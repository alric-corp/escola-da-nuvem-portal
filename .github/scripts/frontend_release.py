"""Contrato de release do frontend: empacotamento, manifesto, validação, publicação, ativação e rollback.

Núcleo compartilhado pelos scripts de .github/scripts/ e pelos testes (tests/integration/test_frontend_release_*.py).
Só a biblioteca padrão; os clientes S3/CloudFront (boto3) e o acesso HTTP são recebidos por parâmetro, para que os
testes usem AWS simulada (moto) e nenhuma rede.

Layout no bucket web:
  /index.html                 ponteiro de ativação (no-cache), único objeto reescrito, sempre com If-Match
  /releases/<release_id>/...  release imutável (If-None-Match), nunca sobrescrita nem apagada pela pipeline
  /app.js, /pages/... (legado) layout plano da versão no ar antes da migração; nunca tocado pela pipeline
"""
from __future__ import annotations

import ast
import base64
import hashlib
import json
import posixpath
import re
import time
from pathlib import Path

SCHEMA = "escola-da-nuvem/frontend-release@1"
BASELINE_SCHEMA = "escola-da-nuvem/frontend-baseline@1"
RELEASES_PREFIX = "releases/"
RELEASE_ID_RE = re.compile(r"^[0-9a-f]{12}-[0-9a-f]{12}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MODES = ("modern", "baseline")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
}
IMMUTABLE = "public, max-age=31536000, immutable"
INDEX_CACHE = "no-cache"
INVALIDATION_PATHS = ["/", "/index.html"]
# O ponteiro reescreve exatamente estes três atributos do index.html da versão.
POINTER_REWRITES = (("href", "logo.png"), ("href", "styles.css"), ("src", "app.js"))
CONFIG_KEYS = ("apiUrl", "authDomain", "instructorEmailDomain", "logoutUri", "redirectUri", "region", "scopes",
               "userPoolClientId", "userPoolId")
MODERN_CONFIG_FETCH = 'new URL("./config.json", import.meta.url)'
# Recursos que a versão resolve contra o documento (/), e não contra o módulo: precisam existir na raiz.
DOCUMENT_RELATIVE = {"modern": ("logo.png",), "baseline": ("config.json", "logo.png")}
FORBIDDEN_SUFFIXES = (".csv", ".tf", ".tfvars", ".tfstate", ".tfplan", ".env", ".pem", ".key", ".hcl")
SENSITIVE_PATTERNS = (
    re.compile(rb"(?:AKIA|ASIA)[0-9A-Z]{16}"),
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(rb"aws_secret_access_key", re.I),
)


class ReleaseError(Exception):
    """Falha que impede empacotar, publicar ou ativar. Mensagem em português, sem segredos."""


class PostActivationError(ReleaseError):
    """O index.html já aponta para a nova release, mas a verificação posterior falhou."""

    def __init__(self, message: str, record=None):
        super().__init__(message)
        self.record = record


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def md5_hex(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()  # noqa: S324 - comparação com o ETag do S3, não segurança


def canonical_json(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def pretty_json(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


# ---------------------------------------------------------------- builder e arquivos

def builder_files(builder: Path) -> list:
    """Lista FILES do scripts/build_frontend.py do commit da versão (lida sem executar o builder)."""
    tree = ast.parse(builder.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "FILES" for t in node.targets):
            files = ast.literal_eval(node.value)
            if not files or not all(isinstance(f, str) for f in files):
                raise ReleaseError("FILES do builder vazio ou inválido.")
            return list(files)
    raise ReleaseError("O builder não define FILES.")


def collect_assets(dist: Path, mode: str, files: list) -> dict:
    """Arquivos da release a partir do dist plano: os FILES do builder (sem index.html) e, na moderna, config.json."""
    if mode not in MODES:
        raise ReleaseError(f"Modo desconhecido: {mode}.")
    present = sorted(p.relative_to(dist).as_posix() for p in dist.rglob("*") if p.is_file())
    expected = sorted(set(files) | {"config.json"})
    if present != expected:
        extra, missing = sorted(set(present) - set(expected)), sorted(set(expected) - set(present))
        raise ReleaseError(f"dist diverge do builder: sobrando {extra}, faltando {missing}.")
    wanted = [f for f in files if f != "index.html"] + (["config.json"] if mode == "modern" else [])
    assets = {}
    for rel in sorted(wanted):
        if posixpath.splitext(rel)[1] not in MIME:
            raise ReleaseError(f"Tipo de arquivo sem MIME definido: {rel}.")
        if rel.lower().endswith(FORBIDDEN_SUFFIXES):
            raise ReleaseError(f"Arquivo proibido na release: {rel}.")
        assets[rel] = (dist / rel).read_bytes()
    return assets


# ---------------------------------------------------------------- configuração pública

def validate_public_origin(origin: str) -> str:
    if not isinstance(origin, str) or not re.fullmatch(r"https://[a-z0-9.-]+\.[a-z]{2,}", origin):
        raise ReleaseError("PUBLIC_ORIGIN precisa ser https://<domínio>, sem caminho nem barra final.")
    return origin


def validate_config(config, public_origin: str) -> dict:
    """Configuração pública do frontend: as 9 chaves do output frontend_config, coerentes com o ambiente."""
    validate_public_origin(public_origin)
    if not isinstance(config, dict) or sorted(config) != sorted(CONFIG_KEYS):
        raise ReleaseError(f"A configuração precisa ter exatamente as chaves {list(CONFIG_KEYS)}.")
    region = config["region"]
    rules = {
        "region": r"[a-z]{2}-[a-z]+-\d",
        "apiUrl": rf"https://[a-z0-9]{{6,20}}\.execute-api\.{re.escape(str(region))}\.amazonaws\.com",
        "authDomain": rf"https://[a-z0-9-]+\.auth\.{re.escape(str(region))}\.amazoncognito\.com",
        "userPoolId": rf"{re.escape(str(region))}_[A-Za-z0-9]+",
        "userPoolClientId": r"[a-z0-9]{20,40}",
        "instructorEmailDomain": r"[a-z0-9.-]+\.[a-z]{2,}",
    }
    for key, pattern in rules.items():
        if not isinstance(config[key], str) or not re.fullmatch(pattern, config[key]):
            raise ReleaseError(f"Valor inválido em {key}.")
    for key in ("redirectUri", "logoutUri"):
        if config[key] != public_origin + "/":
            raise ReleaseError(f"{key} precisa ser a raiz da origem pública ({public_origin}/).")
    scopes = config["scopes"]
    if (not isinstance(scopes, list) or not all(isinstance(s, str) and re.fullmatch(r"[A-Za-z0-9/_:.-]+", s) for s in scopes)
            or "openid" not in scopes or "portal/access" not in scopes):
        raise ReleaseError("scopes inválidos (exigidos openid e portal/access).")
    return config


def canonical_config_bytes(config: dict) -> bytes:
    """Bytes que o builder grava em dist/config.json (json.dumps indent=2 + \\n) para a config em ordem canônica."""
    return (json.dumps({k: config[k] for k in sorted(config)}, indent=2) + "\n").encode()


# ---------------------------------------------------------------- imports e caminhos

_IMPORT_RE = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']""", re.M)
_DYNAMIC_EXPR_RE = re.compile(r"""\bimport\s*\(\s*(?!["'])""")
_DOC_FETCH_RE = re.compile(r"""fetch\(\s*["'](\.\/[^"']*)["']""")
_DOC_ATTR_RE = re.compile(r"""(?:src|href)=\\?["'](\.\/[^"'\\]*)\\?["']""")


def import_graph_problems(assets: dict) -> list:
    """Todo import (estático, reexport ou import() literal) é relativo e resolve para um arquivo da própria release."""
    problems = []
    for rel, data in sorted(assets.items()):
        if not rel.endswith(".js"):
            continue
        text = data.decode("utf-8")
        if _DYNAMIC_EXPR_RE.search(text):
            problems.append(f"{rel}: import() com expressão não literal.")
        for spec in _IMPORT_RE.findall(text):
            if not spec.startswith(("./", "../")):
                problems.append(f"{rel}: import não relativo '{spec}'.")
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec))
            if target.startswith("../") or target not in assets:
                problems.append(f"{rel}: import '{spec}' fora da release ou ausente.")
    return problems


def document_relative_refs(assets: dict) -> set:
    """Recursos que o JavaScript pede relativos ao documento (fetch('./x'), src/href='./x'); './' é navegação."""
    refs = set()
    for rel, data in assets.items():
        if rel.endswith(".js"):
            text = data.decode("utf-8")
            for match in _DOC_FETCH_RE.findall(text) + _DOC_ATTR_RE.findall(text):
                target = match[2:]
                if target:
                    refs.add(target.split("?")[0].split("#")[0])
    return refs


def path_problems(assets: dict, mode: str) -> list:
    problems = []
    refs = document_relative_refs(assets)
    allowed = set(DOCUMENT_RELATIVE[mode])
    if refs - allowed:
        problems.append(f"Recursos relativos ao documento não permitidos no modo {mode}: {sorted(refs - allowed)}.")
    app = assets.get("app.js", b"").decode("utf-8")
    if mode == "modern":
        if MODERN_CONFIG_FETCH not in app:
            problems.append("app.js moderno precisa carregar config.json relativo ao módulo (D1).")
        if "config.json" in refs:
            problems.append("app.js moderno ainda busca ./config.json relativo ao documento.")
    elif MODERN_CONFIG_FETCH in app:
        problems.append("A baseline não pode usar a config por release: ela lê /config.json da raiz.")
    return problems


def sensitive_problems(assets: dict) -> list:
    problems = []
    for rel, data in sorted(assets.items()):
        if rel.lower().endswith(FORBIDDEN_SUFFIXES):
            problems.append(f"Arquivo proibido: {rel}.")
        for pattern in SENSITIVE_PATTERNS:
            if pattern.search(data):
                problems.append(f"{rel}: padrão sensível encontrado.")
    return problems


# ---------------------------------------------------------------- ponteiro

_LOCAL_REF_RE = re.compile(r"""(?:src|href)="([^"]+)\"""")


def make_pointer(index_html: bytes, release_id: str) -> bytes:
    """index.html da versão com logo, CSS e app.js apontando para releases/<id>/; o documento continua na raiz."""
    if not RELEASE_ID_RE.fullmatch(release_id):
        raise ReleaseError("release_id inválido.")
    html = index_html.decode("utf-8")
    refs = _LOCAL_REF_RE.findall(html)
    expected = sorted(f for _, f in POINTER_REWRITES)
    if sorted(r for r in refs if not r.startswith(("https://", "#", "data:"))) != expected:
        raise ReleaseError(f"index.html com referências locais inesperadas: {refs}.")
    for attr, file in POINTER_REWRITES:
        before = f'{attr}="{file}"'
        if html.count(before) != 1:
            raise ReleaseError(f"index.html sem {before} exatamente uma vez.")
        html = html.replace(before, f'{attr}="{RELEASES_PREFIX}{release_id}/{file}"')
    if html.count("<head>") != 1:
        raise ReleaseError("index.html sem <head> único.")
    html = html.replace("<head>", f'<head>\n    <meta name="portal-release" content="{release_id}" />', 1)
    return html.encode("utf-8")


def pointer_release(index_html: bytes):
    """Release apontada pelo index.html publicado, ou None quando é o layout plano legado."""
    match = re.search(rb'<meta name="portal-release" content="([0-9a-f-]+)"', index_html)
    if not match:
        return None
    rid = match.group(1).decode()
    if not RELEASE_ID_RE.fullmatch(rid):
        raise ReleaseError("index.html publicado aponta para um release_id inválido.")
    return rid


# ---------------------------------------------------------------- manifesto

def manifest_core(mode: str, source_sha: str, assets: dict, builder_sha256: str, api: dict) -> dict:
    if not SHA_RE.fullmatch(source_sha or ""):
        raise ReleaseError("source_sha precisa ser um SHA completo (40 hex).")
    files = []
    for rel, data in sorted(assets.items()):
        files.append({"path": rel, "sha256": sha256_hex(data), "md5": md5_hex(data), "size": len(data),
                      "content_type": MIME[posixpath.splitext(rel)[1]], "cache_control": IMMUTABLE})
    config = None
    if mode == "modern":
        cfg = json.loads(assets["config.json"])
        config = {"sha256": sha256_hex(assets["config.json"]), "keys": sorted(cfg)}
    routes = sorted(api.get("routes", []))
    if not routes or not all(re.fullmatch(r"(GET|POST|PUT|PATCH|DELETE) /\S*", r) for r in routes):
        raise ReleaseError("Lista de rotas da API vazia ou inválida.")
    return {
        "schema": SCHEMA,
        "mode": mode,
        "source_sha": source_sha,
        "builder_sha256": builder_sha256,
        "files": files,
        "config": config,
        "document_relative": list(DOCUMENT_RELATIVE[mode]),
        "api": {"routes": routes, "openapi_sha256": api.get("openapi_sha256")},
    }


def release_id_for(core: dict) -> tuple:
    digest = sha256_hex(canonical_json(core))
    return f"{core['source_sha'][:12]}-{digest[:12]}", digest


def build_release(mode: str, source_sha: str, dist: Path, builder: Path, api: dict):
    """(manifest, assets, pointer) determinísticos para um dist plano gerado pelo builder do mesmo commit."""
    files = builder_files(builder)
    assets = collect_assets(dist, mode, files)
    core = manifest_core(mode, source_sha, assets, sha256_hex(builder.read_bytes()), api)
    release_id, digest = release_id_for(core)
    pointer = make_pointer((dist / "index.html").read_bytes(), release_id)
    manifest = dict(core, release_id=release_id, content_digest=digest,
                    pointer={"sha256": sha256_hex(pointer), "md5": md5_hex(pointer), "size": len(pointer)})
    return manifest, assets, pointer


def write_release(out: Path, manifest: dict, assets: dict, pointer: bytes) -> Path:
    root = out / manifest["release_id"]
    if root.exists():
        raise ReleaseError(f"Diretório de saída já existe: {root}.")
    for rel, data in assets.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(data)
    (root / "pointer.html").write_bytes(pointer)
    (root / "manifest.json").write_bytes(pretty_json(manifest))
    return root


def manifest_problems(manifest: dict) -> list:
    """Coerência interna: schema, modo, id recalculado a partir do núcleo e ponteiro descrito."""
    problems = []
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        return ["Manifesto ausente ou de schema desconhecido."]
    if manifest.get("mode") not in MODES:
        problems.append("Modo inválido no manifesto.")
    core_keys = ("schema", "mode", "source_sha", "builder_sha256", "files", "config", "document_relative", "api")
    try:
        core = {k: manifest[k] for k in core_keys}
        release_id, digest = release_id_for(core)
    except (KeyError, TypeError):
        return problems + ["Manifesto incompleto."]
    if manifest.get("content_digest") != digest or manifest.get("release_id") != release_id:
        problems.append("Manifesto adulterado: release_id/content_digest não correspondem ao conteúdo descrito.")
    for f in manifest["files"]:
        ext = posixpath.splitext(f.get("path", ""))[1]
        if MIME.get(ext) != f.get("content_type") or f.get("cache_control") != IMMUTABLE:
            problems.append(f"MIME ou cache inválido para {f.get('path')}.")
    if not isinstance(manifest.get("pointer"), dict):
        problems.append("Manifesto sem ponteiro.")
    return problems


def load_release_dir(release_dir: Path) -> tuple:
    manifest = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))
    problems = manifest_problems(manifest)
    if problems:
        raise ReleaseError(" ".join(problems))
    assets = {}
    for f in manifest["files"]:
        data = (release_dir / f["path"]).read_bytes()
        if sha256_hex(data) != f["sha256"] or md5_hex(data) != f["md5"] or len(data) != f["size"]:
            raise ReleaseError(f"Arquivo local diverge do manifesto: {f['path']}.")
        assets[f["path"]] = data
    present = sorted(p.relative_to(release_dir).as_posix() for p in release_dir.rglob("*") if p.is_file())
    if present != sorted(set(assets) | {"manifest.json", "pointer.html"}):
        raise ReleaseError("Diretório da release com arquivos fora do manifesto.")
    pointer = (release_dir / "pointer.html").read_bytes()
    if sha256_hex(pointer) != manifest["pointer"]["sha256"]:
        raise ReleaseError("pointer.html diverge do manifesto.")
    return manifest, assets, pointer


# ---------------------------------------------------------------- validação completa (offline)

def baseline_problems(manifest: dict, assets: dict, pointer: bytes, baseline: dict) -> list:
    problems = []
    if baseline.get("schema") != BASELINE_SCHEMA:
        return ["baseline.json de schema desconhecido."]
    if manifest["mode"] != "baseline" or manifest["source_sha"] != baseline["source_sha"]:
        problems.append("A release não é a baseline fixada em baseline.json.")
    expected = baseline["files"]
    for rel, data in assets.items():
        if expected.get(rel, {}).get("sha256") != sha256_hex(data):
            problems.append(f"Baseline diverge do publicado: {rel}.")
    if sorted(set(assets) | {"index.html"}) != sorted(expected):
        problems.append("Conjunto de arquivos da baseline diverge de baseline.json.")
    return problems


def validate_release(release_dir: Path, public_origin=None, baseline=None, live_config=None,
                     allow_config_change=False) -> dict:
    """Todas as verificações offline de uma release empacotada. Levanta ReleaseError com a lista de problemas."""
    manifest, assets, pointer = load_release_dir(release_dir)
    problems = []
    problems += import_graph_problems(assets)
    problems += path_problems(assets, manifest["mode"])
    problems += sensitive_problems(dict(assets, **{"pointer.html": pointer}))
    pointer_refs = [r for r in _LOCAL_REF_RE.findall(pointer.decode("utf-8")) if not r.startswith(("https://", "#", "data:"))]
    if sorted(pointer_refs) != sorted(f"{RELEASES_PREFIX}{manifest['release_id']}/{f}" for _, f in POINTER_REWRITES):
        problems.append("Ponteiro referencia caminhos fora da própria release.")
    if pointer_release(pointer) != manifest["release_id"]:
        problems.append("Ponteiro sem o meta portal-release da própria release.")
    if manifest["mode"] == "modern":
        try:
            config = validate_config(json.loads(assets["config.json"]), public_origin)
        except ReleaseError as err:
            problems.append(f"Configuração: {err}")
            config = None
        if config is not None and live_config is not None and config != live_config and not allow_config_change:
            problems.append("A configuração difere da publicada; mudança de config exige aprovação explícita.")
    if manifest["mode"] == "baseline":
        if baseline is None:
            problems.append("Release baseline sem baseline.json para conferir.")
        else:
            problems += baseline_problems(manifest, assets, pointer, baseline)
    if problems:
        raise ReleaseError("Release inválida: " + " | ".join(problems))
    return manifest


def published_config(fetch, public_origin: str) -> tuple:
    """(config, caminho) que a versão no ar usa: a da release ativa moderna ou /config.json (legado e baseline)."""
    validate_public_origin(public_origin)
    status, _, index = fetch(f"{public_origin}/")
    if status != 200:
        raise ReleaseError(f"index.html publicado indisponível (HTTP {status}).")
    path = "/config.json"
    rid = pointer_release(index)
    if rid:
        status, _, body = fetch(f"{public_origin}/{RELEASES_PREFIX}{rid}/manifest.json")
        if status != 200:
            raise ReleaseError(f"Manifesto da release ativa {rid} indisponível (HTTP {status}).")
        if json.loads(body).get("mode") == "modern":
            path = f"/{RELEASES_PREFIX}{rid}/config.json"
    status, _, body = fetch(public_origin + path)
    if status != 200:
        raise ReleaseError(f"Config publicada indisponível em {path} (HTTP {status}).")
    return json.loads(body), path


def live_equivalence_problems(baseline: dict, fetch, public_origin: str) -> list:
    """Bytes servidos hoje na raiz (layout plano) == arquivos fixados em baseline.json."""
    validate_public_origin(public_origin)
    problems = []
    for rel, meta in sorted(baseline["files"].items()):
        status, headers, body = fetch(f"{public_origin}/{rel}")
        if status != 200 or sha256_hex(body) != meta["sha256"]:
            problems.append(f"Publicado diverge da baseline: {rel} (HTTP {status}).")
    return problems


# ---------------------------------------------------------------- S3: publicação

def _code(err) -> str:
    return getattr(err, "response", {}).get("Error", {}).get("Code", "")


def _status(err) -> int:
    return getattr(err, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode", 0)


def _is_precondition(err) -> bool:
    return _code(err) in ("PreconditionFailed", "412") or _status(err) == 412


def _put_release_object(s3, bucket, key, body, content_type):
    return s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, CacheControl=IMMUTABLE,
                         ContentMD5=base64.b64encode(hashlib.md5(body).digest()).decode(),  # noqa: S324
                         IfNoneMatch="*")


def publish_release(s3, bucket: str, release_dir: Path, log=print) -> dict:
    """Envia a release com If-None-Match (nunca sobrescreve). Manifesto por último: sem ele a release não ativa."""
    from botocore.exceptions import ClientError

    manifest, assets, pointer = load_release_dir(release_dir)
    rid = manifest["release_id"]
    prefix = f"{RELEASES_PREFIX}{rid}/"
    items = [(rel, data, MIME[posixpath.splitext(rel)[1]]) for rel, data in sorted(assets.items())]
    items += [("pointer.html", pointer, MIME[".html"]), ("manifest.json", pretty_json(manifest), MIME[".json"])]
    created = identical = 0
    for rel, data, ctype in items:
        key = prefix + rel
        try:
            _put_release_object(s3, bucket, key, data, ctype)
            created += 1
        except ClientError as err:
            if not _is_precondition(err):
                raise ReleaseError(f"Falha ao publicar {key}: {_code(err) or err}.") from err
            existing = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
            if sha256_hex(existing) != sha256_hex(data):
                raise ReleaseError(f"Conflito: {key} já existe com conteúdo diferente; release imutável não é sobrescrita.")
            identical += 1
    verify_remote_release(s3, bucket, rid)
    log(f"release {rid}: {created} objetos criados, {identical} já idênticos")
    return {"release_id": rid, "created": created, "identical": identical}


def remote_manifest(s3, bucket: str, release_id: str) -> dict:
    from botocore.exceptions import ClientError

    if not RELEASE_ID_RE.fullmatch(release_id or ""):
        raise ReleaseError("release_id inválido.")
    try:
        raw = s3.get_object(Bucket=bucket, Key=f"{RELEASES_PREFIX}{release_id}/manifest.json")["Body"].read()
    except ClientError as err:
        raise ReleaseError(f"Release {release_id} sem manifesto publicado ({_code(err) or err}).") from err
    manifest = json.loads(raw)
    problems = manifest_problems(manifest)
    if problems or manifest.get("release_id") != release_id:
        raise ReleaseError(f"Manifesto remoto inválido para {release_id}: {' '.join(problems) or 'id diverge'}.")
    return manifest


def verify_remote_release(s3, bucket: str, release_id: str) -> dict:
    """Cada objeto do manifesto existe com ETag == md5, MIME e cache registrados; ponteiro também."""
    from botocore.exceptions import ClientError

    manifest = remote_manifest(s3, bucket, release_id)
    prefix = f"{RELEASES_PREFIX}{release_id}/"
    expected = [(f["path"], f["md5"], f["content_type"], f["cache_control"]) for f in manifest["files"]]
    expected.append(("pointer.html", manifest["pointer"]["md5"], MIME[".html"], IMMUTABLE))
    for rel, md5, ctype, cache in expected:
        try:
            head = s3.head_object(Bucket=bucket, Key=prefix + rel)
        except ClientError as err:
            raise ReleaseError(f"Objeto ausente na release {release_id}: {rel} ({_code(err) or err}).") from err
        if head.get("ETag", "").strip('"') != md5 or head.get("ContentType") != ctype or head.get("CacheControl") != cache:
            raise ReleaseError(f"Objeto da release {release_id} diverge do manifesto: {rel}.")
    return manifest


def remote_pointer(s3, bucket: str, manifest: dict) -> bytes:
    pointer = s3.get_object(Bucket=bucket, Key=f"{RELEASES_PREFIX}{manifest['release_id']}/pointer.html")["Body"].read()
    if sha256_hex(pointer) != manifest["pointer"]["sha256"] or pointer_release(pointer) != manifest["release_id"]:
        raise ReleaseError("pointer.html remoto diverge do manifesto.")
    return pointer


def read_active(s3, bucket: str) -> dict:
    obj = s3.get_object(Bucket=bucket, Key="index.html")
    body = obj["Body"].read()
    return {"etag": obj["ETag"], "release_id": pointer_release(body), "md5": md5_hex(body)}


# ---------------------------------------------------------------- ativação e rollback

def forward_problems(target: dict, active_manifest, active: dict, baseline: dict, git) -> list:
    """Ativação para frente: piso, main e, a partir do legado, somente a baseline fixada."""
    problems = []
    floor = baseline["rollback_floor_sha"]
    if not git.on_first_parent(target["source_sha"]):
        problems.append("A release não foi construída de um commit da first-parent da main.")
    elif not git.is_ancestor(floor, target["source_sha"]):
        problems.append("A release é anterior ao piso histórico.")
    if active["release_id"] is None:
        legacy_index = baseline["files"]["index.html"]["md5"]
        if target["mode"] != "baseline" or target["source_sha"] != baseline["source_sha"]:
            problems.append("A partir do layout legado, a primeira ativação precisa ser a baseline fixada.")
        if active["md5"] != legacy_index:
            problems.append("O index.html legado publicado não é o da baseline; ativação recusada.")
    elif active_manifest is not None and not git.is_ancestor(active_manifest["source_sha"], target["source_sha"]):
        problems.append("A release é anterior à ativa: use a operação rollback.")
    return problems


def rollback_problems(target: dict, active_manifest, baseline: dict, git, confirm_release_id: str) -> list:
    """Rollback: release existente e íntegra, piso, rotas da API contidas e revisão explícita de contrato."""
    problems = []
    if active_manifest is None:
        return ["Não há release ativa: rollback a partir do legado não é feito pela pipeline."]
    if target["release_id"] == active_manifest["release_id"]:
        problems.append("A release alvo já é a ativa.")
    if not git.on_first_parent(target["source_sha"]):
        problems.append("A release alvo não vem da first-parent da main.")
    elif not git.is_ancestor(baseline["rollback_floor_sha"], target["source_sha"]):
        problems.append("Rollback abaixo do piso histórico 1daab31 recusado.")
    elif (target["source_sha"] != active_manifest["source_sha"]
          and git.is_ancestor(active_manifest["source_sha"], target["source_sha"])):
        problems.append("A release alvo é posterior à ativa: use a operação activate.")
    missing = sorted(set(target["api"]["routes"]) - set(active_manifest["api"]["routes"]))
    if missing:
        problems.append(f"Rotas da API usadas pelo alvo e ausentes na release ativa: {missing}.")
    if target["api"].get("openapi_sha256") != active_manifest["api"].get("openapi_sha256") and confirm_release_id != target["release_id"]:
        problems.append("Contratos OpenAPI diferentes: confirme a revisão de compatibilidade repetindo o release_id alvo.")
    return problems


def invalidate(cloudfront, distribution_id: str, caller_reference: str, timeout_seconds=900, poll_seconds=10,
               sleep=time.sleep) -> str:
    batch = {"Paths": {"Quantity": len(INVALIDATION_PATHS), "Items": list(INVALIDATION_PATHS)},
             "CallerReference": caller_reference}
    inv = cloudfront.create_invalidation(DistributionId=distribution_id, InvalidationBatch=batch)["Invalidation"]
    waited = 0
    # A AWS documenta "InProgress" e "Completed"; o moto usa "COMPLETED".
    while str(inv.get("Status", "")).lower() != "completed":
        if waited >= timeout_seconds:
            raise PostActivationError(f"Invalidação {inv['Id']} não concluiu em {timeout_seconds}s.")
        sleep(poll_seconds)
        waited += poll_seconds
        inv = cloudfront.get_invalidation(DistributionId=distribution_id, Id=inv["Id"])["Invalidation"]
    return inv["Id"]


def smoke_problems(fetch, public_origin: str, manifest: dict) -> list:
    """Verificação pública depois da ativação: ponteiro, cada arquivo da release (bytes e MIME), dependências da raiz."""
    rid = manifest["release_id"]
    problems = []
    status, headers, body = fetch(f"{public_origin}/")
    if status != 200 or pointer_release(body) != rid:
        problems.append(f"A raiz não serve o ponteiro da release {rid} (HTTP {status}).")
    for f in manifest["files"]:
        status, headers, body = fetch(f"{public_origin}/{RELEASES_PREFIX}{rid}/{f['path']}")
        if status != 200 or sha256_hex(body) != f["sha256"] or headers.get("content-type") != f["content_type"]:
            problems.append(f"Arquivo publicado diverge: {f['path']} (HTTP {status}).")
    for rel in manifest["document_relative"]:
        status, headers, body = fetch(f"{public_origin}/{rel}")
        if status != 200:
            problems.append(f"Dependência da raiz indisponível: /{rel} (HTTP {status}).")
    return problems


def activate_release(s3, cloudfront, *, bucket, distribution_id, release_id, public_origin, baseline, git, fetch,
                     mode="activate", expected_active="", confirm_release_id="", caller_reference,
                     smoke_attempts=10, smoke_wait=15, sleep=time.sleep, log=print) -> dict:
    """Ativa (ou faz rollback para) uma release já publicada.

    Antes do PutObject do index.html nada muda: manifesto, objetos, ponteiro, piso, rotas e a release ativa
    esperada são conferidos. A escrita usa If-Match com o ETag lido; corrida resulta em 412 e falha segura.
    Depois da escrita, falhas viram PostActivationError com diagnóstico; não há rollback automático.
    """
    from botocore.exceptions import ClientError

    validate_public_origin(public_origin)
    target = verify_remote_release(s3, bucket, release_id)
    pointer = remote_pointer(s3, bucket, target)
    active = read_active(s3, bucket)
    current = active["release_id"] or "legacy"
    if expected_active and expected_active != current:
        raise ReleaseError(f"Release ativa é {current}, não {expected_active}; nada foi alterado.")
    active_manifest = remote_manifest(s3, bucket, active["release_id"]) if active["release_id"] else None
    if mode == "rollback":
        problems = rollback_problems(target, active_manifest, baseline, git, confirm_release_id)
    elif mode == "activate":
        problems = [] if current == release_id else forward_problems(target, active_manifest, active, baseline, git)
    else:
        raise ReleaseError(f"Modo de ativação desconhecido: {mode}.")
    if problems:
        raise ReleaseError("Ativação recusada: " + " | ".join(problems))
    record = {"release_id": release_id, "previous_release": current, "mode": mode, "etag_before": active["etag"]}
    if current == release_id:
        log(f"release {release_id} já está ativa; index.html não foi reescrito")
        record["changed"] = False
    else:
        try:
            put = s3.put_object(Bucket=bucket, Key="index.html", Body=pointer, ContentType=MIME[".html"],
                                CacheControl=INDEX_CACHE, IfMatch=active["etag"])
        except ClientError as err:
            if _is_precondition(err):
                raise ReleaseError("index.html mudou desde a leitura (corrida); nada foi sobrescrito.") from err
            raise ReleaseError(f"Falha ao ativar: {_code(err) or err}.") from err
        record.update(changed=True, etag_after=put.get("ETag"))
        log(f"index.html → release {release_id} (anterior: {current})")
    recovery = (f"Recuperação: rollback para {current} (operation=rollback, release_id={current}, "
                f"expected_active_release={release_id})" if current != "legacy" else
                "Recuperação: restaurar o index.html legado da baseline (procedimento manual do runbook).")
    record.update(smoke="pendente", recovery=recovery)
    try:
        record["invalidation_id"] = invalidate(cloudfront, distribution_id, caller_reference, sleep=sleep)
        problems = []
        for attempt in range(smoke_attempts):
            problems = smoke_problems(fetch, public_origin, target)
            if not problems:
                break
            sleep(smoke_wait)
    except PostActivationError as err:
        record["smoke"] = "não executado"
        raise PostActivationError(f"{err} {recovery}", record) from err
    except Exception as err:  # noqa: BLE001 - qualquer falha depois da escrita vira diagnóstico explícito
        record["smoke"] = "não executado"
        raise PostActivationError(f"Falha depois da ativação: {err}. {recovery}", record) from err
    if problems:
        record["smoke"] = "falhou"
        raise PostActivationError("Smoke falhou depois da ativação: " + " | ".join(problems) + f". {recovery}", record)
    record["smoke"] = "ok"
    return record

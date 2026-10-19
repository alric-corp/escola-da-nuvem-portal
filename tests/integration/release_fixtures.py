"""Fixtures dos testes da pipeline de release do frontend (tests/integration/test_frontend_release_*.py).

Builds reais com o builder do repositório: a árvore de trabalho (versão moderna, com D1) e a baseline C7.3 extraída
do histórico com git archive. Nada é gravado no checkout: tudo vai para diretórios temporários. A rede externa fica
bloqueada durante os testes (só sockets locais), e a AWS é sempre o moto.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import frontend_release as fr  # noqa: E402
from release_cli import Git  # noqa: E402
from release_gate import ENVIRONMENT, ROLE_NAME  # noqa: E402

BASELINE = json.loads((ROOT / ".github" / "release" / "baseline.json").read_text(encoding="utf-8"))
BASELINE_SHA = BASELINE["source_sha"]
ORIGIN = "https://portal.example.test"
BUCKET = "portal-web-test"
REGION = "us-east-1"
# Histórico simulado da first-parent, do mais antigo ao mais novo; OFF_MAIN não está nela.
PRE_FLOOR, MAIN_1, MAIN_2, OFF_MAIN = "0" * 40, "a1" * 20, "b2" * 20, "c3" * 20
HISTORY = (PRE_FLOOR, BASELINE_SHA, MAIN_1, MAIN_2)
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".json": "application/json", ".png": "image/png"}


def config(marker: str = "1") -> dict:
    """Config pública fictícia, no formato do output frontend_config (valores que não existem na AWS)."""
    return {
        "apiUrl": f"https://api{marker}teste01.execute-api.{REGION}.amazonaws.com",
        "authDomain": f"https://portal-teste-{marker}.auth.{REGION}.amazoncognito.com",
        "instructorEmailDomain": "example.test",
        "logoutUri": ORIGIN + "/",
        "redirectUri": ORIGIN + "/",
        "region": REGION,
        "scopes": ["openid", "email", "portal/access"],
        "userPoolClientId": ("cliente" + marker * 20)[:26],
        "userPoolId": f"{REGION}_Teste{marker}",
    }


class FakeGit:
    """Ancestralidade da first-parent simulada (os testes de S3 não dependem do histórico real)."""

    def __init__(self, order=HISTORY):
        self.order = list(order)

    def on_first_parent(self, sha: str) -> bool:
        return sha in self.order

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        return ancestor in self.order and descendant in self.order and self.order.index(ancestor) <= self.order.index(descendant)


def copy_app(dest: Path) -> Path:
    """Fontes da árvore de trabalho que o builder lê (frontend/, builder e OpenAPI), fora do checkout."""
    shutil.copytree(ROOT / "frontend", dest / "frontend", ignore=shutil.ignore_patterns("dist", "config.json"))
    (dest / "scripts").mkdir(parents=True)
    shutil.copy2(ROOT / "scripts" / "build_frontend.py", dest / "scripts" / "build_frontend.py")
    (dest / "openapi").mkdir()
    shutil.copy2(ROOT / "openapi" / "portal.yaml", dest / "openapi" / "portal.yaml")
    return dest


def archive_baseline(dest: Path) -> Path:
    Git(ROOT).archive(BASELINE_SHA, dest)
    return dest


def build(app: Path, cfg=None) -> Path:
    args = [sys.executable, "-B", str(app / "scripts" / "build_frontend.py")]
    if cfg is not None:
        cfg_file = app.parent / f"{app.name}-config.json"
        cfg_file.write_bytes(fr.canonical_config_bytes(cfg))
        args += ["--config", str(cfg_file)]
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
    return app / "frontend" / "dist"


def api_routes(app: Path, work: Path) -> dict:
    out = work / f"{app.name}-routes.json"
    subprocess.run(["node", str(SCRIPTS / "release-api-routes.mjs"), "--api", str(app / "frontend" / "dist" / "api.js"),
                    "--source-openapi", str(app / "openapi" / "portal.yaml"),
                    "--contract-openapi", str(ROOT / "openapi" / "portal.yaml"), "--out", str(out)],
                   check=True, stdout=subprocess.DEVNULL, cwd=ROOT)
    return json.loads(out.read_text(encoding="utf-8"))


def package(mode: str, sha: str, app: Path, api: dict, out: Path) -> Path:
    manifest, assets, pointer = fr.build_release(mode, sha, app / "frontend" / "dist", app / "scripts" / "build_frontend.py", api)
    return fr.write_release(out, manifest, assets, pointer)


def child_env(**extra) -> dict:
    """Ambiente de subprocesso sem as variáveis do runner (GITHUB_OUTPUT, GITHUB_SHA...) nem credenciais AWS."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GITHUB_", "AWS_", "RUNNER_", "ACTIONS_"))}
    env.update(AWS_EC2_METADATA_DISABLED="true", AWS_CONFIG_FILE=os.devnull, AWS_SHARED_CREDENTIALS_FILE=os.devnull, **extra)
    return env


# ---------------------------------------------------------------- GitHub simulado (gates do workflow)

SHA = "d4" * 20                      # commit da execução simulada (GITHUB_SHA)
RID = "d4d4d4d4d4d4-0123456789ab"
REPO = "org-teste/portal-teste"
ROLE = f"arn:aws:iam::123456789012:role/{ROLE_NAME}"
ENVDOC = {
    "name": "production", "can_admins_bypass": False,
    "protection_rules": [{"type": "required_reviewers", "prevent_self_review": False,
                          "reviewers": [{"type": "User", "reviewer": {"login": "revisor"}}]}],
    "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
}
_MAIN_REF = object()


def load_script(name):
    """Carrega um script de .github/scripts/ com hífen no nome (check-deploy-gate.py, verify-access.py...)."""
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def repo_env(**overrides):
    env = {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA, "EXPECTED_MAIN_SHA": SHA,
           "OPERATION": "prepare", "SOURCE": "main", "GITHUB_REPOSITORY": REPO, "DEPLOY_ENABLED": "true"}
    env.update(overrides)
    return {k: v for k, v in env.items() if v is not None}


def environment_env(**overrides):
    env = {"AWS_ROLE_ARN": ROLE, "AWS_REGION": REGION, "FRONTEND_BUCKET": "portal-web-teste", "CLOUDFRONT_DISTRIBUTION_ID": "E1ABCDEFGHIJ",
           "PUBLIC_ORIGIN": "https://portal.example.test", "FRONTEND_CONFIG_JSON": json.dumps(config()),
           "OPERATION": "publish", "SOURCE": "main"}
    env.update(overrides)
    return {k: v for k, v in env.items() if v is not None}


def main_ref(sha):
    """Resposta de GET /repos/{repo}/git/ref/heads/main."""
    return {"ref": "refs/heads/main", "node_id": "REF_teste", "url": f"https://api.github.com/repos/{REPO}/git/refs/heads/main",
            "object": {"sha": sha, "type": "commit", "url": f"https://api.github.com/repos/{REPO}/git/commits/{sha}"}}


class FakeGitHub:
    """API do GitHub simulada: runs da CI, environment, políticas de branch e o HEAD de refs/heads/main.

    head pode mudar durante o teste (a main avança enquanto o workflow espera aprovação).
    """

    def __init__(self, ci=("success",), env=ENVDOC, env_status=200, branches=(("main", "branch"),), runs_sha=SHA,
                 head=SHA, head_status=200, head_payload=_MAIN_REF):
        self.ci, self.env, self.env_status, self.branches, self.runs_sha, self.paths = ci, env, env_status, branches, runs_sha, []
        self.head, self.head_status, self.head_payload = head, head_status, head_payload

    def __call__(self, path):
        self.paths.append(path)
        if path.endswith("/git/ref/heads/main"):
            return self.head_status, main_ref(self.head) if self.head_payload is _MAIN_REF else self.head_payload
        if "/actions/workflows/ci.yml/runs?" in path:
            return 200, {"workflow_runs": [{"head_sha": self.runs_sha, "conclusion": c} for c in self.ci]}
        if path.endswith("/deployment-branch-policies"):
            return 200, {"branch_policies": [{"name": n, "type": t} for n, t in self.branches]}
        if path.endswith(f"/environments/{ENVIRONMENT}"):
            return self.env_status, self.env if self.env_status == 200 else None
        raise AssertionError(f"consulta inesperada: {path}")


# ---------------------------------------------------------------- rede

_LOCAL = {"127.0.0.1", "::1", "localhost"}


def block_network():
    """Só conexões locais (unix ou loopback). Devolve a função que restaura o socket original."""
    connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo

    def allowed(address):
        return not isinstance(address, tuple) or address[0] in _LOCAL

    def guard(original):
        def wrapper(self, address):
            if not allowed(address):
                raise OSError(f"Rede externa bloqueada nos testes: {address[0]}")
            return original(self, address)
        return wrapper

    def resolve(host, *args, **kwargs):
        if host not in _LOCAL and host is not None:
            raise OSError(f"Rede externa bloqueada nos testes: {host}")
        return getaddrinfo(host, *args, **kwargs)

    socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = guard(connect), guard(connect_ex), resolve

    def restore():
        socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = connect, connect_ex, getaddrinfo
    return restore


# ---------------------------------------------------------------- S3 e CloudFront simulados

class Spy:
    """Cliente S3 que registra cada PutObject e permite intervir logo antes dele (corrida, falha parcial)."""

    def __init__(self, client, before_put=None):
        self.client, self.before_put, self.puts = client, before_put, []

    def __getattr__(self, name):
        attr = getattr(self.client, name)
        if name != "put_object":
            return attr

        def put_object(**kwargs):
            self.puts.append(kwargs)
            if self.before_put:
                self.before_put(kwargs)
            return attr(**kwargs)
        return put_object


def put_legacy(s3, dist: Path, root_config: dict):
    """Layout plano publicado hoje (C7.3): os 30 arquivos na raiz e /config.json, como o deploy legado deixou."""
    for path in sorted(p for p in dist.rglob("*") if p.is_file() and p.name != "config.json"):
        rel = path.relative_to(dist).as_posix()
        s3.put_object(Bucket=BUCKET, Key=rel, Body=path.read_bytes(), ContentType=MIME[path.suffix],
                      CacheControl="no-cache" if rel == "index.html" else "public, max-age=300")
    s3.put_object(Bucket=BUCKET, Key="config.json", Body=json.dumps(root_config).encode(), ContentType=MIME[".json"])


def create_distribution(cloudfront) -> str:
    origin_id = "web"
    dist = cloudfront.create_distribution(DistributionConfig={
        "CallerReference": "portal-web-test", "Comment": "teste", "Enabled": True, "DefaultRootObject": "index.html",
        "Origins": {"Quantity": 1, "Items": [{"Id": origin_id, "DomainName": f"{BUCKET}.s3.{REGION}.amazonaws.com",
                                              "S3OriginConfig": {"OriginAccessIdentity": ""}}]},
        "DefaultCacheBehavior": {"TargetOriginId": origin_id, "ViewerProtocolPolicy": "redirect-to-https",
                                 "MinTTL": 0, "ForwardedValues": {"QueryString": False, "Cookies": {"Forward": "none"}},
                                 "TrustedSigners": {"Enabled": False, "Quantity": 0}},
    })
    return dist["Distribution"]["Id"]


def s3_fetch(s3):
    """HTTPS público simulado: CloudFront servindo o bucket (raiz → index.html; ausente → 403, sem fallback HTML)."""
    from botocore.exceptions import ClientError

    def fetch(url: str):
        assert url.startswith(ORIGIN + "/"), url
        key = url[len(ORIGIN) + 1:].split("?")[0] or "index.html"
        try:
            obj = s3.get_object(Bucket=BUCKET, Key=key)
        except ClientError:
            return 403, {}, b""
        return 200, {"content-type": obj["ContentType"]}, obj["Body"].read()
    return fetch

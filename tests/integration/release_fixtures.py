"""Fixtures dos testes da pipeline de release do frontend (tests/integration/test_frontend_release_*.py).

Builds reais com o builder do repositório: a árvore de trabalho (versão moderna, com D1) e a baseline C7.3 extraída
do histórico com git archive. Nada é gravado no checkout: tudo vai para diretórios temporários. A rede externa fica
bloqueada durante os testes (só sockets locais), e a AWS é sempre o moto.
"""
from __future__ import annotations

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

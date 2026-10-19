"""Adaptadores de E/S dos scripts de release: AWS (boto3), HTTP público, API do GitHub, git e resumo do job.

A lógica de decisão fica em frontend_release.py e release_gate.py; aqui só há a ligação com o ambiente real.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parents[1]
BASELINE = REPO_ROOT / ".github" / "release" / "baseline.json"


def fail(message: str, code: int = 1):
    print(f"::error::{message}" if os.environ.get("GITHUB_ACTIONS") == "true" else f"ERRO: {message}", file=sys.stderr)
    sys.exit(code)


def summary(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(lines) + "\n"
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text)
    print(text, end="")


def set_outputs(**values):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            for key, value in values.items():
                handle.write(f"{key}={value}\n")


def load_baseline(path: Path = BASELINE) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def http_fetch(url: str, timeout: int = 20):
    """GET público sem cache. Devolve (status, headers em minúsculas, corpo)."""
    if not url.startswith("https://"):
        raise ValueError("Somente HTTPS.")
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "frontend-release-smoke"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL validada acima
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


def github_get(path: str, env=None, timeout: int = 20):
    """GET na API do GitHub com o GITHUB_TOKEN do job (GH_TOKEN). Devolve (status HTTP, JSON ou None).

    Falha fechada para quem chama: sem token ou URL não HTTPS, rede, TLS ou timeout → (0, None); erro HTTP →
    (código, None); JSON inválido → (status, None). O token só vai no cabeçalho; nada da requisição é impresso.
    """
    env = os.environ if env is None else env
    api, token = env.get("GITHUB_API_URL", "https://api.github.com"), env.get("GH_TOKEN", "")
    if not api.startswith("https://") or not token:
        return 0, None
    request = urllib.request.Request(api + path, headers={"Authorization": f"Bearer {token}",
                                                          "Accept": "application/vnd.github+json",
                                                          "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL HTTPS da API do GitHub
            status, body = response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, None
    except (urllib.error.URLError, OSError, ValueError):
        return 0, None
    try:
        return status, json.loads(body)
    except ValueError:
        return status, None


def main_head_guard(env=None, get=None):
    """Verificação C: função que revalida o HEAD da main imediatamente antes da primeira escrita AWS.

    Levanta ReleaseError (nada foi alterado) quando a main avançou ou a API não confirma o HEAD.
    """
    from frontend_release import ReleaseError
    from release_gate import main_head_problems

    env = dict(os.environ if env is None else env)

    def guard():
        problems = main_head_problems(env, get or (lambda path: github_get(path, env)))
        if problems:
            raise ReleaseError("Revalidação antes da escrita: " + " | ".join(problems))
    return guard


class Git:
    """Consultas de ancestralidade no checkout do pipeline (fetch-depth: 0)."""

    def __init__(self, repo: Path, main_ref: str = "HEAD"):
        self.repo, self.main_ref = Path(repo), main_ref
        self._first_parent = None

    def _git(self, *args, check=True):
        return subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, text=True, check=check)

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        return self._git("merge-base", "--is-ancestor", ancestor, descendant, check=False).returncode == 0

    def on_first_parent(self, sha: str) -> bool:
        if self._first_parent is None:
            self._first_parent = set(self._git("rev-list", "--first-parent", self.main_ref).stdout.split())
        return sha in self._first_parent

    def archive(self, sha: str, dest: Path, paths=("frontend", "scripts/build_frontend.py", "openapi/portal.yaml")):
        dest.mkdir(parents=True, exist_ok=False)
        archive = subprocess.run(["git", "-C", str(self.repo), "archive", sha, *paths], capture_output=True, check=True)
        subprocess.run(["tar", "-x", "-C", str(dest)], input=archive.stdout, check=True)


def aws_clients(region: str):
    import boto3

    session = boto3.session.Session(region_name=region)
    if session.get_credentials() is None:
        fail("Credenciais AWS ausentes: o passo configure-aws-credentials (OIDC) não rodou ou falhou.")
    return session.client("s3"), session.client("cloudfront"), session.client("sts")


def caller_reference(release_id: str) -> str:
    return f"{release_id}-{os.environ.get('GITHUB_RUN_ID', 'local')}-{os.environ.get('GITHUB_RUN_ATTEMPT', '0')}"


def run_activation(mode: str, argv=None):
    """CLI compartilhada por activate-release.py e rollback-release.py (mesmo caminho testado)."""
    import argparse

    from frontend_release import PostActivationError, ReleaseError, activate_release, pretty_json

    parser = argparse.ArgumentParser(description=f"{mode} de uma release já publicada")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--distribution-id", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--public-origin", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--expected-active", default="")
    parser.add_argument("--confirm-release-id", default="")
    parser.add_argument("--record-out", type=Path)
    args = parser.parse_args(argv)
    s3, cloudfront, _ = aws_clients(args.region)
    try:
        record = activate_release(
            s3, cloudfront, bucket=args.bucket, distribution_id=args.distribution_id, release_id=args.release_id,
            public_origin=args.public_origin, baseline=load_baseline(), git=Git(REPO_ROOT), fetch=http_fetch,
            mode=mode, expected_active=args.expected_active, confirm_release_id=args.confirm_release_id,
            caller_reference=caller_reference(args.release_id), before_write=main_head_guard())
    except PostActivationError as err:
        if args.record_out and err.record:
            args.record_out.write_bytes(pretty_json(dict(err.record, error=str(err))))
        summary([f"### ATENÇÃO: falha depois da ativação de `{args.release_id}`", f"- {err}",
                 "- Nenhum rollback automático foi feito: diagnosticar e decidir pela recuperação indicada."])
        fail(str(err), code=3)
    except ReleaseError as err:
        summary([f"### {mode} recusado; nada foi alterado", f"- {err}"])
        fail(str(err))
    if args.record_out:
        args.record_out.write_bytes(pretty_json(record))
    set_outputs(**{"active-release": record["release_id"], "previous-release": record["previous_release"]})
    summary([f"### {mode}: release ativa `{record['release_id']}`",
             f"- anterior: `{record['previous_release']}`; index reescrito: {record.get('changed')}",
             f"- invalidação: `{record.get('invalidation_id')}` (/ e /index.html); smoke: {record.get('smoke')}"])
    return record

"""Pré-condições do deploy do frontend (falha fechada). Estágios em release_gate.py.

  --stage repository   job gate: evento, main, SHA confirmado, CI verde, operação, kill switch, environment protegido
  --stage environment  primeiro passo dos jobs do environment: variables e ausência de chaves AWS estáticas
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_cli import fail, summary  # noqa: E402
from release_gate import ENVIRONMENT, environment_problems, repository_problems, self_review_note  # noqa: E402


def github_get(path: str):
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    token = os.environ.get("GH_TOKEN", "")
    if not api.startswith("https://") or not token:
        return 0, None
    request = urllib.request.Request(api + path, headers={"Authorization": f"Bearer {token}",
                                                          "Accept": "application/vnd.github+json",
                                                          "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - URL da API do GitHub
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as err:
        return err.code, None


def main(argv=None, env=None, get=github_get):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("repository", "environment"), required=True)
    args = parser.parse_args(argv)
    env = dict(os.environ if env is None else env)
    if args.stage == "repository":
        problems = repository_problems(env, get)
        note = ""
        if not problems:
            status, envdoc = get(f"/repos/{env['GITHUB_REPOSITORY']}/environments/{ENVIRONMENT}")
            note = self_review_note(envdoc or {})
    else:
        problems = environment_problems(env, env.get("OPERATION", ""), env.get("SOURCE", ""))
        note = ""
    if problems:
        summary([f"### Gate ({args.stage}) recusou a execução"] + [f"- {p}" for p in problems])
        fail(" | ".join(problems))
    summary([f"### Gate ({args.stage}) aprovado",
             f"- operação: `{env.get('OPERATION')}`; origem: `{env.get('SOURCE')}`; commit: `{env.get('GITHUB_SHA')}`",
             f"- iniciador: `{env.get('GITHUB_ACTOR')}`"] + ([f"- {note}"] if note else []))


if __name__ == "__main__":
    main()

"""Pré-condições do deploy do frontend (falha fechada). Estágios em release_gate.py.

  --stage repository   job gate: evento, main, SHA confirmado, HEAD atual da main, CI verde, operação, kill switch,
                       environment protegido (verificação A, antes de qualquer aprovação)
  --stage environment  primeiro passo dos jobs do environment, depois da aprovação: variables, ausência de chaves AWS
                       estáticas e o HEAD atual da main de novo (verificação B, antes de credencial ou artefato)
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_cli import fail, github_get, summary  # noqa: E402
from release_gate import (ENVIRONMENT, environment_problems, main_head_problems, repository_problems,  # noqa: E402
                          self_review_note)


def main(argv=None, env=None, get=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("repository", "environment"), required=True)
    args = parser.parse_args(argv)
    env = dict(os.environ if env is None else env)
    get = get or (lambda path: github_get(path, env))
    if args.stage == "repository":
        problems = repository_problems(env, get)
        note = ""
        if not problems:
            status, envdoc = get(f"/repos/{env['GITHUB_REPOSITORY']}/environments/{ENVIRONMENT}")
            note = self_review_note(envdoc or {})
    else:
        problems = environment_problems(env, env.get("OPERATION", ""), env.get("SOURCE", "")) + main_head_problems(env, get)
        note = ""
    if problems:
        summary([f"### Gate ({args.stage}) recusou a execução"] + [f"- {p}" for p in problems])
        fail(" | ".join(problems))
    summary([f"### Gate ({args.stage}) aprovado",
             f"- operação: `{env.get('OPERATION')}`; origem: `{env.get('SOURCE')}`; commit: `{env.get('GITHUB_SHA')}`",
             f"- HEAD atual da main no GitHub confirmado igual ao commit desta execução",
             f"- iniciador: `{env.get('GITHUB_ACTOR')}`"] + ([f"- {note}"] if note else []))


if __name__ == "__main__":
    main()

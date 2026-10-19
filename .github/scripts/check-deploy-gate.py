"""Pré-condições do deploy do frontend (falha fechada). Estágios em release_gate.py.

  --stage repository   job gate: evento (CI verde na main ou disparo manual), main, SHA esperado, HEAD atual da main,
                       CI verde, operação, kill switch, environment restrito à main (verificação A, antes de qualquer
                       job do environment). Aprovado, grava operation, source e expected-main-sha nos outputs do passo:
                       os jobs seguintes usam só esses valores
  --stage environment  primeiro passo dos jobs do environment, já liberados: variables, ausência de chaves AWS
                       estáticas e o HEAD atual da main de novo (verificação B, antes de credencial ou artefato)
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_cli import fail, github_get, set_outputs, summary  # noqa: E402
from release_gate import (ENVIRONMENT, environment_problems, main_head_problems, repository_problems,  # noqa: E402
                          run_parameters, self_review_note)


def load_event(env: dict):
    """Payload do workflow_run (GITHUB_EVENT_PATH). O disparo manual usa só os inputs; ilegível → None (recusa)."""
    if env.get("GITHUB_EVENT_NAME") != "workflow_run" or not env.get("GITHUB_EVENT_PATH"):
        return None
    try:
        return json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None, env=None, get=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("repository", "environment"), required=True)
    args = parser.parse_args(argv)
    env = dict(os.environ if env is None else env)
    get = get or (lambda path: github_get(path, env))
    if args.stage == "repository":
        event = load_event(env)
        problems = repository_problems(env, get, event)
        (operation, source, expected), _ = run_parameters(env, event)
        note = ""
        if not problems:
            status, envdoc = get(f"/repos/{env['GITHUB_REPOSITORY']}/environments/{ENVIRONMENT}")
            note = self_review_note(envdoc or {})
    else:
        operation, source, expected = env.get("OPERATION", ""), env.get("SOURCE", ""), env.get("EXPECTED_MAIN_SHA", "")
        problems = environment_problems(env, operation, source) + main_head_problems(env, get)
        note = ""
    if problems:
        summary([f"### Gate ({args.stage}) recusou a execução"] + [f"- {p}" for p in problems])
        fail(" | ".join(problems))
    if args.stage == "repository":
        set_outputs(**{"operation": operation, "source": source, "expected-main-sha": expected})
    summary([f"### Gate ({args.stage}) aprovado",
             f"- evento: `{env.get('GITHUB_EVENT_NAME')}`; operação: `{operation}`; origem: `{source}`; commit: `{env.get('GITHUB_SHA')}`",
             f"- HEAD atual da main no GitHub confirmado igual ao commit desta execução",
             f"- iniciador: `{env.get('GITHUB_ACTOR')}`"] + ([f"- {note}"] if note else []))


if __name__ == "__main__":
    main()

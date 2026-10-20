"""Pré-condições do workflow de deploy do frontend (falha fechada).

Estágio "repository" (job gate, sem environment e sem AWS): evento, branch, SHA esperado, HEAD atual da main no
GitHub, CI verde do SHA, operação, kill switch e proteções do environment production lidas pela API do GitHub.
Estágio "environment" (primeiro passo dos jobs do environment, já liberados, e antes de qualquer credencial):
variables do environment, ausência de chaves AWS estáticas e, de novo, o HEAD atual da main.
main_head_problems também é a guarda que os scripts chamam imediatamente antes da primeira escrita AWS.
"""
from __future__ import annotations

import json
import re

from frontend_release import RELEASE_ID_RE, SHA_RE, ReleaseError, validate_config, validate_public_origin
from publication_approval import input_problems, publication_context

OPERATIONS = ("prepare", "verify", "publish", "activate", "rollback", "deploy")
PRODUCTIVE = ("publish", "activate", "rollback", "deploy")
BUILDS = ("prepare", "publish", "deploy")
SOURCES = ("main", "baseline")
ENVIRONMENT = "production"
ROLE_NAME = "restart-portal-prod-github-frontend-deploy"
STATIC_KEYS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")
REPOSITORY_RE = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
CI_WORKFLOW = ".github/workflows/ci.yml"


def run_parameters(env: dict, event) -> tuple:
    """((operação, origem, SHA esperado), problemas do evento) desta execução.

    workflow_dispatch: os inputs do operador. workflow_run (automático, depois de todo push na main): deploy da main
    com o commit do CI concluído, aceito só se esse CI é o ci.yml, rodou por push na main deste repositório e
    terminou verde. No automático nada do payload escolhe operação, origem ou release.
    """
    name = env.get("GITHUB_EVENT_NAME")
    if name == "workflow_dispatch":
        return (env.get("OPERATION", ""), env.get("SOURCE", ""), env.get("EXPECTED_MAIN_SHA", "")), []
    if name != "workflow_run":
        return ("", "", ""), ["Só o CI verde na main (workflow_run) ou o disparo manual (workflow_dispatch) iniciam este workflow."]
    run = event.get("workflow_run") if isinstance(event, dict) else None
    run = run if isinstance(run, dict) else {}
    head_repository = run.get("head_repository") if isinstance(run.get("head_repository"), dict) else {}
    problems = []
    if str(run.get("path", "")).split("@")[0] != CI_WORKFLOW:
        problems.append(f"O workflow_run não veio do CI ({CI_WORKFLOW}).")
    if run.get("event") != "push" or run.get("head_branch") != "main":
        problems.append("O CI que disparou o deploy não é de um push na main.")
    if head_repository.get("full_name") != env.get("GITHUB_REPOSITORY"):
        problems.append("O CI que disparou o deploy é de outro repositório.")
    if run.get("conclusion") != "success":
        problems.append("O CI deste commit não terminou verde: deploy bloqueado.")
    head = run.get("head_sha")
    return ("deploy", "main", head if isinstance(head, str) else ""), problems


def repository_problems(env: dict, github_get, event=None) -> list:
    """github_get(path) -> (status, objeto JSON); event: payload do workflow_run. Nenhuma decisão depende de entrada
    não validada."""
    (operation, source, expected), problems = run_parameters(env, event)
    problems += input_problems(env, operation, source)
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and operation in ("publish", "deploy") and event is not None:
        try:
            publication_context(env, event)
        except ReleaseError as err:
            problems.append(str(err))
    if env.get("GITHUB_REF") != "refs/heads/main":
        problems.append("Execução recusada fora da branch main.")
    if operation not in OPERATIONS:
        problems.append("Operação desconhecida.")
    if source not in SOURCES:
        problems.append("Origem do código desconhecida.")
    if operation not in BUILDS and source != "main":
        problems.append("source=baseline só se aplica a prepare/publish/deploy.")
    sha = env.get("GITHUB_SHA", "")
    if not SHA_RE.fullmatch(expected):
        problems.append("expected_main_sha (ou o commit do CI) precisa ser o SHA completo (40 hex).")
    elif expected != sha:
        problems.append("expected_main_sha (ou o commit do CI) diverge do commit desta execução: a main avançou?")
    release_id, expected_active = env.get("RELEASE_ID", ""), env.get("EXPECTED_ACTIVE_RELEASE", "")
    if operation in ("activate", "rollback") and not RELEASE_ID_RE.fullmatch(release_id):
        problems.append("release_id obrigatório e no formato <12 hex>-<12 hex>.")
    if expected_active and expected_active != "legacy" and not RELEASE_ID_RE.fullmatch(expected_active):
        problems.append("expected_active_release inválido.")
    if operation == "rollback" and not expected_active:
        problems.append("rollback exige expected_active_release (a release ativa conferida pelo operador).")
    if operation in PRODUCTIVE and env.get("DEPLOY_ENABLED") != "true":
        problems.append("Kill switch: a variable FRONTEND_DEPLOY_ENABLED do repositório não é 'true'.")
    if env.get("S3_PROBE") == "true" and (operation != "verify" or env.get("DEPLOY_ENABLED") != "true"):
        problems.append("A sonda S3 só roda em verify e com FRONTEND_DEPLOY_ENABLED=true.")
    if problems:
        return problems  # não consulta a API com entradas já recusadas
    env = dict(env, EXPECTED_MAIN_SHA=expected)
    problems += main_head_problems(env, github_get)
    repo = env["GITHUB_REPOSITORY"]
    status, runs = github_get(f"/repos/{repo}/actions/workflows/ci.yml/runs?head_sha={sha}&event=push&status=success&per_page=10")
    if status != 200 or not any(r.get("head_sha") == sha and r.get("conclusion") == "success"
                                for r in (runs or {}).get("workflow_runs", [])):
        problems.append("CI (ci.yml, push) não está verde para este commit.")
    problems += environment_protection_problems(repo, github_get)
    return problems


def main_head_problems(env: dict, github_get) -> list:
    """O commit desta execução precisa ser o HEAD atual de refs/heads/main no GitHub, lido agora pela API.

    Não confia no checkout nem em referências lidas antes: a main pode ter avançado enquanto a execução esperava
    na fila, na concorrência ou numa aprovação opcional do environment, ou entre o build e o publish. Qualquer resposta
    que não prove a igualdade dos 40 hex recusa (falha fechada).
    """
    sha, expected, repo = env.get("GITHUB_SHA", ""), env.get("EXPECTED_MAIN_SHA", ""), env.get("GITHUB_REPOSITORY", "")
    if not SHA_RE.fullmatch(expected) or expected != sha:
        return ["expected_main_sha diverge do commit desta execução (ou não é um SHA completo)."]
    if not REPOSITORY_RE.fullmatch(repo):
        return ["GITHUB_REPOSITORY ausente ou inválido."]
    status, ref = github_get(f"/repos/{repo}/git/ref/heads/main")
    if status != 200:
        reason = f"HTTP {status}" if status else "sem resposta: credencial ausente, rede ou timeout"
        return [f"HEAD da main ilegível no GitHub ({reason}); execução recusada."]
    obj = ref.get("object") if isinstance(ref, dict) and ref.get("ref") == "refs/heads/main" else None
    if not isinstance(obj, dict) or obj.get("type") != "commit":
        return ["A resposta da API do GitHub não é a referência refs/heads/main; execução recusada."]
    head = obj.get("sha")
    if not isinstance(head, str) or not SHA_RE.fullmatch(head):
        return ["SHA do HEAD remoto ausente ou malformado; execução recusada."]
    if head != sha:
        return [f"A main avançou: HEAD remoto {head[:12]} ≠ commit desta execução {sha[:12]}. O commit mais novo tem o "
                "próprio deploy automático; no disparo manual, dispare de novo com o SHA atual."]
    return []


def environment_protection_problems(repo: str, github_get) -> list:
    """O environment precisa existir e aceitar só a branch main (modelo de mantenedor único).

    Revisores obrigatórios e o bloqueio de bypass de administradores são opcionais: com um único mantenedor, a
    autoaprovação não é revisão independente. A restrição real de branch e environment também está na trust da
    role (ref refs/heads/main e environment production), e o gate recusa execuções fora da main.
    """
    status, envdoc = github_get(f"/repos/{repo}/environments/{ENVIRONMENT}")
    if status == 404:
        return [f"Environment {ENVIRONMENT} ausente: crie-o restrito à main antes (o GitHub o criaria sem restrição)."]
    if status != 200 or not isinstance(envdoc, dict):
        return [f"Não foi possível ler o environment {ENVIRONMENT} (HTTP {status})."]
    problems = []
    policy = envdoc.get("deployment_branch_policy") or {}
    if policy.get("custom_branch_policies") is not True or policy.get("protected_branches") is not False:
        problems.append("Environment sem política de branches customizada.")
    else:
        status, branches = github_get(f"/repos/{repo}/environments/{ENVIRONMENT}/deployment-branch-policies")
        names = [(b.get("name"), b.get("type", "branch")) for b in (branches or {}).get("branch_policies", [])]
        if status != 200 or names != [("main", "branch")]:
            problems.append("Environment precisa permitir somente a branch main.")
    return problems


def self_review_note(envdoc: dict) -> str:
    """Nota do resumo do gate sobre o modelo de aprovação configurado no environment."""
    rule = {r.get("type"): r for r in envdoc.get("protection_rules", [])}.get("required_reviewers", {})
    if not rule.get("reviewers"):
        return ("Sem revisor obrigatório (mantenedor único): o deploy automático segue o CI verde na main; no disparo "
                "manual produtivo da main, o SHA e o manifesto previamente aprovados são conferidos.")
    if rule.get("prevent_self_review"):
        return "prevent_self_review ativo."
    return ("prevent_self_review desativado: se o iniciador também aprovar, a aprovação não é revisão independente "
            "(projeto com um único mantenedor).")


def environment_problems(env: dict, operation: str, source: str) -> list:
    problems = []
    present = [k for k in STATIC_KEYS if env.get(k)]
    if present:
        problems.append(f"Chaves AWS estáticas no ambiente do job ({', '.join(present)}): somente OIDC é aceito.")
    role = env.get("AWS_ROLE_ARN", "")
    if not re.fullmatch(rf"arn:aws:iam::[0-9]{{12}}:role/{ROLE_NAME}", role):
        problems.append(f"AWS_ROLE_ARN ausente ou de outra role (esperada {ROLE_NAME}).")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", env.get("AWS_REGION", "")):
        problems.append("AWS_REGION ausente ou inválida.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", env.get("FRONTEND_BUCKET", "")):
        problems.append("FRONTEND_BUCKET ausente ou inválido.")
    if not re.fullmatch(r"E[A-Z0-9]{6,20}", env.get("CLOUDFRONT_DISTRIBUTION_ID", "")):
        problems.append("CLOUDFRONT_DISTRIBUTION_ID ausente ou inválido.")
    try:
        origin = validate_public_origin(env.get("PUBLIC_ORIGIN", ""))
    except ReleaseError as err:
        problems.append(str(err))
        origin = None
    if operation in BUILDS and source == "main":
        try:
            validate_config(json.loads(env.get("FRONTEND_CONFIG_JSON", "") or "null"), origin or "")
        except (ReleaseError, ValueError) as err:
            problems.append(f"FRONTEND_CONFIG_JSON: {err}")
    return problems

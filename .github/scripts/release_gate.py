"""Pré-condições do workflow de deploy do frontend (falha fechada).

Estágio "repository" (job gate, sem environment e sem AWS): evento, branch, SHA confirmado, CI verde do SHA,
operação, kill switch e proteções do environment production lidas pela API do GitHub.
Estágio "environment" (primeiro passo dos jobs do environment, antes de qualquer credencial): variables do
environment e ausência de chaves AWS estáticas.
"""
from __future__ import annotations

import json
import re

from frontend_release import RELEASE_ID_RE, SHA_RE, ReleaseError, validate_config, validate_public_origin

OPERATIONS = ("prepare", "verify", "publish", "activate", "rollback")
PRODUCTIVE = ("publish", "activate", "rollback")
SOURCES = ("main", "baseline")
ENVIRONMENT = "production"
ROLE_NAME = "restart-portal-prod-github-frontend-deploy"
STATIC_KEYS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")


def repository_problems(env: dict, github_get) -> list:
    """github_get(path) -> (status, objeto JSON). Nenhuma decisão depende de entrada não validada."""
    problems = []
    operation, source = env.get("OPERATION", ""), env.get("SOURCE", "")
    if env.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        problems.append("Só workflow_dispatch pode iniciar este workflow.")
    if env.get("GITHUB_REF") != "refs/heads/main":
        problems.append("Execução recusada fora da branch main.")
    if operation not in OPERATIONS:
        problems.append("Operação desconhecida.")
    if source not in SOURCES:
        problems.append("Origem do código desconhecida.")
    if operation in ("activate", "rollback", "verify") and source != "main":
        problems.append("source=baseline só se aplica a prepare/publish.")
    sha, expected = env.get("GITHUB_SHA", ""), env.get("EXPECTED_MAIN_SHA", "")
    if not SHA_RE.fullmatch(expected):
        problems.append("expected_main_sha precisa ser o SHA completo (40 hex).")
    elif expected != sha:
        problems.append("expected_main_sha diverge do commit desta execução.")
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
    repo = env["GITHUB_REPOSITORY"]
    status, runs = github_get(f"/repos/{repo}/actions/workflows/ci.yml/runs?head_sha={sha}&event=push&status=success&per_page=10")
    if status != 200 or not any(r.get("head_sha") == sha and r.get("conclusion") == "success"
                                for r in (runs or {}).get("workflow_runs", [])):
        problems.append("CI (ci.yml, push) não está verde para este commit.")
    problems += environment_protection_problems(repo, github_get)
    return problems


def environment_protection_problems(repo: str, github_get) -> list:
    status, envdoc = github_get(f"/repos/{repo}/environments/{ENVIRONMENT}")
    if status == 404:
        return [f"Environment {ENVIRONMENT} ausente: crie e proteja antes (o GitHub o criaria sem proteção)."]
    if status != 200 or not isinstance(envdoc, dict):
        return [f"Não foi possível ler o environment {ENVIRONMENT} (HTTP {status})."]
    problems = []
    rules = {r.get("type"): r for r in envdoc.get("protection_rules", [])}
    reviewers = rules.get("required_reviewers", {}).get("reviewers", [])
    if not reviewers:
        problems.append("Environment sem revisor obrigatório.")
    policy = envdoc.get("deployment_branch_policy") or {}
    if policy.get("custom_branch_policies") is not True or policy.get("protected_branches") is not False:
        problems.append("Environment sem política de branches customizada.")
    else:
        status, branches = github_get(f"/repos/{repo}/environments/{ENVIRONMENT}/deployment-branch-policies")
        names = [(b.get("name"), b.get("type", "branch")) for b in (branches or {}).get("branch_policies", [])]
        if status != 200 or names != [("main", "branch")]:
            problems.append("Environment precisa permitir somente a branch main.")
    if envdoc.get("can_admins_bypass") is not False:
        problems.append("Environment permite (ou não informa) bypass de administradores.")
    return problems


def self_review_note(envdoc: dict) -> str:
    rule = {r.get("type"): r for r in envdoc.get("protection_rules", [])}.get("required_reviewers", {})
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
    if operation in ("prepare", "publish") and source == "main":
        try:
            validate_config(json.loads(env.get("FRONTEND_CONFIG_JSON", "") or "null"), origin or "")
        except (ReleaseError, ValueError) as err:
            problems.append(f"FRONTEND_CONFIG_JSON: {err}")
    return problems

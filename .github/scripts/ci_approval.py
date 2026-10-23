"""Prova do conteúdo testado no PR integrado, sem repetir a suíte no deploy.

O SHA do merge temporário vem dos passos de checkout dos quatro jobs da mesma tentativa.
A API Git confirma pais/árvore; a API de PR confirma a integração. Nenhum artefato é autoridade.
"""
import base64
import re

from frontend_release import SHA_RE

CHECKS = (
    "Backend (Python + Moto)", "Frontend (Node + Playwright)",
    "Terraform (fmt, validate, test)", "Bootstrap do deploy do frontend (fmt, validate, test)",
)
CHECKOUT_PREFIX = "Verifica checkout testado "
CHECKOUT_RE = re.compile(r"Verifica checkout testado ([0-9a-f]{40}) do PR ([1-9][0-9]*)")
CI_PATH = ".github/workflows/ci.yml"


class ApprovalError(ValueError):
    pass


def _document(get, path, kind=dict):
    status, value = get(path)
    if status != 200 or not isinstance(value, kind):
        raise ApprovalError(f"Evidência CI/PR ilegível ({path}, HTTP {status}).")
    return value


def _pages(get, path, key=None):
    """Pagina mesmo quando a página não traz resultados; total_count é o limite da API de Actions."""
    results = []
    for page in range(1, 101):
        value = _document(get, f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}", dict if key else list)
        rows = value.get(key) if key else value
        if not isinstance(rows, list):
            raise ApprovalError("Lista de evidências CI/PR inválida.")
        results.extend(rows)
        if key:
            total = value.get("total_count")
            if not isinstance(total, int) or total < 0:
                raise ApprovalError("Contagem de evidências CI/PR inválida.")
            if len(results) >= total:
                return results
        elif len(rows) < 100:
            return results
    raise ApprovalError("Paginação CI/PR excedeu o limite; não foi possível comprovar a aprovação.")


def _commit(get, repo, sha):
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        raise ApprovalError("SHA do checkout testado ausente ou inválido.")
    value = _document(get, f"/repos/{repo}/git/commits/{sha}")
    tree = value.get("tree", {}).get("sha")
    parents = [p.get("sha") for p in value.get("parents", []) if isinstance(p, dict)]
    if value.get("sha") != sha or not isinstance(tree, str) or not SHA_RE.fullmatch(tree) or not all(
            isinstance(p, str) and SHA_RE.fullmatch(p) for p in parents):
        raise ApprovalError("Commit/árvore da evidência CI inválido.")
    return tree, parents


def _legacy_manual(env, get):
    """Compatibilidade de recuperação: somente uma revisão cujo CI ainda era push/main.

    Nunca usa CI de outro SHA nem supõe que uma evidência PR ausente equivale ao modelo antigo.
    """
    repo, sha = env["GITHUB_REPOSITORY"], env["GITHUB_SHA"]
    status, content = get(f"/repos/{repo}/contents/{CI_PATH}?ref={sha}")
    if status != 200 or not isinstance(content, dict) or content.get("encoding") != "base64":
        return False
    try:
        workflow = base64.b64decode(content["content"], validate=False).decode("utf-8")
    except (KeyError, ValueError, UnicodeError):
        return False
    if not re.search(r"(?m)^  push:\n    branches: \[main\]\n", workflow):
        return False
    runs = _pages(get, f"/repos/{repo}/actions/workflows/ci.yml/runs?head_sha={sha}&event=push&status=success", "workflow_runs")
    for run in runs:
        if (run.get("head_sha") == sha and run.get("event") == "push" and run.get("head_branch") == "main"
                and str(run.get("path", "")).split("@")[0] == CI_PATH and run.get("conclusion") == "success"
                and run.get("status") == "completed" and run.get("head_repository", {}).get("full_name") == repo
                and run.get("repository", {}).get("full_name") == repo):
            _jobs(get, repo, run, legacy=True)
            if env.get("GITHUB_ACTIONS") == "true":
                print(f"CI histórico push/main: run {run['id']}, tentativa {run['run_attempt']}, commit {sha}; quatro checks success.")
            return True
    return False


def _jobs(get, repo, run, *, pr_number=None, legacy=False):
    run_id, attempt = run.get("id"), run.get("run_attempt")
    if not isinstance(run_id, int) or not isinstance(attempt, int) or run_id <= 0 or attempt <= 0:
        raise ApprovalError("Identidade/tentativa do CI inválida.")
    jobs = _pages(get, f"/repos/{repo}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    if len(jobs) != len(CHECKS) or {job.get("name") for job in jobs} != set(CHECKS):
        raise ApprovalError("O CI não contém os quatro checks obrigatórios da mesma tentativa.")
    tested = set()
    for job in jobs:
        if job.get("status") != "completed" or job.get("conclusion") != "success":
            raise ApprovalError(f"Check obrigatório sem success: {job.get('name')}.")
        if legacy:
            continue
        steps = [s for s in job.get("steps", []) if s.get("name", "").startswith(CHECKOUT_PREFIX)]
        if len(steps) != 1 or steps[0].get("conclusion") != "success":
            raise ApprovalError(f"Checkout efetivamente testado não comprovado: {job.get('name')}.")
        match = CHECKOUT_RE.fullmatch(steps[0]["name"])
        if not match or int(match[2]) != pr_number:
            raise ApprovalError("O checkout pertence a outro PR ou não identifica o PR testado.")
        tested.add(match[1])
    if not legacy and len(tested) != 1:
        raise ApprovalError("Os quatro checks não testaram o mesmo checkout.")
    return next(iter(tested)) if tested else None


def pr_approval_problems(env, get):
    """Falha fechada; dados do evento não escolhem CI, PR, tree ou dispensam a verificação."""
    repo, sha = env["GITHUB_REPOSITORY"], env["GITHUB_SHA"]
    try:
        candidates = _pages(get, f"/repos/{repo}/commits/{sha}/pulls")
        prs = []
        for candidate in candidates:
            if not isinstance(candidate, dict) or not isinstance(candidate.get("number"), int):
                raise ApprovalError("Associação de PR inválida.")
            pr = _document(get, f"/repos/{repo}/pulls/{candidate['number']}")
            if pr.get("number") != candidate["number"]:
                raise ApprovalError("Identidade do PR diverge da associação do commit.")
            if (pr.get("merged") is True and pr.get("merge_commit_sha") == sha
                    and pr.get("base", {}).get("ref") == "main"
                    and pr.get("base", {}).get("repo", {}).get("full_name") == repo):
                prs.append(pr)
        if len(prs) != 1:
            raise ApprovalError("O commit precisa corresponder exatamente a um PR integrado na main.")
        pr = prs[0]
        head = pr.get("head", {}).get("sha")
        if not isinstance(head, str) or not SHA_RE.fullmatch(head):
            raise ApprovalError("Head do PR integrado inválido.")
        runs = _pages(get, f"/repos/{repo}/actions/workflows/ci.yml/runs?head_sha={head}&event=pull_request", "workflow_runs")
        matching = [r for r in runs if (r.get("head_sha") == head and r.get("event") == "pull_request"
                    and str(r.get("path", "")).split("@")[0] == CI_PATH
                    and r.get("repository", {}).get("full_name") == repo
                    and r.get("head_repository", {}).get("full_name") == pr.get("head", {}).get("repo", {}).get("full_name"))]
        if not matching:
            raise ApprovalError("CI pull_request pertinente não encontrado para o head integrado.")
        # API devolve runs mais recentes primeiro; não usa um verde antigo para esconder a falha atual.
        run = _document(get, f"/repos/{repo}/actions/runs/{matching[0]['id']}")
        if (run.get("id") != matching[0]["id"] or run.get("head_sha") != head or run.get("event") != "pull_request"
                or str(run.get("path", "")).split("@")[0] != CI_PATH
                or run.get("repository", {}).get("full_name") != repo
                or run.get("head_repository", {}).get("full_name") != pr.get("head", {}).get("repo", {}).get("full_name")
                or run.get("status") != "completed" or run.get("conclusion") != "success"):
            raise ApprovalError("CI do PR integrado não terminou com success.")
        associated = run.get("pull_requests", [])
        if not isinstance(associated, list) or (associated and not any(
                isinstance(item, dict) and item.get("number") == pr["number"]
                and item.get("head", {}).get("sha") == head for item in associated)):
            raise ApprovalError("O CI está associado a outro PR/head.")
        # Depois do merge a API pode esvaziar pull_requests; o número no passo usa o contexto do evento do runner.
        tested_sha = _jobs(get, repo, run, pr_number=pr["number"])
        tested_tree, tested_parents = _commit(get, repo, tested_sha)
        final_tree, final_parents = _commit(get, repo, sha)
        if len(tested_parents) != 2 or tested_parents[1] != head:
            raise ApprovalError("O checkout testado não é o merge temporário do head deste PR.")
        if len(final_parents) not in (1, 2) or (len(final_parents) == 2 and final_parents[1] != head):
            raise ApprovalError("Pais do commit integrado incompatíveis com o PR.")
        base_changed = final_parents[0] != tested_parents[0]
        if final_tree != tested_tree:
            reason = "A base mudou entre teste e integração. " if base_changed else ""
            raise ApprovalError(reason + "A árvore integrada difere do checkout testado; valide a combinação no PR antes de integrar.")
        if env.get("GITHUB_ACTIONS") == "true":
            if base_changed:
                print("A base avançou; equivalência comprovada pela árvore Git integral idêntica, sem repetir a suíte.")
            print(f"CI do PR #{pr['number']}: run {run['id']}, tentativa {run['run_attempt']}; "
                  f"quatro checks success; checkout {tested_sha}; árvore {tested_tree}; integrado {sha}.")
        return []
    except (ApprovalError, KeyError, TypeError, AttributeError) as err:
        if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
            try:
                if _legacy_manual(env, get):
                    return []
            except (ApprovalError, KeyError, TypeError, AttributeError):
                pass
        return [f"Aprovação CI do PR recusada: {err}"]

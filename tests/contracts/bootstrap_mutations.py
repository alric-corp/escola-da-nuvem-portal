"""Mutações da trust e da policy da role de deploy do frontend (infra/cicd-bootstrap), avaliadas pelo terraform test.

Cada mutante enfraquece uma proteção em uma cópia descartável do HCL e precisa ser reprovado por uma asserção dos
testes nativos (mock_provider: nenhuma chamada AWS). Nenhum state, tfvars, backend ou credencial é copiado.
Requer terraform init -backend=false em infra/cicd-bootstrap (CI) ou, localmente, em infra/terraform: o provider
aws 6.64.0 é o mesmo nos dois locks.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "infra" / "cicd-bootstrap"
MAIN, VARIABLES = "main.tf", "variables.tf"

CASES = [
    ("job_workflow_ref_presumido", MAIN, 'var.trusted_job_workflow_ref == "" ? {} :', "false ? {} :"),
    ("sem_ref", MAIN, '      "${local.oidc_host}:ref"                 = "refs/heads/${var.deploy_branch}"\n', ""),
    ("sem_environment", MAIN, '      "${local.oidc_host}:environment"         = var.github_environment\n', ""),
    ("sem_repository_id", MAIN, '      "${local.oidc_host}:repository_id"       = var.github_repository_id\n', ""),
    ("sub_com_curinga", MAIN, ':environment:${var.github_environment}"', ':environment:*"'),
    ("string_like_na_trust", MAIN, "Condition = { StringEquals = local.trust_conditions }", "Condition = { StringLike = local.trust_conditions }"),
    ("release_sobrescrevivel", MAIN, '{ Null = { "s3:if-none-match" = "true" } }', '{ Null = { "s3:if-none-match" = "false" } }'),
    ("ativacao_sem_if_match", MAIN, '{ Null = { "s3:if-match" = "true" } }', '{ Null = { "s3:if-match" = "false" } }'),
    ("escrita_no_bucket_inteiro", MAIN, '        Action   = "s3:PutObject"\n        Resource = [local.releases_arn, local.activation_arn]',
     '        Action   = "s3:PutObject"\n        Resource = ["${local.bucket_arn}/*"]'),
    ("exclusao_permitida", MAIN, 'Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion", ', 'Action   = ['),
    ("qualquer_distribuicao", MAIN, "        Resource = local.distribution_arn", '        Resource = "*"'),
    ("acao_curinga", MAIN, '        Action    = "s3:ListBucket"', '        Action    = "s3:List*"'),
    ("listagem_fora_de_releases", MAIN, '{ "s3:prefix" = [var.releases_prefix, "${var.releases_prefix}*"] }', '{ "s3:prefix" = ["*"] }'),
    ("sessao_longa", MAIN, "  max_session_duration = var.max_session_duration", "  max_session_duration = 43200"),
    ("curinga_no_job_workflow_ref", VARIABLES, "workflows/[A-Za-z0-9_.-]+\\\\.ya?ml", "workflows/.+"),
]


def providers_dir() -> Path:
    for candidate in (MODULE / ".terraform" / "providers", ROOT / "infra" / "terraform" / ".terraform" / "providers"):
        if candidate.is_dir():
            return candidate.resolve()
    raise SystemExit("Rode terraform init -backend=false em infra/cicd-bootstrap antes das mutações.")


def run():
    providers = providers_dir()
    with tempfile.TemporaryDirectory(prefix="bootstrap-mutations-") as directory:
        module = Path(directory) / "cicd-bootstrap"
        module.mkdir()
        for path in MODULE.rglob("*"):
            rel = path.relative_to(MODULE)
            if path.is_file() and ".terraform" not in rel.parts[:1] and (path.suffix in (".tf", ".hcl") and not path.name.endswith(".example")):
                (module / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, module / rel)
        assert not any(p.name in ("terraform.tfvars", "backend.hcl") or p.suffix == ".tfstate" for p in module.rglob("*"))
        (module / ".terraform").mkdir()
        (module / ".terraform" / "providers").symlink_to(providers, target_is_directory=True)
        originals = {name: (module / name).read_text(encoding="utf-8") for name in (MAIN, VARIABLES)}

        def test():
            return subprocess.run(["terraform", f"-chdir={module}", "test", "-no-color"], capture_output=True, text=True, timeout=600)

        control = test()
        if control.returncode:
            raise RuntimeError("Controle falhou:\n" + control.stdout[-3000:] + control.stderr)
        results = []
        for name, file, old, new in CASES:
            for original, content in originals.items():
                (module / original).write_text(content, encoding="utf-8")
            if originals[file].count(old) != 1:
                raise RuntimeError(f"Mutação ambígua ou ausente: {name}")
            (module / file).write_text(originals[file].replace(old, new, 1), encoding="utf-8")
            result = test()
            output = result.stdout + result.stderr
            killed = result.returncode != 0 and (" fail" in output or "Missing expected failure" in output) and "Error: Invalid" not in output
            results.append({"mutation": name, "killed": killed})
            print(json.dumps(results[-1]), flush=True)
            if not killed:
                raise RuntimeError(f"Mutação sobrevivente ou falha inesperada: {name}\n{output[-3000:]}")
        print(json.dumps({"controls": "PASS", "killed": len(results), "survived": 0, "checkout_modified": False}))


if __name__ == "__main__":
    run()

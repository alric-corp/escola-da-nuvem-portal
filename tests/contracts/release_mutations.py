"""Pipeline do frontend: remove proteções da release em um clone temporário e exige que o teste indicado falhe.

O clone usa --shared (objetos do checkout; nada é gravado nele) e recebe a árvore de trabalho atual. AWS só pelo
moto e navegador só local; nenhum backend, credencial ou variável do runner chega aos testes. Mutação sobrevivente
ou falha que não seja de asserção sai com código diferente de zero.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE = ".github/scripts/frontend_release.py"
GATE = ".github/scripts/release_gate.py"
ACCESS = ".github/scripts/verify-access.py"
WORKFLOW = ".github/workflows/deploy-frontend.yml"
ACTIVATE_ACTION = ".github/actions/activate-release/action.yml"
APP = "frontend/app.js"
CHECK = ".github/scripts/check-deploy-gate.py"
CLI = ".github/scripts/release_cli.py"
PUBLISH = ".github/scripts/publish-release.py"
PUBLISH_ACTION = ".github/actions/publish-release/action.yml"
S3, PACKAGE, GATES = "test_frontend_release_s3", "test_frontend_release_package", "test_frontend_release_gate"
HEAD = "test_frontend_release_head"
PIPELINE, BROWSER = "tests/release-pipeline.mjs", "tests/release-cache-browser.mjs"

# (nome, arquivo, trecho original, substituto, ocorrências, suíte, teste que precisa matar o mutante)
CASES = [
    ("release_sem_if_none_match", CORE, '                         IfNoneMatch="*")', "                         )", 1,
     S3, "test_publish_sends_every_object_with_if_none_match_and_manifest_last"),
    ("conflito_aceito", CORE, "            if sha256_hex(existing) != sha256_hex(data):", "            if False:", 1,
     S3, "test_same_id_with_different_content_is_a_conflict_and_nothing_is_overwritten"),
    ("manifesto_primeiro", CORE,
     '    items = [(rel, data, MIME[posixpath.splitext(rel)[1]]) for rel, data in sorted(assets.items())]\n'
     '    items += [("pointer.html", pointer, MIME[".html"]), ("manifest.json", pretty_json(manifest), MIME[".json"])]',
     '    items = [("manifest.json", pretty_json(manifest), MIME[".json"])]\n'
     '    items += [(rel, data, MIME[posixpath.splitext(rel)[1]]) for rel, data in sorted(assets.items())]\n'
     '    items += [("pointer.html", pointer, MIME[".html"])]', 1,
     S3, "test_partial_upload_leaves_no_activatable_release_and_a_rerun_completes_it"),
    ("index_sem_if_match", CORE, "CacheControl=INDEX_CACHE, IfMatch=active[\"etag\"])", "CacheControl=INDEX_CACHE)", 1,
     S3, "test_race_on_the_index_is_detected_by_if_match_and_the_concurrent_write_survives"),
    ("invalidacao_ampla", CORE, 'INVALIDATION_PATHS = ["/", "/index.html"]', 'INVALIDATION_PATHS = ["/*"]', 1,
     S3, "test_activation_writes_only_the_pointer_with_if_match_and_invalidates_only_root_paths"),
    ("sem_conferencia_remota", CORE, "    target = verify_remote_release(s3, bucket, release_id)",
     "    target = remote_manifest(s3, bucket, release_id)", 1, S3, "test_failure_before_the_index_write_changes_nothing"),
    ("legado_aceita_qualquer_release", CORE,
     '        if target["mode"] != "baseline" or target["source_sha"] != baseline["source_sha"]:', "        if False:", 1,
     S3, "test_first_activation_from_legacy_is_only_the_pinned_baseline"),
    ("legado_sem_md5", CORE, '        if active["md5"] != legacy_index:', "        if False:", 1,
     S3, "test_activation_from_a_changed_legacy_index_is_refused"),
    ("ativacao_para_tras", CORE,
     '    elif active_manifest is not None and not git.is_ancestor(active_manifest["source_sha"], target["source_sha"]):',
     "    elif False:", 1, S3, "test_forward_activation_refuses_older_off_main_and_below_floor_releases"),
    ("ativa_esperada_ignorada", CORE, "    if expected_active and expected_active != current:", "    if False:", 1,
     S3, "test_wrong_expected_active_changes_nothing"),
    ("smoke_ignorado", CORE, '    if problems:\n        record["smoke"] = "falhou"', '    if False:\n        record["smoke"] = "falhou"', 1,
     S3, "test_failure_after_the_index_write_is_explicit_and_never_rolls_back"),
    ("rollback_abaixo_do_piso", CORE,
     '    elif not git.is_ancestor(baseline["rollback_floor_sha"], target["source_sha"]):\n        problems.append("Rollback abaixo',
     '    elif False:\n        problems.append("Rollback abaixo', 1, S3, "test_rollback_refusals"),
    ("rollback_sem_rotas", CORE, '    missing = sorted(set(target["api"]["routes"]) - set(active_manifest["api"]["routes"]))',
     "    missing = []", 1, S3, "test_rollback_needs_routes_contained_in_the_active_release"),
    ("rollback_sem_confirmacao", CORE, ' and confirm_release_id != target["release_id"]:', " and False:", 1,
     S3, "test_rollback_across_different_contracts_requires_the_explicit_confirmation"),
    ("rollback_para_frente", CORE, '          and git.is_ancestor(active_manifest["source_sha"], target["source_sha"])):', "          and False):", 1,
     S3, "test_rollback_refusals"),
    # A config entra no id duas vezes (config.json em files e config.sha256): o mutante remove as duas.
    ("id_ignora_conteudo", CORE, "    digest = sha256_hex(canonical_json(core))",
     '    digest = sha256_hex(canonical_json({k: v for k, v in core.items() if k not in ("files", "config")}))', 1,
     PACKAGE, "test_build_is_deterministic_and_release_id_binds_revision_assets_config_and_manifest"),
    ("manifesto_adulterado_aceito", CORE,
     '    if manifest.get("content_digest") != digest or manifest.get("release_id") != release_id:', "    if False:", 1,
     PACKAGE, "test_tampered_manifest_assets_or_extra_files_are_refused"),
    ("import_fora_da_release", CORE, '            if target.startswith("../") or target not in assets:', "            if False:", 1,
     PACKAGE, "test_import_graph_static_dynamic_and_reexports_must_stay_inside_the_release"),
    ("import_dinamico_expressao", CORE, "        if _DYNAMIC_EXPR_RE.search(text):", "        if False:", 1,
     PACKAGE, "test_import_graph_static_dynamic_and_reexports_must_stay_inside_the_release"),
    ("modern_sem_d1", CORE, "        if MODERN_CONFIG_FETCH not in app:", "        if False:", 1,
     PACKAGE, "test_config_is_per_release_in_modern_and_from_root_in_baseline"),
    ("baseline_sem_conferencia", CORE,
     '        if expected.get(rel, {}).get("sha256") != sha256_hex(data):', "        if False:", 1,
     PACKAGE, "test_a_baseline_with_any_divergent_file_is_refused"),
    ("config_da_raiz_sempre", CORE, '            path = f"/{RELEASES_PREFIX}{rid}/config.json"', '            path = "/config.json"', 1,
     PACKAGE, "test_published_config_follows_the_active_release"),
    ("callback_fora_da_raiz", CORE, '        if config[key] != public_origin + "/":', "        if False:", 1,
     PACKAGE, "test_config_validation_requires_the_nine_keys_https_and_root_callbacks"),
    ("gate_sem_main", GATE, '    if env.get("GITHUB_REF") != "refs/heads/main":', "    if False:", 1,
     GATES, "test_refusals_before_any_api_call"),
    ("gate_sha_ignorado", GATE, "    elif expected != sha:", "    elif False:", 1, GATES, "test_refusals_before_any_api_call"),
    ("gate_sem_kill_switch", GATE, '    if operation in PRODUCTIVE and env.get("DEPLOY_ENABLED") != "true":', "    if False:", 1,
     GATES, "test_refusals_before_any_api_call"),
    ("gate_sem_ci", GATE, '    if status != 200 or not any(r.get("head_sha") == sha', '    if False and not any(r.get("head_sha") == sha', 1,
     GATES, "test_ci_must_be_green_for_this_exact_commit"),
    ("gate_bypass_ausente_aceito", GATE, '    if envdoc.get("can_admins_bypass") is not False:', '    if envdoc.get("can_admins_bypass") is True:', 1,
     GATES, "test_environment_must_exist_with_reviewer_main_only_and_no_admin_bypass"),
    ("gate_outras_branches", GATE, '        if status != 200 or names != [("main", "branch")]:', '        if status != 200 or ("main", "branch") not in names:', 1,
     GATES, "test_environment_must_exist_with_reviewer_main_only_and_no_admin_bypass"),
    ("gate_chaves_estaticas", GATE, "    present = [k for k in STATIC_KEYS if env.get(k)]", "    present = []", 1,
     GATES, "test_fails_closed_without_variables_role_or_with_static_keys"),
    ("gate_qualquer_role", GATE, '    if not re.fullmatch(rf"arn:aws:iam::[0-9]{{12}}:role/{ROLE_NAME}", role):',
     '    if not re.match(r"arn:aws:iam::[0-9]{12}:role/", role):', 1, GATES, "test_fails_closed_without_variables_role_or_with_static_keys"),
    ("token_impresso", ACCESS, '        return decode_claims(json.loads(response.read())["value"])',
     '        value = json.loads(response.read())["value"]\n        print(value)\n        return decode_claims(value)', 1,
     GATES, "test_claims_are_compared_with_the_trust_and_the_token_never_appears"),
    ("sonda_index_sem_condicao", ACCESS, 'attempt(Key="index.html", Body=b"x", IfNoneMatch="*")', 'attempt(Key="index.html", Body=b"x")', 1,
     GATES, "test_probe_never_changes_the_index_and_flags_missing_iam_denies"),
    ("workflow_id_token_global", WORKFLOW, "permissions: {}\n", "permissions:\n  id-token: write\n", 1,
     PIPELINE, "permissões mínimas"),
    ("workflow_cancela_em_andamento", WORKFLOW, "  cancel-in-progress: false", "  cancel-in-progress: true", 1,
     PIPELINE, "permissões mínimas"),
    ("workflow_publica_por_padrao", WORKFLOW, "        default: prepare", "        default: publish", 1,
     PIPELINE, "só workflow_dispatch"),
    ("workflow_push", WORKFLOW, "on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:", 1,
     PIPELINE, "só workflow_dispatch"),
    ("workflow_guarda_token", WORKFLOW, "          persist-credentials: false\n          fetch-depth: 0\n      - name: Variables",
     "          persist-credentials: true\n          fetch-depth: 0\n      - name: Variables", 2, PIPELINE, "só workflow_dispatch"),
    ("workflow_id_token_sem_oidc", WORKFLOW,
     "      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0\n"
     "        with:\n          role-to-assume: ${{ vars.AWS_ROLE_ARN }}\n          aws-region: ${{ vars.AWS_REGION }}\n"
     "          role-session-name: frontend-${{ github.run_id }}-${{ github.run_attempt }}\n"
     "          role-duration-seconds: 1800\n          mask-aws-account-id: true\n      - id: activate",
     "      - id: activate", 1, PIPELINE, "permissões mínimas"),
    ("composite_interpola_input", ACTIVATE_ACTION, '--release-id "$RELEASE_ID"', '--release-id "${{ inputs.release-id }}"', 1,
     PIPELINE, "nenhuma expressão dentro de run"),
    # B.2: HEAD atual da main revalidado no gate (A), depois da aprovação (B) e antes da primeira escrita AWS (C).
    ("head_gate_removido", GATE, "    problems += main_head_problems(env, github_get)\n", "", 1,
     HEAD, "test_head_different_from_the_run_commit_is_denied"),
    ("head_compara_so_expected", GATE, "    if head != sha:", "    if expected != sha:", 1,
     HEAD, "test_head_different_from_the_run_commit_is_denied"),
    ("head_http_erro_aceito", GATE, '    if status != 200:\n        reason = f"HTTP {status}"', '    if status >= 500:\n        reason = f"HTTP {status}"', 1,
     HEAD, "test_api_error_statuses_are_denied"),
    ("head_falha_api_ignorada", GATE, '    if status != 200:\n        reason = f"HTTP {status}"',
     '    if status not in (0, 200):\n        reason = f"HTTP {status}"', 1, HEAD, "test_timeouts_and_network_errors_are_denied"),
    ("head_resposta_vazia_aceita", GATE,
     '        return ["A resposta da API do GitHub não é a referência refs/heads/main; execução recusada."]', "        return []", 1,
     HEAD, "test_responses_that_are_not_refs_heads_main_are_denied"),
    ("head_sha_malformado_aceito", GATE, "    if not isinstance(head, str) or not SHA_RE.fullmatch(head):", "    if not isinstance(head, str):", 1,
     HEAD, "test_missing_or_malformed_sha_is_denied"),
    ("adaptador_erro_http_como_200", CLI, "        return err.code, None", "        return 200, None", 1,
     HEAD, "test_http_errors_including_rate_limit_are_denied"),
    ("segunda_verificacao_removida", CHECK, " + main_head_problems(env, get)", "", 1,
     HEAD, "test_main_advances_between_gate_and_approval_the_released_job_is_denied"),
    ("diferenca_apos_aprovacao_ignorada", CHECK, "    if problems:\n        summary([f\"### Gate ({args.stage}) recusou",
     "    if problems and args.stage == \"repository\":\n        summary([f\"### Gate ({args.stage}) recusou", 1,
     HEAD, "test_main_advances_between_gate_and_approval_the_released_job_is_denied"),
    ("verificacao_so_no_build", WORKFLOW,
     "        run: python3 -B .github/scripts/check-deploy-gate.py --stage environment\n      - uses: actions/download-artifact",
     "        run: echo \"revalidação removida\"\n      - uses: actions/download-artifact", 1,
     HEAD, "test_main_advances_between_build_and_publish_is_denied_before_oidc"),
    ("guarda_publicacao_removida", CORE, "    if before_write:\n        before_write()  # verificação C: HEAD da main antes do primeiro objeto\n",
     "", 1, S3, "test_publish_revalidates_main_before_the_first_object"),
    ("guarda_ativacao_removida", CORE,
     "    if before_write:\n        before_write()  # verificação C: HEAD da main depois das conferências e antes do index.html ou da invalidação\n",
     "", 1, S3, "test_activation_revalidates_main_after_the_checks_and_before_the_index"),
    ("cli_ativacao_sem_guarda", CLI, ", before_write=main_head_guard())", ")", 1,
     HEAD, "test_activation_and_rollback_cli_revalidate_before_writing"),
    ("cli_publicacao_sem_guarda", PUBLISH, ", before_write=main_head_guard())", ")", 1,
     HEAD, "test_publish_cli_revalidates_before_the_first_object"),
    ("sonda_sem_revalidacao", ACCESS,
     "        try:\n            main_head_guard()()  # verificação C: HEAD da main antes da primeira escrita da sonda\n"
     "        except ReleaseError as err:\n            fail(str(err))\n", "", 1, HEAD, "test_s3_probe_revalidates_before_writing"),
    ("composite_publica_sem_sha", PUBLISH_ACTION, "        EXPECTED_MAIN_SHA: ${{ inputs.expected-main-sha }}\n", "", 1,
     PIPELINE, "HEAD da main revalidado"),
    ("d1_revertida", APP, 'fetch(new URL("./config.json", import.meta.url), { cache: "no-store" })',
     'fetch("./config.json", { cache: "no-store" })', 1, BROWSER, ""),
]


def child_env():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GITHUB_", "AWS_", "RUNNER_", "ACTIONS_"))}
    env.update(AWS_EC2_METADATA_DISABLED="true", AWS_CONFIG_FILE=os.devnull, AWS_SHARED_CREDENTIALS_FILE=os.devnull)
    return env


def make_clone(work: Path) -> Path:
    clone = work / "clone"
    head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    subprocess.run(["git", "clone", "--quiet", "--shared", "--no-checkout", str(ROOT), str(clone)], check=True)
    subprocess.run(["git", "-C", str(clone), "checkout", "--quiet", "--detach", head], check=True)
    listed = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                            capture_output=True, check=True).stdout.decode().split("\0")
    for rel in filter(None, listed):
        if (ROOT / rel).is_file():
            (clone / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / rel, clone / rel)
    git = ["git", "-C", str(clone), "-c", "user.name=Teste", "-c", "user.email=teste@example.test"]
    subprocess.run(git + ["add", "-A"], check=True)
    subprocess.run(git + ["commit", "--quiet", "--allow-empty", "-m", "árvore de trabalho"], check=True, env=child_env())
    (clone / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    return clone


def command(suite: str, target: str):
    if suite.startswith("test_"):
        return [sys.executable, "-B", "-m", "unittest", *(["-k", target] if target else []), suite], "tests/integration"
    pattern = [f"--test-name-pattern={target}"] if target else []
    return ["node", "--test", "--test-reporter=tap", *pattern, suite], "."


def run_suite(clone: Path, suite: str, target: str):
    args, cwd = command(suite, target)
    result = subprocess.run(args, cwd=clone / cwd, capture_output=True, text=True, timeout=600, env=child_env())
    output = result.stdout + result.stderr
    if suite.startswith("test_"):
        asserted = "FAIL:" in output and "AssertionError" in output
        broken = any(marker in output for marker in ("ERROR: ", "SyntaxError", "ImportError", "NameError"))
        ran = "Ran 0 tests" not in output
    else:
        asserted = "not ok" in output and ("AssertionError" in output or "ERR_ASSERTION" in output)
        broken = "SyntaxError" in output and "releaseMarker" not in output
        ran = "# tests 0" not in output
    return result.returncode, asserted and not broken and ran, ran, output


def run():
    with tempfile.TemporaryDirectory(prefix="release-mutations-") as directory:
        clone = make_clone(Path(directory))
        originals = {file: (clone / file).read_text(encoding="utf-8") for file in {case[1] for case in CASES}}
        controls = sorted({(suite, target) for *_, suite, target in CASES})
        for suite, target in controls:
            code, _, ran, output = run_suite(clone, suite, target)
            if code or not ran:
                raise RuntimeError(f"Controle falhou ({suite} {target}):\n{output[-3000:]}")
        results = []
        for name, file, old, new, count, suite, target in CASES:
            for original, content in originals.items():
                (clone / original).write_text(content, encoding="utf-8")
            source = originals[file]
            if source.count(old) != count:
                raise RuntimeError(f"Mutação ambígua ou ausente: {name} ({source.count(old)} ocorrências)")
            (clone / file).write_text(source.replace(old, new), encoding="utf-8")
            code, killed, _, output = run_suite(clone, suite, target)
            results.append({"mutation": name, "killed": killed and code != 0, "suite": suite, "test": target or "(suíte inteira)"})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
            if not results[-1]["killed"]:
                raise RuntimeError(f"Mutação sobrevivente ou falha inesperada: {name}\n{output[-3000:]}")
        for original, content in originals.items():
            (clone / original).write_text(content, encoding="utf-8")
        status = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True, text=True, check=True).stdout
        print(json.dumps({"controls": "PASS", "control_runs": len(controls), "killed": len(results), "survived": 0,
                          "checkout_modified": status != STATUS_BEFORE}, ensure_ascii=False))
        if status != STATUS_BEFORE:
            raise RuntimeError("O checkout foi alterado durante as mutações.")


STATUS_BEFORE = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True, text=True, check=True).stdout

if __name__ == "__main__":
    run()

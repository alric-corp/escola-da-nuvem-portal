"""Pipeline do frontend: gates de execução (repositório e environment), claims OIDC, sonda S3 e falhas de credencial.

A API do GitHub é simulada por função; o endpoint de token OIDC, por um servidor HTTP local; a AWS, pelo moto.
"""
import base64
import contextlib
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

import boto3
from moto import mock_aws

from release_fixtures import (BUCKET, ENVDOC, ENVDOC_SOLO, REGION, REPO, RID, ROLE, SHA, FakeGitHub, PR_HEAD, auto_env, block_network, child_env,
                              ci_run_event, config, environment_env, fr, load_script, repo_env)

import release_cli  # noqa: E402 - SCRIPTS já está no sys.path (release_fixtures)
import release_gate as gate  # noqa: E402


check_gate = load_script("check-deploy-gate")
verify_access = load_script("verify-access")
_restore = None


def setUpModule():
    global _restore
    _restore = block_network()


def tearDownModule():
    _restore()


class RepositoryGateTests(unittest.TestCase):
    def test_protected_main_with_green_ci_passes_and_queries_ci_by_exact_sha(self):
        github = FakeGitHub()
        for operation, extra in (("prepare", {}), ("verify", {}), ("publish", {}), ("activate", {"RELEASE_ID": RID}),
                                 ("rollback", {"RELEASE_ID": RID, "EXPECTED_ACTIVE_RELEASE": "legacy"}), ("deploy", {}),
                                 ("deploy", {"SOURCE": "baseline"})):
            with self.subTest(operation, **extra):
                self.assertEqual(gate.repository_problems(repo_env(OPERATION=operation, **extra), github), [])
        ci_query = next(p for p in github.paths if "ci.yml" in p)
        self.assertIn(f"head_sha={PR_HEAD}", ci_query)
        self.assertIn("event=pull_request", ci_query)

    def test_refusals_before_any_api_call(self):
        cases = {
            "evento workflow_run": (repo_env(GITHUB_EVENT_NAME="workflow_run"), "Só push"),
            "evento pull_request": (repo_env(GITHUB_EVENT_NAME="pull_request"), "Só push"),
            "branch não autorizada": (repo_env(GITHUB_REF="refs/heads/feat/x"), "fora da branch main"),
            "tag": (repo_env(GITHUB_REF="refs/tags/v1"), "fora da branch main"),
            "sha divergente": (repo_env(EXPECTED_MAIN_SHA="e5" * 20), "diverge"),
            "sha curto": (repo_env(EXPECTED_MAIN_SHA=SHA[:12]), "40 hex"),
            "operação desconhecida": (repo_env(OPERATION="destroy"), "Operação desconhecida"),
            "baseline no verify": (repo_env(OPERATION="verify", SOURCE="baseline"), "baseline só se aplica"),
            "origem desconhecida": (repo_env(SOURCE="feature"), "Origem"),
            "baseline na ativação": (repo_env(OPERATION="activate", SOURCE="baseline", RELEASE_ID=RID), "baseline só se aplica"),
            "activate sem release": (repo_env(OPERATION="activate"), "release_id obrigatório"),
            "release_id inválido": (repo_env(OPERATION="activate", RELEASE_ID="../index"), "release_id obrigatório"),
            "rollback sem ativa": (repo_env(OPERATION="rollback", RELEASE_ID=RID), "expected_active_release"),
            "ativa inválida": (repo_env(OPERATION="activate", RELEASE_ID=RID, EXPECTED_ACTIVE_RELEASE="x"), "inválido"),
            "kill switch desligado": (repo_env(OPERATION="publish", DEPLOY_ENABLED="false"), "Kill switch"),
            "kill switch no deploy manual": (repo_env(OPERATION="deploy", DEPLOY_ENABLED="false"), "Kill switch"),
            "kill switch ausente": (repo_env(OPERATION="activate", RELEASE_ID=RID, DEPLOY_ENABLED=None), "Kill switch"),
            "sonda fora do verify": (repo_env(OPERATION="publish", S3_PROBE="true"), "sonda S3"),
            "sonda sem kill switch": (repo_env(OPERATION="verify", S3_PROBE="true", DEPLOY_ENABLED=None), "sonda S3"),
        }
        for label, (env, reason) in cases.items():
            with self.subTest(label):
                github = FakeGitHub()
                problems = gate.repository_problems(env, github)
                self.assertTrue(any(reason in p for p in problems), problems)
                self.assertEqual(github.paths, [], "entrada recusada não consulta a API")

    def test_ci_must_be_green_for_this_exact_commit(self):
        for label, github in {"sem execução": FakeGitHub(ci=()), "falhou": FakeGitHub(ci=("failure",)),
                              "outro commit": FakeGitHub(runs_sha="e5" * 20)}.items():
            with self.subTest(label):
                self.assertTrue(any("Aprovação CI" in p for p in gate.repository_problems(repo_env(), github)))

    def test_environment_must_exist_and_deploy_only_from_main(self):
        without = lambda **changes: dict(ENVDOC_SOLO, **changes)  # noqa: E731
        cases = {
            "ausente": (FakeGitHub(env_status=404), "ausente"),
            "ilegível": (FakeGitHub(env_status=403), "Não foi possível ler"),
            "branches protegidas": (FakeGitHub(env=without(deployment_branch_policy={"protected_branches": True,
                                                                                     "custom_branch_policies": False})), "customizada"),
            "sem política (todas as branches)": (FakeGitHub(env=without(deployment_branch_policy=None)), "customizada"),
            "outra branch": (FakeGitHub(env=ENVDOC_SOLO, branches=(("main", "branch"), ("release/*", "branch"))), "somente a branch main"),
            "curinga": (FakeGitHub(env=ENVDOC_SOLO, branches=(("*", "branch"),)), "somente a branch main"),
            "tag": (FakeGitHub(env=ENVDOC_SOLO, branches=(("main", "tag"),)), "somente a branch main"),
        }
        for label, (github, reason) in cases.items():
            with self.subTest(label):
                problems = gate.repository_problems(repo_env(), github)
                self.assertTrue(any(reason in p for p in problems), problems)

    def test_single_maintainer_environment_without_reviewers_passes(self):
        """Mantenedor único: revisores e bloqueio de bypass são opcionais; a restrição à main continua obrigatória."""
        variants = {
            "sem revisor, bypass padrão": ENVDOC_SOLO,
            "sem regras": dict(ENVDOC_SOLO, protection_rules=[]),
            "bypass não informado": {k: v for k, v in ENVDOC_SOLO.items() if k != "can_admins_bypass"},
            "com revisor (opcional)": ENVDOC,
        }
        for label, envdoc in variants.items():
            for operation, extra in (("prepare", {}), ("publish", {}), ("activate", {"RELEASE_ID": RID}),
                                     ("rollback", {"RELEASE_ID": RID, "EXPECTED_ACTIVE_RELEASE": "legacy"}), ("deploy", {})):
                with self.subTest(label, operation=operation):
                    self.assertEqual(gate.repository_problems(repo_env(OPERATION=operation, **extra), FakeGitHub(env=envdoc)), [])
            with self.subTest(label, operation="deploy automático"):
                self.assertEqual(gate.repository_problems(auto_env(), FakeGitHub(env=envdoc), ci_run_event()), [])

    def test_review_note_describes_the_configured_model(self):
        self.assertIn("Sem revisor obrigatório", gate.self_review_note(ENVDOC_SOLO))
        self.assertIn("deploy automático segue o CI do PR integrado", gate.self_review_note(ENVDOC_SOLO))
        self.assertIn("não é revisão independente", gate.self_review_note(ENVDOC))
        strict = dict(ENVDOC, protection_rules=[dict(ENVDOC["protection_rules"][0], prevent_self_review=True)])
        self.assertEqual(gate.self_review_note(strict), "prevent_self_review ativo.")


class AutomaticDeployGateTests(unittest.TestCase):
    """Push/main integrado: somente a árvore aprovada pelos quatro checks do PR pode ser publicada."""

    def test_green_ci_of_a_push_on_main_deploys_that_exact_commit(self):
        github = FakeGitHub()
        self.assertEqual(gate.run_parameters(auto_env(), ci_run_event()), (("deploy", "main", SHA), []))
        self.assertEqual(gate.repository_problems(auto_env(), github, ci_run_event()), [])
        ci_query = next(p for p in github.paths if "ci.yml" in p)
        self.assertIn(f"head_sha={PR_HEAD}", ci_query, "o CI verde é reconferido na API para o commit exato")
        self.assertIn(f"/repos/{REPO}/git/ref/heads/main", github.paths)

    def test_inputs_never_choose_the_automatic_operation_source_or_commit(self):
        env = auto_env(OPERATION="rollback", SOURCE="baseline", EXPECTED_MAIN_SHA="e5" * 20, RELEASE_ID=RID)
        self.assertEqual(gate.run_parameters(env, ci_run_event())[0], ("deploy", "main", SHA))
        self.assertEqual(gate.repository_problems(env, FakeGitHub(), ci_run_event()), [])

    def test_automatic_refusals_before_any_api_call(self):
        cases = {
            "push de outra branch": (auto_env(), ci_run_event(ref="refs/heads/feature"), "main existente"),
            "push de exclusão": (auto_env(), ci_run_event(deleted=True), "main existente"),
            "push de outro repositório": (auto_env(), ci_run_event(repository={"full_name": "fork/portal"}), "outro repositório"),
            "payload ausente": (auto_env(), None, "main existente"),
            "after divergente": (auto_env(), ci_run_event(after="e5" * 20), "diverge"),
            "after curto": (auto_env(), ci_run_event(after=SHA[:12]), "40 hex"),
            "fora da main": (auto_env(GITHUB_REF="refs/heads/feat/x"), ci_run_event(), "fora da branch main"),
            "kill switch desligado": (auto_env(DEPLOY_ENABLED="false"), ci_run_event(), "Kill switch"),
            "kill switch ausente": (auto_env(DEPLOY_ENABLED=None), ci_run_event(), "Kill switch"),
        }
        for label, (env, event, reason) in cases.items():
            with self.subTest(label):
                github = FakeGitHub()
                problems = gate.repository_problems(env, github, event)
                self.assertTrue(any(reason in p for p in problems), problems)
                self.assertEqual(github.paths, [], "evento recusado não consulta a API")

    def test_head_ci_and_environment_are_still_checked_in_the_api(self):
        cases = {
            "main avançou": (FakeGitHub(head="e5" * 20), "A main avançou"),
            "CI da API não verde": (FakeGitHub(ci=("failure",)), "Aprovação CI"),
            "environment ausente": (FakeGitHub(env_status=404), "ausente"),
            "environment sem restrição": (FakeGitHub(env=dict(ENVDOC_SOLO, deployment_branch_policy=None)), "customizada"),
        }
        for label, (github, reason) in cases.items():
            with self.subTest(label):
                problems = gate.repository_problems(auto_env(), github, ci_run_event())
                self.assertTrue(any(reason in p for p in problems), problems)

    def test_cli_reads_the_event_file_and_publishes_the_decision_only_when_approved(self):
        with tempfile.TemporaryDirectory() as tmp:
            event_file, output_file = Path(tmp) / "event.json", Path(tmp) / "output"
            for label, event, expected in (("aprovado", ci_run_event(), 0), ("CI vermelho", ci_run_event(after="e5" * 20), 1)):
                with self.subTest(label):
                    event_file.write_text(json.dumps(event), encoding="utf-8")
                    output_file.write_text("", encoding="utf-8")
                    env = dict(auto_env(), GITHUB_EVENT_PATH=str(event_file), GITHUB_OUTPUT=str(output_file),
                               GITHUB_STEP_SUMMARY=str(Path(tmp) / "summary.md"))
                    code = 0
                    with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(io.StringIO()), \
                            contextlib.redirect_stderr(io.StringIO()):
                        try:
                            check_gate.main(["--stage", "repository"], env=env, get=FakeGitHub())
                        except SystemExit as exit_:
                            code = exit_.code
                    self.assertEqual(code, expected)
                    outputs = output_file.read_text(encoding="utf-8")
                    if expected == 0:
                        self.assertEqual(outputs, f"operation=deploy\nsource=main\nexpected-main-sha={SHA}\n")
                    else:
                        self.assertEqual(outputs, "", "gate recusado não publica decisão")
            self.assertIn("evento: `push`; operação: `deploy`", (Path(tmp) / "summary.md").read_text(encoding="utf-8"))
        for label, path in (("sem arquivo", None), ("arquivo inexistente", "/nao/existe.json")):
            with self.subTest(label):
                self.assertIsNone(check_gate.load_event(auto_env(GITHUB_EVENT_PATH=path)))


class EnvironmentGateTests(unittest.TestCase):
    def test_complete_variables_without_static_keys_pass(self):
        self.assertEqual(gate.environment_problems(environment_env(), "publish", "main"), [])
        self.assertEqual(gate.environment_problems(environment_env(FRONTEND_CONFIG_JSON=None), "activate", "main"), [])
        self.assertEqual(gate.environment_problems(environment_env(FRONTEND_CONFIG_JSON=None), "publish", "baseline"), [])
        self.assertEqual(gate.environment_problems(environment_env(FRONTEND_CONFIG_JSON=None), "deploy", "baseline"), [])
        self.assertTrue(gate.environment_problems(environment_env(FRONTEND_CONFIG_JSON=None), "deploy", "main"),
                        "o deploy da main precisa da config publicada")

    def test_fails_closed_without_variables_role_or_with_static_keys(self):
        cases = {
            "chave estática": (environment_env(AWS_ACCESS_KEY_ID="AKIAEXEMPLO"), "Chaves AWS estáticas"),
            "segredo estático": (environment_env(AWS_SECRET_ACCESS_KEY="x"), "Chaves AWS estáticas"),
            "token de sessão": (environment_env(AWS_SESSION_TOKEN="x"), "Chaves AWS estáticas"),
            "sem role": (environment_env(AWS_ROLE_ARN=None), "AWS_ROLE_ARN"),
            "outra role": (environment_env(AWS_ROLE_ARN="arn:aws:iam::123456789012:role/admin"), "AWS_ROLE_ARN"),
            "role com sufixo": (environment_env(AWS_ROLE_ARN=ROLE + "-x"), "AWS_ROLE_ARN"),
            "sem região": (environment_env(AWS_REGION=None), "AWS_REGION"),
            "sem bucket": (environment_env(FRONTEND_BUCKET=None), "FRONTEND_BUCKET"),
            "bucket inválido": (environment_env(FRONTEND_BUCKET="Bucket_Invalido"), "FRONTEND_BUCKET"),
            "sem distribuição": (environment_env(CLOUDFRONT_DISTRIBUTION_ID=None), "CLOUDFRONT_DISTRIBUTION_ID"),
            "origem http": (environment_env(PUBLIC_ORIGIN="http://portal.example.test"), "PUBLIC_ORIGIN"),
            "sem config": (environment_env(FRONTEND_CONFIG_JSON=None), "FRONTEND_CONFIG_JSON"),
            "config não JSON": (environment_env(FRONTEND_CONFIG_JSON="{"), "FRONTEND_CONFIG_JSON"),
            "config de outra origem": (environment_env(FRONTEND_CONFIG_JSON=json.dumps(dict(config(), redirectUri="https://x.example.test/"))),
                                       "redirectUri"),
        }
        for label, (env, reason) in cases.items():
            with self.subTest(label):
                problems = gate.environment_problems(env, "publish", "main")
                self.assertTrue(any(reason in p for p in problems), problems)
                self.assertFalse(any("AKIAEXEMPLO" in p for p in problems), "o valor da chave nunca é ecoado")

    def test_cli_writes_the_refusal_to_the_summary_and_exits_non_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary_file = Path(tmp) / "summary.md"
            env = dict(environment_env(AWS_ROLE_ARN=None), GITHUB_STEP_SUMMARY=str(summary_file), GITHUB_ACTIONS="true")
            with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit) as code:
                check_gate.main(["--stage", "environment"], env=env)
            self.assertEqual(code.exception.code, 1)
            self.assertIn("::error::", err.getvalue())
            self.assertIn("recusou", summary_file.read_text())
            env = dict(repo_env(), GITHUB_STEP_SUMMARY=str(summary_file), GITHUB_ACTOR="operador")
            with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(io.StringIO()):
                check_gate.main(["--stage", "repository"], env=env, get=FakeGitHub())
            text = summary_file.read_text()
            self.assertIn("Gate (repository) aprovado", text)
            self.assertIn("não é revisão independente", text)


def fake_jwt(claims):
    part = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{part({'alg': 'RS256'})}.{part(claims)}.assinatura-falsa"


def trust_claims(**overrides):
    claims = {"aud": "sts.amazonaws.com", "sub": "repo:org-teste@111/portal-teste@222:environment:production",
              "repository": REPO, "repository_id": "222", "repository_owner_id": "111", "environment": "production",
              "ref": "refs/heads/main", "ref_type": "branch", "workflow": "Deploy do frontend",
              "workflow_ref": f"{REPO}/.github/workflows/deploy-frontend.yml@refs/heads/main",
              "job_workflow_ref": f"{REPO}/.github/workflows/deploy-frontend.yml@refs/heads/main",
              "event_name": "workflow_dispatch", "runner_environment": "github-hosted", "jti": "segredo-nao-listado"}
    claims.update(overrides)
    return claims


class TokenServer:
    """Endpoint ACTIONS_ID_TOKEN_REQUEST_URL simulado em 127.0.0.1."""

    def __init__(self, token):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                outer.requests.append((self.path, self.headers.get("Authorization")))
                body = json.dumps({"value": token}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/token?api-version=2.0"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class ClaimsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_claims(self, claims):
        token = fake_jwt(claims)
        server = TokenServer(token)
        self.addCleanup(server.close)
        summary_file = self.tmp / "summary.md"
        env = {"ACTIONS_ID_TOKEN_REQUEST_URL": server.url, "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "token-do-runner",
               "GITHUB_REPOSITORY": REPO, "GITHUB_REPOSITORY_ID": "222", "GITHUB_REPOSITORY_OWNER_ID": "111",
               "GITHUB_STEP_SUMMARY": str(summary_file)}
        out, err, code = io.StringIO(), io.StringIO(), None
        with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                verify_access.main(["--claims"])
            except SystemExit as exit_:
                code = exit_.code
        return token, server, out.getvalue() + err.getvalue() + summary_file.read_text(), code

    def test_claims_are_compared_with_the_trust_and_the_token_never_appears(self):
        token, server, output, code = self.run_claims(trust_claims())
        self.assertIsNone(code)
        self.assertNotIn(token, output)
        for piece in token.split("."):
            self.assertNotIn(piece, output)
        self.assertNotIn("segredo-nao-listado", output, "só as claims da matriz são exibidas")
        self.assertNotIn("token-do-runner", output)
        path, auth = server.requests[0]
        self.assertIn("audience=sts.amazonaws.com", path)
        self.assertEqual(auth, "Bearer token-do-runner")
        self.assertIn("| `sub` | `repo:org-teste@111/portal-teste@222:environment:production` | sim | sim |", output)

    def test_any_trust_claim_mismatch_fails(self):
        for claim, value in (("sub", "repo:org-teste/portal-teste:environment:production"), ("ref", "refs/heads/feat"),
                             ("environment", "staging"), ("repository_id", "999"), ("aud", "outra")):
            with self.subTest(claim):
                _, _, output, code = self.run_claims(trust_claims(**{claim: value}))
                self.assertEqual(code, 1)
                self.assertIn("**NÃO**", output)

    def test_missing_id_token_permission_fails(self):
        with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            verify_access.request_claims({})


class CredentialTests(unittest.TestCase):
    def test_missing_aws_credentials_fail_before_any_call(self):
        with patch.dict(os.environ, child_env(), clear=True), contextlib.redirect_stderr(io.StringIO()) as err, \
                self.assertRaises(SystemExit) as code:
            release_cli.aws_clients(REGION)
        self.assertEqual(code.exception.code, 1)
        self.assertIn("Credenciais AWS ausentes", err.getvalue())

    def test_activation_cli_exit_codes_distinguish_refusal_from_post_activation_failure(self):
        args = ["--bucket", BUCKET, "--distribution-id", "E1ABCDEFGHIJ", "--release-id", RID, "--public-origin",
                "https://portal.example.test", "--region", REGION]
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / "record.json"
            env = {"GITHUB_STEP_SUMMARY": str(Path(tmp) / "summary.md")}
            refused = fr.ReleaseError("Release ativa é legacy, não x; nada foi alterado.")
            after = fr.PostActivationError("Smoke falhou. Recuperação: rollback.", {"release_id": RID, "smoke": "falhou"})
            for error, expected in ((refused, 1), (after, 3)):
                with self.subTest(expected), patch.dict(os.environ, env, clear=True), \
                        patch.object(release_cli, "aws_clients", return_value=(None, None, None)), \
                        patch.object(fr, "activate_release", side_effect=error), contextlib.redirect_stdout(io.StringIO()), \
                        contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as code:
                    release_cli.run_activation("activate", args + ["--record-out", str(record)])
                self.assertEqual(code.exception.code, expected)
            saved = json.loads(record.read_text())
            self.assertEqual((saved["smoke"], saved["error"]), ("falhou", "Smoke falhou. Recuperação: rollback."))
            summary = (Path(tmp) / "summary.md").read_text()
            self.assertIn("nada foi alterado", summary)
            self.assertIn("Nenhum rollback automático", summary)


@mock_aws
class ProbeTests(unittest.TestCase):
    """A sonda só escreve em releases/_probe/<run>/ e nunca altera o index.html, qualquer que seja o resultado."""

    def test_probe_never_changes_the_index_and_flags_missing_iam_denies(self):
        s3 = boto3.client("s3", region_name=REGION)
        s3.create_bucket(Bucket=BUCKET)
        s3.put_object(Bucket=BUCKET, Key="index.html", Body=b"<html>no ar</html>", ContentType="text/html; charset=utf-8")
        before = s3.get_object(Bucket=BUCKET, Key="index.html")
        results = verify_access.probe(s3, BUCKET, "123-1")
        after = s3.get_object(Bucket=BUCKET, Key="index.html")
        self.assertEqual((after["ETag"], after["Body"].read()), (before["ETag"], b"<html>no ar</html>"))
        keys = sorted(o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET)["Contents"])
        self.assertEqual(keys, ["index.html", "releases/_probe/123-1/probe.txt"])
        observed = {step: (expected, got) for step, expected, got in results}
        # O moto não avalia a policy IAM: os passos que dependem do Deny divergem, e a sonda acusa isso.
        self.assertEqual(observed["1 release sem If-None-Match"], ("AccessDenied", "200"))
        self.assertEqual(observed["4 index.html sem If-Match"], ("AccessDenied", "PreconditionFailed"))
        self.assertEqual(observed["3 repetir com If-None-Match"], ("PreconditionFailed", "PreconditionFailed"))
        self.assertEqual(observed["5 index.html com If-Match errado"], ("PreconditionFailed", "PreconditionFailed"))
        self.assertEqual(observed["index.html intacto"][0], observed["index.html intacto"][1])


if __name__ == "__main__":
    unittest.main()

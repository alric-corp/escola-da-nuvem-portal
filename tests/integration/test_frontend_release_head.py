"""Pipeline do frontend (B.2): o HEAD atual da main no GitHub é revalidado em três momentos.

- Verificação A: job gate, antes de qualquer job do environment.
- Verificação B: primeiro passo de cada job do environment, já liberado, e antes de credencial ou artefato.
- Verificação C: nos scripts, imediatamente antes da primeira escrita AWS (publicação, ativação, sonda).

A API do GitHub é simulada (FakeGitHub e urlopen substituído), a AWS só aparece como cliente simulado e a rede fica
bloqueada. O simulador de workflow lê o deploy-frontend.yml real e executa os passos de gate na ordem dos jobs, no
disparo manual e no deploy automático (push integrado), com os outputs do gate decidindo jobs e passos.
"""
import contextlib
import io
import json
import os
import re
import socket
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from release_fixtures import (ENVDOC, ENVDOC_SOLO, REPO, RID, ROOT, SHA, FakeGitHub, block_network, ci_run_event, environment_env, fr,
                              load_script, repo_env)

import release_cli  # noqa: E402 - SCRIPTS já está no sys.path (release_fixtures)
import release_gate as gate  # noqa: E402

check_gate = load_script("check-deploy-gate")
verify_access = load_script("verify-access")
publish_cli = load_script("publish-release")
OTHER = "e5" * 20                     # commit integrado à main depois do disparo
HEAD_PATH = f"/repos/{REPO}/git/ref/heads/main"
TOKEN = "gh-token-teste-nao-imprimir"
AWS_ACTION = "aws-actions/configure-aws-credentials"
_restore = None


def setUpModule():
    global _restore
    _restore = block_network()


def tearDownModule():
    _restore()


def quiet(output_file=""):
    """Sem GITHUB_STEP_SUMMARY do runner, GITHUB_OUTPUT só no arquivo pedido e com a saída capturada."""
    out = io.StringIO()
    stack = contextlib.ExitStack()
    stack.enter_context(patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": "", "GITHUB_OUTPUT": output_file}))
    stack.enter_context(contextlib.redirect_stdout(out))
    stack.enter_context(contextlib.redirect_stderr(out))
    return stack, out


def run_stage(stage, env, github, output_file=""):
    stack, out = quiet(output_file)
    with stack:
        try:
            check_gate.main(["--stage", stage], env=env, get=github)
            code = 0
        except SystemExit as exit_:
            code = exit_.code
    return code, out.getvalue()


def stage_env(operation="publish", source="main", **overrides):
    """Ambiente do primeiro passo de um job do environment, como o workflow o monta."""
    env = dict(repo_env(OPERATION=operation, SOURCE=source), **environment_env(OPERATION=operation, SOURCE=source), GH_TOKEN=TOKEN)
    env.update(overrides)
    return {k: v for k, v in env.items() if v is not None}


class RemoteHeadGateTests(unittest.TestCase):
    """Verificações A (gate) e B (environment) com a API do GitHub simulada."""

    def test_head_equal_to_the_run_commit_passes(self):
        github = FakeGitHub()
        self.assertEqual(gate.repository_problems(repo_env(), github), [])
        self.assertIn(HEAD_PATH, github.paths, "o gate consulta refs/heads/main no GitHub")
        github = FakeGitHub()
        self.assertEqual(run_stage("environment", stage_env(), github)[0], 0)
        self.assertEqual(github.paths, [HEAD_PATH], "depois da aprovação, só a referência da main é consultada")

    def test_head_different_from_the_run_commit_is_denied(self):
        problems = gate.repository_problems(repo_env(), FakeGitHub(head=OTHER))
        self.assertTrue(any("A main avançou" in p and OTHER[:12] in p for p in problems), problems)
        code, output = run_stage("environment", stage_env(), FakeGitHub(head=OTHER))
        self.assertEqual(code, 1)
        self.assertIn("A main avançou", output)

    def test_api_error_statuses_are_denied(self):
        for status in (401, 403, 404, 429, 500):
            with self.subTest(status):
                problems = gate.repository_problems(repo_env(), FakeGitHub(head_status=status, head_payload=None))
                self.assertTrue(any(f"HTTP {status}" in p and "HEAD da main" in p for p in problems), problems)
                code, output = run_stage("environment", stage_env(), FakeGitHub(head_status=status, head_payload=None))
                self.assertEqual(code, 1)
                self.assertIn(f"HTTP {status}", output)

    def test_responses_that_are_not_refs_heads_main_are_denied(self):
        payloads = {
            "JSON inválido": None, "objeto vazio": {}, "lista": [], "sem object": {"ref": "refs/heads/main"},
            "object nulo": {"ref": "refs/heads/main", "object": None},
            "outra ref": {"ref": "refs/heads/main-antiga", "object": {"type": "commit", "sha": SHA}},
            "tag anotada": {"ref": "refs/heads/main", "object": {"type": "tag", "sha": SHA}},
        }
        for label, payload in payloads.items():
            with self.subTest(label):
                problems = gate.repository_problems(repo_env(), FakeGitHub(head_payload=payload))
                self.assertTrue(any("não é a referência refs/heads/main" in p for p in problems), problems)
                self.assertEqual(run_stage("environment", stage_env(), FakeGitHub(head_payload=payload))[0], 1)

    def test_missing_or_malformed_sha_is_denied(self):
        for label, sha in {"ausente": None, "maiúsculas": SHA.upper(), "curto": SHA[:39], "longo": SHA + "0",
                           "não hex": "g" * 40, "número": 123}.items():
            with self.subTest(label):
                obj = {"type": "commit"} if sha is None else {"type": "commit", "sha": sha}
                payload = {"ref": "refs/heads/main", "object": obj}
                problems = gate.repository_problems(repo_env(), FakeGitHub(head_payload=payload))
                self.assertTrue(any("SHA do HEAD remoto ausente ou malformado" in p for p in problems), problems)
                self.assertEqual(run_stage("environment", stage_env(), FakeGitHub(head_payload=payload))[0], 1)

    def test_green_ci_for_the_run_commit_does_not_cover_a_main_that_moved(self):
        problems = gate.repository_problems(repo_env(), FakeGitHub(head=OTHER, runs_sha=SHA))
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("A main avançou", problems[0])

    def test_main_at_the_run_commit_without_green_ci_is_denied(self):
        problems = gate.repository_problems(repo_env(), FakeGitHub(ci=("failure",)))
        self.assertTrue(any("Aprovação CI" in p for p in problems))

    def test_unprotected_environment_is_denied_even_with_main_current(self):
        # Sem restrição de branch (qualquer branch poderia usar o environment): recusa mesmo com a main correta.
        problems = gate.repository_problems(repo_env(), FakeGitHub(env=dict(ENVDOC_SOLO, deployment_branch_policy=None)))
        self.assertEqual(problems, ["Environment sem política de branches customizada."])

    def test_kill_switch_off_denies_productive_operations_before_any_query(self):
        for operation, extra in (("publish", {}), ("activate", {"RELEASE_ID": RID}),
                                 ("rollback", {"RELEASE_ID": RID, "EXPECTED_ACTIVE_RELEASE": "legacy"}), ("deploy", {})):
            with self.subTest(operation):
                github = FakeGitHub()
                problems = gate.repository_problems(repo_env(OPERATION=operation, DEPLOY_ENABLED="false", **extra), github)
                self.assertTrue(any("Kill switch" in p for p in problems), problems)
                self.assertEqual(github.paths, [])

    def test_environment_stage_requires_the_confirmed_sha(self):
        code, output = run_stage("environment", stage_env(EXPECTED_MAIN_SHA=OTHER), FakeGitHub(head=OTHER))
        self.assertEqual(code, 1)
        self.assertIn("expected_main_sha diverge", output)
        code, output = run_stage("environment", stage_env(EXPECTED_MAIN_SHA=None), FakeGitHub())
        self.assertEqual(code, 1)

    def test_github_token_never_appears_in_the_output(self):
        for github in (FakeGitHub(head=OTHER), FakeGitHub(head_status=401, head_payload=None), FakeGitHub()):
            code, output = run_stage("environment", stage_env(), github)
            self.assertNotIn(TOKEN, output)


class FakeResponse:
    def __init__(self, status, body):
        self.status, self.body = status, body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class GitHubAdapterTests(unittest.TestCase):
    """release_cli.github_get, o adaptador real da API, com urlopen substituído."""

    env = {"GH_TOKEN": TOKEN, "GITHUB_API_URL": "https://api.github.com", "GITHUB_SHA": SHA, "EXPECTED_MAIN_SHA": SHA,
           "GITHUB_REPOSITORY": REPO}

    def head_problems(self, env=None):
        env = env or self.env
        return gate.main_head_problems(env, lambda path: release_cli.github_get(path, env))

    def test_valid_response_passes_and_the_token_only_goes_in_the_header(self):
        with patch("urllib.request.urlopen", return_value=FakeResponse(200, json.dumps({
                "ref": "refs/heads/main", "object": {"type": "commit", "sha": SHA}}).encode())) as urlopen:
            self.assertEqual(self.head_problems(), [])
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "https://api.github.com" + HEAD_PATH)
        self.assertEqual(request.get_header("Authorization"), f"Bearer {TOKEN}")
        self.assertNotIn(TOKEN, request.full_url)

    def test_missing_credential_is_denied_without_calling_the_api(self):
        with patch("urllib.request.urlopen") as urlopen:
            problems = self.head_problems({k: v for k, v in self.env.items() if k != "GH_TOKEN"})
        urlopen.assert_not_called()
        self.assertTrue(any("sem resposta" in p for p in problems), problems)

    def test_non_https_api_url_is_denied_without_calling_it(self):
        with patch("urllib.request.urlopen") as urlopen:
            problems = self.head_problems(dict(self.env, GITHUB_API_URL="http://127.0.0.1:9"))
        urlopen.assert_not_called()
        self.assertTrue(problems)

    def test_http_errors_including_rate_limit_are_denied(self):
        for status in (401, 403, 404, 429, 500, 502):
            with self.subTest(status):
                error = urllib.error.HTTPError(HEAD_PATH, status, "erro", {"x-ratelimit-remaining": "0"}, io.BytesIO(b"{}"))
                with patch("urllib.request.urlopen", side_effect=error):
                    self.assertEqual(release_cli.github_get(HEAD_PATH, self.env), (status, None))
                    problems = self.head_problems()
                self.assertTrue(any(f"HTTP {status}" in p for p in problems), problems)

    def test_timeouts_and_network_errors_are_denied(self):
        for error in (TimeoutError("tempo esgotado"), socket.timeout("tempo esgotado"), urllib.error.URLError("sem rota"),
                      ConnectionResetError("reset")):
            with self.subTest(type(error).__name__):
                with patch("urllib.request.urlopen", side_effect=error):
                    self.assertEqual(release_cli.github_get(HEAD_PATH, self.env), (0, None))
                    problems = self.head_problems()
                self.assertTrue(any("sem resposta" in p for p in problems), problems)

    def test_invalid_json_is_denied(self):
        for body in (b"{nao-json", b"", b"\xff\xfe"):
            with self.subTest(body), patch("urllib.request.urlopen", return_value=FakeResponse(200, body)):
                self.assertEqual(release_cli.github_get(HEAD_PATH, self.env), (200, None))
                problems = self.head_problems()
            self.assertTrue(any("não é a referência refs/heads/main" in p for p in problems), problems)


# ---------------------------------------------------------------- simulador do deploy-frontend.yml

EXPRESSION = re.compile(r"\$\{\{ (inputs|vars|secrets|github|steps\.gate\.outputs|needs\.gate\.outputs)\.([\w-]+) \}\}")
OPERATION_IS = re.compile(r"needs\.gate\.outputs\.operation == '(\w+)'")
GATE_STEP = re.compile(r"python3 -B \.github/scripts/check-deploy-gate\.py --stage (repository|environment)")
AUTOMATIC = "automático"            # push integrado na main: sem inputs


def load_workflow():
    """deploy-frontend.yml como JSON, pelo parser YAML do Playwright fixado (o mesmo de tests/contracts/openapi.mjs)."""
    script = ("import bundle from 'playwright-core/lib/utilsBundle'; import { readFileSync } from 'node:fs';"
              "process.stdout.write(JSON.stringify(bundle.yaml.parse(readFileSync(process.argv[1], 'utf8'))));")
    out = subprocess.run(["node", "--input-type=module", "-e", script, str(ROOT / ".github" / "workflows" / "deploy-frontend.yml")],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class Run:
    """Uma execução do workflow: evento, contexto de expressões, runner e a API do GitHub simulada (mutável)."""

    def __init__(self, workflow, operation, github, tmp, event=None, **inputs):
        self.workflow, self.github, self.tmp = workflow, github, Path(tmp)
        if operation == AUTOMATIC:
            self.inputs = {}  # no push, inputs.* vira texto vazio
        else:
            self.inputs = {"operation": operation, "source": "main", "expected_main_sha": SHA, "release_id": "",
                           "expected_active_release": "", "confirm_release_id": "", "allow_config_change": "false",
                           "s3_probe": "false", "approved_release_id": RID, "approved_manifest_sha256": "a" * 64}
            if operation in ("activate", "rollback"):
                self.inputs.update(release_id=RID, expected_active_release="legacy")
            self.inputs.update(inputs)
        variables = environment_env()
        self.vars = {"FRONTEND_DEPLOY_ENABLED": "true", **{k: variables[k] for k in ("AWS_ROLE_ARN", "AWS_REGION", "FRONTEND_BUCKET",
                                                                                      "CLOUDFRONT_DISTRIBUTION_ID", "PUBLIC_ORIGIN",
                                                                                      "FRONTEND_CONFIG_JSON")}}
        self.context = {"inputs": self.inputs, "vars": self.vars, "secrets": {}, "github": {"token": TOKEN, "run_id": "1", "run_attempt": "1"},
                        "steps.gate.outputs": {}, "needs.gate.outputs": {}}
        self.runner = {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA,
                       "GITHUB_REPOSITORY": REPO, "GITHUB_ACTOR": "operador"}
        if operation != AUTOMATIC:
            payload = self.tmp / "event.json"
            payload.write_text(json.dumps({"inputs": self.inputs}), encoding="utf-8")
            self.runner["GITHUB_EVENT_PATH"] = str(payload)
        if operation == AUTOMATIC:
            payload = self.tmp / "event.json"
            payload.write_text(json.dumps(event or ci_run_event()), encoding="utf-8")
            self.runner.update(GITHUB_EVENT_NAME="push", GITHUB_EVENT_PATH=str(payload), GITHUB_ACTOR="github-actions")

    def resolve(self, value):
        if isinstance(value, bool):
            return str(value).lower()
        value = str(value)
        if "${{" not in value:
            return value
        match = EXPRESSION.fullmatch(value)
        assert match, f"expressão fora do que o simulador entende: {value}"
        return str(self.context[match.group(1)].get(match.group(2), ""))

    def selected(self, condition):
        """Condição de job ou de passo: alternativas `needs.gate.outputs.operation == 'x'`, com always() opcional."""
        if not condition or condition == "always()":
            return True
        condition = condition[len("always() && "):] if condition.startswith("always() && ") else condition
        options = [OPERATION_IS.fullmatch(part.strip()) for part in condition.split("||")]
        assert all(options), f"condição fora do que o simulador entende: {condition}"
        return self.context["needs.gate.outputs"].get("operation") in [m.group(1) for m in options]

    def run_job(self, name):
        """Executa os passos de gate; os demais são só registrados. Devolve (aprovado, passos executados, saída)."""
        executed = []
        job = self.workflow["jobs"][name]
        for step in job["steps"]:
            if not self.selected(step.get("if")):
                continue
            label = step.get("uses") or step.get("name") or step.get("run")
            match = GATE_STEP.fullmatch(step.get("run", ""))
            if match:
                env = dict(self.runner, **{k: self.resolve(v) for k, v in step.get("env", {}).items()})
                env = {k: v for k, v in env.items() if v != ""}
                output = self.tmp / f"output-{name}"
                output.write_text("", encoding="utf-8")
                code, out = run_stage(match.group(1), env, self.github, str(output))
                if code:
                    return False, executed, out
                if step.get("id") == "gate":
                    self.context["steps.gate.outputs"] = dict(line.split("=", 1) for line in output.read_text().splitlines())
            executed.append(label)
        if name == "gate":
            self.context["needs.gate.outputs"] = {k: self.resolve(v) for k, v in job.get("outputs", {}).items()}
        return True, executed, ""


class WorkflowWindowTests(unittest.TestCase):
    """A main avança enquanto a execução espera: o job liberado é recusado antes de credencial ou artefato."""

    @classmethod
    def setUpClass(cls):
        cls.workflow = load_workflow()

    def run_operation(self, operation, advance_before=None, github=None, event=None, **inputs):
        """Executa os jobs em ordem; advance_before = job antes do qual a main avança para OTHER."""
        github = github or FakeGitHub()
        results = []
        with tempfile.TemporaryDirectory() as tmp:
            run = Run(self.workflow, operation, github, tmp, event, **inputs)
            for job, spec in self.workflow["jobs"].items():
                if not run.selected(spec.get("if")):
                    continue
                if job == advance_before:
                    github.head = OTHER
                ok, executed, output = run.run_job(job)
                results.append((job, ok, executed, output))
                if not ok:
                    break
            self.outputs, self.run = dict(run.context["needs.gate.outputs"]), run
        return results

    def assert_denied_before_credentials(self, results, job):
        name, ok, executed, output = results[-1]
        self.assertEqual((name, ok), (job, False), results)
        self.assertIn("A main avançou", output)
        self.assertEqual([e.split("@")[0] for e in executed], ["actions/checkout"],
                         "nada além do checkout roda antes da revalidação: sem artefato, dependência ou OIDC")

    def test_control_with_main_unchanged_every_operation_reaches_its_last_step(self):
        expected = {"prepare": ["gate", "build"], "verify": ["gate", "verify"], "publish": ["gate", "build", "publish"],
                    "activate": ["gate", "activate"], "rollback": ["gate", "activate"], "deploy": ["gate", "build", "publish"],
                    AUTOMATIC: ["gate", "build", "publish"]}
        for operation, jobs in expected.items():
            with self.subTest(operation):
                results = self.run_operation(operation)
                self.assertEqual([(name, ok) for name, ok, _, _ in results], [(job, True) for job in jobs])
                last = results[-1][2]
                steps = [s for s in self.workflow["jobs"][jobs[-1]]["steps"] if self.run.selected(s.get("if"))]
                self.assertEqual(len(last), len(steps), "todos os passos do último job que valem para a operação")
                if operation != "prepare":
                    self.assertTrue(any(e.startswith(AWS_ACTION) for e in last))

    def test_publish_never_activates_and_deploy_activates_only_after_publishing(self):
        for operation, activates in (("publish", False), ("deploy", True), (AUTOMATIC, True)):
            with self.subTest(operation):
                last = self.run_operation(operation)[-1][2]
                self.assertEqual("./.github/actions/activate-release" in last, activates, last)
                if activates:
                    self.assertLess(last.index("./.github/actions/publish-release"), last.index("./.github/actions/activate-release"))

    def test_automatic_run_takes_operation_source_and_commit_from_the_gate(self):
        results = self.run_operation(AUTOMATIC)
        self.assertTrue(all(ok for _, ok, _, _ in results))
        self.assertEqual(self.outputs, {"operation": "deploy", "source": "main", "expected-main-sha": SHA,
                                       "approved-release-id": "", "approved-manifest-sha256": ""})

    def test_automatic_run_with_red_ci_reaches_no_environment_job(self):
        for label, event in (("push de exclusão", ci_run_event(deleted=True)), ("push de outra branch", ci_run_event(ref="refs/heads/feature"))):
            with self.subTest(label):
                results = self.run_operation(AUTOMATIC, event=event)
                self.assertEqual([(name, ok) for name, ok, _, _ in results], [("gate", False)])
                self.assertEqual(self.outputs, {}, "gate recusado não decide operação: nenhum job do environment roda")

    def test_main_advances_between_gate_and_approval_the_released_job_is_denied(self):
        for operation, job in (("prepare", "build"), ("verify", "verify"), ("publish", "build"),
                               ("activate", "activate"), ("rollback", "activate"), ("deploy", "build"), (AUTOMATIC, "build")):
            with self.subTest(operation):
                results = self.run_operation(operation, advance_before=job)
                self.assertTrue(results[0][1], "o gate inicial aprovou o commit A")
                self.assert_denied_before_credentials(results, job)

    def test_main_advances_between_build_and_publish_is_denied_before_oidc(self):
        for operation in ("publish", "deploy", AUTOMATIC):
            with self.subTest(operation):
                results = self.run_operation(operation, advance_before="publish")
                self.assertEqual([(name, ok) for name, ok, _, _ in results], [("gate", True), ("build", True), ("publish", False)])
                self.assert_denied_before_credentials(results, "publish")

    def test_main_advances_before_activate_is_denied(self):
        self.assert_denied_before_credentials(self.run_operation("activate", advance_before="activate"), "activate")

    def test_main_advances_before_rollback_is_denied(self):
        self.assert_denied_before_credentials(self.run_operation("rollback", advance_before="activate"), "activate")

    def test_main_advances_before_verify_is_denied(self):
        self.assert_denied_before_credentials(self.run_operation("verify", advance_before="verify", s3_probe="true"), "verify")

    def test_main_already_ahead_at_dispatch_is_denied_by_the_initial_gate(self):
        for operation in ("publish", AUTOMATIC):
            with self.subTest(operation):
                results = self.run_operation(operation, github=FakeGitHub(head=OTHER))
                self.assertEqual([(name, ok) for name, ok, _, _ in results], [("gate", False)])
                self.assertIn("A main avançou", results[0][3])


# ---------------------------------------------------------------- verificação C nos scripts

class WriteGuardTests(unittest.TestCase):
    """Imediatamente antes da primeira escrita AWS, os scripts revalidam o HEAD (sem AWS real: clientes simulados)."""

    env = {"GH_TOKEN": TOKEN, "GITHUB_SHA": SHA, "EXPECTED_MAIN_SHA": SHA, "GITHUB_REPOSITORY": REPO, "GITHUB_STEP_SUMMARY": "",
           "GITHUB_OUTPUT": ""}

    def test_guard_passes_with_main_current_and_raises_when_it_moved(self):
        release_cli.main_head_guard(self.env, FakeGitHub())()
        with self.assertRaisesRegex(fr.ReleaseError, "A main avançou"):
            release_cli.main_head_guard(self.env, FakeGitHub(head=OTHER))()
        with self.assertRaisesRegex(fr.ReleaseError, "HTTP 500"):
            release_cli.main_head_guard(self.env, FakeGitHub(head_status=500, head_payload=None))()

    def test_activation_and_rollback_cli_revalidate_before_writing(self):
        args = ["--bucket", "portal-web-teste", "--distribution-id", "E1ABCDEFGHIJ", "--release-id", RID, "--public-origin",
                "https://portal.example.test", "--region", "us-east-1"]
        for mode in ("activate", "rollback"):
            with self.subTest(mode):
                calls = []

                def activate(*_, before_write=None, **__):
                    if before_write:
                        calls.append("guard")
                        before_write()
                    calls.append("write")
                    return {"release_id": RID, "previous_release": "legacy", "changed": True, "invalidation_id": "I1", "smoke": "ok"}
                stack, out = quiet()
                with stack, patch.dict(os.environ, {k: v for k, v in self.env.items() if k != "GH_TOKEN"}, clear=True), \
                        patch.object(release_cli, "aws_clients", return_value=(None, None, None)), \
                        patch.object(fr, "activate_release", side_effect=activate), self.assertRaises(SystemExit) as code:
                    release_cli.run_activation(mode, args)
                self.assertEqual(code.exception.code, 1)
                self.assertEqual(calls, ["guard"], "sem credencial do GitHub, a escrita não acontece")
                self.assertIn("nada foi alterado", out.getvalue())

    def test_publish_cli_revalidates_before_the_first_object(self):
        writes = []

        def publish(s3, bucket, release_dir, before_write=None, approve=None):
            if before_write:
                before_write()
            writes.append(release_dir)
            return {"release_id": RID, "created": 1, "identical": 0}
        with patch.dict(os.environ, dict(self.env, GH_TOKEN=TOKEN), clear=True), \
                patch.object(publish_cli, "check_package"), \
                patch.object(publish_cli, "aws_clients", return_value=(None, None, None)), \
                patch.object(publish_cli, "publish_release", side_effect=publish), \
                patch.object(release_cli, "github_get", side_effect=lambda path, env=None: FakeGitHub(head=OTHER)(path)), \
                self.assertRaisesRegex(fr.ReleaseError, "A main avançou"):
            publish_cli.main(["--bucket", "portal-web-teste", "--release-dir", "x", "--region", "us-east-1"])
        self.assertEqual(writes, [])

    def test_s3_probe_revalidates_before_writing(self):
        sts = MagicMock()
        sts.get_caller_identity.return_value = {"Arn": f"arn:aws:sts::123456789012:assumed-role/{gate.ROLE_NAME}/s"}
        cloudfront = MagicMock()
        cloudfront.get_distribution.return_value = {"Distribution": {"Status": "Deployed"}}
        s3 = MagicMock()
        s3.list_objects_v2.return_value = {}
        stack, out = quiet()
        with stack, patch.dict(os.environ, {k: v for k, v in self.env.items() if k != "GH_TOKEN"}, clear=True), \
                patch.object(verify_access, "aws_clients", return_value=(s3, cloudfront, sts)), \
                patch.object(verify_access, "read_active", return_value={"etag": '"e"', "release_id": None, "md5": "m"}), \
                patch.object(verify_access, "probe") as probe, self.assertRaises(SystemExit):
            verify_access.main(["--s3-probe", "--bucket", "portal-web-teste", "--distribution-id", "E1ABCDEFGHIJ", "--region", "us-east-1"])
        probe.assert_not_called()
        s3.put_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()

"""Aprovação externa: CLI real, bytes reais e S3 Moto; toda recusa prova zero PutObject."""
import contextlib
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import boto3
from moto import mock_aws

from release_fixtures import (BASELINE, BASELINE_SHA, BUCKET, ORIGIN, REGION, ROOT, SHA, FakeGitHub, api_routes,
                              archive_baseline, block_network, build, ci_run_event, config, copy_app, fr,
                              child_env, load_script, package, repo_env)
from publication_approval import approve_snapshot, check_package, load_event
import release_cli
import release_gate

publisher = load_script("publish-release")
KEYS = ("operation", "source", "expected_main_sha", "approved_release_id", "approved_manifest_sha256")


class PublicationApprovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.restore = staticmethod(block_network())
        cls.tmp = tempfile.TemporaryDirectory()
        cls.work = Path(cls.tmp.name)
        app = copy_app(cls.work / "modern")
        build(app, config())
        api = api_routes(app, cls.work)
        cls.modern = package("modern", SHA, app, api, cls.work / "modern-release")
        base = archive_baseline(cls.work / "baseline")
        build(base)
        cls.baseline = package("baseline", BASELINE_SHA, base, api_routes(base, cls.work), cls.work / "base-release")
        changed = copy_app(cls.work / "changed")
        (changed / "frontend/styles.css").write_bytes((changed / "frontend/styles.css").read_bytes() + b"\n/* changed */\n")
        build(changed, config())
        cls.changed = package("modern", SHA, changed, api, cls.work / "changed-release")
        cls.other_sha = package("modern", "e5" * 20, app, api, cls.work / "other-release")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        cls.restore()

    def setUp(self):
        self.tmp_case = tempfile.TemporaryDirectory(dir=self.work)
        self.dir = Path(self.tmp_case.name) / "release"
        shutil.copytree(self.modern, self.dir)
        self.env = repo_env(OPERATION="publish", PUBLIC_ORIGIN=ORIGIN,
                            GITHUB_EVENT_PATH=str(Path(self.tmp_case.name) / "event.json"))
        self.approve_current()
        self.write_event()
        self.moto = mock_aws()
        self.moto.start()
        real = boto3.client("s3", region_name=REGION, aws_access_key_id="test", aws_secret_access_key="test")
        real.create_bucket(Bucket=BUCKET)
        self.s3 = MagicMock(wraps=real)
        self.clients = MagicMock(return_value=(self.s3, None, None))
        self.github = FakeGitHub()

    def tearDown(self):
        self.moto.stop()
        self.tmp_case.cleanup()

    def approve_current(self):
        raw = (self.dir / "manifest.json").read_bytes()
        self.env.update(APPROVED_RELEASE_ID=json.loads(raw)["release_id"],
                        APPROVED_MANIFEST_SHA256=hashlib.sha256(raw).hexdigest(), BUILT_RELEASE_ID=json.loads(raw)["release_id"])

    def write_event(self, event=None):
        Path(self.env["GITHUB_EVENT_PATH"]).write_text(json.dumps(event if event is not None else {
            "inputs": {key: self.env.get(key.upper(), "") for key in KEYS}}))

    def replace_package(self, source):
        shutil.rmtree(self.dir)
        shutil.copytree(source, self.dir)

    def run_cli(self):
        with patch.dict(os.environ, self.env, clear=True), patch.object(publisher, "aws_clients", self.clients), \
                patch.object(release_cli, "github_get", side_effect=lambda path, env=None: self.github(path)), \
                contextlib.redirect_stdout(io.StringIO()):
            return publisher.main(["--bucket", BUCKET, "--release-dir", str(self.dir), "--region", REGION])

    def assert_no_put(self):
        with self.assertRaises((fr.ReleaseError, ValueError, OSError, TypeError)):
            self.run_cli()
        self.s3.put_object.assert_not_called()
        self.assertEqual(self.s3.list_objects_v2(Bucket=BUCKET).get("KeyCount"), 0)

    def test_valid_manual_publish_and_deploy_accept_exact_approval(self):
        for operation in ("publish", "deploy"):
            with self.subTest(operation):
                self.env["OPERATION"] = operation
                self.write_event()
                self.run_cli()
                self.assertEqual(self.s3.put_object.call_count, 32)
                self.assertTrue(all(c.kwargs["IfNoneMatch"] == "*" for c in self.s3.put_object.call_args_list))
                self.assertTrue(self.s3.put_object.call_args_list[-1].kwargs["Key"].endswith("/manifest.json"))
                self.s3.put_object.reset_mock()

    def test_missing_or_malformed_approval_rejected_with_zero_put(self):
        original = dict(self.env)
        for key, values in {"APPROVED_RELEASE_ID": ["", "x", "../index", "A" * 12 + "-" + "b" * 12, "a" * 12 + "-" + "b" * 11],
                            "APPROVED_MANIFEST_SHA256": ["", "a" * 12, "a" * 63, "a" * 65, "G" * 64, "A" * 64, "a" * 64 + "\n"]}.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    self.env = dict(original, **{key: value})
                    self.write_event()
                    github = FakeGitHub()
                    self.assertTrue(release_gate.repository_problems(self.env, github))
                    self.assertEqual(github.paths, [])
                    self.assert_no_put()
        self.env = original

    def test_different_approved_id_hash_or_built_id_zero_put(self):
        original = dict(self.env)
        for key, value in {"APPROVED_RELEASE_ID": "a" * 12 + "-" + "b" * 12,
                           "APPROVED_MANIFEST_SHA256": "f" * 64, "BUILT_RELEASE_ID": "a" * 12 + "-" + "b" * 12}.items():
            with self.subTest(key=key):
                self.env = dict(original, **{key: value})
                self.write_event()
                self.assert_no_put()

    def test_source_sha_and_mode_must_match_even_with_approval_for_package(self):
        for source in (self.other_sha, self.baseline):
            with self.subTest(source=source.name):
                self.replace_package(source)
                self.approve_current()
                self.write_event()
                self.assert_no_put()

    def test_mode_wrong_with_matching_source_sha_zero_put(self):
        self.replace_package(self.baseline)
        self.env.update(GITHUB_SHA=BASELINE_SHA, EXPECTED_MAIN_SHA=BASELINE_SHA)
        self.github.head = BASELINE_SHA
        self.approve_current()
        self.write_event()
        self.assert_no_put()

    def test_event_approval_cannot_be_replaced_by_environment(self):
        inputs = {key: self.env.get(key.upper(), "") for key in KEYS}
        inputs["approved_manifest_sha256"] = "f" * 64
        self.write_event({"inputs": inputs})
        self.assert_no_put()

    def test_gate_fails_closed_when_original_manual_event_is_unreadable(self):
        gate_cli = load_script("check-deploy-gate")
        for contents in ("null", "[]", "invalid JSON", "{}"):
            with self.subTest(contents=contents):
                Path(self.env["GITHUB_EVENT_PATH"]).write_text(contents)
                github = FakeGitHub()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                        self.assertRaises(SystemExit) as raised:
                    gate_cli.main(["--stage", "repository"], env=self.env, get=github)
                self.assertEqual(raised.exception.code, 1)
                self.assertEqual(github.paths, [])
                self.s3.put_object.assert_not_called()

    def test_hash_is_exact_manifest_bytes_not_reserialized_json(self):
        file = self.dir / "manifest.json"
        file.write_bytes(file.read_bytes() + b" \n")  # mesmo JSON e release_id; bytes diferentes
        self.assert_no_put()

    def test_changed_asset_after_initial_validation_zero_put(self):
        check_package(self.dir, env=self.env, built_release_id=self.env["BUILT_RELEASE_ID"], baseline=BASELINE)
        (self.dir / "styles.css").write_bytes(b"alterado")
        self.assert_no_put()
        self.clients.assert_not_called()

    def test_manifest_changed_immediately_before_write_zero_put(self):
        def clients(region):
            file = self.dir / "manifest.json"
            file.write_bytes(file.read_bytes() + b"\n")
            return self.s3, None, None
        self.clients.side_effect = clients  # depois da validação inicial da CLI
        self.assert_no_put()
        self.clients.assert_called_once()

    def test_valid_different_artifact_after_initial_validation_zero_put(self):
        def clients(region):
            self.replace_package(self.changed)
            return self.s3, None, None
        self.clients.side_effect = clients
        self.assert_no_put()
        self.clients.assert_called_once()

    def test_core_requires_authorization_callback(self):
        with self.assertRaises(TypeError):
            fr.publish_release(self.s3, BUCKET, self.dir)
        self.s3.put_object.assert_not_called()

    def test_source_baseline_cannot_publish_modern_package_without_approval(self):
        self.env.update(SOURCE="baseline", APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="")
        self.write_event()
        self.assert_no_put()

    def test_pinned_baseline_still_publishes_without_modern_approval(self):
        self.replace_package(self.baseline)
        self.env.update(SOURCE="baseline", APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="", BUILT_RELEASE_ID=self.baseline.name)
        self.write_event()
        self.run_cli()
        self.assertEqual(self.s3.put_object.call_count, 31)

    def test_prepare_without_approval_remains_valid(self):
        self.env.update(OPERATION="prepare", APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="")
        self.write_event()
        check_package(self.dir, env=self.env, built_release_id=self.env["BUILT_RELEASE_ID"], baseline=BASELINE)
        self.assertEqual(release_gate.repository_problems(self.env, self.github, load_event(self.env)), [])
        self.s3.put_object.assert_not_called()
        self.assert_no_put()  # mas chamar o publicador com prepare nunca concede escrita

    def test_automatic_ci_publish_needs_no_manual_inputs(self):
        self.env.update(GITHUB_EVENT_NAME="workflow_run", OPERATION="deploy", APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="")
        self.write_event(ci_run_event())
        self.run_cli()
        self.assertEqual(self.s3.put_object.call_count, 32)

    def test_forged_automatic_or_manual_context_never_disables_approval(self):
        original = dict(self.env)
        for change in ({"GITHUB_EVENT_NAME": "workflow_run"}, {"SOURCE": "baseline"}, {"OPERATION": "prepare"},
                       {"APPROVED_RELEASE_ID": "a" * 12 + "-" + "b" * 12}, {"GITHUB_SHA": "e5" * 20}, {"GITHUB_REF": "refs/tags/main"}):
            with self.subTest(change=change):
                self.env = dict(original, **change)  # evento original permanece igual
                self.assert_no_put()
        self.env = original

    def test_untrusted_ci_event_and_missing_event_refuse_zero_put(self):
        self.env.update(GITHUB_EVENT_NAME="workflow_run", OPERATION="deploy", APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="")
        for event in (ci_run_event(conclusion="failure"), ci_run_event(event="pull_request"),
                      ci_run_event(head_repository={"full_name": "fork/portal"}), {}):
            with self.subTest(event=event):
                self.write_event(event)
                self.assert_no_put()
        Path(self.env["GITHUB_EVENT_PATH"]).unlink()
        self.assert_no_put()

    def test_gate_refuses_manual_publish_and_deploy_without_approval_before_api(self):
        for operation in ("publish", "deploy"):
            for key in ("APPROVED_RELEASE_ID", "APPROVED_MANIFEST_SHA256"):
                env = dict(self.env, OPERATION=operation, **{key: ""})
                github = FakeGitHub()
                self.assertTrue(release_gate.repository_problems(env, github))
                self.assertEqual(github.paths, [])

    def test_real_workflow_gate_build_and_pre_oidc_shell_steps_enforce_approval(self):
        from test_frontend_release_head import load_workflow

        workflow = load_workflow()
        gate_cli = load_script("check-deploy-gate")
        output = Path(self.tmp_case.name) / "gate-output"
        for valid in (True, False):
            with self.subTest(valid=valid):
                self.approve_current()
                if not valid:
                    self.env["APPROVED_MANIFEST_SHA256"] = "f" * 64
                self.write_event()
                output.write_text("")
                with patch.dict(os.environ, dict(self.env, GITHUB_OUTPUT=str(output)), clear=True), \
                        contextlib.redirect_stdout(io.StringIO()):
                    gate_cli.main(["--stage", "repository"], env=self.env, get=self.github)
                outputs = dict(line.split("=", 1) for line in output.read_text().splitlines())
                for job in ("build", "publish"):
                    definition = workflow["jobs"][job]
                    job_env = {k: outputs[v.removeprefix("${{ needs.gate.outputs.").removesuffix(" }}")]
                               for k, v in definition["env"].items()}
                    step = next(s for s in definition["steps"] if "check-publication-approval.py" in s.get("run", ""))
                    env = child_env(**self.env)
                    env.update(job_env, RELEASE_DIR=str(self.dir), PUBLIC_ORIGIN=ORIGIN,
                               BUILT_RELEASE_ID=self.env["BUILT_RELEASE_ID"])
                    result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", step["run"]],
                                            cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode == 0, valid, result.stdout + result.stderr)
                self.s3.put_object.assert_not_called()

    def test_main_advancing_still_prevents_every_put(self):
        self.github.head = "e5" * 20
        self.assert_no_put()

    def test_workflow_composite_shell_passes_public_origin_to_real_publisher(self):
        """Resolve o YAML real e executa shell + CLI; somente GitHub/AWS são simulados."""
        from test_frontend_release_head import load_workflow

        workflow = load_workflow()
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            "import bundle from 'playwright-core/lib/utilsBundle'; import {readFileSync} from 'node:fs';"
            "console.log(JSON.stringify(bundle.yaml.parse(readFileSync(process.argv[1], 'utf8'))));",
            str(ROOT / ".github/actions/publish-release/action.yml"),
        ], cwd=ROOT, capture_output=True, text=True, check=True)
        action = json.loads(result.stdout)
        job = workflow["jobs"]["publish"]
        call = next(s for s in job["steps"] if s.get("uses") == "./.github/actions/publish-release")
        step = action["runs"]["steps"][-1]
        harness = Path(self.tmp_case.name) / "publisher-harness.py"
        trace = Path(self.tmp_case.name) / "publication-trace.json"
        harness.write_text('''import json, os, runpy, sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import boto3
from moto import mock_aws
from release_fixtures import block_network, FakeGitHub, BUCKET, REGION
import release_cli
block_network()
sys.argv = sys.argv[1:]
if sys.argv[0] == "-B": sys.argv.pop(0)
with mock_aws():
    real = boto3.client("s3", region_name=REGION, aws_access_key_id="test", aws_secret_access_key="test")
    real.create_bucket(Bucket=BUCKET)
    s3 = MagicMock(wraps=real)
    github = FakeGitHub()
    with patch.object(release_cli, "aws_clients", return_value=(s3, None, None)), \\
            patch.object(release_cli, "github_get", side_effect=lambda path, env=None: github(path)):
        try:
            runpy.run_path(sys.argv[0], run_name="__main__")
        finally:
            Path(os.environ["TEST_TRACE"]).write_text(json.dumps({
                "origin": os.environ.get("PUBLIC_ORIGIN"),
                "puts": [{"key": c.kwargs["Key"], "condition": c.kwargs["IfNoneMatch"]}
                         for c in s3.put_object.call_args_list]}))
''')
        for operation, automatic, missing_origin in (("publish", False, False), ("deploy", False, False),
                                                       ("deploy", True, False), ("publish", False, True)):
            with self.subTest(operation=operation, automatic=automatic, missing_origin=missing_origin):
                self.approve_current()
                self.env.update(OPERATION=operation, GITHUB_EVENT_NAME="workflow_run" if automatic else "workflow_dispatch")
                if automatic:
                    self.env.update(APPROVED_RELEASE_ID="", APPROVED_MANIFEST_SHA256="")
                self.write_event(ci_run_event() if automatic else None)
                context = {"vars.PUBLIC_ORIGIN": ORIGIN, "vars.FRONTEND_BUCKET": BUCKET, "vars.AWS_REGION": REGION,
                           "github.token": "synthetic-token", "runner.temp": self.tmp_case.name,
                           "needs.build.outputs.release-id": self.env["BUILT_RELEASE_ID"]}
                context.update({"needs.gate.outputs." + k.lower().replace("_", "-"): self.env[k]
                                for k in ("OPERATION", "SOURCE", "EXPECTED_MAIN_SHA", "APPROVED_RELEASE_ID", "APPROVED_MANIFEST_SHA256")})

                def resolve(value):
                    return re.sub(r"\$\{\{ ([\w.-]+) \}\}", lambda m: context[m[1]], value)

                context.update({"inputs." + k: resolve(v) for k, v in call["with"].items()})
                env = child_env(**self.env)
                env.pop("PUBLIC_ORIGIN", None)  # precisa vir do workflow → input → env da composite
                env.update({k: resolve(v) for k, v in job["env"].items()})
                env.update({k: resolve(v) for k, v in step["env"].items()})
                if missing_origin:
                    env.pop("PUBLIC_ORIGIN", None)
                env.update(TEST_TRACE=str(trace), PYTHONPATH=str(ROOT / "tests/integration"))
                # O shell da action roda sem alteração; o Python usa a CLI real sob Moto, sem rede externa.
                shell = f'python3() {{ {shlex.quote(sys.executable)} -B {shlex.quote(str(harness))} "$@"; }}\n'
                result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", shell + step["run"]],
                                        cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
                observed = json.loads(trace.read_text())
                self.assertEqual(result.returncode == 0, not missing_origin, result.stdout + result.stderr)
                self.assertEqual(len(observed["puts"]), 0 if missing_origin else 32)
                if not missing_origin:
                    self.assertEqual(observed["origin"], ORIGIN)
                    self.assertTrue(all(c["condition"] == "*" for c in observed["puts"]))
                    self.assertTrue(observed["puts"][-1]["key"].endswith("/manifest.json"))

    def test_bytes_sent_are_the_approved_snapshot_despite_disk_changes_in_head_guard(self):
        raw = (self.dir / "manifest.json").read_bytes()
        def head():
            (self.dir / "manifest.json").write_bytes(b"changed after snapshot")
        def approve(manifest, assets, pointer, body):
            approve_snapshot(manifest, assets, pointer, body, env=self.env, event=load_event(self.env),
                             built_release_id=self.env["BUILT_RELEASE_ID"], baseline=BASELINE)
        fr.publish_release(self.s3, BUCKET, self.dir, before_write=head, approve=approve)
        self.assertEqual(self.s3.put_object.call_args_list[-1].kwargs["Body"], raw)

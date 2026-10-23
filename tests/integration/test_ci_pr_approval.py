"""APIs GitHub controladas: integração, quatro checks e conteúdo realmente testado."""
import base64
import contextlib
import io
import tempfile
import unittest

from release_fixtures import FakeGitHub, PR_BASE, PR_HEAD, REPO, SHA, TESTED_SHA, auto_env
from ci_approval import CHECKOUT_PREFIX, ApprovalError, _jobs, _pages, pr_approval_problems
from test_frontend_release_head import AUTOMATIC, Run, load_workflow


class CiPrApprovalTests(unittest.TestCase):
    def test_first_transition_different_commit_ids_same_tree_is_approved_without_push_ci(self):
        github = FakeGitHub()
        self.assertNotEqual(SHA, TESTED_SHA)
        self.assertNotEqual(SHA, PR_HEAD)
        self.assertEqual(pr_approval_problems(auto_env(), github), [])
        self.assertTrue(any("event=pull_request" in p for p in github.paths))
        self.assertFalse(any("event=push" in p for p in github.paths))
        self.assertTrue(any("/attempts/1/jobs" in p for p in github.paths))

    def assert_refused(self, github, message):
        errors = pr_approval_problems(auto_env(), github)
        self.assertTrue(errors, "a ausência de evidência não equivale à aprovação")
        self.assertIn(message, " | ".join(errors))

    def test_wrong_or_unmerged_pr_and_wrong_repository_are_refused(self):
        for changes in ({"merged": False}, {"merge_commit_sha": PR_HEAD},
                        {"base": {"ref": "other", "repo": {"full_name": REPO}}},
                        {"base": {"ref": "main", "repo": {"full_name": "fork/other"}}}):
            with self.subTest(changes=changes):
                github = FakeGitHub()
                github.documents["pr"].update(changes)
                self.assert_refused(github, "PR integrado")

    def test_pr_response_must_match_commit_association_number(self):
        github = FakeGitHub()
        github.documents["pr"]["number"] = 18
        self.assert_refused(github, "Identidade do PR")

    def test_wrong_run_identity_sha_workflow_repository_and_failed_ci_are_refused(self):
        variants = ({"head_sha": SHA}, {"event": "push"}, {"path": ".github/workflows/other.yml"},
                    {"repository": {"full_name": "fork/other"}}, {"head_repository": {"full_name": "fork/other"}},
                    {"conclusion": "failure"}, {"status": "in_progress"}, {"run_attempt": 0})
        for changes in variants:
            with self.subTest(changes=changes):
                github = FakeGitHub()
                github.documents["run"].update(changes)
                self.assertTrue(pr_approval_problems(auto_env(), github))

    def test_four_jobs_must_be_successful_same_attempt_and_same_checkout(self):
        for problem in ("missing", "duplicate", "failed", "skipped", "checkout missing", "checkout failed", "different", "malformed"):
            with self.subTest(problem=problem):
                github = FakeGitHub()
                jobs = github.documents["jobs"]["jobs"]
                if problem == "missing":
                    jobs.pop()
                    github.documents["jobs"]["total_count"] = 3
                elif problem == "duplicate":
                    jobs[0]["name"] = jobs[1]["name"]
                elif problem in ("failed", "skipped"):
                    jobs[0]["conclusion"] = "failure" if problem == "failed" else "skipped"
                elif problem == "checkout missing":
                    jobs[0]["steps"] = []
                elif problem == "checkout failed":
                    jobs[0]["steps"][0]["conclusion"] = "failure"
                else:
                    jobs[0]["steps"][0]["name"] = CHECKOUT_PREFIX + (PR_HEAD if problem == "different" else "abc") + " do PR 17"
                with self.assertRaises(ApprovalError):
                    _jobs(github, REPO, github.documents["run"], pr_number=17)
                self.assertTrue(pr_approval_problems(auto_env(), github))

    def test_green_ci_for_another_pr_with_same_head_and_tree_is_refused(self):
        github = FakeGitHub()
        for job in github.documents["jobs"]["jobs"]:
            job["steps"][0]["name"] = CHECKOUT_PREFIX + TESTED_SHA + " do PR 18"
        self.assert_refused(github, "outro PR")
        github = FakeGitHub()
        github.documents["run"]["pull_requests"] = [{"number": 18, "head": {"sha": PR_HEAD}}]
        self.assert_refused(github, "outro PR")
        github.documents["run"]["pull_requests"] = [{"number": 17, "head": {"sha": PR_HEAD}}]
        self.assertEqual(pr_approval_problems(auto_env(), github), [])

    def test_malformed_git_documents_and_incompatible_final_parents_fail_closed(self):
        for doc, value in (("tested", {"sha": TESTED_SHA, "tree": None, "parents": []}),
                           ("final", {"sha": SHA, "tree": {"sha": "1" * 40}, "parents": None}),
                           ("final", {"sha": SHA, "tree": {"sha": "1" * 40},
                                      "parents": [{"sha": PR_BASE}, {"sha": PR_HEAD}, {"sha": SHA}]})):
            with self.subTest(doc=doc, value=value):
                github = FakeGitHub()
                github.documents[doc] = value
                self.assertTrue(pr_approval_problems(auto_env(), github))

    def test_tree_and_base_change_are_independently_refused(self):
        for doc, key, value, message in (
                ("final", "tree", {"sha": "9" * 40}, "árvore integrada"),
                ("tested", "parents", [{"sha": PR_BASE}, {"sha": SHA}], "merge temporário"),
                ("tested", "sha", PR_HEAD, "Commit/árvore")):
            with self.subTest(doc=doc, key=key):
                github = FakeGitHub()
                github.documents[doc][key] = value
                self.assert_refused(github, message)

    def test_base_changed_identical_tree_passes_and_changed_content_refuses(self):
        github = FakeGitHub()
        github.documents["final"]["parents"][0]["sha"] = "9" * 40
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(pr_approval_problems(auto_env(GITHUB_ACTIONS="true"), github), [])
        self.assertIn("base avançou", output.getvalue())
        self.assertIn("árvore Git integral idêntica", output.getvalue())
        github.documents["final"]["tree"]["sha"] = "9" * 40
        self.assert_refused(github, "base mudou")
        self.assert_refused(github, "árvore integrada")

    def test_squash_merge_keeps_the_same_base_and_tested_tree(self):
        github = FakeGitHub()
        github.documents["final"]["parents"] = [{"sha": PR_BASE}]
        self.assertEqual(pr_approval_problems(auto_env(), github), [])

    def test_api_failures_are_not_absence_or_success(self):
        for status in (0, 403, 404, 429, 500):
            with self.subTest(status=status):
                self.assertTrue(pr_approval_problems(auto_env(), lambda path: (status, None)))

    def test_empty_page_with_continuation_and_multiple_pages(self):
        paths = []
        pages = [{"total_count": 1, "jobs": []}, {"total_count": 1, "jobs": [{"name": "x"}]}]
        def get(path):
            paths.append(path)
            return 200, pages.pop(0)
        self.assertEqual(_pages(get, "/jobs", "jobs"), [{"name": "x"}])
        self.assertEqual(len(paths), 2)

    def test_legacy_manual_recovery_uses_only_old_workflow_and_exact_push_ci(self):
        github = FakeGitHub()
        legacy = base64.b64encode(b"on:\n  push:\n    branches: [main]\n  pull_request:\n").decode()
        run = dict(github.documents["run"], head_sha=SHA, event="push", head_branch="main")
        def get(path):
            if "/contents/" in path:
                return 200, {"encoding": "base64", "content": legacy}
            if "event=push" in path:
                return 200, {"total_count": 1, "workflow_runs": [run]}
            if "/commits/" in path and "/pulls?" in path:
                return 200, []
            return github(path)
        self.assertEqual(pr_approval_problems(auto_env(GITHUB_EVENT_NAME="workflow_dispatch"), get), [])
        self.assertTrue(pr_approval_problems(auto_env(), get), "push atual não usa fallback manual histórico")
        run["head_sha"] = PR_HEAD
        self.assertTrue(pr_approval_problems(auto_env(GITHUB_EVENT_NAME="workflow_dispatch"), get))

    def test_new_main_cannot_claim_legacy_recovery(self):
        github = FakeGitHub(ci=("failure",))
        self.assertTrue(pr_approval_problems(auto_env(GITHUB_EVENT_NAME="workflow_dispatch"), github))
        self.assertTrue(any("/contents/" in p for p in github.paths))

    def test_real_workflow_mismatched_tree_stops_before_build_oidc_or_put(self):
        github = FakeGitHub()
        github.documents["final"]["tree"]["sha"] = "9" * 40
        with tempfile.TemporaryDirectory() as tmp:
            run = Run(load_workflow(), AUTOMATIC, github, tmp)
            ok, executed, output = run.run_job("gate")
            self.assertFalse(ok)
            self.assertIn("árvore integrada", output)
            self.assertEqual(run.context["needs.gate.outputs"], {})
            self.assertFalse(any("publish" in step or "configure-aws" in step for step in executed))

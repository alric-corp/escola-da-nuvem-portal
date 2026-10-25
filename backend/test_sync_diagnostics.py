"""Diagnóstico docente: dispatcher e sync reais, Canvas fictício, sem acesso produtivo."""
import copy
import json
import unittest
from unittest.mock import patch

import test_canvas as fixtures
from canvas import CanvasError
from portal import APIError, Portal, SYNC_USER


class SyncDiagnosticsTests(unittest.TestCase):
    setUp = fixtures.SyncTests.setUp
    pk = "COHORT#BRSA0267"
    slot = "2026-10-06T21:00:00Z"

    def execute(self, *, scheduled=True, attempt=1, slot=None):
        slot = slot or self.slot
        event = {"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": slot,
                 "executionId": "synthetic-" + str(attempt), "attemptNumber": attempt} if scheduled else None
        at = slot.replace(":00Z", ":30Z")
        client = fixtures.CanvasClient(fixtures.BASE, "fake", opener=fixtures.FakeCanvas({"4436": fixtures.course()}))
        with patch("portal.now", return_value=at), patch("canvas_sync._save_submissions"):
            return fixtures.run(self.repo, client, event=event, clock=lambda: at)

    def report(self, user=SYNC_USER):
        # Nenhuma consulta Canvas pode acontecer ao abrir o relatório.
        with patch("canvas.CanvasClient.get_all", side_effect=AssertionError("GET Canvas no relatório")):
            return Portal(self.repo, user).dispatch("GET", "/cohorts/BRSA0267/report", {})

    def proof(self):
        return self.repo.get(self.pk, "SYNC_RUN#" + self.slot)

    def test_catalog_failure_with_unchanged_grades_is_not_a_complete_success(self):
        self.execute(scheduled=False)
        before = self.report()
        catalog = self.repo.get("CATALOG#4436", "METADATA")
        with patch("canvas_sync.course_catalog", side_effect=CanvasError("private-token@example.test")):
            results, failures = self.execute()
        self.assertEqual(results, {"BRSA0267": "failed"})
        self.assertTrue(failures)
        after = self.report()
        self.assertEqual(after["canvasSync"]["status"], "unchanged")
        diagnostic = after.get("canvasSyncDiagnostics")
        self.assertIsNotNone(diagnostic)
        self.assertEqual(diagnostic["status"], "failed")
        self.assertEqual(diagnostic["stages"], {"catalog": "failed", "roster": "succeeded", "grades": "unchanged"})
        self.assertEqual(after["publication"], before["publication"])
        self.assertEqual(after["updatedAt"], before["updatedAt"])
        academic = lambda rows: [{key: value for key, value in row.items() if key != "canvasActivity"} for row in rows]
        self.assertEqual(academic(after["students"]), academic(before["students"]))
        self.assertEqual(self.repo.get("CATALOG#4436", "METADATA"), catalog)
        self.assertNotIn("private-token", json.dumps(after))

    def test_new_success_replaces_failure_without_changing_academic_history(self):
        self.execute(scheduled=False)
        with patch("canvas_sync.course_catalog", side_effect=CanvasError("failure")):
            self.execute()
        failed = self.report()
        self.execute(slot="2026-10-07T09:00:00Z")
        recovered = self.report()
        self.assertEqual(recovered["canvasSyncDiagnostics"]["status"], "succeeded")
        self.assertEqual(recovered["canvasSyncDiagnostics"]["scheduledFor"], "2026-10-07T09:00:00Z")
        self.assertEqual(recovered["history"], failed["history"])
        self.assertEqual(recovered["updatedAt"], failed["updatedAt"])
        self.assertEqual(self.proof()["status"], "failed", "A prova histórica não é reescrita pela recuperação.")

    def test_allowlist_and_profile_boundaries_include_legacy_sync_message(self):
        self.execute()
        proof = self.proof()
        proof.update(message="secret-token", token="secret-token", email="private@example.test", body={"name": "private"})
        self.repo.put(self.pk, "SYNC_RUN#" + self.slot, proof)
        self.repo.put(self.pk, "SYNC", {"status": "failed", "message": "secret-token private@example.test", "at": proof["finishedAt"]})
        admin = self.report()
        self.assertNotIn("secret-token", json.dumps(admin))
        self.assertNotIn("private@example.test", json.dumps(admin))
        self.assertEqual(set(admin["canvasSyncDiagnostics"]), {"status", "scheduledFor", "startedAt", "finishedAt", "stages"})
        self.assertEqual(self.repo.get(self.pk, "SYNC")["message"], "secret-token private@example.test", "Não altera registro histórico.")
        teacher = {"sub": "teacher", "email": "teacher@example.test", "groups": []}
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        self.assertEqual(self.report(teacher)["canvasSyncDiagnostics"], admin["canvasSyncDiagnostics"])
        student = {"sub": "student", "email": "aluno0@example.test", "groups": []}
        own = self.report(student)
        self.assertNotIn("canvasSyncDiagnostics", own)
        self.assertNotIn("canvasSync", own)
        viewed = Portal(self.repo, SYNC_USER).dispatch("POST", "/cohorts/BRSA0267/student-view", {"studentId": "100"})
        self.assertNotIn("canvasSyncDiagnostics", viewed)
        self.repo.transaction([("USER#teacher", "TEACH#BRSA0267", None, {"code": "BRSA0267"})])
        with self.assertRaises(APIError) as denied:
            self.report(teacher)
        self.assertEqual(denied.exception.status, 403)

    def test_missing_legacy_and_changed_course_do_not_claim_stage_success(self):
        self.execute(scheduled=False)
        self.assertIsNone(self.report().get("canvasSyncDiagnostics"))
        self.execute()
        proof = self.proof()
        self.assertEqual(proof["courseId"], "4436")
        proof.pop("courseId")
        self.repo.put(self.pk, "SYNC_RUN#" + self.slot, proof)
        self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "succeeded", "Legado com prova exata de METADATA é aproveitado.")
        metadata = self.repo.get(self.pk, "METADATA")
        self.repo.put(self.pk, "METADATA", {**metadata, "canvasCourseId": "9999"})
        self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "unavailable")

    def test_running_invalid_and_read_failure_are_conservative(self):
        self.execute()
        proof = self.proof()
        running = {**proof, "status": "running", "finishedAt": None,
                   "stages": {"catalog": "pending", "roster": "pending", "grades": "pending"}}
        self.repo.put(self.pk, "SYNC_RUN#" + self.slot, running)
        self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "running")
        for change in [{"finishedAt": "not-a-date"}, {"status": "succeeded", "stages": {"catalog": "failed", "roster": "succeeded", "grades": "unchanged"}},
                       {"startedAt": "2026-10-07T00:00:00Z"}, {"source": "other"}]:
            self.repo.put(self.pk, "SYNC_RUN#" + self.slot, {**proof, **change})
            self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "unavailable")
        with patch.object(self.repo, "page", side_effect=RuntimeError("secret read failure")):
            result = self.report()
        self.assertEqual(result["canvasSyncDiagnostics"]["status"], "unavailable")
        self.assertEqual(result["students"], self.report()["students"])
        self.assertNotIn("secret read failure", json.dumps(result))

    def test_latest_lookup_is_bounded_and_does_not_write(self):
        self.execute()
        before = copy.deepcopy(self.repo.items)
        original = self.repo.page
        with patch.object(self.repo, "page", wraps=original) as page:
            self.report()
        page.assert_called_once_with(self.pk, "SYNC_RUN#", 1)
        self.assertEqual(self.repo.items, before)

    def test_empty_page_with_continuation_is_not_confirmed_absence(self):
        self.execute()
        with patch.object(self.repo, "page", return_value=([], False)):
            self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "unavailable")
        with patch.object(self.repo, "page", return_value=([], True)):
            self.assertIsNone(self.report()["canvasSyncDiagnostics"])

    def test_failed_first_sync_is_visible_without_a_publication(self):
        with patch("canvas_sync.course_students", side_effect=CanvasError("private failure")):
            self.execute()
        result = self.report()
        self.assertIsNone(result["publication"])
        self.assertEqual(result["canvasSyncDiagnostics"]["status"], "failed")
        self.assertEqual(result["canvasSyncDiagnostics"]["stages"]["roster"], "failed")
        self.assertEqual(result["canvasSyncDiagnostics"]["stages"]["grades"], "skipped")
        self.assertNotIn("private failure", json.dumps(result))


if __name__ == "__main__":
    unittest.main()

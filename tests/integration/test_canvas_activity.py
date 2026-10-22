"""Proveniência auxiliar Canvas: dados sintéticos, sem rede ou escrita AWS real."""
import copy
import json
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from canvas_activity import activity_summary, instructor_activity, save_activity, student_activity
from repository import Conflict, Repository
from test_portal import MemoryRepository

OLD = "2026-10-20T12:00:00+00:00"
NEW = "2026-10-21T12:00:00+00:00"
LATEST = "2026-10-22T12:00:00+00:00"
LAST = "2026-10-19T09:00:00+00:00"
PK = "CANVAS_ACTIVITY#4436"
MISSING = object()


def person(user=100, seconds=3600, last=LAST, course=4436):
    enrollment = {"user_id": user, "course_id": course, "type": "StudentEnrollment", "enrollment_state": "active"}
    if seconds is not MISSING:
        enrollment["total_activity_time"] = seconds
    if last is not MISSING:
        enrollment["last_activity_at"] = last
    return {"id": user, "name": "Private name", "email": "private@example.test", "enrollments": [enrollment]}


class ActivityProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()

    def save(self, users, at=NEW, **kwargs):
        return save_activity(self.repo, "4436", users, at, complete=True, **kwargs)

    def row(self, user=100):
        return student_activity(instructor_activity(self.repo, "4436"), user)["canvasActivity"]

    def test_partial_field_omission_retains_value_and_original_observation(self):
        self.save([person(), person(101, 7200)], OLD)
        self.save([person(seconds=0), person(101, MISSING, None)])
        row = self.row(101)
        self.assertEqual(row["totalActivityTime"], 7200)
        self.assertEqual(row["provenance"]["totalActivityTime"], {
            "status": "retained", "observedAt": OLD, "referenceAt": None, "reason": "missing",
            "attemptedAt": NEW, "lastValidObservedAt": OLD})
        self.assertIsNone(row["lastActivityAt"])
        self.assertEqual(self.row()["totalActivityTime"], 0)

    def test_null_clears_visible_value_but_keeps_last_valid_reference(self):
        self.save([person()], OLD)
        self.save([person(seconds=None, last=None)])
        row = self.row()
        for field in ("totalActivityTime", "lastActivityAt"):
            self.assertIsNone(row[field])
            p = row["provenance"][field]
            self.assertEqual((p["status"], p["reason"], p["observedAt"]), ("unknown", "null", None))
            self.assertEqual(p["lastValidObservedAt"], OLD)
            self.assertEqual(p["attemptedAt"], NEW)

    def test_invalid_fields_retain_known_values_without_new_observation(self):
        self.save([person()], OLD)
        for seconds, last in [(-1, "invalid"), (True, "2026-10-20T10:00:00"),
                              (1.5, "2027-01-01T00:00:00Z"), ("0", "2026-02-30T12:00:00Z"),
                              (False, "9999-12-31T23:59:59-23:59"), (False, "0001-01-01T00:00:00+23:59")]:
            with self.subTest(seconds=seconds):
                self.setUp()
                self.save([person()], OLD)
                self.save([person(seconds=seconds, last=last)])
                row = self.row()
                self.assertEqual((row["totalActivityTime"], row["lastActivityAt"]), (3600, LAST))
                self.assertTrue(all(p["status"] == "retained" and p["reason"] == "invalid"
                                    and p["observedAt"] == OLD for p in row["provenance"].values()))

    def test_entirely_omitted_records_attempt_without_refreshing_collection(self):
        self.save([person()], OLD)
        self.assertFalse(self.save([{"id": 100}]))
        record = instructor_activity(self.repo, "4436")
        self.assertEqual(record["collectedAt"], OLD)
        self.assertEqual((record["attemptedAt"], record["status"]), (NEW, "partial"))
        self.assertEqual(self.row()["provenance"]["totalActivityTime"]["observedAt"], OLD)

    def test_explicit_null_is_not_replaced_by_old_data_on_later_omission(self):
        self.save([person()], OLD)
        self.save([person(seconds=None, last=None)])
        self.save([person(seconds=MISSING, last=MISSING)], LATEST)
        row = self.row()
        self.assertIsNone(row["totalActivityTime"])
        self.assertEqual(row["provenance"]["totalActivityTime"]["status"], "unknown")
        self.assertEqual(row["provenance"]["totalActivityTime"]["lastValidObservedAt"], OLD)

    def test_multiple_enrollments_are_order_independent_and_never_sum(self):
        first = person(seconds=600)
        first["enrollments"] += person(seconds=900, last="2026-10-20T09:00:00Z")["enrollments"]
        first["enrollments"] += person(seconds=None, last=None)["enrollments"]
        first["enrollments"] += person(seconds="bad", last=MISSING)["enrollments"]
        first["enrollments"] += person(seconds=99999, course=999)["enrollments"]
        self.save([first])
        before = self.row()
        self.assertEqual((before["totalActivityTime"], before["lastActivityAt"]),
                         (900, "2026-10-20T09:00:00+00:00"))
        first["enrollments"].reverse()
        other = MemoryRepository()
        save_activity(other, "4436", [first], NEW, complete=True)
        self.assertEqual(self.repo.get(PK, "METADATA"), other.get(PK, "METADATA"))

    def test_complete_listing_removes_missing_students_but_partial_does_not(self):
        self.save([person(), person(101)], OLD)
        save_activity(self.repo, "4436", [person()], NEW, complete=False)
        self.assertEqual(set(instructor_activity(self.repo, "4436")["students"]), {"100", "101"})
        self.assertEqual(self.row(101)["provenance"]["totalActivityTime"]["reason"], "incomplete")
        self.save([person()], LATEST)
        self.assertEqual(set(instructor_activity(self.repo, "4436")["students"]), {"100"})

    def test_empty_complete_list_removes_rows_but_partial_empty_retains(self):
        self.save([person()], OLD)
        save_activity(self.repo, "4436", [], NEW, complete=False)
        self.assertEqual(self.row()["totalActivityTime"], 3600)
        self.save([], LATEST)
        self.assertEqual(instructor_activity(self.repo, "4436")["students"], {})

    def test_legacy_records_preserve_unknown_precision_and_course_isolation(self):
        self.repo.put(PK, "METADATA", {"courseId": "4436", "collectedAt": OLD,
                      "students": {"100": {"total_activity_time": 3600, "last_activity_at": LAST}}})
        row = self.row()
        p = row["provenance"]["totalActivityTime"]
        self.assertEqual((p["status"], p["reason"], p["observedAt"], p["referenceAt"]),
                         ("retained", "legacy", None, OLD))
        self.assertIsNone(p["lastValidObservedAt"])
        self.assertIsNone(instructor_activity(self.repo, "9999"))
        self.assertEqual(student_activity(None, 100), {})

    def test_older_or_duplicate_attempt_never_overwrites_newer_attempt(self):
        self.save([person(seconds=7200)], NEW)
        before = self.repo.get(PK, "METADATA")
        for at in (OLD, NEW):
            with self.subTest(at=at), self.assertRaises(Conflict):
                self.save([person(seconds=100)], at)
        self.assertEqual(self.repo.get(PK, "METADATA"), before)

    def test_concurrent_change_after_read_is_rejected_without_retry(self):
        self.save([person()], OLD)
        transact = self.repo.transaction
        calls = []
        def race(writes, *args, **kwargs):
            calls.append(writes)
            self.repo.put(PK, "METADATA", {"courseId": "4436", "attemptedAt": LATEST,
                          "collectedAt": LATEST, "students": {}})
            return transact(writes, *args, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race), self.assertRaises(Conflict):
            self.save([person(seconds=100)])
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.repo.get(PK, "METADATA")["attemptedAt"], LATEST)

    def test_record_is_compact_and_contains_no_personal_payload(self):
        self.save([person(user=i, seconds=0) for i in range(1000, 1500)])
        raw = json.dumps(self.repo.get(PK, "METADATA"))
        self.assertLess(len(raw.encode()), 400 * 1024)
        self.assertNotIn("private", raw)
        self.assertNotIn("Private name", raw)

    def test_new_user_with_missing_fields_has_no_invented_historical_reference(self):
        self.save([person()], OLD)
        self.save([person(), person(101, MISSING, MISSING)])
        row = self.row(101)
        self.assertIsNone(row["totalActivityTime"])
        for p in row["provenance"].values():
            self.assertEqual((p["status"], p["observedAt"], p["referenceAt"]), ("unknown", None, None))

    def test_smaller_counter_in_new_collection_is_a_new_valid_observation(self):
        self.save([person(seconds=7200)], OLD)
        self.save([person(seconds=600)])
        self.assertEqual(self.row()["totalActivityTime"], 600)
        self.assertEqual(self.row()["provenance"]["totalActivityTime"]["observedAt"], NEW)

    def test_activity_during_query_is_valid_but_after_query_is_not(self):
        start, end = "2026-10-21T12:00:00+00:00", "2026-10-21T12:01:00+00:00"
        save_activity(self.repo, "4436", [person(last="2026-10-21T12:00:30+00:00")], end,
                      attempted_at=start, complete=True)
        row = self.row()
        self.assertEqual(row["lastActivityAt"], "2026-10-21T12:00:30+00:00")
        self.assertEqual(row["provenance"]["lastActivityAt"]["observedAt"], end)
        self.assertEqual(row["provenance"]["lastActivityAt"]["attemptedAt"], start)
        save_activity(self.repo, "4436", [person(last="2026-10-22T12:01:01+00:00")],
                      "2026-10-22T12:01:00+00:00", attempted_at=LATEST, complete=True)
        self.assertEqual(self.row()["lastActivityAt"], row["lastActivityAt"])
        self.assertEqual(self.row()["provenance"]["lastActivityAt"]["reason"], "invalid")

    def test_only_deleted_rejected_or_foreign_enrollments_cannot_refresh_values(self):
        for overrides in ({"enrollment_state": "deleted"}, {"enrollment_state": "rejected"},
                          {"course_id": 9999}, {"user_id": 999}, {"type": "TeacherEnrollment"}):
            with self.subTest(overrides=overrides):
                self.setUp()
                self.save([person()], OLD)
                user = person(seconds=99999)
                user["enrollments"][0].update(overrides)
                self.save([user])
                self.assertEqual(self.row()["totalActivityTime"], 3600)
                p = self.row()["provenance"]["totalActivityTime"]
                self.assertEqual((p["status"], p["observedAt"], p["reason"]), ("retained", OLD, "no-enrollment"))
        self.setUp()
        user = person()
        user["enrollments"][0]["enrollment_state"] = "deleted"
        self.save([user])
        self.assertIsNone(self.row()["totalActivityTime"])
        self.assertEqual(self.row()["provenance"]["totalActivityTime"]["status"], "unknown")

    def test_failure_records_first_attempt_without_fabricating_collection(self):
        self.assertFalse(save_activity(self.repo, "4436", [], NEW, failed=True))
        record = instructor_activity(self.repo, "4436")
        self.assertEqual(activity_summary(record), {"canvasEngagement": {
            "courseId": "4436", "collectedAt": None, "attemptedAt": NEW, "status": "failed"}})
        self.assertEqual(record["students"], {})
        self.assertEqual(activity_summary(None), {})

    def test_failure_preserves_values_and_age_while_marking_attempt(self):
        self.save([person()], OLD)
        save_activity(self.repo, "4436", [], NEW, failed=True)
        record, row = instructor_activity(self.repo, "4436"), self.row()
        self.assertEqual((record["status"], record["collectedAt"], record["attemptedAt"]), ("failed", OLD, NEW))
        self.assertEqual((row["totalActivityTime"], row["lastActivityAt"]), (3600, LAST))
        self.assertTrue(all(p["reason"] == "failed" and p["observedAt"] == OLD for p in row["provenance"].values()))

    def test_malformed_listing_never_claims_complete_or_removes_previous_student(self):
        self.save([person(), person(101)], OLD)
        self.save([person(), {"id": "bad"}])
        record = instructor_activity(self.repo, "4436")
        self.assertEqual(set(record["students"]), {"100", "101"})
        self.assertEqual(record["status"], "partial")

    def test_course_mismatch_in_existing_record_is_refused_without_writing(self):
        self.repo.put(PK, "METADATA", {"courseId": "other", "collectedAt": OLD, "students": {}})
        before = copy.deepcopy(self.repo.items)
        with self.assertRaises(ValueError):
            self.save([person()])
        self.assertEqual(self.repo.items, before)

    def test_failed_or_null_observation_never_restores_old_visible_value(self):
        self.save([person()], OLD)
        self.save([person(seconds=None, last=None)])
        save_activity(self.repo, "4436", [], LATEST, failed=True)
        row = self.row()
        self.assertIsNone(row["totalActivityTime"])
        self.assertEqual(row["provenance"]["totalActivityTime"]["lastValidObservedAt"], OLD)

    def test_legacy_summary_and_field_whitelist_do_not_copy_unrelated_payload(self):
        legacy = {"courseId": "4436", "collectedAt": OLD, "students": {"100": {
            "total_activity_time": 0, "last_activity_at": None, "email": "private@example.test"}},
            "secret": "private-token"}
        self.assertEqual(activity_summary(legacy), {"canvasEngagement": {
            "courseId": "4436", "collectedAt": OLD, "attemptedAt": None, "status": "legacy"}})
        exposed = json.dumps(student_activity(legacy, 100))
        self.assertNotIn("private", exposed)
        self.assertNotIn("email", exposed)


class ActivitySyncAndReportTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None,
                      "canvasCourseId": "4436", "autoSync": True})

    def execute(self, data=None, *, include_error=False, event=None):
        from canvas import CanvasClient, CanvasError
        from canvas_sync import run
        from test_canvas import BASE, FakeCanvas, course
        fake = FakeCanvas({"4436": data or course()})
        def opener(request, timeout=None):
            if include_error and "include[]=enrollments" in request.full_url:
                raise CanvasError("read denied; private-token private@example.test")
            return fake(request, timeout)
        with patch("canvas_sync._now", return_value=NEW):
            return run(self.repo, CanvasClient(BASE, "synthetic", opener=opener), event=event, clock=lambda: NEW)

    def test_first_failed_activity_collection_is_visible_only_in_authorized_report(self):
        from portal import APIError, Portal
        with self.assertLogs(level="WARNING") as logs:
            self.assertEqual(self.execute(include_error=True), ({"BRSA0267": "published"}, []))
        self.assertNotIn("private", " ".join(logs.output))
        admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        teacher = Portal(self.repo, {"sub": "teacher", "email": "teacher@example.test", "groups": ["instructor"]})
        path = "/cohorts/BRSA0267/report"
        expected = {"courseId": "4436", "collectedAt": None, "attemptedAt": NEW, "status": "failed"}
        self.assertEqual(admin.dispatch("GET", path, {})["canvasEngagement"], expected)
        with self.assertRaises(APIError) as denied:
            teacher.dispatch("GET", path, {})
        self.assertEqual(denied.exception.status, 403)
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        self.assertEqual(teacher.dispatch("GET", path, {})["canvasEngagement"], expected)
        student = Portal(self.repo, {"sub": "student", "email": "aluno0@example.test", "groups": []})
        self.assertNotIn("canvasEngagement", student.dispatch("GET", path, {}))
        self.assertNotIn("canvasActivity", json.dumps(student.dispatch("GET", path, {})))

    def test_partial_collection_report_includes_retained_field_with_original_age(self):
        from portal import Portal
        from test_canvas import course
        save_activity(self.repo, "4436", [person(), person(101, 7200)], OLD, complete=True)
        data = course()
        data["students"][0]["enrollments"] = person(seconds=0)["enrollments"]
        data["students"][1]["enrollments"] = person(101, MISSING, MISSING)["enrollments"]
        self.assertEqual(self.execute(data), ({"BRSA0267": "published"}, []))
        report = Portal(self.repo, {"sub": "a", "email": "a@example.test", "groups": ["admin"]}).dispatch(
            "GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(report["canvasEngagement"], {"courseId": "4436", "collectedAt": OLD,
                                                      "attemptedAt": NEW, "status": "partial"})
        row = next(s for s in report["students"] if s["id"] == "101")["canvasActivity"]
        self.assertEqual(row["totalActivityTime"], 7200)
        self.assertEqual(row["provenance"]["totalActivityTime"]["observedAt"], OLD)
        self.assertEqual(row["provenance"]["totalActivityTime"]["status"], "retained")
        self.assertEqual(set(row), {"totalActivityTime", "lastActivityAt", "collectedAt", "provenance"})

    def test_attempt_timestamp_precedes_http_and_old_late_response_cannot_overwrite(self):
        from canvas import CanvasClient
        from canvas_sync import run
        from test_canvas import BASE, FakeCanvas, course
        fake = FakeCanvas({"4436": course()}, page_size=100)
        def opener(request, timeout=None):
            if "include[]=enrollments" in request.full_url:
                # Outra tentativa termina enquanto a consulta antiga ainda está em curso.
                save_activity(self.repo, "4436", [person(seconds=7200)], LATEST, complete=True)
            return fake(request, timeout)
        with patch("canvas_sync._now", return_value=NEW), self.assertLogs(level="WARNING") as logs:
            self.assertEqual(run(self.repo, CanvasClient(BASE, "synthetic", opener=opener)),
                             ({"BRSA0267": "published"}, []))
        self.assertIn("superada", " ".join(logs.output))
        record = instructor_activity(self.repo, "4436")
        self.assertEqual((record["attemptedAt"], record["students"]["100"]["total_activity_time"]), (LATEST, 7200))

    def test_auxiliary_storage_failure_does_not_change_scheduled_proof_contract(self):
        event = {"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": "2026-10-21T09:00:00Z",
                 "executionId": "synthetic", "attemptNumber": 1}
        with patch("canvas_sync.save_activity", side_effect=RuntimeError("private-token")), self.assertLogs(level="WARNING"):
            self.assertEqual(self.execute(event=event), ({"BRSA0267": "published"}, []))
        proof = self.repo.get("COHORT#BRSA0267", "SYNC_RUN#2026-10-21T09:00:00Z")
        self.assertEqual(proof["status"], "succeeded")
        self.assertEqual(proof["stages"], {"catalog": "succeeded", "roster": "succeeded", "grades": "published"})
        self.assertIsNone(instructor_activity(self.repo, "4436"))


@mock_aws
class ActivityAWSPersistenceTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "TABLE_NAME": "activity-cas-test",
                                      "IMPORTS_BUCKET": "activity-imports-test"})
        env.start()
        self.addCleanup(env.stop)
        boto3.client("dynamodb", region_name="us-east-1").create_table(
            TableName="activity-cas-test", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k in ("PK", "SK")])
        self.repo = Repository()

    def test_real_repository_round_trip_preserves_retained_and_null_provenance(self):
        save_activity(self.repo, "4436", [person()], OLD, complete=True)
        save_activity(self.repo, "4436", [person(seconds=MISSING, last=None)], NEW, complete=True)
        row = student_activity(instructor_activity(self.repo, "4436"), 100)["canvasActivity"]
        self.assertEqual(row["totalActivityTime"], 3600)
        self.assertEqual((row["provenance"]["totalActivityTime"]["status"],
                          row["provenance"]["totalActivityTime"]["observedAt"]), ("retained", OLD))
        self.assertIsNone(row["lastActivityAt"])
        self.assertEqual(row["provenance"]["lastActivityAt"]["lastValidObservedAt"], OLD)

    def test_cas_uses_expected_snapshot_and_does_not_replace_concurrent_update(self):
        save_activity(self.repo, "4436", [person()], OLD, complete=True)
        transact = self.repo.transaction
        calls = []
        newer = {"courseId": "4436", "collectedAt": LATEST, "attemptedAt": LATEST,
                 "status": "complete", "students": {}}
        def race(writes, *args, **kwargs):
            calls.append(writes)
            self.repo.put(PK, "METADATA", newer)
            return transact(writes, *args, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race), self.assertRaises(Conflict):
            save_activity(self.repo, "4436", [person(seconds=900)], NEW, complete=True)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.repo.get(PK, "METADATA"), newer)

    def test_first_write_requires_absence_and_race_cannot_overwrite_it(self):
        transact = self.repo.transaction
        newer = {"courseId": "4436", "collectedAt": LATEST, "attemptedAt": LATEST,
                 "status": "complete", "students": {}}
        def race(writes, *args, **kwargs):
            self.repo.put(PK, "METADATA", newer)
            return transact(writes, *args, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race), self.assertRaises(Conflict):
            save_activity(self.repo, "4436", [person()], NEW, complete=True)
        self.assertEqual(self.repo.get(PK, "METADATA"), newer)


if __name__ == "__main__":
    unittest.main()

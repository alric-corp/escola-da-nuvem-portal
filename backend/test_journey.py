import json
import unittest
from unittest.mock import patch

from changes import snapshot_changes
from delivery import handler as delivery_handler, record_event
from grades import parse_csv
from portal import APIError
from test_grades import canvas_csv
import test_portal
import test_reminders


class JourneyTests(unittest.TestCase):
    setUp = test_portal.PortalTests.setUp
    call = test_portal.PortalTests.call
    publish = test_portal.PortalTests.publish

    def test_focus_is_teacher_only_and_uses_current_active_activities(self):
        publication = self.publish()
        body = {"activityIds": ["001 KC (123)"], "expectedCurrent": publication["id"], "expectedVersion": None}
        for actor in (self.student, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "focus-activities", body)
            self.assertEqual(err.exception.status, 403)
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        focus = self.call(self.instructor, "focus-activities", body)["focus"]
        self.assertEqual(self.call(self.student, "report", method="GET")["focus"], focus)
        for ids in (["missing"], ["001 KC (123)"] * 2, ["001 KC (123)"] * 4, [None], "001 KC (123)"):
            with self.assertRaises(APIError) as err:
                self.call(self.admin, "focus-activities", dict(body, activityIds=ids, expectedVersion=focus["version"]))
            self.assertEqual(err.exception.status, 400)
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "focus-activities", body)
        self.assertEqual(err.exception.status, 409)
        updated = self.publish(canvas_csv(kc="9"))
        self.assertEqual(self.call(self.student, "report", method="GET")["focus"], focus)
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "focus-activities", dict(body, expectedVersion=focus["version"]))
        self.assertEqual(err.exception.status, 409)
        self.call(self.admin, "focus-activities", dict(body, activityIds=[], expectedCurrent=updated["id"], expectedVersion=focus["version"]))
        self.assertEqual(self.call(self.student, "report", method="GET")["focus"]["activityIds"], [])

    def test_focus_filters_paused_activities_and_rejects_cross_cohort_ids(self):
        publication = self.publish()
        self.call(self.admin, "focus-activities", {"activityIds": ["001 KC (123)"], "expectedCurrent": publication["id"]})
        draft = self.call(self.admin, "preview", {"csv": canvas_csv(), "activeIds": ["002 Lab (456)"]})
        pub = self.call(self.admin, "publish", {"draftId": draft["draft"]["id"]})["publication"]
        report = self.call(self.student, "report", method="GET")
        self.assertEqual(report["focus"]["activityIds"], [])
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "focus-activities", {"activityIds": ["001 KC (123)"], "expectedCurrent": pub["id"], "expectedVersion": report["focus"]["version"]})
        self.assertEqual(err.exception.status, 400)

    def test_review_uses_unrounded_scores_and_excludes_missing_and_exempt(self):
        self.publish(canvas_csv(kc="6.99999", lab="94.99999"))
        activities = self.call(self.student, "report", method="GET")["student"]["activities"]
        self.assertTrue(all(a["needsReview"] for a in activities if a["state"] == "completed" and a["kind"] in ("kc", "lab")))
        self.publish(canvas_csv(kc="", lab="EX"))
        activities = self.call(self.student, "report", method="GET")["student"]["activities"]
        self.assertFalse(any(a["needsReview"] for a in activities))

    def test_preview_lists_removed_students_and_publish_requires_acknowledgment(self):
        self.publish(canvas_csv(extra=["Outro Aluno", "202", "other@example.test", "8", "100", "0"]))
        preview = self.call(self.admin, "preview", {"csv": canvas_csv(kc="9")})
        c = preview["changes"]
        self.assertEqual((c["previousCount"], c["currentCount"], c["gradesChanged"]), (2, 1, 1))
        self.assertEqual(c["studentsRemoved"], [{"id": "202", "name": "Outro Aluno"}])
        for acknowledgment in (None, False, "true"):
            with self.assertRaises(APIError) as err:
                self.call(self.admin, "publish", {"draftId": preview["draft"]["id"], "acknowledgeRemoved": acknowledgment})
            self.assertEqual(err.exception.status, 400)
        result = self.call(self.admin, "publish", {"draftId": preview["draft"]["id"], "acknowledgeRemoved": True})
        self.assertEqual(result["publication"]["changes"]["studentsRemoved"], 1)

    def test_comparison_distinguishes_zero_missing_exemption_and_release(self):
        before = parse_csv(canvas_csv(kc="", lab="EX"), ["001 KC (123)"])
        after = parse_csv(canvas_csv(kc="0", lab="0"), ["002 Lab (456)"])
        c = snapshot_changes(before, after)
        self.assertEqual(c["gradesChanged"], 2)
        self.assertEqual(c["activitiesReleased"][0]["id"], "002 Lab (456)")
        self.assertEqual(c["activitiesPaused"][0]["id"], "001 KC (123)")

    def test_restore_has_its_own_date_and_current_history_marker(self):
        with patch("portal.now", return_value="2026-09-01T12:00:00+00:00"):
            first = self.publish()
        with patch("portal.now", return_value="2026-09-02T12:00:00+00:00"):
            second = self.publish(canvas_csv(kc="9"))
        with patch("portal.now", return_value="2026-09-24T12:00:00+00:00"):
            self.call(self.admin, "restore", {"publicationId": first["id"], "expectedCurrent": second["id"]})
        report = self.call(self.student, "report", method="GET")
        self.assertEqual(report["publication"]["publishedAt"], first["publishedAt"])
        self.assertEqual(report["updatedAt"], "2026-09-24T12:00:00+00:00")
        self.assertEqual(report["updateKind"], "restore")
        self.assertEqual([r["publishedAt"] for r in report["history"] if r["current"]], [first["publishedAt"]])
        self.publish(canvas_csv(kc="8"))
        self.assertEqual(self.call(self.student, "report", method="GET")["updateKind"], "publish")

    def test_personal_history_compares_only_own_grades(self):
        extra = ["Segredo", "202", "secret@example.test", "8", "100", "0"]
        self.publish(canvas_csv(kc="7", extra=extra))
        self.publish(canvas_csv(kc="9", extra=extra))
        report = self.call(self.student, "report", method="GET")
        changes = next(row["changes"] for row in report["history"] if row["current"])
        self.assertEqual(changes["kc"], 20)
        self.assertEqual(changes["activities"][0]["after"], 90)
        for private in ("Segredo", "secret@example.test", '"202"', "studentsAdded", "snapshot"):
            self.assertNotIn(private, json.dumps(report))

    def test_restored_version_remains_in_history_outside_last_twelve(self):
        with patch("portal.now", return_value="2026-09-01T12:00:00+00:00"):
            first = self.publish()
        for day in range(2, 15):
            with patch("portal.now", return_value=f"2026-09-{day:02d}T12:00:00+00:00"):
                latest = self.publish(canvas_csv(kc="8"))
        self.call(self.admin, "restore", {"publicationId": first["id"], "expectedCurrent": latest["id"]})
        history = self.call(self.student, "report", method="GET")["history"]
        self.assertEqual(len(history), 12)
        self.assertEqual([row["publishedAt"] for row in history if row["current"]], [first["publishedAt"]])

    def test_student_cannot_access_comparison_or_sender_settings(self):
        for method, op in (("POST", "preview"), ("GET", "reminder-settings"), ("POST", "verify-sender")):
            with self.assertRaises(APIError) as err:
                self.call(self.student, op, {"csv": canvas_csv()} if op == "preview" else {}, method=method)
            self.assertEqual(err.exception.status, 403)

    def test_delivery_events_are_idempotent_and_do_not_regress(self):
        event = {"mail": {"messageId": "msg", "timestamp": "2026-09-24T12:00:00Z"}}
        for kind in ("Delivery", "DeliveryDelay", "Delivery", "Bounce", "Delivery", "Complaint", "Bounce"):
            record_event(self.repo, {**event, "eventType": kind})
        self.assertEqual(self.repo.get("EMAIL#msg", "DELIVERY")["status"], "complained")
        self.assertNotIn("mail", self.repo.get("EMAIL#msg", "DELIVERY"))

    def test_delivery_rejects_untrusted_topic(self):
        with patch.dict("os.environ", {"REMINDER_EVENTS_TOPIC": "trusted"}), patch("delivery.Repository", return_value=self.repo):
            with self.assertRaises(ValueError):
                delivery_handler({"Records": [{"EventSource": "aws:sns", "Sns": {"TopicArn": "wrong", "Message": "{}"}}]}, None)


class ReminderJourneyTests(unittest.TestCase):
    setUp = test_reminders.ReminderTests.setUp
    call = test_reminders.ReminderTests.call
    publish = test_reminders.ReminderTests.publish
    preview = test_reminders.ReminderTests.preview
    payload = test_reminders.ReminderTests.payload

    def test_verification_only_when_requested(self):
        with patch.object(self.mailer, "ensure_identity") as verify:
            settings = self.admin.dispatch("GET", "/cohorts/BRSA0267/reminder-settings", {})
            self.assertTrue(settings["enabled"])
            verify.assert_not_called()
            self.call("verify-sender", {})
            verify.assert_called_once_with("teacher@escoladanuvem.org")
        with self.assertRaises(APIError):
            self.call("verify-sender", {"email": "someone@escoladanuvem.org"})

    def test_delivery_status_is_visible_but_never_allows_duplicate(self):
        body = self.payload()
        self.call("send-reminder", body)
        record_event(self.repo, {"eventType": "Bounce", "mail": {"messageId": "ses-message-test"}})
        self.assertEqual(self.preview()["delivery"]["status"], "bounced")
        with self.assertRaises(APIError):
            self.call("send-reminder", body)
        self.assertEqual(len(self.mailer.sent), 1)


if __name__ == "__main__":
    unittest.main()

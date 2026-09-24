import unittest
from unittest.mock import patch

from portal import Portal, APIError
from reminders import SendFailure
from test_portal import MemoryRepository
from test_grades import canvas_csv


class Mailer:
    def __init__(self):
        self.sent = []
        self.ready = True
        self.failure = None

    def readiness(self, sender):
        return {"ready": self.ready, "reason": "SES aguardando liberação"}

    def send(self, msg):
        if self.failure:
            raise self.failure
        self.sent.append(msg)
        return "ses-message-test"

    def ensure_identity(self, email):
        pass


class ReminderTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", {"REMINDERS_ENABLED": "true"})
        env.start()
        self.addCleanup(env.stop)
        self.repo = MemoryRepository()
        self.mailer = Mailer()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "teacher@escoladanuvem.org", "groups": ["admin"]}, mailer=self.mailer)
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []}, mailer=self.mailer)
        self.publish()

    def call(self, op, body, actor=None):
        return (actor or self.admin).dispatch("POST", "/cohorts/BRSA0267/" + op, body)

    def publish(self, kc="", lab="", email="aluno@example.test"):
        draft = self.call("preview", {"csv": canvas_csv(kc=kc, lab=lab, email=email), "activeIds": ["001 KC (123)", "002 Lab (456)"]})
        return self.call("publish", {"draftId": draft["draft"]["id"]})

    def preview(self):
        return self.call("pending-preview", {"studentId": "101"})

    def payload(self, preview=None):
        preview = preview or self.preview()
        return {"studentId": "101", "publicationId": preview["publicationId"], "previewHash": preview["previewHash"]}

    def test_paused_reminders_keep_details_without_ses_or_send(self):
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}), patch.object(self.mailer, "readiness", side_effect=AssertionError("SES must not be called")):
            preview = self.preview()
            self.assertEqual(len(preview["activities"]), 2)
            self.assertNotIn("message", preview)
            self.assertNotIn("ses", preview)
            with self.assertRaises(APIError) as err:
                self.call("send-reminder", {"studentId": "101", "publicationId": preview["publicationId"], "previewHash": "old-preview"})
            self.assertEqual(err.exception.status, 403)
            self.assertEqual(self.mailer.sent, [])

    def test_preview_contains_only_pending_activities_and_no_send(self):
        preview = self.preview()
        self.assertEqual(len(preview["activities"]), 2)
        self.assertIn("KCs sem nota registrada:\n- 001 KC", preview["message"]["text"])
        self.assertIn("LABs sem nota registrada:\n- 002 Lab", preview["message"]["text"])
        self.assertIn("Precisa de algum auxílio?", preview["message"]["text"])
        self.assertEqual(preview["message"]["replyTo"], "teacher@escoladanuvem.org")
        self.assertEqual(preview["message"]["from"], "teacher@escoladanuvem.org")
        self.assertEqual(self.mailer.sent, [])

    def test_students_and_unassigned_instructors_cannot_preview_or_send(self):
        instructor = Portal(self.repo, {"sub": "other", "email": "other@escoladanuvem.org", "groups": ["instructor"]}, mailer=self.mailer)
        for actor in (self.student, instructor):
            for op, body in (("pending-preview", {"studentId": "101"}), ("send-reminder", self.payload())):
                with self.subTest(op=op), self.assertRaises(APIError) as err:
                    self.call(op, body, actor)
                self.assertEqual(err.exception.status, 403)
        self.assertEqual(self.mailer.sent, [])

    def test_send_is_individual_and_duplicate_is_blocked(self):
        body = self.payload()
        self.assertEqual(self.call("send-reminder", body)["delivery"]["status"], "sent")
        self.assertEqual(self.mailer.sent[0]["to"], "aluno@example.test")
        with self.assertRaises(APIError):
            self.call("send-reminder", body)
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(self.preview()["delivery"]["messageId"], "ses-message-test")

    def test_recipient_and_message_cannot_be_supplied_by_browser(self):
        for key in ("to", "text", "subject", "replyTo"):
            with self.subTest(key=key), self.assertRaises(APIError):
                self.call("send-reminder", {**self.payload(), key: "attacker@example.test"})
        self.assertEqual(self.mailer.sent, [])

    def test_new_publication_invalidates_previous_preview(self):
        body = self.payload()
        self.publish(kc="0")
        with self.assertRaises(APIError) as err:
            self.call("send-reminder", body)
        self.assertEqual(err.exception.status, 409)
        self.assertEqual(self.mailer.sent, [])

    def test_display_name_change_invalidates_preview(self):
        body = self.payload()
        self.repo.put("COHORT#BRSA0267", "PROFILE#101", {"canvasId": "101", "displayName": "Novo nome"})
        with self.assertRaises(APIError):
            self.call("send-reminder", body)
        self.assertEqual(self.mailer.sent, [])

    def test_missing_email_no_pending_and_ses_unready_block_send(self):
        self.mailer.ready = False
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.mailer.ready = True
        self.publish(email="")
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.publish(kc="0", lab="EX")
        self.assertEqual(self.preview()["activities"], [])
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.mailer.sent, [])

    def test_unreleased_activity_is_not_in_email(self):
        draft = self.call("preview", {"csv": canvas_csv(kc="", lab=""), "activeIds": ["001 KC (123)"]})
        self.call("publish", {"draftId": draft["draft"]["id"]})
        preview = self.preview()
        self.assertEqual(len(preview["activities"]), 1)
        self.assertNotIn("LABs sem nota registrada", preview["message"]["text"])

    def test_unknown_outcome_blocks_retry_but_definite_rejection_allows_it(self):
        self.mailer.failure = SendFailure(uncertain=False)
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.preview()["delivery"]["status"], "failed")
        self.mailer.failure = SendFailure(uncertain=True)
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.preview()["delivery"]["status"], "unknown")
        self.mailer.failure = None
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.mailer.sent, [])

    def test_publication_race_does_not_send(self):
        from repository import Conflict
        body = self.payload()
        self.repo.fail_transaction = True
        with self.assertRaises(Conflict): self.call("send-reminder", body)
        self.assertEqual(self.mailer.sent, [])

    def test_crash_after_acceptance_does_not_allow_duplicate(self):
        body = self.payload()
        original = self.repo.put
        with patch.object(self.repo, "put", wraps=original) as put:
            def fail_final(pk, sk, data, absent=False):
                if data.get("status") == "sent": raise RuntimeError("Dynamo unavailable")
                return original(pk, sk, data, absent)
            put.side_effect = fail_final
            with self.assertRaises(RuntimeError): self.call("send-reminder", body)
        self.assertEqual(self.preview()["delivery"]["status"], "sending")
        with self.assertRaises(APIError): self.call("send-reminder", body)
        self.assertEqual(len(self.mailer.sent), 1)


if __name__ == "__main__": unittest.main()

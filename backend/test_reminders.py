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
        env = patch.dict("os.environ", {"REMINDERS_ENABLED": "true", "REMINDER_BATCH_DELAY_SECONDS": "0"})
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
        return self.publish_csv(canvas_csv(kc=kc, lab=lab, email=email))

    def publish_csv(self, csv):
        draft = self.call("preview", {"csv": csv, "activeIds": ["001 KC (123)", "002 Lab (456)"]})
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

    def test_preview_includes_full_student_detail_for_instructor(self):
        self.publish(kc="7", lab="")  # KC com nota (70%), LAB sem nota
        preview = self.preview()
        self.assertEqual([a["state"] for a in preview["allActivities"]], ["completed", "pending"])
        self.assertEqual(preview["summary"]["kc"], 70)
        self.assertEqual(preview["summary"]["pending"], 1)
        self.assertEqual(preview["thresholds"], {"kc": 70, "lab": 95})
        self.assertEqual(len(preview["history"]), 2)  # publicação do setUp e esta
        self.assertTrue(preview["history"][0]["current"])
        self.assertEqual(len(preview["activities"]), 1)  # a lista do lembrete continua só com pendências
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            self.assertEqual(len(self.preview()["allActivities"]), 2)

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

    def test_batch_preview_reports_skip_reasons_and_a_sample_message(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Sem Email", "202", "", "", "", "0"]))
        # 101 (aluno@example.test): pendente, elegível. 202 (Sem Email): sem e-mail.
        self.call("send-reminder", self.payload())  # 101 já recebeu nesta publicação.
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202", "999"]})
        by_id = {r["id"]: r for r in preview["recipients"]}
        self.assertEqual(by_id["101"]["skip"], "already-sent")
        self.assertEqual(by_id["202"]["skip"], "no-email")
        self.assertEqual(by_id["999"]["skip"], "not-found")
        self.assertIsNone(preview["sample"])  # ninguém elegível para amostra
        self.assertEqual(len(self.mailer.sent), 1)  # só o send-reminder individual acima

    def test_batch_send_reports_per_student_outcome_and_never_duplicates(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Segundo Aluno", "202", "segundo@example.test", "", "", "0"]))
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202"]})
        self.assertIsNotNone(preview["sample"])
        result = self.call("send-reminders", {"studentIds": ["101", "202"],
                                              "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: r["status"] for r in result["results"]}, {"101": "sent", "202": "sent"})
        self.assertEqual({m["to"] for m in self.mailer.sent}, {"aluno@example.test", "segundo@example.test"})
        # Reenviar para os mesmos dois é bloqueado (mesma publicação, já enviado) — não duplica.
        again = self.call("send-reminders", {"studentIds": ["101", "202"],
                                             "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["status"] for r in again["results"]}, {"skipped"})
        self.assertEqual(len(self.mailer.sent), 2)

    def test_batch_send_skips_ineligible_without_blocking_the_rest(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Sem Email", "202", "", "", "", "0"]))
        result = self.call("send-reminders", {"studentIds": ["101", "202", "999"],
                                              "expectedPublicationId": self.repo.get("COHORT#BRSA0267", "METADATA")["current"]})
        by_id = {r["id"]: r for r in result["results"]}
        self.assertEqual(by_id["101"]["status"], "sent")
        self.assertEqual(by_id["202"]["reason"], "no-email")
        self.assertEqual(by_id["999"]["reason"], "not-found")
        self.assertEqual(len(self.mailer.sent), 1)

    def test_batch_requires_institutional_reminders_enabled_and_valid_ids(self):
        instructor = Portal(self.repo, {"sub": "other", "email": "other@escoladanuvem.org", "groups": ["instructor"]}, mailer=self.mailer)
        for actor in (self.student, instructor):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ["101"]}, actor)
            self.assertEqual(err.exception.status, 403)
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ["101"]})
            self.assertEqual(err.exception.status, 403)
        for ids in ([], ["101", "101"], ["x"] * 201, [1]):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ids})
            self.assertEqual(err.exception.status, 400)
        self.assertEqual(self.mailer.sent, [])

    def test_batch_send_stops_remaining_students_when_publication_changes_mid_batch(self):
        from repository import Conflict
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Segundo Aluno", "202", "segundo@example.test", "", "", "0"]))
        publication_id = self.repo.get("COHORT#BRSA0267", "METADATA")["current"]
        original = self.repo.transaction
        calls = {"n": 0}

        def flaky(writes):
            calls["n"] += 1
            if calls["n"] == 2:
                raise Conflict()
            return original(writes)

        with patch.object(self.repo, "transaction", side_effect=flaky):
            result = self.call("send-reminders", {"studentIds": ["101", "202"],
                                                   "expectedPublicationId": publication_id})
        self.assertEqual(result["results"][0]["status"], "sent")
        self.assertEqual(result["results"][1], {"id": "202", "name": "Segundo Aluno", "status": "skipped", "reason": "publication-changed"})
        self.assertEqual(len(self.mailer.sent), 1)

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

import copy
import csv
import io
import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from portal import Portal, APIError
from reminders import SendFailure
from test_portal import MemoryRepository
from test_grades import canvas_csv
from automatic_reminders import empty_counts
from sync_runs import canonical_time


def sao_paulo(*parts):
    """Instante local pelas regras IANA de America/Sao_Paulo, sem offset fixo."""
    return datetime(*parts, tzinfo=ZoneInfo("America/Sao_Paulo")).isoformat()


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


class AutomaticReminderAdapterTests(unittest.TestCase):
    def setUp(self):
        import os
        self.env = patch.dict(os.environ, {"AUTOMATIC_REMINDER_COHORTS": '["TURMAA","TURMAB"]',
                                          "INSTRUCTOR_EMAIL_DOMAIN": "example.test",
                                          "AUTOMATIC_REMINDERS_ENABLED": "true"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.event = {"source": "portal.scheduler", "type": "automatic-reminders", "version": 1,
                      "cohortCode": "TURMAA", "scheduledFor": "2026-10-06T23:00:00Z",
                      "executionId": "scheduler-1", "attemptNumber": "1", "dryRun": False}

    def invoke(self, result):
        import automatic_reminders as automatic
        from unittest.mock import Mock
        context = Mock()
        context.get_remaining_time_in_millis.return_value = 15000
        with patch.object(automatic, "Repository") as repo, patch.object(automatic.reminders, "SESMailer") as mailer, \
                patch.object(automatic, "run", return_value=result) as worker:
            response = automatic.handler(self.event, context)
            return response, worker.call_args, repo, mailer, context

    def test_native_event_is_normalized_and_only_selected_cohort_is_passed(self):
        result = [{"status": "completed", "retryable": False}]
        response, call, repo, mailer, context = self.invoke(result)
        self.assertEqual(response, result)
        self.assertEqual(call.args[:2], (repo.return_value, mailer.return_value))
        self.assertEqual(call.args[2], {k: (1 if k == "attemptNumber" else self.event[k]) for k in
                                      ("source", "type", "scheduledFor", "executionId", "attemptNumber")})
        self.assertEqual(call.args[3:], (["TURMAA"], "example.test"))
        self.assertTrue(call.kwargs["enabled"])
        self.assertFalse(call.kwargs["dry_run"])
        self.assertEqual(call.kwargs["remaining_ms"], context.get_remaining_time_in_millis)

    def test_invalid_or_unconfigured_event_is_rejected_before_clients(self):
        import automatic_reminders as automatic
        for change in ({"cohortCode": "UNKNOWN"}, {"version": True}, {"version": 2}, {"dryRun": "false"},
                       {"sender": "private@example.test"}, {"attemptNumber": "0"}, {"attemptNumber": True},
                       {"attemptNumber": "1.0"}, {"scheduledFor": sao_paulo(2026, 10, 6, 20, 1)},
                       {"scheduledFor": sao_paulo(2026, 10, 7, 19, 59), "dryRun": True},
                       {"scheduledFor": sao_paulo(2026, 10, 7, 23, 30), "dryRun": True}):
            with self.subTest(change=change), patch.object(automatic, "Repository") as repo, \
                    patch.object(automatic.reminders, "SESMailer") as mailer:
                with self.assertRaises(ValueError) as error:
                    automatic.handler({**self.event, **change}, None)
                self.assertNotIn("private@example.test", str(error.exception))
                repo.assert_not_called()
                mailer.assert_not_called()

    def test_dry_run_and_disabled_infrastructure_are_forwarded_without_inferred_enable(self):
        import os
        self.event["dryRun"] = True
        with patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "false"}):
            _, call, *_ = self.invoke([{"status": "dry-run", "retryable": False}])
        self.assertFalse(call.kwargs["enabled"])
        self.assertTrue(call.kwargs["dry_run"])

    def test_disabled_live_returns_existing_skip_without_clients_writes_or_send(self):
        import os
        import automatic_reminders as automatic
        from unittest.mock import Mock
        repo, mailer = MemoryRepository(), Mailer()
        with patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "false"}), \
                patch.object(automatic, "utc_now", return_value=self.event["scheduledFor"]), \
                patch.object(automatic, "Repository", return_value=repo) as repository, \
                patch.object(automatic.reminders, "SESMailer", return_value=mailer) as ses_mailer, \
                patch("boto3.client") as client, patch("boto3.resource") as resource, \
                patch.object(repo, "put") as put, patch.object(repo, "transaction") as transaction, \
                patch.object(mailer, "send") as send:
            response = automatic.handler(self.event, Mock())
        self.assertEqual(len(response), 1)
        self.assertEqual((response[0]["status"], response[0]["reason"]), ("skipped", "infrastructure-disabled"))
        self.assertEqual(response[0]["cohort"], self.event["cohortCode"])
        self.assertEqual(response[0]["scheduledFor"], self.event["scheduledFor"])
        self.assertFalse(response[0]["dryRun"])
        self.assertFalse(response[0]["retryable"])
        self.assertIsNone(response[0]["publicationId"])
        self.assertEqual(response[0]["counts"]["sent"], 0)
        for operation in (repository, ses_mailer, client, resource, put, transaction, send):
            operation.assert_not_called()

    def test_retryable_partial_requests_async_retry_without_exposing_summary(self):
        with self.assertRaisesRegex(RuntimeError, "Retentativa de lembretes automáticos"):
            self.invoke([{"status": "partial", "retryable": True}])

    def test_disabled_live_respects_2000_window_without_aws(self):
        import os
        import automatic_reminders as automatic
        from unittest.mock import Mock
        for at, reason in ((sao_paulo(2026, 10, 6, 19, 59, 59), "not-due"),
                           (sao_paulo(2026, 10, 6, 20, 0), "infrastructure-disabled"),
                           (sao_paulo(2026, 10, 6, 20, 29, 59), "infrastructure-disabled"),
                           (sao_paulo(2026, 10, 6, 20, 30), "window-expired")):
            with self.subTest(at=at), patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "false"}), \
                    patch.object(automatic, "utc_now", return_value=at), \
                    patch.object(automatic, "Repository") as repo, \
                    patch.object(automatic.reminders, "SESMailer") as mailer, \
                    patch("boto3.client") as client, patch("boto3.resource") as resource:
                result = automatic.handler(self.event, Mock())[0]
                self.assertEqual((result["status"], result["reason"]), ("skipped", reason))
                self.assertIsNone(result["publicationId"])
                self.assertEqual(result["counts"], automatic.empty_counts())
                for operation in (repo, mailer, client, resource):
                    operation.assert_not_called()

    def test_live_outside_tuesday_friday_is_not_due_before_clients_even_with_gate_open(self):
        import os
        import automatic_reminders as automatic
        from unittest.mock import Mock
        for gate in ("true", "false"):
            for day in (5, 7, 8, 10, 11):  # segunda, quarta, quinta, sábado e domingo às 20h
                at = sao_paulo(2026, 10, day, 20, 0)
                with self.subTest(gate=gate, day=day), patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": gate}), \
                        patch.object(automatic, "utc_now", return_value=at), \
                        patch.object(automatic, "Repository") as repo, \
                        patch.object(automatic.reminders, "SESMailer") as mailer, \
                        patch("boto3.client") as client, patch("boto3.resource") as resource:
                    result = automatic.handler({**self.event, "scheduledFor": at}, Mock())[0]
                    self.assertEqual((result["status"], result["reason"], result["dryRun"]), ("skipped", "not-due", False))
                    self.assertFalse(result["retryable"])
                    self.assertEqual(result["counts"], automatic.empty_counts())
                    for operation in (repo, mailer, client, resource):
                        operation.assert_not_called()

    def test_oct14_pilot_adapter_opens_clients_only_for_brsa0257_exact_slot(self):
        import os
        import automatic_reminders as automatic
        from unittest.mock import Mock
        self.event.update(cohortCode="BRSA0257", scheduledFor="2026-10-14T23:00:00Z")
        with patch.dict(os.environ, {"AUTOMATIC_REMINDER_COHORTS": '["BRSA0257","BRSA0267"]'}):
            _, call, repo, mailer, _ = self.invoke([{"status": "completed", "retryable": False}])
            repo.assert_called_once()
            mailer.assert_called_once()
            self.assertEqual(call.args[3], ["BRSA0257"])
            for code, slot in (("BRSA0267", "2026-10-14T23:00:00Z"),
                               ("BRSA0257", "2026-10-21T23:00:00Z")):
                event = {**self.event, "cohortCode": code, "scheduledFor": slot}
                with self.subTest(code=code, slot=slot), \
                        patch.object(automatic, "utc_now", return_value=slot), \
                        patch.object(automatic, "Repository") as repository, \
                        patch.object(automatic.reminders, "SESMailer") as ses_mailer:
                    result = automatic.handler(event, Mock())[0]
                    self.assertEqual(result["reason"], "not-due")
                    repository.assert_not_called()
                    ses_mailer.assert_not_called()

    def test_active_lease_contention_requests_retry_but_business_skips_do_not(self):
        with self.assertRaises(RuntimeError):
            self.invoke([{"status": "skipped", "reason": "lease-active", "retryable": False}])
        for reason in ("sync-invalid", "window-expired", "sender-not-ready", "already-finished", "infrastructure-disabled",
                       "not-due"):
            result = [{"status": "skipped", "reason": reason, "retryable": False}]
            self.assertEqual(self.invoke(result)[0], result)


class AutomaticSenderSettingsTests(unittest.TestCase):
    def setUp(self):
        self.repo, self.mailer = MemoryRepository(), Mailer()
        self.code = "TURMAA"
        self.pk = "COHORT#" + self.code
        self.at = "2026-10-06T20:00:00+00:00"

    def configure(self, enabled=True, version=1):
        from reminders import reminder_settings
        settings = reminder_settings("teacher-1", enabled, version, self.at)
        self.repo.put(self.pk, "REMINDER_SETTINGS", settings)
        self.repo.put(self.pk, "TEACH#teacher-1", {"userId": "teacher-1", "code": self.code,
                                                   "email": "teacher@example.test"})
        self.repo.put("USER#teacher-1", "TEACH#" + self.code, {"code": self.code})
        return settings

    def resolve(self):
        from reminders import automatic_sender_readiness
        return automatic_sender_readiness(self.repo, self.code, "example.test", self.mailer)

    def test_missing_or_disabled_settings_never_calls_ses(self):
        with patch.object(self.mailer, "readiness", side_effect=AssertionError("SES not needed")):
            self.assertEqual(self.resolve(), {"ready": False, "reason": "settings-missing"})
            self.configure(enabled=False)
            self.assertEqual(self.resolve(), {"ready": False, "reason": "automatic-disabled"})

    def test_config_contains_only_reference_flag_version_and_utc_time(self):
        settings = self.configure(version=3)
        self.assertEqual(settings, {"senderUserId": "teacher-1", "automaticEnabled": True,
                                    "version": 3, "updatedAt": self.at})
        self.assertNotIn("@", str(self.repo.get(self.pk, "REMINDER_SETTINGS")))
        from reminders import reminder_settings
        for args in (("", True, 1, self.at), ("teacher-1", "true", 1, self.at),
                     ("teacher-1", True, True, self.at), ("teacher-1", True, 0, self.at),
                     ("teacher-1", True, 1, "2026-10-06T20:00:00")):
            with self.subTest(args=args), self.assertRaises(ValueError):
                reminder_settings(*args)

    def test_sender_is_resolved_from_current_link_without_persistence_or_verification(self):
        self.configure()
        before = copy.deepcopy(self.repo.items)
        with patch.object(self.mailer, "ensure_identity", side_effect=AssertionError("no verification")):
            result = self.resolve()
        self.assertTrue(result["ready"])
        self.assertEqual(result["sender"], "teacher@example.test")
        self.assertEqual(self.repo.items, before)
        self.repo.items[self.pk, "TEACH#teacher-1"]["email"] = "changed@example.test"
        self.assertEqual(self.resolve()["sender"], "changed@example.test")

    def test_removed_link_does_not_fall_back_to_another_teacher(self):
        self.configure()
        self.repo.put(self.pk, "TEACH#other", {"userId": "other", "code": self.code, "email": "other@example.test"})
        for key in ((self.pk, "TEACH#teacher-1"), ("USER#teacher-1", "TEACH#" + self.code)):
            before = copy.deepcopy(self.repo.items)
            del self.repo.items[key]
            with patch.object(self.mailer, "readiness", side_effect=AssertionError("invalid sender")):
                self.assertEqual(self.resolve(), {"ready": False, "reason": "sender-unlinked"})
            self.repo.items = before

    def test_invalid_settings_and_sender_fail_closed(self):
        self.configure()
        valid = self.repo.get(self.pk, "REMINDER_SETTINGS")
        for changes in ({"senderUserId": None}, {"version": 0}, {"email": "hidden@example.test"}):
            self.repo.put(self.pk, "REMINDER_SETTINGS", {**valid, **changes})
            self.assertEqual(self.resolve(), {"ready": False, "reason": "settings-invalid"})
        self.repo.put(self.pk, "REMINDER_SETTINGS", valid)
        for email in (None, "bad", "outside@elsewhere.test"):
            self.repo.items[self.pk, "TEACH#teacher-1"]["email"] = email
            self.assertEqual(self.resolve(), {"ready": False, "reason": "sender-invalid"})

    def test_readiness_false_is_preserved_and_two_cohorts_use_their_own_sender(self):
        self.configure()
        self.mailer.ready = False
        self.assertFalse(self.resolve()["ready"])
        self.assertEqual(self.resolve()["reason"], "SES aguardando liberação")
        from reminders import automatic_sender_readiness, reminder_settings
        self.repo.put("COHORT#TURMAB", "REMINDER_SETTINGS", reminder_settings("teacher-2", True, 1, self.at))
        self.repo.put("COHORT#TURMAB", "TEACH#teacher-2", {"userId": "teacher-2", "code": "TURMAB", "email": "other@example.test"})
        self.repo.put("USER#teacher-2", "TEACH#TURMAB", {"code": "TURMAB"})
        self.assertEqual(automatic_sender_readiness(self.repo, "TURMAB", "example.test", self.mailer)["sender"], "other@example.test")


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

        def flaky(writes, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise Conflict()
            return original(writes, **kwargs)

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



class SharedReminderReservationTests(unittest.TestCase):
    setUp = ReminderTests.setUp
    call = ReminderTests.call
    publish = ReminderTests.publish
    publish_csv = ReminderTests.publish_csv
    preview = ReminderTests.preview
    payload = ReminderTests.payload

    def withdraw(self, sid="101"):
        self.repo.put("COHORT#BRSA0267", "PARTICIPATION#" + sid,
                      {"canvasId": sid, "status": "WITHDRAWN", "updatedAt": "2026-10-06T21:59:00Z", "updatedBy": "other"})

    def test_individual_withdrawal_after_read_before_transaction_reserves_nothing(self):
        body = self.payload()
        original = self.repo.transaction
        def race(writes, **kwargs):
            if any(w[1].startswith("REMINDER#") for w in writes):
                self.withdraw()
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race), self.assertRaises(APIError) as err:
            self.call("send-reminder", body)
        self.assertEqual(err.exception.status, 409)
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_batch_reauthorizes_the_next_recipient_after_the_first_send(self):
        self.publish_csv(canvas_csv(kc="", lab="", extra=["Second", "202", "second@example.test", "", "", "0"]))
        pub = self.preview()["publicationId"]
        original = self.mailer.send
        def send(message):
            result = original(message)
            self.withdraw("202")
            return result
        with patch.object(self.mailer, "send", side_effect=send):
            result = self.call("send-reminders", {"studentIds": ["101", "202"], "expectedPublicationId": pub})
        self.assertEqual([r["status"] for r in result["results"]], ["sent", "skipped"])
        self.assertEqual(result["results"][1]["reason"], "withdrawn")
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "REMINDER#" + pub + "#202"))

    def test_withdrawal_after_reservation_does_not_claim_to_recall_the_email(self):
        body = self.payload()
        original = self.mailer.send
        def after_reservation(message):
            record = self.repo.get("COHORT#BRSA0267", "REMINDER#" + body["publicationId"] + "#101")
            self.assertEqual(record["status"], "sending")
            self.withdraw()
            return original(message)
        with patch.object(self.mailer, "send", side_effect=after_reservation):
            self.assertEqual(self.call("send-reminder", body)["delivery"]["status"], "sent")
        self.assertEqual(len(self.mailer.sent), 1)

    def test_both_manual_adapters_use_the_shared_reservation(self):
        import reminders
        body = self.payload()
        with patch.object(reminders, "reserve_reminder", wraps=reminders.reserve_reminder) as reserve:
            self.call("send-reminder", body)
            self.assertEqual(reserve.call_count, 1)
        self.publish(kc="1")
        pub = self.preview()["publicationId"]
        with patch.object(reminders, "reserve_reminder", wraps=reminders.reserve_reminder) as reserve:
            self.call("send-reminders", {"studentIds": ["101"], "expectedPublicationId": pub})
            self.assertEqual(reserve.call_count, 1)

    def test_shared_primitive_has_the_same_key_for_manual_and_future_automatic(self):
        import reminders
        from repository import Conflict
        self.call("send-reminder", self.payload())
        cohort = self.repo.get("COHORT#BRSA0267", "METADATA")
        pub = cohort["current"]
        key = "REMINDER#" + pub + "#101"
        previous = self.repo.get("COHORT#BRSA0267", key)
        with self.assertRaises(Conflict):
            reminders.reserve_reminder(self.repo, cohort, pub, "101", "system:auto", previous, "2026-10-06T23:00:00Z")
        self.assertEqual(self.repo.keys("COHORT#BRSA0267", "REMINDER#"), [key])

    def test_reservation_states_and_active_implicit_or_explicit(self):
        import reminders
        from repository import Conflict
        cohort = self.repo.get("COHORT#BRSA0267", "METADATA")
        pub, pk = cohort["current"], "COHORT#BRSA0267"
        for participation_status in (None, "ACTIVE", "WITHDRAWN"):
            for prior in (None, "failed", "sending", "unknown", "sent"):
                with self.subTest(participation=participation_status, prior=prior):
                    self.repo.items.pop((pk, "PARTICIPATION#101"), None)
                    if participation_status:
                        self.repo.put(pk, "PARTICIPATION#101", {"canvasId": "101", "status": participation_status})
                    key = "REMINDER#" + pub + "#101"
                    previous = {"status": prior} if prior else None
                    self.repo.items.pop((pk, key), None)
                    if previous: self.repo.put(pk, key, previous)
                    if participation_status == "WITHDRAWN":
                        with self.assertRaises(reminders.RecipientWithdrawn):
                            reminders.reserve_reminder(self.repo, cohort, pub, "101", "actor", previous, "at")
                    elif prior in ("sending", "unknown", "sent"):
                        with self.assertRaises(Conflict):
                            reminders.reserve_reminder(self.repo, cohort, pub, "101", "actor", previous, "at")
                    else:
                        record = reminders.reserve_reminder(self.repo, cohort, pub, "101", "actor", previous, "at")
                        self.assertEqual(record["status"], "sending")
                        with self.assertRaises(Conflict):
                            reminders.reserve_reminder(self.repo, cohort, pub, "101", "actor", previous, "at")
        self.assertEqual(self.mailer.sent, [])


def pending_csv(*rows):
    """Turma com todas as atividades sem nota; cada linha é (nome, ID Canvas, e-mail)."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Student", "ID", "SIS Login ID", "001 KC (123)", "002 Lab (456)", "Graduated Final Points"])
    writer.writerow(["Points Possible", "", "", "10", "100", "1"])
    for name, sid, email in rows:
        writer.writerow([name, sid, email, "", "", "0"])
    return out.getvalue()


class WithdrawnReminderTests(unittest.TestCase):
    """Aluno WITHDRAWN não recebe lembrete: o envio individual é recusado antes de qualquer efeito e o lote o pula,
    sempre conferindo no momento do envio (a prévia não autoriza nada). O detalhe do aluno continua abrindo."""

    def setUp(self):
        env = patch.dict("os.environ", {"REMINDERS_ENABLED": "true", "REMINDER_BATCH_DELAY_SECONDS": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.repo = MemoryRepository()
        self.mailer = Mailer()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "teacher@escoladanuvem.org", "groups": ["admin"]}, mailer=self.mailer)
        self.publish(pending_csv(("Costa, Marina", "101", "aluno@example.test"), ("Aluno, Segundo", "202", "segundo@example.test"),
                                 ("Aluno, Terceiro", "303", "terceiro@example.test"), ("Sem, Email", "404", ""), ("Outro, Sem Email", "505", "")))

    def call(self, op, body, code="BRSA0267"):
        return self.admin.dispatch("POST", f"/cohorts/{code}/" + op, body)

    def publish(self, text, code="BRSA0267"):
        draft = self.call("preview", {"csv": text, "activeIds": ["001 KC (123)", "002 Lab (456)"]}, code)
        return self.call("publish", {"draftId": draft["draft"]["id"]}, code)["publication"]

    def mark(self, canvas_id, status, expected):
        return self.call("participation", {"canvasId": canvas_id, "status": status, "expectedStatus": expected})

    def send_one(self, preview):
        return self.call("send-reminder", {"studentId": preview["student"]["id"], "publicationId": preview["publicationId"], "previewHash": preview["previewHash"]})

    def current(self):
        return self.repo.get("COHORT#BRSA0267", "METADATA")["current"]

    def refused(self, call):
        with self.assertRaises(APIError) as err:
            call()
        return err.exception.status

    def test_detail_still_opens_with_the_flag_and_individual_send_is_refused_without_effects(self):
        self.mark("202", "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview", {"studentId": "202"})
        self.assertEqual(preview["participationStatus"], "WITHDRAWN")
        self.assertEqual((preview["student"]["id"], len(preview["activities"])), ("202", 2))
        self.assertIn("message", preview)
        self.assertNotIn("participationStatus", self.call("pending-preview", {"studentId": "101"}))
        items = copy.deepcopy(self.repo.items)
        with patch.object(self.mailer, "readiness", side_effect=AssertionError("o SES não pode ser consultado")), \
                patch.object(self.mailer, "send", side_effect=AssertionError("nada pode ser enviado")):
            self.assertEqual(self.refused(lambda: self.send_one(preview)), 409)
        self.assertEqual((self.mailer.sent, self.repo.items), ([], items))
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            self.assertEqual(self.call("pending-preview", {"studentId": "202"})["participationStatus"], "WITHDRAWN")

    def test_preview_made_while_active_does_not_authorize_a_later_send(self):
        preview = self.call("pending-preview", {"studentId": "202"})
        self.assertNotIn("participationStatus", preview)
        self.mark("202", "WITHDRAWN", "ACTIVE")
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.refused(lambda: self.send_one(preview)), 409)
        self.assertEqual((self.mailer.sent, self.repo.items), ([], items))
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", f"REMINDER#{preview['publicationId']}#202"))

    def test_batch_skips_withdrawn_alongside_the_existing_reasons(self):
        self.send_one(self.call("pending-preview", {"studentId": "101"}))  # 101 já contatado nesta publicação
        self.mark("202", "WITHDRAWN", "ACTIVE")
        self.mark("505", "WITHDRAWN", "ACTIVE")  # sem e-mail e desistente: vale o motivo withdrawn
        ids = ["101", "202", "303", "404", "505", "999"]
        expected = {"101": "already-sent", "202": "withdrawn", "303": None, "404": "no-email", "505": "withdrawn", "999": "not-found"}
        preview = self.call("pending-preview-batch", {"studentIds": ids})
        self.assertEqual({r["id"]: r["skip"] for r in preview["recipients"]}, expected)
        self.assertEqual(preview["sample"]["to"], "terceiro@example.test")
        result = self.call("send-reminders", {"studentIds": ids, "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: (r["status"], r.get("reason")) for r in result["results"]},
                         {sid: ("sent", None) if reason is None else ("skipped", reason) for sid, reason in expected.items()})
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test", "terceiro@example.test"])

    def test_withdrawal_after_the_batch_preview_is_honoured_at_send(self):
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "303"]})
        self.assertEqual({r["id"]: r["skip"] for r in preview["recipients"]}, {"101": None, "303": None})
        self.mark("303", "WITHDRAWN", "ACTIVE")
        result = self.call("send-reminders", {"studentIds": ["101", "303"], "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: (r["status"], r.get("reason")) for r in result["results"]},
                         {"101": ("sent", None), "303": ("skipped", "withdrawn")})
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test"])
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", f"REMINDER#{self.current()}#303"))

    def test_all_withdrawn_batch_sends_nothing(self):
        for canvas_id in ("101", "202", "303"):
            self.mark(canvas_id, "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202", "303"]})
        self.assertEqual(({r["skip"] for r in preview["recipients"]}, preview["sample"]), ({"withdrawn"}, None))
        result = self.call("send-reminders", {"studentIds": ["101", "202", "303"], "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({(r["status"], r["reason"]) for r in result["results"]}, {("skipped", "withdrawn")})
        self.assertEqual(self.mailer.sent, [])

    def test_batch_send_only_reaches_the_requested_students(self):
        # O envio recalcula cada aluno pedido, mas nunca acrescenta quem não foi pedido: quem só reaparece como
        # ativo depois da prévia não entra se o pedido traz apenas os aprovados nela.
        self.mark("202", "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202"]})
        approved = [r["id"] for r in preview["recipients"] if not r["skip"]]
        self.assertEqual(approved, ["101"])
        self.mark("202", "ACTIVE", "WITHDRAWN")
        result = self.call("send-reminders", {"studentIds": approved, "expectedPublicationId": preview["publicationId"]})
        self.assertEqual([(r["id"], r["status"]) for r in result["results"]], [("101", "sent")])
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test"])

    def test_without_records_reminder_contracts_are_unchanged(self):
        preview = self.call("pending-preview", {"studentId": "101"})
        self.assertEqual(set(preview), {"student", "activities", "publicationId", "publishedAt", "message", "previewHash", "delivery", "ses",
                                        "remindersEnabled", "summary", "allActivities", "thresholds", "canvasCourseId", "history"})
        batch = self.call("pending-preview-batch", {"studentIds": ["101", "404", "999"]})
        self.assertEqual({frozenset(r) for r in batch["recipients"]}, {frozenset({"id", "name", "email", "pending", "skip"})})
        self.assertEqual({r["id"]: r["skip"] for r in batch["recipients"]}, {"101": None, "404": "no-email", "999": "not-found"})
        result = self.call("send-reminders", {"studentIds": ["101", "404"], "expectedPublicationId": batch["publicationId"]})
        self.assertEqual(result["results"], [{"id": "101", "name": "Marina Costa", "status": "sent"},
                                             {"id": "404", "name": "Email Sem", "status": "skipped", "reason": "no-email"}])

    def test_batch_reads_participation_with_one_query(self):
        self.repo.put("COHORT#BRSA0300", "METADATA", {"code": "BRSA0300", "current": None})
        rows = [(f"Aluno, N{i}", str(1000 + i), f"aluno{i}@example.test") for i in range(100)]
        self.publish(pending_csv(*rows), code="BRSA0300")
        for canvas_id in ("1000", "1050"):
            self.call("participation", {"canvasId": canvas_id, "status": "WITHDRAWN", "expectedStatus": "ACTIVE"}, code="BRSA0300")
        ids = [sid for _, sid, _ in rows]
        calls, list_, get = [], self.repo.list, self.repo.get
        with patch.object(self.repo, "list", lambda pk, prefix="": calls.append(("list", prefix)) or list_(pk, prefix)), \
                patch.object(self.repo, "get", lambda pk, sk: calls.append(("get", sk)) or get(pk, sk)):
            preview = self.call("pending-preview-batch", {"studentIds": ids}, code="BRSA0300")
        self.assertEqual([c for c in calls if c[1].startswith("PARTICIPATION#")], [("list", "PARTICIPATION#")])
        self.assertEqual(sorted(r["id"] for r in preview["recipients"] if r["skip"] == "withdrawn"), ["1000", "1050"])


class AutomaticReminderWorkerTests(unittest.TestCase):
    call = ReminderTests.call
    publish = ReminderTests.publish
    publish_csv = ReminderTests.publish_csv
    preview = ReminderTests.preview
    payload = ReminderTests.payload

    def setUp(self):
        ReminderTests.setUp(self)
        self.at = "2026-10-06T23:00:00Z"
        self.event = {"source": "portal.scheduler", "type": "automatic-reminders",
                      "scheduledFor": self.at, "executionId": "execution-test", "attemptNumber": 1}
        self.events = []
        self.prepare()

    def prepare(self, code="BRSA0267", sender="teacher"):
        from reminders import reminder_settings
        from sync_runs import SyncRun, scheduled_context, evening_sync_key
        pk = "COHORT#" + code
        self.repo.put(pk, "REMINDER_SETTINGS", reminder_settings(sender, True, 1, self.at))
        self.repo.put(pk, "TEACH#" + sender, {"userId": sender, "code": code, "email": sender + "@escoladanuvem.org"})
        self.repo.put("USER#" + sender, "TEACH#" + code, {"code": code})
        key = evening_sync_key(self.event["scheduledFor"])
        previous = self.repo.get(pk, key)
        context = scheduled_context({"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": key[9:],
                                     "executionId": "sync-test", "attemptNumber": (previous or {}).get("attemptNumber", 0) + 1})
        proof = SyncRun(self.repo, self.repo.get(pk, "METADATA"), context, lambda: key[9:])
        proof.stages.update(catalog="succeeded", roster="succeeded")
        proof.complete_unchanged(self.repo.get(pk, "METADATA"))

    def execute(self, **kwargs):
        from automatic_reminders import run
        options = {"enabled": True, "dry_run": False, "clock": lambda: self.at,
                   "sleep": lambda _: None, "emit": self.events.append}
        options.update(kwargs)
        return run(self.repo, self.mailer, self.event, options.pop("cohort_codes", ["BRSA0267"]),
                   "escoladanuvem.org", **options)

    def record(self, code="BRSA0267"):
        from sync_runs import canonical_time
        return self.repo.get("COHORT#" + code, "AUTO_REMINDER#" + canonical_time(self.event["scheduledFor"]))

    def oct14_pilot(self):
        code = "BRSA0257"
        self.repo.put("COHORT#" + code, "METADATA", {"code": code, "current": None})
        draft = self.admin.dispatch("POST", "/cohorts/" + code + "/preview",
                                    {"csv": canvas_csv(kc="", lab=""), "activeIds": ["001 KC (123)", "002 Lab (456)"]})
        self.admin.dispatch("POST", "/cohorts/" + code + "/publish", {"draftId": draft["draft"]["id"]})
        self.event["scheduledFor"] = self.at = "2026-10-14T23:00:00Z"
        self.prepare(code=code)

    def test_oct14_pilot_sends_once_and_deduplicates_retry(self):
        from automatic_reminders import live_day
        self.oct14_pilot()
        self.assertFalse(live_day(self.event["scheduledFor"]))  # manual continua restrito a terça/sexta
        result = self.execute(cohort_codes=["BRSA0257"])[0]
        self.assertEqual((result["status"], result["counts"]["sent"]), ("completed", 1))
        self.assertEqual(self.record("BRSA0257")["syncKey"], "SYNC_RUN#2026-10-14T21:00:00Z")
        self.event.update(executionId="retry", attemptNumber=2)
        self.assertEqual(self.execute(cohort_codes=["BRSA0257"])[0]["reason"], "already-finished")
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "AUTO_REMINDER#"), [])

    def test_oct14_pilot_keeps_window_and_infrastructure_gate_before_reads(self):
        for at, enabled, reason in (("2026-10-14T22:59:59Z", True, "not-due"),
                                    ("2026-10-14T23:30:00Z", True, "window-expired"),
                                    ("2026-10-14T23:00:00Z", False, "infrastructure-disabled")):
            with self.subTest(at=at, enabled=enabled):
                self.setUp()
                self.oct14_pilot()
                self.at = at
                before = copy.deepcopy(self.repo.items)
                with patch.object(self.repo, "get", side_effect=AssertionError("no read")):
                    result = self.execute(cohort_codes=["BRSA0257"], enabled=enabled)[0]
                self.assertEqual(result["reason"], reason)
                self.assertEqual((self.repo.items, self.mailer.sent), (before, []))

    def test_oct14_pilot_requires_natural_same_day_proof_and_matching_publication(self):
        for change, reason in (("missing", "sync-invalid"), ("manual", "sync-invalid"),
                               ("yesterday", "sync-invalid"), ("publication", "publication-changed"),
                               ("settings", "automatic-disabled")):
            with self.subTest(change=change):
                self.setUp()
                self.oct14_pilot()
                pk, key = "COHORT#BRSA0257", "SYNC_RUN#2026-10-14T21:00:00Z"
                proof = self.repo.get(pk, key)
                if change == "missing": self.repo.items.pop((pk, key))
                elif change == "manual": self.repo.put(pk, key, {**proof, "source": "portal.operator"})
                elif change == "yesterday": self.repo.put(pk, key, {**proof, "scheduledFor": "2026-10-13T21:00:00Z"})
                elif change == "publication": self.repo.put(pk, "METADATA", {**self.repo.get(pk, "METADATA"), "current": "changed"})
                else: self.repo.put(pk, "REMINDER_SETTINGS", {**self.repo.get(pk, "REMINDER_SETTINGS"), "automaticEnabled": False})
                before = copy.deepcopy(self.repo.items)
                result = self.execute(cohort_codes=["BRSA0257"])[0]
                self.assertEqual(result["reason"], reason)
                self.assertEqual((self.repo.items, self.mailer.sent), (before, []))

    def test_oct14_pilot_skips_withdrawn_and_existing_manual_send(self):
        from reminders import reminder_key
        for withdrawn in (True, False):
            with self.subTest(withdrawn=withdrawn):
                self.setUp()
                self.oct14_pilot()
                pk = "COHORT#BRSA0257"
                if withdrawn:
                    self.repo.put(pk, "PARTICIPATION#101", {"canvasId": "101", "status": "WITHDRAWN"})
                else:
                    self.repo.put(pk, reminder_key(self.repo.get(pk, "METADATA")["current"], "101"),
                                  {"studentId": "101", "status": "sent", "by": "teacher"})
                result = self.execute(cohort_codes=["BRSA0257"])[0]
                self.assertEqual((result["status"], result["counts"]["sent"]), ("completed", 0))
                self.assertEqual(result["counts"]["skipReasons"], {"withdrawn" if withdrawn else "already-sent": 1})
                self.assertEqual(self.mailer.sent, [])

    def test_tuesday_and_friday_use_the_same_occurrence_key_on_retry(self):
        for scheduled in ("2026-10-06T20:00:00-03:00", "2026-10-09T23:00:00Z"):
            with self.subTest(scheduled=scheduled):
                self.setUp()
                self.event["scheduledFor"] = self.at = scheduled
                self.prepare()
                result = self.execute()[0]
                self.assertEqual((result["status"], result["counts"]["sent"]), ("completed", 1))
                self.event.update(executionId="retry", attemptNumber=2)
                self.assertEqual(self.execute()[0]["reason"], "already-finished")
                self.assertEqual(len(self.mailer.sent), 1)
                self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "AUTO_REMINDER#")), 1)

    def test_invalid_time_or_event_never_sends_or_claims_in_any_mode(self):
        for changes in ({"scheduledFor": sao_paulo(2026, 10, 6, 19, 59)}, {"scheduledFor": sao_paulo(2026, 10, 6, 20, 1)},
                        {"scheduledFor": sao_paulo(2026, 10, 6, 20, 0, 1)}, {"scheduledFor": sao_paulo(2026, 10, 6, 20, 0, 0, 1000)},
                        {"scheduledFor": sao_paulo(2026, 10, 6, 23, 30)}, {"scheduledFor": sao_paulo(2026, 10, 7, 19, 59)},
                        {"scheduledFor": sao_paulo(2026, 10, 7, 20, 1)}, {"scheduledFor": sao_paulo(2026, 10, 7, 18, 0)},
                        {"scheduledFor": "2026-10-06T20:00:00"}, {"source": "manual"},
                        {"attemptNumber": True}, {"sender": "injected@example.test"}):
            for dry_run in (False, True):
                with self.subTest(changes=changes, dry_run=dry_run):
                    previous = self.event
                    self.event = {**previous, **changes}
                    with self.assertRaises(ValueError): self.execute(dry_run=dry_run)
                    self.event = previous
        self.assertEqual(self.mailer.sent, [])
        self.assertIsNone(self.record())

    def diagnostic(self, at=None):
        """Quarta-feira 20h: dia sem envio LIVE, com prova das 18h, settings e remetente válidos."""
        self.event["scheduledFor"] = sao_paulo(2026, 10, 7, 20, 0)
        self.at = at or self.event["scheduledFor"]
        self.prepare()

    def assert_untouched(self, before):
        self.assertEqual(self.repo.items, before)
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "AUTO_REMINDER#"), [])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_live_follows_tuesday_friday_while_dry_run_is_a_daily_diagnostic(self):
        for day in range(5, 12):  # segunda 05/10 a domingo 11/10
            live_day = day in (6, 9)
            with self.subTest(day=day):
                self.setUp()
                self.event["scheduledFor"] = self.at = sao_paulo(2026, 10, day, 20, 0)
                self.prepare()
                before = copy.deepcopy(self.repo.items)
                dry = self.execute(dry_run=True, enabled=False)[0]
                self.assertEqual((dry["status"], dry["reason"], dry["dryRun"]), ("dry-run", None, True))
                self.assertEqual(dry["counts"]["pending"], 1)
                self.assert_untouched(before)
                live = self.execute()[0]
                if live_day:
                    self.assertEqual((live["status"], live["counts"]["sent"]), ("completed", 1))
                else:
                    self.assertEqual((live["status"], live["reason"], live["dryRun"]), ("skipped", "not-due", False))
                    self.assertEqual(live["counts"], empty_counts())
                    self.assert_untouched(before)

    def test_wednesday_live_is_not_due_before_any_read_even_with_both_gates_open(self):
        self.diagnostic()
        before = copy.deepcopy(self.repo.items)
        for enabled in (True, False):
            with self.subTest(enabled=enabled), \
                    patch.object(self.repo, "get", side_effect=AssertionError("no read")) as get, \
                    patch.object(self.repo, "list", side_effect=AssertionError("no read")) as list_, \
                    patch.object(self.mailer, "readiness", side_effect=AssertionError("no SES")) as readiness:
                result = self.execute(enabled=enabled)[0]
                self.assertEqual((result["status"], result["reason"]), ("skipped", "not-due"))
                for operation in (get, list_, readiness): operation.assert_not_called()
        self.assert_untouched(before)

    def test_wednesday_dry_run_reads_and_checks_readiness_with_zero_writes_or_send(self):
        self.diagnostic()
        before = copy.deepcopy(self.repo.items)
        with patch.object(self.repo, "put", side_effect=AssertionError("dry run must not write")) as put, \
                patch.object(self.repo, "transaction", side_effect=AssertionError("dry run must not reserve")) as transaction, \
                patch.object(self.mailer, "send", side_effect=AssertionError("dry run must not send")) as send, \
                patch.object(self.repo, "get", wraps=self.repo.get) as get, \
                patch.object(self.mailer, "readiness", wraps=self.mailer.readiness) as readiness:
            result = self.execute(dry_run=True, enabled=False)[0]
        self.assertEqual((result["status"], result["dryRun"]), ("dry-run", True))
        self.assertEqual(result["publicationId"], self.repo.get("COHORT#BRSA0267", "METADATA")["current"])
        self.assertEqual(result["counts"]["pending"], 1)
        self.assertGreater(get.call_count, 0)
        readiness.assert_called_once()
        for operation in (put, transaction, send): operation.assert_not_called()
        self.assert_untouched(before)

    def test_diagnostic_executes_inside_2000_to_2030_and_refuses_before_or_after(self):
        for at, status, reason in ((sao_paulo(2026, 10, 7, 19, 59), "skipped", "not-due"),
                                   (sao_paulo(2026, 10, 7, 19, 59, 59), "skipped", "not-due"),
                                   (sao_paulo(2026, 10, 7, 20, 0), "dry-run", None),
                                   (sao_paulo(2026, 10, 7, 20, 15), "dry-run", None),
                                   (sao_paulo(2026, 10, 7, 20, 29, 59), "dry-run", None),
                                   (sao_paulo(2026, 10, 7, 20, 29, 59, 999999), "dry-run", None),
                                   (sao_paulo(2026, 10, 7, 20, 30), "skipped", "window-expired"),
                                   (sao_paulo(2026, 10, 7, 20, 31), "skipped", "window-expired")):
            with self.subTest(at=at):
                self.setUp()
                self.diagnostic(at)
                before = copy.deepcopy(self.repo.items)
                result = self.execute(dry_run=True, enabled=False)[0]
                self.assertEqual((result["status"], result["reason"]), (status, reason))
                self.assertEqual(result["scheduledFor"], canonical_time(sao_paulo(2026, 10, 7, 20, 0)))
                self.assert_untouched(before)
        self.setUp()
        self.at = sao_paulo(2026, 10, 6, 20, 15)  # LIVE de terça também aceita execução atrasada na janela
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)

    def test_diagnostic_requires_same_day_1800_proof_and_current_publication(self):
        from sync_runs import evening_sync_key
        self.diagnostic()
        pk = "COHORT#BRSA0267"
        key = evening_sync_key(self.event["scheduledFor"])
        self.assertEqual(key, "SYNC_RUN#" + canonical_time(sao_paulo(2026, 10, 7, 18, 0)))
        today = self.repo.get(pk, key)
        yesterday = self.repo.get(pk, evening_sync_key(sao_paulo(2026, 10, 6, 20, 0)))
        self.assertIsNotNone(yesterday)  # terça anterior válida não serve para quarta
        valid = copy.deepcopy(self.repo.items)
        for name, change, reason in (
                ("J sem SYNC_RUN das 18h de hoje", lambda: self.repo.items.pop((pk, key)), "sync-invalid"),
                ("K prova de ontem na chave de hoje", lambda: self.repo.put(pk, key, yesterday), "sync-invalid"),
                ("K sync das 06h de hoje", lambda: self.repo.put(pk, key, {**today, "scheduledFor": canonical_time(
                    sao_paulo(2026, 10, 7, 6, 0))}), "sync-invalid"),
                ("terminou depois das 20h", lambda: self.repo.put(pk, key, {**today, "finishedAt": canonical_time(
                    sao_paulo(2026, 10, 7, 20, 0, 1))}), "sync-invalid"),
                ("L current diferente da prova", lambda: self.publish(kc="1"), "publication-changed")):
            with self.subTest(name=name):
                self.repo.items = copy.deepcopy(valid)
                change()
                before = copy.deepcopy(self.repo.items)
                result = self.execute(dry_run=True, enabled=False)[0]
                self.assertEqual((result["status"], result["reason"]), ("skipped", reason))
                self.assert_untouched(before)

    def test_restored_diagnostic_at_20h_is_read_only_for_both_cohorts(self):
        from sync_runs import evening_sync_key
        for code in ("BRSA0257", "BRSA0267"):
            with self.subTest(code=code):
                self.setUp()
                if code == "BRSA0257":
                    self.repo.put("COHORT#" + code, "METADATA", {"code": code, "current": None})
                    draft = self.admin.dispatch("POST", "/cohorts/" + code + "/preview",
                                                {"csv": canvas_csv(kc="", lab=""), "activeIds": ["001 KC (123)", "002 Lab (456)"]})
                    self.admin.dispatch("POST", "/cohorts/" + code + "/publish", {"draftId": draft["draft"]["id"]})
                self.event["scheduledFor"] = self.at = sao_paulo(2026, 10, 7, 20, 0)
                self.prepare(code=code)
                before = copy.deepcopy(self.repo.items)
                with patch.object(self.repo, "put", side_effect=AssertionError("no write")), \
                        patch.object(self.repo, "transaction", side_effect=AssertionError("no transaction")), \
                        patch.object(self.mailer, "send", side_effect=AssertionError("no send")):
                    result = self.execute(cohort_codes=[code], dry_run=True, enabled=False)[0]
                self.assertEqual((result["status"], result["counts"]["pending"]), ("dry-run", 1))
                self.assertEqual(evening_sync_key(result["scheduledFor"]), "SYNC_RUN#2026-10-07T21:00:00Z")
                self.assertEqual(self.repo.items, before)
                self.assertEqual(self.mailer.sent, [])

    def test_restoration_removes_both_temporary_windows_in_every_mode(self):
        for code in ("BRSA0257", "BRSA0267"):
            for dry_run in (True, False):
                for at in (sao_paulo(2026, 10, 6, 21, 30), sao_paulo(2026, 10, 7, 0, 30)):
                    with self.subTest(code=code, dry_run=dry_run, at=at):
                        self.at = at
                        with patch.object(self.repo, "get", side_effect=AssertionError("expired before read")), \
                                patch.object(self.mailer, "readiness", side_effect=AssertionError("no SES")):
                            result = self.execute(cohort_codes=[code], dry_run=dry_run)[0]
                        self.assertEqual(result["reason"], "window-expired")

    def test_restored_diagnostic_rechecks_2030_deadline_after_readiness(self):
        self.diagnostic()
        before = copy.deepcopy(self.repo.items)
        original = self.mailer.readiness
        def late_readiness(sender):
            self.at = sao_paulo(2026, 10, 7, 20, 30)
            return original(sender)
        with patch.object(self.mailer, "readiness", side_effect=late_readiness):
            result = self.execute(dry_run=True, enabled=False)[0]
        self.assertEqual((result["status"], result["reason"]), ("skipped", "window-expired"))
        self.assert_untouched(before)

    def test_weekday_and_proof_use_the_sao_paulo_date_not_the_offset_date(self):
        from sync_runs import evening_sync_key
        # Terça 20h em São Paulo, escrita num offset em que já é quarta: LIVE permitido.
        self.event["scheduledFor"] = self.at = "2026-10-07T04:00:00+05:00"
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)
        self.assertEqual(self.record()["syncKey"], evening_sync_key(sao_paulo(2026, 10, 6, 20, 0)))
        # Quarta 20h em São Paulo, escrita num offset em que já é quinta: só diagnóstico.
        self.setUp()
        self.event["scheduledFor"] = self.at = "2026-10-08T01:00:00+02:00"
        self.prepare()
        self.assertEqual(evening_sync_key(self.event["scheduledFor"]),
                         "SYNC_RUN#" + canonical_time(sao_paulo(2026, 10, 7, 18, 0)))
        self.assertEqual(self.execute(dry_run=True)[0]["status"], "dry-run")
        self.assertEqual(self.execute()[0]["reason"], "not-due")
        self.assertEqual(self.mailer.sent, [])

    def test_window_uses_original_slot_not_invocation_time(self):
        for at, reason in (("2026-10-06T22:59:59Z", "not-due"), ("2026-10-06T23:30:00Z", "window-expired"),
                           ("2026-10-09T23:00:00Z", "window-expired")):
            with self.subTest(at=at):
                self.at = at
                self.assertEqual(self.execute()[0]["reason"], reason)
        self.assertIsNone(self.record())
        self.assertEqual(self.mailer.sent, [])
        self.at = "2026-10-06T23:29:59Z"
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)
        self.assertEqual(self.record()["syncKey"], "SYNC_RUN#2026-10-06T21:00:00Z")

    def test_both_gates_and_readiness_are_required_without_sender_fallback(self):
        self.assertEqual(self.execute(enabled=False)[0]["reason"], "infrastructure-disabled")
        pk = "COHORT#BRSA0267"
        valid = copy.deepcopy(self.repo.items)
        for key, value, reason in (
                ((pk, "REMINDER_SETTINGS"), None, "settings-missing"),
                ((pk, "REMINDER_SETTINGS"), {**self.repo.get(pk, "REMINDER_SETTINGS"), "automaticEnabled": False}, "automatic-disabled"),
                ((pk, "TEACH#teacher"), None, "sender-unlinked")):
            with self.subTest(reason=reason):
                self.repo.items = copy.deepcopy(valid)
                if value is None: self.repo.items.pop(key)
                else: self.repo.put(*key, value)
                self.assertEqual(self.execute()[0]["reason"], reason)
        self.repo.items = valid
        self.mailer.ready = False
        self.assertEqual(self.execute()[0]["reason"], "sender-not-ready")
        self.assertIsNone(self.record())
        self.assertEqual(self.mailer.sent, [])

    def test_sync_proof_requires_all_stages_same_day_evening_and_current_metadata(self):
        from sync_runs import evening_sync_key
        # Uma reentrega às 20h05 não pode adotar sync que só terminou às 20h01.
        self.at = "2026-10-06T23:05:00Z"
        key = ("COHORT#BRSA0267", evening_sync_key(self.event["scheduledFor"]))
        original = self.repo.get(*key)
        for changes in (None, {"status": "running"}, {"status": "failed"}, {"publicationId": None},
                        {"scheduledFor": "2026-10-05T21:00:00Z"}, {"scheduledFor": "2026-10-06T09:00:00Z"},
                        {"source": "manual"}, {"metadataVersion": "wrong"}, {"finishedAt": "2026-10-06T23:01:00Z"},
                        {"stages": {"catalog": "failed", "roster": "succeeded", "grades": "published"}}):
            with self.subTest(changes=changes):
                if changes is None: self.repo.items.pop(key, None)
                else: self.repo.put(*key, {**original, **changes})
                self.assertEqual(self.execute()[0]["status"], "skipped")
        self.assertEqual(self.mailer.sent, [])
        self.assertIsNone(self.record())
        self.repo.put(*key, original)
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)

    def test_published_and_unchanged_are_equally_valid_with_proof(self):
        from sync_runs import evening_sync_key
        for state in ("published", "unchanged"):
            with self.subTest(state=state):
                self.setUp()
                key = ("COHORT#BRSA0267", evening_sync_key(self.event["scheduledFor"]))
                proof = self.repo.get(*key)
                proof["stages"]["grades"] = state
                proof["finishedAt"] = self.event["scheduledFor"]  # limite inclusivo: até 20h
                self.repo.put(*key, proof)
                self.assertEqual(self.execute()[0]["counts"]["sent"], 1)

    def test_dry_run_is_read_only_even_with_infrastructure_disabled(self):
        for name in ("terça", "quarta"):
            with self.subTest(day=name):
                self.setUp()
                if name == "quarta":
                    self.diagnostic()
                self.assert_handler_dry_run_is_read_only()

    def assert_handler_dry_run_is_read_only(self):
        import os
        import automatic_reminders as automatic
        from unittest.mock import Mock
        before = copy.deepcopy(self.repo.items)
        with patch.object(self.mailer, "send", side_effect=AssertionError("dry run must not send")):
            result = self.execute(dry_run=True, enabled=False)[0]
        event = {**self.event, "version": 1, "cohortCode": "BRSA0267", "dryRun": True}
        with patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "false",
                                    "AUTOMATIC_REMINDER_COHORTS": '["BRSA0267"]',
                                    "INSTRUCTOR_EMAIL_DOMAIN": "escoladanuvem.org"}), \
                patch.object(automatic, "utc_now", return_value=self.at), \
                patch.object(automatic, "Repository", return_value=self.repo) as repository, \
                patch.object(automatic.reminders, "SESMailer", return_value=self.mailer) as ses_mailer, \
                patch.object(self.repo, "get", wraps=self.repo.get) as read, \
                patch.object(self.mailer, "readiness", wraps=self.mailer.readiness) as readiness, \
                patch.object(self.repo, "put", side_effect=AssertionError("dry run must not write")) as put, \
                patch.object(self.repo, "transaction", side_effect=AssertionError("dry run must not reserve")) as transaction, \
                patch.object(self.mailer, "send", side_effect=AssertionError("dry run must not send")) as send:
            self.assertEqual(automatic.handler(event, Mock()), [result])
        repository.assert_called_once_with()
        ses_mailer.assert_called_once_with()
        self.assertGreater(read.call_count, 0)
        self.assertGreater(readiness.call_count, 0)
        for operation in (put, transaction, send):
            operation.assert_not_called()
        self.assertEqual(result["status"], "dry-run")
        self.assertEqual(result["counts"]["pending"], 1)
        self.assertEqual(self.repo.items, before)

    def test_worker_defaults_to_dry_run_and_never_enables_itself(self):
        from automatic_reminders import run
        before = copy.deepcopy(self.repo.items)
        run(self.repo, self.mailer, self.event, ["BRSA0267"], "escoladanuvem.org", clock=lambda: self.at)
        self.assertEqual(self.repo.items, before)
        self.assertEqual(self.mailer.sent, [])

    def test_manual_before_and_after_automatic_share_dedupe(self):
        self.call("send-reminder", self.payload())
        result = self.execute()[0]
        self.assertEqual(result["counts"]["skipReasons"], {"already-sent": 1})
        self.assertEqual(len(self.mailer.sent), 1)
        self.setUp()
        self.execute()
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(len(self.mailer.sent), 1)

    def test_current_snapshot_skip_reasons_and_withdrawn_race_use_shared_domain(self):
        import reminders
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test"),
                                     ("Missing", "303", "")))
        self.prepare()
        original = self.mailer.send
        def withdraw_next(message):
            self.repo.put("COHORT#BRSA0267", "PARTICIPATION#202", {"canvasId": "202", "status": "WITHDRAWN"})
            return original(message)
        with patch.object(self.mailer, "send", side_effect=withdraw_next), \
             patch.object(reminders, "reserve_reminder", wraps=reminders.reserve_reminder) as reserve:
            result = self.execute()[0]
        self.assertGreaterEqual(reserve.call_count, 1)
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(result["counts"]["skipReasons"], {"withdrawn": 1, "no-email": 1})

    def test_no_pending_means_no_reservation(self):
        self.publish(kc="10", lab="100")
        self.prepare()
        result = self.execute()[0]
        self.assertEqual(result["counts"]["skipReasons"], {"no-pending": 1})
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_two_cohorts_are_independent_and_use_their_own_senders(self):
        first = self.repo.get("COHORT#BRSA0267", "METADATA")
        pub = self.repo.get("COHORT#BRSA0267", "PUB#" + first["current"])
        self.repo.put("COHORT#BRSA0257", "METADATA", {**first, "code": "BRSA0257"})
        self.repo.put("COHORT#BRSA0257", "PUB#" + pub["id"], pub)
        self.prepare("BRSA0257", "other-teacher")
        self.repo.items.pop(("COHORT#BRSA0267", "REMINDER_SETTINGS"))
        results = self.execute(cohort_codes=["BRSA0267", "BRSA0257"])
        self.assertEqual([r["status"] for r in results], ["skipped", "completed"])
        self.assertEqual([m["from"] for m in self.mailer.sent], ["other-teacher@escoladanuvem.org"])
        self.prepare()
        self.execute()
        self.assertEqual(self.mailer.sent[-1]["from"], "teacher@escoladanuvem.org")

    def test_partial_failure_resumes_only_failed_or_not_yet_reserved(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        original = self.mailer.send
        def fail_first(message):
            if message["to"] == "one@example.test": raise SendFailure()
            return original(message)
        with patch.object(self.mailer, "send", side_effect=fail_first):
            first = self.execute()[0]
        self.assertEqual((first["status"], first["counts"]["sent"], first["counts"]["failed"]), ("partial", 1, 1))
        self.assertTrue(first["retryable"])
        result = self.execute()[0]
        self.assertEqual((result["status"], result["counts"]["sent"], result["counts"]["failed"]), ("completed", 2, 0))
        self.assertEqual(len(self.mailer.sent), 2)

    def test_unknown_and_sending_are_never_retried(self):
        from reminders import reminder_key
        pub = self.repo.get("COHORT#BRSA0267", "METADATA")["current"]
        for status in ("unknown", "sending", "sent"):
            with self.subTest(status=status):
                self.repo.put("COHORT#BRSA0267", reminder_key(pub, "101"), {"status": status, "by": "manual"})
                self.assertEqual(self.execute(dry_run=True)[0]["counts"]["skipReasons"], {"already-sent": 1})
        self.assertEqual(self.mailer.sent, [])

    def test_live_claim_blocks_a_second_worker_and_lease_expiry_allows_resume(self):
        original = self.mailer.send
        nested = []
        def concurrent(message):
            nested.extend(self.execute())
            return original(message)
        with patch.object(self.mailer, "send", side_effect=concurrent): self.execute()
        self.assertEqual(nested[0]["reason"], "lease-active")
        self.assertEqual(len(self.mailer.sent), 1)
        self.setUp()
        with patch.object(self.mailer, "send", side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            self.execute()
        self.assertEqual(self.record()["status"], "running")
        self.at = "2026-10-06T23:02:01Z"
        result = self.execute()[0]
        self.assertEqual(result["counts"]["sending"], 1)
        self.assertFalse(result["retryable"])
        self.assertEqual(self.mailer.sent, [])

    def test_crash_after_sent_before_summary_recovers_counts_without_resending(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        original = self.repo.put
        def crash(pk, sk, record, *args, **kwargs):
            result = original(pk, sk, record, *args, **kwargs)
            if sk.startswith("REMINDER#") and record["status"] == "sent": raise KeyboardInterrupt()
            return result
        with patch.object(self.repo, "put", side_effect=crash), self.assertRaises(KeyboardInterrupt): self.execute()
        self.assertEqual(len(self.mailer.sent), 1)
        self.at = "2026-10-06T23:02:01Z"
        result = self.execute()[0]
        self.assertEqual(result["counts"]["sent"], 2)
        self.assertEqual(len(self.mailer.sent), 2)

    def test_timeout_budget_yields_a_partial_occurrence_without_claiming_the_next_recipient(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        result = self.execute(remaining_ms=lambda: 5000 if self.mailer.sent else 60000)[0]
        self.assertEqual(result["reason"], "time-budget")
        self.assertTrue(result["retryable"])
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(self.execute()[0]["counts"]["sent"], 2)

    def test_window_is_rechecked_before_each_reservation(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        original = self.mailer.send
        def expire(message):
            self.at = "2026-10-06T23:30:00Z"
            return original(message)
        with patch.object(self.mailer, "send", side_effect=expire): result = self.execute()[0]
        self.assertEqual(result["reason"], "window-expired")
        self.assertFalse(result["retryable"])
        self.assertEqual(len(self.mailer.sent), 1)

    def test_publication_change_interrupts_and_retry_never_repins(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        original = self.mailer.send
        def change(message):
            result = original(message)
            cohort = self.repo.get("COHORT#BRSA0267", "METADATA")
            self.repo.put("COHORT#BRSA0267", "METADATA", {**cohort, "current": "different"})
            return result
        with patch.object(self.mailer, "send", side_effect=change): result = self.execute()[0]
        self.assertEqual(result["reason"], "publication-changed")
        self.assertEqual(len(self.mailer.sent), 1)
        pinned = self.record()["publicationId"]
        self.assertNotEqual(pinned, "different")
        self.execute()
        self.assertEqual(self.record()["publicationId"], pinned)
        self.assertEqual(len(self.mailer.sent), 1)

    def test_settings_disable_or_link_removal_between_students_stops_sending(self):
        for key in ("REMINDER_SETTINGS", "TEACH#teacher"):
            with self.subTest(key=key):
                self.setUp()
                self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
                self.prepare()
                original = self.mailer.send
                def remove(message):
                    self.repo.items.pop(("COHORT#BRSA0267", key))
                    return original(message)
                with patch.object(self.mailer, "send", side_effect=remove): result = self.execute()[0]
                self.assertEqual(len(self.mailer.sent), 1)
                self.assertFalse(result["retryable"])

    def test_new_slot_same_publication_dedupes_but_new_publication_can_send(self):
        self.execute()
        self.event["scheduledFor"] = self.at = "2026-10-09T23:00:00Z"
        self.prepare()
        self.assertEqual(self.execute()[0]["counts"]["skipReasons"], {"already-sent": 1})
        self.assertEqual(len(self.mailer.sent), 1)
        self.publish(kc="1")
        self.event["scheduledFor"] = self.at = "2026-10-13T23:00:00Z"
        self.prepare()
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)
        self.assertEqual(len(self.mailer.sent), 2)

    def test_logs_summary_and_occurrence_record_contain_no_pii_or_messages(self):
        import json
        result = self.execute()[0]
        text = json.dumps([result, self.record(), self.events])
        for forbidden in ("@", "Marina", "Costa", "subject", "previewHash", "private", '"studentId"', '"senderUserId"'):
            self.assertNotIn(forbidden, text)
        self.assertEqual(result["counts"]["sent"], 1)
        self.assertTrue(self.events)

    def test_expired_lease_cannot_authorize_a_recipient_even_without_a_successor(self):
        import reminders
        original = reminders.message_for
        def slow_message(*args):
            self.at = "2026-10-06T23:02:01Z"
            return original(*args)
        with patch.object(reminders, "message_for", side_effect=slow_message):
            result = self.execute()[0]
        self.assertEqual(result["reason"], "lease-lost")
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_lost_lease_between_renewal_and_reservation_cannot_send_or_finalize(self):
        original = self.repo.transaction
        successor = []
        def race(writes, **kwargs):
            if any(w[1].startswith("REMINDER#") for w in writes):
                record = {**self.record(), "owner": "successor"}
                self.repo.put("COHORT#BRSA0267", "AUTO_REMINDER#" + record["scheduledFor"], record)
                successor.append(record)
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race): result = self.execute()[0]
        self.assertEqual(result["reason"], "lease-lost")
        self.assertEqual(self.record(), successor[0])
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_sender_and_sync_checks_are_atomic_with_each_reservation(self):
        from sync_runs import evening_sync_key
        for key in ("REMINDER_SETTINGS", "TEACH#teacher", evening_sync_key(self.event["scheduledFor"])):
            with self.subTest(key=key):
                self.setUp()
                original = self.repo.transaction
                def race(writes, **kwargs):
                    if any(w[1].startswith("REMINDER#") for w in writes):
                        self.repo.items.pop(("COHORT#BRSA0267", key))
                    return original(writes, **kwargs)
                with patch.object(self.repo, "transaction", side_effect=race): self.execute()
                self.assertEqual(self.mailer.sent, [])
                self.assertEqual(self.repo.list("COHORT#BRSA0267", "REMINDER#"), [])

    def test_readiness_may_not_move_claim_outside_the_window(self):
        original = self.mailer.readiness
        def too_late(sender):
            self.at = "2026-10-06T23:30:00Z"
            return original(sender)
        with patch.object(self.mailer, "readiness", side_effect=too_late): result = self.execute()[0]
        self.assertEqual(result["reason"], "window-expired")
        self.assertIsNone(self.record())
        self.assertEqual(self.mailer.sent, [])

    def test_partial_retry_does_not_adopt_a_new_even_valid_publication(self):
        self.mailer.failure = SendFailure()
        self.execute()
        pinned = self.record()["publicationId"]
        self.publish(kc="1")
        self.prepare()
        self.mailer.failure = None
        self.assertEqual(self.execute()[0]["reason"], "publication-changed")
        self.assertEqual(self.record()["publicationId"], pinned)
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.execute(dry_run=True)[0]["reason"], "publication-changed")

    def test_ses_accepted_but_status_write_failed_never_reopens_sending(self):
        self.publish_csv(pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")))
        self.prepare()
        original = self.repo.put
        def fail_status(pk, sk, value, *args, **kwargs):
            if sk.startswith("REMINDER#") and value["status"] == "sent":
                raise RuntimeError("private@example.test message content")
            return original(pk, sk, value, *args, **kwargs)
        with patch.object(self.repo, "put", side_effect=fail_status): first = self.execute()[0]
        self.assertEqual(first["counts"]["sending"], 1)
        self.assertEqual(first["counts"]["pending"], 1)
        self.assertEqual(len(self.mailer.sent), 1)
        result = self.execute()[0]
        self.assertEqual((result["counts"]["sent"], result["counts"]["sending"]), (1, 1))
        self.assertFalse(result["retryable"])
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertNotIn("private", str(self.events))

    def test_uncertain_ses_failure_is_terminal_for_that_recipient(self):
        self.mailer.failure = SendFailure(uncertain=True)
        first = self.execute()[0]
        self.assertEqual(first["counts"]["unknown"], 1)
        self.assertFalse(first["retryable"])
        self.mailer.failure = None
        self.execute()
        self.assertEqual(self.mailer.sent, [])

    def test_iana_timezone_includes_historical_dst(self):
        self.at = self.event["scheduledFor"] = "2018-11-06T22:00:00Z"
        self.prepare()
        self.assertEqual(self.execute()[0]["counts"]["sent"], 1)
        self.assertEqual(self.record()["syncKey"], "SYNC_RUN#2018-11-06T20:00:00Z")

    def test_failure_in_one_cohort_does_not_stop_another(self):
        first = self.repo.get("COHORT#BRSA0267", "METADATA")
        pub = self.repo.get("COHORT#BRSA0267", "PUB#" + first["current"])
        self.repo.put("COHORT#BRSA0257", "METADATA", {**first, "code": "BRSA0257"})
        self.repo.put("COHORT#BRSA0257", "PUB#" + pub["id"], pub)
        self.prepare("BRSA0257", "other")
        original = self.mailer.send
        def fail_first(message):
            if message["from"] == "teacher@escoladanuvem.org": raise RuntimeError("private@example.test")
            return original(message)
        with patch.object(self.mailer, "send", side_effect=fail_first):
            results = self.execute(cohort_codes=["BRSA0267", "BRSA0257"])
        self.assertEqual([r["status"] for r in results], ["partial", "completed"])
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertNotIn("private", str(self.events))

    def test_failed_final_summary_does_not_recommend_retry_after_deadline(self):
        original_send, original_transaction = self.mailer.send, self.repo.transaction
        def finish_late(message):
            self.at = "2026-10-06T23:30:00Z"
            return original_send(message)
        def fail_summary(writes, **kwargs):
            if any(w[1].startswith("AUTO_REMINDER#") and w[2]["status"] != "running" for w in writes):
                raise RuntimeError("private@example.test")
            return original_transaction(writes, **kwargs)
        with patch.object(self.mailer, "send", side_effect=finish_late), \
             patch.object(self.repo, "transaction", side_effect=fail_summary): result = self.execute()[0]
        self.assertFalse(result["retryable"])
        self.assertEqual(result["counts"]["sent"], 1)
        self.assertEqual(self.record()["status"], "running")
        self.assertNotIn("private", str(self.events))

    def test_cohort_configuration_is_an_explicit_list_not_event_or_string(self):
        for codes in ("TURMA", [], ["BRSA0267", "BRSA0267"], ["private@example.test"]):
            with self.subTest(codes=codes), self.assertRaises(ValueError): self.execute(cohort_codes=codes)
        self.assertEqual(self.mailer.sent, [])
        self.assertIsNone(self.record())


if __name__ == "__main__": unittest.main()

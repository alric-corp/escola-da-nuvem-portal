"""Recuperação LIVE pelo alias protegido; DynamoDB/S3 Moto e SES fictício."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from moto import mock_aws

import test_automatic_claim as claim
import test_aws as fixtures
import automatic_reminders as worker


ALIAS = "arn:aws:lambda:us-east-1:123456789012:function:automatic-reminders:manual-recovery"


@mock_aws
class ManualRecoveryTests(unittest.TestCase):
    call = fixtures.AWSPersistenceTests.call
    auto4_settings = claim.AutomaticReminderClaimTests.auto4_settings
    reminder_write = fixtures.AutomaticReminderWorkerPersistenceTests.reminder_write

    def setUp(self):
        claim.AutomaticReminderClaimTests.setUp(self)
        self.at = "2026-10-10T05:05:00Z"  # sábado, fora da janela automática
        self.manual = {**self.event, "source": "portal.operator", "mode": "manual-recovery",
                       "version": 1, "cohortCode": "BRSA0267", "dryRun": False,
                       "executionId": "recovery-original-friday", "attemptNumber": 2}
        self.config = {
            "MANUAL_RECOVERY_ENABLED": "true", "MANUAL_RECOVERY_COHORT": "BRSA0267",
            "MANUAL_RECOVERY_SCHEDULED_FOR": self.event["scheduledFor"],
            "MANUAL_RECOVERY_NOT_BEFORE": "2026-10-10T05:00:00Z",
            "MANUAL_RECOVERY_EXPIRES_AT": "2026-10-10T05:30:00Z",
            "MANUAL_RECOVERY_ALIAS_ARN": ALIAS,
            "AUTOMATIC_REMINDERS_ENABLED": "false", "AUTOMATIC_REMINDER_COHORTS": '["BRSA0257","BRSA0267"]',
            "INSTRUCTOR_EMAIL_DOMAIN": "example.test",
        }

    def invoke(self, event=None, arn=ALIAS, config=None):
        with patch.dict(os.environ, {**self.config, **(config or {})}), \
                patch.object(worker, "Repository", return_value=self.repo), \
                patch.object(worker.reminders, "SESMailer", return_value=self.mailer), \
                patch.object(worker, "utc_now", lambda: self.at), patch.object(worker.time, "sleep"):
            return worker.handler(self.manual if event is None else event, SimpleNamespace(
                invoked_function_arn=arn, get_remaining_time_in_millis=lambda: 300000))[0]

    def assert_rejected(self, *, event=None, arn=ALIAS, config=None):
        before = self.repo.table.scan()["Items"]
        with patch.dict(os.environ, {**self.config, **(config or {})}), \
                patch.object(worker, "Repository") as repository, \
                patch.object(worker.reminders, "SESMailer") as mailer, \
                patch.object(worker, "utc_now", lambda: self.at):
            with self.assertRaisesRegex(ValueError, "Recuperação manual não autorizada"):
                worker.handler(self.manual if event is None else event, SimpleNamespace(
                    invoked_function_arn=arn, get_remaining_time_in_millis=lambda: 300000))
            repository.assert_not_called()
            mailer.assert_not_called()
        self.assertEqual(self.repo.table.scan()["Items"], before)

    def test_authorized_manual_live_with_auto_gate_false_uses_original_claim(self):
        raw = self.repo.table.get_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})["Item"]["data"]
        self.assertNotEqual(raw, self.repo._encode(self.settings))  # writer AUTO-4 v1 real
        result = self.invoke()
        self.assertEqual((result["status"], result["counts"]["sent"]), ("completed", 2))
        record = self.repo.get(self.pk, self.sk)
        self.assertEqual(record["scheduledFor"], "2026-10-09T23:00:00Z")
        self.assertEqual(record["syncKey"], "SYNC_RUN#2026-10-09T21:00:00Z")
        self.assertEqual(record["attemptNumber"], 2)
        self.assertEqual(len(self.repo.keys(self.pk, "AUTO_REMINDER#")), 1)
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertEqual(self.repo.get(self.pk, "REMINDER_SETTINGS"), self.settings)

    def test_false_or_malformed_manual_flag_rejected_before_clients(self):
        for flag in ["false", "TRUE", "1", ""]:
            with self.subTest(flag=flag):
                self.assert_rejected(config={"MANUAL_RECOVERY_ENABLED": flag})

    def test_expired_manual_authorization_rejected_before_clients(self):
        self.at = "2026-10-10T05:30:00Z"
        self.assert_rejected()

    def test_not_yet_authorized_rejected_before_clients(self):
        self.at = "2026-10-10T04:59:59Z"
        self.assert_rejected()

    def test_unbounded_or_invalid_authorization_rejected(self):
        for field, value in [("MANUAL_RECOVERY_EXPIRES_AT", "2026-10-10T05:30:01Z"),
                             ("MANUAL_RECOVERY_EXPIRES_AT", ""),
                             ("MANUAL_RECOVERY_EXPIRES_AT", "2026-10-10T04:59:00Z"),
                             ("MANUAL_RECOVERY_NOT_BEFORE", "2026-10-10T05:00:00"),
                             ("MANUAL_RECOVERY_ALIAS_ARN", "")]:
            with self.subTest(field=field, value=value):
                self.assert_rejected(config={field: value})

    def test_other_cohort_rejected(self):
        self.assert_rejected(event={**self.manual, "cohortCode": "BRSA0257"})

    def test_other_occurrence_rejected(self):
        self.assert_rejected(event={**self.manual, "scheduledFor": "2026-10-06T23:00:00Z"})

    def test_original_slot_and_live_weekdays_still_required(self):
        for slot in ["2026-10-10T03:45:00Z", "2026-10-10T23:00:00Z", "2026-10-07T23:00:00Z"]:
            with self.subTest(slot=slot):
                self.assert_rejected(event={**self.manual, "scheduledFor": slot},
                                     config={"MANUAL_RECOVERY_SCHEDULED_FOR": slot})

    def test_oct14_automatic_exception_does_not_authorize_manual_recovery(self):
        slot = "2026-10-14T23:00:00Z"
        self.at = "2026-10-14T23:05:00Z"
        self.assert_rejected(event={**self.manual, "cohortCode": "BRSA0257", "scheduledFor": slot}, config={
            "MANUAL_RECOVERY_COHORT": "BRSA0257", "MANUAL_RECOVERY_SCHEDULED_FOR": slot,
            "MANUAL_RECOVERY_NOT_BEFORE": slot, "MANUAL_RECOVERY_EXPIRES_AT": "2026-10-14T23:30:00Z"})

    def test_unqualified_version_and_other_alias_cannot_authorize_payload(self):
        for arn in [None, ALIAS.rsplit(":", 1)[0], ALIAS.rsplit(":", 1)[0] + ":1", ALIAS + "-other"]:
            with self.subTest(arn=arn):
                self.assert_rejected(arn=arn)

    def test_event_cannot_supply_authentication_or_recipients(self):
        for extra in ["sender", "recipient", "studentId", "publicationId", "authorization", "invoked_function_arn"]:
            with self.subTest(extra=extra):
                self.assert_rejected(event={**self.manual, extra: ALIAS})
        for changes in [{"dryRun": True}, {"version": True}, {"attemptNumber": "2"},
                        {"source": "portal.scheduler"}, {"mode": "manual"}]:
            self.assert_rejected(event={**self.manual, **changes})

    def test_scheduler_event_cannot_use_manual_alias(self):
        event = {**self.event, "version": 1, "cohortCode": "BRSA0267", "dryRun": False}
        self.assert_rejected(event=event)

    def test_scheduler_outside_window_stays_blocked_with_manual_enabled(self):
        event = {**self.event, "version": 1, "cohortCode": "BRSA0267", "dryRun": False}
        result = self.invoke(event=event, arn=ALIAS.rsplit(":", 1)[0],
                             config={"AUTOMATIC_REMINDERS_ENABLED": "true"})
        self.assertEqual(result["reason"], "window-expired")
        self.assertIsNone(self.repo.get(self.pk, self.sk))
        self.assertEqual(self.mailer.sent, [])

    def test_publication_changed_still_blocks(self):
        meta = self.repo.get(self.pk, "METADATA")
        self.repo.put(self.pk, "METADATA", {**meta, "current": "changed"})
        self.assertEqual(self.invoke()["reason"], "publication-changed")
        self.assertEqual(self.mailer.sent, [])
        self.assertIsNone(self.repo.get(self.pk, self.sk))

    def test_invalid_sync_still_blocks(self):
        key = "SYNC_RUN#2026-10-09T21:00:00Z"
        proof = self.repo.get(self.pk, key)
        for changes in [{"status": "failed"}, {"source": "portal.operator"},
                        {"finishedAt": "2026-10-09T23:00:01Z"}, {"stages": {}}]:
            self.repo.put(self.pk, key, {**proof, **changes})
            self.assertEqual(self.invoke()["reason"], "sync-invalid")
            self.assertEqual(self.mailer.sent, [])

    def test_settings_changed_atomically_before_claim_still_blocks(self):
        original = self.repo.db.transact_write_items
        def race(**kwargs):
            self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, "version": 2})
            return original(**kwargs)
        with patch.object(self.repo.db, "transact_write_items", side_effect=race):
            self.assertEqual(self.invoke()["reason"], "claim-conflict")
        self.assertIsNone(self.repo.get(self.pk, self.sk))
        self.assertEqual(self.mailer.sent, [])

    def test_disabled_settings_and_unready_sender_still_block(self):
        self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, "automaticEnabled": False})
        self.assertEqual(self.invoke()["reason"], "automatic-disabled")
        self.repo.put(self.pk, "REMINDER_SETTINGS", self.settings)
        with patch.object(self.mailer, "readiness", return_value={"ready": False, "reason": "not-ready"}):
            self.assertEqual(self.invoke()["reason"], "sender-not-ready")
        self.assertEqual(self.mailer.sent, [])
        self.assertIsNone(self.repo.get(self.pk, self.sk))

    def test_withdrawn_before_reservation_still_sends_zero(self):
        original = self.repo.db.transact_write_items
        def race(**kwargs):
            if self.reminder_write(kwargs["TransactItems"]):
                for student in ["101", "202"]:
                    self.repo.put(self.pk, "PARTICIPATION#" + student, {"canvasId": student, "status": "WITHDRAWN"})
            return original(**kwargs)
        with patch.object(self.repo.db, "transact_write_items", side_effect=race):
            result = self.invoke()
        self.assertEqual(result["counts"]["skipReasons"], {"withdrawn": 2})
        self.assertEqual(self.repo.keys(self.pk, "REMINDER#"), [])
        self.assertEqual(self.mailer.sent, [])

    def test_concurrent_manual_claim_only_one_wins(self):
        original = self.repo.db.transact_write_items
        winner = []
        def race(**kwargs):
            if not winner:
                winner.append("running")
                winner[0] = self.invoke()
            return original(**kwargs)
        with patch.object(self.repo.db, "transact_write_items", side_effect=race):
            loser = self.invoke()
        self.assertEqual(winner[0]["counts"]["sent"], 2)
        self.assertEqual(loser["reason"], "claim-conflict")
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertEqual(len(self.repo.keys(self.pk, "AUTO_REMINDER#")), 1)

    def test_retry_after_committed_send_does_not_duplicate(self):
        original = self.repo.put
        def crash(pk, sk, record, *args, **kwargs):
            result = original(pk, sk, record, *args, **kwargs)
            if sk.startswith("REMINDER#") and record["status"] == "sent":
                raise KeyboardInterrupt()
            return result
        with patch.object(self.repo, "put", side_effect=crash), self.assertRaises(KeyboardInterrupt):
            self.invoke()
        self.at = "2026-10-10T05:07:01Z"
        self.assertEqual(self.invoke()["counts"]["sent"], 2)
        self.assertEqual(len({m["to"] for m in self.mailer.sent}), 2)
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertEqual(self.invoke()["reason"], "already-finished")
        self.assertEqual(len(self.mailer.sent), 2)

    def test_expiration_during_execution_stops_new_reservations(self):
        original = self.mailer.send
        def send(*args, **kwargs):
            result = original(*args, **kwargs)
            self.at = "2026-10-10T05:30:00Z"
            return result
        with patch.object(self.mailer, "send", side_effect=send):
            result = self.invoke()
        self.assertEqual(result["reason"], "manual-authorization-expired")
        self.assertFalse(result["retryable"])
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(len(self.repo.keys(self.pk, "REMINDER#")), 1)

    def test_expiration_during_reservation_prevents_send(self):
        original = self.repo.db.transact_write_items
        def reserve(**kwargs):
            result = original(**kwargs)
            if self.reminder_write(kwargs["TransactItems"]):
                self.at = "2026-10-10T05:30:00Z"
            return result
        with patch.object(self.repo.db, "transact_write_items", side_effect=reserve):
            result = self.invoke()
        self.assertEqual(result["reason"], "manual-authorization-expired")
        self.assertEqual(result["counts"]["sending"], 1)
        self.assertEqual(self.mailer.sent, [])


if __name__ == "__main__":
    unittest.main()

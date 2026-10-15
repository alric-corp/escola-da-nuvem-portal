"""LIVE/claim real em DynamoDB Moto; SES e relógio locais, nunca AWS real."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from moto import mock_aws

import test_aws as fixtures
from automatic_reminders import CohortRun, Stop, handler, occurrence_context
from repository import Conflict
from reminders import reminder_settings
from sync_runs import SyncRun, scheduled_context


@mock_aws
class AutomaticReminderClaimTests(unittest.TestCase):
    call = fixtures.AWSPersistenceTests.call
    execute = fixtures.AutomaticReminderWorkerPersistenceTests.execute
    reminder_write = fixtures.AutomaticReminderWorkerPersistenceTests.reminder_write

    def setUp(self):
        fixtures.AutomaticReminderWorkerPersistenceTests.setUp(self)
        self.event["scheduledFor"] = self.at = "2026-10-09T23:00:00Z"
        self.sk = "AUTO_REMINDER#" + self.at
        meta = self.repo.get(self.pk, "METADATA")
        proof = SyncRun(self.repo, meta, scheduled_context({
            **self.event, "type": "canvas-sync", "scheduledFor": "2026-10-09T21:00:00Z",
        }), lambda: "2026-10-09T21:01:00Z")
        proof.stages.update(catalog="succeeded", roster="succeeded")
        proof.complete_unchanged(meta)
        self.settings = self.auto4_settings()

    def auto4_settings(self):
        """Mesmo modelo/serializer/condição do one-shot AUTO-4; identidade fictícia."""
        settings = reminder_settings("teacher", True, 1, "2026-10-08T00:33:41.282499+00:00")
        self.repo.table.delete_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})
        operations = [{"Put": {
            "TableName": self.repo.table.name,
            "Item": {"PK": {"S": self.pk}, "SK": {"S": "REMINDER_SETTINGS"},
                     "data": {"S": json.dumps(settings)}},
            "ConditionExpression": "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }}]
        for pk, sk in [(self.pk, "TEACH#teacher"), ("USER#teacher", "TEACH#BRSA0267")]:
            saved = self.repo.db.get_item(TableName=self.repo.table.name,
                                         Key={"PK": {"S": pk}, "SK": {"S": sk}})["Item"]
            operations.append({"ConditionCheck": {
                "TableName": self.repo.table.name, "Key": {k: saved[k] for k in ["PK", "SK"]},
                "ConditionExpression": "#d = :expected", "ExpressionAttributeNames": {"#d": "data"},
                "ExpressionAttributeValues": {":expected": saved["data"]},
            }})
        self.repo.db.transact_write_items(TransactItems=operations)
        return settings

    def raw_settings(self, raw=None):
        if raw is not None:
            self.repo.table.put_item(Item={"PK": self.pk, "SK": "REMINDER_SETTINGS", "data": raw})
        return self.repo.table.get_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})["Item"]["data"]

    def prepared_claim(self):
        worker = CohortRun(self.repo, self.mailer, occurrence_context(self.event), "BRSA0267", "example.test",
                           enabled=True, dry_run=False, clock=lambda: self.at, sleep=lambda _: None,
                           delay_seconds=0, remaining_ms=lambda: 300000, emit=lambda _: None)
        worker.prepare()
        worker.old = worker.previous()
        return worker

    def assert_claim_conflict(self, worker):
        with self.assertRaises(Stop) as raised:
            worker.acquire()
        self.assertEqual(raised.exception.reason, "claim-conflict")
        self.assertIsNone(self.repo.get(self.pk, self.sk))
        self.assertEqual(self.repo.keys(self.pk, "REMINDER#"), [])
        self.assertEqual(self.mailer.sent, [])

    def test_auto4_writer_v1_live_handler_acquires_claim(self):
        settings = self.auto4_settings()
        raw = self.repo.table.get_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})["Item"]["data"]
        self.assertNotEqual(raw, self.repo._encode(settings))
        self.assertEqual(json.loads(raw), settings)
        event = {**self.event, "version": 1, "cohortCode": "BRSA0267", "dryRun": False,
                 "attemptNumber": "1"}
        with patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "true",
                                     "AUTOMATIC_REMINDER_COHORTS": '["BRSA0267"]',
                                     "INSTRUCTOR_EMAIL_DOMAIN": "example.test"}), \
                patch("automatic_reminders.reminders.SESMailer", return_value=self.mailer), \
                patch("automatic_reminders.utc_now", lambda: self.at), \
                patch("automatic_reminders.time.sleep"):
            result = handler(event, SimpleNamespace(get_remaining_time_in_millis=lambda: 300000))[0]
        self.assertEqual((result["status"], result["reason"]), ("completed", None))
        self.assertEqual(result["counts"]["sent"], 2)
        self.assertEqual(self.repo.get(self.pk, self.sk)["status"], "completed")
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertEqual(self.raw_settings(), raw, "LIVE não migra nem regrava settings")

    def test_brsa0257_regular_friday_handler_claim_withdrawal_and_retry(self):
        import test_reminders
        pk, slot, sync = "COHORT#BRSA0257", "2026-10-16T23:00:00Z", "2026-10-16T21:00:00Z"
        self.repo.put(pk, "METADATA", {"code": "BRSA0257", "current": None})
        draft = self.admin.dispatch("POST", "/cohorts/BRSA0257/preview", {
            "csv": test_reminders.pending_csv(("One", "101", "one@example.test"), ("Two", "202", "two@example.test")),
            "activeIds": ["001 KC (123)", "002 Lab (456)"]})["draft"]
        self.admin.dispatch("POST", "/cohorts/BRSA0257/publish", {"draftId": draft["id"]})
        self.repo.put(pk, "TEACH#teacher", {"userId": "teacher", "code": "BRSA0257", "email": "teacher@example.test"})
        self.repo.put("USER#teacher", "TEACH#BRSA0257", {"code": "BRSA0257"})
        raw = json.dumps(reminder_settings("teacher", True, 1, sync))
        self.repo.table.put_item(Item={"PK": pk, "SK": "REMINDER_SETTINGS", "data": raw})
        self.repo.put(pk, "PARTICIPATION#202", {"canvasId": "202", "status": "WITHDRAWN"})
        event = {**self.event, "scheduledFor": slot, "version": 1, "cohortCode": "BRSA0257", "dryRun": False, "attemptNumber": "1"}
        proof = SyncRun(self.repo, self.repo.get(pk, "METADATA"), scheduled_context({
            **event, "type": "canvas-sync", "scheduledFor": sync, "attemptNumber": 1}), lambda: "2026-10-16T21:01:00Z")
        proof.stages.update(catalog="succeeded", roster="succeeded")
        proof.complete_unchanged(self.repo.get(pk, "METADATA"))
        with patch.dict(os.environ, {"AUTOMATIC_REMINDERS_ENABLED": "true", "AUTOMATIC_REMINDER_COHORTS": '["BRSA0257","BRSA0267"]',
                                     "INSTRUCTOR_EMAIL_DOMAIN": "example.test"}), \
                patch("automatic_reminders.reminders.SESMailer", return_value=self.mailer), \
                patch("automatic_reminders.utc_now", return_value=slot), patch("automatic_reminders.time.sleep"):
            context = SimpleNamespace(get_remaining_time_in_millis=lambda: 300000)
            result = handler(event, context)[0]
            retry = handler({**event, "attemptNumber": "2"}, context)[0]
        self.assertEqual((result["status"], result["counts"]["sent"], result["counts"]["skipReasons"]), ("completed", 1, {"withdrawn": 1}))
        self.assertEqual(retry["reason"], "already-finished")
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(self.repo.get(pk, "AUTO_REMINDER#" + slot)["syncKey"], "SYNC_RUN#" + sync)
        self.assertEqual(self.repo.keys(pk, "REMINDER#"), ["REMINDER#" + draft["id"] + "#101"])
        self.assertEqual(self.repo.table.get_item(Key={"PK": pk, "SK": "REMINDER_SETTINGS"})["Item"]["data"], raw)

    def test_equal_settings_with_different_json_representations_acquire(self):
        variants = [json.dumps(self.settings), self.repo._encode(self.settings),
                    json.dumps(dict(reversed(list(self.settings.items()))), indent=2),
                    json.dumps(self.settings, separators=(",", ":")),
                    json.dumps(self.settings).replace("teacher", r"te\u0061cher")]
        for raw in variants:
            with self.subTest(raw=raw):
                self.raw_settings(raw)
                worker = self.prepared_claim()
                original = self.repo.db.transact_write_items
                with patch.object(self.repo.db, "transact_write_items", wraps=original) as transaction:
                    worker.acquire()
                checks = [a["ConditionCheck"] for a in transaction.call_args.kwargs["TransactItems"] if "ConditionCheck" in a]
                settings = next(c for c in checks if c["Key"]["SK"]["S"] == "REMINDER_SETTINGS")
                self.assertEqual(settings["ConditionExpression"], "#d = :old")
                self.assertEqual(settings["ExpressionAttributeValues"][":old"]["S"], raw)
                self.assertEqual(self.repo.get(self.pk, self.sk)["status"], "running")
                self.assertEqual(self.raw_settings(), raw)
                self.repo.table.delete_item(Key={"PK": self.pk, "SK": self.sk})
        self.assertEqual(self.mailer.sent, [])

    def test_representation_only_change_before_claim_is_not_a_logical_conflict(self):
        worker = self.prepared_claim()
        raw = json.dumps(self.settings, indent=3, sort_keys=True)
        self.raw_settings(raw)
        worker.acquire()
        self.assertEqual(self.repo.get(self.pk, self.sk)["status"], "running")
        self.assertEqual(self.raw_settings(), raw)

    def test_version_change_before_claim_conflicts(self):
        worker = self.prepared_claim()
        self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, "version": 2})
        self.assert_claim_conflict(worker)

    def test_disable_without_version_bump_before_claim_conflicts(self):
        worker = self.prepared_claim()
        self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, "automaticEnabled": False})
        self.assert_claim_conflict(worker)

    def test_sender_change_without_version_bump_before_claim_conflicts(self):
        worker = self.prepared_claim()
        self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, "senderUserId": "other-teacher"})
        self.assert_claim_conflict(worker)

    def test_deleted_settings_before_claim_conflicts(self):
        worker = self.prepared_claim()
        self.repo.table.delete_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})
        self.assert_claim_conflict(worker)

    def test_missing_settings_before_prepare_blocks(self):
        self.repo.table.delete_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})
        result = self.execute()
        self.assertEqual((result["status"], result["reason"]), ("skipped", "settings-missing"))
        self.assertIsNone(self.repo.get(self.pk, self.sk))
        self.assertEqual(self.mailer.sent, [])

    def test_updated_at_and_extra_fields_remain_part_of_snapshot(self):
        for changes in [{"updatedAt": "2026-10-09T22:59:00+00:00"}, {"unexpected": True}]:
            with self.subTest(changes=changes):
                self.raw_settings(json.dumps(self.settings))
                worker = self.prepared_claim()
                self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, **changes})
                self.assert_claim_conflict(worker)

    def test_json_types_cannot_be_coerced_by_python_equality(self):
        for changes in [{"version": True}, {"version": 1.0}, {"version": "1"},
                        {"automaticEnabled": 1}, {"automaticEnabled": "true"}]:
            with self.subTest(changes=changes):
                self.raw_settings(json.dumps(self.settings))
                worker = self.prepared_claim()
                self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, **changes})
                self.assert_claim_conflict(worker)

    def test_publication_change_before_claim_blocks(self):
        worker = self.prepared_claim()
        self.repo.put(self.pk, "METADATA", {**worker.cohort, "current": "different-publication"})
        self.assert_claim_conflict(worker)

    def test_sync_proof_change_before_claim_blocks(self):
        worker = self.prepared_claim()
        self.repo.put(self.pk, worker.sync_key, {**worker.proof, "status": "failed"})
        self.assert_claim_conflict(worker)

    def test_settings_races_after_canonical_comparison_still_fail_atomically(self):
        for changes in [{"version": 2}, {"automaticEnabled": False}, {"senderUserId": "other-teacher"}, None]:
            with self.subTest(changes=changes):
                self.raw_settings(json.dumps(self.settings))
                worker = self.prepared_claim()
                original = self.repo.db.transact_write_items
                def race(**kwargs):
                    if changes is None:
                        self.repo.table.delete_item(Key={"PK": self.pk, "SK": "REMINDER_SETTINGS"})
                    else:
                        self.repo.put(self.pk, "REMINDER_SETTINGS", {**self.settings, **changes})
                    return original(**kwargs)
                with patch.object(self.repo.db, "transact_write_items", side_effect=race) as transaction:
                    self.assert_claim_conflict(worker)
                transaction.assert_called_once()

    def test_withdrawn_before_reservation_never_reserves_or_sends(self):
        original = self.repo.db.transact_write_items
        def withdraw(**kwargs):
            if self.reminder_write(kwargs["TransactItems"]):
                for student in ["101", "202"]:
                    self.repo.put(self.pk, "PARTICIPATION#" + student, {"canvasId": student, "status": "WITHDRAWN"})
            return original(**kwargs)
        with patch.object(self.repo.db, "transact_write_items", side_effect=withdraw):
            result = self.execute()
        self.assertEqual(result["counts"]["skipReasons"], {"withdrawn": 2})
        self.assertEqual(result["counts"]["sent"], 0)
        self.assertEqual(self.repo.keys(self.pk, "REMINDER#"), [])
        self.assertEqual(self.mailer.sent, [])

    def test_two_claims_prepared_concurrently_only_one_wins(self):
        first, second = self.prepared_claim(), self.prepared_claim()
        self.assertIsNone(first.old)
        self.assertIsNone(second.old)
        first.acquire()
        with self.assertRaises(Stop) as raised:
            second.acquire()
        self.assertEqual(raised.exception.reason, "claim-conflict")
        self.assertEqual(self.repo.get(self.pk, self.sk), first.record)
        self.assertEqual(self.repo.keys(self.pk, "AUTO_REMINDER#"), [self.sk])
        self.assertEqual(self.mailer.sent, [])

    def test_retry_after_committed_send_never_duplicates(self):
        original = self.repo.put
        def crash(pk, sk, record, *args, **kwargs):
            result = original(pk, sk, record, *args, **kwargs)
            if sk.startswith("REMINDER#") and record["status"] == "sent":
                raise KeyboardInterrupt()
            return result
        with patch.object(self.repo, "put", side_effect=crash), self.assertRaises(KeyboardInterrupt):
            self.execute()
        self.assertEqual(len(self.mailer.sent), 1)
        self.at = "2026-10-09T23:02:01Z"
        result = self.execute()
        self.assertEqual((result["status"], result["counts"]["sent"]), ("completed", 2))
        self.assertEqual(len(self.mailer.sent), 2)
        self.assertEqual(len({m["to"] for m in self.mailer.sent}), 2)
        self.assertEqual(len(self.repo.keys(self.pk, "REMINDER#")), 2)
        self.assertEqual(self.execute()["reason"], "already-finished")
        self.assertEqual(len(self.mailer.sent), 2)

    def test_legacy_settings_dry_run_remains_zero_write(self):
        before = self.repo.table.scan()["Items"]
        with patch.object(self.repo.db, "transact_write_items", side_effect=AssertionError("no transaction")), \
                patch.object(self.repo.table, "put_item", side_effect=AssertionError("no put")), \
                patch.object(self.repo.table, "delete_item", side_effect=AssertionError("no delete")), \
                patch.object(self.repo.table, "update_item", side_effect=AssertionError("no update")):
            result = self.execute(dry_run=True)
        self.assertEqual(result["status"], "dry-run")
        self.assertEqual(result["counts"]["pending"], 2)
        self.assertEqual(result["counts"]["sent"], 0)
        self.assertEqual(self.mailer.sent, [])
        self.assertEqual(self.repo.table.scan()["Items"], before)


@mock_aws
class RepositorySnapshotConditionTests(unittest.TestCase):
    def setUp(self):
        fixtures.AWSPersistenceTests.setUp(self)
        self.expected = {"version": 1, "enabled": True, "label": "açúcar"}
        self.raw = json.dumps(self.expected, indent=2)
        self.repo.table.put_item(Item={"PK": "TEST", "SK": "legacy", "data": self.raw})

    def test_conditional_update_and_delete_use_exact_read_representation(self):
        self.repo.transaction([("TEST", "legacy", {**self.expected, "version": 2}, self.expected)])
        updated = self.repo.get("TEST", "legacy")
        self.assertEqual(updated["version"], 2)
        self.repo.transaction([("TEST", "legacy", None, updated)])
        self.assertIsNone(self.repo.get("TEST", "legacy"))

    def test_conditional_write_race_is_rejected_after_snapshot_read(self):
        original = self.repo.db.transact_write_items
        def race(**kwargs):
            self.repo.put("TEST", "legacy", {**self.expected, "version": 2})
            return original(**kwargs)
        with patch.object(self.repo.db, "transact_write_items", side_effect=race), self.assertRaises(Conflict):
            self.repo.transaction([("TEST", "legacy", {"version": 3}, self.expected)])
        self.assertEqual(self.repo.get("TEST", "legacy")["version"], 2)

    def test_malformed_missing_or_map_data_fail_closed(self):
        for raw in ["{broken", {"version": 1}, None]:
            with self.subTest(raw=raw):
                item = {"PK": "TEST", "SK": "legacy"}
                if raw is not None:
                    item["data"] = raw
                self.repo.table.put_item(Item=item)
                with self.assertRaises(Conflict):
                    self.repo.transaction([], checks=[("TEST", "legacy", self.expected)])

    def test_snapshot_read_is_consistent_and_keeps_every_field(self):
        with patch.object(self.repo.table, "get_item", wraps=self.repo.table.get_item) as read:
            self.repo.transaction([], checks=[("TEST", "legacy", self.expected)])
        read.assert_called_once_with(Key={"PK": "TEST", "SK": "legacy"}, ConsistentRead=True)
        with self.assertRaises(Conflict):
            self.repo.transaction([], checks=[("TEST", "legacy", {"version": 1})])


if __name__ == "__main__":
    unittest.main()

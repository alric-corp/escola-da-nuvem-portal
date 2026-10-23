"""Canonical authorization + bounded read projections, using real Repository/Moto."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import derived_access as access
from portal import Portal
from repository import Conflict, Repository
from test_portal import class_csv


@mock_aws
class DerivedAccessTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "TABLE_NAME": "derived-test",
                                      "IMPORTS_BUCKET": "derived-imports-test"})
        env.start()
        self.addCleanup(env.stop)
        boto3.client("dynamodb").create_table(TableName="derived-test",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST")
        boto3.client("s3").create_bucket(Bucket="derived-imports-test")
        self.repo = Repository()
        self.admin_user = {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]}
        self.student_user = {"sub": "student", "email": "aluno@example.test", "groups": []}
        self.admin = Portal(self.repo, self.admin_user)

    def create(self, code="AAA"):
        return self.admin.dispatch("POST", "/cohorts", {"code": code, "name": code})

    def publish(self, code="AAA", csv=None):
        portal = Portal(self.repo, self.admin_user)
        draft = portal.dispatch("POST", f"/cohorts/{code}/preview", {"csv": csv or class_csv()})["draft"]
        return portal.dispatch("POST", f"/cohorts/{code}/publish", {"draftId": draft["id"], "acknowledgeRemoved": True})["publication"]

    def cohorts(self, user=None):
        return Portal(self.repo, user or self.student_user).dispatch("GET", "/cohorts", {})

    def test_cutover_preserves_first_access_additional_course_and_canonical_owner(self):
        self.create("AAA")
        self.create("BBB")
        self.publish("AAA")
        self.publish("BBB")
        self.repo.put("USER#student", "STUDY#AAA", {"code": "AAA", "canvasId": "101"})
        self.repo.put("COHORT#BBB", "OWNER#101", {"userId": "other"})
        expected = self.cohorts()
        access.migrate(self.repo, apply=True, cutover=True)
        with patch.object(self.repo.table, "scan", side_effect=AssertionError("normal read must not scan")):
            self.assertEqual(self.cohorts(), expected)
            self.repo.table.delete_item(Key={"PK": "COHORT#BBB", "SK": "OWNER#101"})
            self.assertEqual([c["code"] for c in self.cohorts()["cohorts"]], ["AAA", "BBB"])
            # First access is still only a discovery, never an account binding.
            self.assertIsNone(self.repo.get("USER#student", "STUDY#BBB"))
            self.assertEqual([c["code"] for c in self.cohorts(self.admin_user)["cohorts"]], ["AAA", "BBB"])

    def test_new_course_empty_course_mixed_roles_revocation_and_old_binding(self):
        self.create("AAA")
        self.publish()
        access.migrate(self.repo, apply=True, cutover=True)
        self.repo.put("USER#student", "STUDY#AAA", {"code": "AAA", "canvasId": "101"})
        self.repo.put("USER#student", "STUDY#REMOVED", {"code": "REMOVED", "canvasId": "101"})
        self.create("BBB")
        self.publish("BBB")
        self.create("CCC")
        self.repo.put("USER#student", "TEACH#CCC", {"code": "CCC"})
        with patch.object(self.repo.table, "scan", side_effect=AssertionError("unexpected scan")):
            rows = self.cohorts()["cohorts"]
            self.assertEqual([(c["code"], c["canTeach"]) for c in rows], [("AAA", False), ("BBB", False), ("CCC", True)])
            self.repo.transaction([("USER#student", "TEACH#CCC", None, {"code": "CCC"})])
            self.assertEqual([c["code"] for c in self.cohorts()["cohorts"]], ["AAA", "BBB"])

    def test_removed_or_corrected_email_and_forged_candidate_never_grant_access(self):
        self.create()
        first = self.publish()
        access.migrate(self.repo, apply=True, cutover=True)
        self.publish(csv=class_csv().replace("aluno@example.test", "corrected@example.test"))
        self.assertEqual(self.cohorts(), {"cohorts": []})
        # Index cannot bypass a source/OWNER check, even if an entry is forged.
        access.prepare_discovery(self.repo, "AAA", {"students": [{"email": "attacker@example.test"}]})
        self.assertEqual(self.cohorts({**self.student_user, "email": "attacker@example.test"}), {"cohorts": []})
        current = self.repo.get("COHORT#AAA", "METADATA")["current"]
        Portal(self.repo, self.admin_user).dispatch("POST", "/cohorts/AAA/restore",
                                                  {"publicationId": first["id"], "expectedCurrent": current})
        self.assertEqual([c["code"] for c in self.cohorts()["cohorts"]], ["AAA"])

    def test_partial_candidate_preparation_cannot_activate_publication(self):
        self.create()
        first = self.publish(csv=class_csv(extra_ids=("102",)))
        portal = Portal(self.repo, self.admin_user)
        preview = portal.dispatch("POST", "/cohorts/AAA/preview", {"csv": class_csv(extra_ids=("102",), kc="9")})
        original = self.repo.put
        calls = []
        def fail_second(pk, sk, data, **kwargs):
            if pk.startswith("DISCOVERY_EMAIL#"):
                calls.append((pk, sk))
                if len(calls) == 2:
                    raise RuntimeError("injected connection failure")
            return original(pk, sk, data, **kwargs)
        with patch.object(self.repo, "put", side_effect=fail_second):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                portal.dispatch("POST", "/cohorts/AAA/publish", {"draftId": preview["draft"]["id"]})
        self.assertEqual(self.repo.get("COHORT#AAA", "METADATA")["current"], first["id"])
        self.assertIsNone(self.repo.get("COHORT#AAA", "PUB#" + preview["draft"]["id"]))
        self.assertEqual(len(calls), 2)

    def test_dry_run_idempotent_resume_and_concurrent_source_change(self):
        self.create()
        self.publish()
        before = list(self.repo.table.scan()["Items"])
        self.assertTrue(access.migrate(self.repo)["dryRun"])
        self.assertEqual(self.repo.table.scan()["Items"], before)
        original = self.repo.transaction
        def race(writes, **kwargs):
            if any(sk == "DISCOVERY_READY" for _, sk, *_ in writes):
                current = self.repo.get("COHORT#AAA", "METADATA")
                self.repo.put("COHORT#AAA", "METADATA", {**current, "name": "concurrent"})
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race):
            with self.assertRaises(Conflict):
                access.migrate(self.repo, apply=True, cutover=True)
        self.assertFalse(access.discovery_ready(self.repo))
        access.migrate(self.repo, apply=True, cutover=True)
        first = sorted(self.repo.table.scan()["Items"], key=lambda i: (i["PK"], i["SK"]))
        access.migrate(self.repo, apply=True, cutover=True)
        self.assertEqual(sorted(self.repo.table.scan()["Items"], key=lambda i: (i["PK"], i["SK"])), first)

    def test_new_cohort_racing_global_cutover_refuses_and_resume_includes_it(self):
        self.create()
        original = self.repo.transaction
        raced = False
        def race(writes, **kwargs):
            nonlocal raced
            if not raced and any(pk == access.STATE and sk == "DISCOVERY" for pk, sk, *_ in writes):
                raced = True
                self.create("BBB")
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race):
            with self.assertRaises(Conflict):
                access.migrate(self.repo, apply=True, cutover=True)
        self.assertFalse(access.discovery_ready(self.repo))
        access.migrate(self.repo, apply=True, cutover=True)
        with patch.object(self.repo.table, "scan", side_effect=AssertionError("scan")):
            self.assertEqual([c["code"] for c in self.cohorts(self.admin_user)["cohorts"]], ["AAA", "BBB"])

    def test_history_zero_one_twelve_many_ties_and_old_current(self):
        self.create()
        pk = "COHORT#AAA"
        for count in (0, 1, 12, 75):
            for index in range(count):
                row = {"id": f"p{index:03}", "publishedAt": f"2026-10-{1 + index // 3:02}T12:00:00+00:00"}
                self.repo.put(pk, "PUB#" + row["id"], row)
            access.migrate(self.repo, apply=True, discovery=False)
            expected = sorted(self.repo.list(pk, "PUB#"), key=lambda p: p["publishedAt"], reverse=True)[:12]
            with patch.object(self.repo, "list", side_effect=AssertionError("bounded reader cannot list all PUB")):
                self.assertEqual(access.recent_publications(self.repo, pk), expected)
        # Preserves the original ID-ascending tie order, including prefix IDs.
        for ident in ("a", "aa", "b"):
            self.repo.put(pk, "PUB#" + ident, {"id": ident, "publishedAt": "2026-11-01T00:00:00Z"})
        access.migrate(self.repo, apply=True, discovery=False)
        self.assertEqual([p["id"] for p in access.recent_publications(self.repo, pk)][:3], ["a", "aa", "b"])

    def test_partial_backfill_keeps_legacy_reader_until_complete_and_resumes(self):
        # Deliberately legacy metadata/PUB writer, representing pre-deployment data.
        self.repo.put("COHORT#AAA", "METADATA", {"code": "AAA", "current": None})
        for index in range(20):
            self.repo.put("COHORT#AAA", f"PUB#{index:02}", {"id": f"{index:02}", "publishedAt": f"2026-10-{index + 1:02}T00:00:00Z"})
        original, calls = self.repo.transaction, []
        def interrupted(writes, **kwargs):
            calls.append(writes)
            if len(calls) == 4:
                raise RuntimeError("interrupted migration")
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=interrupted):
            with self.assertRaises(RuntimeError):
                access.migrate(self.repo, apply=True)
        self.assertIsNone(self.repo.get("COHORT#AAA", "HISTORY_READY"))
        expected = access.recent_publications(self.repo, "COHORT#AAA")
        access.migrate(self.repo, apply=True)
        self.assertEqual(access.recent_publications(self.repo, "COHORT#AAA"), expected)
        # Defensive corruption, not a legitimate writer race: a reference whose
        # canonical PUB disappeared must fail instead of fabricating history.
        self.repo.table.delete_item(Key={"PK": "COHORT#AAA", "SK": "PUB#" + expected[0]["id"]})
        with self.assertRaises(Conflict):
            access.recent_publications(self.repo, "COHORT#AAA")

    def test_bounded_query_continues_empty_pages_and_small_byte_pages(self):
        self.create()
        pk = "COHORT#AAA"
        for index in range(15):
            row = {"id": str(index), "publishedAt": f"2026-10-{index + 1:02}T00:00:00Z"}
            self.repo.put(pk, "PUB#" + row["id"], row)
        access.migrate(self.repo, apply=True, discovery=False)
        original = self.repo.table.query
        seen = []
        def pages(**kwargs):
            if not seen:
                seen.append("empty")
                return {"Items": [], "LastEvaluatedKey": {"PK": pk, "SK": "RECENT#z"}}
            seen.append(kwargs.get("ExclusiveStartKey"))
            kwargs["Limit"] = min(kwargs["Limit"], 3)
            return original(**kwargs)
        with patch.object(self.repo.table, "query", side_effect=pages):
            self.assertEqual(len(access.recent_publications(self.repo, pk)), 12)
        self.assertGreater(len(seen), 3)
        self.assertEqual(seen[1], {"PK": pk, "SK": "RECENT#z"})

    def test_publish_after_cutover_updates_history_and_restore_keeps_original_time(self):
        self.create()
        first = self.publish()
        access.migrate(self.repo, apply=True, cutover=True)
        second = self.publish(csv=class_csv(kc="9"))
        self.assertEqual(self.repo.get("COHORT#AAA", "HISTORY_READY")["count"], 2)
        Portal(self.repo, self.admin_user).dispatch("POST", "/cohorts/AAA/restore",
                                                  {"publicationId": first["id"], "expectedCurrent": second["id"]})
        self.assertEqual(access.recent_publications(self.repo, "COHORT#AAA"), [second, first])
        self.assertEqual(self.repo.get("COHORT#AAA", "PUB#" + first["id"])["publishedAt"], first["publishedAt"])

    def test_student_history_preserves_old_current_missing_student_and_legacy_summary(self):
        self.create()
        publications = [self.publish(csv=class_csv(kc=str(1 + i % 10))) for i in range(16)]
        pk, current = "COHORT#AAA", publications[0]
        # Original compact history can omit this student; selection must still
        # happen over publications, not by filling the page with older students.
        self.repo.snapshot(publications[-2]["history"], {})
        # A legacy publication needs the existing full-snapshot fallback.
        old = {k: v for k, v in publications[-3].items() if k != "history"}
        self.repo.put(pk, "PUB#" + old["id"], old)
        portal = Portal(self.repo, self.student_user)
        snapshot = portal.snapshot(current)
        marker = self.repo.get(pk, "HISTORY_READY")
        self.repo.transaction([(pk, "HISTORY_READY", {"ready": False}, marker)])
        expected = portal.student_history(pk, current, snapshot, "101", {"kc": 70, "lab": 95})
        access.migrate(self.repo, apply=True, discovery=False)
        observed = Portal(self.repo, self.student_user).student_history(pk, current, snapshot, "101", {"kc": 70, "lab": 95})
        self.assertEqual(observed, expected)
        self.assertTrue(observed[-1]["current"])
        self.assertEqual(len(observed), 11)

    def test_candidate_and_directory_queries_are_fully_paginated(self):
        for code in ("AAA", "BBB", "CCC", "DDD"):
            self.create(code)
            self.publish(code)
        access.migrate(self.repo, apply=True, cutover=True)
        original = self.repo.table.query
        calls = []
        def tiny_pages(**kwargs):
            kwargs["Limit"] = 1
            calls.append(kwargs)
            return original(**kwargs)
        with patch.object(self.repo.table, "query", side_effect=tiny_pages), patch.object(self.repo.table, "scan", side_effect=AssertionError("scan")):
            self.assertEqual([c["code"] for c in self.cohorts()["cohorts"]], ["AAA", "BBB", "CCC", "DDD"])
            self.assertEqual([c["code"] for c in self.cohorts(self.admin_user)["cohorts"]], ["AAA", "BBB", "CCC", "DDD"])
        self.assertGreater(sum("ExclusiveStartKey" in c for c in calls), 4)

    def test_large_class_never_depends_on_single_large_transaction(self):
        self.create()
        with patch.object(self.repo, "transaction", wraps=self.repo.transaction) as transactions:
            publication = self.publish(csv=class_csv(extra_ids=tuple(str(i) for i in range(102, 502))))
        self.assertEqual(self.repo.get("COHORT#AAA", "METADATA")["current"], publication["id"])
        self.assertTrue(all(len(c.args[0]) < 10 for c in transactions.call_args_list))
        self.assertEqual(len(self.repo.list("DISCOVERY_EMAIL#" + access.email_hash("colega501@example.test"))), 1)

    def test_publish_concurrent_with_history_backfill_cannot_certify_stale_count(self):
        self.create()
        first = self.publish()
        cohort = self.repo.get("COHORT#AAA", "METADATA")
        original = self.repo.transaction
        raced = False
        def race(writes, **kwargs):
            nonlocal raced
            if not raced and any(sk == "DISCOVERY_READY" for _, sk, *_ in writes):
                raced = True
                self.publish(csv=class_csv(kc="9"))
            return original(writes, **kwargs)
        with patch.object(self.repo, "transaction", side_effect=race):
            with self.assertRaises(Conflict):
                access.migrate_cohort(self.repo, cohort, apply=True)
        access.migrate(self.repo, apply=True)
        self.assertEqual(len(access.recent_publications(self.repo, "COHORT#AAA")), 2)
        self.assertIn(first["id"], [p["id"] for p in access.recent_publications(self.repo, "COHORT#AAA")])

    def test_recovery_disables_readiness_without_deleting_any_source_or_projection(self):
        self.create()
        publication = self.publish()
        access.migrate(self.repo, apply=True, cutover=True)
        before = {i["SK"] for i in self.repo.table.scan()["Items"]}
        access.disable(self.repo)
        self.assertTrue(access.discovery_ready(self.repo))
        access.disable(self.repo, apply=True)
        self.assertFalse(access.discovery_ready(self.repo))
        self.assertFalse(self.repo.get("COHORT#AAA", "HISTORY_READY")["ready"])
        self.assertEqual(self.repo.get("COHORT#AAA", "PUB#" + publication["id"]), publication)
        self.assertEqual({i["SK"] for i in self.repo.table.scan()["Items"]}, before)
        access.migrate(self.repo, apply=True, cutover=True)
        self.assertTrue(access.discovery_ready(self.repo))

    def test_projection_cutovers_are_independent_and_partial_cutover_is_refused_before_writes(self):
        self.create()
        self.publish()
        access.migrate(self.repo, apply=True, discovery=False)
        self.assertFalse(access.discovery_ready(self.repo))
        self.assertTrue(self.repo.get("COHORT#AAA", "HISTORY_READY")["ready"])
        before = sorted(self.repo.table.scan()["Items"], key=lambda i: (i["PK"], i["SK"]))
        with self.assertRaises(ValueError):
            access.migrate(self.repo, apply=True, cutover=True, codes=["AAA"])
        self.assertEqual(sorted(self.repo.table.scan()["Items"], key=lambda i: (i["PK"], i["SK"])), before)
        access.migrate(self.repo, apply=True, history=False, cutover=True)
        self.assertTrue(access.discovery_ready(self.repo))
        access.disable(self.repo, apply=True, discovery=False)
        self.assertTrue(access.discovery_ready(self.repo))
        self.assertFalse(self.repo.get("COHORT#AAA", "HISTORY_READY")["ready"])

    def test_restore_candidate_failure_keeps_current_publication(self):
        self.create()
        first = self.publish()
        second = self.publish(csv=class_csv(kc="9"))
        access.migrate(self.repo, apply=True, cutover=True)
        current = self.repo.get("COHORT#AAA", "METADATA")
        original = self.repo.put
        def fail_candidate(pk, sk, data, **kwargs):
            if pk.startswith("DISCOVERY_EMAIL#"):
                raise RuntimeError("injected restore candidate failure")
            return original(pk, sk, data, **kwargs)
        with patch.object(self.repo, "put", side_effect=fail_candidate):
            with self.assertRaisesRegex(RuntimeError, "restore candidate"):
                Portal(self.repo, self.admin_user).dispatch("POST", "/cohorts/AAA/restore",
                    {"publicationId": first["id"], "expectedCurrent": second["id"]})
        self.assertEqual(self.repo.get("COHORT#AAA", "METADATA"), current)
        self.assertEqual(self.repo.get("COHORT#AAA", "PUB#" + first["id"]), first)
        self.assertEqual(self.repo.get("COHORT#AAA", "PUB#" + second["id"]), second)

    def test_corrected_email_requires_owner_unlink_before_new_identity_discovers(self):
        self.create()
        self.publish()
        Portal(self.repo, self.student_user).dispatch("GET", "/cohorts/AAA/report", {})
        access.migrate(self.repo, apply=True, cutover=True)
        self.publish(csv=class_csv().replace("aluno@example.test", "corrected@example.test"))
        new_user = {"sub": "new-student", "email": "corrected@example.test", "groups": []}
        self.assertEqual(self.cohorts(new_user), {"cohorts": []})
        Portal(self.repo, self.admin_user).dispatch("POST", "/cohorts/AAA/unlink-student", {"canvasId": "101"})
        self.assertEqual([c["code"] for c in self.cohorts(new_user)["cohorts"]], ["AAA"])
        Portal(self.repo, new_user).dispatch("GET", "/cohorts/AAA/report", {})
        self.assertEqual(self.repo.get("COHORT#AAA", "OWNER#101")["userId"], "new-student")
        self.assertIsNone(self.repo.get("USER#student", "STUDY#AAA"))

    def test_terraform_seed_without_data_is_reconciled_without_rewriting_canonical_item(self):
        seed = {"PK": "COHORT#SEED", "SK": "METADATA", "cohortCode": "SEED", "entityType": "cohort", "status": "active"}
        self.repo.table.put_item(Item=seed)
        access.migrate(self.repo, apply=True, cutover=True)
        self.assertEqual(self.repo.table.get_item(Key={"PK": "COHORT#SEED", "SK": "METADATA"})["Item"], seed)
        with patch.object(self.repo.table, "scan", side_effect=AssertionError("scan")):
            rows = self.cohorts(self.admin_user)["cohorts"]
            self.assertEqual(rows, [{"code": "SEED", "name": "SEED", "current": None, "canTeach": True}])

    def test_publication_between_marker_read_and_query_accepts_new_canonical_reference(self):
        self.create()
        first = self.publish()
        portal = Portal(self.repo, self.student_user)
        snapshot = portal.snapshot(first)
        original = self.repo.recent_references
        published = []
        def publish_before_query(pk, limit):
            self.assertEqual(limit, 12)
            published.append(self.publish(csv=class_csv(kc="9")))
            return original(pk, limit)
        with patch.object(self.repo, "recent_references", side_effect=publish_before_query), \
                patch.object(self.repo.table, "query", wraps=self.repo.table.query) as queries:
            history = portal.student_history("COHORT#AAA", first, snapshot, "101", {"kc": 70, "lab": 95})
        self.assertEqual(len(history), 2)
        self.assertEqual([row["current"] for row in history], [False, True])
        self.assertEqual(history[0]["publishedAt"], published[0]["publishedAt"])
        bounded = [call.kwargs for call in queries.call_args_list if call.kwargs.get("ScanIndexForward") is False]
        self.assertEqual(len(bounded), 1)
        self.assertTrue(all(call["Limit"] <= 12 for call in bounded))
        self.assertEqual(self.repo.get("COHORT#AAA", "HISTORY_READY")["count"], 2)

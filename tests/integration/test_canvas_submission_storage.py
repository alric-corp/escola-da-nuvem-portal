"""DynamoDB/Moto do registro auxiliar de entregas, sem chamadas externas."""
import json
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from canvas_submissions import MAX_ITEM_BYTES, read_submissions, save_submissions
from repository import Conflict, Repository
from test_canvas_submissions import OLD, NOW, NEW, PK, assignment, candidate, submission


@mock_aws
class SubmissionAWSPersistenceTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "TABLE_NAME": "submissions-cas-test",
                                      "IMPORTS_BUCKET": "submissions-imports-test"})
        env.start()
        self.addCleanup(env.stop)
        boto3.client("dynamodb", region_name="us-east-1").create_table(
            TableName="submissions-cas-test", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k in ("PK", "SK")])
        self.repo = Repository()

    def test_roundtrip_retention_null_and_course_isolation_with_real_serialization(self):
        save_submissions(self.repo, "4436", candidate(), OLD)
        save_submissions(self.repo, "4436", candidate({}), NOW)
        result = read_submissions(self.repo, "4436", "100")
        self.assertEqual((result["items"]["11"]["state"], result["items"]["11"]["observedAt"]), ("submitted", OLD))
        self.assertEqual(result["items"]["11"]["provenance"]["status"], "retained")
        save_submissions(self.repo, "4436", candidate(submission(workflow_state=None)), NEW)
        self.assertEqual(read_submissions(self.repo, "4436", "100")["items"]["11"]["state"], "unknown")
        self.assertIsNone(read_submissions(self.repo, "9999", "100"))
        self.assertIsNone(read_submissions(self.repo, "4436", "101"))

    def test_row_and_course_marker_are_both_checked_before_older_writer_can_commit(self):
        save_submissions(self.repo, "4436", candidate(), OLD)
        original = self.repo.transaction
        called = False
        def competing(writes, *args, **kw):
            nonlocal called
            if not called and writes[0][1].startswith("STUDENT#"):
                called = True
                save_submissions(self.repo, "4436", candidate(submission(workflow_state="pending_review")), NEW)
            return original(writes, *args, **kw)
        with patch.object(self.repo, "transaction", side_effect=competing), self.assertRaises(Conflict):
            save_submissions(self.repo, "4436", candidate(), NOW)
        row = read_submissions(self.repo, "4436", "100")["items"]["11"]
        self.assertEqual((row["state"], row["observedAt"]), ("pending_review", NEW))

    def test_failed_new_collection_does_not_rewrite_student_observation_or_academic_items(self):
        academic = {"id": "historical", "snapshotKey": "immutable"}
        self.repo.put("COHORT#FICTION", "PUB#historical", academic)
        save_submissions(self.repo, "4436", candidate(), OLD)
        before = self.repo.get(PK, "STUDENT#100")
        save_submissions(self.repo, "4436", None, NOW, failed=True)
        self.assertEqual(self.repo.get(PK, "STUDENT#100"), before)
        self.assertEqual(self.repo.get("COHORT#FICTION", "PUB#historical"), academic)
        self.assertEqual(read_submissions(self.repo, "4436", "100")["status"], "failed")

    def test_two_hundred_activities_fit_one_student_item_not_an_entire_class_matrix(self):
        tasks = {str(i): assignment() for i in range(1, 201)}
        users = {str(i): {str(a): submission() for a in range(1, 201)} for i in range(100, 103)}
        save_submissions(self.repo, "4436", candidate(assignments=tasks, students=users), NOW)
        encoded = self.repo.table.get_item(Key={"PK": PK, "SK": "STUDENT#100"}, ConsistentRead=True)["Item"]["data"]
        self.assertLess(len(encoded.encode("utf-8")), MAX_ITEM_BYTES)
        self.assertEqual(len(json.loads(encoded)["items"]), 200)
        self.assertEqual(len(read_submissions(self.repo, "4436", "100", ["1", "200"])["items"]), 2)


if __name__ == "__main__":
    unittest.main()

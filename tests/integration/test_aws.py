"""Executa o Repository real com boto3 e serviços Moto, sem recursos AWS reais."""
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from portal import Portal, class_report
from repository import Conflict, Repository
from test_grades import canvas_csv


@mock_aws
class AWSPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"AWS_DEFAULT_REGION":"us-east-1", "TABLE_NAME":"portal-test", "IMPORTS_BUCKET":"portal-imports-test"})
        self.env.start()
        self.addCleanup(self.env.stop)
        db = boto3.client("dynamodb", region_name="us-east-1")
        db.create_table(TableName="portal-test", KeySchema=[{"AttributeName":"PK","KeyType":"HASH"},{"AttributeName":"SK","KeyType":"RANGE"}],
                        AttributeDefinitions=[{"AttributeName":"PK","AttributeType":"S"},{"AttributeName":"SK","AttributeType":"S"}], BillingMode="PAY_PER_REQUEST")
        db.put_item(TableName="portal-test", Item={"PK":{"S":"COHORT#BRSA0267"}, "SK":{"S":"METADATA"}, "cohortCode":{"S":"BRSA0267"}})
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="portal-imports-test")
        self.repo = Repository()
        self.admin = Portal(self.repo, {"sub":"admin", "email":"admin@example.test", "groups":["admin"]})

    def call(self, op, body):
        return self.admin.dispatch("POST", "/cohorts/BRSA0267/"+op, body)

    def test_seed_preview_atomic_publish_student_binding_and_restore(self):
        first = self.call("preview", {"csv":canvas_csv()})["draft"]
        self.assertTrue(self.repo.get("COHORT#BRSA0267", "METADATA")["_seed"])
        self.call("publish", {"draftId":first["id"]})
        student = Portal(self.repo, {"sub":"s1", "email":"aluno@example.test", "groups":[]})
        report = student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(report["student"]["kc"], 70)
        self.assertEqual(self.repo.get("USER#s1", "STUDY#BRSA0267")["canvasId"], "101")
        second = self.call("preview", {"csv":canvas_csv(kc="9")})["draft"]
        self.call("publish", {"draftId":second["id"]})
        self.call("restore", {"publicationId":first["id"], "expectedCurrent":second["id"]})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], first["id"])
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "PUB#")), 2)

    def test_missing_email_roundtrips_through_real_repository(self):
        draft = self.call("preview", {"csv": canvas_csv(email="")})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        report = Portal(Repository(), self.admin.user).dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertIsNone(report["students"][0]["email"])
        self.assertEqual(report["students"][0]["kc"], 70)
        self.assertEqual(len(report["warnings"]), 1)

    def test_focus_roundtrip_preserves_grade_publication(self):
        draft = self.call("preview", {"csv": canvas_csv()})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        metadata = self.repo.get("COHORT#BRSA0267", "METADATA")
        focus = self.call("focus-activities", {"activityIds": ["001 KC (123)"], "expectedCurrent": draft["id"], "expectedVersion": None})["focus"]
        student = Portal(Repository(), {"sub": "s1", "email": "aluno@example.test", "groups": []})
        report = student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(report["focus"], focus)
        self.assertEqual(report["student"]["kc"], 70)
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA"), metadata)
        self.call("focus-activities", {"activityIds": [], "expectedCurrent": draft["id"], "expectedVersion": focus["version"]})
        self.assertEqual(student.dispatch("GET", "/cohorts/BRSA0267/report", {})["focus"]["activityIds"], [])

    def test_failed_transaction_leaves_all_items_unchanged(self):
        self.repo.put("TEST", "existing", {"version":1})
        with self.assertRaises(Conflict):
            self.repo.transaction([("TEST", "new", {"test":True}, None), ("TEST", "existing", {"version":2}, {"version":0})])
        self.assertIsNone(self.repo.get("TEST", "new"))
        self.assertEqual(self.repo.get("TEST", "existing"), {"version":1})

    def test_admin_requests_query_without_empty_sort_key(self):
        from unittest.mock import patch
        self.repo.put("REQUESTS", "user-1", {"userId": "user-1", "email": "teacher@example.test"})
        self.repo.put("REQUESTS", "user-2", {"userId": "user-2", "email": "other@example.test"})
        self.repo.put("OTHER", "user-3", {"userId": "user-3"})
        with patch.object(self.repo.table.meta.client, "query", wraps=self.repo.table.meta.client.query) as query:
            result = self.admin.dispatch("GET", "/requests", {})
            self.assertEqual({r["userId"] for r in result["requests"]}, {"user-1", "user-2"})
            condition = query.call_args.kwargs["KeyConditionExpression"]
            from boto3.dynamodb.conditions import ConditionExpressionBuilder
            expression = ConditionExpressionBuilder().build_expression(condition, is_key_condition=True)
            self.assertNotIn("", expression.attribute_value_placeholders.values())
            self.assertNotIn("begins_with", expression.condition_expression)
        self.assertEqual(len(self.repo.list("REQUESTS", "user-1")), 1)

    def test_approval_and_revocation_transactions(self):
        instructor = Portal(self.repo, {"sub":"t1", "email":"prof@escoladanuvem.org", "groups":[]})
        instructor.dispatch("POST", "/access-request", {})
        self.call("instructors", {"userId":"t1"})
        self.assertTrue(instructor.can_teach("BRSA0267"))
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "TEACH#")), 1)
        self.call("revoke-instructor", {"userId":"t1"})
        self.assertFalse(instructor.can_teach("BRSA0267"))
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "TEACH#"), [])

    def test_class_report_is_instructor_only_after_new_csv(self):
        draft = self.call("preview", {"csv": canvas_csv()})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        student = Portal(self.repo, {"sub": "s1", "email": "aluno@example.test", "groups": []})
        with self.assertRaises(Exception):
            student.dispatch("GET", "/cohorts/BRSA0267/class-report", {})
        draft = self.call("preview", {"csv": canvas_csv(kc="9")})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        report = class_report(self.repo, "BRSA0267")
        self.assertEqual(report["students"][0]["kc"], 90)


if __name__ == "__main__":
    unittest.main()

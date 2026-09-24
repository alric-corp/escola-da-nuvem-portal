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

    def test_cohorts_listing_skips_snapshot_once_student_is_bound(self):
        draft = self.call("preview", {"csv": canvas_csv()})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        student = Portal(self.repo, {"sub": "s1", "email": "aluno@example.test", "groups": []})
        # Primeiro acesso: sem vínculo STUDY# ainda, precisa ler o snapshot para achar pelo e-mail.
        with patch.object(self.repo.s3, "get_object", wraps=self.repo.s3.get_object) as get_object:
            first = student.dispatch("GET", "/cohorts", {})
            self.assertEqual([c["code"] for c in first["cohorts"]], ["BRSA0267"])
            self.assertTrue(get_object.called)
        # A rota de relatório é quem grava o vínculo (bind=True).
        student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(self.repo.get("USER#s1", "STUDY#BRSA0267")["canvasId"], "101")
        with patch.object(self.repo.s3, "get_object", wraps=self.repo.s3.get_object) as get_object:
            second = student.dispatch("GET", "/cohorts", {})
            self.assertEqual([c["code"] for c in second["cohorts"]], ["BRSA0267"])
            get_object.assert_not_called()

    def test_student_report_history_uses_compact_summary_and_falls_back_for_legacy_publications(self):
        first = self.call("preview", {"csv": canvas_csv(kc="7", lab="50")})["draft"]
        self.call("publish", {"draftId": first["id"]})
        second = self.call("preview", {"csv": canvas_csv(kc="9", lab="80")})["draft"]
        self.call("publish", {"draftId": second["id"]})
        third = self.call("preview", {"csv": canvas_csv(kc="10", lab="95")})["draft"]
        self.call("publish", {"draftId": third["id"]})
        student = Portal(self.repo, {"sub": "s1", "email": "aluno@example.test", "groups": []})

        with patch.object(self.repo.s3, "get_object", wraps=self.repo.s3.get_object) as get_object:
            report = student.dispatch("GET", "/cohorts/BRSA0267/report", {})
            full_snapshots_read = [c for c in get_object.call_args_list if c.kwargs["Key"].endswith("/snapshot.json")]
            # Só a publicação atual precisa do snapshot completo; as outras vêm do resumo
            # compacto (history.json), gravado no publish (ver todo/06).
            self.assertEqual(len(full_snapshots_read), 1)

        self.assertEqual(len(report["history"]), 3)
        self.assertEqual([round(h["kc"]) for h in report["history"]], [100, 90, 70])
        self.assertTrue(report["history"][0]["current"])
        self.assertEqual(report["history"][0]["changes"]["kc"], 10)
        self.assertEqual(report["history"][1]["changes"]["kc"], 20)
        self.assertIsNone(report["history"][2]["changes"])  # primeira publicação, sem base

        # Publicações anteriores a este recurso não têm "history": simula removendo a chave
        # e confirma que o resultado (cálculo sob demanda) é idêntico ao do resumo compacto.
        legacy = {k: v for k, v in self.repo.get("COHORT#BRSA0267", "PUB#" + second["id"]).items() if k != "history"}
        self.repo.put("COHORT#BRSA0267", "PUB#" + second["id"], legacy)
        fallback_report = student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(fallback_report["history"], report["history"])

    def test_unlink_student_and_display_name_use_real_transactions(self):
        draft = self.call("preview", {"csv": canvas_csv()})["draft"]
        self.call("publish", {"draftId": draft["id"]})
        student = Portal(self.repo, {"sub": "s1", "email": "aluno@example.test", "groups": []})
        student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual(self.repo.get("USER#s1", "STUDY#BRSA0267")["canvasId"], "101")

        found = self.call("students-search", {"query": "aluno@example.test"})["results"]
        self.assertEqual(found, [{"id": "101", "name": "Marina Costa", "email": "aluno@example.test",
                                  "bound": True, "boundEmail": "aluno@example.test", "boundAt": found[0]["boundAt"]}])

        self.call("display-name", {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(Portal(Repository(), self.admin.user).dispatch(
            "GET", "/cohorts/BRSA0267/report", {})["students"][0]["name"], "Apelido")

        self.call("unlink-student", {"canvasId": "101"})
        self.assertIsNone(self.repo.get("USER#s1", "STUDY#BRSA0267"))
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "OWNER#101"))
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "AUDIT#")), 2)

        other = Portal(Repository(), {"sub": "s2", "email": "aluno@example.test", "groups": []})
        self.assertEqual(other.dispatch("GET", "/cohorts/BRSA0267/report", {})["student"]["id"], "101")

    def test_draft_retention_tags_and_ttl_on_real_services(self):
        s3 = boto3.client("s3", region_name="us-east-1")
        db = boto3.client("dynamodb", region_name="us-east-1")
        tag = lambda key: {t["Key"]: t["Value"] for t in s3.get_object_tagging(Bucket="portal-imports-test", Key=key)["TagSet"]}
        draft = self.call("preview", {"csv": canvas_csv()})["draft"]
        folder = draft["snapshot"].rsplit("/", 1)[0]
        self.assertEqual(tag(folder + "/source.csv"), {"portal-status": "draft"})
        item = db.get_item(TableName="portal-test", Key={"PK": {"S": "COHORT#BRSA0267"}, "SK": {"S": "DRAFT#" + draft["id"]}})["Item"]
        self.assertIn("expiresAt", item)
        self.call("publish", {"draftId": draft["id"]})
        self.assertEqual(tag(folder + "/source.csv"), {"portal-status": "published"})
        self.assertEqual(tag(folder + "/snapshot.json"), {"portal-status": "published"})
        item = db.get_item(TableName="portal-test", Key={"PK": {"S": "COHORT#BRSA0267"}, "SK": {"S": "DRAFT#" + draft["id"]}})["Item"]
        self.assertNotIn("expiresAt", item)

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

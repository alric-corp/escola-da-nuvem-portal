"""Limpeza do kit live em Moto/fakes: nunca executa o CLI ou acessa AWS real."""
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import uuid

import boto3
from moto import mock_aws

spec = importlib.util.spec_from_file_location("live_accounts", Path(__file__).parents[1] / "live_accounts.py")
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class Cognito:
    """Pool UsernameAttributes=email: alias mutável resolve um Username UUID.

    Cognito é fake explícito; apenas DynamoDB/S3 usam Moto neste módulo.
    """
    class exceptions:
        class UserNotFoundException(Exception):
            pass

    def __init__(self, actors):
        self.users = {a["username"]: {"Username": a["sub"], "UserAttributes": [{"Name": "sub", "Value": a["sub"]},
                                                        {"Name": "email", "Value": a["username"]}]} for a in actors.values()}
        self.deleted = []

    def _alias(self, name):
        return next((alias for alias, user in self.users.items()
                     if alias == name or user["Username"] == name), None)

    def admin_get_user(self, **kwargs):
        alias = self._alias(kwargs["Username"])
        if alias is None:
            raise self.exceptions.UserNotFoundException()
        return self.users[alias]

    def admin_delete_user(self, **kwargs):
        alias = self._alias(kwargs["Username"])
        if alias is None:
            raise self.exceptions.UserNotFoundException()
        self.deleted.append(kwargs["Username"])
        self.users.pop(alias)


@mock_aws
class LiveCleanupTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1"})
        self.env.start(); self.addCleanup(self.env.stop)
        self.session = boto3.Session(region_name="us-east-1")
        self.session.client("dynamodb").create_table(TableName="qa-test", KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST")
        self.table = self.session.resource("dynamodb").Table("qa-test")
        self.session.client("s3").create_bucket(Bucket="qa-imports-test")
        self.context = {"run": "0123456789ab", "cohort": "SMOKE-0123456789AB", "accountId": "123456789012",
            "output": {"table_name": "qa-test", "imports_bucket": "qa-imports-test", "user_pool_id": "us-east-1_example"},
            "actors": {role: {"username": f"portal-smoke-0123456789ab-{role}@" + ("escoladanuvem.org" if role == "instructor" else "example.test"),
                              "password": "synthetic-secret", "sub": str(uuid.uuid4())}
                       for role in ("admin", "student1", "student2", "instructor")}}
        self.cognito = Cognito(self.context["actors"])
        original_client = self.session.client
        self.clients = patch.object(self.session, "client", side_effect=lambda service, **kwargs:
            self.cognito if service == "cognito-idp" else original_client(service, **kwargs))
        self.clients.start(); self.addCleanup(self.clients.stop)
        self.pk = "COHORT#" + self.context["cohort"]
        self.put(self.pk, "METADATA", {"code": self.context["cohort"], "name": "Teste temporário de implantação", "current": None})
        self.put("COHORT_DIRECTORY", self.pk, {"code": self.context["cohort"]})
        self.put("COHORT_DIRECTORY", "COHORT#REAL", {"code": "REAL"})
        self.put("DERIVED_ACCESS", "DISCOVERY", {"ready": True})
        self.put("DERIVED_ACCESS", "DIRECTORY_REVISION", {"revision": "preserve-global"})
        for actor in self.context["actors"].values():
            self.put("USER#" + actor["sub"], "STUDY#" + self.context["cohort"], {"code": self.context["cohort"]})
            key = "DISCOVERY_EMAIL#" + hashlib.sha256(actor["username"].encode()).hexdigest()
            self.put(key, self.pk, {"code": self.context["cohort"]})
            self.put(key, "COHORT#REAL", {"code": "REAL"})
        self.session.client("s3").put_object(Bucket="qa-imports-test", Key=f"cohorts/{self.context['cohort']}/fake/snapshot.json", Body=b"{}")
        self.session.client("s3").put_object(Bucket="qa-imports-test", Key="cohorts/REAL/keep.json", Body=b"{}")

    def put(self, pk, sk, data):
        self.table.put_item(Item={"PK": pk, "SK": sk, "data": json.dumps(data)})

    def items(self):
        return {(i["PK"], i["SK"]): i for i in self.table.scan()["Items"]}

    def clean(self):
        return live.cleanup(self.context, self.session, self.context["accountId"])

    def test_exact_scope_and_repeatable_cleanup_preserve_globals_other_cohorts_and_objects(self):
        self.clean()
        remaining = self.items()
        self.assertTrue(all(pk != self.pk and not pk.startswith("USER#") for pk, sk in remaining))
        self.assertIn(("DERIVED_ACCESS", "DISCOVERY"), remaining)
        self.assertIn(("DERIVED_ACCESS", "DIRECTORY_REVISION"), remaining)
        self.assertIn(("COHORT_DIRECTORY", "COHORT#REAL"), remaining)
        self.assertEqual(sum(pk.startswith("DISCOVERY_EMAIL#") for pk, sk in remaining), 4)
        self.assertEqual([o["Key"] for o in self.session.client("s3").list_objects_v2(Bucket="qa-imports-test")["Contents"]], ["cohorts/REAL/keep.json"])
        self.clean()
        self.assertEqual(self.items(), remaining)

    def test_bad_context_or_account_refuses_before_any_delete(self):
        for change in [{"run": "../unsafe"}, {"cohort": "SMOKE-REAL"}, {"accountId": "000000000000"}]:
            old = copy.deepcopy(self.context); before = self.items()
            self.context.update(change)
            with self.assertRaises(ValueError): self.clean()
            self.assertEqual(self.items(), before); self.assertEqual(self.cognito.deleted, [])
            self.context = old
        self.context["actors"]["student2"]["username"] = "real@example.test"
        with self.assertRaises(ValueError): self.clean()
        self.assertEqual(self.cognito.deleted, [])

    def test_cognito_sub_or_foreign_binding_refuses_entire_plan(self):
        before = self.items()
        self.context["actors"]["student2"]["sub"] = str(uuid.uuid4())
        with self.assertRaises(ValueError): self.clean()
        self.assertEqual(self.items(), before); self.assertEqual(self.cognito.deleted, [])

    def test_missing_cognito_identity_does_not_authorize_deleting_arbitrary_sub(self):
        actor = self.context["actors"]["student1"]
        self.cognito.users.pop(actor["username"])
        before = self.items()
        with self.assertRaisesRegex(ValueError, "Cognito"): self.clean()
        self.assertEqual(self.items(), before)
        self.assertEqual(self.cognito.deleted, [])

    def test_foreign_canonical_data_and_mismatched_projection_are_preserved(self):
        for pk, sk, data in [
            ("USER#" + self.context["actors"]["admin"]["sub"], "TEACH#REAL", {"code": "REAL"}),
            (self.pk, "METADATA", {"code": self.context["cohort"], "name": "Turma real", "current": None}),
            ("COHORT_DIRECTORY", self.pk, {"code": "REAL"}),
        ]:
            previous = self.table.get_item(Key={"PK": pk, "SK": sk}).get("Item")
            self.put(pk, sk, data); before = self.items()
            with self.assertRaises(ValueError): self.clean()
            self.assertEqual(self.items(), before); self.assertEqual(self.cognito.deleted, [])
            if previous: self.table.put_item(Item=previous)
            else: self.table.delete_item(Key={"PK": pk, "SK": sk})

    def test_partial_failure_preserves_context_and_resume_reconciles_remaining_rows(self):
        original = self.table.delete_item; calls = []
        def fail(**kwargs):
            calls.append(kwargs)
            if len(calls) == 3: raise RuntimeError("interrupted")
            return original(**kwargs)
        with patch.object(self.session, "resource", return_value=type("Resource", (), {"Table": lambda _, name: self.table})()), \
             patch.object(self.table, "delete_item", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "interrupted"): self.clean()
        self.assertEqual(self.cognito.deleted, [])
        self.clean()
        self.assertNotIn((self.pk, "METADATA"), self.items())
        self.assertIn(("DERIVED_ACCESS", "DISCOVERY"), self.items())

    def test_conditional_delete_preserves_concurrent_changed_row(self):
        original = self.table.delete_item
        def race(**kwargs):
            if kwargs["Key"] == {"PK": "COHORT_DIRECTORY", "SK": self.pk}:
                self.put("COHORT_DIRECTORY", self.pk, {"code": "REAL"})
            return original(**kwargs)
        with patch.object(self.session, "resource", return_value=type("Resource", (), {"Table": lambda _, name: self.table})()), \
             patch.object(self.table, "delete_item", side_effect=race):
            with self.assertRaises(RuntimeError): self.clean()
        self.assertEqual(json.loads(self.items()[("COHORT_DIRECTORY", self.pk)]["data"]), {"code": "REAL"})
        self.assertEqual(self.cognito.deleted, [])

    def test_cli_real_path_removes_derived_rows_and_only_then_removes_context(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private-context.json"
            live.save(path, self.context)
            with patch.object(live.boto3, "Session", return_value=self.session), patch("sys.argv", [
                    "live_accounts.py", "cleanup", "--context", str(path), "--account-id", self.context["accountId"]]):
                live.main()
            self.assertFalse(path.exists())
        self.assertNotIn(("COHORT_DIRECTORY", self.pk), self.items())
        self.assertFalse(any(pk.startswith("DISCOVERY_EMAIL#") and sk == self.pk for pk, sk in self.items()))
        self.assertIn(("DERIVED_ACCESS", "DISCOVERY"), self.items())

    def test_s3_partial_error_keeps_context_and_resume_finishes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private-context.json"
            live.save(path, self.context)
            s3 = self.session.client("s3")
            original = self.session.client
            with patch.object(live.boto3, "Session", return_value=self.session), patch("sys.argv", [
                    "live_accounts.py", "cleanup", "--context", str(path), "--account-id", self.context["accountId"]]), \
                 patch.object(self.session, "client", side_effect=lambda service, **kwargs: s3 if service == "s3" else original(service, **kwargs)), \
                 patch.object(s3, "delete_objects", return_value={"Errors": [{"Code": "AccessDenied"}]}):
                with self.assertRaisesRegex(RuntimeError, "novamente"): live.main()
            self.assertTrue(path.exists())
            self.assertEqual(self.cognito.deleted, [])
            self.clean()
            self.assertNotIn((self.pk, "METADATA"), self.items())

    def test_all_versions_and_delete_markers_are_removed_only_in_the_test_prefix(self):
        s3 = self.session.client("s3")
        s3.put_bucket_versioning(Bucket="qa-imports-test", VersioningConfiguration={"Status": "Enabled"})
        key = f"cohorts/{self.context['cohort']}/fake/snapshot.json"
        for _ in range(2): s3.put_object(Bucket="qa-imports-test", Key=key, Body=b"{}")
        s3.delete_object(Bucket="qa-imports-test", Key=key)
        self.clean()
        remaining = s3.list_object_versions(Bucket="qa-imports-test")
        self.assertFalse(remaining.get("DeleteMarkers"))
        self.assertEqual([row["Key"] for row in remaining["Versions"]], ["cohorts/REAL/keep.json"])

    def test_new_row_during_cleanup_is_reported_instead_of_false_completion(self):
        original = self.table.delete_item
        inserted = False
        def concurrent(**kwargs):
            nonlocal inserted
            if not inserted:
                inserted = True
                self.put(self.pk, "AUDIT#new", {"by": self.context["actors"]["admin"]["sub"]})
            return original(**kwargs)
        with patch.object(self.session, "resource", return_value=type("Resource", (), {"Table": lambda _, name: self.table})()), \
             patch.object(self.table, "delete_item", side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError, "Surgiram registros"): self.clean()
        self.assertEqual(self.cognito.deleted, [])
        self.assertIn((self.pk, "AUDIT#new"), self.items())
        self.clean()
        self.assertNotIn((self.pk, "AUDIT#new"), self.items())

    def test_recreated_email_alias_preserves_replacement_and_original_context_on_retry(self):
        actor = self.context["actors"]["student1"]
        original_sub, replacement = actor["sub"], str(uuid.uuid4())
        original_delete, replaced = self.table.delete_item, False
        def recreate(**kwargs):
            nonlocal replaced
            if not replaced:
                replaced = True
                self.cognito.users[actor["username"]] = {"Username": replacement, "UserAttributes": [
                    {"Name": "sub", "Value": replacement}, {"Name": "email", "Value": actor["username"]}]}
            return original_delete(**kwargs)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private-context.json"
            live.save(path, self.context)
            with patch.object(live.boto3, "Session", return_value=self.session), patch("sys.argv", [
                    "live_accounts.py", "cleanup", "--context", str(path), "--account-id", self.context["accountId"]]), \
                 patch.object(self.session, "resource", return_value=type("Resource", (), {"Table": lambda _, name: self.table})()), \
                 patch.object(self.table, "delete_item", side_effect=recreate):
                with self.assertRaisesRegex(ValueError, "Identidade Cognito"): live.main()
            self.assertTrue(path.exists())
            saved = json.loads(path.read_text())
            self.assertEqual(saved["actors"]["student1"]["sub"], original_sub)
            self.assertEqual(saved["actors"]["student1"]["cognitoUsername"], original_sub)
            self.assertEqual(self.cognito.users[actor["username"]]["Username"], replacement)
            self.context = saved
            with self.assertRaisesRegex(ValueError, "Identidade Cognito"): self.clean()
            self.assertEqual(self.context["actors"]["student1"]["sub"], original_sub)
            self.assertNotIn(replacement, self.cognito.deleted)

    def test_deletion_uses_validated_canonical_username_even_when_different_from_sub(self):
        expected = []
        for actor in self.context["actors"].values():
            canonical = str(uuid.uuid4())
            self.cognito.users[actor["username"]]["Username"] = canonical
            expected.append(canonical)
        self.clean()
        self.assertEqual(self.cognito.deleted, expected)
        self.assertEqual([a["cognitoUsername"] for a in self.context["actors"].values()], expected)

    def test_replacement_between_final_read_and_delete_cannot_be_deleted_by_alias(self):
        actor = self.context["actors"]["student1"]
        old, replacement = actor["sub"], str(uuid.uuid4())
        original = self.cognito.admin_delete_user
        def race(**kwargs):
            if kwargs["Username"] in (old, actor["username"]):
                self.cognito.users[actor["username"]] = {"Username": replacement, "UserAttributes": [
                    {"Name": "sub", "Value": replacement}, {"Name": "email", "Value": actor["username"]}]}
            return original(**kwargs)
        with patch.object(self.cognito, "admin_delete_user", side_effect=race):
            with self.assertRaisesRegex(ValueError, "Identidade Cognito"): self.clean()
        self.assertEqual(self.cognito.users[actor["username"]]["Username"], replacement)
        self.assertNotIn(replacement, self.cognito.deleted)
        self.assertEqual(actor["sub"], old)

    def test_cleanup_never_adopts_a_sub_absent_from_original_context(self):
        self.context["actors"]["student1"].pop("sub")
        before = self.items()
        with self.assertRaisesRegex(ValueError, "Identidade Cognito"): self.clean()
        self.assertEqual(self.items(), before)
        self.assertEqual(self.cognito.deleted, [])

    def test_query_pagination_does_not_leave_derived_or_canonical_rows(self):
        original = self.table.query
        def one_page(**kwargs): return original(**(kwargs | {"Limit": 1}))
        with patch.object(self.session, "resource", return_value=type("Resource", (), {"Table": lambda _, name: self.table})()), \
             patch.object(self.table, "query", side_effect=one_page):
            self.clean()
        self.assertEqual(len(self.items()), 7)

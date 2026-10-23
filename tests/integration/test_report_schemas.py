"""Respostas do dispatcher real contra OpenAPI 3.0 (nullable não é JSON Schema 3.1)."""
import copy
import json
import os
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch

from openapi_schema_validator import OAS30Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT4

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from canvas_submissions import save_submissions
from portal import APIError, Portal
from test_grades import canvas_csv
from test_portal import MemoryRepository


class ConcreteResponseContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract = subprocess.run(["node", "--input-type=module", "-e",
            'import {parseContract} from "./tests/contracts/openapi.mjs"; console.log(JSON.stringify(parseContract()));'],
            cwd=ROOT, check=True, capture_output=True, text=True)
        cls.contract = json.loads(contract.stdout)
        cls.base = "https://portal.invalid/openapi.json"
        cls.registry = Registry().with_resource(cls.base, Resource(cls.contract, DRAFT4))

    def setUp(self):
        self.repo = MemoryRepository()
        self.repo.put("COHORT#FIC001", "METADATA", {"code": "FIC001", "name": "Turma fictícia", "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []})
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"REMINDERS_ENABLED": "false"}).start()

    def validate(self, path, result, method="get"):
        pointer = path.replace("~", "~0").replace("/", "~1")
        schema = {"$ref": f"{self.base}#/paths/{pointer}/{method}/responses/200/content/application~1json/schema"}
        validator = OAS30Validator(schema, registry=self.registry, format_checker=OAS30Validator.FORMAT_CHECKER)
        validator.validate(result)

    def publish(self):
        draft = self.admin.dispatch("POST", "/cohorts/FIC001/preview", {"csv": canvas_csv(kc="0", lab="100")})["draft"]
        self.admin.dispatch("POST", "/cohorts/FIC001/publish", {"draftId": draft["id"]})
        cohort = self.repo.get("COHORT#FIC001", "METADATA")
        self.repo.put("COHORT#FIC001", "METADATA", {**cohort, "canvasCourseId": "7"})

    def test_empty_reports_and_discovery_have_concrete_shapes(self):
        for path in ["/cohorts", "/cohorts/FIC001/class-report", "/cohorts/FIC001/report"]:
            template = path.replace("FIC001", "{code}")
            self.validate(template, self.admin.dispatch("GET", path, {}))
        self.assertEqual(self.student.dispatch("GET", "/cohorts", {}), {"cohorts": []})

    def test_real_reports_all_profiles_zero_and_nullable_fields(self):
        self.publish()
        own = self.student.dispatch("GET", "/cohorts/FIC001/report", {})
        self.assertEqual(own["student"]["kc"], 0)
        self.assertIsNone(own["history"][0]["changes"])
        self.validate("/cohorts/{code}/report", own)
        self.validate("/cohorts", self.student.dispatch("GET", "/cohorts", {}))
        self.validate("/cohorts/{code}/report", self.admin.dispatch("GET", "/cohorts/FIC001/report", {}))
        self.validate("/cohorts/{code}/class-report", self.admin.dispatch("GET", "/cohorts/FIC001/class-report", {}))
        self.validate("/cohorts/{code}/pending-preview", self.admin.dispatch("POST", "/cohorts/FIC001/pending-preview", {"studentId": "101"}), "post")
        with self.assertRaises(APIError) as error:
            self.student.dispatch("GET", "/cohorts/FIC001/class-report", {})
        self.assertEqual(error.exception.status, 403)

    def test_submission_contract_does_not_change_academic_snapshot_or_leak_another_student(self):
        self.publish()
        before = self.student.dispatch("GET", "/cohorts/FIC001/report", {})
        assignment = {"published": True, "submission_types": ["online_upload"], "unlock_at": None}
        row = {"workflow_state": "submitted", "attempt": 1, "submitted_at": "2026-10-21T10:00:00Z", "assignment_visible": True}
        save_submissions(self.repo, "7", {"courseId": "7", "assignments": {"123": assignment},
            "students": {"101": {"123": row}, "999": {"123": row}}}, "2026-10-22T10:00:00Z")
        own = self.student.dispatch("GET", "/cohorts/FIC001/report", {})
        self.validate("/cohorts/{code}/report", own)
        self.assertEqual({k: v for k, v in own.items() if k != "canvasSubmissions"}, before)
        self.assertNotIn("999", json.dumps(own["canvasSubmissions"]))
        self.assertEqual(own["canvasSubmissions"]["items"]["123"]["state"], "submitted")
        detail = self.admin.dispatch("POST", "/cohorts/FIC001/pending-preview", {"studentId": "101"})
        self.validate("/cohorts/{code}/pending-preview", detail, "post")
        self.assertEqual(detail["canvasSubmissions"], own["canvasSubmissions"])
        self.assertNotIn("canvasSubmissions", self.admin.dispatch("GET", "/cohorts/FIC001/report", {}))
        for mutate in [lambda x: x["items"]["123"].pop("state"),
                       lambda x: x["items"]["123"].update(state="unknown-new-enum"),
                       lambda x: x["items"]["123"].update(attempt="1"),
                       lambda x: x["items"]["123"].update(observedAt="inválido"),
                       lambda x: x["items"]["123"].update(grade="nota não publicada")]:
            changed = copy.deepcopy(own)
            mutate(changed["canvasSubmissions"])
            with self.assertRaises(ValidationError):
                self.validate("/cohorts/{code}/report", changed)

    def test_negative_required_type_enum_null_and_profile_exposure(self):
        self.publish()
        actual = self.admin.dispatch("GET", "/cohorts/FIC001/class-report", {})
        changes = [lambda x: x.pop("students"), lambda x: x.update(students=None),
            lambda x: x["students"][0].pop("name"), lambda x: x["students"][0].update(pending="2"),
            lambda x: x["students"][0].update(status="inventado"), lambda x: x["students"][0].update(name=None),
            lambda x: x["students"][0].update(email="other@example.test"), lambda x: x.update(student={})]
        for mutate in changes:
            changed = copy.deepcopy(actual)
            mutate(changed)
            with self.subTest(changed=changed), self.assertRaises(ValidationError):
                self.validate("/cohorts/{code}/class-report", changed)
        own = self.student.dispatch("GET", "/cohorts/FIC001/report", {})
        for field in ["students", "canvasEngagement", "canvasSync", "warnings"]:
            changed = {**own, field: []}
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.validate("/cohorts/{code}/report", changed)
        # Extensões legítimas não são fechadas por additionalProperties=false global.
        self.validate("/cohorts/{code}/class-report", {**actual, "futureExtension": True})

    def test_history_required_fields_and_nullable_are_distinct(self):
        self.publish()
        own = self.student.dispatch("GET", "/cohorts/FIC001/report", {})
        for mutate in [lambda x: x["history"][0].pop("current"),
                       lambda x: x["history"][0].update(publishedAt=None),
                       lambda x: x["history"][0].update(current="true")]:
            changed = copy.deepcopy(own)
            mutate(changed)
            with self.assertRaises(ValidationError):
                self.validate("/cohorts/{code}/report", changed)

    def test_instructor_revocation_and_admin_student_view_keep_profile_boundaries(self):
        self.publish()
        teacher = Portal(self.repo, {"sub": "prof", "email": "prof@example.test", "groups": []})
        self.repo.put("USER#prof", "TEACH#FIC001", {"code": "FIC001"})
        for suffix in ("report", "class-report"):
            self.validate("/cohorts/{code}/" + suffix, teacher.dispatch("GET", "/cohorts/FIC001/" + suffix, {}))
        viewed = self.admin.dispatch("POST", "/cohorts/FIC001/student-view", {"studentId": "101"})
        self.validate("/cohorts/{code}/student-view", viewed, "post")
        self.assertNotIn("students", viewed)
        self.repo.transaction([("USER#prof", "TEACH#FIC001", None, {"code": "FIC001"})])
        with self.assertRaises(APIError) as error:
            teacher.dispatch("GET", "/cohorts/FIC001/class-report", {})
        self.assertEqual(error.exception.status, 403)


if __name__ == "__main__":
    unittest.main()

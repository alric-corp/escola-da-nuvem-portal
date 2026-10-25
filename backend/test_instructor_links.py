"""Vínculos posteriores à aprovação, com dispatcher e repositório em memória."""
import copy
import unittest
from unittest.mock import patch

from portal import APIError, Portal
from test_portal import MemoryRepository, NoopMailer


class InstructorLinkTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.mailer = NoopMailer()
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]}, mailer=self.mailer)
        self.instructor = Portal(self.repo, {"sub": "teacher", "email": "teacher@escoladanuvem.org", "groups": []}, mailer=self.mailer)
        for code in ("FIC001", "FIC002"):
            self.admin.dispatch("POST", "/cohorts", {"code": code, "name": "Turma fictícia"})
        self.instructor.dispatch("POST", "/access-request", {})

    def grant(self, code="FIC001", actor=None):
        return (actor or self.admin).dispatch("POST", f"/cohorts/{code}/instructors", {"userId": "teacher"})

    def test_approved_instructor_can_receive_another_cohort_without_losing_the_first(self):
        self.grant()
        request = self.repo.get("REQUESTS", "teacher")
        first = self.repo.get("USER#teacher", "TEACH#FIC001")
        self.assertEqual(self.grant("FIC002"), {"approved": True})
        self.assertTrue(self.instructor.can_teach("FIC001"))
        self.assertTrue(self.instructor.can_teach("FIC002"))
        self.assertEqual(self.repo.get("USER#teacher", "TEACH#FIC001"), first)
        self.assertEqual(self.repo.get("REQUESTS", "teacher"), request)
        self.assertEqual(self.repo.get("COHORT#FIC002", "TEACH#teacher")["userId"], "teacher")
        self.assertEqual(self.mailer.identities, [])

    def test_revoked_link_can_be_granted_again_explicitly_without_touching_other_records(self):
        self.grant()
        self.grant("FIC002")
        self.admin.dispatch("POST", "/cohorts/FIC001/revoke-instructor", {"userId": "teacher"})
        self.assertFalse(self.instructor.can_teach("FIC001"))
        self.assertEqual(self.repo.get("REQUESTS", "teacher")["status"], "approved")
        before = copy.deepcopy(self.repo.items)
        self.grant()
        self.assertTrue(self.instructor.can_teach("FIC001"))
        self.assertTrue(self.instructor.can_teach("FIC002"))
        allowed = {("USER#teacher", "TEACH#FIC001"), ("COHORT#FIC001", "TEACH#teacher"), ("REQUESTS", "teacher")}
        self.assertEqual({k: v for k, v in self.repo.items.items() if k not in allowed},
                         {k: v for k, v in before.items() if k not in allowed})

    def test_rejected_request_cannot_be_reopened_by_a_link_operation(self):
        self.admin.dispatch("POST", "/requests/teacher/reject", {})
        before = copy.deepcopy(self.repo.items)
        with patch.object(self.repo, "transaction", wraps=self.repo.transaction) as write:
            with self.assertRaises(APIError) as error:
                self.grant()
            self.assertEqual(error.exception.status, 409)
            write.assert_not_called()
        self.assertEqual(self.repo.items, before)

    def test_unknown_request_status_fails_before_any_transaction(self):
        request = self.repo.get("REQUESTS", "teacher")
        self.repo.put("REQUESTS", "teacher", {**request, "status": "unknown"})
        before = copy.deepcopy(self.repo.items)
        with patch.object(self.repo, "transaction", wraps=self.repo.transaction) as write:
            with self.assertRaises(APIError) as error:
                self.grant()
            self.assertEqual(error.exception.status, 409)
            write.assert_not_called()
        self.assertEqual(self.repo.items, before)

    def test_legacy_request_without_status_keeps_the_existing_approval_path(self):
        request = self.repo.get("REQUESTS", "teacher")
        request.pop("status")
        self.repo.put("REQUESTS", "teacher", request)
        self.assertEqual(self.grant(), {"approved": True})
        self.assertTrue(self.instructor.can_teach("FIC001"))
        self.assertEqual(self.repo.get("REQUESTS", "teacher")["status"], "approved")

    def test_non_admin_cannot_grant_even_an_approved_instructor(self):
        self.grant()
        for groups in ([], ["student"], ["instructor"]):
            with self.subTest(groups=groups):
                actor = Portal(self.repo, {"sub": "outsider", "email": "other@example.test", "groups": groups}, mailer=self.mailer)
                before = copy.deepcopy(self.repo.items)
                with patch.object(self.repo, "transaction", wraps=self.repo.transaction) as write:
                    with self.assertRaises(APIError) as error:
                        self.grant("FIC002", actor)
                    self.assertEqual(error.exception.status, 403)
                    write.assert_not_called()
                self.assertEqual(self.repo.items, before)

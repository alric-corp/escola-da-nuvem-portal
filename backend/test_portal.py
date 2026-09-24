import copy
import csv
import io
import json
import unittest
from unittest.mock import patch

from grades import parse_csv
from portal import APIError, Portal, authenticate, handler, class_report
from repository import Conflict
from test_grades import canvas_csv


def sparse_lab_csv(lab_filled, students=6, extra_activity=False):
    """Turma com um Lab pouco preenchido, para testar a sugestão de atividades liberadas."""
    headers = ["Student", "ID", "SIS Login ID", "001 KC (1)", "002 Lab (2)"]
    points = ["Points Possible", "", "", "10", "100"]
    if extra_activity:
        headers.append("003 Lab (3)")
        points.append("100")
    headers.append("Graduated Final Points")
    points.append("1")
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(headers)
    writer.writerow(points)
    for i in range(students):
        row = [f"Aluno {i}, Turma", str(200 + i), f"aluno{i}@example.test", "8", str(50) if i < lab_filled else ""]
        if extra_activity:
            row.append("60" if i < lab_filled else "")
        row.append("0")
        writer.writerow(row)
    return out.getvalue()


class MemoryRepository:
    def __init__(self):
        self.items = {}
        self.files = {}
        self.fail_transaction = False

    def get(self, pk, sk):
        return copy.deepcopy(self.items.get((pk, sk)))

    def put(self, pk, sk, data, absent=False):
        if absent and (pk, sk) in self.items:
            raise Conflict()
        self.items[pk, sk] = copy.deepcopy(data)

    def list(self, pk, prefix=""):
        return [copy.deepcopy(v) for (p, s), v in self.items.items() if p == pk and s.startswith(prefix)]

    def cohorts(self):
        return [copy.deepcopy(v) for (p, s), v in self.items.items() if s == "METADATA"]

    def transaction(self, writes):
        if self.fail_transaction or any(self.get(p, s) != old for p, s, data, old in writes):
            raise Conflict()
        for p, s, data, old in writes:
            if data is None:
                self.items.pop((p, s), None)
            else:
                self.put(p, s, data)

    def snapshot(self, key, value=None, raw=False):
        if value is not None:
            self.files[key] = copy.deepcopy(value)
        return copy.deepcopy(self.files[key])


class NoopMailer:
    """Evita chamadas reais ao SES nos testes que aprovam instrutores."""
    def __init__(self):
        self.identities = []

    def ensure_identity(self, email):
        self.identities.append(email)


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "name": "Turma 267", "current": None})
        self.mailer = NoopMailer()
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]}, mailer=self.mailer)
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []}, mailer=self.mailer)
        self.instructor = Portal(self.repo, {"sub": "teacher", "email": "teacher@escoladanuvem.org", "groups": ["instructor"]}, mailer=self.mailer)

    def call(self, actor, operation, body=None, method="POST", code="BRSA0267"):
        return actor.dispatch(method, f"/cohorts/{code}/{operation}", body or {})

    def publish(self, csv=None):
        draft = self.call(self.admin, "preview", {"csv": csv or canvas_csv()})
        return self.call(self.admin, "publish", {"draftId": draft["draft"]["id"], "acknowledgeRemoved": True})["publication"]

    def test_email_or_instructor_group_does_not_grant_class_access(self):
        for actor in (self.student, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "preview", {"csv": canvas_csv()})
            self.assertEqual(err.exception.status, 403)

    def test_student_cannot_create_cohort_or_list_requests(self):
        for method, path in (("POST", "/cohorts"), ("GET", "/requests")):
            with self.assertRaises(APIError):
                self.student.dispatch(method, path, {"code": "BRSA0268"})

    def test_request_approval_grants_only_selected_cohort(self):
        self.admin.dispatch("POST", "/cohorts", {"code": "BRSA0268"})
        self.instructor.dispatch("POST", "/access-request", {})
        self.call(self.admin, "instructors", {"userId": "teacher"})
        self.call(self.instructor, "preview", {"csv": canvas_csv()})
        with self.assertRaises(APIError):
            self.call(self.instructor, "preview", {"csv": canvas_csv()}, code="BRSA0268")
        self.assertEqual(self.instructor.me()["roles"], ["instructor"])

    def test_instructor_approval_does_not_send_verification_automatically(self):
        self.instructor.dispatch("POST", "/access-request", {})
        self.call(self.admin, "instructors", {"userId": "teacher"})
        self.assertEqual(self.mailer.identities, [])

    def test_instructor_approval_succeeds_even_if_ses_setup_fails(self):
        self.instructor.dispatch("POST", "/access-request", {})
        with patch.object(self.mailer, "ensure_identity", side_effect=RuntimeError("SES indisponível")):
            self.assertEqual(self.call(self.admin, "instructors", {"userId": "teacher"}), {"approved": True})
        self.assertTrue(self.instructor.can_teach("BRSA0267"))

    def test_lookalike_institutional_domain_cannot_request(self):
        attacker = Portal(self.repo, {"sub": "x", "email": "x@escoladanuvem.org.evil.test", "groups": []})
        with self.assertRaises(APIError):
            attacker.dispatch("POST", "/access-request", {})

    def test_revocation_takes_effect_without_new_cognito_token(self):
        self.instructor.dispatch("POST", "/access-request", {})
        self.call(self.admin, "instructors", {"userId": "teacher"})
        self.assertTrue(self.instructor.can_teach("BRSA0267"))
        self.call(self.admin, "revoke-instructor", {"userId": "teacher"})
        self.assertFalse(self.instructor.can_teach("BRSA0267"))
        with self.assertRaises(APIError):
            self.call(self.instructor, "preview", {"csv": canvas_csv()})

    def test_preview_does_not_publish_or_expose_students(self):
        self.call(self.admin, "preview", {"csv": canvas_csv()})
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "METADATA")["current"])
        self.assertEqual(self.student.dispatch("GET", "/cohorts", {})["cohorts"], [])

    def test_student_response_contains_only_own_grades(self):
        self.publish(canvas_csv(extra=["Private Other Name", "202", "other@example.test", "8", "100", "0"]))
        result = self.call(self.student, "report", method="GET", body={"studentId": "202", "role": "admin"})
        encoded = json.dumps(result)
        self.assertNotIn("Private Other Name", encoded)
        self.assertNotIn("other@example.test", encoded)
        self.assertNotIn("students", result)
        self.assertNotIn("snapshot", result["publication"])
        self.assertEqual(result["student"]["id"], "101")

    def test_other_student_cannot_access_report(self):
        self.publish()
        outsider = Portal(self.repo, {"sub": "outsider", "email": "outsider@example.test", "groups": []})
        with self.assertRaises(APIError):
            self.call(outsider, "report", method="GET")

    def test_binding_survives_email_change_and_cannot_be_stolen(self):
        self.publish()
        self.call(self.student, "report", method="GET")
        self.student.user["email"] = "new@example.test"
        self.assertEqual(self.call(self.student, "report", method="GET")["student"]["id"], "101")
        thief = Portal(self.repo, {"sub": "thief", "email": "aluno@example.test", "groups": []})
        with self.assertRaises(APIError):
            self.call(thief, "report", method="GET")

    def test_missing_email_can_publish_but_cannot_create_membership_until_corrected(self):
        self.publish(canvas_csv(email=""))
        self.assertEqual(len(self.call(self.admin, "report", method="GET")["students"]), 1)
        self.assertEqual(self.student.dispatch("GET", "/cohorts", {})["cohorts"], [])
        for op in ("report", "class-report"):
            with self.subTest(op=op), self.assertRaises(APIError) as err:
                self.call(self.student, op, method="GET")
            self.assertEqual(err.exception.status, 403)
        self.assertIsNone(self.repo.get("USER#student", "STUDY#BRSA0267"))
        self.publish(canvas_csv())
        result = self.call(self.student, "report", method="GET")["student"]
        self.assertEqual((result["id"], result["kc"]), ("101", 70))
        # An established identity must not be lost if a later export omits email.
        self.publish(canvas_csv(email=""))
        self.assertEqual(self.call(self.student, "report", method="GET")["student"]["id"], "101")

    def test_stale_and_duplicate_publications_are_rejected(self):
        draft = self.call(self.admin, "preview", {"csv": canvas_csv()})["draft"]
        publication = self.publish()
        for id_ in (draft["id"], publication["id"]):
            with self.assertRaises(APIError) as err:
                self.call(self.admin, "publish", {"draftId": id_})
            self.assertEqual(err.exception.status, 409)

    def test_failure_cannot_move_current_pointer(self):
        first = self.publish()
        draft = self.call(self.admin, "preview", {"csv": canvas_csv(kc="9")})["draft"]
        self.repo.fail_transaction = True
        with self.assertRaises(Conflict):
            self.call(self.admin, "publish", {"draftId": draft["id"]})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], first["id"])

    def test_restore_preserves_history_and_checks_current(self):
        first, second = self.publish(), self.publish(canvas_csv(kc="9"))
        with self.assertRaises(APIError):
            self.call(self.admin, "restore", {"publicationId": first["id"], "expectedCurrent": first["id"]})
        self.call(self.admin, "restore", {"publicationId": first["id"], "expectedCurrent": second["id"]})
        report = self.call(self.student, "report", method="GET")
        self.assertEqual(report["student"]["kc"], 70)
        self.assertEqual(len(report["history"]), 2)

    def test_draft_cannot_be_published_by_another_instructor(self):
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        draft = self.call(self.admin, "preview", {"csv": canvas_csv()})["draft"]
        with self.assertRaises(APIError):
            self.call(self.instructor, "publish", {"draftId": draft["id"]})

    def test_no_released_activities_cannot_be_published(self):
        draft = self.call(self.admin, "preview", {"csv": canvas_csv(), "activeIds": []})["draft"]
        with self.assertRaises(APIError):
            self.call(self.admin, "publish", {"draftId": draft["id"]})

    def test_preview_keeps_previously_active_activity_below_heuristic(self):
        # Turma com 6 alunos: o Lab só tem 2 notas preenchidas na primeira semana
        # (abaixo do limite automático de 5), mas o instrutor libera manualmente.
        first_draft = self.call(self.admin, "preview", {
            "csv": sparse_lab_csv(lab_filled=2),
            "activeIds": ["001 KC (1)", "002 Lab (2)"],
        })["draft"]
        self.call(self.admin, "publish", {"draftId": first_draft["id"]})
        # Semana seguinte: o Lab segue com poucas notas (3), abaixo do limite
        # automático. Sem seleção explícita, a prévia deve mantê-lo liberado.
        second = self.call(self.admin, "preview", {"csv": sparse_lab_csv(lab_filled=3)})
        lab = next(a for a in second["activities"] if a["id"] == "002 Lab (2)")
        self.assertTrue(lab["active"])
        self.assertEqual(second["changes"]["activitiesPaused"], [])
        # Uma atividade nova, ainda pouco preenchida, continua seguindo a
        # sugestão automática (não vem liberada por padrão).
        with_new_activity = self.call(self.admin, "preview", {"csv": sparse_lab_csv(lab_filled=3, extra_activity=True)})
        extra = next(a for a in with_new_activity["activities"] if a["id"] == "003 Lab (3)")
        self.assertFalse(extra["active"])

    def test_preview_still_honors_explicit_selection(self):
        first_draft = self.call(self.admin, "preview", {
            "csv": sparse_lab_csv(lab_filled=2),
            "activeIds": ["001 KC (1)", "002 Lab (2)"],
        })["draft"]
        self.call(self.admin, "publish", {"draftId": first_draft["id"]})
        # Se o instrutor desmarcar explicitamente, a escolha dele prevalece.
        updated = self.call(self.admin, "preview", {
            "csv": sparse_lab_csv(lab_filled=3), "activeIds": ["001 KC (1)"],
        })
        lab = next(a for a in updated["activities"] if a["id"] == "002 Lab (2)")
        self.assertFalse(lab["active"])

    def test_class_report_includes_names_but_no_private_fields(self):
        publication = self.publish(canvas_csv(extra=["Outro Aluno", "202", "other@example.test", "8", "100", "0"]))
        report = class_report(self.repo, "BRSA0267")
        self.assertEqual(len(report["students"]), 2)
        self.assertIn("Outro Aluno", [s["name"] for s in report["students"]])
        encoded = json.dumps(report)
        for private in ("@", "canvasId", '"id"', "snapshot", "source.csv", "publishedBy", "filename", publication["id"]):
            self.assertNotIn(private, encoded)
        self.assertEqual(set(report), {"cohort", "updatedAt", "thresholds", "students"})
        self.assertEqual(set(report["students"][0]), {"name", "kc", "lab", "total", "completed", "pending", "status"})
        self.assertEqual({s["status"] for s in report["students"]}, {"ok", "attention"})

    def test_class_report_status_matches_personal_report_before_rounding(self):
        self.publish(canvas_csv(kc="6.99999", lab="94.99999"))
        personal = self.call(self.student, "report", method="GET")["student"]
        report = class_report(self.repo, "BRSA0267")["students"][0]
        self.assertEqual((report["kc"], report["lab"]), (70, 95))
        self.assertEqual(report["status"], "critical")
        self.assertEqual(report["status"], personal["status"])
        self.assertNotIn("activities", report)

    def test_display_name_preserves_identity_and_survives_csv_and_restore(self):
        first = self.publish()
        original = self.call(self.student, "report", method="GET")["student"]
        self.repo.put("COHORT#BRSA0267", "PROFILE#101", {"canvasId": "101", "displayName": "Marina"})
        personal = self.call(self.student, "report", method="GET")["student"]
        self.assertEqual(personal, {**original, "name": "Marina"})
        self.assertEqual(self.call(self.admin, "report", method="GET")["students"][0]["name"], "Marina")
        self.assertEqual(class_report(self.repo, "BRSA0267")["students"][0]["name"], "Marina")
        preview = self.call(self.admin, "preview", {"csv": canvas_csv()})
        self.assertEqual(preview["students"][0]["name"], "Marina")
        self.call(self.admin, "publish", {"draftId": preview["draft"]["id"]})
        self.assertEqual(self.call(self.student, "report", method="GET")["student"]["name"], "Marina")
        self.call(self.admin, "restore", {"publicationId": first["id"], "expectedCurrent": preview["draft"]["id"]})
        self.assertEqual(self.call(self.student, "report", method="GET")["student"]["name"], "Marina")
        self.assertEqual(self.repo.snapshot(first["snapshot"])["students"][0]["name"], original["name"])
    def test_guest_cannot_see_drafts_and_requires_existing_cohort(self):
        self.call(self.admin, "preview", {"csv": canvas_csv()})
        self.assertEqual(class_report(self.repo, "BRSA0267")["students"], [])
        with self.assertRaises(APIError):
            class_report(self.repo, "NO-SUCH-COHORT")
        with self.assertRaises(APIError):
            class_report(self.repo, "../BRSA0267")

    def test_no_grade_route_bypasses_authentication(self):
        for path in ("/guest/cohorts/BRSA0267", "/cohorts/BRSA0267/class-report",
                     "/cohorts/BRSA0267/report"):
            for method in ("GET", "POST"):
                with self.subTest(path=path, method=method), patch("portal.Repository") as repo:
                    result = handler({"rawPath": path, "requestContext": {"http": {"method": method}}}, None)
                    self.assertEqual(result["statusCode"], 401)
                    repo.assert_not_called()

    def test_class_report_requires_current_membership_or_teaching_access(self):
        self.publish(canvas_csv(extra=["Outro Aluno", "202", "other@example.test", "8", "100", "0"]))
        with self.assertRaises(APIError) as err:
            self.call(self.student, "class-report", method="GET")
        self.assertEqual(err.exception.status, 403)
        self.assertEqual(len(self.call(self.admin, "class-report", method="GET")["students"]), 2)
        outsider = Portal(self.repo, {"sub": "outsider", "email": "outsider@example.test", "groups": []})
        for actor in (outsider, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "class-report", method="GET")
            self.assertEqual(err.exception.status, 403)
        self.instructor.dispatch("POST", "/access-request", {})
        self.call(self.admin, "instructors", {"userId": "teacher"})
        self.assertEqual(len(self.call(self.instructor, "class-report", method="GET")["students"]), 2)
        self.call(self.admin, "revoke-instructor", {"userId": "teacher"})
        with self.assertRaises(APIError):
            self.call(self.instructor, "class-report", method="GET")
        self.publish(canvas_csv(email="other@example.test", student_id="202"))
        with self.assertRaises(APIError):
            self.call(self.student, "class-report", method="GET")

    def test_class_report_route_hides_private_fields_and_old_guest_route_is_removed(self):
        self.publish()
        event = {"rawPath": "/cohorts/BRSA0267/class-report", "requestContext": {"http": {"method": "GET"}}}
        with patch("portal.authenticate", return_value=self.admin.user), patch("portal.Repository", return_value=self.repo), patch.dict("os.environ", {"INSTRUCTOR_EMAIL_DOMAIN": "escoladanuvem.org"}):
            result = handler(event, None)
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(result["headers"]["Cache-Control"], "no-store")
            row = json.loads(result["body"])["students"][0]
            self.assertEqual(set(row), {"name", "kc", "lab", "total", "completed", "pending", "status"})
            event["rawPath"] = "/guest/cohorts/BRSA0267"
            self.assertEqual(handler(event, None)["statusCode"], 404)


    def test_students_search_finds_by_name_email_or_canvas_id_and_shows_binding(self):
        self.publish()
        self.call(self.student, "report", method="GET")
        for query in ("marina", "aluno@example.test", "101"):
            with self.subTest(query=query):
                result = self.call(self.admin, "students-search", {"query": query})["results"]
                self.assertEqual(len(result), 1)
                row = result[0]
                self.assertEqual(row["id"], "101")
                self.assertTrue(row["bound"])
                self.assertEqual(row["boundEmail"], "aluno@example.test")
        self.assertEqual(self.call(self.admin, "students-search", {"query": "não existe"})["results"], [])

    def test_students_search_and_admin_actions_require_admin(self):
        self.publish()
        for actor in (self.student, self.instructor):
            for op, body in (("students-search", {"query": "a"}), ("unlink-student", {"canvasId": "101"}),
                              ("display-name", {"canvasId": "101", "displayName": "X"})):
                with self.subTest(actor=actor.uid, op=op), self.assertRaises(APIError) as err:
                    self.call(actor, op, body)
                self.assertEqual(err.exception.status, 403)

    def test_unlink_student_allows_rebinding_by_email(self):
        self.publish()
        self.call(self.student, "report", method="GET")
        self.assertIsNotNone(self.repo.get("USER#student", "STUDY#BRSA0267"))
        self.call(self.admin, "unlink-student", {"canvasId": "101"})
        self.assertIsNone(self.repo.get("USER#student", "STUDY#BRSA0267"))
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "OWNER#101"))
        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#")]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "unlink-student")
        other = Portal(self.repo, {"sub": "student2", "email": "aluno@example.test", "groups": []}, mailer=self.mailer)
        self.assertEqual(self.call(other, "report", method="GET")["student"]["id"], "101")

    def test_unlink_student_requires_existing_binding(self):
        self.publish()
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "unlink-student", {"canvasId": "101"})
        self.assertEqual(err.exception.status, 404)

    def test_display_name_updates_and_audits(self):
        self.publish()
        result = self.call(self.admin, "display-name", {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(result, {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "PROFILE#101"), {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(self.call(self.admin, "report", method="GET")["students"][0]["name"], "Apelido")
        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#")]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "display-name")

    def test_settings_update_thresholds_and_canvas_course_id_and_audit(self):
        self.publish()
        report = self.call(self.admin, "report", method="GET")
        self.assertEqual(report["thresholds"], {"kc": 70, "lab": 95})
        self.assertIsNone(report["canvasCourseId"])
        self.assertEqual(report["students"][0]["status"], "attention")  # kc 70% ok, lab 50% abaixo de 95%

        result = self.call(self.admin, "settings", {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "4436"})
        self.assertEqual(result, {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "4436"})

        report = self.call(self.admin, "report", method="GET")
        self.assertEqual(report["thresholds"], {"kc": 60, "lab": 40})
        self.assertEqual(report["canvasCourseId"], "4436")
        self.assertEqual(report["students"][0]["status"], "ok")  # 70% e 50% acima dos novos limites
        student_report = self.call(self.student, "report", method="GET")
        self.assertEqual(student_report["thresholds"], {"kc": 60, "lab": 40})
        self.assertEqual(student_report["canvasCourseId"], "4436")

        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#")]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "settings")

    def test_settings_requires_admin_and_validates_input(self):
        self.publish()
        for actor in (self.student, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "settings", {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": None})
            self.assertEqual(err.exception.status, 403)
        for body in (
            {"thresholds": {"kc": 60, "lab": 40}},
            {"thresholds": {"kc": 0, "lab": 40}, "canvasCourseId": None},
            {"thresholds": {"kc": 60, "lab": 101}, "canvasCourseId": None},
            {"thresholds": {"kc": 60}, "canvasCourseId": None},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "abc"},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": ""},
        ):
            with self.subTest(body=body), self.assertRaises(APIError) as err:
                self.call(self.admin, "settings", body)
            self.assertEqual(err.exception.status, 400)

    def test_reject_request_only_pending_and_admin_only(self):
        self.instructor.dispatch("POST", "/access-request", {})
        with self.assertRaises(APIError) as err:
            self.instructor.dispatch("POST", "/requests/teacher/reject", {})
        self.assertEqual(err.exception.status, 403)
        result = self.admin.dispatch("POST", "/requests/teacher/reject", {})
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.repo.get("REQUESTS", "teacher")["status"], "rejected")
        with self.assertRaises(APIError) as err:
            self.admin.dispatch("POST", "/requests/teacher/reject", {})
        self.assertEqual(err.exception.status, 409)


class AuthenticationTests(unittest.TestCase):
    def event(self):
        return {"headers": {"authorization": "Bearer secret"}, "requestContext": {"authorizer": {"jwt": {"claims": {
            "sub": "abc", "token_use": "access", "scope": "openid portal/access"}}}}}

    def test_missing_authorizer_denied_before_aws(self):
        self.assertEqual(handler({}, None)["statusCode"], 401)

    @patch.dict("os.environ", {"AUTH_DOMAIN": "https://auth.example.test"})
    @patch("urllib.request.urlopen")
    def test_unverified_or_wrong_userinfo_rejected(self, urlopen):
        import io
        for info in ({"sub":"abc","email_verified":False}, {"sub":"other","email_verified":True}):
            urlopen.return_value.__enter__.return_value = io.StringIO(json.dumps(info))
            with self.assertRaises(APIError):
                authenticate(self.event())

    @patch("urllib.request.urlopen")
    def test_email_claim_from_access_token_skips_userinfo(self, urlopen):
        event = self.event()
        event["requestContext"]["authorizer"]["jwt"]["claims"].update(
            {"email": "Aluno@Example.TEST", "email_verified": "true"})
        user = authenticate(event)
        self.assertEqual(user["email"], "aluno@example.test")
        urlopen.assert_not_called()

    @patch("urllib.request.urlopen")
    def test_unverified_email_claim_rejected_without_calling_userinfo(self, urlopen):
        event = self.event()
        event["requestContext"]["authorizer"]["jwt"]["claims"].update(
            {"email": "aluno@example.test", "email_verified": "false"})
        with self.assertRaises(APIError) as err:
            authenticate(event)
        self.assertEqual(err.exception.status, 403)
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()

import copy
import csv
import io
import json
import unittest
from unittest.mock import patch

from grades import parse_csv
from integrity import SYNC_MIN_ROSTER, check as integrity_check, email_hash, roster_record
from portal import APIError, Portal, authenticate, handler, class_report
from repository import Conflict
from test_grades import canvas_csv


def class_csv(extra_ids=(), kc="7", marina=True):
    """Marina (101, aluno@example.test) e um colega por ID extra; turmas com mais de dois alunos
    permitem remover um sem cair abaixo do mínimo de 80% (integrity.SYNC_MIN_ROSTER)."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Student", "ID", "SIS Login ID", "001 KC (123)", "002 Lab (456)", "Graduated Final Points"])
    writer.writerow(["Points Possible", "", "", "10", "100", "1"])
    if marina:
        writer.writerow(["Costa, Marina", "101", "aluno@example.test", kc, "50", "0"])
    for i in extra_ids:
        writer.writerow([f"Aluno{i}, Colega", i, f"colega{i}@example.test", "8", "100", "0"])
    return out.getvalue()


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
        self.tags = {}
        self.ttl = {}
        self.fail_transaction = False

    def get(self, pk, sk):
        return copy.deepcopy(self.items.get((pk, sk)))

    def put(self, pk, sk, data, absent=False, ttl_days=None):
        if absent and (pk, sk) in self.items:
            raise Conflict()
        self.items[pk, sk] = copy.deepcopy(data)
        if ttl_days:
            self.ttl[pk, sk] = ttl_days
        else:
            self.ttl.pop((pk, sk), None)

    def list(self, pk, prefix=""):
        return [copy.deepcopy(v) for (p, s), v in self.items.items() if p == pk and s.startswith(prefix)]

    def keys(self, pk, prefix):
        return [s for (p, s) in self.items if p == pk and s.startswith(prefix)]

    def cohorts(self):
        # Como Repository.cohorts: só COHORT#…/METADATA (CATALOG# e ROSTER# também usam METADATA).
        return [copy.deepcopy(v) for (p, s), v in self.items.items() if s == "METADATA" and p.startswith("COHORT#")]

    def transaction(self, writes):
        if self.fail_transaction or any(self.get(p, s) != old for p, s, data, old in writes):
            raise Conflict()
        for p, s, data, old in writes:
            if data is None:
                self.items.pop((p, s), None)
            else:
                self.put(p, s, data)

    def snapshot(self, key, value=None, raw=False, status=None):
        if value is not None:
            self.files[key] = copy.deepcopy(value)
            if status:
                self.tags[key] = status
            return None
        return copy.deepcopy(self.files[key])

    def mark(self, key, status):
        self.tags[key] = status


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
        self.publish(class_csv(["202", "203", "204", "205"]))
        with self.assertRaises(APIError) as err:
            self.call(self.student, "class-report", method="GET")
        self.assertEqual(err.exception.status, 403)
        self.assertEqual(len(self.call(self.admin, "class-report", method="GET")["students"]), 5)
        outsider = Portal(self.repo, {"sub": "outsider", "email": "outsider@example.test", "groups": []})
        for actor in (outsider, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "class-report", method="GET")
            self.assertEqual(err.exception.status, 403)
        self.instructor.dispatch("POST", "/access-request", {})
        self.call(self.admin, "instructors", {"userId": "teacher"})
        self.assertEqual(len(self.call(self.instructor, "class-report", method="GET")["students"]), 5)
        self.call(self.admin, "revoke-instructor", {"userId": "teacher"})
        with self.assertRaises(APIError):
            self.call(self.instructor, "class-report", method="GET")
        self.publish(class_csv(["202", "203", "204", "205"], marina=False))
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
        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#") and v["action"] != "publish"]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "unlink-student")
        other = Portal(self.repo, {"sub": "student2", "email": "aluno@example.test", "groups": []}, mailer=self.mailer)
        self.assertEqual(self.call(other, "report", method="GET")["student"]["id"], "101")

    def test_instructor_report_shows_who_never_opened_the_portal(self):
        self.publish()
        linked = lambda: {s["id"]: s["portalLinked"] for s in self.call(self.admin, "report", method="GET")["students"]}
        self.assertEqual(linked(), {"101": False})
        self.call(self.student, "report", method="GET")  # primeiro acesso vincula a matrícula
        self.assertEqual(linked(), {"101": True})
        self.call(self.admin, "unlink-student", {"canvasId": "101"})
        self.assertEqual(linked(), {"101": False})
        self.assertNotIn("students", self.call(self.student, "report", method="GET"))  # aluno não vê a turma

    def test_unlink_student_requires_existing_binding(self):
        self.publish()
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "unlink-student", {"canvasId": "101"})
        self.assertEqual(err.exception.status, 404)

    def student_view_state(self):
        """Tudo o que não é auditoria: vínculos, publicações, rascunhos e arquivos."""
        items = {k: v for k, v in self.repo.items.items() if not k[1].startswith("AUDIT#")}
        return copy.deepcopy(items), copy.deepcopy(self.repo.files)

    def view_audits(self):
        return [v for (p, s), v in self.repo.items.items()
                if s.startswith("AUDIT#") and v["action"] == "STUDENT_VIEW_AS_ADMIN"]

    def test_student_view_matches_student_report(self):
        other = ["Private Other Name", "202", "other@example.test", "3", "90", "0"]
        first = self.publish(canvas_csv(extra=other))
        self.call(self.admin, "focus-activities", {"activityIds": ["001 KC (123)"],
                                                   "expectedCurrent": first["id"], "expectedVersion": None})
        self.call(self.admin, "display-name", {"canvasId": "101", "displayName": "Marina Exibição"})
        self.publish(canvas_csv(kc="9", lab="100", extra=other))
        own = self.call(self.student, "report", method="GET")
        viewed = self.call(self.admin, "student-view", {"studentId": "101"})
        self.assertEqual(viewed.pop("viewAs"), {"studentId": "101", "name": "Marina Exibição"})
        self.assertEqual(viewed, own)
        self.assertEqual(len(viewed["history"]), 2)
        self.assertEqual(viewed["focus"]["activityIds"], ["001 KC (123)"])
        for private in ("Private Other Name", "other@example.test", '"id": "202"'):
            self.assertNotIn(private, json.dumps(viewed))

    def test_student_view_is_read_only_and_never_binds(self):
        self.publish()
        before = self.student_view_state()
        self.call(self.admin, "student-view", {"studentId": "101"})
        self.assertEqual(self.student_view_state(), before)
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "OWNER#101"))
        self.assertEqual(self.repo.list("USER#admin", "STUDY#"), [])
        # O aluno real continua podendo se vincular normalmente depois da visualização.
        self.assertEqual(self.call(self.student, "report", method="GET")["student"]["id"], "101")
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "OWNER#101")["userId"], "student")

    def test_student_view_audits_each_opening_without_secrets(self):
        self.publish()
        self.call(self.admin, "student-view", {"studentId": "101"})
        self.call(self.admin, "student-view", {"studentId": "101"})
        audits = self.view_audits()
        self.assertEqual(len(audits), 2)
        self.assertEqual(set(audits[0]), {"action", "by", "byEmail", "studentId", "cohort", "at"})
        self.assertEqual((audits[0]["by"], audits[0]["byEmail"], audits[0]["studentId"], audits[0]["cohort"]),
                         ("admin", "admin@example.test", "101", "BRSA0267"))

    def test_student_view_requires_admin(self):
        self.publish()
        self.call(self.student, "report", method="GET")
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        for actor in (self.student, self.instructor):
            with self.subTest(actor=actor.uid), self.assertRaises(APIError) as err:
                self.call(actor, "student-view", {"studentId": "101"})
            self.assertEqual(err.exception.status, 403)
        self.assertEqual(self.view_audits(), [])

    def test_student_view_rejects_unknown_or_other_cohort_students(self):
        self.publish()
        self.admin.dispatch("POST", "/cohorts", {"code": "BRSA0268"})
        draft = self.call(self.admin, "preview", {"csv": canvas_csv(student_id="303", email="outro@example.test")},
                          code="BRSA0268")
        self.call(self.admin, "publish", {"draftId": draft["draft"]["id"], "acknowledgeRemoved": True}, code="BRSA0268")
        before = self.student_view_state()
        cases = [("BRSA0267", {"studentId": "999999"}, 404), ("BRSA0267", {"studentId": "303"}, 404),
                 ("BRSA0268", {"studentId": "101"}, 404), ("BRSA0267", {"studentId": 101}, 400),
                 ("BRSA0267", {"studentId": "101 "}, 400), ("BRSA0267", {"studentId": "../101"}, 400),
                 ("BRSA0267", {"studentId": ["101"]}, 400), ("BRSA0267", {"studentId": "101", "role": "student"}, 400),
                 ("BRSA0267", {}, 400), ("BRSA9999", {"studentId": "101"}, 404)]
        for code, body, status in cases:
            with self.subTest(code=code, body=body), self.assertRaises(APIError) as err:
                self.admin.dispatch("POST", f"/cohorts/{code}/student-view", body)
            self.assertEqual(err.exception.status, status)
            self.assertNotIn("Marina", err.exception.message)
        self.assertEqual(self.student_view_state(), before)
        self.assertEqual(self.view_audits(), [])

    def test_student_view_route_through_handler(self):
        self.publish()
        event = {"rawPath": "/cohorts/BRSA0267/student-view", "requestContext": {"http": {"method": "POST"}},
                 "body": json.dumps({"studentId": "101"})}
        env = patch.dict("os.environ", {"INSTRUCTOR_EMAIL_DOMAIN": "escoladanuvem.org"})
        for actor, status in ((self.admin, 200), (self.student, 403), (self.instructor, 403)):
            with self.subTest(actor=actor.uid), env, patch("portal.authenticate", return_value=actor.user), \
                    patch("portal.Repository", return_value=self.repo):
                result = handler(event, None)
                self.assertEqual(result["statusCode"], status)
                self.assertEqual(result["headers"]["Cache-Control"], "no-store")
                if status != 200:
                    self.assertNotIn("Marina", result["body"])
        with env, patch("portal.authenticate", return_value=self.admin.user), patch("portal.Repository", return_value=self.repo):
            self.assertEqual(handler({**event, "body": json.dumps({"studentId": "999999"})}, None)["statusCode"], 404)
            self.assertEqual(handler({**event, "requestContext": {"http": {"method": "GET"}}}, None)["statusCode"], 404)
        self.assertEqual(len(self.view_audits()), 1)

    def test_student_view_without_publication_is_not_found(self):
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "student-view", {"studentId": "101"})
        self.assertEqual(err.exception.status, 404)

    def test_display_name_updates_and_audits(self):
        self.publish()
        result = self.call(self.admin, "display-name", {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(result, {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "PROFILE#101"), {"canvasId": "101", "displayName": "Apelido"})
        self.assertEqual(self.call(self.admin, "report", method="GET")["students"][0]["name"], "Apelido")
        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#") and v["action"] != "publish"]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "display-name")

    def test_draft_files_expire_unless_published(self):
        draft = self.call(self.admin, "preview", {"csv": canvas_csv()})["draft"]
        folder = draft["snapshot"].rsplit("/", 1)[0]
        self.assertEqual(self.repo.tags[folder + "/source.csv"], "draft")
        self.assertEqual(self.repo.tags[folder + "/snapshot.json"], "draft")
        self.assertEqual(self.repo.ttl["COHORT#BRSA0267", "DRAFT#" + draft["id"]], 30)
        self.call(self.admin, "publish", {"draftId": draft["id"]})
        self.assertEqual(self.repo.tags[folder + "/source.csv"], "published")
        self.assertEqual(self.repo.tags[folder + "/snapshot.json"], "published")
        self.assertNotIn(("COHORT#BRSA0267", "DRAFT#" + draft["id"]), self.repo.ttl)

    def test_old_draft_cannot_be_published(self):
        draft = self.call(self.admin, "preview", {"csv": canvas_csv()})["draft"]
        stored = self.repo.get("COHORT#BRSA0267", "DRAFT#" + draft["id"])
        self.repo.items["COHORT#BRSA0267", "DRAFT#" + draft["id"]] = {**stored, "createdAt": "2020-01-01T00:00:00+00:00"}
        with self.assertRaises(APIError) as err:
            self.call(self.admin, "publish", {"draftId": draft["id"]})
        self.assertEqual(err.exception.status, 409)
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "METADATA")["current"])

    def test_release_date_is_kept_across_publications_and_new_ones_get_their_own(self):
        csv_one = sparse_lab_csv(lab_filled=6)  # KC e LAB liberados
        first = self.publish(csv_one)
        kc_date = first["releasedAt"]["001 KC (1)"]
        second = self.publish(sparse_lab_csv(lab_filled=6, extra_activity=True))
        self.assertEqual(second["releasedAt"]["001 KC (1)"], kc_date)
        self.assertEqual(second["releasedAt"]["003 Lab (3)"], second["publishedAt"])
        report = self.call(self.admin, "report", method="GET")
        by_id = {a["id"]: a for a in report["activities"]}
        self.assertEqual(by_id["001 KC (1)"]["releasedAt"], kc_date)
        self.assertNotIn("releasedAt", report["history"][0])  # lista de publicações não carrega o mapa

    def test_legacy_publication_without_release_map_uses_its_date(self):
        first = self.publish(sparse_lab_csv(lab_filled=6))
        legacy = {k: v for k, v in self.repo.get("COHORT#BRSA0267", "PUB#" + first["id"]).items() if k != "releasedAt"}
        self.repo.put("COHORT#BRSA0267", "PUB#" + first["id"], legacy)
        second = self.publish(sparse_lab_csv(lab_filled=6))
        self.assertEqual(second["releasedAt"]["001 KC (1)"], first["publishedAt"])

    def test_settings_update_thresholds_and_canvas_course_id_and_audit(self):
        self.publish()
        report = self.call(self.admin, "report", method="GET")
        self.assertEqual(report["thresholds"], {"kc": 70, "lab": 95})
        self.assertIsNone(report["canvasCourseId"])
        self.assertEqual(report["students"][0]["status"], "attention")  # kc 70% ok, lab 50% abaixo de 95%

        result = self.call(self.admin, "settings", {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "4436", "autoSync": False})
        self.assertEqual(result, {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "4436", "autoSync": False})

        report = self.call(self.admin, "report", method="GET")
        self.assertEqual(report["thresholds"], {"kc": 60, "lab": 40})
        self.assertEqual(report["canvasCourseId"], "4436")
        self.assertEqual(report["students"][0]["status"], "ok")  # 70% e 50% acima dos novos limites
        student_report = self.call(self.student, "report", method="GET")
        self.assertEqual(student_report["thresholds"], {"kc": 60, "lab": 40})
        self.assertEqual(student_report["canvasCourseId"], "4436")

        audits = [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#") and v["action"] != "publish"]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["action"], "settings")

    def test_settings_requires_admin_and_validates_input(self):
        self.publish()
        for actor in (self.student, self.instructor):
            with self.assertRaises(APIError) as err:
                self.call(actor, "settings", {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": None, "autoSync": False})
            self.assertEqual(err.exception.status, 403)
        for body in (
            {"thresholds": {"kc": 60, "lab": 40}, "autoSync": False},
            {"thresholds": {"kc": 0, "lab": 40}, "canvasCourseId": None, "autoSync": False},
            {"thresholds": {"kc": 60, "lab": 101}, "canvasCourseId": None, "autoSync": False},
            {"thresholds": {"kc": 60}, "canvasCourseId": None, "autoSync": False},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "abc", "autoSync": False},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "", "autoSync": False},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": "4436", "autoSync": "sim"},
            {"thresholds": {"kc": 60, "lab": 40}, "canvasCourseId": None, "autoSync": True},
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



# IDs reais das tarefas (só números) dos dois cursos em produção em 26/09/2026: catálogo de
# módulos (CATALOG#) e colunas KC/LAB do CSV de cada turma. Servem para provar que a regra de
# maioria separa as duas turmas sem exigir que o catálogo esteja completo.
def _ids(*ranges):
    return [str(i) for a, b in ranges for i in range(a, b + 1)]


CATALOG_4413 = _ids((639129, 639205), (639207, 639210))
CATALOG_4436 = _ids((643101, 643271), (643273, 643278), (643280, 643280))
CSV_BRSA0257 = _ids((639129, 639203))
CSV_BRSA0267 = _ids((643101, 643266))
CAPTURED_AT = "2026-09-26T04:45:58+00:00"


def course_file(student_ids, assignment_ids=CSV_BRSA0267[:6], emails=None, section="BRSAO267"):
    """CSV como o export do Canvas (com Section), um aluno por ID; e-mail padrão alunoID@."""
    emails = emails or {}
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Student", "ID", "SIS User ID", "SIS Login ID", "Section"]
                    + [f"{i:03d} KC Atividade ({a})" for i, a in enumerate(assignment_ids, 1)] + ["Graduated Final Points"])
    writer.writerow(["Points Possible", "", "", "", ""] + ["10"] * len(assignment_ids) + ["1"])
    for sid in student_ids:
        writer.writerow([f"Aluno{sid}, Nome", sid, "", emails.get(sid, f"aluno{sid}@example.test"), section]
                        + ["8"] + [""] * (len(assignment_ids) - 1) + ["0"])
    return out.getvalue()


def enrolled(student_ids, emails=None):
    emails = emails or {}
    return [{"id": int(sid), "login_id": emails.get(sid, f"aluno{sid}@example.test")} for sid in student_ids]


STUDENTS = [str(126400 + i) for i in range(10)]


class IntegrityRuleTests(unittest.TestCase):
    def report(self, csv_text, roster_ids=STUDENTS, catalog=CATALOG_4436, current=None, filename="notas.csv",
               roster_emails=None, course="4436"):
        roster = roster_record(course, enrolled(roster_ids, roster_emails), CAPTURED_AT) if roster_ids is not None else None
        cat = {"courseId": course, "modules": ["M"], "items": {a: {"module": 0, "url": "u"} for a in catalog}} if catalog else None
        return integrity_check(parse_csv(csv_text), canvas_course_id=course, roster=roster, catalog=cat,
                               current=current, filename=filename)

    codes = staticmethod(lambda items: [i["code"] for i in items])

    def test_email_hash_normalizes_trim_and_case(self):
        self.assertEqual(email_hash("  Upper@Email.com "), email_hash("upper@email.com"))
        self.assertNotEqual(email_hash("upper@email.com"), email_hash("other@email.com"))
        self.assertIsNone(email_hash(""))
        self.assertIsNone(email_hash(None))
        record = roster_record("4436", [{"id": 1, "login_id": "Upper@Email.com"}, {"id": 2, "email": "b@x.test"}], CAPTURED_AT)
        self.assertEqual(record, {"courseId": "4436", "capturedAt": CAPTURED_AT, "count": 2,
                                  "students": {"1": email_hash("upper@email.com"), "2": email_hash("b@x.test")}})
        self.assertNotIn("@", json.dumps(record))  # sem e-mail em claro

    def test_valid_complete_file_has_no_issues(self):
        r = self.report(course_file(STUDENTS))
        self.assertEqual((r["critical"], r["warnings"]), ([], []))
        self.assertEqual({k: r["summary"][k] for k in ("studentsExpected", "studentsFound", "studentsExtra", "studentsMissing",
                                                        "activitiesFound", "activitiesKnown", "rosterCapturedAt")},
                         {"studentsExpected": 10, "studentsFound": 10, "studentsExtra": 0, "studentsMissing": 0,
                          "activitiesFound": 6, "activitiesKnown": 6, "rosterCapturedAt": CAPTURED_AT})

    def test_extra_student_like_999999_is_critical_and_listed_by_canvas_id(self):
        r = self.report(course_file(STUDENTS + ["999999"], emails={"999999": "conta.ficticia@example.test"}))
        self.assertEqual(self.codes(r["critical"]), ["studentNotInRoster"])
        self.assertEqual(r["critical"][0]["ids"], ["999999"])
        self.assertNotIn("conta.ficticia", json.dumps(r))
        self.assertEqual(r["summary"]["studentsExtra"], 1)

    def test_missing_student_is_a_warning_until_the_class_drops_below_the_sync_limit(self):
        r = self.report(course_file(STUDENTS[:9]))
        self.assertEqual((self.codes(r["critical"]), self.codes(r["warnings"])), ([], ["studentsMissingFromFile"]))
        self.assertEqual(r["warnings"][0]["ids"], [STUDENTS[9]])
        self.assertEqual(SYNC_MIN_ROSTER, 0.8)
        self.assertEqual(self.codes(self.report(course_file(STUDENTS[:8]))["critical"]), [])  # 8/10 = limite
        self.assertEqual(self.codes(self.report(course_file(STUDENTS[:7]))["critical"]), ["rosterShrink"])

    def test_half_of_a_59_student_class_is_blocked_against_roster_and_current_publication(self):
        class_59 = [str(126400 + i) for i in range(59)]
        current = parse_csv(course_file(class_59))
        r = self.report(course_file(class_59[:30]), roster_ids=class_59, current=current)
        self.assertEqual(self.codes(r["critical"]), ["rosterShrink", "publicationShrink"])

    def test_same_canvas_id_with_different_email_is_only_a_warning(self):
        r = self.report(course_file(STUDENTS, emails={STUDENTS[0]: "novo.email@example.test"}))
        self.assertEqual((self.codes(r["critical"]), self.codes(r["warnings"])), ([], ["emailDiffersFromRoster"]))

    def test_email_of_another_enrolled_student_is_critical(self):
        # O dono do e-mail (STUDENTS[1]) não está no arquivo; senão o próprio parse_csv recusaria o duplicado.
        others = [sid for sid in STUDENTS if sid != STUDENTS[1]]
        stolen = {STUDENTS[0]: f"aluno{STUDENTS[1]}@example.test"}
        r = self.report(course_file(others, emails=stolen))
        self.assertEqual(self.codes(r["critical"]), ["emailBelongsToOtherStudent"])
        self.assertEqual(r["critical"][0]["ids"], [STUDENTS[0]])
        # Mesma comparação com maiúsculas e espaços (hash normalizado).
        shouting = {STUDENTS[0]: f"  ALUNO{STUDENTS[1]}@Example.TEST "}
        self.assertIn("emailBelongsToOtherStudent", self.codes(self.report(course_file(others, emails=shouting))["critical"]))
        self.assertEqual(self.codes(self.report(course_file(STUDENTS, emails={STUDENTS[0]: f"ALUNO{STUDENTS[0]}@EXAMPLE.TEST"}))["warnings"]), [])

    def test_real_assignment_ids_separate_the_two_classes(self):
        own = self.report(course_file(STUDENTS, CSV_BRSA0267))
        self.assertEqual((own["critical"], own["summary"]["activitiesKnown"]), ([], 166))
        other = self.report(course_file(STUDENTS, CSV_BRSA0257))
        self.assertEqual(self.codes(other["critical"]), ["activitiesFromOtherCourse"])
        self.assertEqual(other["summary"]["activitiesKnown"], 0)
        # O contrário também: CSV da 0267 contra o catálogo da 0257, e a 0257 contra o próprio curso.
        self.assertEqual(self.codes(self.report(course_file(STUDENTS, CSV_BRSA0267), catalog=CATALOG_4413, course="4413")["critical"]),
                         ["activitiesFromOtherCourse"])
        self.assertEqual(self.report(course_file(STUDENTS, CSV_BRSA0257), catalog=CATALOG_4413, course="4413")["critical"], [])

    def test_new_assignments_missing_from_the_catalog_are_not_a_false_positive(self):
        new = [str(700000 + i) for i in range(20)]
        r = self.report(course_file(STUDENTS, CSV_BRSA0267 + new))
        self.assertEqual((r["critical"], r["summary"]["activitiesKnown"], r["summary"]["activitiesFound"]), ([], 166, 186))

    def test_other_course_rule_scenarios(self):
        """Tarefas em comum < 50% do menor conjunto (arquivo ou referência) = arquivo de outra turma."""
        other_100 = [str(800000 + i) for i in range(100)]
        catalog_55 = CSV_BRSA0267[:55]
        scenarios = {
            "A mesmo curso, catálogo completo": (CSV_BRSA0267, CSV_BRSA0267, 166, False),
            "B CSV da 0257 contra o curso da 0267": (CSV_BRSA0257, CSV_BRSA0267, 0, True),
            "C 166 + 20 tarefas novas fora do catálogo": (CSV_BRSA0267 + [str(700000 + i) for i in range(20)], CSV_BRSA0267, 166, False),
            "D catálogo incompleto, 55 de 166": (CSV_BRSA0267, catalog_55, 55, False),
            "E outro curso, nenhuma em comum": (other_100, catalog_55, 0, True),
            "F outro curso, 3 coincidências": (other_100[:97] + catalog_55[:3], catalog_55, 3, True),
            "G arquivo legítimo com só 30 tarefas": (CSV_BRSA0267[:30], CSV_BRSA0267, 30, False),
        }
        for name, (csv_ids, catalog_ids, overlap, blocked) in scenarios.items():
            with self.subTest(name):
                r = self.report(course_file(STUDENTS, csv_ids), catalog=catalog_ids)
                self.assertEqual(r["summary"]["activitiesKnown"], overlap)
                self.assertEqual("activitiesFromOtherCourse" in self.codes(r["critical"]), blocked)

    def test_test_like_filename_is_only_a_warning(self):
        for name in ("BRSA0267-demo-tomas.csv", "notas_TESTE.csv", "mock.csv", "fixture-1.csv", "Test Export.csv"):
            r = self.report(course_file(STUDENTS), filename=name)
            self.assertEqual((r["critical"], self.codes(r["warnings"])), ([], ["testFilename"]), name)
            self.assertEqual(r["warnings"][0]["message"], "Este arquivo parece ser de teste.")
        for name in ("notas.csv", "2026-09-25T2147_Notas-BRSAO267.csv", "latest.csv", "contest.csv"):
            self.assertEqual(self.report(course_file(STUDENTS), filename=name)["warnings"], [], name)

    def test_normal_filename_does_not_hide_an_invalid_student(self):
        r = self.report(course_file(STUDENTS + ["999999"]), filename="notas.csv")
        self.assertEqual(self.codes(r["critical"]), ["studentNotInRoster"])

    def test_canvas_class_without_roster_is_blocked(self):
        r = self.report(course_file(STUDENTS), roster_ids=None)
        self.assertEqual(self.codes(r["critical"]), ["rosterUnavailable"])
        self.assertIn("Aguarde a próxima sincronização automática", r["critical"][0]["message"])

    def test_class_without_canvas_uses_the_current_publication(self):
        check = lambda text, current=None: integrity_check(parse_csv(text), current=current, filename="notas.csv")
        first = check(course_file(STUDENTS))  # primeira publicação: só a estrutura do parse_csv
        self.assertEqual((first["critical"], self.codes(first["warnings"])), ([], ["rosterNotVerified"]))
        self.assertEqual(first["warnings"][0]["message"], "Matrícula não conferida: turma sem curso Canvas configurado.")
        current = parse_csv(course_file(STUDENTS, CSV_BRSA0267))
        self.assertEqual(check(course_file(STUDENTS, CSV_BRSA0267), current)["critical"], [])
        self.assertEqual(self.codes(check(course_file(STUDENTS[:7], CSV_BRSA0267), current)["critical"]), ["publicationShrink"])
        self.assertEqual(self.codes(check(course_file(STUDENTS, CSV_BRSA0257), current)["critical"]), ["activitiesFromOtherCourse"])


class IntegrityPortalTests(unittest.TestCase):
    """Envio manual e Restore numa turma com Canvas (curso 4436), como a BRSA0267."""

    def setUp(self):
        self.repo = MemoryRepository()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "name": "Turma 267", "current": None, "canvasCourseId": "4436"})
        self.repo.put("CATALOG#4436", "METADATA", {"courseId": "4436", "modules": ["M"],
                                                    "items": {a: {"module": 0, "url": "u"} for a in CATALOG_4436}})
        self.save_roster(STUDENTS)
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})

    def save_roster(self, ids, emails=None):
        self.repo.put("ROSTER#4436", "METADATA", roster_record("4436", enrolled(ids, emails), CAPTURED_AT))

    def call(self, operation, body=None, method="POST"):
        return self.admin.dispatch(method, f"/cohorts/BRSA0267/{operation}", body or {})

    def preview(self, text, filename="notas.csv", **extra):
        return self.call("preview", {"csv": text, "filename": filename, **extra})

    def publish(self, text, filename="notas.csv"):
        return self.call("publish", {"draftId": self.preview(text, filename)["draft"]["id"], "acknowledgeRemoved": True})["publication"]

    def state(self):
        return copy.deepcopy(self.repo.items), copy.deepcopy(self.repo.files)

    def audits(self, action="publish"):
        return [v for (p, s), v in self.repo.items.items() if s.startswith("AUDIT#") and v["action"] == action]

    def test_valid_manual_publication_writes_audit_in_the_same_transaction(self):
        preview = self.preview(course_file(STUDENTS))
        self.assertEqual((preview["integrity"]["critical"], preview["integrity"]["summary"]["rosterCapturedAt"]), ([], CAPTURED_AT))
        with patch.object(self.repo, "transaction", wraps=self.repo.transaction) as tx:
            publication = self.call("publish", {"draftId": preview["draft"]["id"]})["publication"]
        keys = [sk.split("#")[0] for _, sk, _, _ in tx.call_args.args[0]]
        self.assertEqual(keys, ["METADATA", "DRAFT", "PUB", "AUDIT"])
        [audit] = self.audits()
        self.assertEqual(set(audit), {"action", "origin", "by", "byEmail", "cohort", "publicationId", "at", "filename",
                                      "students", "activities", "warnings"})
        self.assertEqual({k: audit[k] for k in ("action", "origin", "by", "byEmail", "cohort", "publicationId", "filename", "students", "activities", "warnings")},
                         {"action": "publish", "origin": "manual", "by": "admin", "byEmail": "admin@example.test", "cohort": "BRSA0267",
                          "publicationId": publication["id"], "filename": "notas.csv", "students": 10, "activities": 6, "warnings": []})
        self.assertEqual(audit["at"], publication["publishedAt"])
        text = json.dumps(audit).lower()
        for private in ("aluno", "1264", "grades", "csv\":", "token"):  # sem nome, e-mail, ID de aluno, notas, CSV
            self.assertNotIn(private, text)

    def test_audit_keeps_only_warning_codes_and_counts(self):
        self.publish(course_file(STUDENTS))
        self.publish(course_file(STUDENTS[:9] + [], emails={STUDENTS[0]: "novo@example.test"}), filename="BRSA0267-demo.csv")
        audit = max(self.audits(), key=lambda a: a["at"])
        self.assertEqual(sorted(audit["warnings"], key=lambda w: w["code"]),
                         [{"code": "emailDiffersFromRoster", "count": 1}, {"code": "studentsMissingFromFile", "count": 1},
                          {"code": "testFilename", "count": 1}])
        self.assertNotIn("novo@", json.dumps(audit))
        self.assertNotIn(STUDENTS[9], json.dumps(audit))

    def test_demo_like_file_with_999999_is_blocked_even_when_publish_is_called_directly(self):
        valid = self.publish(course_file(STUDENTS))
        demo = course_file(STUDENTS + ["999999"], emails={"999999": "conta.ficticia@example.test"})
        preview = self.preview(demo, filename="BRSA0267-demo-tomas.csv")
        self.assertEqual([i["code"] for i in preview["integrity"]["critical"]], ["studentNotInRoster"])
        self.assertEqual(preview["integrity"]["critical"][0]["ids"], ["999999"])
        self.assertEqual([i["code"] for i in preview["integrity"]["warnings"]], ["testFilename"])
        before = self.state()
        # Chamada direta ao backend, sem interface e mandando uma "integridade" forjada: o mesmo bloqueio.
        for body in ({"draftId": preview["draft"]["id"], "acknowledgeRemoved": True},
                     {"draftId": preview["draft"]["id"], "acknowledgeRemoved": True, "integrity": {"critical": []}}):
            with self.assertRaises(APIError) as err:
                self.call("publish", body)
            self.assertEqual(err.exception.status, 409)
            self.assertIn("999999", err.exception.message)
            self.assertNotIn("conta.ficticia", err.exception.message)
        self.assertEqual(self.state(), before)  # nada gravado: nem PUB, nem AUDIT, nem history.json
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], valid["id"])

    def test_preview_ignores_integrity_sent_by_the_client(self):
        forged = {"critical": [], "warnings": [], "summary": {"studentsExtra": 0}}
        preview = self.preview(course_file(STUDENTS + ["999999"]), integrity=forged)
        self.assertEqual(preview["integrity"]["summary"]["studentsExtra"], 1)

    def test_other_class_file_and_shrunken_class_are_blocked(self):
        self.publish(course_file(STUDENTS))
        for text in (course_file(STUDENTS, CSV_BRSA0257), course_file(STUDENTS[:7])):
            draft = self.preview(text)["draft"]["id"]
            with self.assertRaises(APIError) as err:
                self.call("publish", {"draftId": draft, "acknowledgeRemoved": True})
            self.assertEqual(err.exception.status, 409)

    def test_canvas_class_without_roster_previews_but_cannot_publish(self):
        del self.repo.items[("ROSTER#4436", "METADATA")]
        preview = self.preview(course_file(STUDENTS))
        self.assertEqual([i["code"] for i in preview["integrity"]["critical"]], ["rosterUnavailable"])
        self.assertIsNotNone(self.repo.get("COHORT#BRSA0267", "DRAFT#" + preview["draft"]["id"]))
        with self.assertRaises(APIError) as err:
            self.call("publish", {"draftId": preview["draft"]["id"]})
        self.assertEqual(err.exception.status, 409)
        self.assertIn("Matrícula do Canvas ainda não disponível para validação", err.exception.message)
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "METADATA")["current"])

    def restore(self, publication_id):
        return self.call("restore", {"publicationId": publication_id,
                                     "expectedCurrent": self.repo.get("COHORT#BRSA0267", "METADATA")["current"]})

    def test_restore_of_a_valid_publication_still_works(self):
        first = self.publish(course_file(STUDENTS))
        self.publish(course_file(STUDENTS, CSV_BRSA0267[:7]))
        self.assertEqual(self.restore(first["id"]), {"restored": True})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], first["id"])
        self.assertEqual(len(self.audits("restore")), 1)

    def test_restore_of_the_demo_publication_is_blocked_and_history_stays_visible(self):
        # Publicação equivalente à BRSA0267-demo-tomas.csv, feita antes destas validações
        # (turma ainda sem Canvas configurado), e depois a publicação real atual.
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "name": "Turma 267", "current": None})
        demo = self.publish(course_file(STUDENTS + ["999999"], emails={"999999": "conta.ficticia@example.test"}), "BRSA0267-demo-tomas.csv")
        self.repo.put("COHORT#BRSA0267", "METADATA", {**self.repo.get("COHORT#BRSA0267", "METADATA"), "canvasCourseId": "4436"})
        current = self.publish(course_file(STUDENTS))
        before = self.state()
        with self.assertRaises(APIError) as err:
            self.restore(demo["id"])
        self.assertEqual(err.exception.status, 409)
        self.assertTrue(err.exception.message.startswith(
            "Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade."))
        self.assertIn("999999", err.exception.message)
        self.assertEqual(self.state(), before)  # estado corrente idêntico, sem AUDIT de restore
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], current["id"])
        # O histórico continua consultável e imutável.
        history = self.call("report", method="GET")["history"]
        self.assertIn(demo["id"], [p["id"] for p in history])
        self.assertIn("999999", {s["id"] for s in self.repo.snapshot(demo["snapshot"])["students"]})

    def test_restore_is_blocked_when_a_student_left_the_canvas_class(self):
        old = self.publish(course_file(STUDENTS))
        self.save_roster(STUDENTS[:9] + ["126499"])  # um aluno saiu e outro entrou no Canvas
        self.publish(course_file(STUDENTS[:9] + ["126499"]))
        with self.assertRaises(APIError) as err:
            self.restore(old["id"])
        self.assertEqual(err.exception.status, 409)
        self.assertIn(STUDENTS[9], err.exception.message)

    def test_restore_allows_warnings(self):
        old = self.publish(course_file(STUDENTS[:9]), filename="teste.csv")  # 1 ausente + nome de teste
        self.publish(course_file(STUDENTS))
        self.assertEqual(self.restore(old["id"]), {"restored": True})

    def test_automatic_sync_is_not_checked_against_itself(self):
        from portal import sync_from_canvas
        # Mesmo sem ROSTER, a sincronização publica: os dados dela são a própria matrícula.
        del self.repo.items[("ROSTER#4436", "METADATA")]
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", course_file(STUDENTS), len(STUDENTS))["status"], "published")
        self.assertEqual(self.audits(), [])  # a sincronização continua registrando só em SYNC


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

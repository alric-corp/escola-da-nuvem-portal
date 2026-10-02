import copy
import csv
import io
import json
import unittest
import uuid
from unittest.mock import patch

from grades import parse_csv
import feedback as feedback_module
from datetime import datetime, timedelta, timezone
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
        self.expires = {}
        self.counters = {}
        self.fail_transaction = False
        # Bucket de anexos em memória: chave -> {"body", "contentType", "versions"}.
        self.feedback_files = {}
        self.file_calls = []

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

    def page(self, pk, prefix, limit, after=None):
        keys = sorted((s for (p, s) in self.items if p == pk and s.startswith(prefix)), reverse=True)
        if after:
            keys = [k for k in keys if k < after]
        return [(k, copy.deepcopy(self.items[pk, k])) for k in keys[:limit]], len(keys) <= limit

    def counter(self, pk, sk):
        return dict(self.counters.get((pk, sk), {}))

    def cohorts(self):
        # Como Repository.cohorts: só COHORT#…/METADATA (CATALOG# e ROSTER# também usam METADATA).
        return [copy.deepcopy(v) for (p, s), v in self.items.items() if s == "METADATA" and p.startswith("COHORT#")]

    def transaction(self, writes, counters=()):
        # Mesma semântica do Repository.transaction: tudo ou nada, com as mesmas condições.
        if self.fail_transaction or any(self.get(w[0], w[1]) != w[3] for w in writes):
            raise Conflict()
        for p, s, deltas, limit, expires_at in counters:
            current = self.counters.get((p, s), {})
            if limit and limit[0] in current and current[limit[0]] >= limit[1]:
                raise Conflict()
        for w in writes:
            p, s, data = w[:3]
            if data is None:
                self.items.pop((p, s), None)
                self.expires.pop((p, s), None)
            else:
                self.put(p, s, data)
                if len(w) > 4 and w[4]:
                    self.expires[p, s] = w[4]
        for p, s, deltas, limit, expires_at in counters:
            current = self.counters.setdefault((p, s), {})
            for name, delta in deltas.items():
                current[name] = current.get(name, 0) + delta
            if expires_at:
                self.expires[p, s] = expires_at

    def snapshot(self, key, value=None, raw=False, status=None):
        if value is not None:
            self.files[key] = copy.deepcopy(value)
            if status:
                self.tags[key] = status
            return None
        return copy.deepcopy(self.files[key])

    def mark(self, key, status):
        self.tags[key] = status

    def presign_upload(self, key, content_type, max_bytes, expires):
        self.file_calls.append(("presign_upload", key, content_type, max_bytes, expires))
        return {"url": "https://feedback-files.example.test/", "fields": {"key": key, "Content-Type": content_type, "policy": "p"}}

    def upload(self, key, body, content_type):
        """Simula o POST do navegador direto ao S3."""
        self.feedback_files[key] = {"body": body, "contentType": content_type, "version": uuid.uuid4().hex}

    def file_head(self, key):
        f = self.feedback_files.get(key)
        return {"size": len(f["body"]), "contentType": f["contentType"]} if f else None

    def file_start(self, key, length):
        return self.feedback_files[key]["body"][:length]

    def promote_file(self, source, target, content_type):
        self.file_calls.append(("promote_file", source, target, content_type))
        version = uuid.uuid4().hex
        self.feedback_files[target] = {**self.feedback_files[source], "contentType": content_type, "version": version}
        return version

    def delete_file(self, key, version_id=None):
        self.file_calls.append(("delete_file", key, version_id))
        f = self.feedback_files.get(key)
        if f and (version_id is None or f["version"] == version_id):
            del self.feedback_files[key]

    def presign_download(self, key, content_type, disposition, expires):
        self.file_calls.append(("presign_download", key, content_type, disposition, expires))
        return f"https://feedback-files.example.test/{key}?X-Amz-Expires={expires}"


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


class ParticipationTests(unittest.TestCase):
    """Status manual de participação do aluno na turma (ACTIVE/WITHDRAWN): persistência e API. Nenhum fluxo de
    leitura (relatório, métricas, lembretes) usa a marca ainda."""

    def setUp(self):
        self.repo = MemoryRepository()
        for code in ("BRSA0267", "BRSA0268"):
            self.repo.put("COHORT#" + code, "METADATA", {"code": code, "name": code, "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        self.teacher = Portal(self.repo, {"sub": "teacher", "email": "teacher@escoladanuvem.org", "groups": []})
        self.other_teacher = Portal(self.repo, {"sub": "teacher2", "email": "teacher2@escoladanuvem.org", "groups": []})
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []})
        self.outsider = Portal(self.repo, {"sub": "outsider", "email": "outsider@example.test", "groups": []})
        for actor, code in ((self.teacher, "BRSA0267"), (self.other_teacher, "BRSA0268")):
            actor.dispatch("POST", "/access-request", {})
            self.admin.dispatch("POST", f"/cohorts/{code}/instructors", {"userId": actor.uid})
        # Marina (101), 102 e 103 na 267; só 201 na 268.
        self.first = self.publish("BRSA0267", class_csv(["102", "103"]))
        self.publish("BRSA0268", class_csv(["201"], marina=False))

    def publish(self, code, text):
        draft = self.admin.dispatch("POST", f"/cohorts/{code}/preview", {"csv": text})["draft"]
        return self.admin.dispatch("POST", f"/cohorts/{code}/publish", {"draftId": draft["id"], "acknowledgeRemoved": True})["publication"]

    def mark(self, actor, canvas_id, status, expected, code="BRSA0267"):
        return actor.dispatch("POST", f"/cohorts/{code}/participation", {"canvasId": canvas_id, "status": status, "expectedStatus": expected})

    def item(self, canvas_id, code="BRSA0267"):
        return self.repo.get("COHORT#" + code, "PARTICIPATION#" + canvas_id)

    def audits(self, code="BRSA0267"):
        return [v for (p, s), v in self.repo.items.items() if p == "COHORT#" + code and s.startswith("AUDIT#") and v["action"] == "participation"]

    def status_of(self, call):
        with self.assertRaises(APIError) as err:
            call()
        return err.exception.status

    def test_withdrawing_an_active_student_stores_status_actor_time_and_audit(self):
        items, files = copy.deepcopy(self.repo.items), copy.deepcopy(self.repo.files)
        result = self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        at = result["updatedAt"]
        self.assertEqual(result, {"canvasId": "102", "participationStatus": "WITHDRAWN", "updatedAt": at})
        self.assertEqual(datetime.fromisoformat(at).utcoffset(), timedelta(0))
        self.assertEqual(self.item("102"), {"canvasId": "102", "status": "WITHDRAWN", "updatedAt": at, "updatedBy": "teacher"})
        self.assertEqual(self.audits(), [{"action": "participation", "canvasId": "102", "from": "ACTIVE", "to": "WITHDRAWN", "by": "teacher", "at": at}])
        # Só o registro e a auditoria são novos: snapshots, publicações, turma e vínculos ficam como estavam.
        added = {k for k in self.repo.items if k not in items}
        self.assertEqual({s.split("#")[0] for _, s in added}, {"PARTICIPATION", "AUDIT"})
        self.assertEqual({k: v for k, v in self.repo.items.items() if k in items}, items)
        self.assertEqual(self.repo.files, files)

    def test_reactivation_keeps_the_record_with_active_and_audits_it(self):
        self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        result = self.mark(self.admin, "102", "ACTIVE", "WITHDRAWN")
        self.assertEqual(result["participationStatus"], "ACTIVE")
        self.assertEqual(self.item("102"), {"canvasId": "102", "status": "ACTIVE", "updatedAt": result["updatedAt"], "updatedBy": "admin"})
        self.assertEqual(sorted((a["from"], a["to"], a["by"]) for a in self.audits()),
                         [("ACTIVE", "WITHDRAWN", "teacher"), ("WITHDRAWN", "ACTIVE", "admin")])

    def test_without_a_record_the_student_is_active_and_asking_for_active_writes_nothing(self):
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.mark(self.teacher, "102", "ACTIVE", "ACTIVE"), {"canvasId": "102", "participationStatus": "ACTIVE", "updatedAt": None})
        self.assertIsNone(self.item("102"))
        self.assertEqual(self.repo.items, items)
        from portal import participation
        self.assertEqual(participation(self.repo, "BRSA0267", "102"), (None, "ACTIVE"))

    def test_repeating_the_current_status_is_idempotent(self):
        first = self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.mark(self.admin, "102", "WITHDRAWN", "WITHDRAWN"), first)
        self.assertEqual(self.repo.items, items)
        reactivated = self.mark(self.admin, "102", "ACTIVE", "WITHDRAWN")
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.mark(self.teacher, "102", "ACTIVE", "ACTIVE"), reactivated)
        self.assertEqual(self.repo.items, items)
        self.assertEqual(len(self.audits()), 2)

    def test_only_admin_and_instructors_of_this_cohort_can_change_participation(self):
        items = copy.deepcopy(self.repo.items)
        for actor in (self.other_teacher, self.student, self.outsider):
            with self.subTest(actor=actor.uid):
                self.assertEqual(self.status_of(lambda: self.mark(actor, "102", "WITHDRAWN", "ACTIVE")), 403)
        self.assertEqual(self.repo.items, items)
        self.assertEqual(self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")["participationStatus"], "WITHDRAWN")
        self.assertEqual(self.mark(self.admin, "102", "ACTIVE", "WITHDRAWN")["participationStatus"], "ACTIVE")
        self.assertEqual(self.mark(self.other_teacher, "201", "WITHDRAWN", "ACTIVE", code="BRSA0268")["participationStatus"], "WITHDRAWN")

    def test_route_requires_an_authenticated_portal_session(self):
        def event(claims):
            return {"rawPath": "/cohorts/BRSA0267/participation", "requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": claims}}},
                    "body": json.dumps({"canvasId": "102", "status": "WITHDRAWN", "expectedStatus": "ACTIVE"})}
        with patch("portal.Repository") as repo:
            self.assertEqual(handler(event({}), None)["statusCode"], 401)
            self.assertEqual(handler(event({"sub": "abc", "token_use": "access", "scope": "openid"}), None)["statusCode"], 403)
            repo.assert_not_called()

    def test_student_must_be_in_the_current_publication_of_this_cohort(self):
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.status_of(lambda: self.mark(self.admin, "999", "WITHDRAWN", "ACTIVE")), 404)
        # 102 existe na 267, não na 268: nada de busca global.
        self.assertEqual(self.status_of(lambda: self.mark(self.admin, "102", "WITHDRAWN", "ACTIVE", code="BRSA0268")), 404)
        self.assertEqual(self.repo.items, items)
        # 103 esteve numa publicação anterior, mas não está na atual.
        self.publish("BRSA0267", class_csv(["102", "104"]))
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.status_of(lambda: self.mark(self.admin, "103", "WITHDRAWN", "ACTIVE")), 404)
        self.assertEqual(self.repo.items, items)
        self.assertEqual(self.mark(self.admin, "104", "WITHDRAWN", "ACTIVE")["participationStatus"], "WITHDRAWN")

    def test_cohort_without_a_current_publication_is_a_conflict(self):
        self.admin.dispatch("POST", "/cohorts", {"code": "BRSA0269"})
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.status_of(lambda: self.mark(self.admin, "101", "WITHDRAWN", "ACTIVE", code="BRSA0269")), 409)
        self.assertEqual(self.status_of(lambda: self.mark(self.admin, "101", "WITHDRAWN", "ACTIVE", code="BRSA0999")), 404)
        self.assertEqual(self.repo.items, items)

    def test_only_active_and_withdrawn_are_valid(self):
        items = copy.deepcopy(self.repo.items)
        for bad in ("INACTIVE", "DROPPED", "DESISTENTE", "", "active", "withdrawn", None, 1, ["WITHDRAWN"]):
            for body in ({"status": bad, "expectedStatus": "ACTIVE"}, {"status": "WITHDRAWN", "expectedStatus": bad}):
                with self.subTest(body=body):
                    self.assertEqual(self.status_of(lambda: self.admin.dispatch(
                        "POST", "/cohorts/BRSA0267/participation", {"canvasId": "102", **body})), 400)
        self.assertEqual(self.repo.items, items)

    def test_body_is_exact_and_the_actor_never_comes_from_it(self):
        items = copy.deepcopy(self.repo.items)
        valid = {"canvasId": "102", "status": "WITHDRAWN", "expectedStatus": "ACTIVE"}
        bodies = [{k: v for k, v in valid.items() if k != "expectedStatus"}, {k: v for k, v in valid.items() if k != "canvasId"},
                  {**valid, "updatedBy": "outro-sub"}, {**valid, "by": "outro-sub"}, {**valid, "canvasId": 102},
                  {**valid, "canvasId": "abc"}, {**valid, "canvasId": ""}, {**valid, "canvasId": "1" * 33}, {**valid, "canvasId": "../102"}]
        for body in bodies:
            with self.subTest(body=body):
                self.assertEqual(self.status_of(lambda: self.teacher.dispatch("POST", "/cohorts/BRSA0267/participation", body)), 400)
        self.assertEqual(self.repo.items, items)
        self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        self.assertEqual((self.item("102")["updatedBy"], self.audits()[0]["by"]), ("teacher", "teacher"))

    def test_stale_expected_status_is_a_conflict_without_writing(self):
        self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        items = copy.deepcopy(self.repo.items)
        # Quem ainda vê o aluno ativo: reativar ou repetir a marca a partir desse estado antigo dá 409, mesmo que o
        # resultado pedido já seja o atual (a esperada é conferida antes da idempotência, como no status do feedback).
        for status in ("ACTIVE", "WITHDRAWN"):
            with self.subTest(status=status):
                self.assertEqual(self.status_of(lambda: self.mark(self.admin, "102", status, "ACTIVE")), 409)
        self.assertEqual(self.repo.items, items)

    def test_concurrent_changes_never_overwrite_each_other(self):
        # A e B leem o aluno ativo; A grava antes de B. A escrita de B ainda espera o registro ausente: a condição
        # atômica da transação recusa, e o que A gravou fica intacto.
        original = self.repo.transaction

        def a_wins_first(writes, counters=()):
            self.repo.transaction = original
            self.mark(self.admin, "102", "WITHDRAWN", "ACTIVE")
            return original(writes, counters)

        self.repo.transaction = a_wins_first
        self.assertEqual(self.status_of(lambda: self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")), 409)
        self.assertEqual(self.item("102")["updatedBy"], "admin")
        self.assertEqual([(a["from"], a["to"], a["by"]) for a in self.audits()], [("ACTIVE", "WITHDRAWN", "admin")])

    def test_audit_and_record_hold_no_personal_data(self):
        self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        self.mark(self.teacher, "102", "ACTIVE", "WITHDRAWN")
        for audit in self.audits():
            self.assertEqual(set(audit), {"action", "canvasId", "from", "to", "by", "at"})
        self.assertEqual(set(self.item("102")), {"canvasId", "status", "updatedAt", "updatedBy"})
        stored = json.dumps([self.audits(), self.item("102")])
        for private in ("Colega", "colega102@example.test", "Marina", "aluno@example.test", "teacher@escoladanuvem.org", '"8"', '"100"'):
            self.assertNotIn(private, stored)

    def test_canvas_sync_and_new_publications_keep_the_record(self):
        from portal import sync_from_canvas
        self.mark(self.teacher, "101", "WITHDRAWN", "ACTIVE")
        marked = self.item("101")
        # Sincronização com o aluno ainda no Canvas: sem mudança, e depois com a nota dele alterada.
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", class_csv(["102", "103"]), 3)["status"], "unchanged")
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", class_csv(["102", "103"], kc="9"), 3)["status"], "published")
        self.assertEqual(self.item("101"), marked)
        # Envio manual de outro CSV: rascunho, publicação e turma regravados; o registro não.
        self.publish("BRSA0267", class_csv(["102", "103"], kc="10"))
        self.assertEqual(self.item("101"), marked)
        self.assertEqual(len(self.audits()), 1)
        self.assertEqual(self.mark(self.teacher, "101", "ACTIVE", "WITHDRAWN")["participationStatus"], "ACTIVE")

    def test_restore_keeps_the_record(self):
        second = self.publish("BRSA0267", class_csv(["102", "103"], kc="9"))
        self.mark(self.admin, "102", "WITHDRAWN", "ACTIVE")
        marked = self.item("102")
        self.admin.dispatch("POST", "/cohorts/BRSA0267/restore", {"publicationId": self.first["id"], "expectedCurrent": second["id"]})
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], self.first["id"])
        self.assertEqual(self.item("102"), marked)

    def test_reports_and_reminders_do_not_use_the_record_yet(self):
        views = lambda: (self.admin.dispatch("GET", "/cohorts/BRSA0267/report", {}), class_report(self.repo, "BRSA0267"),
                         self.student.dispatch("GET", "/cohorts/BRSA0267/report", {}),
                         self.teacher.dispatch("POST", "/cohorts/BRSA0267/pending-preview", {"studentId": "101"}))
        self.student.dispatch("GET", "/cohorts/BRSA0267/report", {})  # o primeiro acesso cria o vínculo (portalLinked)
        before = views()
        self.mark(self.teacher, "101", "WITHDRAWN", "ACTIVE")
        self.mark(self.teacher, "102", "WITHDRAWN", "ACTIVE")
        self.assertEqual(views(), before)


class FeedbackTests(unittest.TestCase):
    """Feedback da plataforma: criação, leitura própria, administração, paginação, dedup e limite."""

    T0 = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)

    def setUp(self):
        self.repo = MemoryRepository()
        for code in ("BRSA0267", "BRSA0268"):
            self.repo.put("COHORT#" + code, "METADATA", {"code": code, "name": code, "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []})
        self.other = Portal(self.repo, {"sub": "student2", "email": "colega202@example.test", "groups": []})
        self.instructor = Portal(self.repo, {"sub": "teacher", "email": "teacher@escoladanuvem.org", "groups": []})
        self.repo.put("USER#teacher", "TEACH#BRSA0267", {"code": "BRSA0267"})
        draft = self.admin.dispatch("POST", "/cohorts/BRSA0267/preview", {"csv": class_csv(["202", "203", "204", "205"])})["draft"]
        self.publication = self.admin.dispatch("POST", "/cohorts/BRSA0267/publish", {"draftId": draft["id"]})["publication"]
        self.at = self.T0

    def send(self, actor=None, **fields):
        body = {"type": "BUG", "title": "KC aparece como pendente", "description": "A atividade 254 continua sem nota.",
                "cohort": "BRSA0267", "page": "activities", **fields}
        body = {k: v for k, v in body.items() if v is not ...}
        with patch("feedback.clock", return_value=self.at):
            return (actor or self.student).dispatch("POST", "/feedback", body)

    def mine(self, actor=None, **query):
        return (actor or self.student).dispatch("GET", "/feedback", {}, {k: str(v) for k, v in query.items()})

    def admin_list(self, **query):
        return self.admin.dispatch("GET", "/admin/feedback", {}, {k: str(v) for k, v in query.items()})

    def status(self, feedback_id, status, expected, actor=None):
        return (actor or self.admin).dispatch("POST", f"/admin/feedback/{feedback_id}/status", {"status": status, "expectedStatus": expected})

    def stored(self):
        return [v for (p, s), v in self.repo.items.items() if p == "FEEDBACK"]

    def assert_status(self, fn, status):
        with self.assertRaises(APIError) as err:
            fn()
        self.assertEqual(err.exception.status, status)
        return err.exception

    def test_create_takes_identity_status_and_context_from_the_server(self):
        created = self.send()["feedback"]
        self.assertEqual((created["status"], created["type"], created["cohort"], created["page"]), ("NEW", "BUG", "BRSA0267", "activities"))
        [item] = self.stored()
        self.assertEqual({k: item[k] for k in ("createdBy", "createdByEmail", "canvasId", "publicationId", "updatedBy", "createdAt")},
                         {"createdBy": "student", "createdByEmail": "aluno@example.test", "canvasId": "101",
                          "publicationId": self.publication["id"], "updatedBy": "student", "createdAt": self.T0.isoformat()})
        self.assertEqual(item["statusHistory"], [{"status": "NEW", "by": "student", "at": self.T0.isoformat()}])
        self.assertNotIn("Marina", json.dumps(item))  # o nome não é guardado
        self.assertTrue(feedback_module.ID_PATTERN.fullmatch(item["id"]))
        self.assertEqual(set(created), {"id", "type", "title", "description", "status", "createdAt", "cohort", "page", "updatedAt", "attachments"})
        # Sem turma (tela de primeiro acesso) e por admin/instrutor também é permitido.
        self.at += timedelta(minutes=1)
        self.assertIsNone(self.send(cohort=..., page="onboarding", title="Sem turma")["feedback"]["cohort"])
        admin_item = self.send(self.admin, title="Relato do admin")["feedback"]
        self.assertEqual(self.repo.get("FEEDBACK", "FEEDBACK#" + admin_item["id"])["canvasId"], None)
        self.send(self.instructor, title="Relato do instrutor")

    def test_client_cannot_set_identity_status_dates_or_unknown_fields(self):
        for field, value in (("createdBy", "outro"), ("createdByEmail", "x@y.z"), ("status", "RESOLVED"), ("createdAt", "2020-01-01"),
                             ("updatedBy", "admin"), ("canvasId", "999999"), ("publicationId", "p"), ("userAgent", "x"), ("id", "1")):
            with self.subTest(field):
                self.assert_status(lambda: self.send(**{field: value}), 400)
        self.assertEqual(self.stored(), [])

    def test_validation_limits_and_text_cleanup(self):
        bad = [{"type": "PRAISE"}, {"type": None}, {"title": "  ab  "}, {"title": "x" * 121}, {"title": 12},
               {"description": "curta     "}, {"description": "x" * 2001}, {"page": "/admin/qualquer"}, {"page": "javascript:alert(1)"},
               {"cohort": "brsa0267"}, {"cohort": "../BRSA0267"}, {"title": ...}, {"description": ...}, {"type": ...}]
        for fields in bad:
            with self.subTest(fields):
                self.assert_status(lambda: self.send(**fields), 400)
        self.assertEqual(self.stored(), [])
        ok = self.send(title="  " + "t" * 3 + "\n\tcom quebra ", description="  linha 1\r\nlinha 2\x00\x07 " + "x" * 5 + "  ")["feedback"]
        self.assertEqual((ok["title"], ok["description"]), ("ttt com quebra", "linha 1\nlinha 2 xxxxx"))
        self.at += timedelta(minutes=1)
        self.send(title="t" * 120, description="d" * 2000)
        script = self.send(title="<script>alert(1)</script>", description="<img src=x onerror=alert(1)> nota < 70")["feedback"]
        self.assertEqual(script["title"], "<script>alert(1)</script>")  # guardado como texto; a tela escapa

    def test_cohort_must_be_one_the_user_belongs_to(self):
        self.assert_status(lambda: self.send(cohort="BRSA0268"), 403)
        self.assert_status(lambda: self.send(cohort="BRSA9999"), 404)
        self.assert_status(lambda: self.send(self.other, cohort="BRSA0268"), 403)
        self.assertEqual(self.stored(), [])
        # Aluno do CSV ainda sem vínculo (nunca abriu o relatório) também pode, e o vínculo não é criado.
        self.send(self.other)
        self.assertEqual(self.repo.get("FEEDBACK", "FEEDBACK#" + self.stored()[0]["id"])["canvasId"], "202")
        self.assertIsNone(self.repo.get("USER#student2", "STUDY#BRSA0267"))

    def test_students_only_read_their_own_feedback_and_cannot_administer(self):
        self.send(title="Meu relato")
        self.send(self.other, title="Relato do colega")
        self.assertEqual([f["title"] for f in self.mine()["items"]], ["Meu relato"])
        self.assertEqual([f["title"] for f in self.mine(self.other)["items"]], ["Relato do colega"])
        self.assert_status(lambda: self.mine(userId="student2"), 400)
        self.assert_status(lambda: self.mine(createdBy="student2"), 400)
        other_id = self.mine(self.other)["items"][0]["id"]
        for actor in (self.student, self.instructor):
            with self.subTest(actor=actor.uid):
                self.assert_status(lambda: actor.dispatch("GET", "/admin/feedback", {}, {}), 403)
                self.assert_status(lambda: self.status(other_id, "RESOLVED", "NEW", actor), 403)
        self.assertEqual(self.repo.get("FEEDBACK", "FEEDBACK#" + other_id)["status"], "NEW")

    def fill(self, count, actor=None, start=None, **fields):
        """Um feedback por hora, para não esbarrar no limite de 5 por hora."""
        self.at = start or self.at
        ids = []
        for i in range(count):
            ids.append(self.send(actor, title=f"Relato {i:02d} de {(actor or self.student).uid}", **fields)["feedback"]["id"])
            self.at += timedelta(hours=1)
        return ids

    def test_student_pagination_is_newest_first_and_never_leaks_other_users(self):
        mine, theirs = [], []
        for i in range(25):
            mine.append(self.send(title=f"Meu {i:02d}")["feedback"]["id"])
            theirs.append(self.send(self.other, title=f"Dele {i:02d}")["feedback"]["id"])
            self.at += timedelta(hours=1)
        pages, cursor = [], None
        while True:
            page = self.mine(limit=10, **({"cursor": cursor} if cursor else {}))
            pages.append([f["id"] for f in page["items"]])
            if page["nextCursor"]:
                self.assertIn(feedback_module.decode_cursor(page["nextCursor"]), mine)  # cursor só com id próprio
            cursor = page["nextCursor"]
            if not cursor:
                break
        self.assertEqual([len(p) for p in pages], [10, 10, 5])
        self.assertEqual(sum(pages, []), sorted(mine, reverse=True))
        self.assertEqual(len(self.mine()["items"]), 20)  # padrão 20
        # Cursor com id de outro aluno não devolve nada dele (só continua a partir daquele ponto).
        forged = feedback_module.encode_cursor(theirs[-1])
        self.assertTrue(set(f["id"] for f in self.mine(cursor=forged, limit=50)["items"]) <= set(mine))

    def test_invalid_cursor_and_limits_are_rejected(self):
        for query in ({"cursor": "abc"}, {"cursor": feedback_module.encode_cursor("../x")}, {"cursor": "e30"},
                      {"limit": "0"}, {"limit": "51"}, {"limit": "abc"}, {"limit": "-1"}):
            with self.subTest(query):
                self.assert_status(lambda: self.mine(**query), 400)
        self.assertEqual(self.mine(limit=50)["items"], [])
        self.assert_status(lambda: self.admin_list(limit=101), 400)
        self.assertEqual(self.admin_list(limit=100)["items"], [])
        self.assert_status(lambda: self.admin_list(status="DONE"), 400)
        self.assert_status(lambda: self.admin_list(type="PRAISE"), 400)
        self.assert_status(lambda: self.admin_list(cohort="x"), 400)
        self.assert_status(lambda: self.admin_list(owner="student"), 400)

    def test_admin_lists_filters_and_paginates(self):
        bugs = self.fill(3)
        ideas = self.fill(2, type="SUGGESTION", page="history")
        general = self.fill(1, self.admin, cohort=...)
        archived = bugs[0]
        self.status(archived, "ARCHIVED", "NEW")
        self.status(ideas[0], "IN_REVIEW", "NEW")
        listed = self.admin_list()
        self.assertEqual([f["id"] for f in listed["items"]], sorted(set(bugs + ideas + general) - {archived}, reverse=True))
        self.assertEqual(listed["summary"], {"NEW": 4, "IN_REVIEW": 1, "RESOLVED": 0, "ARCHIVED": 1})
        self.assertEqual([f["id"] for f in self.admin_list(status="ARCHIVED")["items"]], [archived])
        self.assertEqual(len(self.admin_list(status="ALL")["items"]), 6)
        self.assertEqual([f["id"] for f in self.admin_list(type="SUGGESTION")["items"]], sorted(ideas, reverse=True))
        self.assertEqual({f["id"] for f in self.admin_list(cohort="BRSA0267")["items"]}, set(bugs + ideas) - {archived})
        self.assertEqual([f["id"] for f in self.admin_list(status="IN_REVIEW", type="SUGGESTION")["items"]], [ideas[0]])
        first = self.admin_list(limit=2, status="ALL")
        second = self.admin_list(limit=2, status="ALL", cursor=first["nextCursor"])
        third = self.admin_list(limit=2, status="ALL", cursor=second["nextCursor"])
        self.assertEqual([f["id"] for p in (first, second, third) for f in p["items"]], sorted(bugs + ideas + general, reverse=True))
        self.assertIsNone(third["nextCursor"])
        item = next(f for f in listed["items"] if f["id"] == bugs[1])
        self.assertEqual((item["studentName"], item["inCohort"], item["canViewAsStudent"], item["createdByEmail"]),
                         ("Marina Costa", True, True, "aluno@example.test"))

    def test_student_who_left_the_class_keeps_email_but_cannot_be_viewed(self):
        self.send()
        self.admin.dispatch("POST", "/cohorts/BRSA0267/display-name", {"canvasId": "101", "displayName": "Marina Apelido"})
        self.assertEqual(self.admin_list()["items"][0]["studentName"], "Marina Apelido")
        draft = self.admin.dispatch("POST", "/cohorts/BRSA0267/preview", {"csv": class_csv(["202", "203", "204", "205"], marina=False)})["draft"]
        self.admin.dispatch("POST", "/cohorts/BRSA0267/publish", {"draftId": draft["id"], "acknowledgeRemoved": True})
        item = self.admin_list()["items"][0]
        self.assertEqual((item["studentName"], item["inCohort"], item["canViewAsStudent"], item["createdByEmail"], item["canvasId"]),
                         (None, False, False, "aluno@example.test", "101"))

    def test_admin_changes_status_with_optimistic_concurrency_and_bounded_history(self):
        fid = self.send()["feedback"]["id"]
        with patch("portal.now", return_value="2026-09-26T13:00:00+00:00"):
            changed = self.status(fid, "IN_REVIEW", "NEW")["feedback"]
        self.assertEqual((changed["status"], changed["updatedBy"], changed["updatedAt"]), ("IN_REVIEW", "admin", "2026-09-26T13:00:00+00:00"))
        self.assertEqual(changed["statusHistory"][-1], {"status": "IN_REVIEW", "by": "admin", "at": "2026-09-26T13:00:00+00:00"})
        self.assert_status(lambda: self.status(fid, "RESOLVED", "NEW"), 409)  # outro admin já mudou
        self.assert_status(lambda: self.status(fid, "DONE", "IN_REVIEW"), 400)
        self.assert_status(lambda: self.status(fid, "RESOLVED", "WHATEVER"), 400)
        self.assert_status(lambda: self.admin.dispatch("POST", f"/admin/feedback/{fid}/status", {"status": "RESOLVED"}), 400)
        self.assert_status(lambda: self.admin.dispatch("POST", f"/admin/feedback/{fid}/status",
                                                       {"status": "RESOLVED", "expectedStatus": "IN_REVIEW", "updatedBy": "x"}), 400)
        self.assert_status(lambda: self.status("20260926T120000000000-deadbeef", "RESOLVED", "NEW"), 404)
        self.assert_status(lambda: self.status("../x", "RESOLVED", "NEW"), 404)
        current = "IN_REVIEW"
        for i in range(25):
            nxt = "RESOLVED" if current != "RESOLVED" else "IN_REVIEW"
            self.status(fid, nxt, current)
            current = nxt
        history = self.repo.get("FEEDBACK", "FEEDBACK#" + fid)["statusHistory"]
        self.assertEqual(len(history), 20)
        self.assertEqual(history[-1]["status"], current)  # as 20 mais recentes
        self.assertEqual(self.admin_list()["summary"], {"NEW": 0, "IN_REVIEW": 0, "RESOLVED": 1, "ARCHIVED": 0})
        self.assertEqual(self.mine()["items"][0]["status"], "RESOLVED")  # o aluno vê o status atual

    def rate_count(self, actor=None):
        pk, sk, _ = feedback_module.rate_key((actor or self.student).uid, self.at)
        return self.repo.counter(pk, sk).get("count", 0)

    def test_identical_feedback_within_ten_minutes_returns_the_existing_one(self):
        first = self.send()
        self.at += timedelta(minutes=9)
        again = self.send(title="  KC aparece como PENDENTE  ")  # mesmo conteúdo (espaços e maiúsculas)
        self.assertEqual((again["duplicate"], again["feedback"]["id"]), (True, first["feedback"]["id"]))
        self.assertEqual((len(self.stored()), self.rate_count()), (1, 1))  # não consome o limite de novo
        # Expirado pela data, mas o item ainda existe (TTL do DynamoDB é assíncrono): cria outro.
        self.at += timedelta(minutes=2)
        self.assertIsNotNone(self.repo.get("FEEDBACK-DEDUP", f"student#{feedback_module.content_hash('student', feedback_module.clean_new({'type': 'BUG', 'title': 'KC aparece como pendente', 'description': 'A atividade 254 continua sem nota.', 'cohort': 'BRSA0267', 'page': 'activities'}))}"))
        later = self.send()
        self.assertEqual(later["duplicate"], False)
        self.assertEqual(len(self.stored()), 2)
        self.assertFalse(self.send(self.other)["duplicate"])  # outro aluno, mesmo texto: não é duplicado

    def test_duplicate_key_includes_the_origin_page(self):
        # 1. Mesmo tipo, título, descrição, turma e página em 10 minutos: duplicado, 1 feedback, 1 no limite.
        first = self.send()
        self.at += timedelta(minutes=5)
        self.assertEqual((self.send()["duplicate"], len(self.stored()), self.rate_count()), (True, 1, 1))
        # 2. Mesmo texto e turma, outra página: é outro feedback.
        other_page = self.send(page="history")
        self.assertEqual((other_page["duplicate"], len(self.stored()), self.rate_count()), (False, 2, 2))
        self.assertNotEqual(other_page["feedback"]["id"], first["feedback"]["id"])
        # 3. Sem página nos dois envios: continua deduplicando.
        without = self.send(page=...)
        self.assertEqual((self.send(page=...)["feedback"]["id"], len(self.stored())), (without["feedback"]["id"], 3))
        # 4. Um sem página e outro com página: feedbacks diferentes.
        self.assertEqual((self.send(page="overview")["duplicate"], len(self.stored())), (False, 4))
        # 5. Marca vencida pela data, mas ainda presente (TTL assíncrono): novo envio é aceito.
        key = f"student#{feedback_module.content_hash('student', {**feedback_module.clean_new({'type': 'BUG', 'title': 'KC aparece como pendente', 'description': 'A atividade 254 continua sem nota.', 'cohort': 'BRSA0267', 'page': 'history'})})}"
        self.at += timedelta(minutes=11)
        self.assertIsNotNone(self.repo.get("FEEDBACK-DEDUP", key))
        self.assertEqual((self.send(page="history")["duplicate"], len(self.stored())), (False, 5))

    def test_simultaneous_identical_requests_create_only_one_feedback(self):
        original = self.repo.transaction
        results = []

        def racing(writes, counters=()):
            if not results:  # a outra requisição chega entre a leitura do dedup e a gravação
                results.append(None)
                results.append(self.send())
            return original(writes, counters)
        with patch.object(self.repo, "transaction", side_effect=racing):
            outer = self.send()
        inner = results[1]
        self.assertEqual((inner["duplicate"], outer["duplicate"]), (False, True))
        self.assertEqual(outer["feedback"]["id"], inner["feedback"]["id"])
        self.assertEqual((len(self.stored()), self.rate_count()), (1, 1))
        self.assertEqual(self.repo.counter("FEEDBACK-STATS", "ALL"), {"NEW": 1})

    def test_rate_limit_is_five_per_user_per_hour(self):
        ids = [self.send(title=f"Relato {i}")["feedback"]["id"] for i in range(5)]
        self.assertEqual(self.rate_count(), 5)
        err = self.assert_status(lambda: self.send(title="Sexto relato"), 429)
        self.assertIn("5 feedbacks nesta hora", err.message)
        self.assertEqual((len(self.stored()), self.repo.counter("FEEDBACK-STATS", "ALL")), (5, {"NEW": 5}))
        # Reenvio idêntico de um já aceito ainda devolve o existente, sem 429 e sem consumir.
        self.assertEqual(self.send(title="Relato 0")["feedback"]["id"], ids[0])
        self.assertEqual(self.rate_count(), 5)
        self.assertFalse(self.send(self.other, title="Outro aluno")["duplicate"])  # o limite é por usuário
        self.at += timedelta(hours=1)
        self.assertFalse(self.send(title="Na hora seguinte")["duplicate"])
        self.assertEqual(self.rate_count(), 1)

    def test_query_string_reaches_the_api_through_the_handler(self):
        event = {"rawPath": "/feedback", "requestContext": {"http": {"method": "GET"}}, "queryStringParameters": {"limit": "999"}}
        with patch("portal.authenticate", return_value=self.student.user), patch("portal.Repository", return_value=self.repo), \
                patch.dict("os.environ", {"INSTRUCTOR_EMAIL_DOMAIN": "escoladanuvem.org"}):
            self.assertEqual(handler(event, None)["statusCode"], 400)
            self.assertEqual(handler({**event, "queryStringParameters": {"limit": "5"}}, None)["statusCode"], 200)
            self.assertEqual(handler({**event, "queryStringParameters": None}, None)["statusCode"], 200)


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x40\x00\x00\x00WEBPVP8 " + b"\x00" * 64


class FeedbackAttachmentTests(unittest.TestCase):
    """Anexos do feedback: slots, presigned POST, validação na conclusão, leitura e rollback."""
    setUp_feedback = FeedbackTests.setUp
    send = FeedbackTests.send
    T0 = FeedbackTests.T0

    def setUp(self):
        self.setUp_feedback()
        self.repo.files_bucket = "feedback-test"
        self.fid = self.send()["feedback"]["id"]

    def assert_status(self, fn, status):
        with self.assertRaises(APIError) as err:
            fn()
        self.assertEqual(err.exception.status, status)
        return err.exception

    def slot(self, actor=None, fid=None, token=None, **fields):
        body = {"fileName": "captura-erro.png", "contentType": "image/png", "size": len(PNG),
                "clientToken": token or uuid.uuid4().hex, **fields}
        with patch("feedback.clock", return_value=self.at):
            return (actor or self.student).dispatch("POST", f"/feedback/{fid or self.fid}/attachments", body)

    def upload(self, slot, body, content_type=None):
        fields = slot["upload"]["fields"]
        self.repo.upload(fields["key"], body, content_type or fields["Content-Type"])

    def complete(self, aid, actor=None, fid=None):
        with patch("feedback.clock", return_value=self.at):
            return (actor or self.student).dispatch("POST", f"/feedback/{fid or self.fid}/attachments/{aid}/complete", {})

    def attach(self, body=PNG, mime="image/png", name="captura-erro.png", actor=None):
        s = self.slot(actor, contentType=mime, size=len(body), fileName=name)
        self.upload(s, body)
        return self.complete(s["attachment"]["attachmentId"], actor)

    def listing(self, actor=None, fid=None):
        return (actor or self.student).dispatch("GET", f"/feedback/{fid or self.fid}/attachments", {})

    def download(self, aid, actor=None):
        return (actor or self.student).dispatch("GET", f"/feedback/{self.fid}/attachments/{aid}", {})

    def slots(self):
        return {s["slot"]: s for s in self.repo.list(feedback_module.attachment_pk(self.fid), "SLOT#")}

    def count(self):
        return self.repo.get("FEEDBACK", "FEEDBACK#" + self.fid).get("attachments", 0)

    def test_png_jpeg_and_webp_become_ready_with_the_right_keys(self):
        results = [self.attach(PNG, "image/png"), self.attach(JPEG, "image/jpeg", "foto.jpg"), self.attach(WEBP, "image/webp", "tela.webp")]
        self.assertEqual([r["status"] for r in results], ["READY"] * 3)
        self.assertEqual(self.count(), 3)
        for slot in self.slots().values():
            self.assertEqual(slot["objectKey"], f"feedback/{self.fid}/{slot['attachmentId']}")
            self.assertNotIn("pendingUntil", slot)
            self.assertIn(slot["objectKey"], self.repo.feedback_files)
            self.assertEqual(self.repo.feedback_files[slot["objectKey"]]["contentType"], slot["mimeType"])
        self.assertFalse(any(k.startswith("tmp/") for k in self.repo.feedback_files))  # temporários removidos
        presign = [c for c in self.repo.file_calls if c[0] == "presign_upload"]
        self.assertEqual([c[1].split("/")[0] for c in presign], ["tmp"] * 3)
        self.assertEqual({(c[3], c[4]) for c in presign}, {(5_242_880, 300)})  # 5 MiB, 5 minutos
        self.assertTrue(all(("SLOT#%d" % n) for n in (1, 2, 3)))
        # O limite de feedbacks por hora não é consumido pelos anexos.
        pk, sk, _ = feedback_module.rate_key("student", self.at)
        self.assertEqual(self.repo.counter(pk, sk), {"count": 1})

    def test_only_png_jpeg_webp_up_to_5_mib_are_accepted(self):
        bad = [{"contentType": "image/svg+xml"}, {"contentType": "application/pdf"}, {"contentType": "application/zip"},
               {"contentType": "text/html"}, {"contentType": "application/octet-stream"}, {"contentType": "video/mp4"},
               {"contentType": "audio/mpeg"}, {"contentType": "IMAGE/PNG"}, {"size": 0}, {"size": 5_242_881}, {"size": True},
               {"size": "10"}, {"clientToken": "curto"}, {"clientToken": "x" * 65}, {"clientToken": "../../etc/passwd-aaaaaaaa"},
               {"fileName": 12}, {"objectKey": "feedback/outro/arquivo"}]
        for fields in bad:
            with self.subTest(fields):
                self.assert_status(lambda: self.slot(**fields), 400)
        self.assert_status(lambda: self.student.dispatch("POST", f"/feedback/{self.fid}/attachments", {"contentType": "image/png"}), 400)
        self.assertEqual(self.slots(), {})
        self.assertEqual(self.slot(size=5_242_880)["status"], "PENDING")  # exatamente 5 MiB é permitido

    def test_fourth_attachment_is_rejected_and_expired_pending_frees_a_slot(self):
        for _ in range(3):
            self.slot()
        self.assert_status(lambda: self.slot(), 409)
        self.at += timedelta(minutes=16)  # os três PENDING venceram (upload abandonado)
        self.assertEqual(self.slot()["status"], "PENDING")
        self.assertEqual(len(self.slots()), 3)
        for _ in range(2):
            self.attach()
        self.assert_status(lambda: self.slot(), 409)
        self.assertEqual(self.count(), 2)

    def test_spoofed_type_bad_signature_and_size_mismatch_are_rejected_and_cleaned(self):
        same_size = lambda body: body.ljust(len(PNG), b" ")[:len(PNG)]
        cases = [(same_size(JPEG), "image/png", None, "não é uma imagem"),     # bytes de JPEG declarados como PNG
                 (same_size(b"<svg onload=alert(1)>"), "image/png", None, "não é uma imagem"),
                 (same_size(b"%PDF-1.7"), "image/png", None, "não é uma imagem"),
                 (PNG, "image/png", "image/jpeg", "tipo da imagem"),          # Content-Type no S3 diferente do declarado
                 (PNG + b"x", "image/png", None, "tamanho")]                  # tamanho diferente do declarado
        for body, mime, stored_type, message in cases:
            with self.subTest(message=message, body=body[:8]):
                s = self.slot(contentType=mime, size=len(PNG))
                self.upload(s, body, stored_type)
                err = self.assert_status(lambda: self.complete(s["attachment"]["attachmentId"]), 400)
                self.assertIn(message, err.message)
                slot = next(x for x in self.slots().values() if x["attachmentId"] == s["attachment"]["attachmentId"])
                self.assertEqual(slot["status"], "REJECTED")
                self.assertNotIn(s["upload"]["fields"]["key"], self.repo.feedback_files)  # temporário apagado
                self.assertNotIn(slot["objectKey"], self.repo.feedback_files)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.listing()["items"], [])
        # Nada enviado ao S3: recusado também.
        s = self.slot()
        self.assert_status(lambda: self.complete(s["attachment"]["attachmentId"]), 400)
        self.assertEqual(self.attach()["status"], "READY")  # as recusadas liberaram os slots

    def test_authorization_and_idor(self):
        ready = self.attach()["attachment"]["attachmentId"]
        pending = self.slot()["attachment"]["attachmentId"]
        # Outro aluno e o admin não anexam no feedback de outra pessoa.
        for actor in (self.other, self.admin, self.instructor):
            with self.subTest(actor=actor.uid):
                self.assert_status(lambda: self.slot(actor), 403)
                self.assert_status(lambda: self.complete(pending, actor), 403)
        # Leitura: outro aluno e instrutor recebem o mesmo 404 de um feedback inexistente.
        for actor in (self.other, self.instructor):
            with self.subTest(actor=actor.uid):
                self.assertEqual(self.assert_status(lambda: self.listing(actor), 404).message, "Feedback não encontrado.")
                self.assertEqual(self.assert_status(lambda: self.download(ready, actor), 404).message, "Feedback não encontrado.")
        missing = "20260926T120000000000-deadbeef"
        self.assertEqual(self.assert_status(lambda: self.listing(fid=missing), 404).message, "Feedback não encontrado.")
        # Admin lê.
        self.assertEqual([a["attachmentId"] for a in self.listing(self.admin)["items"]], [ready])
        self.assertIn("downloadUrl", self.download(ready, self.admin))
        self.assertFalse(self.listing(self.admin)["canAdd"])
        # IDs manipulados: formato inválido, anexo de outro feedback, PENDING.
        other_fid = self.send(self.other)["feedback"]["id"]
        self.assert_status(lambda: self.student.dispatch("GET", f"/feedback/{self.fid}/attachments/../x", {}), 404)
        self.assert_status(lambda: self.student.dispatch("GET", f"/feedback/{other_fid}/attachments/{ready}", {}), 404)
        self.assert_status(lambda: self.download(pending), 404)
        self.assert_status(lambda: self.download("0" * 32), 404)

    def test_list_has_only_ready_metadata_and_download_url_lasts_300_seconds(self):
        ready = self.attach(name="captura final.png")["attachment"]["attachmentId"]
        self.slot()  # PENDING não aparece
        listing = self.listing()
        self.assertEqual(listing["items"], [{"attachmentId": ready, "originalName": "captura final.png", "mimeType": "image/png",
                                             "size": len(PNG), "createdAt": self.T0.isoformat()}])
        self.assertTrue(listing["canAdd"])
        self.assertNotIn("http", json.dumps(listing))  # nenhuma URL na listagem
        result = self.download(ready)
        self.assertEqual(result["expiresIn"], 300)
        call = [c for c in self.repo.file_calls if c[0] == "presign_download"][-1]
        self.assertEqual((call[1], call[2], call[4]), (f"feedback/{self.fid}/{ready}", "image/png", 300))
        self.assertEqual(call[3], "inline; filename=\"captura final.png\"; filename*=UTF-8''captura%20final.png")
        self.assertEqual([k for k in self.repo.items if "URL" in json.dumps(self.repo.items[k]).upper() and "HTTP" in json.dumps(self.repo.items[k]).upper()], [])

    def test_filenames_are_display_only_and_never_reach_keys_or_headers_raw(self):
        evil = self.attach(name='../../<img src=x onerror=alert(1)>\r\nX-Evil: 1‮.png')
        slot = next(iter(self.slots().values()))
        self.assertEqual(slot["originalName"], "<img src=x onerror=alert(1)>X-Evil: 1.png")
        self.assertEqual(slot["objectKey"], f"feedback/{self.fid}/{evil['attachment']['attachmentId']}")
        self.download(evil["attachment"]["attachmentId"])
        disposition = [c for c in self.repo.file_calls if c[0] == "presign_download"][-1][3]
        self.assertNotIn("\r", disposition)
        self.assertNotIn("\n", disposition)
        self.assertTrue(disposition.startswith('inline; filename="<img src=x onerror=alert(1)>X-Evil: 1.png"; filename*=UTF-8\'\''))
        for raw, mime, expected in (("\r\n../", "image/png", "imagem.png"), ("  ..\\..\\  ", "image/webp", "imagem.webp"),
                                    ("", "image/jpeg", "imagem.jpg"), ("a" * 300 + ".png", "image/png", "a" * 180)):
            self.assertEqual(feedback_module.clean_filename(raw, mime), expected)

    def test_complete_is_idempotent_and_counts_once(self):
        s = self.slot()
        self.upload(s, PNG)
        aid = s["attachment"]["attachmentId"]
        self.assertEqual(self.complete(aid)["status"], "READY")
        self.assertEqual(self.complete(aid)["status"], "READY")
        self.assertEqual(self.count(), 1)
        self.assertEqual(len([c for c in self.repo.file_calls if c[0] == "promote_file"]), 1)

    def test_simultaneous_completes_make_a_single_transition(self):
        s = self.slot()
        self.upload(s, PNG)
        aid = s["attachment"]["attachmentId"]
        original, inner = self.repo.promote_file, []

        def racing(source, target, content_type):
            version = original(source, target, content_type)
            if not inner:  # a outra conclusão roda inteira entre a cópia e a gravação desta
                inner.append(None)
                inner[0] = self.complete(aid)
            return version
        with patch.object(self.repo, "promote_file", side_effect=racing):
            outer = self.complete(aid)
        self.assertEqual((inner[0]["status"], outer["status"]), ("READY", "READY"))
        self.assertEqual(self.count(), 1)
        self.assertEqual([x["status"] for x in self.slots().values()], ["READY"])
        self.assertIn(f"feedback/{self.fid}/{aid}", self.repo.feedback_files)

    def test_same_client_token_returns_the_same_slot(self):
        first = self.slot(token="a" * 32)
        again = self.slot(token="a" * 32)
        self.assertEqual(first["attachment"]["attachmentId"], again["attachment"]["attachmentId"])
        self.assertEqual(len(self.slots()), 1)
        self.upload(again, PNG)
        self.complete(again["attachment"]["attachmentId"])
        done = self.slot(token="a" * 32)
        self.assertEqual((done["status"], done["upload"]), ("READY", None))
        self.assertEqual((len(self.slots()), self.count()), (1, 1))

    def test_feedback_status_rules(self):
        s = self.slot()
        self.upload(s, PNG)
        self.admin.dispatch("POST", f"/admin/feedback/{self.fid}/status", {"status": "RESOLVED", "expectedStatus": "NEW"})
        # Slot criado com o feedback aberto e ainda no prazo: conclui mesmo depois de RESOLVED.
        self.assertEqual(self.complete(s["attachment"]["attachmentId"])["status"], "READY")
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.assert_status(lambda: self.slot(), 409).message, "Este feedback não aceita mais imagens.")
        self.assertFalse(self.listing()["canAdd"])
        self.admin.dispatch("POST", f"/admin/feedback/{self.fid}/status", {"status": "ARCHIVED", "expectedStatus": "RESOLVED"})
        self.assert_status(lambda: self.slot(), 409)
        self.assertEqual(len(self.listing()["items"]), 1)  # continuam visíveis
        self.assertEqual(self.repo.get("FEEDBACK", "FEEDBACK#" + self.fid)["attachments"], 1)  # status preservou a contagem
        # IN_REVIEW continua aceitando; PENDING vencido não conclui.
        self.admin.dispatch("POST", f"/admin/feedback/{self.fid}/status", {"status": "IN_REVIEW", "expectedStatus": "ARCHIVED"})
        late = self.slot()
        self.upload(late, PNG)
        self.at += timedelta(minutes=16)
        self.assert_status(lambda: self.complete(late["attachment"]["attachmentId"]), 409)

    def test_duplicate_feedback_can_receive_a_new_attachment(self):
        self.attach()
        self.at += timedelta(minutes=2)
        again = self.send()
        self.assertTrue(again["duplicate"])
        self.assertEqual(again["feedback"]["attachments"], 1)
        self.assertEqual(self.attach(JPEG, "image/jpeg")["status"], "READY")
        self.assertEqual(self.count(), 2)
        self.assertEqual(self.student.dispatch("GET", "/feedback", {}, {})["items"][0]["attachments"], 2)

    def test_database_failure_after_copy_deletes_only_the_new_version(self):
        s = self.slot()
        self.upload(s, PNG)
        aid, final = s["attachment"]["attachmentId"], f"feedback/{self.fid}/{s['attachment']['attachmentId']}"
        with patch.object(self.repo, "transaction", side_effect=RuntimeError("DynamoDB indisponível")):
            with self.assertRaises(RuntimeError) as err, self.assertLogs(level="ERROR"):
                self.complete(aid)
        self.assertEqual(str(err.exception), "DynamoDB indisponível")
        promote_version = [c for c in self.repo.file_calls if c[0] == "delete_file" and c[1] == final]
        self.assertEqual(len(promote_version), 1)
        self.assertIsNotNone(promote_version[0][2])  # apagou com VersionId, não a chave inteira
        self.assertNotIn(final, self.repo.feedback_files)
        self.assertEqual(next(iter(self.slots().values()))["status"], "PENDING")
        self.assertEqual(self.count(), 0)

    def test_cleanup_failure_is_logged_without_hiding_the_original_error(self):
        s = self.slot()
        self.upload(s, PNG)
        original_delete = self.repo.delete_file

        def failing_delete(key, version_id=None):
            if version_id:
                raise RuntimeError("S3 recusou a exclusão")
            return original_delete(key, version_id)
        with patch.object(self.repo, "transaction", side_effect=RuntimeError("DynamoDB indisponível")), \
                patch.object(self.repo, "delete_file", side_effect=failing_delete):
            with self.assertRaises(RuntimeError) as err, self.assertLogs(level="ERROR") as logs:
                self.complete(s["attachment"]["attachmentId"])
        self.assertEqual(str(err.exception), "DynamoDB indisponível")
        self.assertTrue(any("Falha ao remover a versão" in line for line in logs.output))
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.listing()["items"], [])  # sem falsa confirmação

    def test_upload_routes_require_the_bucket_configuration(self):
        self.repo.files_bucket = None
        self.assert_status(lambda: self.slot(), 503)


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

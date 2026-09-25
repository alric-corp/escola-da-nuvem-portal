import csv
import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from canvas import CanvasClient, CanvasError, course_catalog, course_csv
from canvas_sync import NO_EXPIRY_DAYS, report_token_expiry, run, token_days_left
from grades import parse_csv
from portal import APIError, Portal, save_catalog, sync_from_canvas
from test_portal import MemoryRepository

BASE = "https://canvas.example.test"


class FakeCanvas:
    """Responde como a API do Canvas, com paginação por cabeçalho Link."""

    def __init__(self, courses, page_size=2):
        self.courses, self.page_size, self.calls, self.auth = courses, page_size, [], set()
        self.fail = None
        self.token_hint, self.expires_at = "1~abcde", "2026-12-22T05:00:00Z"

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.calls.append(url)
        self.auth.add(request.get_header("Authorization"))
        if self.fail:
            raise self.fail
        path, _, query = url.split("/api/v1", 1)[1].partition("?")
        if path.startswith("/users/self/tokens/"):
            if path != "/users/self/tokens/" + self.token_hint:
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
            return _Response({"id": 1, "expires_at": self.expires_at}, "")
        _, _, course, resource = path.split("/")[:4]
        data = self.courses[course][{"assignments": "assignments", "users": "students", "students": "submissions",
                                     "modules": "modules"}[resource]]
        if resource == "students" and "workflow_state=graded" in query:
            data = [s for s in data if s["workflow_state"] == "graded"]
        page = int(dict(p.split("=") for p in query.split("&") if p.startswith("page=")).get("page", 1)) if "page=" in query else 1
        chunk = data[(page - 1) * self.page_size: page * self.page_size]
        more = page * self.page_size < len(data)
        link = f'<{BASE}/api/v1{path}?{query}&page={page + 1}>; rel="next"' if more else ""
        return _Response(chunk, link)


class _Response(io.BytesIO):
    def __init__(self, data, link):
        super().__init__(json.dumps(data).encode())
        self.headers = {"Link": link}


def modules(course_id="4436"):
    item = lambda n: f"{BASE}/courses/{course_id}/modules/items/{n}"
    return [
        {"id": 1, "name": "Painel do instrutor", "published": False,
         "items": [{"type": "Assignment", "content_id": 13, "html_url": item(500)}]},
        {"id": 2, "name": " Introdução  ao   curso ", "published": True,
         "items": [{"type": "ExternalUrl", "content_id": 0, "html_url": "https://externo.example.test/"},
                   {"type": "Assignment", "content_id": 11, "published": True, "html_url": item(501)}]},
        {"id": 3, "name": "Vazio", "published": True, "items": [{"type": "SubHeader", "title": "Seção"}]},
        {"id": 4, "name": "Prática", "published": True,
         "items": [{"type": "Assignment", "content_id": 12, "html_url": item(502)},
                   {"type": "Assignment", "content_id": 12, "html_url": item(503)},
                   {"type": "Assignment", "content_id": 99, "published": False, "html_url": item(504)},
                   {"type": "Assignment", "content_id": 98, "html_url": f"{BASE}/courses/1/modules/items/505"}]},
    ]


def course(students=3, kc_scores=(7, 8, 9), lab_scores=(100, None, 50), excused_lab_for=None, graduated_for=None):
    assignments = [
        {"id": 11, "name": "001 KC Introdução", "points_possible": 10.0},
        {"id": 12, "name": "002 Lab Prática", "points_possible": 100.0},
        {"id": 13, "name": "Aviso sem nota", "points_possible": 0},
        {"id": 99, "name": "Graduated", "points_possible": 1.0},
    ]
    people = [{"id": 100 + i, "sortable_name": f"Sobrenome{i}, Nome{i}", "name": f"Nome{i} Sobrenome{i}",
               "login_id": f"aluno{i}@example.test"} for i in range(students)]
    subs = []
    for i, p in enumerate(people):
        if i < len(kc_scores) and kc_scores[i] is not None:
            subs.append({"user_id": p["id"], "assignment_id": 11, "score": kc_scores[i], "workflow_state": "graded"})
        if excused_lab_for == i:
            subs.append({"user_id": p["id"], "assignment_id": 12, "score": None, "excused": True, "workflow_state": "graded"})
        elif i < len(lab_scores) and lab_scores[i] is not None:
            subs.append({"user_id": p["id"], "assignment_id": 12, "score": lab_scores[i], "workflow_state": "graded"})
        else:
            subs.append({"user_id": p["id"], "assignment_id": 12, "score": None, "workflow_state": "unsubmitted"})
        if graduated_for == i:
            subs.append({"user_id": p["id"], "assignment_id": 99, "score": 1.0, "workflow_state": "graded"})
    return {"assignments": assignments, "students": people, "submissions": subs, "modules": modules()}


class CourseCsvTests(unittest.TestCase):
    def test_builds_the_same_csv_the_canvas_export_would(self):
        fake = FakeCanvas({"4436": course(excused_lab_for=2, graduated_for=1)})
        text, count = course_csv(CanvasClient(BASE, "t", opener=fake), "4436")
        self.assertEqual(count, 3)
        snap = parse_csv(text, ["001 KC Introdução (11)", "002 Lab Prática (12)"])
        self.assertEqual([a["id"] for a in snap["activities"]], ["001 KC Introdução (11)", "002 Lab Prática (12)"])
        self.assertEqual([a["points"] for a in snap["activities"]], ["10", "100"])
        by_id = {s["id"]: s for s in snap["students"]}
        self.assertEqual(by_id["100"]["name"], "Nome0 Sobrenome0")
        self.assertEqual(by_id["100"]["email"], "aluno0@example.test")
        self.assertEqual(by_id["100"]["grades"], {"001 KC Introdução (11)": "7", "002 Lab Prática (12)": "100"})
        self.assertIsNone(by_id["101"]["grades"]["002 Lab Prática (12)"])
        self.assertEqual(by_id["102"]["grades"]["002 Lab Prática (12)"], "EX")
        self.assertTrue(by_id["101"]["graduated"])
        self.assertFalse(by_id["100"]["graduated"])
        # Paginação seguida e só as submissões com nota pedidas.
        self.assertTrue(any("workflow_state=graded" in c for c in fake.calls))
        self.assertTrue(any("page=2" in c for c in fake.calls))

    def test_token_errors_are_clear_and_server_errors_are_retried(self):
        fake = FakeCanvas({"4436": course()})
        fake.fail = urllib.error.HTTPError(BASE, 401, "Unauthorized", {}, None)
        with self.assertRaises(CanvasError) as err:
            course_csv(CanvasClient(BASE, "t", opener=fake), "4436")
        self.assertIn("expirado", str(err.exception))
        fake = FakeCanvas({"4436": course()})
        fake.fail = urllib.error.HTTPError(BASE, 503, "Busy", {}, None)
        with patch("canvas.time.sleep"), self.assertRaises(CanvasError):
            course_csv(CanvasClient(BASE, "t", opener=fake), "4436")
        self.assertEqual(len(fake.calls), 3)


class TokenExpiryTests(unittest.TestCase):
    def test_days_left_come_from_the_token_itself(self):
        from datetime import datetime, timezone
        fake = FakeCanvas({})
        client = CanvasClient(BASE, "1~abcdefghij", opener=fake)
        now = datetime(2026, 12, 7, 5, tzinfo=timezone.utc)
        self.assertEqual(token_days_left(client, now), 15)
        self.assertTrue(fake.calls[-1].endswith("/users/self/tokens/1~abcde"))  # só a dica, nunca o token
        self.assertEqual(token_days_left(client, datetime(2027, 1, 1, tzinfo=timezone.utc)), 0)
        fake.expires_at = None
        self.assertEqual(token_days_left(client, now), NO_EXPIRY_DAYS)

    def test_metric_failure_never_breaks_the_sync(self):
        published = []
        class CloudWatch:
            def put_metric_data(self, **kw):
                published.append(kw)
        report_token_expiry(CanvasClient(BASE, "1~abcdefghij", opener=FakeCanvas({})), CloudWatch(), "portal")
        self.assertEqual(published[0]["Namespace"], "portal")
        self.assertEqual(published[0]["MetricData"][0]["MetricName"], "CanvasTokenDaysLeft")
        with self.assertLogs(level="ERROR"):
            report_token_expiry(CanvasClient(BASE, "outro", opener=FakeCanvas({})), CloudWatch(), "portal")
        self.assertEqual(len(published), 1)  # sem métrica: o alarme dispara por falta de dados


class CatalogTests(unittest.TestCase):
    def test_modules_in_course_order_with_links_by_assignment_id(self):
        catalog = course_catalog(CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()})), "4436")
        # Módulo não publicado, módulo sem tarefa, item não publicado, item repetido e link
        # de outro curso ficam de fora; o nome do módulo tem espaços normalizados.
        self.assertEqual(catalog, {"courseId": "4436", "modules": ["Introdução ao curso", "Prática"], "items": {
            "11": {"module": 0, "url": f"{BASE}/courses/4436/modules/items/501"},
            "12": {"module": 1, "url": f"{BASE}/courses/4436/modules/items/502"}}})


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None,
                                                        "canvasCourseId": "4436", "autoSync": True})

    def csv(self, **kw):
        return course_csv(CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course(**kw)})), "4436")

    def test_publishes_then_skips_when_nothing_changed_then_publishes_changes(self):
        first = sync_from_canvas(self.repo, "BRSA0267", *self.csv())
        self.assertEqual(first["status"], "published")
        cohort = self.repo.get("COHORT#BRSA0267", "METADATA")
        self.assertEqual(cohort["updateKind"], "canvas")
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "PUB#" + cohort["current"])["publishedBy"], "system:canvas-sync")
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", *self.csv())["status"], "unchanged")
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "PUB#")), 1)
        changed = sync_from_canvas(self.repo, "BRSA0267", *self.csv(kc_scores=(7, 8, 10)))
        self.assertEqual(changed["status"], "published")
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "PUB#")), 2)
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "SYNC")["status"], "published")

    def test_manual_csv_then_same_grades_from_canvas_is_unchanged(self):
        text, count = self.csv(lab_scores=(100, 90, 50))
        rows = list(csv.reader(io.StringIO(text)))
        grade_cols = [i for i, h in enumerate(rows[0]) if "(" in h]
        for row in rows[2:]:  # formato do CSV exportado pelo Canvas: "7.00", "100.00"
            for i in grade_cols:
                row[i] = f"{float(row[i]):.2f}" if row[i] not in ("", "EX") else row[i]
        out = io.StringIO()
        csv.writer(out).writerows(rows)
        csv_like_export = out.getvalue()
        self.assertIn("7.00", csv_like_export)
        admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        draft = admin.dispatch("POST", "/cohorts/BRSA0267/preview", {"csv": csv_like_export})["draft"]
        admin.dispatch("POST", "/cohorts/BRSA0267/publish", {"draftId": draft["id"]})
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", text, count)["status"], "unchanged")

    def test_empty_or_shrunken_roster_is_not_published(self):
        sync_from_canvas(self.repo, "BRSA0267", *self.csv(students=5, kc_scores=(7,) * 5, lab_scores=(100,) * 5))
        current = self.repo.get("COHORT#BRSA0267", "METADATA")["current"]
        with self.assertRaises(APIError):
            sync_from_canvas(self.repo, "BRSA0267", *self.csv(students=3, kc_scores=(1, 1, 1)))
        with self.assertRaises(APIError):
            sync_from_canvas(self.repo, "BRSA0267", "Student,ID,SIS Login ID\n", 0)
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "METADATA")["current"], current)
        self.assertEqual(self.repo.get("COHORT#BRSA0267", "SYNC")["status"], "failed")
        # Um aluno a menos (acima de 80%) é mudança normal de turma e publica.
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", *self.csv(students=4, kc_scores=(7,) * 4, lab_scores=(100,) * 4))["status"], "published")

    def test_catalog_adds_module_and_link_to_the_student_report(self):
        sync_from_canvas(self.repo, "BRSA0267", *self.csv(lab_scores=(100, 90, 50)))
        student = Portal(self.repo, {"sub": "s0", "email": "aluno0@example.test", "groups": []})
        before = student.dispatch("GET", "/cohorts/BRSA0267/report", {})["student"]["activities"]
        self.assertTrue(all("module" not in a for a in before))  # sem catálogo: frontend usa a lista fixa
        catalog = course_catalog(CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()})), "4436")
        self.assertTrue(save_catalog(self.repo, catalog))
        self.assertFalse(save_catalog(self.repo, catalog))  # sem mudança, não regrava
        by_id = {a["id"]: a for a in student.dispatch("GET", "/cohorts/BRSA0267/report", {})["student"]["activities"]}
        self.assertEqual((by_id["001 KC Introdução (11)"]["module"], by_id["001 KC Introdução (11)"]["moduleOrder"],
                          by_id["001 KC Introdução (11)"]["canvasUrl"]),
                         ("Introdução ao curso", 0, f"{BASE}/courses/4436/modules/items/501"))
        self.assertEqual(by_id["002 Lab Prática (12)"]["module"], "Prática")
        admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        overview = admin.dispatch("GET", "/cohorts/BRSA0267/report", {})["activities"]
        self.assertEqual({a["id"]: a["module"] for a in overview}["002 Lab Prática (12)"], "Prática")
        # Tarefa fora de qualquer módulo (ex.: Roll Call Attendance) vai para "Outras atividades".
        del catalog["items"]["12"]
        self.assertTrue(save_catalog(self.repo, catalog))
        by_id = {a["id"]: a for a in student.dispatch("GET", "/cohorts/BRSA0267/report", {})["student"]["activities"]}
        self.assertEqual({k: by_id["002 Lab Prática (12)"][k] for k in ("module", "canvasUrl")}, {"module": None, "canvasUrl": None})

    def test_published_grades_reach_the_student_report(self):
        sync_from_canvas(self.repo, "BRSA0267", *self.csv(lab_scores=(100, 90, 50)))
        student = Portal(self.repo, {"sub": "s0", "email": "aluno0@example.test", "groups": []})
        report = student.dispatch("GET", "/cohorts/BRSA0267/report", {})
        self.assertEqual((report["student"]["kc"], report["student"]["lab"]), (70, 100))
        self.assertEqual(report["updateKind"], "canvas")


class RunTests(unittest.TestCase):
    def test_write_conflict_in_one_cohort_does_not_stop_the_others(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": True})
        repo.put("COHORT#TURMAB", "METADATA", {"code": "TURMAB", "current": None, "canvasCourseId": "4413", "autoSync": True})
        client = CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course(), "4413": course()}))
        original = repo.transaction
        def conflict_on_a(writes):
            if any(pk == "COHORT#TURMAA" and sk == "METADATA" for pk, sk, _, _ in writes):
                from repository import Conflict
                raise Conflict()
            return original(writes)
        with patch.object(repo, "transaction", side_effect=conflict_on_a):
            results, failures = run(repo, client)
        self.assertEqual(results, {"TURMAA": "failed", "TURMAB": "published"})
        self.assertIn("mudaram durante a atualização", failures[0])
        self.assertEqual(repo.get("COHORT#TURMAA", "SYNC")["status"], "failed")

    def test_only_opted_in_cohorts_run_and_one_failure_does_not_stop_the_others(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": True})
        repo.put("COHORT#TURMAB", "METADATA", {"code": "TURMAB", "current": None, "canvasCourseId": "9999", "autoSync": True})
        repo.put("COHORT#TURMAC", "METADATA", {"code": "TURMAC", "current": None, "canvasCourseId": "4436", "autoSync": False})
        repo.put("COHORT#TURMAD", "METADATA", {"code": "TURMAD", "current": None})
        fake = FakeCanvas({"4436": course(), "9999": course()})
        original = fake.__call__

        def maybe_fail(request, timeout=None):
            if "/courses/9999/" in request.full_url:
                raise urllib.error.HTTPError(BASE, 403, "Forbidden", {}, None)
            return original(request, timeout)
        results, failures = run(repo, CanvasClient(BASE, "t", opener=maybe_fail))
        self.assertEqual(results, {"TURMAA": "published", "TURMAB": "failed"})
        self.assertEqual(len(failures), 2)  # catálogo e notas do curso inacessível
        self.assertTrue(all(f.startswith("TURMAB:") for f in failures))
        # O catálogo vale para toda turma com curso configurado, mesmo sem atualização automática.
        self.assertIsNotNone(repo.get("CATALOG#4436", "METADATA"))
        self.assertIsNone(repo.get("CATALOG#9999", "METADATA"))
        self.assertEqual(repo.get("COHORT#TURMAB", "SYNC")["status"], "failed")
        self.assertIsNone(repo.get("COHORT#TURMAC", "SYNC"))


if __name__ == "__main__":
    unittest.main()

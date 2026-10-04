import csv
import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from canvas import CanvasClient, CanvasError, course_catalog, course_csv
from canvas_sync import NO_EXPIRY_DAYS, report_token_expiry, run, token_days_left
from grades import parse_csv
from canvas import course_students
from integrity import email_hash
from portal import APIError, Portal, save_catalog, save_roster, sync_from_canvas
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

    def test_unchanged_run_leaves_no_draft_behind(self):
        sync_from_canvas(self.repo, "BRSA0267", *self.csv())
        drafts = lambda: [k for k in self.repo.keys("COHORT#BRSA0267", "DRAFT#")]
        before, files = drafts(), set(self.repo.files)
        self.assertEqual(len(before), 1)  # o rascunho publicado fica, como no envio de CSV
        for _ in range(3):
            self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", *self.csv())["status"], "unchanged")
        self.assertEqual((drafts(), set(self.repo.files)), (before, files))
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", *self.csv(kc_scores=(10, 8, 9)))["status"], "published")
        self.assertEqual(len(drafts()), 2)

    def test_manual_csv_then_same_grades_from_canvas_is_unchanged(self):
        text, count = self.csv(lab_scores=(100, 90, 50))
        rows = list(csv.reader(io.StringIO(text)))
        grade_cols = [i for i, h in enumerate(rows[0]) if "(" in h]
        for row in rows[1:]:  # formato do CSV exportado pelo Canvas: "7.00", "100.00", inclusive Points Possible
            for i in grade_cols:
                row[i] = f"{float(row[i]):.2f}" if row[i] not in ("", "EX") else row[i]
        out = io.StringIO()
        csv.writer(out).writerows(rows)
        csv_like_export = out.getvalue()
        self.assertIn("7.00", csv_like_export)
        # Turma com Canvas: o envio manual só publica com a matrícula já gravada pelo canvas_sync.
        save_roster(self.repo, "4436", course_students(CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()})), "4436"))
        admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        self.assertIn("Points Possible,,,10.00,100.00", csv_like_export)
        sync_from_canvas(self.repo, "BRSA0267", text, count)  # publicação atual vinda da API ("10", "100")
        preview = admin.dispatch("POST", "/cohorts/BRSA0267/preview", {"csv": csv_like_export})
        self.assertEqual((preview["changes"]["scalesChanged"], preview["changes"]["gradesChanged"]), ([], 0))
        admin.dispatch("POST", "/cohorts/BRSA0267/publish", {"draftId": preview["draft"]["id"]})
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", text, count)["status"], "unchanged")

    def test_manual_export_then_sync_does_not_add_false_changes_to_student_history(self):
        text, count = self.csv(lab_scores=(100, 90, 50))
        rows = list(csv.reader(io.StringIO(text)))
        cols = [i for i, h in enumerate(rows[0]) if "(" in h]
        for row in rows[1:]:  # export do Canvas: pontuação máxima e notas com duas casas
            for i in cols:
                row[i] = f"{float(row[i]):.2f}" if row[i] not in ("", "EX") else row[i]
        out = io.StringIO()
        csv.writer(out).writerows(rows)
        save_roster(self.repo, "4436", course_students(CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()})), "4436"))
        admin = Portal(self.repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        draft = admin.dispatch("POST", "/cohorts/BRSA0267/preview", {"csv": out.getvalue()})["draft"]
        admin.dispatch("POST", "/cohorts/BRSA0267/publish", {"draftId": draft["id"]})
        # A sincronização publica por causa de outro aluno; as pontuações vêm como "10" e "100".
        self.assertEqual(sync_from_canvas(self.repo, "BRSA0267", *self.csv(kc_scores=(7, 8, 10), lab_scores=(100, 90, 50)))["status"], "published")
        student = Portal(self.repo, {"sub": "s0", "email": "aluno0@example.test", "groups": []})
        history = student.dispatch("GET", "/cohorts/BRSA0267/report", {})["history"]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["changes"]["activities"], [])  # nada mudou para este aluno
        other = Portal(self.repo, {"sub": "s2", "email": "aluno2@example.test", "groups": []})
        changed = other.dispatch("GET", "/cohorts/BRSA0267/report", {})["history"][0]["changes"]["activities"]
        self.assertEqual([(a["name"], a["before"], a["after"]) for a in changed], [("001 KC Introdução", 90.0, 100.0)])

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

    def test_roster_is_saved_on_every_successful_run_even_when_grades_are_unchanged(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": True})
        fake = FakeCanvas({"4436": course()})
        with patch("portal.now", return_value="2026-09-26T09:00:00+00:00"):
            self.assertEqual(run(repo, CanvasClient(BASE, "t", opener=fake))[0], {"TURMAA": "published"})
        roster = repo.get("ROSTER#4436", "METADATA")
        self.assertEqual((roster["count"], sorted(roster["students"]), roster["capturedAt"]),
                         (3, ["100", "101", "102"], "2026-09-26T09:00:00+00:00"))
        self.assertEqual(roster["students"]["100"], email_hash("aluno0@example.test"))
        self.assertNotIn("@", json.dumps(roster))
        # A matrícula é lida uma vez só por execução e reaproveitada no CSV da sincronização.
        self.assertEqual(sum("/users?" in c for c in fake.calls), 2)  # 3 alunos, páginas de 2
        with patch("portal.now", return_value="2026-09-26T21:00:00+00:00"):
            self.assertEqual(run(repo, CanvasClient(BASE, "t", opener=fake))[0], {"TURMAA": "unchanged"})
        self.assertEqual(repo.get("ROSTER#4436", "METADATA")["capturedAt"], "2026-09-26T21:00:00+00:00")

    def test_new_enrollment_updates_the_roster(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": True})
        repo.put("COHORT#TURMAC", "METADATA", {"code": "TURMAC", "current": None, "canvasCourseId": "4413", "autoSync": False})
        fake = FakeCanvas({"4436": course(students=5, kc_scores=(7,) * 5, lab_scores=(100,) * 5),
                           "4413": course(students=5, kc_scores=(7,) * 5, lab_scores=(100,) * 5)})
        run(repo, CanvasClient(BASE, "t", opener=fake))
        pubs = len(repo.list("COHORT#TURMAA", "PUB#"))
        # Um aluno entra nos dois cursos, sem nenhuma nota.
        for code in ("4436", "4413"):
            fake.courses[code] = course(students=6, kc_scores=(7,) * 5, lab_scores=(100,) * 5)
        results, failures = run(repo, CanvasClient(BASE, "t", opener=fake))
        for code in ("4436", "4413"):
            self.assertIn("105", repo.get("ROSTER#" + code, "METADATA")["students"])
        # Turma sem autoSync: a matrícula muda e nenhuma publicação é criada.
        self.assertEqual(repo.list("COHORT#TURMAC", "PUB#"), [])
        self.assertIsNone(repo.get("COHORT#TURMAC", "SYNC"))
        # Com autoSync, o comportamento acadêmico é o de antes: aluno novo é mudança e publica.
        self.assertEqual((results, failures), ({"TURMAA": "published"}, []))
        self.assertEqual(len(repo.list("COHORT#TURMAA", "PUB#")), pubs + 1)

    def test_canvas_failure_keeps_the_previous_roster(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": True})
        repo.put("COHORT#TURMAC", "METADATA", {"code": "TURMAC", "current": None, "canvasCourseId": "4413", "autoSync": False})
        fake = FakeCanvas({"4436": course(), "4413": course()})
        run(repo, CanvasClient(BASE, "t", opener=fake))
        saved = {c: repo.get("ROSTER#" + c, "METADATA") for c in ("4436", "4413")}
        fake.fail = urllib.error.HTTPError(BASE, 401, "Unauthorized", {}, None)
        results, failures = run(repo, CanvasClient(BASE, "t", opener=fake))
        self.assertEqual({c: repo.get("ROSTER#" + c, "METADATA") for c in ("4436", "4413")}, saved)
        # Tratamento de erro de antes: SYNC falhou na turma com autoSync; a outra falha também é reportada.
        self.assertEqual(results, {"TURMAA": "failed"})
        self.assertEqual(repo.get("COHORT#TURMAA", "SYNC")["status"], "failed")
        self.assertTrue(any(f.startswith("TURMAC: matrícula do curso 4413") for f in failures))

    def test_roster_from_sync_lets_a_manual_upload_of_the_same_class_publish(self):
        repo = MemoryRepository()
        repo.put("COHORT#TURMAA", "METADATA", {"code": "TURMAA", "current": None, "canvasCourseId": "4436", "autoSync": False})
        fake = FakeCanvas({"4436": course(students=5, kc_scores=(7,) * 5, lab_scores=(100,) * 5)})
        admin = Portal(repo, {"sub": "admin", "email": "admin@example.test", "groups": ["admin"]})
        text, _ = course_csv(CanvasClient(BASE, "t", opener=fake), "4436")
        preview = admin.dispatch("POST", "/cohorts/TURMAA/preview", {"csv": text})
        self.assertEqual([i["code"] for i in preview["integrity"]["critical"]], ["rosterUnavailable"])
        run(repo, CanvasClient(BASE, "t", opener=fake))  # só grava catálogo e matrícula (sem autoSync)
        preview = admin.dispatch("POST", "/cohorts/TURMAA/preview", {"csv": text})
        self.assertEqual(preview["integrity"]["critical"], [])
        admin.dispatch("POST", "/cohorts/TURMAA/publish", {"draftId": preview["draft"]["id"]})
        self.assertIsNotNone(repo.get("COHORT#TURMAA", "METADATA")["current"])


class ScheduledSyncProofTests(unittest.TestCase):
    setUp = SyncTests.setUp

    def event(self, scheduled="2026-10-06T18:00:00-03:00", attempt=1):
        return {"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": scheduled,
                "executionId": "execution-" + str(attempt), "attemptNumber": attempt}

    def execute(self, event=None, **kwargs):
        client = CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()}))
        at = "2026-10-06T21:01:00+00:00"
        with patch("portal.now", return_value=at):
            return run(self.repo, client, event=event, clock=lambda: at, **kwargs)

    def proof(self, slot="2026-10-06T21:00:00Z"):
        return self.repo.get("COHORT#BRSA0267", "SYNC_RUN#" + slot)

    def test_legacy_and_manual_events_create_no_scheduled_proof(self):
        for event in (None, {}, {"source": "manual", "type": "canvas-sync", "scheduledFor": "2026-10-06T21:00:00Z"}):
            with self.subTest(event=event):
                results, failures = self.execute(event)
                self.assertIn(results["BRSA0267"], ("published", "unchanged"))
                self.assertEqual(failures, [])
                self.assertEqual(self.repo.list("COHORT#BRSA0267", "SYNC_RUN#"), [])

    def test_evening_published_proof_is_tied_to_the_actual_publication(self):
        from sync_runs import metadata_version
        self.assertEqual(self.execute(self.event()), ({"BRSA0267": "published"}, []))
        proof = self.proof()
        metadata = self.repo.get("COHORT#BRSA0267", "METADATA")
        self.assertEqual(proof["status"], "succeeded")
        self.assertEqual(proof["publicationId"], metadata["current"])
        self.assertEqual(proof["metadataVersion"], metadata_version(metadata))
        self.assertEqual(proof["scheduledFor"], "2026-10-06T21:00:00Z")
        self.assertEqual(proof["stages"], {"catalog": "succeeded", "roster": "succeeded", "grades": "published"})
        self.assertIsNotNone(proof["startedAt"])
        self.assertIsNotNone(proof["finishedAt"])

    def test_unchanged_has_a_real_publication_without_changing_legacy_sync(self):
        self.execute()
        publication = self.repo.get("COHORT#BRSA0267", "METADATA")["current"]
        self.assertEqual(self.execute(self.event()), ({"BRSA0267": "unchanged"}, []))
        self.assertEqual(self.proof()["publicationId"], publication)
        self.assertEqual(self.proof()["status"], "succeeded")
        self.assertEqual(self.proof()["stages"]["grades"], "unchanged")
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", "SYNC")["publicationId"])

    def test_morning_slot_is_distinct_and_lookup_uses_iana_timezone(self):
        from sync_runs import evening_sync_key
        self.execute(self.event("2026-10-06T06:00:00-03:00"))
        self.assertIsNone(self.proof())
        self.assertEqual(self.proof("2026-10-06T09:00:00Z")["status"], "succeeded")
        self.assertEqual(evening_sync_key("2026-10-06T23:00:00Z"), "SYNC_RUN#2026-10-06T21:00:00Z")
        # São Paulo tinha DST nesta data: não fixar UTC-3 no identificador.
        self.assertEqual(evening_sync_key("2018-11-06T22:00:00Z"), "SYNC_RUN#2018-11-06T20:00:00Z")

    def test_retry_reuses_slot_and_changes_only_attempt_telemetry(self):
        self.execute(self.event())
        pub = self.proof()["publicationId"]
        self.execute(self.event("2026-10-06T21:00:00Z", attempt=2))
        self.assertEqual(len(self.repo.list("COHORT#BRSA0267", "SYNC_RUN#")), 1)
        self.assertEqual(self.proof()["publicationId"], pub)
        self.assertEqual((self.proof()["attemptNumber"], self.proof()["executionId"]), (2, "execution-2"))
        before = self.proof()
        self.execute(self.event())  # tentativa atrasada não substitui a prova mais nova
        self.assertEqual(self.proof(), before)

    def test_catalog_failure_invalidates_each_cohort_sharing_that_course(self):
        from canvas import CanvasError
        self.repo.put("COHORT#TURMAB", "METADATA", {"code": "TURMAB", "current": None, "canvasCourseId": "4436", "autoSync": True})
        with patch("canvas_sync.course_catalog", side_effect=CanvasError("private@example.test")):
            self.execute(self.event())
        for code in ("BRSA0267", "TURMAB"):
            proof = self.repo.get("COHORT#" + code, "SYNC_RUN#2026-10-06T21:00:00Z")
            self.assertEqual(proof["status"], "failed")
            self.assertEqual(proof["stages"]["catalog"], "failed")
            self.assertNotIn("private@example.test", json.dumps(proof))

    def test_roster_and_grade_failure_are_recorded_without_false_success(self):
        from canvas import CanvasError
        for function, stage in (("course_students", "roster"), ("course_csv", "grades")):
            with self.subTest(stage=stage):
                self.setUp()
                with patch("canvas_sync." + function, side_effect=CanvasError("sensitive details")):
                    self.execute(self.event())
                proof = self.proof()
                self.assertEqual(proof["status"], "failed")
                self.assertEqual(proof["stages"][stage], "failed")
                self.assertIsNone(proof["publicationId"])
                self.assertNotIn("sensitive", json.dumps(proof))

    def test_abrupt_interruption_leaves_an_incomplete_run(self):
        with patch("canvas_sync.course_csv", side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            self.execute(self.event())
        self.assertEqual(self.proof()["status"], "running")
        self.assertIsNone(self.proof()["finishedAt"])
        self.assertIsNone(self.proof()["publicationId"])

    def test_publication_race_cannot_attach_a_later_current_to_the_run(self):
        original = self.repo.transaction
        for unchanged in (False, True):
            with self.subTest(unchanged=unchanged):
                self.setUp()
                if unchanged: self.execute()
                original = self.repo.transaction
                def race(writes, **kwargs):
                    if any(w[1].startswith("SYNC_RUN#") and w[2]["status"] == "succeeded" for w in writes):
                        metadata = self.repo.get("COHORT#BRSA0267", "METADATA")
                        metadata.update(current="later-publication", updatedAt="later")
                        self.repo.put("COHORT#BRSA0267", "METADATA", metadata)
                    return original(writes, **kwargs)
                with patch.object(self.repo, "transaction", side_effect=race):
                    self.execute(self.event())
                proof = self.proof()
                self.assertEqual(proof["status"], "failed")
                self.assertIsNone(proof["publicationId"])
                self.assertIsNone(proof["metadataVersion"])

    def test_proof_does_not_store_event_or_student_information(self):
        event = {**self.event(), "email": "do-not-store@example.test", "token": "private-token", "body": {"name": "private-name"}}
        self.execute(event)
        proof = self.proof()
        self.assertEqual(set(proof), {"source", "scheduledFor", "executionId", "attemptNumber", "startedAt",
                                     "finishedAt", "status", "publicationId", "metadataVersion", "stages"})
        self.assertNotIn("@", json.dumps(proof))
        self.assertNotIn("private", json.dumps(proof))

    def test_unchanged_cannot_reread_and_claim_current_after_its_comparison(self):
        from sync_runs import SyncRun
        self.execute()
        original = SyncRun.complete_unchanged
        def change_current(proof, compared_metadata):
            self.repo.put("COHORT#BRSA0267", "METADATA", {**compared_metadata, "current": "later-publication"})
            return original(proof, compared_metadata)
        with patch.object(SyncRun, "complete_unchanged", change_current):
            self.execute(self.event())
        self.assertEqual(self.proof()["status"], "failed")
        self.assertIsNone(self.proof()["publicationId"])

    def test_course_configuration_cannot_change_while_canvas_is_being_read(self):
        import canvas_sync
        original = canvas_sync.course_csv
        def change_course(*args):
            result = original(*args)
            metadata = self.repo.get("COHORT#BRSA0267", "METADATA")
            self.repo.put("COHORT#BRSA0267", "METADATA", {**metadata, "canvasCourseId": "different"})
            return result
        with patch.object(canvas_sync, "course_csv", side_effect=change_course):
            self.execute(self.event())
        self.assertEqual(self.proof()["status"], "failed")
        self.assertIsNone(self.proof()["publicationId"])
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "PUB#"), [])

    def test_metadata_proof_detects_restore_to_the_same_publication(self):
        from sync_runs import metadata_version
        self.execute(self.event())
        metadata = self.repo.get("COHORT#BRSA0267", "METADATA")
        restored = {**metadata, "updateKind": "restore", "updatedAt": "2026-10-06T22:00:00Z"}
        self.assertEqual(restored["current"], self.proof()["publicationId"])
        self.assertNotEqual(metadata_version(restored), self.proof()["metadataVersion"])

    def test_one_failed_scheduled_cohort_does_not_block_the_other(self):
        from canvas import CanvasError
        import canvas_sync
        self.repo.put("COHORT#TURMAB", "METADATA", {"code": "TURMAB", "current": None, "canvasCourseId": "4436", "autoSync": True})
        original = canvas_sync.sync_from_canvas
        def fail_first(repo, code, *args, **kwargs):
            if code == "BRSA0267": raise CanvasError("failed")
            return original(repo, code, *args, **kwargs)
        with patch.object(canvas_sync, "sync_from_canvas", side_effect=fail_first):
            self.execute(self.event())
        self.assertEqual(self.proof()["status"], "failed")
        self.assertEqual(self.repo.get("COHORT#TURMAB", "SYNC_RUN#2026-10-06T21:00:00Z")["status"], "succeeded")

    def test_invalid_scheduled_context_cannot_become_proof(self):
        for change in ({"scheduledFor": "bad"}, {"scheduledFor": "2026-10-06T21:00:00"},
                       {"scheduledFor": "2026-10-06T20:00:00Z"}, {"executionId": ""}, {"attemptNumber": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.execute({**self.event(), **change})
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "SYNC_RUN#"), [])

    def test_run_model_rejects_a_raw_event_instead_of_persisting_it(self):
        from sync_runs import SyncRun
        cohort = self.repo.get("COHORT#BRSA0267", "METADATA")
        with self.assertRaises(ValueError):
            SyncRun(self.repo, cohort, self.event(), lambda: "2026-10-06T21:01:00Z")
        self.assertEqual(self.repo.list("COHORT#BRSA0267", "SYNC_RUN#"), [])

    def test_monitoring_failure_after_data_does_not_invalidate_proof(self):
        import canvas_sync
        client = CanvasClient(BASE, "t", opener=FakeCanvas({"4436": course()}))
        with patch.dict("os.environ", {"CANVAS_BASE_URL": BASE, "CANVAS_SECRET_ARN": "fake", "METRICS_NAMESPACE": "test"}), \
             patch.object(canvas_sync, "read_token", return_value="fake"), \
             patch.object(canvas_sync, "CanvasClient", return_value=client), \
             patch.object(canvas_sync, "Repository", return_value=self.repo), \
             patch("boto3.client") as aws, \
             patch("sync_runs.utc_now", return_value="2026-10-06T21:01:00+00:00"), \
             self.assertLogs(level="ERROR"):
            aws.return_value.put_metric_data.side_effect = RuntimeError("metrics unavailable")
            canvas_sync.handler(self.event(), None)
        self.assertEqual(self.proof()["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()

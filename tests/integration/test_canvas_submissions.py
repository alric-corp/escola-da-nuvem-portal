"""Situação auxiliar de entregas: dados fictícios e HTTP controlado, nunca Canvas real."""
import copy
import io
import json
import pathlib
import sys
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from canvas import AUX_MAX_PAGE_BYTES, CanvasClient, CanvasError, course_csv
from canvas_submissions import (MAX_ASSIGNMENTS, MAX_ITEM_BYTES, classify_submission, collect_submissions,
                                read_submissions, save_submissions)
from canvas_sync import run
from repository import Conflict
from test_canvas import BASE, FakeCanvas, _Response, course
from test_portal import MemoryRepository

OLD = "2026-10-20T12:00:00+00:00"
NOW = "2026-10-21T12:00:00+00:00"
NEW = "2026-10-22T12:00:00+00:00"
SENT = "2026-10-19T12:00:00+00:00"
PK = "CANVAS_SUBMISSIONS#4436"


def assignment(**kw):
    return {"published": True, "submission_types": ["online_upload"], "unlock_at": None, "has_overrides": False, **kw}


def submission(**kw):
    return {"workflow_state": "submitted", "attempt": 1, "submitted_at": SENT,
            "graded_at": None, "posted_at": None, "assignment_visible": True,
            "grade_matches_current_submission": False, "excused": False, **kw}


def candidate(data=None, assignments=None, students=None, course_id="4436"):
    return {"courseId": course_id, "assignments": assignments or {"11": assignment()},
            "students": students if students is not None else {"100": {"11": data if data is not None else submission()}}}


class SubmissionDecisionTests(unittest.TestCase):
    def state(self, data=None, task=None):
        return classify_submission(task if task is not None else assignment(), data, NOW)

    def test_valid_delivery_and_pending_review_have_distinct_conservative_states(self):
        for source, expected in (("submitted", "submitted"), ("pending_review", "pending_review")):
            with self.subTest(source=source):
                state, reason, fields = self.state(submission(workflow_state=source))
                self.assertEqual((state, reason), (expected, None))
                self.assertEqual(fields, {"attempt": 1, "submittedAt": SENT, "gradedAt": None})

    def test_graded_zero_is_not_used_for_delivery_and_only_posted_current_evaluation_is_exposed(self):
        data = submission(workflow_state="graded", graded_at="2026-10-20T10:00:00Z", posted_at=OLD,
                          grade_matches_current_submission=True, score=0, grade="0", body="PRIVATE")
        state, _, fields = self.state(data)
        self.assertEqual(state, "graded")
        self.assertEqual(fields["gradedAt"], "2026-10-20T10:00:00+00:00")
        for key in ("score", "grade", "body", "postedAt"):
            self.assertNotIn(key, fields)
        data["score"] = 100
        self.assertEqual(self.state(data)[0], state)

    def test_hidden_or_new_attempt_does_not_expose_old_evaluation(self):
        for changes in ({"posted_at": None}, {"grade_matches_current_submission": False},
                        {"posted_at": "2027-01-01T00:00:00Z"}):
            with self.subTest(changes=changes):
                data = submission(workflow_state="graded", graded_at=OLD, posted_at=OLD,
                                  grade_matches_current_submission=True)
                data.update(changes)
                state, reason, fields = self.state(data)
                self.assertEqual((state, reason, fields["gradedAt"]), ("submitted", "evaluation-unconfirmed", None))

    def test_unsubmitted_needs_positive_visibility_applicability_and_zero_attempt(self):
        data = submission(workflow_state="unsubmitted", attempt=0, submitted_at=None, missing=True, late=True)
        self.assertEqual(self.state(data)[0], "unsubmitted")
        for changes in ({"attempt": None}, {"attempt": False}, {"submitted_at": SENT},
                        {"assignment_visible": None}, {"workflow_state": "unexpected"}):
            with self.subTest(changes=changes):
                self.assertEqual(self.state({**data, **changes})[0], "unknown")
        without_time = {k: v for k, v in data.items() if k != "submitted_at"}
        self.assertEqual(self.state(without_time)[0], "unknown")
        self.assertEqual(self.state({key: value for key, value in data.items() if key != "excused"})[0], "unknown")
        self.assertEqual(self.state(data, assignment(has_overrides=True))[0], "unknown")
        for key in ("unlock_at", "has_overrides"):
            incomplete = {key_: value for key_, value in assignment().items() if key_ != key}
            self.assertEqual(self.state(data, incomplete)[0], "unknown")
        self.assertEqual(self.state(data, assignment(has_overrides=None))[0], "unknown")

    def test_absence_null_invalid_or_future_never_proves_non_delivery(self):
        for data in (None, {}, submission(workflow_state=None), submission(workflow_state="future-state"),
                     submission(workflow_state={}), submission(workflow_state=[]), submission(workflow_state=1),
                     submission(submitted_at="2027-01-01T00:00:00Z"), submission(submitted_at="invalid"),
                     submission(submitted_at="2026-10-20T12:00:00"), submission(attempt=True),
                     submission(workflow_state="graded", graded_at="bad", posted_at=OLD,
                                grade_matches_current_submission=True)):
            with self.subTest(data=data):
                self.assertEqual(self.state(data)[0], "unknown")

    def test_offline_lti_quiz_discussion_unpublished_excused_and_not_released(self):
        for types in (["on_paper"], ["none"], ["external_tool"], ["online_quiz"], ["discussion_topic"]):
            with self.subTest(types=types):
                self.assertEqual(self.state(submission(), assignment(submission_types=types))[0], "not_applicable")
        self.assertEqual(self.state(submission(excused=True))[0], "not_applicable")
        self.assertEqual(self.state(submission(), assignment(published=False))[0], "not_applicable")
        self.assertEqual(self.state(submission(assignment_visible=False))[0], "not_applicable")
        self.assertEqual(self.state(submission(workflow_state="unsubmitted", attempt=0, submitted_at=None),
                                    assignment(unlock_at=NEW))[0], "not_applicable")
        for task in (assignment(submission_types=None), assignment(submission_types=["unknown"]),
                     assignment(submission_types=["online_upload", "external_tool"]),
                     assignment(published=None)):
            self.assertEqual(self.state(submission(), task)[0], "unknown")


class SubmissionPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()

    def save(self, value=None, at=OLD, **kw):
        save_submissions(self.repo, "4436", value or candidate(), at, **kw)

    def row(self):
        return read_submissions(self.repo, "4436", "100")["items"]["11"]

    def test_roundtrip_whitelist_and_course_student_assignment_isolation(self):
        self.save(candidate(submission(score=99, grade="A", body="PRIVATE", submission_comments=["PRIVATE"])))
        result = read_submissions(self.repo, "4436", "100", ["11"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(self.row()["state"], "submitted")
        self.assertIsNone(read_submissions(self.repo, "9999", "100"))
        self.assertIsNone(read_submissions(self.repo, "4436", "101"))
        self.assertEqual(read_submissions(self.repo, "4436", "100", ["12"])["items"], {})
        encoded = json.dumps(list(self.repo.items.values()))
        for secret in ("PRIVATE", "score", '"grade"', '"name"', "email", "body", "comments"):
            self.assertNotIn(secret, encoded)

    def test_omission_and_invalid_retain_original_observation_without_false_freshness(self):
        for data in ({}, submission(submitted_at="2027-01-01T00:00:00Z"), submission(workflow_state="bad")):
            with self.subTest(data=data):
                self.setUp()
                self.save()
                self.save(candidate(data), NOW)
                row = self.row()
                self.assertEqual((row["state"], row["observedAt"], row["provenance"]["status"]),
                                 ("submitted", OLD, "retained"))
                self.assertEqual(row["provenance"]["attemptedAt"], NOW)
                self.assertEqual(self.repo.get(PK, "METADATA")["collectedAt"], OLD)

    def test_explicit_null_clears_current_state_and_retains_last_valid_reference(self):
        self.save()
        self.save(candidate(submission(workflow_state=None)), NOW)
        row = self.row()
        self.assertEqual((row["state"], row["observedAt"], row["provenance"]["reason"]), ("unknown", None, "null"))
        self.assertEqual(row["provenance"]["lastValidObservedAt"], OLD)
        self.save(candidate({}), NEW)
        self.assertEqual(self.row()["state"], "unknown")

    def test_integral_failure_retains_values_dates_and_exposes_failed_attempt(self):
        self.save()
        self.save(at=NOW, failed=True)
        row = self.row()
        self.assertEqual((row["state"], row["observedAt"], row["provenance"]["reason"]), ("submitted", OLD, "failed"))
        result = read_submissions(self.repo, "4436", "100")
        self.assertEqual((result["attemptedAt"], result["status"]), (NOW, "failed"))
        self.assertEqual(self.repo.get(PK, "METADATA")["collectedAt"], OLD)

    def test_confirmed_removal_and_activity_removal_hide_obsolete_rows_without_deleting_canonical_data(self):
        self.save()
        save_submissions(self.repo, "4436", candidate(students={}), NOW)
        self.assertIsNone(read_submissions(self.repo, "4436", "100"))
        self.assertIsNotNone(self.repo.get(PK, "STUDENT#100"))
        self.save(candidate(assignments={"12": assignment()}, students={"100": {}}), NEW)
        self.assertEqual(set(read_submissions(self.repo, "4436", "100")["items"]), {"12"})

    def test_older_attempt_is_rejected_before_writing(self):
        self.save(at=NEW)
        before = copy.deepcopy(self.repo.items)
        with self.assertRaises(Conflict):
            self.save(at=NOW)
        self.assertEqual(self.repo.items, before)

    def test_newer_attempt_during_row_write_blocks_old_attempt_and_keeps_new_state(self):
        original = self.repo.transaction
        called = False
        def competing(writes, *args, **kw):
            nonlocal called
            if not called and writes[0][1].startswith("STUDENT#"):
                called = True
                save_submissions(self.repo, "4436", candidate(submission(workflow_state="pending_review")), NEW)
            return original(writes, *args, **kw)
        with patch.object(self.repo, "transaction", side_effect=competing), self.assertRaises(Conflict):
            self.save(at=NOW)
        self.assertEqual(self.row()["state"], "pending_review")
        self.assertEqual(self.row()["observedAt"], NEW)

    def test_partial_row_failure_leaves_running_marker_and_reports_retained_values(self):
        self.save()
        original = self.repo.transaction
        def fail_row(writes, *args, **kw):
            if writes[0][1].startswith("STUDENT#"):
                raise RuntimeError("synthetic failure")
            return original(writes, *args, **kw)
        with patch.object(self.repo, "transaction", side_effect=fail_row), self.assertRaises(RuntimeError):
            self.save(at=NOW)
        self.assertEqual(read_submissions(self.repo, "4436", "100")["status"], "partial")
        self.assertEqual((self.row()["observedAt"], self.row()["provenance"]["reason"]), (OLD, "incomplete"))

    def test_marker_changed_during_read_does_not_mix_two_generations(self):
        self.save()
        original = self.repo.get
        calls = 0
        def changed(pk, sk):
            nonlocal calls
            value = original(pk, sk)
            if sk == "METADATA":
                calls += 1
                if calls == 2:
                    return {**value, "attemptedAt": NEW}
            return value
        with patch.object(self.repo, "get", side_effect=changed):
            result = read_submissions(self.repo, "4436", "100")
        self.assertEqual((result["status"], result["items"]), ("partial", {}))

    def test_expired_persistence_budget_starts_no_new_student_write(self):
        self.save()
        original = self.repo.transaction
        clock = [0]
        def pause_after_marker(writes, *args, **kwargs):
            result = original(writes, *args, **kwargs)
            if writes[0][1] == "METADATA":
                clock[0] = 20
            return result
        with patch("canvas_submissions.time.monotonic", side_effect=lambda: clock[0]), \
             patch.object(self.repo, "transaction", side_effect=pause_after_marker), self.assertRaisesRegex(CanvasError, "orçamento"):
            save_submissions(self.repo, "4436", candidate(), NOW, deadline=10)
        self.assertEqual(self.repo.get(PK, "STUDENT#100")["attemptedAt"], OLD)
        self.assertEqual(read_submissions(self.repo, "4436", "100")["status"], "partial")

    def test_supported_volume_has_separate_bounded_items_and_no_pii(self):
        assignments = {str(i): assignment() for i in range(1, 201)}
        students = {str(i): {str(a): submission() for a in range(1, 201)} for i in range(1, 501)}
        save_submissions(self.repo, "4436", candidate(assignments=assignments, students=students), NOW)
        sizes = [len(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()) for value in self.repo.items.values()]
        self.assertEqual(len(sizes), 501)
        self.assertLess(max(sizes), MAX_ITEM_BYTES)
        self.assertGreater(len(json.dumps(list(self.repo.items.values())).encode()), MAX_ITEM_BYTES)
        self.assertEqual(len(read_submissions(self.repo, "4436", "1")["items"]), 200)

    def test_size_limit_is_checked_before_any_student_or_marker_write(self):
        before = copy.deepcopy(self.repo.items)
        with patch("canvas_submissions.MAX_ITEM_BYTES", 10), self.assertRaisesRegex(ValueError, "tamanho"):
            self.save()
        self.assertEqual(self.repo.items, before)

    def test_legacy_or_invalid_identity_does_not_break_academic_report(self):
        self.assertIsNone(read_submissions(self.repo, "not-configured", "100"))
        self.assertIsNone(read_submissions(self.repo, "4436", "legacy-local-id"))


class SubmissionCollectionTests(unittest.TestCase):
    def fake(self, page_size=2):
        value = course(students=3)
        for task in value["assignments"]:
            task.update(assignment(), course_id=4436)
        for data in value["submissions"]:
            data.update({key: val for key, val in submission().items() if key not in data})
        fake = FakeCanvas({"4436": value}, page_size=page_size)
        return value, fake, CanvasClient(BASE, "synthetic", opener=fake)

    def test_full_pagination_course_user_assignment_ids_and_no_read_status(self):
        value, fake, client = self.fake()
        result = collect_submissions(client, "4436", value["students"])
        self.assertEqual(set(result["students"]), {"100", "101", "102"})
        self.assertEqual(set(result["assignments"]), {"11", "12", "13", "99"})
        self.assertEqual(set(result["students"]["100"]), {"11", "12"})
        self.assertTrue(any("page=2" in url for url in fake.calls))
        self.assertTrue(all("read_status" not in url and "workflow_state" not in url for url in fake.calls))
        self.assertTrue(all("/students/submissions?student_ids[]=all" in url or "/assignments?" in url for url in fake.calls))

    def test_empty_page_with_next_link_still_reads_following_page(self):
        path = BASE + "/api/v1/courses/4436/students/submissions"
        pages = {1: ([], f'<{path}?page=2>; rel="next"'),
                 2: ([{"user_id": 100, "assignment_id": 11, **submission()}], "")}
        def opener(req, timeout=None):
            if "/assignments?" in req.full_url:
                return _Response([{"id": 11, **assignment()}], "")
            page = 2 if "page=2" in req.full_url else 1
            return _Response(*pages[page])
        candidate_value = collect_submissions(CanvasClient(BASE, "synthetic", opener=opener), "4436", [{"id": 100}])
        self.assertEqual(candidate_value["students"]["100"]["11"]["workflow_state"], "submitted")

    def test_grouped_pages_associate_nested_rows_with_parent_user_without_private_payloads(self):
        calls = []
        def opener(req, timeout=None):
            calls.append((req.full_url, timeout))
            if "/assignments?" in req.full_url:
                return _Response([{"id": 11, **assignment()}], "")
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(req.full_url).query)
            self.assertEqual(query.get("grouped"), ["true"])
            self.assertEqual(query.get("per_page"), ["10"])
            page = int(query.get("page", [1])[0])
            row = {"assignment_id": 11, **submission(), "body": "PRIVATE", "score": 10}
            data = [{"user_id": 99 + page, "sis_user_id": "PRIVATE", "submissions": [row]}]
            return _Response(data, f'<{req.full_url}&page=2>; rel="next"' if page == 1 else "")
        value = collect_submissions(CanvasClient(BASE, "synthetic", opener=opener), "4436", [{"id": 100}, {"id": 101}])
        self.assertEqual(set(value["students"]), {"100", "101"})
        self.assertEqual(value["students"]["101"]["11"]["attempt"], 1)
        self.assertNotIn("PRIVATE", json.dumps(value))
        self.assertNotIn('"score"', json.dumps(value))
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(0 < timeout <= 30 for _, timeout in calls))

    def test_group_user_conflict_or_malformed_nested_list_fails_closed(self):
        for group in ({"user_id": 100, "submissions": None},
                      {"user_id": 100, "course_id": 999, "submissions": []},
                      {"user_id": 100, "submissions": [{"user_id": 101, "assignment_id": 11, **submission()}]}):
            with self.subTest(group=group):
                def opener(req, timeout=None):
                    return _Response([{"id": 11, **assignment()}] if "/assignments?" in req.full_url else [group], "")
                with self.assertRaises(CanvasError):
                    collect_submissions(CanvasClient(BASE, "synthetic", opener=opener), "4436", [{"id": 100}])

    def test_permission_network_and_foreign_origin_fail_without_partial_candidate(self):
        value, fake, client = self.fake()
        for error in (urllib.error.HTTPError(BASE, 403, "forbidden", {}, None), urllib.error.URLError("timeout")):
            fake.fail = error
            with self.subTest(error=type(error).__name__), patch("canvas.time.sleep"), self.assertRaises(CanvasError):
                collect_submissions(client, "4436", value["students"])
        requested = []
        def foreign(req, timeout=None):
            requested.append(req.full_url)
            return _Response([], '<https://foreign.example.test/api/v1/courses/4436/assignments?page=2>; rel="next"')
        with self.assertRaises(CanvasError):
            collect_submissions(CanvasClient(BASE, "synthetic", opener=foreign), "4436", [{"id": 100}])
        self.assertEqual(len(requested), 1)

    def test_intermediate_permission_failure_does_not_return_first_page(self):
        calls = []
        def opener(req, timeout=None):
            calls.append(req.full_url)
            if "page=2" in req.full_url:
                raise urllib.error.HTTPError(req.full_url, 403, "forbidden", {}, None)
            return _Response([{"id": 11, **assignment()}], f'<{req.full_url}&page=2>; rel="next"')
        with self.assertRaises(CanvasError):
            collect_submissions(CanvasClient(BASE, "synthetic", opener=opener), "4436", [{"id": 100}])
        self.assertEqual(len(calls), 2)

    def test_budget_exhaustion_is_explicit_failure_not_truncated_success(self):
        value, fake, client = self.fake(page_size=1)
        with patch("canvas_submissions.MAX_PAGES", 1), self.assertRaisesRegex(CanvasError, "orçamento"):
            collect_submissions(client, "4436", value["students"])
        self.assertEqual(len(fake.calls), 1)

    def test_expired_deadline_sends_no_http_request(self):
        value, fake, client = self.fake()
        with self.assertRaisesRegex(CanvasError, "orçamento"):
            collect_submissions(client, "4436", value["students"], deadline=0)
        self.assertEqual(fake.calls, [])

    def test_http_timeout_is_bounded_by_remaining_auxiliary_budget(self):
        seen = []
        def opener(req, timeout=None):
            seen.append(timeout)
            return _Response([], "")
        client = CanvasClient(BASE, "synthetic", opener=opener)
        with patch("canvas.time.monotonic", return_value=100):
            self.assertEqual(client.get_all("/courses/4436/assignments?per_page=100", deadline=105), [])
        self.assertEqual(seen, [5])

    def test_auxiliary_page_limit_is_enforced_before_json_parsing(self):
        response = _Response([{"body": "PRIVATE" * 100}], "")
        original_read, sizes = response.read, []
        def read(size=-1):
            sizes.append(size)
            return original_read(size)
        response.read = read
        client = CanvasClient(BASE, "synthetic", opener=lambda *args, **kwargs: response)
        with patch("canvas.AUX_MAX_PAGE_BYTES", 32), patch("canvas.json.loads") as parse, \
             self.assertRaisesRegex(CanvasError, "tamanho"):
            client.get_all("/courses/4436/assignments?per_page=100", deadline=float("inf"))
        self.assertEqual(sizes, [33])
        parse.assert_not_called()
        self.assertEqual(AUX_MAX_PAGE_BYTES, 4 * 1024 * 1024)

    def test_page_limit_only_applies_to_auxiliary_reads_and_does_not_change_grades(self):
        value, fake, client = self.fake()
        before = course_csv(client, "4436", value["students"])
        repo = MemoryRepository()
        save_submissions(repo, "4436", candidate(), OLD)
        with patch("canvas.AUX_MAX_PAGE_BYTES", 32), self.assertRaisesRegex(CanvasError, "tamanho"):
            collect_submissions(client, "4436", value["students"])
        save_submissions(repo, "4436", None, NOW, failed=True)
        with patch("canvas.AUX_MAX_PAGE_BYTES", 1):
            self.assertEqual(course_csv(client, "4436", value["students"]), before)
        row = read_submissions(repo, "4436", "100")["items"]["11"]
        self.assertEqual((row["state"], row["observedAt"], row["provenance"]["reason"]),
                         ("submitted", OLD, "failed"))

    def test_final_page_completed_after_deadline_is_not_accepted_as_fresh(self):
        clock = [0]
        def opener(req, timeout=None):
            clock[0] = 20
            return _Response([], "")
        client = CanvasClient(BASE, "synthetic", opener=opener)
        with patch("canvas.time.monotonic", side_effect=lambda: clock[0]), self.assertRaisesRegex(CanvasError, "orçamento"):
            client.get_all("/courses/4436/assignments?per_page=100", deadline=10)

    def test_wrong_course_assignment_and_duplicate_conflict_are_not_accepted_as_current(self):
        value, fake, client = self.fake()
        value["assignments"][0]["course_id"] = 999
        with self.assertRaises(CanvasError):
            collect_submissions(client, "4436", value["students"])
        value["assignments"][0]["course_id"] = 4436
        value["submissions"].append({**value["submissions"][0], "attempt": 2})
        result = collect_submissions(client, "4436", value["students"])
        self.assertEqual(result["students"]["100"]["11"]["workflow_state"], "invalid-duplicate")

    def test_auxiliary_changes_do_not_change_csv_bytes_academic_results_or_publication(self):
        from grades import parse_csv
        value, fake, client = self.fake()
        before, count = course_csv(client, "4436", value["students"])
        academic_before = parse_csv(before)
        for data in value["submissions"]:
            data.update(attempt=8, submitted_at="2026-10-20T12:00:00Z", grade_matches_current_submission=False)
        value["submissions"].append({"user_id": 100, "assignment_id": 13, **submission()})
        collect_submissions(client, "4436", value["students"])
        after, next_count = course_csv(client, "4436", value["students"])
        self.assertEqual((before, count, academic_before), (after, next_count, parse_csv(after)))
        self.assertTrue(all("workflow_state=graded" in url for url in fake.calls
                            if "/students/submissions?" in url and "include[]=visibility" not in url))

    def test_sync_reuses_course_and_auxiliary_failure_does_not_block_grades(self):
        repo = MemoryRepository()
        for code in ("BRSAO1", "BRSAO2"):
            repo.put("COHORT#" + code, "METADATA", {"code": code, "name": code, "canvasCourseId": "4436", "autoSync": False})
        value, fake, client = self.fake()
        with patch("canvas_sync._now", return_value=NOW):
            results, failures = run(repo, client)
        self.assertEqual((results, failures), ({}, []))
        starts = [url for url in fake.calls if "/students/submissions?" in url
                  and "page" not in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)]
        self.assertEqual(len(starts), 1)
        self.assertIsNotNone(read_submissions(repo, "4436", "100"))
        with patch("canvas_sync._now", return_value=NEW), patch("canvas_sync.collect_submissions", side_effect=CanvasError("PRIVATE")), \
             self.assertLogs(level="WARNING") as logs:
            results, failures = run(repo, client)
        self.assertEqual((results, failures), ({}, []))
        self.assertNotIn("PRIVATE", "".join(logs.output))
        self.assertEqual(read_submissions(repo, "4436", "100")["status"], "failed")
        self.assertEqual(read_submissions(repo, "4436", "100")["items"]["11"]["observedAt"], NOW)

    def test_delivery_refresh_without_new_grade_creates_no_new_academic_publication(self):
        repo = MemoryRepository()
        repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None,
                                                   "canvasCourseId": "4436", "autoSync": True})
        value, fake, client = self.fake()
        with patch("canvas_sync._now", return_value=OLD):
            self.assertEqual(run(repo, client), ({"BRSA0267": "published"}, []))
        before = repo.get("COHORT#BRSA0267", "METADATA")["current"]
        publications = repo.list("COHORT#BRSA0267", "PUB#")
        auxiliary = next(row for row in value["submissions"] if row["user_id"] == 101 and row["assignment_id"] == 12)
        self.assertIsNone(auxiliary["score"])
        auxiliary.update(submission(workflow_state="pending_review"))
        with patch("canvas_sync._now", return_value=NOW):
            self.assertEqual(run(repo, client), ({"BRSA0267": "unchanged"}, []))
        self.assertEqual(repo.get("COHORT#BRSA0267", "METADATA")["current"], before)
        self.assertEqual(repo.list("COHORT#BRSA0267", "PUB#"), publications)
        self.assertEqual(read_submissions(repo, "4436", "101")["items"]["12"]["state"], "pending_review")
        self.assertEqual(read_submissions(repo, "4436", "101")["items"]["12"]["observedAt"], NOW)

    def test_oversized_auxiliary_page_in_sync_preserves_observations_and_existing_grades(self):
        repo = MemoryRepository()
        repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None,
                                                   "canvasCourseId": "4436", "autoSync": True})
        value, fake, client = self.fake()
        with patch("canvas_sync._now", return_value=OLD):
            self.assertEqual(run(repo, client), ({"BRSA0267": "published"}, []))
        publications = repo.list("COHORT#BRSA0267", "PUB#")
        with patch("canvas_sync._now", return_value=NOW), patch("canvas.AUX_MAX_PAGE_BYTES", 1), \
             self.assertLogs(level="WARNING"):
            self.assertEqual(run(repo, client), ({"BRSA0267": "unchanged"}, []))
        self.assertEqual(repo.list("COHORT#BRSA0267", "PUB#"), publications)
        result = read_submissions(repo, "4436", "100")
        self.assertEqual((result["status"], result["items"]["11"]["observedAt"]), ("failed", OLD))

    def test_all_grade_attempts_precede_auxiliary_read_and_scheduled_proof_is_preserved_on_failure(self):
        repo = MemoryRepository()
        for code in ("BRSA0267", "BRSA0268"):
            repo.put("COHORT#" + code, "METADATA", {"code": code, "current": None,
                                                    "canvasCourseId": "4436", "autoSync": True})
        event = {"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": "2026-10-21T09:00:00Z",
                 "executionId": "synthetic-submissions", "attemptNumber": 1}
        value, fake, client = self.fake()
        def fail_after_grades(*args, **kwargs):
            self.assertTrue(all(repo.get("COHORT#" + code, "METADATA")["current"] for code in ("BRSA0267", "BRSA0268")))
            raise CanvasError("PRIVATE")
        with patch("canvas_sync._now", return_value=NOW), patch("canvas_sync.collect_submissions", side_effect=fail_after_grades), \
             self.assertLogs(level="WARNING") as logs:
            self.assertEqual(run(repo, client, event=event, clock=lambda: NOW),
                             ({"BRSA0267": "published", "BRSA0268": "published"}, []))
        self.assertNotIn("PRIVATE", "".join(logs.output))
        for code in ("BRSA0267", "BRSA0268"):
            proof = repo.get("COHORT#" + code, "SYNC_RUN#2026-10-21T09:00:00Z")
            self.assertEqual(proof["status"], "succeeded")
            self.assertEqual(proof["stages"], {"catalog": "succeeded", "roster": "succeeded", "grades": "published"})


if __name__ == "__main__":
    unittest.main()

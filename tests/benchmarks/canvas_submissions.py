"""Mede operações/tamanho locais de entregas, com HTTP e dados inteiramente fictícios.

PYTHONPATH=backend python tests/benchmarks/canvas_submissions.py --students 500 --assignments 200 --existing
Não mede latência/capacidade AWS ou Canvas; não faz chamadas de rede.
"""
import argparse
import gc
import io
import json
import pathlib
import platform
import resource
import sys
import time
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "integration"))
from canvas import CanvasClient, course_csv
from canvas_submissions import collect_submissions, save_submissions
from test_canvas_submissions import NOW, OLD, assignment, submission
from test_portal import MemoryRepository

BASE = "https://canvas.example.test"


class Response(io.BytesIO):
    def __init__(self, data, link):
        super().__init__(json.dumps(data).encode())
        self.headers = {"Link": link}


def measure(students_count, assignment_count, existing=False):
    calls = []
    def opener(request, timeout=None):
        path = urllib.parse.urlsplit(request.full_url).path
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
        page, size = int(query.get("page", [1])[0]), int(query.get("per_page", [100])[0])
        start = (page - 1) * size
        if path.endswith("/assignments"):
            kind, count = "assignments", assignment_count
            data = [{"id": i + 1, "course_id": 4436, "name": f"{i + 1:03} KC Sintético",
                     "points_possible": 10, **assignment()} for i in range(start, min(start + size, count))]
        elif path.endswith("/users"):
            kind, count = "users", students_count
            data = [{"id": i + 1, "name": f"Pessoa fictícia {i + 1}", "login_id": f"teste{i + 1}@example.test"}
                    for i in range(start, min(start + size, count))]
        elif query.get("grouped") == ["true"]:
            kind, count = "grouped", students_count
            data = [{"user_id": i + 1, "submissions": [{"assignment_id": a + 1,
                      **submission(workflow_state="graded", graded_at=OLD, posted_at=OLD, grade_matches_current_submission=True),
                      "body": "FICTÍCIO" * 20, "score": 0} for a in range(assignment_count)]}
                    for i in range(start, min(start + size, count))]
        else:
            kind, count = "graded", students_count * assignment_count
            data = [{"user_id": i // assignment_count + 1, "assignment_id": i % assignment_count + 1,
                     **submission(workflow_state="graded", graded_at=OLD, posted_at=OLD, grade_matches_current_submission=True), "score": 0}
                    for i in range(start, min(start + size, count))]
        link = f'<{request.full_url.rsplit("&page=", 1)[0]}&page={page + 1}>; rel="next"' if start + size < count else ""
        calls.append({"kind": kind, "bytes": len(json.dumps(data).encode()), "rows": len(data)})
        return Response(data, link)
    client = CanvasClient(BASE, "synthetic-only", opener=opener)
    people = [{"id": i + 1} for i in range(students_count)]
    repo = MemoryRepository()
    if existing:
        previous = collect_submissions(client, "4436", people)
        save_submissions(repo, "4436", previous, OLD)
        del previous
        gc.collect()
        calls.clear()
    start = time.perf_counter()
    csv_text, _ = course_csv(client, "4436")
    grade_seconds = time.perf_counter() - start
    before = list(calls)
    calls.clear()
    start = time.perf_counter()
    candidate = collect_submissions(client, "4436", people)
    collect_seconds = time.perf_counter() - start
    start = time.perf_counter()
    save_submissions(repo, "4436", candidate, NOW)
    save_seconds = time.perf_counter() - start
    sizes = [len(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()) for value in repo.items.values()]
    return {"students": students_count, "assignments": assignment_count, "existing": existing,
            "existing_grade_path": {"requests": len(before), "pages_by_kind": {
                kind: sum(call["kind"] == kind for call in before) for kind in ("assignments", "users", "graded")},
                "response_bytes": sum(call["bytes"] for call in before), "csv_bytes": len(csv_text.encode()),
                "local_seconds": grade_seconds},
            "additional_delivery_path": {"requests": len(calls), "pages_by_kind": {
                kind: sum(call["kind"] == kind for call in calls) for kind in ("assignments", "grouped")},
                "response_bytes": sum(call["bytes"] for call in calls),
                "max_page_bytes": max((call["bytes"] for call in calls), default=0), "student_items": len(sizes) - 1,
                "max_item_bytes": max(sizes), "total_stored_bytes": sum(sizes),
                "local_collect_seconds": collect_seconds, "local_memory_save_seconds": save_seconds},
            "process_peak_rss_native_units": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "rss_units": "bytes" if sys.platform == "darwin" else "KiB",
            "environment": {"python": platform.python_version(), "system": platform.system(),
                            "machine": platform.machine(), "platform": platform.platform()},
            "limits": "HTTP controlado sem rede; MemoryRepository; não certifica AWS/ARM64 ou latência Canvas."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--students", type=int, default=40, choices=range(1, 501))
    parser.add_argument("--assignments", type=int, default=80, choices=range(1, 201))
    parser.add_argument("--existing", action="store_true")
    args = parser.parse_args()
    print(json.dumps(measure(args.students, args.assignments, args.existing), ensure_ascii=False, indent=2))

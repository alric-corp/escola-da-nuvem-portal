"""Observações auxiliares de entrega; nunca participam de notas, vínculos ou lembretes."""
import copy
import itertools
import json
import time

from canvas import CanvasError, _canvas_id
from canvas_activity import activity_date
from repository import Conflict

DIGITAL_TYPES = {"online_text_entry", "online_url", "online_upload", "media_recording", "student_annotation"}
OTHER_TYPES = {"none", "on_paper", "external_tool", "online_quiz", "discussion_topic", "not_graded"}
STATES = {"submitted", "pending_review", "graded", "unsubmitted", "not_applicable", "unknown"}
MAX_ASSIGNMENTS = 200
MAX_STUDENTS = 500
MAX_ITEM_BYTES = 340_000  # margem para chaves e o atributo String `data` do DynamoDB (<400 KiB)
MAX_PAGES = 1000
COLLECTION_SECONDS = 60
SUBMISSION_FIELDS = ("course_id", "user_id", "assignment_id", "workflow_state", "attempt", "submitted_at", "graded_at",
                     "posted_at", "grade_matches_current_submission", "assignment_visible", "excused")


def _submission_fields(entry):
    if not isinstance(entry, dict):
        return entry
    if "submissions" in entry:
        nested = entry["submissions"]
        return {**({"course_id": entry["course_id"]} if "course_id" in entry else {}),
                "user_id": entry.get("user_id"), "submissions": [
            {key: row[key] for key in SUBMISSION_FIELDS if key in row} if isinstance(row, dict) else row
            for row in nested] if isinstance(nested, list) else nested}
    # Compatibilidade defensiva se uma instância devolver a representação plana
    # documentada em vez de aplicar grouped. As mesmas verificações de IDs valem.
    return {key: entry[key] for key in SUBMISSION_FIELDS if key in entry}


def _flat_submissions(groups, course_id):
    for group in groups:
        if not isinstance(group, dict) or "submissions" not in group:
            yield group
            continue
        user = _canvas_id(group.get("user_id"))
        if "course_id" in group and _canvas_id(group["course_id"]) != course_id:
            raise CanvasError("Grupo de submissões Canvas de outro curso.")
        if not isinstance(group["submissions"], list):
            raise CanvasError("Grupo de submissões Canvas inválido.")
        for row in group["submissions"]:
            if not isinstance(row, dict) or "user_id" in row and _canvas_id(row["user_id"]) != user:
                raise CanvasError("Submissão Canvas incompatível com o aluno do grupo.")
            yield {**row, "user_id": user}


def _pk(course_id):
    return "CANVAS_SUBMISSIONS#" + _canvas_id(course_id)


def collect_submissions(client, course_id, students, *, deadline=None):
    """Duas listas coletivas paginadas, sem comentários/entregas/read_status ou aluno individual.

    Orçamento explícito: excedê-lo é falha auxiliar, nunca uma lista completa truncada.
    Cada chamada/retry respeita o tempo restante do orçamento auxiliar.
    """
    course_id = _canvas_id(course_id)
    if not isinstance(students, list):
        raise CanvasError("Matrícula Canvas indisponível para a coleta auxiliar.")
    users = sorted({_canvas_id(student.get("id")) for student in students if isinstance(student, dict)})
    if len(users) != len(students) or len(users) > MAX_STUDENTS:
        raise CanvasError("Matrícula Canvas inválida ou acima do limite da coleta auxiliar.")
    deadline = min(deadline if deadline is not None else float("inf"), time.monotonic() + COLLECTION_SECONDS)
    assignment_fields = ("id", "course_id", "published", "submission_types", "unlock_at", "has_overrides")
    assignments = client.get_all(f"/courses/{course_id}/assignments?per_page=100",
                                 max_pages=MAX_PAGES, deadline=deadline, fields=assignment_fields)
    if len(assignments) > MAX_ASSIGNMENTS:
        raise CanvasError("Curso acima do limite de atividades da coleta auxiliar.")
    found = {}
    for assignment in assignments:
        if not isinstance(assignment, dict):
            raise CanvasError("Atividade Canvas inválida na coleta auxiliar.")
        assignment_id = _canvas_id(assignment.get("id"))
        if (assignment_id in found or "course_id" in assignment and _canvas_id(assignment["course_id"]) != course_id):
            raise CanvasError("Atividade Canvas duplicada ou de outro curso na coleta auxiliar.")
        found[assignment_id] = {key: assignment[key] for key in
                               ("published", "submission_types", "unlock_at", "has_overrides")
                               if key in assignment}
    submissions = client.get_all(
        f"/courses/{course_id}/students/submissions?student_ids[]=all&grouped=true&include[]=visibility&per_page=10",
        max_pages=MAX_PAGES, deadline=deadline, project=_submission_fields)
    rows = {user: {} for user in users}
    for submission in _flat_submissions(submissions, course_id):
        if not isinstance(submission, dict):
            raise CanvasError("Submissão Canvas inválida na coleta auxiliar.")
        user, assignment_id = _canvas_id(submission.get("user_id")), _canvas_id(submission.get("assignment_id"))
        if "course_id" in submission and _canvas_id(submission["course_id"]) != course_id:
            raise CanvasError("Submissão Canvas de outro curso na coleta auxiliar.")
        if assignment_id not in found:
            raise CanvasError("Submissão Canvas sem atividade correspondente na coleta auxiliar.")
        # Aluno removido entre as duas listagens não ganha vínculo nem linha nova.
        if user not in rows:
            continue
        selected = {key: submission[key] for key in ("workflow_state", "attempt", "submitted_at", "graded_at",
                    "posted_at", "grade_matches_current_submission", "assignment_visible", "excused") if key in submission}
        previous = rows[user].get(assignment_id)
        if previous is not None and previous != selected:
            selected = {"workflow_state": "invalid-duplicate"}
        rows[user][assignment_id] = selected
    return {"courseId": course_id, "assignments": found, "students": rows}


def _date(value, at):
    date = activity_date(value)
    return date.isoformat() if date is not None and date <= at else None


def classify_submission(assignment, submission, observed_at):
    """(estado, motivo, campos) sem usar score/grade/missing/late como inferência."""
    at = activity_date(observed_at)
    if at is None:
        raise ValueError("Horário da observação inválido.")
    if not isinstance(assignment, dict):
        return "unknown", "missing-assignment", {}
    submission = submission if isinstance(submission, dict) else {}
    if submission.get("excused") is True:
        return "not_applicable", "excused", {}
    if assignment.get("published") is False or submission.get("assignment_visible") is False:
        return "not_applicable", "not-visible", {}
    types = assignment.get("submission_types")
    if (isinstance(types, list) and types and all(isinstance(t, str) for t in types)
            and set(types) <= OTHER_TYPES):
        return "not_applicable", "submission-type", {}
    if (not isinstance(types, list) or not types or not all(isinstance(t, str) for t in types)
            or not set(types) <= DIGITAL_TYPES):
        return "unknown", "submission-type", {}
    if assignment.get("published") is not True or submission.get("assignment_visible") is not True:
        return "unknown", "visibility", {}
    state = submission.get("workflow_state")
    if state is None:
        return "unknown", "null" if "workflow_state" in submission else "missing", {}
    if not isinstance(state, str) or state not in {"submitted", "pending_review", "graded", "unsubmitted"}:
        return "unknown", "invalid", {}
    attempt = submission.get("attempt")
    submitted = _date(submission.get("submitted_at"), at)
    graded = _date(submission.get("graded_at"), at)
    posted = _date(submission.get("posted_at"), at)
    if state == "unsubmitted":
        # A data de liberação do solicitante não prova a de uma seção com override.
        if submission.get("excused") is not False:
            return "unknown", "applicability", {}
        if assignment.get("has_overrides") is True:
            return "unknown", "overrides", {}
        if assignment.get("has_overrides") is not False or "unlock_at" not in assignment:
            return "unknown", "applicability", {}
        unlock = assignment.get("unlock_at")
        if unlock is not None:
            date = activity_date(unlock)
            if date is None:
                return "unknown", "invalid", {}
            if date > at:
                return "not_applicable", "not-released", {}
        if attempt == 0 and type(attempt) is int and "submitted_at" in submission and submission["submitted_at"] is None:
            return "unsubmitted", None, {"attempt": 0, "submittedAt": None, "gradedAt": None}
        return "unknown", "invalid", {}
    if type(attempt) is not int or attempt < 1 or submitted is None:
        return "unknown", "invalid", {}
    data = {"attempt": attempt, "submittedAt": submitted, "gradedAt": None}
    if state == "pending_review":
        return "pending_review", None, data
    if state == "graded":
        # Não divulgar a existência/data de avaliação ainda oculta ao aluno.
        if (submission.get("grade_matches_current_submission") is True and graded is not None and posted is not None
                and activity_date(graded) >= activity_date(submitted)):
            return "graded", None, {**data, "gradedAt": graded}
        if submission.get("grade_matches_current_submission") is False or posted is None:
            return "submitted", "evaluation-unconfirmed", data
        return "unknown", "invalid", {}
    return "submitted", None, data


def _merge(previous, assignment, submission, observed_at, attempted_at):
    old = previous if isinstance(previous, dict) and previous.get("state") in STATES else {}
    state, reason, fields = classify_submission(assignment, submission, observed_at)
    old_meta = old.get("provenance") if isinstance(old.get("provenance"), dict) else {}
    prior_observed = old_meta.get("lastValidObservedAt") or old.get("observedAt")
    if state == "unknown" and reason != "null":
        retained = old.get("state") not in (None, "unknown")
        return {"state": old.get("state", "unknown"), "attempt": old.get("attempt"),
                "submittedAt": old.get("submittedAt"), "gradedAt": old.get("gradedAt"),
                "observedAt": old.get("observedAt"), "provenance": {
                    "status": "retained" if retained else "unknown", "reason": reason,
                    "attemptedAt": attempted_at, "lastValidObservedAt": prior_observed}}
    valid = state != "unknown"
    return {"state": state, "attempt": fields.get("attempt"), "submittedAt": fields.get("submittedAt"),
            "gradedAt": fields.get("gradedAt"), "observedAt": observed_at if valid else None,
            "provenance": {"status": "current" if valid else "unknown", "reason": reason,
                           "attemptedAt": attempted_at,
                           "lastValidObservedAt": observed_at if valid else prior_observed}}


def save_submissions(repo, course_id, candidate, collected_at, *, attempted_at=None, failed=False, deadline=None):
    """CAS por curso + por aluno; sem retry, sem matriz única e sem escrita acadêmica.

    O marcador running é conservador após interrupção: leituras retêm datas antigas
    e nunca confundem a tentativa com observação. Uma tentativa nova pode sucedê-lo.
    """
    course_id, pk = _canvas_id(course_id), _pk(course_id)
    observed, attempted = activity_date(collected_at), activity_date(attempted_at or collected_at)
    if observed is None or attempted is None or observed < attempted:
        raise ValueError("Horário da coleta de entregas inválido.")
    observed_at, at = observed.isoformat(), attempted.isoformat()
    previous = repo.get(pk, "METADATA")
    if previous and previous.get("courseId") != course_id:
        raise ValueError("Registro auxiliar de outro curso.")
    previous_at = activity_date((previous or {}).get("attemptedAt"))
    if previous_at is not None and attempted <= previous_at:
        raise Conflict("Tentativa auxiliar de entregas superada.")
    old_users = (previous or {}).get("studentIds", [])
    if failed:
        marker = {**(previous or {}), "courseId": course_id, "attemptedAt": at,
                  "status": "failed", "studentIds": old_users}
        repo.transaction([(pk, "METADATA", marker, previous)])
        return
    if (not isinstance(candidate, dict) or candidate.get("courseId") != course_id
            or not isinstance(candidate.get("students"), dict) or not isinstance(candidate.get("assignments"), dict)):
        raise ValueError("Candidato auxiliar inválido.")
    assignments, students = candidate["assignments"], candidate["students"]
    if len(assignments) > MAX_ASSIGNMENTS or len(students) > MAX_STUDENTS:
        raise ValueError("Candidato auxiliar acima do limite suportado.")
    def within_budget():
        if deadline is not None and time.monotonic() >= deadline:
            raise CanvasError("Persistência auxiliar Canvas excedeu o orçamento de execução.")
    within_budget()
    if any(not isinstance(rows, dict) or _canvas_id(user) != user for user, rows in students.items()):
        raise ValueError("Aluno auxiliar inválido.")
    def writes():
        # Uma linha antiga + nova por vez. Reter todas as 500 cópias antigas e
        # novas simultaneamente consumiria memória desnecessária na Lambda.
        for user, submissions in sorted(students.items()):
            within_budget()
            sk = "STUDENT#" + user
            old = repo.get(pk, sk)
            old_items = (old or {}).get("items", {})
            items = {assignment_id: _merge(old_items.get(assignment_id), assignment, submissions.get(assignment_id),
                                          observed_at, at) for assignment_id, assignment in sorted(assignments.items())}
            record = {"courseId": course_id, "canvasUserId": user, "attemptedAt": at, "items": items}
            if len(json.dumps(record, ensure_ascii=False, sort_keys=True).encode("utf-8")) > MAX_ITEM_BYTES:
                raise ValueError("Registro auxiliar por aluno acima do limite de tamanho.")
            yield pk, sk, record, old
    pending = writes()
    first = next(pending, None)  # valida o primeiro item antes de criar o marcador
    marker = {"courseId": course_id, "attemptedAt": at, "status": "running",
              "studentIds": sorted(students), "collectedAt": (previous or {}).get("collectedAt")}
    within_budget()
    repo.transaction([(pk, "METADATA", marker, previous)])
    complete = True
    for write in itertools.chain(() if first is None else (first,), pending):
        within_budget()
        complete &= all(row["provenance"]["status"] == "current" for row in write[2]["items"].values())
        repo.transaction([write], checks=[(pk, "METADATA", marker)])
    within_budget()
    final = {**marker, "status": "complete" if complete else "partial",
             "collectedAt": observed_at if complete else marker.get("collectedAt")}
    repo.transaction([(pk, "METADATA", final, marker)])


def read_submissions(repo, course_id, canvas_user_id, assignment_ids=None):
    """Whitelist de um aluno já autorizado pelo chamador; nenhuma concessão de acesso.

    A segunda leitura do marcador detecta concorrência com uma nova tentativa.
    Esse envelope é atual e não pertence a uma publicação histórica de notas.
    """
    if not course_id or not canvas_user_id:
        return None
    try:
        course_id, user = _canvas_id(course_id), _canvas_id(canvas_user_id)
    except CanvasError:
        return None  # configuração legada/ID indisponível não quebra o relatório acadêmico
    pk = _pk(course_id)
    metadata = repo.get(pk, "METADATA")
    if not metadata or metadata.get("courseId") != course_id or user not in metadata.get("studentIds", []):
        return None
    record = repo.get(pk, "STUDENT#" + user)
    current = repo.get(pk, "METADATA")
    if not record or record.get("courseId") != course_id or record.get("canvasUserId") != user:
        return None
    if current != metadata:
        # A leitura não mistura linhas de duas tentativas. Próximo carregamento pode obtê-las.
        return {"courseId": course_id, "attemptedAt": (current or {}).get("attemptedAt"),
                "status": "partial", "items": {}}
    selected = None if assignment_ids is None else {str(i) for i in assignment_ids}
    items = {}
    for assignment_id, raw in record.get("items", {}).items():
        if selected is not None and assignment_id not in selected or not isinstance(raw, dict) or raw.get("state") not in STATES:
            continue
        row = {key: copy.deepcopy(raw.get(key)) for key in
               ("state", "attempt", "submittedAt", "gradedAt", "observedAt", "provenance")}
        if not isinstance(row["provenance"], dict):
            row["provenance"] = {"status": "unknown", "reason": "legacy", "attemptedAt": None,
                                 "lastValidObservedAt": None}
        if record.get("attemptedAt") != metadata.get("attemptedAt"):
            row["provenance"].update(status="retained" if row["state"] != "unknown" else "unknown",
                                     reason="failed" if metadata.get("status") == "failed" else "incomplete",
                                     attemptedAt=metadata.get("attemptedAt"))
        items[assignment_id] = row
    return {"courseId": course_id, "attemptedAt": metadata.get("attemptedAt"),
            "status": metadata.get("status") if metadata.get("status") in ("complete", "partial", "failed") else "partial",
            "items": items}

"""Atividade acumulada do Canvas, separada das publicações de notas e sem dados pessoais.

Uma linha por Canvas User ID e curso. Matrículas/seções podem representar interações
sobrepostas: usamos o maior contador disponível, nunca a soma; a data é a mais recente.
Tempo registrado não equivale a tempo efetivo de estudo.
"""
from datetime import datetime, timezone
import re


def activity_date(value):
    if not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.astimezone(timezone.utc) if date.tzinfo is not None else None
    except ValueError:
        return None


def activity_record(course_id, students, collected_at):
    course_id = str(course_id)
    collected = activity_date(collected_at)
    if collected is None:
        raise ValueError("Horário da coleta inválido.")
    rows, available = {}, False
    for student in students:
        user_id = str(student.get("id", ""))
        if not re.fullmatch(r"\d{1,32}", user_id):
            continue
        row = rows.setdefault(user_id, {"total_activity_time": None, "last_activity_at": None})
        enrollments = student.get("enrollments")
        for enrollment in enrollments if isinstance(enrollments, list) else []:
            if (not isinstance(enrollment, dict) or enrollment.get("type") != "StudentEnrollment"
                    or str(enrollment.get("course_id")) != course_id
                    or str(enrollment.get("user_id")) != user_id
                    or enrollment.get("enrollment_state") in ("deleted", "rejected")):
                continue
            available |= "total_activity_time" in enrollment or "last_activity_at" in enrollment
            seconds = enrollment.get("total_activity_time")
            if type(seconds) is int and seconds >= 0:
                previous = row["total_activity_time"]
                row["total_activity_time"] = seconds if previous is None else max(previous, seconds)
            date = activity_date(enrollment.get("last_activity_at"))
            if date is not None and date <= collected:
                previous = activity_date(row["last_activity_at"])
                if previous is None or date > previous:
                    row["last_activity_at"] = date.isoformat()
    if not available:
        return None  # campo omitido por permissão/instância: preserva a coleta anterior
    return {"courseId": course_id, "collectedAt": collected.isoformat(), "students": rows}


def save_activity(repo, course_id, students, collected_at):
    record = activity_record(course_id, students, collected_at)
    if record is not None:
        repo.put("CANVAS_ACTIVITY#" + str(course_id), "METADATA", record)
    return record is not None


def instructor_activity(repo, course_id):
    if not course_id:
        return None
    record = repo.get("CANVAS_ACTIVITY#" + str(course_id), "METADATA")
    if (record and record.get("courseId") == str(course_id)
            and activity_date(record.get("collectedAt")) is not None
            and isinstance(record.get("students"), dict)):
        return record
    return None


def student_activity(record, canvas_id):
    """Whitelist da resposta do instrutor; nunca copiar o payload Canvas para a API."""
    row = record["students"].get(str(canvas_id)) if record else None
    if not isinstance(row, dict):
        return {}
    return {"canvasActivity": {"totalActivityTime": row.get("total_activity_time"),
                               "lastActivityAt": row.get("last_activity_at"),
                               "collectedAt": record["collectedAt"]}}

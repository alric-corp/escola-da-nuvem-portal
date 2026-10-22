"""Atividade acumulada do Canvas, separada das publicações de notas e sem dados pessoais.

Uma linha por Canvas User ID e curso. Matrículas/seções podem representar interações
sobrepostas: usamos o maior contador disponível, nunca a soma; a data é a mais recente.
Tempo registrado não equivale a tempo efetivo de estudo.
"""
from datetime import datetime, timezone
import re

from repository import Conflict

FIELDS = {"total_activity_time": "totalActivityTime", "last_activity_at": "lastActivityAt"}
PROVENANCE_KEYS = ("status", "observedAt", "referenceAt", "reason", "attemptedAt", "lastValidObservedAt")


def activity_date(value):
    if not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.astimezone(timezone.utc) if date.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def activity_record(course_id, students, collected_at):
    """Normalização pura legada; o writer abaixo adiciona preservação e proveniência."""
    course_id = str(course_id)
    collected = activity_date(collected_at)
    if collected is None:
        raise ValueError("Horário da coleta inválido.")
    observed, _ = _observations(course_id, students, collected)
    if not any(reason in ("current", "null", "invalid") for fields in observed.values() for reason, _ in fields.values()):
        return None  # campo omitido por permissão/instância: preserva a coleta anterior
    rows = {user: {field: value for field, (_, value) in fields.items()} for user, fields in observed.items()}
    return {"courseId": course_id, "collectedAt": collected.isoformat(), "students": rows}


def _observations(course_id, students, at):
    """Agrupa as seções por usuário; valor válido vence null, inválido e omissão.

    Sem um valor válido, null explícito significa ausência atual e não reutiliza o
    valor antigo. Datas futuras/sem fuso e contadores inválidos não são observações.
    """
    rows, eligible_users, enrollment_lists = {}, set(), set()
    valid_list = isinstance(students, list)
    for student in students if isinstance(students, list) else []:
        if not isinstance(student, dict) or not re.fullmatch(r"\d{1,32}", str(student.get("id", ""))):
            valid_list = False
            continue
        user = str(student["id"])
        fields = rows.setdefault(user, {field: [] for field in FIELDS})
        enrollments = student.get("enrollments")
        if not isinstance(enrollments, list):
            continue
        enrollment_lists.add(user)
        for enrollment in enrollments:
            if (not isinstance(enrollment, dict) or enrollment.get("type") != "StudentEnrollment"
                    or str(enrollment.get("course_id")) != course_id or str(enrollment.get("user_id")) != user
                    or enrollment.get("enrollment_state") in ("deleted", "rejected")):
                continue
            eligible_users.add(user)
            for field in FIELDS:
                if field not in enrollment:
                    continue
                value = enrollment[field]
                if value is None:
                    fields[field].append(("null", None))
                elif field == "total_activity_time":
                    fields[field].append(("current", value) if type(value) is int and value >= 0 else ("invalid", None))
                else:
                    date = activity_date(value)
                    fields[field].append(("current", date.isoformat()) if date is not None and date <= at
                                         else ("invalid", None))
    result = {}
    for user, fields in rows.items():
        result[user] = {}
        for field, values in fields.items():
            valid = [value for status, value in values if status == "current"]
            # ISO normalizado em UTC; ordenação de datas coincide com a cronológica.
            reason = ("current" if valid else "null" if any(s == "null" for s, _ in values) else "invalid" if values
                      else "no-enrollment" if user in enrollment_lists and user not in eligible_users else "missing")
            result[user][field] = (reason, max(valid) if valid else None)
    return result, valid_list


def _previous_field(record, row, field):
    value = row.get(field)
    if field == "total_activity_time":
        value = value if type(value) is int and value >= 0 else None
    else:
        date = activity_date(value)
        value = date.isoformat() if date is not None else None
    existing = (row.get("provenance") or {}).get(FIELDS[field])
    if isinstance(existing, dict):
        provenance = {key: existing.get(key) for key in PROVENANCE_KEYS}
    else:
        # Uma coleta global legada não comprova quando este campo foi observado.
        provenance = {"status": "retained" if value is not None else "unknown", "reason": "legacy" if row else "missing",
                      "observedAt": None, "referenceAt": record.get("collectedAt") if row else None,
                      "attemptedAt": record.get("attemptedAt"), "lastValidObservedAt": None}
    return value, provenance


def save_activity(repo, course_id, students, collected_at, *, complete=False, failed=False, attempted_at=None):
    """Uma tentativa auxiliar por curso, CAS sem retry e sem apagar dados em falha.

    `attempted_at` identifica o início da consulta; `collected_at`, sua conclusão.
    O início ordena tentativas, e a conclusão limita datas e registra observações.
    Somente o chamador que concluiu a paginação pode informar complete=True.
    Retorna se houve algum campo observado (inclusive null), não se gravou metadata.
    """
    course_id, collected = str(course_id), activity_date(collected_at)
    attempted = activity_date(attempted_at if attempted_at is not None else collected_at)
    if collected is None or attempted is None or collected < attempted:
        raise ValueError("Horário da coleta inválido.")
    at, observed_at, pk = attempted.isoformat(), collected.isoformat(), "CANVAS_ACTIVITY#" + course_id
    previous = repo.get(pk, "METADATA")
    if previous and previous.get("courseId") != course_id:
        raise ValueError("Registro de atividade de outro curso.")
    previous = previous or None
    previous_at = activity_date((previous or {}).get("attemptedAt") or (previous or {}).get("collectedAt"))
    if previous_at is not None and attempted <= previous_at:
        raise Conflict("Tentativa auxiliar superada.")
    observed, valid_list = _observations(course_id, students, collected) if not failed else ({}, False)
    complete = complete and valid_list and not failed
    old_rows = (previous or {}).get("students", {})
    users = set(observed) if complete else set(observed) | set(old_rows)
    rows, any_observed, all_observed = {}, False, complete
    for user in sorted(users):
        row, provenance = {}, {}
        for field, api_name in FIELDS.items():
            old_value, prior = _previous_field(previous or {}, old_rows.get(user, {}), field)
            reason, value = observed.get(user, {}).get(field, ("missing" if complete else "incomplete", None))
            if failed:
                reason = "failed"
            known = reason in ("current", "null")
            any_observed |= known
            all_observed &= known
            last_valid = prior.get("lastValidObservedAt") or prior.get("observedAt")
            if reason == "current":
                meta = {"status": "current", "observedAt": observed_at, "referenceAt": None, "reason": None,
                        "attemptedAt": at, "lastValidObservedAt": observed_at}
            elif reason == "null":
                meta = {"status": "unknown", "observedAt": None, "referenceAt": prior.get("referenceAt"),
                        "reason": "null", "attemptedAt": at, "lastValidObservedAt": last_valid}
            else:
                value = old_value
                meta = {**prior, "status": "retained" if value is not None else "unknown", "reason": reason,
                        "attemptedAt": at}
            row[field], provenance[api_name] = value, meta
        rows[user] = {**row, "provenance": provenance}
    record = {"courseId": course_id, "collectedAt": observed_at if all_observed else (previous or {}).get("collectedAt"),
              "attemptedAt": at, "status": "failed" if failed else "complete" if all_observed else "partial",
              "students": rows}
    repo.transaction([(pk, "METADATA", record, previous)])
    return any_observed


def instructor_activity(repo, course_id):
    if not course_id:
        return None
    record = repo.get("CANVAS_ACTIVITY#" + str(course_id), "METADATA")
    if (record and record.get("courseId") == str(course_id)
            and (activity_date(record.get("collectedAt")) is not None or activity_date(record.get("attemptedAt")) is not None)
            and isinstance(record.get("students"), dict)):
        return record
    return None


def student_activity(record, canvas_id):
    """Whitelist da resposta do instrutor; nunca copiar o payload Canvas para a API."""
    row = record["students"].get(str(canvas_id)) if record else None
    if not isinstance(row, dict):
        return {}
    values = {api: _previous_field(record, row, field) for field, api in FIELDS.items()}
    return {"canvasActivity": {**{api: value for api, (value, _) in values.items()},
                               "collectedAt": record.get("collectedAt"),
                               "provenance": {api: meta for api, (_, meta) in values.items()}}}


def activity_summary(record):
    """Envelope aditivo do relatório autorizado; sem Canvas ou cópia de payload pessoal."""
    if not record:
        return {}
    return {"canvasEngagement": {"courseId": record["courseId"], "collectedAt": record.get("collectedAt"),
                                 "attemptedAt": record.get("attemptedAt"), "status": record.get("status", "legacy")}}

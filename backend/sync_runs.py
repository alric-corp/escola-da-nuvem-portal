"""Prova do sync por turma/ocorrência; não agenda, não dispara lembretes nem inventa contexto."""
import hashlib
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from repository import Conflict

TIMEZONE = ZoneInfo("America/Sao_Paulo")
SOURCE = "portal.scheduler"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def instant(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise ValueError("Horário agendado inválido") from None


def canonical_time(value):
    return instant(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def scheduler_event(event):
    """Borda do Scheduler: jsonencode mantém o placeholder numérico como string JSON.

    Não altera eventos legados nem fabrica horário/tentativa. O domínio recebe int.
    """
    if (not isinstance(event, dict) or event.get("source") != SOURCE
            or event.get("type") not in ("canvas-sync", "automatic-reminders")):
        return event
    attempt = event.get("attemptNumber")
    if isinstance(attempt, str) and re.fullmatch(r"[1-9][0-9]{0,8}", attempt):
        attempt = int(attempt)
    if type(attempt) is not int or attempt < 1:
        raise ValueError("Tentativa agendada inválida")
    return {**event, "attemptNumber": attempt}


def scheduled_context(event):
    if not isinstance(event, dict) or event.get("source") != SOURCE or event.get("type") != "canvas-sync":
        return None
    scheduled = instant(event.get("scheduledFor"))
    local = scheduled.astimezone(TIMEZONE)
    execution, attempt = event.get("executionId"), event.get("attemptNumber")
    if (local.hour not in (6, 18) or local.minute or local.second or local.microsecond
            or not isinstance(execution, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,256}", execution)
            or type(attempt) is not int or attempt < 1):
        raise ValueError("Contexto agendado inválido")
    return {"source": SOURCE, "scheduledFor": canonical_time(event["scheduledFor"]),
            "executionId": execution, "attemptNumber": attempt}


def evening_sync_key(automatic_scheduled_for):
    local = instant(automatic_scheduled_for).astimezone(TIMEZONE)
    evening = local.replace(hour=18, minute=0, second=0, microsecond=0)
    return "SYNC_RUN#" + canonical_time(evening.isoformat())


def metadata_version(metadata):
    # Inclui updatedAt/updateKind: detectar X→Y→restore X, não só igualdade do current.
    return hashlib.sha256(json.dumps(metadata, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class SyncRun:
    """running sem finishedAt é prova incompleta. Tentativa antiga nunca finaliza por cima de outra.

    Não há claim/retry de envio aqui. A CAS apenas mantém a prova da tentativa do Canvas
    coerente; execução/retentativa do Scheduler continuam fora deste domínio.
    """
    def __init__(self, repo, cohort, context, clock=None):
        if set(context) != {"source", "scheduledFor", "executionId", "attemptNumber"}:
            raise ValueError("Use somente o contexto agendado validado")
        code = cohort["code"]
        self.cohort = cohort
        self.repo, self.code, self.pk = repo, code, "COHORT#" + code
        self.clock = clock or utc_now
        self.sk = "SYNC_RUN#" + context["scheduledFor"]
        previous = repo.get(self.pk, self.sk)
        if previous and previous["attemptNumber"] >= context["attemptNumber"]:
            raise Conflict()
        at = self.clock()
        if instant(at) < instant(context["scheduledFor"]):
            raise ValueError("Sync não pode começar antes da ocorrência agendada")
        self.stages = {"catalog": "pending", "roster": "pending", "grades": "pending"}
        self.record = {**context, "startedAt": at, "finishedAt": None, "status": "running",
                       "publicationId": None, "metadataVersion": None, "stages": dict(self.stages)}
        repo.transaction([(self.pk, self.sk, self.record, previous)])

    def completion_write(self, metadata, data_status):
        if (metadata.get("code") != self.code or not metadata.get("current")
                or data_status not in ("published", "unchanged")):
            raise ValueError("Prova de publicação inválida")
        stages = {**self.stages, "grades": data_status}
        status = "succeeded" if all(stages[s] == "succeeded" for s in ("catalog", "roster")) else "failed"
        record = {**self.record, "finishedAt": self.clock(), "status": status, "stages": stages,
                  "publicationId": metadata["current"], "metadataVersion": metadata_version(metadata)}
        if instant(record["finishedAt"]) < instant(self.record["startedAt"]):
            raise ValueError("Fim do sync anterior ao início")
        return self.pk, self.sk, record, self.record

    def accept(self, write):
        self.record = write[2]

    def complete_unchanged(self, metadata):
        write = self.completion_write(metadata, "unchanged")
        self.repo.transaction([write], checks=[(self.pk, "METADATA", metadata)])
        self.accept(write)

    def fail(self):
        if self.record["status"] != "running":
            return
        stages = dict(self.stages)
        if stages["grades"] == "pending":
            stages["grades"] = "skipped" if stages["roster"] == "failed" else "failed"
        record = {**self.record, "status": "failed", "finishedAt": self.clock(), "stages": stages}
        self.repo.transaction([(self.pk, self.sk, record, self.record)])
        self.record = record

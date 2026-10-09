"""Orquestração interna e adaptador Lambda. Dependências e gates são explícitos.

Somente o handler constrói clientes AWS; o domínio continua injetável.
Dry-run é o padrão; nenhum evento pode fornecer remetente, destinatários ou habilitação.
"""
import json
import logging
import os
import re
import time
import uuid
from datetime import timedelta

import reminders
from repository import Conflict, Repository
from sync_runs import SOURCE, TIMEZONE, canonical_time, evening_sync_key, instant, metadata_version, scheduler_event, utc_now

SLOT = (20, 0)  # horário local (America/Sao_Paulo) de toda ocorrência
LIVE_WEEKDAYS = (1, 4)  # terça e sexta: calendário operacional do envio
WINDOW = timedelta(minutes=30)
DRY_RUN_DELAY = timedelta(minutes=90)  # diagnóstico 21h30–22h; referência/prova continuam às 20h
DRY_RUN_DELAYS = {"BRSA0257": timedelta(hours=4, minutes=30)}  # temporário: 00h30–01h do dia seguinte
LEASE = timedelta(seconds=120)
SKIP_REASONS = {"withdrawn", "no-email", "no-pending", "already-sent", "not-found"}
CONFIG_REASONS = {"settings-missing", "settings-invalid", "automatic-disabled", "sender-unlinked", "sender-invalid"}


def occurrence_context(event):
    """Slot diário exato às 20h locais. O dia de envio LIVE é conferido por live_day."""
    required = {"source", "type", "scheduledFor", "executionId", "attemptNumber"}
    if (not isinstance(event, dict) or set(event) != required or event["source"] != SOURCE
            or event["type"] != "automatic-reminders"):
        raise ValueError("Ocorrência automática inválida")
    at = instant(event["scheduledFor"])
    local = at.astimezone(TIMEZONE)
    if ((local.hour, local.minute) != SLOT or local.second or local.microsecond
            or not isinstance(event["executionId"], str)
            or not re.fullmatch(r"[A-Za-z0-9_:-]{1,256}", event["executionId"])
            or type(event["attemptNumber"]) is not int or event["attemptNumber"] < 1):
        raise ValueError("Ocorrência automática inválida")
    return {**event, "scheduledFor": canonical_time(event["scheduledFor"])}


def live_day(scheduled_for):
    """LIVE segue terça/sexta; dry-run é diagnóstico em qualquer dia, com as mesmas provas."""
    return instant(scheduled_for).astimezone(TIMEZONE).weekday() in LIVE_WEEKDAYS


def empty_counts():
    return {"total": 0, "eligible": 0, "pending": 0, "sent": 0, "failed": 0,
            "unknown": 0, "sending": 0, "skipped": 0, "skipReasons": {}}


class Stop(Exception):
    def __init__(self, reason):
        self.reason = reason


class CohortRun:
    def __init__(self, repo, mailer, context, code, domain, *, enabled, dry_run, clock,
                 sleep, delay_seconds, remaining_ms, emit):
        self.repo, self.mailer, self.context, self.code, self.domain = repo, mailer, context, code, domain
        self.enabled, self.dry_run, self.clock = enabled, dry_run, clock
        self.sleep, self.delay_seconds, self.remaining_ms, self.emit = sleep, delay_seconds, remaining_ms, emit
        self.pk = "COHORT#" + code
        self.sk = "AUTO_REMINDER#" + context["scheduledFor"]
        self.actor = "system:auto-reminder:" + context["scheduledFor"]
        self.scheduled = instant(context["scheduledFor"])
        delay = DRY_RUN_DELAYS.get(code, DRY_RUN_DELAY) if dry_run else timedelta()
        self.window_start = self.scheduled + delay
        self.deadline = self.window_start + WINDOW
        self.record = self.publication = self.snapshot = self.old = None
        self.counts = empty_counts()

    def now(self):
        return instant(self.clock())

    def check_window(self):
        at = self.now()
        if at < self.window_start:
            raise Stop("not-due")
        if at >= self.deadline:
            raise Stop("window-expired")
        return at

    def prepare(self):
        if not self.dry_run and not live_day(self.context["scheduledFor"]):
            raise Stop("not-due")
        at = self.check_window()
        if not self.dry_run and not self.enabled:
            raise Stop("infrastructure-disabled")
        self.cohort = self.repo.get(self.pk, "METADATA")
        if not self.cohort or self.cohort.get("code") != self.code:
            raise Stop("cohort-missing")
        self.sync_key = evening_sync_key(self.context["scheduledFor"])
        self.proof = self.repo.get(self.pk, self.sync_key)
        proof = self.proof or {}
        try:
            slot = instant(self.sync_key[9:])
            valid = (proof.get("source") == SOURCE and proof.get("status") == "succeeded"
                     and proof.get("scheduledFor") == self.sync_key[9:]
                     and proof.get("stages", {}).get("catalog") == "succeeded"
                     and proof.get("stages", {}).get("roster") == "succeeded"
                     and proof.get("stages", {}).get("grades") in ("published", "unchanged")
                     and slot <= instant(proof.get("startedAt")) <= instant(proof.get("finishedAt")) <= self.scheduled <= at)
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise Stop("sync-invalid")
        if (not self.cohort.get("current") or proof.get("publicationId") != self.cohort["current"]
                or proof.get("metadataVersion") != metadata_version(self.cohort)):
            raise Stop("publication-changed")
        sender = reminders.automatic_sender_readiness(self.repo, self.code, self.domain, self.mailer)
        if not sender["ready"]:
            reason = sender.get("reason")
            raise Stop(reason if reason in CONFIG_REASONS else "sender-not-ready")
        self.settings, self.sender = sender["settings"], sender["sender"]
        uid = self.settings["senderUserId"]
        link = self.repo.get(self.pk, "TEACH#" + uid)
        reverse = self.repo.get("USER#" + uid, "TEACH#" + self.code)
        if (not link or link.get("email") != self.sender or link.get("userId") != uid
                or link.get("code") != self.code or not reverse or reverse.get("code") != self.code):
            raise Stop("sender-changed")
        self.sender_version = metadata_version({"settings": self.settings, "link": link, "reverse": reverse})
        self.conditions = [(self.pk, self.sync_key, self.proof), (self.pk, "REMINDER_SETTINGS", self.settings),
                           (self.pk, "TEACH#" + uid, link), ("USER#" + uid, "TEACH#" + self.code, reverse)]

    def check_context(self):
        if self.repo.get(self.pk, "METADATA") != self.cohort:
            raise Stop("publication-changed")
        for pk, sk, expected in self.conditions:
            if self.repo.get(pk, sk) != expected:
                raise Stop("sync-changed" if sk == self.sync_key else "sender-changed")

    def previous(self):
        old = self.repo.get(self.pk, self.sk)
        if old:
            if (old.get("publicationId") != self.cohort["current"]
                    or old.get("metadataVersion") != self.proof["metadataVersion"]):
                raise Stop("publication-changed")
            if old.get("senderVersion") != self.sender_version:
                raise Stop("sender-changed")
        return old

    def acquire(self):
        old = self.old
        if old:
            if old.get("status") != "running" and not old.get("retryable"):
                self.counts = old["counts"]
                raise Stop("already-finished")
            if old.get("status") == "running" and instant(old["leaseUntil"]) > self.now():
                raise Stop("lease-active")
        at = self.check_window()
        record = {"cohort": self.code, "scheduledFor": self.context["scheduledFor"],
                  "publicationId": self.cohort["current"], "metadataVersion": self.proof["metadataVersion"],
                  "syncKey": self.sync_key, "senderVersion": self.sender_version, "settingsVersion": self.settings["version"],
                  "executionId": self.context["executionId"], "attemptNumber": self.context["attemptNumber"],
                  "attempts": (old or {}).get("attempts", 0) + 1, "owner": uuid.uuid4().hex,
                  "leaseUntil": min(at + LEASE, self.deadline).isoformat(), "startedAt": (old or {}).get("startedAt", at.isoformat()),
                  "updatedAt": at.isoformat(), "finishedAt": None, "status": "running", "retryable": True,
                  "counts": (old or {}).get("counts", empty_counts())}
        try:
            self.repo.transaction([(self.pk, self.sk, record, old)],
                                  checks=[(self.pk, "METADATA", self.cohort), *self.conditions])
        except Conflict:
            raise Stop("claim-conflict") from None
        self.record = record

    def renew(self):
        at = self.check_window()
        if instant(self.record["leaseUntil"]) <= at or self.repo.get(self.pk, self.sk) != self.record:
            raise Stop("lease-lost")
        self.check_context()
        updated = {**self.record, "leaseUntil": min(at + LEASE, self.deadline).isoformat(), "updatedAt": at.isoformat()}
        try:
            self.repo.transaction([(self.pk, self.sk, updated, self.record)],
                                  checks=[(self.pk, "METADATA", self.cohort), *self.conditions])
        except Conflict:
            self.check_context()
            raise Stop("lease-lost") from None
        self.record = updated

    def summarize(self):
        """Reconstituído de REMINDER, inclusive se houve queda depois de SES/persistência.

        pending é trabalho seguramente retomável (inclui failed elegível), não um
        contador de tentativas. eligible conta ativos com pendência/e-mail, antes do dedupe.
        """
        counts = empty_counts()
        if self.snapshot is None:
            return counts
        withdrawn = reminders.withdrawn_ids(self.repo, self.code)
        for student in self.snapshot["students"]:
            c = reminders.evaluate_recipient(self.repo, self.cohort, self.publication, self.snapshot, student["id"], withdrawn)
            counts["total"] += 1
            if c["skip"] in (None, "already-sent"):
                counts["eligible"] += 1
            if c["skip"] is None:
                counts["pending"] += 1
            previous = c.get("_previous") or {}
            if previous.get("by") == self.actor and previous.get("status") in ("sent", "failed", "unknown", "sending"):
                counts[previous["status"]] += 1
            elif c["skip"] in SKIP_REASONS:
                counts["skipped"] += 1
                counts["skipReasons"][c["skip"]] = counts["skipReasons"].get(c["skip"], 0) + 1
        return counts

    def result(self, status, reason=None, retryable=False):
        return {"cohort": self.code, "scheduledFor": self.context["scheduledFor"], "dryRun": self.dry_run,
                "publicationId": self.record["publicationId"] if self.record else
                self.publication["id"] if self.publication else self.old["publicationId"] if self.old else None,
                "status": status, "reason": reason, "retryable": retryable, "counts": self.counts}

    def finish(self, reason=None):
        self.counts = self.summarize()
        at = self.now()
        retryable = (self.counts["pending"] > 0 and at < self.deadline
                     and reason in (None, "time-budget", "execution-error"))
        incomplete = any(self.counts[k] for k in ("pending", "failed", "unknown", "sending"))
        status = "partial" if incomplete or reason else "completed"
        updated = {**self.record, "status": status, "reason": reason, "retryable": retryable,
                   "counts": self.counts, "finishedAt": at.isoformat(), "updatedAt": at.isoformat(),
                   "leaseUntil": at.isoformat(),
                   "durationMs": max(0, int((at - instant(self.record["startedAt"])).total_seconds() * 1000))}
        try:
            self.repo.transaction([(self.pk, self.sk, updated, self.record)])
        except Conflict:
            return self.result("skipped", "lease-lost")
        self.record = updated
        return self.result(status, reason, retryable)

    def execute(self):
        try:
            self.prepare()
            self.old = self.previous()
            if not self.dry_run:
                self.acquire()
                self.emit(self.result("started"))
            self.publication, self.snapshot = reminders.fixed_publication(self.repo, self.cohort)
            if self.dry_run:
                self.check_window()
                self.check_context()
                self.counts = self.summarize()
                return self.result("dry-run")
            withdrawn = reminders.withdrawn_ids(self.repo, self.code)
            for student in self.snapshot["students"]:
                self.check_window()
                if self.remaining_ms and self.remaining_ms() < 10000:
                    raise Stop("time-budget")
                candidate = reminders.evaluate_recipient(self.repo, self.cohort, self.publication,
                                                         self.snapshot, student["id"], withdrawn)
                if candidate["skip"]:
                    continue
                self.renew()
                message, _, _ = reminders.message_for(self.code, candidate["_student"], self.publication, self.sender)
                at = self.check_window()
                if at >= instant(self.record["leaseUntil"]):
                    raise Stop("lease-lost")
                try:
                    record = reminders.reserve_reminder(
                        self.repo, self.cohort, self.publication["id"], student["id"], self.actor,
                        candidate["_previous"], at.isoformat(),
                        checks=[(self.pk, self.sk, self.record), *self.conditions])
                except reminders.RecipientWithdrawn:
                    continue
                except Conflict:
                    self.check_context()
                    if self.repo.get(self.pk, self.sk) != self.record:
                        raise Stop("lease-lost") from None
                    # Reserva manual concorrente ou mudança ACTIVE→ACTIVE: não repetir este send.
                    continue
                try:
                    reminders.send_reserved_reminder(self.repo, self.code, record, message, self.mailer)
                except reminders.SendFailure:
                    pass  # failed pode retomar; unknown nunca reabre. Ambos entram no resumo.
                self.sleep(self.delay_seconds)
            return self.finish()
        except Stop as stop:
            if self.record and stop.reason != "lease-lost":
                return self.finish(stop.reason)
            return self.result("skipped", stop.reason)


def run(repo, mailer, event, cohort_codes, domain, *, enabled=False, dry_run=True, clock=None,
        sleep=None, delay_seconds=0.25, remaining_ms=None, emit=None):
    """Uma passagem por turma. O chamador controla invocação/retry; nenhum polling ou envio recursivo."""
    context = occurrence_context(event)
    if not isinstance(cohort_codes, (list, tuple)):
        raise ValueError("Configuração automática inválida")
    codes = list(cohort_codes)
    if (type(enabled) is not bool or type(dry_run) is not bool or not codes
            or any(not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", code) for code in codes)
            or len(codes) != len(set(codes)) or delay_seconds < 0):
        raise ValueError("Configuração automática inválida")
    emit = emit or (lambda result: logging.info(json.dumps({"automaticReminder": result}, sort_keys=True)))
    results = []
    for code in codes:
        worker = CohortRun(repo, mailer, context, code, domain, enabled=enabled, dry_run=dry_run,
                           clock=clock or utc_now, sleep=sleep or time.sleep, delay_seconds=delay_seconds,
                           remaining_ms=remaining_ms, emit=emit)
        try:
            result = worker.execute()
        except Exception:
            # Nunca registrar exceção bruta: pode conter destinatário, mensagem ou contexto AWS.
            result = worker.result("partial", "execution-error", retryable=not dry_run and worker.now() < worker.deadline)
            if worker.record:
                try:
                    result = worker.finish("execution-error")
                except Exception:
                    pass  # Reserva sending continua bloqueada; lease permite investigar/retomar o restante.
        emit(result)
        results.append(result)
    return results


def handler(event, context):
    """Contrato técnico do Scheduler; nenhuma identidade/destinatário vem do payload."""
    event = scheduler_event(event)
    fields = {"source", "type", "version", "cohortCode", "scheduledFor", "executionId", "attemptNumber", "dryRun"}
    if (not isinstance(event, dict) or set(event) != fields or type(event["version"]) is not int
            or event["version"] != 1 or type(event["dryRun"]) is not bool):
        raise ValueError("Evento automático inválido")
    technical = occurrence_context({key: event[key] for key in fields - {"version", "cohortCode", "dryRun"}})
    try:
        codes = json.loads(os.environ.get("AUTOMATIC_REMINDER_COHORTS", "[]"))
        gate = os.environ.get("AUTOMATIC_REMINDERS_ENABLED", "false")
        domain = os.environ["INSTRUCTOR_EMAIL_DOMAIN"]
        if (not isinstance(codes, list) or not codes or any(not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", code) for code in codes)
                or len(codes) != len(set(codes)) or event["cohortCode"] not in codes
                or gate not in ("true", "false") or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", domain)):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise ValueError("Configuração automática inválida") from None
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    # O caminho bloqueado (gate fechado ou LIVE fora de terça/sexta) reutiliza o
    # guard/resultado do worker, sem construir clientes.
    repo = mailer = None
    if event["dryRun"] or (gate == "true" and live_day(technical["scheduledFor"])):
        repo, mailer = Repository(), reminders.SESMailer()
    results = run(repo, mailer, technical, [event["cohortCode"]], domain,
                  enabled=gate == "true", dry_run=event["dryRun"],
                  remaining_ms=context.get_remaining_time_in_millis,
                  emit=lambda result: logger.info(json.dumps({"automaticReminder": result}, sort_keys=True)))
    # Scheduler confirma a entrega assíncrona, não o resultado do domínio. Erro técnico
    # solicita retry limitado pela configuração Lambda e pela janela original do worker.
    # Lease ativo também precisa de retry: pode pertencer a uma tentativa interrompida.
    if not event["dryRun"] and any(result["retryable"] or result.get("reason") == "lease-active" for result in results):
        raise RuntimeError("Retentativa de lembretes automáticos necessária")
    return results

import base64
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from grades import ValidationError, overview, parse_csv, summary
from identity import groups_from_claim, response
from repository import Conflict, Repository
from reminders import SESMailer, SendFailure, message_for
from changes import snapshot_changes, change_counts, student_changes, student_history


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(condition, status=403, message="Você não tem acesso a esta operação."):
    if not condition:
        raise APIError(status, message)


def now():
    return datetime.now(timezone.utc).isoformat()


def cohort_thresholds(cohort):
    """Limites de referência (%) da turma; 70/95 se a turma não tiver configurado os seus."""
    thresholds = cohort.get("thresholds") or {}
    return {"kc": thresholds.get("kc", 70), "lab": thresholds.get("lab", 95)}


def display_snapshot(repo, code, snapshot):
    """Aplica nomes de exibição por matrícula sem alterar CSV, notas ou e-mail."""
    profiles = {p["canvasId"]: p for p in repo.list("COHORT#" + code, "PROFILE#")}
    return {**snapshot, "students": [
        {**s, "name": profiles.get(s["id"], {}).get("displayName", s["name"])}
        for s in snapshot["students"]
    ]}


def class_report(repo, code):
    """Painel do instrutor com a turma inteira; só é chamado após checar require(teach) em dispatch."""
    require(bool(re.fullmatch(r"[A-Z0-9-]{3,32}", code)), 400, "Código de turma inválido.")
    pk = "COHORT#" + code
    cohort = repo.get(pk, "METADATA")
    require(cohort is not None, 404, "Turma não encontrada.")
    if not cohort.get("current"):
        return {"cohort": code, "updatedAt": None, "thresholds": cohort_thresholds(cohort), "students": []}
    publication = repo.get(pk, "PUB#" + cohort["current"])
    require(publication is not None, 404, "Publicação não encontrada.")
    snapshot = display_snapshot(repo, code, repo.snapshot(publication["snapshot"]))
    thresholds = cohort_thresholds(cohort)
    rows = [{"name": student["name"],
             **{k: v for k, v in summary(student, snapshot["activities"], thresholds).items()
                if k in ("kc", "lab", "total", "completed", "pending", "status")}}
            for student in snapshot["students"]]
    return {"cohort": code, "updatedAt": cohort.get("updatedAt", publication["publishedAt"]),
            "thresholds": thresholds, "students": rows}


class Portal:
    def __init__(self, repo, user, domain="escoladanuvem.org", mailer=None):
        self.repo, self.user, self.domain = repo, user, domain
        self.uid = user["sub"]
        self.upk = "USER#" + self.uid
        self.admin = "admin" in user.get("groups", [])
        self.cache = {}
        self.mailer = mailer

    def snapshot(self, publication):
        key = publication["snapshot"]
        if key not in self.cache:
            self.cache[key] = self.repo.snapshot(key)
        return self.cache[key]

    def history(self, publication):
        """Resumo por aluno da publicação, se já foi gravado no momento do publish (ver
        _publish); None para publicações antigas, anteriores a esse resumo existir."""
        key = publication.get("history")
        if not key:
            return None
        if key not in self.cache:
            self.cache[key] = self.repo.snapshot(key)
        return self.cache[key]

    def student_summary_entry(self, pk, publication, student_id, thresholds, current_snap=None):
        hist = self.history(publication)
        if hist is not None:
            return hist.get(student_id)
        # Fallback só para publicações anteriores ao resumo compacto (ver _publish):
        # recalcula a partir dos snapshots completos, como antes desta otimização.
        old = current_snap if current_snap is not None else self.snapshot(publication)
        own = next((s for s in old["students"] if s["id"] == student_id), None)
        if not own:
            return None
        s = summary(own, old["activities"], thresholds)
        base = self.repo.get(pk, "PUB#" + publication["base"]) if publication.get("base") else None
        previous = self.snapshot(base) if base else {"students": [], "activities": []}
        prior = next((s for s in previous["students"] if s["id"] == student_id), None)
        return {"kc": s["kc"], "lab": s["lab"], "total": s["total"],
                "changes": student_changes(prior, previous["activities"], own, old["activities"], thresholds)}

    def cohort(self, code):
        require(bool(re.fullmatch(r"[A-Z0-9-]{3,32}", code)), 400, "Código de turma inválido.")
        c = self.repo.get("COHORT#" + code, "METADATA")
        require(c is not None, 404, "Turma não encontrada.")
        return c

    def can_teach(self, code):
        return self.admin or self.repo.get(self.upk, "TEACH#" + code) is not None

    def publication(self, code, publication_id):
        result = self.repo.get("COHORT#" + code, "PUB#" + publication_id)
        require(result is not None, 404, "Publicação não encontrada.")
        return result

    def student(self, code, snapshot, bind=False):
        binding = self.repo.get(self.upk, "STUDY#" + code)
        if binding:
            return next((s for s in snapshot["students"] if s["id"] == binding["canvasId"]), None)
        student = next((s for s in snapshot["students"] if s["email"] == self.user["email"]), None)
        if student:
            owner = self.repo.get("COHORT#" + code, "OWNER#" + student["id"])
            if owner and owner["userId"] != self.uid:
                return None
            if bind:
                self.repo.transaction([
                    ("COHORT#" + code, "OWNER#" + student["id"],
                     {"userId": self.uid, "email": self.user["email"], "at": now()}, owner),
                    (self.upk, "STUDY#" + code, {"code": code, "canvasId": student["id"]}, None),
                ])
        return student

    def me(self):
        teaching = self.repo.list(self.upk, "TEACH#")
        roles = ["admin"] if self.admin else ["instructor"] if teaching else ["student"]
        return {"userId": self.uid, "email": self.user["email"], "roles": roles,
                "instructorCandidate": self.user["email"].rsplit("@", 1)[-1] == self.domain,
                "request": self.repo.get("REQUESTS", self.uid)}

    def dispatch(self, method, path, body):
        if method == "GET" and path == "/me":
            return self.me()
        if path == "/access-request" and method == "POST":
            require(self.user["email"].rsplit("@", 1)[-1] == self.domain,
                    403, "Somente e-mails institucionais confirmados podem solicitar acesso de instrutor.")
            request = self.repo.get("REQUESTS", self.uid)
            if not request:
                request = {"userId": self.uid, "email": self.user["email"], "status": "pending", "createdAt": now()}
                self.repo.put("REQUESTS", self.uid, request, absent=True)
            return request
        if path == "/requests" and method == "GET":
            require(self.admin)
            return {"requests": self.repo.list("REQUESTS")}
        reject_match = re.fullmatch(r"/requests/([^/]+)/reject", path)
        if reject_match and method == "POST":
            require(self.admin)
            require(not body, 400, "A recusa não usa corpo na requisição.")
            uid = reject_match.group(1)
            request = self.repo.get("REQUESTS", uid)
            require(request is not None and request["status"] == "pending", 409,
                    "Só é possível recusar solicitações pendentes.")
            updated = {**request, "status": "rejected", "rejectedBy": self.uid, "rejectedAt": now()}
            self.repo.put("REQUESTS", uid, updated)
            return updated
        if path == "/cohorts" and method == "GET":
            # Vínculo (STUDY#/TEACH#) já indica a turma sem reler o snapshot do S3 a cada
            # login. Sem vínculo (primeiro acesso, ou CSV publicado sem e-mail até então),
            # cai no fallback por e-mail, que ainda precisa do snapshot atual.
            bound = {b["code"] for b in self.repo.list(self.upk, "STUDY#")}
            teaching = {t["code"] for t in self.repo.list(self.upk, "TEACH#")}
            result = []
            for cohort in self.repo.cohorts():
                code = cohort["code"]
                teach = self.admin or code in teaching
                if not teach and code not in bound:
                    if not cohort.get("current"):
                        continue
                    snap = self.snapshot(self.publication(code, cohort["current"]))
                    if not self.student(code, snap):
                        continue
                result.append({k: v for k, v in cohort.items() if not k.startswith("_")} | {"canTeach": teach})
            return {"cohorts": result}
        if path == "/cohorts" and method == "POST":
            require(self.admin)
            code = str(body.get("code", "")).strip().upper()
            name = str(body.get("name", code)).strip()
            require(bool(re.fullmatch(r"[A-Z0-9-]{3,32}", code)) and 1 <= len(name) <= 100, 400, "Informe código e nome válidos.")
            cohort = {"code": code, "name": name, "current": None}
            self.repo.put("COHORT#" + code, "METADATA", cohort, absent=True)
            return cohort
        match = re.fullmatch(r"/cohorts/([A-Z0-9-]+)/([a-z-]+)", path)
        require(match is not None, 404, "Rota não encontrada.")
        code, operation = match.groups()
        cohort = self.cohort(code)
        pk = "COHORT#" + code
        teach = self.can_teach(code)
        if operation == "focus-activities" and method == "POST":
            return self._focus_activities(cohort, pk, teach, body)
        if operation in ("reminder-settings", "verify-sender"):
            return self._reminder_settings(operation, method, teach, body)
        if operation in ("pending-preview", "send-reminder") and method == "POST":
            return self._reminder_flow(operation, code, cohort, pk, teach, body)
        if operation in ("pending-preview-batch", "send-reminders") and method == "POST":
            return self._reminder_batch(operation, code, cohort, pk, teach, body)
        if operation == "class-report" and method == "GET":
            require(teach, 403, "Você não tem acesso a esta turma.")
            return class_report(self.repo, code)
        if operation == "instructors" and method == "GET":
            require(self.admin)
            return {"instructors": self.repo.list(pk, "TEACH#")}
        if operation == "instructors" and method == "POST":
            return self._approve_instructor(code, pk, body)
        if operation == "revoke-instructor" and method == "POST":
            return self._revoke_instructor(code, pk, body)
        if operation == "students-search" and method == "POST":
            return self._students_search(code, cohort, pk, body)
        if operation == "unlink-student" and method == "POST":
            return self._unlink_student(code, pk, body)
        if operation == "display-name" and method == "POST":
            return self._set_display_name(pk, body)
        if operation == "settings" and method == "POST":
            return self._set_cohort_settings(cohort, pk, body)
        if operation == "preview" and method == "POST":
            return self._preview(code, cohort, pk, teach, body)
        if operation == "publish" and method == "POST":
            return self._publish(cohort, pk, teach, body)
        if operation == "restore" and method == "POST":
            return self._restore(cohort, pk, teach, body)
        if operation == "report" and method == "GET":
            return self._report(code, cohort, pk, teach)
        raise APIError(404, "Rota não encontrada.")

    def _focus_activities(self, cohort, pk, teach, body):
        require(teach)
        require(cohort.get("current"), 409, "Publique as notas antes de escolher o foco da turma.")
        require(body.get("expectedCurrent") == cohort["current"], 409, "As notas foram atualizadas. Consulte a atualização antes de salvar o foco.")
        ids = body.get("activityIds")
        require(isinstance(ids, list) and len(ids) <= 3 and all(isinstance(i, str) for i in ids), 400, "Escolha até três atividades.")
        require(len(set(ids)) == len(ids), 400, "Escolha atividades diferentes.")
        snap = self.snapshot(self.publication(cohort["code"], cohort["current"]))
        active = {a["id"] for a in snap["activities"] if a["active"]}
        require(set(ids) <= active, 400, "Escolha atividades liberadas na publicação atual.")
        previous = self.repo.get(pk, "FOCUS")
        require(body.get("expectedVersion") == (previous or {}).get("version"), 409, "O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar.")
        focus = {"activityIds": ids, "version": uuid.uuid4().hex}
        self.repo.transaction([(pk, "METADATA", cohort, cohort), (pk, "FOCUS", focus, previous)])
        return {"focus": focus}

    def _reminder_settings(self, operation, method, teach, body):
        require(teach)
        enabled = os.environ.get("REMINDERS_ENABLED", "false").lower() == "true"
        require(method == ("POST" if operation == "verify-sender" else "GET"), 405, "Método inválido.")
        require(self.user["email"].rsplit("@", 1)[-1] == self.domain, 403,
                "Use seu e-mail institucional para enviar lembretes.")
        if not enabled:
            return {"enabled": False, "sender": self.user["email"], "ready": False,
                    "reason": "O envio de lembretes está desativado nesta instalação."}
        mailer = self.mailer or SESMailer()
        if operation == "verify-sender":
            require(not body, 400, "A confirmação usa o e-mail da sua conta.")
            mailer.ensure_identity(self.user["email"])
        return {"enabled": True, "sender": self.user["email"], **mailer.readiness(self.user["email"])}

    def _reminder_flow(self, operation, code, cohort, pk, teach, body):
        require(teach)
        reminders_enabled = os.environ.get("REMINDERS_ENABLED", "false").lower() == "true"
        if operation == "send-reminder":
            require(reminders_enabled, 403, "O envio de e-mails de apoio está desabilitado.")
            require(self.user["email"].rsplit("@", 1)[-1] == self.domain, 403,
                    "Use seu e-mail institucional para enviar lembretes.")
        expected_keys = {"studentId"} if operation == "pending-preview" else {"studentId", "publicationId", "previewHash"}
        require(set(body) == expected_keys, 400, "Solicitação de lembrete inválida.")
        require(cohort.get("current"), 409, "Publique as notas antes de consultar pendências.")
        publication = self.publication(code, cohort["current"])
        snap = display_snapshot(self.repo, code, self.snapshot(publication))
        raw_student = next((s for s in snap["students"] if s["id"] == body["studentId"]), None)
        require(raw_student is not None, 404, "Aluno não encontrado nesta publicação.")
        student = summary(raw_student, snap["activities"], cohort_thresholds(cohort))
        if not reminders_enabled:
            return {"student": {k: student[k] for k in ("id", "name", "email")},
                    "activities": [a for a in student["activities"] if a["state"] == "pending"],
                    "publicationId": publication["id"], "publishedAt": publication["publishedAt"],
                    "remindersEnabled": False}
        message, digest, pending = message_for(code, student, publication, self.user["email"])
        sk = "REMINDER#" + publication["id"] + "#" + student["id"]
        previous = self.repo.get(pk, sk)
        delivery = dict(previous) if previous else None
        if delivery and delivery.get("messageId"):
            event = self.repo.get("EMAIL#" + delivery["messageId"], "DELIVERY")
            if event:
                delivery.update(event)
        mailer = self.mailer or SESMailer()
        readiness = mailer.readiness(message["from"])
        if operation == "pending-preview":
            return {"student": {k: student[k] for k in ("id", "name", "email")},
                    "activities": pending, "publicationId": publication["id"],
                    "publishedAt": publication["publishedAt"], "message": message,
                    "previewHash": digest, "delivery": delivery, "ses": readiness, "remindersEnabled": True}
        require(body["publicationId"] == publication["id"] and body["previewHash"] == digest,
                409, "As notas ou a mensagem mudaram. Abra uma nova prévia antes de enviar.")
        require(student["email"] and pending, 400, "O aluno precisa ter e-mail no Canvas e atividades pendentes.")
        require(readiness["ready"], 409, readiness["reason"])
        require(not previous or previous["status"] == "failed", 409,
                "Já existe envio ou tentativa em andamento para este aluno nesta publicação. Consulte o status.")
        record = {"studentId": student["id"], "publicationId": publication["id"],
                  "by": self.uid, "at": now(), "status": "sending"}
        self.repo.transaction([(pk, "METADATA", cohort, cohort), (pk, sk, record, previous)])
        try:
            message_id = mailer.send(message)
        except SendFailure as err:
            record["status"] = "unknown" if err.uncertain else "failed"
            self.repo.put(pk, sk, record)
            raise APIError(503, "Não foi possível confirmar o envio. Atualize a prévia para consultar o status.") from None
        record.update(status="sent", messageId=message_id)
        self.repo.put(pk, sk, record)
        return {"delivery": record}

    def _reminder_batch(self, operation, code, cohort, pk, teach, body):
        require(teach)
        require(os.environ.get("REMINDERS_ENABLED", "false").lower() == "true", 403,
                "O envio de e-mails de apoio está desabilitado.")
        require(self.user["email"].rsplit("@", 1)[-1] == self.domain, 403,
                "Use seu e-mail institucional para enviar lembretes.")
        expected_keys = {"studentIds"} if operation == "pending-preview-batch" else {"studentIds", "expectedPublicationId"}
        require(set(body) == expected_keys, 400, "Solicitação de lembrete em lote inválida.")
        ids = body.get("studentIds")
        require(isinstance(ids, list) and 1 <= len(ids) <= 200 and len(set(ids)) == len(ids)
                and all(isinstance(i, str) for i in ids), 400, "Selecione até 200 alunos, sem repetição.")
        require(cohort.get("current"), 409, "Publique as notas antes de consultar pendências.")
        publication = self.publication(code, cohort["current"])
        snap = display_snapshot(self.repo, code, self.snapshot(publication))
        by_id = {s["id"]: s for s in snap["students"]}
        mailer = self.mailer or SESMailer()
        readiness = mailer.readiness(self.user["email"])
        candidates = []
        for sid in ids:
            raw_student = by_id.get(sid)
            if raw_student is None:
                candidates.append({"id": sid, "name": None, "email": None, "pending": 0, "skip": "not-found"})
                continue
            student = summary(raw_student, snap["activities"], cohort_thresholds(cohort))
            pending = [a for a in student["activities"] if a["state"] == "pending"]
            sk = "REMINDER#" + publication["id"] + "#" + student["id"]
            previous = self.repo.get(pk, sk)
            skip = ("no-email" if not student["email"] else
                    "no-pending" if not pending else
                    "already-sent" if previous and previous["status"] != "failed" else None)
            candidates.append({"id": student["id"], "name": student["name"], "email": student["email"],
                                "pending": len(pending), "skip": skip,
                                "_student": student, "_previous": previous})
        if operation == "pending-preview-batch":
            sample_candidate = next((c for c in candidates if not c["skip"]), None)
            sample = message_for(code, sample_candidate["_student"], publication, self.user["email"])[0] if sample_candidate else None
            return {"publicationId": publication["id"], "publishedAt": publication["publishedAt"],
                    "ses": readiness, "sample": sample,
                    "recipients": [{k: v for k, v in c.items() if not k.startswith("_")} for c in candidates]}
        require(body["expectedPublicationId"] == publication["id"], 409,
                "As notas foram atualizadas. Consulte a prévia de novo antes de enviar.")
        require(readiness["ready"], 409, readiness["reason"])
        results, stopped = [], False
        for i, c in enumerate(candidates):
            if stopped or c["skip"]:
                results.append({"id": c["id"], "name": c["name"], "status": "skipped",
                                "reason": "publication-changed" if stopped else c["skip"]})
                continue
            message, _, _ = message_for(code, c["_student"], publication, self.user["email"])
            sk = "REMINDER#" + publication["id"] + "#" + c["id"]
            record = {"studentId": c["id"], "publicationId": publication["id"],
                      "by": self.uid, "at": now(), "status": "sending"}
            try:
                self.repo.transaction([(pk, "METADATA", cohort, cohort), (pk, sk, record, c["_previous"])])
            except Conflict:
                stopped = True
                results.append({"id": c["id"], "name": c["name"], "status": "skipped", "reason": "publication-changed"})
                continue
            try:
                message_id = mailer.send(message)
            except SendFailure as err:
                record["status"] = "unknown" if err.uncertain else "failed"
                self.repo.put(pk, sk, record)
                results.append({"id": c["id"], "name": c["name"], "status": "failed"})
                continue
            record.update(status="sent", messageId=message_id)
            self.repo.put(pk, sk, record)
            results.append({"id": c["id"], "name": c["name"], "status": "sent"})
            if i < len(candidates) - 1:
                time.sleep(float(os.environ.get("REMINDER_BATCH_DELAY_SECONDS", "0.25")))
        return {"publicationId": publication["id"], "results": results}

    def _approve_instructor(self, code, pk, body):
        require(self.admin)
        uid = str(body.get("userId", ""))
        request = self.repo.get("REQUESTS", uid)
        require(request is not None and request["email"].rsplit("@", 1)[-1] == self.domain,
                400, "Selecione uma solicitação institucional existente.")
        old = self.repo.get("USER#" + uid, "TEACH#" + code)
        self.repo.transaction([
            ("USER#" + uid, "TEACH#" + code, {"code": code, "approvedBy": self.uid}, old),
            (pk, "TEACH#" + uid, {"userId": uid, "email": request["email"], "code": code}, self.repo.get(pk, "TEACH#" + uid)),
            ("REQUESTS", uid, {**request, "status": "approved"}, request),
        ])
        return {"approved": True}

    def _revoke_instructor(self, code, pk, body):
        require(self.admin)
        uid = str(body.get("userId", ""))
        old = self.repo.get("USER#" + uid, "TEACH#" + code)
        require(old is not None, 404, "Vínculo não encontrado.")
        self.repo.transaction([
            ("USER#" + uid, "TEACH#" + code, None, old),
            (pk, "TEACH#" + uid, None, self.repo.get(pk, "TEACH#" + uid)),
        ])
        return {"revoked": True}

    def _students_search(self, code, cohort, pk, body):
        require(self.admin)
        require(set(body) == {"query"}, 400, "Solicitação de busca inválida.")
        query = str(body["query"]).strip().lower()
        require(1 <= len(query) <= 100, 400, "Digite ao menos um caractere para buscar.")
        require(cohort.get("current"), 409, "Publique as notas antes de buscar alunos.")
        publication = self.publication(code, cohort["current"])
        snap = display_snapshot(self.repo, code, self.snapshot(publication))
        results = []
        for student in snap["students"]:
            haystacks = (student["name"], student["email"] or "", student["id"])
            if not any(query in h.lower() for h in haystacks):
                continue
            owner = self.repo.get(pk, "OWNER#" + student["id"])
            results.append({"id": student["id"], "name": student["name"], "email": student["email"],
                            "bound": owner is not None,
                            "boundEmail": owner.get("email") if owner else None,
                            "boundAt": owner.get("at") if owner else None})
            if len(results) >= 25:
                break
        return {"results": results}

    def _unlink_student(self, code, pk, body):
        require(self.admin)
        require(set(body) == {"canvasId"}, 400, "Solicitação inválida.")
        canvas_id = str(body["canvasId"])
        owner = self.repo.get(pk, "OWNER#" + canvas_id)
        require(owner is not None, 404, "Este aluno não está vinculado a nenhuma conta.")
        self.repo.transaction([
            (pk, "OWNER#" + canvas_id, None, owner),
            ("USER#" + owner["userId"], "STUDY#" + code, None, self.repo.get("USER#" + owner["userId"], "STUDY#" + code)),
            (pk, "AUDIT#" + uuid.uuid4().hex,
             {"action": "unlink-student", "canvasId": canvas_id, "unlinkedUser": owner["userId"], "by": self.uid, "at": now()}, None),
        ])
        return {"unlinked": True}

    def _set_display_name(self, pk, body):
        require(self.admin)
        require(set(body) == {"canvasId", "displayName"}, 400, "Solicitação inválida.")
        canvas_id = str(body["canvasId"])
        display_name = str(body["displayName"]).strip()
        require(1 <= len(display_name) <= 100, 400, "Informe um nome entre 1 e 100 caracteres.")
        previous = self.repo.get(pk, "PROFILE#" + canvas_id)
        self.repo.transaction([
            (pk, "PROFILE#" + canvas_id, {"canvasId": canvas_id, "displayName": display_name}, previous),
            (pk, "AUDIT#" + uuid.uuid4().hex,
             {"action": "display-name", "canvasId": canvas_id, "displayName": display_name, "by": self.uid, "at": now()}, None),
        ])
        return {"canvasId": canvas_id, "displayName": display_name}

    def _set_cohort_settings(self, cohort, pk, body):
        require(self.admin)
        require(set(body) == {"thresholds", "canvasCourseId"}, 400, "Solicitação inválida.")
        thresholds = body["thresholds"]
        require(isinstance(thresholds, dict) and set(thresholds) == {"kc", "lab"}
                and all(isinstance(thresholds[k], (int, float)) and 1 <= thresholds[k] <= 100 for k in ("kc", "lab")),
                400, "Informe limites de KC e LAB entre 1 e 100.")
        canvas_course_id = body["canvasCourseId"]
        require(canvas_course_id is None or (isinstance(canvas_course_id, str) and re.fullmatch(r"\d{1,10}", canvas_course_id)),
                400, "Informe um ID de curso Canvas numérico, ou nenhum.")
        thresholds = {"kc": thresholds["kc"], "lab": thresholds["lab"]}
        updated = {**{k: v for k, v in cohort.items() if not k.startswith("_")},
                   "thresholds": thresholds, "canvasCourseId": canvas_course_id}
        self.repo.transaction([
            (pk, "METADATA", updated, cohort),
            (pk, "AUDIT#" + uuid.uuid4().hex,
             {"action": "settings", "thresholds": thresholds, "canvasCourseId": canvas_course_id, "by": self.uid, "at": now()}, None),
        ])
        return {"thresholds": thresholds, "canvasCourseId": canvas_course_id}

    def _preview(self, code, cohort, pk, teach, body):
        require(teach)
        active_ids = body.get("activeIds")
        snapshot = parse_csv(body.get("csv"), active_ids)
        before = self.snapshot(self.publication(code, cohort["current"])) if cohort.get("current") else None
        if active_ids is None and before:
            # Sem seleção explícita (primeira prévia da semana): mantém liberadas as
            # atividades já ativas na publicação atual, além da sugestão automática.
            # Evita que uma atividade caia do cálculo só por ter poucas notas ainda.
            previously_active = {a["id"] for a in before["activities"] if a["active"]}
            for activity in snapshot["activities"]:
                if activity["id"] in previously_active:
                    activity["active"] = True
        draft_id = uuid.uuid4().hex
        key = f"cohorts/{code}/{draft_id}"
        self.repo.snapshot(key + "/source.csv", body["csv"], raw=True)
        self.repo.snapshot(key + "/snapshot.json", snapshot)
        draft = {"id": draft_id, "cohort": code, "createdBy": self.uid, "createdAt": now(),
                 "base": cohort.get("current"), "snapshot": key + "/snapshot.json", "status": "draft",
                 "filename": str(body.get("filename", "notas.csv"))[:150]}
        self.repo.put(pk, "DRAFT#" + draft_id, draft, absent=True)
        return {"draft": draft, **overview(display_snapshot(self.repo, code, snapshot), cohort_thresholds(cohort)),
                "changes": snapshot_changes(before, snapshot)}

    def _publish(self, cohort, pk, teach, body):
        require(teach)
        draft = self.repo.get(pk, "DRAFT#" + str(body.get("draftId", "")))
        require(draft is not None and draft["createdBy"] == self.uid, 404, "Prévia não encontrada para sua conta.")
        require(draft["status"] == "draft" and draft["base"] == cohort.get("current"), 409,
                "A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia.")
        snap = self.snapshot(draft)
        before = self.snapshot(self.publication(cohort["code"], cohort["current"])) if cohort.get("current") else None
        changes = snapshot_changes(before, snap)
        require(not changes["studentsRemoved"] or body.get("acknowledgeRemoved") is True, 400,
                "Confirme a remoção de alunos antes de publicar o arquivo completo da turma.")
        require(any(a["active"] for a in snap["activities"]), 400, "Libere ao menos uma atividade antes de publicar.")
        # Resumo por aluno gravado agora, com o que já está em memória (snap e before), para
        # que _report não precise reler dezenas de snapshots a cada carregamento do histórico.
        history_key = draft["snapshot"].rsplit("/", 1)[0] + "/history.json"
        self.repo.snapshot(history_key, student_history(before, snap, cohort_thresholds(cohort)))
        publication = {**draft, "status": "published", "publishedAt": now(), "publishedBy": self.uid,
                       "changes": change_counts(changes), "history": history_key}
        next_cohort = {k: v for k, v in cohort.items() if not k.startswith("_")}
        next_cohort.update(current=draft["id"], updatedAt=publication["publishedAt"], updateKind="publish")
        self.repo.transaction([
            (pk, "METADATA", next_cohort, cohort),
            (pk, "DRAFT#" + draft["id"], publication, draft),
            (pk, "PUB#" + draft["id"], publication, None),
        ])
        return {"publication": publication}

    def _restore(self, cohort, pk, teach, body):
        require(teach)
        publication = self.publication(cohort["code"], str(body.get("publicationId", "")))
        require(body.get("expectedCurrent") == cohort.get("current"), 409, "A turma foi atualizada. Recarregue o histórico.")
        updated = {k: v for k, v in cohort.items() if not k.startswith("_")}
        updated.update(current=publication["id"], updatedAt=now(), updateKind="restore")
        self.repo.transaction([(pk, "METADATA", updated, cohort),
                               (pk, "AUDIT#" + uuid.uuid4().hex,
                                {"action": "restore", "by": self.uid, "at": now(), "publicationId": publication["id"]}, None)])
        return {"restored": True}

    def _report(self, code, cohort, pk, teach):
        if not cohort.get("current"):
            require(teach)
            return {"cohort": code, "publication": None, "students": [], "history": [],
                    "thresholds": cohort_thresholds(cohort), "canvasCourseId": cohort.get("canvasCourseId")}
        publication = self.publication(code, cohort["current"])
        snap = display_snapshot(self.repo, code, self.snapshot(publication))
        focus = self.repo.get(pk, "FOCUS") or {"activityIds": [], "version": None}
        active = {a["id"] for a in snap["activities"] if a["active"]}
        focus = {"activityIds": [i for i in focus["activityIds"] if i in active], "version": focus.get("version")}
        thresholds = cohort_thresholds(cohort)
        canvas_course_id = cohort.get("canvasCourseId")
        if teach:
            return {"cohort": code, "publication": publication, "focus": focus, **overview(snap, thresholds),
                    "updatedAt": cohort.get("updatedAt", publication["publishedAt"]),
                    "updateKind": cohort.get("updateKind", "publish"),
                    "thresholds": thresholds, "canvasCourseId": canvas_course_id,
                    "history": sorted(self.repo.list(pk, "PUB#"), key=lambda p: p["publishedAt"], reverse=True)}
        student = self.student(code, snap, bind=True)
        require(student is not None, 403, "Matrícula não localizada para sua conta nesta turma.")
        history = []
        publications = sorted(self.repo.list(pk, "PUB#"), key=lambda p: p["publishedAt"], reverse=True)[:12]
        if not any(p["id"] == publication["id"] for p in publications):
            publications = publications[:11] + [publication]
        for p in publications:
            is_current = p["id"] == publication["id"]
            entry = self.student_summary_entry(pk, p, student["id"], thresholds, snap if is_current else None)
            if entry:
                history.append({"publishedAt": p["publishedAt"], "current": is_current, **entry})
        return {"cohort": code, "publication": {"id": publication["id"], "publishedAt": publication["publishedAt"]},
                "updatedAt": cohort.get("updatedAt", publication["publishedAt"]),
                "updateKind": cohort.get("updateKind", "publish"),
                "thresholds": thresholds, "canvasCourseId": canvas_course_id,
                "student": summary(student, snap["activities"], thresholds), "history": history, "focus": focus}


def authenticate(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    require(claims.get("sub") and claims.get("token_use") == "access", 401, "Entre novamente para continuar.")
    require("portal/access" in claims.get("scope", "").split(), 403, "Sessão sem permissão para o portal.")
    # O gatilho Cognito "pre token generation" (infra/terraform/auth-trigger.tf) inclui email e
    # email_verified no access token. Tokens emitidos antes do gatilho (ou durante uma eventual
    # falha dele) não têm a claim "email"; nesse caso, e só nesse caso, caímos de volta no
    # /oauth2/userInfo. Fora essa transição, nenhuma requisição chama o Cognito.
    if "email" in claims:
        email = str(claims.get("email", "")).strip().lower()
        verified = claims.get("email_verified") in (True, "true")
    else:
        token = next((v for k, v in event.get("headers", {}).items() if k.lower() == "authorization"), "")
        require(token.lower().startswith("bearer "), 401, "Sessão inválida.")
        request = urllib.request.Request(os.environ["AUTH_DOMAIN"] + "/oauth2/userInfo", headers={"Authorization": token})
        try:
            with urllib.request.urlopen(request, timeout=5) as result:
                info = json.load(result)
        except urllib.error.HTTPError as e:
            raise APIError(401 if e.code in (400, 401, 403) else 503, "Não foi possível validar a sessão. Entre novamente.") from None
        except (urllib.error.URLError, TimeoutError):
            raise APIError(503, "Autenticação temporariamente indisponível.") from None
        require(info.get("sub") == claims["sub"], 403, "Sessão inválida.")
        email = str(info.get("email", "")).strip().lower()
        verified = info.get("email_verified") in (True, "true")
    require(verified, 403, "Confirme seu e-mail antes de acessar o portal.")
    require(bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)), 403, "E-mail da conta inválido.")
    return {"sub": claims["sub"], "email": email, "groups": groups_from_claim(claims.get("cognito:groups", []))}


def handler(event, context):
    try:
        http = event.get("requestContext", {}).get("http", {})
        path = event.get("rawPath", "")
        user = authenticate(event)
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        require(len(raw.encode("utf-8")) <= 4_000_000, 413, "Arquivo maior que o limite permitido.")
        body = json.loads(raw)
        require(isinstance(body, dict), 400, "Corpo da requisição inválido.")
        result = Portal(Repository(), user, os.environ["INSTRUCTOR_EMAIL_DOMAIN"]).dispatch(http.get("method"), path, body)
        return response(200, result)
    except APIError as e:
        return response(e.status, {"error": e.message})
    except Conflict:
        return response(409, {"error": "Os dados mudaram ou o registro já existe. Recarregue e tente novamente."})
    except (ValidationError, json.JSONDecodeError, UnicodeError, ValueError) as e:
        return response(400, {"error": str(e) if isinstance(e, ValidationError) else "Requisição inválida."})
    except Exception:
        logging.exception("Falha interna no portal")
        return response(500, {"error": "Não foi possível concluir a operação. Tente novamente."})

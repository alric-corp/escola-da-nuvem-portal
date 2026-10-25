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
from reminders import cohort_thresholds, display_snapshot, participation, withdrawn_ids
import reminders
from changes import snapshot_changes, change_counts, student_changes, student_history
from canvas_activity import activity_summary, instructor_activity, student_activity
from canvas_submissions import read_submissions
from integrity import SYNC_MIN_ROSTER, blocking_message, issue_counts, roster_record
from integrity import check as integrity_check
import feedback
import derived_access


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(condition, status=403, message="Você não tem acesso a esta operação."):
    if not condition:
        raise APIError(status, message)


def now():
    return datetime.now(timezone.utc).isoformat()


DRAFT_TTL_DAYS = 30


def released_at(publication, snapshot):
    """Anota em cada atividade quando ela foi liberada (todo/16), se a publicação tiver o mapa.
    Publicações anteriores ao recurso não têm o mapa: as atividades ficam sem a data."""
    dates = (publication or {}).get("releasedAt") or {}
    return {**snapshot, "activities": [{**a, "releasedAt": dates.get(a["id"])} if a["active"] else a
                                       for a in snapshot["activities"]]}


def save_catalog(repo, catalog):
    """Grava o catálogo de módulos e links de um curso do Canvas (todo/12), só se mudou."""
    key = "CATALOG#" + catalog["courseId"]
    current = repo.get(key, "METADATA")
    if current and all(current.get(k) == catalog[k] for k in ("modules", "items")):
        return False
    repo.put(key, "METADATA", {**catalog, "updatedAt": now()})
    return True


def save_roster(repo, course_id, students):
    """Grava a matrícula do Canvas (ROSTER#<curso>) a cada execução do canvas_sync que conseguiu
    lê-la, mesmo sem mudança de notas. É a referência das validações do envio manual e do Restore
    (integrity.py); o portal nunca chama o Canvas. Só IDs e hash do e-mail, sem e-mail em claro."""
    repo.put("ROSTER#" + str(course_id), "METADATA", roster_record(course_id, students, now()))


def with_catalog(repo, cohort, snapshot):
    """Anota módulo e link do Canvas em cada atividade, pelo ID da tarefa (o número entre
    parênteses na coluna do CSV). Com catálogo, toda atividade recebe "module" (None se a
    tarefa não está em nenhum módulo); sem catálogo, o frontend usa a lista fixa antiga."""
    course = cohort.get("canvasCourseId")
    catalog = repo.get("CATALOG#" + course, "METADATA") if course else None
    if not catalog:
        return snapshot
    activities = []
    for activity in snapshot["activities"]:
        match = re.search(r"\((\d+)\)\s*$", activity["id"])
        entry = catalog["items"].get(match.group(1)) if match else None
        activities.append({**activity, "module": catalog["modules"][entry["module"]] if entry else None,
                           "moduleOrder": entry["module"] if entry else None,
                           "canvasUrl": entry["url"] if entry else None})
    return {**snapshot, "activities": activities}


# Participação do aluno na turma, marcada à mão no portal; o Canvas continua com a matrícula. Sem registro
# PARTICIPATION#<idCanvas>, o aluno está ACTIVE: ninguém precisa ser marcado para seguir como antes.
PARTICIPATION_STATUSES = ("ACTIVE", "WITHDRAWN")


def participation_flag(withdrawn, student_id):
    """Campo esparso para o instrutor: só desistentes recebem participationStatus (sem marcas, nada muda)."""
    return {"participationStatus": "WITHDRAWN"} if student_id in withdrawn else {}


def submission_view(repo, course_id, student_id, activities):
    """Auxiliar atual, só depois da autorização e restrito às tarefas da publicação exibida."""
    ids = {match.group(1) for activity in activities
           if (match := re.search(r"\((\d+)\)\s*$", activity["id"]))}
    collection = read_submissions(repo, course_id, student_id, ids) if course_id else None
    return {"canvasSubmissions": collection} if collection is not None else {}


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
    withdrawn = withdrawn_ids(repo, code)
    rows = [{"name": student["name"],
             **{k: v for k, v in summary(student, snapshot["activities"], thresholds).items()
                if k in ("kc", "lab", "total", "completed", "pending", "status")},
             **participation_flag(withdrawn, student["id"])}
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

    def student_history(self, pk, publication, snap, student_id, thresholds):
        """Médias do aluno nas últimas 12 publicações (a atual incluída), mais recentes primeiro."""
        history = []
        publications = derived_access.recent_publications(self.repo, pk)
        if not any(p["id"] == publication["id"] for p in publications):
            publications = publications[:11] + [publication]
        for p in publications:
            is_current = p["id"] == publication["id"]
            entry = self.student_summary_entry(pk, p, student_id, thresholds, snap if is_current else None)
            if entry:
                history.append({"publishedAt": p["publishedAt"], "current": is_current, **entry})
        return history

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
        return self._unbound_student(code, snapshot, bind)

    def _unbound_student(self, code, snapshot, bind=False):
        """Fallback por e-mail quando a leitura consistente não encontrou STUDY.

        /cohorts já leu os vínculos desta requisição por Query. Reaproveitar essa
        ausência evita um GetItem por turma; OWNER continua sendo conferido.
        Não há cache de autorização entre requisições, sessões ou usuários.
        """
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

    def dispatch(self, method, path, body, query=None):
        if method == "GET" and path == "/me":
            return self.me()
        if path in ("/feedback", "/admin/feedback") or path.startswith(("/admin/feedback/", "/feedback/")):
            try:
                return self._feedback_route(method, path, body, query or {})
            except feedback.Invalid as err:
                raise APIError(400, str(err)) from None
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
            # STUDY/TEACH stay canonical. After explicit cutover, email candidates
            # limit first-access discovery to relevant cohorts; their current
            # snapshot and OWNER still authorize access. Until then, legacy Scan.
            bound = {b["code"] for b in self.repo.list(self.upk, "STUDY#")} if not self.admin else set()
            teaching = {t["code"] for t in self.repo.list(self.upk, "TEACH#")} if not self.admin else set()
            result = []
            if not self.admin and derived_access.discovery_ready(self.repo):
                codes = bound | teaching | {r["code"] for r in derived_access.candidates(self.repo, self.user["email"])}
                cohorts = [self.repo.get("COHORT#" + c, "METADATA") for c in sorted(codes)]
            else:
                cohorts = self.repo.cohorts()
            for cohort in cohorts:
                if cohort is None:
                    continue
                code = cohort["code"]
                teach = self.admin or code in teaching
                if not teach and code not in bound:
                    if not cohort.get("current"):
                        continue
                    snap = self.snapshot(self.publication(code, cohort["current"]))
                    if not self._unbound_student(code, snap):
                        continue
                result.append({k: v for k, v in cohort.items() if not k.startswith("_")} | {"canTeach": teach})
            return {"cohorts": result}
        if path == "/cohorts" and method == "POST":
            require(self.admin)
            code = str(body.get("code", "")).strip().upper()
            name = str(body.get("name", code)).strip()
            require(bool(re.fullmatch(r"[A-Z0-9-]{3,32}", code)) and 1 <= len(name) <= 100, 400, "Informe código e nome válidos.")
            cohort = {"code": code, "name": name, "current": None}
            self.repo.transaction([("COHORT#" + code, "METADATA", cohort, None),
                                   *derived_access.create_writes(self.repo, cohort)])
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
        if operation == "student-view" and method == "POST":
            return self._student_view(code, cohort, pk, body)
        if operation == "display-name" and method == "POST":
            return self._set_display_name(pk, body)
        if operation == "participation" and method == "POST":
            return self._set_participation(code, cohort, pk, teach, body)
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

    # Feedback da plataforma (feedback.py). Qualquer usuário autenticado envia e lê os próprios;
    # só admin lista todos e muda o status. Autor, datas, status e vínculo vêm do servidor.
    def _feedback_route(self, method, path, body, query):
        if path == "/feedback" and method == "POST":
            return self._create_feedback(body)
        if path == "/feedback" and method == "GET":
            require(set(query) <= {"limit", "cursor"}, 400, "Parâmetros inválidos.")
            items, cursor = self._feedback_page(feedback.page_size(query.get("limit"), "mine"),
                                                feedback.decode_cursor(query.get("cursor")),
                                                lambda item: item["createdBy"] == self.uid)
            return {"items": [feedback.own_view(i) for i in items], "nextCursor": cursor}
        if path.startswith("/feedback/"):
            match = re.fullmatch(r"/feedback/([^/]+)/attachments(?:/([^/]+)(/complete)?)?", path)
            require(match is not None, 404, "Rota não encontrada.")
            return self._attachment_route(method, *match.groups(), body)
        require(self.admin)
        if path == "/admin/feedback" and method == "GET":
            return self._admin_feedback(query)
        match = re.fullmatch(r"/admin/feedback/([^/]+)/status", path)
        if match and method == "POST":
            return self._feedback_status(match.group(1), body)
        raise APIError(404, "Rota não encontrada.")

    # Anexos do feedback (feedback.py). Criar slot e concluir: só o autor. Ler: autor ou admin;
    # para qualquer outro, 404 genérico. A chave no S3 vem sempre do item gravado, nunca do cliente.
    def _attachment_route(self, method, feedback_id, attachment_id, complete, body):
        require(feedback.ID_PATTERN.fullmatch(feedback_id) is not None, 404, "Feedback não encontrado.")
        require(attachment_id is None or feedback.ATTACHMENT_ID.fullmatch(attachment_id) is not None, 404, "Imagem não encontrada.")
        require(bool(self.repo.files_bucket), 503, "Anexos indisponíveis no momento.")
        item = self.repo.get("FEEDBACK", "FEEDBACK#" + feedback_id)
        if attachment_id is None and method == "POST":
            return self._attachment_slot(item, body)
        if complete and method == "POST":
            require(not body, 400, "Solicitação inválida.")
            return self._attachment_complete(item, feedback_id, attachment_id)
        require(method == "GET" and not complete, 404, "Rota não encontrada.")
        require(item is not None and (item["createdBy"] == self.uid or self.admin), 404, "Feedback não encontrado.")
        slots = self.repo.list(feedback.attachment_pk(feedback_id), "SLOT#")
        ready = sorted((s for s in slots if s["status"] == "READY"), key=lambda s: s["slot"])
        if attachment_id is None:
            active = self._active_slots(slots)
            return {"items": [feedback.attachment_view(s) for s in ready],
                    "canAdd": item["createdBy"] == self.uid and item["status"] in feedback.OPEN_STATUSES and len(active) < feedback.ATTACHMENT_SLOTS}
        slot = next((s for s in ready if s["attachmentId"] == attachment_id), None)
        require(slot is not None, 404, "Imagem não encontrada.")
        url = self.repo.presign_download(slot["objectKey"], slot["mimeType"], feedback.content_disposition(slot["originalName"]),
                                         feedback.DOWNLOAD_SECONDS)
        return {"downloadUrl": url, "expiresIn": feedback.DOWNLOAD_SECONDS}

    @staticmethod
    def _active_slots(slots, at=None):
        """READY e PENDING ainda dentro do prazo ocupam vaga; REJECTED e PENDING vencido não."""
        at = at or feedback.clock()
        return [s for s in slots if s["status"] == "READY"
                or (s["status"] == "PENDING" and datetime.fromisoformat(s["pendingUntil"]) > at)]

    def _attachment_slot(self, item, body):
        require(item is not None, 404, "Feedback não encontrado.")
        require(item["createdBy"] == self.uid, 403, "Só quem enviou o feedback pode anexar imagens.")
        data = feedback.clean_slot_request(body)
        require(item["status"] in feedback.OPEN_STATUSES, 409, "Este feedback não aceita mais imagens.")
        pk = feedback.attachment_pk(item["id"])
        at = feedback.clock()
        slots = {s["slot"]: s for s in self.repo.list(pk, "SLOT#")}
        active = self._active_slots(slots.values(), at)
        same = next((s for s in active if s["clientToken"] == data["clientToken"]), None)
        if same:  # repetição do mesmo pedido (duplo clique, nova tentativa): mesmo slot, sem criar outro
            return self._slot_response(same)
        require(len(active) < feedback.ATTACHMENT_SLOTS, 409, "Este feedback já tem 3 imagens.")
        taken = {s["slot"] for s in active}
        number = next(n for n in range(1, feedback.ATTACHMENT_SLOTS + 1) if n not in taken)
        attachment_id = uuid.uuid4().hex
        slot = {"attachmentId": attachment_id, "feedbackId": item["id"], "slot": number, **data,
                "objectKey": feedback.final_key(item["id"], attachment_id), "status": "PENDING",
                "createdAt": at.isoformat(), "createdBy": self.uid,
                "pendingUntil": (at + feedback.PENDING_WINDOW).isoformat()}
        try:  # vaga livre, ou a mesma vaga vencida/recusada que foi lida (condição de igualdade)
            self.repo.transaction([(pk, f"SLOT#{number}", slot, slots.get(number), int((at + feedback.PENDING_TTL).timestamp()))])
        except Conflict:
            raise APIError(409, "Outra imagem foi enviada ao mesmo tempo. Tente novamente.") from None
        return self._slot_response(slot)

    def _slot_response(self, slot):
        if slot["status"] == "READY":
            return {"attachment": feedback.attachment_view(slot), "status": "READY", "upload": None}
        upload = self.repo.presign_upload(feedback.tmp_key(slot["feedbackId"], slot["attachmentId"]), slot["mimeType"],
                                          feedback.ATTACHMENT_MAX_BYTES, feedback.UPLOAD_SECONDS)
        return {"attachment": feedback.attachment_view(slot), "status": "PENDING", "upload": upload}

    def _attachment_complete(self, item, feedback_id, attachment_id):
        require(item is not None, 404, "Feedback não encontrado.")
        require(item["createdBy"] == self.uid, 403, "Só quem enviou o feedback pode anexar imagens.")
        pk = feedback.attachment_pk(feedback_id)
        slot = next((s for s in self.repo.list(pk, "SLOT#") if s["attachmentId"] == attachment_id), None)
        require(slot is not None, 404, "Imagem não encontrada.")
        if slot["status"] == "READY":  # conclusão repetida: sucesso, sem contar de novo
            return {"attachment": feedback.attachment_view(slot), "status": "READY"}
        require(slot["status"] == "PENDING", 409, "Esta imagem foi recusada. Envie de novo.")
        # Slot criado com o feedback aberto e ainda no prazo pode concluir mesmo que o status tenha
        # mudado depois (não quebra um envio em andamento); slots novos é que exigem feedback aberto.
        require(datetime.fromisoformat(slot["pendingUntil"]) > feedback.clock(), 409, "O envio desta imagem expirou. Envie de novo.")
        tmp, final = feedback.tmp_key(feedback_id, attachment_id), slot["objectKey"]
        head = self.repo.file_head(tmp)
        if head is None:
            if self.repo.file_head(final) is not None:  # outra conclusão simultânea já copiou
                again = self.repo.get(pk, f"SLOT#{slot['slot']}")
                if again and again["attachmentId"] == attachment_id and again["status"] == "READY":
                    return {"attachment": feedback.attachment_view(again), "status": "READY"}
                raise APIError(409, "A imagem está sendo concluída. Tente novamente em instantes.")
            self._reject_attachment(pk, slot, tmp, "Imagem não recebida. Envie de novo.")
        problem = None
        if not 0 < head["size"] <= feedback.ATTACHMENT_MAX_BYTES or head["size"] != slot["size"]:
            problem = "O tamanho da imagem não confere com o arquivo selecionado."
        elif head["contentType"] != slot["mimeType"]:
            problem = "O tipo da imagem não confere com o arquivo selecionado."
        elif feedback.detect_image(self.repo.file_start(tmp, 32)) != slot["mimeType"]:
            problem = "O arquivo não é uma imagem PNG, JPEG ou WebP válida."
        if problem:
            self._reject_attachment(pk, slot, tmp, problem)
        try:
            version_id = self.repo.promote_file(tmp, final, slot["mimeType"])
        except Exception:
            logging.exception("Falha ao promover anexo %s", final)
            raise APIError(502, "Não foi possível concluir o envio da imagem. Tente novamente.") from None
        try:
            self.repo.delete_file(tmp)
        except Exception:  # o lifecycle de tmp/ remove depois; a imagem final já está pronta
            logging.exception("Falha ao remover temporário %s", tmp)
        return self._mark_attachment_ready(pk, slot, feedback_id, final, version_id)

    def _mark_attachment_ready(self, pk, slot, feedback_id, final, version_id):
        """PENDING -> READY e attachments + 1 na mesma transação. A condição sobre o slot garante uma
        única transição (e um único incremento) mesmo com conclusões simultâneas. Se não gravar, apaga
        só a versão que esta tentativa criou no S3 (bucket versionado: sem marcador, sem tocar versões
        anteriores). S3 e DynamoDB não têm transação distribuída: se a Lambda morrer entre a cópia e
        esta gravação, sobra um objeto final não referenciado (nunca servido, porque o download exige READY)."""
        sk = f"SLOT#{slot['slot']}"
        ready = {**slot, "status": "READY", "readyAt": now()}
        ready.pop("pendingUntil", None)
        try:
            for _ in range(3):
                current = self.repo.get(pk, sk)
                if current and current["attachmentId"] == slot["attachmentId"] and current["status"] == "READY":
                    return {"attachment": feedback.attachment_view(current), "status": "READY"}  # a outra conclusão venceu
                if current != slot:
                    raise APIError(409, "Esta imagem mudou durante o envio. Envie de novo.")
                item = self.repo.get("FEEDBACK", "FEEDBACK#" + feedback_id)
                try:
                    self.repo.transaction([(pk, sk, ready, slot), ("FEEDBACK", "FEEDBACK#" + feedback_id,
                                                                   {**item, "attachments": item.get("attachments", 0) + 1}, item)])
                    return {"attachment": feedback.attachment_view(ready), "status": "READY"}
                except Conflict:
                    continue  # o feedback mudou (status, outra imagem): relê e tenta de novo
            raise APIError(409, "Não foi possível registrar a imagem agora. Tente novamente.")
        except Exception as error:
            again = self.repo.get(pk, sk)
            if not (again and again["attachmentId"] == slot["attachmentId"] and again["status"] == "READY"):
                logging.error("Anexo %s não registrado (%s); removendo a versão criada", final, type(error).__name__)
                try:
                    self.repo.delete_file(final, version_id)
                except Exception:
                    logging.exception("Falha ao remover a versão %s de %s após erro de gravação", version_id, final)
            raise

    def _reject_attachment(self, pk, slot, tmp, message):
        """Apaga o temporário, marca REJECTED (libera o slot) e responde 400. Nada é contado."""
        try:
            self.repo.delete_file(tmp)
        except Exception:
            logging.exception("Falha ao remover temporário recusado %s", tmp)
        rejected = {**slot, "status": "REJECTED", "rejectedAt": now()}
        rejected.pop("pendingUntil", None)
        try:
            self.repo.transaction([(pk, f"SLOT#{slot['slot']}", rejected, slot,
                                    int((feedback.clock() + feedback.REJECTED_TTL).timestamp()))])
        except Conflict:
            pass  # o slot já mudou (outra conclusão); a resposta continua sendo a recusa deste envio
        raise APIError(400, message)

    def _feedback_page(self, limit, after_id, keep):
        """Até `limit` feedbacks que passam em `keep`, do mais recente ao mais antigo. O próximo
        cursor é sempre o id do último item devolvido ao próprio chamador, nunca de outro usuário."""
        after = "FEEDBACK#" + after_id if after_id else None
        found = []
        while True:
            rows, done = self.repo.page("FEEDBACK", "FEEDBACK#", max(limit * 2, 50), after)
            for sk, item in rows:
                after = sk
                if keep(item):
                    found.append(item)
                    if len(found) > limit:
                        return found[:limit], feedback.encode_cursor(found[limit - 1]["id"])
            if done or not rows:
                return found, None

    def _create_feedback(self, body):
        data = feedback.clean_new(body)
        canvas_id = publication_id = None
        if data["cohort"]:
            cohort = self.cohort(data["cohort"])
            student = None
            if cohort.get("current"):
                # Só leitura: o vínculo (bind) continua sendo criado apenas pelo relatório do aluno.
                student = self.student(data["cohort"], self.snapshot(self.publication(data["cohort"], cohort["current"])))
            require(student is not None or self.can_teach(data["cohort"]), 403, "Você não participa desta turma.")
            canvas_id, publication_id = (student or {}).get("id"), cohort.get("current")
        at = feedback.clock()
        created_at = at.isoformat()
        dedup = ("FEEDBACK-DEDUP", f"{self.uid}#{feedback.content_hash(self.uid, data)}")
        active = lambda d: d is not None and d["expiresAt"] > at.timestamp()
        previous = self.repo.get(*dedup)
        if active(previous):
            return self._duplicate_feedback(previous)
        item = {"id": feedback.new_id(at), **data, "status": "NEW", "createdAt": created_at, "createdBy": self.uid,
                "createdByEmail": self.user["email"], "canvasId": canvas_id, "publicationId": publication_id,
                "updatedAt": created_at, "updatedBy": self.uid,
                "statusHistory": [{"status": "NEW", "by": self.uid, "at": created_at}]}
        expires = (at + feedback.DEDUP_WINDOW).timestamp()
        rate_pk, rate_sk, rate_expires = feedback.rate_key(self.uid, at)
        try:
            # Feedback, marca de duplicidade e contadores juntos: ou tudo entra, ou nada. Um dedup
            # expirado mas ainda não removido pelo TTL é substituído (condição: igual ao lido).
            self.repo.transaction(
                [("FEEDBACK", "FEEDBACK#" + item["id"], item, None),
                 (*dedup, {"feedbackId": item["id"], "expiresAt": expires}, previous, int(expires) + 60)],
                counters=[(rate_pk, rate_sk, {"count": 1}, ("count", feedback.RATE_LIMIT), rate_expires),
                          ("FEEDBACK-STATS", "ALL", {"NEW": 1}, None, None)])
        except Conflict:
            again = self.repo.get(*dedup)
            if active(again):  # envio idêntico simultâneo: devolve o que entrou primeiro
                return self._duplicate_feedback(again)
            require(self.repo.counter(rate_pk, rate_sk).get("count", 0) < feedback.RATE_LIMIT, 429,
                    "Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde.")
            raise APIError(409, "Não foi possível enviar agora. Tente novamente.") from None
        return {"feedback": feedback.own_view(item), "duplicate": False}

    def _duplicate_feedback(self, dedup):
        item = self.repo.get("FEEDBACK", "FEEDBACK#" + dedup["feedbackId"])
        require(item is not None and item["createdBy"] == self.uid, 409, "Não foi possível enviar agora. Tente novamente.")
        return {"feedback": feedback.own_view(item), "duplicate": True}

    def _admin_feedback(self, query):
        require(set(query) <= {"limit", "cursor", "status", "type", "cohort"}, 400, "Parâmetros inválidos.")
        status, kind, code = query.get("status"), query.get("type"), query.get("cohort")
        require(status in (None, "ALL", *feedback.STATUSES) and kind in (None, *feedback.TYPES)
                and (code is None or feedback.CODE_PATTERN.fullmatch(code) is not None), 400, "Filtro inválido.")

        def keep(item):
            # Sem filtro de status, arquivados ficam de fora; "ALL" inclui todos.
            return ((item["status"] == status if status in feedback.STATUSES else status == "ALL" or item["status"] != "ARCHIVED")
                    and (kind is None or item["type"] == kind) and (code is None or item["cohort"] == code))
        items, cursor = self._feedback_page(feedback.page_size(query.get("limit"), "admin"),
                                            feedback.decode_cursor(query.get("cursor")), keep)
        counts = self.repo.counter("FEEDBACK-STATS", "ALL")
        return {"items": [self._admin_feedback_view(i) for i in items], "nextCursor": cursor,
                "summary": {s: max(0, counts.get(s, 0)) for s in feedback.STATUSES}}

    def _admin_feedback_view(self, item):
        """Nome atual do aluno, resolvido na publicação atual (não é guardado no feedback)."""
        name, in_cohort = None, False
        if item.get("cohort") and item.get("canvasId"):
            cohort = self.repo.get("COHORT#" + item["cohort"], "METADATA")
            if cohort and cohort.get("current"):
                key = "_names#" + cohort["current"]  # por publicação: nomes mudam a cada publicação
                if key not in self.cache:
                    snap = display_snapshot(self.repo, item["cohort"], self.snapshot(self.publication(item["cohort"], cohort["current"])))
                    self.cache[key] = {s["id"]: s["name"] for s in snap["students"]}
                name = self.cache[key].get(item["canvasId"])
                in_cohort = name is not None
        return {**item, "studentName": name, "inCohort": in_cohort, "canViewAsStudent": in_cohort}

    def _feedback_status(self, feedback_id, body):
        require(isinstance(body, dict) and set(body) == {"status", "expectedStatus"}, 400, "Solicitação inválida.")
        require(body["status"] in feedback.STATUSES and body["expectedStatus"] in feedback.STATUSES, 400, "Status inválido.")
        require(feedback.ID_PATTERN.fullmatch(feedback_id) is not None, 404, "Feedback não encontrado.")
        item = self.repo.get("FEEDBACK", "FEEDBACK#" + feedback_id)
        require(item is not None, 404, "Feedback não encontrado.")
        conflict = "O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo."
        require(item["status"] == body["expectedStatus"], 409, conflict)
        if body["status"] == item["status"]:
            return {"feedback": self._admin_feedback_view(item)}
        updated = feedback.with_status(item, body["status"], self.uid, now())
        try:
            self.repo.transaction([("FEEDBACK", "FEEDBACK#" + feedback_id, updated, item)],
                                  counters=[("FEEDBACK-STATS", "ALL", {item["status"]: -1, body["status"]: 1}, None, None)])
        except Conflict:
            raise APIError(409, conflict) from None
        return {"feedback": self._admin_feedback_view(updated)}

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
        try:
            publication, snap = reminders.fixed_publication(self.repo, cohort, self.snapshot)
        except reminders.PublicationMissing as err:
            raise APIError(404, str(err)) from None
        snap = with_catalog(self.repo, cohort, snap)
        raw_student = next((s for s in snap["students"] if s["id"] == body["studentId"]), None)
        require(raw_student is not None, 404, "Aluno não encontrado nesta publicação.")
        # Desistente: o detalhe continua abrindo, com a marca; o envio é recusado antes de qualquer efeito, conferindo
        # agora (a prévia não autoriza o envio).
        withdrawn = {raw_student["id"]} if participation(self.repo, code, raw_student["id"])[1] == "WITHDRAWN" else set()
        require(operation != "send-reminder" or not withdrawn, 409, "Aluno marcado como desistente nesta turma: lembretes desativados.")
        student = summary(raw_student, snap["activities"], cohort_thresholds(cohort))
        # Detalhe completo para o instrutor (todo/10): resumo, todas as atividades e histórico.
        detail = {"summary": {k: student[k] for k in ("kc", "lab", "total", "progress", "completed", "pending", "status")},
                  "allActivities": student["activities"], "thresholds": cohort_thresholds(cohort),
                  "canvasCourseId": cohort.get("canvasCourseId")} if operation == "pending-preview" else {}
        if operation == "pending-preview":
            detail["history"] = self.student_history(pk, publication, snap, raw_student["id"], detail["thresholds"])
            detail.update(submission_view(self.repo, cohort.get("canvasCourseId"), raw_student["id"], snap["activities"]))
        if not reminders_enabled:
            return {"student": {k: student[k] for k in ("id", "name", "email")},
                    "activities": [a for a in student["activities"] if a["state"] == "pending"],
                    "publicationId": publication["id"], "publishedAt": publication["publishedAt"],
                    "remindersEnabled": False, **detail, **participation_flag(withdrawn, raw_student["id"])}
        message, digest, pending = message_for(code, student, publication, self.user["email"])
        sk = reminders.reminder_key(publication["id"], student["id"])
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
                    "previewHash": digest, "delivery": delivery, "ses": readiness, "remindersEnabled": True,
                    **detail, **participation_flag(withdrawn, raw_student["id"])}
        require(body["publicationId"] == publication["id"] and body["previewHash"] == digest,
                409, "As notas ou a mensagem mudaram. Abra uma nova prévia antes de enviar.")
        require(student["email"] and pending, 400, "O aluno precisa ter e-mail no Canvas e atividades pendentes.")
        require(readiness["ready"], 409, readiness["reason"])
        require(not previous or previous["status"] == "failed", 409,
                "Já existe envio ou tentativa em andamento para este aluno nesta publicação. Consulte o status.")
        try:
            record = reminders.reserve_reminder(self.repo, cohort, publication["id"], student["id"], self.uid, previous, now())
        except reminders.RecipientWithdrawn:
            raise APIError(409, "Aluno marcado como desistente nesta turma: lembretes desativados.") from None
        try:
            reminders.send_reserved_reminder(self.repo, code, record, message, mailer)
        except SendFailure:
            raise APIError(503, "Não foi possível confirmar o envio. Atualize a prévia para consultar o status.") from None
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
        try:
            publication, snap = reminders.fixed_publication(self.repo, cohort, self.snapshot)
        except reminders.PublicationMissing as err:
            raise APIError(404, str(err)) from None
        # Conferido em cada chamada, prévia e envio: quem foi marcado depois da prévia é pulado no envio.
        withdrawn = withdrawn_ids(self.repo, code)
        mailer = self.mailer or SESMailer()
        readiness = mailer.readiness(self.user["email"])
        candidates = [reminders.evaluate_recipient(self.repo, cohort, publication, snap, sid, withdrawn) for sid in ids]
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
            try:
                record = reminders.reserve_reminder(self.repo, cohort, publication["id"], c["id"], self.uid, c["_previous"], now())
            except reminders.RecipientWithdrawn:
                results.append({"id": c["id"], "name": c["name"], "status": "skipped", "reason": "withdrawn"})
                continue
            except Conflict:
                stopped = True
                results.append({"id": c["id"], "name": c["name"], "status": "skipped", "reason": "publication-changed"})
                continue
            try:
                reminders.send_reserved_reminder(self.repo, code, record, message, mailer)
            except SendFailure:
                results.append({"id": c["id"], "name": c["name"], "status": "failed"})
                continue
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
        require(request.get("status", "pending") in ("pending", "approved"), 409,
                "Solicitação recusada ou não elegível para vínculo.")
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

    def _set_participation(self, code, cohort, pk, teach, body):
        """Marca um aluno da publicação atual como WITHDRAWN (desistente) ou de volta como ACTIVE, sem tocar no
        snapshot, nas notas nem na conta dele. expectedStatus é o status que quem pede está vendo: se mudou, 409,
        conferido antes da idempotência (como no status do feedback); pedir o status atual não grava nada. Registro
        e auditoria entram na mesma transação, condicionada ao registro lido."""
        require(teach)
        require(set(body) == {"canvasId", "status", "expectedStatus"}, 400, "Solicitação inválida.")
        canvas_id, status, expected = body["canvasId"], body["status"], body["expectedStatus"]
        require(isinstance(canvas_id, str) and re.fullmatch(r"\d{1,32}", canvas_id) is not None, 400, "Identificador de aluno inválido.")
        require(status in PARTICIPATION_STATUSES and expected in PARTICIPATION_STATUSES, 400, "Status de participação inválido.")
        require(cohort.get("current"), 409, "Publique as notas antes de alterar a participação dos alunos.")
        snap = self.snapshot(self.publication(code, cohort["current"]))
        require(any(s["id"] == canvas_id for s in snap["students"]), 404, "Aluno não encontrado nesta turma.")
        item, current = participation(self.repo, code, canvas_id)
        conflict = "A participação deste aluno foi alterada por outra pessoa. Recarregue e tente de novo."
        require(current == expected, 409, conflict)
        if status == current:
            return {"canvasId": canvas_id, "participationStatus": current, "updatedAt": item["updatedAt"] if item else None}
        at = now()
        try:
            self.repo.transaction([
                (pk, "PARTICIPATION#" + canvas_id, {"canvasId": canvas_id, "status": status, "updatedAt": at, "updatedBy": self.uid}, item),
                (pk, "AUDIT#" + uuid.uuid4().hex,
                 {"action": "participation", "canvasId": canvas_id, "from": current, "to": status, "by": self.uid, "at": at}, None),
            ])
        except Conflict:
            raise APIError(409, conflict) from None
        return {"canvasId": canvas_id, "participationStatus": status, "updatedAt": at}

    def _set_cohort_settings(self, cohort, pk, body):
        require(self.admin)
        require(set(body) == {"thresholds", "canvasCourseId", "autoSync"}, 400, "Solicitação inválida.")
        require(isinstance(body["autoSync"], bool), 400, "Informe se a atualização automática fica ligada.")
        require(not body["autoSync"] or body["canvasCourseId"], 400,
                "Informe o ID do curso Canvas para ligar a atualização automática.")
        thresholds = body["thresholds"]
        require(isinstance(thresholds, dict) and set(thresholds) == {"kc", "lab"}
                and all(isinstance(thresholds[k], (int, float)) and 1 <= thresholds[k] <= 100 for k in ("kc", "lab")),
                400, "Informe limites de KC e LAB entre 1 e 100.")
        canvas_course_id = body["canvasCourseId"]
        require(canvas_course_id is None or (isinstance(canvas_course_id, str) and re.fullmatch(r"\d{1,10}", canvas_course_id)),
                400, "Informe um ID de curso Canvas numérico, ou nenhum.")
        thresholds = {"kc": thresholds["kc"], "lab": thresholds["lab"]}
        updated = {**{k: v for k, v in cohort.items() if not k.startswith("_")},
                   "thresholds": thresholds, "canvasCourseId": canvas_course_id, "autoSync": body["autoSync"]}
        self.repo.transaction([
            (pk, "METADATA", updated, cohort),
            (pk, "AUDIT#" + uuid.uuid4().hex,
             {"action": "settings", "thresholds": thresholds, "canvasCourseId": canvas_course_id,
              "autoSync": body["autoSync"], "by": self.uid, "at": now()}, None),
        ])
        return {"thresholds": thresholds, "canvasCourseId": canvas_course_id, "autoSync": body["autoSync"]}

    def _preview(self, code, cohort, pk, teach, body):
        require(teach)
        snapshot, before = self._prepare(code, cohort, body)
        result = self._save_draft(code, cohort, pk, body, snapshot, before)
        # Só para exibir: _publish recalcula tudo e ignora qualquer "integrity" vindo do cliente.
        result["integrity"] = self._integrity(cohort, snapshot, before, result["draft"]["filename"])
        return result

    def _integrity(self, cohort, snapshot, current, filename, compare_size_with_current=True):
        """Integridade contra a matrícula e o catálogo do Canvas gravados pelo canvas_sync."""
        course = cohort.get("canvasCourseId")
        return integrity_check(snapshot, canvas_course_id=course,
                               roster=self.repo.get("ROSTER#" + course, "METADATA") if course else None,
                               catalog=self.repo.get("CATALOG#" + course, "METADATA") if course else None,
                               current=current, filename=filename,
                               compare_size_with_current=compare_size_with_current)

    def _prepare(self, code, cohort, body):
        """Lê o CSV e a publicação atual, sem gravar nada."""
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
        return snapshot, before

    def _save_draft(self, code, cohort, pk, body, snapshot, before):
        draft_id = uuid.uuid4().hex
        key = f"cohorts/{code}/{draft_id}"
        # Rascunho não publicado expira em DRAFT_TTL_DAYS (tag no S3 + TTL no DynamoDB; ver todo/13).
        self.repo.snapshot(key + "/source.csv", body["csv"], raw=True, status="draft")
        self.repo.snapshot(key + "/snapshot.json", snapshot, status="draft")
        draft = {"id": draft_id, "cohort": code, "createdBy": self.uid, "createdAt": now(),
                 "base": cohort.get("current"), "snapshot": key + "/snapshot.json", "status": "draft",
                 "filename": str(body.get("filename", "notas.csv"))[:150]}
        self.repo.put(pk, "DRAFT#" + draft_id, draft, absent=True, ttl_days=DRAFT_TTL_DAYS)
        return {"draft": draft, **overview(display_snapshot(self.repo, code, snapshot), cohort_thresholds(cohort)),
                "changes": snapshot_changes(before, snapshot)}

    def _publish(self, cohort, pk, teach, body, kind="publish", sync_run=None):
        require(teach)
        draft = self.repo.get(pk, "DRAFT#" + str(body.get("draftId", "")))
        require(draft is not None and draft["createdBy"] == self.uid, 404, "Prévia não encontrada para sua conta.")
        require(draft["status"] == "draft" and draft["base"] == cohort.get("current"), 409,
                "A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia.")
        # Um dia de folga antes da expiração no S3, para nunca publicar lendo arquivo já apagado.
        # Mesmo relógio que gravou createdAt (now(), UTC com offset): o teste fixa um só.
        age = datetime.fromisoformat(now()) - datetime.fromisoformat(draft["createdAt"])
        require(age.days < DRAFT_TTL_DAYS - 1, 409, "Esta prévia expirou. Confira o arquivo de novo para gerar outra.")
        snap = self.snapshot(draft)
        before = self.snapshot(self.publication(cohort["code"], cohort["current"])) if cohort.get("current") else None
        changes = snapshot_changes(before, snap)
        require(not changes["studentsRemoved"] or body.get("acknowledgeRemoved") is True, 400,
                "Confirme a remoção de alunos antes de publicar o arquivo completo da turma.")
        require(any(a["active"] for a in snap["activities"]), 400, "Libere ao menos uma atividade antes de publicar.")
        report = None
        if kind == "publish":
            # Envio manual: recalculado aqui com o rascunho gravado e a matrícula, o catálogo e a
            # publicação atuais, antes de qualquer escrita. A sincronização (kind="canvas") não passa
            # por aqui: os dados dela são a própria matrícula do Canvas.
            report = self._integrity(cohort, snap, before, draft.get("filename", ""))
            require(not report["critical"], 409,
                    blocking_message(report, "Publicação bloqueada pelas validações de integridade."))
        # Resumo por aluno gravado agora, com o que já está em memória (snap e before), para
        # que _report não precise reler dezenas de snapshots a cada carregamento do histórico.
        history_key = draft["snapshot"].rsplit("/", 1)[0] + "/history.json"
        self.repo.snapshot(history_key, student_history(before, snap, cohort_thresholds(cohort)))
        # Antes de efetivar: se a publicação falhar depois disso, os arquivos só ficam guardados a
        # mais; o contrário (publicar e não desmarcar) apagaria dados publicados em 30 dias.
        folder = draft["snapshot"].rsplit("/", 1)[0]
        for name in ("source.csv", "snapshot.json"):
            self.repo.mark(folder + "/" + name, "published")
        published_at = now()
        previous_pub = self.publication(cohort["code"], cohort["current"]) if cohort.get("current") else None
        previous_dates = (previous_pub or {}).get("releasedAt") or {}
        previously_active = {a["id"] for a in before["activities"] if a["active"]} if before else set()
        # Atividade já liberada antes mantém a data original; sem mapa (publicação antiga), a
        # melhor estimativa é a data daquela publicação. Atividade nova recebe a data de agora.
        released = {a["id"]: previous_dates.get(a["id"])
                    or (previous_pub["publishedAt"] if a["id"] in previously_active else published_at)
                    for a in snap["activities"] if a["active"]}
        publication = {**draft, "status": "published", "publishedAt": published_at, "publishedBy": self.uid,
                       "changes": change_counts(changes), "history": history_key, "releasedAt": released}
        next_cohort = {k: v for k, v in cohort.items() if not k.startswith("_")}
        next_cohort.update(current=draft["id"], updatedAt=publication["publishedAt"], updateKind=kind)
        writes = [
            (pk, "METADATA", next_cohort, cohort),
            (pk, "DRAFT#" + draft["id"], publication, draft),
            (pk, "PUB#" + draft["id"], publication, None),
        ]
        if kind == "publish":
            # Na mesma transação: não existe publicação manual sem AUDIT nem AUDIT sem publicação.
            writes.append((pk, "AUDIT#" + uuid.uuid4().hex, {
                "action": "publish", "origin": "manual", "by": self.uid, "byEmail": self.user["email"],
                "cohort": cohort["code"], "publicationId": draft["id"], "at": published_at,
                "filename": draft.get("filename"), "students": len(snap["students"]),
                "activities": len(snap["activities"]), "warnings": issue_counts(report, snap.get("warnings", []))}, None))
        proof = sync_run.completion_write(next_cohort, "published") if sync_run else None
        if proof:
            writes.append(proof)
        # Build candidate projection completely before exposing the new current.
        # No transaction-size assumption about class size; incomplete preparations
        # are harmless candidates and cannot activate a partially indexed publish.
        derived_access.prepare_discovery(self.repo, cohort["code"], snap)
        writes += [derived_access.directory_write(self.repo, cohort["code"]),
                   *derived_access.publication_history_writes(self.repo, cohort["code"], publication)]
        self.repo.transaction(writes)
        if proof:
            sync_run.accept(proof)
        return {"publication": publication}

    def _restore(self, cohort, pk, teach, body):
        require(teach)
        publication = self.publication(cohort["code"], str(body.get("publicationId", "")))
        require(body.get("expectedCurrent") == cohort.get("current"), 409, "A turma foi atualizada. Recarregue o histórico.")
        # O histórico é imutável e continua consultável; só não volta a ser o estado oficial se
        # não passar nas validações atuais (matrícula e catálogo de agora).
        current = self.snapshot(self.publication(cohort["code"], cohort["current"])) if cohort.get("current") else None
        report = self._integrity(cohort, self.snapshot(publication), current, publication.get("filename", ""),
                                 compare_size_with_current=False)
        require(not report["critical"], 409, blocking_message(
            report, "Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade."))
        updated = {k: v for k, v in cohort.items() if not k.startswith("_")}
        updated.update(current=publication["id"], updatedAt=now(), updateKind="restore")
        derived_access.prepare_discovery(self.repo, cohort["code"], self.snapshot(publication))
        self.repo.transaction([(pk, "METADATA", updated, cohort),
                               derived_access.directory_write(self.repo, cohort["code"]),
                               (pk, "AUDIT#" + uuid.uuid4().hex,
                                {"action": "restore", "by": self.uid, "at": now(), "publicationId": publication["id"]}, None)])
        return {"restored": True}

    def _report(self, code, cohort, pk, teach):
        if not cohort.get("current"):
            require(teach)
            return {"cohort": code, "publication": None, "students": [], "history": [],
                    "thresholds": cohort_thresholds(cohort), "canvasCourseId": cohort.get("canvasCourseId"),
                    **self._sync_report(cohort, pk)}
        publication, snap, focus = self._current_view(code, cohort, pk)
        thresholds = cohort_thresholds(cohort)
        canvas_course_id = cohort.get("canvasCourseId")
        if teach:
            # Vínculo criado quando o aluno entra e abre o próprio relatório (Portal.student).
            linked = {k[len("OWNER#"):] for k in self.repo.keys(pk, "OWNER#")}
            # Desistentes seguem listados, com a marca, e saem das estatísticas por atividade.
            withdrawn = withdrawn_ids(self.repo, code)
            class_overview = overview(snap, thresholds, excluded=withdrawn)
            activity = instructor_activity(self.repo, canvas_course_id)
            class_overview["students"] = [{**s, "portalLinked": s["id"] in linked, **participation_flag(withdrawn, s["id"]),
                                           **student_activity(activity, s["id"])}
                                               for s in class_overview["students"]]
            return {"cohort": code, "publication": publication, "focus": focus, **class_overview,
                    **activity_summary(activity),
                    "updatedAt": cohort.get("updatedAt", publication["publishedAt"]),
                    "updateKind": cohort.get("updateKind", "publish"),
                    "thresholds": thresholds, "canvasCourseId": canvas_course_id,
                    **self._sync_report(cohort, pk),
                    "history": sorted(({k: v for k, v in p.items() if k != "releasedAt"} for p in self.repo.list(pk, "PUB#")),
                                     key=lambda p: p["publishedAt"], reverse=True)}
        student = self.student(code, snap, bind=True)
        require(student is not None, 403, "Matrícula não localizada para sua conta nesta turma.")
        return self._student_report(code, cohort, pk, publication, snap, focus, student)

    def _sync_report(self, cohort, pk):
        from sync_runs import diagnostics
        sync = self.repo.get(pk, "SYNC")
        if isinstance(sync, dict):
            # O registro histórico permanece intacto. Texto de exceção nunca é
            # necessário para explicar a qualidade da coleta na interface.
            sync = {key: value for key, value in sync.items()
                    if key in ("status", "message", "at", "students", "publicationId")}
            if sync.get("status") == "failed":
                sync["message"] = "Não foi possível concluir a verificação das notas no Canvas."
        return {"canvasSync": sync, "canvasSyncDiagnostics": diagnostics(self.repo, cohort)}

    def _current_view(self, code, cohort, pk):
        """Publicação atual como aluno e instrutor a enxergam: nomes de exibição,
        catálogo, liberação e foco restrito às atividades ativas."""
        publication = self.publication(code, cohort["current"])
        snap = with_catalog(self.repo, cohort,
                            released_at(publication, display_snapshot(self.repo, code, self.snapshot(publication))))
        focus = self.repo.get(pk, "FOCUS") or {"activityIds": [], "version": None}
        active = {a["id"] for a in snap["activities"] if a["active"]}
        focus = {"activityIds": [i for i in focus["activityIds"] if i in active], "version": focus.get("version")}
        return publication, snap, focus

    def _student_report(self, code, cohort, pk, publication, snap, focus, student):
        """Relatório de um aluno. Único ponto usado pelo próprio aluno e pelo admin em
        "Visualizar como aluno"; não cria nem consulta vínculo de conta."""
        thresholds = cohort_thresholds(cohort)
        history = self.student_history(pk, publication, snap, student["id"], thresholds)
        return {"cohort": code, "publication": {"id": publication["id"], "publishedAt": publication["publishedAt"]},
                "updatedAt": cohort.get("updatedAt", publication["publishedAt"]),
                "updateKind": cohort.get("updateKind", "publish"),
                "thresholds": thresholds, "canvasCourseId": cohort.get("canvasCourseId"),
                "student": summary(student, snap["activities"], thresholds), "history": history, "focus": focus,
                **submission_view(self.repo, cohort.get("canvasCourseId"), student["id"], snap["activities"])}

    def _student_view(self, code, cohort, pk, body):
        """Admin vê o relatório de um aluno sem se autenticar como ele: somente leitura,
        sem vínculo OWNER/STUDY e com auditoria de cada abertura."""
        require(self.admin)
        require(isinstance(body, dict) and set(body) == {"studentId"}, 400, "Solicitação inválida.")
        student_id = body["studentId"]
        require(isinstance(student_id, str) and re.fullmatch(r"\d{1,32}", student_id) is not None,
                400, "Identificador de aluno inválido.")
        not_found = "Aluno não encontrado nesta turma."
        require(bool(cohort.get("current")), 404, not_found)
        publication, snap, focus = self._current_view(code, cohort, pk)
        student = next((s for s in snap["students"] if s["id"] == student_id), None)
        require(student is not None, 404, not_found)
        self.repo.put(pk, "AUDIT#" + uuid.uuid4().hex,
                      {"action": "STUDENT_VIEW_AS_ADMIN", "by": self.uid, "byEmail": self.user["email"],
                       "studentId": student_id, "cohort": code, "at": now()}, absent=True)
        return {**self._student_report(code, cohort, pk, publication, snap, focus, student),
                "viewAs": {"studentId": student_id, "name": student["name"]}}


SYNC_USER = {"sub": "system:canvas-sync", "email": "canvas-sync@system", "groups": ["admin"]}


def sync_from_canvas(repo, code, csv_text, api_students, sync_run=None):
    """Publica as notas vindas do Canvas (todo/17), como se o instrutor tivesse enviado o CSV.

    Não publica se nada mudou (evita encher o histórico do aluno) nem se a turma veio vazia ou
    muito menor que a publicação atual (mais provável ser falha da API do que evasão). Grava o
    resultado em COHORT#<code>/SYNC e devolve {"status": ...}; falhas levantam exceção.
    """
    portal = Portal(repo, SYNC_USER)
    pk = "COHORT#" + code
    cohort = portal.cohort(code)
    if sync_run and cohort != sync_run.cohort:
        raise Conflict()
    current = portal.snapshot(portal.publication(code, cohort["current"])) if cohort.get("current") else None

    def record(status, message, publication_id=None):
        result = {"status": status, "message": message, "at": now(), "students": api_students,
                  "publicationId": publication_id}
        repo.put(pk, "SYNC", result)
        return result

    try:
        require(api_students > 0, 409, "O Canvas não devolveu nenhum aluno; nada foi publicado.")
        if current:
            require(api_students >= SYNC_MIN_ROSTER * len(current["students"]), 409,
                    f"O Canvas devolveu {api_students} alunos, bem menos que os {len(current['students'])} "
                    "da publicação atual; nada foi publicado.")
        body = {"csv": csv_text, "filename": "canvas-api.csv"}
        snapshot, before = portal._prepare(code, cohort, body)
        changes = snapshot_changes(before, snapshot)
        if current and not any(changes[k] for k in (
                "gradesChanged", "studentsAdded", "studentsRemoved", "studentsUpdated", "activitiesAdded",
                "activitiesRemoved", "activitiesReleased", "activitiesPaused", "scalesChanged")):
            # Compara antes de gravar: execução sem mudança não deixa rascunho para trás.
            if sync_run:
                sync_run.complete_unchanged(cohort)
            return record("unchanged", "Nenhuma mudança no Canvas desde a última publicação.")
        preview = portal._save_draft(code, cohort, pk, body, snapshot, before)
        publication = portal._publish(cohort if sync_run else portal.cohort(code), pk, True,
                                      {"draftId": preview["draft"]["id"], "acknowledgeRemoved": True},
                                      kind="canvas", sync_run=sync_run)["publication"]
        return record("published", f"{changes['gradesChanged']} nota(s) alterada(s).", publication["id"])
    except (APIError, ValidationError) as err:
        record("failed", err.message if isinstance(err, APIError) else str(err))
        raise


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
        result = Portal(Repository(), user, os.environ["INSTRUCTOR_EMAIL_DOMAIN"]).dispatch(
            http.get("method"), path, body, event.get("queryStringParameters") or {})
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

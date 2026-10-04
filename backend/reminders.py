"""Lembretes individuais: conteúdo gerado no servidor e envio explícito pelo instrutor."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone

from grades import summary
from repository import Conflict


def reminder_settings(sender_user_id, automatic_enabled, version, updated_at):
    """Modelo fechado: a identidade/e-mail permanece no vínculo, nunca nesta configuração."""
    if (not isinstance(sender_user_id, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,128}", sender_user_id)
            or not isinstance(automatic_enabled, bool) or type(version) is not int or version < 1):
        raise ValueError("Configuração de lembrete inválida")
    try:
        at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        if at.tzinfo is None:
            raise ValueError()
    except (AttributeError, TypeError, ValueError):
        raise ValueError("Data da configuração inválida") from None
    return {"senderUserId": sender_user_id, "automaticEnabled": automatic_enabled,
            "version": version, "updatedAt": at.astimezone(timezone.utc).isoformat()}


def automatic_sender_readiness(repo, code, domain, mailer):
    """Consulta apenas. O gate da turma não substitui o gate de infraestrutura futuro."""
    pk = "COHORT#" + code
    settings = repo.get(pk, "REMINDER_SETTINGS")
    if settings is None:
        return {"ready": False, "reason": "settings-missing"}
    try:
        if set(settings) != {"senderUserId", "automaticEnabled", "version", "updatedAt"}:
            raise ValueError()
        reminder_settings(settings["senderUserId"], settings["automaticEnabled"], settings["version"], settings["updatedAt"])
    except (TypeError, ValueError):
        return {"ready": False, "reason": "settings-invalid"}
    if not settings["automaticEnabled"]:
        return {"ready": False, "reason": "automatic-disabled"}
    uid = settings["senderUserId"]
    link = repo.get(pk, "TEACH#" + uid)
    reverse = repo.get("USER#" + uid, "TEACH#" + code)
    if (not isinstance(link, dict) or link.get("userId") != uid or link.get("code") != code
            or not isinstance(reverse, dict) or reverse.get("code") != code):
        return {"ready": False, "reason": "sender-unlinked"}
    email = link.get("email")
    if not isinstance(email, str) or not re.fullmatch(r"[^\s@]+@" + re.escape(domain), email):
        return {"ready": False, "reason": "sender-invalid"}
    return {"settings": settings, "sender": email, **mailer.readiness(email)}


def cohort_thresholds(cohort):
    thresholds = cohort.get("thresholds") or {}
    return {"kc": thresholds.get("kc", 70), "lab": thresholds.get("lab", 95)}


def display_snapshot(repo, code, snapshot):
    """Nomes de exibição não alteram notas, matrícula ou e-mail."""
    profiles = {p["canvasId"]: p for p in repo.list("COHORT#" + code, "PROFILE#")}
    return {**snapshot, "students": [
        {**s, "name": profiles.get(s["id"], {}).get("displayName", s["name"])} for s in snapshot["students"]]}


def participation(repo, code, canvas_id):
    item = repo.get("COHORT#" + code, "PARTICIPATION#" + canvas_id)
    return item, item["status"] if item else "ACTIVE"


def withdrawn_ids(repo, code):
    return {p["canvasId"] for p in repo.list("COHORT#" + code, "PARTICIPATION#") if p["status"] == "WITHDRAWN"}


class PublicationMissing(LookupError):
    pass


def fixed_publication(repo, cohort, snapshot_loader=None):
    """Carrega somente a publicação do METADATA fornecido; a reserva condiciona esse METADATA."""
    if not cohort.get("current"):
        raise PublicationMissing("Publicação não encontrada.")
    publication = repo.get("COHORT#" + cohort["code"], "PUB#" + cohort["current"])
    if publication is None:
        raise PublicationMissing("Publicação não encontrada.")
    snapshot = snapshot_loader(publication) if snapshot_loader else repo.snapshot(publication["snapshot"])
    return publication, display_snapshot(repo, cohort["code"], snapshot)


def evaluate_recipient(repo, cohort, publication, snapshot, student_id, withdrawn):
    """A preview classifica; a reserva faz a autorização final por destinatário."""
    raw = next((s for s in snapshot["students"] if s["id"] == student_id), None)
    if raw is None:
        return {"id": student_id, "name": None, "email": None, "pending": 0, "skip": "not-found"}
    student = summary(raw, snapshot["activities"], cohort_thresholds(cohort))
    pending = sum(a["state"] == "pending" for a in student["activities"])
    previous = repo.get("COHORT#" + cohort["code"], reminder_key(publication["id"], student_id))
    skip = ("withdrawn" if student_id in withdrawn else "no-email" if not student["email"] else
            "no-pending" if not pending else "already-sent" if previous and previous["status"] != "failed" else None)
    return {"id": student_id, "name": student["name"], "email": student["email"], "pending": pending,
            "skip": skip, "_student": student, "_previous": previous}


def reminder_key(publication_id, student_id):
    return "REMINDER#" + publication_id + "#" + student_id


class RecipientWithdrawn(Exception):
    pass


def reserve_reminder(repo, cohort, publication_id, student_id, actor, previous, at):
    """Ponto de autorização: publicação, participação e dedupe são condicionados atomicamente.

    ACTIVE implícito é condição de ausência; ACTIVE explícito exige o registro lido.
    Depois da reserva, uma desistência não recolhe a mensagem já autorizada/em trânsito.
    """
    code, pk = cohort["code"], "COHORT#" + cohort["code"]
    item, status = participation(repo, code, student_id)
    if status != "ACTIVE":
        raise RecipientWithdrawn()
    if cohort.get("current") != publication_id or (previous and previous["status"] != "failed"):
        raise Conflict()
    record = {"studentId": student_id, "publicationId": publication_id, "by": actor, "at": at, "status": "sending"}
    try:
        repo.transaction([(pk, "METADATA", cohort, cohort),
                          (pk, reminder_key(publication_id, student_id), record, previous)],
                         checks=[(pk, "PARTICIPATION#" + student_id, item)])
    except Conflict:
        if participation(repo, code, student_id)[1] != "ACTIVE":
            raise RecipientWithdrawn() from None
        raise
    return record


def send_reserved_reminder(repo, code, record, message, mailer):
    """Uma tentativa SES; falha incerta permanece bloqueada pela mesma chave manual/automática."""
    pk, sk = "COHORT#" + code, reminder_key(record["publicationId"], record["studentId"])
    try:
        message_id = mailer.send(message)
    except SendFailure as err:
        record["status"] = "unknown" if err.uncertain else "failed"
        repo.put(pk, sk, record)
        raise
    record.update(status="sent", messageId=message_id)
    repo.put(pk, sk, record)
    return record


class SendFailure(Exception):
    def __init__(self, uncertain=False):
        self.uncertain = uncertain


def message_for(code, student, publication, reply_to):
    pending = [a for a in student["activities"] if a["state"] == "pending"]
    sections = []
    for kind, title in (("kc", "KCs sem nota registrada"), ("lab", "LABs sem nota registrada")):
        names = [a["name"] for a in pending if a["kind"] == kind]
        if names:
            sections.append(title + ":\n" + "\n".join("- " + name for name in names))
    text = (f"Olá, {student['name']}!\n\n"
            f"Há atividades sem nota registrada na turma {code}, "
            f"conforme a atualização de {publication['publishedAt'][:10]}.\n\n"
            + "\n\n".join(sections)
            + "\n\nPrecisa de algum auxílio? Responda a este e-mail para conversar com a pessoa instrutora."
            "\n\nUma nota em branco não confirma falta de entrega. Se você já entregou, "
            "aguarde a correção e a próxima atualização ou converse com seu instrutor."
            "\n\nConte com a gente!\nEquipe de instrução · Escola da Nuvem · AWS re/Start")
    msg = {"to": student["email"], "replyTo": reply_to,
           "subject": f"Podemos ajudar? Atividades sem nota · {code}", "text": text,
           "from": reply_to}
    digest = hashlib.sha256(json.dumps(msg, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return msg, digest, pending


class SESMailer:
    def __init__(self):
        import boto3
        from botocore.config import Config
        # SES SendEmail has no idempotency key. Never automatically retry a send.
        self.client = boto3.client("sesv2", config=Config(connect_timeout=3, read_timeout=5,
                                                        retries={"total_max_attempts": 1}))

    def ensure_identity(self, email):
        """Cria a identidade SES do instrutor se ainda não existir. O SES envia a confirmação por e-mail;
        não recriamos identidades já existentes para não reenviar essa confirmação sem necessidade."""
        from botocore.exceptions import ClientError
        try:
            self.client.get_email_identity(EmailIdentity=email)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") != "NotFoundException":
                raise
            self.client.create_email_identity(EmailIdentity=email)

    def readiness(self, sender):
        try:
            account = self.client.get_account()
            identity = self.client.get_email_identity(EmailIdentity=sender)
        except Exception:
            return {"ready": False, "reason": "Não foi possível confirmar a configuração do SES. Avise o administrador."}
        if not identity.get("VerifiedForSendingStatus"):
            return {"ready": False, "reason": "Confirme o e-mail de verificação que o SES enviou ao seu endereço institucional."}
        if not account.get("ProductionAccessEnabled"):
            return {"ready": False, "reason": "O SES aguarda liberação de produção pela AWS para enviar aos alunos."}
        if not account.get("SendingEnabled"):
            return {"ready": False, "reason": "O envio está suspenso no SES. Avise o administrador."}
        return {"ready": True, "reason": "Remetente verificado e envio habilitado."}

    def send(self, message):
        from botocore.exceptions import ClientError
        args = {"FromEmailAddress": message["from"],
                "Destination": {"ToAddresses": [message["to"]]},
                "ReplyToAddresses": [message["replyTo"]],
                "Content": {"Simple": {
                    "Subject": {"Data": message["subject"], "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": message["text"], "Charset": "UTF-8"}}}}}
        if os.environ.get("REMINDER_CONFIGURATION_SET"):
            args["ConfigurationSetName"] = os.environ["REMINDER_CONFIGURATION_SET"]
        try:
            return self.client.send_email(**args)["MessageId"]
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code")
            # Only definite rejection permits a manual retry. Unknown outcomes stay locked.
            rejected = code in {"MessageRejected", "MailFromDomainNotVerifiedException", "NotFoundException",
                                "BadRequestException", "AccountSuspendedException", "SendingPausedException",
                                "TooManyRequestsException", "LimitExceededException", "AccessDeniedException"}
            raise SendFailure(uncertain=not rejected) from None
        except Exception:
            raise SendFailure(uncertain=True) from None

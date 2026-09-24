"""Lembretes individuais: conteúdo gerado no servidor e envio explícito pelo instrutor."""
import hashlib
import json
import os


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
            + "\n\nPrecisa de algum auxílio? Responda a este e-mail para conversar com seu instrutor."
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

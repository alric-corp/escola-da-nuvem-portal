"""Feedback da plataforma: validação, identificadores, cursor de paginação e chaves auxiliares.

Domínio independente de publicações, rascunhos, notas e matrícula. Os handlers ficam em
portal.py (Portal._create_feedback e vizinhos); aqui só regras puras, sem acesso a dados.

Itens no DynamoDB (tabela única, sem GSI):
- FEEDBACK / FEEDBACK#<id>: o feedback. O id começa pela data (ordenável), então a partição
  lida em ordem decrescente de SK já sai do mais recente para o mais antigo.
- FEEDBACK-DEDUP / <sub>#<hash do conteúdo>: envio idêntico nos últimos 10 minutos.
- FEEDBACK-RATE#<sub> / HOUR#<aaaammddHH>: contador atômico de envios na hora (UTC).
- FEEDBACK-STATS / ALL: contadores por status, para o resumo do admin sem ler a partição toda.
Os três auxiliares têm TTL (expiresAt), mas nenhuma regra depende da remoção física pelo TTL.
"""
import base64
import binascii
import hashlib
import json
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

TYPES = ("BUG", "SUGGESTION", "IMPROVEMENT", "OTHER")
STATUSES = ("NEW", "IN_REVIEW", "RESOLVED", "ARCHIVED")
# Páginas de onde se chega ao Feedback (state.view do frontend). Só estes valores são aceitos;
# "onboarding" é a tela de quem ainda não tem turma.
PAGES = ("overview", "activities", "history", "import", "reminders", "access", "activity-overview",
         "student-pending", "reminders-batch", "admin-feedback", "onboarding")
TITLE_LIMITS = (3, 120)
DESCRIPTION_LIMITS = (10, 2000)
CREATE_FIELDS = {"type", "title", "description", "cohort", "page"}
RATE_LIMIT = 5
DEDUP_WINDOW = timedelta(minutes=10)
HISTORY_LIMIT = 20
PAGE_SIZES = {"mine": (20, 50), "admin": (50, 100)}  # (padrão, máximo)

ID_PATTERN = re.compile(r"\d{8}T\d{12}-[0-9a-f]{8}")
CODE_PATTERN = re.compile(r"[A-Z0-9-]{3,32}")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class Invalid(ValueError):
    """Entrada recusada; a mensagem é mostrada ao usuário (400)."""


def clock():
    return datetime.now(timezone.utc)


def new_id(at):
    return f"{at:%Y%m%dT%H%M%S%f}-{uuid.uuid4().hex[:8]}"


def _text(value, limits, field, multiline):
    if not isinstance(value, str):
        raise Invalid(f"Informe {field}.")
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text if multiline else text.replace("\n", " ").replace("\t", " "))
    text = "\n".join(line.rstrip() for line in text.strip().split("\n")) if multiline else " ".join(text.split())
    low, high = limits
    if not low <= len(text) <= high:
        raise Invalid(f"{field[0].upper() + field[1:]} deve ter entre {low} e {high} caracteres.")
    return text


def clean_new(body):
    """Campos do cliente para criar um feedback. Tudo o mais (autor, datas, status, vínculo)
    é definido pelo servidor; qualquer campo além destes é recusado."""
    if not isinstance(body, dict) or not set(body) <= CREATE_FIELDS or not {"type", "title", "description"} <= set(body):
        raise Invalid("Solicitação inválida.")
    if body["type"] not in TYPES:
        raise Invalid("Escolha o tipo do feedback.")
    cohort = body.get("cohort")
    if cohort is not None and (not isinstance(cohort, str) or not CODE_PATTERN.fullmatch(cohort)):
        raise Invalid("Turma inválida.")
    page = body.get("page")
    if page is not None and page not in PAGES:
        raise Invalid("Página de origem inválida.")
    return {"type": body["type"], "title": _text(body["title"], TITLE_LIMITS, "o título", False),
            "description": _text(body["description"], DESCRIPTION_LIMITS, "a descrição", True),
            "cohort": cohort, "page": page}


def content_hash(uid, data):
    """Identidade de um envio para a regra de duplicidade: tipo, título, descrição, turma e página
    de origem (o mesmo texto vindo de Atividades e de Histórico pode ser outro problema)."""
    raw = json.dumps([uid, data["type"], data["title"].casefold(), data["description"].casefold(), data["cohort"], data["page"]],
                     ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def rate_key(uid, at):
    hour = at.replace(minute=0, second=0, microsecond=0)
    # O TTL só limpa a tabela; a regra usa a chave da hora, não a remoção do item.
    return "FEEDBACK-RATE#" + uid, f"HOUR#{hour:%Y%m%d%H}", int((hour + timedelta(hours=2)).timestamp())


def page_size(value, kind):
    default, maximum = PAGE_SIZES[kind]
    if value is None:
        return default
    if not isinstance(value, str) or not value.isdigit() or not 1 <= int(value) <= maximum:
        raise Invalid(f"O limite deve estar entre 1 e {maximum}.")
    return int(value)


def encode_cursor(feedback_id):
    """Cursor opaco: só o id do último feedback devolvido ao próprio chamador."""
    return base64.urlsafe_b64encode(json.dumps({"after": feedback_id}).encode()).decode().rstrip("=")


def decode_cursor(cursor):
    if cursor is None:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        after = data["after"]
    except (binascii.Error, ValueError, TypeError, KeyError, UnicodeDecodeError):
        raise Invalid("Cursor de paginação inválido.") from None
    if not isinstance(after, str) or not ID_PATTERN.fullmatch(after) or set(data) != {"after"}:
        raise Invalid("Cursor de paginação inválido.")
    return after


def with_status(item, status, by, at):
    """Nova versão do feedback com o status trocado; statusHistory guarda só as 20 mudanças
    mais recentes (as mais antigas são descartadas)."""
    history = (item.get("statusHistory") or []) + [{"status": status, "by": by, "at": at}]
    return {**item, "status": status, "updatedAt": at, "updatedBy": by, "statusHistory": history[-HISTORY_LIMIT:]}


def own_view(item):
    """O que o autor vê do próprio feedback (sem e-mail, sub de admin ou histórico interno)."""
    return {k: item.get(k) for k in ("id", "type", "title", "description", "status", "createdAt", "cohort", "page", "updatedAt")} | {
        "attachments": item.get("attachments", 0)}


# Anexos (imagens) do feedback. O arquivo vai do navegador direto ao S3 por presigned POST
# (bucket próprio, privado); o DynamoDB guarda só metadados, em três slots fixos por feedback:
# FEEDBACK-ATTACHMENT#<feedbackId> / SLOT#1..3. O limite de 3 vem da própria chave.
ATTACHMENT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024  # 5 MiB
ATTACHMENT_SLOTS = 3
ATTACHMENT_NAME_MAX = 180
OPEN_STATUSES = ("NEW", "IN_REVIEW")
UPLOAD_SECONDS = 300          # validade do presigned POST
PENDING_WINDOW = timedelta(minutes=15)  # depois disso o slot PENDING é considerado livre
PENDING_TTL = timedelta(days=1)
REJECTED_TTL = timedelta(days=7)
DOWNLOAD_SECONDS = 300        # validade do link de leitura
ATTACHMENT_ID = re.compile(r"[0-9a-f]{32}")
CLIENT_TOKEN = re.compile(r"[A-Za-z0-9-]{16,64}")
SLOT_FIELDS = {"fileName", "contentType", "size", "clientToken"}


def attachment_pk(feedback_id):
    return "FEEDBACK-ATTACHMENT#" + feedback_id


def tmp_key(feedback_id, attachment_id):
    return f"tmp/{feedback_id}/{attachment_id}"


def final_key(feedback_id, attachment_id):
    return f"feedback/{feedback_id}/{attachment_id}"


def clean_filename(name, mime):
    """Nome só para exibição: nunca vira chave no S3 nem entra cru em cabeçalho."""
    text = unicodedata.normalize("NFC", name if isinstance(name, str) else "")
    text = re.split(r"[\\/]", text)[-1]  # basename: descarta qualquer caminho (../../)
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")  # controles, CR/LF, bidi
    text = " ".join(text.split()).strip(" .")
    return text[:ATTACHMENT_NAME_MAX].strip() or f"imagem.{ATTACHMENT_TYPES[mime]}"


def clean_slot_request(body):
    if not isinstance(body, dict) or set(body) != SLOT_FIELDS:
        raise Invalid("Solicitação inválida.")
    mime = body["contentType"]
    if mime not in ATTACHMENT_TYPES:
        raise Invalid("Envie imagens PNG, JPEG ou WebP.")
    size = body["size"]
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= ATTACHMENT_MAX_BYTES:
        raise Invalid("Cada imagem deve ter até 5 MB.")
    token = body["clientToken"]
    if not isinstance(token, str) or not CLIENT_TOKEN.fullmatch(token):
        raise Invalid("Identificador do arquivo inválido.")
    if not isinstance(body["fileName"], str) or len(body["fileName"]) > 1000:
        raise Invalid("Nome de arquivo inválido.")
    return {"originalName": clean_filename(body["fileName"], mime), "mimeType": mime, "size": size, "clientToken": token}


def detect_image(head):
    """Tipo real pelos primeiros bytes (assinatura), sem biblioteca de imagem."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def content_disposition(name):
    """inline; filename="<ASCII seguro>"; filename*=UTF-8''<percent-encoded>. Nada cru do usuário."""
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\;' else "_" for ch in name) or "imagem"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


def attachment_view(slot):
    return {k: slot.get(k) for k in ("attachmentId", "originalName", "mimeType", "size", "createdAt")}

"""Lambda agendada (EventBridge Scheduler): atualiza as notas das turmas pela API do Canvas.

Só atualiza notas de turmas com autoSync ligado e canvasCourseId configurado (Turmas e acessos →
Configurações). O catálogo de módulos e links (todo/12) é atualizado para toda turma com
canvasCourseId, mesmo sem autoSync. Falha de uma turma não impede as outras; ao final,
qualquer falha faz a execução terminar com erro, o que aciona o alarme do CloudWatch
(canvas-sync.tf).
"""
import json
import logging
import os

from canvas import CanvasClient, CanvasError, course_catalog, course_csv, course_students, token_expires_at
from portal import APIError, save_catalog, save_roster, sync_from_canvas
from grades import ValidationError
from repository import Conflict, Repository

logging.getLogger().setLevel(logging.INFO)


def read_token(secret_arn):
    import boto3
    from botocore.exceptions import ClientError
    try:
        value = boto3.client("secretsmanager").get_secret_value(SecretId=secret_arn).get("SecretString", "").strip()
    except ClientError as err:
        if err.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            raise RuntimeError("O token do Canvas ainda não foi gravado no segredo.") from None
        raise
    if not value:
        raise RuntimeError("O segredo do token do Canvas está vazio.")
    # Aceita o token puro ou {"token": "..."}.
    return json.loads(value)["token"] if value.startswith("{") else value


def run(repo, client):
    results, failures, catalogs, rosters = {}, [], set(), {}
    for cohort in repo.cohorts():
        code, course = cohort["code"], cohort.get("canvasCourseId")
        if course and course not in catalogs:
            catalogs.add(course)
            try:
                save_catalog(repo, course_catalog(client, course))
            except CanvasError as err:
                failures.append(f"{code}: catálogo do curso {course}: {err}")
        if course and course not in rosters:
            # Matrícula gravada a cada execução, com ou sem autoSync e mesmo que as notas não mudem
            # (integrity.py). Se o Canvas falhar, o ROSTER anterior fica como está.
            try:
                rosters[course] = course_students(client, course)
                save_roster(repo, course, rosters[course])
            except CanvasError as err:
                rosters[course] = err
                if not cohort.get("autoSync"):
                    failures.append(f"{code}: matrícula do curso {course}: {err}")
        if not cohort.get("autoSync") or not course:
            continue
        try:
            if isinstance(rosters[course], CanvasError):
                raise rosters[course]
            csv_text, count = course_csv(client, course, rosters[course])
            results[code] = sync_from_canvas(repo, code, csv_text, count)["status"]
        except (CanvasError, APIError, ValidationError, Conflict) as err:
            message = (err.message if isinstance(err, APIError) else
                       "Os dados da turma mudaram durante a atualização; nova tentativa na próxima execução."
                       if isinstance(err, Conflict) else str(err))
            if isinstance(err, (CanvasError, Conflict)):
                repo.put("COHORT#" + code, "SYNC", {"status": "failed", "message": message, "at": _now()})
            results[code] = "failed"
            failures.append(f"{code}: {message}")
    return results, failures


TOKEN_METRIC = "CanvasTokenDaysLeft"
NO_EXPIRY_DAYS = 3650


def token_days_left(client, now=None):
    """Dias até o token do Canvas expirar; um valor alto se ele não expira."""
    from datetime import datetime, timezone
    expires = token_expires_at(client)
    if expires is None:
        return NO_EXPIRY_DAYS
    now = now or datetime.now(timezone.utc)
    return max(0.0, round((datetime.fromisoformat(expires.replace("Z", "+00:00")) - now).total_seconds() / 86400, 2))


def report_token_expiry(client, cloudwatch, namespace):
    """Publica os dias restantes do token (alarme em canvas-sync.tf). Sem consulta ou sem
    métrica, o alarme também dispara por falta de dados: nunca interrompe a atualização."""
    try:
        days = token_days_left(client)
        cloudwatch.put_metric_data(Namespace=namespace, MetricData=[{"MetricName": TOKEN_METRIC, "Value": days, "Unit": "None"}])
        logging.info(json.dumps({"canvasTokenDaysLeft": days}))
    except Exception:
        logging.exception("Não foi possível conferir a validade do token do Canvas")


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def handler(event, context):
    client = CanvasClient(os.environ["CANVAS_BASE_URL"], read_token(os.environ["CANVAS_SECRET_ARN"]))
    results, failures = run(Repository(), client)
    import boto3
    report_token_expiry(client, boto3.client("cloudwatch"), os.environ["METRICS_NAMESPACE"])
    logging.info(json.dumps({"canvasSync": results}))
    if failures:
        raise RuntimeError("Falha na atualização pelo Canvas — " + "; ".join(failures))
    return {"results": results}

"""Lambda agendada (EventBridge Scheduler): atualiza as notas das turmas pela API do Canvas.

Só processa turmas com autoSync ligado e canvasCourseId configurado (Turmas e acessos →
Configurações). Falha de uma turma não impede as outras; ao final, qualquer falha faz a
execução terminar com erro, o que aciona o alarme do CloudWatch (canvas-sync.tf).
"""
import json
import logging
import os

from canvas import CanvasClient, CanvasError, course_csv
from portal import APIError, sync_from_canvas
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
    results, failures = {}, []
    for cohort in repo.cohorts():
        code, course = cohort["code"], cohort.get("canvasCourseId")
        if not cohort.get("autoSync") or not course:
            continue
        try:
            csv_text, count = course_csv(client, course)
            results[code] = sync_from_canvas(repo, code, csv_text, count)["status"]
        except (CanvasError, APIError, ValidationError, Conflict) as err:
            message = (err.message if isinstance(err, APIError) else
                       "Os dados da turma mudaram durante a atualização; tenta de novo na próxima execução."
                       if isinstance(err, Conflict) else str(err))
            if isinstance(err, (CanvasError, Conflict)):
                repo.put("COHORT#" + code, "SYNC", {"status": "failed", "message": message, "at": _now()})
            results[code] = "failed"
            failures.append(f"{code}: {message}")
    return results, failures


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def handler(event, context):
    client = CanvasClient(os.environ["CANVAS_BASE_URL"], read_token(os.environ["CANVAS_SECRET_ARN"]))
    results, failures = run(Repository(), client)
    logging.info(json.dumps({"canvasSync": results}))
    if failures:
        raise RuntimeError("Falha na atualização pelo Canvas — " + "; ".join(failures))
    return {"results": results}

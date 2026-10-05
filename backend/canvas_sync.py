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
from sync_runs import SyncRun, scheduled_context

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


def run(repo, client, event=None, clock=None):
    context = scheduled_context(event)
    results, failures, catalogs, rosters = {}, [], {}, {}
    for cohort in repo.cohorts():
        code, course = cohort["code"], cohort.get("canvasCourseId")
        proof = None
        if context and cohort.get("autoSync") and course:
            try:
                proof = SyncRun(repo, cohort, context, clock)
            except Conflict:
                results[code] = "failed"
                failures.append(f"{code}: tentativa agendada duplicada ou superada")
                continue
        if course and course not in catalogs:
            catalogs[course] = "succeeded"
            try:
                save_catalog(repo, course_catalog(client, course))
            except CanvasError as err:
                catalogs[course] = "failed"
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
        if proof:
            proof.stages.update(catalog=catalogs[course],
                                roster="failed" if isinstance(rosters[course], CanvasError) else "succeeded")
        try:
            if isinstance(rosters[course], CanvasError):
                raise rosters[course]
            csv_text, count = course_csv(client, course, rosters[course])
            if proof:
                results[code] = sync_from_canvas(repo, code, csv_text, count, sync_run=proof)["status"]
                if proof.record["status"] != "succeeded":
                    results[code] = "failed"
                    failures.append(f"{code}: execução agendada com etapa incompleta")
            else:
                results[code] = sync_from_canvas(repo, code, csv_text, count)["status"]
        except (CanvasError, APIError, ValidationError, Conflict) as err:
            message = (err.message if isinstance(err, APIError) else
                       "Os dados da turma mudaram durante a atualização; nova tentativa na próxima execução."
                       if isinstance(err, Conflict) else str(err))
            if isinstance(err, (CanvasError, Conflict)):
                repo.put("COHORT#" + code, "SYNC", {"status": "failed", "message": message, "at": _now()})
            results[code] = "failed"
            failures.append(f"{code}: {message}")
            if proof:
                try:
                    proof.fail()
                except Conflict:
                    # Uma tentativa mais nova substituiu a prova; a antiga não pode sobrescrevê-la.
                    pass
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
    from sync_runs import scheduler_event
    event = scheduler_event(event)
    client = CanvasClient(os.environ["CANVAS_BASE_URL"], read_token(os.environ["CANVAS_SECRET_ARN"]))
    results, failures = run(Repository(), client, event=event)
    import boto3
    report_token_expiry(client, boto3.client("cloudwatch"), os.environ["METRICS_NAMESPACE"])
    logging.info(json.dumps({"canvasSync": results}))
    if failures:
        raise RuntimeError("Falha na atualização pelo Canvas — " + "; ".join(failures))
    return {"results": results}

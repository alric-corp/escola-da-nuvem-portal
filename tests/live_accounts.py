"""Contas efêmeras para smoke test real. Sempre SUPPRESS: nenhum e-mail é enviado.

Executar setup/cleanup deliberadamente após um deploy. O contexto tem senhas e
deve permanecer fora do Git, com permissão 0600. Não imprime segredos.
"""
import argparse
import json
import hashlib
import re
import os
from pathlib import Path
import secrets
import uuid

import boto3


def save(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream)
    path.chmod(0o600)


ROLES = ("admin", "student1", "student2", "instructor")


def validate_context(context, account_id):
    """Valida tudo antes da primeira exclusão; prefixo SMOKE isolado não basta."""
    if (not re.fullmatch(r"[0-9]{12}", account_id)
            or context.get("accountId") != account_id
            or not re.fullmatch(r"[a-f0-9]{12}", context.get("run", ""))
            or context.get("cohort") != "SMOKE-" + context["run"].upper()
            or set(context.get("actors", {})) != set(ROLES)):
        raise ValueError("Contexto de teste ou conta inválidos.")
    for role, actor in context["actors"].items():
        domain = "escoladanuvem.org" if role == "instructor" else "example.test"
        expected = f"portal-smoke-{context['run']}-{role}@{domain}"
        if actor.get("username") != expected or any(actor.get(field) and not re.fullmatch(
                r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", actor[field])
                for field in ("sub", "cognitoUsername")):
            raise ValueError("Conta fora da identidade sintética deste teste.")
    output = context.get("output", {})
    for key in ("table_name", "imports_bucket", "user_pool_id"):
        if not isinstance(output.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", output[key]):
            raise ValueError("Recursos do contexto inválidos.")


def _rows(table, pk):
    from boto3.dynamodb.conditions import Key
    args, rows = {"KeyConditionExpression": Key("PK").eq(pk), "ConsistentRead": True}, []
    while True:
        result = table.query(**args)
        rows.extend(result.get("Items", []))
        if "LastEvaluatedKey" not in result:
            return rows
        args["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def _data(row):
    try:
        value = json.loads(row["data"])
    except (KeyError, ValueError, TypeError):
        raise ValueError("Registro sem conteúdo reconhecido; limpeza interrompida.") from None
    if not isinstance(value, dict):
        raise ValueError("Registro de teste inválido.")
    return value



def _original_identity(cognito, pool, actor):
    """Username canônico do pool email-only: nunca excluir pelo alias reutilizável.

    Um sub ausente não autoriza adotar a identidade agora encontrada. Se o nome
    original sumiu, a leitura do alias só detecta substituição; não retargeta delete.
    """
    identifier = actor.get("cognitoUsername") or actor["username"]
    try:
        user = cognito.admin_get_user(UserPoolId=pool, Username=identifier)
    except cognito.exceptions.UserNotFoundException:
        if identifier == actor["username"]:
            return None
        try:
            user = cognito.admin_get_user(UserPoolId=pool, Username=actor["username"])
        except cognito.exceptions.UserNotFoundException:
            return None
    attrs = {entry["Name"]: entry["Value"] for entry in user["UserAttributes"]}
    canonical = user.get("Username", "")
    if (not actor.get("sub") or attrs.get("sub") != actor["sub"]
            or attrs.get("email") != actor["username"]
            or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", canonical)
            or actor.get("cognitoUsername", canonical) != canonical):
        raise ValueError("Identidade Cognito diferente da original; contexto preservado para diagnóstico.")
    return canonical


def cleanup(context, session, account_id, persist=lambda data: None):
    """Reconcilia somente a unidade sintética. Não faz Scan nem altera markers globais.

    Uma falha mantém o arquivo de contexto. A repetição relê os alvos restantes,
    sem confiar em cursor antigo; exclusões comparam o conteúdo observado.
    """
    validate_context(context, account_id)
    if session.client("sts").get_caller_identity()["Account"] != account_id:
        raise ValueError("Conta AWS diferente da esperada.")
    output, code = context["output"], context["cohort"]
    cognito = session.client("cognito-idp")
    verified = set()
    for actor in context["actors"].values():
        canonical = _original_identity(cognito, output["user_pool_id"], actor)
        if canonical is not None:
            # Preserva o sub registrado pelo setup. O nome canônico é persistido
            # antes das exclusões para a mesma identidade ser usada na retomada.
            actor["cognitoUsername"] = canonical
            verified.add(actor["sub"])
    validate_context(context, account_id)
    persist(context)
    table = session.resource("dynamodb").Table(output["table_name"])
    pk = "COHORT#" + code
    actors = {a["sub"]: a for a in context["actors"].values() if a.get("sub")}
    rows = []
    for sub, actor in actors.items():
        for row in _rows(table, "USER#" + sub):
            if sub not in verified:
                raise ValueError("Conta ausente no Cognito ainda possui dados; conferir a identidade antes de limpar.")
            if row["SK"] not in ("STUDY#" + code, "TEACH#" + code) or _data(row).get("code") != code:
                raise ValueError("Conta sintética tem dados fora da turma deste teste.")
            rows.append(row)
        request = table.get_item(Key={"PK": "REQUESTS", "SK": sub}, ConsistentRead=True).get("Item")
        if request:
            if sub not in verified:
                raise ValueError("Solicitação sem identidade Cognito confirmada.")
            value = _data(request)
            if value.get("userId") != sub or value.get("email") != actor["username"]:
                raise ValueError("Solicitação incompatível com a conta sintética.")
            rows.append(request)
    cohort_rows = _rows(table, pk)
    if cohort_rows and len(verified) != len(ROLES):
        raise ValueError("Turma ainda possui dados sem todas as identidades sintéticas confirmadas.")
    for row in cohort_rows:
        value, sk = _data(row), row["SK"]
        if sk == "METADATA":
            if (value.get("code") != code or value.get("name") != "Teste temporário de implantação"
                    or value.get("canvasCourseId") or value.get("autoSync")):
                raise ValueError("Metadados não pertencem à turma sintética esperada.")
        elif sk.startswith(("DRAFT#", "PUB#")):
            if (value.get("cohort") != code or value.get("createdBy") != context["actors"]["admin"].get("sub")
                    or not str(value.get("snapshot", "")).startswith(f"cohorts/{code}/")):
                raise ValueError("Publicação fora do contexto sintético.")
        elif sk.startswith("OWNER#"):
            if value.get("userId") not in actors or value.get("email") != actors[value["userId"]]["username"]:
                raise ValueError("Vínculo de aluno fora do contexto sintético.")
        elif sk.startswith("TEACH#"):
            if value.get("userId") not in actors:
                raise ValueError("Vínculo de instrutor fora do contexto sintético.")
        elif sk.startswith("AUDIT#"):
            if value.get("by") not in actors:
                raise ValueError("Auditoria de outro usuário; limpeza interrompida.")
        elif not (sk in ("HISTORY_READY", "DISCOVERY_READY") or sk.startswith(("RECENT#", "PRIVACY#"))):
            raise ValueError("Registro não previsto na turma sintética; confira antes de limpar.")
        rows.append(row)
    derived_keys = [("COHORT_DIRECTORY", pk)]
    for actor in context["actors"].values():
        digest = hashlib.sha256(actor["username"].strip().lower().encode()).hexdigest()
        derived_keys.append(("DISCOVERY_EMAIL#" + digest, pk))
    for key_pk, key_sk in derived_keys:
        row = table.get_item(Key={"PK": key_pk, "SK": key_sk}, ConsistentRead=True).get("Item")
        if row:
            if _data(row) != {"code": code}:
                raise ValueError("Projeção derivada incompatível com a turma sintética.")
            rows.append(row)
    s3, prefix = session.client("s3"), f"cohorts/{code}/"
    batches = []
    for page in s3.get_paginator("list_object_versions").paginate(Bucket=output["imports_bucket"], Prefix=prefix):
        objects = [{"Key": item["Key"], "VersionId": item["VersionId"]}
                   for item in page.get("Versions", []) + page.get("DeleteMarkers", [])]
        if any(not item["Key"].startswith(prefix) for item in objects):
            raise ValueError("Objeto fora do prefixo sintético; limpeza interrompida.")
        if objects:
            batches.append(objects)
    # Todo o plano foi validado. Se um registro mudar, preservá-lo e parar;
    # nunca apagar o novo conteúdo com uma chave descoberta em leitura antiga.
    for row in rows:
        key = {"PK": row["PK"], "SK": row["SK"]}
        try:
            table.delete_item(Key=key, ConditionExpression="#data = :expected",
                              ExpressionAttributeNames={"#data": "data"},
                              ExpressionAttributeValues={":expected": row["data"]})
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            if table.get_item(Key=key, ConsistentRead=True).get("Item"):
                raise RuntimeError("Registro mudou durante a limpeza; contexto preservado para diagnóstico.") from None
    count = 0
    for objects in batches:
        result = s3.delete_objects(Bucket=output["imports_bucket"], Delete={"Objects": objects})
        if result.get("Errors"):
            raise RuntimeError("Falha ao remover objetos de teste. Execute cleanup novamente.")
        count += len(objects)
    if any(_rows(table, candidate) for candidate in [pk, *("USER#" + sub for sub in actors)]):
        raise RuntimeError("Surgiram registros durante a limpeza; pare o smoke e reconcilie novamente.")
    if any(table.get_item(Key={"PK": key_pk, "SK": key_sk}, ConsistentRead=True).get("Item")
           for key_pk, key_sk in derived_keys):
        raise RuntimeError("Referências sintéticas ainda presentes; reconcilie novamente.")
    for page in s3.get_paginator("list_object_versions").paginate(Bucket=output["imports_bucket"], Prefix=prefix):
        if page.get("Versions") or page.get("DeleteMarkers"):
            raise RuntimeError("Objetos sintéticos ainda presentes; pare o smoke e reconcilie novamente.")
    # Não revogar identidades antes de concluir as etapas que dependem delas.
    for actor in context["actors"].values():
        canonical = _original_identity(cognito, output["user_pool_id"], actor)
        if canonical is None:
            continue
        try:
            cognito.admin_delete_user(UserPoolId=output["user_pool_id"], Username=canonical)
        except cognito.exceptions.UserNotFoundException:
            # Uma remoção entre check/delete é aceitável somente se o alias não
            # passou a designar outra identidade. Nunca repete delete pelo e-mail.
            _original_identity(cognito, output["user_pool_id"], actor)
    return {"objectVersions": count, "records": len(rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["setup", "cleanup"])
    parser.add_argument("--context", type=Path, required=True)
    parser.add_argument("--outputs", type=Path)
    parser.add_argument("--account-id", required=True)
    args = parser.parse_args()
    session = boto3.Session(region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != args.account_id:
        raise SystemExit("Conta AWS diferente da esperada; operação cancelada.")
    cognito = session.client("cognito-idp")
    if args.action == "setup":
        if args.context.exists():
            raise SystemExit("O contexto já existe. Faça cleanup antes de iniciar outro teste.")
        output = {k: v["value"] for k, v in json.loads(args.outputs.read_text()).items()}
        run = uuid.uuid4().hex[:12]
        actors = {}
        for role in ("admin", "student1", "student2", "instructor"):
            domain = "escoladanuvem.org" if role == "instructor" else "example.test"
            actors[role] = {"username": f"portal-smoke-{run}-{role}@{domain}",
                            "password": secrets.token_urlsafe(28) + "aA1!"}
        context = {"run": run, "cohort": "SMOKE-" + run.upper(), "actors": actors, "output": output,
                   "accountId": args.account_id}
        save(args.context, context)
        for role, actor in actors.items():
            result = cognito.admin_create_user(UserPoolId=output["user_pool_id"], Username=actor["username"],
                MessageAction="SUPPRESS", UserAttributes=[{"Name":"email", "Value":actor["username"]},
                                                           {"Name":"email_verified", "Value":"true"}])
            actor["sub"] = next(a["Value"] for a in result["User"]["Attributes"] if a["Name"] == "sub")
            save(args.context, context)
            cognito.admin_set_user_password(UserPoolId=output["user_pool_id"], Username=actor["username"],
                                            Password=actor["password"], Permanent=True)
            if role == "admin":
                cognito.admin_add_user_to_group(UserPoolId=output["user_pool_id"], Username=actor["username"], GroupName="admin")
        print("Quatro contas sintéticas preparadas, sem envio de e-mail.")
        return

    context = json.loads(args.context.read_text())
    result = cleanup(context, session, args.account_id, persist=lambda data: save(args.context, data))
    # Só remove o contexto após todas as etapas; qualquer erro permite nova reconciliação.
    args.context.unlink()
    print(f"Contas, referências da turma sintética e {result['objectVersions']} versões de teste removidos.")


if __name__ == "__main__":
    main()

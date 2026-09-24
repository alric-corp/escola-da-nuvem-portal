"""Contas efêmeras para smoke test real. Sempre SUPPRESS: nenhum e-mail é enviado.

Executar setup/cleanup deliberadamente após um deploy. O contexto tem senhas e
deve permanecer fora do Git, com permissão 0600. Não imprime segredos.
"""
import argparse
import json
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
    if context["accountId"] != args.account_id or not context["cohort"].startswith("SMOKE-"):
        raise SystemExit("Contexto de teste inválido.")
    output = context["output"]
    db = session.resource("dynamodb").Table(output["table_name"])
    from boto3.dynamodb.conditions import Key
    for actor in context["actors"].values():
        if not actor["username"].startswith("portal-smoke-" + context["run"] + "-"):
            raise SystemExit("Nome fora do prefixo deste teste; cancelado.")
        if actor.get("sub"):
            delete_partition(db, "USER#" + actor["sub"], Key)
            db.delete_item(Key={"PK":"REQUESTS", "SK":actor["sub"]})
        try:
            cognito.admin_delete_user(UserPoolId=output["user_pool_id"], Username=actor["username"])
        except cognito.exceptions.UserNotFoundException:
            pass
    delete_partition(db, "COHORT#" + context["cohort"], Key)
    s3 = session.client("s3")
    count = 0
    for page in s3.get_paginator("list_object_versions").paginate(Bucket=output["imports_bucket"], Prefix=f"cohorts/{context['cohort']}/"):
        objects = [{"Key": o["Key"], "VersionId": o["VersionId"]} for o in page.get("Versions", []) + page.get("DeleteMarkers", [])]
        if objects:
            result = s3.delete_objects(Bucket=output["imports_bucket"], Delete={"Objects":objects})
            if result.get("Errors"):
                raise RuntimeError("Falha ao remover objetos de teste. Execute cleanup novamente.")
            count += len(objects)
    # O arquivo contém apenas segredos efêmeros que já foram revogados.
    args.context.unlink()
    print(f"Contas, vínculos, turma sintética e {count} versões de objetos de teste removidos.")


def delete_partition(table, pk, key_type):
    args = {"KeyConditionExpression":key_type("PK").eq(pk), "ConsistentRead":True}
    while True:
        result = table.query(**args)
        with table.batch_writer() as batch:
            for item in result["Items"]:
                batch.delete_item(Key={"PK":item["PK"], "SK":item["SK"]})
        if "LastEvaluatedKey" not in result:
            return
        args["ExclusiveStartKey"] = result["LastEvaluatedKey"]


if __name__ == "__main__":
    main()

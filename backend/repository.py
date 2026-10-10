"""Persistência AWS. Snapshots completos ficam privados no S3; DynamoDB guarda
turmas, vínculos e ponteiros de publicação, alterados por transação."""
import json
import os


class Conflict(Exception):
    pass


class Repository:
    def __init__(self):
        import boto3
        self.table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
        self.db = boto3.client("dynamodb")
        from botocore.config import Config
        # SigV4: presigned POST/GET dos anexos com as credenciais temporárias da Lambda e
        # validade explícita (X-Amz-Expires).
        self.s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
        self.bucket = os.environ["IMPORTS_BUCKET"]
        # Anexos do feedback: bucket próprio, privado (storage.tf). Só a identity usa.
        self.files_bucket = os.environ.get("FEEDBACK_BUCKET")

    @staticmethod
    def decode(item):
        if not item:
            return None
        if "data" in item:
            return json.loads(item["data"])
        return {"code": item["cohortCode"], "name": item["cohortCode"], "current": None, "_seed": True}

    def get(self, pk, sk):
        return self.decode(self.table.get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=True).get("Item"))

    def list(self, pk, prefix=""):
        from boto3.dynamodb.conditions import Key
        condition = Key("PK").eq(pk)
        if prefix:
            condition &= Key("SK").begins_with(prefix)
        args = {"KeyConditionExpression": condition, "ConsistentRead": True}
        items = []
        while True:
            result = self.table.query(**args)
            items.extend(self.decode(i) for i in result["Items"])
            if "LastEvaluatedKey" not in result:
                return items
            args["ExclusiveStartKey"] = result["LastEvaluatedKey"]

    def page(self, pk, prefix, limit, after=None):
        """Uma página da partição do maior SK para o menor (com SK ordenável por data, do mais
        recente para o mais antigo), começando depois de `after` (SK exclusivo).
        Devolve ([(sk, dados)], fim_da_partição)."""
        from boto3.dynamodb.conditions import Key
        args = {"KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix),
                "ScanIndexForward": False, "Limit": limit, "ConsistentRead": True}
        if after:
            args["ExclusiveStartKey"] = {"PK": pk, "SK": after}
        result = self.table.query(**args)
        return [(i["SK"], self.decode(i)) for i in result["Items"]], "LastEvaluatedKey" not in result

    def counter(self, pk, sk):
        """Atributos numéricos de um item contador (gravado por `transaction(..., counters)`)."""
        item = self.table.get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=True).get("Item") or {}
        return {k: int(v) for k, v in item.items() if k not in ("PK", "SK", "data", "expiresAt")}

    def keys(self, pk, prefix):
        """Só as chaves de ordenação (SK) que começam com o prefixo, sem ler os dados."""
        from boto3.dynamodb.conditions import Key
        args = {"KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix),
                "ProjectionExpression": "SK", "ConsistentRead": True}
        keys = []
        while True:
            result = self.table.query(**args)
            keys.extend(i["SK"] for i in result["Items"])
            if "LastEvaluatedKey" not in result:
                return keys
            args["ExclusiveStartKey"] = result["LastEvaluatedKey"]

    def cohorts(self):
        from boto3.dynamodb.conditions import Attr
        args = {"FilterExpression": Attr("SK").eq("METADATA") & Attr("PK").begins_with("COHORT#"), "ConsistentRead": True}
        items = []
        while True:
            result = self.table.scan(**args)
            items.extend(self.decode(i) for i in result["Items"])
            if "LastEvaluatedKey" not in result:
                return sorted(items, key=lambda c: c["code"])
            args["ExclusiveStartKey"] = result["LastEvaluatedKey"]

    def put(self, pk, sk, data, absent=False, ttl_days=None):
        args = {"Item": {"PK": pk, "SK": sk, "data": self._encode(data)}}
        if ttl_days:
            # Atributo de TTL da tabela (storage.tf); o DynamoDB apaga o item depois dessa data.
            import time
            args["Item"]["expiresAt"] = int(time.time()) + ttl_days * 86400
        if absent:
            args["ConditionExpression"] = "attribute_not_exists(PK)"
        try:
            self.table.put_item(**args)
        except self.db.exceptions.ConditionalCheckFailedException:
            raise Conflict() from None

    @staticmethod
    def _encode(data):
        # sort_keys torna a serialização independente da ordem de construção do
        # dict em memória, para que a comparação de igualdade em `transaction`
        # não gere Conflict falso-positivo quando o mesmo conteúdo é montado
        # com chaves em ordens diferentes.
        return json.dumps(data, ensure_ascii=False, sort_keys=True)

    def _expected_data(self, pk, sk, expected):
        """Compare o snapshot lógico; condicione a transação aos bytes lidos.

        `data` é uma String DynamoDB, inclusive nos registros legados. Recriar
        essa string a partir do dict pode mudar só sua representação JSON.
        A leitura consistente não autoriza a escrita: #d = :old ainda rejeita
        qualquer mudança entre esta leitura e o commit atômico da transação.
        A mesma canonicalização dos writers preserva tipos (true != 1), todos
        os campos e seus valores; nunca substituir o esperado por dados novos.
        """
        item = self.table.get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=True).get("Item") or {}
        raw = item.get("data")
        if not isinstance(raw, str):
            raise Conflict()
        try:
            current = json.loads(raw)
        except (ValueError, TypeError):
            raise Conflict() from None
        if self._encode(current) != self._encode(expected):
            raise Conflict()
        return raw

    def transaction(self, writes, counters=(), checks=()):
        """Escritas atômicas. Cada escrita é (pk, sk, dados, esperado[, expiresAt]): dados None
        apaga; esperado None exige item inexistente, senão exige o item igual a `esperado`.
        Cada contador é (pk, sk, {atributo: incremento}, (atributo, máximo) | None, expiresAt | None):
        soma atômica, e com máximo só aplica se o atributo ainda estiver abaixo dele.
        checks: (pk, sk, esperado), condição de igualdade/ausência sem gravar o item."""
        actions = []
        for write in writes:
            pk, sk, data, expected = write[:4]
            expires_at = write[4] if len(write) > 4 else None
            action = {"TableName": self.table.name, "Item": {
                "PK": {"S": pk}, "SK": {"S": sk}, "data": {"S": self._encode(data)}},
                "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "#d = :old"}
            if expected is not None:
                action["ExpressionAttributeNames"] = {"#d": "data"}
            if expected is not None and expected.get("_seed"):
                action["ConditionExpression"] = "attribute_exists(PK) AND attribute_not_exists(#d)"
            elif expected is not None:
                action["ExpressionAttributeValues"] = {":old": {"S": self._expected_data(pk, sk, expected)}}
            if data is None:
                action["Key"] = {"PK": {"S": pk}, "SK": {"S": sk}}
                del action["Item"]
                actions.append({"Delete": action})
            else:
                if expires_at:
                    action["Item"]["expiresAt"] = {"N": str(int(expires_at))}
                actions.append({"Put": action})
        for pk, sk, expected in checks:
            check = {"TableName": self.table.name, "Key": {"PK": {"S": pk}, "SK": {"S": sk}},
                     "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "#d = :old"}
            if expected is not None:
                check["ExpressionAttributeNames"] = {"#d": "data"}
                if expected.get("_seed"):
                    check["ConditionExpression"] = "attribute_exists(PK) AND attribute_not_exists(#d)"
                else:
                    check["ExpressionAttributeValues"] = {":old": {"S": self._expected_data(pk, sk, expected)}}
            actions.append({"ConditionCheck": check})
        for pk, sk, deltas, limit, expires_at in counters:
            names = {f"#c{i}": name for i, name in enumerate(deltas)}
            values = {f":c{i}": {"N": str(int(delta))} for i, delta in enumerate(deltas.values())}
            expression = "ADD " + ", ".join(f"#c{i} :c{i}" for i in range(len(deltas)))
            if expires_at:
                expression += " SET expiresAt = :exp"
                values[":exp"] = {"N": str(int(expires_at))}
            action = {"TableName": self.table.name, "Key": {"PK": {"S": pk}, "SK": {"S": sk}},
                      "UpdateExpression": expression, "ExpressionAttributeNames": names, "ExpressionAttributeValues": values}
            if limit:
                names["#lim"], values[":max"] = limit[0], {"N": str(int(limit[1]))}
                action["ConditionExpression"] = "attribute_not_exists(#lim) OR #lim < :max"
            actions.append({"Update": action})
        try:
            self.db.transact_write_items(TransactItems=actions)
        except self.db.exceptions.TransactionCanceledException:
            raise Conflict() from None

    def snapshot(self, key, value=None, raw=False, status=None):
        if value is not None:
            body = value if raw else json.dumps(value, ensure_ascii=False)
            args = {"Bucket": self.bucket, "Key": key, "Body": body.encode("utf-8"),
                    "ContentType": "text/csv; charset=utf-8" if raw else "application/json",
                    "ServerSideEncryption": "AES256"}
            if status:
                args["Tagging"] = "portal-status=" + status
            self.s3.put_object(**args)
            return
        return json.loads(self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read())

    def mark(self, key, status):
        """Marca o arquivo para a regra de ciclo de vida do S3 (rascunho expira; publicado fica)."""
        self.s3.put_object_tagging(Bucket=self.bucket, Key=key,
                                   Tagging={"TagSet": [{"Key": "portal-status", "Value": status}]})

    # Arquivos do feedback. Chaves sempre montadas pelo backend (feedback.tmp_key/final_key).
    def presign_upload(self, key, content_type, max_bytes, expires):
        """Presigned POST: a política fixa a chave, o Content-Type e a faixa de tamanho."""
        return self.s3.generate_presigned_post(
            Bucket=self.files_bucket, Key=key, Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, max_bytes]], ExpiresIn=expires)

    def file_head(self, key):
        """{"size", "contentType"} do objeto, ou None se não existe (sem ListBucket o S3 responde 403)."""
        from botocore.exceptions import ClientError
        try:
            head = self.s3.head_object(Bucket=self.files_bucket, Key=key)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("404", "403", "NoSuchKey", "NotFound", "Forbidden"):
                return None
            raise
        return {"size": head["ContentLength"], "contentType": head.get("ContentType")}

    def file_start(self, key, length):
        return self.s3.get_object(Bucket=self.files_bucket, Key=key, Range=f"bytes=0-{length - 1}")["Body"].read()

    def promote_file(self, source, target, content_type):
        """Copia o arquivo validado para a chave final e devolve o VersionId da versão criada."""
        result = self.s3.copy_object(Bucket=self.files_bucket, Key=target, CopySource={"Bucket": self.files_bucket, "Key": source},
                                     ContentType=content_type, MetadataDirective="REPLACE", ServerSideEncryption="AES256")
        return result.get("VersionId")

    def delete_file(self, key, version_id=None):
        """Com VersionId, apaga só aquela versão (sem deixar marcador nem apagar versões anteriores)."""
        args = {"Bucket": self.files_bucket, "Key": key}
        if version_id:
            args["VersionId"] = version_id
        self.s3.delete_object(**args)

    def presign_download(self, key, content_type, disposition, expires):
        return self.s3.generate_presigned_url("get_object", ExpiresIn=expires, Params={
            "Bucket": self.files_bucket, "Key": key, "ResponseContentType": content_type,
            "ResponseContentDisposition": disposition})

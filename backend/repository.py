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
        self.s3 = boto3.client("s3")
        self.bucket = os.environ["IMPORTS_BUCKET"]

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

    def put(self, pk, sk, data, absent=False):
        args = {"Item": {"PK": pk, "SK": sk, "data": self._encode(data)}}
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

    def transaction(self, writes):
        actions = []
        for pk, sk, data, expected in writes:
            action = {"TableName": self.table.name, "Item": {
                "PK": {"S": pk}, "SK": {"S": sk}, "data": {"S": self._encode(data)}},
                "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "#d = :old"}
            if expected is not None:
                action["ExpressionAttributeNames"] = {"#d": "data"}
            if expected is not None and expected.get("_seed"):
                action["ConditionExpression"] = "attribute_exists(PK) AND attribute_not_exists(#d)"
            elif expected is not None:
                action["ExpressionAttributeValues"] = {":old": {"S": self._encode(expected)}}
            if data is None:
                action["Key"] = {"PK": {"S": pk}, "SK": {"S": sk}}
                del action["Item"]
                actions.append({"Delete": action})
            else:
                actions.append({"Put": action})
        try:
            self.db.transact_write_items(TransactItems=actions)
        except self.db.exceptions.TransactionCanceledException:
            raise Conflict() from None

    def snapshot(self, key, value=None, raw=False):
        if value is not None:
            body = value if raw else json.dumps(value, ensure_ascii=False)
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=body.encode("utf-8"),
                               ContentType="text/csv; charset=utf-8" if raw else "application/json", ServerSideEncryption="AES256")
            return
        return json.loads(self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read())

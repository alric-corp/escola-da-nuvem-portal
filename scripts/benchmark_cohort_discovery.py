"""AS-06: descoberta real (Repository + Moto), sem credenciais ou chamadas AWS.

Executar com o ambiente de requirements-dev.txt:
  python scripts/benchmark_cohort_discovery.py --output /tmp/cohorts.json

Moto demonstra operações e paginação, não latência/capacidade da AWS. O Limit
de 25 itens força páginas pequenas e reproduzíveis apenas neste experimento.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
from unittest.mock import patch

import boto3
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from portal import Portal
from repository import Repository

REFERENCE = "9097f5c7208be279aa85e007fe84d2f3e9c047e7"
ENV = {"AWS_DEFAULT_REGION": "us-east-1", "TABLE_NAME": "discovery-fixture",
       "IMPORTS_BUCKET": "discovery-fixture-imports"}


class CountedTable:
    """Conta o trabalho efetivamente devolvido pelo DynamoDB simulado."""
    def __init__(self, table, metrics, page_limit):
        self.table, self.metrics, self.page_limit = table, metrics, page_limit

    def __getattr__(self, name):
        return getattr(self.table, name)

    def read(self, method, **kwargs):
        assert kwargs.get("ConsistentRead") is True
        if method in ("scan", "query"):
            kwargs["Limit"] = self.page_limit
        response = getattr(self.table, method)(**kwargs)
        metric = self.metrics[method]
        metric["calls"] += 1
        metric["examined"] += response.get("ScannedCount", int("Item" in response))
        metric["returned"] += response.get("Count", int("Item" in response))
        # Payload de itens retornados, não bytes de fio nem capacidade faturada.
        payload = response.get("Items", response.get("Item"))
        metric["itemJsonBytes"] += len(json.dumps(payload, default=str).encode("utf-8"))
        return response

    def get_item(self, **kwargs):
        return self.read("get_item", **kwargs)

    def query(self, **kwargs):
        return self.read("query", **kwargs)

    def scan(self, **kwargs):
        return self.read("scan", **kwargs)


def reference_portal(revision=REFERENCE):
    """Carrega somente o Portal da revisão local; sem checkout ou rede."""
    source = subprocess.check_output(["git", "show", f"{revision}:backend/portal.py"], cwd=ROOT, text=True)
    spec = importlib.util.spec_from_loader("discovery_reference", loader=None)
    module = importlib.util.module_from_spec(spec)
    exec(compile(source, f"{revision}:backend/portal.py", "exec"), module.__dict__)
    return module.Portal


def create_fixture(cohorts=20, other_items=100, bindings=0, role="student"):
    """Somente dados fictícios: turmas vinculadas e adicionais por e-mail."""
    db = boto3.client("dynamodb", region_name="us-east-1")
    db.create_table(TableName=ENV["TABLE_NAME"],
                    KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
                    AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
                    BillingMode="PAY_PER_REQUEST")
    boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=ENV["IMPORTS_BUCKET"])
    repo = Repository()
    user = {"sub": "fixture", "email": "fixture@example.test", "groups": ["admin"] if role == "admin" else []}
    for index in range(cohorts):
        code, canvas_id = f"SYN{index:04}", str(1000 + index)
        published = index % 5 != 0 or index == cohorts - 1
        pub = f"pub-{index}" if published else None
        repo.put("COHORT#" + code, "METADATA", {"code": code, "name": "Turma fictícia " + str(index), "current": pub})
        if published:
            key = f"fixture/{code}/snapshot.json"
            repo.put("COHORT#" + code, "PUB#" + pub, {"id": pub, "snapshot": key})
            # Última turma é uma descoberta nova, mesmo para quem já tem vínculo.
            email = user["email"] if index % 2 == 0 or index == cohorts - 1 else "other@example.test"
            repo.snapshot(key, {"students": [{"id": canvas_id, "email": email}], "activities": []})
        if index < bindings:
            repo.put("USER#fixture", "STUDY#" + code, {"code": code, "canvasId": canvas_id})
        if role in ("instructor", "mixed") and index in (1, 5):
            repo.put("USER#fixture", "TEACH#" + code, {"code": code})
    # Vínculo antigo sem metadados não fabrica turma; OWNER alheio continua negando descoberta.
    repo.put("USER#fixture", "STUDY#REMOVED", {"code": "REMOVED", "canvasId": "999"})
    repo.put("COHORT#SYN0002", "OWNER#1002", {"userId": "another-fixture"})
    with repo.table.batch_writer() as writer:
        for index in range(other_items):
            writer.put_item(Item={"PK": f"NOISE#{index:05}", "SK": "FEEDBACK#fixture",
                                  "data": json.dumps({"description": "Somente massa sintética " + "x" * 100})})
    return repo, user


def measure(repo, user, portal_class=Portal, page_limit=25):
    metrics = {name: {"calls": 0, "examined": 0, "returned": 0, "itemJsonBytes": 0}
               for name in ("query", "get_item", "scan")}
    metrics["s3"] = {"calls": 0, "bodyBytes": 0}
    table, snapshot = repo.table, repo.snapshot

    def counted_snapshot(key):
        result = snapshot(key)
        metrics["s3"]["calls"] += 1
        metrics["s3"]["bodyBytes"] += len(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        return result

    with patch.object(repo, "table", CountedTable(table, metrics, page_limit)), patch.object(repo, "snapshot", counted_snapshot):
        start = time.perf_counter()
        result = portal_class(repo, user).dispatch("GET", "/cohorts", {})
        elapsed = (time.perf_counter() - start) * 1000
    return {"operations": metrics, "localMs": elapsed, "result": result}


def benchmark(samples):
    before = reference_portal()
    cases = []
    for cohorts, noise in ((5, 0), (25, 0), (25, 200), (25, 800), (50, 500)):
        for role, bindings in (("student", 0), ("student", 1), ("student", 4),
                               ("instructor", 0), ("mixed", 2), ("admin", 0)):
            with mock_aws(), patch.dict(os.environ, ENV):
                repo, user = create_fixture(cohorts, noise, bindings, role)
                observations = {"before": [], "after": []}
                for _ in range(samples):
                    for name, cls in (("before", before), ("after", Portal)):
                        observations[name].append(measure(repo, user, cls))
                expected = observations["before"][0]["result"]
                assert all(o["result"] == expected for group in observations.values() for o in group)
                case = {"cohorts": cohorts, "otherItems": noise, "role": role, "bindings": bindings,
                        "returnedCohorts": len(expected["cohorts"]), "equivalent": True}
                for name, values in observations.items():
                    assert all(v["operations"] == values[0]["operations"] for v in values)
                    timings = [round(v["localMs"], 3) for v in values]
                    case[name] = {"operations": values[0]["operations"], "samplesMs": timings,
                                  "medianMs": statistics.median(timings), "minMs": min(timings), "maxMs": max(timings)}
                cases.append(case)
    return {"reference": REFERENCE, "python": platform.python_version(), "platform": platform.platform(),
            "moto": __import__("moto").__version__, "pageLimit": 25, "samplesPerCase": samples,
            "method": "Mesmo fixture e Repository real; antes/depois alternados. Somente Moto, sem AWS. "
                      "Tempo local inclui emulação e não estima latência AWS. Bytes são JSON dos itens, não tráfego/capacidade.",
            "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=3)
    args = parser.parse_args()
    args.output.write_text(json.dumps(benchmark(args.samples), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)

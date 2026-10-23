"""Synthetic operation counts only: Moto is not an AWS latency/cost model.

python scripts/benchmark_derived_access.py --output /tmp/derived-access.json
No credentials/production traffic. Identical data, before/after, 3 local samples.
"""
import argparse
import json
from pathlib import Path
import platform
import statistics
import sys
from unittest.mock import patch
import os

from moto import mock_aws

from benchmark_cohort_discovery import ENV, create_fixture, measure, reference_portal

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import derived_access as access
from portal import Portal

REFERENCE = "142d4fa2150cece27cdc65a29f6b358dd3d9c6c3"


def benchmark(samples=3):
    before_portal = reference_portal(REFERENCE)
    cases = []
    for cohorts, noise in ((5, 0), (25, 200), (50, 800)):
        for role, bindings in (("student", 0), ("student", 1), ("mixed", 2), ("admin", 0)):
            with mock_aws(), patch.dict(os.environ, ENV):
                repo, user = create_fixture(cohorts, noise, bindings, role)
                # The old Repository did not read the new cutover marker.
                with patch.object(repo, "cohorts", side_effect=repo.legacy_cohorts):
                    before = [measure(repo, user, before_portal) for _ in range(samples)]
                access.migrate(repo, apply=True, history=False, cutover=True)
                after = [measure(repo, user, Portal) for _ in range(samples)]
                expected = before[0]["result"]
                assert all(o["result"] == expected for o in before + after)
                assert after[0]["operations"]["scan"]["calls"] == 0
                row = {"cohorts": cohorts, "noise": noise, "role": role, "bindings": bindings, "equivalent": True}
                for label, observations in (("before", before), ("after", after)):
                    values = [round(o["localMs"], 3) for o in observations]
                    row[label] = {"operations": observations[0]["operations"], "localSamplesMs": values,
                                  "medianMs": statistics.median(values), "minMs": min(values), "maxMs": max(values)}
                cases.append(row)
    history = []
    for count in (12, 100, 1000):
        with mock_aws(), patch.dict(os.environ, ENV):
            repo, _ = create_fixture(1, 0)
            pk = "COHORT#SYN0000"
            for index in range(count):
                row = {"id": f"hist-{index:05}", "publishedAt": f"2026-10-01T00:{index // 60:02}:{index % 60:02}+00:00"}
                # Replace impossible minutes for >=3600, outside this fixture.
                repo.put(pk, "PUB#" + row["id"], row)
            # Existing fixture has one unrelated current row without publishedAt;
            # use a separate cohort for chronological measurements.
            data = repo.list(pk, "PUB#")
            for publication in data:
                if "publishedAt" not in publication:
                    repo.table.delete_item(Key={"PK": pk, "SK": "PUB#" + publication["id"]})
            self_cohort = repo.get(pk, "METADATA")
            repo.put(pk, "METADATA", {**self_cohort, "current": None})
            table = repo.table
            from benchmark_cohort_discovery import CountedTable
            metrics = {name: {"calls": 0, "examined": 0, "returned": 0, "itemJsonBytes": 0}
                       for name in ("query", "get_item", "scan")}
            with patch.object(repo, "table", CountedTable(table, metrics, 25)):
                expected = sorted(repo.list(pk, "PUB#"), key=lambda p: p["publishedAt"], reverse=True)[:12]
            before = metrics
            access.migrate_cohort(repo, repo.get(pk, "METADATA"), apply=True, discovery=False)
            metrics = {name: {"calls": 0, "examined": 0, "returned": 0, "itemJsonBytes": 0}
                       for name in ("query", "get_item", "scan")}
            # Preserve the reader's remaining Limit; simulate byte-limited pages.
            class BoundedCountedTable(CountedTable):
                def read(self, method, **kwargs):
                    prior = self.page_limit
                    if method == "query":
                        self.page_limit = min(prior, kwargs.get("Limit", prior))
                    try:
                        return super().read(method, **kwargs)
                    finally:
                        self.page_limit = prior
            with patch.object(repo, "table", BoundedCountedTable(table, metrics, 5)):
                observed = access.recent_publications(repo, pk)
            assert observed == expected
            history.append({"publications": count, "before": before, "after": metrics, "equivalent": True})
    return {"reference": REFERENCE, "python": platform.python_version(), "platform": platform.platform(),
            "samples": samples, "method": "Moto; synthetic data. Item bytes are JSON, not billed bytes. Local wall clock is emulator time, not AWS latency.",
            "discovery": cases, "history": history}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", default=3, type=int)
    args = parser.parse_args()
    args.output.write_text(json.dumps(benchmark(args.samples), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)

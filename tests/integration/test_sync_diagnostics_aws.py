"""Leitura limitada e preservação das provas usando DynamoDB/S3 Moto, sem AWS real."""
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "backend"))
from canvas import CanvasClient, CanvasError
from canvas_sync import run
from portal import Portal, SYNC_USER
from repository import Repository
from test_canvas import BASE, FakeCanvas, course


@mock_aws
class SyncDiagnosticsPersistenceTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "TABLE_NAME": "diagnostics-test", "IMPORTS_BUCKET": "diagnostics-imports-test"})
        env.start()
        self.addCleanup(env.stop)
        boto3.client("dynamodb").create_table(TableName="diagnostics-test", BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}])
        boto3.client("s3").create_bucket(Bucket="diagnostics-imports-test")
        self.repo = Repository()
        self.repo.put("COHORT#FIC001", "METADATA", {"code": "FIC001", "current": None, "canvasCourseId": "4436", "autoSync": True})

    def execute(self, slot):
        event = {"source": "portal.scheduler", "type": "canvas-sync", "scheduledFor": slot, "executionId": "fake", "attemptNumber": 1}
        client = CanvasClient(BASE, "fake", opener=FakeCanvas({"4436": course()}))
        at = slot.replace(":00Z", ":30Z")
        with patch("portal.now", return_value=at), patch("canvas_sync._save_submissions"):
            return run(self.repo, client, event=event, clock=lambda: at)

    def report(self):
        return Portal(self.repo, SYNC_USER).dispatch("GET", "/cohorts/FIC001/report", {})

    def test_real_latest_query_is_bounded_and_does_not_change_old_proof_or_publication(self):
        self.execute("2026-10-20T09:00:00Z")
        before = self.report()
        previous = self.repo.get("COHORT#FIC001", "SYNC_RUN#2026-10-20T09:00:00Z")
        with patch("canvas_sync.course_catalog", side_effect=CanvasError("secret failure")):
            self.execute("2026-10-21T09:00:00Z")
        with patch.object(self.repo.table, "query", wraps=self.repo.table.query) as query:
            after = self.report()
        diagnostic_queries = [call.kwargs for call in query.call_args_list if "Limit" in call.kwargs]
        self.assertEqual(len(diagnostic_queries), 1)
        self.assertEqual(diagnostic_queries[0]["Limit"], 1)
        self.assertTrue(diagnostic_queries[0]["ConsistentRead"])
        self.assertFalse(diagnostic_queries[0]["ScanIndexForward"])
        self.assertEqual(after["canvasSyncDiagnostics"]["status"], "failed")
        self.assertEqual(after["canvasSyncDiagnostics"]["stages"]["grades"], "unchanged")
        self.assertEqual(after["updatedAt"], before["updatedAt"])
        self.assertEqual(after["history"], before["history"])
        self.assertEqual(self.repo.get("COHORT#FIC001", "SYNC_RUN#2026-10-20T09:00:00Z"), previous)
        self.execute("2026-10-22T09:00:00Z")
        self.assertEqual(self.report()["canvasSyncDiagnostics"]["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()

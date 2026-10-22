"""AS-06: contrato de descoberta e trabalho de leitura, sem tempos frágeis."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from moto import mock_aws

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from benchmark_cohort_discovery import ENV, create_fixture, measure, reference_portal
from portal import Portal


class CohortDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = staticmethod(reference_portal())

    def setUp(self):
        env = patch.dict(os.environ, ENV)
        env.start()
        self.addCleanup(env.stop)

    def test_same_authorized_result_and_fewer_reads_for_every_profile(self):
        # Cada subcaso tem sua tabela isolada. A comparação usa o Portal original
        # sobre o MESMO Repository e massa; não uma segunda lista de autorização.
        for role, bindings in (("student", 0), ("student", 1), ("student", 4),
                               ("instructor", 0), ("mixed", 2), ("admin", 0)):
            with self.subTest(role=role, bindings=bindings), mock_aws():
                repo, user = create_fixture(9, 40, bindings, role)
                before = measure(repo, user, self.reference, page_limit=2)
                after = measure(repo, user, Portal, page_limit=2)
                self.assertEqual(after["result"], before["result"])
                self.assertEqual(after["operations"]["scan"], before["operations"]["scan"])
                self.assertEqual(after["operations"]["s3"], before["operations"]["s3"])
                rows = {c["code"]: c for c in after["result"]["cohorts"]}
                self.assertIn("SYN0008", rows)  # nova turma descoberta por e-mail, com ou sem vínculos
                self.assertNotIn("REMOVED", rows)  # vínculo antigo não cria metadados
                self.assertEqual(list(rows), sorted(rows))
                self.assertTrue(all(not k.startswith("_") for c in rows.values() for k in c))
                if role == "admin":
                    self.assertEqual(len(rows), 9)
                    self.assertTrue(all(c["canTeach"] for c in rows.values()))
                    self.assertEqual(after["operations"]["query"]["calls"], 0)
                    self.assertGreater(before["operations"]["query"]["calls"], 0)
                else:
                    self.assertEqual(after["operations"]["query"], before["operations"]["query"])
                    # Some apenas o GetItem de STUDY já coberto pelo Query consistente;
                    # PUBLICATION, OWNER e os snapshots permanecem iguais.
                    self.assertLess(after["operations"]["get_item"]["calls"], before["operations"]["get_item"]["calls"])
                    if bindings < 3:
                        self.assertNotIn("SYN0002", rows)  # OWNER exclusivo de outra pessoa
                    if role in ("instructor", "mixed"):
                        self.assertTrue(rows["SYN0001"]["canTeach"])
                        self.assertTrue(rows["SYN0005"]["canTeach"])  # turma sem publicação
                        self.assertFalse(rows["SYN0008"]["canTeach"])  # mesmo usuário também aluno
                self.assertIn("REMOVED", {b["code"] for b in repo.list("USER#fixture", "STUDY#")})
                self.assertIsNone(repo.get("COHORT#SYN0008", "OWNER#1008"))  # descobrir não vincula

    @mock_aws
    def test_complete_scan_and_query_pagination_including_empty_filtered_pages(self):
        repo, user = create_fixture(9, 55, 4, "mixed")
        raw_count = len(repo.table.scan()["Items"])
        measured = measure(repo, user, Portal, page_limit=2)
        reads = measured["operations"]
        self.assertEqual(reads["scan"]["examined"], raw_count)
        self.assertEqual(reads["scan"]["returned"], 9)
        self.assertEqual(reads["scan"]["calls"], (raw_count + 1) // 2)
        self.assertEqual(reads["query"]["returned"], 7)  # cinco STUDY (um removido), dois TEACH
        self.assertEqual(reads["query"]["calls"], 4)
        self.assertIn("SYN0008", {c["code"] for c in measured["result"]["cohorts"]})
        # O custo de Scan cresce também com registros que o filtro não retorna.
        self.assertGreater(reads["scan"]["examined"], reads["scan"]["returned"])

    @mock_aws
    def test_revocation_grant_and_owner_are_rechecked_per_request(self):
        repo, user = create_fixture(9, 0, 1, "mixed")

        def discover(actor=user):
            return {c["code"]: c for c in Portal(repo, actor).dispatch("GET", "/cohorts", {})["cohorts"]}

        self.assertTrue(discover()["SYN0001"]["canTeach"])
        repo.table.delete_item(Key={"PK": "USER#fixture", "SK": "TEACH#SYN0001"})
        self.assertNotIn("SYN0001", discover())
        repo.put("USER#fixture", "TEACH#SYN0001", {"code": "SYN0001"})
        self.assertTrue(discover()["SYN0001"]["canTeach"])
        self.assertIn("SYN0008", discover())
        repo.put("COHORT#SYN0008", "OWNER#1008", {"userId": "other"})
        self.assertNotIn("SYN0008", discover())
        other = {"sub": "other", "email": "nobody@example.test", "groups": []}
        self.assertEqual(discover(other), {})

    @mock_aws
    def test_publications_missing_email_and_seed_contract_are_preserved(self):
        repo, user = create_fixture(5, 0, 1, "student")
        repo.table.put_item(Item={"PK": "COHORT#AAA", "SK": "METADATA", "cohortCode": "AAA"})
        # Sem publicação/e-mail não se inventa um vínculo; o admin vê também a seed.
        self.assertNotIn("AAA", {c["code"] for c in Portal(repo, user).dispatch("GET", "/cohorts", {})["cohorts"]})
        admin = {**user, "groups": ["admin"]}
        self.assertEqual(measure(repo, admin)["result"], measure(repo, admin, self.reference)["result"])
        row = measure(repo, admin)["result"]["cohorts"][0]
        self.assertEqual(row, {"code": "AAA", "name": "AAA", "current": None, "canTeach": True})


if __name__ == "__main__":
    unittest.main()

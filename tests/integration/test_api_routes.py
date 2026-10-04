"""C7.2.4.1: dispatchers públicos ↔ OpenAPI, sem importar runtime nem conectar à AWS.

A API-2 remove a lista manual HCL. Terraform valida seus próprios valores
avaliados em routes.tftest.hcl. Este teste amplia a comparação antiga de
operações de turma para todas as 35 operações e seus handlers.
"""
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "contracts"))
from backend_routes import extract  # stdlib AST, compartilhado com os testes Node


class GatewayContractTests(unittest.TestCase):
    def test_public_dispatchers_and_openapi_routes_match(self):
        result = subprocess.run(
            ["node", str(ROOT / "tests" / "contracts" / "openapi_routes.mjs")],
            check=True, capture_output=True, text=True, cwd=ROOT,
        )
        published = json.loads(result.stdout)
        actual = extract((ROOT / "backend" / "portal.py").read_text())
        key = lambda row: (row["method"], row["path"])
        self.assertEqual(len(published), 35)
        self.assertEqual(len(published), len({key(r) for r in published}))
        self.assertEqual(len(actual), len({key(r) for r in actual}))
        self.assertEqual(
            {key(r): r["handler"] for r in actual},
            {key(r): r["handler"] for r in published},
            "Backend público e OpenAPI devem coincidir, inclusive handler.",
        )
        self.assertIn(("POST", "/cohorts/{code}/participation"), {key(r) for r in actual})


if __name__ == "__main__":
    unittest.main()

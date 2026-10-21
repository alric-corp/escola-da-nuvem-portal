"""TODO 22: serializações equivalentes continuam tendo identidades de bytes distintas.

Só Git local, builders reais e validação offline. Não regenera contratos antigos,
não modifica manifestos publicados e não usa AWS nem a rede externa.
"""
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from release_fixtures import (BASELINE, MAIN_1, MAIN_2, ROOT, FakeGit, api_routes, block_network,
                              build, config, copy_app, fr)

WORK = APP = None
EQUIVALENT_BYTES = BUNDLE_BYTES = None
EQUIVALENT_API = BUNDLE_API = None
_restore = None


def setUpModule():
    global WORK, APP, EQUIVALENT_BYTES, BUNDLE_BYTES, EQUIVALENT_API, BUNDLE_API, _restore
    _restore = block_network()
    WORK = Path(tempfile.mkdtemp(prefix="release-openapi-"))
    BUNDLE_BYTES = (ROOT / "openapi/portal.yaml").read_bytes()
    # Fixture derivada do contrato atual: prova o hash bruto sem congelar a API na revisão da migração.
    EQUIVALENT_BYTES = b"# equivalent contract serialization fixture\n" + BUNDLE_BYTES
    APP = copy_app(WORK / "modern-bundle-only")
    build(APP, config())
    BUNDLE_API = api_routes(APP, WORK)
    (APP / "openapi/portal.yaml").write_bytes(EQUIVALENT_BYTES)
    EQUIVALENT_API = api_routes(APP, WORK)
    (APP / "openapi/portal.yaml").write_bytes(BUNDLE_BYTES)


def tearDownModule():
    shutil.rmtree(WORK, ignore_errors=True)
    _restore()


def document(path):
    result = subprocess.run([
        "node", "--input-type=module", "-e",
        "import {readFileSync} from 'node:fs'; import {parseContract} from './tests/contracts/openapi.mjs';"
        "console.log(JSON.stringify(parseContract(readFileSync(process.argv[1], 'utf8'))));",
        str(path),
    ], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def manifest(sha, api):
    return fr.build_release("modern", sha, APP / "frontend/dist", APP / "scripts/build_frontend.py", api)[0]


class OpenApiReleaseCompatibilityTests(unittest.TestCase):
    def test_equivalent_serializations_have_the_same_document_but_different_raw_bytes(self):
        equivalent = WORK / "equivalent-openapi.yaml"
        equivalent.write_bytes(EQUIVALENT_BYTES)
        self.assertEqual(document(equivalent), document(APP / "openapi/portal.yaml"))
        self.assertNotEqual(EQUIVALENT_BYTES, BUNDLE_BYTES, "a fixture muda a serialização, não o contrato")

    def test_release_api_routes_hashes_source_bytes_instead_of_the_semantic_document(self):
        for result, source in ((EQUIVALENT_API, EQUIVALENT_BYTES), (BUNDLE_API, BUNDLE_BYTES)):
            with self.subTest(hash=result["openapi_sha256"]):
                self.assertEqual(result["openapi_sha256"], hashlib.sha256(source).hexdigest())
                self.assertEqual(result["contract_missing"], [])
        self.assertEqual(EQUIVALENT_API["routes"], BUNDLE_API["routes"])
        self.assertNotEqual(EQUIVALENT_API["openapi_sha256"], BUNDLE_API["openapi_sha256"])

    def test_bundle_only_copy_can_be_packaged_without_modular_sources(self):
        self.assertFalse((APP / "openapi/src").exists(), "o consumidor da release só precisa do bundle versionado")
        release = fr.build_release("modern", MAIN_2, APP / "frontend/dist", APP / "scripts/build_frontend.py", BUNDLE_API)
        release_dir = fr.write_release(WORK / "bundle-only-release", *release)
        loaded, _, _ = fr.load_release_dir(release_dir)
        self.assertEqual(loaded["api"]["openapi_sha256"], hashlib.sha256(BUNDLE_BYTES).hexdigest())
        self.assertEqual(loaded["api"]["routes"], BUNDLE_API["routes"])

    def test_rollback_between_equivalent_contracts_with_different_raw_hashes_still_requires_confirmation(self):
        target, active = manifest(MAIN_1, EQUIVALENT_API), manifest(MAIN_2, BUNDLE_API)
        before = (fr.pretty_json(target), fr.pretty_json(active))
        self.assertEqual(target["files"], active["files"], "mesmos assets: a migração é do contrato empacotado")
        self.assertEqual(target["api"]["routes"], active["api"]["routes"])
        for confirmation in ("", active["release_id"]):
            with self.subTest(confirmation=confirmation):
                problems = fr.rollback_problems(target, active, BASELINE, FakeGit(), confirmation)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("Contratos OpenAPI diferentes", problems[0])
        self.assertEqual(fr.rollback_problems(target, active, BASELINE, FakeGit(), target["release_id"]), [])
        self.assertEqual((fr.pretty_json(target), fr.pretty_json(active)), before, "a guarda não reescreve hashes históricos")

    def test_same_raw_contract_still_allows_rollback_without_extra_confirmation(self):
        target, active = manifest(MAIN_1, EQUIVALENT_API), manifest(MAIN_2, EQUIVALENT_API)
        self.assertEqual(fr.rollback_problems(target, active, BASELINE, FakeGit(), ""), [])


if __name__ == "__main__":
    unittest.main()

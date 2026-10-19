"""P-SC1: executa o instalador real com pip/venv e wheels sintéticos locais, sem AWS ou rede externa.

Uma marca simula o próximo passo de autenticação. Hash inválido ou dependência sem hash precisa interromper
o shell antes dessa marca e antes de disponibilizar o intérprete via GITHUB_PATH.
"""
import hashlib
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from release_fixtures import ROOT, child_env


def wheel(directory, name, requires=()):
    path = directory / f"{name}-0.0.1-py3-none-any.whl"
    info = f"{name}-0.0.1.dist-info"
    metadata = f"Metadata-Version: 2.1\nName: {name}\nVersion: 0.0.1\n"
    metadata += "".join(f"Requires-Dist: {requirement}\n" for requirement in requires)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(f"{name}/__init__.py", '__version__ = "0.0.1"\n')
        archive.writestr(f"{info}/METADATA", metadata)
        archive.writestr(f"{info}/WHEEL", "Wheel-Version: 1.0\nGenerator: P-SC1-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
        archive.writestr(f"{info}/RECORD", "")
    return path


def requirement(path, digest=None):
    name = path.name.split("-")[0]
    digest = digest or hashlib.sha256(path.read_bytes()).hexdigest()
    return f"{name} @ {path.as_uri()} --hash=sha256:{digest}\n"


class DeployDependenciesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            'import {readFileSync} from "node:fs"; import bundle from "playwright-core/lib/utilsBundle"; '
            'console.log(JSON.stringify(bundle.yaml.parse(readFileSync(process.argv[1], "utf8"))));',
            str(ROOT / ".github/actions/setup-deploy-python/action.yml"),
        ], cwd=ROOT, capture_output=True, text=True, check=True)
        cls.script = json.loads(result.stdout)["runs"]["steps"][-1]["run"]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="psc1-offline-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name).resolve()
        (self.work / ".github").mkdir()
        (self.work / "runner").mkdir()
        self.child = wheel(self.work, "psc1_child")
        self.parent = wheel(self.work, "psc1_parent", [f"psc1_child @ {self.child.as_uri()}"])
        self.lock = self.work / ".github/requirements-deploy.txt"
        self.lock.write_text(requirement(self.parent) + requirement(self.child), encoding="utf-8")
        self.path_file = self.work / "github-path"
        self.authenticated = self.work / "authenticated"

    def install(self, **extra):
        env = child_env(RUNNER_TEMP=str(self.work / "runner"), GITHUB_PATH=str(self.path_file), **extra)
        # bash -e também representa o shell padrão das composite actions. Nenhuma credencial real é emitida.
        script = self.script + '\nprintf "auth-step-reached" > authenticated\n'
        return subprocess.run(["bash", "-e", "-c", script], cwd=self.work, env=env,
                              capture_output=True, text=True, timeout=90)

    def assert_install_refused_before_authentication(self, result, reason):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(reason, result.stdout + result.stderr)
        self.assertFalse(self.authenticated.exists(), "falha de instalação não pode chegar à autenticação")
        self.assertFalse(self.path_file.exists(), "venv recusado não pode entrar no PATH dos próximos passos")

    def test_verified_wheels_use_a_fresh_isolated_venv_before_authentication(self):
        for _ in range(2):
            result = self.install()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        paths = self.path_file.read_text().splitlines()
        self.assertEqual(len(set(paths)), 2, "cada instalação precisa de um venv novo")
        for path in paths:
            result = subprocess.run([str(Path(path) / "python"), "-c",
                                     "import psc1_parent, psc1_child, sys; "
                                     "assert psc1_parent.__version__ == '0.0.1'; assert sys.prefix != sys.base_prefix"],
                                    env=child_env(), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("include-system-site-packages = false", (Path(path).parent / "pyvenv.cfg").read_text())
        self.assertTrue(self.authenticated.exists())

    def test_tampered_wheel_is_refused_before_authentication(self):
        with self.parent.open("ab") as stream:
            stream.write(b"tampered")
        self.assert_install_refused_before_authentication(self.install(), "DO NOT MATCH THE HASHES")

    def test_wrong_hash_in_lock_is_refused_before_authentication(self):
        self.lock.write_text(requirement(self.parent, "0" * 64) + requirement(self.child), encoding="utf-8")
        self.assert_install_refused_before_authentication(self.install(), "DO NOT MATCH THE HASHES")

    def test_unhashed_transitive_dependency_is_refused_before_authentication(self):
        self.lock.write_text(requirement(self.parent), encoding="utf-8")
        self.assert_install_refused_before_authentication(self.install(), "Hashes are required")

    def test_existing_aws_credentials_refuse_installation_without_exposing_the_value(self):
        for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            with self.subTest(key=key):
                result = self.install(**{key: "synthetic-credential-never-log"})
                self.assert_install_refused_before_authentication(result, "credenciais AWS já estão disponíveis")
                self.assertNotIn("synthetic-credential-never-log", result.stdout + result.stderr)
                self.assertEqual(list((self.work / "runner").iterdir()), [])

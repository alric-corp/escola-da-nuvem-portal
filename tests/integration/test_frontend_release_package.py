"""Pipeline do frontend: empacotamento e validação offline de releases (sem AWS e sem rede externa).

Builds reais: a árvore de trabalho (moderna, com D1) e a baseline C7.3 (1daab31) extraída com git archive.
O checkout não é alterado; os testes de CLI rodam num clone temporário com --shared.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from release_fixtures import (BASELINE, BASELINE_SHA, MAIN_1, ORIGIN, ROOT, SCRIPTS, api_routes, archive_baseline, block_network,
                              build, child_env, config, copy_app, fr, package)

_restore = None
WORK = None
MODERN = BASE = None


def setUpModule():
    global _restore, WORK, MODERN, BASE
    _restore = block_network()
    WORK = Path(tempfile.mkdtemp(prefix="release-package-"))
    MODERN = copy_app(WORK / "modern")
    build(MODERN, config("1"))
    BASE = archive_baseline(WORK / "baseline")
    build(BASE)


def tearDownModule():
    shutil.rmtree(WORK, ignore_errors=True)
    _restore()


def routes(app):
    return api_routes(app, WORK)


class NetworkGuardTests(unittest.TestCase):
    def test_external_network_is_blocked_during_the_suite(self):
        with self.assertRaises(OSError) as ctx:
            urllib.request.urlopen("https://example.com/", timeout=2)
        self.assertIn("bloqueada", str(ctx.exception))


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = routes(MODERN)
        cls.base_api = routes(BASE)

    def make(self, app=None, sha=MAIN_1, mode="modern", api=None):
        out = Path(tempfile.mkdtemp(dir=WORK))
        return package(mode, sha, app or MODERN, api or (self.base_api if mode == "baseline" else self.api), out)

    def manifest(self, release_dir):
        return json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))

    def test_build_is_deterministic_and_release_id_binds_revision_assets_config_and_manifest(self):
        first, again = self.make(), self.make()
        self.assertEqual(first.name, again.name)
        for name in ("manifest.json", "pointer.html", "app.js", "config.json"):
            self.assertEqual((first / name).read_bytes(), (again / name).read_bytes(), name)
        m = self.manifest(first)
        self.assertRegex(m["release_id"], r"^[0-9a-f]{12}-[0-9a-f]{12}$")
        self.assertEqual(m["release_id"][:12], MAIN_1[:12])
        core = {k: m[k] for k in ("schema", "mode", "source_sha", "builder_sha256", "files", "config", "document_relative", "api")}
        self.assertEqual(m["content_digest"], hashlib.sha256(fr.canonical_json(core)).hexdigest())
        # Outro commit, outra config, outro asset ou outras rotas: outro id.
        other_sha = self.make(sha="b2" * 20)
        self.assertNotEqual(other_sha.name, first.name)
        self.assertNotEqual(other_sha.name[13:], first.name[13:])
        app2 = copy_app(WORK / "modern-cfg2")
        build(app2, config("2"))
        cfg2 = self.make(app=app2)
        self.assertEqual(cfg2.name[:12], first.name[:12])
        self.assertNotEqual(cfg2.name, first.name)
        app3 = copy_app(WORK / "modern-asset")
        (app3 / "frontend" / "styles.css").write_bytes((app3 / "frontend" / "styles.css").read_bytes() + b"\n/* x */\n")
        build(app3, config("1"))
        self.assertNotEqual(self.make(app=app3).name, first.name)
        more = dict(self.api, routes=self.api["routes"] + ["GET /rota-nova"])
        self.assertNotEqual(self.make(api=more).name, first.name)

    def test_manifest_lists_every_asset_with_sha256_md5_mime_and_immutable_cache(self):
        release = self.make()
        m = self.manifest(release)
        files = {f["path"]: f for f in m["files"]}
        expected = sorted(set(fr.builder_files(MODERN / "scripts" / "build_frontend.py")) - {"index.html"} | {"config.json"})
        self.assertEqual(sorted(files), expected)
        self.assertNotIn("index.html", files)
        for rel, meta in files.items():
            data = (release / rel).read_bytes()
            self.assertEqual(meta["sha256"], hashlib.sha256(data).hexdigest(), rel)
            self.assertEqual(meta["md5"], hashlib.md5(data).hexdigest(), rel)  # noqa: S324 - ETag do S3
            self.assertEqual(meta["size"], len(data))
            self.assertEqual(meta["cache_control"], "public, max-age=31536000, immutable")
        self.assertEqual(files["app.js"]["content_type"], "text/javascript; charset=utf-8")
        self.assertEqual(files["styles.css"]["content_type"], "text/css; charset=utf-8")
        self.assertEqual(files["logo.png"]["content_type"], "image/png")
        self.assertEqual(files["config.json"]["content_type"], "application/json")
        self.assertEqual(m["config"]["keys"], sorted(config()))
        self.assertEqual(m["document_relative"], ["logo.png"])
        self.assertGreaterEqual(len(m["api"]["routes"]), 30)
        self.assertEqual(fr.validate_release(release, ORIGIN)["release_id"], release.name)

    def test_pointer_keeps_the_document_at_root_and_points_only_into_the_release(self):
        release = self.make()
        pointer = (release / "pointer.html").read_text(encoding="utf-8")
        rid = release.name
        for ref in (f'href="releases/{rid}/logo.png"', f'href="releases/{rid}/styles.css"', f'src="releases/{rid}/app.js"'):
            self.assertIn(ref, pointer)
        self.assertNotIn("<base", pointer)
        self.assertEqual(fr.pointer_release(pointer.encode()), rid)
        self.assertIsNone(fr.pointer_release((BASE / "frontend" / "dist" / "index.html").read_bytes()))
        with self.assertRaises(fr.ReleaseError):
            fr.make_pointer(b'<html><head></head><body><img src="extra.png"><link href="logo.png"><link href="styles.css">'
                            b'<script src="app.js"></script></body></html>', rid)
        with self.assertRaises(fr.ReleaseError):
            fr.make_pointer((release / "pointer.html").read_bytes(), "nao-e-um-id")

    def test_import_graph_static_dynamic_and_reexports_must_stay_inside_the_release(self):
        assets = {"app.js": b'import { a } from "./a.js";\nconst d = await import("./pages/d.js");\n', "a.js": b'export * from "./b.js";\n',
                  "b.js": b"export const a = 1;\n", "pages/d.js": b'import { a } from "../a.js";\n'}
        self.assertEqual(fr.import_graph_problems(assets), [])
        cases = {
            "cdn": b'import x from "https://cdn.example.test/x.js";\n',
            "nu": b'import x from "lodash";\n',
            "ausente": b'import { y } from "./nao-existe.js";\n',
            "fora": b'import { y } from "../../fora.js";\n',
            "expressao": b"const m = await import(`./pages/${name}.js`);\n",
        }
        for label, code in cases.items():
            with self.subTest(label):
                self.assertTrue(fr.import_graph_problems(dict(assets, **{"app.js": code})), label)

    def test_real_release_module_graph_is_closed_and_has_no_sensitive_data(self):
        _, assets, _ = fr.load_release_dir(self.make())
        self.assertEqual(fr.import_graph_problems(assets), [])
        self.assertEqual(fr.sensitive_problems(assets), [])
        self.assertEqual(fr.document_relative_refs(assets), {"logo.png"})
        leaked = dict(assets, **{"ui.js": assets["ui.js"] + b"\n// AKIA" + b"ABCDEFGHIJKLMNOP" + b"\n"})
        self.assertTrue(fr.sensitive_problems(leaked))

    def test_config_is_per_release_in_modern_and_from_root_in_baseline(self):
        _, assets, _ = fr.load_release_dir(self.make())
        self.assertEqual(fr.path_problems(assets, "modern"), [])
        old_fetch = assets["app.js"].replace(b'fetch(new URL("./config.json", import.meta.url)', b'fetch("./config.json"')
        self.assertNotEqual(old_fetch, assets["app.js"])
        self.assertTrue(fr.path_problems(dict(assets, **{"app.js": old_fetch}), "modern"))
        # Caminho absoluto: não é relativo ao documento, mas também não é a config da release (D1 exigida).
        absolute = assets["app.js"].replace(b'new URL("./config.json", import.meta.url)', b'"/config.json"')
        self.assertEqual(fr.document_relative_refs(dict(assets, **{"app.js": absolute})), {"logo.png"})
        self.assertIn("app.js moderno precisa carregar config.json relativo ao módulo (D1).",
                      fr.path_problems(dict(assets, **{"app.js": absolute}), "modern"))
        self.assertTrue(fr.path_problems(assets, "baseline"), "a baseline não pode usar a config por release")
        _, base_assets, _ = fr.load_release_dir(self.make(app=BASE, sha=BASELINE_SHA, mode="baseline"))
        self.assertNotIn("config.json", base_assets)
        self.assertEqual(fr.path_problems(base_assets, "baseline"), [])
        self.assertEqual(fr.document_relative_refs(base_assets), {"config.json", "logo.png"})

    def test_mime_and_dist_must_match_the_builder_exactly(self):
        dist = MODERN / "frontend" / "dist"
        files = fr.builder_files(MODERN / "scripts" / "build_frontend.py")
        self.assertEqual(len(fr.collect_assets(dist, "modern", files)), len(files))  # sem index.html, com config.json
        stale = WORK / "stale-dist"
        shutil.copytree(dist, stale)
        (stale / "pages" / "antigo.js").write_text("export {};\n")
        with self.assertRaisesRegex(fr.ReleaseError, "sobrando"):
            fr.collect_assets(stale, "modern", files)
        svg = WORK / "svg-dist"
        shutil.copytree(dist, svg)
        (svg / "icone.svg").write_text("<svg/>")
        with self.assertRaisesRegex(fr.ReleaseError, "MIME"):
            fr.collect_assets(svg, "modern", files + ["icone.svg"])
        tfvars = WORK / "tf-dist"
        shutil.copytree(dist, tfvars)
        (tfvars / "x.tfvars").write_text("a = 1")
        with self.assertRaises(fr.ReleaseError):
            fr.collect_assets(tfvars, "modern", files + ["x.tfvars"])

    def test_tampered_manifest_assets_or_extra_files_are_refused(self):
        def tampered(edit):
            release = self.make()
            edit(release)
            with self.assertRaises(fr.ReleaseError):
                fr.load_release_dir(release)

        def change_hash(release):
            m = self.manifest(release)
            m["files"][0]["sha256"] = "0" * 64
            (release / "manifest.json").write_bytes(fr.pretty_json(m))

        def change_asset(release):
            (release / "ui.js").write_bytes((release / "ui.js").read_bytes() + b"\n")

        def change_id(release):
            m = self.manifest(release)
            m["release_id"] = m["release_id"][:-1] + ("0" if m["release_id"][-1] != "0" else "1")
            (release / "manifest.json").write_bytes(fr.pretty_json(m))

        def extra_file(release):
            (release / "extra.js").write_text("export {};\n")

        def change_pointer(release):
            (release / "pointer.html").write_bytes((release / "pointer.html").read_bytes() + b"\n")

        for edit in (change_hash, change_asset, change_id, extra_file, change_pointer):
            with self.subTest(edit.__name__):
                tampered(edit)
        m = self.manifest(self.make())
        m["files"][0]["content_type"] = "text/html"
        self.assertTrue(fr.manifest_problems(m))

    def test_config_validation_requires_the_nine_keys_https_and_root_callbacks(self):
        self.assertEqual(fr.validate_config(config(), ORIGIN), config())
        broken = {
            "chave faltando": {k: v for k, v in config().items() if k != "region"},
            "chave extra": dict(config(), extra="x"),
            "callback fora da raiz": dict(config(), redirectUri=ORIGIN + "/releases/x/"),
            "logout de outra origem": dict(config(), logoutUri="https://outro.example.test/"),
            "api http": dict(config(), apiUrl="http://api1teste01.execute-api.us-east-1.amazonaws.com"),
            "api fora do execute-api": dict(config(), apiUrl="https://api.example.test"),
            "scopes sem portal/access": dict(config(), scopes=["openid"]),
        }
        for label, cfg in broken.items():
            with self.subTest(label), self.assertRaises(fr.ReleaseError):
                fr.validate_config(cfg, ORIGIN)
        for origin in ("http://portal.example.test", "https://portal.example.test/", "https://portal.example.test/x"):
            with self.subTest(origin), self.assertRaises(fr.ReleaseError):
                fr.validate_public_origin(origin)

    def test_config_change_against_the_published_config_requires_explicit_approval(self):
        release = self.make()
        fr.validate_release(release, ORIGIN, live_config=config("1"))
        with self.assertRaisesRegex(fr.ReleaseError, "aprovação explícita"):
            fr.validate_release(release, ORIGIN, live_config=config("9"))
        fr.validate_release(release, ORIGIN, live_config=config("9"), allow_config_change=True)


class BaselineTests(unittest.TestCase):
    """C7.3 (1daab31): a baseline reproduz byte a byte o que está publicado e preserva a config da raiz."""

    def test_baseline_build_matches_the_pinned_files_of_the_published_version(self):
        dist = BASE / "frontend" / "dist"
        for rel, meta in BASELINE["files"].items():
            data = (dist / rel).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), meta["sha256"], rel)
            self.assertEqual(hashlib.md5(data).hexdigest(), meta["md5"], rel)  # noqa: S324 - ETag do S3
        release = package("baseline", BASELINE_SHA, BASE, api_routes(BASE, WORK), Path(tempfile.mkdtemp(dir=WORK)))
        m = fr.validate_release(release, ORIGIN, baseline=BASELINE)
        self.assertEqual(m["mode"], "baseline")
        self.assertIsNone(m["config"])
        self.assertEqual(m["document_relative"], ["config.json", "logo.png"])
        self.assertEqual(len(m["files"]), 29)
        with self.assertRaisesRegex(fr.ReleaseError, "baseline.json"):
            fr.validate_release(release, ORIGIN)

    def test_a_baseline_with_any_divergent_file_is_refused(self):
        drifted = WORK / "baseline-drift"
        shutil.copytree(BASE, drifted, ignore=shutil.ignore_patterns("dist"))
        ui = drifted / "frontend" / "ui.js"
        ui.write_bytes(ui.read_bytes() + b"\n")
        build(drifted)
        release = package("baseline", BASELINE_SHA, drifted, api_routes(drifted, WORK), Path(tempfile.mkdtemp(dir=WORK)))
        with self.assertRaisesRegex(fr.ReleaseError, "Baseline diverge do publicado: ui.js"):
            fr.validate_release(release, ORIGIN, baseline=BASELINE)

    def test_live_equivalence_detects_any_divergent_published_file(self):
        dist = BASE / "frontend" / "dist"

        def fetch(url):
            return 200, {}, (dist / url[len(ORIGIN) + 1:]).read_bytes()
        self.assertEqual(fr.live_equivalence_problems(BASELINE, fetch, ORIGIN), [])

        def drifted(url):
            status, headers, body = fetch(url)
            return status, headers, body + b"\n" if url.endswith("/ui.js") else body
        self.assertEqual(len(fr.live_equivalence_problems(BASELINE, drifted, ORIGIN)), 1)

    def test_a_modern_release_cannot_pose_as_the_baseline(self):
        modern = package("modern", BASELINE_SHA, MODERN, api_routes(MODERN, WORK), Path(tempfile.mkdtemp(dir=WORK)))
        # Como moderna ela é válida; quem barra a troca é baseline_problems e, na ativação a partir do legado,
        # forward_problems (test_frontend_release_s3).
        self.assertEqual(fr.validate_release(modern, ORIGIN)["mode"], "modern")
        self.assertIn("A release não é a baseline fixada em baseline.json.", fr.baseline_problems(*fr.load_release_dir(modern), BASELINE))


class PublishedConfigTests(unittest.TestCase):
    """--check-live compara com a config da versão no ar, não com a /config.json da raiz depois da migração."""

    @classmethod
    def setUpClass(cls):
        cls.modern = package("modern", MAIN_1, MODERN, api_routes(MODERN, WORK), Path(tempfile.mkdtemp(dir=WORK)))
        cls.base = package("baseline", BASELINE_SHA, BASE, api_routes(BASE, WORK), Path(tempfile.mkdtemp(dir=WORK)))

    def site(self, active):
        """HTTPS público simulado: raiz com /config.json legada e as duas releases publicadas."""
        files = {"config.json": json.dumps(config("raiz")).encode(), "index.html": (BASE / "frontend" / "dist" / "index.html").read_bytes()}
        for release in (self.modern, self.base):
            for path in filter(Path.is_file, release.rglob("*")):
                files[f"releases/{release.name}/{path.relative_to(release).as_posix()}"] = path.read_bytes()
        if active:
            files["index.html"] = (active / "pointer.html").read_bytes()

        def fetch(url):
            key = url[len(ORIGIN) + 1:] or "index.html"
            return (200, {}, files[key]) if key in files else (403, {}, b"")
        return fetch

    def test_published_config_follows_the_active_release(self):
        self.assertEqual(fr.published_config(self.site(None), ORIGIN), (config("raiz"), "/config.json"))
        self.assertEqual(fr.published_config(self.site(self.base), ORIGIN), (config("raiz"), "/config.json"))
        self.assertEqual(fr.published_config(self.site(self.modern), ORIGIN),
                         (config("1"), f"/releases/{self.modern.name}/config.json"))
        with self.assertRaisesRegex(fr.ReleaseError, "index.html publicado"):
            fr.published_config(lambda url: (503, {}, b""), ORIGIN)

    def test_validate_cli_check_live_uses_the_active_config_and_requires_approval_to_change_it(self):
        spec = importlib.util.spec_from_file_location("validate_release_cli", SCRIPTS / "validate-release.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        args = ["--release-dir", str(self.modern), "--public-origin", ORIGIN, "--check-live"]
        # Sem GITHUB_STEP_SUMMARY/GITHUB_OUTPUT: na CI o resumo do próprio job não pode receber a saída do teste.
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": "", "GITHUB_OUTPUT": ""}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(args, fetch=self.site(self.modern))["release_id"], self.modern.name)
            with self.assertRaisesRegex(fr.ReleaseError, "aprovação explícita"):
                cli.main(args, fetch=self.site(self.base))
            self.assertEqual(cli.main(args + ["--allow-config-change"], fetch=self.site(self.base))["release_id"], self.modern.name)


class CommandLineTests(unittest.TestCase):
    """prepare-release.py e validate-release.py de ponta a ponta, num clone temporário com a árvore de trabalho."""

    @classmethod
    def setUpClass(cls):
        cls.clone = WORK / "clone"
        head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(["git", "clone", "--quiet", "--shared", "--no-checkout", str(ROOT), str(cls.clone)], check=True)
        subprocess.run(["git", "-C", str(cls.clone), "checkout", "--quiet", "--detach", head], check=True)
        listed = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                                capture_output=True, check=True).stdout.decode().split("\0")
        for rel in filter(None, listed):
            source = ROOT / rel
            if source.is_file():
                (cls.clone / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, cls.clone / rel)
        git = ["git", "-C", str(cls.clone), "-c", "user.name=Teste", "-c", "user.email=teste@example.test"]
        subprocess.run(git[:3] + ["add", "-A"], check=True)
        stamp = {"GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z"}
        subprocess.run(git + ["commit", "--quiet", "--allow-empty", "-m", "árvore de trabalho"], check=True, env=child_env(**stamp))
        cls.head = subprocess.run(git[:3] + ["rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        # Depois do commit: o parser YAML do contrato vem do Playwright já instalado no checkout.
        (cls.clone / "node_modules").symlink_to(ROOT / "node_modules")

    def run_script(self, name, *args, env=None):
        return subprocess.run([sys.executable, "-B", str(self.clone / ".github" / "scripts" / name), *args],
                              capture_output=True, text=True, env=env or child_env(), cwd=self.clone)

    def test_prepare_main_and_baseline_then_validate(self):
        out = WORK / "cli-releases"
        main = self.run_script("prepare-release.py", "--source", "main", "--repo", str(self.clone), "--work", str(WORK / "cli-main"),
                               "--out", str(out), "--public-origin", ORIGIN,
                               env=child_env(FRONTEND_CONFIG_JSON=json.dumps(config("1"))))
        self.assertEqual(main.returncode, 0, main.stderr)
        base = self.run_script("prepare-release.py", "--source", "baseline", "--repo", str(self.clone), "--work", str(WORK / "cli-base"),
                               "--out", str(out), "--public-origin", ORIGIN)
        self.assertEqual(base.returncode, 0, base.stderr)
        releases = {json.loads((d / "manifest.json").read_text())["mode"]: d for d in out.iterdir()}
        self.assertEqual(sorted(releases), ["baseline", "modern"])
        self.assertEqual(releases["modern"].name[:12], self.head[:12])
        self.assertEqual(releases["baseline"].name[:12], BASELINE_SHA[:12])
        for mode, release in releases.items():
            with self.subTest(mode):
                check = self.run_script("validate-release.py", "--release-dir", str(release), "--public-origin", ORIGIN)
                self.assertEqual(check.returncode, 0, check.stderr)
        # O build rodou no clone: o dist do checkout real não recebeu a config do teste.
        real = ROOT / "frontend" / "dist" / "config.json"
        self.assertTrue((self.clone / "frontend" / "dist" / "config.json").exists())
        self.assertFalse(real.exists() and json.loads(real.read_text()) == config("1"))

    def test_prepare_refuses_invalid_config_and_a_checkout_other_than_the_run_commit(self):
        bad = self.run_script("prepare-release.py", "--source", "main", "--repo", str(self.clone), "--work", str(WORK / "cli-bad"),
                              "--out", str(WORK / "cli-bad-out"), "--public-origin", ORIGIN,
                              env=child_env(FRONTEND_CONFIG_JSON=json.dumps(dict(config(), redirectUri="https://outro.example.test/"))))
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("redirectUri", bad.stderr)
        other = self.run_script("prepare-release.py", "--source", "main", "--repo", str(self.clone), "--work", str(WORK / "cli-sha"),
                                "--out", str(WORK / "cli-sha-out"), "--public-origin", ORIGIN,
                                env=child_env(FRONTEND_CONFIG_JSON=json.dumps(config()), GITHUB_SHA="f" * 40))
        self.assertNotEqual(other.returncode, 0)
        self.assertIn("commit desta execução", other.stderr)
        missing = self.run_script("prepare-release.py", "--source", "main", "--repo", str(self.clone), "--work", str(WORK / "cli-nocfg"),
                                  "--out", str(WORK / "cli-nocfg-out"), "--public-origin", ORIGIN)
        self.assertNotEqual(missing.returncode, 0)

    def test_validate_cli_reports_tampering_without_traceback(self):
        out = WORK / "cli-tamper"
        prep = self.run_script("prepare-release.py", "--source", "main", "--repo", str(self.clone), "--work", str(WORK / "cli-tamper-w"),
                               "--out", str(out), "--public-origin", ORIGIN, env=child_env(FRONTEND_CONFIG_JSON=json.dumps(config())))
        self.assertEqual(prep.returncode, 0, prep.stderr)
        release = next(out.iterdir())
        (release / "app.js").write_bytes((release / "app.js").read_bytes() + b"\n")
        check = self.run_script("validate-release.py", "--release-dir", str(release), "--public-origin", ORIGIN)
        self.assertEqual(check.returncode, 1)
        self.assertIn("diverge do manifesto", check.stderr)
        self.assertNotIn("Traceback", check.stderr)


if __name__ == "__main__":
    unittest.main()

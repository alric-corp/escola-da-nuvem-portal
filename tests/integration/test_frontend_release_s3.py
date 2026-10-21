"""Pipeline do frontend: publicação, ativação e rollback contra S3 e CloudFront do moto (sem AWS real nem rede).

O moto aplica If-None-Match e If-Match (412), como o S3. A policy IAM da role (Deny sem os headers) não é avaliada
pelo moto: ela é provada no terraform test do bootstrap e no Access Analyzer; aqui o espião prova que os scripts
sempre enviam os headers, e o Stubber simula o AccessDenied.
"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from botocore.stub import Stubber
from moto import mock_aws

from release_fixtures import (BASELINE, BASELINE_SHA, BUCKET, MAIN_1, MAIN_2, OFF_MAIN, ORIGIN, PRE_FLOOR, REGION, FakeGit, Spy,
                              api_routes, archive_baseline, block_network, build, config, copy_app, create_distribution, fr,
                              package, put_legacy, s3_fetch)

_restore = None
WORK = None
R = {}  # releases preparadas uma vez: nome → diretório


def setUpModule():
    global _restore, WORK
    _restore = block_network()
    WORK = Path(tempfile.mkdtemp(prefix="release-s3-"))
    base = archive_baseline(WORK / "baseline")
    build(base)
    base_api = api_routes(base, WORK)
    apps = {}
    for marker in ("1", "2", "3"):
        apps[marker] = copy_app(WORK / f"modern-{marker}")
        build(apps[marker], config(marker))
    api = api_routes(apps["1"], WORK)
    out = WORK / "releases"
    R["legacy_dist"] = base / "frontend" / "dist"
    R["baseline"] = package("baseline", BASELINE_SHA, base, base_api, out)
    R["m1"] = package("modern", MAIN_1, apps["1"], api, out)
    R["m2"] = package("modern", MAIN_2, apps["2"], api, out)
    R["m1_config3"] = package("modern", MAIN_1, apps["3"], api, out)          # mesmo commit, outra config
    R["pre_floor"] = package("modern", PRE_FLOOR, apps["1"], api, out)
    R["off_main"] = package("modern", OFF_MAIN, apps["1"], api, out)
    R["m2_new_route"] = package("modern", MAIN_2, apps["3"], dict(api, routes=api["routes"] + ["GET /rota-nova"]), out)
    R["m2_new_contract"] = package("modern", MAIN_2, apps["2"], dict(api, openapi_sha256="f" * 64), out)


def tearDownModule():
    shutil.rmtree(WORK, ignore_errors=True)
    _restore()


def rid(name):
    return R[name].name


@mock_aws
class ReleaseS3Tests(unittest.TestCase):
    def setUp(self):
        self.s3 = boto3.client("s3", region_name=REGION)
        self.s3.create_bucket(Bucket=BUCKET)
        self.s3.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})
        self.cloudfront = boto3.client("cloudfront", region_name=REGION)
        self.distribution = create_distribution(self.cloudfront)
        put_legacy(self.s3, R["legacy_dist"], config("raiz"))
        self.git = FakeGit()
        self.logs = []

    # ------------------------------------------------------------ utilidades

    def publish(self, name, s3=None):
        return fr.publish_release(s3 or self.s3, BUCKET, R[name], log=self.logs.append, approve=lambda *snapshot: None)

    def activate(self, name, mode="activate", s3=None, fetch=None, cloudfront=None, **kwargs):
        kwargs.setdefault("caller_reference", f"{rid(name)}-teste-{len(self.logs)}")
        return fr.activate_release(s3 or self.s3, cloudfront or self.cloudfront, bucket=BUCKET, distribution_id=self.distribution,
                                   release_id=rid(name), public_origin=ORIGIN, baseline=BASELINE, git=self.git,
                                   fetch=fetch or s3_fetch(self.s3), mode=mode, sleep=lambda s: None, smoke_wait=0,
                                   log=self.logs.append, **kwargs)

    def index(self):
        obj = self.s3.get_object(Bucket=BUCKET, Key="index.html")
        return obj["ETag"], obj["Body"].read()

    def keys(self, prefix=""):
        pages = self.s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix)
        return sorted(o["Key"] for page in pages for o in page.get("Contents", []))

    def invalidations(self):
        items = self.cloudfront.list_invalidations(DistributionId=self.distribution)["InvalidationList"].get("Items", [])
        return [self.cloudfront.get_invalidation(DistributionId=self.distribution, Id=i["Id"])["Invalidation"] for i in items]

    def legacy_up_to_baseline(self):
        self.publish("baseline")
        return self.activate("baseline", expected_active="legacy")

    # ------------------------------------------------------------ publicação

    def test_publish_sends_every_object_with_if_none_match_and_manifest_last(self):
        spy = Spy(self.s3)
        result = self.publish("m1", s3=spy)
        m = json.loads((R["m1"] / "manifest.json").read_text())
        self.assertEqual(result, {"release_id": rid("m1"), "created": len(m["files"]) + 2, "identical": 0})
        self.assertTrue(all(call.get("IfNoneMatch") == "*" and "IfMatch" not in call for call in spy.puts))
        self.assertTrue(all(call["Key"].startswith(f"releases/{rid('m1')}/") for call in spy.puts))
        self.assertEqual([c["Key"].rsplit("/", 1)[1] for c in spy.puts[-2:]], ["pointer.html", "manifest.json"])
        self.assertTrue(all(call.get("ContentMD5") for call in spy.puts))
        head = self.s3.head_object(Bucket=BUCKET, Key=f"releases/{rid('m1')}/app.js")
        self.assertEqual(head["ContentType"], "text/javascript; charset=utf-8")
        self.assertEqual(head["CacheControl"], "public, max-age=31536000, immutable")
        for name, mime in (("normativa-abono-faltas.pdf", "application/pdf"),
                           ("aula-inaugural-regras-curso.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")):
            rel = "documents/" + name
            document = self.s3.get_object(Bucket=BUCKET, Key=f"releases/{rid('m1')}/{rel}")
            self.assertEqual(document["ContentType"], mime)
            self.assertEqual(document["CacheControl"], fr.IMMUTABLE)
            self.assertEqual(document["Body"].read(), (R["m1"] / rel).read_bytes())
        self.assertEqual(fr.verify_remote_release(self.s3, BUCKET, rid("m1"))["release_id"], rid("m1"))
        self.assertEqual(self.index()[1], (R["legacy_dist"] / "index.html").read_bytes(), "publicar não ativa")

    def test_publish_is_idempotent_and_preserves_every_release(self):
        self.publish("m1")
        before = self.keys("releases/")
        again = self.publish("m1")
        self.assertEqual((again["created"], again["identical"]), (0, len(before)))
        self.publish("m2")
        self.assertTrue(set(before) < set(self.keys("releases/")), "releases anteriores continuam publicadas")
        versions = self.s3.list_object_versions(Bucket=BUCKET, Prefix=f"releases/{rid('m1')}/").get("Versions", [])
        self.assertEqual(len(versions), len(before), "nenhuma versão nova: nada foi sobrescrito")

    def test_same_id_with_different_content_is_a_conflict_and_nothing_is_overwritten(self):
        key = f"releases/{rid('m1')}/ui.js"
        self.s3.put_object(Bucket=BUCKET, Key=key, Body=b"// outro conteudo\n", ContentType="text/javascript; charset=utf-8")
        with self.assertRaisesRegex(fr.ReleaseError, "Conflito"):
            self.publish("m1")
        self.assertEqual(self.s3.get_object(Bucket=BUCKET, Key=key)["Body"].read(), b"// outro conteudo\n")
        self.assertNotIn(f"releases/{rid('m1')}/manifest.json", self.keys())

    def test_partial_upload_leaves_no_activatable_release_and_a_rerun_completes_it(self):
        calls = {"n": 0}

        def flaky(kwargs):
            calls["n"] += 1
            if calls["n"] == 5:
                raise ClientError({"Error": {"Code": "InternalError", "Message": "falha simulada"}}, "PutObject")
        with self.assertRaisesRegex(fr.ReleaseError, "InternalError"):
            self.publish("baseline", s3=Spy(self.s3, before_put=flaky))
        self.assertNotIn(f"releases/{rid('baseline')}/manifest.json", self.keys())
        etag = self.index()[0]
        with self.assertRaisesRegex(fr.ReleaseError, "sem manifesto"):
            self.activate("baseline")
        self.assertEqual(self.index()[0], etag)
        self.assertEqual(self.invalidations(), [])
        result = self.publish("baseline")
        self.assertEqual(result["identical"], 4)
        self.assertEqual(self.activate("baseline")["release_id"], rid("baseline"))

    def test_access_denied_on_publish_is_a_failure_never_a_retry_without_condition(self):
        stub = Stubber(self.s3)
        stub.add_client_error("put_object", service_error_code="AccessDenied", http_status_code=403)
        with stub, self.assertRaisesRegex(fr.ReleaseError, "AccessDenied"):
            self.publish("m1")
        stub.assert_no_pending_responses()

    def test_unauthorized_or_missing_bucket_fails_closed(self):
        with self.assertRaisesRegex(fr.ReleaseError, "NoSuchBucket"):
            fr.publish_release(self.s3, "outro-bucket-nao-autorizado", R["m1"], approve=lambda *snapshot: None)
        stub = Stubber(self.s3)
        stub.add_client_error("get_object", service_error_code="AccessDenied", http_status_code=403)
        with stub, self.assertRaises(ClientError):
            fr.read_active(self.s3, BUCKET)

    # ------------------------------------------------------------ ativação

    def test_first_activation_from_legacy_is_only_the_pinned_baseline(self):
        for name in ("m1", "baseline"):
            self.publish(name)
        etag, body = self.index()
        with self.assertRaisesRegex(fr.ReleaseError, "baseline fixada"):
            self.activate("m1")
        self.assertEqual(self.index(), (etag, body))
        self.assertEqual(self.invalidations(), [])
        record = self.activate("baseline", expected_active="legacy")
        self.assertEqual((record["release_id"], record["previous_release"], record["changed"], record["smoke"]),
                         (rid("baseline"), "legacy", True, "ok"))
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("baseline"))
        # A raiz legada continua lá: /config.json (lido pela baseline), logo.png e os assets planos.
        for key in ("config.json", "logo.png", "app.js", "pages/student.js"):
            self.assertIn(key, self.keys())

    def test_activation_from_a_changed_legacy_index_is_refused(self):
        self.publish("baseline")
        self.s3.put_object(Bucket=BUCKET, Key="index.html", Body=b"<html>alterado</html>", ContentType="text/html; charset=utf-8")
        with self.assertRaisesRegex(fr.ReleaseError, "legado publicado"):
            self.activate("baseline")

    def test_activation_writes_only_the_pointer_with_if_match_and_invalidates_only_root_paths(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        before = self.keys()
        etag = self.index()[0]
        spy = Spy(self.s3)
        record = self.activate("m1", s3=spy, expected_active=rid("baseline"))
        self.assertEqual(len(spy.puts), 1)
        put = spy.puts[0]
        self.assertEqual((put["Key"], put["IfMatch"], put["CacheControl"], put["ContentType"]),
                         ("index.html", etag, "no-cache", "text/html; charset=utf-8"))
        self.assertNotIn("IfNoneMatch", put)
        self.assertEqual(self.keys(), before, "nenhum objeto criado ou removido além da reescrita do ponteiro")
        ours = [i for i in self.invalidations() if i["Id"] == record["invalidation_id"]]
        self.assertEqual(len(ours), 1)
        self.assertEqual(sorted(ours[0]["InvalidationBatch"]["Paths"]["Items"]), ["/", "/index.html"])
        self.assertTrue(all(sorted(i["InvalidationBatch"]["Paths"]["Items"]) == ["/", "/index.html"] for i in self.invalidations()))
        self.assertEqual(record["previous_release"], rid("baseline"))
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m1"))

    def test_activating_the_active_release_again_does_not_rewrite_the_index(self):
        self.legacy_up_to_baseline()
        etag = self.index()[0]
        spy = Spy(self.s3)
        record = self.activate("baseline", s3=spy)
        self.assertEqual((record["changed"], spy.puts), (False, []))
        self.assertEqual(self.index()[0], etag)

    def test_wrong_expected_active_changes_nothing(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        etag = self.index()[0]
        with self.assertRaisesRegex(fr.ReleaseError, "nada foi alterado"):
            self.activate("m1", expected_active="legacy")
        self.assertEqual(self.index()[0], etag)

    def test_race_on_the_index_is_detected_by_if_match_and_the_concurrent_write_survives(self):
        self.legacy_up_to_baseline()
        self.publish("m1")

        def concurrent(kwargs):
            if kwargs["Key"] == "index.html":
                self.s3.put_object(Bucket=BUCKET, Key="index.html", Body=b"<html>outra execucao</html>",
                                   ContentType="text/html; charset=utf-8")
        with self.assertRaisesRegex(fr.ReleaseError, "corrida"):
            self.activate("m1", s3=Spy(self.s3, before_put=concurrent))
        self.assertEqual(self.index()[1], b"<html>outra execucao</html>")

    def test_wrong_or_missing_if_match_is_rejected_by_s3(self):
        with self.assertRaises(ClientError) as ctx:
            self.s3.put_object(Bucket=BUCKET, Key="index.html", Body=b"x", IfMatch='"00000000000000000000000000000000"')
        self.assertTrue(fr._is_precondition(ctx.exception))
        with self.assertRaises(ClientError) as ctx:
            self.s3.put_object(Bucket=BUCKET, Key="index.html", Body=b"x", IfNoneMatch="*")
        self.assertTrue(fr._is_precondition(ctx.exception))
        self.assertEqual(self.index()[1], (R["legacy_dist"] / "index.html").read_bytes())

    def test_failure_before_the_index_write_changes_nothing(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        etag = self.index()[0]
        cases = {
            "asset ausente": lambda: self.s3.delete_object(Bucket=BUCKET, Key=f"releases/{rid('m1')}/pages/student.js"),
            "asset trocado": lambda: self.s3.put_object(Bucket=BUCKET, Key=f"releases/{rid('m1')}/ui.js", Body=b"//",
                                                        ContentType="text/javascript; charset=utf-8",
                                                        CacheControl="public, max-age=31536000, immutable"),
            "manifesto adulterado": lambda: self.s3.put_object(
                Bucket=BUCKET, Key=f"releases/{rid('m1')}/manifest.json", ContentType="application/json",
                Body=(R["m1"] / "manifest.json").read_bytes().replace(b'"size": ', b'"size": 1', 1)),
        }
        for label, damage in cases.items():
            with self.subTest(label):
                self.s3.delete_objects(Bucket=BUCKET, Delete={"Objects": [{"Key": k} for k in self.keys(f"releases/{rid('m1')}/")]})
                self.publish("m1")
                damage()
                with self.assertRaises(fr.ReleaseError) as ctx:
                    self.activate("m1")
                self.assertNotIsInstance(ctx.exception, fr.PostActivationError)
                self.assertEqual(self.index()[0], etag)
        self.assertEqual(len(self.invalidations()), 1, "só a invalidação da baseline")

    def test_failure_after_the_index_write_is_explicit_and_never_rolls_back(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        real = s3_fetch(self.s3)

        def broken(url):
            status, headers, body = real(url)
            return (500, headers, b"") if url.endswith("/ui.js") else (status, headers, body)
        with self.assertRaises(fr.PostActivationError) as ctx:
            self.activate("m1", fetch=broken, smoke_attempts=2)
        message = str(ctx.exception)
        self.assertIn("ui.js", message)
        self.assertIn(f"rollback para {rid('baseline')}", message)
        self.assertEqual(ctx.exception.record["smoke"], "falhou")
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m1"), "sem rollback automático")

    def test_invalidation_timeout_after_the_write_is_a_post_activation_failure(self):
        self.legacy_up_to_baseline()
        self.publish("m1")

        class Slow:
            def create_invalidation(self, **kwargs):
                return {"Invalidation": {"Id": "I1", "Status": "InProgress"}}

            def get_invalidation(self, **kwargs):
                return {"Invalidation": {"Id": "I1", "Status": "InProgress"}}
        with self.assertRaisesRegex(fr.PostActivationError, "não concluiu"):
            self.activate("m1", cloudfront=Slow())
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m1"))

    def test_access_denied_on_the_index_is_a_failure_before_any_change(self):
        self.legacy_up_to_baseline()
        self.publish("m1")

        def denied(kwargs):
            if kwargs["Key"] == "index.html":
                raise ClientError({"Error": {"Code": "AccessDenied", "Message": "negado"}}, "PutObject")
        etag = self.index()[0]
        with self.assertRaisesRegex(fr.ReleaseError, "AccessDenied") as ctx:
            self.activate("m1", s3=Spy(self.s3, before_put=denied))
        self.assertNotIsInstance(ctx.exception, fr.PostActivationError)
        self.assertEqual(self.index()[0], etag)

    def test_forward_activation_refuses_older_off_main_and_below_floor_releases(self):
        self.legacy_up_to_baseline()
        for name in ("m1", "m2", "off_main", "pre_floor"):
            self.publish(name)
        self.activate("m2")
        for name, reason in (("m1", "use a operação rollback"), ("off_main", "first-parent"), ("pre_floor", "piso")):
            with self.subTest(name), self.assertRaisesRegex(fr.ReleaseError, reason):
                self.activate(name)
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m2"))

    # ------------------------------------------------------------ verificação C (B.2): HEAD da main antes da escrita

    def moved(self, spy, seen):
        def guard():
            seen.append(len(spy.puts))
            raise fr.ReleaseError("Revalidação antes da escrita: A main avançou (teste).")
        return guard

    def test_publish_revalidates_main_before_the_first_object(self):
        spy, seen = Spy(self.s3), []
        with self.assertRaisesRegex(fr.ReleaseError, "A main avançou"):
            fr.publish_release(spy, BUCKET, R["m1"], log=self.logs.append, before_write=self.moved(spy, seen), approve=lambda *snapshot: None)
        self.assertEqual((seen, spy.puts, self.keys("releases/")), ([0], [], []))

    def test_activation_revalidates_main_after_the_checks_and_before_the_index(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        etag, spy, seen = self.index()[0], Spy(self.s3), []
        with self.assertRaisesRegex(fr.ReleaseError, "A main avançou") as ctx:
            self.activate("m1", s3=spy, before_write=self.moved(spy, seen))
        self.assertNotIsInstance(ctx.exception, fr.PostActivationError)
        self.assertEqual((seen, spy.puts, self.index()[0]), ([0], [], etag))
        self.assertEqual(len(self.invalidations()), 1, "só a invalidação da baseline")
        # Reativar a release já ativa também revalida antes da invalidação.
        with self.assertRaisesRegex(fr.ReleaseError, "A main avançou"):
            self.activate("baseline", before_write=self.moved(spy, seen))
        self.assertEqual(len(self.invalidations()), 1)

    def test_revalidation_runs_only_after_the_activation_checks_pass(self):
        self.legacy_up_to_baseline()
        self.publish("m1")
        spy, seen = Spy(self.s3), []
        with self.assertRaisesRegex(fr.ReleaseError, "nada foi alterado"):
            self.activate("m1", s3=spy, expected_active="legacy", before_write=self.moved(spy, seen))
        self.assertEqual(seen, [], "uma ativação já recusada não chega à revalidação")
        record = self.activate("m1", before_write=lambda: None)
        self.assertEqual(record["release_id"], rid("m1"))

    # ------------------------------------------------------------ rollback

    def test_rollback_to_a_previous_release_with_the_same_contract(self):
        self.legacy_up_to_baseline()
        for name in ("m1", "m2"):
            self.publish(name)
        self.activate("m1")
        self.activate("m2")
        with self.assertRaisesRegex(fr.ReleaseError, "nada foi alterado"):
            self.activate("m1", mode="rollback", expected_active=rid("m1"))
        record = self.activate("m1", mode="rollback", expected_active=rid("m2"))
        self.assertEqual((record["mode"], record["previous_release"], record["smoke"]), ("rollback", rid("m2"), "ok"))
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m1"))
        # Rollback de config no mesmo commit (mesmo sha12, conteúdo diferente) também é permitido.
        self.publish("m1_config3")
        self.activate("m1_config3")
        self.activate("m1", mode="rollback", expected_active=rid("m1_config3"))

    def test_rollback_to_the_baseline_restores_the_root_config_read(self):
        # openapi/portal.yaml e frontend/api.js não mudaram desde 1daab31: mesmo contrato, sem confirmação extra.
        self.legacy_up_to_baseline()
        self.publish("m1")
        self.activate("m1")
        record = self.activate("baseline", mode="rollback", expected_active=rid("m1"))
        self.assertEqual(record["release_id"], rid("baseline"))
        status, _, body = s3_fetch(self.s3)(ORIGIN + "/config.json")
        self.assertEqual((status, json.loads(body)), (200, config("raiz")), "a baseline volta a ler a config da raiz")

    def test_rollback_across_different_contracts_requires_the_explicit_confirmation(self):
        self.legacy_up_to_baseline()
        for name in ("m1", "m2_new_contract"):
            self.publish(name)
        self.activate("m1")
        self.activate("m2_new_contract")
        etag = self.index()[0]
        with self.assertRaisesRegex(fr.ReleaseError, "Contratos OpenAPI diferentes"):
            self.activate("m1", mode="rollback", expected_active=rid("m2_new_contract"))
        with self.assertRaisesRegex(fr.ReleaseError, "Contratos OpenAPI diferentes"):
            self.activate("m1", mode="rollback", expected_active=rid("m2_new_contract"), confirm_release_id=rid("m2_new_contract"))
        self.assertEqual(self.index()[0], etag)
        record = self.activate("m1", mode="rollback", expected_active=rid("m2_new_contract"), confirm_release_id=rid("m1"))
        self.assertEqual(record["release_id"], rid("m1"))

    def test_rollback_refusals(self):
        self.legacy_up_to_baseline()
        for name in ("m1", "m2", "pre_floor", "off_main", "m2_new_route"):
            self.publish(name)
        self.activate("m1")
        cases = {
            "pre_floor": "piso histórico",
            "off_main": "first-parent",
            "m2": "posterior à ativa",
            "m1": "já é a ativa",
        }
        for name, reason in cases.items():
            with self.subTest(name), self.assertRaisesRegex(fr.ReleaseError, reason):
                self.activate(name, mode="rollback", expected_active=rid("m1"))
        self.activate("m2_new_route")
        # A partir de m2_new_route (que tem uma rota a mais), voltar para m1 é permitido; o inverso exigiria a rota.
        self.activate("m1", mode="rollback", expected_active=rid("m2_new_route"))
        self.assertEqual(fr.pointer_release(self.index()[1]), rid("m1"))

    def test_rollback_needs_routes_contained_in_the_active_release(self):
        target = fr.load_release_dir(R["m2_new_route"])[0]
        active = fr.load_release_dir(R["m2"])[0]
        problems = fr.rollback_problems(target, active, BASELINE, FakeGit([BASELINE_SHA, MAIN_1, MAIN_2]), "")
        self.assertTrue(any("GET /rota-nova" in p for p in problems), problems)

    def test_rollback_from_legacy_is_not_done_by_the_pipeline(self):
        self.publish("baseline")
        with self.assertRaisesRegex(fr.ReleaseError, "legado"):
            self.activate("baseline", mode="rollback", expected_active="legacy")


if __name__ == "__main__":
    unittest.main()

import copy
import csv
import io
import unittest
from unittest.mock import patch

from portal import Portal, APIError
from reminders import SendFailure
from test_portal import MemoryRepository
from test_grades import canvas_csv


class Mailer:
    def __init__(self):
        self.sent = []
        self.ready = True
        self.failure = None

    def readiness(self, sender):
        return {"ready": self.ready, "reason": "SES aguardando liberação"}

    def send(self, msg):
        if self.failure:
            raise self.failure
        self.sent.append(msg)
        return "ses-message-test"

    def ensure_identity(self, email):
        pass


class ReminderTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", {"REMINDERS_ENABLED": "true", "REMINDER_BATCH_DELAY_SECONDS": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.repo = MemoryRepository()
        self.mailer = Mailer()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "teacher@escoladanuvem.org", "groups": ["admin"]}, mailer=self.mailer)
        self.student = Portal(self.repo, {"sub": "student", "email": "aluno@example.test", "groups": []}, mailer=self.mailer)
        self.publish()

    def call(self, op, body, actor=None):
        return (actor or self.admin).dispatch("POST", "/cohorts/BRSA0267/" + op, body)

    def publish(self, kc="", lab="", email="aluno@example.test"):
        return self.publish_csv(canvas_csv(kc=kc, lab=lab, email=email))

    def publish_csv(self, csv):
        draft = self.call("preview", {"csv": csv, "activeIds": ["001 KC (123)", "002 Lab (456)"]})
        return self.call("publish", {"draftId": draft["draft"]["id"]})

    def preview(self):
        return self.call("pending-preview", {"studentId": "101"})

    def payload(self, preview=None):
        preview = preview or self.preview()
        return {"studentId": "101", "publicationId": preview["publicationId"], "previewHash": preview["previewHash"]}

    def test_paused_reminders_keep_details_without_ses_or_send(self):
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}), patch.object(self.mailer, "readiness", side_effect=AssertionError("SES must not be called")):
            preview = self.preview()
            self.assertEqual(len(preview["activities"]), 2)
            self.assertNotIn("message", preview)
            self.assertNotIn("ses", preview)
            with self.assertRaises(APIError) as err:
                self.call("send-reminder", {"studentId": "101", "publicationId": preview["publicationId"], "previewHash": "old-preview"})
            self.assertEqual(err.exception.status, 403)
            self.assertEqual(self.mailer.sent, [])

    def test_preview_includes_full_student_detail_for_instructor(self):
        self.publish(kc="7", lab="")  # KC com nota (70%), LAB sem nota
        preview = self.preview()
        self.assertEqual([a["state"] for a in preview["allActivities"]], ["completed", "pending"])
        self.assertEqual(preview["summary"]["kc"], 70)
        self.assertEqual(preview["summary"]["pending"], 1)
        self.assertEqual(preview["thresholds"], {"kc": 70, "lab": 95})
        self.assertEqual(len(preview["history"]), 2)  # publicação do setUp e esta
        self.assertTrue(preview["history"][0]["current"])
        self.assertEqual(len(preview["activities"]), 1)  # a lista do lembrete continua só com pendências
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            self.assertEqual(len(self.preview()["allActivities"]), 2)

    def test_preview_contains_only_pending_activities_and_no_send(self):
        preview = self.preview()
        self.assertEqual(len(preview["activities"]), 2)
        self.assertIn("KCs sem nota registrada:\n- 001 KC", preview["message"]["text"])
        self.assertIn("LABs sem nota registrada:\n- 002 Lab", preview["message"]["text"])
        self.assertIn("Precisa de algum auxílio?", preview["message"]["text"])
        self.assertEqual(preview["message"]["replyTo"], "teacher@escoladanuvem.org")
        self.assertEqual(preview["message"]["from"], "teacher@escoladanuvem.org")
        self.assertEqual(self.mailer.sent, [])

    def test_students_and_unassigned_instructors_cannot_preview_or_send(self):
        instructor = Portal(self.repo, {"sub": "other", "email": "other@escoladanuvem.org", "groups": ["instructor"]}, mailer=self.mailer)
        for actor in (self.student, instructor):
            for op, body in (("pending-preview", {"studentId": "101"}), ("send-reminder", self.payload())):
                with self.subTest(op=op), self.assertRaises(APIError) as err:
                    self.call(op, body, actor)
                self.assertEqual(err.exception.status, 403)
        self.assertEqual(self.mailer.sent, [])

    def test_send_is_individual_and_duplicate_is_blocked(self):
        body = self.payload()
        self.assertEqual(self.call("send-reminder", body)["delivery"]["status"], "sent")
        self.assertEqual(self.mailer.sent[0]["to"], "aluno@example.test")
        with self.assertRaises(APIError):
            self.call("send-reminder", body)
        self.assertEqual(len(self.mailer.sent), 1)
        self.assertEqual(self.preview()["delivery"]["messageId"], "ses-message-test")

    def test_recipient_and_message_cannot_be_supplied_by_browser(self):
        for key in ("to", "text", "subject", "replyTo"):
            with self.subTest(key=key), self.assertRaises(APIError):
                self.call("send-reminder", {**self.payload(), key: "attacker@example.test"})
        self.assertEqual(self.mailer.sent, [])

    def test_new_publication_invalidates_previous_preview(self):
        body = self.payload()
        self.publish(kc="0")
        with self.assertRaises(APIError) as err:
            self.call("send-reminder", body)
        self.assertEqual(err.exception.status, 409)
        self.assertEqual(self.mailer.sent, [])

    def test_display_name_change_invalidates_preview(self):
        body = self.payload()
        self.repo.put("COHORT#BRSA0267", "PROFILE#101", {"canvasId": "101", "displayName": "Novo nome"})
        with self.assertRaises(APIError):
            self.call("send-reminder", body)
        self.assertEqual(self.mailer.sent, [])

    def test_missing_email_no_pending_and_ses_unready_block_send(self):
        self.mailer.ready = False
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.mailer.ready = True
        self.publish(email="")
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.publish(kc="0", lab="EX")
        self.assertEqual(self.preview()["activities"], [])
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.mailer.sent, [])

    def test_unreleased_activity_is_not_in_email(self):
        draft = self.call("preview", {"csv": canvas_csv(kc="", lab=""), "activeIds": ["001 KC (123)"]})
        self.call("publish", {"draftId": draft["draft"]["id"]})
        preview = self.preview()
        self.assertEqual(len(preview["activities"]), 1)
        self.assertNotIn("LABs sem nota registrada", preview["message"]["text"])

    def test_unknown_outcome_blocks_retry_but_definite_rejection_allows_it(self):
        self.mailer.failure = SendFailure(uncertain=False)
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.preview()["delivery"]["status"], "failed")
        self.mailer.failure = SendFailure(uncertain=True)
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.preview()["delivery"]["status"], "unknown")
        self.mailer.failure = None
        with self.assertRaises(APIError): self.call("send-reminder", self.payload())
        self.assertEqual(self.mailer.sent, [])

    def test_publication_race_does_not_send(self):
        from repository import Conflict
        body = self.payload()
        self.repo.fail_transaction = True
        with self.assertRaises(Conflict): self.call("send-reminder", body)
        self.assertEqual(self.mailer.sent, [])

    def test_batch_preview_reports_skip_reasons_and_a_sample_message(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Sem Email", "202", "", "", "", "0"]))
        # 101 (aluno@example.test): pendente, elegível. 202 (Sem Email): sem e-mail.
        self.call("send-reminder", self.payload())  # 101 já recebeu nesta publicação.
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202", "999"]})
        by_id = {r["id"]: r for r in preview["recipients"]}
        self.assertEqual(by_id["101"]["skip"], "already-sent")
        self.assertEqual(by_id["202"]["skip"], "no-email")
        self.assertEqual(by_id["999"]["skip"], "not-found")
        self.assertIsNone(preview["sample"])  # ninguém elegível para amostra
        self.assertEqual(len(self.mailer.sent), 1)  # só o send-reminder individual acima

    def test_batch_send_reports_per_student_outcome_and_never_duplicates(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Segundo Aluno", "202", "segundo@example.test", "", "", "0"]))
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202"]})
        self.assertIsNotNone(preview["sample"])
        result = self.call("send-reminders", {"studentIds": ["101", "202"],
                                              "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: r["status"] for r in result["results"]}, {"101": "sent", "202": "sent"})
        self.assertEqual({m["to"] for m in self.mailer.sent}, {"aluno@example.test", "segundo@example.test"})
        # Reenviar para os mesmos dois é bloqueado (mesma publicação, já enviado) — não duplica.
        again = self.call("send-reminders", {"studentIds": ["101", "202"],
                                             "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["status"] for r in again["results"]}, {"skipped"})
        self.assertEqual(len(self.mailer.sent), 2)

    def test_batch_send_skips_ineligible_without_blocking_the_rest(self):
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Sem Email", "202", "", "", "", "0"]))
        result = self.call("send-reminders", {"studentIds": ["101", "202", "999"],
                                              "expectedPublicationId": self.repo.get("COHORT#BRSA0267", "METADATA")["current"]})
        by_id = {r["id"]: r for r in result["results"]}
        self.assertEqual(by_id["101"]["status"], "sent")
        self.assertEqual(by_id["202"]["reason"], "no-email")
        self.assertEqual(by_id["999"]["reason"], "not-found")
        self.assertEqual(len(self.mailer.sent), 1)

    def test_batch_requires_institutional_reminders_enabled_and_valid_ids(self):
        instructor = Portal(self.repo, {"sub": "other", "email": "other@escoladanuvem.org", "groups": ["instructor"]}, mailer=self.mailer)
        for actor in (self.student, instructor):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ["101"]}, actor)
            self.assertEqual(err.exception.status, 403)
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ["101"]})
            self.assertEqual(err.exception.status, 403)
        for ids in ([], ["101", "101"], ["x"] * 201, [1]):
            with self.assertRaises(APIError) as err:
                self.call("pending-preview-batch", {"studentIds": ids})
            self.assertEqual(err.exception.status, 400)
        self.assertEqual(self.mailer.sent, [])

    def test_batch_send_stops_remaining_students_when_publication_changes_mid_batch(self):
        from repository import Conflict
        self.publish_csv(canvas_csv(kc="", lab="", email="aluno@example.test",
                                 extra=["Segundo Aluno", "202", "segundo@example.test", "", "", "0"]))
        publication_id = self.repo.get("COHORT#BRSA0267", "METADATA")["current"]
        original = self.repo.transaction
        calls = {"n": 0}

        def flaky(writes):
            calls["n"] += 1
            if calls["n"] == 2:
                raise Conflict()
            return original(writes)

        with patch.object(self.repo, "transaction", side_effect=flaky):
            result = self.call("send-reminders", {"studentIds": ["101", "202"],
                                                   "expectedPublicationId": publication_id})
        self.assertEqual(result["results"][0]["status"], "sent")
        self.assertEqual(result["results"][1], {"id": "202", "name": "Segundo Aluno", "status": "skipped", "reason": "publication-changed"})
        self.assertEqual(len(self.mailer.sent), 1)

    def test_crash_after_acceptance_does_not_allow_duplicate(self):
        body = self.payload()
        original = self.repo.put
        with patch.object(self.repo, "put", wraps=original) as put:
            def fail_final(pk, sk, data, absent=False):
                if data.get("status") == "sent": raise RuntimeError("Dynamo unavailable")
                return original(pk, sk, data, absent)
            put.side_effect = fail_final
            with self.assertRaises(RuntimeError): self.call("send-reminder", body)
        self.assertEqual(self.preview()["delivery"]["status"], "sending")
        with self.assertRaises(APIError): self.call("send-reminder", body)
        self.assertEqual(len(self.mailer.sent), 1)



def pending_csv(*rows):
    """Turma com todas as atividades sem nota; cada linha é (nome, ID Canvas, e-mail)."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Student", "ID", "SIS Login ID", "001 KC (123)", "002 Lab (456)", "Graduated Final Points"])
    writer.writerow(["Points Possible", "", "", "10", "100", "1"])
    for name, sid, email in rows:
        writer.writerow([name, sid, email, "", "", "0"])
    return out.getvalue()


class WithdrawnReminderTests(unittest.TestCase):
    """Aluno WITHDRAWN não recebe lembrete: o envio individual é recusado antes de qualquer efeito e o lote o pula,
    sempre conferindo no momento do envio (a prévia não autoriza nada). O detalhe do aluno continua abrindo."""

    def setUp(self):
        env = patch.dict("os.environ", {"REMINDERS_ENABLED": "true", "REMINDER_BATCH_DELAY_SECONDS": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.repo = MemoryRepository()
        self.mailer = Mailer()
        self.repo.put("COHORT#BRSA0267", "METADATA", {"code": "BRSA0267", "current": None})
        self.admin = Portal(self.repo, {"sub": "admin", "email": "teacher@escoladanuvem.org", "groups": ["admin"]}, mailer=self.mailer)
        self.publish(pending_csv(("Costa, Marina", "101", "aluno@example.test"), ("Aluno, Segundo", "202", "segundo@example.test"),
                                 ("Aluno, Terceiro", "303", "terceiro@example.test"), ("Sem, Email", "404", ""), ("Outro, Sem Email", "505", "")))

    def call(self, op, body, code="BRSA0267"):
        return self.admin.dispatch("POST", f"/cohorts/{code}/" + op, body)

    def publish(self, text, code="BRSA0267"):
        draft = self.call("preview", {"csv": text, "activeIds": ["001 KC (123)", "002 Lab (456)"]}, code)
        return self.call("publish", {"draftId": draft["draft"]["id"]}, code)["publication"]

    def mark(self, canvas_id, status, expected):
        return self.call("participation", {"canvasId": canvas_id, "status": status, "expectedStatus": expected})

    def send_one(self, preview):
        return self.call("send-reminder", {"studentId": preview["student"]["id"], "publicationId": preview["publicationId"], "previewHash": preview["previewHash"]})

    def current(self):
        return self.repo.get("COHORT#BRSA0267", "METADATA")["current"]

    def refused(self, call):
        with self.assertRaises(APIError) as err:
            call()
        return err.exception.status

    def test_detail_still_opens_with_the_flag_and_individual_send_is_refused_without_effects(self):
        self.mark("202", "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview", {"studentId": "202"})
        self.assertEqual(preview["participationStatus"], "WITHDRAWN")
        self.assertEqual((preview["student"]["id"], len(preview["activities"])), ("202", 2))
        self.assertIn("message", preview)
        self.assertNotIn("participationStatus", self.call("pending-preview", {"studentId": "101"}))
        items = copy.deepcopy(self.repo.items)
        with patch.object(self.mailer, "readiness", side_effect=AssertionError("o SES não pode ser consultado")), \
                patch.object(self.mailer, "send", side_effect=AssertionError("nada pode ser enviado")):
            self.assertEqual(self.refused(lambda: self.send_one(preview)), 409)
        self.assertEqual((self.mailer.sent, self.repo.items), ([], items))
        with patch.dict("os.environ", {"REMINDERS_ENABLED": "false"}):
            self.assertEqual(self.call("pending-preview", {"studentId": "202"})["participationStatus"], "WITHDRAWN")

    def test_preview_made_while_active_does_not_authorize_a_later_send(self):
        preview = self.call("pending-preview", {"studentId": "202"})
        self.assertNotIn("participationStatus", preview)
        self.mark("202", "WITHDRAWN", "ACTIVE")
        items = copy.deepcopy(self.repo.items)
        self.assertEqual(self.refused(lambda: self.send_one(preview)), 409)
        self.assertEqual((self.mailer.sent, self.repo.items), ([], items))
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", f"REMINDER#{preview['publicationId']}#202"))

    def test_batch_skips_withdrawn_alongside_the_existing_reasons(self):
        self.send_one(self.call("pending-preview", {"studentId": "101"}))  # 101 já contatado nesta publicação
        self.mark("202", "WITHDRAWN", "ACTIVE")
        self.mark("505", "WITHDRAWN", "ACTIVE")  # sem e-mail e desistente: vale o motivo withdrawn
        ids = ["101", "202", "303", "404", "505", "999"]
        expected = {"101": "already-sent", "202": "withdrawn", "303": None, "404": "no-email", "505": "withdrawn", "999": "not-found"}
        preview = self.call("pending-preview-batch", {"studentIds": ids})
        self.assertEqual({r["id"]: r["skip"] for r in preview["recipients"]}, expected)
        self.assertEqual(preview["sample"]["to"], "terceiro@example.test")
        result = self.call("send-reminders", {"studentIds": ids, "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: (r["status"], r.get("reason")) for r in result["results"]},
                         {sid: ("sent", None) if reason is None else ("skipped", reason) for sid, reason in expected.items()})
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test", "terceiro@example.test"])

    def test_withdrawal_after_the_batch_preview_is_honoured_at_send(self):
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "303"]})
        self.assertEqual({r["id"]: r["skip"] for r in preview["recipients"]}, {"101": None, "303": None})
        self.mark("303", "WITHDRAWN", "ACTIVE")
        result = self.call("send-reminders", {"studentIds": ["101", "303"], "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({r["id"]: (r["status"], r.get("reason")) for r in result["results"]},
                         {"101": ("sent", None), "303": ("skipped", "withdrawn")})
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test"])
        self.assertIsNone(self.repo.get("COHORT#BRSA0267", f"REMINDER#{self.current()}#303"))

    def test_all_withdrawn_batch_sends_nothing(self):
        for canvas_id in ("101", "202", "303"):
            self.mark(canvas_id, "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202", "303"]})
        self.assertEqual(({r["skip"] for r in preview["recipients"]}, preview["sample"]), ({"withdrawn"}, None))
        result = self.call("send-reminders", {"studentIds": ["101", "202", "303"], "expectedPublicationId": preview["publicationId"]})
        self.assertEqual({(r["status"], r["reason"]) for r in result["results"]}, {("skipped", "withdrawn")})
        self.assertEqual(self.mailer.sent, [])

    def test_batch_send_only_reaches_the_requested_students(self):
        # O envio recalcula cada aluno pedido, mas nunca acrescenta quem não foi pedido: quem só reaparece como
        # ativo depois da prévia não entra se o pedido traz apenas os aprovados nela.
        self.mark("202", "WITHDRAWN", "ACTIVE")
        preview = self.call("pending-preview-batch", {"studentIds": ["101", "202"]})
        approved = [r["id"] for r in preview["recipients"] if not r["skip"]]
        self.assertEqual(approved, ["101"])
        self.mark("202", "ACTIVE", "WITHDRAWN")
        result = self.call("send-reminders", {"studentIds": approved, "expectedPublicationId": preview["publicationId"]})
        self.assertEqual([(r["id"], r["status"]) for r in result["results"]], [("101", "sent")])
        self.assertEqual([m["to"] for m in self.mailer.sent], ["aluno@example.test"])

    def test_without_records_reminder_contracts_are_unchanged(self):
        preview = self.call("pending-preview", {"studentId": "101"})
        self.assertEqual(set(preview), {"student", "activities", "publicationId", "publishedAt", "message", "previewHash", "delivery", "ses",
                                        "remindersEnabled", "summary", "allActivities", "thresholds", "canvasCourseId", "history"})
        batch = self.call("pending-preview-batch", {"studentIds": ["101", "404", "999"]})
        self.assertEqual({frozenset(r) for r in batch["recipients"]}, {frozenset({"id", "name", "email", "pending", "skip"})})
        self.assertEqual({r["id"]: r["skip"] for r in batch["recipients"]}, {"101": None, "404": "no-email", "999": "not-found"})
        result = self.call("send-reminders", {"studentIds": ["101", "404"], "expectedPublicationId": batch["publicationId"]})
        self.assertEqual(result["results"], [{"id": "101", "name": "Marina Costa", "status": "sent"},
                                             {"id": "404", "name": "Email Sem", "status": "skipped", "reason": "no-email"}])

    def test_batch_reads_participation_with_one_query(self):
        self.repo.put("COHORT#BRSA0300", "METADATA", {"code": "BRSA0300", "current": None})
        rows = [(f"Aluno, N{i}", str(1000 + i), f"aluno{i}@example.test") for i in range(100)]
        self.publish(pending_csv(*rows), code="BRSA0300")
        for canvas_id in ("1000", "1050"):
            self.call("participation", {"canvasId": canvas_id, "status": "WITHDRAWN", "expectedStatus": "ACTIVE"}, code="BRSA0300")
        ids = [sid for _, sid, _ in rows]
        calls, list_, get = [], self.repo.list, self.repo.get
        with patch.object(self.repo, "list", lambda pk, prefix="": calls.append(("list", prefix)) or list_(pk, prefix)), \
                patch.object(self.repo, "get", lambda pk, sk: calls.append(("get", sk)) or get(pk, sk)):
            preview = self.call("pending-preview-batch", {"studentIds": ids}, code="BRSA0300")
        self.assertEqual([c for c in calls if c[1].startswith("PARTICIPATION#")], [("list", "PARTICIPATION#")])
        self.assertEqual(sorted(r["id"] for r in preview["recipients"] if r["skip"] == "withdrawn"), ["1000", "1050"])


if __name__ == "__main__": unittest.main()

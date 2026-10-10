"""Exceção temporária para recuperar somente a ocorrência autorizada, sem AWS."""
import unittest

from automatic_reminders import CohortRun, Stop, live_day, occurrence_context
from sync_runs import evening_sync_key


class RecoveryWindowTests(unittest.TestCase):
    def worker(self, at, *, code="BRSA0267", dry_run=False,
               scheduled="2026-10-09T23:00:00Z"):
        event = occurrence_context({"source": "portal.scheduler", "type": "automatic-reminders",
                                    "scheduledFor": scheduled, "executionId": "recovery-test",
                                    "attemptNumber": 2})
        return CohortRun(None, None, event, code, "example.test", enabled=True,
                         dry_run=dry_run, clock=lambda: at, sleep=lambda _: None,
                         delay_seconds=0, remaining_ms=None, emit=lambda _: None)

    def test_original_friday_occurrence_can_run_saturday_0035(self):
        worker = self.worker("2026-10-10T03:35:00Z")
        worker.check_window()
        self.assertTrue(live_day(worker.context["scheduledFor"]))
        self.assertEqual(evening_sync_key(worker.context["scheduledFor"]),
                         "SYNC_RUN#2026-10-09T21:00:00Z")

    def test_recovery_deadline_is_exclusive_at_0100(self):
        self.worker("2026-10-10T03:59:59Z").check_window()
        with self.assertRaises(Stop) as raised:
            self.worker("2026-10-10T04:00:00Z").check_window()
        self.assertEqual(raised.exception.reason, "window-expired")

    def test_saturday_0035_is_not_a_new_occurrence(self):
        with self.assertRaises(ValueError):
            self.worker("2026-10-10T03:35:00Z", scheduled="2026-10-10T03:35:00Z")

    def test_saturday_live_stays_forbidden(self):
        worker = self.worker("2026-10-10T23:00:00Z", scheduled="2026-10-10T23:00:00Z")
        with self.assertRaises(Stop) as raised:
            worker.prepare()
        self.assertEqual(raised.exception.reason, "not-due")

    def test_other_cohort_dry_run_and_other_dates_keep_30_minutes(self):
        for kwargs in ({"code": "BRSA0257"}, {"dry_run": True},
                       {"scheduled": "2026-10-13T23:00:00Z"}):
            with self.subTest(kwargs=kwargs):
                scheduled = kwargs.get("scheduled", "2026-10-09T23:00:00Z")
                at = scheduled.replace("23:00:00", "23:30:00")
                with self.assertRaises(Stop) as raised:
                    self.worker(at, **kwargs).check_window()
                self.assertEqual(raised.exception.reason, "window-expired")

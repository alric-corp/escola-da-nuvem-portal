"""Mutações da autorização manual em cópias descartáveis; DynamoDB Moto, nunca AWS real.

Cada mutante deve falhar no teste indicado, não apenas por import/sintaxe.
Nenhum backend Terraform, configuração local ou credencial é copiado.
"""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
CASES = [
    ("manual_without_iam_alias", 'or getattr(context, "invoked_function_arn", None) != alias',
     'or False', "test_unqualified_version_and_other_alias_cannot_authorize_payload"),
    ("manual_without_flag", 'or os.environ.get("MANUAL_RECOVERY_ENABLED", "false") != "true"',
     'or False', "test_false_or_malformed_manual_flag_rejected_before_clients"),
    ("manual_wrong_cohort", 'if code != self.cohort or scheduled_for != self.scheduled_for:',
     'if scheduled_for != self.scheduled_for:', "test_other_cohort_rejected"),
    ("manual_wrong_occurrence", 'if code != self.cohort or scheduled_for != self.scheduled_for:',
     'if code != self.cohort:', "test_other_occurrence_rejected"),
    ("manual_expired", 'if at >= self.expires_at:', 'if False:',
     "test_expired_manual_authorization_rejected_before_clients"),
    ("manual_before_authorization", 'if at < self.not_before:', 'if False:',
     "test_not_yet_authorized_rejected_before_clients"),
    ("manual_unbounded", 'or not timedelta(0) < authorization.expires_at - authorization.not_before <= MANUAL_MAX_DURATION',
     'or False', "test_unbounded_or_invalid_authorization_rejected"),
    ("manual_weekday_bypass", 'if (not live_day(technical["scheduledFor"])', 'if (False',
     "test_original_slot_and_live_weekdays_still_required"),
    ("manual_payload_extra", 'not isinstance(event, dict) or set(event) != fields',
     'not isinstance(event, dict)', "test_event_cannot_supply_authentication_or_recipients"),
    ("manual_expiry_during_run", 'self.authorization.check(self.code, self.context["scheduledFor"], at)',
     'pass', "test_expiration_during_execution_stops_new_reservations"),
    ("manual_expiry_before_send", '                    if self.authorization:\n',
     '                    if False:\n', "test_expiration_during_reservation_prevents_send"),
]



def main():
    files = list((ROOT / "backend").glob("*.py")) + [
        ROOT / "tests" / "integration" / name for name in ["test_aws.py", "test_automatic_claim.py", "test_manual_recovery.py"]]
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    env = {k: v for k, v in os.environ.items() if not k.startswith(("AWS_", "TF_")) and k != "PYTHONPATH"}
    env.update(AWS_ACCESS_KEY_ID="testing", AWS_SECRET_ACCESS_KEY="testing", AWS_SESSION_TOKEN="testing",
               AWS_DEFAULT_REGION="us-east-1", AWS_EC2_METADATA_DISABLED="true", PYTHONDONTWRITEBYTECODE="1")
    with tempfile.TemporaryDirectory(prefix="portal-manual-mutations-") as folder:
        root = Path(folder)
        for file in files:
            target = root / file.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        def run():
            return subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/integration",
                                   "-p", "test_manual_recovery.py", "-v"], cwd=root, env=env,
                                  capture_output=True, text=True, timeout=90)
        baseline = run()
        assert baseline.returncode == 0, baseline.stdout + baseline.stderr
        print("manual baseline: PASS", flush=True)
        killed = 0
        for name, old, new, expected_test in CASES:
            module = "automatic_reminders.py"
            target = root / "backend" / module
            original = target.read_text()
            assert original.count(old) == (2 if name == "manual_payload_extra" else 1), "Mutation anchor changed: " + name
            mutated = original.replace(old, new)
            compile(mutated, module, "exec")
            target.write_text(mutated)
            try:
                result = run()
                failures = re.findall(r"^(?:FAIL|ERROR): (test_\w+)", result.stdout + result.stderr, re.M)
                assert result.returncode != 0 and expected_test in failures, (
                    "Mutant survived or failed outside its guard: " + name + "\n" + result.stdout + result.stderr)
                killed += 1
                print(name + ": KILLED by " + expected_test, flush=True)
            finally:
                target.write_text(original)
        assert killed == len(CASES)
        print(f"manual mutations: {killed}/{len(CASES)} killed; 0 survived", flush=True)
    assert all(hashlib.sha256(p.read_bytes()).hexdigest() == value for p, value in hashes.items())


if __name__ == "__main__":
    main()

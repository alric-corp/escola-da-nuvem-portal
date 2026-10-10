"""Mutações do claim em cópias descartáveis; DynamoDB Moto, nunca AWS real.

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
    ("reserialize_condition", "repository.py", "        return raw\n\n    def transaction",
     "        return self._encode(expected)\n\n    def transaction", 1,
     "test_auto4_writer_v1_live_handler_acquires_claim"),
    ("accept_changed_snapshot", "repository.py", "if self._encode(current) != self._encode(expected):",
     "if False:", 1, "test_version_change_before_claim_conflicts"),
    ("coerce_json_types", "repository.py", "if self._encode(current) != self._encode(expected):",
     "if current != expected:", 1, "test_json_types_cannot_be_coerced_by_python_equality"),
    ("eventual_snapshot_read", "repository.py",
     'item = self.table.get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=True).get("Item") or {}\n        raw = item.get("data")',
     'item = self.table.get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=False).get("Item") or {}\n        raw = item.get("data")', 1,
     "test_snapshot_read_is_consistent_and_keeps_every_field"),
    ("omit_settings_atomic_check", "repository.py", '            actions.append({"ConditionCheck": check})',
     '            if sk != "REMINDER_SETTINGS": actions.append({"ConditionCheck": check})', 1,
     "test_settings_races_after_canonical_comparison_still_fail_atomically"),
    ("omit_claim_absence", "repository.py",
     '"SK": {"S": sk}, "data": {"S": self._encode(data)}},\n'
     '                "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "#d = :old"}',
     '"SK": {"S": sk}, "data": {"S": self._encode(data)}},\n'
     '                "ConditionExpression": "attribute_not_exists(PK) OR attribute_exists(PK)" if expected is None else "#d = :old"}',
     1, "test_two_claims_prepared_concurrently_only_one_wins"),
    ("omit_publication_guard", "automatic_reminders.py",
     'checks=[(self.pk, "METADATA", self.cohort), *self.conditions])',
     'checks=self.conditions)', 2, "test_publication_change_before_claim_blocks"),
    ("omit_sync_proof", "automatic_reminders.py",
     'self.conditions = [(self.pk, self.sync_key, self.proof), (self.pk, "REMINDER_SETTINGS", self.settings),',
     'self.conditions = [(self.pk, "REMINDER_SETTINGS", self.settings),',
     1, "test_sync_proof_change_before_claim_blocks"),
    ("omit_withdrawn_fence", "reminders.py",
     'checks=[(pk, "PARTICIPATION#" + student_id, item), *checks])',
     'checks=checks)', 1, "test_withdrawn_before_reservation_never_reserves_or_sends"),
    ("ignore_already_sent", "reminders.py",
     '"already-sent" if previous and previous["status"] != "failed" else None',
     'None', 1, "test_retry_after_committed_send_never_duplicates"),
    ("omit_write_snapshot_fence", "repository.py",
     '"SK": {"S": sk}, "data": {"S": self._encode(data)}},\n'
     '                "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "#d = :old"}',
     '"SK": {"S": sk}, "data": {"S": self._encode(data)}},\n'
     '                "ConditionExpression": "attribute_not_exists(PK)" if expected is None else "attribute_exists(#d) OR #d = :old"}',
     1, "test_conditional_write_race_is_rejected_after_snapshot_read"),
    ("swallow_real_transaction_conflict", "repository.py",
     'except self.db.exceptions.TransactionCanceledException:\n            raise Conflict() from None',
     'except self.db.exceptions.TransactionCanceledException:\n            pass', 1,
     "test_two_claims_prepared_concurrently_only_one_wins"),
]


def main():
    files = list((ROOT / "backend").glob("*.py")) + [
        ROOT / "tests" / "integration" / name for name in ["test_aws.py", "test_automatic_claim.py"]]
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    env = {k: v for k, v in os.environ.items() if not k.startswith(("AWS_", "TF_")) and k != "PYTHONPATH"}
    env.update(AWS_ACCESS_KEY_ID="testing", AWS_SECRET_ACCESS_KEY="testing", AWS_SESSION_TOKEN="testing",
               AWS_DEFAULT_REGION="us-east-1", AWS_EC2_METADATA_DISABLED="true", PYTHONDONTWRITEBYTECODE="1")
    with tempfile.TemporaryDirectory(prefix="portal-claim-mutations-") as folder:
        root = Path(folder)
        for file in files:
            target = root / file.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        def run():
            return subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/integration",
                                   "-p", "test_automatic_claim.py", "-v"], cwd=root, env=env,
                                  capture_output=True, text=True, timeout=90)
        baseline = run()
        assert baseline.returncode == 0, baseline.stdout + baseline.stderr
        print("claim baseline: PASS", flush=True)
        killed = 0
        for name, module, old, new, count, expected_test in CASES:
            target = root / "backend" / module
            original = target.read_text()
            assert original.count(old) == count, "Mutation anchor changed: " + name
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
        print(f"claim mutations: {killed}/{len(CASES)} killed; 0 survived", flush=True)
    assert all(hashlib.sha256(p.read_bytes()).hexdigest() == value for p, value in hashes.items())


if __name__ == "__main__":
    main()

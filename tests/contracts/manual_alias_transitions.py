"""Exercise gate transitions and alias regressions with real HCL and AWS mocks.

Disposable modules contain no state, production tfvars or credentials. The gate
is changed in these copies, so the false -> true regression does not require a
new production configuration switch just for testing.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "infra" / "terraform"
NATIVE = MODULE / "tests" / "manual-alias.tftest.hcl"


def replace_once(text, old, new):
    assert text.count(old) == 1, "Fixture anchor changed; review: " + old
    return text.replace(old, new, 1)


def main():
    worker = (MODULE / "automatic-reminders.tf").read_text()
    manual = (MODULE / "manual-recovery.tf").read_text()
    native = NATIVE.read_text()
    gate = 'AUTOMATIC_REMINDERS_ENABLED   = "true"'
    reference = "function_version = var.manual_recovery_target_version"
    sources = list(MODULE.glob("*.tf")) + [NATIVE, ROOT / "openapi" / "portal.yaml"]
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    providers = MODULE / ".terraform" / "providers"
    assert providers.is_dir(), "Run terraform init -backend=false first"
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("AWS_", "TF_VAR_", "TF_CLI_ARGS"))
           and k not in ("TF_DATA_DIR", "TF_WORKSPACE")}
    env.update(AWS_ACCESS_KEY_ID="testing", AWS_SECRET_ACCESS_KEY="testing",
               AWS_EC2_METADATA_DISABLED="true", TF_IN_AUTOMATION="true", TF_INPUT="false")

    # Every case runs native Terraform assertions against evaluated resources.
    cases = [
        ("gate_false", replace_once(worker, gate, gate.replace('"true"', '"false"')),
         manual, replace_once(native, 'AUTOMATIC_REMINDERS_ENABLED == "true"',
                              'AUTOMATIC_REMINDERS_ENABLED == "false"'), None),
        ("gate_true_zip_and_explicit_target", worker, manual, native, None),
        ("reject_dynamic_version", worker,
         replace_once(manual, reference, "function_version = aws_lambda_function.automatic_reminders.version"),
         native, "Test assertion failed"),
        ("reject_hardcoded_version", worker,
         replace_once(manual, reference, 'function_version = "3"'),
         native, "Test assertion failed"),
        ("reject_unvalidated_latest", worker,
         replace_once(manual, 'can(regex("^[1-9][0-9]*$", var.manual_recovery_target_version))',
                      "var.manual_recovery_target_version != null"),
         native, "Missing expected failure"),
        ("reject_enabled_schedule", replace_once(worker, 'state                        = contains(var.automatic_reminder_enabled_cohorts, each.key) ? "ENABLED" : "DISABLED"',
                                                  'state                        = "ENABLED"'),
         manual, native, "Test assertion failed"),
        ("reject_open_manual_gate", replace_once(worker,
          'MANUAL_RECOVERY_ENABLED       = tostring(var.manual_recovery.enabled)',
          'MANUAL_RECOVERY_ENABLED       = "true"'), manual, native, "Test assertion failed"),
    ]
    try:
        with tempfile.TemporaryDirectory(prefix="portal-manual-alias-") as folder:
            project = Path(folder)
            module = project / "infra" / "terraform"
            (module / "tests").mkdir(parents=True)
            (module / ".terraform").mkdir()
            (module / ".terraform" / "providers").symlink_to(providers.resolve(), target_is_directory=True)
            for path in MODULE.iterdir():
                if path.is_file() and (path.suffix in (".tf", ".json", ".tftpl") or path.name == ".terraform.lock.hcl"):
                    if not path.name.endswith(".tfvars.json"):
                        shutil.copyfile(path, module / path.name)
            for name in ("backend", "frontend"):
                (project / name).symlink_to(ROOT / name, target_is_directory=True)
            (project / "openapi").mkdir()
            shutil.copyfile(ROOT / "openapi" / "portal.yaml", project / "openapi" / "portal.yaml")
            for name, worker_source, manual_source, test_source, diagnostic in cases:
                (module / "automatic-reminders.tf").write_text(worker_source)
                (module / "manual-recovery.tf").write_text(manual_source)
                (module / "tests" / NATIVE.name).write_text(test_source)
                result = subprocess.run(
                    ["terraform", "-chdir=" + str(module), "test", "-no-color", "-filter=tests/" + NATIVE.name],
                    env=env, text=True, capture_output=True, timeout=120,
                )
                output = result.stdout + result.stderr
                if diagnostic is None:
                    assert result.returncode == 0 and "11 passed, 0 failed" in output, name + "\n" + output
                else:
                    assert result.returncode != 0 and diagnostic in output, name + ": wrong rejection\n" + output
                print(name + ": PASS", flush=True)
    finally:
        assert {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources} == hashes, "Original sources changed"
    print("2 transition suites passed; 5 mutations rejected; original sources unchanged")


if __name__ == "__main__":
    main()

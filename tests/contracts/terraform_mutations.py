"""API-2 mutation evidence using the real HCL and native terraform test.

No YAML/HCL parser or route derivation lives here. Edits replace unique,
known YAML byte ranges in disposable copies. Modular cases regenerate the
contract with the production bundler before Terraform evaluates the resources.
Direct bundle mutations remain separate, including invalid-contract guards.
No state, tfvars, backend configuration or credentials are copied.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "infra" / "terraform"
KEY = "POST /cohorts/{code}/participation"
RESOURCE = 'aws_apigatewayv2_route.portal["' + KEY + '"]'
BASELINE_HASH = "c30736ca652e8d28253caba8b0e986730812b3a3163ddd37666826f2471d1af6"


def replace_once(text, old, new):
    assert text.count(old) == 1, "Fixture anchor changed; review: " + old
    return text.replace(old, new, 1)


def assertion(condition, message):
    return '\n  assert {\n    condition = (' + condition + ')\n    error_message = "' + message + '"\n  }\n'


def openapi_inputs():
    """Inputs whose hashes must remain unchanged; generated output is checked separately."""
    return ([ROOT / "openapi" / "redocly.yaml", ROOT / "scripts" / "bundle_openapi.mjs",
             ROOT / "scripts" / "openapi_offline.mjs"]
            + sorted((ROOT / "openapi" / "src").rglob("*.yaml")))


def copy_openapi_sources(project):
    """Copy institutional contract inputs only, never state, credentials or the existing bundle."""
    source = ROOT / "openapi" / "src"
    assert (source / "portal.yaml").is_file(), "Modular OpenAPI entrypoint missing"
    target = project / "openapi" / "src"
    if target.exists():
        shutil.rmtree(target)
    for path in sorted(source.rglob("*.yaml")):
        destination = target / path.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    shutil.copyfile(ROOT / "openapi" / "redocly.yaml", project / "openapi" / "redocly.yaml")


def bundle_openapi(project, env):
    # Node prepares a disposable fixture; Terraform itself keeps reading the generated YAML via file()/yamldecode().
    # Run the original tool so dependencies resolve from the installed repository, not a duplicate node_modules tree.
    result = subprocess.run(["node", str(ROOT / "scripts" / "bundle_openapi.mjs"), "--root", str(project)],
                            cwd=ROOT, env=env, text=True, capture_output=True, timeout=90)
    assert result.returncode == 0, "OpenAPI fixture generation failed\n" + result.stdout + result.stderr


def path_item(document, path):
    """Locate one known YAML path byte range; this does not parse or derive a route map."""
    marker = "  " + path + ":\n"
    assert document.count(marker) == 1, "Fixture path changed: " + path
    start = document.index(marker)
    end = document.find("\n  /", start + len(marker))
    return document[start:end + 1] if end >= 0 else document[start:]


def main():
    yaml_path = ROOT / "openapi" / "portal.yaml"
    original = yaml_path.read_text()
    start = original.index("  /cohorts/{code}/participation:\n")
    end = original.index("  /cohorts/{code}/pending-preview:\n", start)
    block = original[start:end]
    scopes = "      x-portal-authorization-scopes:\n        - portal/access\n"
    security = "      security:\n        - PortalJwt: []\n"
    native = (MODULE / "tests" / "routes.tftest.hcl").read_text()
    marker = 'run "openapi_routes" {'
    assert native.count(marker) == 1
    mock_setup = native.split(marker)[0]
    assert 'mock_provider "aws"' in mock_setup and 'mock_provider "archive"' in mock_setup
    route_hash = 'sha256(jsonencode(sort(concat([aws_apigatewayv2_route.me.route_key], keys(aws_apigatewayv2_route.portal)))))'

    def change(part):
        return replace_once(original, block, part)

    added = replace_once(block, "/participation:", "/api2-test:")
    added = replace_once(added, "operationId: setParticipation", "operationId: api2Test")
    public = replace_once(replace_once(block, scopes, ""), security, "      security: []\n")
    metadata = replace_once(block, "    post:\n",
                            "    parameters: []\n    summary: Fixture\n    description: Fixture\n"
                            "    servers: []\n    x-fixture: {get: ignored}\n    post:\n")
    cases = [
        ("A_add", change(block + added), 36,
         'aws_apigatewayv2_route.portal["POST /cohorts/{code}/api2-test"].route_key == "POST /cohorts/{code}/api2-test"', False, True),
        ("B_remove", change(""), 34,
         '!contains(keys(aws_apigatewayv2_route.portal), "' + KEY + '")', False, True),
        ("C_method", change(replace_once(block, "    post:\n", "    get:\n")), 35,
         '!contains(keys(aws_apigatewayv2_route.portal), "' + KEY + '") && contains(keys(aws_apigatewayv2_route.portal), "GET /cohorts/{code}/participation")', False, True),
        ("D_scope", change(replace_once(block, scopes, "")), 35,
         RESOURCE + '.authorization_type == "JWT" && length(' + RESOURCE + '.authorization_scopes) == 0', False, True),
        ("E_public", change(public), 35,
         RESOURCE + '.authorization_type == "NONE" && ' + RESOURCE + '.authorizer_id == null && length(' + RESOURCE + '.authorization_scopes) == 0', False, True),
        ("F_metadata", change(metadata), 35, route_hash + ' == "' + BASELINE_HASH + '"', False, False),
        ("G_operation_id", change(replace_once(block, "operationId: setParticipation", "operationId: changeParticipation")),
         35, route_hash + ' == "' + BASELINE_HASH + '"', False, False),
        ("H_invalid_key", change(replace_once(block, "/participation:", "/bad path:")), 35, None, True, False),
        ("I_unknown_security", change(replace_once(block, "        - PortalJwt: []", "        - UnknownJwt: []")),
         35, None, True, False),
        ("J_inherited_security", replace_once(change(replace_once(block, security, "")), "paths:\n", "security:\n  - PortalJwt: []\npaths:\n"),
         35, RESOURCE + '.authorization_type == "JWT" && ' + RESOURCE + '.authorization_scopes == toset(["portal/access"])', False, False),
    ]
    extra = ""
    for method in ("put", "patch", "delete", "head", "options"):
        part = replace_once(added, "    post:\n", "    " + method + ":\n")
        part = replace_once(part, "/api2-test:", "/api2-" + method + ":")
        part = replace_once(part, "operationId: api2Test", "operationId: api2" + method.title())
        extra += part
    cases.append(("K_http_methods", change(block + extra), 40,
                  'alltrue([for method in ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] : contains(keys(aws_apigatewayv2_route.portal), "${method} /cohorts/{code}/api2-${lower(method)}")])',
                  False, False))

    entry_name = "openapi/src/portal.yaml"
    domain_name = "openapi/src/domains/cohorts.yaml"
    entry = (ROOT / entry_name).read_text()
    domain = (ROOT / domain_name).read_text()
    domain_block = path_item(domain, "/cohorts/{code}/participation")
    entry_block = path_item(entry, "/cohorts/{code}/participation")
    source_added = replace_once(domain_block, "/participation:", "/api2-test:")
    source_added = replace_once(source_added, "operationId: setParticipation", "operationId: api2Test")
    source_extra = ""
    entry_extra = ""
    for method in ("put", "patch", "delete", "head", "options"):
        part = replace_once(source_added, "    post:\n", "    " + method + ":\n")
        part = replace_once(part, "/api2-test:", "/api2-" + method + ":")
        source_extra += replace_once(part, "operationId: api2Test", "operationId: api2" + method.title())
        ref = replace_once(entry_block, "/participation:", "/api2-" + method + ":")
        entry_extra += replace_once(ref, "~1participation", "~1api2-" + method)
    source_changes = {
        "A_add": domain_block + source_added,
        "B_remove": "",
        "C_method": replace_once(domain_block, "    post:\n", "    get:\n"),
        "D_scope": replace_once(domain_block, scopes, ""),
        "E_public": replace_once(replace_once(domain_block, scopes, ""), security, "      security: []\n"),
        "F_metadata": replace_once(domain_block, "    post:\n",
                                   "    parameters: []\n    summary: Fixture\n    description: Fixture\n"
                                   "    servers: []\n    x-fixture: {get: ignored}\n    post:\n"),
        "G_operation_id": replace_once(domain_block, "operationId: setParticipation", "operationId: changeParticipation"),
        "J_inherited_security": replace_once(domain_block, security, ""),
        "K_http_methods": domain_block + source_extra,
    }
    source_cases = []
    for name, _, count, condition, guard, rejects_baseline in cases:
        if name not in source_changes:  # H/I remain direct mutations to exercise Terraform's own guards.
            continue
        changed_entry = entry
        if name == "A_add":
            added_ref = replace_once(replace_once(entry_block, "/participation:", "/api2-test:"),
                                     "~1participation", "~1api2-test")
            changed_entry = replace_once(entry, entry_block, entry_block + added_ref)
        elif name == "B_remove":
            changed_entry = replace_once(entry, entry_block, "")
        elif name == "J_inherited_security":
            changed_entry = replace_once(entry, "paths:\n", "security:\n  - PortalJwt: []\npaths:\n")
        elif name == "K_http_methods":
            changed_entry = replace_once(entry, entry_block, entry_block + entry_extra)
        changed_domain = replace_once(domain, domain_block, source_changes[name])
        source_cases.append((name, {entry_name: changed_entry, domain_name: changed_domain},
                             count, condition, guard, rejects_baseline))

    sources = [yaml_path] + openapi_inputs() + sorted(MODULE.glob("*.tf")) + [MODULE / "tests" / "routes.tftest.hcl"]
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    providers = MODULE / ".terraform" / "providers"
    assert providers.is_dir(), "Run terraform init -backend=false before the mutation suite"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("AWS_", "TF_VAR_", "TF_CLI_ARGS")) and k not in ("TF_DATA_DIR", "TF_WORKSPACE")}
    env.update(AWS_EC2_METADATA_DISABLED="true", TF_IN_AUTOMATION="true", TF_INPUT="false")
    passed = rejected = 0
    try:
        with tempfile.TemporaryDirectory(prefix="portal-api2-") as folder:
            project = Path(folder)
            module = project / "infra" / "terraform"
            (module / "tests").mkdir(parents=True)
            (module / ".terraform").mkdir()
            (module / ".terraform" / "providers").symlink_to(providers.resolve(), target_is_directory=True)
            for path in MODULE.iterdir():
                if path.is_file() and (path.suffix in (".tf", ".json", ".tftpl") or path.name == ".terraform.lock.hcl"):
                    # Never copy .tfvars.json despite its suffix.
                    if not path.name.endswith(".tfvars.json"):
                        shutil.copyfile(path, module / path.name)
            for name in ("backend", "frontend"):
                (project / name).symlink_to(ROOT / name, target_is_directory=True)
            (project / "openapi").mkdir()
            copy_openapi_sources(project)
            bundle_openapi(project, env)
            assert (project / "openapi" / "portal.yaml").read_bytes() == yaml_path.read_bytes(), "Clean source bundle diverged"
            (module / "tests" / "routes.tftest.hcl").write_text(native)

            def run(file):
                return subprocess.run(
                    ["terraform", "-chdir=" + str(module), "test", "-no-color", "-filter=tests/" + file],
                    env=env, text=True, capture_output=True, timeout=90,
                )

            for kind, candidate in [("bundle", case) for case in cases] + [("source", case) for case in source_cases]:
                name, source, count, condition, guard, rejects_baseline = candidate
                if kind == "source":
                    copy_openapi_sources(project)
                    for relative, content in source.items():
                        (project / relative).write_text(content)
                    bundle_openapi(project, env)
                else:
                    (project / "openapi" / "portal.yaml").write_text(source)
                label = kind + ":" + name
                body = mock_setup + '\nrun "mutation" {\n  command = plan\n'
                if guard:
                    body += "  expect_failures = [aws_apigatewayv2_route.me, aws_apigatewayv2_route.portal]\n"
                else:
                    body += assertion("length(local.routes) == " + str(count) + " && length(aws_apigatewayv2_route.portal) == " + str(count - 1), "Unexpected route count")
                    body += assertion(condition, "Mutation was not reflected in evaluated resources")
                    body += assertion('aws_apigatewayv2_route.me.route_key == "GET /me" && !contains(keys(aws_apigatewayv2_route.portal), "GET /me")', "Historical me address changed")
                    body += assertion('alltrue([for route in concat([aws_apigatewayv2_route.me], values(aws_apigatewayv2_route.portal)) : route.target == "integrations/integration-test" && route.api_id == "api-test" && (route.authorization_type == "JWT" ? route.authorizer_id == "authorizer-test" : route.authorizer_id == null)])', "Environment integration or authorizer changed")
                body += "}\n"
                (module / "tests" / "mutation.tftest.hcl").write_text(body)
                result = run("mutation.tftest.hcl")
                assert result.returncode == 0 and "1 passed, 0 failed" in result.stdout, label + "\n" + result.stdout + result.stderr
                passed += 1
                if rejects_baseline:
                    baseline = run("routes.tftest.hcl")
                    assert baseline.returncode != 0 and "Test assertion failed" in baseline.stderr + baseline.stdout, label + ": baseline failed for the wrong reason\n" + baseline.stdout + baseline.stderr
                    rejected += 1
                print(label + ": PASS" + (" (guard refused the invalid contract)" if guard else " (evaluated resources verified)"), flush=True)
    finally:
        assert {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources} == hashes, "Original sources changed"
    print(str(passed) + " mutation scenarios passed (11 direct bundle + 9 regenerated source); " + str(rejected) + " expected baseline rejections; original SHA-256 unchanged")


if __name__ == "__main__":
    main()

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "playwright-core/lib/utilsBundle";
import { parseContract, validateStructure } from "./contracts/openapi.mjs";
import { equivalentContracts } from "./contracts/openapi_equivalence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/bundle_openapi.mjs");
const committed = readFileSync(join(root, "openapi/portal.yaml"), "utf8");
const source = "openapi/src/portal.yaml";
const serialized = (value) => yaml.yaml.stringify(value, { lineWidth: 100 });

function fixture(run) {
  const folder = mkdtempSync(join(tmpdir(), "portal-bundle-test-"));
  cpSync(join(root, "openapi"), join(folder, "openapi"), { recursive: true });
  try { return run(folder); } finally { rmSync(folder, { recursive: true, force: true }); }
}
function command(folder, check = false, options = {}) {
  return spawnSync(process.execPath, [script, "--root", folder, ...(check ? ["--check"] : [])], {
    cwd: options.cwd ?? folder, encoding: "utf8", env: { ...process.env, ...options.env }, timeout: 30000,
  });
}
const log = (result) => `${result.stdout}${result.stderr}`;
function success(result) { assert.equal(result.error, undefined); assert.equal(result.status, 0, log(result)); }
function edit(folder, path, mutate) {
  const file = join(folder, path), data = parseContract(readFileSync(file, "utf8"));
  mutate(data); writeFileSync(file, serialized(data));
}
function unchangedAfterFailure(folder, pattern) {
  const before = readFileSync(join(folder, "openapi/portal.yaml"));
  for (const check of [false, true]) {
    const result = command(folder, check);
    assert.notEqual(result.status, 0, "invalid source must fail even with an old valid bundle");
    assert.match(log(result), pattern);
    assert.deepEqual(readFileSync(join(folder, "openapi/portal.yaml")), before, "failure must preserve the previous bundle");
  }
}

test("bundle: valid OpenAPI, direct Terraform path items and only local component references", () => fixture((folder) => {
  success(command(folder, true));
  validateStructure(parseContract(committed));
  assert.match(committed, /^# Gerado por npm run openapi:bundle\./);
  assert.doesNotMatch(committed, /\r/);
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.$ref) assert.match(value.$ref, /^#\/components\//);
    Object.values(value).forEach(walk);
  };
  walk(parseContract(committed));
}));

test("bundle: identical UTF-8/LF bytes across repetitions, roots and working directories, offline", () => fixture((folder) => {
  const other = join(folder, "outra cópia");
  cpSync(join(folder, "openapi"), join(other, "openapi"), { recursive: true });
  const guard = join(folder, "no-network.mjs");
  writeFileSync(guard, 'import net from "node:net"; net.Socket.prototype.connect = function () { throw new Error("Network is forbidden during local OpenAPI generation"); };\n');
  const options = { cwd: dirname(folder), env: { NODE_OPTIONS: `--import=${pathToFileURL(guard).href}` } };
  for (const destination of [folder, folder, other]) {
    success(command(destination, false, options));
    assert.equal(readFileSync(join(destination, "openapi/portal.yaml"), "utf8"), committed);
  }
}));

test("bundle: remote references fail before HTTP access and preserve the versioned output in both modes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "portal-bundle-offline-test-"));
  cpSync(join(root, "openapi"), join(folder, "openapi"), { recursive: true });
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "Content-Type": "application/yaml" });
    response.end("OfflineOnly:\n  type: object\n  properties:\n    remote:\n      type: string\n");
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    edit(folder, "openapi/src/domains/access.yaml", (c) => {
      c.paths["/me"].get.responses["200"] = { description: "Offline boundary fixture", content: {
        "application/json": { schema: { $ref: `http://127.0.0.1:${server.address().port}/schema.yaml#/OfflineOnly` } },
      } };
    });
    const before = readFileSync(join(folder, "openapi/portal.yaml"));
    for (const check of [false, true]) {
      requests = 0;
      // Keep the loopback server responsive: a synchronous child would conceal HTTP requests.
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, "--root", folder, ...(check ? ["--check"] : [])], {
          cwd: folder, env: process.env, timeout: 15000,
        });
        let stdout = "", stderr = "";
        child.stdout.on("data", (data) => { stdout += data; });
        child.stderr.on("data", (data) => { stderr += data; });
        child.once("error", reject);
        child.once("close", (status) => resolve({ status, stdout, stderr }));
      });
      assert.equal(requests, 0, "remote references must not reach even the loopback HTTP server");
      assert.notEqual(result.status, 0, "remote references must fail before replacing the bundle");
      assert.match(log(result), /Referências de rede não são permitidas/);
      assert.deepEqual(readFileSync(join(folder, "openapi/portal.yaml")), before);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  }
});

test("check: changed source refuses stale bundle without rewriting it; explicit generation fixes it", () => fixture((folder) => {
  edit(folder, source, (c) => { c.info.description += " Revisão intencional de teste."; });
  const result = command(folder, true);
  assert.notEqual(result.status, 0); assert.match(log(result), /npm run openapi:bundle/);
  assert.equal(readFileSync(join(folder, "openapi/portal.yaml"), "utf8"), committed);
  success(command(folder)); success(command(folder, true));
  assert.notEqual(readFileSync(join(folder, "openapi/portal.yaml"), "utf8"), committed);
}));

test("check: direct bundle tampering is refused and never silently regenerated", () => fixture((folder) => {
  const altered = committed + "# edição manual\n";
  writeFileSync(join(folder, "openapi/portal.yaml"), altered);
  const result = command(folder, true);
  assert.notEqual(result.status, 0); assert.match(log(result), /npm run openapi:bundle/);
  assert.equal(readFileSync(join(folder, "openapi/portal.yaml"), "utf8"), altered);
}));

test("check: missing versioned bundle fails without creating it", () => fixture((folder) => {
  unlinkSync(join(folder, "openapi/portal.yaml"));
  const result = command(folder, true);
  assert.notEqual(result.status, 0); assert.match(log(result), /ausente ou desatualizado/);
  assert.equal(existsSync(join(folder, "openapi/portal.yaml")), false);
}));

test("bundle: missing referenced file fails and preserves the existing output", () => fixture((folder) => {
  unlinkSync(join(folder, "openapi/src/domains/feedback.yaml"));
  unchangedAfterFailure(folder, /feedback.yaml|resolve|ENOENT/i);
}));

test("bundle: unresolved JSON pointer fails and preserves the existing output", () => fixture((folder) => {
  edit(folder, source, (c) => { c.paths["/me"].$ref = "./domains/access.yaml#/paths/absent"; });
  unchangedAfterFailure(folder, /resolve|absent/i);
}));

test("bundle: duplicate operation keys fail instead of last-key-wins", () => fixture((folder) => {
  const file = join(folder, "openapi/src/domains/access.yaml");
  writeFileSync(file, readFileSync(file, "utf8") + "  /me: {}\n");
  unchangedAfterFailure(folder, /duplicat|mapping key/i);
}));

test("bundle: duplicate component keys fail instead of silently replacing schemas", () => fixture((folder) => {
  const file = join(folder, "openapi/src/components/schemas.yaml");
  writeFileSync(file, readFileSync(file, "utf8") + "ErrorResponse:\n  type: string\n");
  unchangedAfterFailure(folder, /duplicat|mapping key/i);
}));

test("bundle: duplicate operationIds fail before replacing the existing output", () => fixture((folder) => {
  edit(folder, "openapi/src/domains/access.yaml", (c) => {
    c.paths["/cohorts/{code}/display-name"].post.operationId = c.paths["/access-request"].post.operationId;
  });
  unchangedAfterFailure(folder, /unique.*operationId|operation-operationId-unique/i);
}));

test("bundle: conflicting imported component names fail; no automatic renaming", () => fixture((folder) => {
  for (const [file, type] of [["left", "string"], ["right", "integer"]])
    writeFileSync(join(folder, `openapi/src/components/${file}.yaml`), serialized({ Shared: { type } }));
  edit(folder, "openapi/src/domains/access.yaml", (c) => {
    c.paths["/me"].get.responses["200"] = { description: "Collision fixture", content: {
      "application/json": { schema: { oneOf: ["left", "right"].map((name) => ({ $ref: `../components/${name}.yaml#/Shared` })) } },
    } };
  });
  unchangedAfterFailure(folder, /conflict|renam|same name/i);
}));

test("bundle: recursive schemas remain finite local refs and unused components are retained", () => fixture((folder) => {
  edit(folder, "openapi/src/components/schemas.yaml", (c) => {
    c.Recursive = { type: "object", properties: { child: { $ref: "./schemas.yaml#/Recursive" } } };
    c.Unused = { type: "string", description: "Not referenced by an operation; must remain." };
  });
  edit(folder, source, (c) => {
    for (const name of ["Recursive", "Unused"]) c.components.schemas[name] = { $ref: `./components/schemas.yaml#/${name}` };
  });
  success(command(folder));
  const c = parseContract(readFileSync(join(folder, "openapi/portal.yaml"), "utf8"));
  assert.equal(c.components.schemas.Recursive.properties.child.$ref, "#/components/schemas/Recursive");
  assert.equal(c.components.schemas.Unused.description, "Not referenced by an operation; must remain.");
  validateStructure(c);
}));

test("equivalence: complete generated tree equals the versioned tree without ignoring fields", () => fixture((folder) => {
  success(command(folder));
  equivalentContracts(committed, readFileSync(join(folder, "openapi/portal.yaml"), "utf8"));
  const c = parseContract(committed);
  equivalentContracts(committed, serialized(Object.fromEntries(Object.entries(c).reverse())));
}));

const changes = [
  ["schema limit", (c) => { c.components.schemas.ParticipationRequest.properties.canvasId.maxLength++; }],
  ["required", (c) => { c.components.schemas.ParticipationRequest.required.pop(); }],
  ["enum", (c) => { c.components.schemas.ParticipationRequest.properties.status.enum.pop(); }],
  ["false versus absence", (c) => { delete c.components.schemas.ParticipationRequest.additionalProperties; }],
  ["null versus false", (c) => { c.components.schemas.ParticipationResponse.properties.updatedAt.nullable = null; }],
  ["authentication", (c) => { c.paths["/me"].get.security = []; }],
  ["scope", (c) => { c.paths["/me"].get["x-portal-authorization-scopes"] = []; }],
  ["request body", (c) => { c.paths["/access-request"].post.requestBody.required = true; }],
  ["response", (c) => { delete c.paths["/me"].get.responses["401"]; }],
  ["parameter", (c) => { c.paths["/cohorts/{code}/participation"].post.parameters[0].required = false; }],
  ["operationId", (c) => { c.paths["/me"].get.operationId += "Changed"; }],
  ["extension", (c) => { c.paths["/me"].get["x-portal-backend-operation"] = "Portal.other"; }],
  ["editorial metadata", (c) => { c.info.description += " Changed."; }],
];
for (const [name, mutate] of changes) test(`equivalence: detects ${name} changes`, () => {
  const changed = parseContract(committed); mutate(changed);
  assert.throws(() => equivalentContracts(committed, serialized(changed)), /OpenAPI contract changed/);
});

test("CI: bundle check precedes consumers inside existing required checks", () => {
  const ci = parseContract(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
  assert.deepEqual(Object.values(ci.jobs).map((job) => job.name).sort(), [
    "Backend (Python + Moto)", "Frontend (Node + Playwright)",
    "Terraform (fmt, validate, test)", "Bootstrap do deploy do frontend (fmt, validate, test)",
  ].sort());
  for (const [name, consumer] of [["python", "python -m unittest discover -s backend"], ["node", "npm test"], ["terraform", "terraform validate"]]) {
    const steps = ci.jobs[name].steps;
    const check = steps.findIndex((step) => step.run === "npm run openapi:check");
    const install = steps.findIndex((step) => step.run === "npm ci");
    assert.ok(install >= 0 && check > install && check < steps.findIndex((step) => step.run === consumer));
    if (name === "terraform") assert.equal(steps[check]["working-directory"], "../..");
  }
});

test("tool: pinned dev dependency; no runtime npm dependency or unpinned npx download", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.match(pkg.devDependencies["@redocly/cli"], /^\d+\.\d+\.\d+$/);
  assert.equal(lock.packages["node_modules/@redocly/cli"].version, pkg.devDependencies["@redocly/cli"]);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts["openapi:bundle"], "node scripts/bundle_openapi.mjs");
  assert.equal(pkg.scripts["openapi:check"], "node scripts/bundle_openapi.mjs --check");
});

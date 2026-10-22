import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { read, root, frontendRoutes, backendRoutes } from "./contracts/sources.mjs";
import { parseContract, operations, validateStructure, validateBaselineSecurity, compareFrontend, compareBackend } from "./contracts/openapi.mjs";

const contract = parseContract();
const frontend = await frontendRoutes();
const backend = backendRoutes();
const participationPath = "/cohorts/{code}/participation";
const copy = () => structuredClone(contract);
const fingerprint = () => ["openapi/portal.yaml", "infra/terraform/api.tf", "frontend/api.js", "backend/portal.py"]
  .map((path) => [path, createHash("sha256").update(read(path)).digest("hex")]);
const originalHashes = fingerprint();

test("OpenAPI 3.0.3: metadata, references, operationIds, parameters, responses and security", () => validateStructure(contract));
test("OpenAPI counts exactly 35 HTTP operations; metadata is not a method", () => {
  assert.equal(operations(contract).length, 35);
  assert.equal(backend.length, 35);
  const c = copy();
  c.paths["/me"].summary = "Metadata";
  c.paths["/me"]["x-note"] = true;
  c.paths["/me"].parameters = [];
  assert.equal(operations(c).length, 35);
});
test("OpenAPI ↔ backend: exact methods and path parameter names", () => {
  assert.deepEqual(operations(contract).map((r) => r.signature).sort(), backend.map((r) => r.signature).sort());
});
test("OpenAPI baseline requires JWT and portal/access; Terraform equivalence runs in native tests", () => validateBaselineSecurity(contract));
test("Every frontend Portal API call has an OpenAPI operation", () => compareFrontend(contract, frontend));
test("OpenAPI ↔ all public backend dispatchers and operation mapping", () => compareBackend(contract, backend));
test("Participation preserves exact request fields, statuses and nullable no-record timestamp", () => {
  const request = contract.components.schemas.ParticipationRequest;
  assert.deepEqual(request.required, ["canvasId", "status", "expectedStatus"]);
  assert.equal(request.additionalProperties, false);
  assert.equal(request.properties.canvasId.type, "string");
  for (const key of ["status", "expectedStatus"]) assert.deepEqual(request.properties[key].enum, ["ACTIVE", "WITHDRAWN"]);
  assert.equal(contract.components.schemas.ParticipationResponse.properties.updatedAt.nullable, true);
  const op = contract.paths[participationPath].post;
  assert.equal(op.requestBody.content["application/json"].schema.$ref, "#/components/schemas/ParticipationRequest");
  for (const status of ["200", "400", "401", "403", "404", "409", "500"]) assert(op.responses[status]);
});
test("Canvas report describes additive per-field provenance without changing access or route contracts", () => {
  const schemas = contract.components.schemas;
  const report = contract.paths["/cohorts/{code}/report"].get;
  assert.equal(report.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/CohortReport");
  assert.equal(schemas.CohortReport.required, undefined);
  assert.equal(schemas.CanvasActivity.required, undefined); // backend anterior e registros legados
  assert.equal(schemas.CanvasActivity.properties.totalActivityTime.minimum, 0);
  assert.equal(schemas.CanvasActivity.properties.totalActivityTime.nullable, true);
  assert.equal(schemas.CanvasActivity.properties.collectedAt.nullable, true);
  for (const key of ["totalActivityTime", "lastActivityAt"])
    assert.equal(schemas.CanvasActivity.properties.provenance.properties[key].$ref, "#/components/schemas/CanvasActivityProvenance");
  assert.deepEqual(schemas.CanvasActivityProvenance.properties.status.enum, ["current", "retained", "unknown"]);
  for (const key of ["observedAt", "referenceAt", "attemptedAt", "lastValidObservedAt"])
    assert.equal(schemas.CanvasActivityProvenance.properties[key].nullable, true);
  assert.deepEqual(schemas.CanvasEngagement.properties.status.enum, ["complete", "partial", "failed", "legacy"]);
  assert.deepEqual(report.security, [{ PortalJwt: [] }]);
  assert.deepEqual(report["x-portal-authorization-scopes"], ["portal/access"]);
});
test("Contract contains no environment IDs, servers, contact data or credential examples", () => {
  const source = read("openapi/portal.yaml");
  assert.equal(contract.servers, undefined);
  assert.doesNotMatch(source, /arn:aws|amazonaws\.com|cloudfront\.net|\b\d{12}\b|us-east-1_[A-Za-z0-9]+|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{20,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(source, /^\s*(example|examples|clientSecret|clientId|Authorization):/m);
});
test("YAML duplicate keys are rejected", () => assert.throws(() => parseContract("openapi: 3.0.3\nopenapi: 3.0.3\n"), /Invalid YAML/));

const mutations = [
  ["A / participation missing", (c) => { delete c.paths[participationPath]; }, (c) => compareBackend(c, backend), /route mismatch/],
  ["B / ghost route", (c) => { c.paths["/ghost"] = structuredClone(c.paths["/me"]); c.paths["/ghost"].get.operationId = "ghost"; }, (c) => compareBackend(c, backend), /route mismatch/],
  ["C / participation changed to GET", (c) => { c.paths[participationPath].get = c.paths[participationPath].post; delete c.paths[participationPath].post; }, (c) => compareBackend(c, backend), /route mismatch/],
  ["D / wrong path, including parameter spelling", (c) => { c.paths["/cohorts/{cohort}/participation"] = c.paths[participationPath]; delete c.paths[participationPath]; }, (c) => compareBackend(c, backend), /route mismatch/],
  ["E / duplicate operationId", (c) => { c.paths[participationPath].post.operationId = c.paths["/me"].get.operationId; }, validateStructure, /Duplicate operationId/],
  ["F / undeclared path parameter", (c) => { c.paths[participationPath].post.parameters = []; }, validateStructure, /Path parameter mismatch/],
  ["G / JWT route becomes public", (c) => { c.paths[participationPath].post.security = []; c.paths[participationPath].post["x-portal-authorization-scopes"] = []; }, (c) => validateBaselineSecurity(c), /Security mismatch/],
  ["H / portal\/access removed", (c) => { c.paths[participationPath].post["x-portal-authorization-scopes"] = []; }, (c) => validateBaselineSecurity(c), /Security mismatch/],
];
for (const [name, mutate, validate, failure] of mutations) {
  test("Mutation " + name + " is detected; source hashes stay unchanged", () => {
    const changed = copy();
    mutate(changed);
    assert.throws(() => validate(changed), failure);
    assert.deepEqual(fingerprint(), originalHashes);
  });
}
test("Mutation I / new frontend call without OpenAPI is detected", async () => {
  const source = read("frontend/api.js").replace('"./auth.js"', JSON.stringify(new URL("frontend/auth.js", root).href))
    + '\nexport const ghost = { get: () => request("/ghost") };\n';
  const routes = await frontendRoutes(new URL("data:text/javascript;base64," + Buffer.from(source).toString("base64")));
  assert.throws(() => compareFrontend(contract, routes), /Frontend route missing from OpenAPI: GET \/ghost/);
  assert.deepEqual(fingerprint(), originalHashes);
});
test("Mutation J / new backend public operation without OpenAPI is detected", () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-openapi-"));
  try {
    const path = join(directory, "portal.py");
    const source = read("backend/portal.py").replace('        if method == "GET" and path == "/me":',
      '        if method == "GET" and path == "/ghost":\n            return self.me()\n        if method == "GET" and path == "/me":');
    assert.notEqual(source, read("backend/portal.py"));
    writeFileSync(path, source);
    assert.throws(() => compareBackend(contract, backendRoutes(pathToFileURL(path))), /OpenAPI\/backend route mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(fingerprint(), originalHashes);
});
test("Wrong backend handler is detected even when method/path exist", () => {
  const c = copy();
  c.paths[participationPath].post["x-portal-backend-operation"] = "Portal._report";
  assert.throws(() => compareBackend(c, backend), /Backend operation mapping mismatch/);
});
test("API-2 mutation G: valid operationId rename preserves route keys and backend mapping", () => {
  const c = copy();
  c.paths[participationPath].post.operationId = "changeParticipation";
  validateStructure(c);
  compareBackend(c, backend);
  assert.deepEqual(operations(c).map((r) => r.signature), operations(contract).map((r) => r.signature));
  assert.deepEqual(fingerprint(), originalHashes);
});

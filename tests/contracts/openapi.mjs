import assert from "node:assert/strict";
// Reuse the YAML parser already shipped by the pinned Playwright dev dependency.
// Keep this adapter isolated: an upgrade that removes it must fail, not parse YAML by hand.
import bundle from "playwright-core/lib/utilsBundle";
import { read, signature } from "./sources.mjs";

export const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
export function parseContract(source = read("openapi/portal.yaml")) {
  const document = bundle.yaml.parseDocument(source, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, "Invalid YAML: " + document.errors.map((e) => e.message).join("; "));
  return document.toJS({ maxAliasCount: 0 });
}

export function resolve(contract, value) {
  if (!value?.$ref) return value;
  assert.match(value.$ref, /^#\/components\//, "Only local component references are used in API-1");
  const result = value.$ref.slice(2).split("/").reduce((v, k) => v?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], contract);
  assert(result, "Unresolved reference: " + value.$ref);
  return result;
}

export function operations(contract) {
  return Object.entries(contract.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => HTTP_METHODS.has(method)).map(([method, operation]) =>
      ({ signature: signature(method, path), method, path, item, operation })));
}

export function authorization(contract, operation) {
  const security = operation.security ?? contract.security ?? [];
  const scopes = operation["x-portal-authorization-scopes"] ?? [];
  assert(Array.isArray(security) && Array.isArray(scopes), "Invalid security declarations");
  assert(scopes.every((s) => typeof s === "string" && s.length > 0), "Invalid authorization scope");
  assert.equal(new Set(scopes).size, scopes.length, "Duplicate authorization scope");
  if (security.length === 0) {
    assert.equal(scopes.length, 0, "Public operation cannot require JWT scopes");
    return { authorization: "NONE", scopes: [] };
  }
  assert.deepEqual(security, [{ PortalJwt: [] }], "Unexpected security requirement or anonymous alternative");
  const scheme = contract.components?.securitySchemes?.PortalJwt;
  assert(scheme?.type === "http" && scheme.scheme === "bearer" && scheme.bearerFormat === "JWT", "Invalid PortalJwt scheme");
  return { authorization: "JWT", scopes: [...scopes].sort() };
}

export function validateStructure(contract) {
  assert.equal(contract.openapi, "3.0.3", "OpenAPI version");
  assert.equal(contract.info?.title, "Escola da Nuvem Portal API");
  assert.match(contract.info?.version ?? "", /^\d+\.\d+\.\d+$/, "Semantic contract version");
  assert(contract.info?.description && contract.paths && Object.keys(contract.paths).length, "Required metadata");
  const ids = new Set();
  const tags = new Set(contract.tags.map((t) => t.name));
  for (const [path, item] of Object.entries(contract.paths)) {
    assert.match(path, /^\/[^?#]*$/);
    for (const key of Object.keys(item)) {
      assert(HTTP_METHODS.has(key) || ["parameters", "summary", "description"].includes(key) || key.startsWith("x-"), "Unknown path item key: " + key);
    }
  }
  for (const { path, item, operation: op } of operations(contract)) {
    assert.match(op.operationId ?? "", /^[A-Za-z][A-Za-z0-9]*$/, "Missing or invalid operationId");
    assert(!ids.has(op.operationId), "Duplicate operationId: " + op.operationId);
    ids.add(op.operationId);
    assert.match(op["x-portal-backend-operation"] ?? "", /^(Portal\.[a-z_]+|class_report)$/);
    assert(op.tags?.length && op.tags.every((tag) => tags.has(tag)), "Undeclared operation tag");
    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => resolve(contract, p));
    assert.equal(new Set(parameters.map((p) => p.in + ":" + p.name)).size, parameters.length, "Duplicate parameter");
    const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(parameters.filter((p) => p.in === "path").map((p) => p.name).sort(), placeholders, "Path parameter mismatch: " + path);
    for (const p of parameters) {
      assert(["path", "query", "header", "cookie"].includes(p.in) && p.name && p.schema, "Invalid parameter");
      if (p.in === "path") assert.equal(p.required, true, "Path parameter must be required");
    }
    assert(op.responses && Object.keys(op.responses).length > 0, "Missing responses");
    for (const [status, value] of Object.entries(op.responses)) {
      assert.match(status, /^(default|[1-5][0-9]{2})$/, "Invalid HTTP response code");
      const response = resolve(contract, value);
      assert(typeof response.description === "string" && response.description.length, "Response description required");
      for (const media of Object.values(response.content ?? {})) assert(media.schema, "Response schema required when content is documented");
    }
    if (op.requestBody) {
      const body = resolve(contract, op.requestBody);
      assert(body.content?.["application/json"]?.schema, "JSON request schema required");
      assert.equal(typeof body.required, "boolean");
    }
    authorization(contract, op);
  }
  const checkedSchemas = new Set();
  function validateSchema(value) {
    assert(value && typeof value === "object" && !Array.isArray(value), "Schema must be an OpenAPI object");
    const schema = resolve(contract, value);
    if (checkedSchemas.has(schema)) return;
    checkedSchemas.add(schema);
    if (schema.type !== undefined) assert(["object", "array", "string", "integer", "number", "boolean"].includes(schema.type), "OpenAPI 3.0 schema type");
    if (schema.type === "array") {
      assert(schema.items, "Array items required");
      validateSchema(schema.items);
    }
    if (schema.nullable !== undefined) assert.equal(typeof schema.nullable, "boolean");
    if (schema.required !== undefined) {
      assert(Array.isArray(schema.required) && schema.required.length > 0);
      assert.equal(new Set(schema.required).size, schema.required.length);
      for (const name of schema.required) assert(Object.hasOwn(schema.properties ?? {}, name), "Required field without property");
    }
    for (const property of Object.values(schema.properties ?? {})) validateSchema(property);
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") validateSchema(schema.additionalProperties);
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (schema[keyword] !== undefined) {
        assert(Array.isArray(schema[keyword]) && schema[keyword].length > 0);
        schema[keyword].forEach(validateSchema);
      }
    }
    if (schema.enum !== undefined) assert(Array.isArray(schema.enum) && schema.enum.length > 0);
    if (schema.pattern !== undefined) assert.doesNotThrow(() => new RegExp(schema.pattern));
  }
  Object.values(contract.components?.schemas ?? {}).forEach(validateSchema);
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref) resolve(contract, value);
    if (value.schema) validateSchema(value.schema);
    Object.values(value).forEach(walk);
  }
  walk(contract);
}

const keys = (routes) => [...new Set(routes.map((r) => r.signature))].sort();
// Baseline policy remains explicit in tests; Terraform derives evaluated values in routes.tftest.hcl.
export function validateBaselineSecurity(contract) {
  for (const { signature: key, operation } of operations(contract)) {
    assert.deepEqual(authorization(contract, operation),
      { authorization: "JWT", scopes: ["portal/access"] }, "Security mismatch: " + key);
  }
}
export function compareFrontend(contract, routes) {
  const known = new Set(keys(operations(contract)));
  for (const route of routes) assert(known.has(route.signature), "Frontend route missing from OpenAPI: " + route.signature);
}
export function compareBackend(contract, routes) {
  assert.deepEqual(keys(operations(contract)), keys(routes), "OpenAPI/backend route mismatch");
  const byRoute = new Map(routes.map((r) => [r.signature, r.handler]));
  for (const { signature: key, operation } of operations(contract)) {
    assert.equal(operation["x-portal-backend-operation"], byRoute.get(key), "Backend operation mapping mismatch: " + key);
  }
}

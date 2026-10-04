import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = new URL("../../", import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), "utf8");
export const signature = (method, path) => {
  assert.match(path, /^\/[^?#]*$/, "Route path must preserve its literal template");
  return method.toUpperCase() + " " + path;
};

export function terraformRoutes(source = read("infra/terraform/api.tf")) {
  const routes = [];
  const blocks = [...source.matchAll(/^resource "aws_apigatewayv2_route" "(\w+)" \{([\s\S]*?)^\}/gm)];
  assert.equal(blocks.length, [...source.matchAll(/\bresource\s+"aws_apigatewayv2_route"/g)].length, "Review Terraform resource formatting");
  for (const match of blocks) {
    const [, resource, block] = match;
    const literal = block.match(/^\s*route_key\s*=\s*"([^"]+)"/m);
    const set = block.match(/for_each\s*=\s*toset\(\[([\s\S]*?)\]\)/);
    assert(literal || (set && /route_key\s*=\s*each\.value/.test(block)), "Review Terraform route expression");
    const keys = literal ? [literal[1]] : [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (set) assert.match(set[1].replace(/"[^"]+"/g, ""), /^[\s,]*$/, "Review Terraform route set");
    const authorization = block.match(/authorization_type\s*=\s*"([^"]+)"/);
    assert(authorization || !/authorization_type\s*=/.test(block), "Review Terraform authorization expression");
    const scopeMatch = block.match(/authorization_scopes\s*=\s*\[([^\]]*)\]/);
    assert(scopeMatch || !/authorization_scopes\s*=/.test(block), "Review Terraform scope expression");
    const scopeText = scopeMatch?.[1] || "";
    assert.match(scopeText.replace(/"[^"]+"/g, ""), /^[\s,]*$/);
    const scopes = [...scopeText.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      const [method, path, ...rest] = key.split(" ");
      assert.equal(rest.length, 0);
      routes.push({ signature: signature(method, path), authorization: authorization?.[1] || "NONE", scopes, resource });
    }
  }
  assert(routes.length > 0);
  assert.equal(new Set(routes.map((r) => r.signature)).size, routes.length, "Duplicate Terraform route");
  return routes;
}

export async function frontendRoutes(url = new URL("frontend/api.js", root)) {
  const api = await import(url.href);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network is forbidden during contract capture"); };
  let calls = [];
  api.setTransport(async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    return {};
  });
  const routes = [];
  try {
    for (const [group, object] of Object.entries(api)) {
      const excluded = new Set(["configure", "setTransport", "uploadAttachmentToS3", "signupConfirmation",
        "ACCOUNT_STATE_CATEGORIES", "SignupConfirmationError", "normalizeSignupEmail"]);
      if (excluded.has(group)) continue;
      assert(object && typeof object === "object" && !Array.isArray(object), "Review new frontend export: " + group);
      for (const [name, fn] of Object.entries(object)) {
        assert.equal(typeof fn, "function", "Review frontend API export");
        const args = fn.toString().match(/^\(([^)]*)\)\s*=>/);
        assert(args, "Review frontend function signature: " + group + "." + name);
        const parameters = args[1].split(",").map((s) => s.trim()).filter(Boolean);
        const inputs = parameters.map((parameter) => {
          if (parameter === "body" || parameter === "filters") return {};
          if (parameter === "cursor") return undefined;
          assert(["code", "userId", "feedbackId", "attachmentId"].includes(parameter), "Review new API argument: " + parameter);
          // The public dispatcher/Terraform name is id; the existing JS argument is feedbackId.
          const publicName = group === "adminFeedback" && name === "setStatus" && parameter === "feedbackId" ? "id" : parameter;
          return "__PATH_" + publicName + "__";
        });
        calls = [];
        await fn(...inputs);
        assert.equal(calls.length, 1, "Expected exactly one Portal API request: " + group + "." + name);
        const { method, path } = calls[0];
        const template = path.split("?")[0].replace(/__PATH_(\w+)__/g, "{$1}");
        routes.push({ signature: signature(method, template), frontend: group + "." + name });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    api.setTransport(() => { throw new Error("Contract capture ended; network is disabled"); });
  }
  return routes;
}

export function backendRoutes(path = new URL("backend/portal.py", root)) {
  const result = spawnSync("python3", [fileURLToPath(new URL("backend_routes.py", import.meta.url)), fileURLToPath(path)], { encoding: "utf8" });
  assert.equal(result.status, 0, "Backend route extraction failed:\n" + result.stderr);
  return JSON.parse(result.stdout).map((route) => ({ ...route, signature: signature(route.method, route.path) }));
}

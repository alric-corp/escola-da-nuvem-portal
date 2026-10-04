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

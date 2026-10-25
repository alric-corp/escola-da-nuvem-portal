// Regressões locais do kit manual. Nenhuma chamada externa ou credencial real.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readiness, verifyPublishedConfig } from "./live_readiness.mjs";
import { verifyStudentReport } from "./live_browser.mjs";

const rid = "0123456789ab-fedcba987654", sha = "0123456789abcdef0123456789abcdef01234567";
const config = { apiUrl: "https://api.example.test", region: "us-east-1" };
const outputs = { portal_url: "https://portal.example.test", frontend_config: config };
function fixture({ mode = "modern", legacy = false, changeHash = false } = {}) {
  const body = JSON.stringify(config), calls = [];
  const manifest = { release_id: rid, source_sha: sha, mode,
    files: [{ path: "config.json", sha256: createHash("sha256").update(body).digest("hex") }] };
  if (changeHash) manifest.files[0].sha256 = "0".repeat(64);
  const fetch = async (url) => {
    calls.push(String(url));
    const path = new URL(url).pathname;
    if (path === "/") return new Response(legacy ? "<html>legado</html>" : `<meta name="portal-release" content="${rid}" />`);
    if (path === `/releases/${rid}/manifest.json`) return Response.json(manifest);
    if (path === `/releases/${rid}/config.json` || path === "/config.json") return new Response(body);
    throw new Error(`Consulta inesperada: ${path}`);
  };
  return { fetch, calls, manifest };
}

test("QA manual: configuração moderna é da release ativa, sem ler a raiz legada", async () => {
  const f = fixture();
  const result = await verifyPublishedConfig(outputs, f.fetch);
  assert.equal(result.releaseId, rid);
  assert.equal(result.sourceSha, sha);
  assert.equal(result.configPath, `/releases/${rid}/config.json`);
  assert.equal(result.mode, "modern");
  assert.equal(f.calls.some((u) => new URL(u).pathname === "/config.json"), false);
});

test("QA manual: baseline e legado continuam usando a configuração da raiz", async () => {
  for (const options of [{ mode: "baseline" }, { legacy: true }]) {
    const f = fixture(options);
    assert.equal((await verifyPublishedConfig(outputs, f.fetch)).configPath, "/config.json");
  }
});

test("QA manual: manifesto/config divergentes ou indisponíveis não viram sucesso", async () => {
  const f = fixture({ changeHash: true });
  await assert.rejects(verifyPublishedConfig(outputs, f.fetch), /hash/i);
  const missing = fixture();
  await assert.rejects(verifyPublishedConfig(outputs, async (u) => String(u).endsWith("manifest.json") ? new Response("", { status: 404 }) : missing.fetch(u)), /manifesto/i);
  const changed = fixture();
  await assert.rejects(verifyPublishedConfig({ ...outputs, frontend_config: {} }, changed.fetch), /configuração/i);
  const invalid = fixture(); invalid.manifest.mode = "unrecognized";
  await assert.rejects(verifyPublishedConfig(outputs, invalid.fetch), /modo/i);
  const wrongId = fixture(); wrongId.manifest.release_id = "other";
  await assert.rejects(verifyPublishedConfig(outputs, wrongId.fetch), /release/i);
});

test("QA manual: aluno tem relatório próprio e class-report permanece 403", async () => {
  const calls = [];
  const api = async (path, body, status = 200) => {
    calls.push({ path, body, status });
    return path.endsWith("/report") ? { student: { id: "101" } } : {};
  };
  await verifyStudentReport(api, "/cohorts/SMOKE-0123456789AB", "101");
  assert.equal(calls.find((c) => c.path.endsWith("/class-report")).status, 403);
  assert.equal(calls.every((c) => c.body === undefined), true);
  await assert.rejects(verifyStudentReport(async () => ({ student: { id: "102" } }), "/cohorts/TEST", "101"));
  await assert.rejects(verifyStudentReport(async () => ({ student: { id: "101" }, students: [] }), "/cohorts/TEST", "101"));
});

test("QA manual: readiness público é somente leitura e registra limites da versão backend", async () => {
  const f = fixture(), calls = [];
  const result = await readiness({ ...outputs, api_url: "https://api.example.test", frontend_bucket: "web-example", imports_bucket: "imports-example" }, async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    const u = new URL(url);
    if (u.hostname === "portal.example.test") return f.fetch(url);
    if (u.hostname.endsWith("s3.us-east-1.amazonaws.com")) return new Response("", { status: 403 });
    return new Response("", { status: u.pathname.includes("/guest/") ? 404 : 401 });
  }, () => {});
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.equal(result.backendVersion, null);
  assert.match(result.limitation, /não comprova QA autenticado/);
  assert.equal(result.frontend.releaseId, rid);
});

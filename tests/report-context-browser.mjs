// TODO 23: navegação real Guia → troca de turma → painel; respostas HTTP liberadas explicitamente.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const root = path.resolve("frontend/dist");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    const source = pathname === "/app.js" && process.env.REPORT_BASELINE_APP ? process.env.REPORT_BASELINE_APP : file;
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(source));
  } catch { res.writeHead(404).end(); }
});
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let browser, origin;
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await new Promise((r) => server.close(r)); });
const report = (id) => ({ cohort: "TURMA-A", publication: { id, publishedAt: "2026-10-21T12:00:00Z" }, thresholds: { kc: 70, lab: 95 },
  students: [], activities: [], history: [], focus: { activityIds: [], version: null } });
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
for (const width of [375, 1440]) for (const failure of [false, true]) {
  test(`Guia ${width}px: ${failure ? "erro" : "sucesso"} acadêmico antigo é descartado após turma A→B→A`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), pending = [], errors = [], calls = [];
    let arrival = deferred();
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "fake-test", expires: Date.now() + 3600000 })));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { errors.push("rede externa"); return route.abort(); }
      if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      calls.push(url.pathname);
      if (url.pathname === "/api/me") return route.fulfill({ json: { roles: ["instructor"], email: "teacher@example.test" } });
      if (url.pathname === "/api/cohorts") return route.fulfill({ json: { cohorts: ["TURMA-A", "TURMA-B"].map((code) => ({ code, canTeach: true })) } });
      if (url.pathname.endsWith("/report")) { pending.push(route); arrival.resolve(); return; }
      errors.push(url.pathname); return route.fulfill({ status: 404, json: { error: "Rota fictícia desconhecida" } });
    });
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin); await arrival.promise;
      await page.evaluate(async () => { window.portalState = (await import("/state.js")).state; });
      await page.getByRole("button", { name: "Guia do curso", exact: true }).click();
      await page.locator("#cohort").selectOption("TURMA-B");
      await page.locator("#cohort").selectOption("TURMA-A");
      await page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).click();
      const before = await page.locator("#app").innerHTML();
      const finished = page.waitForResponse((r) => r.url().endsWith("/report"));
      await pending[0].fulfill({ status: failure ? 500 : 200, json: failure ? { error: "erro antigo" } : report("antiga") });
      await (await finished).finished(); await settle(page);
      assert.deepEqual(await page.evaluate(() => [portalState.report, portalState.reportError]), [null, ""]);
      assert.equal(await page.locator("#app").innerHTML(), before, "resposta descartada não redesenha o guia nem rouba foco");
      assert.equal(pending.length, 1, "guia e seletor não fazem consultas acadêmicas");
      arrival = deferred();
      await page.getByRole("button", { name: "Painel do instrutor", exact: true }).click(); await arrival.promise;
      await pending[1].fulfill({ json: report("atual") });
      await page.waitForFunction(() => window.portalState.report?.publication?.id === "atual");
      assert.equal(calls.filter((url) => url.endsWith("/report")).length, 2);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

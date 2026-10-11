// C7.4: API local, respostas liberadas explicitamente. Não acessa produção.
import assert from "node:assert/strict";
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const student = { id: "1", name: "Aluno Fictício", email: "aluno@example.test", pending: 1, completed: 0, progress: 0, status: "critical" };
const value = (mode, tag) => mode === "sender" ? { enabled: true, ready: true, sender: `${tag}@example.test`, reason: tag }
  : mode === "mine" ? { items: [{ id: tag, title: tag, description: tag, type: "BUG", status: "NEW", createdAt: "2026-10-10T12:00:00Z" }], nextCursor: null }
  : { student: { ...student, name: tag }, publicationId: tag, publishedAt: "2026-10-10T12:00:00Z", activities: [{ id: "k1", name: "KC", kind: "kc", state: "pending", active: true }], remindersEnabled: false };
const views = { sender: "reminders", mine: "feedback", pending: "student-pending" };
const endpoints = { sender: "/reminder-settings", mine: "/feedback", pending: "/pending-preview" };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [375, 1440]) for (const mode of Object.keys(views)) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    const requests = [], errors = []; let arrival = deferred();
    await context.route("**/api/**", (route) => {
      const endpoint = new URL(route.request().url()).pathname.slice(4);
      if (endpoint.endsWith(endpoints[mode])) { requests.push(route); arrival.resolve(); return; }
      if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "teacher@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }, { code: "BRSA0257", canTeach: true }] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: { students: [student], history: [], focus: { activityIds: [], version: null }, publication: { id: "p1", publishedAt: "2026-10-10T12:00:00Z" } } });
      errors.push(endpoint); return route.fulfill({ status: 404, json: { error: "Rota não prevista no teste" } });
    });
    const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin); await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    await page.evaluate(async () => {
      window.state = (await import("/state.js")).state;
      window.reminders = await import("/handlers/reminders.js"); window.feedback = await import("/handlers/feedback.js");
      window.jobs = {}; window.caught = [];
    });
    const start = async (tag) => {
      arrival = deferred(); const arrived = arrival.promise;
      await page.evaluate(({ mode, view, tag }) => {
        state.view = view;
        jobs[tag] = (mode === "sender" ? reminders.loadSender() : mode === "mine" ? feedback.loadMine() : reminders.loadPending("1"))
          .catch((e) => caught.push(e.message));
      }, { mode, view: views[mode], tag });
      await arrived; return requests.at(-1);
    };
    const finish = async (tag, route, failure = false) => {
      await route.fulfill({ status: failure ? 500 : 200, json: failure ? { error: tag } : value(mode, tag) });
      await page.evaluate((tag) => jobs[tag], tag);
    };
    const snapshot = () => page.evaluate((mode) => ({ state: mode === "sender" ? [state.sender, state.senderError, state.senderLoading]
      : mode === "mine" ? state.myFeedback : [state.pendingPreview, state.pendingError], html: document.querySelector("#app").innerHTML,
      caught: [...caught], notices: document.querySelector("#notices").innerText }), mode);
    // B vence; o sucesso A não altera state nem DOM.
    let a = await start("A"), b = await start("B"); await finish("B", b);
    let before = await snapshot(); await finish("A", a); assert.deepEqual(await snapshot(), before);
    assert.ok((await page.locator("main").innerText()).includes("B"));
    // A termina enquanto B carrega: o finally antigo não remove o loading atual.
    a = await start("A2"); b = await start("B2"); before = await snapshot();
    await finish("A2", a); assert.deepEqual(await snapshot(), before);
    await finish("B2", b, true); assert.ok((await page.locator("main").innerText()).includes("B2"));
    // B falha primeiro; A não preenche dados nem apaga o erro legítimo.
    a = await start("A3"); b = await start("B3"); await finish("B3", b, true);
    before = await snapshot(); await finish("A3", a); assert.deepEqual(await snapshot(), before);
    // Navegação real invalida mesmo sem outra requisição: erro atrasado fica silencioso.
    a = await start("saida"); await page.getByRole("button", { name: "Publicações da turma", exact: true }).click();
    before = await snapshot(); await finish("saida", a, true); assert.deepEqual(await snapshot(), before);
    // Voltar ao mesmo contexto (A/B/A), sem carregar, não revalida a resposta antiga.
    a = await start("retorno"); await page.getByRole("button", { name: "Publicações da turma", exact: true }).click();
    await page.evaluate((view) => { state.view = view; }, views[mode]);
    before = await snapshot(); await finish("retorno", a); assert.deepEqual(await snapshot(), before);
    // Troca real da turma descarta a resposta, incluindo erro global de prévia.
    a = await start("turma"); await page.locator("#cohort").selectOption("BRSA0257");
    await page.getByRole("heading", { name: "Painel da BRSA0257", exact: true }).waitFor();
    before = await snapshot(); await finish("turma", a, true); assert.deepEqual(await snapshot(), before);
    // Um 401 real da camada api encerra a sessão e limpa as três leituras, sem trocar Cognito.
    a = await start("sessao"); await a.fulfill({ status: 401, json: { error: "Sessão encerrada" } });
    await page.evaluate(() => jobs.sessao);
    assert.deepEqual(await page.evaluate(() => [state.me, state.sender, state.pendingPreview, state.myFeedback.items, state.myFeedback.loading]), [null, null, null, [], false]);
    assert.deepEqual(errors, []); await context.close();
    console.log(`C7.4 ${mode} ${width}px: concorrência, erro, loading, navegação, A/B/A, turma e sessão PASS`);
  }
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }

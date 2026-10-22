// Interface real, API fictícia e relógio fixo. Nenhuma operação produtiva ou rede externa.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.env.OPERATIONAL_TIME_FRONTEND || "frontend/dist");
const prefix = "/releases/timezone-test/", code = "TURMA-FUSO";
const at = "2026-11-01T01:15:00Z", equivalent = "2026-10-31T22:15:00-03:00";
const publication = { id: "publication-fixture", publishedAt: at, publishedBy: "system:canvas-sync", filename: "canvas-api.csv", base: null };
const students = [{ id: "101", name: "Aluna Fictícia", email: "fixture@example.test", kc: 80, lab: 100, total: 90, completed: 0, pending: 0, progress: 100, status: "ok", portalLinked: true,
  canvasActivity: { totalActivityTime: 3600, lastActivityAt: at, collectedAt: at,
    provenance: Object.fromEntries(["totalActivityTime", "lastActivityAt"].map((field) => [field,
      { status: "current", observedAt: at, attemptedAt: at, reason: null, referenceAt: null, lastValidObservedAt: at }])) } },
  { id: "102", name: "=1+1", email: "other@example.test", kc: 80, lab: 100, total: 90, completed: 0, pending: 0, progress: 100, status: "ok",
    canvasActivity: { totalActivityTime: 0, lastActivityAt: null, collectedAt: at } }];
const report = { cohort: code, publication, updatedAt: equivalent, updateKind: "canvas", students, activities: [], history: [publication],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, canvasCourseId: "9999",
  canvasSync: { status: "unchanged", at, message: "" }, canvasEngagement: { courseId: "9999", collectedAt: at, attemptedAt: at, status: "complete" } };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const relative = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname.slice(1);
  const file = path.resolve(root, relative || "index.html");
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".json": "application/json" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
let browser, origin;
before(async () => { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await new Promise((resolve) => server.close(resolve)); });

async function open(timezoneId) {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], calls = [], external = [];
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ code }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "fixture-only", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: "instructor@example.test", code, view: "overview" }));
  }, { code });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.endsWith("/config.json")) return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    calls.push(request.method() + " " + url.pathname);
    assert.equal(request.method(), "GET", "teste de apresentação não inicia mutações");
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { email: "instructor@example.test", roles: ["instructor"] } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code, canTeach: true, autoSync: true, canvasCourseId: "9999" }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: report });
    if (endpoint === "/feedback") return route.fulfill({ json: { items: [{ id: "feedback-fixture", type: "BUG", title: "Relato fictício", description: "Apenas uma demonstração de data.", status: "NEW", createdAt: at, updatedAt: at, attachments: 0 }], nextCursor: null } });
    throw new Error("Consulta não prevista: " + endpoint);
  });
  await page.goto(origin + prefix);
  await page.locator(".teacher-home").waitFor();
  return { page, calls, external, errors, close: () => context.close() };
}

test("painel, publicações, feedback e CSV usam Brasília em UTC/Brasília/Tóquio", async () => {
  const observations = [];
  for (const zone of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
    const c = await open(zone);
    try {
      const update = await c.page.locator(".update-line").innerText();
      assert.match(update, /31\/10\/2026, 22:15/);
      assert.match(update, /horário de Brasília/i);
      const row = await c.page.locator(".tp-row").filter({ hasText: "Aluna Fictícia" }).innerText();
      assert.match(row, /31\/10\/2026/);
      const csv = await c.page.evaluate(async () => {
        const { studentsCsv } = await import("./pages/teacher.js");
        const { state } = await import("./state.js");
        return studentsCsv(state.report.students);
      });
      assert.equal(csv.charCodeAt(0), 0xfeff);
      assert.match(csv, /Última atividade no Canvas \(Brasília\)/);
      assert.match(csv, /31\/10\/2026, 22:15/);
      assert.match(csv, /"'=1\+1"/);
      assert.match(csv, /"Sem informação";"0min"/);
      assert.equal(csv.split("\r\n")[0].split(";").length, 12, "colunas existentes preservadas");
      await c.page.locator('nav [data-view="history"]').click();
      await c.page.locator(".tpub-current-date").waitFor();
      const history = await c.page.locator(".tpub-current-date").innerText();
      assert.match(history, /31 de outubro de 2026/);
      assert.match(history, /22:15/);
      assert.equal(await c.page.locator(`time[datetime="${at}"]`).count() > 0, true, "ISO original preservado");
      assert.match(await c.page.locator(".teacher-publications").innerText(), /Horário de Brasília/);
      await c.page.locator('footer [data-view="feedback"]').click();
      await c.page.locator(".feedback-card").waitFor();
      const feedback = await c.page.locator(".feedback-card").first().innerText();
      assert.match(feedback, /31\/10\/2026/);
      assert.match(await c.page.locator("main").innerText(), /Horário de Brasília/);
      observations.push({ update, row, csv, history, feedback });
      assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
    } finally { await c.close(); }
  }
  assert.deepEqual(observations[0], observations[1]);
  assert.deepEqual(observations[0], observations[2]);
});

test("datas civis, offsets equivalentes, ausência e inválidos não recebem fuso presumido", async () => {
  for (const zone of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
    const c = await open(zone);
    try {
      const result = await c.page.evaluate(async ({ at, equivalent }) => {
        const { date, formatOperationalDate } = await import("./ui.js");
        return { z: date(at), offset: date(equivalent), civil: formatOperationalDate("2026-10-22", "shortDate"),
          old: date("2018-12-15T02:30:00Z"), missing: date(null), invalid: date("invalid"),
          noZone: date("2026-10-22T01:15:00"), badCivil: formatOperationalDate("2026-02-30", "shortDate") };
      }, { at, equivalent });
      assert.equal(result.z, "31/10/2026, 22:15"); assert.equal(result.offset, result.z);
      assert.equal(result.civil, "22/10/2026");
      assert.equal(result.old, "15/12/2018, 00:30", "IANA respeita o horário de verão histórico");
      assert.equal(result.missing, "Ainda não publicada");
      assert.equal(result.invalid, "Data indisponível"); assert.equal(result.noZone, "Data indisponível");
      assert.equal(result.badCivil, "Data não informada");
      assert.deepEqual(c.errors, []);
    } finally { await c.close(); }
  }
});

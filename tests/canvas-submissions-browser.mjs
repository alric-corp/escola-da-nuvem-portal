import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist"), at = "2026-10-22T12:00:00Z";
const activities = ["submitted", "unsubmitted", "pending_review", "graded", "unknown", "not_applicable"].map((s, i) => ({
  id: `${i + 1} KC (${100 + i})`, name: `Atividade fictícia ${i + 1}`, kind: "kc", active: true, state: i === 3 ? "completed" : "pending",
  percent: i === 3 ? 0 : null, score: i === 3 ? 0 : null, points: "10", filled: 1, needsReview: i === 3, module: "Fundamentos", moduleOrder: 0,
}));
const collection = { courseId: "7", attemptedAt: at, status: "partial", items: Object.fromEntries(
  ["submitted", "unsubmitted", "pending_review", "graded", "unknown", "not_applicable"].map((state, i) => [String(100 + i), {
    state, observedAt: i === 4 ? null : at, provenance: { status: i === 0 ? "retained" : "current", ...(i === 0 ? { reason: "failed" } : {}) },
  }])) };
const student = { id: "101", name: "Aluna Fictícia", email: "aluna@example.test", kc: 0, lab: null, total: 0, progress: 16.67,
  completed: 1, pending: 5, status: "insufficient", activities };
const base = { cohort: "FIC001", publication: { id: "p1", publishedAt: at }, updatedAt: at, updateKind: "canvas",
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, history: [], canvasCourseId: "7" };
const server = createServer(async (req, res) => {
  const file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname.replace(/\/$/, "/index.html"));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[path.extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
let browser, origin;
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await new Promise((r) => server.close(r)); });

async function open(role, width, available = true, text = 1) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, timezoneId: "UTC" });
  const page = await context.newPage(), errors = [], calls = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (text !== 1) await (await context.newCDPSession(page)).send("Page.setFontSizes", { fontSizes: { standard: 16 * text, fixed: 13 * text } });
  await page.addInitScript(({ role }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "fixture-only", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: role === "student" ? "aluna@example.test" : "prof@example.test", code: "FIC001", view: role === "student" ? "activities" : "overview" }));
  }, { role });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, "sem chamadas externas");
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), verb = route.request().method(); calls.push(verb + " " + endpoint);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role === "student" ? "aluna@example.test" : "prof@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "FIC001", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? { ...base, student, ...(available ? { canvasSubmissions: collection } : {}) }
      : { ...base, students: [student], activities, warnings: [] } });
    if (endpoint.endsWith("/pending-preview")) {
      assert.equal(verb, "POST"); assert.equal(route.request().postDataJSON().studentId, "101");
      return route.fulfill({ json: { student, activities: activities.filter((a) => a.state === "pending"), allActivities: activities,
        summary: student, history: [], publishedAt: at, publicationId: "p1", remindersEnabled: false,
        ...(available ? { canvasSubmissions: collection } : {}) } });
    }
    throw Error("Consulta não prevista: " + endpoint);
  });
  await page.goto(origin);
  await page.locator(role === "student" ? ".student-activities" : ".teacher-home").waitFor();
  return { page, errors, calls, close: () => context.close() };
}

test("aluno vê entrega independente da nota, filtra por notas e usa teclado em desktop/mobile/texto 200%", async () => {
  for (const [width, text] of [[1440, 1], [390, 1], [320, 2]]) {
    const c = await open("student", width, true, text);
    try {
      assert.match(await c.page.locator(".student-activities").innerText(), /Entrega registrada; avaliação atual não confirmada/);
      assert.doesNotMatch(await c.page.locator(".student-activities").innerText(), /aguardando avaliação/);
      assert.match(await c.page.locator(".student-activities").innerText(), /Informação retida/);
      assert.match(await c.page.locator(".canvas-submissions-note").innerText(), /separada das notas desta publicação/);
      const filter = c.page.getByRole("button", { name: "Sem nota", exact: true });
      await filter.focus(); await c.page.keyboard.press("Enter");
      assert.equal(await c.page.locator("#activity-list .activity-card").count(), 5, "entrega não remove pendência acadêmica");
      assert.equal(await c.page.locator("#activity-list .canvas-submission").count(), 5);
      assert.ok(await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.SUBMISSION_UI_EVIDENCE && text === 1) {
        await mkdir(process.env.SUBMISSION_UI_EVIDENCE, { recursive: true });
        if (width < 1000) await c.page.locator(".activity-card").first().scrollIntoViewIfNeeded();
        await c.page.screenshot({ path: path.join(process.env.SUBMISSION_UI_EVIDENCE, `entregas-aluno-${width}.png`), fullPage: width >= 1000 });
      }
      assert.deepEqual(c.errors, []);
      assert.ok(c.calls.every((call) => call.startsWith("GET ")));
    } finally { await c.close(); }
  }
});

test("instrutor e admin recebem entregas somente no detalhe autorizado; backend anterior e vazio continuam legíveis", async () => {
  for (const role of ["instructor", "admin"]) {
    const c = await open(role, 390);
    try {
      assert.equal(await c.page.locator(".canvas-submission").count(), 0);
      await c.page.locator('[data-student-pending="101"]').click();
      await c.page.getByRole("heading", { name: "Todas as atividades", exact: true }).waitFor();
      assert.match(await c.page.locator("main").innerText(), /Entrega em revisão/);
      assert.match(await c.page.locator("main").innerText(), /Sem informação de entrega/);
      assert.deepEqual(c.errors, []);
      assert.equal(c.calls.filter((call) => call.startsWith("POST ")).length, 1);
    } finally { await c.close(); }
  }
  const old = await open("student", 390, false);
  try { assert.equal(await old.page.locator(".canvas-submission").count(), 0); assert.equal(await old.page.locator(".activity-card").count(), 6); assert.deepEqual(old.errors, []); }
  finally { await old.close(); }
});

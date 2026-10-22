// Manual local benchmark, never a timing threshold in CI. All identities/data are synthetic.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  output: { type: "string" }, label: { type: "string", default: "manual" },
  rounds: { type: "string", default: "3" }, frontend: { type: "string" }, probe: { type: "boolean", default: false },
} });
const checkout = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(values.frontend || join(checkout, "frontend"));
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("rounds must be 1–10");
const prefix = "/releases/benchmark-local/", course = "TURMA-FICTICIA";
const collectedAt = "2026-10-21T09:00:00Z", old = "2026-10-01T09:00:00Z";
const provenance = (status, observedAt = collectedAt) => ({ status, observedAt, referenceAt: null,
  attemptedAt: collectedAt, lastValidObservedAt: observedAt, reason: status === "retained" ? "missing" : null });
const students = (count) => Array.from({ length: count }, (_, i) => ({ id: String(i + 1000),
  name: `Aluno Fictício ${String(i + 1).padStart(3, "0")}`, email: `aluno.${i + 1}@example.test`,
  kc: [85, 60, 40, null][i % 4], lab: [100, 96, 70, 100][i % 4], total: 75, completed: 4,
  pending: i % 3, progress: 66.67, status: ["ok", "attention", "critical", "insufficient"][i % 4],
  portalLinked: i % 5 !== 0, ...(i % 13 === 12 ? { participationStatus: "WITHDRAWN" } : {}),
  canvasActivity: i % 7 === 0 ? null : { totalActivityTime: i === 1 ? 0 : (i + 1) * 1800,
    lastActivityAt: i % 3 ? "2026-10-20T14:00:00Z" : old, collectedAt,
    provenance: { totalActivityTime: provenance(i % 5 ? "current" : "retained", i % 5 ? collectedAt : old),
      lastActivityAt: provenance(i % 4 ? "current" : "retained", i % 4 ? collectedAt : old) } },
}));
const activities = ["kc", "lab"].map((kind, i) => ({ id: `a${i}`, name: `${kind.toUpperCase()} · Exemplo fictício`,
  kind, active: true, points: "100", completed: 22, pending: 18, needsReview: 2, average: 75 }));
const report = (count) => ({ cohort: course, publication: { id: "p-fake", publishedAt: collectedAt },
  students: students(count), activities, history: [], thresholds: { kc: 70, lab: 95 },
  focus: { activityIds: ["a0"], version: "v-fake" }, updatedAt: collectedAt, updateKind: "canvas",
  canvasCourseId: "9999", canvasEngagement: { courseId: "9999", collectedAt, attemptedAt: collectedAt, status: "partial" },
  canvasSync: { status: "unchanged", at: collectedAt, message: "Consulta fictícia sem novas notas." } });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1);
  const file = resolve(root, relative || "index.html");
  if (!file.startsWith(root + "/")) return res.writeHead(403).end();
  try { res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const result = { label: values.label, browser: browser.version(), node: process.version, platform: process.platform,
  arch: process.arch, frontend: root, viewport: { width: 1440, height: 1000 }, rounds,
  kind: values.probe ? "isolated-filter-sort-and-dom-probe" : "complete-interaction",
  conditions: values.probe
    ? "Local isolated probe; same synthetic fixture, 1 warm-up + 5 samples/round. filteredStudents averages 20 calls; innerHTML uses already-built DOM markup. Excludes layout/paint; not the complete interaction."
    : "Local loopback, synthetic API, fixed date, no CPU/network throttle; 1 warm-up + 5 samples per action/round. Not INP/RUM.",
  samples: [], summary: [], externalRequests: [], errors: [] };
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  for (const count of [40, 200, 400]) {
    for (let round = 0; round < rounds; round++) {
      const context = await browser.newContext({ viewport: result.viewport, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable");
      await page.clock.setFixedTime(new Date("2026-10-21T12:00:00Z"));
      page.on("pageerror", (error) => result.errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "FAKE-LOCAL-ONLY", expires: Date.now() + 3600000 }));
        new PerformanceObserver((list) => { window.benchmarkLongTasks = (window.benchmarkLongTasks || []).concat(list.getEntries().map((e) => e.duration)); }).observe({ type: "longtask", buffered: true });
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { result.externalRequests.push(url.href); return route.abort(); }
        if (url.pathname.endsWith("/config.json")) return route.fulfill({ json: { apiUrl: origin + "/api" } });
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (route.request().method() !== "GET") throw new Error("Benchmark must never perform a mutation");
        const endpoint = url.pathname.slice(4);
        if (endpoint === "/me") return route.fulfill({ json: { userId: "fake-instructor", email: "instructor@example.test", roles: ["instructor"] } });
        if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: course, canTeach: true, autoSync: true }] } });
        if (endpoint.endsWith("/report")) return route.fulfill({ json: report(count) });
        throw new Error("Unexpected API read: " + endpoint);
      });
      await page.goto(origin + prefix);
      await page.locator(".tp-row").last().waitFor(); await settle(page);
      const boot = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length,
        tableRows: document.querySelectorAll(".tp-row").length, rowScrollHeight: document.documentElement.scrollHeight }));
      if (values.probe) {
        // Separate probe, not the event handler: identical filtered/sorted source, then parsing/replacement
        // of already-built HTML at the target used by that phase. Layout/paint are outside this timing.
        await page.evaluate(async () => {
          const { state } = await import("./state.js");
          Object.assign(state, { search: "Fict", filter: "all", canvasActivityFilter: "all", sort: "pending" });
        });
        for (let sample = 0; sample < 6; sample++) {
          const measurement = await page.evaluate(async () => {
            const { filteredStudents } = await import("./pages/teacher.js");
            const iterations = 20, start = performance.now();
            let rows;
            for (let i = 0; i < iterations; i++) rows = filteredStudents();
            const filteredStudentsMs = (performance.now() - start) / iterations;
            const selector = document.getElementById("teacher-student-results") ? "#teacher-student-results" : "#app";
            const target = document.querySelector(selector), html = target.innerHTML;
            const replaceStart = performance.now();
            target.innerHTML = html;
            const domSubstitutionMs = performance.now() - replaceStart;
            return { filteredStudentsMs, filteredRows: rows.length, filterIterations: iterations,
              domSubstitutionMs, domTarget: selector, htmlBytes: new TextEncoder().encode(html).length };
          });
          await settle(page);
          if (sample) result.samples.push({ count, round, sample, ...measurement });
        }
        result.summary.push({ count, round, ...boot });
        await context.close();
        continue;
      }
      for (const operation of ["sort", "search", "filter"]) for (let sample = 0; sample < 6; sample++) {
        const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
        const measurement = await page.evaluate(async ({ operation, sample }) => {
          const element = document.getElementById(operation === "sort" ? "student-sort" : operation === "filter" ? "status-filter" : "search");
          element.value = operation === "sort" ? (sample % 2 ? "name" : "pending") : operation === "filter" ? (sample % 2 ? "all" : "active") : (sample % 2 ? "Fictício" : "Fict");
          const shell = document.querySelector(".sidebar"), summary = document.querySelector(".tp-engagement");
          const start = performance.now(); element.dispatchEvent(new Event(operation === "search" ? "input" : "change", { bubbles: true }));
          const syncMs = performance.now() - start;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { syncMs, throughTwoAnimationFramesMs: performance.now() - start,
            shellPreserved: shell === document.querySelector(".sidebar"), engagementPreserved: summary === document.querySelector(".tp-engagement") };
        }, { operation, sample });
        const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
        if (sample) result.samples.push({ count, round, operation, sample, ...measurement,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000 });
      }
      const htmlSamples = await page.evaluate(async () => {
        const { teacherPage } = await import("./pages/teacher.js"), samples = [];
        for (let i = 0; i < 6; i++) { const start = performance.now(), html = teacherPage(); if (i) samples.push({ htmlMs: performance.now() - start, bytes: new TextEncoder().encode(html).length }); }
        return samples;
      });
      result.summary.push({ count, round, ...boot, htmlSamples, longTasks: await page.evaluate(() => window.benchmarkLongTasks || []) });
      await context.close();
    }
  }
} finally {
  await browser.close(); await new Promise((r) => server.close(r));
  const destination = resolve(values.output || `benchmark-teacher-${values.label}.json`);
  await mkdir(resolve(destination, ".."), { recursive: true }); await writeFile(destination, JSON.stringify(result, null, 2) + "\n");
  console.log(destination);
}
if (result.errors.length || result.externalRequests.length) throw new Error("Benchmark violated isolation; inspect evidence");

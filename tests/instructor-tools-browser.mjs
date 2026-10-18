// Teste isolado com API fictícia. Nunca envia e-mail nem acessa dados AWS.
// Cobre os todos de prioridade baixa: 10 (detalhe do aluno), 16 (próximos passos por
// data de liberação e gráfico de evolução), 18 (exportar CSV e copiar mensagem) e 19
// (busca sem acento).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
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
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let role = "instructor";
  const thresholds = { kc: 70, lab: 95 };
  const students = [
    { id: "1", name: "João Silva", email: "joao@example.test", kc: 50, lab: 100, total: 75, completed: 1, pending: 2, progress: 33, status: "attention", portalLinked: false },
    { id: "2", name: "=HYPERLINK(\"x\")", email: "b@example.test", kc: 80, lab: 96, total: 88, completed: 3, pending: 0, progress: 100, status: "ok", portalLinked: true },
    { id: "3", name: "Carla Souza", email: "carla@example.test", kc: 40, lab: 50, total: 45, completed: 1, pending: 1, progress: 50, status: "critical", portalLinked: true },
  ];
  const activity = (id, name, kind, state, extra = {}) => ({ id, name, kind, state, active: state !== "unreleased", points: "100", ...extra });
  const all = [
    activity("k1", "10- CF - KC — Introdução ao Amazon S3", "kc", "completed", { percent: 50, needsReview: true }),
    activity("k2", "226-LX-KC - Uma introdução ao Linux", "kc", "pending"),
    activity("l1", "11--Lab - Introdução ao Amazon EC2", "lab", "pending"),
  ];
  const publication = { id: "p2", publishedAt: "2026-09-20T12:00:00Z" };
  const history = [
    { publishedAt: "2026-09-20T12:00:00Z", current: true, kc: 50, lab: 100, total: 75 },
    { publishedAt: "2026-09-13T12:00:00Z", current: false, kc: 40, lab: 90, total: 65 },
  ];
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role + "@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role === "instructor", autoSync: true }] } });
    if (endpoint.endsWith("/report")) {
      if (role === "instructor")
        return route.fulfill({ json: { students, activities: all, publication, history: [publication], thresholds, canvasCourseId: "4436", focus: { activityIds: [], version: null },
          updateKind: "canvas", canvasSync: { status: "failed", at: "2026-09-21T09:00:00Z", message: "Token do Canvas recusado (expirado ou revogado)." } } });
      const student = { ...students[0], activities: [
        activity("velha", "10- CF - KC — Introdução ao Amazon S3", "kc", "pending", { releasedAt: "2026-09-01T12:00:00Z" }),
        activity("nova", "226-LX-KC - Uma introdução ao Linux", "kc", "pending", { releasedAt: "2026-09-20T12:00:00Z" }),
      ] };
      return route.fulfill({ json: { student, publication, history, thresholds, canvasCourseId: "4436", focus: { activityIds: [], version: null }, updateKind: "canvas" } });
    }
    if (endpoint.endsWith("/pending-preview"))
      return route.fulfill({ json: {
        student: { id: "1", name: "João Silva", email: "joao@example.test" },
        activities: all.filter((a) => a.state === "pending"), publicationId: "p2", publishedAt: publication.publishedAt,
        previewHash: "h", remindersEnabled: true, delivery: null, ses: { ready: true, reason: "ok" },
        message: { from: "instructor@example.test", to: "joao@example.test", replyTo: "instructor@example.test", subject: "Podemos ajudar?", text: "Olá, João Silva!" },
        summary: { kc: 50, lab: 100, total: 75, progress: 33, completed: 1, pending: 2, status: "attention" },
        allActivities: all, thresholds, canvasCourseId: "4436", history,
      } });
    throw new Error("Rota inesperada: " + endpoint);
  });

  await page.goto(origin);
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();

  // 17: instrutor vê que as notas vieram do Canvas e o motivo da última falha.
  assert.match(await page.locator(".update-line").innerText(), /Atualizado automaticamente do Canvas às 6h e às 18h/);
  assert.match(await page.locator(".update-line .sync-failed").innerText(), /Token do Canvas recusado/);

  // 19: busca sem acento encontra "João".
  await page.locator("#search").fill("joao");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.locator("#search").fill("");

  // 18: exportar CSV respeita o filtro ativo e neutraliza fórmula.
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV (3)", exact: true }).click();
  let csv = await readFile(await (await download).path(), "utf8");
  assert.ok(csv.startsWith("﻿\"Nome\";\"E-mail\""));
  assert.match(csv, /"João Silva";"joao@example\.test";"50";"100";"75";"33";"2";"Atenção";"Não"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  await page.locator("#status-filter").selectOption("critical");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV (1)", exact: true }).click();
  csv = await readFile(await (await download).path(), "utf8");
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.match(csv, /Carla Souza/);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();

  // Quem ainda não entrou no portal: marcação na linha, filtro e contagem no atalho da Situação da turma (Expansão 4).
  assert.match(await page.locator('.tp-filter[data-filter="no-portal"]').innerText(), /Ainda não entraram\n1/);
  // Os atalhos filtram a lista e levam o foco até ela.
  await page.locator('.tp-filter[data-filter="critical"]').click();
  assert.deepEqual(await page.locator("tbody tr .tp-student").allInnerTexts(), ["Carla Souza"]);
  assert.equal(await page.locator('.tp-filter[data-filter="critical"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#status-filter").inputValue(), "critical");
  assert.equal(await page.evaluate(() => document.activeElement.id), "students-heading");
  await page.locator('.tp-filter[data-filter="no-portal"]').click();
  assert.deepEqual(await page.locator("tbody tr .tp-student").allInnerTexts(), ["João Silva"]);
  await page.locator('.tp-filter[data-filter="all"]').click();
  assert.equal(await page.locator("tbody tr").count(), 3);
  // Só quem não entrou ganha a marcação; quem entrou não precisa de texto na linha.
  assert.deepEqual(await page.locator("tbody tr").evaluateAll((rows) => rows.map((tr) => [tr.querySelector(".tp-student").textContent, tr.querySelector(".tp-tag.is-portal")?.textContent ?? null])),
    [["=HYPERLINK(\"x\")", null], ["Carla Souza", null], ["João Silva", "Não entrou no portal"]]);
  await page.locator("#status-filter").selectOption("no-portal");
  assert.deepEqual(await page.locator("tbody tr .tp-student").allInnerTexts(), ["João Silva"]);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();

  // 10: detalhe completo do aluno.
  await page.locator('[data-student-pending="1"]').click();
  await page.getByRole("heading", { name: "Todas as atividades", exact: true }).waitFor();
  assert.equal(await page.locator(".activity-module .activity-card").count(), 3);
  assert.ok((await page.locator(".activity-module").allInnerTexts()).join(" ").includes("para revisar"));
  await page.getByRole("heading", { name: "Histórico do aluno", exact: true }).waitFor();
  assert.equal(await page.locator("section:has(h2:text('Histórico do aluno')) tbody tr").count(), 2);

  // 18: copiar mensagem da prévia.
  await page.getByRole("button", { name: "Copiar mensagem", exact: true }).click();
  await page.getByText("Mensagem copiada.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Podemos ajudar?\n\nOlá, João Silva!");

  // 16: aluno vê a atividade liberada mais recentemente primeiro e o gráfico com KC, LAB e referências.
  role = "student";
  await page.reload();
  await page.getByRole("heading", { name: "Por onde começar", exact: true }).waitFor();
  assert.match(await page.locator(".next-steps .activity-card").first().innerText(), /226-LX-KC/);
  assert.match(await page.locator(".update-line").innerText(), /Atualizado automaticamente do Canvas às 6h e às 18h/);
  assert.equal(await page.locator(".update-line .sync-failed").count(), 0);
  assert.equal(await page.locator(".evolution path.evo-kc").count(), 1);
  assert.equal(await page.locator(".evolution path.evo-lab").count(), 1);
  assert.equal(await page.locator(".evolution line.evo-ref").count(), 2);
  assert.match(await page.locator(".evolution svg").innerHTML(), /KC 70%[\s\S]*LAB 95%/);

  assert.deepEqual(errors, []);
  console.log("Ferramentas do instrutor: busca sem acento, CSV, detalhe do aluno, copiar mensagem, próximos passos e evolução OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

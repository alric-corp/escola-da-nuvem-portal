// Teste isolado com API fictícia. Nunca abre Canvas nem acessa dados AWS.
// Cobre o todo/09: tabela por atividade, filtros de módulo/tipo e ordenação por
// "mais sem nota" / "mais em revisão".
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // As duas primeiras casam com o módulo Linux (catálogo 4436, 225–253); a terceira não
  // tem correspondência no catálogo e cai em "Outras atividades".
  const activities = [
    { id: "kc1", name: "226-LX-KC - Uma introdução ao Linux", kind: "kc", active: true, completed: 5, pending: 5, needsReview: 1, average: 60, points: "100" },
    { id: "lab1", name: "229--Lab - Usuários e grupos", kind: "lab", active: true, completed: 8, pending: 2, needsReview: 4, average: 50, points: "100" },
    { id: "other", name: "999-KC - Sem módulo", kind: "kc", active: true, completed: 10, pending: 0, needsReview: 0, average: 95, points: "100" },
    { id: "paused", name: "9-CF-KC - Não liberada", kind: "kc", active: false, completed: 0, pending: 0, needsReview: 0, average: null, points: "100" },
  ];
  const publication = { id: "p1", publishedAt: "2026-09-24T12:00:00Z" };
  await page.addInitScript(() => sessionStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }] } });
    if (endpoint.endsWith("/report"))
      return route.fulfill({ json: { students: [], activities, publication, history: [], focus: { activityIds: [], version: null } } });
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ver por atividade", exact: true }).click();
  await page.getByRole("heading", { name: "Visão por atividade", exact: true }).waitFor();

  // Não liberada some da lista.
  assert.equal(await page.locator("tbody tr").count(), 3);

  await page.locator("#activity-overview-module").selectOption("Linux");
  assert.equal(await page.locator("tbody tr").count(), 2);
  await page.locator("#activity-overview-module").selectOption("all");

  await page.locator("#activity-overview-kind").selectOption("kc");
  assert.deepEqual(await page.locator("tbody tr td:first-child").allInnerTexts(), ["226-LX-KC - Uma introdução ao Linux", "999-KC - Sem módulo"]);
  await page.locator("#activity-overview-kind").selectOption("all");

  await page.locator("#activity-overview-sort").selectOption("pending");
  assert.deepEqual(await page.locator("tbody tr td:first-child").allInnerTexts(), [
    "226-LX-KC - Uma introdução ao Linux", "229--Lab - Usuários e grupos", "999-KC - Sem módulo",
  ]);

  await page.locator("#activity-overview-sort").selectOption("review");
  assert.deepEqual(await page.locator("tbody tr td:first-child").allInnerTexts(), [
    "229--Lab - Usuários e grupos", "226-LX-KC - Uma introdução ao Linux", "999-KC - Sem módulo",
  ]);

  assert.deepEqual(errors, []);
  console.log("Visão por atividade: filtro por módulo/tipo e ordenação por pendência/revisão OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

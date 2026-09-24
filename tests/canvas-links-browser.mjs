// Teste isolado com API fictícia. Nunca abre Canvas nem acessa dados AWS.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist");
const previewDir = path.join(os.tmpdir(), "avanca-preview");
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
  let role = "student";
  let writes = 0;
  const activities = [
    { name: "10- CF - KC — Introdução ao Amazon S3", kind: "kc", state: "pending" },
    { name: "11--Lab - Introdução ao Amazon EC2", kind: "lab", state: "pending" },
    { name: "275--Lab - Introdução a Amazon DynamoDB", kind: "lab", state: "completed", percent: 100 },
    { name: "226-LX-KC - Uma introdução ao Linux", kind: "kc", state: "pending" },
    { name: "12- CF -KC — Introdução ao Amazon EC2", kind: "kc", state: "unreleased" },
    { name: "279--Lab - Introdução ao gerenciamento de identidade e acesso (IAM)", kind: "lab", state: "exempt" },
    { name: '<img src=x onerror="window.injected=1">', kind: "kc", state: "pending" },
  ].map((a) => ({ ...a, id: a.name }));
  const student = { id: "101", name: "Aluno de teste", email: "student@example.test", kc: 50, lab: 100, total: 75, completed: 1, pending: 4, progress: 20, status: "attention", activities };
  const publication = { id: "p1", publishedAt: "2026-09-24T12:00:00Z" };
  await page.addInitScript(() => sessionStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test-only", expires: Date.now() + 3600000 })));
  // Recurso pausado no produto; exercitamos o catálogo em uma variante só de teste.
  await page.route("**/ui.js", async (route) => {
    const source = await readFile(path.join(root, "ui.js"), "utf8");
    await route.fulfill({contentType: "text/javascript", body: source.replace("export const canvasLinksEnabled = false;", "export const canvasLinksEnabled = true;")});
  });
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: `${origin}/api` } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") writes++;
    const endpoint = new URL(request.url()).pathname.slice(4);
    let data;
    if (endpoint === "/me") data = { roles: [role], email: `${role}@example.test` };
    else if (endpoint === "/cohorts") data = { cohorts: [
      { code: "BRSA0267", canTeach: role === "instructor" },
      { code: "BRSA0257", canTeach: role === "instructor" },
      { code: "OTHER4437", canTeach: role === "instructor" },
    ] };
    else if (endpoint.endsWith("/report")) data = { student, students: [student], publication, history: [] };
    else if (endpoint.endsWith("/pending-preview")) data = { student, activities: activities.filter((a) => a.state === "pending"), publishedAt: publication.publishedAt };
    else throw new Error(`Unexpected endpoint: ${endpoint}`);
    await route.fulfill({ json: data });
  });
  await page.goto(origin);
  const kcLink = page.getByRole("link", { name: /Abrir KC no Canvas: 10-/ });
  await kcLink.waitFor();
  assert.equal(await page.locator(".activity-link").count(), 3);
  assert.equal(await page.getByRole("link", { name: /Abrir KC no Canvas: 226-/ }).getAttribute("href"), "https://awsrestart.instructure.com/courses/4436/modules/items/2892251");
  assert.equal(await kcLink.getAttribute("href"), "https://awsrestart.instructure.com/courses/4436/modules/items/2892243");
  assert.equal(await kcLink.getAttribute("target"), "_blank");
  assert.equal(await kcLink.getAttribute("rel"), "noopener noreferrer");
  assert.match(await kcLink.getAttribute("aria-label"), /abre em nova aba/);
  await kcLink.focus();
  assert.equal(await kcLink.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  assert.equal(await page.locator(".activity-link").count(), 4);
  await page.locator(".activity-module").evaluateAll((groups) => groups.forEach((group) => group.open = true));

  assert.equal(await page.getByRole("link", { name: /Ver atividade no Canvas/ }).count(), 1);
  assert.equal(await page.locator(".activity-card img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await mkdir(`${previewDir}`, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Sem transbordamento em ${width}px`);
    const boxes = await page.locator(".activity-link").evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect();
      const card = el.closest(".activity-card").getBoundingClientRect();
      return { height: rect.height, right: rect.right, cardRight: card.right };
    }));
    assert.ok(boxes.every((b) => b.height >= 44 && b.right <= b.cardRight), `Links legíveis em ${width}px`);
    await page.screenshot({ path: `${previewDir}/canvas-links-${width}.png`, fullPage: true });
  }
  await page.locator("#cohort").selectOption("BRSA0257");
  await kcLink.waitFor();
  assert.equal(await kcLink.getAttribute("href"), "https://awsrestart.instructure.com/courses/4413/modules/items/2877585");
  assert.equal(await page.getByRole("link", { name: /Abrir LAB no Canvas: 11-/ }).getAttribute("href"), "https://awsrestart.instructure.com/courses/4413/modules/items/2877588");
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  assert.equal(await page.locator(".activity-link").count(), 2);
  assert.equal(await page.getByRole("link", { name: /Ver atividade no Canvas/ }).count(), 0, "LAB ausente no curso 4413 não usa o curso 4436");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator("#cohort").selectOption("BRSA0267");
  await kcLink.waitFor();
  assert.equal(await kcLink.getAttribute("href"), "https://awsrestart.instructure.com/courses/4436/modules/items/2892243");
  await page.locator("#cohort").selectOption("OTHER4437");
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  assert.equal(await page.locator(".activity-link").count(), 0);
  assert.equal(writes, 0, "Consultar links não grava nem publica notas");
  role = "instructor";
  await page.reload();
  await page.getByRole("button", { name: "Ver pendências de Aluno de teste" }).click();
  await kcLink.waitFor();
  assert.equal(await page.locator(".activity-link").count(), 3);
  await page.locator("#cohort").selectOption("BRSA0257");
  await page.getByRole("button", { name: "Ver pendências de Aluno de teste" }).click();
  await kcLink.waitFor();
  assert.equal(await kcLink.getAttribute("href"), "https://awsrestart.instructure.com/courses/4413/modules/items/2877585");
  assert.ok(await page.locator(".activity-link").evaluateAll((links) => links.every((a) => a.href.includes("/courses/4413/"))));
  assert.deepEqual(errors, []);
  console.log("Canvas: painel, atividades, instrutor, isolamento de turma, teclado e celular OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

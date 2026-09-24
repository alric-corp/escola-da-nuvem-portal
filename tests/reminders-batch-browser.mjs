// Teste isolado com API fictícia. Nunca envia e-mail real nem acessa dados AWS.
// Cobre o todo/08: filtrar "Com atividades sem nota", revisar destinatários e motivos de
// pular, enviar em lote e ver o resultado por aluno.
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
  page.on("dialog", (dialog) => dialog.accept());
  let previewCalls = 0, sendCalls = 0;
  const students = [
    { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 50, lab: 100, total: 75, completed: 1, pending: 2, progress: 33, status: "attention" },
    { id: "2", name: "Bruna Teste", email: null, kc: 40, lab: 60, total: 50, completed: 0, pending: 3, progress: 0, status: "critical" },
    { id: "3", name: "Carla Teste", email: "carla@example.test", kc: 100, lab: 100, total: 100, completed: 2, pending: 0, progress: 100, status: "ok" },
  ];
  const publication = { id: "p1", publishedAt: "2026-09-24T12:00:00Z" };
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }] } });
    if (endpoint.endsWith("/report") && request.method() === "GET")
      return route.fulfill({ json: { students, publication, history: [], focus: { activityIds: [], version: null } } });
    if (endpoint.endsWith("/pending-preview-batch")) {
      previewCalls++;
      assert.deepEqual(new Set(request.postDataJSON().studentIds), new Set(["1", "2"]));
      return route.fulfill({ json: {
        publicationId: publication.id, publishedAt: publication.publishedAt,
        ses: { ready: true, reason: "Remetente confirmado." },
        sample: { from: "instrutor@example.test", subject: "Podemos ajudar? Atividades sem nota · BRSA0267", text: "Olá, Ana Teste!" },
        recipients: [
          { id: "1", name: "Ana Teste", email: "ana@example.test", pending: 2, skip: null },
          { id: "2", name: "Bruna Teste", email: null, pending: 3, skip: "no-email" },
        ],
      } });
    }
    if (endpoint.endsWith("/send-reminders")) {
      sendCalls++;
      assert.deepEqual(request.postDataJSON(), { studentIds: ["1", "2"], expectedPublicationId: publication.id });
      return route.fulfill({ json: { publicationId: publication.id, results: [
        { id: "1", name: "Ana Teste", status: "sent" },
        { id: "2", name: "Bruna Teste", status: "skipped", reason: "no-email" },
      ] } });
    }
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  await page.locator("#status-filter").selectOption("pending");
  assert.equal(await page.locator("tbody tr").count(), 2);
  const batchButton = page.getByRole("button", { name: "Enviar lembrete para 2 aluno(s)", exact: true });
  await batchButton.waitFor();
  await batchButton.click();

  await page.getByRole("heading", { name: "Lembretes em lote", exact: true }).waitFor();
  await page.getByText(/1 de 2 aluno\(s\) vão receber/).waitFor();
  assert.equal(previewCalls, 1);
  assert.match(await page.locator("tbody").first().innerText(), /Sem e-mail no Canvas/);
  await page.getByText("Olá, Ana Teste!", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Enviar para 1 aluno(s)", exact: true }).click();
  assert.equal(sendCalls, 1);
  await page.getByText("1 enviado(s) · 1 pulado(s) · 0 com falha.", { exact: true }).waitFor();
  assert.match(await page.locator("tbody").innerText(), /Ana Teste[\s\S]*Enviado/);
  assert.match(await page.locator("tbody").innerText(), /Bruna Teste[\s\S]*Pulado.*Sem e-mail no Canvas/);

  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  assert.equal(await page.locator("#status-filter").inputValue(), "pending");

  assert.deepEqual(errors, []);
  console.log("Lembretes em lote: filtro, destinatários pulados, prévia, envio e resultado por aluno OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

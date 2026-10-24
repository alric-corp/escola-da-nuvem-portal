// Teste isolado com API fictícia. Nunca abre Canvas nem acessa dados AWS.
// Cobre o todo/07: GET repete com espera crescente em 429; POST não repete e mostra
// mensagem amigável de imediato.
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
  let role = "instructor", reportAttempts = 0, participationAttempts = 0;
  const student = { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 70, lab: 100, total: 85, completed: 1, pending: 0, progress: 100, status: "ok", activities: [] };
  const activities = [{ id: "a", name: "Atividade X", kind: "kc", active: true, completed: 1, pending: 0, needsReview: 0, average: 100, points: "100" }];
  const publication = { id: "p1", publishedAt: "2026-09-24T12:00:00Z" };
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role + "@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role === "instructor" }] } });
    if (endpoint.endsWith("/report") && request.method() === "GET") {
      reportAttempts++;
      // As duas primeiras tentativas são limitadas; a terceira sucede.
      if (reportAttempts < 3) return route.fulfill({ status: 429, json: { message: "Too Many Requests" } });
      return route.fulfill({ json: { student, students: [student], activities, publication, history: [], focus: { activityIds: ["a"], version: null } } });
    }
    if (endpoint.endsWith("/pending-preview") && request.method() === "POST")
      return route.fulfill({ json: { student: { id: student.id, name: student.name, email: student.email },
        publicationId: publication.id, publishedAt: publication.publishedAt, activities: [], remindersEnabled: false } });
    if (endpoint.endsWith("/participation") && request.method() === "POST") {
      participationAttempts++;
      assert.deepEqual(request.postDataJSON(), { canvasId: "1", status: "WITHDRAWN", expectedStatus: "ACTIVE" });
      return route.fulfill({ status: 429, json: { message: "Too Many Requests" } });
    }
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  // GET com retentativa: mesmo com duas respostas 429, o painel carrega no fim.
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  assert.equal(reportAttempts, 3);

  // O teste de POST continua cobrindo uma mutação real da interface. O Foco da
  // turma foi removido; participação preserva a garantia de não repetir operação.
  await page.getByRole("button", { name: "Ver pendências de Ana Teste", exact: true }).click();
  await page.getByRole("heading", { name: "Participação na turma", exact: true }).waitFor();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Marcar como desistente", exact: true }).click();
  await page.getByText("O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.", { exact: true }).waitFor();
  assert.equal(participationAttempts, 1);
  assert.equal(await page.getByRole("button", { name: "Marcar como desistente", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Reativar aluno", exact: true }).count(), 0, "429 não atualiza participação otimisticamente");

  assert.deepEqual(errors, []);
  console.log("Limite de requisições: GET repete com espera crescente, POST não repete e avisa na hora. OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

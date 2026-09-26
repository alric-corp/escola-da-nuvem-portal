// Teste isolado com API fictícia. Nunca acessa dados AWS reais.
// Cobre o todo/11: buscar aluno, ver vínculo, desvincular, editar nome de exibição,
// recusar solicitação e filtrar por status. Cobre também o todo/12: configurar limites
// de referência e o ID do curso Canvas da turma sem editar código.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  let requests = [
    { userId: "t1", email: "prof1@escoladanuvem.org", status: "pending" },
    { userId: "t2", email: "prof2@escoladanuvem.org", status: "approved" },
  ];
  let rejectCalls = 0, unlinkCalls = 0, renameCalls = 0, settingsCalls = 0;
  let bound = true;
  let cohortSettings = { thresholds: { kc: 70, lab: 95 }, canvasCourseId: null, autoSync: false };
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["admin"], email: "admin@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true, ...cohortSettings }] } });
    if (endpoint.endsWith("/settings") && request.method() === "POST") {
      settingsCalls++;
      cohortSettings = request.postDataJSON();
      return route.fulfill({ json: cohortSettings });
    }
    if (endpoint === "/requests") return route.fulfill({ json: { requests } });
    if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: { students: [], publication: null, history: [] } });
    if (endpoint.match(/\/requests\/t1\/reject$/)) {
      rejectCalls++;
      assert.deepEqual(request.postDataJSON(), {});
      requests = requests.map((r) => (r.userId === "t1" ? { ...r, status: "rejected" } : r));
      return route.fulfill({ json: { ...requests[0] } });
    }
    if (endpoint.endsWith("/students-search")) {
      assert.equal(request.postDataJSON().query, "ana");
      return route.fulfill({ json: { results: [
        { id: "101", name: "Ana Teste", email: "ana@example.test", bound, boundEmail: bound ? "ana@example.test" : null, boundAt: bound ? "2026-09-24T12:00:00Z" : null },
      ] } });
    }
    if (endpoint.endsWith("/unlink-student")) {
      unlinkCalls++;
      assert.deepEqual(request.postDataJSON(), { canvasId: "101" });
      bound = false;
      return route.fulfill({ json: { unlinked: true } });
    }
    if (endpoint.endsWith("/display-name")) {
      renameCalls++;
      assert.deepEqual(request.postDataJSON(), { canvasId: "101", displayName: "Ana Apelido" });
      return route.fulfill({ json: { canvasId: "101", displayName: "Ana Apelido" } });
    }
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitações de acesso", exact: true }).waitFor();

  // Filtro de solicitações: só a pendente aparece por padrão.
  assert.equal(await page.locator(".approve-form").count(), 1);
  await page.locator("#requests-filter").selectOption("all");
  assert.equal(await page.locator(".approve-form").count(), 2);
  await page.getByText("Aprovada", { exact: true }).waitFor();
  await page.locator("#requests-filter").selectOption("pending");

  // Recusar solicitação pendente. A espera pela resposta do mock (o contador sobe antes do fulfill)
  // é criada antes do clique, para não perder uma requisição rápida.
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/requests/t1/reject"));
  await page.locator('[data-reject="t1"]').click();
  await rejected;
  assert.equal(rejectCalls, 1);
  await page.locator("#requests-filter").selectOption("all");
  await page.getByText("Recusada", { exact: true }).waitFor();

  // Buscar aluno, ver o vínculo, desvincular.
  await page.locator("#student-query").fill("ana");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("ana@example.test", { exact: true }).first().waitFor();
  const unlinked = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/unlink-student"));
  await page.locator('[data-unlink="101"]').click();
  await unlinked;
  assert.equal(unlinkCalls, 1);
  await page.getByText("Sem vínculo", { exact: true }).waitFor();

  // Editar nome de exibição.
  await page.locator('[data-start-edit-name="101"]').click();
  await page.locator('input[name="displayName"]').fill("Ana Apelido");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Nome atualizado.", { exact: true }).waitFor();
  assert.equal(renameCalls, 1);

  // Configurações da turma: limites e ID do curso Canvas, sem editar código.
  await page.locator('#cohort-settings-form input[name="kc"]').fill("60");
  await page.locator('#cohort-settings-form input[name="lab"]').fill("90");
  await page.locator('#cohort-settings-form input[name="canvasCourseId"]').fill("4436");
  await page.locator('#cohort-settings-form input[name="autoSync"]').check();
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await page.getByText("Configurações da turma atualizadas.", { exact: true }).waitFor();
  assert.equal(settingsCalls, 1);
  assert.deepEqual(cohortSettings, { thresholds: { kc: 60, lab: 90 }, canvasCourseId: "4436", autoSync: true });
  assert.equal(await page.locator('#cohort-settings-form input[name="kc"]').inputValue(), "60");
  assert.equal(await page.locator('#cohort-settings-form input[name="canvasCourseId"]').inputValue(), "4436");
  assert.ok(await page.locator('#cohort-settings-form input[name="autoSync"]').isChecked());

  assert.deepEqual(errors, []);
  console.log("Admin: filtro de solicitações, recusar, buscar aluno, desvincular, editar nome e configurar turma OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

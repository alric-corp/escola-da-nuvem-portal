// Teste isolado com API fictícia. Nunca acessa dados AWS reais.
// Integridade da publicação manual: o painel mostra o que o backend conferiu (matrícula e
// catálogo do Canvas), bloqueia Publicar quando há item crítico e o Restore bloqueado explica o motivo.
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

const publication = { id: "p2", publishedAt: "2026-09-26T04:46:17Z", filename: "canvas-api.csv", changes: { studentsAdded: 0, studentsRemoved: 0, gradesChanged: 26, activitiesReleased: 1, activitiesPaused: 0 } };
const demoPublication = { id: "p1", publishedAt: "2026-09-17T18:21:18Z", filename: "BRSA0267-demo-tomas.csv", changes: { studentsAdded: 1, studentsRemoved: 0, gradesChanged: 24, activitiesReleased: 0, activitiesPaused: 0 } };
const report = { cohort: "BRSA0267", publication, students: [], activities: [], history: [publication, demoPublication],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: publication.publishedAt };
const changes = { previousCount: 59, currentCount: 59, studentsAdded: [], studentsRemoved: [], studentsUpdated: [], activitiesAdded: [], activitiesRemoved: [],
  activitiesReleased: [{ id: "258-NF-KC - Sub-redes IPv4 (643208)", name: "258-NF-KC - Sub-redes IPv4" }], activitiesPaused: [], scalesChanged: [],
  gradesChanged: 26, gradesAdded: 26, gradesRemoved: 0, gradeDetails: [] };
const summary = { studentsFound: 59, activitiesFound: 166, canvasConfigured: true, rosterCapturedAt: "2026-09-26T04:45:58Z",
  studentsExpected: 59, studentsExtra: 0, studentsMissing: 0, activitiesKnown: 166, activitiesReference: "catalog" };
const valid = { critical: [], warnings: [], summary };
const demo = { critical: [{ code: "studentNotInRoster", count: 1, message: "1 aluno(s) não pertence(m) à turma no Canvas.", ids: ["999999"] }],
  warnings: [{ code: "testFilename", count: 1, message: "Este arquivo parece ser de teste." }], summary: { ...summary, studentsFound: 60, studentsExtra: 1 } };
const preview = (integrity) => ({ draft: { id: "d1" }, count: integrity.summary.studentsFound, warnings: [], changes, integrity,
  activities: [{ id: "258-NF-KC - Sub-redes IPv4 (643208)", name: "258-NF-KC - Sub-redes IPv4", kind: "kc", points: "10", active: true, filled: 17 }],
  students: [{ id: "900001", name: "Aluno Exemplo", email: "a@example.test", kc: 80, lab: 50, pending: 1, status: "attention" }] });

let browser;
try {
  browser = await chromium.launch({ headless: true });
  async function open(width, integrity, filename = "notas.csv") {
    const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: "America/Sao_Paulo" });
    const api = { publish: 0, restore: 0, errors: [] };
    page.on("pageerror", (error) => api.errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
    await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: ["admin"], email: "admin@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true, canvasCourseId: "4436", autoSync: true }] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: report });
      if (endpoint.endsWith("/preview")) return route.fulfill({ json: preview(integrity) });
      if (endpoint.endsWith("/publish")) { api.publish++; return route.fulfill({ status: 409, json: { error: "bloqueado" } }); }
      if (endpoint.endsWith("/restore")) {
        api.restore++;
        return route.fulfill({ status: 409, json: { error: "Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade. 1 aluno(s) não pertence(m) à turma no Canvas. (IDs do Canvas: 999999)" } });
      }
      return route.fulfill({ status: 404, json: { error: "não usado" } });
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Atualizar notas", exact: true }).click();
    await page.locator("#csv-file").setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from("Student,ID\n") });
    await page.getByRole("button", { name: /Conferir arquivo/ }).click();
    await page.getByRole("heading", { name: "Integridade" }).waitFor();
    return { page, api };
  }
  const panel = (page) => page.locator(".integrity-panel");
  const publishButton = (page) => page.getByRole("button", { name: /Publicar atualização/ });
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  for (const width of [375, 768, 1440]) {
    // Arquivo válido: resumo, data da matrícula, três verificações e Publicar habilitado.
    {
      const { page, api } = await open(width, valid);
      const text = await panel(page).innerText();
      for (const expected of ["59 esperados", "59 encontrados", "0 extras", "0 ausentes", "166 encontradas", "IDs compatíveis com o curso",
        "26 notas novas", "0 removidas", "1 atividade será liberada", "Matrícula conferida com o Canvas em 26/09/2026, 01:45",
        "IDs conferem com a matrícula do Canvas", "atividades compatíveis com a turma", "estrutura válida"])
        assert.ok(text.includes(expected), `${expected} (${width}px)`);
      assert.equal(await panel(page).locator(".integrity-checks .fail").count(), 0);
      assert.equal(await page.locator(".integrity-critical").count(), 0);
      assert.ok(await publishButton(page).isEnabled());
      assert.ok(await noOverflow(page), `sem rolagem lateral (válido, ${width}px)`);
      if (process.env.INTEGRITY_SCREENSHOTS)
        await panel(page).screenshot({ path: path.join(process.env.INTEGRITY_SCREENSHOTS, `integrity-valid-${width}.png`) });
      assert.deepEqual(api.errors, []);
      await page.close();
    }
    // Equivalente ao BRSA0267-demo-tomas.csv: aluno fora da matrícula bloqueia; nome de teste só avisa.
    {
      const { page, api } = await open(width, demo, "BRSA0267-demo-tomas.csv");
      const critical = page.locator(".integrity-critical");
      assert.match(await critical.innerText(), /1 aluno\(s\) não pertence\(m\) à turma no Canvas\.\s*Canvas ID 999999/);
      assert.doesNotMatch(await panel(page).innerText(), /@/);
      assert.match(await page.locator(".integrity-warnings").innerText(), /Este arquivo parece ser de teste\./);
      assert.match(await panel(page).locator(".integrity-checks .fail").innerText(), /IDs não conferem com a matrícula do Canvas/);
      assert.ok(await publishButton(page).isDisabled());
      assert.match(await page.locator(".publish-footer p").innerText(), /Publicação bloqueada pelas validações de integridade/);
      // Mesmo forçando o clique no botão desabilitado, nada é enviado (e o backend bloquearia de novo).
      await publishButton(page).evaluate((b) => b.click());
      assert.equal(api.publish, 0);
      assert.ok(await noOverflow(page), `sem rolagem lateral (bloqueado, ${width}px)`);
      if (process.env.INTEGRITY_SCREENSHOTS) {
        await panel(page).scrollIntoViewIfNeeded();
        await panel(page).screenshot({ path: path.join(process.env.INTEGRITY_SCREENSHOTS, `integrity-blocked-${width}.png`) });
      }
      assert.deepEqual(api.errors, []);
      await page.close();
    }
  }

  // Turma com Canvas ainda sem matrícula: prévia aparece, publicação bloqueada com a mensagem combinada.
  {
    const noRoster = { critical: [{ code: "rosterUnavailable", count: 1, message: "Matrícula do Canvas ainda não disponível para validação. Aguarde a próxima sincronização automática antes de publicar." }],
      warnings: [], summary: { ...summary, rosterCapturedAt: null, studentsExpected: null, studentsExtra: 0, studentsMissing: 0 } };
    const { page, api } = await open(1440, noRoster);
    assert.match(await page.locator(".integrity-critical").innerText(), /Aguarde a próxima sincronização automática antes de publicar/);
    assert.doesNotMatch(await panel(page).innerText(), /Matrícula conferida com o Canvas em/);
    assert.match(await panel(page).locator(".integrity-checks .fail").innerText(), /matrícula do Canvas ainda não conferida/);
    assert.ok(await publishButton(page).isDisabled());
    assert.deepEqual(api.errors, []);
    await page.close();
  }

  // Restore de publicação que não passa nas validações atuais: explicação do servidor, nada muda.
  {
    const { page, api } = await open(1440, valid);
    await page.getByRole("button", { name: "Publicações da turma", exact: true }).click();
    await page.locator('[data-restore="p1"]').click();
    await page.getByText(/Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade\./).waitFor();
    assert.equal(api.restore, 1);
    assert.equal(await page.locator(".history-table tbody tr").count(), 2, "o histórico continua visível");
    assert.deepEqual(api.errors, []);
    await page.close();
  }
  console.log("Integridade: painel válido e bloqueado (999999), nome de teste, sem matrícula, Restore bloqueado e 375/768/1440 OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

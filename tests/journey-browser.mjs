// Fluxos locais com API e e-mails simulados; nenhuma chamada à AWS ou ao Canvas.
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
  page.on("pageerror", (err) => errors.push(err.message));
  let role = "student", failReport = true, hasCohort = true, senderReady = false;
  let verified = 0, sent = 0, publicationCount = 0, refreshes = 0, delivery = null;
  let acceptDialog = true;
  page.on("dialog", (dialog) => acceptDialog ? dialog.accept() : dialog.dismiss());
  const activities = [
    { id: "a", name: "10- CF - KC — Introdução ao Amazon S3", kind: "kc", state: "pending", active: true, filled: 3, points: "100" },
    { id: "b", name: "11--Lab - Introdução ao Amazon EC2", kind: "lab", state: "completed", active: true, percent: 100, points: "100" },
  ];
  const student = { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 70, lab: 100, total: 85, completed: 1, pending: 1, progress: 50, status: "ok", activities };
  const students = [student, { ...student, id: "2", name: "Bruna Teste", email: null, pending: 4, total: 50 }];
  const publication = { id: "p2", publishedAt: "2026-09-02T12:00:00Z", filename: "notas.csv" };
  const comparison = { previousCount: 2, currentCount: 1, studentsAdded: [], studentsRemoved: [{ id: "2", name: "Bruna Teste" }],
    studentsUpdated: [], activitiesAdded: [], activitiesRemoved: [], activitiesReleased: [], activitiesPaused: [], scalesChanged: [],
    gradesChanged: 1, gradeDetails: [{ student: "Ana Teste", activity: "KC", before: null, after: "70" }] };
  const personal = { kc: 10, lab: 0, pendingBefore: 2, pendingAfter: 1, removed: [],
    activities: [{ name: "KC", before: 60, after: 70, previousState: "completed", state: "completed" }] };
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("avanca.session")) sessionStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", refreshToken: "refresh", expires: Date.now() + 600000 }));
  });
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api", authDomain: origin, userPoolClientId: "test" } }));
  await page.route("**/oauth2/token", (route) => {
    refreshes++;
    return route.fulfill({ json: { access_token: "renewed", expires_in: 900 } });
  });
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.slice(4);
    let data;
    if (p === "/me") data = { userId: role, roles: [role], email: `${role}@escoladanuvem.org`, instructorCandidate: role === "instructor" };
    else if (p === "/cohorts") data = { cohorts: hasCohort ? ["BRSA0267", "BRSA0257"].map((code) => ({ code, canTeach: role === "instructor" })) : [] };
    else if (p.endsWith("/report")) {
      if (failReport) return route.fulfill({ status: 503, json: { error: "Falha temporária de teste" } });
      data = { student, students, publication, updatedAt: "2026-09-24T12:00:00Z", updateKind: "restore",
        history: role === "student" ? [{ ...publication, current: true, kc: 70, lab: 100, total: 85, changes: personal }] : [{ ...publication, changes: { studentsAdded: 0, studentsRemoved: 1, gradesChanged: 1, activitiesReleased: 0, activitiesPaused: 0 } }] };
    } else if (p.endsWith("/preview")) data = { draft: { id: "draft" }, count: 1, students: [student], activities, changes: comparison, warnings: [] };
    else if (p.endsWith("/publish")) {
      assert.equal(route.request().postDataJSON().acknowledgeRemoved, true);
      publicationCount++;
      data = { publication };
    } else if (p.endsWith("/reminder-settings")) data = { enabled: true, ready: senderReady, sender: "instructor@escoladanuvem.org", reason: senderReady ? "Remetente confirmado." : "Confirme seu e-mail." };
    else if (p.endsWith("/verify-sender")) {
      verified++;
      assert.deepEqual(route.request().postDataJSON(), {});
      data = { enabled: true, ready: false, sender: "instructor@escoladanuvem.org", reason: "Confirmação solicitada." };
    } else if (p.endsWith("/pending-preview")) data = { student, activities: [activities[0]], publicationId: publication.id, publishedAt: publication.publishedAt, previewHash: "hash", remindersEnabled: true,
      message: { from: "instructor@escoladanuvem.org", to: student.email, subject: "Podemos ajudar?", text: "Sem nota registrada. <script>window.injected=1</script>" },
      ses: { ready: senderReady, reason: "Confirme seu e-mail." }, delivery };
    else if (p.endsWith("/send-reminder")) {
      sent++;
      assert.deepEqual(route.request().postDataJSON(), { studentId: "1", publicationId: "p2", previewHash: "hash" });
      delivery = { status: "sent" }; data = { delivery };
    } else throw new Error("Rota inesperada: " + p);
    await route.fulfill({ json: data });
  });
  await page.goto(origin);
  await page.getByRole("alert").filter({ hasText: "Falha temporária" }).waitFor();
  failReport = false;
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await page.getByRole("heading", { name: "Por onde começar", exact: true }).waitFor();
  assert.equal(await page.locator(".activity-link").count(), 1, "Link do Canvas aparece para a atividade com correspondência no catálogo");
  assert.match(await page.locator(".update-line").innerText(), /24\/09\/2026/);
  assert.match(await page.locator(".update-line").innerText(), /02\/09\/2026/);
  await page.getByText("Como interpretar minhas notas?", { exact: true }).click();
  assert.match(await page.locator(".grading-help").innerText(), /sem nota contam como zero/);
  await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
  assert.match(await page.locator("tbody").innerText(), /10 pontos percentuais/);
  await page.locator("#cohort").selectOption("BRSA0257");
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Minhas atividades", exact: true }).waitFor();
  assert.equal(await page.locator("#cohort").inputValue(), "BRSA0257");
  await page.evaluate(() => {
    const auth = JSON.parse(sessionStorage.getItem("avanca.session"));
    auth.expires = Date.now() - 1;
    sessionStorage.setItem("avanca.session", JSON.stringify(auth));
  });
  await page.getByRole("button", { name: "Consultar atualização", exact: true }).click();
  await page.getByRole("heading", { name: "Minhas atividades", exact: true }).waitFor();
  assert.equal(refreshes, 1);
  hasCohort = false;
  await page.reload();
  await page.getByRole("heading", { name: "Ainda não encontramos notas para esta conta" }).waitFor();
  assert.match(await page.locator(".onboarding").innerText(), /student@escoladanuvem.org/);
  assert.equal(await page.getByRole("button", { name: "Entrar com outra conta" }).count(), 1);
  hasCohort = true; role = "instructor";
  await page.reload();
  await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
  await page.locator("#student-sort").selectOption("pending");
  assert.match(await page.locator("tbody tr").first().innerText(), /Bruna/);
  await page.locator("#status-filter").selectOption("missing-email");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await page.getByRole("searchbox").fill("Ana");
  await page.getByRole("button", { name: "Ver pendências de Ana Teste" }).click();
  await page.getByRole("heading", { name: "Prévia do lembrete" }).waitFor();
  assert.equal(sent, 0);
  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  assert.equal(await page.getByRole("searchbox").inputValue(), "Ana");
  await page.getByRole("button", { name: "Atualizar notas", exact: true }).first().click();
  await page.locator("#csv-file").setInputFiles({ name: "notas.csv", mimeType: "text/csv", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "Conferir arquivo" }).click();
  await page.getByRole("heading", { name: "O que muda ao publicar" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Publicar atualização" }).isDisabled(), true);
  await page.locator("#cohort").selectOption("BRSA0257");
  await page.locator("#cohort").selectOption("BRSA0267");
  await page.getByRole("button", { name: "Atualizar notas", exact: true }).first().click();
  await page.getByRole("heading", { name: "O que muda ao publicar" }).waitFor();
  assert.match(await page.locator("#import-form").innerText(), /notas.csv/);
  await page.locator("#acknowledge-removed").check();
  await page.getByRole("button", { name: "Publicar atualização" }).click();
  await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
  assert.equal(publicationCount, 1);
  await page.getByRole("button", { name: "Lembretes", exact: true }).click();
  await page.getByRole("button", { name: "Solicitar confirmação do meu e-mail" }).waitFor();
  assert.equal(verified, 0);
  await page.getByRole("button", { name: "Solicitar confirmação do meu e-mail" }).click();
  await page.getByText("Confirmação solicitada.", { exact: true }).waitFor();
  assert.equal(verified, 1);
  senderReady = true;
  await page.getByRole("button", { name: "Já confirmei · verificar novamente" }).click();
  await page.getByText("Remetente confirmado.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ir ao painel da turma" }).click();
  await page.getByRole("button", { name: "Ver pendências de Ana Teste" }).click();
  await page.getByRole("heading", { name: "Prévia do lembrete" }).waitFor();
  assert.equal(await page.evaluate(() => window.injected), undefined);
  acceptDialog = false;
  await page.getByRole("button", { name: "Enviar e-mail para este aluno" }).click();
  assert.equal(sent, 0);
  acceptDialog = true;
  await page.getByRole("button", { name: "Enviar e-mail para este aluno" }).click();
  await page.getByText("Aceito pelo serviço de envio; entrega ainda não confirmada.", { exact: true }).waitFor();
  assert.equal(sent, 1);
  assert.equal(await page.getByRole("button", { name: "Enviar e-mail para este aluno" }).isDisabled(), true);
  delivery = { status: "bounced" };
  await page.getByRole("button", { name: "Atualizar status do envio" }).click();
  await page.getByText("E-mail devolvido. Confira o endereço do aluno com a coordenação.", { exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Fechar aviso" }).count())
    await page.getByRole("button", { name: "Fechar aviso" }).click();
  await mkdir(`${previewDir}`, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Sem transbordamento em ${width}px`);
    await page.screenshot({ path: `${previewDir}/journey-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("Jornada: erros, datas, cálculo, histórico, sessão, filtros, prévia preservada, publicação e lembretes OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

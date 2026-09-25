// Teste isolado com API fictícia. Nunca acessa a AWS.
// Rodada de UX mobile: barra de navegação inferior, cards de alunos do instrutor, médias no
// "Seu resumo" com a distância até a referência e textos da atualização automática pelo Canvas.
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

const activity = (id, kind, state, percent = null) => ({ id, name: `${id} ${kind.toUpperCase()}`, kind, state, percent, active: true, points: "100", module: "Módulo", moduleOrder: 0 });
const thresholds = { kc: 70, lab: 95 };
const publication = { id: "p1", publishedAt: "2026-09-25T09:00:00Z", filename: "canvas-api.csv",
  changes: { studentsAdded: 1, studentsRemoved: 0, gradesChanged: 1, activitiesReleased: 2, activitiesPaused: 1 } };
// Publicação anterior (restaurável), com o nome padrão da exportação do Canvas, o mais longo em produção.
const previous = { id: "p0", publishedAt: "2026-09-18T09:00:00Z", filename: "2026-09-21T1731_Notas-BRSAO257.csv",
  changes: { studentsAdded: 12, studentsRemoved: 3, gradesChanged: 305, activitiesReleased: 13, activitiesPaused: 0 } };
// KC abaixo (1 sem nota), LAB exatamente na referência.
const below = { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 56.67, lab: 95, total: 75.8, completed: 3, pending: 1, progress: 75, status: "attention",
  activities: [activity("k1", "kc", "completed", 80), activity("k2", "kc", "completed", 33.33), activity("k3", "kc", "pending"), activity("l1", "lab", "completed", 95)] };
const students = [
  { ...below, portalLinked: false },
  { id: "2", name: "Maria Aparecida dos Santos Figueiredo Nascimento", email: "maria.aparecida.figueiredo@example.test", kc: 90, lab: 100, total: 95, completed: 4, pending: 0, progress: 100, status: "ok", portalLinked: true },
];

async function open(browser, { width, role = "student", autoSync = true, now = "2026-09-25T13:00:00Z", student = below }) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, timezoneId: "America/Sao_Paulo" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setSystemTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role + "@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role === "instructor", autoSync }] } });
    if (endpoint.endsWith("/report"))
      return route.fulfill({ json: role === "instructor"
        ? { students, activities: student.activities, publication, history: [publication, previous], thresholds, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: publication.publishedAt,
            canvasSync: { status: "unchanged", at: "2026-09-25T09:00:05Z", message: "" } }
        : { student, publication, history: [], thresholds, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: publication.publishedAt } });
    return route.fulfill({ status: 404, json: { error: "não usado" } });
  });
  await page.goto(origin);
  return { page, errors };
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const insideViewport = (locator) => locator.evaluateAll((els) => els.every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));

let browser;
try {
  browser = await chromium.launch({ headless: true });

  for (const width of [375, 390, 430]) {
    // Aluno: barra inferior com os 3 itens, nome acessível completo, sem corte.
    const { page, errors } = await open(browser, { width });
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    const nav = page.locator(".sidebar nav");
    assert.equal(await nav.evaluate((el) => getComputedStyle(el).position), "fixed");
    for (const name of ["Meu desempenho", "Minhas atividades", "Meu histórico"])
      assert.ok(await page.getByRole("button", { name, exact: true }).isVisible(), `${name} visível em ${width}px`);
    assert.ok(await insideViewport(nav.locator(".nav-item")), `itens do menu dentro da tela em ${width}px`);
    assert.ok(await nav.locator(".nav-item").evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height >= 44)));
    assert.equal(await page.locator('.nav-item[aria-current="page"] .nav-short').innerText(), "Desempenho");
    // O fim da página não fica escondido atrás da barra.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector(".sidebar nav").getBoundingClientRect().top - document.querySelector(".main-footer").getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `rodapé acima da barra em ${width}px`);
    await page.evaluate(() => scrollTo(0, 0));

    // Médias no resumo, com a distância real até a referência e plural correto.
    const goals = page.locator(".student-summary .goal");
    assert.equal(await goals.count(), 2);
    assert.match(await goals.nth(0).innerText(), /56,67%[\s\S]*Referência: 70%[\s\S]*Faltam 13,33 pontos para a referência[\s\S]*1 KC sem nota conta como 0%/);
    assert.match(await goals.nth(1).innerText(), /95%[\s\S]*Referência atingida/);
    assert.doesNotMatch(await goals.nth(1).innerText(), /Falta|sem nota/);
    assert.equal(await page.getByText(/Foque (em|nos)/).count(), 0, "sem o alerta vermelho isolado");
    assert.equal(await page.locator(".metrics").count(), 0, "médias não aparecem duplicadas mais abaixo");
    assert.ok(await page.locator(".student-summary .ring").isVisible(), `anel de progresso visível em ${width}px`);
    const kcTop = await goals.nth(0).evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(kcTop < 800, `média de KC visível ao abrir em ${width}px`);

    // Atualização automática: horário fixo e próxima verificação (10h em Brasília → hoje às 18h).
    const update = await page.locator(".update-line").innerText();
    assert.match(update, /Atualizado automaticamente do Canvas às 6h e às 18h \(horário de Brasília\)/);
    assert.match(update, /Próxima verificação:?\s*hoje às 18h/);
    assert.doesNotMatch(update, /instrutor publica/);
    assert.ok(await noHorizontalScroll(page), `sem rolagem lateral (aluno) em ${width}px`);
    assert.deepEqual(errors, []);
    await page.close();

    // Instrutor: cards com situação, portal e "Ver detalhes" dentro da tela.
    const teacher = await open(browser, { width, role: "instructor" });
    await teacher.page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    for (const name of ["Painel do instrutor", "Publicações da turma", "Atualizar notas", "Lembretes"])
      assert.ok(await teacher.page.getByRole("button", { name, exact: true }).isVisible(), `${name} visível em ${width}px`);
    const rows = teacher.page.locator(".student-table tbody tr");
    assert.equal(await rows.count(), 2);
    for (const selector of [".cell-name", ".cell-status .badge", ".cell-kc", ".cell-lab", ".cell-pending .text-link"])
      assert.ok(await insideViewport(rows.locator(selector)), `${selector} dentro da tela em ${width}px`);
    assert.match(await rows.nth(0).innerText(), /Não entrou/);
    assert.match(await rows.nth(0).locator(".cell-pending").innerText(), /^1 sem nota ·\s+Ver detalhes$/);
    assert.equal(await rows.nth(1).locator(".cell-pending").innerText(), "Ver detalhes", "zero pendências não aparece no card");
    assert.equal(await rows.nth(1).locator(".cell-portal").isVisible(), false, "\"Entrou\" não ocupa espaço no card");
    assert.equal(await teacher.page.getByRole("button", { name: "Ver pendências de Ana Teste" }).count(), 1);
    assert.match(await teacher.page.locator(".update-line").innerText(), /Última verificação:?\s*25\/09\/2026, 06:00 · sem mudanças/);
    // Envio manual vira alternativa, não ação principal.
    assert.equal(await teacher.page.locator('.page-heading [data-view="import"]').getAttribute("class"), "button secondary");
    assert.ok(await noHorizontalScroll(teacher.page), `sem rolagem lateral (instrutor) em ${width}px`);
    assert.deepEqual(teacher.errors, []);
    await teacher.page.close();
  }

  // Publicações da turma no desktop: "Restaurar" visível sem rolar a tabela para o lado (só
  // "O que mudou" quebra linha); abaixo de 1024px continuam os cards.
  for (const width of [768, 1024, 1280, 1440, 1920]) {
    const { page, errors } = await open(browser, { width, role: "instructor" });
    await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    await page.locator('.sidebar nav [data-view="history"]').click();
    const restore = page.getByRole("button", { name: "Restaurar", exact: true });
    await restore.waitFor();
    const m = await page.evaluate(() => {
      const box = document.querySelector(".history-table"), table = box.querySelector("table");
      const b = [...box.querySelectorAll("button")].find((x) => x.textContent.trim() === "Restaurar").getBoundingClientRect(), r = box.getBoundingClientRect();
      return { row: getComputedStyle(table.querySelector("tbody tr")).display, tableScroll: table.scrollWidth > box.clientWidth + 1,
        inside: b.left >= r.left - 1 && b.right <= r.right + 1 && b.right <= innerWidth, pageScroll: document.documentElement.scrollWidth > innerWidth,
        changes: getComputedStyle(table.querySelector("td.h-changes")).whiteSpace, file: getComputedStyle(table.querySelector("td.h-file")).whiteSpace };
    });
    assert.equal(m.row, width < 1024 ? "grid" : "table-row", `layout em ${width}px`);
    assert.ok(m.inside, `Restaurar visível em ${width}px`);
    assert.equal(m.tableScroll, false, `sem rolagem lateral da tabela em ${width}px`);
    assert.equal(m.pageScroll, false, `sem rolagem lateral da página em ${width}px`);
    if (width >= 1024) assert.deepEqual([m.changes, m.file], ["normal", "nowrap"], "só \"O que mudou\" quebra linha");
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Desktop continua com menu lateral e tabela.
  const desktop = await open(browser, { width: 1440, role: "instructor" });
  await desktop.page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
  assert.equal(await desktop.page.locator(".sidebar nav").evaluate((el) => getComputedStyle(el).position), "static");
  assert.equal(await desktop.page.locator(".nav-item .nav-short").first().isVisible(), false);
  assert.ok(await desktop.page.locator(".student-table thead").isVisible());
  assert.equal(await desktop.page.locator(".student-table tbody tr").first().evaluate((el) => getComputedStyle(el).display), "table-row");
  await desktop.page.close();

  // Depois das 18h a próxima verificação é amanhã às 6h (19h em Brasília = 22h UTC).
  const night = await open(browser, { width: 390, now: "2026-09-25T22:00:00Z" });
  await night.page.getByRole("heading", { name: "Seu resumo" }).waitFor();
  assert.match(await night.page.locator(".update-line").innerText(), /Próxima verificação:?\s*amanhã às 6h/);
  await night.page.close();

  // Turma sem atualização automática mantém o texto do fluxo manual, sem horários.
  const manual = await open(browser, { width: 390, autoSync: false });
  await manual.page.getByRole("heading", { name: "Seu resumo" }).waitFor();
  const text = await manual.page.locator(".update-line").innerText();
  assert.match(text, /Última atualização das notas/);
  assert.doesNotMatch(text, /6h|18h|Próxima verificação/);
  await manual.page.close();

  console.log("UX mobile: barra inferior, cards do instrutor, médias no resumo e atualização automática em 375/390/430 px e desktop OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

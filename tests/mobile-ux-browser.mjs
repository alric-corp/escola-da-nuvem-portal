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
// 69,96% arredonda para 70% na exibição, mas não atingiu a referência de 70% (valor bruto).
const nearRef = { ...below, id: "3", name: "Bia Limite", email: "bia@example.test", kc: 69.96 };
const students = [
  { ...below, portalLinked: false },
  { id: "2", name: "Maria Aparecida dos Santos Figueiredo Nascimento", email: "maria.aparecida.figueiredo@example.test", kc: 90, lab: 100, total: 95, completed: 4, pending: 0, progress: 100, status: "ok", portalLinked: true },
];

async function open(browser, { width, role = "student", autoSync = true, now = "2026-09-25T13:00:00Z", student = below, previousFilename = previous.filename, studentsList = students }) {
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
        ? { students: studentsList, activities: student.activities, publication, history: [publication, { ...previous, filename: previousFilename }], thresholds, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: publication.publishedAt,
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

  {
    const { page, errors } = await open(browser, { width: 390, student: nearRef });
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    const kcGoal = page.locator(".student-summary .goal").nth(0);
    // Exibe "70%" (arredondado, 1 casa), mas o status usa o valor bruto: ainda não atingiu.
    assert.match(await kcGoal.innerText(), /^Média em KCs\n70%/);
    assert.doesNotMatch(await kcGoal.innerText(), /Referência atingida/);
    assert.match(await kcGoal.innerText(), /Falta menos de 0,01 ponto|Faltam? 0,0[1-9]/);
    assert.deepEqual(errors, []);
    await page.close();
  }

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
    // 56,67% exibe 56,7% (1 casa, sem truncar); "Faltam X pontos" continua com o valor bruto.
    assert.match(await goals.nth(0).innerText(), /56,7%[\s\S]*Referência: 70%[\s\S]*Faltam 13,33 pontos para a referência[\s\S]*1 KC sem nota conta como 0%/);
    assert.match(await goals.nth(1).innerText(), /95%[\s\S]*Referência atingida/);
    assert.doesNotMatch(await goals.nth(1).innerText(), /Falta|sem nota/);
    assert.equal(await page.getByText(/Foque (em|nos)/).count(), 0, "sem o alerta vermelho isolado");
    assert.equal(await page.locator(".metrics").count(), 0, "médias não aparecem duplicadas mais abaixo");
    // Cabeçalho enxuto: só o h1 (sem eyebrow), contexto de turma continua no topo. No celular o piloto visual mostra
    // a turma no seletor do cabeçalho e mantém o "Turma BRSA0267" do topo só para leitura assistiva (sem repetir).
    assert.equal(await page.locator(".page-heading h1").count(), 1, "exatamente um h1");
    assert.equal(await page.locator(".page-heading .eyebrow").count(), 0, "sem eyebrow redundante");
    assert.match(await page.locator(".topline .location-context").innerText(), /Turma BRSA0267/);
    assert.ok(await page.locator("#cohort").isVisible(), `turma visível no seletor em ${width}px`);
    assert.equal(await page.locator("#cohort").inputValue(), "BRSA0267");
    // Progresso das atividades com nota (o anel virou texto + régua segmentada no piloto visual).
    assert.ok(await page.locator(".student-summary .coverage-text").isVisible(), `cobertura visível em ${width}px`);
    assert.match(await page.locator(".student-summary .coverage-text").innerText(), /^\d+ de \d+ atividades? com nota$/);
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

    // Instrutor: cada aluno numa linha empilhada (Expansão 4), com situação, portal e "Ver pendências" dentro da tela.
    const teacher = await open(browser, { width, role: "instructor" });
    await teacher.page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    for (const name of ["Painel do instrutor", "Publicações da turma", "Atualizar notas", "Lembretes"])
      assert.ok(await teacher.page.getByRole("button", { name, exact: true }).isVisible(), `${name} visível em ${width}px`);
    const rows = teacher.page.locator(".teacher-home .tp-row");
    assert.equal(await rows.count(), 2);
    for (const selector of [".tp-name", ".tp-status .tp-state", ".tp-avg.is-kc", ".tp-avg.is-lab", ".tp-action .text-link"])
      assert.ok(await insideViewport(rows.locator(selector)), `${selector} dentro da tela em ${width}px`);
    assert.match(await rows.nth(0).innerText(), /Não entrou no portal/);
    // "Sem nota" é só o número, com o rótulo visível acima (como Média KC e Média LAB, fora da leitura assistiva, que ouve
    // o cabeçalho da coluna); "Ver pendências" fica separado.
    assert.equal(await rows.nth(0).locator(".tp-pending .tp-value").innerText(), "1");
    assert.deepEqual(await rows.nth(0).locator(".tp-pending .tp-cell-label").evaluate((el) => [el.innerText, el.getAttribute("aria-hidden")]), ["Sem nota", "true"]);
    assert.equal(await rows.nth(0).locator(".tp-action").innerText(), "Ver pendências");
    assert.equal(await rows.nth(1).locator(".tp-pending .tp-value").innerText(), "0");
    assert.equal(await rows.nth(1).locator(".tp-tag").count(), 0, "quem entrou no portal não ganha texto na linha");
    assert.equal(await teacher.page.getByRole("button", { name: "Ver pendências de Ana Teste" }).count(), 1);
    assert.match(await teacher.page.locator(".update-line").innerText(), /Última verificação:?\s*25\/09\/2026, 06:00 · sem mudanças/);
    // Envio manual vira alternativa, não ação principal.
    assert.equal(await teacher.page.locator('.page-heading [data-view="import"]').getAttribute("class"), "button secondary");
    assert.ok(await noHorizontalScroll(teacher.page), `sem rolagem lateral (instrutor) em ${width}px`);
    assert.deepEqual(teacher.errors, []);
    await teacher.page.close();
  }

  // Publicações da turma (Expansão 5): "Restaurar" à vista sem rolar nada para o lado e sem rolagem lateral da página; "O que
  // mudou" e o arquivo quebram linha. Com largura (1280 px ou mais: 52rem de tela) cada publicação é uma linha; abaixo,
  // empilhada (antes: tabela a partir de 1024 px e cartões abaixo).
  const restoreInView = (page) => page.locator("[data-restore]").first().evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) p.scrollLeft = 0;
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2);
    const b = el.getBoundingClientRect();
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    return b.left >= clip.left - 1 && b.right <= clip.right + 1 && b.right <= innerWidth;
  });
  for (const width of [768, 1024, 1280, 1440, 1920]) {
    const { page, errors } = await open(browser, { width, role: "instructor" });
    await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    await page.locator('.sidebar nav [data-view="history"]').click();
    await page.locator("[data-restore]").first().waitFor();
    const m = await page.evaluate(() => {
      const entry = document.querySelector(".tpub-entry:not(.is-current)"), top = (s) => Math.round(entry.querySelector(s).getBoundingClientRect().top);
      return { oneRow: new Set([top("h4"), top(".tpub-origin"), top(".tpub-changes")]).size === 1, pageScroll: document.documentElement.scrollWidth > innerWidth,
        changes: getComputedStyle(entry.querySelector(".tpub-facts")).flexWrap, file: getComputedStyle(entry.querySelector(".tpub-origin")).overflowWrap };
    });
    assert.equal(m.oneRow, width >= 1280, `layout em ${width}px`);
    assert.ok(await restoreInView(page), `Restaurar visível em ${width}px`);
    assert.equal(m.pageScroll, false, `sem rolagem lateral da página em ${width}px`);
    // "O que mudou" e o arquivo quebram linha (nomes longos não empurram "Restaurar").
    assert.deepEqual([m.changes, m.file], ["wrap", "anywhere"], "\"O que mudou\" e o arquivo quebram linha");
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Arquivo com nome sem espaços de vários tamanhos não pode empurrar "Restaurar" para fora, em nenhuma largura de desktop.
  // Evita quebrar palavra havendo espaço (overflow-wrap: anywhere só entra em uso quando a palavra não cabe).
  for (const length of [34, 50, 80]) {
    const filename = "a".repeat(length - 4) + ".csv";
    assert.equal(filename.length, length);
    for (const width of [1024, 1280, 1440, 1920]) {
      const { page, errors } = await open(browser, { width, role: "instructor", previousFilename: filename });
      await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
      await page.locator('.sidebar nav [data-view="history"]').click();
      await page.locator("[data-restore]").first().waitFor();
      assert.ok(await page.locator(".teacher-publications").getByText(filename).isVisible(), `nome de ${length} caracteres exibido em ${width}px`);
      assert.ok(await restoreInView(page), `Restaurar visível com nome de ${length} caracteres em ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `sem rolagem lateral da página (${length} caracteres) em ${width}px`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }

  // Painel do instrutor no desktop: a situação ("Médias na referência", "Atenção", "Crítico") e "Não entrou no portal"
  // não quebram linha; a coluna da ação existe (com nome para a leitura assistiva) e "Ver pendências" continua dentro da
  // tela; a tabela não precisa de rolagem própria mesmo com o nome real mais longo já visto em produção (58 caracteres).
  // Em 1024 px (menos de 52rem de painel) a lista já é a de linhas empilhadas: as mesmas garantias valem.
  const realLongName = "Allysson Borges - Allysson Roberto Borges Lima De Moraes";
  for (const width of [1024, 1280, 1440, 1500, 1600, 1920]) {
    const { page, errors } = await open(browser, { width, role: "instructor", studentsList: [{ ...below, name: realLongName, portalLinked: false }, students[1]] });
    await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    const oneLine = (loc) => loc.evaluateAll((els) => els.every((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length <= 1;
    }));
    assert.ok(await oneLine(page.locator(".tp-row .tp-state")), `situação em uma linha em ${width}px`);
    assert.ok(await oneLine(page.locator(".tp-row .tp-tag")), `"Não entrou no portal" em uma linha em ${width}px`);
    assert.equal(await page.locator(".tp-table thead th.tp-action").textContent(), "Ação", `coluna da ação existe em ${width}px`);
    assert.ok(await insideViewport(page.locator(".tp-action .text-link")), `Ver pendências visível em ${width}px`);
    // "Sem nota" contém só o número (sem a ação junto).
    assert.match(await page.locator("tbody td.tp-pending .tp-value").first().innerText(), /^\d+$/, `Sem nota só com o número em ${width}px`);
    const scroll = await page.evaluate(() => { const box = document.querySelector(".tp-table"); return box.scrollWidth > box.clientWidth + 1; });
    assert.equal(scroll, false, `sem rolagem própria da tabela (nome de 58 caracteres) em ${width}px`);
    assert.ok(await noHorizontalScroll(page), `sem rolagem lateral da página em ${width}px`);
    assert.deepEqual(errors, []);
    await page.close();
  }

  // Alinhamento numérico e cabeçalho fixo ao rolar (desktop). Lista maior para garantir
  // conteúdo suficiente para rolar de verdade (poucos alunos cabem inteiros na tela).
  {
    const manyStudents = Array.from({ length: 18 }, (_, i) => ({ ...students[i % 2], id: `many${i}`, name: `Aluno Teste ${i}` }));
    const { page, errors } = await open(browser, { width: 1440, role: "instructor", studentsList: manyStudents });
    await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
    for (const cls of ["tp-avg.is-kc", "tp-avg.is-lab", "tp-pending"])
      assert.equal(await page.locator(`.tp-table td.${cls}`).first().evaluate((el) => getComputedStyle(el).textAlign), "right", `${cls} alinhado à direita`);
    await page.locator(".tp-table").scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.evaluate(() => scrollBy(0, 600));
    const scrollAfter = await page.evaluate(() => scrollY);
    assert.ok(scrollAfter > scrollBefore, "a página realmente rolou (não é um falso positivo)");
    const top = await page.locator(".tp-table thead th").first().evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 100, `cabeçalho continua visível perto do topo após rolar (top=${top})`);
    // Hover/foco: a linha ganha destaque, sem virar link (nenhuma tag <a> na linha).
    // O destaque fica nas células (o fundo de uma linha de tabela não pinta por cima delas).
    const row = page.locator(".tp-table tbody tr").first();
    const base = await row.locator(".tp-name").evaluate((el) => getComputedStyle(el).backgroundColor);
    await row.locator(".tp-action .text-link").focus();
    const focused = await row.locator(".tp-name").evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(base, focused, "linha destacada com foco no elemento interativo");
    assert.equal(await row.locator("a").count(), 0, "linha não vira link");
    assert.ok(await noHorizontalScroll(page));
    assert.deepEqual(errors, []);
    await page.close();
  }

  // Desktop continua com menu lateral e tabela.
  const desktop = await open(browser, { width: 1440, role: "instructor" });
  await desktop.page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
  assert.equal(await desktop.page.locator(".sidebar nav").evaluate((el) => getComputedStyle(el).position), "static");
  assert.equal(await desktop.page.locator(".nav-item .nav-short").first().isVisible(), false);
  assert.ok(await desktop.page.locator(".tp-table thead").isVisible());
  assert.equal(await desktop.page.locator(".tp-table tbody tr").first().evaluate((el) => getComputedStyle(el).display), "table-row");
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

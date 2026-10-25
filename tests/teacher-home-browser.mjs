// Expansão 4 do piloto visual: Painel do instrutor como instrumento de acompanhamento (docs/design-visual.md), com API
// fictícia (nunca AWS, Canvas, publicação ou envio real). Cobre o que a tela promete: composição (tabela com largura,
// linhas empilhadas no tablet, no celular e com texto ampliado), sem rolagem lateral nem controle recortado em 320–1440 px,
// texto e zoom a 200% e janela baixa; os dois botões que passavam da tela com texto a 200% em 320 px; atalhos de filtro
// com o número da lista; ausência do Foco da turma mesmo com dados legados; estados; situação por texto e
// forma; teclado na ordem visual com contorno inteiro (pixels); o mesmo painel para o admin.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
// C3: tipografia de referência dos testes de densidade e de quebra (Arial = Liberation Sans: as mesmas métricas no macOS e no Linux).
const REFERENCE_FONT = ':root { --font-ui: Arial, "Liberation Sans", sans-serif; }';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

// Linhas no formato de backend/grades.summary + portalLinked/participationStatus (backend/portal.py::_report).
const row = (id, name, extra) => ({ id, name, email: `${name.split(" ")[0].toLowerCase()}.${id}@example.test`, kc: 82.5, lab: 97.25, total: 89.88, completed: 8, pending: 0, progress: 100,
  status: "ok", portalLinked: true, ...extra });
const ROSTER = [
  row("1", "Ana Albuquerque", {}), row("2", "Bruno Barbosa", { kc: 61.25, status: "attention", pending: 1, completed: 7, progress: 87.5, portalLinked: false }),
  row("3", "Carla Cavalcanti", { kc: 40, lab: 56.88, status: "critical", pending: 3, completed: 5, progress: 62.5 }), row("4", "Diego Duarte", { lab: 80.75, status: "attention" }),
  row("5", "Elisa Esteves", { kc: 98.13 }), row("6", "Felipe Figueiredo", { kc: 36.75, lab: 14.13, status: "critical", pending: 3, completed: 5, progress: 62.5, portalLinked: false }),
  row("7", "Gabriela Gonçalves", { kc: null, status: "insufficient", pending: 2 }), row("8", "Heitor Holanda", { status: "graduated" }),
];
const LONG = [row("1", "Exemplar Testes - Exemplar Fictino Testes Nome Do Modelo", { email: "exemplar.fictino.testes.nome.do.modelo.turma.manha@exemplo-instituicao-parceira.example.test", portalLinked: false }),
  row("2", "Maria Aparecida dos Santos Oliveira Albuquerque Cavalcanti de Figueiredo", { email: null, kc: 69.96, lab: 94.95, status: "critical", participationStatus: "WITHDRAWN" }), ...ROSTER.slice(2)];
const MANY = Array.from({ length: 40 }, (_, i) => ({ ...ROSTER[i % ROSTER.length], id: `m${i}`, name: `${ROSTER[i % ROSTER.length].name} ${String(i).padStart(2, "0")}` }));
const ACTIVITIES = [
  { id: "a1", name: "254-NF- KC Introdução à rede", kind: "kc", active: true, points: "100", completed: 5, pending: 3, needsReview: 2, average: 64.5, module: "Redes", moduleOrder: 8 },
  { id: "a2", name: "255--Lab - Sub-redes e tabelas de rotas na Amazon VPC", kind: "lab", active: true, points: "100", completed: 7, pending: 1, needsReview: 1, average: 91, module: "Redes", moduleOrder: 8 },
  { id: "a3", name: "226-LX-KC - Uma introdução ao Linux", kind: "kc", active: true, points: "100", completed: 8, pending: 0, needsReview: 2, average: 78, module: "Linux", moduleOrder: 7 },
];
const publication = { id: "p-2026-10-09", publishedAt: "2026-10-09T21:00:00Z" };
const report = (students = ROSTER, extra = {}) => ({ cohort: "BRSA0267", publication, students, activities: ACTIVITIES, count: students.length, warnings: [], thresholds: { kc: 70, lab: 95 },
  focus: { activityIds: [], version: null }, updatedAt: "2026-10-10T21:04:00Z", updateKind: "canvas", canvasCourseId: "4436", history: [publication],
  canvasSync: { status: "unchanged", message: "Nenhuma mudança no Canvas desde a última publicação.", at: "2026-10-11T09:00:12Z" }, ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

let browser, origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// control: report (objeto ou função), reportMode ("ok" | "error" | "hold"), tentativas de foco proibidas, autoSync.
// email: outra conta (o nome no menu é a parte antes do @).
async function open({ width = 1440, height = 900, text = 1, role = "instructor", data = () => report(), autoSync = true, saved = null, email: account = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  const errors = [], control = { data, reportMode: "ok", reports: 0, focusPosts: [], holds: {} };
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  const email = account || (role === "admin" ? "admin@example.test" : role === "student" ? "ana.1@example.test" : "instrutor@example.test");
  await page.addInitScript(({ email, saved }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    if (saved) localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view: "overview", ...saved }));
  }, { email, saved });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync }, { code: "BRSA0268", canTeach: role !== "student", autoSync }] } });
    if (endpoint.endsWith("/report")) {
      control.reports++;
      await hold("report");
      if (control.reportMode === "error") return route.fulfill({ status: 500, json: { error: "Não foi possível carregar o relatório da turma agora." } });
      if (role === "student") return route.fulfill({ json: { ...report(), student: { ...ROSTER[0], activities: [] }, students: undefined } });
      return route.fulfill({ json: control.data() });
    }
    if (endpoint.endsWith("/focus-activities")) {
      control.focusPosts.push(request.postDataJSON());
      return route.fulfill({ status: 404, json: { error: "O frontend não deve mais alterar o foco." } });
    }
    if (endpoint.endsWith("/pending-preview")) return route.fulfill({ status: 404, json: { error: "não simulado" } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  if (role !== "student") await page.locator(".layout .page-heading h1").waitFor();
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shortcutCount = (page, filter) => page.locator(`[data-filter="${filter}"] > strong`).textContent({ timeout: 2000 }).then(Number);
// Controles (e células da tabela) recortados pela janela ou por um ancestral com overflow, e texto cortado dentro do controle.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".teacher-home :is(a, button, select, input, h1, h2, .tp-student, .tp-email, .tp-value, .tp-state, .tp-tag)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.closest("thead")) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.id || el.tagName).trim().slice(0, 30)}`);
    if (el.matches("button, .tp-value, .tp-state") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 30)}`);
  }
  return bad;
});
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("TODO29: painel distingue catálogo indisponível de notas sem mudanças e substitui o diagnóstico na recuperação", async () => {
  const proof = { status: "failed", scheduledFor: "2026-10-11T09:00:00Z", startedAt: "2026-10-11T09:00:01Z", finishedAt: "2026-10-11T09:00:12Z",
    stages: { catalog: "failed", roster: "succeeded", grades: "unchanged" } };
  for (const [width, text, role] of [[1440, 1, "instructor"], [390, 1, "admin"], [320, 2, "instructor"]]) {
    let data = report(ROSTER, { canvasSyncDiagnostics: proof });
    const { context, page, errors, control } = await open({ width, text, role, data: () => data });
    try {
      const area = page.getByRole("region", { name: "Atualização das notas" });
      assert.match(await area.innerText(), /Verificação por etapas incompleta/);
      assert.match(await area.innerText(), /Catálogo: indisponível; Matrículas: verificadas; Notas: verificadas, sem mudanças/);
      const academic = await area.locator(".sync-times > div").first().innerText();
      assert.ok(await pageScroll(page) <= 1, `${width}/${text}: sem rolagem horizontal`);
      data = report(ROSTER, { canvasSyncDiagnostics: { ...proof, status: "succeeded", stages: { catalog: "succeeded", roster: "succeeded", grades: "unchanged" } } });
      const refresh = area.getByRole("button", { name: "Consultar atualização" });
      await refresh.focus();
      const response = page.waitForResponse((r) => r.url().endsWith("/report"));
      await page.keyboard.press("Enter");
      await response;
      await page.getByText(/Etapas da sincronização acadêmica verificadas/).waitFor();
      assert.doesNotMatch(await area.innerText(), /Catálogo: indisponível|Verificação por etapas incompleta/);
      assert.equal(await area.locator(".sync-times > div").first().innerText(), academic);
      data = report(); // Frontend novo com backend anterior.
      const legacy = page.waitForResponse((r) => r.url().endsWith("/report"));
      await area.getByRole("button", { name: "Consultar atualização" }).click();
      await legacy;
      await page.getByText(/Diagnóstico por etapas não disponível/).waitFor();
      assert.doesNotMatch(await area.innerText(), /Etapas da sincronização acadêmica verificadas/);
      assert.equal(control.focusPosts.length, 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

const RING = [0, 203, 221];
const isRing = (c) => !!c && c.every((v, i) => Math.abs(v - RING[i]) <= 45);
async function ringOnScreen(page) {
  const box = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth) }; });
  const { r, o, w } = box, mid = o + w / 2;
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  const shot = (await page.screenshot()).toString("base64");
  const colors = await page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
  return Object.entries(colors).filter(([, c]) => !isRing(c)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
}

test("P1: composição — tabela com largura (52rem de painel), linhas empilhadas no tablet, no celular e com texto ampliado; situação em uma seção única, sem o antigo editor", async () => {
  for (const [width, height, text, table] of [[1440, 900, 1, true], [1280, 800, 1, true], [1024, 768, 1, false], [768, 1024, 1, false], [390, 844, 1, false],
    [320, 640, 1, false], [1440, 900, 2, false]]) {
    const { context, page, errors } = await open({ width, height, text });
    const m = await page.evaluate(() => {
      const tr = document.querySelector(".tp-row"), thead = document.querySelector(".tp-table thead"), head = thead?.getBoundingClientRect();
      const o = document.querySelector(".tp-overview")?.getBoundingClientRect();
      if (!tr || !head || !o) return { row: null, theadVisible: null, labels: null };
      const values = [...document.querySelectorAll(".tp-statuses .tp-filter > strong")].map((s) => Math.round(s.getBoundingClientRect().top));
      return { row: getComputedStyle(tr).display, theadVisible: head.width > 1 && head.height > 1, labels: getComputedStyle(tr.querySelector(".tp-cell-label")).display !== "none",
        sticky: getComputedStyle(thead.querySelector("th")).position, kcAlign: getComputedStyle(tr.querySelector(".tp-avg")).textAlign,
        frame: getComputedStyle(document.querySelector(".tp-overview")).borderTopWidth, sameRow: new Set(values).size === 1, statusesSide: values.length === 3 && new Set([...document.querySelectorAll(".tp-statuses .tp-filter")].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1 };
    });
    const id = `${width}×${height}${text > 1 ? ` a ${text * 100}%` : ""}`;
    assert.equal(m.row, table ? "table-row" : "grid", `${id}: linha`);
    assert.equal(m.theadVisible, table, `${id}: cabeçalho visível só na tabela`);
    assert.equal(m.labels, !table, `${id}: rótulo em cada valor só nas linhas empilhadas`);
    if (table) assert.deepEqual([m.sticky, m.kcAlign], ["sticky", "right"], `${id}: cabeçalho fixo e números à direita`);
    assert.equal(await page.locator(".tp-focus, #focus-form, [data-add-focus], [data-remove-focus]").count(), 0, `${id}: editor removido`);
    // Com as três situações lado a lado, os números ficam na mesma linha mesmo quando um rótulo quebra (subgrid); em coluna
    // estreita (celular, texto ampliado) a Situação da turma não tem moldura.
    if (m.statusesSide) assert.ok(m.sameRow, `${id}: números das situações alinhados`);
    assert.equal(m.frame, width <= 390 || text > 1 ? "0px" : "1px", `${id}: moldura da Situação da turma`);
    // O cabeçalho da coluna existe para a leitura assistiva em todos os modos.
    assert.deepEqual(await page.locator(".tp-table thead th").allTextContents(), ["Aluno", "Média KC referência 70%", "Média LAB referência 95%", "Sem nota", "Situação", "Última atividade conhecida no Canvas Horário de Brasília", "Tempo no Canvas Acumulado no curso", "Ação"]);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("P2: sem rolagem lateral nem controle ou texto recortado em 320–1440 px, texto a 200%, zoom a 200% e janela baixa, com nomes e e-mails longos", async () => {
  const cases = [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [1440, 900, 2], [1024, 768, 2], [768, 1024, 2], [390, 844, 2], [320, 568, 2],
    [320, 640, 2.5], [720, 450, 1], [1280, 560, 1]];
  for (const [width, height, text] of cases) for (const data of [() => report(LONG), () => report(ROSTER, { focus: { activityIds: ["a2", "a1", "a3"], version: "v0" } })]) {
    const { context, page, errors } = await open({ width, height, text, data });
    const id = `${width}×${height}${text > 1 ? ` a ${text * 100}%` : ""}`;
    assert.equal(await pageScroll(page), 0, `${id}: rolagem lateral`);
    assert.deepEqual(await clipped(page), [], id);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("P3: Enviar CSV manualmente cabe em 320 px com texto ampliado: texto inteiro, alvo de 44 px, foco e ação preservados", async () => {
  for (const [height, text] of [[640, 2], [568, 2], [640, 2.5]]) {
    const { context, page, errors } = await open({ width: 320, height, text });
    const id = `320×${height} a ${text * 100}%`;
    const button = page.getByRole("button", { name: "Enviar CSV manualmente", exact: true });
    const m = await button.evaluate((el) => {
      const r = el.getBoundingClientRect(), box = el.closest(".teacher-home").getBoundingClientRect();
      return { inside: r.left >= box.left - 0.5 && r.right <= Math.min(box.right, innerWidth) + 0.5,
        height: r.height, text: el.innerText.replace(/\s+/g, " ").trim(), cut: el.scrollWidth > el.clientWidth + 1, disabled: el.disabled };
    });
    assert.ok(m.inside && !m.cut, `${id}: ação dentro da tela e sem corte (${JSON.stringify(m)})`);
    assert.equal(m.text, "Enviar CSV manualmente");
    assert.ok(m.height >= 44, `${id}: alvo com ${m.height} px`);
    assert.equal(m.disabled, false);
    await button.focus();
    await page.evaluate(() => document.activeElement.scrollIntoView({ block: "center" }));
    await settle(page);
    assert.deepEqual(await ringOnScreen(page), [], `${id}: contorno da ação`);
    await button.click();
    await page.getByRole("heading", { name: "Atualizar notas da BRSA0267", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// C3: com texto muito ampliado (faixa de 8,5rem), o preenchimento lateral dos botões cede largura antes de qualquer quebra no
// meio da palavra. Com a tipografia de referência (Arial = Liberation Sans), "manualmente" (226 px) cabe no rótulo (236 px); com
// o preenchimento de antes (40 px de cada lado) sobravam 176 e a palavra era partida. Com fonte mais larga que a referência
// (DejaVu Sans: 271 px), a quebra continua sendo o último recurso (P3: texto inteiro e sem corte).
test("P3b: a 320 px com texto a 250%, nenhuma palavra dos botões do Painel é partida quando cabe no botão (tipografia de referência)", async () => {
  const { context, page } = await open({ width: 320, height: 640, text: 2.5, data: () => report(ROSTER, { focus: { activityIds: ["a1"], version: "v0" } }) });
  await page.addStyleTag({ content: REFERENCE_FONT });
  const m = await page.evaluate((sel) => {
    const words = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const w of n.textContent.matchAll(/\S+/g)) {
        const r = document.createRange(); r.setStart(n, w.index); r.setEnd(n, w.index + w[0].length);
        words.push({ el: el.textContent.replace(/\s+/g, " ").trim(), word: w[0], lines: new Set([...r.getClientRects()].filter((q) => q.width).map((q) => Math.round(q.top))).size });
      }
    }
    return { reference: [...document.querySelectorAll(sel)].every((el) => /^Arial/.test(getComputedStyle(el).fontFamily)), words };
  }, ".teacher-home .button");
  assert.ok(m.reference, "tipografia de referência aplicada");
  assert.ok(m.words.some((w) => w.word === "manualmente"), JSON.stringify(m.words));
  assert.deepEqual(m.words.filter((w) => w.lines > 1), [], "nenhuma palavra partida");
  await context.close();
});

test("P4: atalhos da Situação da turma filtram a lista com o mesmo número, pressionados um por vez, e levam o foco à lista; busca sem resultado diz o que limita e oferece limpar; filtros sobrevivem à ida e volta", async () => {
  const { context, page, errors } = await open({ data: () => report(ROSTER.map((r) => (r.id === "8" ? { ...r, participationStatus: "WITHDRAWN" } : r))) });
  for (const filter of ["ok", "attention", "critical", "pending", "no-portal", "active"]) {
    const expected = await shortcutCount(page, filter);
    await page.locator(`[data-filter="${filter}"]`).click();
    assert.equal(await page.locator(".tp-row").count(), expected, `${filter}: número do atalho = linhas`);
    assert.equal(await page.locator("#status-filter").inputValue(), filter);
    assert.deepEqual(await page.locator(".tp-filter").evaluateAll((els) => els.filter((el) => el.getAttribute("aria-pressed") === "true").map((el) => el.dataset.filter)), [filter]);
    assert.equal(await page.evaluate(() => document.activeElement.id), "students-heading");
    assert.match(await page.locator(".tp-count").textContent(), new RegExp(`^${expected} de 8 alunos$`));
  }
  // O total fica na turma (a busca não muda os números da situação, só a contagem da lista).
  await page.locator("#status-filter").selectOption("critical");
  await page.locator("#search").fill("zzz");
  assert.equal(await shortcutCount(page, "critical"), 2);
  assert.equal(await page.locator(".tp-empty").textContent(), "Nenhum aluno encontrado para “zzz” com o filtro escolhido.Limpar busca e filtros");
  await page.getByRole("button", { name: "Limpar busca e filtros", exact: true }).click();
  assert.equal(await page.locator(".tp-row").count(), 8);
  assert.deepEqual([await page.locator("#search").inputValue(), await page.locator("#status-filter").inputValue()], ["", "all"]);
  // Ida e volta pela visão por atividade e recarga: busca, filtro e ordenação continuam.
  await page.locator("#search").fill("a");
  await page.locator("#status-filter").selectOption("attention");
  await page.locator("#student-sort").selectOption("pending");
  await page.locator('.tp-actions [data-view="activity-overview"]').click();
  await page.getByRole("heading", { name: "Visão por atividade", exact: true }).waitFor();
  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  await page.locator(".teacher-home .tp-row").first().waitFor();
  const kept = () => Promise.all(["#search", "#status-filter", "#student-sort"].map((s) => page.locator(s).inputValue()));
  assert.deepEqual(await kept(), ["a", "attention", "pending"]);
  await page.reload();
  await page.locator(".teacher-home .tp-row").first().waitFor();
  assert.deepEqual(await kept(), ["a", "attention", "pending"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("P5: Foco da turma removido do painel e da visão por atividade, sem POST mesmo com foco legado no relatório", async () => {
  for (const role of ["instructor", "admin"]) {
    const { context, page, errors, control } = await open({ role, data: () => report(ROSTER, { focus: { activityIds: ["a1", "a2", "a3"], version: "legacy" } }) });
    const absent = async () => {
      assert.equal(await page.locator(".tp-focus, #focus-form, [data-add-focus], [data-remove-focus]").count(), 0);
      assert.equal(await page.getByRole("button", { name: /Salvar foco|Escolher na visão por atividade|do foco/ }).count(), 0);
      assert.deepEqual(control.focusPosts, []);
    };
    await page.locator(".tp-row").first().waitFor();
    await absent();
    await page.locator("#search").fill("Carla");
    assert.deepEqual(await page.locator(".tp-student").allTextContents(), ["Carla Cavalcanti"]);
    await page.getByRole("button", { name: "Ver por atividade", exact: true }).click();
    await page.getByRole("heading", { name: "Visão por atividade", exact: true }).waitFor();
    await absent();
    assert.equal(await page.getByRole("columnheader", { name: /foco/i }).count(), 0);
    assert.equal(await page.locator("tbody tr").count(), ACTIVITIES.length);
    await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await page.locator(".tp-row").first().waitFor();
    await absent();
    assert.equal(await page.locator("#search").inputValue(), "Carla", "navegação mantém os filtros legítimos");
    await page.getByRole("button", { name: "Consultar atualização", exact: true }).click();
    await page.locator(".tp-row").first().waitFor();
    await absent();
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("P6: estados — atualizando, erro recuperável com o título, sem publicação, falha da sincronização, versão restaurada e turma sem atualização automática", async () => {
  {
    const { context, page, errors, control, holdNext } = await open();
    const hold = holdNext("report");
    await page.getByRole("button", { name: "Consultar atualização", exact: true }).click();
    await hold.arrived.promise;
    assert.equal(await page.locator(".teacher-home [role=status]").count(), 1, "carregamento na composição do painel");
    assert.equal(await page.locator(".teacher-home [role=status]").textContent(), "Carregando sua turma…");
    assert.equal(await page.locator(".teacher-home .tp-row").count(), 0, "nenhum dado antigo durante a carga");
    control.reportMode = "error";
    hold.gate.resolve();
    await page.locator("main [role=alert]").waitFor();
    assert.deepEqual(await page.locator(".teacher-home h1").allTextContents(), ["Painel da BRSA0267"]);
    assert.match(await page.locator(".teacher-home [role=alert]").innerText(), /Não foi possível carregar\n+Não foi possível carregar o relatório da turma agora\./);
    control.reportMode = "ok";
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await page.locator(".teacher-home .tp-row").first().waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, errors } = await open({ data: () => ({ cohort: "BRSA0267", publication: null, students: [], history: [], thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436" }), autoSync: false });
    assert.equal((await page.locator(".teacher-home .tp-empty").innerText()).replace(/\n+/g, "\n"), "A turma está pronta para começar.\nImporte o CSV do Canvas para publicar a primeira atualização.");
    assert.equal(await page.locator(".tp-overview, .tp-focus, .tp-table, #search").count(), 0);
    assert.equal(await page.locator('.tp-actions [data-view="import"]').getAttribute("class"), "button primary");
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, errors } = await open({ data: () => report(ROSTER, { canvasSync: { status: "failed", message: "Token do Canvas recusado (expirado ou revogado).", at: "2026-10-11T09:00:12Z" } }) });
    assert.match(await page.locator(".update-line .sync-failed").textContent(), /^A atualização automática pelo Canvas falhou em 11\/10\/2026, 06:00: Token do Canvas recusado/);
    assert.equal(await page.locator(".update-line .sync-failed").getAttribute("role"), "status");
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { context, page, errors } = await open({ data: () => report(ROSTER, { updateKind: "restore", updatedAt: "2026-10-11T14:20:00Z" }), autoSync: false });
    assert.match(await page.locator(".update-line").innerText(), /Última atualização das notas: 11\/10\/2026, 11:20[\s\S]*Versão restaurada\. Notas originalmente publicadas em 09\/10\/2026, 18:00\./);
    assert.equal(await page.locator('.tp-actions [data-view="import"]').innerText(), "Atualizar notas");
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("P7: situação por texto e forma, não só por cor — um anel por média abaixo da referência, visto na referência, traço sem avaliação completa", async () => {
  const { context, page, errors } = await open();
  const shapes = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tp-row")].map((tr) => {
    const st = tr.querySelector(".tp-state"), b = getComputedStyle(st, "::before");
    return [tr.querySelector(".tp-student").textContent, { text: st.textContent, shape: b.content === '""' ? `${Math.round(parseFloat(b.width) / parseFloat(getComputedStyle(st).fontSize) * 100) / 100}em` : "nenhuma",
      check: parseFloat(b.borderRightWidth) > 0 && parseFloat(b.borderBottomWidth) > 0, rings: b.backgroundImage.split("radial-gradient").length - 1,
      below: [...tr.querySelectorAll(".tp-avg.is-below .tp-value")].map((v) => getComputedStyle(v, "::before").backgroundImage.split("radial-gradient").length - 1) }];
  })));
  assert.deepEqual(shapes["Ana Albuquerque"], { text: "Médias na referência", shape: "0.3em", check: true, rings: 0, below: [] });
  assert.deepEqual(shapes["Bruno Barbosa"], { text: "Atenção", shape: "0.83em", check: false, rings: 1, below: [1] });
  assert.deepEqual(shapes["Carla Cavalcanti"], { text: "Crítico", shape: "1.38em", check: false, rings: 2, below: [1, 1] });
  assert.deepEqual(shapes["Gabriela Gonçalves"], { text: "Sem avaliação completa", shape: "0.6em", check: false, rings: 0, below: [] });
  assert.equal(shapes["Heitor Holanda"].text, "Graduado");
  // A cor da série não muda com a situação (KC branco, LAB violeta na régua em miniatura).
  const fills = await page.evaluate(() => [...new Set([...document.querySelectorAll(".tp-row .tp-ruler i")].map((i) => `${i.closest(".tp-avg").classList.contains("is-kc") ? "kc" : "lab"} ${getComputedStyle(i).backgroundColor}`))].sort());
  assert.deepEqual(fills, ["kc rgb(255, 255, 255)", "lab rgb(180, 156, 255)"]);
  // Texto para leitura assistiva junto do número abaixo da referência.
  assert.equal(await page.locator(".tp-row").nth(1).locator(".tp-avg.is-kc .tp-value").textContent(), "61,3%, abaixo da referência de 70%");
  assert.deepEqual(errors, []);
  await context.close();
  // Linhas empilhadas: o anel vai para o rótulo da média (meia coluna não comporta anel e duas casas), não some.
  const narrow = await open({ width: 390, height: 844 });
  const marks = await narrow.page.evaluate(() => [...document.querySelectorAll(".tp-avg.is-below")].map((td) => [getComputedStyle(td.querySelector(".tp-cell-label"), "::before").backgroundImage.split("radial-gradient").length - 1,
    getComputedStyle(td.querySelector(".tp-value"), "::before").content]));
  assert.ok(marks.length >= 4 && marks.every(([label, value]) => label === 1 && value === "none"), JSON.stringify(marks));
  assert.deepEqual(narrow.errors, []);
  await narrow.context.close();
});

test("P8: teclado na ordem visual, com contorno inteiro (pixels); no celular o foco não fica atrás da barra inferior", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page, errors } = await open({ width, height, data: () => report(ROSTER, { focus: { activityIds: ["a1"], version: "v0" } }) });
    const order = [];
    await page.locator(".layout .page-heading h1").evaluate((el) => { el.tabIndex = -1; el.focus(); });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => { const a = document.activeElement; if (!a.closest(".teacher-home")) return null; const r = a.getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
        const bar = getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight;
        return { name: (a.getAttribute("aria-label") || a.innerText || a.id).trim().split("\n")[0], top: r.top + scrollY, left: r.left, visible: r.top >= 0 && r.bottom <= bar }; });
      if (!info) break;
      order.push(info);
      if (/Ver pendências|Ver todos|Atenção|search/.test(info.name)) assert.deepEqual(await ringOnScreen(page), [], `${width}: contorno em ${info.name}`);
      assert.ok(info.visible, `${width}: ${info.name} à vista`);
    }
    // A ordem do teclado segue a leitura: de cima para baixo e, numa mesma faixa, da esquerda para a direita.
    const names = order.map((o) => o.name);
    assert.deepEqual(names.slice(0, 3), ["Ver por atividade", "Enviar CSV manualmente", "Consultar atualização"]);
    assert.ok(names.indexOf("Alunos na publicação") < names.indexOf("Médias na referência") && names.indexOf("Crítico") < names.indexOf("Com atividades sem nota"), names.join(" | "));
    assert.ok(names.indexOf("Ainda não entraram") < names.indexOf("search"), names.join(" | "));
    assert.ok(names.every((name) => !/Salvar foco|do foco|Escolher na visão por atividade/.test(name)), names.join(" | "));
    const rows = names.filter((n) => n.startsWith("Ver pendências de "));
    assert.deepEqual(rows, ROSTER.map((r) => `Ver pendências de ${r.name}`).sort((a, b) => a.localeCompare(b, "pt-BR")).slice(0, rows.length));
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i], sameBand = Math.abs(a.top - b.top) < 24;
      if (width > 1000 && a.name.startsWith("Ver pendências") === false) assert.ok(b.top > a.top - 24 && (!sameBand || b.left > a.left - 1) || /search/.test(b.name), `${a.name} → ${b.name}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("P9: o admin vê o mesmo painel; o aluno não tem .teacher-home", async () => {
  const admin = await open({ role: "admin" });
  assert.deepEqual(await admin.page.locator(".teacher-home h1").allTextContents(), ["Painel da BRSA0267"]);
  assert.equal(await admin.page.locator(".tp-row").count(), ROSTER.length);
  assert.match(await admin.page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  assert.deepEqual(admin.errors, []);
  await admin.context.close();
  const student = await open({ role: "student" });
  await student.page.locator(".student-home").waitFor();
  assert.equal(await student.page.locator(".teacher-home").count(), 0);
  await student.context.close();
});

// C3.3 (F08): a barra lateral tem largura fixa em px (210 px no tablet, 244 px até 1279 px). Com texto ampliado a conta
// não cabia numa linha e o Sair saía da barra, por baixo do conteúdo pintado depois dele: o clique no Sair acionava o
// filtro Crítico (ou outro controle, ou nada). Clique real do mouse do Chromium em cinco pontos do Sair; cada click é
// registrado na fase de captura (window), antes do listener do app (document). Só o click que chega ao Sair é parado
// (nunca sai da conta); os outros seguem para o app, para o efeito real aparecer. Também o Espaço no Sair, uma conta de
// nome longo e o admin ("Administrador e instrutor") com texto normal: no tablet o Sair passava 22 e 6 px da área da
// barra; no desktop a conta continua numa linha, como antes (o nome encolhe antes de a linha quebrar).
test("P10: o clique no Sair da conta chega ao Sair no tablet e no desktop estreito com texto ampliado; o filtro Crítico não é acionado", async () => {
  for (const o of [{ width: 768, height: 1024, text: 2 }, { width: 1024, height: 768, text: 1.75 }, { width: 1279, height: 800, text: 2 },
    { width: 800, height: 1024, text: 2.5 }, { width: 1024, height: 768, email: "exemplar.fictino.testes.nome@example.test" },
    { width: 1024, height: 768, role: "admin" }, { width: 1280, height: 800, role: "admin", oneLine: true }, { width: 1440, height: 900, role: "admin", oneLine: true }]) {
    const { context, page, errors } = await open(o);
    const id = `${o.width}×${o.height}${o.text ? ` texto ${o.text * 100}%` : ""}${o.email ? " nome longo" : ""}${o.role ? ` ${o.role}` : ""}`;
    await page.evaluate(() => document.querySelector('.sidebar [data-action="logout"]').scrollIntoView({ block: "center" }));
    await settle(page);
    const m = await page.evaluate(() => {
      const sb = document.querySelector(".sidebar"), s = getComputedStyle(sb), b = sb.getBoundingClientRect();
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { inner: { left: b.left + parseFloat(s.paddingLeft), right: b.right - parseFloat(s.paddingRight) }, sair: box(sb.querySelector('[data-action="logout"]')), avatar: box(sb.querySelector(".account .avatar")),
        conta: [...sb.querySelectorAll(".account > *, .account strong, .account small")].map((el) => ({ peca: el.getAttribute("class") || el.tagName.toLowerCase(), ...box(el) })) };
    });
    const points = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]].map(([fx, fy]) => [m.sair.left + m.sair.width * fx, m.sair.top + m.sair.height * fy]);
    const covered = await page.evaluate((points) => points.map(([x, y]) => { const el = document.elementFromPoint(x, y);
      return el?.closest('[data-action="logout"]') ? null : `${el?.tagName.toLowerCase()}.${el?.getAttribute("class") || ""}`; }).filter(Boolean), points);
    await page.evaluate(() => {
      window.__cliques = [];
      window.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        window.__cliques.push(!b ? e.target.tagName.toLowerCase() : b.dataset.action || (b.dataset.filter ? `filtro ${b.dataset.filter}` : b.textContent.trim().slice(0, 40)));
        if (b?.dataset.action === "logout") { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    });
    for (const [x, y] of points) { await page.mouse.click(x, y); await settle(page); }
    const cliques = await page.evaluate(() => window.__cliques);
    const critico = await page.locator('.tp-overview [data-filter="critical"]').getAttribute("aria-pressed");
    await page.evaluate(() => { window.__cliques = []; });
    await page.locator('.sidebar [data-action="logout"]').focus();
    await page.keyboard.press("Space");
    const teclado = await page.evaluate(() => window.__cliques);
    assert.deepEqual(cliques, Array(5).fill("logout"), `${id}: os cinco cliques no Sair foram entregues a: ${cliques.join(", ")}`);
    assert.equal(critico, "false", `${id}: o filtro Crítico foi acionado`);
    assert.deepEqual(covered, [], `${id}: pontos do Sair cobertos por ${covered.join(", ")}`);
    assert.ok(m.sair.width >= 44 && m.sair.height >= 44, `${id}: Sair com área de 44 px`);
    for (const p of m.conta) assert.ok(p.left >= m.inner.left - 0.5 && p.right <= m.inner.right + 0.5,
      `${id}: ${p.peca} da conta em ${Math.round(p.left)}–${Math.round(p.right)} px, fora da barra (${Math.round(m.inner.left)}–${Math.round(m.inner.right)} px)`);
    assert.deepEqual(teclado, ["logout"], `${id}: Espaço no Sair`);
    if (o.oneLine) assert.ok(m.sair.top < m.avatar.bottom && m.sair.bottom > m.avatar.top, `${id}: com texto normal a conta fica numa linha (iniciais, nome e Sair)`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

const engagedReport = () => report([
  row("1", "Aluno Recente", { canvasActivity: { totalActivityTime: 0, lastActivityAt: "2026-10-10T12:00:00Z" } }),
  row("2", "Aluno Atenção", { status: "attention", kc: 60, canvasActivity: { totalActivityTime: 19200, lastActivityAt: "2026-09-30T01:00:00Z" } }),
  row("3", "Aluno Crítico", { status: "critical", kc: 40, lab: 50, canvasActivity: { totalActivityTime: 3600, lastActivityAt: "2026-10-01T12:00:00Z" } }),
  row("4", "Aluno Sem Dado", { status: "critical", kc: 40, lab: 50 }),
  row("5", "Aluno Desistente", { participationStatus: "WITHDRAWN", canvasActivity: { totalActivityTime: 999999, lastActivityAt: "2020-01-01T12:00:00Z" } }),
], { canvasEngagement: { courseId: "4436", collectedAt: "2026-10-11T09:00:00Z" } });

test("Canvas: resumo, atividade por aluno, filtro combinado, ordenação, CSV e limpar filtros", async () => {
  const { context, page, errors } = await open({ data: engagedReport });
  const summary = page.locator(".tp-engagement");
  assert.deepEqual(await summary.locator("dd").allTextContents(), ["1h 0minMediana de 3 de 4 alunos ativos com tempo válido", "1", "2"]);
  assert.match(await summary.innerText(), /1 aluno ativo sem informação/);
  assert.match(await summary.innerText(), /não representa necessariamente tempo de estudo efetivo/);
  await page.getByRole("combobox", { name: "Atividade no Canvas", exact: true }).focus();
  await page.locator("#canvas-activity-filter").selectOption("inactive");
  assert.equal(await page.evaluate(() => document.activeElement.id), "canvas-activity-filter", "filtro preserva o foco após render");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "student-sort", "próximo controle alcançável por teclado");
  await page.locator("#status-filter").selectOption("critical");
  assert.deepEqual(await page.locator(".tp-student").allTextContents(), ["Aluno Crítico"]);
  await page.locator("#search").fill("ausente");
  await page.waitForTimeout(200);
  assert.match(await page.locator(".tp-empty").innerText(), /Nenhum aluno encontrado/);
  await page.getByRole("button", { name: "Limpar busca e filtros" }).click();
  assert.equal(await page.locator("#canvas-activity-filter").inputValue(), "all");
  await page.locator("#student-sort").selectOption("last-activity");
  assert.deepEqual(await page.locator(".tp-student").allTextContents(), ["Aluno Atenção", "Aluno Crítico", "Aluno Recente", "Aluno Sem Dado", "Aluno Desistente"]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar CSV/ }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /Última atividade no Canvas \(Brasília\)/);
  assert.match(csv, /29\/09\/2026, 22:00/);
  assert.match(csv, /"0min"/);
  assert.match(csv, /"Sem informação";"Sem informação"/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Canvas: Crítico vermelho, Atenção âmbar e referência verde-água; desktop/mobile com dados e sem cortes", async () => {
  for (const width of [1440, 390, 320]) {
    const { context, page, errors } = await open({ width, data: engagedReport });
    const colors = await page.evaluate(() => {
      const token = (name) => { const el = document.createElement("span"); el.style.color = `var(${name})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
      const danger = token("--color-danger"), warning = token("--color-warning"), success = token("--color-success");
      const critical = document.querySelector('.tp-filter.is-critical > span');
      return { danger, warning, success, count: getComputedStyle(document.querySelector('.tp-filter.is-critical > strong')).color,
        criticalRing: getComputedStyle(critical, "::before").backgroundImage,
        attentionRing: getComputedStyle(document.querySelector('.tp-filter.is-attention > span'), "::before").backgroundImage,
        criticalBar: getComputedStyle(document.querySelector('.tp-scale .is-critical')).backgroundColor,
        okBar: getComputedStyle(document.querySelector('.tp-scale .is-ok')).backgroundColor,
        status: getComputedStyle(document.querySelector('.tp-state.is-critical')).color,
        overflow: [...document.querySelectorAll('.tp-last-activity,.tp-canvas-time')].filter((el) => el.scrollWidth > el.clientWidth + 1).map(el=>el.className) };
    });
    assert.equal(colors.count, colors.danger); assert.equal(colors.status, colors.danger); assert.equal(colors.criticalBar, colors.danger);
    assert.ok(colors.criticalRing.includes(colors.danger)); assert.ok(colors.attentionRing.includes(colors.warning)); assert.equal(colors.okBar, colors.success);
    assert.deepEqual(colors.overflow, [], `${width}: novas células sem cortes`);
    assert.deepEqual(await clipped(page), [], `${width}: controles sem cortes`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator(".tp-last-activity time").first().getAttribute("aria-label").then(x=>x.endsWith("(Brasília)")), true);
    // Evidência visual opcional, com dados inteiramente fictícios e sem tokens.
    if (process.env.TEACHER_SCREENSHOTS && width !== 320) await page.screenshot({ path: path.join(process.env.TEACHER_SCREENSHOTS, width === 1440 ? "desktop.png" : "mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
});

const observation = (status, observedAt, extra = {}) => ({ status, observedAt, referenceAt: null,
  attemptedAt: "2026-10-11T09:00:00Z", lastValidObservedAt: observedAt, reason: null, ...extra });
const mixedEngagement = () => report([
  row("1", "Aluno com tempo zero", { canvasActivity: { totalActivityTime: 0, lastActivityAt: null,
    provenance: { totalActivityTime: observation("current", "2026-10-11T09:00:00Z"), lastActivityAt: observation("unknown", null, { reason: "null" }) } } }),
  row("2", "Aluna com tempo preservado", { status: "attention", kc: 60, canvasActivity: { totalActivityTime: 7200, lastActivityAt: "2026-10-10T12:00:00Z",
    provenance: { totalActivityTime: observation("retained", "2026-10-01T09:00:00Z", { reason: "missing" }), lastActivityAt: observation("current", "2026-10-11T09:00:00Z") } } }),
  row("3", "Aluno com atividade preservada", { status: "critical", kc: 40, lab: 50, canvasActivity: { totalActivityTime: null, lastActivityAt: "2026-09-30T09:00:00Z",
    provenance: { totalActivityTime: observation("unknown", null, { reason: "null" }), lastActivityAt: observation("retained", "2026-10-01T09:00:00Z", { reason: "invalid" }) } } }),
  row("4", "Aluna com dado legado", { canvasActivity: { totalActivityTime: 1800, lastActivityAt: null, collectedAt: "2026-10-01T09:00:00Z" } }),
  row("5", "Aluno desistente", { participationStatus: "WITHDRAWN", canvasActivity: { totalActivityTime: 999999, lastActivityAt: "2020-01-01T00:00:00Z" } }),
], { canvasEngagement: { courseId: "4436", status: "partial", attemptedAt: "2026-10-11T09:00:00Z", collectedAt: "2026-10-01T09:00:00Z" } });

test("AS-03: cobertura/qualidade independentes, zero e legado visíveis sem coleta falsamente recente", async () => {
  for (const options of [{ width: 1440 }, { width: 390 }, { width: 320, text: 2 }]) {
    const { page, context, errors } = await open({ ...options, data: mixedEngagement });
    const engagement = page.locator(".tp-engagement");
    assert.match(await engagement.innerText(), /30min\nMediana de 3 de 4 alunos ativos/);
    assert.match(await engagement.innerText(), /Cobertura de última atividade: 2 de 4/);
    assert.match(await engagement.innerText(), /Coleta de atividade parcial/);
    assert.match(await engagement.innerText(), /Coleta desatualizada/);
    assert.match(await engagement.innerText(), /não comprova ausência de atividade após a coleta/);
    const zero = page.locator(".tp-row", { hasText: "Aluno com tempo zero" });
    assert.equal((await zero.locator(".tp-canvas-time").innerText()).includes("0min"), true);
    assert.equal((await zero.locator(".tp-last-activity").innerText()).includes("Sem informação"), true);
    const retained = page.locator(".tp-row", { hasText: "Aluna com tempo preservado" });
    assert.match(await retained.locator(".tp-canvas-time").innerText(), /Dado preservado/);
    assert.match(await retained.locator(".tp-canvas-time .tp-data-quality").getAttribute("title"), /01\/10\/2026/);
    assert.match(await page.locator(".tp-row", { hasText: "Aluna com dado legado" }).innerText(), /Rastreio legado/);
    assert.equal(await pageScroll(page), 0);
    if (process.env.AS07_SCREENSHOTS && options.width !== 320) {
      await mkdir(process.env.AS07_SCREENSHOTS, { recursive: true });
      await engagement.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.AS07_SCREENSHOTS, options.width === 1440 ? "engagement-desktop.png" : "engagement-mobile.png") });
      await retained.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.AS07_SCREENSHOTS, options.width === 1440 ? "rows-desktop.png" : "rows-mobile.png") });
    }
    assert.deepEqual(errors, []); await context.close();
  }
});

test("AS-07: busca/filtros/ordenação não recriam casca, foco ou agregados; seleção e CSV completo preservados", async () => {
  for (const role of ["instructor", "admin"]) {
    const { page, context, errors } = await open({ role, data: () => report(MANY) });
    await page.evaluate(() => { window.teacherNodes = Object.fromEntries([".sidebar", ".tp-overview", ".tp-engagement", "#search", "#student-sort", "#status-filter"].map((s) => [s, document.querySelector(s)])); });
    const unchanged = async () => assert.equal(await page.evaluate(() => Object.entries(window.teacherNodes).every(([selector, node]) => node === document.querySelector(selector))), true);
    await page.locator("#search").fill("carl"); await unchanged();
    await page.locator("#search").evaluate((el) => el.setSelectionRange(1, 2));
    await page.keyboard.insertText("á"); await unchanged();
    assert.equal(await page.locator("#search").inputValue(), "cárl");
    assert.equal(await page.locator("#search").evaluate((el) => el.selectionStart), 2);
    assert.equal(await page.evaluate(() => document.activeElement.id), "search");
    await page.locator("#status-filter").selectOption("critical"); await unchanged();
    await page.locator("#student-sort").selectOption("pending"); await unchanged();
    await page.locator("#canvas-activity-filter").selectOption("unknown"); await unchanged();
    assert.equal(await page.locator(".tp-row").count(), 5);
    await page.locator('.tp-filter[data-filter="attention"]').click(); await unchanged();
    assert.equal(await page.locator("#status-filter").inputValue(), "attention");
    assert.equal(await page.locator('.tp-filter[data-filter="attention"]').getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Limpar filtros", exact: true }).click(); await unchanged();
    assert.equal(await page.locator(".tp-row").count(), MANY.length);
    await page.locator("#search").fill("ZZZ-sem-correspondencia"); await unchanged();
    await page.getByRole("button", { name: "Limpar busca e filtros", exact: true }).focus();
    await page.keyboard.press("Enter"); await unchanged();
    assert.equal(await page.locator(".tp-row").count(), MANY.length);
    assert.equal(await page.getByRole("button", { name: "Limpar filtros", exact: true }).evaluate((el) => document.activeElement === el), true,
      "limpar o estado vazio mantém o foco no controle equivalente, sem cair no body");
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: `Exportar CSV (${MANY.length})`, exact: true }).click();
    const csv = await readFile(await (await download).path(), "utf8");
    assert.equal(csv.split("\r\n").length, MANY.length + 1);
    for (const student of MANY) assert.ok(csv.includes(student.name), student.name);
    await page.locator("#cohort").selectOption("BRSA0268"); await settle(page);
    assert.equal(await page.locator("#search").inputValue(), "");
    assert.equal(await page.evaluate(() => window.teacherNodes["#search"] !== document.querySelector("#search")), true, "troca de contexto mantém render completo");
    assert.deepEqual(errors, []); await context.close();
  }
});

test("TODO27: cartão Crítico abre o universo contado, limpa busca/Canvas e mantém filtros manuais combináveis e CSV", async () => {
  const students = ROSTER.map((student) => ({ ...student,
    canvasActivity: { totalActivityTime: 3600, lastActivityAt: student.id === "6" ? "2026-10-01T12:00:00Z" : "2026-10-10T12:00:00Z" } }));
  const { page, context, errors } = await open({ data: () => report(students) });
  try {
    const names = () => page.locator(".tp-student").allTextContents();
    const critical = page.locator('.tp-filter[data-filter="critical"]');
    assert.equal(await shortcutCount(page, "critical"), 2);
    await page.locator("#search").fill("Carla");
    await page.locator("#canvas-activity-filter").selectOption("recent");
    assert.deepEqual(await names(), ["Carla Cavalcanti"]);

    await critical.click();
    assert.equal(await page.locator("#search").inputValue(), "", "o atalho limpa a busca incompatível com seu número");
    assert.equal(await page.locator("#canvas-activity-filter").inputValue(), "all", "o atalho limpa o filtro auxiliar");
    assert.equal(await page.locator("#status-filter").inputValue(), "critical");
    assert.equal(await critical.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await names(), ["Carla Cavalcanti", "Felipe Figueiredo"]);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV (2)", exact: true }).click();
    const csv = await readFile(await (await download).path(), "utf8");
    assert.equal(csv.split("\r\n").length, 3, "cabeçalho e os dois resultados do cartão");
    assert.ok(csv.includes("Carla Cavalcanti") && csv.includes("Felipe Figueiredo"));
    assert.ok(!csv.includes("Ana Albuquerque"));

    // Seletores e busca continuam combináveis: apenas o cartão é um atalho de universo.
    await page.locator("#canvas-activity-filter").selectOption("inactive");
    await page.locator("#search").fill("Felipe");
    assert.deepEqual(await names(), ["Felipe Figueiredo"]);
    await page.locator("#status-filter").selectOption("attention");
    assert.equal(await page.locator(".tp-row").count(), 0);
    assert.equal(await page.locator("#search").inputValue(), "Felipe");
    assert.equal(await page.locator("#canvas-activity-filter").inputValue(), "inactive");
    await page.locator("#status-filter").selectOption("critical");
    assert.deepEqual(await names(), ["Felipe Figueiredo"]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

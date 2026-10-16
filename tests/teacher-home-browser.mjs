// Expansão 4 do piloto visual: Painel do instrutor como instrumento de acompanhamento (docs/design-visual.md), com API
// fictícia (nunca AWS, Canvas, publicação ou envio real). Cobre o que a tela promete: composição (tabela com largura,
// linhas empilhadas no tablet, no celular e com texto ampliado), sem rolagem lateral nem controle recortado em 320–1440 px,
// texto e zoom a 200% e janela baixa; os dois botões que passavam da tela com texto a 200% em 320 px; atalhos de filtro
// com o número da lista; Foco da turma com andamento, resultado e erro na própria seção; estados; situação por texto e
// forma; teclado na ordem visual com contorno inteiro (pixels); o mesmo painel para o admin.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
const LONG = [row("1", "Allysson Borges - Allysson Roberto Borges Lima De Moraes", { email: "allysson.roberto.borges.lima.de.moraes.turma.manha@exemplo-instituicao-parceira.example.test", portalLinked: false }),
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

// control: report (objeto ou função), reportMode ("ok" | "error" | "hold"), focusMode ("ok" | "409" | "hold"), autoSync.
async function open({ width = 1440, height = 900, text = 1, role = "instructor", data = () => report(), autoSync = true, saved = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  const errors = [], control = { data, reportMode: "ok", focusMode: "ok", reports: 0, focusPosts: [], holds: {} };
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  const email = role === "admin" ? "admin@example.test" : role === "student" ? "ana.1@example.test" : "instrutor@example.test";
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
      await hold("focus");
      if (control.focusMode === "409") return route.fulfill({ status: 409, json: { error: "O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar." } });
      return route.fulfill({ json: { focus: { activityIds: request.postDataJSON().activityIds, version: `v${control.focusPosts.length}` } } });
    }
    if (endpoint.endsWith("/pending-preview")) return route.fulfill({ status: 404, json: { error: "não simulado" } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  if (role !== "student") await page.locator(".layout .page-heading h1").waitFor();
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
// Resposta do salvamento do foco processada pela tela: espera a rota responder e o render seguinte, sem esperar um
// resultado específico aparecer (assim, um resultado errado ou ausente falha por asserção, não por tempo esgotado).
const focusResponse = (page) => { const response = page.waitForResponse((r) => r.url().endsWith("/focus-activities"));
  return async () => { await response; await page.waitForTimeout(50); await settle(page); }; };
const shortcutCount = (page, filter) => page.locator(`[data-filter="${filter}"] > strong`).textContent({ timeout: 2000 }).then(Number);
// Controles (e células da tabela) recortados pela janela ou por um ancestral com overflow, e texto cortado dentro do controle.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".teacher-home :is(a, button, select, input, h1, h2, .tp-student, .tp-email, .tp-value, .tp-state, .tp-tag, .tp-focus-name)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.closest("thead")) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.id || el.tagName).trim().slice(0, 30)}`);
    if (el.matches("button, .tp-value, .tp-state") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 30)}`);
  }
  return bad;
});
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
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

test("P1: composição — tabela com largura (52rem de painel), linhas empilhadas no tablet, no celular e com texto ampliado; situação e foco lado a lado só com largura", async () => {
  for (const [width, height, text, table, side] of [[1440, 900, 1, true, true], [1280, 800, 1, true, true], [1024, 768, 1, false, false], [768, 1024, 1, false, false], [390, 844, 1, false, false],
    [320, 640, 1, false, false], [1440, 900, 2, false, false]]) {
    const { context, page, errors } = await open({ width, height, text });
    const m = await page.evaluate(() => {
      const tr = document.querySelector(".tp-row"), thead = document.querySelector(".tp-table thead"), head = thead?.getBoundingClientRect();
      const o = document.querySelector(".tp-overview")?.getBoundingClientRect(), f = document.querySelector(".tp-focus")?.getBoundingClientRect();
      if (!tr || !head || !o || !f) return { row: null, theadVisible: null, labels: null, side: null };
      const values = [...document.querySelectorAll(".tp-statuses .tp-filter > strong")].map((s) => Math.round(s.getBoundingClientRect().top));
      return { row: getComputedStyle(tr).display, theadVisible: head.width > 1 && head.height > 1, labels: getComputedStyle(tr.querySelector(".tp-cell-label")).display !== "none",
        sticky: getComputedStyle(thead.querySelector("th")).position, kcAlign: getComputedStyle(tr.querySelector(".tp-avg")).textAlign, side: f.left >= o.right - 1 && Math.abs(f.top - o.top) < 40,
        frame: getComputedStyle(document.querySelector(".tp-overview")).borderTopWidth, sameRow: new Set(values).size === 1, statusesSide: values.length === 3 && new Set([...document.querySelectorAll(".tp-statuses .tp-filter")].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1 };
    });
    const id = `${width}×${height}${text > 1 ? ` a ${text * 100}%` : ""}`;
    assert.equal(m.row, table ? "table-row" : "grid", `${id}: linha`);
    assert.equal(m.theadVisible, table, `${id}: cabeçalho visível só na tabela`);
    assert.equal(m.labels, !table, `${id}: rótulo em cada valor só nas linhas empilhadas`);
    if (table) assert.deepEqual([m.sticky, m.kcAlign], ["sticky", "right"], `${id}: cabeçalho fixo e números à direita`);
    assert.equal(m.side, side, `${id}: situação e foco lado a lado`);
    // Com as três situações lado a lado, os números ficam na mesma linha mesmo quando um rótulo quebra (subgrid); em coluna
    // estreita (celular, texto ampliado) a Situação da turma não tem moldura.
    if (m.statusesSide) assert.ok(m.sameRow, `${id}: números das situações alinhados`);
    assert.equal(m.frame, width <= 390 || text > 1 ? "0px" : "1px", `${id}: moldura da Situação da turma`);
    // O cabeçalho da coluna existe para a leitura assistiva em todos os modos.
    assert.deepEqual(await page.locator(".tp-table thead th").allTextContents(), ["Aluno", "Média KC referência 70%", "Média LAB referência 95%", "Sem nota", "Situação", "Ação"]);
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

test("P3: \"Enviar CSV manualmente\" e \"Salvar foco da turma\" cabem em 320 px com texto a 200%: texto inteiro, alvo de 44 px, estado desabilitado, foco e ação preservados", async () => {
  for (const [height, text] of [[640, 2], [568, 2], [640, 2.5]]) {
    const { context, page, errors, control } = await open({ width: 320, height, text, data: () => report(ROSTER, { focus: { activityIds: ["a1"], version: "v0" } }) });
    const id = `320×${height} a ${text * 100}%`;
    const measure = (name) => page.getByRole("button", { name, exact: true }).evaluate((el) => {
      const r = el.getBoundingClientRect(), box = (el.closest(".teacher-home") || el.closest("main")).getBoundingClientRect();
      return { inside: r.left >= box.left - 0.5 && r.right <= Math.min(box.right, innerWidth) + 0.5, height: r.height, text: el.innerText.replace(/\s+/g, " ").trim(), cut: el.scrollWidth > el.clientWidth + 1, disabled: el.disabled };
    });
    for (const name of ["Enviar CSV manualmente", "Salvar foco da turma"]) {
      const m = await measure(name);
      assert.ok(m.inside && !m.cut, `${id}: ${name} dentro da tela e sem corte (${JSON.stringify(m)})`);
      assert.equal(m.text, name, `${id}: texto inteiro`);
      assert.ok(m.height >= 44, `${id}: ${name} com ${m.height} px`);
    }
    // Estado: com foco salvo e sem mudança, Salvar fica habilitado (salvar de novo é permitido, como antes); vazio, parado.
    assert.equal((await measure("Salvar foco da turma")).disabled, false);
    // Foco pelo teclado: contorno inteiro nos dois.
    for (const name of ["Enviar CSV manualmente", "Salvar foco da turma"]) {
      await page.getByRole("button", { name, exact: true }).focus();
      await page.evaluate(() => document.activeElement.scrollIntoView({ block: "center" }));
      await settle(page);
      assert.deepEqual(await ringOnScreen(page), [], `${id}: contorno de ${name}`);
    }
    // As ações continuam as mesmas: salvar envia o foco; o CSV leva a Atualizar notas.
    await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
    await page.locator("#tp-focus-status.is-saved").waitFor();
    assert.deepEqual(control.focusPosts, [{ activityIds: ["a1"], expectedCurrent: publication.id, expectedVersion: "v0" }]);
    await page.getByRole("button", { name: "Remover 254-NF- KC Introdução à rede do foco", exact: true }).click();
    assert.equal((await measure("Salvar foco da turma")).disabled, true, `${id}: sem atividades, Salvar parado`);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Escolher na visão por atividade", `${id}: sem Remover nem Salvar, o foco vai a escolher`);
    await page.getByRole("button", { name: "Enviar CSV manualmente", exact: true }).click();
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

test("P5: Foco da turma — alteração pendente, salvando (Salvar e Remover parados mesmo com renders), salvo e erro na própria seção, com o foco no resultado e sem aviso temporário", async () => {
  const { context, page, errors, control, holdNext } = await open({ data: () => report(ROSTER, { focus: { activityIds: ["a1", "a2"], version: "v0" } }) });
  const status = () => page.locator("#tp-focus-status");
  assert.equal(await page.locator(".tp-focus .focus-list li").count(), 2, "Foco da turma aberto no painel, com as duas atividades");
  assert.equal(await status().count(), 0);
  // Antes, um controle com memória no render (a busca): remover não pode devolver o foco para lá.
  await page.locator("#search").focus();
  await page.locator("#search").fill("");
  await page.getByRole("button", { name: "Remover 255--Lab - Sub-redes e tabelas de rotas na Amazon VPC do foco", exact: true }).click();
  assert.equal(await status().textContent(), "Alterações ainda não salvas: os alunos continuam vendo o foco anterior.");
  assert.equal(control.focusPosts.length, 0, "remover não salva");
  // O foco fica no Remover que sobrou (a última posição), não volta à busca.
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Remover 254-NF- KC Introdução à rede do foco");
  // Salvando: o andamento recebe o foco (o botão é recriado parado); salvo, o foco vai à confirmação.
  const hold = holdNext("focus");
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await hold.arrived.promise;
  assert.equal(await status().textContent(), "Salvando o foco da turma…");
  assert.equal(await status().getAttribute("role"), "status");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tp-focus-status", "foco no andamento");
  let answered = focusResponse(page);
  hold.gate.resolve();
  await answered();
  assert.equal(await status().count() && await status().textContent(), "Foco da BRSA0267 atualizado.");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tp-focus-status", "foco no resultado");
  assert.deepEqual(control.focusPosts, [{ activityIds: ["a1"], expectedCurrent: publication.id, expectedVersion: "v0" }]);
  assert.deepEqual(await notices(page), []);
  assert.equal(await page.locator('#focus-form [type="submit"]').getAttribute("class"), "button secondary");
  // Um render no meio do salvamento (a busca redesenha a tela) não reabilita Salvar nem Remover: um envio por clique.
  const busy = holdNext("focus");
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await busy.arrived.promise;
  await page.locator("#search").fill("ana");
  await page.locator("#search").fill("");
  assert.equal(await status().textContent(), "Salvando o foco da turma…");
  assert.deepEqual(await page.locator(".tp-focus button").evaluateAll((els) => els.filter((b) => b.matches('[type="submit"], .tp-remove')).map((b) => b.disabled)), [true, true]);
  await page.locator('#focus-form [type="submit"]').click({ force: true, timeout: 1000 }).catch(() => {});
  answered = focusResponse(page);
  busy.gate.resolve();
  await answered();
  assert.equal(await status().count() && await status().textContent(), "Foco da BRSA0267 atualizado.");
  assert.equal(control.focusPosts.length, 2, "nenhum envio a mais");
  // Erro (409): o motivo do servidor fica na seção, como alerta, com o foco; o rascunho continua; nenhum aviso.
  control.focusMode = "409";
  await page.getByRole("button", { name: "Remover 254-NF- KC Introdução à rede do foco", exact: true }).click();
  await page.locator('.tp-actions [data-view="activity-overview"]').click();
  await page.locator('[data-add-focus="a3"]').click();
  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  answered = focusResponse(page);
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await answered();
  assert.equal(await status().count() && await status().textContent(), "O foco não foi salvo. O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar.");
  assert.equal(await status().getAttribute("role"), "alert");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tp-focus-status");
  assert.deepEqual(await page.locator(".focus-list .tp-focus-name").allTextContents(), ["226-LX-KC - Uma introdução ao Linux"]);
  assert.deepEqual(await notices(page), []);
  // Nova tentativa: o motivo antigo some enquanto salva.
  control.focusMode = "ok";
  const again = holdNext("focus");
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await again.arrived.promise;
  assert.equal(await status().textContent(), "Salvando o foco da turma…");
  answered = focusResponse(page);
  again.gate.resolve();
  await answered();
  assert.equal(await status().count() && await status().textContent(), "Foco da BRSA0267 atualizado.");
  assert.deepEqual(errors, []);
  await context.close();
});

test("P5b: resposta do salvamento com outro relatório na tela (Consultar atualização ou outra turma) não aparece no relatório novo; vai para o aviso, como antes", async () => {
  const { context, page, errors, control, holdNext } = await open({ data: () => report(ROSTER, { focus: { activityIds: ["a1"], version: "v0" } }) });
  assert.ok(await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).isVisible(), "Salvar à vista no painel");
  let hold = holdNext("focus");
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await hold.arrived.promise;
  await page.getByRole("button", { name: "Consultar atualização", exact: true }).click();
  await page.locator(".teacher-home .tp-row").first().waitFor();
  // O andamento é do relatório em que o salvamento começou: o relatório novo não o herda.
  assert.equal(await page.locator("#tp-focus-status").count(), 0, "relatório novo sem o andamento do anterior");
  let answered = focusResponse(page);
  hold.gate.resolve();
  await answered();
  assert.deepEqual(await notices(page), ["Foco da BRSA0267 atualizado."]);
  assert.equal(await page.locator("#tp-focus-status").count(), 0, "nenhum resultado no relatório novo");
  assert.equal(await page.locator('#focus-form [type="submit"]').isDisabled(), false);
  // Erro com outra turma na tela: o aviso de erro, com a turma de origem (C1, D05: sem ela, o motivo parecia ser da BRSA0268).
  control.focusMode = "409";
  hold = holdNext("focus");
  await page.getByRole("button", { name: "Salvar foco da turma", exact: true }).click();
  await hold.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }).waitFor();
  answered = focusResponse(page);
  hold.gate.resolve();
  await answered();
  assert.deepEqual(await notices(page), ["O foco da BRSA0267 não foi salvo. O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar."]);
  assert.equal(await page.locator("#notices .notice.error").count(), 1);
  assert.equal(await page.locator("#tp-focus-status").count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("P5c: remover uma atividade do meio do foco deixa o foco no Remover que ocupou o lugar, não no primeiro", async () => {
  const { context, page, errors } = await open({ data: () => report(ROSTER, { focus: { activityIds: ["a1", "a2", "a3"], version: "v0" } }) });
  assert.equal(await page.locator(".tp-focus .focus-list li").count(), 3, "Foco da turma aberto no painel, com as três atividades");
  await page.getByRole("button", { name: "Remover 255--Lab - Sub-redes e tabelas de rotas na Amazon VPC do foco", exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Remover 226-LX-KC - Uma introdução ao Linux do foco");
  assert.deepEqual(await page.locator(".focus-list .tp-focus-name").allTextContents(), ["254-NF- KC Introdução à rede", "226-LX-KC - Uma introdução ao Linux"]);
  assert.deepEqual(errors, []);
  await context.close();
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
      if (/Ver pendências|Remover|Salvar foco|Ver todos|Atenção|search/.test(info.name)) assert.deepEqual(await ringOnScreen(page), [], `${width}: contorno em ${info.name}`);
      assert.ok(info.visible, `${width}: ${info.name} à vista`);
    }
    // A ordem do teclado segue a leitura: de cima para baixo e, numa mesma faixa, da esquerda para a direita.
    const names = order.map((o) => o.name);
    assert.deepEqual(names.slice(0, 3), ["Ver por atividade", "Enviar CSV manualmente", "Consultar atualização"]);
    assert.ok(names.indexOf("Alunos na publicação") < names.indexOf("Médias na referência") && names.indexOf("Crítico") < names.indexOf("Com atividades sem nota"), names.join(" | "));
    assert.ok(names.indexOf("Ainda não entraram") < names.indexOf("Remover 254-NF- KC Introdução à rede do foco"), names.join(" | "));
    assert.ok(names.indexOf("Escolher na visão por atividade") < names.indexOf("search"), names.join(" | "));
    const rows = names.filter((n) => n.startsWith("Ver pendências de "));
    assert.deepEqual(rows, ROSTER.map((r) => `Ver pendências de ${r.name}`).sort((a, b) => a.localeCompare(b, "pt-BR")).slice(0, rows.length));
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i], sameBand = Math.abs(a.top - b.top) < 24;
      if (width > 1000 && a.name.startsWith("Ver pendências") === false) assert.ok(b.top > a.top - 24 && (!sameBand || b.left > a.left - 1) || /Remover|Salvar|Escolher|search/.test(b.name), `${a.name} → ${b.name}`);
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

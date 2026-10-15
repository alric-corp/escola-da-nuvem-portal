// Piloto visual, 2ª iteração ("Instrumento de referência", docs/design-visual.md), com API fictícia. Nunca acessa
// AWS, Cognito ou Canvas. Um teste por item aprovado: V1 contorno do <main>, V2 papéis de cor, V3 primeira atividade
// na primeira tela, V4 cobertura em régua segmentada, V5 médias no celular, V6 linhas de atividade, V7 quebras e
// marcador, V10 turma fora do resumo.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

const canvas = (n) => `https://awsrestart.instructure.com/courses/4436/modules/items/${n}`;
const act = (id, name, kind, state, percent = null, releasedAt = null) => ({ id, name, kind, state, percent, score: percent, points: "100",
  active: state !== "unreleased", needsReview: state === "completed" && percent != null && percent < (kind === "kc" ? 70 : 95),
  module: "Linux", moduleOrder: 7, canvasUrl: ["pending", "completed"].includes(state) ? canvas(9000 + id.length * 7 + id.charCodeAt(id.length - 1)) : null, releasedAt });
// 7 com nota (3 abaixo da referência), 1 sem nota, 1 dispensada e 1 não liberada.
const activities = [
  act("a1", "10- CF - KC — Introdução ao Amazon S3", "kc", "completed", 90, "2026-08-24T12:00:00Z"),
  act("a2", "11--Lab - Introdução ao Amazon EC2", "lab", "completed", 100, "2026-08-24T12:00:00Z"),
  act("a3", "12- CF -KC — Introdução ao Amazon EC2", "kc", "completed", 55, "2026-08-31T12:00:00Z"),
  act("a4", "225--Lab - Introdução ao Linux", "lab", "completed", 100, "2026-08-31T12:00:00Z"),
  act("a5", "226-LX-KC - Uma introdução ao Linux", "kc", "completed", 60, "2026-09-07T12:00:00Z"),
  act("a6", "227--Lab - Linha de comando do Linux", "lab", "completed", 88.5, "2026-09-07T12:00:00Z"),
  act("a7", "254-NF- KC Introdução à rede", "kc", "pending", null, "2026-09-14T12:00:00Z"),
  act("a8", "255--Lab - Sub-redes e tabelas de rotas na Amazon VPC", "lab", "completed", 97, "2026-09-14T12:00:00Z"),
  act("a9", "119- PF -KC - Introdução ao Python", "kc", "exempt"),
  act("a10", "195-CERT-KC -Preparação da Certificação", "kc", "unreleased"),
];
const student = { id: "1", name: "Maria Teste", email: "maria@example.test", kc: 51.25, lab: 96.38, total: 73.81, completed: 7, pending: 1, progress: 87.5, status: "attention", activities };
const history = [
  { publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 51.25, lab: 96.38, total: 73.81, changes: { kc: -6.25, lab: 3.63, pendingBefore: 2, pendingAfter: 1, activities: [], removed: [] } },
  { publishedAt: "2026-10-02T21:00:00Z", current: false, kc: 57.5, lab: 92.75, total: 75.13, changes: null },
  { publishedAt: "2026-09-25T21:00:00Z", current: false, kc: 61, lab: 90, total: 75.5, changes: null },
  { publishedAt: "2026-09-18T21:00:00Z", current: false, kc: 48, lab: 85, total: 66.5, changes: null },
];
const report = (over = {}) => ({ cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-10T21:04:00Z",
  updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, student, history, focus: { activityIds: [], version: null }, ...over });
// Mesma turma com as situações invertidas (KC na referência, LAB abaixo): a cor de cada série não pode mudar.
const swapped = () => report({ student: { ...student, kc: 82, lab: 90 } });
// Nenhuma atividade liberada: zero de zero.
const empty = () => report({ student: { ...student, kc: null, lab: null, total: null, completed: 0, pending: 0, progress: null, status: "insufficient",
  activities: activities.map((a) => ({ ...a, state: "unreleased", active: false, percent: null, score: null, needsReview: false })) },
history: [{ ...history[0], kc: null, lab: null, changes: null }] });
// 30 atividades liberadas (20 com nota): acima de 24, a régua vira barra contínua.
const many = () => {
  const list = Array.from({ length: 30 }, (_, i) => act(`m${i}`, `Atividade ${i + 1}`, i % 2 ? "lab" : "kc", i < 20 ? "completed" : "pending", i < 20 ? 100 : null));
  return report({ student: { ...student, activities: list, completed: 20, pending: 10, progress: 66.67 } });
};

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

async function open({ width = 1440, height = 900, data = report } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [], external = [], calls = { report: 0 };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["student"], email: "maria@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: false, autoSync: true }] } });
    if (endpoint.endsWith("/report")) { calls.report++; return route.fulfill({ json: data() }); }
    throw new Error("endpoint não simulado: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
  return { context, page, errors, external, calls };
}

// Quebras: "·" no fim ou no começo de uma linha, dentro do mesmo bloco de texto. Lê as linhas reais do navegador
// (retângulos de cada caractere), não o CSS.
const separatorBreaks = (page) => page.evaluate(() => {
  const chars = [], walker = document.createTreeWalker(document.querySelector(".student-home"), NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) for (let i = 0; i < node.data.length; i++) chars.push({ node, i, ch: node.data[i] });
  const rect = ({ node, i }) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getClientRects()[0]; };
  // Itens de uma lista em linha (ex.: legenda do resumo) quebram como um texto só: o bloco é a lista.
  const block = ({ node }) => node.parentElement.closest("p, ul, ol, dl, button, a, h1, h2, h3, figcaption, td, th, summary, div");
  const issues = [];
  chars.forEach((c, k) => {
    if (c.ch !== "·") return;
    const self = rect(c);
    if (!self || !self.width) return;
    const near = (step) => { for (let j = k + step; j >= 0 && j < chars.length; j += step) if (/\S/.test(chars[j].ch)) return chars[j]; };
    const [prev, next] = [near(-1), near(1)];
    const text = c.node.parentElement.closest("p, li, button, div")?.innerText.replace(/\s+/g, " ").slice(0, 60);
    if (next && block(next) === block(c) && rect(next)?.top > self.top + 2) issues.push(`fim de linha: ${text}`);
    if (prev && block(prev) === block(c) && rect(prev)?.top < self.top - 2) issues.push(`começo de linha: ${text}`);
  });
  return issues;
});
// Palavras da última linha de cada elemento (palavra isolada = 1).
const lastLineWords = (locator) => locator.evaluateAll((els) => els.map((el) => {
  const tops = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) for (const m of node.data.matchAll(/\S+/g)) {
    const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
    const box = r.getClientRects()[0]; if (box) tops.push(Math.round(box.top));
  }
  const last = Math.max(...tops);
  return [el.innerText.trim(), tops.filter((t) => Math.abs(t - last) <= 2).length];
}));
const lineCount = (locator) => locator.evaluate((el) => {
  const tops = new Set(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) for (const m of node.data.matchAll(/\S+/g)) {
    const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
    const box = r.getClientRects()[0]; if (box && box.width > 1) tops.add(Math.round(box.top / 4));
  }
  return tops.size;
});

test("V1: sem moldura de foco no <main> do piloto; destino do foco (C7.1) e contorno dos controles iguais", async () => {
  const { context, page, errors } = await open();
  const focus = () => page.evaluate(() => { const a = document.activeElement, s = getComputedStyle(a);
    return { tag: a.tagName, id: a.id, text: (a.textContent || "").trim().slice(0, 30), outline: s.outlineStyle, width: s.outlineWidth }; });
  // Destino do foco programático igual ao da 1ª iteração: o <main> depois do carregamento.
  await page.waitForTimeout(100);
  let now = await focus();
  assert.equal(now.id, "main-content");
  assert.equal(now.outline, "none", "o contêiner não interativo não ganha a moldura do navegador");
  // Pular para o conteúdo → <main> (sem moldura) → Tab chega ao primeiro controle, com contorno de 3 px.
  await page.locator(".skip-link").focus();
  assert.deepEqual([(await focus()).outline, (await focus()).width], ["solid", "3px"], "o próprio link de pular continua com contorno");
  await page.keyboard.press("Enter");
  now = await focus();
  assert.deepEqual([now.id, now.outline], ["main-content", "none"]);
  await page.keyboard.press("Tab");
  now = await focus();
  assert.deepEqual([now.tag, now.text, now.outline, now.width], ["BUTTON", "Ver minhas atividades", "solid", "3px"]);
  // Troca de tela pelo teclado: o foco vai para o h1 de cada tela (C7.1), como antes.
  await page.locator('.nav-item[data-view="activities"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Minhas atividades", level: 1 }).waitFor();
  assert.deepEqual([(await focus()).tag, (await focus()).text], ["H1", "Minhas atividades"]);
  await page.locator('.nav-item[data-view="overview"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
  assert.deepEqual([(await focus()).tag, (await focus()).text], ["H1", "Bom ter você aqui, Maria."]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("V2: cada série tem uma cor fixa em barra, linha, marcadores e legenda; situação só no ícone e no texto", async () => {
  const colors = (page) => page.evaluate(() => {
    const css = (sel, prop, pseudo) => { const el = document.querySelector(sel); return el ? getComputedStyle(el, pseudo)[prop] : `ausente: ${sel}`; };
    const series = (key, n) => ({
      bar: css(`.student-summary .goal:nth-child(${n}) .goal-bar i`, "backgroundColor"),
      barMark: css(`.student-summary .goal:nth-child(${n}) .goal-bar b`, "backgroundColor"),
      barMarkTip: css(`.student-summary .goal:nth-child(${n}) .goal-bar b`, "borderTopColor", "::before"),
      line: css(`.evolution path.evo-${key}`, "stroke"),
      dot: css(`.evolution circle.evo-${key}`, "stroke"),
      refLine: css(`.evolution line.evo-ref.evo-${key}`, "stroke"),
      refMark: css(`.evolution .evo-ref-mark.ref-${key}`, "fill"),
      refLabel: css(`.evolution .evo-ref-label.evo-${key}`, "fill"),
      legend: css(`.evolution-legend .evo-key.evo-${key}`, "borderTopColor", "::before"),
    });
    return { kc: series("kc", 1), lab: series("lab", 2), action: css(".student-summary .button.primary", "backgroundColor"),
      warning: getComputedStyle(document.documentElement).getPropertyValue("--warning").trim(),
      status: [...document.querySelectorAll(".student-summary .goal")].map((g) => [g.className, getComputedStyle(g.querySelector(".goal-status")).color]),
      tokens: ["--color-series-kc", "--color-series-lab"].map((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim()) };
  });
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const { context, page } = await open();
  const first = await colors(page);
  assert.ok(first.tokens.every(Boolean), "tokens semânticos das séries declarados no :root");
  for (const key of ["kc", "lab"]) assert.equal(new Set(Object.values(first[key])).size, 1, `${key}: uma única cor em todas as partes ${JSON.stringify(first[key])}`);
  assert.notEqual(first.kc.bar, first.lab.bar, "KC e LAB com cores diferentes");
  for (const key of ["kc", "lab"]) {
    assert.notEqual(first[key].bar, first.action, `${key} não usa a cor de ação`);
    assert.ok(![rgb("#f2b84b"), rgb("#00ebd2"), rgb("#d96b78")].includes(first[key].bar), `${key} não usa cor de situação`);
  }
  // Situação: âmbar abaixo, verde-água na referência (com ícone e texto, já cobertos no teste do piloto).
  assert.deepEqual(first.status.map(([cls, color]) => [cls.match(/goal-(below|reached)/)[1], color]), [["below", rgb("#f2b84b")], ["reached", rgb("#00ebd2")]]);
  await context.close();
  // Situações invertidas: as cores das séries não mudam.
  const other = await open({ data: swapped });
  const second = await colors(other.page);
  assert.deepEqual([second.kc.bar, second.lab.bar], [first.kc.bar, first.lab.bar]);
  assert.deepEqual(second.status.map(([cls]) => cls.match(/goal-(below|reached)/)[1]), ["reached", "below"]);
  await other.context.close();
});

test("V3: em 1440×900 a primeira atividade aparece inteira; ajuda junto das médias; atualização discreta", async () => {
  const { context, page, errors, calls } = await open({ width: 1440, height: 900 });
  const card = await page.locator(".next-steps .activity-card").first().evaluate((el) => el.getBoundingClientRect().bottom);
  assert.ok(card <= 900, `primeira atividade termina em ${Math.round(card)}px`);
  assert.equal(await page.locator(".student-summary .grading-help").count(), 1, "Como interpretar minhas notas? dentro do resumo, junto das médias");
  const order = await page.evaluate(() => {
    const at = (sel) => document.querySelector(sel);
    const before = (a, b) => !!(at(a).compareDocumentPosition(at(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    const note = [...document.querySelectorAll(".next-steps p")].find((p) => /^Sem nota pode significar/.test(p.textContent));
    return { updateAfterSummary: before(".student-summary", ".update-line"), updateBeforeColumns: before(".update-line", ".student-columns"),
      noteAfterList: !!note && !!(at(".next-list").compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  assert.deepEqual(order, { updateAfterSummary: true, updateBeforeColumns: true, noteAfterList: true });
  // A atualização continua com o mesmo texto e a mesma action.
  assert.match(await page.locator(".update-line").innerText(), /Atualizado automaticamente do Canvas às 6h e às 18h \(horário de Brasília\)[\s\S]*Próxima verificação:?\s*(hoje|amanhã) às \d+h/);
  const before = calls.report;
  await page.locator('.update-line [data-action="refresh-report"]').click();
  await page.waitForTimeout(300);
  assert.equal(calls.report, before + 1, "Consultar atualização recarrega o relatório");
  assert.deepEqual(errors, []);
  await context.close();
});

test("V4: cobertura em texto e régua segmentada, sem anel; zero atividades e acima de 24", async () => {
  const { context, page } = await open();
  assert.equal(await page.locator(".student-summary .ring").count(), 0, "sem anel de progresso");
  const coverage = page.locator(".student-summary .coverage");
  assert.equal(await coverage.locator(".coverage-text").innerText(), "7 de 8 atividades com nota");
  assert.doesNotMatch(await coverage.innerText(), /%/, "a cobertura não se apresenta como porcentagem (não confunde com média)");
  const ruler = coverage.locator(".coverage-ruler");
  assert.equal(await ruler.getAttribute("aria-hidden"), "true", "o texto visível carrega a informação; a régua é só a forma");
  assert.deepEqual([await ruler.locator("i").count(), await ruler.locator("i.is-graded").count()], [8, 7], "um segmento por atividade liberada");
  // Não só cor: segmento com nota é cheio; sem nota é só contorno.
  const look = await ruler.evaluate((el) => [el.querySelector("i.is-graded"), el.querySelector("i:not(.is-graded)")].map((i) => {
    const s = getComputedStyle(i); return { fill: s.backgroundColor, border: s.borderTopWidth }; }));
  assert.notEqual(look[0].fill, "rgba(0, 0, 0, 0)");
  assert.equal(look[1].fill, "rgba(0, 0, 0, 0)");
  assert.notEqual(look[1].border, "0px");
  await context.close();

  const none = await open({ data: empty });
  const zero = none.page.locator(".student-summary .coverage");
  assert.equal(await zero.locator(".coverage-text").innerText(), "Nenhuma atividade liberada ainda");
  assert.equal(await zero.locator(".coverage-ruler, .coverage-bar").count(), 0);
  await none.context.close();

  const lots = await open({ data: many });
  const big = lots.page.locator(".student-summary .coverage");
  assert.equal(await big.locator(".coverage-text").innerText(), "20 de 30 atividades com nota");
  assert.equal(await big.locator(".coverage-ruler").count(), 0, "acima de 24 não há segmentos");
  assert.equal(await big.locator(".coverage-bar").getAttribute("aria-hidden"), "true");
  const ratio = await big.locator(".coverage-bar").evaluate((el) => el.firstElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width);
  assert.ok(Math.abs(ratio - 20 / 30) < 0.02, `barra contínua proporcional (${ratio.toFixed(3)})`);
  await lots.context.close();
});

test("V5: até 600 px, médias em linhas de largura total, situação em peso normal, topo compacto e foco nunca sob a barra", async () => {
  for (const [width, height] of [[390, 844], [320, 640]]) {
    const { context, page, errors } = await open({ width, height });
    const goals = await page.locator(".student-summary .summary-goals").evaluate((box) => [...box.querySelectorAll(".goal")].map((g) => {
      const r = g.getBoundingClientRect(), label = g.querySelector(".goal-label").getBoundingClientRect(), value = g.querySelector(":scope > strong").getBoundingClientRect(), bar = g.querySelector(".goal-bar").getBoundingClientRect();
      return { share: r.width / box.getBoundingClientRect().width, sameRow: Math.abs((label.top + label.bottom) / 2 - (value.top + value.bottom) / 2) < value.height / 2, barBelow: bar.top >= value.bottom,
        weight: getComputedStyle(g.querySelector(".goal-status")).fontWeight, size: parseFloat(getComputedStyle(g.querySelector(".goal-status")).fontSize) };
    }));
    for (const g of goals) {
      assert.ok(g.share > 0.95, `média em linha de largura total em ${width}px (${g.share.toFixed(2)})`);
      assert.ok(g.sameRow && g.barBelow, `nome e média na mesma linha, régua abaixo em ${width}px`);
      assert.equal(g.weight, "400", `situação em peso normal em ${width}px`);
      assert.ok(g.size >= 14, `situação legível (${g.size}px) em ${width}px`);
    }
    // Turma: identificável no seletor do cabeçalho; o topo não a repete visualmente e fica em até duas linhas.
    assert.equal(await page.locator("#cohort").inputValue(), "BRSA0267");
    assert.ok(await page.locator("#cohort").isVisible());
    assert.ok(await page.locator(".topline .location-context > span").evaluate((el) => el.getBoundingClientRect().width <= 1), `topo sem a turma repetida em ${width}px`);
    assert.ok(await lineCount(page.locator(".topline")) <= 2, `topo em até duas linhas em ${width}px`);
    for (const text of ["Meu desempenho", "Aluno", "maria@example.test"]) assert.match(await page.locator(".topline").innerText(), new RegExp(text));
    // Foco pelo teclado: nenhum controle do conteúdo fica atrás da barra inferior fixa.
    await page.locator("#main-content").focus();
    const hidden = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const spot = await page.evaluate(() => { const a = document.activeElement; if (!a.closest(".main")) return null;
        const r = a.getBoundingClientRect(), nav = document.querySelector(".sidebar nav").getBoundingClientRect();
        return { text: (a.textContent || a.id).trim().slice(0, 30), ok: r.top >= 0 && r.bottom <= nav.top + 0.5 }; });
      if (!spot) break;
      if (!spot.ok) hidden.push(spot.text);
    }
    assert.deepEqual(hidden, [], `controles encobertos pela barra em ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolagem lateral em ${width}px`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("V6: estados das atividades num formato só, sem ícone decorativo; tipo, situação e ações preservados", async () => {
  const { context, page } = await open();
  assert.equal(await page.locator(".student-home .activity-symbol").evaluateAll((els) => els.filter((el) => el.getClientRects().length).length), 0, "sem ícones em caixa");
  const cards = page.locator(".next-steps .activity-card");
  assert.equal(await cards.count(), 3);
  const states = await cards.evaluateAll((els) => els.map((card) => {
    const status = card.querySelector(".badge, .review-hint"), s = getComputedStyle(status), mark = getComputedStyle(status, "::before");
    return { text: status.textContent, kind: card.querySelector("small").textContent, link: !!card.querySelector("a.activity-link"),
      look: [s.fontSize, s.fontWeight, s.backgroundColor, s.paddingLeft === s.paddingRight ? "simétrico" : "assimétrico"].join(" "), mark: mark.content !== "none" && mark.content !== "normal" };
  }));
  assert.deepEqual(states.map((s) => s.text), ["Sem nota", "Sugestão de revisão", "Sugestão de revisão"]);
  assert.deepEqual(states.map((s) => s.kind), ["KNOWLEDGE CHECK", "KNOWLEDGE CHECK", "LABORATÓRIO"]);
  assert.ok(states.every((s) => s.link), "ação de abrir no Canvas em cada linha");
  assert.equal(new Set(states.map((s) => s.look)).size, 1, `mesma apresentação: ${JSON.stringify(states.map((s) => s.look))}`);
  assert.match(states[0].look, /rgba\(0, 0, 0, 0\)/, "situação sem fundo de selo");
  assert.ok(states.every((s) => s.mark), "situação também por forma (marca antes do texto)");
  await context.close();
});

test("V7: sem separador ou palavra isolados em 320–1440 px; marcador visível sobre o preenchimento; título menos comprimido", async () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const { context, page } = await open({ width });
    assert.deepEqual(await separatorBreaks(page), [], `separadores em ${width}px`);
    for (const [text, words] of await lastLineWords(page.locator(".student-summary .goal-status")))
      assert.ok(words >= 2, `palavra isolada em "${text}" em ${width}px`);
    if (width === 1440) {
      // Marcador da referência separado do preenchimento por um vão da cor da superfície.
      const ring = await page.locator(".student-summary .goal:nth-child(2) .goal-bar b").evaluate((el) => getComputedStyle(el).boxShadow);
      assert.match(ring, /0px 0px 0px [2-9]px/, `vão em volta do marcador: ${ring}`);
      const h1 = await page.locator(".student-home .page-heading h1").evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing) / parseFloat(getComputedStyle(el).fontSize));
      assert.ok(Math.abs(h1 + 0.01) < 0.002, `espaçamento do título ${h1.toFixed(3)}em`);
    }
    await context.close();
  }
});

test("V10: a turma sai do resumo e continua no contexto de navegação", async () => {
  const { context, page } = await open();
  assert.doesNotMatch(await page.locator(".student-summary").innerText(), /BRSA0267|Turma/);
  assert.match(await page.locator(".topline .location-context").innerText(), /Turma BRSA0267/);
  assert.equal(await page.locator("#cohort").inputValue(), "BRSA0267");
  await context.close();
});

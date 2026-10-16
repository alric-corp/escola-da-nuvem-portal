// Expansão 2 do piloto visual: "Meu histórico" do aluno como registro cronológico das publicações
// (docs/design-visual.md), com API fictícia (nunca AWS, Cognito ou Canvas). Cobre o que a tela promete: escopo (só o
// aluno; "Publicações da turma" do instrutor tem a tela própria, Expansão 5), datas sem ambiguidade, médias com o mesmo arredondamento
// de "Meu desempenho", variações do contrato em pontos percentuais com direção por texto e forma (não só cor), mudanças
// nas atividades classificadas a partir do contrato, versão em vigor e restauração, estados, texto a 200%, zoom,
// teclado e contorno de foco lido nos pixels, sem rolagem lateral nem controle recortado.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
// C3: compacidade (alturas) medida com tipografia de referência — Arial, que tem as mesmas métricas da Liberation Sans do
// Linux —, igual em toda plataforma. Transbordamento, recorte e legibilidade continuam com a fonte do sistema (H6).
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

// Histórico no formato de backend/changes.py (student_history / student_changes), mais recentes primeiro.
const pub = (publishedAt, kc, lab, changes, current = false) => ({ publishedAt, current, kc, lab, total: kc == null || lab == null ? kc ?? lab : (kc + lab) / 2, changes });
const ch = (kc, lab, pendingBefore, pendingAfter, activities = [], removed = []) => ({ kc, lab, pendingBefore, pendingAfter, activities, removed });
const a = (name, previousState, before, state, after) => ({ name, previousState, before, state, after });
const S3 = "10- CF - KC — Introdução ao Amazon S3", EC2 = "12- CF -KC — Introdução ao Amazon EC2", LX = "225--Lab - Introdução ao Linux", LXKC = "226-LX-KC - Uma introdução ao Linux",
  CMD = "227--Lab - Linha de comando do Linux", NET = "254-NF- KC Introdução à rede", VPC = "255--Lab - Sub-redes e tabelas de rotas na Amazon VPC", EC2LAB = "11--Lab - Introdução ao Amazon EC2",
  PY = "119- PF -KC - Introdução ao Python", CERT = "195-CERT-KC -Preparação da Certificação do Cenário de Avaliação";
const SEVEN = [
  pub("2026-10-09T21:03:00Z", 53.75, 96.38, ch(-2.5, 24.25, 2, 1, [a(VPC, "pending", null, "completed", 97), a(S3, "completed", 90, "completed", 80)], ["00-Boas-vindas - Questionário inicial da turma"]), true),
  pub("2026-10-02T21:02:00Z", 56.25, 72.13, ch(-12.08, -24.04, 0, 2, [a(EC2, "completed", 55, "completed", 75), a(NET, "unreleased", null, "pending", null), a(VPC, "unreleased", null, "pending", null)])),
  pub("2026-09-25T21:01:00Z", 68.33, 96.17, ch(0, 0, 0, 0)),
  pub("2026-09-18T21:04:00Z", 68.33, 96.17, ch(20, 29.5, 2, 0, [a(LXKC, "pending", null, "completed", 60), a(CMD, "pending", null, "completed", 88.5), a(PY, "unreleased", null, "exempt", null)])),
  pub("2026-09-11T21:00:00Z", 48.33, 66.67, ch(3.33, 16.67, 2, 2, [a(EC2, "pending", null, "completed", 55), a(LX, "pending", null, "completed", 100), a(LXKC, "unreleased", null, "pending", null), a(CMD, "unreleased", null, "pending", null)])),
  pub("2026-09-04T21:02:00Z", 45, 50, ch(-45, -50, 0, 2, [a(EC2, "unreleased", null, "pending", null), a(LX, "unreleased", null, "pending", null)])),
  pub("2026-08-28T21:00:00Z", 90, 100, null),
];
const LONG = "301-SEC-KC - Gerenciamento de identidades e acessos com AWS IAM, políticas baseadas em recursos e limites de permissões";
const LONG2 = "302--Lab - Configuração de autenticação multifator, rotação de credenciais e auditoria contínua com AWS CloudTrail";
// Todas as transições que o contrato permite, inclusive a pontuação que muda sem mudar a nota.
const ALL = [
  pub("2026-10-09T21:03:00Z", 41.2, 91.6, ch(-8.8, 1.6, 1, 2, [
    a(LONG, "unreleased", null, "pending", null), a(LONG2, "pending", null, "completed", 72.5), a(S3, "completed", 90, "completed", 80),
    a(EC2, "completed", 55, "completed", 75), a(LX, "completed", 100, "pending", null), a(PY, "pending", null, "exempt", null),
    a(CERT, "pending", null, "unreleased", null), a("196-CERT-Lab - Simulado prático de certificação", null, null, "pending", null),
    a(EC2LAB, "completed", 100, "completed", 100), a(NET, "exempt", null, "pending", null)], [LONG.replace("301", "300")]), true),
  pub("2026-10-02T21:02:00Z", 50, 90, null),
];
// Doze publicações (o máximo do backend).
const TWELVE = [...SEVEN.slice(0, 6), pub("2026-08-28T21:00:00Z", 90, 100, ch(0, 0, 0, 0)), pub("2026-08-21T21:00:00Z", 90, 100, ch(0, 0, 0, 0)),
  pub("2026-08-14T21:00:00Z", 90, 100, ch(5, 0, 1, 0, [a("02-Atividade introdutória 2", "pending", null, "completed", 90)])),
  pub("2026-08-07T21:00:00Z", 85, 100, ch(5, 0, 1, 1, [a("01-Atividade introdutória 1", "completed", 80, "completed", 85)])),
  pub("2026-07-31T21:00:00Z", 80, 100, ch(0, null, 0, 1, [a("00-Atividade introdutória 0", "unreleased", null, "completed", 100)])), pub("2026-07-24T21:00:00Z", 80, null, null)];

const student = (kc, lab) => ({ id: "1", name: "Maria Teste", email: "maria@example.test", kc, lab, total: (kc + lab) / 2, status: "attention", completed: 4, pending: 1, progress: 80,
  activities: [{ id: "x1", name: S3, kind: "kc", state: "completed", percent: 80, score: 80, points: "100", active: true, needsReview: false, module: "Cloud", moduleOrder: 1, canvasUrl: null, releasedAt: null }] });
const report = (history, over = {}) => () => {
  const current = history.find((p) => p.current) || { publishedAt: "2026-10-09T21:03:00Z", kc: 53.75, lab: 96.38 };
  return { cohort: "BRSA0267", publication: { id: "p-current", publishedAt: current.publishedAt }, updatedAt: current.publishedAt, updateKind: "canvas",
    thresholds: { kc: 70, lab: 95 }, student: student(current.kc ?? 0, current.lab ?? 0), history, focus: { activityIds: [], version: null }, ...over };
};
const SETS = {
  sete: report(SEVEN), todas: report(ALL), doze: report(TWELVE), vazio: report([]),
  primeira: report([pub("2026-10-09T21:03:00Z", 90, 100, null, true)]),
  semMudanca: report([pub("2026-10-09T21:03:00Z", 68.33, 96.17, ch(0, 0, 1, 1), true), pub("2026-10-02T21:02:00Z", 68.33, 96.17, null)]),
  incompletos: report([pub("2026-10-09T21:03:00Z", 60, 95, ch(15, null, 1, 0, [a(EC2LAB, "pending", null, "completed", 95), a(S3, "pending", null, "completed", 60)]), true),
    pub("2026-10-02T21:02:00Z", 45, null, ch(null, null, 0, 1, [a(S3, "unreleased", null, "pending", null), a(EC2LAB, "unreleased", null, "pending", null)])), pub("2026-09-25T21:01:00Z", null, null, null)]),
  // Variação menor que a casa decimal exibida: não pode virar "+0 p.p." nem "sem mudança".
  minima: report([pub("2026-10-09T21:03:00Z", 68.37, 96.17, ch(0.04, -0.03, 0, 0, [a(LXKC, "completed", 60, "completed", 60.15), a(CMD, "completed", 88.5, "completed", 88.46)]), true), pub("2026-10-02T21:02:00Z", 68.33, 96.2, null)]),
  // A equipe voltou para a publicação de 25/09: as duas mais recentes continuam listadas, mas não estão em vigor.
  restaurada: report(SEVEN.map((p) => ({ ...p, current: p.publishedAt.startsWith("2026-09-25") })), { updateKind: "restore", updatedAt: "2026-10-10T14:20:00Z" }),
  // Datas: virada de ano (as duas com ano) e duas publicações no mesmo dia (a hora separa; o período vira um dia só).
  virada: report([pub("2027-01-08T21:00:00Z", 60, 90, ch(5, 0, 0, 0, [a(S3, "completed", 55, "completed", 60)]), true), pub("2026-12-18T21:00:00Z", 55, 90, null)]),
  mesmoDia: report([pub("2026-10-09T21:03:00Z", 60, 90, ch(1.5, -2, 0, 0, [a(S3, "completed", 55, "completed", 60)]), true), pub("2026-10-09T09:02:00Z", 58.5, 92, null)]),
  // Comparação sem a contagem de "sem nota" (dado incompleto): o item some, sem mostrar vazio.
  semContagem: report([pub("2026-10-09T21:03:00Z", 60, 90, { kc: 5, lab: 0, activities: [a(S3, "completed", 55, "completed", 60)], removed: [] }, true),
    pub("2026-10-02T21:02:00Z", 55, 90, { kc: 0, lab: 0, pendingAfter: 1, activities: [], removed: [] }), pub("2026-09-25T21:02:00Z", 55, 90, null)]),
  html: report([pub("2026-10-09T21:03:00Z", 50, 90, ch(1, 0, 0, 0, [a('<img src=x onerror="window.__xss=1">Atividade & "teste"', "pending", null, "completed", 50)], ["<b>removida</b>"]), true)]),
};
const RING = [0, 203, 221];

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

async function open({ width = 1440, height = 900, text = 1, data = SETS.sete, mode = "ok", role = "student", view = "history" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [], control = { mode, reports: 0 };
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ view, email }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    if (view) localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view }));
  }, { view, email: role === "student" ? "maria@example.test" : "instrutor@example.test" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role === "student" ? "maria@example.test" : "instrutor@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) {
      control.reports++;
      if (control.mode === "hang") return;
      if (control.mode === "error") return route.fulfill({ status: 503, body: "" });
      const r = data();
      if (role === "student") return route.fulfill({ json: r });
      const pubs = [{ id: "p2", publishedAt: "2026-10-09T21:03:00Z", filename: "notas-semana-6.csv", changes: { studentsAdded: 0, studentsRemoved: 0, gradesChanged: 3, activitiesReleased: 1, activitiesPaused: 0 } },
        { id: "p1", publishedAt: "2026-10-02T21:02:00Z", filename: "notas-semana-5.csv", changes: null }];
      return route.fulfill({ json: { ...r, publication: pubs[0], history: pubs, students: [r.student], activities: r.student.activities } });
    }
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  await (mode === "hang" ? page.locator("[role=status]").first() : mode === "error" ? page.locator("[role=alert]").first() : page.locator(".layout .page-heading h1")).waitFor();
  return { context, page, errors, control };
}
const entries = (page) => page.locator(".student-history .history-list > li");
// Texto de cada parte de uma publicação: o que se vê (sem o que é só para leitura assistiva) e o que se ouve.
const read = (page) => page.evaluate(() => [...document.querySelectorAll(".student-history .history-list > li")].map((li) => {
  const seen = (el) => { if (!el) return null; const c = el.cloneNode(true); c.querySelectorAll(".sr-only").forEach((s) => s.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
  // O que chega ao leitor de tela: texto fora de aria-hidden e de elementos não renderizados (display: none, hidden).
  const heard = (el) => { if (!el) return null; let out = ""; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { let ok = true; for (let p = n.parentElement; p && ok; p = p === el ? null : p.parentElement) { const st = getComputedStyle(p); ok = p.getAttribute("aria-hidden") !== "true" && st.display !== "none" && st.visibility !== "hidden"; } if (ok) out += n.data; }
    return out.replace(/\s+/g, " ").trim(); };
  const fig = (k) => { const f = li.querySelector(`.history-figure.${k}`); if (!f) return null; const d = f.querySelector(".history-delta");
    return { label: seen(f.querySelector("dt")), value: seen(f.querySelector(".history-value")), valueHeard: heard(f.querySelector(".history-value")), delta: seen(d), deltaHeard: heard(d), dir: d ? ["is-up", "is-down", "is-same", "is-none"].find((c) => d.classList.contains(c)) : null }; };
  return { heading: li.querySelector("h2")?.textContent.replace(/\s+/g, " ").trim(), datetime: li.querySelector("h2 time")?.getAttribute("datetime"), status: seen(li.querySelector(".history-status")),
    current: li.classList.contains("is-current"), kc: fig("kc"), lab: fig("lab"), pending: fig("pending"), note: seen(li.querySelector(".history-note")),
    summary: seen(li.querySelector("summary")), open: li.querySelector("details")?.open ?? null,
    items: [...li.querySelectorAll(".history-activity")].map((x) => ({ kind: seen(x.querySelector(".history-activity-kind")), name: seen(x.querySelector("strong")), change: seen(x.querySelector(".history-transition")), heard: heard(x.querySelector(".history-transition")) })) };
}));
const clipped = (page, scope) => page.evaluate((scope) => {
  const bad = [];
  for (const el of document.querySelectorAll(`${scope} :is(a, button, summary, select, input)`)) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push((el.textContent || el.getAttribute("aria-label") || el.id || el.tagName).trim().slice(0, 30));
  }
  return bad;
}, scope);
async function ringOnScreen(page) {
  const box = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth) }; });
  const { r, o, w } = box, mid = o + w / 2;
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  const colors = await colorsAt(page, points);
  return Object.entries(colors).filter(([, c]) => !isRing(c)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
}
const isRing = (c) => !!c && c.every((v, i) => Math.abs(v - RING[i]) <= 45);
async function colorsAt(page, points) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
}

test("H1: Meu histórico do aluno é um registro cronológico (lista com uma publicação por título), não uma tabela; o instrutor tem a tela dele", async () => {
  const { context, page, errors } = await open();
  assert.equal(await page.locator(".student-history").count(), 1);
  assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  assert.match(await page.locator(".student-history .page-heading h1").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  assert.equal(await page.locator(".student-history table").count(), 0, "sem tabela");
  assert.equal(await page.locator(".student-history .history-list").getAttribute("role"), "list");
  const list = await read(page);
  // Datas por extenso no fuso do navegador (sem dd/mm ambíguo), dia da semana e hora; uma publicação por título h2,
  // na ordem do contrato (mais recentes primeiro). Mesmo dia com dois horários continua distinguível pela hora.
  assert.deepEqual(list.map((r) => r.heading), ["Publicação de 9 de outubro de 2026, sexta-feira, 18:03", "Publicação de 2 de outubro de 2026, sexta-feira, 18:02",
    "Publicação de 25 de setembro de 2026, sexta-feira, 18:01", "Publicação de 18 de setembro de 2026, sexta-feira, 18:04", "Publicação de 11 de setembro de 2026, sexta-feira, 18:00",
    "Publicação de 4 de setembro de 2026, sexta-feira, 18:02", "Publicação de 28 de agosto de 2026, sexta-feira, 18:00"]);
  assert.deepEqual(list.map((r) => r.datetime), SEVEN.map((p) => p.publishedAt));
  assert.equal(await page.getByRole("heading", { level: 2 }).count(), 7);
  // Contexto numa linha: quantas publicações, o período e a unidade das variações.
  assert.equal((await page.locator(".student-history .history-context").innerText()).replace(/\s+/g, " ").trim(),
    "7 publicações, de 28 de agosto a 9 de outubro de 2026. Variações das médias em pontos percentuais (p.p.).");
  // A regra que explica a queda só onde uma média caiu e houve atividade liberada sem nota (02/10 e 04/09); 11/09 liberou
  // e as médias subiram, 09/10 caiu sem liberar nada.
  assert.deepEqual(await entries(page).evaluateAll((lis) => lis.map((li) => li.querySelector(".history-why")?.textContent ?? null)),
    [null, "Atividades liberadas sem nota contam como 0% na média até a nota sair.", null, null, null, "Atividades liberadas sem nota contam como 0% na média até a nota sair.", null]);
  assert.equal(await page.locator(".student-history .history-limit").count(), 0, "com 7 publicações não há aviso de limite");
  // Versão em vigor marcada só na publicação atual; as outras sem rótulo repetido ("Anterior").
  assert.deepEqual(list.map((r) => [r.current, r.status]), [[true, "Em vigor"], ...Array(6).fill([false, null])]);
  assert.equal(await page.locator('.student-history [data-action="refresh-report"]').count(), 1, "atualização do Canvas e a ação de consultar continuam");
  assert.deepEqual(errors, []);
  await context.close();
  // Publicações da turma (instrutor): a mesma página (history.js), com a tela própria desde a Expansão 5 — uma entrada por
  // publicação, Restaurar só na que não está em vigor —, sem nada de Meu histórico.
  const teacher = await open({ role: "instructor" });
  assert.equal(await teacher.page.locator(".page-heading h1").innerText(), "Publicações da turma");
  assert.equal(await teacher.page.locator(".student-history").count(), 0);
  assert.equal(await teacher.page.locator(".teacher-publications .tpub-entry").count(), 2);
  assert.equal(await teacher.page.getByRole("button", { name: "Restaurar" }).count(), 1);
  assert.match(await teacher.page.locator(".page-heading h1").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/, "Publicações da turma expandida (Expansão 5)");
  await teacher.context.close();
});

test("H2: médias com o arredondamento de Meu desempenho; variações do contrato em p.p., com direção por texto e forma, não só cor", async () => {
  const { context, page } = await open();
  const [first, second, unchanged, , , , oldest] = await read(page);
  assert.deepEqual(first.kc, { label: "Média KC", value: "53,8%", valueHeard: "53,8%", delta: "−2,5 p.p.", deltaHeard: "caiu 2,5 pontos percentuais", dir: "is-down" });
  assert.deepEqual(first.lab, { label: "Média LAB", value: "96,4%", valueHeard: "96,4%", delta: "+24,3 p.p.", deltaHeard: "subiu 24,3 pontos percentuais", dir: "is-up" });
  assert.deepEqual(first.pending, { label: "Sem nota", value: "2 → 1", valueHeard: "de 2 para 1", delta: null, deltaHeard: null, dir: null });
  assert.deepEqual([second.kc.delta, second.lab.delta], ["−12,1 p.p.", "−24 p.p."]);
  assert.deepEqual([unchanged.kc.delta, unchanged.kc.dir, unchanged.lab.delta, unchanged.pending.value], ["sem mudança", "is-same", "sem mudança", "0"]);
  // Primeira publicação: sem comparação, nada de variação nem de "sem nota" (o contrato não traz a contagem).
  assert.deepEqual([oldest.kc.value, oldest.kc.delta, oldest.lab.delta, oldest.pending, oldest.note], ["90%", null, null, null, "Sem versão anterior com suas notas para comparar."]);
  // Forma e cor por direção: triângulo para cima (verde-água), para baixo (âmbar) e traço sem cor de situação para "sem
  // mudança".
  const shapes = await page.evaluate(() => Object.fromEntries(["is-up", "is-down", "is-same"].map((c) => {
    const el = document.querySelector(`.student-history .history-delta.${c}`), s = getComputedStyle(el, "::before"), t = getComputedStyle(el);
    return [c, { top: parseFloat(s.borderTopWidth), bottom: parseFloat(s.borderBottomWidth), sides: parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth), inner: parseFloat(s.width), color: t.color }];
  })));
  const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); const rgb = (v) => { const d = document.createElement("i"); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    return { success: rgb(s.getPropertyValue("--color-success")), warning: rgb(s.getPropertyValue("--color-warning")) }; });
  const up = shapes["is-up"], down = shapes["is-down"], same = shapes["is-same"];
  assert.ok(up.bottom > 0 && up.top === 0 && up.sides > 0 && up.inner === 0, `subida: triângulo para cima ${JSON.stringify(up)}`);
  assert.ok(down.top > 0 && down.bottom === 0 && down.sides > 0 && down.inner === 0, `queda: triângulo para baixo ${JSON.stringify(down)}`);
  assert.ok(same.inner > 0 && same.top > 0 && same.bottom === 0 && same.sides === 0, `sem mudança: traço ${JSON.stringify(same)}`);
  assert.equal(up.color, tokens.success);
  assert.equal(down.color, tokens.warning);
  assert.ok(![tokens.success, tokens.warning].includes(same.color), "sem mudança sem cor de situação");
  // A publicação em vigor mostra as mesmas médias de Meu desempenho (mesmo arredondamento).
  await page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
  await page.locator(".student-home .goal strong").first().waitFor();
  assert.deepEqual(await page.locator(".student-home .goal strong").allInnerTexts(), [first.kc.value, first.lab.value]);
  await context.close();
  // Singular até antes de 2 ("1,5 ponto percentual"), plural a partir de 2.
  const mid = await open({ data: SETS.mesmoDia });
  const [md] = await read(mid.page);
  assert.deepEqual([md.kc.delta, md.kc.deltaHeard, md.lab.delta, md.lab.deltaHeard], ["+1,5 p.p.", "subiu 1,5 ponto percentual", "−2 p.p.", "caiu 2 pontos percentuais"]);
  await mid.context.close();
  // Variação menor que a casa decimal: duas casas (como o contrato), nunca "+0" nem "sem mudança"; singular abaixo de 2.
  const tiny = await open({ data: SETS.minima });
  const [t] = await read(tiny.page);
  assert.deepEqual([t.kc.delta, t.kc.deltaHeard, t.kc.dir], ["+0,04 p.p.", "subiu 0,04 ponto percentual", "is-up"]);
  assert.deepEqual([t.lab.delta, t.lab.deltaHeard, t.lab.dir], ["−0,03 p.p.", "caiu 0,03 ponto percentual", "is-down"]);
  // Nota da atividade: uma casa (como em Minhas atividades); se a casa esconder a diferença (88,5% → 88,5%), duas.
  assert.deepEqual(t.items.map((i) => [i.kind, i.change]), [["Nota subiu", "60% → 60,2%"], ["Nota caiu", "88,5% → 88,46%"]]);
  await tiny.context.close();
  // Dados incompletos: média ausente e variação sem comparação ditas com palavras, sem inventar número.
  const partial = await open({ data: SETS.incompletos });
  const [p0, p1, p2] = await read(partial.page);
  assert.deepEqual([p0.kc.delta, p0.lab.delta, p0.lab.dir, p0.pending.value], ["+15 p.p.", "sem comparação", "is-none", "1 → 0"]);
  assert.deepEqual([p1.kc.delta, p1.lab.value, p1.lab.delta], ["sem comparação", "—", "sem média"]);
  assert.deepEqual([p2.kc.value, p2.kc.delta, p2.lab.value, p2.note], ["—", "sem média", "—", "Sem versão anterior com suas notas para comparar."]);
  await partial.context.close();
});

test("H3: mudanças nas atividades classificadas pelo contrato, com resumo por tipo; a publicação em vigor abre, as outras não", async () => {
  const { context, page, errors } = await open({ data: SETS.todas });
  const [cur] = await read(page);
  assert.equal(cur.open, true);
  assert.equal(cur.summary, "11 mudanças nas atividades 1 nota registrada · 1 nota subiu · 1 nota caiu · 1 ficou sem nota · 1 atividade liberada · 1 atividade nova · 1 dispensada · 1 deixou de ser dispensada · 1 retirada do cálculo · 1 pontuação alterada · 1 removida da publicação");
  assert.deepEqual(cur.items.map(({ kind, name, change }) => [kind, name, change]), [
    ["Atividade liberada", LONG, "Não liberada → Sem nota"],
    ["Nota registrada", LONG2, "Sem nota → 72,5%"],
    ["Nota caiu", S3, "90% → 80%"],
    ["Nota subiu", EC2, "55% → 75%"],
    ["Ficou sem nota", LX, "100% → Sem nota"],
    ["Dispensada", PY, "Sem nota → Dispensada"],
    ["Retirada do cálculo", CERT, "Sem nota → Não liberada"],
    ["Atividade nova", "196-CERT-Lab - Simulado prático de certificação", "Sem nota"],
    ["Pontuação alterada", EC2LAB, "100%, nota mantida"],
    ["Deixou de ser dispensada", NET, "Dispensada → Sem nota"],
    ["Removida da publicação", LONG.replace("301", "300"), null],
  ]);
  // A seta é visual; quem ouve recebe "para".
  assert.equal(cur.items[1].heard, "Sem nota para 72,5%");
  await context.close();
  // Só a publicação em vigor abre sozinha; as demais mostram o resumo e abrem pelo teclado.
  const seven = await open();
  const list = await read(seven.page);
  assert.deepEqual(list.map((r) => r.open), [true, false, null, false, false, false, null]);
  assert.equal(list[0].summary, "3 mudanças nas atividades 1 nota registrada · 1 nota caiu · 1 removida da publicação");
  assert.equal(list[1].summary, "3 mudanças nas atividades 1 nota subiu · 2 atividades liberadas");
  assert.equal(list[2].note, "Nenhuma mudança nas suas notas.");
  const summary = entries(seven.page).nth(1).locator("summary");
  await summary.focus();
  await seven.page.keyboard.press("Enter");
  assert.equal(await entries(seven.page).nth(1).locator("details").evaluate((d) => d.open), true);
  await seven.page.keyboard.press(" ");
  assert.equal(await entries(seven.page).nth(1).locator("details").evaluate((d) => d.open), false);
  await seven.context.close();
  // Nome com HTML aparece como texto.
  const html = await open({ data: SETS.html });
  const [h] = await read(html.page);
  assert.deepEqual(h.items.map((i) => i.name), ['<img src=x onerror="window.__xss=1">Atividade & "teste"', "<b>removida</b>"]);
  assert.equal(await html.page.evaluate(() => window.__xss), undefined);
  assert.equal(await html.page.locator(".student-history .history-list img, .student-history .history-list b").count(), 0);
  assert.deepEqual(errors, []);
  await html.context.close();
});

test("H4: restauração — a versão em vigor é a restaurada; as mais recentes continuam listadas, marcadas como fora de vigor", async () => {
  const { context, page } = await open({ data: SETS.restaurada });
  const list = await read(page);
  assert.deepEqual(list.map((r) => [r.current, r.status]), [[false, "Não está em vigor"], [false, "Não está em vigor"], [true, "Em vigor · versão restaurada"], ...Array(4).fill([false, null])]);
  assert.deepEqual(list.map((r) => r.open), [false, false, null, false, false, false, null], "abre a em vigor (sem mudanças: nada a abrir)");
  // A variação de cada publicação é a do contrato (em relação à versão em vigor antes dela), não a diferença para a linha de baixo.
  assert.equal(list[0].kc.delta, "−2,5 p.p.");
  assert.match(await page.locator(".student-history .update-line").innerText(), /Versão restaurada/);
  await context.close();
});

test("H5: estados — sem histórico, primeira publicação, nenhuma mudança, carregamento e erro recuperável na composição da tela", async () => {
  // Alinhado à esquerda (start no LTR), sem moldura: não o bloco centralizado da base.
  const frame = (el) => { const s = getComputedStyle(el); return { scoped: !!el.closest(".student-history"), border: s.borderTopWidth, bg: s.backgroundColor, align: s.textAlign === "start" ? "left" : s.textAlign }; };
  const empty = await open({ data: SETS.vazio });
  assert.equal(await empty.page.locator(".student-history .history-list").count(), 0);
  assert.equal(await empty.page.locator(".student-history .history-context").count(), 0);
  assert.equal((await empty.page.locator(".student-history .history-empty").innerText()).trim(), "As atualizações publicadas aparecerão aqui.");
  assert.deepEqual(await empty.page.locator(".student-history .history-empty").evaluate(frame), { scoped: true, border: "0px", bg: "rgba(0, 0, 0, 0)", align: "left" });
  await empty.context.close();
  const firstOnly = await open({ data: SETS.primeira });
  assert.equal((await firstOnly.page.locator(".student-history .history-context").innerText()).replace(/\s+/g, " ").trim().split(".")[0], "1 publicação, em 9 de outubro de 2026");
  const [only] = await read(firstOnly.page);
  assert.deepEqual([only.status, only.note, only.summary, only.kc.delta], ["Em vigor", "Sem versão anterior com suas notas para comparar.", null, null]);
  await firstOnly.context.close();
  for (const [set, context, headings] of [
    ["virada", "2 publicações, de 18 de dezembro de 2026 a 8 de janeiro de 2027.", ["Publicação de 8 de janeiro de 2027, sexta-feira, 18:00", "Publicação de 18 de dezembro de 2026, sexta-feira, 18:00"]],
    ["mesmoDia", "2 publicações, em 9 de outubro de 2026.", ["Publicação de 9 de outubro de 2026, sexta-feira, 18:03", "Publicação de 9 de outubro de 2026, sexta-feira, 06:02"]]]) {
    const dated = await open({ data: SETS[set] });
    assert.equal((await dated.page.locator(".student-history .history-context").innerText()).split(" Variações")[0], context, set);
    assert.deepEqual((await read(dated.page)).map((r) => r.heading), headings, set);
    await dated.context.close();
  }
  const noCount = await open({ data: SETS.semContagem });
  const [nc, onlyAfter] = await read(noCount.page);
  assert.deepEqual([nc.pending, nc.kc.delta, nc.summary], [null, "+5 p.p.", "1 mudança nas atividades 1 nota subiu"]);
  assert.deepEqual([onlyAfter.pending.value, onlyAfter.pending.valueHeard], ["1", "1"], "sem a contagem anterior, só a atual");
  await noCount.context.close();
  const same = await open({ data: SETS.semMudanca });
  const [s] = await read(same.page);
  assert.deepEqual([s.kc.delta, s.lab.delta, s.pending.value, s.note, s.summary], ["sem mudança", "sem mudança", "1", "Nenhuma mudança nas suas notas.", null]);
  await same.context.close();
  // Carregamento com a tela salva no histórico.
  const loading = await open({ mode: "hang" });
  const status = loading.page.locator("[role=status]").filter({ hasText: "Carregando sua turma…" }).first();
  assert.deepEqual(await status.evaluate(frame), { scoped: true, border: "0px", bg: "rgba(0, 0, 0, 0)", align: "left" }, "carregamento na composição da tela");
  await loading.context.close();
  // Erro: título da tela antes do alerta, turma no topo, foco no Tentar novamente; tentar de novo devolve o histórico.
  const { context, page, control, errors } = await open();
  control.mode = "error";
  await page.locator('.student-history [data-action="refresh-report"]').click();
  const alert = page.locator("[role=alert]").filter({ hasText: "Não foi possível carregar" });
  await alert.waitFor();
  const twelve = await open({ data: SETS.doze });
  assert.equal(await twelve.page.locator(".student-history .history-limit").count(), 1, "com 12 publicações há aviso de limite");
  assert.equal((await twelve.page.locator(".student-history .history-limit").innerText()).trim(), "O histórico mostra no máximo 12 publicações: as mais recentes e a que está em vigor.");
  assert.equal(await twelve.page.locator(".student-history .history-list + .history-limit").count(), 1, "aviso depois da lista");
  await twelve.context.close();
  const shown = await page.evaluate(() => ({ h1: [...document.querySelectorAll("main h1")].map((h) => h.textContent), scoped: !!document.querySelector("[role=alert]").closest(".student-history"),
    beforeAlert: !!(document.querySelector("main h1")?.compareDocumentPosition(document.querySelector("[role=alert]")) & Node.DOCUMENT_POSITION_FOLLOWING),
    topline: document.querySelector(".topline .location-context").innerText.replace(/\s+/g, " "), focused: document.activeElement.textContent.trim(), left: getComputedStyle(document.querySelector("[role=alert]")).borderLeftWidth }));
  assert.deepEqual(shown.h1, ["Meu histórico"]);
  assert.ok(shown.scoped && shown.beforeAlert, "título na composição da tela, antes do alerta");
  assert.match(shown.topline, /Turma BRSA0267.*Meu histórico/);
  assert.equal(shown.focused, "Tentar novamente");
  assert.equal(shown.left, "3px");
  control.mode = "ok";
  await alert.getByRole("button", { name: "Tentar novamente" }).click();
  await entries(page).first().waitFor();
  assert.equal(await entries(page).count(), 7);
  assert.deepEqual(errors, []);
  await context.close();
  const boot = await open({ mode: "error" });
  assert.deepEqual(await boot.page.evaluate(() => [[...document.querySelectorAll("main h1")].map((h) => h.textContent), document.activeElement.id]), [["Meu histórico"], "main-content"]);
  await boot.context.close();
});

test("H6: sem rolagem lateral, controle recortado ou sobreposição em 320–1440 px, texto a 200%, zoom a 200%, 12 publicações e títulos longos", async () => {
  const cases = [[1440, 900, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [1440, 900, 2], [768, 1024, 2], [390, 844, 2], [320, 568, 2], [720, 450, 1]];
  for (const [width, height, text] of cases) for (const set of ["todas", "doze"]) {
    const label = `${set} ${width}×${height} texto ${text * 100}%`;
    const { context, page, errors } = await open({ width, height, text, data: SETS[set] });
    await page.evaluate(() => document.querySelectorAll(".student-history details").forEach((d) => { d.open = true; }));
    const m = await page.evaluate(() => {
      const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const rects = (el) => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.data.trim() || n.parentElement.closest(".sr-only")) continue; const r = document.createRange(); r.selectNodeContents(n); out.push(...r.getClientRects()); } return out; };
      const res = { overflowX: document.documentElement.scrollWidth - innerWidth, outside: [], overlap: [], small: [], split: [], entries: document.querySelectorAll(".student-history .history-list > li").length, opened: document.querySelectorAll(".student-history .history-activity").length };
      for (const li of document.querySelectorAll(".student-history .history-list > li")) {
        const box = li.getBoundingClientRect();
        for (const r of rects(li)) if (r.left < box.left - 0.5 || r.right > box.right + 0.5) res.outside.push(li.querySelector("h2").textContent.slice(0, 40));
        // Partes que não podem se cobrir: data, cada número, cada variação, o resumo e cada linha de atividade.
        const parts = [li.querySelector("h2"), li.querySelector(".history-status"), ...li.querySelectorAll(".history-figure dt, .history-value, .history-delta, .history-note, summary"),
          ...[...li.querySelectorAll(".history-activity")].flatMap((x) => [x.querySelector(".history-activity-kind"), x.querySelector("strong"), x.querySelector(".history-transition")])].filter(Boolean);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
          if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
          const A = rects(parts[i]), B = rects(parts[j]);
          if (A.some((x) => B.some((y) => inter(x, y) > 1))) res.overlap.push(`${parts[i].className || parts[i].tagName} × ${parts[j].className || parts[j].tagName}`);
        }
        for (const s of li.querySelectorAll("summary")) if (s.getBoundingClientRect().height < 44 - 0.5) res.small.push(s.textContent.slice(0, 30));
        // Cada tipo do resumo ("1 nota caiu") numa linha só, a não ser que a coluna seja estreita demais para ele (12rem).
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize), col = li.querySelector(".history-changes").getBoundingClientRect().width / rem;
        for (const k of li.querySelectorAll(".history-kinds > span")) if (col >= 12 && new Set([...k.getClientRects()].map((r) => Math.round(r.top))).size > 1) res.split.push(k.textContent);
      }
      return res;
    });
    assert.ok(m.entries === (set === "doze" ? 12 : 2) && m.opened > 0, `${label}: nada medido (${m.entries} publicações, ${m.opened} atividades)`);
    assert.ok(m.overflowX <= 0, `${label}: rolagem lateral de ${m.overflowX}px`);
    assert.deepEqual(m.outside, [], `${label}: texto fora da publicação`);
    assert.deepEqual([...new Set(m.overlap)], [], `${label}: partes sobrepostas`);
    assert.deepEqual(m.small, [], `${label}: alvo menor que 44 px`);
    assert.deepEqual(m.split, [], `${label}: tipo do resumo quebrado no meio`);
    assert.deepEqual(await clipped(page, ".student-history"), [], `${label}: controle recortado`);
    assert.deepEqual(errors, [], label);
    await context.close();
  }
});

// Antes da Expansão 2 (tabela no desktop, cartões no celular; mesmas sete publicações), cada publicação fechada media
// 145 px em 1440, 143 em 1024, 259 em 768 (no máximo 282), 282 em 390 e em 320 (no máximo 310). Compromisso: nenhuma
// maior que antes e a mediana pelo menos ~20% menor, sem reduzir fonte nem alvo de toque. Texto a 200% no desktop: a
// lista passa à composição estreita (antes, 253 px numa tabela espremida); teto de 310 px, com a variação ao lado do
// número e o resumo corrido.
test("H7: várias publicações sem rolagem excessiva — linhas compactas no desktop e no celular, sem reduzir fonte nem alvo", async () => {
  // C3: medida com a tipografia de referência (Arial = Liberation Sans). Os limites são os da E2, menos o teto da maior linha
  // com texto a 200% no desktop: calibrado na SF (304 px + 26), ele é recalibrado na referência com folga parecida (376 + 24 =
  // 400). A mediana continua no teto de 310 px; nos outros casos, nada muda. Na referência, a publicação mais alta já tem o
  // resumo em 3 linhas: uma regressão que só leva outras linhas a essa altura não muda mediana nem máximo (o resumo em duas
  // linhas também na composição estreita, da E2: 1.833 → 1.906 px no total). Por isso, a 200% no desktop, também a altura
  // somada das seis publicações (a rolagem que elas pedem), com a folga relativa da mediana: 1.833 × 310/303 = 1.875.
  for (const [width, height, median, max, text = 1, total = Infinity] of [[1440, 900, 100, 145], [1024, 768, 120, 143], [768, 1024, 160, 282], [390, 844, 190, 282], [320, 640, 200, 282], [1440, 900, 310, 400, 2, 1875]]) {
    const { context, page } = await open({ width, height, text });
    await page.addStyleTag({ content: REFERENCE_FONT });
    assert.ok(await page.locator(".student-history").evaluate((el) => /^Arial/.test(getComputedStyle(el).fontFamily)), `${width}px: tipografia de referência aplicada`);
    const m = await page.evaluate(() => {
      const lis = [...document.querySelectorAll(".student-history .history-list > li")];
      // Colunas alinhadas de uma publicação para outra (inclusive a primeira, sem "Sem nota"): a comparação é por leitura vertical.
      const lefts = (s) => [...new Set(lis.map((li) => Math.round(li.querySelector(s).getBoundingClientRect().left)))];
      return { kc: lefts(".history-figure.kc .history-value"), lab: lefts(".history-figure.lab .history-value"), date: lefts("h2"), closed: lis.filter((li) => !li.querySelector("details[open]")).map((li) => Math.round(li.getBoundingClientRect().height)).sort((a, b) => a - b),
        font: Math.min(...lis.flatMap((li) => [...li.querySelectorAll("h2, .history-value, .history-delta, .history-figure dt, summary, .history-why")].map((el) => parseFloat(getComputedStyle(el).fontSize)))) };
    });
    assert.equal(m.closed.length, 6, `${width}px: seis publicações fechadas medidas`);
    assert.ok(m.kc.length === 1 && m.lab.length === 1 && m.date.length === 1, `${width}px: colunas desalinhadas ${JSON.stringify(m)}`);
    const mid = m.closed[Math.floor(m.closed.length / 2)];
    assert.ok(mid <= median && Math.max(...m.closed) <= max, `${width}px: mediana ${mid} (máximo ${median}), maior ${Math.max(...m.closed)} (máximo ${max}): ${m.closed}`);
    const sum = m.closed.reduce((s, h) => s + h, 0);
    assert.ok(sum <= total, `${width}px: altura somada ${sum} (máximo ${total}): ${m.closed}`);
    assert.ok(m.font >= 12, `${width}px: fonte mínima ${m.font}px`);
    await context.close();
  }
});

test("H8: teclado na ordem visual e contorno de foco inteiro (pixels); no celular o foco não fica atrás da barra", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page } = await open({ width, height });
    await page.locator('.student-history [data-action="refresh-report"]').focus();
    const order = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => { const a = document.activeElement; return a.tagName === "SUMMARY" ? a.closest("li")?.querySelector("h2 time")?.getAttribute("datetime") : a.textContent.trim().slice(0, 20); }));
      const where = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), nav = document.querySelector(".sidebar nav"), fixed = getComputedStyle(nav).position === "fixed";
        return { bottom: r.bottom, top: r.top, limit: fixed ? nav.getBoundingClientRect().top : innerHeight }; });
      assert.ok(where.top >= 0 && where.bottom <= where.limit + 0.5, `${width}px: foco ${order.at(-1)} fora da área visível (${JSON.stringify(where)})`);
      if (i < 2) assert.deepEqual(await ringOnScreen(page), [], `${width}px: contorno de ${order.at(-1)}`);
    }
    // Só os resumos das publicações com mudanças, na ordem da lista (25/09 e 28/08 não têm o que abrir).
    assert.deepEqual(order, ["2026-10-09T21:03:00Z", "2026-10-02T21:02:00Z", "2026-09-18T21:04:00Z", "2026-09-11T21:00:00Z", "2026-09-04T21:02:00Z"]);
    await context.close();
  }
});

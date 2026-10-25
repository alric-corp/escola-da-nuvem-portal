// Expansão 5 do piloto visual: Publicações da turma (docs/design-visual.md), com API fictícia (nunca AWS, Canvas,
// publicação ou restauração real). Cobre o que a tela promete: qual publicação está em vigor (pelo relatório, também
// depois de uma restauração), datas sem trocar a original pela da restauração, comparação dita quando não é com a
// vizinha, composição sem rolagem lateral nem ação escondida em 320–1440 px, texto e zoom a 200% e janela baixa; a
// restauração de antes (confirm, expectedCurrent, recarga) com a pergunta dizendo qual publicação, andamento, erro e
// resultado na própria tela, um envio por vez e nada de sucesso antes da resposta; troca de turma e consulta durante a
// operação; estados; teclado com contorno inteiro (pixels); fuso do navegador; o admin vê a mesma tela.
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

// Registros PUB# como backend/portal.py::_report os devolve ao instrutor (sem releasedAt), mais recentes primeiro: base é a
// versão em vigor quando cada um saiu; changes, as contagens de changes.change_counts. A sincronização publica como
// system:canvas-sync e com canvas-api.csv.
const KEYS = ["previousCount", "currentCount", "studentsAdded", "studentsRemoved", "studentsUpdated", "activitiesAdded", "activitiesRemoved",
  "activitiesReleased", "activitiesPaused", "scalesChanged", "gradesChanged", "gradesAdded", "gradesRemoved"];
const counts = (c) => Object.fromEntries(KEYS.map((k) => [k, c[k] ?? 0]));
const pub = (id, publishedAt, base, c, extra = {}) => ({ id, cohort: "BRSA0267", base, publishedAt, filename: "canvas-api.csv", publishedBy: "system:canvas-sync", status: "published",
  createdAt: publishedAt, snapshot: `cohorts/BRSA0267/${id}/snapshot.json`, history: `cohorts/BRSA0267/${id}/history.json`, changes: c === undefined ? undefined : counts(c), ...extra });
const manual = (filename) => ({ filename, publishedBy: "8c1e5f2a-0d2b-4f7e-9a51-3b6f0e2d7c11" });
const HISTORY = [
  pub("p13", "2026-10-10T21:04:00Z", "p12", { previousCount: 24, currentCount: 24, gradesChanged: 12, gradesAdded: 12 }),
  pub("p12", "2026-10-09T21:04:00Z", "p11", { previousCount: 24, currentCount: 24, gradesChanged: 21, gradesAdded: 19, gradesRemoved: 2 }),
  pub("p11", "2026-10-09T09:03:00Z", "p10", { previousCount: 24, currentCount: 24, gradesChanged: 3, gradesAdded: 3 }),
  pub("p10", "2026-10-07T21:05:00Z", "p09", { previousCount: 24, currentCount: 24, activitiesAdded: 2, gradesChanged: 28, gradesAdded: 28, activitiesReleased: 1 }),
  pub("p09", "2026-10-06T09:02:00Z", "p08", { previousCount: 24, currentCount: 24, gradesChanged: 7, gradesAdded: 7 }),
  pub("p08", "2026-10-02T21:00:00Z", "p04", { previousCount: 25, currentCount: 24, studentsRemoved: 1, gradesChanged: 33, gradesAdded: 31, gradesRemoved: 1 }),
  pub("p04", "2026-09-18T20:40:00Z", "p03", { previousCount: 25, currentCount: 25, studentsUpdated: 1, gradesChanged: 77, activitiesReleased: 1, scalesChanged: 1 }, manual("2026-09-18T1740_Notas-BRSA0267 (1).csv")),
  pub("p03", "2026-09-11T20:05:00Z", "p02", { previousCount: 24, currentCount: 25, studentsAdded: 1, gradesChanged: 83, activitiesReleased: 2, activitiesPaused: 1 }, manual("2026-09-11T1705_Notas-BRSA0267.csv")),
  pub("p02", "2026-09-04T20:12:00Z", "p01", { previousCount: 24, currentCount: 24, gradesChanged: 61, activitiesReleased: 2 }, manual("2026-09-04T1712_Notas-BRSA0267.csv")),
  pub("p01", "2026-08-28T20:31:00Z", null, { previousCount: 0, currentCount: 24, studentsAdded: 24, activitiesAdded: 10, activitiesReleased: 2 }, manual("2026-08-28T1731_Notas-BRSA0267.csv")),
];
const STUDENTS = Array.from({ length: 24 }, (_, i) => ({ id: String(31000 + i), name: `Aluna Fictícia ${String(i).padStart(2, "0")}`, email: `aluna${i}@example.test`, kc: 80, lab: 96,
  total: 88, completed: 8, pending: 0, progress: 100, status: "ok", portalLinked: true }));
const ACTIVITIES = Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 1}`, name: `${200 + i}-KC - Atividade ${i + 1}`, kind: i % 2 ? "lab" : "kc", points: "100", active: i < 8,
  completed: 20, pending: 4, needsReview: 2, average: 81, module: "Módulo", moduleOrder: 1 }));
const SYNC = { status: "unchanged", message: "Nenhuma mudança no Canvas desde a última publicação.", at: "2026-10-11T09:00:12Z", students: 24, publicationId: null };
// Relatório do instrutor: a versão em vigor (publication, com releasedAt), updatedAt e updateKind como o backend grava.
const report = ({ history = HISTORY, current = history[0]?.id, updateKind, updatedAt, sync = SYNC, students = STUDENTS, activities = ACTIVITIES } = {}) => {
  const p = history.find((x) => x.id === current);
  return { cohort: "BRSA0267", publication: p ? { ...p, releasedAt: {} } : null, focus: { activityIds: [], version: null }, students, activities, count: students.length, warnings: [],
    thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436", canvasSync: sync, history, updatedAt: updatedAt || p?.publishedAt,
    updateKind: updateKind || (p?.publishedBy === "system:canvas-sync" ? "canvas" : "publish") };
};
// p10 (07/10) restaurada em 11/10 às 09:10; p11–p13 são mais recentes e não estão em vigor.
const restored = (extra = {}) => report({ current: "p10", updateKind: "restore", updatedAt: "2026-10-11T12:10:00Z", ...extra });
const OTHER = report({ history: [pub("q2", "2026-10-08T21:00:00Z", "q1", { previousCount: 18, currentCount: 18, gradesChanged: 9, gradesAdded: 9 }, { cohort: "BRSA0268" }),
  pub("q1", "2026-10-01T21:00:00Z", null, { previousCount: 0, currentCount: 18, studentsAdded: 18, activitiesAdded: 12, activitiesReleased: 8 }, { cohort: "BRSA0268" })], students: STUDENTS.slice(0, 18) });
const LONG_FILE = "a".repeat(76) + ".csv";
const LONG = [{ ...HISTORY[0] }, { ...HISTORY[1], filename: LONG_FILE, publishedBy: "uid" },
  { ...HISTORY[2], filename: "Notas finais da turma BRSA0267 depois da revisão das atividades de laboratório - versão corrigida pelo instrutor.csv", publishedBy: "uid" }, ...HISTORY.slice(3)];
const MANY = Array.from({ length: 90 }, (_, i) => pub(`m${String(90 - i).padStart(3, "0")}`, new Date(Date.parse("2026-10-10T21:04:00Z") - i * 16 * 3600000).toISOString(),
  i === 89 ? null : `m${String(89 - i).padStart(3, "0")}`, i === 89 ? { previousCount: 0, currentCount: 24, studentsAdded: 24, activitiesAdded: 12, activitiesReleased: 2 }
    : { previousCount: 24, currentCount: 24, gradesChanged: 1 + ((i * 7) % 29), gradesAdded: (i * 7) % 29, activitiesReleased: i % 9 === 0 ? 1 : 0 }));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const RESTORE_ERRORS = {
  409: [409, "A turma foi atualizada. Recarregue o histórico."],
  integrity: [409, "Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade. 1 aluno(s) não pertence(m) à turma no Canvas. (IDs do Canvas: 999999)"],
  403: [403, "Você não tem acesso a esta operação."],
  500: [500, "Não foi possível concluir a operação. Tente novamente."],
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

// control: data (relatório da BRSA0267), other (da BRSA0268), reportMode ("ok" | "error"), restoreMode ("ok" | chave de
// RESTORE_ERRORS | "network"), confirm (resposta ao confirm()), holds (respostas retidas: "report", "restore").
async function open({ width = 1440, height = 900, text = 1, role = "instructor", data = report(), autoSync = true, timezoneId = "America/Sao_Paulo", view = "history" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  const errors = [], control = { data, other: OTHER, reportMode: "ok", restoreMode: "ok", confirm: true, reports: 0, restores: [], dialogs: [], holds: {} };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return control.confirm ? dialog.accept() : dialog.dismiss(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  const email = role === "admin" ? "admin@example.test" : role === "student" ? "aluna0@example.test" : "instrutor@example.test";
  await page.addInitScript(({ email, view }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view }));
  }, { email, view });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const of = (code) => (code === "BRSA0268" ? control.other : control.data);
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), code = endpoint.split("/")[2];
    if (endpoint === "/me") return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync, canvasCourseId: "4436", current: of("BRSA0267").publication?.id ?? null },
      { code: "BRSA0268", canTeach: role !== "student", autoSync: false, canvasCourseId: "4437", current: of("BRSA0268").publication?.id ?? null }] } });
    if (endpoint.endsWith("/report")) {
      control.reports++;
      await hold("report");
      if (control.reportMode === "error") return route.fulfill({ status: 500, json: { error: "Não foi possível carregar o relatório da turma agora." } });
      if (role === "student") return route.fulfill({ json: { cohort: "BRSA0267", publication: { id: "p13", publishedAt: HISTORY[0].publishedAt }, updateKind: "canvas", updatedAt: HISTORY[0].publishedAt,
        thresholds: { kc: 70, lab: 95 }, student: { ...STUDENTS[0], activities: [] }, history: [{ publishedAt: HISTORY[0].publishedAt, current: true, kc: 80, lab: 96, total: 88, changes: null }], focus: { activityIds: [], version: null } } });
      return route.fulfill({ json: of(code) });
    }
    if (endpoint.endsWith("/restore")) {
      const body = request.postDataJSON();
      control.restores.push({ code, ...body });
      await hold("restore");
      if (control.restoreMode === "network") return route.abort("failed");
      const failure = RESTORE_ERRORS[control.restoreMode];
      if (failure) return route.fulfill({ status: failure[0], json: { error: failure[1] } });
      // Como Portal._restore: confere expectedCurrent e troca a versão em vigor (updatedAt = agora, updateKind = restore).
      const r = of(code);
      if (body.expectedCurrent !== r.publication?.id) return route.fulfill({ status: 409, json: { error: RESTORE_ERRORS[409][1] } });
      const next = { ...r, publication: { ...r.history.find((p) => p.id === body.publicationId), releasedAt: {} }, updateKind: "restore", updatedAt: "2026-10-11T18:00:00.000Z" };
      if (code === "BRSA0268") control.other = next; else control.data = next;
      return route.fulfill({ json: { restored: true } });
    }
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  if (role !== "student") await page.locator(".layout .page-heading h1").waitFor();
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
// Texto como é lido: espaços colapsados e sem espaço antes de vírgula (a vírgula da leitura assistiva entre data e hora).
// Leituras que não esperam o elemento aparecer: se ele não existe, a asserção seguinte falha (sem tempo esgotado).
const read = async (locator, fn = (l) => l.innerText()) => ((await locator.count()) ? fn(locator.first()) : null);
const text = async (locator) => ((await read(locator)) ?? "").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
const soon = (locator) => locator.first().waitFor({ timeout: 3000 }).catch(() => {});
const refresh = (page) => page.locator('[data-action="refresh-report"]').first().click();
const region = (page) => page.locator(".tpub-current");
const restoreButton = (page, id) => page.locator(`[data-restore="${id}"]`);
const entryOf = (page, id) => page.locator(`#tpub-${id}`);
// Espera a resposta da restauração e, quando deu certo, a recarga do relatório (boot), sem esperar um resultado específico
// aparecer: um resultado errado ou ausente falha por asserção, não por tempo esgotado.
const restoreSettled = (page) => {
  const restore = page.waitForResponse((r) => r.url().endsWith("/restore")).catch(() => null);
  return async ({ reload = false } = {}) => {
    if (reload) await page.waitForResponse((r) => r.url().endsWith("/report"), { timeout: 5000 }).catch(() => null);
    else await restore;
    await page.waitForTimeout(60);
    await settle(page);
  };
};
const failed = (page) => { const restore = page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith("/restore") }).catch(() => null);
  return async () => { await restore; await page.waitForTimeout(60); await settle(page); }; };
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : (a.id ? `#${a.id}` : "") + ` ${(a.getAttribute("aria-label") || a.innerText || a.tagName).trim().split("\n")[0]}`; });
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("TODO29: publicações mostram etapas atuais sem alterar a data histórica e sem exigir primeira publicação", async () => {
  const proof = { status: "failed", scheduledFor: "2026-10-11T09:00:00Z", startedAt: "2026-10-11T09:00:01Z", finishedAt: "2026-10-11T09:00:12Z",
    stages: { catalog: "failed", roster: "succeeded", grades: "unchanged" } };
  for (const width of [1440, 390]) {
    const data = { ...report(), canvasSyncDiagnostics: proof };
    const { context, page, errors } = await open({ width, data });
    try {
      const current = page.locator(".tpub-current");
      assert.match(await current.innerText(), /Publicação de 10 de outubro de 2026/);
      assert.match(await current.innerText(), /Catálogo: indisponível; Matrículas: verificadas; Notas: verificadas, sem mudanças/);
      assert.match(await current.innerText(), /conclusão em 11 de outubro de 2026/);
      assert.equal(await page.locator(".tpub-entry").count(), HISTORY.length);
      assert.ok(await pageScroll(page) <= 1);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  const empty = { ...report({ history: [] }), canvasSync: { status: "failed", at: proof.finishedAt, message: "Não foi possível concluir a verificação das notas no Canvas." },
    canvasSyncDiagnostics: { ...proof, stages: { catalog: "succeeded", roster: "failed", grades: "skipped" } } };
  const { context, page, errors } = await open({ width: 390, data: empty });
  try {
    assert.match(await page.locator(".teacher-publications").innerText(), /As atualizações publicadas aparecerão aqui/);
    assert.match(await page.locator(".teacher-publications").innerText(), /Matrículas: indisponíveis; Notas: não verificadas/);
    assert.equal(await page.locator(".tpub-current, .tpub-entry").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// Controles e textos recortados pela janela ou por um ancestral com overflow, e texto cortado dentro do controle.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".teacher-publications :is(a, button, h1, h2, h3, h4, .tpub-fact, .tpub-file, .tpub-origin, .tpub-status, .tpub-note, .tpub-base, .tpub-current-facts)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
    if (el.matches("button, a, .tpub-fact") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 40)}`);
  }
  return bad;
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

test("PB1: composição — a versão em vigor no topo e o histórico por mês; uma linha por publicação com largura, empilhada no tablet estreito, no celular e com texto ampliado", async () => {
  // Restaurar: ao lado da data (linha larga e média), ao lado das mudanças (tablet estreito) ou abaixo delas (empilhada).
  for (const [width, height, txt, wide, frame, action] of [[1440, 900, 1, true, true, "data"], [1280, 800, 1, true, true, "data"], [1024, 768, 1, false, true, "data"],
    [768, 1024, 1, false, true, "mudanças"], [390, 844, 1, false, false, "abaixo"], [320, 640, 1, false, false, "abaixo"], [1440, 900, 2, false, false, "abaixo"]]) {
    const { context, page, errors } = await open({ width, height, text: txt });
    const id = `${width}×${height}${txt > 1 ? ` a ${txt * 100}%` : ""}`;
    assert.equal(await read(page.locator(".teacher-publications h1")), "Publicações da turma", id);
    assert.match(await text(region(page)), /^Em vigor Publicação de 10 de outubro de 2026,? sábado, 18:04 Sincronização com o Canvas · 24 alunos · 8 de 12 atividades liberadas/, id);
    assert.deepEqual(await page.locator(".tpub-month-title").allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, " ").trim())),
      ["Outubro de 2026 6 publicações", "Setembro de 2026 3 publicações", "Agosto de 2026 1 publicação"], id);
    assert.equal(await page.locator(".tpub-entry").count(), HISTORY.length, id);
    const m = await page.evaluate(() => {
      const e = document.querySelector("#tpub-p12"), top = (s) => Math.round(e.querySelector(s).getBoundingClientRect().top);
      const box = (s) => e.querySelector(s).getBoundingClientRect(), mid = (r) => (r.top + r.bottom) / 2;
      const b = box("[data-restore]"), h = box("h4 time"), f = box(".tpub-facts");
      return { oneRow: new Set([top("h4"), top(".tpub-origin"), top(".tpub-facts")]).size === 1, frame: getComputedStyle(document.querySelector(".tpub-current")).borderTopWidth,
        action: Math.abs(mid(b) - mid(h)) < 16 ? "data" : Math.abs(mid(b) - mid(f)) < 16 ? "mudanças" : b.top >= f.bottom - 1 ? "abaixo" : "outro" };
    });
    assert.equal(m.oneRow, wide, `${id}: data, origem e mudanças na mesma linha só com largura`);
    assert.equal(m.action, action, `${id}: posição do Restaurar`);
    assert.equal(m.frame, frame ? "1px" : "0px", `${id}: moldura da versão em vigor`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("PB2: sem rolagem lateral, sem ação escondida e sem texto recortado em 320–1440 px, texto a 200% e 250%, zoom a 200% e janela baixa, com nomes de arquivo extensos", async () => {
  const cases = [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [1440, 900, 2], [1280, 800, 2], [1024, 768, 2], [390, 844, 2], [320, 568, 2],
    [320, 640, 2.5], [720, 450, 1], [1280, 560, 1]];
  for (const [width, height, txt] of cases) for (const data of [report({ history: LONG }), restored()]) {
    const { context, page, errors } = await open({ width, height, text: txt, data });
    const id = `${width}×${height}${txt > 1 ? ` a ${txt * 100}%` : ""}`;
    assert.equal(await pageScroll(page), 0, `${id}: rolagem lateral`);
    assert.deepEqual(await clipped(page), [], id);
    // Antes, com texto a 200% em 1280 e 1440 px, Restaurar ficava fora da área visível da tabela (só aparecia rolando a
    // tabela para o lado). Sem rolar nenhum ancestral na horizontal, o botão precisa estar dentro de todos os recortes.
    const box = await page.locator("[data-restore]").first().evaluate((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) p.scrollLeft = 0;
      window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2);
      const r = el.getBoundingClientRect();
      let clip = { left: 0, right: innerWidth };
      for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
      return { left: Math.round(r.left), right: Math.round(r.right), height: r.height, clip: [Math.round(clip.left), Math.round(clip.right)] };
    });
    assert.ok(box.left >= box.clip[0] && box.right <= box.clip[1], `${id}: Restaurar à vista sem rolagem lateral (${JSON.stringify(box)})`);
    assert.ok(box.height >= 44, `${id}: alvo de 44 px`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("PB3: em vigor é a publicação do relatório; restaurada com as duas datas; as mais recentes não estão em vigor; a comparação depois da restauração é com a versão que estava em vigor", async () => {
  const { context, page, errors } = await open({ data: restored() });
  const status = await page.locator(".tpub-entry").evaluateAll((items) => items.map((li) => [li.id.slice(5), li.querySelector(".tpub-status")?.innerText.trim() ?? null]));
  assert.deepEqual(status.slice(0, 5), [["p13", "Não está em vigor"], ["p12", "Não está em vigor"], ["p11", "Não está em vigor"], ["p10", "Em vigor · versão restaurada"], ["p09", null]]);
  const lead = await text(region(page));
  assert.match(lead, /^Em vigor · versão restaurada Publicação de 7 de outubro de 2026,? quarta-feira, 18:05 /);
  assert.match(lead, /Restaurada em 11 de outubro de 2026, 09:10\. A restauração não cria uma nova publicação: voltou a valer a versão de 7 de outubro de 2026, com as notas daquela publicação\./);
  assert.match(lead, /As 3 publicações mais recentes que ela não estão em vigor\. Ver no histórico/);
  assert.match(lead, /A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação \(hoje às 18h\) publica uma nova versão\./);
  // "Ver no histórico" leva a vista e o foco à publicação em vigor, no meio da lista.
  const link = page.getByRole("link", { name: "Ver no histórico" });
  assert.equal(await link.count(), 1, "atalho para a publicação em vigor");
  await link.click();
  await settle(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), "tpub-p10");
  assert.ok(await read(entryOf(page, "p10"), (l) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })), "publicação em vigor à vista");
  assert.deepEqual(errors, []);
  await context.close();
  // Depois da restauração, uma publicação manual compara com a restaurada (base), não com a de baixo; as outras não dizem nada.
  const p14 = pub("p14", "2026-10-11T16:20:00Z", "p10", { previousCount: 24, currentCount: 24, gradesChanged: 2, gradesAdded: 1 }, manual("BRSA0267-correcao-lab-255.csv"));
  const after = await open({ data: report({ history: [p14, ...HISTORY], current: "p14" }) });
  assert.deepEqual(await after.page.locator(".tpub-base").allInnerTexts(), ["Em relação à publicação de 7 de outubro de 2026, 18:05, que estava em vigor."]);
  assert.equal(await after.page.locator("#tpub-p14 .tpub-base").count(), 1);
  assert.match(await text(region(after.page)), /^Em vigor Publicação de 11 de outubro de 2026,? domingo, 13:20 Envio manual BRSA0267-correcao-lab-255\.csv · 24 alunos/);
  assert.doesNotMatch(await text(region(after.page)), /Restaurada|mais recentes|Ver no histórico/);
  await after.context.close();
});

test("PB4: restaurar — a pergunta diz qual publicação e a consequência; andamento com o foco e todos os Restaurar parados; um envio; sucesso só depois da resposta, na própria tela e com o foco", async () => {
  const { context, page, errors, control, holdNext } = await open();
  const h = holdNext("restore");
  await restoreButton(page, "p11").focus();
  await page.keyboard.press("Enter");
  await h.arrived.promise;
  assert.deepEqual(control.dialogs, ["Restaurar a publicação de 9 de outubro de 2026, 06:03?\n\nOs alunos passarão a ver as notas desta versão. A versão em vigor agora, publicada em 10 de outubro de 2026, 18:04, continua no histórico.\n\nA atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (hoje às 18h) publica uma nova versão."]);
  assert.deepEqual(control.restores, [{ code: "BRSA0267", publicationId: "p11", expectedCurrent: "p13" }]);
  await settle(page);
  assert.equal(await active(page), "#tpub-restore-status Restaurando a publicação de 9 de outubro de 2026, 06:03…");
  assert.equal(await read(page.locator("#tpub-p11 .tpub-op"), (l) => l.getAttribute("role")), "status");
  const disabled = () => page.locator("[data-restore]").evaluateAll((bs) => bs.map((b) => b.disabled && b.getAttribute("aria-describedby") === "tpub-restore-status"));
  assert.deepEqual(await disabled(), Array(HISTORY.length - 1).fill(true));
  // Nenhum sucesso antes da resposta: a versão em vigor ainda é a de antes e nada diz "restaurada".
  assert.match(await text(region(page)), /^Em vigor Publicação de 10 de outubro de 2026/);
  assert.equal(await page.getByText("Publicação restaurada.").count(), 0);
  // Um clique num botão velho (sem o disabled) não envia de novo.
  await restoreButton(page, "p09").evaluate((b) => { b.disabled = false; b.click(); });
  assert.equal(control.restores.length, 1, "um envio só");
  const done = restoreSettled(page);
  h.gate.resolve();
  await done({ reload: true });
  // Confirmada pelo servidor: a versão restaurada em vigor, com a data da restauração; o resultado na própria tela, com o foco.
  assert.match(await text(region(page)), /^Em vigor · versão restaurada Publicação restaurada\. Publicação de 9 de outubro de 2026,? sexta-feira, 06:03 /);
  assert.match(await text(region(page)), /Restaurada em 11 de outubro de 2026, 15:00\./);
  assert.equal(await active(page), "#tpub-restore-status Publicação restaurada.");
  // O resultado entra na coluna da região, sem desmontar a composição (cada bloco começa na mesma margem, um embaixo do outro).
  const column = await region(page).evaluate((el) => [...el.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.bottom)]; }));
  assert.equal(new Set(column.map(([left]) => left)).size, 1, `blocos alinhados: ${JSON.stringify(column)}`);
  assert.ok(column.every(([, top], i) => i === 0 || top >= column[i - 1][2] - 1), `blocos empilhados: ${JSON.stringify(column)}`);
  assert.equal(await read(entryOf(page, "p11").locator(".tpub-status")), "Em vigor · versão restaurada");
  assert.equal(await restoreButton(page, "p11").count(), 0);
  assert.equal(await read(restoreButton(page, "p13"), (l) => l.isEnabled()), true);
  assert.deepEqual(await notices(page), [], "sem aviso temporário repetindo o resultado");
  assert.equal(control.restores.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB4b: um render no meio da restauração (ir ao painel e voltar) não reabilita Restaurar; o resultado aparece na tela sem tirar o foco de onde a navegação o deixou", async () => {
  const { context, page, errors, control, holdNext } = await open();
  const h = holdNext("restore");
  await restoreButton(page, "p11").click();
  await h.arrived.promise;
  await page.locator('.sidebar nav [data-view="overview"]').click();
  await page.locator('.sidebar nav [data-view="history"]').click();
  await soon(page.locator(".tpub-entry"));
  assert.ok(await page.locator("[data-restore]").evaluateAll((bs, n) => bs.length === n && bs.every((b) => b.disabled), HISTORY.length - 1), "parados depois do render");
  assert.equal(await page.locator("#tpub-p11 .tpub-op.is-busy").count(), 1, "o andamento continua na publicação");
  const done = restoreSettled(page);
  h.gate.resolve();
  await done({ reload: true });
  assert.equal(await page.locator(".tpub-op.is-done").count() && await page.locator(".tpub-op.is-done").getAttribute("role"), "status");
  assert.match(await active(page), /^#main-content /, "o foco fica no conteúdo, onde a navegação o deixou (não vai ao <body>)");
  assert.equal(control.restores.length, 1);
  assert.deepEqual(await notices(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB5: cancelar a pergunta não envia nada e deixa o foco no Restaurar", async () => {
  const { context, page, errors, control } = await open();
  control.confirm = false;
  await restoreButton(page, "p12").click();
  await settle(page);
  assert.equal(control.dialogs.length, 1);
  assert.deepEqual(control.restores, []);
  assert.equal(await active(page), " Restaurar a publicação de 9 de outubro de 2026, 18:04");
  assert.equal(await page.locator("#tpub-restore-status").count(), 0);
  assert.equal(await restoreButton(page, "p12").isEnabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB6: falhas na própria publicação, com o foco — conflito e dúvida levam à consulta; nada de 'Failed to fetch'; a lista continua", async () => {
  const cases = [
    ["409", "A publicação não foi restaurada. A turma foi atualizada. Recarregue o histórico. Consultar atualização", true],
    // Todo 409 oferece a consulta: o status não separa "a turma mudou" de "não passa nas validações", e consultar só mostra o estado real.
    ["integrity", "A publicação não foi restaurada. Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade. 1 aluno(s) não pertence(m) à turma no Canvas. (IDs do Canvas: 999999) Consultar atualização", true],
    ["403", "A publicação não foi restaurada. Você não tem acesso a esta operação.", false],
    ["500", "Não foi possível confirmar a restauração. Não foi possível concluir a operação. Tente novamente. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização", true],
    ["network", "Não foi possível confirmar a restauração. A conexão com o portal falhou. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização", true],
  ];
  for (const [mode, message, consult] of cases) {
    const { context, page, errors, control } = await open();
    control.restoreMode = mode === "integrity" ? "integrity" : mode === "network" ? "network" : Number(mode);
    const done = mode === "network" ? failed(page) : restoreSettled(page);
    await restoreButton(page, "p12").click();
    await done();
    const error = page.locator("#tpub-p12 .tpub-op.is-error");
    assert.equal(await error.count() && await text(error), message, mode);
    assert.equal(await read(error, (l) => l.getAttribute("role")), "alert");
    assert.equal(await page.evaluate(() => document.activeElement.id), "tpub-restore-status", mode);
    assert.equal(await error.getByRole("button", { name: "Consultar atualização" }).count(), consult ? 1 : 0, mode);
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso temporário`);
    assert.equal(await page.locator(".tpub-entry").count(), HISTORY.length, `${mode}: o histórico continua`);
    assert.match(await text(region(page)), /^Em vigor Publicação de 10 de outubro de 2026/, `${mode}: a versão em vigor é a de antes`);
    assert.equal(await restoreButton(page, "p12").isEnabled(), true, `${mode}: Restaurar volta a funcionar`);
    if (mode === "409") {
      // Consultar atualização recarrega o relatório e o erro some (era do relatório anterior).
      const reports = control.reports;
      await error.getByRole("button", { name: "Consultar atualização" }).click();
      await soon(page.locator(".tpub-entry"));
      await settle(page);
      assert.equal(control.reports, reports + 1);
      assert.equal(await page.locator(".tpub-op.is-error").count(), 0);
    }
    assert.deepEqual(errors, [], mode);
    await context.close();
  }
});

test("PB7: troca de turma e consulta durante a restauração — nada vaza para a outra turma; o resultado vem no aviso com a turma; a consulta não reabilita Restaurar", async () => {
  for (const outcome of ["ok", 409]) {
    const { context, page, errors, control, holdNext } = await open();
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await page.locator("#cohort").selectOption("BRSA0268");
    await page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }).waitFor();
    await page.locator('.sidebar nav [data-view="history"]').click();
    await soon(page.locator("#tpub-q1"));
    assert.equal(await page.locator("#tpub-restore-status").count(), 0, `${outcome}: o andamento é da BRSA0267`);
    assert.equal(await read(restoreButton(page, "q1"), (l) => l.isEnabled()), true, `${outcome}: Restaurar da BRSA0268 continua disponível`);
    control.restoreMode = outcome;
    const done = restoreSettled(page);
    h.gate.resolve();
    await done({ reload: outcome === "ok" });
    await page.locator("#notices .notice").waitFor({ timeout: 2000 }).catch(() => {});
    assert.deepEqual(await notices(page), [outcome === "ok" ? "Publicação da BRSA0267 restaurada." : "A publicação da BRSA0267 não foi restaurada. A turma foi atualizada. Recarregue o histórico."]);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${outcome}: nada na tela da BRSA0268`);
    assert.match(await text(region(page)), /^Em vigor Publicação de 8 de outubro de 2026/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Consultar atualização durante a restauração: o relatório novo chega com Restaurar ainda parado.
  const { context, page, errors, control, holdNext } = await open();
  const h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  await refresh(page);
  await soon(page.locator(".tpub-entry"));
  await settle(page);
  assert.ok(await page.locator("[data-restore]").evaluateAll((bs) => bs.length && bs.every((b) => b.disabled)), "parados no relatório novo");
  const done = restoreSettled(page);
  h.gate.resolve();
  await done({ reload: true });
  assert.equal(await page.locator(".tpub-op.is-done").count(), 1);
  assert.equal(control.restores.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB7b: restauração confirmada e recarga com erro — o aviso diz que restaurou (nada de falha silenciosa); a tela mostra o erro com o título", async () => {
  const { context, page, errors, control } = await open();
  const done = restoreSettled(page);
  control.reportMode = "error";
  await restoreButton(page, "p12").click();
  await done({ reload: true });
  await page.locator("#notices .notice").waitFor({ timeout: 2000 }).catch(() => {});
  assert.deepEqual(await notices(page), ["Publicação restaurada."]);
  assert.equal(await read(page.locator(".teacher-publications h1")), "Publicações da turma");
  assert.match(await text(page.locator(".teacher-publications [role='alert']")), /Não foi possível carregar o relatório da turma agora\. Tentar novamente/);
  assert.equal(control.restores.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB8: estados — carregando, erro com o título, turma sem publicação, primeira publicação, sem mudança, registros antigos, muitas publicações e falha da sincronização", async () => {
  // Carregamento (Consultar atualização com a resposta retida) e erro na composição da tela.
  const loading = await open();
  const h = loading.holdNext("report");
  await refresh(loading.page);
  await h.arrived.promise;
  await settle(loading.page);
  assert.equal(await loading.page.locator(".teacher-publications > .panel[role='status']").count() && await loading.page.locator(".teacher-publications > .panel[role='status']").innerText(), "Carregando sua turma…");
  assert.equal(await loading.page.locator(".teacher-publications h1").count(), 0, "carregando sem título (como as outras telas)");
  assert.equal(await loading.page.locator(".tpub-entry").count(), 0, "sem dados antigos durante a carga (C7.4)");
  h.gate.resolve();
  await soon(loading.page.locator(".tpub-entry"));
  loading.control.reportMode = "error";
  await refresh(loading.page);
  await soon(loading.page.locator("main [role='alert']"));
  assert.equal(await read(loading.page.locator(".teacher-publications h1")), "Publicações da turma");
  assert.match(await text(loading.page.locator(".teacher-publications [role='alert']")), /Não foi possível carregar Não foi possível carregar o relatório da turma agora\. Tentar novamente/);
  assert.deepEqual(loading.errors, []);
  await loading.context.close();
  // Turma sem publicação: o texto de antes e como a primeira chega (com e sem atualização automática).
  for (const autoSync of [true, false]) {
    const empty = await open({ data: { cohort: "BRSA0267", publication: null, students: [], history: [], thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436" }, autoSync });
    assert.equal(await text(empty.page.locator(".tpub-empty")), autoSync
      ? "As atualizações publicadas aparecerão aqui. A primeira chega pela sincronização com o Canvas (próxima verificação: hoje às 18h) ou por um CSV publicado em Atualizar notas."
      : "As atualizações publicadas aparecerão aqui. Publique o CSV do Canvas em Atualizar notas para criar a primeira.");
    assert.equal(await empty.page.locator(".tpub-current, .tpub-history").count(), 0);
    await empty.context.close();
  }
  // Primeira publicação, publicação sem mudança, registros antigos (sem changes; sem gradesRemoved) e falha da sincronização.
  const same = pub("p14", "2026-10-11T14:02:00Z", "p13", { previousCount: 24, currentCount: 24 }, manual("2026-10-11T1102_Notas-BRSA0267.csv"));
  const legacy = HISTORY.map((p) => (p.id === "p01" ? { ...p, changes: undefined, base: undefined } : p.id === "p08" ? { ...p, changes: { studentsAdded: 0, studentsRemoved: 1, gradesChanged: 33, activitiesReleased: 0, activitiesPaused: 0 } } : p));
  const failing = { ...SYNC, status: "failed", message: "Token do Canvas expirado." };
  const { context, page, errors, control } = await open({ data: report({ history: [HISTORY.at(-1)], activities: ACTIVITIES.slice(0, 10).map((a, i) => ({ ...a, active: i < 2 })) }) });
  assert.equal(await text(page.locator("#tpub-p01 .tpub-note")), "Primeira publicação da turma: 24 alunos e 10 atividades, 2 liberadas.");
  assert.match(await text(region(page)), /Envio manual 2026-08-28T1731_Notas-BRSA0267\.csv · 24 alunos · 2 de 10 atividades liberadas/);
  assert.equal(await page.locator("[data-restore]").count(), 0, "uma publicação só, em vigor: nada a restaurar");
  for (const [data, check] of [
    [report({ history: [same, ...HISTORY] }), async () => assert.equal(await text(page.locator("#tpub-p14 .tpub-note")), "Nenhuma mudança em relação à versão em vigor antes dela.")],
    [report({ history: legacy }), async () => {
      assert.equal(await text(page.locator("#tpub-p01 .tpub-note")), "Comparação indisponível para esta publicação antiga.");
      assert.deepEqual(await page.locator("#tpub-p08 .tpub-fact").allInnerTexts(), ["33 notas alteradas", "1 aluno removido"]);
    }],
    [report({ sync: failing }), async () => assert.match(await text(region(page)), /A atualização automática pelo Canvas falhou em 11 de outubro de 2026, 06:00: Token do Canvas expirado\. As notas exibidas são da última publicação bem-sucedida\./)],
    [report({ history: MANY }), async () => {
      assert.equal(await page.locator(".tpub-entry").count(), 90);
      assert.match(await text(page.locator(".tpub-context")), /^90 publicações, de \d+ de [a-zç]+ a 10 de outubro de 2026\.$/);
      assert.ok(await page.locator(".tpub-month").count() >= 3);
      assert.equal(await page.locator(".tpub-entry.is-current").count(), 1);
    }]]) {
    control.data = data;
    await refresh(page);
    await soon(page.locator(".tpub-entry"));
    await settle(page);
    await check();
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("PB9: teclado na ordem de leitura, com contorno inteiro (pixels); no celular o foco não fica atrás da barra inferior; mudanças que pedem atenção têm forma", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page, errors } = await open({ width, height, data: restored() });
    await page.locator(".layout .page-heading h1").evaluate((el) => { el.tabIndex = -1; el.focus(); });
    const order = [];
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => { const a = document.activeElement; if (!a.closest(".teacher-publications")) return null; const r = a.getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
        const bar = getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight;
        return { name: (a.getAttribute("aria-label") || a.innerText).trim().split("\n")[0], top: r.top + scrollY, visible: r.top >= 0 && r.bottom <= bar }; });
      if (!info) break;
      order.push(info);
      assert.ok(info.visible, `${width}: ${info.name} à vista`);
      assert.deepEqual(await ringOnScreen(page), [], `${width}: contorno em ${info.name}`);
    }
    const names = order.map((o) => o.name);
    assert.deepEqual(names.slice(0, 5), ["Ver no histórico", "Consultar atualização", "Restaurar a publicação de 10 de outubro de 2026, 18:04", "Restaurar a publicação de 9 de outubro de 2026, 18:04",
      "Restaurar a publicação de 9 de outubro de 2026, 06:03"], `${width}: ${names.join(" | ")}`);
    assert.ok(!names.includes("Restaurar a publicação de 7 de outubro de 2026, 18:05"), "a versão em vigor não tem Restaurar");
    for (let i = 1; i < order.length; i++) assert.ok(order[i].top >= order[i - 1].top - 1, `${width}: ${order[i - 1].name} → ${order[i].name}`);
    // Forma do que pede atenção (anel âmbar), não só cor; o texto diz o que é.
    const ring = await read(page.locator("#tpub-p12 .tpub-fact.is-attention"), (l) => l.evaluate((el) => getComputedStyle(el, "::before").backgroundImage));
    assert.match(ring, /radial-gradient/);
    assert.deepEqual(await page.locator("#tpub-p12 .tpub-fact").allInnerTexts(), ["21 notas alteradas (2 removidas)"]);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("PB10: datas e agrupamento em Brasília, independentes do fuso do navegador; a vigência não depende da ordem", async () => {
  const edge = [pub("e2", "2026-10-01T01:30:00Z", "e1", { previousCount: 24, currentCount: 24, gradesChanged: 5 }), pub("e1", "2026-09-29T21:00:00Z", null, { previousCount: 0, currentCount: 24, studentsAdded: 24 })];
  for (const timezoneId of ["America/Sao_Paulo", "UTC"]) {
    const day = "30 de setembro", month = "Setembro de 2026 2 publicações", time = "22:30";
    const { context, page, errors, control } = await open({ timezoneId, data: report({ history: edge, current: "e1", updateKind: "restore", updatedAt: "2026-10-11T12:10:00Z" }) });
    assert.equal(await read(page.locator("#tpub-e2 time")), day, timezoneId);
    assert.equal(await text(page.locator(".tpub-month-title")), month, timezoneId);
    assert.match(await text(page.locator("#tpub-e2 h4")), new RegExp(time), timezoneId);
    assert.equal(await read(page.locator("#tpub-e2 .tpub-status")), "Não está em vigor", timezoneId);
    await restoreButton(page, "e2").click();
    await settle(page);
    assert.match(control.dialogs[0], new RegExp(`^Restaurar a publicação de ${day} de 2026, ${time}\\?`), timezoneId);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("PB11: o admin vê a mesma tela; Meu histórico do aluno continua o do aluno (sem Restaurar)", async () => {
  const admin = await open({ role: "admin" });
  assert.equal(await read(admin.page.locator(".teacher-publications h1")), "Publicações da turma");
  assert.equal(await admin.page.locator("[data-restore]").count(), HISTORY.length - 1);
  assert.match(await admin.page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  assert.deepEqual(admin.errors, []);
  await admin.context.close();
  const student = await open({ role: "student" });
  await student.page.locator(".student-history").waitFor();
  assert.equal(await student.page.locator(".teacher-publications, [data-restore], .tpub-entry").count(), 0);
  assert.equal(await student.page.locator(".student-history h1").innerText(), "Meu histórico");
  assert.deepEqual(student.errors, []);
  await student.context.close();
});

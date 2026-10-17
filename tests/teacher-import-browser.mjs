// Expansão 6 do piloto visual: Atualizar notas (docs/design-visual.md), com API fictícia (nunca AWS, Canvas, envio ou
// publicação real; CSVs sintéticos). Cobre o que a tela promete: três etapas na ordem da tarefa, o arquivo escolhido uma vez,
// erros da conferência na tela e ligados ao campo, andamento com o foco, a pergunta da publicação dizendo turma, arquivo,
// versão que sai e sincronização; durante a publicação tudo da turma parado e um pedido só; falhas recusadas e incertas na
// tela (a incerta leva à consulta da versão em vigor); troca de turma e de usuário durante a publicação; atividades com o
// foco na caixa e as sem notas atrás de "Mostrar"; confirmação dos removidos junto do botão; composição sem rolagem lateral
// nem controle escondido em 320–1440 px, texto e zoom a 200% e janela baixa; teclado com contorno; estados e papéis.
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

// Prévia como backend/portal.py::_preview a devolve (_save_draft + _integrity): draft, atividades de grades.parse_csv (id =
// cabeçalho do CSV, filled, points como str(Decimal)), alunos de grades.summary, count, warnings, changes e integrity.
const A = (n, name, kind, points, filled, active) => ({ id: `${name} (${n})`, name, kind, points, filled, active });
const ACTIVITIES = [A(1, "10- CF - KC — Introdução ao Amazon S3", "kc", "100.00", 24, true), A(2, "11--Lab - Introdução ao Amazon EC2", "lab", "100.00", 23, true),
  A(3, "226-LX-KC - Uma introdução ao Linux", "kc", "100.00", 21, true), A(4, "258-NF-KC - Sub-redes IPv4", "kc", "10.00", 17, true),
  A(5, "119- PF -KC - Introdução ao Python", "kc", "100.00", 3, false), A(6, "195-CERT-KC -Preparação da Certificação", "kc", "100.00", 0, false),
  A(7, "196-CERT-Lab - Simulado de laboratório", "lab", "100.00", 0, false)];
// O curso inteiro no arquivo (como no export real): as de cima e mais 6 sem nenhuma nota (8 sem notas ao todo).
const COURSE = [...ACTIVITIES, ...Array.from({ length: 6 }, (_, i) => A(10 + i, `${300 + i}-CERT-KC - Revisão ${i + 1}`, "kc", "100.00", 0, false))];
const STUDENTS = Array.from({ length: 24 }, (_, i) => ({ id: String(31000 + i), name: `Aluna Fictícia ${String(i).padStart(2, "0")}`, email: i === 5 ? null : `aluna${i}@example.test`,
  kc: 70 + (i % 7) * 3.25, lab: 90 + (i % 5) * 2.5, total: 85, pending: i % 3, completed: 6, progress: 80, status: ["ok", "attention", "critical"][i % 3] }));
const SUMMARY = { studentsFound: 24, activitiesFound: 7, canvasConfigured: true, rosterCapturedAt: "2026-10-11T12:00:12Z", studentsExpected: 24, studentsExtra: 0,
  studentsMissing: 0, activitiesKnown: 7, activitiesReference: "catalog" };
const CHANGES = { previousCount: 24, currentCount: 24, studentsAdded: [], studentsRemoved: [], studentsUpdated: [], activitiesAdded: [], activitiesRemoved: [],
  activitiesReleased: [{ id: ACTIVITIES[3].id, name: ACTIVITIES[3].name }], activitiesPaused: [], scalesChanged: [], gradesChanged: 2, gradesAdded: 2, gradesRemoved: 0,
  gradeDetails: [{ student: "Aluna Fictícia 01", activity: ACTIVITIES[3].name, before: null, after: "8.5" }, { student: "Aluna Fictícia 02", activity: ACTIVITIES[3].name, before: null, after: "10" }] };
let drafts = 0;
const PREVIEWS = {
  valida: () => ({}),
  curso: () => ({}),
  "curso-liberada": (body) => ({ activities: COURSE.map((a, i) => ({ ...a, active: body.activeIds ? body.activeIds.includes(a.id) : a.active || i === 9 })) }),
  remocao: () => ({ count: 23, changes: { ...CHANGES, previousCount: 24, currentCount: 23, studentsRemoved: [{ id: "31023", name: "Aluna Fictícia 23" }] } }),
  // C3: contagens de dois dígitos (12 notas novas, 2 removidas e 3 alteradas), como numa sincronização real.
  contagens: () => ({ changes: { ...CHANGES, gradesChanged: 17, gradesAdded: 12, gradesRemoved: 2, gradeDetails: STUDENTS.slice(0, 17).map((s, i) => ({ student: s.name,
    activity: ACTIVITIES[3].name, before: i < 12 ? null : "7", after: i === 12 || i === 13 ? null : String(6 + (i % 5)) })) } }),
  bloqueada: () => ({ integrity: { critical: [{ code: "studentNotInRoster", count: 1, message: "1 aluno(s) não pertence(m) à turma no Canvas.", ids: ["999999"] }], warnings: [],
    summary: { ...SUMMARY, studentsFound: 25, studentsExtra: 1 } } }),
};
function preview(body, code, kind) {
  const active = body.activeIds;
  return { draft: { id: `d${++drafts}`, cohort: code, createdBy: "u-1", base: "p13", status: "draft", filename: String(body.filename).slice(0, 150) },
    activities: (kind === "curso" ? COURSE : ACTIVITIES).map((a) => ({ ...a, active: active ? active.includes(a.id) : a.active })), students: STUDENTS, count: 24,
    warnings: ["Linha 27: aluno de teste do Canvas ignorado; não entra nas notas da turma."], changes: CHANGES, integrity: { critical: [], warnings: [], summary: SUMMARY },
    ...PREVIEWS[kind](body, code) };
}
const PUBLICATION = { id: "p13", cohort: "BRSA0267", publishedAt: "2026-10-10T21:04:00Z", filename: "canvas-api.csv", publishedBy: "system:canvas-sync", status: "published" };
const report = (publication = PUBLICATION, extra = {}) => ({ cohort: "BRSA0267", publication, students: STUDENTS, activities: [], history: publication ? [publication] : [],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, updatedAt: publication?.publishedAt, updateKind: publication ? "canvas" : undefined, ...extra });
const ERRORS = {
  cabecalho: [400, "O CSV deve conter Student, ID e SIS Login ID, separado por vírgulas."],
  413: [413, "Arquivo maior que o limite permitido."],
  409: [409, "A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia."],
  404: [404, "Prévia não encontrada para sua conta."],
  "400-atividade": [400, "Libere ao menos uma atividade antes de publicar."],
  403: [403, "Você não tem acesso a esta operação."],
  429: [429, null],
  500: [500, "Não foi possível concluir a operação. Tente novamente."],
};
const FILE = "2026-10-11T1450_Notas-BRSA0267.csv";
const CSV = "Student,ID,SIS User ID,SIS Login ID,Section\nPoints Possible,,,,\nFictícia, Aluna,31000,,aluna0@example.test,BRSA0267\n";
const LONG_FILE = "Notas_finais_da_turma_BRSA0267_depois_da_revisao_das_atividades_de_laboratorio_versao_corrigida.csv";
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

// control: previewKind, previewMode / publishMode ("ok" | chave de ERRORS | "network" | "lost": publica e perde a resposta),
// confirm, holds ("preview", "publish"), data (relatório da BRSA0267), emails (sequência de /me: troca de usuário).
async function open({ width = 1440, height = 900, text = 1, role = "instructor", autoSync = true, emails, data = report(), view = "import", demo = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  const people = emails || [role === "admin" ? "admin@example.test" : "instrutor@example.test"];
  const errors = [], control = { reportMode: "ok", drafts: [], previewKind: "valida", previewMode: "ok", publishMode: "ok", confirm: true, holds: {}, data, other: report(null), previews: [], publishes: [], dialogs: [], me: 0 };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return control.confirm ? dialog.accept() : dialog.dismiss(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view }) => {
    if (sessionStorage.getItem("e6")) return;
    sessionStorage.setItem("e6", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view }));
  }, { email: people[0], view });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const of = (code) => (code === "BRSA0268" ? control.other : control.data);
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), code = endpoint.split("/")[2], method = request.method();
    if (endpoint === "/me") return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email: people[Math.min(control.me++, people.length - 1)] } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync, canvasCourseId: autoSync ? "4436" : null, current: of("BRSA0267").publication?.id ?? null },
      { code: "BRSA0268", canTeach: role !== "student", autoSync: false, canvasCourseId: null, current: null }] } });
    if (endpoint.endsWith("/report")) {
      await hold("report");
      if (control.reportMode === "error") return route.fulfill({ status: 500, json: { error: "Não foi possível carregar o relatório da turma agora." } });
      return route.fulfill({ json: of(code) });
    }
    if (endpoint.endsWith("/preview")) {
      const body = request.postDataJSON(), mode = control.previewMode, kind = control.previewKind;
      control.previews.push({ code, filename: body.filename, activeIds: body.activeIds, csv: body.csv });
      await hold("preview");
      if (mode === "network") return route.abort("failed");
      if (ERRORS[mode]) return route.fulfill({ status: ERRORS[mode][0], json: ERRORS[mode][1] ? { error: ERRORS[mode][1] } : { message: "Too Many Requests" } });
      const reply = preview(body, code, kind);
      control.drafts.push(reply.draft.id);
      return route.fulfill({ json: reply });
    }
    if (endpoint.endsWith("/publish")) {
      const body = request.postDataJSON(), mode = control.publishMode;
      control.publishes.push({ code, ...body });
      await hold("publish");
      // Como _publish: a prévia vira a publicação em vigor (o id da publicação é o do rascunho).
      const done = () => { const p = { id: body.draftId, cohort: code, publishedAt: "2026-10-11T18:00:00.000Z", filename: FILE, publishedBy: "u-1", status: "published" };
        if (code === "BRSA0268") control.other = report(p); else control.data = report(p, { updateKind: "publish" }); return p; };
      if (mode === "lost") { done(); return route.abort("failed"); }
      if (mode === "network") return route.abort("failed");
      if (ERRORS[mode]) return route.fulfill({ status: ERRORS[mode][0], json: ERRORS[mode][1] ? { error: ERRORS[mode][1] } : { message: "Too Many Requests" } });
      return route.fulfill({ json: { publication: done() } });
    }
    if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
    if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
    if (endpoint.endsWith("/settings") && method === "POST") return route.fulfill({ json: {} });
    if (endpoint === "/admin/feedback") return route.fulfill({ json: { items: [], nextCursor: null, summary: {} } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin + (demo ? "/?demo=1" : "/"));
  // Só depois do boot (a entrada pública também tem h1): a casca, e nenhum pedido pendente (turma e relatório carregados).
  // Nada aqui depende da marcação da tela: no RED, a tela antiga falha por asserção, não por tempo esgotado.
  await page.locator(".layout").first().waitFor();
  await page.waitForLoadState("networkidle");
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
// Leituras que não esperam o elemento aparecer: se ele não existe, a asserção seguinte falha (sem tempo esgotado).
const read = async (locator, fn = (l) => l.innerText()) => ((await locator.count()) ? fn(locator.first()) : null);
const text = async (locator) => ((await read(locator)) ?? "").replace(/\s+/g, " ").trim();
const soon = (locator, timeout = 3000) => locator.first().waitFor({ timeout }).catch(() => {});
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} ${(a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim()}`.trim(); });
const pick = (page, name = FILE, content = CSV) => page.locator("#csv-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });
const checkButton = (page) => page.locator('button[type="submit"]').filter({ hasText: /Conferir arquivo|Atualizar prévia|Conferindo/ });
const publishButton = (page) => page.locator('[data-action="publish"]');
// Conferir e esperar a resposta (ou a falha) da prévia, sem esperar um resultado específico aparecer. sent: false quando
// nada deve sair (o handler recusa antes do pedido).
async function check(page, { sent = true } = {}) {
  const done = sent ? Promise.race([page.waitForResponse((r) => r.url().endsWith("/preview")), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith("/preview") })]).catch(() => null) : null;
  await checkButton(page).first().click();
  await done;
  await page.waitForTimeout(60);
  await settle(page);
}
async function readyPreview(page, name = FILE) {
  await pick(page, name);
  await check(page);
  await soon(publishButton(page));
}
const publishSettled = (page) => {
  const done = Promise.race([page.waitForResponse((r) => r.url().endsWith("/publish")), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith("/publish") })]).catch(() => null);
  return async () => { await done; await page.waitForTimeout(80); await settle(page); };
};
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// Controles e textos recortados pela janela ou por um ancestral com overflow, e texto cortado dentro do controle.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".teacher-import :is(button, label, a, h1, h2, h3, .timp-filename, .timp-op, .timp-option-name, .timp-state, .timp-student, summary)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
    if (el.matches("button, label") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 40)}`);
  }
  return bad;
});
// Contorno de foco visível em volta de uma caixa (pixels da captura): a cor do anel nos quatro lados.
const RING = [0, 203, 221];
const isRing = (c) => !!c && c.every((v, i) => Math.abs(v - RING[i]) <= 45);
async function ringAround(page, selector) {
  if (!(await page.locator(selector).count())) return [`sem ${selector}`];
  const box = await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(st.outlineOffset), w: parseFloat(st.outlineWidth) }; }, selector);
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
const stepTitles = (page) => page.locator(".teacher-import .timp-step-title").allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, " ").trim()));

test("IB1: composição — três etapas; o arquivo é a ação antes da prévia e a publicação depois; Publicar antes dos resultados; o nome do arquivo uma vez", async () => {
  const { context, page, errors } = await open();
  assert.deepEqual(await stepTitles(page), ["1 Arquivo do Canvas", "2 Prévia", "3 Publicação"]);
  assert.equal(await read(page.locator(".timp-step.is-file .timp-step-body"), (l) => l.evaluate((el) => el.classList.contains("is-action"))), true, "sem prévia, o arquivo é a superfície");
  assert.equal(await text(page.locator(".timp-file-name")), "Nenhum arquivo selecionado");
  // O seletor nativo fica fora da vista (não diz "nenhum arquivo" com um arquivo escolhido); o rótulo é o botão.
  const picker = await read(page.locator("#csv-file"), (l) => l.evaluate((el) => ({ w: el.getBoundingClientRect().width, label: el.labels[0]?.innerText, accept: el.accept, described: el.getAttribute("aria-describedby") })));
  assert.deepEqual(picker, { w: 1, label: "Escolher arquivo", accept: ".csv,text/csv", described: "timp-file-name timp-file-hint" });
  await pick(page);
  await soon(page.locator(".timp-file-name .timp-filename"));
  assert.equal(await text(page.locator(".timp-file-name")), FILE);
  assert.equal(await page.locator(".teacher-import").getByText(FILE, { exact: true }).count(), 1, "o nome do arquivo uma vez, antes da prévia");
  assert.equal(await read(page.locator("#csv-file"), (l) => l.evaluate((el) => el.labels[0].innerText)), "Trocar arquivo");
  await check(page);
  await soon(publishButton(page));
  // Com prévia: a publicação é a superfície; Publicar vem antes dos resultados por aluno e logo depois das atividades.
  const order = await page.evaluate(() => {
    const y = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null; };
    return { integridade: y("#integrity-heading"), muda: y("#timp-changes-title"), avisos: y("#timp-warnings-title"), atividades: y("#timp-activities-title"), atualizar: y('button[form="import-form"]'),
      publicar: y('[data-action="publish"]'), resultados: y("#timp-results-title"), acao: document.querySelector(".timp-publish")?.classList.contains("is-action"), arquivoAcao: document.querySelector(".timp-file")?.classList.contains("is-action") };
  });
  const sequence = ["integridade", "muda", "avisos", "atividades", "atualizar", "publicar", "resultados"].map((k) => order[k]);
  assert.ok(sequence.every((v, i) => v !== null && (i === 0 || v > sequence[i - 1])), `ordem: ${JSON.stringify(order)}`);
  assert.deepEqual([order.acao, order.arquivoAcao], [true, false]);
  assert.match(await text(page.locator(".timp-summary")), new RegExp(`^${FILE.replace(/\./g, "\\.")} · 24 alunos · 4 de 7 atividades liberadas$`));
  assert.deepEqual(errors, []);
  await context.close();
});

test("IB2: conferir — o andamento com o nome do arquivo e o foco; tudo parado; a prévia pronta leva o foco ao título dela; um pedido só", async () => {
  const { context, page, control, holdNext } = await open();
  await pick(page);
  const h = holdNext("preview");
  await checkButton(page).first().focus();
  await page.keyboard.press("Enter");
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#timp-check-status")), `Conferindo ${FILE}…`);
  assert.equal(await read(page.locator("#timp-check-status"), (l) => l.getAttribute("role")), "status");
  assert.match(await active(page), /^p#timp-check-status/, "o foco acompanha o andamento");
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#csv-file").disabled, document.querySelector('#import-form [type="submit"]').disabled]), [true, true]);
  // Outro envio do formulário durante a conferência (Enter, duplo clique): nada sai (o botão está parado no busy).
  await page.evaluate(() => document.querySelector("#import-form").requestSubmit());
  h.gate.resolve();
  await soon(publishButton(page));
  await settle(page);
  assert.equal(control.previews.length, 1, "um pedido só");
  assert.deepEqual(Object.keys(control.previews[0]).filter((k) => control.previews[0][k] !== undefined), ["code", "filename", "csv"]);
  assert.equal(await active(page), "h2#timp-review-title 2 Prévia");
  assert.ok((await notices(page)).includes("Prévia pronta. Confira as atividades e os resultados."), "o aviso de antes continua");
  await context.close();
});

test("IB3: erros da conferência na tela e ligados ao campo — tamanho, vazio, arquivo recusado pelo servidor, permissão, limite, servidor e rede; nada some sozinho", async () => {
  const { context, page, control } = await open();
  const status = () => text(page.locator("#timp-check-status"));
  const described = () => read(page.locator("#csv-file"), (l) => l.evaluate((el) => [el.getAttribute("aria-invalid"), el.getAttribute("aria-describedby")]));
  // Acima de 2 MB (o limite do handler): recusado na escolha, com o nome do arquivo; o foco fica no campo.
  await page.locator("#csv-file").focus();
  await page.locator("#csv-file").setInputFiles({ name: "grande.csv", mimeType: "text/csv", buffer: Buffer.alloc(2000001, "a") });
  await soon(page.locator("#timp-check-status"));
  assert.equal(await status(), "grande.csv não passou na conferência. Selecione um CSV de até 2 MB.");
  assert.equal(await read(page.locator("#timp-check-status"), (l) => l.getAttribute("role")), "alert");
  assert.deepEqual(await described(), ["true", "timp-file-name timp-file-hint timp-check-status"]);
  assert.match(await active(page), /^input#csv-file/);
  assert.deepEqual(await notices(page), [], "sem aviso temporário");
  // Arquivo vazio: o nome e o motivo.
  await pick(page, "vazio.csv", "");
  await soon(page.locator(".timp-file-name .timp-filename"));
  assert.equal(await status(), "", "outro arquivo: o erro anterior sai");
  await check(page, { sent: false });
  assert.equal(await status(), "vazio.csv está vazio. Selecione um arquivo CSV para continuar.");
  assert.equal(control.previews.length, 0, "nada enviado");
  // Recusas do servidor (o arquivo) e falhas que não são do arquivo; o texto do servidor, e a rede em português.
  for (const [mode, expected, invalid] of [
    ["cabecalho", `${FILE} não passou na conferência. O CSV deve conter Student, ID e SIS Login ID, separado por vírgulas.`, "true"],
    ["413", `${FILE} não passou na conferência. Arquivo maior que o limite permitido.`, "true"],
    ["403", "Não foi possível conferir o arquivo. Você não tem acesso a esta operação.", null],
    ["429", "Não foi possível conferir o arquivo. O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.", null],
    ["500", "Não foi possível conferir o arquivo. Não foi possível concluir a operação. Tente novamente.", null],
    ["network", "Não foi possível conferir o arquivo. A conexão com o portal falhou. Tente de novo.", null]]) {
    control.previewMode = mode;
    await pick(page);
    await check(page);
    assert.equal(await status(), expected, mode);
    assert.equal((await described())?.[0] ?? null, invalid, `aria-invalid (${mode})`);
    assert.equal(await active(page), `div#timp-check-status ${expected.split("\n")[0]}`.replace(/\s+$/, ""), `foco no erro (${mode})`);
  }
  assert.doesNotMatch(await page.locator("main").innerText(), /Failed to fetch/);
  // Nada some sozinho (o aviso temporário saía em 6,5 s).
  await page.waitForTimeout(6800);
  assert.match(await status(), /A conexão com o portal falhou/);
  assert.deepEqual(await notices(page), []);
  // Conferir de novo o mesmo arquivo, agora com resposta: a prévia, sem o erro da tentativa anterior.
  control.previewMode = "ok";
  await check(page);
  await soon(publishButton(page));
  assert.equal(await page.locator(".timp-summary").count(), 1, "a prévia chegou");
  assert.equal(await page.locator("#timp-check-status").count(), 0, "o erro da conferência anterior sai");
  assert.equal(await read(page.locator("#csv-file"), (l) => l.getAttribute("aria-invalid")), null);
  await context.close();
});

test("IB4: publicar — a pergunta diz turma, alunos, arquivo, versão que sai e sincronização; andamento com o foco e tudo parado; um pedido; sucesso só depois da resposta", async () => {
  const { context, page, control, holdNext } = await open();
  await readyPreview(page);
  const h = holdNext("publish");
  const settled = publishSettled(page);
  await publishButton(page).click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(control.dialogs.at(-1), [`Publicar as notas para 24 alunos da BRSA0267?`, `Arquivo: ${FILE}`,
    "A publicação substitui a versão em vigor, de 10/10/2026, 18:04. Os alunos passam a ver as notas deste arquivo.",
    "A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (hoje às 18h) publica uma nova versão."].join("\n\n"));
  assert.equal(await text(page.locator("#timp-publish-status")), "Publicando as notas da BRSA0267…");
  assert.equal(await active(page), "p#timp-publish-status Publicando as notas da BRSA0267…");
  const locked = () => page.evaluate(() => ({ arquivo: document.querySelector("#csv-file")?.disabled, atualizar: document.querySelector('button[form="import-form"]')?.disabled,
    atividades: [...document.querySelectorAll("input[data-activity]")].every((i) => i.disabled), publicar: document.querySelector('[data-action="publish"]')?.disabled }));
  assert.deepEqual(await locked(), { arquivo: true, atualizar: true, atividades: true, publicar: true });
  // Ir ao painel e voltar no meio redesenha a tela: continua tudo parado e nada de sucesso antecipado.
  await page.locator('.sidebar nav [data-view="overview"]').click();
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator("#timp-publish-status"));
  assert.deepEqual(await locked(), { arquivo: true, atualizar: true, atividades: true, publicar: true });
  await publishButton(page).evaluate((b) => b.click());
  assert.ok(!(await notices(page)).some((n) => /publicada/i.test(n)), "nada de sucesso antes da resposta");
  assert.equal(control.publishes.length, 1, "um pedido só");
  h.gate.resolve();
  await settled();
  await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
  assert.deepEqual(control.publishes, [{ code: "BRSA0267", draftId: control.drafts.at(-1), acknowledgeRemoved: false }], "a prévia conferida, com o draftId dela");
  assert.ok((await notices(page)).includes("Atualização publicada. Os alunos já podem consultar."));
  await context.close();
});

test("IB5: falhas da publicação na tela, com o foco — recusa com o motivo do servidor e nova tentativa; incerta (rede, 5xx) leva à consulta da versão em vigor", async () => {
  const { context, page, control } = await open();
  await readyPreview(page);
  const status = () => text(page.locator("#timp-publish-status"));
  for (const [mode, expected] of [["409", "Esta prévia não pode ser publicada. A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia. Consultar atualização"],
    ["404", "A atualização não foi publicada. Prévia não encontrada para sua conta."], ["400-atividade", "A atualização não foi publicada. Libere ao menos uma atividade antes de publicar."],
    ["403", "A atualização não foi publicada. Você não tem acesso a esta operação."],
    ["429", "A atualização não foi publicada. O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente."],
    ["500", "Não foi possível confirmar a publicação. Não foi possível concluir a operação. Tente novamente. Ela pode ter sido concluída: consulte a versão em vigor antes de publicar de novo. Consultar atualização"],
    ["network", "Não foi possível confirmar a publicação. A conexão com o portal falhou. Ela pode ter sido concluída: consulte a versão em vigor antes de publicar de novo. Consultar atualização"]]) {
    control.publishMode = mode;
    const settled = publishSettled(page);
    await publishButton(page).click();
    await settled();
    assert.equal(await status(), expected, mode);
    assert.match(await active(page), /^div#timp-publish-status/, `foco no erro (${mode})`);
    assert.ok(await read(publishButton(page), (l) => l.isEnabled()), `Publicar livre de novo (${mode})`);
    assert.equal(await read(page.locator(".timp-summary"), (l) => l.count()), 1, "a prévia continua");
  }
  assert.deepEqual(await notices(page).then((n) => n.filter((x) => !/Prévia pronta/.test(x))), [], "sem aviso temporário");
  assert.doesNotMatch(await page.locator("main").innerText(), /Failed to fetch/);
  // Incerta e concluída no servidor: consultar mostra a versão em vigor nova (a publicação aconteceu); nada é reenviado.
  control.publishMode = "lost";
  const settled = publishSettled(page);
  await publishButton(page).click();
  await settled();
  assert.match(await status(), /^Não foi possível confirmar a publicação\./);
  const before = control.publishes.length;
  await page.locator('#timp-publish-status [data-action="refresh-report"]').click();
  await page.waitForResponse((r) => r.url().endsWith("/report")).catch(() => null);
  await settle(page);
  assert.equal(await text(page.locator(".timp-in-force")), `Em vigor Publicação de 11/10/2026, 15:00 · Envio manual ${FILE}`);
  assert.equal(await text(page.locator("#timp-publish-status .timp-recheck")), `Em vigor agora Publicação de 11/10/2026, 15:00 · Envio manual ${FILE}`, "e junto da ação");
  assert.equal(control.publishes.length, before, "consultar não publica");
  // A mesma prévia de novo: o servidor recusa (já publicada) e a tela não diz "não foi publicada": esta prévia não pode ser.
  control.publishMode = "409";
  const again = publishSettled(page);
  await publishButton(page).click();
  await again();
  assert.match(await status(), /^Esta prévia não pode ser publicada\. .*esta prévia já foi publicada/);
  // Cancelar a pergunta não muda nada: o erro e a consulta continuam junto da ação, também depois de sair e voltar.
  control.confirm = false;
  const asked = control.dialogs.length, sent = control.publishes.length;
  await publishButton(page).click();
  await settle(page);
  assert.equal(control.dialogs.length, asked + 1, "a pergunta apareceu");
  assert.equal(control.publishes.length, sent, "nada enviado");
  await page.locator('.sidebar nav [data-view="overview"]').click();
  await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator("#timp-publish-status"));
  assert.match(await status(), /^Esta prévia não pode ser publicada\. .*Consultar atualização$/, "cancelar não apaga o erro");
  control.confirm = true;
  // Prévia nova; a conferência seguinte falha (a prévia continua valendo) e a publicação dá certo: o erro não volta depois.
  await check(page);
  control.previewMode = "429";
  await check(page);
  assert.match(await text(page.locator("#timp-check-status")), /^Não foi possível conferir o arquivo\./);
  control.publishMode = "ok";
  const published = publishSettled(page);
  await publishButton(page).click();
  await published();
  await soon(page.locator("#notices").getByText("Atualização publicada. Os alunos já podem consultar.", { exact: true }));
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator("#csv-file"));
  assert.equal(await text(page.locator(".timp-file-name")), "Nenhum arquivo selecionado");
  assert.equal(await page.locator("#timp-check-status, #timp-publish-status").count(), 0, "nenhum erro de antes da publicação");
  await context.close();
});

test("IB6: troca de turma durante a publicação — a outra turma fica livre; voltar mostra o andamento; o resultado e a recusa chegam no aviso com a turma", async () => {
  for (const mode of ["ok", "409"]) {
    const { context, page, control, holdNext } = await open();
    await readyPreview(page);
    control.publishMode = mode;
    const h = holdNext("publish");
    const settled = publishSettled(page);
    await publishButton(page).click();
    await h.arrived.promise;
    await page.locator("#cohort").selectOption("BRSA0268");
    await soon(page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }));
    await page.locator('.sidebar nav [data-view="import"]').click();
    await soon(page.locator("#csv-file"));
    assert.deepEqual(await page.evaluate(() => [document.querySelector("#csv-file").disabled, !!document.querySelector("#timp-publish-status")]), [false, false], "BRSA0268 livre");
    await page.locator("#cohort").selectOption("BRSA0267");
    await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
    await page.locator('.sidebar nav [data-view="import"]').click();
    await soon(page.locator("#timp-publish-status"));
    assert.equal(await text(page.locator("#timp-publish-status")), "Publicando as notas da BRSA0267…", "a BRSA0267 continua parada");
    await page.locator("#cohort").selectOption("BRSA0268");
    await soon(page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }));
    h.gate.resolve();
    await settled();
    await page.waitForTimeout(100);
    assert.deepEqual(await notices(page), [mode === "ok" ? "Atualização publicada na BRSA0267." : "A prévia da BRSA0267 não pode ser publicada. A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia."], mode);
    assert.equal(await page.locator("#cohort").inputValue(), "BRSA0268");
    assert.equal(await page.locator(".timp-op").count(), 0, "nada da BRSA0267 na tela da BRSA0268");
    await context.close();
  }
});

test("IB7: troca de usuário durante a publicação — quem entrou não vê nada de quem saiu nem recebe o resultado; a turma fica livre no fim", async () => {
  const { context, page, control, holdNext } = await open({ role: "admin", emails: ["admin@example.test", "outra.admin@example.test"] });
  await readyPreview(page);
  const h = holdNext("publish");
  const settled = publishSettled(page);
  await publishButton(page).click();
  await h.arrived.promise;
  // Outra pessoa entra na aba (o boot depois de salvar as configurações lê o /me de novo).
  await page.locator('.sidebar nav [data-view="access"]').click();
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  // Expansão 8: o aviso do salvamento só aparece para quem salvou; a espera é pela n-ésima leitura do /me e pela rede parada.
  for (let i = 0; i < 80 && control.me < 2; i++) await page.waitForTimeout(50);
  await page.waitForLoadState("networkidle");
  assert.equal(control.me, 2, "o /me foi lido de novo");
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator("#csv-file"));
  // Nada do arquivo nem da prévia de quem saiu; a turma continua parada enquanto o pedido desta aba não termina.
  assert.equal(await text(page.locator(".timp-file-name")), "Nenhum arquivo selecionado");
  assert.equal(await page.locator(".timp-summary, [data-action='publish']").count(), 0);
  assert.equal(await read(page.locator("#csv-file"), (l) => l.isDisabled()), true);
  h.gate.resolve();
  await settled();
  await page.waitForTimeout(150);
  assert.ok(!(await notices(page)).some((n) => /Atualização publicada/.test(n)), "nenhum aviso da publicação de quem saiu");
  assert.ok(await page.locator(".teacher-import").count(), "continua em Atualizar notas (sem ir ao painel)");
  assert.equal(await read(page.locator("#csv-file"), (l) => l.isEnabled()), true, "a turma fica livre no fim");
  await pick(page, "da-outra-pessoa.csv");
  await soon(page.locator(".timp-file-name .timp-filename"));
  assert.equal(await text(page.locator(".timp-file-name")), "da-outra-pessoa.csv");
  await context.close();
});

test("IB7b: troca de usuário — o erro de quem saiu (arquivo recusado, com o nome dele) não aparece para quem entrou nem volta quando ele entra de novo; sem troca, fica", async () => {
  const { context, page, control } = await open({ role: "admin", emails: ["admin@example.test", "admin@example.test", "outra.admin@example.test", "admin@example.test"] });
  // O boot depois de salvar as configurações lê o /me de novo: a n-ésima leitura diz quem está na aba. O aviso do salvamento
  // anterior é fechado antes, para que a espera seja pelo aviso deste (que só vem depois do boot).
  const reboot = async (n) => {
    const close = page.locator("#notices").getByRole("button", { name: "Fechar aviso" });
    if (await close.count()) await close.click();
    await page.locator('.sidebar nav [data-view="access"]').click();
    await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    // Expansão 8: o aviso do salvamento só aparece para quem salvou; a espera é pela n-ésima leitura do /me e pela rede parada.
    for (let i = 0; i < 80 && control.me < n; i++) await page.waitForTimeout(50);
    await page.waitForLoadState("networkidle");
    assert.equal(control.me, n, "o /me foi lido de novo");
    await page.locator('.sidebar nav [data-view="import"]').click();
    await soon(page.locator("#csv-file"));
  };
  await page.locator("#csv-file").setInputFiles({ name: "notas-de-quem-saiu.csv", mimeType: "text/csv", buffer: Buffer.alloc(2000001, "a") });
  await soon(page.locator("#timp-check-status"));
  assert.match(await text(page.locator("#timp-check-status")), /notas-de-quem-saiu\.csv não passou na conferência/);
  // A mesma pessoa: o erro continua, como continuariam o arquivo e a prévia.
  await reboot(2);
  assert.match(await text(page.locator("#timp-check-status")), /notas-de-quem-saiu\.csv não passou na conferência/, "sem troca de usuário, o erro fica");
  // Outra pessoa: nada do erro de quem saiu.
  await reboot(3);
  assert.equal(await page.locator("#timp-check-status").count(), 0);
  assert.doesNotMatch(await page.locator("main").innerText(), /notas-de-quem-saiu/);
  assert.equal(await read(page.locator("#csv-file"), (l) => l.getAttribute("aria-invalid")), null);
  // Quem saiu entra de novo: o erro foi descartado junto com os rascunhos dele.
  await reboot(4);
  assert.equal(await page.locator("#timp-check-status").count(), 0, "o erro antigo não volta");
  assert.doesNotMatch(await page.locator("main").innerText(), /notas-de-quem-saiu/);
  assert.equal(await read(page.locator("#csv-file"), (l) => l.getAttribute("aria-invalid")), null);
  await context.close();
});

test("IB8: atividades — o foco fica na caixa; a contagem acompanha; com a seleção alterada, Publicar parado com o motivo e Atualizar prévia envia a seleção; Mostrar as sem notas", async () => {
  const { context, page, control } = await open();
  control.previewKind = "curso";
  await readyPreview(page);
  const python = page.locator(`input[data-activity="${ACTIVITIES[4].id}"]`);
  await python.focus();
  await page.keyboard.press("Space");
  await settle(page);
  assert.equal(await read(python, (l) => l.isChecked()), true);
  assert.equal(await active(page), "input#timp-activity-4", "o foco continua na caixa");
  assert.equal(await text(page.locator("#timp-activities-count")), "5 de 13 atividades liberadas");
  assert.equal(await read(publishButton(page), (l) => l.isDisabled()), true);
  assert.equal(await text(page.locator("#timp-publish-reason")), "Você alterou a seleção. Atualize a prévia antes de publicar.");
  assert.equal(await read(publishButton(page), (l) => l.getAttribute("aria-describedby")), "timp-publish-reason");
  // As 8 sem notas: atrás de "Mostrar", com o foco no botão; marcar uma não fecha a lista, e desmarcar também não.
  const toggle = page.locator("#timp-unfilled-toggle");
  assert.equal(await text(toggle), "Mostrar as 8 atividades sem notas preenchidas");
  assert.equal(await read(page.locator(`input[data-activity="${ACTIVITIES[5].id}"]`), (l) => l.isVisible()), false);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await settle(page);
  assert.equal(await active(page), "button#timp-unfilled-toggle Ocultar as 8 atividades sem notas preenchidas");
  assert.equal(await read(toggle, (l) => l.getAttribute("aria-expanded")), "true");
  const cert = page.locator(`input[data-activity="${ACTIVITIES[5].id}"]`);
  await cert.check();
  await cert.uncheck();
  await settle(page);
  assert.equal(await read(cert, (l) => l.isVisible()), true, "a lista continua aberta");
  assert.equal(await active(page), "input#timp-activity-5");
  await page.getByRole("button", { name: "Atualizar prévia", exact: true }).click();
  await page.waitForResponse((r) => r.url().endsWith("/preview")).catch(() => null);
  await soon(publishButton(page));
  await settle(page);
  assert.deepEqual(control.previews.at(-1).activeIds, [ACTIVITIES[0].id, ACTIVITIES[1].id, ACTIVITIES[2].id, ACTIVITIES[3].id, ACTIVITIES[4].id]);
  assert.equal(await read(page.locator(`input[data-activity="${ACTIVITIES[5].id}"]`), (l) => l.isVisible()), true, "a nova prévia mantém as sem notas à vista");
  assert.equal(await read(publishButton(page), (l) => l.isEnabled()), true);
  assert.equal(await page.locator("#timp-publish-reason").count(), 0);
  await context.close();
  // Uma sem notas que veio liberada (da publicação em vigor): a lista aparece aberta, sem "Ocultar"; desmarcá-la não a fecha.
  const other = await open();
  other.control.previewKind = "curso-liberada";
  await readyPreview(other.page);
  const kept = other.page.locator(`input[data-activity="${COURSE[9].id}"]`);
  assert.equal(await read(kept, (l) => l.isVisible()), true, "a sem notas liberada fica à vista");
  assert.equal(await other.page.locator("#timp-unfilled-toggle").count(), 0);
  await kept.uncheck();
  await settle(other.page);
  assert.equal(await read(kept, (l) => l.isVisible()), true, "desmarcada, a lista continua aberta");
  assert.equal(await active(other.page), "input#timp-activity-9");
  await other.context.close();
});

test("IB9: alunos removidos — o alerta com o nome na prévia; a confirmação junto do botão; Publicar parado com o motivo até confirmar; publica com acknowledgeRemoved", async () => {
  const { context, page, control } = await open();
  control.previewKind = "remocao";
  await readyPreview(page);
  assert.match(await text(page.locator(".timp-changes .timp-alert")), /^Atenção: 1 aluno deixa de aparecer na publicação atual\. .*Aluna Fictícia 23/);
  const ack = page.locator("#acknowledge-removed");
  assert.equal(await read(ack, (l) => l.evaluate((el) => el.closest(".timp-publish") !== null)), true, "a confirmação fica na etapa Publicação");
  assert.equal(await text(page.locator(".timp-ack")), "Conferi e confirmo a remoção de 1 aluno nesta publicação.");
  assert.equal(await read(publishButton(page), (l) => l.isDisabled()), true);
  assert.equal(await text(page.locator("#timp-publish-reason")), "Confira e confirme os alunos removidos antes de publicar.");
  await ack.check();
  await settle(page);
  assert.equal(await active(page), "input#acknowledge-removed");
  assert.equal(await page.locator("#timp-publish-reason").count(), 0);
  const settled = publishSettled(page);
  await publishButton(page).click();
  await settled();
  assert.match(control.dialogs.at(-1), /^Publicar as notas para 23 alunos da BRSA0267\?/);
  assert.deepEqual(control.publishes.map((p) => p.acknowledgeRemoved), [true]);
  await context.close();
});

test("IB10: sem rolagem lateral nem controle escondido em 320–1440 px, texto a 200% e 250%, zoom a 200% e janela baixa, com nome de arquivo e mensagem extensos", async () => {
  for (const [width, height, txt] of [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 568, 1], [1440, 900, 2], [390, 844, 2], [320, 568, 2], [320, 568, 2.5], [720, 450, 1], [1280, 560, 1]]) {
    const { context, page, control } = await open({ width, height, text: txt });
    const where = `${width}×${height} texto ${txt * 100}%`;
    await pick(page, LONG_FILE);
    control.previewMode = "cabecalho";
    await check(page);
    assert.match(await text(page.locator("#timp-check-status")), /não passou na conferência/, where);
    assert.deepEqual([await pageScroll(page), await clipped(page)], [0, []], `${where}: arquivo com erro`);
    control.previewMode = "ok";
    control.previewKind = "remocao";
    await check(page);
    await soon(publishButton(page));
    for (const opened of await page.locator(".timp-change details").all()) await opened.evaluate((d) => { d.open = true; });
    assert.deepEqual([await pageScroll(page), await clipped(page)], [0, []], `${where}: prévia`);
    // Publicar e o rótulo do seletor na janela, sem rolar nada para o lado; a situação de cada aluno dentro da tela.
    for (const selector of ['[data-action="publish"]', ".timp-choose", ".timp-row:first-child .timp-state", 'button[form="import-form"]']) {
      const inside = await page.locator(selector).first().evaluate((el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
      assert.ok(inside, `${where}: ${selector} dentro da janela`);
    }
    control.publishMode = "network";
    await page.locator("#acknowledge-removed").check();
    const settled = publishSettled(page);
    await publishButton(page).click();
    await settled();
    assert.match(await text(page.locator("#timp-publish-status")), /pode ter sido concluída/, where);
    assert.deepEqual([await pageScroll(page), await clipped(page)], [0, []], `${where}: falha da publicação`);
    await context.close();
  }
});

// C3: o resumo de cada mudança é uma linha flexível (seta + texto); a largura mínima dela é a da palavra mais longa com a seta.
// Com contagens de dois dígitos e a DejaVu Sans do Linux da CI, "17 notas alteradas (12 notas novas, 2 removidas)" pedia 313 px
// a 320 px com texto a 250% (a etapa tem 290) e a prévia rolava para o lado; com a SF do macOS, 286 px. Os dados do IB10 (uma
// casa) ficam abaixo do limite nas duas fontes.
test("IB10b: prévia com contagens de dois dígitos a 320 px com texto a 250% — resumos inteiros na etapa e sem rolagem lateral", async () => {
  const { context, page, control } = await open({ width: 320, height: 568, text: 2.5 });
  control.previewKind = "contagens";
  await readyPreview(page);
  for (const opened of await page.locator(".timp-change details").all()) await opened.evaluate((d) => { d.open = true; });
  const summaries = await page.locator(".timp-change summary").evaluateAll((all) => all.map((el) => {
    const r = el.getBoundingClientRect(), step = el.closest(".timp-step-body").getBoundingClientRect();
    return { text: el.textContent.replace(/\s+/g, " ").trim(), inside: r.left >= step.left - 0.5 && r.right <= step.right + 0.5 };
  }));
  assert.ok(summaries.some((s) => s.text === "17 notas alteradas (12 notas novas, 2 removidas)"), JSON.stringify(summaries));
  assert.deepEqual(summaries.filter((s) => !s.inside), [], "resumos dentro da etapa");
  assert.deepEqual([await pageScroll(page), await clipped(page)], [0, []], "prévia sem rolagem lateral nem texto recortado");
  await context.close();
});

// C3: com texto muito ampliado (faixa de 8,5rem do Painel), o número da etapa ocupa menos largura antes de qualquer quebra no meio
// da palavra do título. Com a tipografia de referência (Arial = Liberation Sans: as mesmas larguras no macOS e no Linux),
// "Publicação" (233 px) cabe ao lado do número (240 px); com a coluna do número de antes (1,6em, 72 px) sobravam 218 e a palavra
// era partida. Com fonte mais larga que a referência (DejaVu Sans: 269 px), a quebra continua sendo o último recurso.
test("IB10c: a 320 px com texto a 250%, nenhuma palavra dos títulos das etapas é partida quando cabe ao lado do número (tipografia de referência)", async () => {
  const { context, page } = await open({ width: 320, height: 568, text: 2.5 });
  await readyPreview(page);
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
  }, ".teacher-import .timp-step-title");
  assert.ok(m.reference, "tipografia de referência aplicada");
  assert.ok(m.words.some((w) => w.word === "Publicação"), JSON.stringify(m.words));
  assert.deepEqual(m.words.filter((w) => w.lines > 1), [], "nenhuma palavra partida");
  await context.close();
});

test("IB11: teclado na ordem da tarefa, com contorno inteiro (pixels) — inclusive no rótulo do seletor; no celular, o foco não fica atrás da barra inferior", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page, control } = await open({ width, height });
    control.previewKind = "curso";
    await readyPreview(page);
    const order = [];
    // Do título da prévia (foco depois de conferir), Shift+Tab volta ao seletor: daí em diante, só Tab.
    await read(page.locator("#timp-review-title"), (l) => l.focus());
    await page.keyboard.press("Shift+Tab");
    for (let i = 0; i < 40 && !order.includes("publish"); i++) {
      const now = await page.evaluate(() => { const a = document.activeElement; return a.id === "csv-file" ? "csv-file" : a.matches("summary") ? "summary" : a.dataset.activity ? "atividade"
        : a.id === "timp-unfilled-toggle" ? "mostrar" : a.getAttribute("form") === "import-form" ? "atualizar" : a.dataset.action === "publish" ? "publish" : a.id || a.tagName.toLowerCase(); });
      if (order.at(-1) !== now) order.push(now);
      if (now === "csv-file") assert.deepEqual(await ringAround(page, ".timp-choose"), [], `${width}: contorno no rótulo do seletor`);
      else if (["summary", "atividade", "mostrar", "atualizar", "publish"].includes(now) && !(await page.evaluate(() => !!document.activeElement.closest(".timp-change.is-attention")))) {
        const covered = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), nav = document.querySelector(".sidebar nav"), n = nav.getBoundingClientRect();
          return getComputedStyle(nav).position === "fixed" && r.bottom > n.top + 1; });
        assert.equal(covered, false, `${width}: ${now} atrás da barra inferior`);
      }
      await page.keyboard.press("Tab");
    }
    assert.deepEqual(order, ["csv-file", "summary", "atividade", "mostrar", "atualizar", "publish"], `${width}: ordem do teclado`);
    await page.locator('[data-action="publish"]').focus();
    assert.deepEqual(await ringAround(page, '[data-action="publish"]'), [], `${width}: contorno em Publicar`);
    await context.close();
  }
});

test("IB12: estados — turma sem publicação, sem sincronização, versão em vigor carregando e com erro, prévia bloqueada, demonstração", async () => {
  // Turma sem publicação: o contexto diz, e a pergunta fala em primeira publicação.
  let { context, page, control } = await open({ data: report(null) });
  assert.equal(await text(page.locator(".timp-in-force")), "Em vigor A turma ainda não tem notas publicadas.");
  await readyPreview(page);
  const settled = publishSettled(page);
  await publishButton(page).click();
  await settled();
  assert.match(control.dialogs.at(-1), /Esta será a primeira publicação da turma\./);
  await context.close();
  // Sem sincronização automática: de onde vêm as notas, e nada da próxima verificação.
  ({ context, page } = await open({ autoSync: false }));
  assert.equal(await text(page.locator(".timp-auto")), "Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado aqui.");
  await readyPreview(page);
  assert.doesNotMatch(await text(page.locator(".timp-publish")), /continua ligada/);
  await context.close();
  // Prévia bloqueada: o crítico na integridade e o motivo junto do botão; nada é enviado.
  ({ context, page, control } = await open());
  control.previewKind = "bloqueada";
  await readyPreview(page);
  assert.match(await text(page.locator(".timp-issues.is-critical")), /^Publicação bloqueada: corrija o arquivo e confira de novo\. 1 aluno\(s\) não pertence\(m\) à turma no Canvas\. Canvas ID 999999$/);
  assert.equal(await text(page.locator("#timp-publish-reason")), "Publicação bloqueada pelas validações de integridade. Confira os itens críticos no início da prévia.");
  await publishButton(page).evaluate((b) => b.click());
  assert.equal(control.publishes.length, 0);
  await context.close();
  // Versão em vigor: erro ao consultar (com o motivo e a consulta) e carregando.
  ({ context, page, control } = await open());
  control.reportMode = "error";
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.locator("#cohort").selectOption("BRSA0267");
  await page.waitForLoadState("networkidle");
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator(".timp-in-force"));
  assert.equal(await text(page.locator(".timp-in-force")), "Em vigor Não foi possível consultar a versão em vigor: Não foi possível carregar o relatório da turma agora. Consultar atualização");
  control.reportMode = "ok";
  const h = { arrived: deferred(), gate: deferred() };
  control.holds.report = h;
  await page.locator('.timp-in-force [data-action="refresh-report"]').click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator(".timp-in-force")), "Em vigor Consultando a versão em vigor…");
  h.gate.resolve();
  await page.waitForResponse((r) => r.url().endsWith("/report")).catch(() => null);
  await settle(page);
  assert.equal(await text(page.locator(".timp-in-force")), "Em vigor Publicação de 10/10/2026, 18:04 · Sincronização com o Canvas");
  await context.close();
  // Demonstração: seletor e conferência desligados, com o motivo.
  ({ context, page } = await open({ demo: true }));
  await page.getByRole("button", { name: "Ver como instrutor" }).click().catch(() => {});
  await soon(page.locator('.sidebar nav [data-view="import"]'));
  await page.locator('.sidebar nav [data-view="import"]').click();
  await soon(page.locator("#csv-file"));
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#csv-file")?.disabled, document.querySelector('#import-form [type="submit"]')?.disabled]), [true, true]);
  assert.match(await text(page.locator(".teacher-import")), /Na demonstração, o envio de arquivos fica desligado\./);
  await context.close();
});

test("IB13: o admin vê a mesma tela; o aluno não tem Atualizar notas (a visualização como aluno fica em student-view-browser)", async () => {
  let { context, page } = await open({ role: "admin" });
  assert.deepEqual(await stepTitles(page), ["1 Arquivo do Canvas", "2 Prévia", "3 Publicação"]);
  await context.close();
  ({ context, page } = await open({ role: "student", view: "overview" }));
  assert.equal(await page.locator('[data-view="import"], .teacher-import').count(), 0);
  await context.close();
});

test("IB14: composição por largura — a superfície é a da ação; número das etapas na margem; tabela ou linhas empilhadas; duas colunas de atividades; dois anéis no crítico", async () => {
  for (const [width, height, txt, frame, gutter, table, columns] of [[1440, 900, 1, true, true, true, 2], [1024, 768, 1, true, true, true, 1], [768, 1024, 1, true, false, false, 1],
    [390, 844, 1, false, false, false, 1], [320, 568, 1, false, false, false, 1], [1440, 900, 2, false, false, false, 1]]) {
    const { context, page, control } = await open({ width, height, text: txt });
    const where = `${width} texto ${txt * 100}%`;
    const surface = (selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const st = getComputedStyle(el); return st.borderTopStyle !== "none" && st.backgroundColor !== "rgba(0, 0, 0, 0)"; }, selector);
    assert.equal(await surface(".timp-file"), frame, `${where}: arquivo como superfície`);
    control.previewKind = "curso";
    await readyPreview(page);
    assert.equal(await surface(".timp-file"), false, `${where}: com prévia, o arquivo deixa de ser a superfície`);
    assert.equal(await surface(".timp-publish"), frame, `${where}: publicação como superfície`);
    const m = await page.evaluate(() => {
      if (!["#timp-review-title", ".timp-summary", ".timp-table table", ".timp-state.is-critical", ".timp-state.is-attention", "#timp-unfilled"].every((s) => document.querySelector(s))) return null;
      const left = (s) => Math.round(document.querySelector(s).getBoundingClientRect().left);
      const options = [...document.querySelectorAll(".timp-option-list:not([hidden]) > li")].slice(0, 4).map((li) => Math.round(li.getBoundingClientRect().left));
      const ring = (s) => parseFloat(getComputedStyle(document.querySelector(s), "::before").width) / parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      return { title: left("#timp-review-title"), titleText: Math.round(document.querySelector("#timp-review-title").getBoundingClientRect().left + document.querySelector("#timp-review-title .timp-n").getBoundingClientRect().width),
        summary: left(".timp-summary"), table: getComputedStyle(document.querySelector(".timp-table table")).display, columns: new Set(options).size,
        critical: ring(".timp-state.is-critical"), attention: ring(".timp-state.is-attention"), hidden: getComputedStyle(document.querySelector("#timp-unfilled")).display };
    });
    assert.ok(m, `${where}: estrutura da prévia`);
    assert.equal(m.summary > m.title + 8, gutter, `${where}: número na margem (${JSON.stringify(m)})`);
    assert.equal(m.table === "table", table, `${where}: tabela (${m.table})`);
    assert.equal(m.columns, columns, `${where}: colunas de atividades`);
    assert.ok(m.critical > 1.3 && m.attention < 0.9, `${where}: dois anéis no crítico, um na atenção (${m.critical}, ${m.attention})`);
    assert.equal(m.hidden, "none", `${where}: as sem notas ficam fechadas`);
    await context.close();
  }
});

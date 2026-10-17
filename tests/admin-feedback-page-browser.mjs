// Expansão 9 do piloto visual: Feedbacks administrativos (docs/design-visual.md), com API fictícia (nunca AWS, Cognito, S3 ou
// feedback real; dados sintéticos em domínios .example e .test; toda chamada para fora da origem é abortada). Cobre o que a tela
// promete: a área do portal inteiro; a caixa de entrada em linhas, com o começo de cada mensagem em até duas linhas; o resumo do
// portal, que também filtra, e os filtros do contrato; o detalhe com a mensagem inteira e os dados do envio; a mudança de status
// com a mesma chamada (expectedStatus), parada enquanto o status escolhido é o atual, andamento junto da ação com o foco, um
// pedido só, sucesso só com a resposta; recusa e dúvida ditas de jeitos diferentes, com a lista atualizada como consulta segura;
// resposta antiga, troca de feedback e de pessoa; conteúdo não confiável como texto; composição sem rolagem lateral nem controle
// escondido em 320–1440 px, texto e zoom a 200% e janela baixa; teclado com contorno; formas de status; papéis.
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
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const COHORTS = [
  { code: "BRSA0267", name: "AWS re/Start · Turma 267", current: "pub-267", autoSync: false, canvasCourseId: null, thresholds: { kc: 70, lab: 95 } },
  { code: "BRSA0268", name: "AWS re/Start · Turma 268", current: "pub-268", autoSync: false, canvasCourseId: null, thresholds: { kc: 70, lab: 95 } },
];
const LONG_TEXT = "Ao abrir Minhas atividades no celular, a lista some depois de alguns segundos e volta só quando eu giro a tela. Aconteceu três vezes hoje, "
  + "sempre depois de publicar as notas da semana.\n\nPassos:\n1. Entrar como aluno\n2. Abrir Minhas atividades\n3. Esperar 10 segundos\n\n"
  + "Esperado: a lista continua na tela. Obtido: a lista some e aparece a mensagem de erro por um instante.";
const SPECIAL = "<b>negrito?</b> **markdown literal** [link](https://exemplo.example/x) https://exemplo.example/caminho?a=1&b=2\n<img src=x onerror=alert(1)>\n"
  + "Acentuação: ação, coração, pão — ÁÉÍÓÚ ñ ü ç 日本語 🙂👍";
// Feedback sintético no formato do backend (id com a data; sub, e-mail e nome fictícios), do mais novo para o mais antigo.
let serial = 0;
function item(i, over = {}) {
  serial += 1;
  const created = new Date(Date.UTC(2026, 9, 13, 15, 0) - i * 5 * 3600000).toISOString().replace(".000Z", "Z");
  return { id: `${created.replace(/[-:Z]/g, "")}000000-${String(serial).padStart(8, "0")}`, type: "BUG", title: `Relato ${i + 1}`,
    description: "A nota do LAB 3 aparece como pendente mesmo depois da publicação.", page: "activities", cohort: "BRSA0267", status: "NEW", createdAt: created,
    createdBy: `uid-sub-${serial}`, createdByEmail: `aluna.${i + 1}@example.test`, canvasId: String(31000 + i), publicationId: "pub-267", updatedAt: created,
    updatedBy: `uid-sub-${serial}`, statusHistory: [{ status: "NEW", by: `uid-sub-${serial}`, at: created }], attachments: 0, studentName: `Aluna Exemplo ${i + 1}`,
    inCohort: true, canViewAsStudent: true, ...over };
}
const SETS = {
  padrao: () => [
    item(0, { title: "KC aparece como pendente depois da publicação", status: "NEW", attachments: 2, description: LONG_TEXT, studentName: "Ana Souza", createdByEmail: "ana.souza@example.test" }),
    item(1, { title: "Mostrar a data da última atualização no painel", type: "SUGGESTION", status: "IN_REVIEW", cohort: "BRSA0268", studentName: "Bruno Reis",
      createdByEmail: "bruno.reis@example.test", publicationId: "pub-268", updatedAt: "2026-10-13T16:30:00Z", page: "overview" }),
    item(2, { title: "Lembretes em lote: texto da mensagem cortado no celular", type: "IMPROVEMENT", status: "RESOLVED", page: "reminders-batch", studentName: null,
      canvasId: null, inCohort: false, canViewAsStudent: false, createdByEmail: "instrutora.lima@instituicao.example", updatedAt: "2026-10-13T18:00:00Z" }),
    item(3, { title: "Dúvida sobre o prazo do LAB 5", type: "OTHER", status: "NEW", cohort: null, studentName: null, canvasId: null, inCohort: false, canViewAsStudent: false,
      page: "onboarding", publicationId: null, createdByEmail: "pessoa.sem.turma@example.test", description: "Curta." }),
    item(4, { title: "Sugestão antiga já arquivada", type: "SUGGESTION", status: "ARCHIVED", studentName: "Caio Lima", createdByEmail: "caio.lima@example.test" }),
  ],
  muitos: () => Array.from({ length: 62 }, (_, i) => item(i, { title: `Relato ${i + 1}: ${["nota não aparece", "link do Canvas abre outra atividade", "sugestão de filtro", "erro ao enviar o CSV"][i % 4]}`,
    type: ["BUG", "BUG", "SUGGESTION", "IMPROVEMENT"][i % 4], status: ["NEW", "IN_REVIEW", "RESOLVED", "NEW"][i % 4], cohort: i % 3 ? "BRSA0267" : "BRSA0268",
    description: i % 5 === 0 ? LONG_TEXT : "Descrição curta do problema, com o passo a passo resumido.", attachments: i % 7 === 0 ? 1 : 0 })),
  vazio: () => [],
  arquivados: () => [item(0, { status: "ARCHIVED" })],
  longos: () => [
    item(0, { title: `Título extenso: ${"a nota do laboratório de redes aparece como pendente ".repeat(2).trim()}`, studentName: "Maria Aparecida dos Santos de Albuquerque Cavalcanti Figueiredo Monteiro",
      createdByEmail: "maria.aparecida.dos.santos.de.albuquerque.cavalcanti.figueiredo@example.test", description: `Palavra sem espaços: ${"inconstitucionalissimamente".repeat(8)}\n\n${LONG_TEXT.repeat(3)}`, attachments: 3 }),
    item(1, { title: "Conteúdo com caracteres especiais <script>alert(1)</script> & “aspas” 🙂", type: "OTHER", description: SPECIAL }),
  ],
};
const ERRORS = { 400: [400, "Status inválido."], 403: [403, "Você não tem acesso a esta operação."], 404: [404, "Feedback não encontrado."],
  409: [409, "O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo."], 429: [429, null], 503: [503, null] };
const STATUSES = ["NEW", "IN_REVIEW", "RESOLVED", "ARCHIVED"];
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

// control: modes por operação ("ok" | chave de ERRORS | "network": nada chega | "lost": o servidor aplica e a resposta se perde) —
// list (primeira página), more (páginas seguintes), status, attachments —; holds por operação (holdNext, com um filtro opcional da
// consulta); posts (o corpo de cada mudança de status), gets (a consulta de cada GET da lista), people (sequência de /me) e os dados.
async function open({ width = 1440, height = 900, text = 1, role = "admin", people, set = "padrao", view = "admin-feedback", modes = {}, pageSize = 50 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-14T10:00:00-03:00"));
  const control = { modes: { ...modes }, holds: {}, posts: [], gets: [], requests: [], blocked: [], me: 0, items: structuredClone(SETS[set]()), pageSize,
    people: people || [role === "admin" ? "admin@example.test" : role === "instructor" ? "ana.lima@instituicao.example" : "lia.mota@example.test"] };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { errors.push(`diálogo inesperado: ${dialog.message()}`); return dialog.dismiss(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view, code }) => {
    if (sessionStorage.getItem("e9")) return;
    sessionStorage.setItem("e9", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code, view }));
  }, { email: control.people[0], view, code: COHORTS[0].code });
  const hold = async (name, query) => { const h = control.holds[name]; if (!h || (h.when && !h.when(query))) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const answer = async (route, op, apply, json, query) => {
    const mode = control.modes[op] || "ok";
    if (mode === "ok" || mode === "lost") apply?.();
    await hold(op, query);
    if (mode === "network" || mode === "lost") return route.abort("failed");
    if (ERRORS[mode]) { const [status, error] = ERRORS[mode]; return route.fulfill(error ? { status, json: { error } } : { status, contentType: "text/plain", body: status === 429 ? "Too Many Requests" : "Service Unavailable" }); }
    return route.fulfill({ json: json() });
  };
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { control.blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (url.pathname.startsWith("/anexo/")) return route.fulfill({ contentType: "image/png", body: PIXEL });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), method = request.method(), body = request.postData() ? request.postDataJSON() : null;
    control.requests.push(`${method} ${endpoint}`);
    if (endpoint === "/me") { const email = control.people[Math.min(control.me++, control.people.length - 1)]; return route.fulfill({ json: { email, roles: [role] } }); }
    if (endpoint === "/cohorts" && method === "GET") return route.fulfill({ json: { cohorts: (role === "admin" ? COHORTS : COHORTS.slice(0, 1)).map((c) => ({ ...c, canTeach: role !== "student" })) } });
    if (endpoint === "/admin/feedback") {
      const q = Object.fromEntries(url.searchParams);
      control.gets.push(q);
      return answer(route, q.cursor ? "more" : "list", null, () => {
        const keep = (f) => (STATUSES.includes(q.status) ? f.status === q.status : q.status === "ALL" || f.status !== "ARCHIVED") && (!q.type || f.type === q.type) && (!q.cohort || f.cohort === q.cohort);
        const filtered = control.items.filter(keep);
        const start = q.cursor ? filtered.findIndex((f) => f.id === atob(q.cursor)) + 1 : 0;
        const size = Math.min(Number(q.limit || control.pageSize), control.pageSize);
        const slice = filtered.slice(start, start + size);
        return { items: slice, nextCursor: start + size < filtered.length ? btoa(slice.at(-1).id) : null,
          summary: Object.fromEntries(STATUSES.map((s) => [s, control.items.filter((f) => f.status === s).length])) };
      }, q);
    }
    const status = endpoint.match(/^\/admin\/feedback\/([^/]+)\/status$/);
    if (status && method === "POST") {
      const id = decodeURIComponent(status[1]), it = control.items.find((f) => f.id === id);
      control.posts.push({ id, ...body });
      if (it && it.status !== body.expectedStatus && !control.modes.status) return route.fulfill({ status: 409, json: { error: ERRORS[409][1] } });
      return answer(route, "status", () => { if (it && it.status !== body.status) Object.assign(it, { status: body.status, updatedAt: "2026-10-14T13:00:00Z", updatedBy: "uid-sub-admin",
        statusHistory: [...it.statusHistory, { status: body.status, by: "uid-sub-admin", at: "2026-10-14T13:00:00Z" }] }); }, () => ({ feedback: { ...it } }));
    }
    let match = endpoint.match(/^\/feedback\/([^/]+)\/attachments$/);
    if (match && method === "GET") {
      const it = control.items.find((f) => f.id === decodeURIComponent(match[1]));
      return answer(route, "attachments", null, () => ({ items: Array.from({ length: it?.attachments || 0 }, (_, i) => ({ attachmentId: `${i + 1}`.padEnd(32, "0"),
        originalName: ["captura-da-tela.png", "erro-no-celular.webp", "lista-vazia.jpg"][i], size: 120000 * (i + 1), contentType: "image/png", status: "READY" })) }), { id: it?.id });
    }
    match = endpoint.match(/^\/feedback\/([^/]+)\/attachments\/([^/]+)$/);
    if (match && method === "GET") return route.fulfill({ json: { downloadUrl: `${origin}/anexo/${match[2]}.png`, expiresIn: 300 } });
    if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
    match = endpoint.match(/^\/cohorts\/([\w-]+)\/([a-z-]+)$/);
    if (match) {
      const [, code, op] = match;
      if (op === "report") return route.fulfill({ json: { cohort: code, publication: null, students: [], activities: [], history: [], thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null } } });
      if (op === "instructors" && method === "GET") return route.fulfill({ json: { instructors: [] } });
      if (op === "settings") return answer(route, "settings", null, () => body);
    }
    if (endpoint === "/feedback") return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin + "/");
  // Só depois do boot e da lista; nada aqui depende da marcação nova (no RED, a tela antiga falha por asserção).
  await page.locator(".layout").first().waitFor();
  await page.waitForLoadState("networkidle");
  await settle(page);
  return { context, page, errors, control, holdNext: (name, when) => (control.holds[name] = { arrived: deferred(), gate: deferred(), when }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
const read = async (locator, fn = (l) => l.innerText()) => ((await locator.count()) ? fn(locator.first()) : null);
const text = async (locator) => ((await read(locator)) ?? "").replace(/\s+/g, " ").trim();
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} ${(a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim()}`.trim(); });
const done = (page, suffix) => Promise.race([page.waitForResponse((r) => r.url().split("?")[0].endsWith(suffix)), page.waitForEvent("requestfailed", { predicate: (r) => r.url().split("?")[0].endsWith(suffix) })]).catch(() => null);
// Esperas por condição, com limite (5 s) e sem falhar: se a tela não chegar lá, a asserção seguinte falha dizendo o que viu (o
// tempo esgotado não é a evidência). A tela quieta: sem andamento da mudança de status, sem carga da lista, de mais itens ou de
// imagens.
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {}).then(() => settle(page));
const quiet = (page) => until(page, () => !document.querySelector("#afb-op-status.is-busy, .afb-loading, .fb-more:disabled, .admin-feedback p.small[role=status]"));
const listed = (page) => until(page, () => !!document.querySelector(".admin-feedback :is(.afb-row, .afb-empty, .afb-error)"));
const noticed = (page) => until(page, () => !!document.querySelector("#notices .notice"));
// O que não deve aparecer (aviso, pedido): a asserção vem depois de uma folga, para dar tempo a um aviso indevido.
const grace = (page) => page.waitForTimeout(300).then(() => settle(page));
async function ready(opened) { await listed(opened.page); await quiet(opened.page); return opened; }
async function openDetail(page, title) {
  await page.locator(".fb-open", { hasText: title }).first().click();
  await until(page, () => document.activeElement?.id === "fb-detail-title");
  await quiet(page);
}
// Como a pessoa faz: o foco vai ao seletor e a escolha muda o valor (o render que liga Salvar status mantém o foco nele).
const choose = async (page, value) => { await page.locator("#fb-status-select").focus(); await page.locator("#fb-status-select").selectOption(value); await settle(page); };
// Clicar num botão parado esperaria até o limite do teste: antes, a asserção diz que ele devia estar livre.
async function clickSave(page) {
  const button = page.locator("[data-fb-save]");
  assert.equal(await button.isEnabled(), true, "Salvar status livre antes do clique");
  await button.click();
}
async function finish(page, gate) {
  const answered = done(page, "/status");
  gate?.resolve();
  await answered;
  await page.waitForTimeout(80);
  await quiet(page);
}
const described = (page, selector) => page.evaluate((s) => (document.querySelector(s)?.getAttribute("aria-describedby") || "").split(" ").filter(Boolean)
  .map((id) => document.getElementById(id)?.innerText.trim()).join(" | "), selector);
const rowTitles = (page) => page.locator(".afb-row .fb-open").allInnerTexts();
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// O conteúdo da tela (o que fica no <main> fora do topo e do rodapé da casca): nada fora da coluna nem botão cortado.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll("main > :not(header, footer) :is(button, a, select, h1, h2, h3, p, dd, dt, time, li, .afb-op)")) {
    // Só leitor de tela (1 px, recortado de propósito): fora da medida.
    if (el.closest(".sr-only")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
    if (el.matches("button") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 40)}`);
    // Texto que passa da própria caixa (uma palavra ou um e-mail sem quebra): o retângulo do elemento não muda, a largura rolável sim.
    else if (el.matches("p, dd, dt, li, h1, h2, h3") && el.scrollWidth > el.clientWidth + 1) bad.push(`transborda: ${(el.textContent || "").trim().slice(0, 40)}`);
  }
  return bad;
});
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
// A forma do status (::before): anel, anel meio cheio, visto ou traço, como no Feedback do aluno; e a cor do texto.
const shapeOf = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const b = getComputedStyle(el, "::before"), st = getComputedStyle(el);
  const kind = b.content === "none" || b.content === "normal" ? "nenhuma" : b.borderRightStyle === "solid" && b.borderBottomStyle === "solid" && b.borderTopWidth === "0px" ? "visto"
    : b.borderRadius === "50%" && b.backgroundImage.startsWith("linear-gradient") ? "meio" : b.borderRadius === "50%" ? "anel"
    : parseFloat(b.borderTopWidth) > 0 && parseFloat(b.borderLeftWidth) === 0 && parseFloat(b.borderBottomWidth) === 0 && parseFloat(b.height) <= parseFloat(b.borderTopWidth) + 0.5 ? "traço" : "outra";
  return { kind, color: st.color, border: st.borderTopStyle === "none" || parseFloat(st.borderTopWidth) === 0 ? "sem borda" : "com borda", radius: st.borderTopLeftRadius };
}, selector);
const cssColor = (page, token) => page.evaluate((t) => { const el = document.createElement("i"); el.style.color = `var(${t})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; }, token);

test("FB1: composição — a área do portal no topo; o resumo do portal e os filtros juntos; a caixa de entrada em linhas, sem cartões nem superfícies; o começo de cada mensagem em até duas linhas", async () => {
  const { context, page, errors, control } = await ready(await open());
  assert.deepEqual([await text(page.locator(".location-context > span")), await text(page.locator(".location-context strong"))], ["Administração do portal", "Feedbacks"], "a área é do portal, não da turma do menu");
  const heads = await page.locator(".admin-feedback :is(h1, h2, h3)").evaluateAll((els) => els.map((el) => `${el.tagName} ${el.textContent.trim()}`));
  assert.deepEqual(heads, ["H1 Feedbacks", "H2 Lista de feedbacks", "H3 KC aparece como pendente depois da publicação", "H3 Mostrar a data da última atualização no painel",
    "H3 Lembretes em lote: texto da mensagem cortado no celular", "H3 Dúvida sobre o prazo do LAB 5"]);
  assert.equal(await text(page.locator(".afb-summary")), "No portal inteiro Todos (sem arquivados) 4 Novos 2 Em análise 1 Resolvidos 1 Arquivados 1");
  assert.equal(await read(page.locator('.afb-summary [aria-pressed="true"]'), (l) => l.innerText().then((t) => t.replace(/\s+/g, " "))), "Todos (sem arquivados) 4");
  const action = await cssColor(page, "--color-action");
  const marks = await page.locator(".afb-summary .afb-count").evaluateAll((els, a) => els.map((el) => { const s = getComputedStyle(el);
    return `${el.getAttribute("aria-pressed")} ${s.borderBottomColor === a ? "ciano" : "sem cor"} ${s.borderBottomWidth}`; }), action);
  assert.deepEqual(marks, ["true ciano 2px", "false sem cor 2px", "false sem cor 2px", "false sem cor 2px", "false sem cor 2px"], "o ativo com o traço ciano");
  assert.deepEqual(await page.locator(".afb-filters label").allInnerTexts(), ["Status", "Tipo", "Turma"]);
  assert.deepEqual(control.gets, [{ limit: "50" }], "uma consulta, sem filtro: os arquivados ficam de fora no backend");
  // Cada linha: título, status, tipo, turma, quem enviou, quando, anexos e o começo da mensagem (o leitor de tela ouve também
  // "enviado por" e "em", que ficam fora da vista).
  assert.equal(await text(page.locator(".afb-row").first()), "KC aparece como pendente depois da publicação Novo · Bug · BRSA0267 · enviado por Ana Souza · em 13 de outubro de 2026 · 2 anexos "
    + "Ao abrir Minhas atividades no celular, a lista some depois de alguns segundos e volta só quando eu giro a tela. Aconteceu três vezes hoje, sempre depois de publicar as notas da…");
  assert.equal(await text(page.locator(".afb-row").nth(2).locator(".afb-meta")), "Resolvido · Melhoria · BRSA0267 · enviado por instrutora.lima@instituicao.example · em 13 de outubro de 2026");
  assert.equal(await text(page.locator(".afb-row").nth(3).locator(".afb-meta")), "Novo · Outro · Sem turma · enviado por pessoa.sem.turma@example.test · em 12 de outubro de 2026");
  // Uma mensagem longa não aumenta a linha: o começo dela fica em até duas linhas; a mensagem inteira, no detalhe.
  const previews = await page.locator(".afb-preview").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))));
  assert.ok(previews.length === 4 && previews.every((lines) => lines >= 1 && lines <= 2), JSON.stringify(previews));
  // Linhas sobre o fundo, separadas por linha fina: nenhuma superfície (fundo e borda) na lista.
  const surfaces = await page.evaluate(() => [...document.querySelectorAll(".admin-feedback *")].filter((el) => { const s = getComputedStyle(el); return s.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(s.borderTopWidth) > 0 && !el.matches("button, select, input, .notice"); }).map((el) => el.className));
  assert.deepEqual(surfaces, []);
  assert.ok(await page.locator(".afb-row").first().evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth) >= 1), "divisória fina entre as linhas");
  assert.doesNotMatch(await page.locator(".admin-feedback").innerText(), /uid-sub/, "nenhum identificador interno");
  assert.deepEqual([errors, control.blocked], [[], []]);
  await context.close();
});

test("FB2: o detalhe — o foco no título; a mensagem inteira com as quebras de linha; os dados do envio; as imagens; voltar devolve o foco à linha, sem consultar de novo", async () => {
  const { context, page, errors, control } = await ready(await open());
  await openDetail(page, "KC aparece como pendente");
  assert.match(await active(page), /^h2#fb-detail-title KC aparece como pendente/);
  assert.equal(await text(page.locator(".afb-kind")), "Bug · enviado em 13 de outubro de 2026 às 12:00");
  assert.equal(await text(page.locator(".afb-state")), "Status: Novo", "o status, sem desde (não mudou depois do envio)");
  assert.equal(await page.locator(".fb-description").innerText(), LONG_TEXT, "a mensagem inteira, como foi escrita");
  assert.equal(await page.locator(".fb-description").evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap");
  assert.deepEqual(await page.locator(".afb-facts dt").allInnerTexts(), ["Aluno", "E-mail", "Turma", "Página de origem", "Publicação"]);
  assert.deepEqual(await page.locator(".afb-facts dd").allInnerTexts(), ["Ana Souza", "ana.souza@example.test", "BRSA0267", "Atividades", "pub-267"]);
  // As imagens do handler de anexos, como antes: o nome, o tamanho e o link temporário (aqui, da origem local).
  assert.deepEqual(await page.locator(".afb-attachments .fb-file-name").allInnerTexts(), ["captura-da-tela.png", "erro-no-celular.webp"]);
  assert.equal(await page.locator(".afb-attachments img").count(), 2);
  assert.deepEqual(await page.locator('.afb-attachments a.text-link').evaluateAll((els) => els.map((a) => [a.getAttribute("target"), a.getAttribute("rel"), new URL(a.href).origin])),
    [["_blank", "noopener noreferrer", origin], ["_blank", "noopener noreferrer", origin]]);
  assert.equal(await page.getByRole("button", { name: "Visualizar como aluno" }).count(), 1);
  // Status mudado depois do envio: desde quando; autor sem vínculo de aluno.
  const gets = control.gets.length;
  await page.locator("[data-fb-back]").click();
  await settle(page);
  assert.match(await active(page), /^button KC aparece como pendente/, "o foco volta à linha aberta");
  assert.equal(control.gets.length, gets, "voltar não consulta de novo");
  await openDetail(page, "Mostrar a data");
  assert.equal(await text(page.locator(".afb-state")), "Status: Em análise desde 13 de outubro de 2026 às 13:30");
  await page.locator("[data-fb-back]").click();
  await openDetail(page, "Lembretes em lote");
  assert.deepEqual(await page.locator(".afb-facts dd").allInnerTexts(), ["Sem vínculo de aluno", "instrutora.lima@instituicao.example", "BRSA0267", "Lembretes em lote", "pub-267"]);
  assert.equal(await page.getByRole("button", { name: "Visualizar como aluno" }).count(), 0);
  assert.equal(await text(page.locator(".afb-attachments")), "Anexos Nenhuma imagem anexada.");
  assert.doesNotMatch(await page.locator(".admin-feedback").innerText(), /uid-sub/);
  // A linha inteira é o alvo: um clique no começo da mensagem (fora do título) também abre o feedback.
  await page.locator("[data-fb-back]").click();
  await settle(page);
  const target = page.locator(".afb-row", { hasText: "Dúvida sobre o prazo" }).locator(".afb-preview");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await until(page, () => document.querySelector("#fb-detail-title")?.textContent === "Dúvida sobre o prazo do LAB 5");
  assert.equal(await text(page.locator("#fb-detail-title")), "Dúvida sobre o prazo do LAB 5");
  assert.deepEqual([errors, control.blocked], [[], []]);
  await context.close();
});

test("FB3: mudar o status — parado até escolher outro status; andamento junto da ação com o foco e os controles parados; um pedido só, mesmo com clique duplo; sucesso só com a resposta, e o foco no seletor", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open());
  await openDetail(page, "KC aparece como pendente");
  assert.deepEqual([await page.locator("[data-fb-save]").isDisabled(), await described(page, "[data-fb-save]")], [true, "Escolha outro status para salvar."], "com o status atual, nada a salvar");
  assert.equal(await text(page.locator(".afb-status-action .afb-note")), "Quem enviou vê o status no próprio feedback e só pode anexar imagens enquanto ele está Novo ou Em análise. Os arquivados saem da lista padrão e continuam no filtro Status.");
  await choose(page, "RESOLVED");
  assert.deepEqual([await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isEnabled(), await described(page, "[data-fb-save]")], ["RESOLVED", true, ""]);
  assert.equal(await active(page), "select#fb-status-select Novo Em análise Resolvido Arquivado", "o seletor continua com o foco depois da escolha");
  const h = holdNext("status");
  await clickSave(page);
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#afb-op-status")), "Mudando o status para Resolvido…");
  assert.equal(await read(page.locator("#afb-op-status"), (l) => l.getAttribute("role")), "status");
  assert.match(await active(page), /^p#afb-op-status/, "o foco acompanha o andamento");
  assert.deepEqual(await page.evaluate(() => ["#fb-status-select", "[data-fb-save]"].map((s) => [document.querySelector(s).disabled, document.querySelector(s).getAttribute("aria-describedby"), document.querySelector(s).value ?? null])),
    [[true, "afb-op-status", "RESOLVED"], [true, "afb-op-status", ""]]);
  // O clique duplo (os cliques seguintes caem no botão parado) e um clique forçado no botão parado não mandam outro pedido.
  await page.locator("[data-fb-save]").dblclick({ force: true });
  await page.evaluate(() => { const b = document.querySelector("[data-fb-save]"); b.disabled = false; b.click(); });
  await grace(page);
  assert.deepEqual(control.posts.map((p) => [p.status, p.expectedStatus]), [["RESOLVED", "NEW"]], "um pedido só");
  assert.deepEqual(await notices(page), [], "nada de sucesso antes da resposta");
  // Clicar no botão parado leva o foco ao <main> (tabindex=-1, C7.1): ele volta ao andamento, onde estava.
  await page.locator("#afb-op-status").focus();
  await finish(page, h.gate);
  await noticed(page);
  assert.deepEqual(await notices(page), ["Status do feedback atualizado."]);
  assert.equal(await text(page.locator(".afb-state")), "Status: Resolvido desde 14 de outubro de 2026 às 10:00");
  assert.equal(await page.locator("#afb-op-status").count(), 0);
  assert.equal(await active(page), "select#fb-status-select Novo Em análise Resolvido Arquivado", "o foco volta ao seletor");
  assert.deepEqual([await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isDisabled()], ["RESOLVED", true], "o status salvo é o atual: nada a salvar");
  await page.locator("[data-fb-back]").click();
  await settle(page);
  assert.equal(await text(page.locator(".afb-row").first().locator(".fb-status")), "Resolvido", "a linha mostra o status novo");
  assert.deepEqual([errors, control.blocked], [[], []]);
  await context.close();
});

test("FB4: recusas (400, 403, 404, 429) — o erro junto da ação, com o foco, sem aviso solto; nada mudou, a escolha fica; 404 leva à lista atualizada; um pedido por tentativa, sem repetir sozinho", async () => {
  for (const [mode, message, consult] of [["400", "Status inválido.", false], ["403", "Você não tem acesso a esta operação.", false], ["404", "Feedback não encontrado.", true],
    ["429", "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.", false]]) {
    const { context, page, errors, control } = await ready(await open({ modes: { status: mode } }));
    await openDetail(page, "KC aparece como pendente");
    await choose(page, "IN_REVIEW");
    const answered = done(page, "/status");
    await clickSave(page);
    await answered; await page.waitForTimeout(80); await quiet(page);
    await grace(page);
    assert.equal(await text(page.locator("#afb-op-status")), `O status não foi alterado. ${message}${consult ? " Atualizar a lista" : ""}`, mode);
    assert.deepEqual([await read(page.locator("#afb-op-status"), (l) => l.getAttribute("role")), await active(page)], ["alert", `div#afb-op-status ${await text(page.locator("#afb-op-status"))}`], `${mode}: o erro recebe o foco`);
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso solto`);
    assert.deepEqual([await text(page.locator(".afb-state")), await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isEnabled()], ["Status: Novo", "IN_REVIEW", true], `${mode}: nada mudou; a escolha fica para tentar de novo`);
    assert.equal(control.posts.length, 1, `${mode}: um pedido, sem repetição automática`);
    if (consult) {
      const gets = control.gets.length;
      await page.locator("#afb-op-retry").click();
      await listed(page); await quiet(page);
      assert.equal(control.gets.length, gets + 1, "Atualizar a lista consulta a primeira página");
      assert.equal(await page.locator(".afb-detail").count(), 0, "volta à lista atualizada");
      assert.match(await active(page), /^button KC aparece como pendente/, "o foco vai à linha do feedback");
    }
    assert.deepEqual([errors, control.blocked], [[], []], mode);
    await context.close();
  }
});

test("FB5: 409 — a lista é relida em silêncio e o detalhe mostra o status do servidor; o erro fica junto da ação, com o foco e a consulta; a nova tentativa usa o status real", async () => {
  const { context, page, errors, control } = await ready(await open());
  await openDetail(page, "KC aparece como pendente");
  control.items[0].status = "IN_REVIEW";  // outra pessoa mudou
  await choose(page, "RESOLVED");
  const gets = control.gets.length, answered = done(page, "/status");
  await clickSave(page);
  await answered; await page.waitForTimeout(150); await quiet(page);
  await grace(page);
  assert.equal(control.gets.length, gets + 1, "uma releitura da lista para conhecer o status real");
  assert.equal(await text(page.locator("#afb-op-status")), "O status não foi alterado. O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo. Atualizar a lista");
  assert.match(await active(page), /^div#afb-op-status/);
  assert.deepEqual(await notices(page), [], "409 não vira aviso de sucesso nem aviso solto");
  assert.deepEqual([await text(page.locator(".afb-state")), await page.locator("#fb-status-select").inputValue()], ["Status: Em análise", "IN_REVIEW"], "o status e o seletor do servidor");
  await choose(page, "RESOLVED");
  const again = done(page, "/status");
  await clickSave(page);
  await again; await page.waitForTimeout(80); await quiet(page); await noticed(page);
  assert.deepEqual(control.posts.map((p) => [p.status, p.expectedStatus]), [["RESOLVED", "NEW"], ["RESOLVED", "IN_REVIEW"]]);
  assert.deepEqual(await notices(page), ["Status do feedback atualizado."]);
  assert.equal(await page.locator("#afb-op-status").count(), 0, "o sucesso tira o erro anterior");
  assert.deepEqual([errors, control.blocked], [[], []]);
  await context.close();
});

test("FB6: dúvida (rede, 5xx, resposta perdida) — dita como dúvida, com Atualizar a lista; a lista atualizada mostra o que de fato aconteceu, e o erro não volta ao reabrir", async () => {
  for (const [mode, message] of [["network", "A conexão com o portal falhou."], ["503", "O portal está temporariamente indisponível. Tente novamente em instantes."], ["lost", "A conexão com o portal falhou."]]) {
    const { context, page, errors, control } = await ready(await open({ modes: { status: mode } }));
    await openDetail(page, "KC aparece como pendente");
    await choose(page, "ARCHIVED");
    const answered = done(page, "/status");
    await clickSave(page);
    await answered; await page.waitForTimeout(80); await quiet(page);
    await grace(page);
    assert.equal(await text(page.locator("#afb-op-status")), `Não foi possível confirmar a mudança de status. ${message} O pedido pode ter sido concluído: atualize a lista antes de tentar de novo. Atualizar a lista`, mode);
    assert.match(await active(page), /^div#afb-op-status/, mode);
    assert.deepEqual([await notices(page), control.posts.length], [[], 1], `${mode}: sem aviso e sem repetir o pedido`);
    assert.equal(await text(page.locator(".afb-state")), "Status: Novo", `${mode}: a tela não afirma a mudança`);
    await page.locator("#afb-op-retry").click();
    await listed(page); await quiet(page);
    assert.match(await active(page), new RegExp(mode === "lost" ? "^h1" : "^button KC aparece como pendente"), `${mode}: o foco vai à linha (ou ao título, se ela saiu da lista)`);
    assert.equal(await page.locator(".afb-row", { hasText: "KC aparece como pendente" }).count(), mode === "lost" ? 0 : 1, `${mode}: arquivado de fato, sai da lista padrão`);
    if (mode === "lost") {
      assert.equal(await text(page.locator(".afb-summary [data-fb-status=ARCHIVED]")), "Arquivados 2", "o resumo relido mostra o arquivado");
    } else {
      await openDetail(page, "KC aparece como pendente");
      assert.equal(await page.locator("#afb-op-status").count(), 0, `${mode}: a lista relida começa sem o erro`);
      assert.deepEqual([await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isDisabled()], ["NEW", true], `${mode}: e sem a escolha de antes`);
    }
    assert.deepEqual([errors, control.blocked], [[], []], mode);
    await context.close();
  }
});

test("FB7: resumo e filtros — o resumo filtra por status (o ativo dito), os filtros consultam o backend com os parâmetros do contrato; caixa vazia × filtro sem resultado; o filtro escolhido fica com o foco", async () => {
  const { context, page, errors, control } = await ready(await open());
  assert.equal(await page.locator('.afb-summary [data-fb-status="NEW"]').count(), 1, "o atalho Novos no resumo do portal");
  await page.locator('.afb-summary [data-fb-status="NEW"]').click();
  await until(page, () => document.querySelectorAll(".afb-row").length === 2); await quiet(page);
  assert.deepEqual(control.gets.at(-1), { limit: "50", status: "NEW" });
  assert.deepEqual(await page.locator(".afb-summary [aria-pressed=true]").allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, " "))), ["Novos 2"]);
  assert.equal(await page.locator("#fb-filter-status").inputValue(), "NEW", "o seletor de status acompanha o resumo");
  assert.equal(await active(page), "button#afb-count-NEW Novos 2", "o foco fica no atalho escolhido");
  await page.locator("#fb-filter-type").focus();
  await page.locator("#fb-filter-type").selectOption("SUGGESTION");
  await until(page, () => !!document.querySelector(".afb-empty")); await quiet(page);
  assert.deepEqual(control.gets.at(-1), { limit: "50", status: "NEW", type: "SUGGESTION" });
  assert.equal(await text(page.locator(".afb-empty")), "Nenhum feedback neste filtro.");
  assert.deepEqual([await active(page), await page.locator("#fb-filter-type").inputValue()], ["select#fb-filter-type Todos os tipos Bug Sugestão Melhoria Outro", "SUGGESTION"], "o filtro fica escolhido e com o foco");
  await page.locator("#fb-filter-status").selectOption("ALL");
  await until(page, () => document.querySelectorAll(".afb-row").length === 2); await quiet(page);
  assert.deepEqual(await rowTitles(page), ["Mostrar a data da última atualização no painel", "Sugestão antiga já arquivada"], "inclusive arquivados");
  assert.equal(await page.locator(".afb-summary [aria-pressed=true]").count(), 0, "Todos, inclusive arquivados: nenhum atalho ativo");
  await page.locator("#fb-filter-type").selectOption("");
  await page.locator("#fb-filter-status").selectOption("");
  await page.locator("#fb-filter-cohort").selectOption("BRSA0268");
  await until(page, () => document.querySelectorAll(".afb-row").length === 1); await quiet(page);
  assert.deepEqual(control.gets.at(-1), { limit: "50", cohort: "BRSA0268" });
  assert.deepEqual(await rowTitles(page), ["Mostrar a data da última atualização no painel"]);
  assert.equal(await text(page.locator(".afb-summary")), "No portal inteiro Todos (sem arquivados) 4 Novos 2 Em análise 1 Resolvidos 1 Arquivados 1", "o resumo é do portal inteiro, não do filtro");
  await context.close();
  // Caixa vazia de verdade, e só com arquivados.
  for (const [set, message] of [["vazio", "Nenhum feedback recebido até agora."], ["arquivados", "Nenhum feedback fora os arquivados."]]) {
    const empty = await ready(await open({ set }));
    assert.equal(await text(empty.page.locator(".afb-empty")), message, set);
    await empty.context.close();
  }
  assert.deepEqual(errors, []);
});

test("FB8: muitos feedbacks — 50 por página e Carregar mais com o cursor; o erro do Carregar mais mantém os itens e a nova tentativa pede a mesma página, sem duplicar", async () => {
  const { context, page, errors, control } = await ready(await open({ set: "muitos" }));
  assert.equal(await page.locator(".afb-row").count(), 50);
  control.modes.more = "503";
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await until(page, () => !!document.querySelector(".afb-error")); await quiet(page);
  assert.equal(await page.locator(".afb-row").count(), 50, "os itens já carregados continuam");
  assert.equal(await text(page.locator(".afb-error")), "O portal está temporariamente indisponível. Tente novamente em instantes. Tentar novamente");
  const cursor = control.gets.at(-1).cursor;
  control.modes.more = "ok";
  await page.locator(".afb-error button").click();
  await until(page, () => document.querySelectorAll(".afb-row").length === 62); await quiet(page);
  assert.deepEqual([control.gets.at(-1).cursor, await page.locator(".afb-row").count()], [cursor, 62]);
  assert.equal(await active(page), "button Relato 51: sugestão de filtro", "sem mais páginas, o foco vai ao primeiro feedback que chegou");
  assert.equal(new Set(await page.locator(".afb-row .fb-open").evaluateAll((els) => els.map((el) => el.dataset.fbOpen))).size, 62, "sem duplicar");
  assert.equal(await page.getByRole("button", { name: "Carregar mais" }).count(), 0);
  // Densidade: as linhas, em média, sem a mensagem inteira (a de mensagem longa do mesmo tamanho das curtas, em até uma linha a mais).
  const heights = await page.locator(".afb-row").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 30, JSON.stringify([Math.min(...heights), Math.max(...heights)]));
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB9: a lista — carregando (sem números no resumo), falha com Tentar novamente, sem permissão (403) com a mensagem do servidor", async () => {
  const slow = await open({ modes: {} });
  await ready(slow);
  const h = slow.holdNext("list");
  await slow.page.getByRole("button", { name: "Feedbacks", exact: true }).click();
  await h.arrived.promise; await settle(slow.page);
  assert.equal(await text(slow.page.locator(".afb-loading")), "Carregando feedbacks…");
  assert.equal(await read(slow.page.locator(".afb-loading"), (l) => l.getAttribute("role")), "status");
  h.gate.resolve(); await listed(slow.page); await quiet(slow.page);
  await slow.context.close();
  const failing = await ready(await open({ modes: { list: "503" } }));
  assert.equal(await text(failing.page.locator(".afb-error")), "O portal está temporariamente indisponível. Tente novamente em instantes. Tentar novamente");
  assert.equal(await failing.page.locator(".afb-summary strong").count(), 0, "sem resumo, sem números");
  failing.control.modes.list = "ok";
  await failing.page.locator(".afb-error button").click();
  await until(failing.page, () => document.querySelectorAll(".afb-row").length === 4); await quiet(failing.page);
  assert.equal(await failing.page.locator(".afb-summary strong").count(), 5);
  await failing.context.close();
  const denied = await ready(await open({ modes: { list: "403" } }));
  assert.equal(await text(denied.page.locator(".afb-error")), "Você não tem acesso a esta operação. Tentar novamente");
  assert.equal(await denied.page.locator(".afb-row").count(), 0);
  await denied.context.close();
});

test("FB10: resposta antiga — a lista de um filtro anterior que chega depois não substitui a do filtro atual (C7.4)", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open());
  const h = holdNext("list", (q) => q.type === "BUG");
  await page.locator("#fb-filter-type").selectOption("BUG");
  await h.arrived.promise;
  await page.locator("#fb-filter-type").selectOption("SUGGESTION");
  await until(page, () => document.querySelectorAll(".afb-row").length === 1); await quiet(page);
  h.gate.resolve();
  await grace(page);
  assert.deepEqual(await rowTitles(page), ["Mostrar a data da última atualização no painel"]);
  assert.equal(await page.locator("#fb-filter-type").inputValue(), "SUGGESTION");
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB11: outra pessoa entra na aba durante a mudança de status — nada de quem saiu aparece: nem aviso, nem andamento, nem erro, nem a escolha", async () => {
  for (const mode of ["ok", "503"]) {
    const { context, page, errors, control, holdNext } = await ready(await open({ people: ["admin@example.test", "outra.admin@example.test"], modes: { status: mode } }));
    await openDetail(page, "KC aparece como pendente");
    await choose(page, "RESOLVED");
    const h = holdNext("status");
    await clickSave(page);
    await h.arrived.promise;
    // A troca: o boot depois de salvar as configurações da turma consulta o /me de novo, e quem responde é outra pessoa.
    await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await page.locator("#cohort-settings-form button").waitFor();
    await page.locator("#cohort-settings-form button").click();
    await until(page, () => document.querySelector(".topline")?.innerText.includes("outra.admin@example.test"));
    // Quem entrou abre o mesmo feedback com o pedido de quem saiu ainda pendente (o servidor fictício aplica ao receber, no "ok").
    await page.getByRole("button", { name: "Feedbacks", exact: true }).click();
    await listed(page); await quiet(page);
    await openDetail(page, "KC aparece como pendente");
    const current = mode === "ok" ? "RESOLVED" : "NEW";
    const clean = async (label) => assert.deepEqual([await page.locator("#afb-op-status").count(), await page.locator("#fb-status-select").isDisabled(),
      await page.locator("#fb-status-select").inputValue(), await described(page, "[data-fb-save]")], [0, false, current, "Escolha outro status para salvar."], `${mode}: ${label}`);
    await clean("com o pedido de quem saiu pendente, nem o andamento nem a escolha dele");
    // A resposta chega com quem entrou na lista (fora do detalhe): nem aviso solto, nem erro guardado para quando abrir.
    await page.locator("[data-fb-back]").click();
    await settle(page);
    const answered = done(page, "/status");
    h.gate.resolve();
    await answered;
    await grace(page);
    assert.deepEqual(await notices(page), [], `${mode}: o resultado de quem saiu não avisa quem entrou`);
    await openDetail(page, "KC aparece como pendente");
    await clean("depois da resposta, nem erro nem aviso");
    assert.deepEqual(errors, [], mode);
    await context.close();
  }
});

test("FB12: troca de feedback durante a carga das imagens — as imagens de um não aparecem no outro; a escolha de status de cada um fica no seu", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open());
  const h = holdNext("attachments");
  await page.locator(".fb-open", { hasText: "KC aparece como pendente" }).click();
  await h.arrived.promise;
  await choose(page, "RESOLVED");
  await page.locator("[data-fb-back]").click();
  await openDetail(page, "Mostrar a data");
  h.gate.resolve();
  await grace(page); await quiet(page);
  assert.equal(await text(page.locator("#fb-detail-title")), "Mostrar a data da última atualização no painel");
  assert.equal(await text(page.locator(".afb-attachments")), "Anexos Nenhuma imagem anexada.");
  assert.equal(await page.locator("#fb-status-select").inputValue(), "IN_REVIEW");
  await page.locator("[data-fb-back]").click();
  await openDetail(page, "KC aparece como pendente");
  assert.deepEqual([await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isEnabled()], ["RESOLVED", true], "a escolha feita antes continua no feedback dela");
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB13: conteúdo não confiável como texto — HTML, script, Markdown e links literais, sem elemento criado; Unicode e emoji; palavras sem espaço quebram sem rolagem lateral", async () => {
  for (const width of [1440, 390]) {
    const { context, page, errors } = await ready(await open({ set: "longos", width, height: width > 500 ? 900 : 844 }));
    assert.equal(await page.locator(".admin-feedback :is(script, b, img, a, iframe)").count(), 0, `${width}: nada do conteúdo vira elemento na lista`);
    assert.equal(await text(page.locator(".afb-row").nth(1).locator(".fb-open")), "Conteúdo com caracteres especiais <script>alert(1)</script> & “aspas” 🙂");
    assert.match(await text(page.locator(".afb-row").nth(1).locator(".afb-preview")), /^<b>negrito\?<\/b> \*\*markdown literal\*\* \[link\]\(https:\/\/exemplo\.example\/x\) https:\/\/exemplo\.example\/caminho\?a=1&b=2 <img src=x onerror=alert\(1\)> Acentuação/);
    await openDetail(page, "caracteres especiais");
    assert.equal(await page.locator(".fb-description").innerText(), SPECIAL);
    assert.equal(await page.locator(".afb-detail :is(script, b, iframe), .afb-detail .fb-description :is(a, img)").count(), 0, `${width}: o detalhe também`);
    await page.locator("[data-fb-back]").click();
    await openDetail(page, "Título extenso");
    assert.equal(await pageScroll(page), 0, `${width}: palavra sem espaço e e-mail extenso sem rolagem lateral`);
    assert.deepEqual(await clipped(page), [], `${width}: recortes`);
    assert.deepEqual(errors, [], String(width));
    await context.close();
  }
});

test("FB14: sem rolagem lateral nem controle escondido em 320–1440 px, texto a 200%, zoom a 200% e janela baixa, com textos extensos; no celular, a ação acima da barra inferior", async () => {
  for (const [width, height, text] of [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [390, 844, 2], [320, 568, 2], [720, 450, 1], [1280, 560, 1]]) {
    const label = `${width}x${height} texto ${text}`;
    const { context, page, errors } = await ready(await open({ width, height, text, set: "longos" }));
    for (const step of ["lista", "detalhe"]) {
      if (step === "detalhe") { await openDetail(page, "Título extenso"); await choose(page, "RESOLVED"); }
      const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")].map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.right > innerWidth + 0.5)
        .sort((x, y) => y[1].right - x[1].right).slice(0, 4).map(([el, r]) => `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, ".")} ${Math.round(r.right)}`));
      assert.equal(await pageScroll(page), 0, `${label} ${step}: rolagem lateral ${JSON.stringify(offenders)}`);
      assert.deepEqual(await clipped(page), [], `${label} ${step}: recortes`);
      if (step === "lista") {
        const lines = await page.locator(".afb-preview").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))));
        assert.ok(lines.length === 2 && lines.every((n) => n >= 1 && n <= 2), `${label}: o começo da mensagem em até duas linhas ${JSON.stringify(lines)}`);
      }
    }
    // A ação, levada à vista pelo teclado, fica acima da barra inferior (no celular) e livre.
    await page.locator("#fb-status-select").focus();
    await page.keyboard.press("Tab");
    assert.match(await active(page), /^button Salvar status/, label);
    const visible = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
      const bar = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight; return r.top >= 0 && r.bottom <= bar + 0.5; });
    assert.ok(visible, `${label}: Salvar status à vista`);
    assert.deepEqual(errors, [], label);
    await context.close();
  }
});

test("FB15: teclado — na lista, o resumo, os filtros e as linhas em ordem; no detalhe, voltar, as imagens, visualizar, o status e salvar; o contorno inteiro nos pixels, também no erro", async () => {
  const { context, page, errors, control } = await ready(await open({ modes: { status: "403" } }));
  // Cada parada do Tab, pelo começo do que o leitor de tela lê (o seletor lê todas as opções).
  const tabs = async (n) => { const seen = []; for (let i = 0; i < n; i++) { await page.keyboard.press("Tab"); seen.push(await active(page)); } return seen; };
  const prefixes = (seen, expected) => seen.map((s, i) => (expected[i] && s.startsWith(expected[i]) ? expected[i] : s));
  await page.locator("main h1").focus();
  const LIST = ["button#afb-count-all Todos (sem arquivados) 4", "button#afb-count-NEW Novos 2", "button#afb-count-IN_REVIEW Em análise 1", "button#afb-count-RESOLVED Resolvidos 1", "button#afb-count-ARCHIVED Arquivados 1",
    "select#fb-filter-status Todos (sem arquivados)", "select#fb-filter-type Todos os tipos", "select#fb-filter-cohort Todas as turmas", "button KC aparece como pendente depois da publicação",
    "button Mostrar a data da última atualização no painel", "button Lembretes em lote: texto da mensagem cortado no celular", "button Dúvida sobre o prazo do LAB 5"];
  assert.deepEqual(prefixes(await tabs(12), LIST), LIST);
  for (const selector of ['.afb-summary [data-fb-status="NEW"]', "#fb-filter-type", ".afb-row:nth-child(2) .fb-open"]) {
    await page.locator(selector).focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
    assert.deepEqual(await ringAround(page, selector), [], selector);
  }
  await page.locator(".afb-row:nth-child(1) .fb-open").press("Enter");
  await until(page, () => document.activeElement?.id === "fb-detail-title"); await quiet(page);
  await choose(page, "RESOLVED");
  await page.locator("#fb-detail-title").focus();
  const DETAIL = ["a Visualizar captura-da-tela.png (abre em nova aba)", "a Visualizar erro-no-celular.webp (abre em nova aba)", "button Visualizar como aluno",
    "select#fb-status-select Novo Em análise Resolvido Arquivado", "button Salvar status", "button Enviar feedback"];
  assert.deepEqual(prefixes(await tabs(6), DETAIL), DETAIL, "do título às imagens, a quem enviou, à ação e ao rodapé");
  await page.locator("[data-fb-back]").focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  assert.deepEqual(await ringAround(page, "[data-fb-back]"), [], "voltar");
  for (const selector of ["#fb-status-select", "[data-fb-save]"]) {
    await page.locator(selector).focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
    assert.deepEqual(await ringAround(page, selector), [], selector);
  }
  const answered = done(page, "/status");
  await page.locator("[data-fb-save]").press("Enter");
  await answered; await page.waitForTimeout(80); await quiet(page);
  assert.deepEqual(await ringAround(page, "#afb-op-status"), [], "o erro com o foco tem contorno");
  assert.deepEqual([errors, control.posts.length], [[], 1]);
  await context.close();
});

test("FB16: o status por texto e forma — anel (novo), anel meio cheio (em análise), visto verde-água (resolvido), traço (arquivado), como no Feedback do aluno; sem pílula colorida; ciano só nas ações", async () => {
  const { context, page, errors } = await ready(await open({ set: "padrao" }));
  await page.locator("#fb-filter-status").selectOption("ALL");
  await until(page, () => document.querySelectorAll(".afb-row").length === 5); await quiet(page);
  const text_ = await cssColor(page, "--color-text"), muted = await cssColor(page, "--color-text-muted"), success = await cssColor(page, "--color-success");
  // Linhas, na ordem dos dados: 1 novo, 2 em análise, 3 resolvido, 4 novo, 5 arquivado.
  const shapes = {};
  for (const [status, nth] of [["new", 1], ["in_review", 2], ["resolved", 3], ["archived", 5]]) shapes[status] = await shapeOf(page, `.afb-row:nth-child(${nth}) .afb-meta .fb-status`);
  assert.deepEqual(shapes, {
    new: { kind: "anel", color: text_, border: "sem borda", radius: "0px" }, in_review: { kind: "meio", color: text_, border: "sem borda", radius: "0px" },
    resolved: { kind: "visto", color: success, border: "sem borda", radius: "0px" }, archived: { kind: "traço", color: muted, border: "sem borda", radius: "0px" },
  });
  // Ciano (ação) só em botões, links e campos: nenhum texto nem borda visível de outra coisa na cor de ação.
  const action = await cssColor(page, "--color-action"), hover = await cssColor(page, "--color-action-hover");
  const cyan = await page.evaluate(([a, b]) => {
    const isCyan = (c) => c === a || c === b;
    const edge = (s, side) => s[`border${side}Style`] !== "none" && parseFloat(s[`border${side}Width`]) > 0 && isCyan(s[`border${side}Color`]);
    return [...document.querySelectorAll(".admin-feedback *")].filter((el) => !el.closest("button, a, select, label")).filter((el) => { const s = getComputedStyle(el);
      return isCyan(s.color) || ["Top", "Right", "Bottom", "Left"].some((side) => edge(s, side)); }).map((el) => `${el.tagName} ${el.className}`);
  }, [action, hover]);
  assert.deepEqual(cyan, [], "ciano só em ações");
  await openDetail(page, "Lembretes em lote");
  assert.equal((await shapeOf(page, ".afb-state .fb-status")).kind, "visto");
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB17: a escolha sobrevive ao redesenho (o fim da carga das imagens) e o andamento mostra o status pedido; Visualizar como aluno continua de onde estava", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open());
  const h = holdNext("attachments");
  await page.locator(".fb-open", { hasText: "KC aparece como pendente" }).click();
  await h.arrived.promise;
  await choose(page, "ARCHIVED");
  h.gate.resolve();
  await until(page, () => document.querySelectorAll(".afb-attachments img").length === 2); await quiet(page);
  assert.deepEqual([await page.locator("#fb-status-select").inputValue(), await page.locator("[data-fb-save]").isEnabled()], ["ARCHIVED", true], "o redesenho não devolve o seletor ao status atual");
  assert.equal(await active(page), "select#fb-status-select Novo Em análise Resolvido Arquivado");
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB18: andamento de um feedback com outro aberto — o outro também fica parado, com o andamento dizendo qual; no fim, livre, e o aviso uma vez só", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open());
  await openDetail(page, "KC aparece como pendente");
  await choose(page, "RESOLVED");
  const h = holdNext("status");
  await clickSave(page);
  await h.arrived.promise;
  await page.locator("[data-fb-back]").click();
  await openDetail(page, "Dúvida sobre o prazo");
  assert.equal(await text(page.locator("#afb-op-status")), "Mudando o status de “KC aparece como pendente depois da publicação” para Resolvido…");
  assert.deepEqual(await page.evaluate(() => ["#fb-status-select", "[data-fb-save]"].map((s) => [document.querySelector(s).disabled, document.querySelector(s).getAttribute("aria-describedby")])),
    [[true, "afb-op-status"], [true, "afb-op-status"]]);
  await page.evaluate(() => { const b = document.querySelector("[data-fb-save]"); b.disabled = false; b.click(); });
  await finish(page, h.gate);
  await noticed(page);
  assert.deepEqual([control.posts.length, await notices(page)], [1, ["Status do feedback atualizado."]]);
  assert.deepEqual([await page.locator("#afb-op-status").count(), await page.locator("#fb-status-select").isDisabled(), await text(page.locator("#fb-detail-title"))],
    [0, false, "Dúvida sobre o prazo do LAB 5"], "o feedback aberto continua aberto e livre");
  assert.deepEqual(errors, []);
  await context.close();
});

test("FB20: fora da tela — a falha de uma mudança com o detalhe já fechado vira o aviso do portal, como antes, sem erro guardado no feedback", async () => {
  const { context, page, errors, control, holdNext } = await ready(await open({ modes: { status: "403" } }));
  await openDetail(page, "KC aparece como pendente");
  await choose(page, "RESOLVED");
  const h = holdNext("status");
  await clickSave(page);
  await h.arrived.promise;
  await page.locator("[data-fb-back]").click();
  await settle(page);
  const answered = done(page, "/status");
  h.gate.resolve();
  await answered;
  await noticed(page);
  assert.deepEqual(await notices(page), ["Você não tem acesso a esta operação."]);
  await openDetail(page, "KC aparece como pendente");
  assert.equal(await page.locator("#afb-op-status").count(), 0, "o erro não fica guardado no feedback");
  assert.deepEqual([errors, control.posts.length], [[], 1]);
  await context.close();
});

test("FB19: papéis — instrutor não tem Feedbacks no menu nem a tela (o backend é quem autoriza); aluno também não", async () => {
  for (const role of ["instructor", "student"]) {
    const { context, page, errors, control } = await open({ role });
    await grace(page);
    assert.equal(await page.getByRole("button", { name: "Feedbacks", exact: true }).count(), 0, role);
    assert.equal(await page.locator(".admin-feedback").count(), 0, role);
    assert.equal(control.requests.filter((r) => r.includes("/admin/feedback")).length, 0, `${role}: nenhuma consulta à lista de admin`);
    assert.deepEqual(errors, [], role);
    await context.close();
  }
});

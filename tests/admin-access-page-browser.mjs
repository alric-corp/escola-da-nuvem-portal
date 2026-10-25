// Expansão 8 do piloto visual: Turmas e acessos (docs/design-visual.md), com API fictícia (nunca AWS, Cognito ou acesso real;
// dados sintéticos em domínios .example e .test). Cobre o que a tela promete: o escopo (portal inteiro × turma selecionada) e a
// turma identificada; as operações de antes (vincular, recusar, remover acesso, buscar, desvincular, nome, configurações e
// criar turma) com as mesmas chamadas, andamento junto do alvo e com o foco, tudo que muda parado e um pedido só; recusa e
// dúvida ditas de jeitos diferentes, com a consulta segura; as perguntas com a pessoa e a turma; troca de turma e de pessoa
// durante as operações; composição sem rolagem lateral nem controle escondido em 320–1440 px, texto e zoom a 200% e janela
// baixa, com nomes e e-mails extensos; teclado com contorno; estados, papéis e formas.
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

const COHORTS = [
  { code: "BRSA0267", name: "AWS re/Start · Turma 267", current: "pub-267", autoSync: true, canvasCourseId: "4436", thresholds: { kc: 70, lab: 95 } },
  { code: "BRSA0268", name: "AWS re/Start · Turma 268", current: null, autoSync: false, canvasCourseId: null },
];
const MANY = Array.from({ length: 14 }, (_, i) => ({ code: `BRSA02${50 + i}`, name: `AWS re/Start · Turma 2${50 + i}`, current: null }));
const REQUESTS = [
  { userId: "u-carla", email: "carla.dias@instituicao.example", status: "pending", createdAt: "2026-10-13T14:20:00Z" },
  { userId: "u-bruno", email: "bruno.reis@instituicao.example", status: "pending", createdAt: "2026-10-12T09:05:00Z" },
  { userId: "u-ana", email: "ana.lima@instituicao.example", status: "approved", createdAt: "2026-09-02T11:00:00Z" },
  { userId: "u-diego", email: "diego.melo@instituicao.example", status: "rejected", createdAt: "2026-09-20T16:40:00Z", rejectedAt: "2026-09-21T10:00:00Z" },
];
const INSTRUCTORS = { BRSA0267: [{ userId: "u-ana", email: "ana.lima@instituicao.example", code: "BRSA0267" }, { userId: "u-joao", email: "joao.paz@instituicao.example", code: "BRSA0267" }],
  BRSA0268: [{ userId: "u-eva", email: "eva.luz@instituicao.example", code: "BRSA0268" }] };
const STUDENTS = [
  { id: "31000", name: "Lia Mota", email: "lia.mota@example.test", bound: true, boundEmail: "lia.mota@example.test", boundAt: "2026-09-24T12:00:00Z" },
  { id: "31001", name: "Liam Duarte", email: "liam.duarte@example.test", bound: false, boundEmail: null, boundAt: null },
  { id: "31002", name: "Lis Prado", email: null, bound: false, boundEmail: null, boundAt: null },
];
const LONG = " de Albuquerque Cavalcanti Figueiredo Monteiro Nascimento";
const longEmail = (email) => email.replace("@", ".de.albuquerque.cavalcanti.figueiredo.monteiro.nascimento@");
const ERRORS = { 400: [400, "Informe o ID do curso Canvas para ligar a atualização automática."], 403: [403, "Você não tem acesso a esta operação."],
  404: [404, "Vínculo não encontrado."], 409: [409, "Os dados mudaram ou o registro já existe. Recarregue e tente novamente."], 503: [503, null] };
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

// control: modes por operação ("ok" | chave de ERRORS | "network": nada chega | "lost": o servidor aplica e a resposta se perde),
// holds por operação, confirm, dialogs, requests (log), people (sequência de /me) e os dados.
async function open({ width = 1440, height = 900, text = 1, role = "admin", people, cohorts = COHORTS, long = false, view = "access", requests = REQUESTS, loadMode = "ok", touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: touch });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-14T10:00:00-03:00"));
  const stretch = (s) => (long ? longEmail(s) : s);
  const control = { modes: { load: loadMode }, holds: {}, confirm: true, dialogs: [], requests: [], bodies: [], me: 0, people: people || [role === "admin" ? "admin@example.test" : "ana.lima@instituicao.example"],
    cohorts: structuredClone(cohorts).map((c) => (long ? { ...c, name: c.name + LONG } : c)), list: structuredClone(requests).map((r) => ({ ...r, email: stretch(r.email) })),
    instructors: Object.fromEntries(Object.entries(structuredClone(INSTRUCTORS)).map(([k, v]) => [k, v.map((i) => ({ ...i, email: stretch(i.email) }))])),
    students: structuredClone(STUDENTS).map((s) => (long ? { ...s, name: s.name + LONG, email: s.email && stretch(s.email), boundEmail: s.boundEmail && stretch(s.boundEmail) } : s)) };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return control.confirm ? dialog.accept() : dialog.dismiss(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view, code }) => {
    if (sessionStorage.getItem("e8")) return;
    sessionStorage.setItem("e8", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code, view }));
  }, { email: control.people[0], view, code: control.cohorts[0]?.code || "" });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const answer = async (route, op, apply, json) => {
    const mode = control.modes[op] || "ok";
    if (mode === "ok" || mode === "lost") apply?.();
    await hold(op);
    if (mode === "network" || mode === "lost") return route.abort("failed");
    if (ERRORS[mode]) { const [status, error] = ERRORS[mode]; return route.fulfill(error ? { status, json: { error } } : { status, contentType: "text/plain", body: "Service Unavailable" }); }
    return route.fulfill({ json: json() });
  };
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), method = request.method(), body = request.postData() ? request.postDataJSON() : null;
    control.requests.push(`${method} ${endpoint}`);
    if (method === "POST") control.bodies.push({ endpoint, body });
    if (endpoint === "/me") { const email = control.people[Math.min(control.me++, control.people.length - 1)]; return route.fulfill({ json: { email, roles: [role] } }); }
    if (endpoint === "/cohorts" && method === "GET") return route.fulfill({ json: { cohorts: (role === "admin" ? control.cohorts : control.cohorts.slice(0, 1)).map((c) => ({ ...c, canTeach: role !== "student" })) } });
    if (endpoint === "/cohorts") return answer(route, "create", () => control.cohorts.push({ code: body.code.toUpperCase(), name: body.name, current: null }), () => ({ code: body.code.toUpperCase() }));
    if (endpoint === "/requests") { await hold("load"); return control.modes.load === "ok" ? route.fulfill({ json: { requests: control.list } }) : answer(route, "load", null, () => ({})); }
    const reject = endpoint.match(/^\/requests\/([^/]+)\/reject$/);
    if (reject) return answer(route, "reject", () => { control.list = control.list.map((r) => (r.userId === reject[1] ? { ...r, status: "rejected" } : r)); }, () => ({ status: "rejected" }));
    const match = endpoint.match(/^\/cohorts\/([\w-]+)\/([a-z-]+)$/);
    if (match) {
      const [, code, op] = match;
      if (op === "report") return route.fulfill({ json: { cohort: code, publication: null, students: [], activities: [], history: [], thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null } } });
      if (op === "instructors" && method === "GET") { await hold("instructors"); return route.fulfill({ json: { instructors: control.instructors[code] || [] } }); }
      if (op === "instructors") return answer(route, "approve", () => {
        const r = control.list.find((x) => x.userId === body.userId);
        (control.instructors[code] ||= []).push({ userId: body.userId, email: r.email, code });
        control.list = control.list.map((x) => (x.userId === body.userId ? { ...x, status: "approved" } : x));
      }, () => ({ approved: true }));
      if (op === "revoke-instructor") return answer(route, "revoke", () => { control.instructors[code] = control.instructors[code].filter((i) => i.userId !== body.userId); }, () => ({ revoked: true }));
      if (op === "students-search") return answer(route, "search", null, () => ({ results: control.students.filter((s) => [s.name, s.email || "", s.id].some((h) => h.toLowerCase().includes(body.query.toLowerCase()))) }));
      if (op === "unlink-student") return answer(route, "unlink", () => { control.students = control.students.map((s) => (s.id === body.canvasId ? { ...s, bound: false, boundEmail: null, boundAt: null } : s)); }, () => ({ unlinked: true }));
      if (op === "display-name") return answer(route, "rename", () => { control.students = control.students.map((s) => (s.id === body.canvasId ? { ...s, name: body.displayName } : s)); }, () => body);
      if (op === "settings") return answer(route, "settings", () => { control.cohorts = control.cohorts.map((c) => (c.code === code ? { ...c, ...body } : c)); }, () => body);
    }
    if (endpoint === "/admin/feedback") return route.fulfill({ json: { items: [], nextCursor: null, summary: {} } });
    if (endpoint === "/feedback") return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin + "/");
  // Só depois do boot e sem pedido pendente; nada aqui depende da marcação da tela (no RED, a tela antiga falha por asserção).
  await page.locator(".layout").first().waitFor();
  await page.waitForLoadState("networkidle");
  await settle(page);
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
const closeNotice = async (page) => { if (await page.locator("#notices .notice button").count()) await page.locator("#notices .notice button").first().click(); };
const read = async (locator, fn = (l) => l.innerText()) => ((await locator.count()) ? fn(locator.first()) : null);
const text = async (locator) => ((await read(locator)) ?? "").replace(/\s+/g, " ").trim();
const soon = (locator, timeout = 3000) => locator.first().waitFor({ timeout }).catch(() => {});
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} ${(a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim()}`.trim(); });
const posts = (control, suffix) => control.requests.filter((r) => r.startsWith("POST ") && r.endsWith(suffix)).length;
const done = (page, suffix) => Promise.race([page.waitForResponse((r) => r.url().endsWith(suffix)), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith(suffix) })]).catch(() => null);
// Esperas por condição, com limite (5 s) e sem falhar: se a tela não chegar lá, a asserção seguinte falha dizendo o que viu (o
// tempo esgotado não é a evidência). Depois do carregamento inicial, waitForLoadState("networkidle") volta na hora; a condição
// real é a tela quieta: sem andamento de operação, sem carga dos acessos e sem busca em andamento.
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {}).then(() => settle(page));
const quiet = (page) => until(page, () => !document.querySelector("#aa-op-status.is-busy, #aa-load-status, .aa-students .aa-loading"));
const noticed = (page) => until(page, () => !!document.querySelector("#notices .notice"));
// O que não deve aparecer (aviso, andamento): a asserção vem depois de uma folga, para dar tempo a um aviso indevido.
const grace = (page) => page.waitForTimeout(300).then(() => settle(page));
// Depois de uma operação: a resposta e a tela quieta (as recargas terminaram).
async function finish(page, suffix, gate) {
  const answered = done(page, suffix);
  gate?.resolve();
  await answered;
  await page.waitForTimeout(80);
  await quiet(page);
}
const writeButtons = (page) => page.evaluate(() => [...document.querySelectorAll(".admin-access button")]
  .filter((b) => /data-(reject|revoke|unlink|start-edit-name)=/.test(b.outerHTML) || /^(Vincular à turma|Conceder acesso à turma|Salvar configurações|Criar turma|Salvar)$/.test(b.textContent.trim()))
  .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, describedby: b.getAttribute("aria-describedby") || "" })));
// Livre de operação e de carga: parado só com o motivo de Vincular sem turma (Expansão 8.1: escolher a turma; ou não haver turmas),
// nunca ligado ao andamento nem ao aviso de carregamento.
const free = (b) => !b.disabled || (/\baa-(no-cohorts|pick-)/.test(b.describedby) && !/aa-op-status|aa-load-status/.test(b.describedby));
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".admin-access :is(button, a, select, input, h1, h2, h3, .aa-email, .aa-name, .aa-status, dd, .aa-op, .aa-role)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
    if (el.matches("button") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 40)}`);
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
const shapeOf = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = getComputedStyle(el, "::before");
  return { check: b.borderRightStyle === "solid" && b.borderBottomStyle === "solid", ring: b.backgroundImage.startsWith("radial-gradient"), dash: b.borderTopStyle === "solid" && parseFloat(b.borderTopWidth) > 0 && b.borderRightStyle !== "solid" }; }, selector);
async function search(page, query) {
  await page.locator("#student-query").fill(query);
  const answered = done(page, "/students-search");
  await page.locator("#student-search-form button").click();
  await answered;
  await page.waitForTimeout(60);
  await quiet(page);
}

// Expansão 8.1: a pergunta de Vincular, a turma por código e nome, o botão Vincular do pedido e o que o leitor de tela lê com ele.
const approveQuestion = (email, label, code) => `Vincular ${email} à turma ${label}?\n\nA pessoa passa a acompanhar a ${code} com as permissões de instrutor: ver as notas de todos os alunos, publicar e restaurar notas, marcar desistências e enviar lembretes por e-mail aos alunos dessa turma. O acesso a outras turmas não muda.`;
const T267 = "BRSA0267 — AWS re/Start · Turma 267", T268 = "BRSA0268 — AWS re/Start · Turma 268";
const vincular = (page, user) => page.locator(`form[data-user="${user}"] button:not([type])`);
const described = (page, selector) => page.evaluate((s) => (document.querySelector(s)?.getAttribute("aria-describedby") || "").split(" ").filter(Boolean)
  .map((id) => document.getElementById(id)?.innerText.trim()).join(" | "), selector);
const forceSubmit = (page, user, value) => page.evaluate(([u, v]) => { const f = document.querySelector(`form[data-user="${u}"]`); if (v !== null) f.elements.cohort.value = v;
  f.querySelector("button:not([type])").disabled = false; f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }, [user, value]);

test("AB1: composição — solicitações (portal inteiro), a turma selecionada com código e nome (instrutores, alunos e contas, configurações) e criar turma por último; a turma é a única superfície", async () => {
  const { context, page, errors } = await open();
  await soon(page.locator(".admin-access"));
  const heads = await page.locator(".admin-access :is(h1, h2, h3)").allInnerTexts();
  assert.deepEqual(heads.map((h) => h.replace(/\s+/g, " ").trim()), ["Turmas e acessos", "Solicitações de acesso", "Turma BRSA0267", "Instrutores da BRSA0267", "Alunos e contas",
    "Configurações da BRSA0267", "Criar uma turma"]);
  assert.equal(await text(page.locator(".aa-cohort-head")), "Turma selecionada Turma BRSA0267 AWS re/Start · Turma 267 Instrutores, contas dos alunos e configurações valem só para esta turma. Para cuidar de outra, troque no seletor de turma.");
  const surfaces = await page.evaluate(() => [...document.querySelectorAll(".admin-access *")].filter((el) => { const s = getComputedStyle(el); return s.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(s.borderTopWidth) > 0 && !el.matches("button, select, input, .aa-op, .notice"); }).map((el) => el.className));
  assert.deepEqual(surfaces, ["aa-cohort-head"], "uma superfície só: a turma");
  // Troca de turma no seletor: a tela diz a outra turma e os instrutores dela.
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.getByRole("heading", { name: "Instrutores da BRSA0268", exact: true }).waitFor();
  await quiet(page);
  assert.equal(await text(page.locator("#aa-cohort-title")), "Turma BRSA0268");
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), ["eva.luz@instituicao.example"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB2: vincular — a turma do próprio formulário, andamento junto do pedido com o foco, tudo que muda parado e um pedido só; sucesso depois da resposta e da recarga, com a pessoa e a turma no aviso e o foco nas solicitações", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await page.locator("#approve-u-carla").selectOption("BRSA0268");
  await settle(page);
  assert.deepEqual([await page.locator("#approve-u-carla").inputValue(), await vincular(page, "u-carla").isDisabled()], ["BRSA0268", false], "a escolha fica e libera Vincular");
  const h = holdNext("approve");
  await page.locator('form[data-user="u-carla"] button', { hasText: "Vincular à turma" }).click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#aa-op-status")), "Vinculando carla.dias@instituicao.example à BRSA0268…");
  assert.equal(await read(page.locator("#aa-op-status"), (l) => l.getAttribute("role")), "status");
  assert.match(await active(page), /^p#aa-op-status/, "o foco acompanha o andamento");
  const parked = await writeButtons(page);
  assert.ok(parked.length >= 8 && parked.every((b) => b.disabled && b.describedby.split(" ").includes("aa-op-status")), JSON.stringify(parked));
  await page.locator('[data-reject="u-bruno"]').click({ force: true });
  assert.deepEqual([posts(control, "/instructors"), control.dialogs], [1, [approveQuestion("carla.dias@instituicao.example", T268, "BRSA0268")]], "um pedido só, depois da pergunta de Vincular; nada mais começa");
  await page.locator("#aa-op-status").focus();
  await finish(page, "/cohorts/BRSA0268/instructors", h.gate);
  assert.deepEqual(await notices(page), ["Acesso à BRSA0268 concedido a carla.dias@instituicao.example."]);
  assert.match(await active(page), /^h2#aa-requests-title/, "o foco vai às solicitações recarregadas");
  assert.equal(await page.locator('form[data-user="u-carla"]').count(), 0);
  assert.ok((await writeButtons(page)).every(free));
  // A turma escolhida no pedido continua escolhida quando a tela é refeita — por outra ação (a busca de alunos), durante o
  // andamento e depois de uma falha —, e uma nova tentativa vai para a mesma turma (o seletor não volta sozinho à primeira).
  await closeNotice(page);
  await page.locator("#approve-u-bruno").selectOption("BRSA0268");
  await search(page, "li");
  assert.equal(await page.locator("#approve-u-bruno").inputValue(), "BRSA0268", "a busca refaz a tela e a escolha continua");
  control.modes.approve = "503";
  const again = holdNext("approve");
  await page.locator('form[data-user="u-bruno"] button:not([type])').click();
  await again.arrived.promise; await settle(page);
  assert.equal(await page.locator("#approve-u-bruno").inputValue(), "BRSA0268", "durante o andamento, a escolha à vista é a do pedido");
  await finish(page, "/cohorts/BRSA0268/instructors", again.gate);
  assert.match(await text(page.locator("#aa-op-status")), /^Não foi possível confirmar o vínculo\./);
  assert.equal(await page.locator("#approve-u-bruno").inputValue(), "BRSA0268", "depois da falha, a escolha continua");
  control.modes.approve = "ok";
  await page.locator('form[data-user="u-bruno"] button:not([type])').click();
  await finish(page, "/cohorts/BRSA0268/instructors");
  assert.deepEqual(control.requests.filter((r) => /^POST \/cohorts\/[\w-]+\/instructors$/.test(r)),
    ["POST /cohorts/BRSA0268/instructors", "POST /cohorts/BRSA0268/instructors", "POST /cohorts/BRSA0268/instructors"], "cada tentativa vai para a turma escolhida");
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB3: recusar — a pergunta diz quem e o que acontece; cancelar não envia nem para nada; confirmar envia uma vez", async () => {
  const { context, page, errors, control } = await open();
  control.confirm = false;
  await page.locator('[data-reject="u-carla"]').click();
  await settle(page);
  assert.deepEqual(control.dialogs, ["Recusar a solicitação de carla.dias@instituicao.example?\n\nA pessoa não recebe acesso de instrutor. Esta tela não tem como reabrir uma solicitação recusada, e a pessoa não consegue pedir de novo."]);
  assert.equal(posts(control, "/reject"), 0);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "cancelar não mostra andamento");
  assert.equal(await active(page), "button Recusar", "cancelar deixa o foco onde estava");
  assert.ok((await writeButtons(page)).every(free));
  control.confirm = true;
  const answered = done(page, "/requests/u-carla/reject");
  await page.locator('[data-reject="u-carla"]').click();
  await answered;
  await quiet(page);
  assert.equal(posts(control, "/reject"), 1);
  assert.deepEqual(await notices(page), ["Solicitação de carla.dias@instituicao.example recusada."]);
  await page.locator("#requests-filter").selectOption("rejected");
  assert.match(await text(page.locator(".aa-request-list")), /carla\.dias@instituicao\.example Recusada/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB4: remover acesso — a pergunta com a pessoa, a turma e as consequências; recusa (403, 404) na linha, com o foco e sem aviso temporário; dúvida (rede, 503) com a consulta, que mostra a situação real; sucesso com a pessoa e a turma", async () => {
  const { context, page, errors, control } = await open();
  control.confirm = false;
  await page.locator('[data-revoke="u-ana"]').click();
  assert.deepEqual(control.dialogs, ["Remover o acesso de ana.lima@instituicao.example à BRSA0267?\n\nA pessoa deixa de acompanhar a BRSA0267; o acesso a outras turmas não muda. Se ela for quem envia os lembretes automáticos da BRSA0267, eles param até outro remetente ser configurado.\n\nSe já estiver aprovada no portal, você poderá conceder o vínculo novamente em Instrutores da turma."]);
  assert.equal(posts(control, "/revoke-instructor"), 0);
  control.confirm = true;
  for (const [mode, expected] of [["403", "O acesso não foi removido por este pedido. Você não tem acesso a esta operação."],
    ["404", "O acesso não foi removido por este pedido. Vínculo não encontrado. Atualizar a lista"]]) {
    control.modes.revoke = mode;
    const answered = done(page, "/revoke-instructor");
    await page.locator('[data-revoke="u-ana"]').click();
    await answered; await page.waitForTimeout(60); await quiet(page);
    assert.equal(await text(page.locator("#aa-op-status")), expected, mode);
    assert.equal(await read(page.locator("#aa-op-status"), (l) => l.getAttribute("role")), "alert");
    assert.match(await active(page), /^div#aa-op-status/, `${mode}: o foco vai ao erro`);
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso temporário`);
    assert.equal(await page.locator('[data-revoke="u-ana"]').count(), 1, `${mode}: a pessoa continua na lista`);
    assert.ok((await writeButtons(page)).every(free), `${mode}: tudo livre de novo`);
  }
  // Consultar: a lista recarrega e o erro sai.
  control.modes.revoke = "ok";
  await page.locator('#aa-op-status [data-action="refresh-requests"]').click();
  await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "a consulta apaga o erro");
  assert.match(await active(page), /^h3#aa-instructors-title/, "o foco volta ao título da seção de onde a consulta saiu");
  // Dúvida: o servidor removeu e a resposta se perdeu; a consulta mostra a lista sem a pessoa.
  control.modes.revoke = "lost";
  let answered = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-ana"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await text(page.locator("#aa-op-status")), "Não foi possível confirmar a remoção do acesso. A conexão com o portal falhou. O pedido pode ter sido concluído: atualize a lista antes de tentar de novo. Atualizar a lista");
  assert.deepEqual(await notices(page), []);
  await page.locator('#aa-op-status [data-action="refresh-requests"]').click();
  await quiet(page);
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), ["joao.paz@instituicao.example"], "a consulta mostra que foi removido");
  // 503 sem corpo: dúvida também.
  control.modes.revoke = "503";
  answered = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-joao"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.match(await text(page.locator("#aa-op-status")), /^Não foi possível confirmar a remoção do acesso\. O portal está temporariamente indisponível\. Tente novamente em instantes\. O pedido pode ter sido concluído/);
  // Sucesso: aviso com a pessoa e a turma; o foco nos instrutores.
  control.modes.revoke = "ok";
  answered = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-joao"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.deepEqual(await notices(page), ["Acesso de joao.paz@instituicao.example à BRSA0267 removido."]);
  assert.match(await active(page), /^h3#aa-instructors-title/);
  assert.equal(await text(page.locator(".aa-instructors .aa-empty")), "Nenhum instrutor vinculado à BRSA0267. Administradores têm acesso a todas as turmas.");
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB5: alunos e contas — a contagem anunciada com o foco; desvincular com a pergunta, a recusa e a dúvida na linha e a nova busca; editar o nome; busca vazia e busca recusada na tela", async () => {
  const { context, page, errors, control } = await open();
  await search(page, "li");
  assert.equal(await text(page.locator("#aa-students-count")), "3 alunos encontrados para “li”.");
  assert.match(await active(page), /^p#aa-students-count/, "o foco vai à contagem");
  assert.deepEqual((await page.locator(".aa-student-list .aa-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), [
    "Lia Mota ID Canvas 31000 E-mail no Canvas lia.mota@example.test Conta do portal lia.mota@example.test · desde 24 de setembro de 2026 Visualizar como aluno Editar nome Desvincular conta",
    "Liam Duarte ID Canvas 31001 E-mail no Canvas liam.duarte@example.test Conta do portal Sem conta vinculada Visualizar como aluno Editar nome",
    "Lis Prado ID Canvas 31002 E-mail no Canvas Ausente no Canvas Conta do portal Sem conta vinculada Visualizar como aluno Editar nome"]);
  control.confirm = false;
  await page.locator('[data-unlink="31000"]').click();
  assert.deepEqual(control.dialogs, ["Desvincular a conta lia.mota@example.test de Lia Mota (ID Canvas 31000) na BRSA0267?\n\nO aluno continua na turma, com as notas; só a conta do portal deixa de estar ligada a ele. Ele poderá se vincular de novo pelo e-mail do Canvas no próximo acesso."]);
  control.confirm = true;
  control.modes.unlink = "409";
  let answered = done(page, "/unlink-student");
  await page.locator('[data-unlink="31000"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await text(page.locator(".aa-student-list #aa-op-status")), "A conta não foi desvinculada por este pedido. Os dados mudaram ou o registro já existe. Recarregue e tente novamente. Buscar de novo");
  control.modes.unlink = "lost";
  answered = done(page, "/unlink-student");
  await page.locator('[data-unlink="31000"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.match(await text(page.locator("#aa-op-status")), /^Não foi possível confirmar o desvínculo\. A conexão com o portal falhou\. O pedido pode ter sido concluído: busque de novo antes de tentar outra vez\. Buscar de novo$/);
  answered = done(page, "/students-search");
  await page.locator('#aa-op-status [data-action="repeat-student-search"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "a nova busca apaga o erro");
  assert.match(await text(page.locator(".aa-student-list .aa-row").first()), /Conta do portal Sem conta vinculada/, "a nova busca mostra que foi desvinculada");
  assert.match(await active(page), /^p#aa-students-count/);
  // Editar o nome.
  await page.locator('[data-start-edit-name="31001"]').click();
  await page.locator("#edit-name-31001").fill("Liam D.");
  answered = done(page, "/display-name");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.deepEqual(await notices(page), ["“Liam D.” é o novo nome de exibição."], "sem pontuação dobrada quando o nome termina em ponto");
  assert.match(await text(page.locator(".aa-student-list")), /Liam D\. ID Canvas 31001/);
  assert.match(await active(page), /^p#aa-students-count/, "o foco vai à contagem da nova busca");
  await closeNotice(page);
  // Nome só com espaços: recusado antes do pedido, com o aviso de sempre; nada sai e nada fica em andamento.
  const sent = posts(control, "/display-name");
  await page.locator('[data-start-edit-name="31001"]').click();
  await page.locator("#edit-name-31001").fill("   ");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await settle(page);
  assert.deepEqual([await notices(page), posts(control, "/display-name"), await page.locator("#aa-op-status").count()], [["Informe um nome."], sent, 0]);
  await closeNotice(page);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  // Busca vazia: o problema na tela, sem pedido; busca recusada pelo servidor também.
  const before = control.requests.length;
  await page.locator("#student-query").fill("   ");
  await page.locator("#student-search-form button").click();
  await settle(page);
  assert.equal(await text(page.locator("#aa-students-count")), "Digite ao menos um caractere para buscar.");
  assert.equal(control.requests.length, before);
  assert.deepEqual(await notices(page).then((n) => n.filter((x) => !/novo nome de exibição/.test(x))), [], "sem aviso temporário");
  control.modes.search = "409";
  await search(page, "li");
  assert.equal(await read(page.locator("#aa-students-count"), (l) => l.getAttribute("role")), "alert");
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB6: configurações e criar turma — recusa e dúvida na própria seção, com o foco; sucesso com a recarga do portal, a turma nova no seletor e o foco na seção", async () => {
  const { context, page, errors, control } = await open();
  control.modes.settings = "400";
  let answered = done(page, "/settings");
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await text(page.locator(".aa-settings #aa-op-status")), "As configurações não foram salvas. Informe o ID do curso Canvas para ligar a atualização automática.");
  assert.match(await active(page), /^div#aa-op-status/);
  control.modes.settings = "network";
  answered = done(page, "/settings");
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.match(await text(page.locator(".aa-settings #aa-op-status")), /^Não foi possível confirmar se as configurações foram salvas\. A conexão com o portal falhou\. O pedido pode ter sido concluído: consulte de novo antes de tentar outra vez\. Consultar de novo$/);
  // Consultar de novo: o portal relido (a espera é pela última leitura do boot), o erro sai e o foco vai ao título da seção (o
  // botão some).
  let reread = done(page, "/cohorts/BRSA0267/instructors");
  await page.getByRole("button", { name: "Consultar de novo", exact: true }).click();
  await reread; await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "a consulta apaga o erro");
  assert.match(await active(page), /^h3#aa-settings-title/, "o foco vai às configurações");
  control.modes.settings = "ok";
  await page.locator('#cohort-settings-form input[name="kc"]').fill("65");
  answered = done(page, "/settings");
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await answered; await page.waitForTimeout(80); await quiet(page);
  assert.deepEqual(await notices(page), ["Configurações da turma atualizadas."]);
  assert.match(await active(page), /^h3#aa-settings-title/);
  assert.equal(await page.locator('#cohort-settings-form input[name="kc"]').inputValue(), "65");
  await closeNotice(page);
  // Criar turma: 409 (código existente) e sucesso.
  control.modes.create = "409";
  await page.getByLabel("Código da turma").fill("BRSA0267");
  await page.getByLabel("Nome da turma").fill("Repetida");
  answered = done(page, "/api/cohorts");
  await page.getByRole("button", { name: "Criar turma" }).click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await text(page.locator(".aa-create #aa-op-status")), "A turma não foi criada. Os dados mudaram ou o registro já existe. Recarregue e tente novamente. Consultar de novo");
  reread = done(page, "/cohorts/BRSA0267/instructors");
  await page.getByRole("button", { name: "Consultar de novo", exact: true }).click();
  await reread; await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "a consulta apaga o erro");
  assert.match(await active(page), /^h2#aa-create-title/, "o foco vai a Criar uma turma");
  control.modes.create = "ok";
  await page.getByLabel("Código da turma").fill("brsa0299");
  await page.getByLabel("Nome da turma").fill("Turma de teste");
  answered = done(page, "/api/cohorts");
  await page.getByRole("button", { name: "Criar turma" }).click();
  await answered; await page.waitForTimeout(80); await quiet(page);
  assert.deepEqual(await notices(page), ["Turma BRSA0299 criada."]);
  assert.equal(await page.locator('#cohort option[value="BRSA0299"]').count(), 1);
  assert.match(await active(page), /^h2#aa-create-title/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB7: troca de turma e de pessoa durante as operações — nada de andamento, erro ou sucesso de uma na tela da outra; com outra turma, o aviso diz a turma da operação", async () => {
  // Turma: a remoção da BRSA0267 termina com a BRSA0268 na tela — e a mesma pessoa também acompanha a BRSA0268: o andamento
  // não aparece na linha dela na outra turma (nem com a turma da tela no texto), e as ações da outra turma ficam livres.
  const { context, page, errors, control, holdNext } = await open();
  control.instructors.BRSA0268.push({ userId: "u-ana", email: "ana.lima@instituicao.example", code: "BRSA0268" });
  let h = holdNext("revoke");
  await page.locator('[data-revoke="u-ana"]').click();
  await h.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.getByRole("heading", { name: "Instrutores da BRSA0268", exact: true }).waitFor();
  await quiet(page);
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), ["eva.luz@instituicao.example", "ana.lima@instituicao.example"]);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "a outra turma não mostra o andamento");
  assert.ok((await writeButtons(page)).every(free), "a operação da outra turma não para as ações desta");
  await finish(page, "/revoke-instructor", h.gate);
  await noticed(page);
  assert.deepEqual(await notices(page), ["Acesso de ana.lima@instituicao.example à BRSA0267 removido."]);
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), ["eva.luz@instituicao.example", "ana.lima@instituicao.example"], "a lista é da turma na tela");
  await closeNotice(page);
  // Turma: o erro da BRSA0268 não fica para a BRSA0267.
  control.modes.revoke = "403";
  const answered = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-eva"]').click();
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 1);
  await page.locator("#cohort").selectOption("BRSA0267");
  await page.getByRole("heading", { name: "Instrutores da BRSA0267", exact: true }).waitFor();
  await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0, "o erro fica na turma em que aconteceu");
  // Turma: a recusa da BRSA0267 chega com a BRSA0268 na tela — o aviso do portal diz o motivo; na tela da outra turma, nada.
  h = holdNext("revoke");
  await page.locator('[data-revoke="u-joao"]').click();
  await h.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.getByRole("heading", { name: "Instrutores da BRSA0268", exact: true }).waitFor();
  await finish(page, "/revoke-instructor", h.gate);
  await noticed(page);
  assert.deepEqual([await notices(page), await page.locator("#aa-op-status").count()], [["Você não tem acesso a esta operação."], 0]);
  assert.deepEqual(errors, []);
  await context.close();
  // Pessoa: durante uma operação a tela para tudo que muda, então a troca chega pela outra aba (a sessão é a mesma); a criação
  // de turma relê a conta (/me) e encontra outra pessoa: o sucesso de quem pediu não aparece para quem entrou, nem andamento.
  const two = await open({ people: ["admin@example.test", "outra.admin@example.test"] });
  await two.page.locator("#approve-u-carla").selectOption("BRSA0268");
  h = two.holdNext("create");
  await two.page.getByLabel("Código da turma").fill("BRSA0299");
  await two.page.getByLabel("Nome da turma").fill("Turma de teste");
  await two.page.getByRole("button", { name: "Criar turma" }).click();
  await h.arrived.promise;
  await settle(two.page);
  assert.equal(await text(two.page.locator("#aa-op-status")), "Criando a turma BRSA0299…");
  // A recarga do portal já é de quem entrou (a carga dos acessos fica presa): o andamento de quem saiu não aparece para ela.
  const reload = two.holdNext("load");
  const created = done(two.page, "/api/cohorts");
  h.gate.resolve();
  await created; await reload.arrived.promise; await settle(two.page);
  assert.ok((await text(two.page.locator(".topline"))).includes("outra.admin@example.test"), "quem entrou já está na tela");
  assert.equal(await two.page.locator("#aa-op-status").count(), 0, "sem o andamento de quem saiu");
  await finish(two.page, "/requests", reload.gate);
  await grace(two.page);
  assert.equal(two.control.me, 2, "o /me foi lido de novo");
  assert.deepEqual(await notices(two.page), [], "o sucesso de quem saiu não aparece para quem entrou");
  assert.equal(await two.page.locator("#aa-op-status").count(), 0);
  assert.ok((await text(two.page.locator(".topline"))).includes("outra.admin@example.test"), "quem entrou está na tela");
  assert.equal(await two.page.locator("#approve-u-carla").inputValue(), "", "a turma escolhida por quem saiu não fica para quem entrou (nenhuma escolhida)");
  await forceSubmit(two.page, "u-carla", "BRSA0268");
  await settle(two.page);
  assert.deepEqual([posts(two.control, "/instructors"), two.control.dialogs], [0, []], "a escolha de quem saiu não vale nem forçando o envio");
  assert.deepEqual(two.errors, []);
  await two.context.close();
  // Pessoa: o mesmo com as configurações salvas — sem o aviso de sucesso de quem saiu e sem andamento.
  const three = await open({ people: ["admin@example.test", "outra.admin@example.test"] });
  h = three.holdNext("settings");
  await three.page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await h.arrived.promise;
  await settle(three.page);
  assert.equal(await text(three.page.locator("#aa-op-status")), "Salvando as configurações da BRSA0267…");
  const rebooted = done(three.page, "/cohorts/BRSA0267/instructors");
  await finish(three.page, "/settings", h.gate);
  await rebooted; await quiet(three.page); await grace(three.page);
  assert.equal(three.control.me, 2, "o /me foi lido de novo");
  assert.deepEqual([await notices(three.page), await three.page.locator("#aa-op-status").count()], [[], 0]);
  assert.ok((await text(three.page.locator(".topline"))).includes("outra.admin@example.test"));
  assert.deepEqual(three.errors, []);
  await three.context.close();
});

test("AB8: sem rolagem lateral nem controle escondido em 320–1440 px, texto a 200% e 250%, zoom a 200% e janela baixa, com nomes, e-mails e turma extensos; ações à vista", async () => {
  for (const [width, height, text] of [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [390, 844, 2], [320, 568, 2.5],
    [1440, 900, 2], [720, 450, 1], [1280, 560, 1]]) {
    const { context, page, errors } = await open({ width, height, text, long: true });
    await search(page, "li");
    await page.locator('[data-start-edit-name="31001"]').click();
    await settle(page);
    const label = `${width}x${height} texto ${text}`;
    // Na falha, os elementos que passam da janela (os mais à direita primeiro).
    const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")].map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.right > innerWidth + 0.5)
      .sort((x, y) => y[1].right - x[1].right).slice(0, 4).map(([el, r]) => `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, ".")} ${Math.round(r.right)}: ${(el.textContent || "").trim().slice(0, 40)}`));
    assert.equal(await pageScroll(page), 0, `${label}: rolagem lateral ${JSON.stringify(offenders)}`);
    assert.deepEqual(await clipped(page), [], `${label}: recortes`);
    assert.equal(await page.locator(".admin-access table, .admin-access .table-scroll").count(), 0, `${label}: sem tabela que role para o lado`);
    assert.deepEqual(errors, [], label);
    await context.close();
  }
});

test("AB9: teclado na ordem da tarefa, com o contorno inteiro nos pixels (também nas ações de consequência e no erro); no celular, nada atrás da barra inferior", async () => {
  const { context, page, errors, control } = await open();
  await search(page, "li");
  await page.locator("#approve-u-carla").selectOption("BRSA0268");
  await settle(page);
  assert.equal(await page.locator("#aa-requests-title").count(), 1, "o título das solicitações, ponto de partida do teclado");
  await page.locator("#aa-requests-title").focus();
  const order = [];
  for (let i = 0; i < 18; i++) { await page.keyboard.press("Tab"); order.push((await active(page)).replace(/ .*/, (m) => m.slice(0, 26))); }
  const ids = order.join(" | ");
  for (const [a, b] of [["select#requests-filter", "button Atualizar"], ["select#approve-u-carla", "button Vincular à turma"], ["button Vincular à turma", "button Recusar"],
    ["button Recusar", "select#approve-u-bruno"], ["button Remover acesso", "input#student-query"], ["input#student-query", "button Buscar"]])
    assert.ok(ids.indexOf(a) >= 0 && ids.indexOf(a) < ids.indexOf(b), `${a} antes de ${b}: ${ids}`);
  for (const selector of ['form[data-user="u-carla"] button:not([type])', '[data-reject="u-carla"]', '[data-revoke="u-ana"]', '[data-unlink="31000"]', "#student-search-form button",
    "#cohort-settings-form button"]) {
    await page.locator(selector).focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
    assert.deepEqual(await ringAround(page, selector), [], selector);
  }
  control.modes.revoke = "403";
  const answered = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-ana"]').press("Enter");
  await answered; await page.waitForTimeout(60); await quiet(page);
  assert.deepEqual(await ringAround(page, "#aa-op-status"), [], "o erro com o foco tem contorno");
  await context.close();
  for (const [w, hgt, txt] of [[390, 844, 1], [390, 844, 2]]) {
    const small = await open({ width: w, height: hgt, text: txt });
    for (const selector of ['[data-revoke="u-joao"]', "#cohort-settings-form button", "#cohort-form button"]) {
      await small.page.locator(selector).focus();
      await small.page.keyboard.press("Shift+Tab"); await small.page.keyboard.press("Tab");
      const visible = await small.page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const nav = document.querySelector(".sidebar nav");
        const bar = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight; return r.top >= 0 && r.bottom <= bar; }, selector);
      assert.ok(visible, `${w} texto ${txt}: ${selector} acima da barra`);
    }
    await small.context.close();
  }
  assert.deepEqual(errors, []);
});

test("AB10: estados — carregando e erro na própria seção; na carga, campos e ações que mudam algo param, ligados ao aviso, e o que se digita não some; no erro, as outras seções continuam, com Tentar novamente; sem turmas, Vincular parado com o motivo; muitas turmas; filtro e busca sem resultado", async () => {
  const slow = await open({ loadMode: "ok" });
  const h = slow.holdNext("load");
  await slow.page.locator('[data-action="refresh-requests"]').first().click();
  await h.arrived.promise; await settle(slow.page);
  assert.equal(await text(slow.page.locator(".aa-requests .aa-loading")), "Carregando solicitações e instrutores…");
  assert.equal(await text(slow.page.locator(".aa-instructors .aa-note:not(.aa-instructors-note)")), "Carregando os instrutores…");
  assert.equal(await slow.page.locator("#student-search-form").count(), 1, "a busca continua na tela");
  // Cada controle na carga: parado ou não e a descrição que o leitor de tela lê com ele.
  const parked = await slow.page.evaluate(() => Object.fromEntries(["#student-query", "#student-search-form button", "#cohort-settings-form [name=kc]", "#cohort-settings-form button",
    "#cohort-form [name=code]", "#cohort-form button", "#requests-filter", '[data-action="refresh-requests"]'].map((s) => { const el = document.querySelector(s);
    return [s, el && [el.disabled, (el.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.innerText.trim()).join(" | ")]]; })));
  // Digitar na busca durante a carga: o que o campo aceitar continua nele depois do fim da carga (antes desta correção, o campo
  // aceitava o texto e o fim da carga o apagava; parado, ele não aceita, e nada some).
  await slow.page.locator("#student-query").evaluate((el) => el.focus());
  await slow.page.keyboard.type("li");
  const during = await slow.page.locator("#student-query").inputValue();
  h.gate.resolve(); await quiet(slow.page);
  assert.equal(await slow.page.locator("#student-query").inputValue(), during, "o que o campo aceitou durante a carga continua nele");
  assert.equal(await active(slow.page), "button Atualizar", "Atualizar, que continua na tela, fica com o foco");
  await slow.page.locator("#student-query").fill("li");
  const LOADING = "Carregando solicitações e instrutores…";
  assert.deepEqual(parked, {
    "#student-query": [true, LOADING], "#student-search-form button": [true, LOADING], "#cohort-settings-form [name=kc]": [true, LOADING], "#cohort-settings-form button": [true, LOADING],
    "#cohort-form [name=code]": [true, `Letras, números e hífen, de 3 a 32; o código fica em maiúsculas. | ${LOADING}`], "#cohort-form button": [true, LOADING],
    "#requests-filter": [false, ""], '[data-action="refresh-requests"]': [false, ""],
  });
  // Depois da carga, nada parado por ela: só Vincular sem turma escolhida (Expansão 8.1), com o motivo de escolher.
  const after = await slow.page.evaluate(() => [...document.querySelectorAll(".admin-access :disabled")].map((el) => `${el.textContent.trim()} | ${el.getAttribute("aria-describedby") || ""}`));
  assert.ok(after.length === 2 && after.every((x) => /^Vincular à turma \| aa-req-u-\w+ aa-pick-u-\w+$/.test(x)), `depois da carga, nada parado: ${JSON.stringify(after)}`);
  await slow.page.locator("#student-query").press("Enter");
  await quiet(slow.page);
  assert.equal(await text(slow.page.locator("#aa-students-count")), "3 alunos encontrados para “li”.");
  await slow.context.close();
  const failed = await open({ loadMode: "503" });
  assert.match(await text(failed.page.getByRole("alert").filter({ hasText: "Não foi possível carregar os acessos" })), /Tentar novamente$/);
  assert.equal(await text(failed.page.locator(".aa-instructors .aa-note:not(.aa-instructors-note)")), "Os instrutores não foram carregados.");
  assert.equal(await failed.page.getByText("Nenhum instrutor vinculado", { exact: false }).count(), 0, "sem lista vazia falsa");
  failed.control.modes.load = "ok";
  await failed.page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await quiet(failed.page);
  assert.equal(await failed.page.locator(".aa-request-list .aa-row").count(), 2);
  assert.match(await active(failed.page), /^h2#aa-requests-title/, "o botão do erro some e o foco vai ao título da seção");
  await failed.context.close();
  // Sem nenhuma turma, o boot leva ao primeiro acesso (como antes); a tela vem pelo menu.
  const none = await open({ cohorts: [] });
  await none.page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
  await quiet(none.page);
  assert.equal(await text(none.page.locator("#aa-cohort-title")), "Nenhuma turma no portal");
  assert.equal(await read(none.page.locator('form[data-user="u-carla"] button:not([type])'), (l) => l.isDisabled()), true);
  assert.equal(await text(none.page.locator("#aa-no-cohorts")), "Crie uma turma antes de vincular instrutores.");
  await none.context.close();
  const many = await open({ cohorts: MANY });
  // As 14 turmas e, antes delas, "Selecione uma turma" (Expansão 8.1), sem nenhuma escolhida.
  assert.deepEqual([await many.page.locator("#approve-u-carla option").count(), await many.page.locator("#approve-u-carla option").first().innerText(),
    await many.page.locator("#approve-u-carla").inputValue()], [15, "Selecione uma turma", ""]);
  assert.equal(await text(many.page.locator("#aa-cohort-title")), "Turma BRSA0250");
  await many.page.locator("#requests-filter").selectOption("rejected");
  assert.match(await text(many.page.locator(".aa-request-list")), /diego\.melo/);
  await search(many.page, "zz");
  assert.equal(await text(many.page.locator("#aa-students-count")), "Nenhum aluno encontrado com esses termos.");
  await many.context.close();
});

test("AB11: papéis — só o admin tem a tela e os controles; instrutor e aluno não veem Turmas e acessos, nem pelo contexto salvo", async () => {
  for (const role of ["instructor", "student"]) {
    const { context, page, errors, control } = await open({ role });
    assert.equal(await page.getByRole("button", { name: "Turmas e acessos" }).count(), 0, role);
    assert.equal(await page.locator(".admin-access, [data-revoke], [data-reject], #cohort-form").count(), 0, role);
    assert.equal(await page.getByRole("link", { name: /^Criar turma/ }).count(), 0, `${role}: sem o atalho Criar turma`);
    assert.equal(control.requests.filter((r) => /\/requests|\/instructors/.test(r)).length, 0, `${role}: nenhuma leitura de acessos`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("AB12: formas e ênfases — situação da solicitação por texto e forma (anel, visto, traço); as ações de consequência em vermelho, diferentes das de consulta e das que concedem", async () => {
  const { context, page, errors } = await open();
  await page.locator("#requests-filter").selectOption("all");
  await settle(page);
  assert.ok((await shapeOf(page, ".aa-status.is-attention"))?.ring, "pendente: anel");
  assert.ok((await shapeOf(page, ".aa-status.is-ok"))?.check, "aprovada: visto");
  assert.ok((await shapeOf(page, ".aa-status.is-off"))?.dash, "recusada: traço");
  const colors = await page.evaluate(() => {
    const css = (s) => { const el = document.querySelector(s), st = getComputedStyle(el); return { color: st.color, border: st.borderTopColor }; };
    const danger = getComputedStyle(document.documentElement).getPropertyValue("--color-danger").trim();
    return { reject: css('[data-reject="u-carla"]'), revoke: css('[data-revoke="u-ana"]'), link: css('form[data-user="u-carla"] button:not([type])'), refresh: css('[data-action="refresh-requests"]'), danger };
  });
  const red = await page.evaluate((hex) => { const d = document.createElement("div"); d.style.color = hex; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, colors.danger);
  assert.equal(colors.reject.color, red);
  assert.equal(colors.reject.border, red);
  assert.equal(colors.revoke.color, red);
  assert.notEqual(colors.link.color, red);
  assert.notEqual(colors.refresh.color, red);
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB13: Vincular com a turma escolhida (Expansão 8.1) — começa sem turma (nem a primeira), Vincular parado com o motivo; nenhum pedido sem escolha válida, nem forçando o envio; a escolha libera; a pergunta diz a pessoa e a turma; cancelar não envia; trocar a escolha muda o alvo da pergunta; confirmar (também com clique duplo) envia um pedido só, com a turma confirmada", async () => {
  const { context, page, errors, control } = await open();
  assert.equal(await page.locator("#approve-u-carla").inputValue(), "", "nenhuma turma escolhida");
  assert.equal(await page.locator("#approve-u-carla option:checked").innerText(), "Selecione uma turma");
  assert.equal(await vincular(page, "u-carla").isDisabled(), true);
  assert.equal(await described(page, 'form[data-user="u-carla"] button:not([type])'), "carla.dias@instituicao.example | Escolha a turma para vincular.");
  // O botão parado não é a única proteção: envio forçado sem escolha, ou com o valor trocado sem escolher, não pergunta nem envia —
  // mesmo com uma escolha da sessão em outro pedido (a de bruno não vale para carla).
  await page.locator("#approve-u-bruno").selectOption("BRSA0267");
  await settle(page);
  await forceSubmit(page, "u-carla", null);
  await forceSubmit(page, "u-carla", "BRSA0268");
  await settle(page);
  assert.deepEqual([posts(control, "/instructors"), control.dialogs], [0, []], "sem escolha, nem pergunta nem pedido");
  await page.locator("#approve-u-carla").selectOption("BRSA0268");
  await settle(page);
  assert.deepEqual([await vincular(page, "u-carla").isDisabled(), await described(page, 'form[data-user="u-carla"] button:not([type])')], [false, "carla.dias@instituicao.example"]);
  control.confirm = false;
  await vincular(page, "u-carla").click();
  await settle(page);
  assert.deepEqual(control.dialogs, [approveQuestion("carla.dias@instituicao.example", T268, "BRSA0268")]);
  assert.deepEqual([posts(control, "/instructors"), await page.locator("#approve-u-carla").inputValue(), await active(page)], [0, "BRSA0268", "button Vincular à turma"], "cancelar: nenhum pedido, a escolha e o foco ficam");
  await page.locator("#approve-u-carla").selectOption("BRSA0267");
  await vincular(page, "u-carla").click();
  await settle(page);
  assert.deepEqual([control.dialogs[1], posts(control, "/instructors")], [approveQuestion("carla.dias@instituicao.example", T267, "BRSA0267"), 0], "a pergunta segue a escolha nova");
  // "Selecione uma turma" desfaz a escolha: Vincular para de novo, com o motivo; escolher outra vez libera.
  await page.locator("#approve-u-carla").selectOption("");
  await settle(page);
  assert.deepEqual([await vincular(page, "u-carla").isDisabled(), await described(page, 'form[data-user="u-carla"] button:not([type])')], [true, "carla.dias@instituicao.example | Escolha a turma para vincular."]);
  await page.locator("#approve-u-carla").selectOption("BRSA0267");
  await settle(page);
  control.confirm = true;
  const answered = done(page, "/cohorts/BRSA0267/instructors");
  await vincular(page, "u-carla").dblclick();
  await answered; await page.waitForTimeout(80); await quiet(page);
  await noticed(page);
  assert.equal(control.dialogs.length, 3, "uma pergunta para o clique duplo");
  assert.deepEqual(control.bodies.filter((b) => b.endpoint.endsWith("/instructors")), [{ endpoint: "/cohorts/BRSA0267/instructors", body: { userId: "u-carla" } }], "um pedido, com a turma e a pessoa da pergunta");
  assert.deepEqual(await notices(page), ["Acesso à BRSA0267 concedido a carla.dias@instituicao.example."]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB14: a escolha fica com o pedido certo (Expansão 8.1) — não passa a outro pedido; resiste ao redesenho, à resposta antiga da carga e à lista de turmas relida; falha de rede sem sucesso falso, com a consulta segura e a escolha mantida", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await page.locator("#approve-u-carla").selectOption("BRSA0268");
  await settle(page);
  assert.equal(await page.locator("#approve-u-bruno").inputValue(), "", "a escolha de um pedido não vale para outro");
  // Outra operação em andamento (Recusar bruno, recusada pelo servidor; resposta retida): nem o envio forçado de Vincular sai.
  control.modes.reject = "403";
  const other = holdNext("reject");
  await page.locator('[data-reject="u-bruno"]').click();
  await other.arrived.promise;
  await forceSubmit(page, "u-carla", null);
  await settle(page);
  assert.deepEqual([posts(control, "/instructors"), control.dialogs.length], [0, 1], "durante outra operação, Vincular não pergunta nem envia");
  await finish(page, "/requests/u-bruno/reject", other.gate);
  control.modes.reject = "ok";
  const picks = async () => [await page.locator("#approve-u-carla").inputValue(), await page.locator("#approve-u-bruno").inputValue()];
  await search(page, "li");
  assert.deepEqual(await picks(), ["BRSA0268", ""], "o redesenho mantém a escolha");
  // Resposta antiga: a primeira carga fica presa, a segunda termina, a primeira chega por último e é descartada.
  const stale = holdNext("load");
  await page.locator('[data-action="refresh-requests"]').first().click();
  await stale.arrived.promise;
  await page.locator('[data-action="refresh-requests"]').first().click();
  await quiet(page);
  stale.gate.resolve();
  await page.waitForTimeout(150); await settle(page);
  assert.deepEqual(await picks(), ["BRSA0268", ""], "a resposta antiga não troca a escolha");
  // Lista de turmas relida (a criação relê o portal): a escolha válida fica; quem não escolheu continua sem turma.
  await page.getByLabel("Código da turma").fill("BRSA0299");
  await page.getByLabel("Nome da turma").fill("Turma de teste");
  const reread = done(page, "/cohorts/BRSA0267/instructors");
  await page.getByRole("button", { name: "Criar turma", exact: true }).click();
  await reread; await page.waitForTimeout(80); await quiet(page);
  assert.equal(await page.locator('#approve-u-carla option[value="BRSA0299"]').count(), 1, "a lista nova chegou");
  assert.deepEqual(await picks(), ["BRSA0268", ""], "a lista relida não escolhe por ninguém");
  await closeNotice(page);
  // Falha de rede: nada de sucesso; a dúvida, com a consulta segura; a escolha fica para uma nova tentativa.
  control.modes.approve = "network";
  const failed = done(page, "/cohorts/BRSA0268/instructors");
  await vincular(page, "u-carla").click();
  await failed; await page.waitForTimeout(80); await quiet(page);
  assert.equal(await text(page.locator("#aa-op-status")), "Não foi possível confirmar o vínculo. A conexão com o portal falhou. O pedido pode ter sido concluído: atualize a lista antes de tentar de novo. Atualizar a lista");
  assert.deepEqual([await notices(page), await page.locator("#approve-u-carla").inputValue()], [[], "BRSA0268"], "sem sucesso falso; a escolha fica");
  assert.deepEqual(errors, []);
  await context.close();
});

test("AB15: atalho Criar turma (Expansão 8.1) — leva o foco e a vista ao título de Criar uma turma, por mouse, toque e teclado, sem pedido, sem outro formulário e sem apagar o que foi digitado; com lista longa, em 1440, 390 e 320 px e com texto a 200%", async () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ userId: `u-p${i}`, email: `pessoa${i}@instituicao.example`, status: "pending", createdAt: "2026-10-10T12:00:00Z" }));
  for (const [width, height, text, how] of [[1440, 900, 1, "mouse"], [390, 844, 1, "toque"], [390, 844, 2, "teclado"], [320, 640, 2, "teclado"], [320, 640, 1, "mouse"]]) {
    const { context, page, errors, control } = await open({ width, height, text, requests: [...REQUESTS, ...many], touch: how === "toque" });
    const label = `${width} texto ${text} ${how}`;
    const link = page.getByRole("link", { name: /^Criar turma/ });
    assert.equal(await link.count(), 1, `${label}: um atalho`);
    assert.equal(await link.getAttribute("href"), "#aa-create-title", label);
    await page.locator("#student-query").fill("li");
    await page.getByLabel("Código da turma").fill("BRSA0299");
    const before = control.requests.length;
    if (how === "teclado") {
      await page.locator("main h1").focus();
      await page.keyboard.press("Tab");
      assert.match(await active(page), /^a Criar turma/, `${label}: o atalho logo depois do título da página`);
      await page.keyboard.press("Enter");
    } else if (how === "toque") await link.tap();
    else await link.click();
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), "aa-create-title", `${label}: o foco chega ao título`);
    const seen = await page.evaluate(() => { const r = document.querySelector("#aa-create-title").getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
      const bar = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight; return r.top >= 0 && r.bottom <= bar; });
    assert.ok(seen, `${label}: o título à vista, acima da barra inferior`);
    assert.equal(control.requests.length, before, `${label}: nenhum pedido`);
    assert.deepEqual([await page.locator("#cohort-form").count(), await page.locator(".aa-create").count()], [1, 1], `${label}: o formulário de sempre, um só`);
    assert.deepEqual([await page.locator("#student-query").inputValue(), await page.getByLabel("Código da turma").inputValue()], ["li", "BRSA0299"], `${label}: nada apagado`);
    assert.equal(await pageScroll(page), 0, `${label}: sem rolagem lateral`);
    assert.deepEqual(errors, [], label);
    await context.close();
  }
});

// ---------------------------------------------------------------- PR #3 (fechamento, B3)

// A busca de alunos guardava a pessoa pelo objeto state.me, que todo boot() troca (salvar configurações, criar turma,
// "Consultar de novo"): a resposta que chegava depois era descartada e "Buscando…" ficava para sempre, com o Buscar parado.
// A troca de turma também deixava o andamento da busca da turma anterior na turma nova. A resposta de outra turma continua
// descartada.
test("PR3-B3: busca de alunos com recarga do portal ou troca de turma no meio — nunca fica em 'Buscando…'; a resposta vale para a mesma pessoa e turma e é descartada em outra turma", async () => {
  // Recarga do portal (salvar configurações) com a mesma pessoa e a mesma turma: a resposta continua valendo.
  let { context, page, errors, control, holdNext } = await open();
  let h = holdNext("search");
  await page.locator("#student-query").fill("li");
  await page.locator("#student-search-form button").click();
  await h.arrived.promise;
  const saved = done(page, "/settings");
  await page.locator("#cohort-settings-form button[type=submit]").click();
  await saved;
  await noticed(page);
  assert.deepEqual(await notices(page), ["Configurações da turma atualizadas."], "recarga: as configurações foram salvas no meio da busca");
  let answered = done(page, "/students-search");
  h.gate.resolve();
  await answered; await grace(page);
  assert.equal(await page.locator(".aa-students .aa-loading").count(), 0, "recarga: 'Buscando…' termina");
  assert.equal(await text(page.locator("#aa-students-count")), "3 alunos encontrados para “li”.", "recarga: o resultado da mesma pessoa e da mesma turma aparece");
  assert.equal(await page.locator("#student-search-form button").isDisabled(), false, "recarga: Buscar livre");
  assert.equal(control.requests.filter((r) => r.endsWith("/students-search")).length, 1, "recarga: nenhuma busca repetida");
  assert.deepEqual(errors, []);
  await context.close();
  // Troca de turma no meio: a turma nova não fica em "Buscando…", e a resposta da BRSA0267 não aparece nela.
  ({ context, page, errors, control, holdNext } = await open());
  h = holdNext("search");
  await page.locator("#student-query").fill("li");
  await page.locator("#student-search-form button").click();
  await h.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0268");
  await until(page, () => /BRSA0268/.test(document.querySelector(".admin-access")?.textContent || "") && !document.querySelector("#aa-load-status"));
  assert.equal(await page.locator(".aa-students .aa-loading").count(), 0, "troca de turma: nada de 'Buscando…' na turma nova");
  answered = done(page, "/students-search");
  h.gate.resolve();
  await answered; await grace(page);
  assert.equal(await page.locator(".aa-students .aa-loading, .aa-student-list, #aa-students-count").count(), 0, "troca de turma: a resposta da BRSA0267 é descartada");
  assert.equal(await page.locator("#student-search-form button").isDisabled(), false, "troca de turma: Buscar livre");
  assert.equal(await page.locator("#student-query").inputValue(), "", "troca de turma: a busca começa vazia na turma nova");
  assert.deepEqual(errors, []);
  await context.close();
  // Recarga do portal e busca recusada: a recusa aparece na seção, sem ficar em "Buscando…".
  ({ context, page, errors, control, holdNext } = await open());
  control.modes.search = 403;
  h = holdNext("search");
  await page.locator("#student-query").fill("li");
  await page.locator("#student-search-form button").click();
  await h.arrived.promise;
  await page.locator("#cohort-settings-form button[type=submit]").click();
  await noticed(page);
  answered = done(page, "/students-search");
  h.gate.resolve();
  await answered; await grace(page);
  assert.equal(await page.locator(".aa-students .aa-loading").count(), 0, "recusa: 'Buscando…' termina");
  assert.equal(await text(page.locator("#aa-students-count")), ERRORS[403][1], "recusa: o motivo aparece na seção");
  assert.equal(await page.locator("#student-search-form button").isDisabled(), false, "recusa: Buscar livre");
  assert.deepEqual(errors, []);
  await context.close();
  // Outra pessoa entra na aba durante a busca (o boot depois de salvar responde com outra pessoa): a resposta é descartada e a
  // seção não fica em "Buscando…".
  ({ context, page, errors, control, holdNext } = await open({ people: ["admin@example.test", "outra.admin@example.test"] }));
  h = holdNext("search");
  await page.locator("#student-query").fill("li");
  await page.locator("#student-search-form button").click();
  await h.arrived.promise;
  await page.locator("#cohort-settings-form button[type=submit]").click();
  await until(page, () => document.querySelector(".topline")?.innerText.includes("outra.admin@example.test"));
  answered = done(page, "/students-search");
  h.gate.resolve();
  await answered; await grace(page);
  assert.match(await text(page.locator(".topline")), /outra\.admin@example\.test/, "outra pessoa: a sessão é a da pessoa nova");
  assert.equal(await page.locator(".aa-students .aa-loading").count(), 0, "outra pessoa: 'Buscando…' termina");
  assert.equal(await page.locator(".aa-student-list, #aa-students-count").count(), 0, "outra pessoa: a resposta da busca anterior é descartada");
  assert.equal(await page.locator("#student-search-form button").isDisabled(), false, "outra pessoa: Buscar livre");
  assert.deepEqual(errors, []);
  await context.close();
});

const linkQuestion = (email, label) => `Conceder acesso de instrutor a ${email} na turma ${label}?\n\nA pessoa poderá ver as notas dos alunos, publicar e restaurar notas, marcar desistências e enviar lembretes por e-mail nesta turma. Os vínculos com outras turmas e a configuração dos lembretes automáticos não mudam.`;
const grant = (page) => page.locator("#approved-instructor-form button[type=submit]");
async function chooseApproved(page, code = "BRSA0268") {
  await page.locator("#cohort").selectOption(code);
  await quiet(page);
  await page.getByLabel("Instrutor já aprovado", { exact: true }).selectOption("u-ana");
  await settle(page);
}

test("TODO28: vínculo adicional e reconcessão são explícitos, sem duplicata ou repetição por clique duplo", async () => {
  const { context, page, errors, control, holdNext } = await open();
  assert.equal(await page.locator("#approved-instructor-form").count(), 0, "Ana já vinculada à A não é oferecida de novo");
  await page.locator("#cohort").selectOption("BRSA0268");
  await quiet(page);
  assert.deepEqual(await page.locator("#approved-instructor option").evaluateAll((options) => options.map((o) => o.value)), ["", "u-ana"], "somente aprovada; pendente e recusado não viram concessão posterior");
  assert.equal(await grant(page).isDisabled(), true);
  assert.match(await described(page, "#approved-instructor-form button"), /Escolha um instrutor já aprovado/);
  await page.getByLabel("Instrutor já aprovado", { exact: true }).selectOption("u-ana");
  await settle(page);
  await search(page, "li");
  assert.equal(await page.locator("#approved-instructor").inputValue(), "u-ana", "outra leitura não perde a escolha");
  control.confirm = false;
  await grant(page).click();
  await settle(page);
  assert.equal(posts(control, "/instructors"), 0, "cancelar não envia");
  assert.deepEqual(control.dialogs, [linkQuestion(REQUESTS[2].email, T268)]);
  control.confirm = true;
  const h = holdNext("approve");
  await grant(page).click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#aa-op-status")), `Vinculando ${REQUESTS[2].email} à BRSA0268…`);
  assert.match(await active(page), /^p#aa-op-status/);
  assert.ok((await writeButtons(page)).every((b) => b.disabled), "escritas ficam paradas enquanto aguarda a resposta");
  // Envio sintético defensivo do mesmo formulário, apesar do botão disabled: a barreira não depende apenas do DOM.
  await page.locator("#approved-instructor-form").evaluate((f) => f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle(page);
  assert.equal(posts(control, "/instructors"), 1);
  await finish(page, "/cohorts/BRSA0268/instructors", h.gate);
  assert.deepEqual(await notices(page), [`Acesso à BRSA0268 concedido a ${REQUESTS[2].email}.`]);
  assert.deepEqual(control.bodies.filter((r) => r.endpoint.endsWith("/instructors")), [{ endpoint: "/cohorts/BRSA0268/instructors", body: { userId: "u-ana" } }]);
  assert.equal(await page.locator("#approved-instructor-form").count(), 0, "a lista recarregada não permite duplicar");
  assert.match(await active(page), /^h3#aa-instructors-title/);
  assert.deepEqual(control.instructors.BRSA0267.map((i) => i.userId), ["u-ana", "u-joao"], "vínculo com A preservado");
  await closeNotice(page);
  // Remover não concede nada de novo; só uma nova escolha e confirmação podem restabelecer o vínculo.
  const revoked = done(page, "/revoke-instructor");
  await page.locator('[data-revoke="u-ana"]').click();
  await revoked; await quiet(page);
  assert.equal(await page.locator("#approved-instructor").inputValue(), "");
  assert.equal(await grant(page).isDisabled(), true);
  assert.equal(posts(control, "/instructors"), 1);
  await closeNotice(page);
  await page.getByLabel("Instrutor já aprovado", { exact: true }).selectOption("u-ana");
  await settle(page);
  const regranted = done(page, "/cohorts/BRSA0268/instructors");
  await grant(page).click();
  await regranted; await quiet(page);
  assert.equal(posts(control, "/instructors"), 2);
  assert.equal(control.dialogs.filter((d) => d === linkQuestion(REQUESTS[2].email, T268)).length, 3, "cancelamento, concessão e reconcessão têm confirmação própria");
  assert.equal(control.instructors.BRSA0268.filter((i) => i.userId === "u-ana").length, 1);
  assert.equal(control.requests.filter((r) => /settings|sender|reminder/.test(r)).length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("TODO28: recusa, conflito e resposta incerta preservam pessoa/turma; atualizar a lista nunca repete a concessão", async () => {
  for (const mode of ["403", "409", "503", "network", "lost"]) {
    const { context, page, errors, control } = await open();
    await chooseApproved(page);
    control.modes.approve = mode;
    const answered = done(page, "/cohorts/BRSA0268/instructors");
    await grant(page).click();
    await answered; await quiet(page);
    const unsure = ["503", "network", "lost"].includes(mode);
    assert.match(await text(page.locator("#aa-op-status")), unsure
      ? /Não foi possível confirmar o vínculo de ana\.lima@instituicao\.example à BRSA0268/
      : /O vínculo de ana\.lima@instituicao\.example à BRSA0268 não foi feito/, mode);
    assert.equal(await page.locator("#aa-op-status").getAttribute("role"), "alert");
    assert.equal(await page.locator("#approved-instructor").inputValue(), "u-ana", "falha não troca pessoa nem turma escolhida");
    assert.equal(posts(control, "/instructors"), 1);
    assert.deepEqual(await notices(page), []);
    assert.equal(await page.locator("#aa-op-retry").count(), mode === "403" ? 0 : 1);
    if (mode !== "403") {
      const refreshed = done(page, "/requests");
      await page.locator("#aa-op-retry").click();
      await refreshed; await quiet(page);
      assert.equal(posts(control, "/instructors"), 1, `${mode}: consulta segura, sem repetir POST`);
      assert.equal(await page.locator("#aa-op-status").count(), 0);
      assert.equal(await page.locator("#approved-instructor-form").count(), mode === "lost" ? 0 : 1, "resposta perdida é reconciliada pela lista atual");
      assert.match(await active(page), /^h3#aa-instructors-title/);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("TODO28: concessão iniciada em B não muda a lista de A nem empresta sua escolha à outra sessão", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await chooseApproved(page);
  const h = holdNext("approve");
  await grant(page).click();
  await h.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0267");
  await quiet(page);
  assert.equal(await page.locator("#aa-op-status").count(), 0);
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), [REQUESTS[2].email, "joao.paz@instituicao.example"]);
  await finish(page, "/cohorts/BRSA0268/instructors", h.gate);
  assert.deepEqual(await page.locator(".aa-instructors .aa-email").allInnerTexts(), [REQUESTS[2].email, "joao.paz@instituicao.example"]);
  assert.deepEqual(await notices(page), [`Acesso à BRSA0268 concedido a ${REQUESTS[2].email}.`]);
  assert.equal(posts(control, "/instructors"), 1);
  await context.close();
  // Injeção somente no fixture: reproduz a troca de identidade no mesmo documento enquanto o POST está em voo.
  // A volta ao mesmo e-mail usa outro objeto de sessão, não pode reutilizar seleção/erro/recarga anteriores (A→B→A).
  for (const mode of ["ok", "503"]) {
    const next = await open();
    await chooseApproved(next.page);
    next.control.modes.approve = mode;
    const pending = next.holdNext("approve");
    await grant(next.page).click();
    await pending.arrived.promise;
    const before = next.control.requests.length;
    await next.page.evaluate(async () => {
      const { state } = await import("/state.js");
      const previous = state.me;
      state.me = { email: "outra.admin@example.test", roles: ["admin"] };
      state.me = { ...previous };
      document.getElementById("requests-filter").dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await next.page.locator("#aa-op-status").count(), 0, "andamento pertence à sessão anterior");
    if (mode !== "ok") {
      assert.equal(await next.page.locator("#approved-instructor").inputValue(), "", "outra sessão começa sem a escolha anterior");
      assert.equal(await grant(next.page).isDisabled(), true);
    }
    await finish(next.page, "/cohorts/BRSA0268/instructors", pending.gate);
    assert.equal(next.control.requests.length, before, "resposta antiga não recarrega a lista da nova sessão");
    assert.deepEqual(await notices(next.page), [], "sem sucesso ou erro emprestado à outra sessão");
    assert.equal(await next.page.locator("#aa-op-status").count(), 0);
    assert.deepEqual(next.errors, []);
    await next.context.close();
  }
  assert.deepEqual(errors, []);
});

test("TODO28: após selecionar o instrutor, Tab/Shift+Tab e Enter preservam o vínculo legível em desktop e 320px com texto 200%", async () => {
  for (const [width, textSize] of [[1440, 1], [320, 2]]) {
    const { context, page, errors, control } = await open({ width, text: textSize, long: true });
    await page.locator("#cohort").selectOption("BRSA0268");
    await quiet(page);
    const field = page.getByLabel("Instrutor já aprovado", { exact: true });
    // A seleção é arranjada pela API do select: ArrowDown/Enter podem abrir ou confirmar a popup conforme o sistema.
    // O que exercitamos por teclado aqui é a ordem de foco do formulário e a confirmação por Enter, com a popup fechada.
    await field.selectOption("u-ana");
    await settle(page);
    await field.focus();
    assert.equal(await field.inputValue(), "u-ana", "a escolha permanece depois do render");
    assert.equal(await grant(page).isDisabled(), false, "a escolha válida habilita a concessão");
    assert.equal(await field.evaluate((el) => el.matches(":open")), false, "arranjo: popup nativa fechada antes de Tab");
    assert.match(await active(page), /^select#approved-instructor /);
    await page.keyboard.press("Tab");
    assert.match(await active(page), /^button Conceder acesso à turma$/);
    await page.keyboard.press("Shift+Tab");
    assert.match(await active(page), /^select#approved-instructor /, "a volta chega ao seletor");
    await page.keyboard.press("Tab");
    assert.match(await active(page), /^button Conceder acesso à turma$/, "a ordem do formulário é previsível nas duas direções");
    assert.deepEqual(await ringAround(page, "#approved-instructor-form button"), [], "foco ciano inteiro visível");
    assert.equal(await pageScroll(page), 0);
    assert.deepEqual(await clipped(page), []);
    control.confirm = false;
    await page.keyboard.press("Enter");
    await settle(page);
    assert.equal(posts(control, "/instructors"), 0);
    assert.deepEqual(control.dialogs, [linkQuestion(longEmail(REQUESTS[2].email), `${T268}${LONG}`)]);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("TODO28 modo aluno: conceder em andamento não recarrega acessos nem mostra resultado administrativo na visualização", async () => {
  for (const mode of ["ok", "503"]) {
    const { context, page, errors, control, holdNext } = await open({ cohorts: [COHORTS[0], { ...COHORTS[1], current: "pub-268" }] });
    await context.route("**/api/cohorts/BRSA0268/student-view", (route) => route.fulfill({ json: {
      cohort: "BRSA0268", publication: { id: "pub-268", publishedAt: "2026-10-13T14:00:00Z" },
      updatedAt: "2026-10-13T14:00:00Z", thresholds: { kc: 70, lab: 95 }, history: [],
      student: { id: "31000", name: "Lia Mota", kc: null, lab: null, total: null, progress: 0, pending: 0, completed: 0, status: "attention", activities: [] },
      viewAs: { studentId: "31000", name: "Lia Mota" },
    } }));
    await chooseApproved(page);
    await search(page, "li");
    control.modes.approve = mode;
    const h = holdNext("approve");
    await grant(page).click();
    await h.arrived.promise;
    await page.locator('[data-view-as-student="31000"]').click();
    await until(page, () => !!document.querySelector(".student-view-banner") && !document.querySelector(".student-home.is-loading"));
    assert.match(await text(page.locator("main")), /Lia/);
    assert.equal(await page.locator(".admin-access").count(), 0);
    const requests = control.requests.length, main = await text(page.locator("main"));
    await finish(page, "/cohorts/BRSA0268/instructors", h.gate);
    assert.equal(control.requests.length, requests, `${mode}: nenhuma recarga administrativa depois da mudança de modo`);
    assert.deepEqual(await notices(page), [], `${mode}: nem sucesso nem erro administrativo aparece ao visualizar aluno`);
    assert.equal(await text(page.locator("main")), main, "a resposta não troca a tela nem rouba o foco/contexto do aluno");
    assert.equal(posts(control, "/instructors"), 1, "a operação recebida no servidor não é desfeita nem repetida");
    assert.deepEqual(errors, []);
    await context.close();
  }
});

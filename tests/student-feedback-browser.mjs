// Expansão 3 do piloto visual: Feedback do aluno (docs/design-visual.md), com API e S3 fictícios na mesma origem
// (nunca AWS, Cognito ou Canvas; toda chamada externa é abortada). Cobre o que a tela promete: escopo (só o aluno;
// instrutor e admin continuam na tela antiga), tipos com explicação, regras junto dos campos, problemas de validação
// junto do campo (todos de uma vez, sem enviar), estados de envio, foco que não se perde, "Meus feedbacks" com a
// mensagem, a situação (texto e forma) e quando ela mudou, anexos, estados da lista, texto a 200%, zoom, teclado e
// contorno de foco lido nos pixels, sem rolagem lateral nem controle recortado.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
// C3: compacidade (altura dos tipos) medida com tipografia de referência — Arial, que tem as mesmas métricas da Liberation
// Sans do Linux —, igual em toda plataforma. Transbordamento, recorte e legibilidade continuam com a fonte do sistema (F6, C6).
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

// Feedbacks no formato de backend/feedback.py::own_view. updatedAt só difere de createdAt quando a equipe mudou o status.
const item = (n, extra = {}) => ({ id: `20261001T12000000000${n}-0000000${n}`.slice(0, 30), type: "BUG", title: `Relato ${n}`, description: `Descrição do relato ${n}.`,
  status: "NEW", createdAt: `2026-09-${String(28 - (n % 20)).padStart(2, "0")}T15:00:00Z`, cohort: "BRSA0267", page: "activities", updatedAt: `2026-09-${String(28 - (n % 20)).padStart(2, "0")}T15:00:00Z`, attachments: 0, ...extra });
const FEW = [
  item(1, { title: "KC de redes aparece sem nota", description: "A atividade 254 continua sem nota no portal.\nNo Canvas a nota já saiu.", status: "IN_REVIEW",
    createdAt: "2026-10-08T13:12:00Z", updatedAt: "2026-10-09T17:40:00Z", attachments: 2 }),
  item(2, { type: "SUGGESTION", title: "Mostrar a data de entrega", description: "Seria útil ver a data limite de cada atividade.", createdAt: "2026-10-03T22:05:00Z", updatedAt: "2026-10-03T22:05:00Z" }),
  item(3, { type: "IMPROVEMENT", title: "Gráfico difícil de ler no celular", description: "As linhas ficam muito próximas.", status: "RESOLVED", page: "overview",
    createdAt: "2026-09-22T11:30:00Z", updatedAt: "2026-09-30T19:02:00Z", attachments: 1 }),
  item(4, { type: "OTHER", title: '<img src=x onerror="window.__xss=1">Dúvida & "aspas"', description: "<script>window.__xss=2</script> texto", status: "ARCHIVED", page: "history",
    cohort: "BRSA0201", createdAt: "2026-09-10T12:00:00Z", updatedAt: "2026-09-10T12:00:00Z" }),
];
const MANY = Array.from({ length: 25 }, (_, i) => item(i + 10, { id: `20260901T1200000000${String(i).padStart(2, "0")}-aaaa${String(i).padStart(4, "0")}`, title: `Relato número ${i + 1}` }));
const LONG_WORD = "https://awsrestart.instructure.com/courses/4436/modules/items/2892295?module_item_id=" + "9".repeat(60);
const LONG = [item(1, { title: "Atividade 254-NF- KC Introdução à rede aparece sem nota no portal mesmo com a nota registrada no Canvas",
  description: (`Passos: abri Minhas atividades e cliquei em Abrir no Canvas.\n${LONG_WORD}\n\n` + "A média de KC caiu na mesma publicação e não sei se é atraso da correção. ".repeat(24)).slice(0, 2000),
  status: "IN_REVIEW", updatedAt: "2026-10-10T09:15:00Z", attachments: 3 }), ...FEW.slice(1, 3)];
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const image = (name, mimeType = "image/png", buffer = PIXEL) => ({ name, mimeType, buffer });
const LONG_FILE = `captura-${"da-tela-minhas-atividades-".repeat(5)}final.png`;
const RING = [0, 203, 221];
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

const report = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-09T21:00:00Z", updateKind: "canvas",
  thresholds: { kc: 70, lab: 95 }, canvasCourseId: null, focus: { activityIds: [], version: null }, history: [],
  student: { id: "101", name: "Maria Teste", email: "maria@example.test", kc: 80, lab: 96, total: 88, progress: 100, pending: 0, completed: 1, status: "ok",
    activities: [{ id: "a1", name: "001 KC Introdução", kind: "kc", points: "100", active: true, score: 80, percent: 80, state: "completed", needsReview: false, module: "Cloud", moduleOrder: 1, canvasUrl: null, releasedAt: null }] } };

// from: tela antes do Feedback (o botão do menu). api.* muda as respostas durante o teste.
// users: e-mails devolvidos pelo /me a cada boot (troca de usuário na mesma aba); itemsFor: lista de cada um.
async function open({ width = 1440, height = 900, text = 1, items = FEW, role = "student", from = "Minhas atividades", go = true, scale = 1, mine = "ok", users = null, itemsFor = null, cohorts = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const api = { items: [...items], posts: [], gets: [], slots: [], s3: [], completes: [], errors: [], blocked: [], mine, post: "ok", s3Fail: 0, holdPost: null, holdMine: null, holdS3: null, meCalls: 0, who: null };
  page.on("pageerror", (error) => api.errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(() => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    // Prévias locais criadas e liberadas pela página (URL.createObjectURL/revokeObjectURL), sem mudar o comportamento.
    window.__urls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); window.__urls.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { window.__urls.revoked.push(url); revoke(url); };
  });
  const email = role === "student" ? "maria@example.test" : `${role}@example.test`;
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { api.blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (url.pathname.startsWith("/s3/")) {
      if (request.method() !== "POST") return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
      api.s3.push(url.pathname);
      if (api.holdS3) { const h = api.holdS3; api.holdS3 = null; h.arrived.resolve(); await h.gate.promise; }
      if (api.s3Fail > 0) { api.s3Fail--; return route.fulfill({ status: 403, body: "" }); }
      return route.fulfill({ status: 204, body: "" });
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), method = request.method();
    if (endpoint === "/me") { api.who = users ? users[Math.min(api.meCalls++, users.length - 1)] : email; return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email: api.who } }); }
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: cohorts ?? [{ code: "BRSA0267", canTeach: role !== "student" }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? report : { ...report, students: [report.student], activities: report.student.activities } });
    if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
    if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
    if (endpoint === "/admin/feedback") return route.fulfill({ json: { items: [], nextCursor: null, summary: { NEW: 0, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } } });
    if (endpoint === "/feedback" && method === "GET") {
      const who = api.who;
      api.gets.push({ ...Object.fromEntries(url.searchParams), who });
      if (api.holdMine) { const h = api.holdMine; api.holdMine = null; h.arrived.resolve(); await h.gate.promise; }
      const cursor = url.searchParams.get("cursor");
      if (api.mine === "error" || (api.mine === "error-more" && cursor)) return route.fulfill({ status: 500, json: { error: "Falha fictícia ao carregar seus feedbacks." } });
      const start = Number(cursor || 0), own = itemsFor ? itemsFor[who] : api.items;
      return route.fulfill({ json: { items: own.slice(start, start + 20), nextCursor: start + 20 < own.length ? String(start + 20) : null } });
    }
    if (endpoint === "/feedback" && method === "POST") {
      const body = request.postDataJSON();
      api.posts.push(body);
      if (api.holdPost) { const h = api.holdPost; api.holdPost = null; h.arrived.resolve(); await h.gate.promise; }
      if (api.post === "429") return route.fulfill({ status: 429, json: { error: "Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde." } });
      if (api.post === "409") return route.fulfill({ status: 409, json: { error: "Não foi possível enviar agora. Tente novamente." } });
      if (api.post === "500") return route.fulfill({ status: 500, json: { error: "Erro interno. Tente novamente em instantes." } });
      if (api.post === "network") return route.abort("failed");
      if (api.post === "401") return route.fulfill({ status: 401, json: { error: "Sua sessão expirou. Entre novamente." } });
      // Mesmo texto em 10 minutos: o backend devolve o feedback que já existe (o primeiro da lista), sem criar outro.
      if (api.post === "duplicate") return route.fulfill({ json: { feedback: api.items[0], duplicate: true } });
      const created = { id: `20261011T18000000000${api.posts.length}-bbbbbbbb`, ...body, status: "NEW", createdAt: "2026-10-11T18:00:00Z", updatedAt: "2026-10-11T18:00:00Z", attachments: 0 };
      api.items.unshift(created);
      return route.fulfill({ json: { feedback: created, duplicate: false } });
    }
    let m = endpoint.match(/^\/feedback\/([^/]+)\/attachments$/);
    if (m && method === "POST") {
      const body = request.postDataJSON(), attachmentId = body.clientToken.replace(/-/g, "").slice(0, 32);
      api.slots.push({ feedbackId: m[1], ...body });
      return route.fulfill({ json: { status: "PENDING", attachment: { attachmentId, originalName: body.fileName, mimeType: body.contentType, size: body.size },
        upload: { url: `${origin}/s3/`, fields: { key: `tmp/${m[1]}/${attachmentId}`, "Content-Type": body.contentType } } } });
    }
    if (m) {
      const it = api.items.find((f) => f.id === m[1]);
      return route.fulfill({ json: { canAdd: true, items: Array.from({ length: it?.attachments || 0 }, (_, i) => ({ attachmentId: String(i + 1).padEnd(32, "0"),
        originalName: [LONG_FILE, "canvas.jpg", "detalhe.webp"][i], mimeType: "image/png", size: 1_887_437, createdAt: it.createdAt })) } });
    }
    m = endpoint.match(/^\/feedback\/([^/]+)\/attachments\/([^/]+)\/complete$/);
    if (m) { api.completes.push(m[2]); return route.fulfill({ json: { status: "READY", attachment: { attachmentId: m[2] } } }); }
    m = endpoint.match(/^\/feedback\/([^/]+)\/attachments\/([^/]+)$/);
    if (m) return route.fulfill({ json: { downloadUrl: `${origin}/s3/${m[2]}.png?X-Amz-Expires=300`, expiresIn: 300 } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  await page.locator(".layout .page-heading h1").waitFor();
  await page.evaluate(async () => { window.__state = (await import("/state.js")).state; });
  if (role === "student" && from) { await page.getByRole("button", { name: from, exact: true }).click(); await page.getByRole("heading", { name: from, level: 1 }).waitFor(); }
  if (go) {
    if (role === "student") await page.getByRole("button", { name: "Feedback", exact: true }).click();
    else await page.locator(".footer-feedback").click();
    await page.getByRole("heading", { name: "Ajude a melhorar a plataforma", level: 1 }).waitFor();
    if (mine !== "hold") await page.waitForFunction(() => !document.querySelector("main").textContent.includes("Carregando seus feedbacks"));
  }
  return { context, page, api };
}
const pick = async (page, trigger, files) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
  await chooser.setFiles(files);
};
const fill = async (page, { type = "Bug", title = "KC de redes aparece sem nota", description = "A atividade 254 continua sem nota no portal, mas no Canvas já saiu." } = {}) => {
  if (type) await page.locator(".fb-type-option", { hasText: type }).click();
  if (title != null) await page.locator("#fb-title").fill(title);
  if (description != null) await page.locator("#fb-description").fill(description);
};
const submit = (page) => page.locator('#feedback-form button[type="submit"]');
const active = (page) => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, text: a.textContent.trim().slice(0, 40), name: a.getAttribute("name") }; });
const notices = (page) => page.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));
const flush = (page) => page.evaluate(() => fetch("/index.html", { cache: "no-store" }).then((r) => r.text()).then(() => true));
// Cada feedback da lista como a pessoa o lê (sem o que é só para leitura assistiva) e o que o leitor de tela ouve da situação.
const entries = (page) => page.locator(".student-feedback .feedback-list > li").evaluateAll((lis) => lis.map((li) => {
  const seen = (el) => { if (!el) return null; const c = el.cloneNode(true); c.querySelectorAll(".sr-only").forEach((s) => s.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
  const state = li.querySelector(".fb-state");
  const meta = li.querySelector(".fb-entry-meta");
  return { title: li.querySelector("h3")?.textContent, state: seen(state?.querySelector(".fb-state-name")), since: seen(state?.querySelector(".fb-state-since")), heard: state?.textContent.replace(/\s+/g, " ").trim(),
    meta: seen(meta), metaHeard: meta?.textContent.replace(/\s+/g, " ").trim(), text: li.querySelector(".fb-entry-text")?.innerText ?? null, shape: state ? getComputedStyle(state, "::before").content : null };
}));
async function colorsAt(page, points) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
}
const isRing = (c) => !!c && c.every((v, i) => Math.abs(v - RING[i]) <= 45);
// Contorno de foco inteiro na tela (os quatro lados), lido nos pixels, em volta de `selector` (o controle ou a caixa dele).
async function ringOnScreen(page, selector) {
  const box = await page.evaluate((s) => { const el = s ? document.querySelector(s) : document.activeElement, r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(st.outlineOffset), w: parseFloat(st.outlineWidth) }; }, selector);
  const { r, o, w } = box, mid = o + w / 2;
  if (!(w >= 3)) return [`contorno de ${w}px`];
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  return Object.entries(await colorsAt(page, points)).filter(([, c]) => !isRing(c)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
}

test("F1: Feedback do aluno na composição própria (formulário e Meus feedbacks), tipos com explicação, regras junto dos campos e o que vai junto; instrutor e admin como antes", async () => {
  const { context, page, api } = await open();
  assert.equal(await page.locator(".student-feedback").count(), 1);
  // Título na escala das telas do aluno (seção 30, a mesma de Minhas atividades e Meu histórico).
  assert.deepEqual(await page.locator(".student-feedback .page-heading h1").evaluate((el) => { const s = getComputedStyle(el); return [/^system-ui/.test(s.fontFamily), s.fontWeight, Math.round(parseFloat(s.letterSpacing) / parseFloat(s.fontSize) * 1000) / 1000]; }),
    [true, "650", -0.01]);
  assert.deepEqual(await page.locator(".student-feedback h2").allInnerTexts(), ["Novo feedback", "Meus feedbacks"]);
  assert.equal(await page.locator(".student-feedback .fb-required").innerText(), "Tipo, título e descrição são obrigatórios.");
  // Tipos na ordem do contrato; cada rádio tem nome curto e a explicação como descrição; obrigatórios.
  const types = await page.locator('.student-feedback input[name="fb-type"]').evaluateAll((els) => els.map((el) => ({ value: el.value, required: el.required,
    name: el.getAttribute("aria-labelledby").split(" ").map((id) => document.getElementById(id).textContent).join(" "),
    hint: el.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent).join(" ") })));
  assert.deepEqual(types, [
    { value: "BUG", required: true, name: "Bug", hint: "Algo não funciona como deveria." },
    { value: "SUGGESTION", required: true, name: "Sugestão", hint: "Uma ideia nova para o portal." },
    { value: "IMPROVEMENT", required: true, name: "Melhoria", hint: "Algo que já existe pode ficar melhor." },
    { value: "OTHER", required: true, name: "Outro", hint: "Qualquer outro assunto." }]);
  for (const name of ["Bug", "Sugestão", "Melhoria", "Outro"]) assert.equal(await page.getByRole("radio", { name, exact: true }).count(), 1, name);
  // Nome e explicação separados por espaço: na coluna estreita os dois ficam na mesma linha e precisam poder quebrar.
  assert.deepEqual(await page.locator(".student-feedback .fb-type-text").allTextContents(),
    ["Bug Algo não funciona como deveria.", "Sugestão Uma ideia nova para o portal.", "Melhoria Algo que já existe pode ficar melhor.", "Outro Qualquer outro assunto."]);
  // Título e descrição: rótulo, a regra com os limites (a mesma do backend) e a contagem, como descrição do campo.
  const field = (id) => page.locator(`#${id}`).evaluate((el) => ({ label: document.querySelector(`label[for="${el.id}"]`).textContent, required: el.required,
    describedBy: el.getAttribute("aria-describedby").split(" ").map((x) => document.getElementById(x)?.textContent) }));
  assert.deepEqual(await field("fb-title"), { label: "Título", required: true, describedBy: ["Em poucas palavras, de 3 a 120 caracteres.", "0/120"] });
  assert.deepEqual(await field("fb-description"), { label: "Descrição", required: true,
    describedBy: ["O que aconteceu ou o que você sugere, e em qual tela. De 10 a 2.000 caracteres.", "0/2000"] });
  // O que vai junto com o envio: a turma atual e a tela de onde a pessoa veio, com o nome do menu dela.
  assert.equal((await page.locator(".student-feedback .feedback-origin").innerText()).replace(/\s+/g, " "),
    "Junto com o feedback vão a turma BRSA0267 e a tela de origem, Minhas atividades.");
  await fill(page);
  await submit(page).click();
  await page.locator(".feedback-success").waitFor();
  assert.deepEqual(api.posts, [{ type: "BUG", title: "KC de redes aparece sem nota", description: "A atividade 254 continua sem nota no portal, mas no Canvas já saiu.", cohort: "BRSA0267", page: "activities" }]);
  assert.deepEqual([api.errors, api.blocked], [[], []]);
  await context.close();
  // Vindo de Meu desempenho: o nome do menu do aluno (não o rótulo curto do admin).
  const home = await open({ from: null });
  assert.match(await home.page.locator(".feedback-origin").innerText(), /a tela de origem, Meu desempenho\.$/);
  await home.context.close();
  // Instrutor e admin, pelo rodapé: a tela antiga (painel, "Sobre:", pílulas sem explicação, fonte antiga).
  for (const role of ["instructor", "admin"]) {
    const other = await open({ role });
    const old = await other.page.evaluate(() => ({ scoped: document.querySelectorAll(".student-feedback").length, panel: !!document.querySelector("section.panel.feedback-form-panel"),
      origin: document.querySelector(".feedback-origin").textContent, hints: document.querySelectorAll(".fb-type-hint, .fb-hint, .fb-required").length,
      font: getComputedStyle(document.querySelector("main h1")).fontFamily, h2: [...document.querySelectorAll("main h2")].map((h) => h.textContent) }));
    const { font, ...rest } = old;
    assert.deepEqual(rest, { scoped: 0, panel: true, origin: "Sobre: Painel do instrutor", hints: 0, h2: ["Meus feedbacks"] }, role);
    assert.doesNotMatch(font, /^system-ui/, `${role}: conteúdo fora do piloto continua na fonte antiga`);
    // Validação do instrutor como antes: pelo aviso, sem marcar campos.
    await other.page.locator('#feedback-form button[type="submit"]').click();
    await other.page.getByText("Escolha o tipo do feedback.").waitFor();
    assert.deepEqual(await notices(other.page), [{ error: true, text: "Escolha o tipo do feedback." }]);
    assert.equal(await other.page.locator(".fb-error, [aria-invalid]").count(), 0);
    assert.deepEqual(other.api.posts, []);
    await other.context.close();
  }
});

test("F2: validação junto dos campos — todos os problemas de uma vez, sem enviar nem aviso solto; foco no primeiro; somem quando o campo fica válido", async () => {
  const { context, page, api } = await open();
  await page.locator("#fb-title").fill("a");
  await submit(page).click();
  await flush(page);
  assert.equal(await page.locator(".student-feedback .fb-error").count(), 3, "três problemas na tela");
  const shown = () => page.evaluate(() => [...document.querySelectorAll(".student-feedback .fb-error")].map((el) => ({ id: el.id, text: el.textContent,
    linked: [...document.querySelectorAll(`[aria-describedby~="${el.id}"]`)].map((f) => `${f.id}:${f.getAttribute("aria-invalid")}`),
    mark: getComputedStyle(el, "::before").content, near: (() => { const f = [...document.querySelectorAll(`[aria-describedby~="${el.id}"]`)].at(-1); if (!f) return null;
      const a = (f.closest(".fb-type-option") || f).getBoundingClientRect(), b = el.getBoundingClientRect(); return Math.round(b.top - a.bottom); })() })));
  const errors = await shown();
  assert.deepEqual(errors.map((x) => [x.id, x.text, x.mark]), [
    ["fb-type-error", "Escolha o tipo do feedback.", '"!"'], ["fb-title-error", "O título deve ter ao menos 3 caracteres.", '"!"'], ["fb-description-error", "A descrição deve ter ao menos 10 caracteres.", '"!"']]);
  assert.deepEqual(errors.map((x) => x.linked), [["fb-type-bug:true", "fb-type-suggestion:true", "fb-type-improvement:true", "fb-type-other:true"], ["fb-title:true"], ["fb-description:true"]]);
  // Junto do campo: logo abaixo dele (menos de 40 px), não num aviso no canto da tela.
  assert.ok(errors.every((x) => x.near >= 0 && x.near < 40), JSON.stringify(errors.map((x) => [x.id, x.near])));
  assert.deepEqual(await notices(page), [], "sem aviso solto: o problema está no campo");
  assert.deepEqual(api.posts, [], "nada é enviado");
  assert.deepEqual(await active(page), { tag: "INPUT", id: "fb-type-bug", text: "", name: "fb-type" }, "foco no primeiro campo com problema");
  // Não só cor: o texto do problema na cor do texto, a marca "!" e a borda do campo.
  const look = await page.locator("#fb-title-error").evaluate((el) => ({ color: getComputedStyle(el).color, field: getComputedStyle(document.getElementById("fb-title")).borderTopColor }));
  assert.equal(look.color, "rgb(255, 255, 255)");
  assert.equal(look.field, "rgb(217, 107, 120)");
  // Corrigir o título tira só o problema dele, na hora, sem redesenhar: o foco e o cursor ficam onde estão.
  await page.locator("#fb-title").click();
  await page.keyboard.press("End");
  await page.keyboard.type("b");
  assert.deepEqual((await shown()).map((x) => x.id), ["fb-type-error", "fb-title-error", "fb-description-error"], "\"ab\" ainda é curto: o problema continua");
  await page.keyboard.type("c");
  const afterTitle = await page.evaluate(() => ({ ids: [...document.querySelectorAll(".fb-error")].map((el) => el.id), invalid: document.getElementById("fb-title").getAttribute("aria-invalid"),
    describedBy: document.getElementById("fb-title").getAttribute("aria-describedby"), focus: document.activeElement.id, caret: document.activeElement.selectionStart, value: document.activeElement.value }));
  assert.deepEqual(afterTitle, { ids: ["fb-type-error", "fb-description-error"], invalid: null, describedBy: "fb-title-hint fb-title-count", focus: "fb-title", caret: 3, value: "abc" });
  // Escolher o tipo tira o problema do tipo.
  await page.locator(".fb-type-option", { hasText: "Melhoria" }).click();
  assert.deepEqual(await page.evaluate(() => [[...document.querySelectorAll(".fb-error")].map((el) => el.id), document.querySelectorAll('[name="fb-type"][aria-invalid]').length]), [["fb-description-error"], 0]);
  // Descrição só com espaços continua inválida (o backend apara); de novo, o foco vai para ela e nada é enviado.
  await page.locator("#fb-description").fill("          ");
  await submit(page).click();
  await page.waitForFunction(() => document.activeElement.id === "fb-description");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".fb-error")].map((el) => el.id)), ["fb-description-error"]);
  assert.deepEqual(api.posts, []);
  // Enter no título também passa pela validação.
  await page.locator("#fb-title").press("Enter");
  await page.waitForFunction(() => document.activeElement.id === "fb-description");
  assert.deepEqual(api.posts, []);
  // Válido, sem sair da tela: envia uma vez e o rascunho novo (vazio) começa sem problemas na tela.
  await page.locator("#fb-description").fill("Descrição com detalhes suficientes.");
  await submit(page).click();
  await page.locator(".feedback-success").waitFor();
  await page.waitForFunction(() => !document.querySelector("main").textContent.includes("Carregando seus feedbacks"));
  assert.equal(api.posts.length, 1);
  assert.equal(await page.locator(".fb-error, [aria-invalid]").count(), 0, "rascunho novo, sem problemas na tela");
  // Saindo e voltando, o rascunho continua e os problemas não aparecem de novo antes de uma tentativa.
  await page.locator("#fb-title").fill("Rascunho guardado");
  await submit(page).click();
  await flush(page);
  assert.equal(await page.locator(".fb-error").count(), 2, "tipo e descrição");
  await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
  await page.getByRole("heading", { name: "Meu histórico", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.locator("#fb-title").waitFor();
  assert.deepEqual([await page.locator("#fb-title").inputValue(), await page.locator(".fb-error, [aria-invalid]").count()], ["Rascunho guardado", 0]);
  assert.equal(api.posts.length, 1);
  assert.deepEqual(api.errors, []);
  await context.close();
});

test("F3: envio — andamento visível e sem envio duplicado; sucesso recebe o foco e aparece na lista; falhas (429, 409) ficam junto do botão, mantêm o rascunho e recebem o foco", async () => {
  const { context, page, api } = await open();
  await fill(page);
  const hold = { arrived: deferred(), gate: deferred() };
  api.holdPost = hold;
  await submit(page).click();
  await hold.arrived.promise;
  const during = await page.evaluate(() => ({ status: document.querySelector(".student-feedback .fb-progress")?.textContent, role: document.querySelector(".student-feedback .fb-progress")?.getAttribute("role"),
    busy: document.getElementById("feedback-form").getAttribute("aria-busy"), button: document.querySelector('#feedback-form [type="submit"]').textContent, disabled: document.querySelector('#feedback-form [type="submit"]').disabled }));
  assert.deepEqual(during, { status: "Enviando seu feedback…", role: "status", busy: "true", button: "Enviando…", disabled: true });
  // Outro envio do formulário durante o envio (como um segundo Enter): nada sai de novo.
  await page.evaluate(() => { document.getElementById("feedback-form").requestSubmit(); document.getElementById("feedback-form").requestSubmit(); });
  await flush(page);
  assert.equal(api.posts.length, 1, "um envio só");
  hold.gate.resolve();
  await page.locator(".feedback-success").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 5);
  assert.deepEqual(await active(page), { tag: "P", id: "fb-sent", text: "Feedback enviado com sucesso.", name: null }, "o foco vai à confirmação, não se perde");
  assert.equal(await page.locator("#fb-sent").getAttribute("role"), "status");
  assert.equal((await entries(page))[0].title, "KC de redes aparece sem nota");
  assert.equal((await entries(page))[0].state, "Novo");
  assert.deepEqual(await notices(page), [], "a confirmação fica só no formulário (consolidação)");
  assert.deepEqual([await page.locator("#fb-title").inputValue(), await page.locator("#fb-description").inputValue(), await page.locator('[name="fb-type"]:checked').count()], ["", "", 0]);
  assert.equal(await page.locator(".student-feedback .fb-progress").count(), 0);
  // Se a pessoa leva o foco a um campo enquanto o envio acontece (Enter no título), ele fica lá depois da confirmação.
  await fill(page, { title: "Outro assunto" });
  const again = { arrived: deferred(), gate: deferred() };
  api.holdPost = again;
  await page.locator("#fb-title").press("Enter");
  await again.arrived.promise;
  await page.locator("#fb-description").focus();
  again.gate.resolve();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 6);
  assert.equal((await active(page)).id, "fb-description", "o foco escolhido pela pessoa não é puxado");
  assert.equal(api.posts.length, 2);
  await context.close();
  // Falhas do envio (consolidação): a mensagem do servidor junto do botão, sem aviso temporário; nada de confirmação;
  // rascunho mantido; o foco vai ao motivo e o botão aponta para ele.
  for (const [mode, message] of [["429", "Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde."], ["409", "Não foi possível enviar agora. Tente novamente."]]) {
    const failed = await open();
    failed.api.post = mode;
    await fill(failed.page);
    await submit(failed.page).click();
    await failed.page.waitForFunction(() => document.querySelector("#fb-send-error, #notices .notice") && !document.querySelector('#feedback-form [type="submit"]').disabled);
    assert.deepEqual(await notices(failed.page), [], mode);
    assert.equal((await failed.page.locator("#fb-send-error-text").innerText()).replace(/\s+/g, " "), `O feedback não foi enviado. ${message}`, mode);
    assert.equal(await submit(failed.page).getAttribute("aria-describedby"), "fb-send-error-text", mode);
    assert.equal(await failed.page.locator(".feedback-success").count(), 0, `${mode}: sucesso nunca sem confirmação do servidor`);
    assert.deepEqual([await failed.page.locator("#fb-title").inputValue(), await failed.page.locator('[name="fb-type"]:checked').getAttribute("value")], ["KC de redes aparece sem nota", "BUG"]);
    assert.deepEqual(await active(failed.page), { tag: "DIV", id: "fb-send-error", text: `O feedback não foi enviado. ${message}`.slice(0, 40), name: null }, `${mode}: foco no motivo`);
    assert.equal(failed.api.posts.length, 1);
    assert.equal((await entries(failed.page)).length, 4, `${mode}: a lista não ganha item`);
    await failed.context.close();
  }
});

test("F4: Meus feedbacks — título, situação por texto e forma, tipo, data por extenso, tela de origem, mensagem enviada e quando a situação mudou; registro sem cartões; estados da lista", async () => {
  const { context, page, api } = await open();
  const list = await entries(page);
  // Situação por texto; quando a equipe a mudou (updatedAt diferente de createdAt), desde quando.
  assert.deepEqual(list.map((x) => [x.title, x.state, x.since, x.heard]), [
    ["KC de redes aparece sem nota", "Em análise", "desde 9 de outubro de 2026", "Situação: Em análise desde 9 de outubro de 2026"],
    ["Mostrar a data de entrega", "Novo", null, "Situação: Novo"],
    ["Gráfico difícil de ler no celular", "Resolvido", "desde 30 de setembro de 2026", "Situação: Resolvido desde 30 de setembro de 2026"],
    ['<img src=x onerror="window.__xss=1">Dúvida & "aspas"', "Arquivado", null, "Situação: Arquivado"]]);
  assert.deepEqual(list.map((x) => x.meta), [
    "Bug · 8 de outubro de 2026 · a partir de Minhas atividades · 2 anexos",
    "Sugestão · 3 de outubro de 2026 · a partir de Minhas atividades",
    "Melhoria · 22 de setembro de 2026 · a partir de Meu desempenho · 1 anexo",
    "Outro · 10 de setembro de 2026 · a partir de Meu histórico · turma BRSA0201"]);
  assert.match(list[0].metaHeard, /^Bug · enviado em 8 de outubro de 2026 · /, "o leitor de tela ouve que a data é a do envio");
  assert.deepEqual(list.map((x) => x.text), ["A atividade 254 continua sem nota no portal.\nNo Canvas a nota já saiu.", "Seria útil ver a data limite de cada atividade.",
    "As linhas ficam muito próximas.", "<script>window.__xss=2</script> texto"]);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator(".student-feedback h3").count(), 4, "um título por feedback");
  // Forma diferente para cada situação (a cor não é a única pista) e nenhuma em ciano (ação).
  const shapes = await page.locator(".student-feedback .fb-state").evaluateAll((els) => els.map((el) => { const b = getComputedStyle(el, "::before");
    return [b.borderRadius, b.backgroundImage === "none" ? "vazio" : "metade", b.borderTopWidth, b.transform === "none" ? "reto" : "girado", getComputedStyle(el).color]; }));
  assert.equal(new Set(shapes.map((s) => s.slice(0, 4).join())).size, 4, JSON.stringify(shapes));
  assert.ok(shapes.every((s) => s[4] !== "rgb(0, 175, 232)" && s[4] !== "rgb(0, 203, 221)"), "situação sem a cor de ação");
  // Registro: linhas finas entre os feedbacks, sem moldura nem fundo de cartão.
  const frame = await page.locator(".student-feedback .feedback-list > li").first().evaluate((el) => { const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderLeftWidth, s.borderRightWidth, s.borderBottomWidth, s.backgroundColor, s.borderRadius]; });
  assert.deepEqual(frame, ["0px", "0px", "0px", "1px", "rgba(0, 0, 0, 0)", "0px"]);
  assert.match(await page.locator(".student-feedback .fb-entry-text").first().evaluate((el) => getComputedStyle(el).whiteSpace), /^pre-wrap$/);
  assert.deepEqual(api.errors, []);
  await context.close();
  // Vazio, carregando, erro na primeira página (com recomeço), "Carregar mais" e erro nele (os itens ficam).
  const empty = await open({ items: [] });
  assert.equal((await empty.page.locator(".student-feedback .fb-list-state").innerText()).trim(), "Você ainda não enviou feedbacks.");
  assert.equal(await empty.page.locator(".student-feedback .feedback-list").count(), 0);
  await empty.context.close();
  const loading = await open({ go: false, mine: "hold" });
  const held = loading.api.holdMine = { arrived: deferred(), gate: deferred() };
  await loading.page.getByRole("button", { name: "Feedback", exact: true }).click();
  await held.arrived.promise;
  assert.deepEqual(await loading.page.locator('.student-feedback .fb-list-state[role="status"]').allInnerTexts(), ["Carregando seus feedbacks…"]);
  assert.equal(await loading.page.locator("#feedback-form").count(), 1, "o formulário não espera a lista");
  held.gate.resolve();
  await loading.context.close();
  const failed = await open({ mine: "error" });
  const alert = failed.page.locator('.student-feedback .fb-list-state[role="alert"]');
  assert.match(await alert.innerText(), /Falha fictícia ao carregar seus feedbacks\.[\s\S]*Tentar novamente/);
  assert.equal(await alert.locator('[data-action="feedback-retry"]').count(), 1);
  failed.api.mine = "ok";
  await alert.getByRole("button", { name: "Tentar novamente" }).click();
  await failed.page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 4);
  await failed.context.close();
  const many = await open({ items: MANY, mine: "error-more" });
  assert.equal((await entries(many.page)).length, 20);
  await many.page.getByRole("button", { name: "Carregar mais" }).click();
  const moreAlert = many.page.locator('.student-feedback .fb-list-state[role="alert"]');
  await moreAlert.waitFor();
  assert.equal((await entries(many.page)).length, 20, "com erro no Carregar mais os itens continuam");
  assert.equal(await moreAlert.locator('[data-action="feedback-more"]').count(), 1, "a nova tentativa repete a mesma página");
  many.api.mine = "ok";
  await moreAlert.getByRole("button", { name: "Tentar novamente" }).click();
  await many.page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 25);
  assert.equal(await many.page.getByRole("button", { name: "Carregar mais" }).count(), 0);
  assert.deepEqual(many.api.gets.map((g) => g.cursor ?? null), [null, "20", "20"]);
  await many.context.close();
});

test("F5: anexos — nomes longos quebram, Remover com nome e 44 px, arquivo recusado junto do campo, falha parcial leva o foco ao Tentar novamente e explica o envio parado; envio pelo item com motivo do botão parado", async () => {
  const { context, page, api } = await open({ width: 390, height: 844 });
  await pick(page, page.locator('[data-fb-pick="form"]'), [image(LONG_FILE), image("tela.webp", "image/webp")]);
  await page.locator(".fb-file").nth(1).waitFor();
  const files = await page.locator(".student-feedback .fb-file").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(), b = el.querySelector(".fb-remove").getBoundingClientRect();
    return { inside: r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1, remove: el.querySelector(".fb-remove").getAttribute("aria-label"), h: b.height >= 44, w: b.right <= innerWidth }; }));
  assert.deepEqual(files, [{ inside: true, remove: `Remover ${LONG_FILE}`, h: true, w: true }, { inside: true, remove: "Remover tela.webp", h: true, w: true }]);
  // Arquivo recusado no navegador (consolidação): o motivo junto das imagens, sem aviso temporário, e nenhuma linha nova.
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("desenho.svg", "image/svg+xml", Buffer.from("<svg/>"))]);
  await page.waitForFunction(() => document.querySelector("#fb-files-error, #notices .notice"));
  assert.equal(await page.evaluate(() => document.querySelector(".fb-attachments #fb-files-error")?.textContent ?? null), "Envie imagens PNG, JPEG ou WebP.");
  assert.equal(await page.locator(".fb-file").count(), 2);
  assert.deepEqual(await notices(page), []);
  // Falha parcial: o feedback foi criado, uma imagem não. Foco no Tentar novamente; o botão de enviar parado diz por quê.
  api.s3Fail = 1;
  await fill(page);
  await submit(page).click();
  await page.locator(".fb-partial").waitFor();
  await page.waitForFunction(() => document.activeElement?.closest(".fb-partial"));
  assert.deepEqual(await active(page), { tag: "BUTTON", id: "", text: "Tentar novamente", name: null });
  assert.deepEqual(await submit(page).evaluate((el) => [el.disabled, el.getAttribute("aria-describedby"), document.getElementById(el.getAttribute("aria-describedby"))?.textContent]),
    [true, "fb-partial-text", "Feedback enviado, mas não foi possível anexar uma das imagens. Tente anexar de novo ou descarte a que faltou: o texto não é enviado outra vez."]);
  assert.deepEqual(await notices(page), [], "a falha parcial fica só no formulário");
  await page.locator(".fb-partial").getByRole("button", { name: "Tentar novamente" }).click();
  await page.locator(".feedback-success").waitFor();
  assert.deepEqual([api.posts.length, api.completes.length], [1, 2]);
  await context.close();
  // Pelo item: Ver anexos (aria-expanded) e Adicionar imagem parado durante o envio, com o andamento como motivo.
  const card = await open();
  const first = card.page.locator(".student-feedback .feedback-list > li").first();
  const toggle = first.getByRole("button", { name: "Ver anexos" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  await first.locator(".fb-gallery .fb-thumb img").nth(1).waitFor();
  assert.equal(await first.getByRole("button", { name: "Ocultar anexos" }).getAttribute("aria-expanded"), "true");
  const hold = { arrived: deferred(), gate: deferred() };
  card.api.holdS3 = hold;
  await pick(card.page, first.getByRole("button", { name: "Adicionar imagem" }), [image("mais.png")]);
  await hold.arrived.promise;
  await card.page.waitForFunction(() => document.querySelector(".fb-card-add")?.disabled);
  assert.deepEqual(await first.locator(".fb-card-add").evaluate((el) => [el.disabled, document.getElementById(el.getAttribute("aria-describedby"))?.textContent]), [true, "Enviando imagem 1 de 1…"]);
  hold.gate.resolve();
  // Consolidação: o resultado fica no próprio item (sem aviso) e o foco volta ao botão, que aponta para ele.
  // Depois do envio a lista recarrega (o botão some por um instante): espera o botão de volta, livre, e o resultado.
  await card.page.waitForFunction(() => { const add = document.querySelector(".fb-card-add"); return add && !add.disabled && !document.querySelector(".fb-card-progress")?.textContent.startsWith("Enviando"); });
  await flush(card.page);
  await assert.doesNotReject(() => card.page.waitForFunction((id) =>
    document.activeElement?.matches(`.student-feedback .fb-card-add[data-fb-pick="${CSS.escape(id)}"]`),
  FEW[0].id, { timeout: 5000 }), "foco no Adicionar imagem do mesmo feedback em até 5 segundos");
  assert.equal(await first.locator(".fb-card-progress").count() && await first.locator(".fb-card-progress").textContent(), "Imagem anexada ao feedback.");
  assert.equal(await card.page.evaluate(() => document.activeElement.matches(".fb-card-add")), true, "foco no Adicionar imagem");
  assert.deepEqual(await first.locator(".fb-card-add").evaluate((el) => document.getElementById(el.getAttribute("aria-describedby"))?.textContent), "Imagem anexada ao feedback.");
  assert.deepEqual(await notices(card.page), []);
  await card.context.close();
});

test("F6: sem rolagem lateral, texto fora do lugar ou controle recortado em 320–1440 px, texto a 200%, zoom a 200%, mensagens e nomes longos, problemas na tela", async () => {
  // 320 px com texto a 250%: folga além dos 200% para fontes do sistema mais largas que a do macOS (Segoe UI, Roboto);
  // "+ Adicionar imagem" ocupa 254 de 288 px a 200% e só cabe a 250% porque o botão quebra linha.
  const cases = [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [1440, 900, 2], [768, 1024, 2], [390, 844, 2], [320, 568, 2], [320, 568, 2.5], [720, 450, 1, 2]];
  for (const [width, height, text, scale = 1] of cases) {
    const label = `${width}×${height} texto ${text * 100}%${scale > 1 ? " zoom 200%" : ""}`;
    const { context, page, api } = await open({ width, height, text, items: LONG, scale });
    await pick(page, page.locator('[data-fb-pick="form"]'), [image(LONG_FILE)]);
    await page.locator(".fb-file").waitFor();
    await page.locator("#fb-title").fill("ab");
    await submit(page).click();
    await flush(page);
    assert.equal(await page.locator("#fb-description-error").count(), 1, `${label}: problema da descrição na tela`);
    await page.locator(".student-feedback .feedback-list > li").first().getByRole("button", { name: "Ver anexos" }).click();
    await page.locator(".fb-gallery .fb-thumb img").nth(2).waitFor();
    const m = await page.evaluate(() => {
      const res = { overflowX: document.documentElement.scrollWidth - innerWidth, outside: [], clipped: [], small: [] };
      const scope = document.querySelector(".student-feedback"), box = scope.getBoundingClientRect();
      // Palavra por palavra: com pre-wrap, o espaço no fim de uma linha fica "pendurado" (invisível) depois da borda.
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { if (!n.data.trim() || n.parentElement.closest(".sr-only, textarea")) continue;
        for (const word of n.data.matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(n, word.index); r.setEnd(n, word.index + word[0].length);
          for (const x of r.getClientRects()) if (x.left < box.left - 0.5 || x.right > box.right + 0.5) res.outside.push(word[0].slice(0, 30)); } }
      for (const el of scope.querySelectorAll("a, button, input, textarea, label.fb-type-option")) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || el.scrollWidth > el.clientWidth + 1) res.clipped.push((el.textContent || el.id || el.tagName).trim().slice(0, 30));
        if (!el.matches('input[type="radio"]') && r.height < 44 - 0.5) res.small.push(`${(el.textContent || el.id).trim().slice(0, 30)} ${Math.round(r.height)}`);
      }
      return res;
    });
    assert.ok(m.overflowX <= 0, `${label}: rolagem lateral de ${m.overflowX}px`);
    assert.deepEqual([...new Set(m.outside)], [], `${label}: texto fora da tela`);
    assert.deepEqual(m.clipped, [], `${label}: controle recortado`);
    assert.deepEqual(m.small, [], `${label}: alvo menor que 44 px`);
    assert.deepEqual(api.errors, [], label);
    await context.close();
  }
});

// Antes da Expansão 3 (dois painéis empilhados; 3 feedbacks), em 1440×900 a lista começava em 940 px, abaixo da primeira
// tela, e a página tinha 1.627 px; em 390×844, 1.845 px até o fim da lista sem a mensagem de cada feedback.
test("F7: composição — formulário e lista lado a lado com largura (a lista começa na primeira tela), empilhados no tablet e no celular; o formulário é a única superfície", async () => {
  for (const [width, height, text, columns] of [[1440, 900, 1, 2], [1280, 800, 1, 2], [1024, 768, 1, 1], [768, 1024, 1, 1], [390, 844, 1, 1], [320, 640, 1, 1], [390, 844, 2, 1], [1440, 900, 2, 1]]) {
    const { context, page } = await open({ width, height, text });
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const compose = r(".feedback-compose"), history = r(".feedback-history"), first = r(".student-feedback .feedback-list > li");
      const surface = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
      return { side: history.left >= compose.right && Math.abs(history.top - compose.top) < 2, stacked: history.top >= compose.bottom, firstTop: first.top + scrollY,
        compose: surface(".feedback-compose"), list: surface(".feedback-history"), item: surface(".student-feedback .feedback-list > li"),
        // O botão de enviar logo depois do que vai junto (na mesma linha ou na seguinte), sem vão no rodapé do formulário.
        footerGap: (() => { const t = document.createRange(); t.selectNodeContents(document.querySelector(".student-feedback .feedback-origin"));
          return Math.round(r('#feedback-form [type="submit"]').top - t.getBoundingClientRect().bottom); })(),
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize), width: document.querySelector(".student-feedback").getBoundingClientRect().width,
        types: document.querySelector(".student-feedback .feedback-types").getBoundingClientRect().height,
        font: Math.min(...[...document.querySelectorAll(".student-feedback :is(p, label, legend, small, h2, h3, button, input, textarea)")].map((el) => parseFloat(getComputedStyle(el).fontSize))) };
    });
    const label = `${width}px texto ${text * 100}%`;
    assert.ok(columns === 2 ? m.side : m.stacked, `${label}: composição ${JSON.stringify(m)}`);
    if (columns === 2) assert.ok(m.firstTop < height, `${label}: o primeiro feedback começa na primeira tela (${Math.round(m.firstTop)} px)`);
    // Com largura, o formulário numa superfície e a lista sobre o fundo; estreito (menos de 30rem), o formulário sem moldura.
    const narrow = m.width / m.rem < 30;
    assert.equal(m.compose === "rgba(0, 0, 0, 0)", narrow, `${label}: superfície do formulário ${m.compose}`);
    assert.deepEqual([m.list, m.item], ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
    assert.ok(m.footerGap <= 24 * text, `${label}: vão de ${m.footerGap}px entre o que vai junto e o botão`);
    // Tipos: duas colunas de caixas quando cabem; na coluna estreita, lista simples. Antes da lista simples, com caixas
    // empilhadas, o grupo media ~17rem em 320 px e ~24rem em 390 px a 200%; agora ~13rem nos dois.
    // C3: o limite de 15rem separa a lista simples das caixas empilhadas de antes. Com a fonte do sistema, a altura dependia da
    // largura dela (13,7rem com a SF do macOS; 17,4rem com a DejaVu Sans do Linux, sem virar caixa). Medida com a tipografia
    // de referência.
    await page.addStyleTag({ content: REFERENCE_FONT });
    const [reference, types] = await page.locator(".student-feedback .feedback-types").evaluate((el) => [/^Arial/.test(getComputedStyle(el).fontFamily), el.getBoundingClientRect().height]);
    assert.ok(reference, `${label}: tipografia de referência aplicada`);
    assert.ok(types / m.rem <= 15, `${label}: tipos com ${Math.round(types)}px (${(types / m.rem).toFixed(1)}rem, tipografia de referência)`);
    assert.ok(m.font >= 12 * text - 0.5, `${label}: fonte mínima ${m.font}px`);
    await context.close();
  }
});

test("F8: teclado na ordem visual, setas entre os tipos e contorno de foco inteiro (pixels) nos tipos, campos e ações; no celular o foco não fica atrás da barra", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page } = await open({ width, height });
    await page.locator("main h1").focus();
    const order = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const a = await active(page);
      order.push(a.name === "fb-type" ? `tipo:${a.id}` : a.id || a.text);
      const shown = await page.evaluate(() => { const el = document.activeElement, target = el.closest(".fb-type-option") || el, r = target.getBoundingClientRect(),
        nav = document.querySelector(".sidebar nav"), fixed = getComputedStyle(nav).position === "fixed"; return { bottom: r.bottom, top: r.top, limit: fixed ? nav.getBoundingClientRect().top : innerHeight }; });
      // Visível sem rolar à mão: o topo e pelo menos 44 px do controle acima da barra (um campo de texto alto pode
      // continuar abaixo da dobra; o cursor fica no topo).
      assert.ok(shown.top >= 0 && Math.min(shown.bottom, shown.top + 44) <= shown.limit, `${width}px: ${order.at(-1)} escondido (${JSON.stringify(shown)})`);
      await page.evaluate(() => (document.activeElement.closest(".fb-type-option") || document.activeElement).scrollIntoView({ block: "nearest" }));
      const ring = await ringOnScreen(page, null);
      assert.deepEqual(ring, [], `${width}px: contorno de ${order.at(-1)}`);
    }
    assert.deepEqual(order, ["tipo:fb-type-bug", "fb-title", "fb-description", "+ Adicionar imagem", "Enviar feedback", "Ver anexos"], `${width}px`);
    // Setas mudam o tipo escolhido (grupo de rádio do navegador).
    await page.locator("#fb-type-bug").focus();
    await page.keyboard.press("ArrowDown");
    assert.deepEqual([(await active(page)).id, await page.locator('[name="fb-type"]:checked').getAttribute("value")], ["fb-type-suggestion", "SUGGESTION"]);
    await context.close();
  }
});

// C7.5 pela tela do aluno: troca de usuário na mesma aba (o boot recebe outro /me; o aluno sem turma chega a ela pelo
// "Verificar novamente"). Nada de A — rascunho, problemas na tela, imagens escolhidas, envio pelo item em andamento,
// lista em trânsito — aparece para B, e nenhuma etapa de A continua com a sessão de B.
test("F9: troca de usuário durante o upload e durante o carregamento da lista não leva rascunho, problemas, imagens nem itens de A para B", async () => {
  const A = "aluna.a@example.test", B = "aluno.b@example.test";
  const itemsFor = { [A]: FEW.slice(0, 2), [B]: [item(7, { title: "Feedback de B", description: "Só de B.", createdAt: "2026-10-05T12:00:00Z", updatedAt: "2026-10-05T12:00:00Z" })] };
  const { context, page, api } = await open({ from: null, cohorts: [], users: [A, B, B], itemsFor });
  assert.deepEqual(await entries(page).then((l) => l.map((x) => x.title)), ["KC de redes aparece sem nota", "Mostrar a data de entrega"]);
  // A: rascunho, tentativa com problemas, imagem no formulário e envio pelo item retido no S3.
  await page.locator("#fb-title").fill("Segredo de A");
  await page.locator("#fb-description").fill("Texto privado de A");
  await submit(page).click();
  await flush(page);
  assert.equal(await page.locator(".fb-error").count(), 1, "o problema do tipo de A na tela");
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("a-formulario.png")]);
  await page.locator(".fb-file").waitFor();
  const hold = { arrived: deferred(), gate: deferred() };
  api.holdS3 = hold;
  await pick(page, page.locator(".student-feedback .feedback-list > li").first().getByRole("button", { name: "Adicionar imagem" }), [image("a-item.png")]);
  await hold.arrived.promise;
  // Troca: A sai para o primeiro acesso e o boot recebe B.
  await page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
  await page.getByRole("button", { name: "Verificar novamente" }).click();
  await page.waitForFunction((b) => window.__state.me?.email === b, B);
  hold.gate.resolve();
  await flush(page); await flush(page);
  // B abre o Feedback: formulário vazio, sem problemas, sem imagens; lista só de B; nada de A concluído nem avisado.
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 1);
  const seen = await page.evaluate(() => ({ title: document.getElementById("fb-title").value, description: document.getElementById("fb-description").value,
    marks: document.querySelectorAll(".fb-error, [aria-invalid]").length, files: document.querySelectorAll(".fb-file").length, text: document.querySelector("main").innerText,
    urls: window.__urls, progress: document.querySelectorAll(".fb-card-progress").length }));
  assert.deepEqual([seen.title, seen.description, seen.marks, seen.files, seen.progress], ["", "", 0, 0, 0]);
  assert.doesNotMatch(seen.text, /Segredo de A|KC de redes|Mostrar a data|a-formulario|a-item/);
  assert.match(seen.text, /Feedback de B/);
  assert.deepEqual(api.completes, [], "o anexo de A não é concluído com a sessão de B");
  assert.equal(await page.getByText("Imagem anexada ao feedback.").count(), 0);
  assert.equal(seen.urls.created.length, 2);
  assert.deepEqual([...seen.urls.revoked].sort(), [...seen.urls.created].sort(), "as prévias de A foram liberadas");
  assert.ok(api.gets.every((g) => g.who === A || g.who === B) && api.gets.at(-1).who === B);
  assert.deepEqual(api.errors, []);
  await context.close();
  // Durante o carregamento: a lista de A fica em trânsito enquanto B entra; a resposta tardia de A não aparece para B.
  const late = await open({ from: null, cohorts: [], users: [A, B, B], itemsFor, go: false });
  const held = late.api.holdMine = { arrived: deferred(), gate: deferred() };
  await late.page.getByRole("button", { name: "Feedback", exact: true }).click();
  await held.arrived.promise;
  await late.page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
  await late.page.getByRole("button", { name: "Verificar novamente" }).click();
  await late.page.waitForFunction((b) => window.__state.me?.email === b, B);
  held.gate.resolve();
  await flush(late.page); await flush(late.page);
  assert.deepEqual(await late.page.evaluate(() => window.__state.myFeedback.items.map((f) => f.title)), [], "a resposta de A não escreve no estado de B");
  await late.page.getByRole("button", { name: "Feedback", exact: true }).click();
  await late.page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 1);
  assert.deepEqual((await entries(late.page)).map((x) => x.title), ["Feedback de B"]);
  assert.deepEqual(late.api.gets.map((g) => g.who), [A, B]);
  assert.deepEqual(late.api.errors, []);
  await late.context.close();
});


// ---- Consolidação da Expansão 3 (docs/design-visual.md) ----
// Mensagens longas em "Meus feedbacks": com mais de 4 linhas na largura atual, só as 3 primeiras até a pessoa abrir; o
// estado de cada uma é do feedback (id), da lista daquele usuário, e sobrevive aos renders. Resultados do envio no
// formulário, sem aviso temporário: confirmação (ou "já tinha sido enviado"), falhas com o motivo, arquivos recusados.
const LINES4 = "Linha 1\nLinha 2\nLinha 3\nLinha 4";
const LINES5 = `${LINES4}\nLinha 5`;
const PARAGRAPH = "A média de KC caiu na mesma publicação e não sei se é atraso da correção ou se a nota não foi importada. ".repeat(9).trim();
const MEDIUM = "No celular, com o texto maior, a legenda do gráfico fica por cima das linhas e não dá para ler os valores da semana nem a referência da turma.";
const MIXED = [
  item(1, { id: "20261010T120000000000-00000001", title: "Curta", description: "O lab 227 mostra 0% mas eu entreguei." }),
  item(2, { id: "20261010T120000000000-00000002", title: "Quatro linhas", description: LINES4 }),
  item(3, { id: "20261010T120000000000-00000003", title: "Cinco linhas", description: LINES5, status: "IN_REVIEW", updatedAt: "2026-10-11T09:00:00Z", attachments: 2 }),
  item(4, { id: "20261010T120000000000-00000004", title: "Longa com endereço", description: `Passos: abri Minhas atividades.\n${LONG_WORD}\n\n${PARAGRAPH}`, status: "RESOLVED", updatedAt: "2026-10-11T09:00:00Z" }),
  item(5, { id: "20261010T120000000000-00000005", title: "Média", description: MEDIUM, status: "ARCHIVED" }),
  item(6, { id: "20261010T120000000000-00000006", title: "Perto do limite", description: (PARAGRAPH + "\n\n").repeat(3).slice(0, 2000) }),
];
const LONGS = Array.from({ length: 25 }, (_, i) => item(i + 30, { id: `20260920T1200000000${String(i).padStart(2, "0")}-bbbb${String(i).padStart(4, "0")}`, title: `Longo ${i + 1}`, description: `${LINES5}\nDo feedback ${i + 1}` }));

// Cada mensagem: medida em linhas (inteira e à vista), marcação e o botão (só quando visível).
const messages = (page) => page.locator(".student-feedback .feedback-list > li").evaluateAll((lis) => lis.map((li) => {
  const p = li.querySelector(".fb-entry-text"), b = li.querySelector(".fb-message-toggle");
  if (!p) return { title: li.querySelector("h3").textContent, text: null };
  const lh = parseFloat(getComputedStyle(p).lineHeight), r = b?.getBoundingClientRect();
  return { title: li.querySelector("h3").textContent, full: Math.round(p.scrollHeight / lh), shown: Math.round(p.clientHeight / lh), long: p.classList.contains("is-long"),
    collapsed: p.classList.contains("is-collapsed"), toggle: b && r.height > 0 ? { label: b.textContent, expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls") === p.id, h: r.height } : null,
    text: p.textContent, state: li.querySelector(".fb-state-name").textContent, meta: li.querySelector(".fb-entry-meta").textContent.replace(/\s+/g, " ") };
}));
const toggleOf = (page, title) => page.locator(".student-feedback .feedback-list > li", { has: page.getByRole("heading", { name: title, exact: true }) }).locator(".fb-message-toggle");
// Abre ou recolhe pelo botão da mensagem, conferindo antes que ele está na tela (falha por asserção, não por espera).
const press = async (page, title) => { const t = toggleOf(page, title); assert.ok(await t.isVisible(), `${title}: botão da mensagem na tela`); await t.click(); };
// Espera o resultado de uma ação aparecer, no formulário ou num aviso temporário; quem chama confere qual.
const either = (page, selector) => page.waitForFunction((s) => document.querySelector(s) || document.querySelector("#notices .notice"), selector);
// Espera a ação terminar (o resultado na tela ou num aviso, o botão de enviar livre, a lista carregada) e confere o foco.
const focusOn = async (page, test, result) => {
  await page.waitForFunction((s) => (document.querySelector(s) || document.querySelector("#notices .notice")) && !document.querySelector('#feedback-form [type="submit"]')?.disabled
    && !document.querySelector(".fb-card-add:disabled") && !document.querySelector("#main-content").textContent.includes("Carregando seus feedbacks"), result);
  await flush(page); await flush(page);
  assert.ok(await page.evaluate(`(${test})(document.activeElement)`), `foco: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))}`);
};
const listHeight = (page) => page.locator(".student-feedback .feedback-list").evaluate((el) => el.getBoundingClientRect().height);
// Resultado do envio na tela e avisos temporários (que não devem aparecer no Feedback do aluno).
const outcome = (page) => page.evaluate(() => ({ sent: document.getElementById("fb-sent")?.textContent ?? null, failure: document.getElementById("fb-send-error")?.innerText.replace(/\s+/g, " ") ?? null,
  files: document.getElementById("fb-files-error")?.textContent ?? null, partial: document.querySelector(".fb-partial p")?.textContent ?? null,
  notices: [...document.querySelectorAll("#notices .notice")].map((n) => n.textContent) }));
// O elemento focado inteiro na janela e acima da barra inferior fixa; mais alto que esse espaço (texto a 200% em 320 px),
// com o começo no primeiro quarto da janela, para a leitura começar dele.
const inView = (page) => page.evaluate(() => { const el = document.activeElement, r = el.getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
  const limit = getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight;
  return r.top >= 0 && (r.bottom <= limit + 0.5 || (r.height > limit && r.top <= limit / 4)); });

test("C1: mensagens curtas inteiras; longas (mais de 4 linhas na largura atual) com 3 linhas, reticências e o botão; nada some do DOM nem da linha de situação, data e anexos", async () => {
  for (const [width, height, text] of [[1440, 900, 1], [768, 1024, 1], [390, 844, 1], [390, 844, 2], [320, 568, 2]]) {
    const label = `${width}×${height} texto ${text * 100}%`;
    const { context, page, api } = await open({ width, height, text, items: MIXED });
    const list = await messages(page);
    for (const [index, m] of list.entries()) {
      assert.equal(m.text, MIXED[index].description, `${label} ${m.title}: o texto inteiro continua no DOM`);
      assert.equal(m.long, m.full > 4, `${label} ${m.title}: longa só com mais de 4 linhas (${m.full})`);
      if (m.long) {
        assert.equal(m.shown, 3, `${label} ${m.title}: 3 linhas à vista`);
        assert.deepEqual(m.toggle, { label: "Ler mensagem completa", expanded: "false", controls: true, h: m.toggle?.h }, `${label} ${m.title}`);
        assert.ok(m.toggle.h >= 44, `${label} ${m.title}: alvo de 44 px`);
      } else {
        assert.equal(m.shown, m.full, `${label} ${m.title}: inteira`);
        assert.equal(m.toggle, null, `${label} ${m.title}: sem botão`);
      }
    }
    // Quatro linhas: inteira em qualquer largura; cinco: recolhida; a longa e a perto do limite: recolhidas.
    assert.deepEqual(list.slice(1, 4).map((m) => m.long).concat(list[5].long), [false, true, true, true], label);
    // A situação, a data e os anexos continuam à vista na recolhida.
    assert.equal(list[2].state, "Em análise");
    assert.match(list[2].meta, /^Bug · enviado em \d+ de setembro de 2026 · a partir de Minhas atividades · 2 anexos$/);
    // Reticências na última linha à vista (o navegador desenha com line-clamp), e o resto não aparece por baixo da caixa
    // (o ponto logo abaixo dela é do item, não do texto).
    assert.deepEqual(await page.locator(".fb-entry-text.is-long.is-collapsed").first().evaluate((el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect();
      return [getComputedStyle(el).webkitLineClamp, document.elementFromPoint(r.left + 8, r.bottom + 2) === el]; }), ["3", false], `${label}: recolhida sem vazar`);
    // Sem nenhuma ação visível (mensagem curta, sem anexos, situação fechada), a linha de ações não ocupa espaço: o item
    // termina no texto (sem o vão e a margem de uma linha vazia).
    if (!list[4].long) {
      const gap = await page.locator(".student-feedback .feedback-list > li").nth(4).evaluate((li) => {
        const text = li.querySelector(".fb-entry-text").getBoundingClientRect().bottom, st = getComputedStyle(li), end = li.getBoundingClientRect().bottom - parseFloat(st.paddingBottom) - parseFloat(st.borderBottomWidth);
        return { title: li.querySelector("h3").textContent, gap: end - text }; });
      assert.ok(gap.title === "Média" && gap.gap < 1, `${label}: linha de ações vazia sem espaço ${JSON.stringify(gap)}`);
    }
    assert.deepEqual([api.errors, api.blocked], [[], []], label);
    await context.close();
  }
  // A medida é da largura atual: a mensagem média é curta no desktop e longa no celular com o texto a 200%.
  const wide = await open({ width: 1440, height: 900, items: MIXED });
  assert.equal((await messages(wide.page))[4].long, false);
  await wide.context.close();
  const narrow = await open({ width: 390, height: 844, text: 2, items: MIXED });
  assert.equal((await messages(narrow.page))[4].long, true);
  await narrow.context.close();
  // O texto do sistema muda sem a janela mudar (configuração do navegador): a medida acompanha.
  const live = await open({ width: 390, height: 844, items: MIXED });
  assert.deepEqual([(await messages(live.page))[4].long, await toggleOf(live.page, "Média").isVisible()], [false, false]);
  const cdp = await live.context.newCDPSession(live.page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
  await live.page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 32);
  await live.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100)))));
  assert.deepEqual([(await messages(live.page))[4].shown, await toggleOf(live.page, "Média").isVisible()], [3, true]);
  await live.context.close();
});

test("C2: abrir e recolher — mensagem inteira com as quebras de linha, aria-expanded, foco no botão; recolhida, o botão continua à vista acima da barra; menos altura que tudo aberto", async () => {
  for (const [width, height, text] of [[1440, 900, 1], [390, 844, 1], [390, 844, 2]]) {
    const label = `${width}×${height} texto ${text * 100}%`;
    const { context, page } = await open({ width, height, text, items: MIXED });
    const collapsedHeight = await listHeight(page);
    await press(page, "Longa com endereço");
    const opened = (await messages(page))[3];
    assert.equal(opened.shown, opened.full, `${label}: inteira`);
    assert.deepEqual([opened.collapsed, opened.toggle.label, opened.toggle.expanded], [false, "Recolher mensagem", "true"], label);
    assert.equal(await page.locator("#fb-text-20261010T120000000000-00000004").innerText(), MIXED[3].description, `${label}: quebras de linha preservadas`);
    const focused = () => page.evaluate(() => document.activeElement.dataset.fbMessage);
    assert.equal(await focused(), "20261010T120000000000-00000004", `${label}: o foco fica no botão`);
    // Quem leu até o fim tem o botão no pé da janela; recolher pelo teclado encolhe o texto acima dele, que volta à vista
    // (acima da barra inferior no celular) em vez de ficar lá em cima, fora da tela.
    await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); scrollBy(0, r.bottom - innerHeight + 80); });
    await page.keyboard.press("Enter");
    assert.deepEqual([(await messages(page))[3].shown, await focused()], [3, "20261010T120000000000-00000004"], label);
    assert.ok(await inView(page), `${label}: botão à vista depois de recolher`);
    // Tudo aberto ocupa mais do que a lista recolhida (a economia é a razão da prévia).
    for (const title of ["Cinco linhas", "Longa com endereço", "Perto do limite"]) await press(page, title);
    if (await toggleOf(page, "Média").isVisible()) await press(page, "Média");
    const expandedHeight = await listHeight(page);
    assert.ok(collapsedHeight < expandedHeight * 0.75, `${label}: recolhida ${Math.round(collapsedHeight)} px × aberta ${Math.round(expandedHeight)} px`);
    assert.ok((await messages(page)).every((m) => m.shown === m.full), `${label}: todas inteiras depois de abrir`);
    await context.close();
  }
});

test("C3: o estado de cada mensagem é do feedback (id), não da posição — sobrevive a renders, ao Carregar mais (com erro e com a lista em carregamento) e à recarga depois de um envio", async () => {
  const { context, page, api } = await open({ items: LONGS });
  await press(page, "Longo 2");
  await press(page, "Longo 19");
  const open_ = async () => (await messages(page)).filter((m) => m.toggle?.expanded === "true").map((m) => m.title);
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19"]);
  // Render qualquer (imagem escolhida no formulário): nada se recolhe.
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("a.png")]);
  await page.locator(".fb-file").waitFor();
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19"]);
  // Carregar mais: com a página retida, a tela é redesenhada (Carregando…) e as abertas continuam; com erro, também.
  api.mine = "error-more";
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await page.locator('.student-feedback .fb-list-state[role="alert"]').waitFor();
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19"], "erro no Carregar mais");
  api.mine = "ok";
  const held = api.holdMine = { arrived: deferred(), gate: deferred() };
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await held.arrived.promise;
  assert.equal(await page.locator(".fb-more").innerText(), "Carregando…");
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19"], "lista em carregamento");
  held.gate.resolve();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 25);
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19"], "os novos chegam recolhidos");
  await press(page, "Longo 23");
  // Envio: a lista recarrega a primeira página com o novo no topo (todos descem uma posição) e as abertas seguem pelo id.
  await fill(page, { description: LINES5 + "\nNovo" });
  const reload = api.holdMine = { arrived: deferred(), gate: deferred() };
  await submit(page).click();
  await reload.arrived.promise;
  reload.gate.resolve();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 20);
  const after = await messages(page);
  assert.deepEqual(after.filter((m) => m.toggle?.expanded === "true").map((m) => m.title), ["Longo 2", "Longo 19"]);
  assert.deepEqual([after[1].title, after[1].toggle.expanded, after[2].title, after[2].toggle.expanded], ["Longo 1", "false", "Longo 2", "true"], "pelo id, não pela posição");
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 26);
  assert.deepEqual(await open_(), ["Longo 2", "Longo 19", "Longo 23"]);
  // Sair da tela e voltar: começa tudo recolhido (outra lista).
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 20);
  assert.deepEqual(await open_(), []);
  assert.deepEqual(api.errors, []);
  await context.close();
});

test("C4: troca de usuário — mensagens abertas, motivo de falha e arquivos recusados de A não aparecem para B, nem com um envio de A terminando depois da troca", async () => {
  const A = "aluna.a@example.test", B = "aluno.b@example.test", shared = "20261001T120000000000-cccccccc";
  const itemsFor = { [A]: [item(1, { id: shared, title: "Mensagem de A", description: `${LINES5}\nprivado de A` })],
    [B]: [item(2, { id: shared, title: "Mensagem de B", description: `${LINES5}\nde B` })] };
  const { context, page, api } = await open({ from: null, cohorts: [], users: [A, B, B], itemsFor });
  await press(page, "Mensagem de A");
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("a.svg", "image/svg+xml", Buffer.from("<svg/>"))]);
  await either(page, "#fb-files-error");
  assert.equal(await page.locator("#fb-files-error").count(), 1, "A: recusa no formulário");
  // Envio de A retido no servidor; A sai, B entra; a resposta (429) chega depois.
  await fill(page, { title: "Envio de A" });
  api.post = "429";
  const hold = api.holdPost = { arrived: deferred(), gate: deferred() };
  await submit(page).click();
  await hold.arrived.promise;
  await page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
  await page.getByRole("button", { name: "Verificar novamente" }).click();
  await page.waitForFunction((b) => window.__state.me?.email === b, B);
  // B já está no Feedback quando a resposta (429) do envio de A chega.
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".student-feedback .feedback-list h3")?.textContent === "Mensagem de B");
  hold.gate.resolve();
  await flush(page); await flush(page);
  const b = await messages(page);
  assert.deepEqual([b.length, b[0].title, b[0].collapsed, b[0].shown, b[0].toggle.expanded], [1, "Mensagem de B", true, 3, "false"], "o mesmo id em B começa recolhido");
  assert.deepEqual(await outcome(page), { sent: null, failure: null, files: null, partial: null, notices: [] }, "nada do resultado de A");
  assert.doesNotMatch(await page.locator("main").innerText(), /privado de A|Envio de A|Envie imagens/);
  assert.deepEqual(api.errors, []);
  await context.close();
});

test("C5: teclado — o botão da mensagem vem logo depois do texto e antes das ações de anexos; Enter e espaço abrem e recolhem; contorno inteiro; os escondidos ficam fora do Tab", async () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page } = await open({ width, height, items: MIXED });
    await submit(page).focus();
    const order = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      const a = await page.evaluate(() => { const el = document.activeElement; return `${el.closest("li")?.querySelector("h3")?.textContent}: ${el.textContent}`; });
      order.push(a);
    }
    // A média só tem botão onde passa de 4 linhas; os escondidos não entram no Tab.
    const medium = await toggleOf(page, "Média").isVisible();
    assert.deepEqual(order, ["Curta: Adicionar imagem", "Quatro linhas: Adicionar imagem", "Cinco linhas: Ler mensagem completa", "Cinco linhas: Ver anexos", "Cinco linhas: Adicionar imagem",
      "Longa com endereço: Ler mensagem completa", medium ? "Média: Ler mensagem completa" : "Perto do limite: Ler mensagem completa"], `${width}px`);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press(" ");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-expanded")), "true", `${width}px: espaço abre`);
    await page.evaluate(() => document.activeElement.scrollIntoView({ block: "center" }));
    assert.deepEqual(await ringOnScreen(page, null), [], `${width}px: contorno do botão`);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-expanded")), "false", `${width}px: Enter recolhe`);
    await context.close();
  }
});

test("C6: sem rolagem lateral, texto fora do lugar nem controle recortado com mensagens abertas e recolhidas e com cada resultado do envio, em 320–1440 px, texto e zoom a 200%", async () => {
  const cases = [[1440, 900, 1], [768, 1024, 1], [390, 844, 1], [320, 568, 1], [390, 844, 2], [320, 568, 2], [720, 450, 1, 2]];
  const check = (page) => page.evaluate(() => {
    const res = { overflowX: document.documentElement.scrollWidth - innerWidth, outside: [], clipped: [], small: [] };
    const scope = document.querySelector(".student-feedback"), box = scope.getBoundingClientRect();
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (!n.data.trim() || n.parentElement.closest(".sr-only, textarea")) continue;
      for (const word of n.data.matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(n, word.index); r.setEnd(n, word.index + word[0].length);
        for (const x of r.getClientRects()) if (x.left < box.left - 0.5 || x.right > box.right + 0.5) res.outside.push(word[0].slice(0, 30)); } }
    for (const el of scope.querySelectorAll("a, button, input, textarea, label.fb-type-option, .fb-send-error, .fb-partial, .feedback-success, .fb-error")) {
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      // Campo de uma linha rola o próprio texto (o título preenchido passa da largura a 200%): só a caixa conta.
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || (!el.matches("input") && el.scrollWidth > el.clientWidth + 1)) res.clipped.push((el.textContent || el.id || el.tagName).trim().slice(0, 30));
      if (el.matches("a, button, input, textarea, label") && !el.matches('input[type="radio"]') && r.height < 44 - 0.5) res.small.push(`${(el.textContent || el.id).trim().slice(0, 30)} ${Math.round(r.height)}`);
    }
    return res;
  });
  for (const [width, height, text, scale = 1] of cases) {
    const label = `${width}×${height} texto ${text * 100}%${scale > 1 ? " zoom 200%" : ""}`;
    for (const mode of ["network", "duplicate", "partial", "refused"]) {
      const { context, page, api } = await open({ width, height, text, scale, items: MIXED });
      for (const title of ["Longa com endereço", "Perto do limite"]) await press(page, title);
      if (mode === "refused") await pick(page, page.locator('[data-fb-pick="form"]'), [image(`${LONG_FILE}.svg`, "image/svg+xml", Buffer.from("<svg/>"))]);
      else {
        if (mode === "partial") { await pick(page, page.locator('[data-fb-pick="form"]'), [image(LONG_FILE), image("b.png")]); await page.locator(".fb-file").nth(1).waitFor(); api.s3Fail = 1; }
        else api.post = mode;
        await fill(page);
        await submit(page).click();
      }
      await page.waitForFunction(() => document.querySelector("#fb-send-error, #fb-sent, .fb-partial, #fb-files-error, #notices .notice"));
      assert.deepEqual((await outcome(page)).notices, [], `${label} ${mode}: sem aviso temporário`);
      await flush(page);
      const m = await check(page);
      assert.ok(m.overflowX <= 0, `${label} ${mode}: rolagem lateral de ${m.overflowX}px`);
      assert.deepEqual([...new Set(m.outside)], [], `${label} ${mode}: texto fora da tela`);
      assert.deepEqual(m.clipped, [], `${label} ${mode}: recortado`);
      assert.deepEqual(m.small, [], `${label} ${mode}: alvo menor que 44 px`);
      assert.ok(await inView(page), `${label} ${mode}: o resultado focado à vista, acima da barra`);
      // Na coluna estreita (até 30rem), o motivo usa quase toda a largura, sem o recuo largo do desktop.
      if (mode === "network") assert.ok(await page.evaluate(() => { const box = document.querySelector(".student-feedback").getBoundingClientRect().width, text = document.querySelector("#fb-send-error-text").getBoundingClientRect().width;
        return box > parseFloat(getComputedStyle(document.documentElement).fontSize) * 30 || text >= box * 0.85; }), `${label}: motivo com a largura da coluna`);
      assert.deepEqual(api.errors, [], `${label} ${mode}`);
      await context.close();
    }
  }
});

test("C7: confirmação só no formulário e só com resposta do servidor; duplicado diz que já existia e não vira item novo; instrutor e admin com o aviso de sempre", async () => {
  // Criado: confirmação no formulário, com foco, sem aviso temporário.
  const created = await open({ width: 390, height: 844 });
  await fill(created.page);
  await submit(created.page).click();
  await focusOn(created.page, (el) => el?.id === "fb-sent", "#fb-sent");
  assert.deepEqual(await outcome(created.page), { sent: "Feedback enviado com sucesso.", failure: null, files: null, partial: null, notices: [] });
  assert.ok(await inView(created.page), "a confirmação focada à vista, acima da barra");
  await created.context.close();
  // Duplicado (com imagem): o texto diz que já existia; a imagem vai para o feedback existente; a lista não ganha item.
  const dup = await open({ width: 390, height: 844 });
  dup.api.post = "duplicate";
  await pick(dup.page, dup.page.locator('[data-fb-pick="form"]'), [image("mais.png")]);
  await dup.page.locator(".fb-file").waitFor();
  await fill(dup.page);
  await submit(dup.page).click();
  await focusOn(dup.page, (el) => el?.id === "fb-sent", "#fb-sent");
  const seen = await outcome(dup.page);
  assert.deepEqual(seen, { sent: "Este feedback já tinha sido enviado. Ele não foi registrado de novo e continua em Meus feedbacks.", failure: null, files: null, partial: null, notices: [] });
  assert.doesNotMatch(await dup.page.locator("#feedback-form").innerText(), /enviado com sucesso/);
  assert.deepEqual([dup.api.posts.length, dup.api.slots.map((s) => s.feedbackId), (await entries(dup.page)).length], [1, [FEW[0].id], 4]);
  assert.ok(await inView(dup.page));
  await dup.context.close();
  // Andamento: sem resposta do servidor, nenhuma confirmação.
  const pending = await open();
  const hold = pending.api.holdPost = { arrived: deferred(), gate: deferred() };
  await fill(pending.page);
  await submit(pending.page).click();
  await hold.arrived.promise;
  assert.deepEqual(await outcome(pending.page), { sent: null, failure: null, files: null, partial: null, notices: [] });
  hold.gate.resolve();
  await pending.context.close();
  // Instrutor e admin: a tela antiga, com a confirmação no formulário e o aviso de sempre.
  for (const role of ["instructor", "admin"]) {
    const own = await open({ role });
    await own.page.locator(".fb-type-option", { hasText: "Bug" }).click();
    await own.page.locator("#fb-title").fill("Título do instrutor");
    await own.page.locator("#fb-description").fill("Descrição suficiente do instrutor");
    await submit(own.page).click();
    await own.page.waitForFunction(() => document.querySelector(".feedback-success") && !document.querySelector('#feedback-form [type="submit"]').disabled);
    assert.deepEqual(await notices(own.page), [{ error: false, text: "Feedback enviado com sucesso." }], role);
    assert.equal(await own.page.locator(".feedback-success").innerText(), "Feedback enviado com sucesso.");
    await pick(own.page, own.page.locator('[data-fb-pick="form"]'), [image("a.svg", "image/svg+xml", Buffer.from("<svg/>"))]);
    // A escolha é tratada assim que a janela de arquivos fecha; duas idas e voltas de rede bastam para ver o resultado.
    await flush(own.page); await flush(own.page);
    assert.deepEqual([await notices(own.page), await own.page.locator("#fb-files-error").count()], [[{ error: true, text: "Envie imagens PNG, JPEG ou WebP." }], 0], `${role}: recusa no aviso, como antes`);
    await own.context.close();
  }
});

test("C8: falhas ficam no formulário — 409, 429, 500 e rede com o motivo e se o feedback pode ter chegado; persistem em renders; somem na nova tentativa e ao sair; rascunho mantido; um envio por clique", async () => {
  const cases = [["409", "O feedback não foi enviado. Não foi possível enviar agora. Tente novamente. O que você escreveu continua no formulário."],
    ["429", "O feedback não foi enviado. Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde. O que você escreveu continua no formulário."],
    ["500", "Não foi possível confirmar o envio. Erro interno. Tente novamente em instantes. O que você escreveu continua no formulário. Envie de novo: se ele já tiver chegado, não será registrado duas vezes."],
    ["network", "Não foi possível confirmar o envio. A conexão com o portal falhou. O que você escreveu continua no formulário. Envie de novo: se ele já tiver chegado, não será registrado duas vezes."]];
  for (const [mode, expected] of cases) {
    const { context, page, api } = await open({ width: 390, height: 844 });
    api.post = mode;
    // Um arquivo recusado antes: a tentativa de envio tira esse motivo antigo.
    await pick(page, page.locator('[data-fb-pick="form"]'), [image("a.gif", "image/gif")]);
    await either(page, "#fb-files-error");
    assert.equal(await page.locator("#fb-files-error").count(), 1, `${mode}: recusa no formulário`);
    await fill(page);
    await submit(page).click();
    await focusOn(page, (el) => el?.id === "fb-send-error", "#fb-send-error");
    assert.equal(await page.evaluate(() => document.activeElement.id), "fb-send-error", `${mode}: foco no motivo`);
    assert.deepEqual(await outcome(page), { sent: null, failure: expected, files: null, partial: null, notices: [] }, mode);
    // Não só cor: a borda e a marca "!" antes do título do motivo.
    assert.deepEqual(await page.locator("#fb-send-error").evaluate((el) => [getComputedStyle(el).borderLeftWidth, getComputedStyle(el.querySelector("strong"), "::before").content]), ["3px", '"!"'], mode);
    assert.ok(await inView(page), `${mode}: o motivo focado à vista, acima da barra`);
    assert.equal(api.posts.length, 1, `${mode}: um envio`);
    // Outro render (imagem escolhida) não apaga o motivo; o rascunho continua.
    await pick(page, page.locator('[data-fb-pick="form"]'), [image("a.png")]);
    await page.locator(".fb-file").waitFor();
    assert.equal((await outcome(page)).failure, expected, `${mode}: persiste`);
    assert.deepEqual([await page.locator("#fb-title").inputValue(), await page.locator("#fb-description").inputValue()], ["KC de redes aparece sem nota", "A atividade 254 continua sem nota no portal, mas no Canvas já saiu."]);
    // Nova tentativa: o motivo some enquanto envia; com sucesso, só a confirmação.
    api.post = "ok";
    const hold = api.holdPost = { arrived: deferred(), gate: deferred() };
    await submit(page).click();
    await hold.arrived.promise;
    assert.equal((await outcome(page)).failure, null, `${mode}: some durante a nova tentativa`);
    hold.gate.resolve();
    await focusOn(page, (el) => el?.id === "fb-sent", "#fb-sent");
    assert.deepEqual(await outcome(page), { sent: "Feedback enviado com sucesso.", failure: null, files: null, partial: null, notices: [] }, mode);
    assert.equal(api.posts.length, 2);
    await context.close();
  }
  // Pelo teclado (Enter no botão): o motivo recebe o foco com o contorno inteiro.
  const keyboard = await open();
  keyboard.api.post = "429";
  await fill(keyboard.page);
  await submit(keyboard.page).focus();
  await keyboard.page.keyboard.press("Enter");
  await focusOn(keyboard.page, (el) => el?.id === "fb-send-error", "#fb-send-error");
  assert.equal(await keyboard.page.evaluate(() => document.activeElement.id), "fb-send-error");
  assert.deepEqual(await ringOnScreen(keyboard.page, null), []);
  await keyboard.context.close();
  // Sair da tela e voltar: o rascunho fica, o motivo da tentativa anterior não.
  const away = await open();
  away.api.post = "409";
  await fill(away.page);
  await submit(away.page).click();
  await either(away.page, "#fb-send-error");
  assert.equal(await away.page.locator("#fb-send-error").count(), 1);
  await away.page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  await away.page.getByRole("button", { name: "Feedback", exact: true }).click();
  await away.page.locator("#feedback-form").waitFor();
  assert.deepEqual([(await outcome(away.page)).failure, await away.page.locator("#fb-title").inputValue()], [null, "KC de redes aparece sem nota"]);
  await away.context.close();
});

test("C9: imagens — recusadas ficam junto de onde foram escolhidas até a próxima escolha ou envio; falha parcial só reenvia as imagens; nova tentativa e descarte não perdem o foco", async () => {
  const { context, page, api } = await open({ width: 390, height: 844 });
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("desenho.svg", "image/svg+xml", Buffer.from("<svg/>")), image("ok.png")]);
  await focusOn(page, (el) => el?.id === "fb-files-error", "#fb-files-error");
  assert.deepEqual(await outcome(page), { sent: null, failure: null, files: "Envie imagens PNG, JPEG ou WebP.", partial: null, notices: [] });
  assert.equal(await page.locator('[data-fb-pick="form"]').getAttribute("aria-describedby"), "fb-files-error");
  assert.equal(await page.locator(".fb-file").count(), 1, "a válida entra");
  assert.ok(await inView(page));
  // A próxima escolha sem recusa tira o motivo; o foco volta ao botão de adicionar.
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("outra.png")]);
  await page.locator(".fb-file").nth(1).waitFor();
  await flush(page);
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-fb-pick="form"]')), true, "foco no botão de adicionar");
  assert.equal((await outcome(page)).files, null);
  // Remover leva o foco ao botão de adicionar (o Remover some com a imagem); escolhe a de novo.
  await page.locator(".fb-files > li").last().locator(".fb-remove").click();
  await flush(page);
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-fb-pick="form"]')), true, "foco depois de Remover");
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("outra.png")]);
  await page.locator(".fb-file").nth(1).waitFor();
  // Terceira imagem: o botão some e o foco vai ao Remover da última.
  await pick(page, page.locator('[data-fb-pick="form"]'), [image("terceira.png")]);
  await page.locator(".fb-file").nth(2).waitFor();
  await flush(page);
  assert.equal(await page.evaluate(() => document.activeElement.matches(".fb-files > li:last-child .fb-remove")), true, "foco no Remover da última");
  // Falha parcial: o feedback não é enviado de novo; a nova tentativa usa o mesmo slot e leva o foco à confirmação.
  api.s3Fail = 1;
  await fill(page);
  await submit(page).click();
  await page.locator(".fb-partial").waitFor();
  assert.deepEqual(await outcome(page), { sent: null, failure: null, files: null, partial: "Feedback enviado, mas não foi possível anexar uma das imagens. Tente anexar de novo ou descarte a que faltou: o texto não é enviado outra vez.", notices: [] });
  const token = api.slots[0].clientToken;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await focusOn(page, (el) => el?.id === "fb-sent", "#fb-sent");
  assert.deepEqual([api.posts.length, api.slots.at(-1).clientToken, (await outcome(page)).notices], [1, token, []], "só a imagem que faltou, sem aviso");
  await context.close();
  // Descartar: o foco vai ao botão de adicionar imagem, sem aviso.
  const discard = await open({ width: 390, height: 844 });
  await pick(discard.page, discard.page.locator('[data-fb-pick="form"]'), [image("a.png")]);
  await discard.page.locator(".fb-file").waitFor();
  discard.api.s3Fail = 1;
  await fill(discard.page);
  await submit(discard.page).click();
  await discard.page.locator(".fb-partial").waitFor();
  await discard.page.getByRole("button", { name: "Descartar imagens" }).click();
  await discard.page.locator(".fb-partial").waitFor({ state: "detached" });
  assert.equal(await discard.page.evaluate(() => document.activeElement.matches('[data-fb-pick="form"]')), true, "foco no botão de adicionar");
  assert.deepEqual([(await outcome(discard.page)).notices, discard.api.posts.length], [[], 1]);
  await discard.context.close();
  // Pelo feedback já enviado: o arquivo recusado fica no próprio item, com o foco; o envio seguinte tira o motivo.
  const card = await open({ width: 390, height: 844 });
  const first = card.page.locator(".student-feedback .feedback-list > li").first();
  await pick(card.page, first.getByRole("button", { name: "Adicionar imagem" }), [image("a.gif", "image/gif")]);
  await focusOn(card.page, (el) => el?.id?.startsWith("fb-card-error-"), ".fb-entry .fb-error");
  assert.deepEqual(await notices(card.page), []);
  assert.equal(await first.locator(".fb-error").innerText(), "Envie imagens PNG, JPEG ou WebP.");
  assert.equal(await card.page.locator(".student-feedback .fb-error").count(), 1, "só no item escolhido");
  assert.equal(await first.locator(".fb-card-add").getAttribute("aria-describedby"), await first.locator(".fb-error").getAttribute("id"));
  await pick(card.page, first.getByRole("button", { name: "Adicionar imagem" }), [image("b.png")]);
  await card.page.waitForFunction(() => !document.querySelector(".fb-card-add")?.disabled && (document.querySelector(".fb-card-progress") || document.querySelector("#notices .notice")));
  assert.equal(await first.evaluate((li) => li.querySelector(".fb-card-progress")?.textContent ?? null), "Imagem anexada ao feedback.");
  assert.deepEqual([await card.page.locator(".student-feedback .fb-error").count(), await notices(card.page)], [0, []]);
  // Depois de uma imagem anexada, um arquivo recusado no mesmo item: só a recusa (nada de "Imagem anexada" de antes).
  await pick(card.page, first.getByRole("button", { name: "Adicionar imagem" }), [image("c.gif", "image/gif")]);
  await focusOn(card.page, (el) => el?.id?.startsWith("fb-card-error-"), ".fb-entry .fb-error");
  assert.deepEqual([await first.locator(".fb-card-progress").count(), await card.page.getByText("Imagem anexada ao feedback.").count()], [0, 0]);
  await card.context.close();
});

test("C10: o foco que um render perde não volta a um controle antigo — Ver anexos, abrir mensagem e o envio deixam o foco onde a ação diz", async () => {
  // Ver anexos logo depois do render que guardou o título (antes da consolidação, o foco ia parar no título).
  const direct = await open({ items: MIXED, go: false, mine: "hold" });
  const first = direct.api.holdMine = { arrived: deferred(), gate: deferred() };
  await direct.page.getByRole("button", { name: "Feedback", exact: true }).click();
  await first.arrived.promise;
  await direct.page.locator("#fb-title").focus();
  first.gate.resolve();
  await direct.page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 6);
  const withFiles = direct.page.locator(".student-feedback .feedback-list > li").nth(2);
  await withFiles.getByRole("button", { name: "Ver anexos" }).click();
  await withFiles.locator(".fb-gallery .fb-thumb img").first().waitFor();
  assert.equal(await direct.page.evaluate(() => document.activeElement.textContent), "Ocultar anexos");
  await direct.context.close();
  // O título recebe o foco enquanto a lista carrega: o render que mostra a lista o guarda como "último controle com nome".
  const { context, page, api } = await open({ items: MIXED, go: false, mine: "hold" });
  const held = api.holdMine = { arrived: deferred(), gate: deferred() };
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await held.arrived.promise;
  await page.locator("#fb-title").focus();
  held.gate.resolve();
  await page.waitForFunction(() => document.querySelectorAll(".student-feedback .feedback-list > li").length === 6);
  assert.equal((await active(page)).id, "fb-title");
  // Abrir a mensagem: o foco fica no botão dela (não volta ao título).
  await press(page, "Cinco linhas");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.fbMessage), "20261010T120000000000-00000003");
  // Ver anexos do mesmo item (C7.5): o foco fica em Ver/Ocultar anexos, não no botão da mensagem nem no título.
  const item3 = page.locator(".student-feedback .feedback-list > li").nth(2);
  await item3.getByRole("button", { name: "Ver anexos" }).click();
  await item3.locator(".fb-gallery .fb-thumb img").first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Ocultar anexos");
  // Envio que falha: o foco vai ao motivo, não a um controle de antes.
  api.post = "409";
  await fill(page);
  await submit(page).click();
  await focusOn(page, (el) => el?.id === "fb-send-error", "#fb-send-error");
  assert.equal(await page.evaluate(() => document.activeElement.id), "fb-send-error");
  assert.deepEqual(api.errors, []);
  await context.close();
});

// PR #3 (fechamento, B2): a sessão acaba durante o envio do aluno — expirada antes de o pedido sair (o api.js recusa sem
// enviar) ou com 401 do servidor. O portal volta à entrada pública e o aviso diz o motivo, como antes do piloto (busy);
// nada de "enviado", nenhum POST repetido, nenhum resto do rascunho ou do motivo na tela. Antes, o erro ficava preso ao
// rascunho, fora da vista, e a pessoa caía na entrada sem saber por quê.
test("PR3-B2: sessão encerrada durante o envio do Feedback do aluno — entrada pública com o aviso do motivo, sem sucesso nem repetição", async () => {
  for (const mode of ["expirada antes de sair", "401"]) {
    const { context, page, api } = await open();
    await fill(page);
    if (mode === "401") api.post = "401";
    else await page.evaluate(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() - 1000 })));
    await submit(page).click();
    await page.getByRole("button", { name: "Entrar no meu portal" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("#notices .notice").length > 0, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await notices(page), [{ error: true, text: "Sua sessão expirou. Entre novamente." }], `${mode}: o aviso diz o motivo`);
    await page.waitForTimeout(400);
    assert.equal(api.posts.length, mode === "401" ? 1 : 0, `${mode}: nenhum envio repetido (e nenhum quando a sessão já tinha expirado)`);
    const main = await page.locator("#app").innerText();
    assert.doesNotMatch(main, /Feedback enviado|enviado com sucesso|já tinha sido enviado|KC de redes aparece sem nota/, `${mode}: nada de sucesso nem do rascunho na entrada`);
    assert.equal(await page.locator("#fb-send-error, #fb-sent, .student-feedback").count(), 0, `${mode}: nada do formulário na entrada`);
    assert.deepEqual(api.errors, [], mode);
    await context.close();
  }
});

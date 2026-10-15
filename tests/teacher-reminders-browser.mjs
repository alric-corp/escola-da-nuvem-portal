// Expansão 7 do piloto visual: Lembretes (docs/design-visual.md), com API fictícia (nunca AWS, SES, e-mail, agendamento ou
// configuração real; dados sintéticos). Cobre o que as duas telas prometem: em "Lembretes", o remetente como a única
// superfície, com a situação por texto e forma e o motivo do servidor, a verificação com andamento e resultado na tela e os
// dois caminhos de envio; em "Lembretes em lote", quem recebe e quem fica de fora por motivo, a mensagem, o envio como a única
// superfície e a lista; a pergunta do envio; durante o envio, Enviar parado e um pedido só; sucesso só depois da resposta, sem
// confundir "aceito" com entrega; recusa, conflito e dúvida na tela (a dúvida leva à nova consulta); troca de turma, de tela e
// de usuário durante as operações; composição sem rolagem lateral nem controle escondido em 320–1440 px, texto e zoom a 200%
// e janela baixa; teclado com contorno; estados e papéis.
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

// Turma sintética: o filtro "Com atividades sem nota" do painel seleciona 9 (Felipe e Kiara sem pendências; Lia, desistente
// no relatório). Na prévia, como evaluate_recipient: Bruno já tem lembrete nesta publicação, Diego foi marcado desistente
// depois do relatório e Elisa não tem e-mail no Canvas: 6 de 9 recebem.
const ROWS = [["31000", "Ana Lima", 4], ["31001", "Bruno Reis", 1], ["31002", "Carla Dias", 2], ["31003", "Diego Melo", 3], ["31004", "Elisa Rocha", 1, null],
  ["31005", "Felipe Souza", 0], ["31006", "Gabi Lins", 2], ["31007", "Heitor Prado", 5], ["31008", "Isa Nunes", 1], ["31009", "João Paz", 3], ["31010", "Kiara Luz", 0],
  ["31011", "Lia Mota", 2, undefined, "WITHDRAWN"]];
const STUDENTS = ROWS.map(([id, name, pending, email, participationStatus]) => ({ id, name, email: email === null ? null : `${name.split(" ")[0].toLowerCase()}@example.test`,
  kc: 50 + pending, lab: 80, total: 65, completed: 3, pending, progress: 60, status: pending ? "critical" : "ok", ...(participationStatus ? { participationStatus } : {}) }));
const byId = Object.fromEntries(STUDENTS.map((s) => [s.id, s]));
const PUBLICATION = { id: "p13", publishedAt: "2026-10-09T21:00:00Z" };
const report = () => ({ cohort: "BRSA0267", publication: PUBLICATION, students: STUDENTS, activities: [], history: [], thresholds: { kc: 70, lab: 95 },
  focus: { activityIds: [], version: null }, updatedAt: PUBLICATION.publishedAt, updateKind: "canvas" });
const READY = { ready: true, reason: "Remetente verificado e envio habilitado." };
const NOT_VERIFIED = "Confirme o e-mail de verificação que o SES enviou ao seu endereço institucional.";
const SENDERS = {
  pronto: (email) => ({ enabled: true, sender: email, ...READY }),
  pendente: (email) => ({ enabled: true, sender: email, ready: false, reason: NOT_VERIFIED }),
  desligado: (email) => ({ enabled: false, sender: email, ready: false, reason: "O envio de lembretes está desativado nesta instalação." }),
};
const ERRORS = {
  401: [401, "Sua sessão expirou. Entre novamente."],
  403: [403, "Use seu e-mail institucional para enviar lembretes."],
  409: [409, "As notas foram atualizadas. Consulte a prévia de novo antes de enviar."],
  429: [429, null],
  500: [500, "Erro interno."],
  503: [503, null],
};
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

// control: sender ("pronto" | "pendente" | "desligado"), senderMode / verifyMode / previewMode / sendMode ("ok" | chave de ERRORS |
// "network" | "lost": o servidor processa e a resposta se perde), sent / withdrawn / failIds / unsureIds (ids), cut (a publicação
// muda depois de N envios), raceIds (outra reserva registra o aluno entre a avaliação e a reserva: conflito, como cut), ses
// (prontidão na prévia), confirm, holds ("sender", "verify", "preview", "send"), emails (/me).
async function open({ width = 1440, height = 900, text = 1, role = "instructor", emails, view = "overview", sender = "pronto", long = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-13T15:00:00-03:00"));
  const people = emails || [role === "admin" ? "admin@example.test" : "instrutor@example.test"];
  const errors = [], control = { sender, senderMode: "ok", verifyMode: "ok", previewMode: "ok", sendMode: "ok", sent: new Set(["31001"]), withdrawn: new Set(["31003"]),
    failIds: new Set(), unsureIds: new Set(), raceIds: new Set(), cut: null, ses: READY, confirm: true, holds: {}, dialogs: [], requests: [], me: 0, email: people[0], long };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return control.confirm ? dialog.accept() : dialog.dismiss(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view }) => {
    if (sessionStorage.getItem("e7")) return;
    sessionStorage.setItem("e7", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view, filter: "pending" }));
  }, { email: people[0], view });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const fail = (route, mode) => route.fulfill(ERRORS[mode][1] ? { status: ERRORS[mode][0], json: { error: ERRORS[mode][1] } } : { status: ERRORS[mode][0], contentType: "text/plain", body: "Service Unavailable" });
  const name = (s) => (control.long ? `${s.name} de Albuquerque Cavalcanti Figueiredo Monteiro Nascimento` : s.name);
  const skipOf = (id) => { const s = byId[id]; return !s ? "not-found" : control.withdrawn.has(id) ? "withdrawn" : !s.email ? "no-email" : !s.pending ? "no-pending" : control.sent.has(id) ? "already-sent" : null; };
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), code = endpoint.split("/")[2], body = request.postData() ? request.postDataJSON() : null;
    control.requests.push(`${request.method()} ${endpoint}`);
    if (endpoint === "/me") { control.email = people[Math.min(control.me++, people.length - 1)]; return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email: control.email } }); }
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true, canvasCourseId: "4436", current: "p13" },
      { code: "BRSA0268", canTeach: role !== "student", autoSync: false, canvasCourseId: null, current: "p13" }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: report() });
    if (endpoint.endsWith("/reminder-settings")) {
      const mode = control.senderMode, email = control.long ? "maria.fernanda.albuquerque.de.oliveira.cavalcanti.instrutora@example.test" : control.email;
      await hold("sender");
      if (mode === "network") return route.abort("failed");
      if (ERRORS[mode]) return fail(route, mode);
      return route.fulfill({ json: SENDERS[control.sender](email) });
    }
    if (endpoint.endsWith("/verify-sender")) {
      const mode = control.verifyMode;
      await hold("verify");
      if (mode === "network") return route.abort("failed");
      if (ERRORS[mode]) return fail(route, mode);
      return route.fulfill({ json: { ...SENDERS[control.sender](control.email), reason: "Confirmação solicitada. Abra o link que a AWS enviou." } });
    }
    if (endpoint.endsWith("/pending-preview-batch")) {
      const mode = control.previewMode;
      const recipients = body.studentIds.map((id) => ({ id, name: byId[id] ? name(byId[id]) : null, email: byId[id]?.email ?? null, pending: byId[id]?.pending ?? 0, skip: skipOf(id) }));
      const first = recipients.find((r) => !r.skip);
      const sample = first ? { from: control.email, replyTo: control.email, to: first.email, subject: `Podemos ajudar? Atividades sem nota · ${code}`,
        text: `Olá, ${first.name}!\n\nHá atividades sem nota registrada na turma ${code}, conforme a atualização de 2026-10-09.${control.long ? `\n\n${"Uma linha extensa da mensagem de exemplo, ".repeat(12)}` : ""}` } : null;
      await hold("preview");
      if (mode === "network") return route.abort("failed");
      if (ERRORS[mode]) return fail(route, mode);
      return route.fulfill({ json: { publicationId: "p13", publishedAt: PUBLICATION.publishedAt, ses: control.ses, sample, recipients } });
    }
    if (endpoint.endsWith("/send-reminders")) {
      const mode = control.sendMode;
      // _reminder_batch: com 4xx nada sai; senão cada aluno é avaliado de novo e reservado (a reserva marca "já registrado").
      const results = [];
      if (!ERRORS[mode] && mode !== "network") {
        let stopped = false, sent = 0;
        for (const id of body.studentIds) {
          const skip = skipOf(id);
          if (stopped || skip) { results.push({ id, name: byId[id]?.name ?? null, status: "skipped", reason: stopped ? "publication-changed" : skip }); continue; }
          if (control.cut !== null && sent >= control.cut) { stopped = true; results.push({ id, name: byId[id].name, status: "skipped", reason: "publication-changed" }); continue; }
          if (control.raceIds.has(id)) { control.sent.add(id); stopped = true; results.push({ id, name: byId[id].name, status: "skipped", reason: "publication-changed" }); continue; }
          if (control.failIds.has(id) || control.unsureIds.has(id)) { if (control.unsureIds.has(id)) control.sent.add(id); results.push({ id, name: byId[id].name, status: "failed" }); continue; }
          control.sent.add(id); sent++;
          results.push({ id, name: byId[id].name, status: "sent" });
        }
      }
      await hold("send");
      if (mode === "network" || mode === "lost") return route.abort("failed");
      if (ERRORS[mode]) return fail(route, mode);
      return route.fulfill({ json: { publicationId: "p13", results } });
    }
    if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
    if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
    if (endpoint.endsWith("/settings")) return route.fulfill({ json: {} });
    if (endpoint === "/admin/feedback") return route.fulfill({ json: { items: [], nextCursor: null, summary: {} } });
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin + "/");
  // Só depois do boot e sem pedido pendente; nada aqui depende da marcação da tela (no RED, a tela antiga falha por asserção).
  await page.locator(".layout").first().waitFor();
  await page.waitForLoadState("networkidle");
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const notices = (page) => page.locator("#notices .notice span").allTextContents();
const closeNotice = async (page) => { if (await page.locator("#notices .notice button").count()) await page.locator("#notices .notice button").first().click(); };
const read = async (locator, fn = (l) => l.innerText()) => ((await locator.count()) ? fn(locator.first()) : null);
const text = async (locator) => ((await read(locator)) ?? "").replace(/\s+/g, " ").trim();
const soon = (locator, timeout = 3000) => locator.first().waitFor({ timeout }).catch(() => {});
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} ${(a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim()}`.trim(); });
const requests = (control, op) => control.requests.filter((r) => r.endsWith(`/${op}`)).length;
const sendButton = (page) => page.locator('[data-action="send-reminders-batch"]');
const done = (page, op) => Promise.race([page.waitForResponse((r) => r.url().endsWith(`/${op}`)), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith(`/${op}`) })]).catch(() => null);
async function goSender(page) {
  const loaded = done(page, "reminder-settings");
  await page.locator('.sidebar nav [data-view="reminders"]').click();
  await loaded;
  await settle(page);
}
async function goBatch(page) {
  const loaded = done(page, "pending-preview-batch");
  await page.locator('[data-action="reminders-batch"]').click();
  await loaded;
  await page.waitForTimeout(60);
  await settle(page);
}
// Do menu ao lote: o painel volta no filtro "Todos"; o lote sai do filtro "Com atividades sem nota".
async function toBatch(page) {
  await page.locator('.sidebar nav [data-view="overview"]').click();
  await soon(page.locator("#status-filter"));
  await page.locator("#status-filter").selectOption("pending");
  await soon(page.locator('[data-action="reminders-batch"]'));
  await goBatch(page);
}
async function send(page) {
  const finished = done(page, "send-reminders");
  await sendButton(page).click();
  await finished;
  await page.waitForTimeout(80);
  await settle(page);
}
const pageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// Controles e textos recortados pela janela ou por um ancestral com overflow, e texto cortado dentro do controle.
const clipped = (page) => page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(".teacher-reminders :is(button, a, h1, h2, h3, h4, .trem-name, .trem-state, .trem-op, .trem-address, .trem-text, dd)")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push(`fora: ${(el.textContent || el.tagName).trim().slice(0, 40)}`);
    if (el.matches("button") && el.scrollWidth > el.clientWidth + 1) bad.push(`cortado: ${el.textContent.trim().slice(0, 40)}`);
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
// Forma da situação (o ::before da linha): visto, anel ou traço, com tamanho.
const shapeOf = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = getComputedStyle(el, "::before");
  return { content: b.content, width: parseFloat(b.width), check: b.borderRightStyle === "solid" && b.borderBottomStyle === "solid", ring: b.backgroundImage.startsWith("radial-gradient"), dash: b.borderTopStyle === "solid" && parseFloat(b.borderTopWidth) > 0 && b.borderRightStyle !== "solid" }; }, selector);

test("RB1: Lembretes — a situação do remetente por texto e forma (pronto, falta confirmar, desligado), o e-mail uma vez e a única superfície; o atalho leva ao filtro do painel", async () => {
  const shapes = { pronto: "check", pendente: "ring", desligado: "dash" };
  for (const [sender, shape] of Object.entries(shapes)) {
    const { context, page, errors } = await open({ view: "reminders", sender });
    await soon(page.locator("#trem-sender-status"));
    assert.equal(await page.locator(".teacher-reminders .is-action").count(), 1, sender);
    assert.equal(await read(page.locator(".teacher-reminders .is-action"), (l) => l.evaluate((el) => el.classList.contains("trem-sender"))), true, `${sender}: o remetente é a superfície`);
    assert.equal(await page.locator(".teacher-reminders").getByText("instrutor@example.test", { exact: true }).count(), 1, `${sender}: o e-mail uma vez`);
    const status = await text(page.locator("#trem-sender-status"));
    assert.equal(status, { pronto: "Pronto para enviar. Remetente verificado e envio habilitado.", pendente: `Ainda não é possível enviar. ${NOT_VERIFIED}`,
      desligado: "O envio de lembretes está desativado nesta instalação." }[sender]);
    const form = await shapeOf(page, "#trem-sender-status");
    assert.ok(form && form.content !== "none" && form.width > 0 && form[shape], `${sender}: forma ${shape} ${JSON.stringify(form)}`);
    assert.equal(await page.locator('[data-action="verify-sender"]').count(), sender === "pendente" ? 1 : 0, sender);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { context, page } = await open({ view: "reminders" });
  await soon(page.locator("#trem-sender-status"));
  const order = await page.evaluate(() => ["trem-sender-title", "trem-how-title", "trem-rules-title"].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? null));
  assert.ok(order.every((v, i) => v !== null && (i === 0 || v > order[i - 1])), `remetente, como enviar, regras: ${JSON.stringify(order)}`);
  const shortcut = page.getByRole("button", { name: "Ver alunos com atividades sem nota", exact: true });
  await soon(shortcut);
  if (await shortcut.count()) await shortcut.click();
  await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
  assert.equal(await read(page.locator("#status-filter"), (l) => l.inputValue()), "pending", "o atalho abre o painel no filtro do lote");
  assert.equal(await page.locator('[data-action="reminders-batch"]').count(), 1);
  await context.close();
});

test("RB2: verificação — andamento com o foco e as duas ações paradas; um pedido; o resultado só depois da resposta; recusa e dúvida na tela, sem aviso; a nova consulta apaga o erro", async () => {
  const { context, page, errors, control, holdNext } = await open({ view: "reminders", sender: "pendente" });
  await soon(page.locator('[data-action="verify-sender"]'));
  const h = holdNext("verify");
  await page.locator('[data-action="verify-sender"]').focus();
  await page.keyboard.press("Enter");
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Solicitando a confirmação do seu e-mail…");
  assert.match(await active(page), /^p#trem-verify-status/, "o foco acompanha o andamento");
  assert.deepEqual(await page.evaluate(() => ["verify-sender", "refresh-sender"].map((a) => document.querySelector(`[data-action="${a}"]`)?.disabled)), [true, true]);
  await page.locator('[data-action="verify-sender"]').click({ force: true });
  assert.equal(requests(control, "verify-sender"), 1, "um pedido só");
  // O clique no botão parado leva o foco ao <main> (o contêiner focável); a pessoa volta ao andamento antes da resposta.
  await page.locator("#trem-verify-status").focus();
  const verified = done(page, "verify-sender");
  h.gate.resolve();
  await verified;
  await settle(page);
  assert.equal(await text(page.locator("#trem-sender-status")), "Ainda não é possível enviar. Confirmação solicitada. Abra o link que a AWS enviou.");
  assert.match(await active(page), /^p#trem-sender-status/, "o foco vai à situação nova");
  assert.deepEqual(await notices(page), [], "sem aviso temporário: a situação nova está na tela, com o foco (fechamento)");
  assert.equal(await page.locator("#trem-verify-status").count(), 0);
  // Recusa (4xx): nada foi pedido; o motivo do servidor fica junto da ação, com o foco; nenhum aviso temporário.
  await closeNotice(page);
  control.verifyMode = "403";
  const refused = done(page, "verify-sender");
  await page.locator('[data-action="verify-sender"]').click();
  await refused;
  await settle(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "A confirmação não foi solicitada. Use seu e-mail institucional para enviar lembretes.");
  assert.equal(await read(page.locator("#trem-verify-status"), (l) => l.getAttribute("role")), "alert");
  assert.match(await active(page), /^div#trem-verify-status/);
  assert.deepEqual(await notices(page), []);
  // A nova consulta (Já confirmei · verificar novamente) troca a situação e o erro sai; o foco vai à situação.
  const consulted = done(page, "reminder-settings");
  await page.locator('[data-action="refresh-sender"]').click();
  await consulted;
  await settle(page);
  assert.equal(await page.locator("#trem-verify-status").count(), 0, "o erro sai com a nova consulta");
  assert.match(await active(page), /^p#trem-sender-status/);
  // Dúvida (sem resposta): o pedido pode ter chegado.
  control.verifyMode = "network";
  const lost = done(page, "verify-sender");
  await page.locator('[data-action="verify-sender"]').click();
  await lost;
  await settle(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Não foi possível confirmar o pedido. A conexão com o portal falhou. Ele pode ter chegado: verifique de novo para ver a situação do seu e-mail.");
  assert.deepEqual(await notices(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB3: lote — quem recebe e quem fica de fora por motivo, a mensagem, o envio (a única superfície) e a lista, nessa ordem; o foco no título", async () => {
  const { context, page, errors } = await open();
  await goBatch(page);
  assert.match(await active(page), /^h1 Lembretes em lote$/);
  assert.equal(await text(page.locator(".trem-count")), "6 de 9 alunos vão receber um lembrete agora.");
  const groups = await page.locator(".trem-out .trem-group").evaluateAll((els) => els.map((g) => g.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(groups, ["Lembrete já registrado nesta publicação · 1 Bruno Reis 1 sem nota", "Desistente · 1 Diego Melo 3 sem nota", "Sem e-mail no Canvas · 1 Elisa Rocha 1 sem nota"]);
  assert.equal(await page.locator(".teacher-reminders .is-action").count(), 1);
  assert.equal(await read(page.locator(".teacher-reminders .is-action"), (l) => l.evaluate((el) => el.classList.contains("trem-send"))), true);
  assert.equal(await text(page.locator(".trem-recipients h2")), "Recebem agora · 6");
  assert.deepEqual(await page.locator(".trem-recipients .trem-name").allInnerTexts(), ["Ana Lima", "Carla Dias", "Gabi Lins", "Heitor Prado", "Isa Nunes", "João Paz"]);
  assert.equal(await text(page.locator(".trem-envelope")), "De instrutor@example.test Para o e-mail de cada aluno no Canvas Assunto Podemos ajudar? Atividades sem nota · BRSA0267");
  const y = await page.evaluate(() => ["#trem-summary-title", "#trem-message-title", "#trem-send-title", '[data-action="send-reminders-batch"]', "#trem-recipients-title"]
    .map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? null));
  assert.ok(y.every((v, i) => v !== null && (i === 0 || v > y[i - 1])), `ordem: ${JSON.stringify(y)}`);
  assert.equal(await text(page.locator(".trem-send .trem-consequence")), "Ao confirmar, o portal envia agora um e-mail para cada um dos 6 alunos da lista. Um e-mail enviado não pode ser desfeito.");
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB4: enviar — a pergunta diz turma, quantos, quem envia, sem volta e quantos ficam de fora; cancelar não envia; andamento com o foco, Enviar parado e um pedido; sucesso só depois da resposta, com o foco", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await goBatch(page);
  control.confirm = false;
  await sendButton(page).click();
  await settle(page);
  assert.deepEqual(control.dialogs, ["Enviar lembrete para 6 alunos da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.\n\n3 alunos selecionados ficam de fora; os motivos estão na lista."]);
  assert.equal(requests(control, "send-reminders"), 0);
  assert.equal(await page.locator("#trem-send-status").count(), 0, "cancelar não mostra andamento");
  control.confirm = true;
  const h = holdNext("send");
  await sendButton(page).focus();
  await page.keyboard.press("Enter");
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#trem-send-status")), "Enviando lembretes para 6 alunos… O resultado aparece aqui. Sair desta tela não cancela o envio.");
  assert.equal(await read(page.locator("#trem-send-status"), (l) => l.getAttribute("role")), "status");
  assert.match(await active(page), /^p#trem-send-status/, "o foco acompanha o andamento");
  assert.equal(await read(sendButton(page), (l) => l.isDisabled()), true, "Enviar parado durante o envio, mesmo depois do redesenho");
  await sendButton(page).click({ force: true });
  assert.equal(requests(control, "send-reminders"), 1, "um pedido só");
  assert.equal(await page.locator("#trem-result-title").count(), 0, "nada de resultado antes da resposta");
  // O clique no botão parado leva o foco ao <main> (o contêiner focável); a pessoa volta ao andamento antes da resposta.
  await page.locator("#trem-send-status").focus();
  const finished = done(page, "send-reminders");
  h.gate.resolve();
  await finished;
  await page.waitForTimeout(80);
  await settle(page);
  assert.match(await active(page), /^h2#trem-result-title/, "o foco vai ao resultado");
  assert.equal(await text(page.locator(".trem-result .trem-count")), "6 aceitos pelo serviço de envio.");
  assert.equal(await text(page.locator(".trem-result .trem-note")), "“Aceito pelo serviço de envio” ainda não é a entrega na caixa do aluno: a situação de cada um aparece em “Ver pendências”, no painel.");
  assert.deepEqual(await page.locator(".trem-result h3").allInnerTexts(), ["Aceitos pelo serviço de envio · 6"]);
  assert.equal(await read(page.locator("#trem-result-title"), (l) => l.getAttribute("aria-describedby")), "trem-result-count");
  assert.equal(await text(page.locator("#trem-result-count")), "6 aceitos pelo serviço de envio.", "o título com o foco anuncia as quantidades");
  assert.deepEqual(await notices(page), [], "sem aviso temporário: o resultado está na tela, com o foco (fechamento)");
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB5: falhas do envio na tela, com o foco e sem aviso: recusa (403, 429) e conflito (409) — nada saiu —; dúvida (rede, 503, resposta perdida) leva à nova consulta, que mostra quem já tem lembrete; cancelar a pergunta não apaga o erro", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await goBatch(page);
  for (const [mode, expected, consult] of [["403", "Nenhum lembrete foi enviado. Use seu e-mail institucional para enviar lembretes.", false],
    ["429", "Nenhum lembrete foi enviado. O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.", false],
    ["409", "Nenhum lembrete foi enviado. As notas foram atualizadas. Consulte a prévia de novo antes de enviar. Consultar destinatários de novo", true]]) {
    control.sendMode = mode;
    await send(page);
    assert.equal(await text(page.locator("#trem-send-status")), expected, mode);
    assert.equal(await read(page.locator("#trem-send-status"), (l) => l.getAttribute("role")), "alert", mode);
    assert.match(await active(page), /^div#trem-send-status/, mode);
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso temporário`);
    assert.equal(await read(sendButton(page), (l) => l.isEnabled()), true, `${mode}: enviar de novo continua possível`);
    assert.equal(await page.locator('#trem-send-status [data-action="retry-batch-preview"]').count(), consult ? 1 : 0, mode);
  }
  assert.equal(control.sent.size, 1, "com 4xx nada saiu");
  // Nova tentativa depois do conflito: durante o envio, o erro sai e Enviar volta a ser a ação principal (parado).
  const retry = holdNext("send");
  await sendButton(page).click();
  await retry.arrived.promise;
  await settle(page);
  assert.deepEqual(await read(sendButton(page), (l) => l.evaluate((b) => [b.disabled, b.classList.contains("primary")])), [true, true]);
  assert.equal(await read(page.locator("#trem-send-status"), (l) => l.getAttribute("role")), "status", "o andamento no lugar do erro");
  const retried = done(page, "send-reminders");
  retry.gate.resolve();
  await retried;
  await page.waitForTimeout(80);
  await settle(page);
  // Cancelar a pergunta não muda nada: o erro continua.
  control.confirm = false;
  await sendButton(page).click();
  await settle(page);
  assert.match(await text(page.locator("#trem-send-status")), /^Nenhum lembrete foi enviado\. As notas foram atualizadas/);
  control.confirm = true;
  // A nova consulta: o foco no andamento e depois em "Quem recebe", numa prévia nova, sem o erro.
  const consulting = holdNext("preview");
  await page.locator('#trem-send-status [data-action="retry-batch-preview"]').click();
  await consulting.arrived.promise;
  await settle(page);
  assert.match(await active(page), /^p#trem-batch-loading Consultando destinatários…$/, "o foco acompanha a nova consulta");
  const consulted = done(page, "pending-preview-batch");
  consulting.gate.resolve();
  await consulted;
  await page.waitForTimeout(60);
  await settle(page);
  assert.equal(await page.locator("#trem-send-status").count(), 0);
  assert.match(await active(page), /^h2#trem-summary-title/);
  // Dúvida: o servidor envia, mas a resposta se perde.
  control.sendMode = "lost";
  await send(page);
  assert.equal(await text(page.locator("#trem-send-status")), "Não foi possível confirmar o envio. A conexão com o portal falhou. Parte dos lembretes pode ter sido enviada, e o envio pode continuar no servidor. Antes de enviar de novo, consulte os destinatários: quem já tem lembrete registrado nesta publicação fica de fora e não recebe outro. Consultar destinatários de novo");
  assert.equal(await read(sendButton(page), (l) => l.evaluate((b) => b.classList.contains("secondary"))), true, "a nova consulta vem antes de enviar de novo");
  assert.deepEqual(await notices(page), []);
  const again = done(page, "pending-preview-batch");
  await page.locator('#trem-send-status [data-action="retry-batch-preview"]').click();
  await again;
  await page.waitForTimeout(60);
  await settle(page);
  assert.equal(await text(page.locator(".trem-count")), "0 de 9 alunos vão receber um lembrete agora.", "quem recebeu fica de fora");
  assert.match(await text(page.locator(".trem-out")), /Lembrete já registrado nesta publicação · 7/);
  assert.equal(await sendButton(page).count(), 0);
  // 503 do gateway (o envio pode continuar no servidor): a mesma dúvida.
  const second = await open();
  await goBatch(second.page);
  second.control.sendMode = "503";
  await send(second.page);
  assert.match(await text(second.page.locator("#trem-send-status")), /^Não foi possível confirmar o envio\. O portal está temporariamente indisponível\. Tente novamente em instantes\. Parte dos lembretes pode ter sido enviada/);
  await second.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB6: resultado — sem confirmação (recusa certa e sem resposta) e envio interrompido por conflito no meio, sem afirmar a causa; a nova consulta: a recusa certa volta a aparecer, a sem resposta fica registrada", async () => {
  const { context, page, errors, control } = await open();
  await goBatch(page);
  control.failIds = new Set(["31000"]);
  control.unsureIds = new Set(["31002"]);
  await send(page);
  assert.equal(await text(page.locator(".trem-result .trem-count")), "4 aceitos pelo serviço de envio · 2 sem confirmação do envio.");
  assert.equal(await text(page.locator(".trem-result .trem-alert")), "2 alunos ficaram sem confirmação do envio. O serviço de envio recusou a mensagem ou não respondeu. Na nova consulta, quem teve a recusa confirmada volta a aparecer para envio; quem ficou sem resposta continua com o lembrete registrado e não recebe outro, para não haver duplicação.");
  assert.deepEqual(await page.locator(".trem-result h3").allInnerTexts(), ["Aceitos pelo serviço de envio · 4", "Sem confirmação do envio · 2"]);
  await closeNotice(page);
  const consulted = done(page, "pending-preview-batch");
  await page.locator('.trem-result [data-action="retry-batch-preview"]').click();
  await consulted;
  await page.waitForTimeout(60);
  await settle(page);
  assert.deepEqual(await page.locator(".trem-recipients .trem-name").allInnerTexts(), ["Ana Lima"], "a recusa certa volta a aparecer para envio");
  assert.match(await text(page.locator(".trem-out")), /Lembrete já registrado nesta publicação · 6 .*Carla Dias/, "a sem resposta fica registrada");
  // Conflito na reserva depois de 2 envios (aqui, a publicação mudou; o servidor não diz): este envio não manda aos demais.
  const other = await open();
  await goBatch(other.page);
  other.control.cut = 2;
  await send(other.page);
  assert.equal(await text(other.page.locator(".trem-result .trem-count")), "2 aceitos pelo serviço de envio · 4 ficaram de fora.");
  assert.equal(await text(other.page.locator(".trem-result .trem-alert")), "Envio interrompido por conflito. O servidor encontrou um conflito ao registrar um lembrete e parou o envio; este envio não mandou lembrete para 4 alunos (em “Envio interrompido por conflito”). A causa pode ser outro envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma; o portal não sabe qual. Antes de enviar de novo, consulte os destinatários: a nova consulta mostra quem já tem lembrete registrado, inclusive por outro envio, e quem ainda pode receber. Se as notas mudaram, ela já é da publicação nova, em que quem recebeu agora pode aparecer de novo.");
  assert.match(await text(other.page.locator(".trem-result")), /Ficaram de fora · 4 Envio interrompido por conflito · 4 Gabi Lins Heitor Prado Isa Nunes João Paz$/);
  assert.equal(await other.page.locator('.trem-result [data-action="retry-batch-preview"]').count(), 1);
  await other.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB15: fechamento — outra reserva do mesmo aluno no meio do envio: conflito sem causa afirmada, quantidades e grupos como o servidor devolve, e a nova consulta mostra o registro do outro envio; o aviso temporário só quando o foco ficou em outro lugar (envio e verificação)", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await goBatch(page);
  control.raceIds = new Set(["31006"]);
  await send(page);
  assert.match(await active(page), /^h2#trem-result-title/, "o foco vai ao resultado");
  assert.equal(await text(page.locator(".trem-result .trem-count")), "2 aceitos pelo serviço de envio · 4 ficaram de fora.");
  assert.equal(await text(page.locator(".trem-result .trem-alert")), "Envio interrompido por conflito. O servidor encontrou um conflito ao registrar um lembrete e parou o envio; este envio não mandou lembrete para 4 alunos (em “Envio interrompido por conflito”). A causa pode ser outro envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma; o portal não sabe qual. Antes de enviar de novo, consulte os destinatários: a nova consulta mostra quem já tem lembrete registrado, inclusive por outro envio, e quem ainda pode receber. Se as notas mudaram, ela já é da publicação nova, em que quem recebeu agora pode aparecer de novo.");
  assert.match(await text(page.locator(".trem-result")), /Aceitos pelo serviço de envio · 2 Ana Lima Carla Dias Ficaram de fora · 4 Envio interrompido por conflito · 4 Gabi Lins Heitor Prado Isa Nunes João Paz$/);
  assert.deepEqual(await notices(page), []);
  const consulted = done(page, "pending-preview-batch");
  await page.locator('.trem-result [data-action="retry-batch-preview"]').click();
  await consulted;
  await page.waitForTimeout(60);
  await settle(page);
  assert.deepEqual(await page.locator(".trem-recipients .trem-name").allInnerTexts(), ["Heitor Prado", "Isa Nunes", "João Paz"], "quem este envio não processou volta");
  assert.match(await text(page.locator(".trem-out")), /Lembrete já registrado nesta publicação · 4 .*Gabi Lins/, "o aluno disputado tem o lembrete do outro envio");
  // Com o foco num controle que a pessoa escolheu durante o envio, o resultado aparece sem tirar o foco dela, e o aviso anuncia.
  const h = holdNext("send");
  await sendButton(page).focus();
  await page.keyboard.press("Enter");
  await h.arrived.promise;
  await settle(page);
  await page.locator('button[data-view="feedback"]').focus();
  const finished = done(page, "send-reminders");
  h.gate.resolve();
  await finished;
  await page.waitForTimeout(80);
  await settle(page);
  assert.equal(await text(page.locator(".trem-result .trem-count")), "3 aceitos pelo serviço de envio.");
  assert.match(await active(page), /^button Enviar feedback/, "o foco fica onde a pessoa o deixou");
  assert.deepEqual(await notices(page), ["Chegou a resposta do envio em lote. Confira o resultado por aluno."]);
  await closeNotice(page);
  // Verificação: o mesmo — com o foco em outro lugar, a situação nova aparece e o aviso anuncia; sem ele, nada é anunciado.
  control.sender = "pendente";
  await goSender(page);
  await soon(page.locator('[data-action="verify-sender"]'));
  const v = holdNext("verify");
  await page.locator('[data-action="verify-sender"]').click();
  await v.arrived.promise;
  await settle(page);
  await page.locator('button[data-view="feedback"]').focus();
  const verified = done(page, "verify-sender");
  v.gate.resolve();
  await verified;
  await page.waitForTimeout(80);
  await settle(page);
  assert.equal(await text(page.locator("#trem-sender-status")), "Ainda não é possível enviar. Confirmação solicitada. Abra o link que a AWS enviou.");
  assert.match(await active(page), /^button Enviar feedback/);
  assert.deepEqual(await notices(page), ["Chegou a resposta do pedido de confirmação. Confira a situação do seu remetente."]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB7: troca de turma e de tela durante o envio — a tela atual não muda (sem redesenho, aviso nem foco); um lote novo, aberto com o envio antigo ainda em andamento ou depois, começa livre e sem nada de antes", async () => {
  for (const leave of ["turma", "painel"]) {
    const { context, page, errors, control, holdNext } = await open();
    await goBatch(page);
    control.sendMode = "500";
    const h = holdNext("send");
    await sendButton(page).click();
    await h.arrived.promise;
    await settle(page);
    assert.equal(await text(page.locator("#trem-send-status")), "Enviando lembretes para 6 alunos… O resultado aparece aqui. Sair desta tela não cancela o envio.", `${leave}: o andamento na tela`);
    if (leave === "turma") {
      await page.locator("#cohort").selectOption("BRSA0268");
      await soon(page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }));
    } else {
      // De volta ao painel e a um lote novo, com o envio antigo ainda em andamento: o lote novo é livre.
      await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
      await soon(page.locator('[data-action="reminders-batch"]'));
      await goBatch(page);
      assert.equal(await page.locator("#trem-send-status").count(), 0, "o lote novo não mostra o andamento do antigo");
      assert.deepEqual(await read(sendButton(page), (l) => l.evaluate((b) => [b.disabled, b.classList.contains("primary")])), [false, true], "Enviar livre no lote novo");
    }
    await page.locator("#cohort").focus();
    await page.evaluate(() => { window.__renders = 0; new MutationObserver((list) => { window.__renders += list.length; }).observe(document.querySelector("#app"), { childList: true }); });
    const html = await page.locator("#app").innerHTML();
    const finished = done(page, "send-reminders");
    h.gate.resolve();
    await finished;
    await page.waitForTimeout(120);
    await settle(page);
    assert.equal(await page.evaluate(() => window.__renders), 0, `${leave}: nenhum redesenho`);
    assert.equal(await page.locator("#app").innerHTML(), html, `${leave}: a tela atual não muda`);
    assert.deepEqual(await notices(page), [], `${leave}: nenhum aviso`);
    assert.match(await active(page), /^select#cohort/, `${leave}: o foco fica onde estava`);
    if (leave === "turma") {
      await page.locator("#cohort").selectOption("BRSA0267");
      await soon(page.locator("#status-filter"));
      await page.locator("#status-filter").selectOption("pending");
      await soon(page.locator('[data-action="reminders-batch"]'));
      await goBatch(page);
    }
    assert.equal(await page.locator("#trem-send-status").count(), 0, `${leave}: o lote novo começa sem nada`);
    assert.equal(await read(sendButton(page), (l) => l.isEnabled()), true, `${leave}: Enviar livre no lote novo`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("RB7b: troca de usuário — o andamento e o resultado da verificação de quem saiu não aparecem para quem entrou; o erro de quem entrou não fica para quem volta", async () => {
  const { context, page, errors, control, holdNext } = await open({ role: "admin", view: "reminders", sender: "pendente",
    emails: ["admin@example.test", "outra.admin@example.test", "admin@example.test"] });
  // Boot pela tela de acessos ("Salvar configurações"): /me devolve a próxima pessoa da lista.
  const reboot = async (n) => {
    await closeNotice(page);
    await page.locator('.sidebar nav [data-view="access"]').click();
    await soon(page.getByRole("button", { name: "Salvar configurações", exact: true }));
    await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    // Expansão 8: o aviso do salvamento só aparece para quem salvou; a espera é pela n-ésima leitura do /me e pela rede parada.
    for (let i = 0; i < 80 && control.me < n; i++) await page.waitForTimeout(50);
    await page.waitForLoadState("networkidle");
    assert.equal(control.me, n, "o /me foi lido de novo");
    await closeNotice(page);
  };
  await soon(page.locator('[data-action="verify-sender"]'));
  const h = holdNext("verify");
  await page.locator('[data-action="verify-sender"]').click();
  await h.arrived.promise;
  await reboot(2);
  await goSender(page);
  assert.equal(await text(page.locator(".trem-address")), "outra.admin@example.test");
  assert.equal(await page.locator("#trem-verify-status").count(), 0, "quem entrou não vê o andamento de quem saiu");
  assert.equal(await read(page.locator('[data-action="verify-sender"]'), (l) => l.isEnabled()), true);
  // Quem entrou pede a própria verificação, ainda com a de quem saiu em andamento: a de quem saiu termina e não muda nada aqui.
  const own = holdNext("verify");
  await page.locator('[data-action="verify-sender"]').click();
  await own.arrived.promise;
  await settle(page);
  assert.equal(await page.locator("#trem-sender-title").count(), 1, "o título do remetente");
  await page.locator("#trem-sender-title").evaluate((el) => { el.tabIndex = -1; el.focus(); });
  const finished = done(page, "verify-sender");
  h.gate.resolve();
  await finished;
  await page.waitForTimeout(80);
  await settle(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Solicitando a confirmação do seu e-mail…", "o andamento de quem entrou continua");
  assert.deepEqual(await notices(page), [], "nem o aviso de quem saiu");
  assert.match(await active(page), /^h2#trem-sender-title/, "o foco fica onde estava");
  // A tela redesenhada (Lembretes de novo pelo menu) ainda mostra a verificação de quem entrou em andamento.
  await goSender(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Solicitando a confirmação do seu e-mail…", "o andamento continua depois do redesenho");
  assert.equal(await read(page.locator('[data-action="verify-sender"]'), (l) => l.isDisabled()), true);
  const mine = done(page, "verify-sender");
  own.gate.resolve();
  await mine;
  await page.waitForTimeout(80);
  await settle(page);
  assert.equal(await page.locator("#trem-verify-status").count(), 0);
  // O erro de quem está na aba fica na tela dela; quem volta (outra pessoa) não o vê.
  control.verifyMode = "403";
  const refused = done(page, "verify-sender");
  await page.locator('[data-action="verify-sender"]').click();
  await refused;
  await settle(page);
  assert.match(await text(page.locator("#trem-verify-status")), /^A confirmação não foi solicitada\./);
  await reboot(3);
  await goSender(page);
  assert.equal(await text(page.locator(".trem-address")), "admin@example.test");
  assert.equal(await page.locator("#trem-verify-status").count(), 0, "o erro de quem saiu não aparece para quem entrou");
  assert.deepEqual(errors, []);
  await context.close();
});

test("RB8: sem rolagem lateral nem controle escondido em 320–1440 px, texto a 200% e 250%, zoom a 200% e janela baixa, com e-mail, nomes e mensagem extensos", async () => {
  const sizes = [[1440, 900, 1], [1280, 800, 1], [1024, 768, 1], [768, 1024, 1], [390, 844, 1], [320, 640, 1], [1440, 900, 2], [390, 844, 2], [320, 640, 2.5], [720, 450, 1], [1280, 560, 1]];
  for (const [width, height, scale] of sizes) {
    const { context, page, errors } = await open({ width, height, text: scale, view: "reminders", sender: "pendente", long: true });
    await soon(page.locator("#trem-sender-status"));
    assert.equal(await pageScroll(page), 0, `remetente ${width}x${height} texto ${scale}`);
    assert.deepEqual(await clipped(page), [], `remetente ${width}x${height} texto ${scale}`);
    await toBatch(page);
    assert.equal(await pageScroll(page), 0, `lote ${width}x${height} texto ${scale}`);
    assert.deepEqual(await clipped(page), [], `lote ${width}x${height} texto ${scale}`);
    assert.equal(await page.locator(".trem-text").count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("RB9: teclado na ordem da tarefa, com contorno inteiro (pixels); no celular, o foco no Enviar não fica atrás da barra inferior", async () => {
  const { context, page } = await open({ view: "reminders", sender: "pendente" });
  await soon(page.locator('[data-action="verify-sender"]'));
  assert.equal(await page.locator("#trem-sender-title").count(), 1, "o título do remetente");
  await page.locator("#trem-sender-title").evaluate((el) => { el.tabIndex = -1; el.focus(); });
  const order = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); order.push(await active(page)); }
  assert.deepEqual(order, ["button Solicitar confirmação do meu e-mail", "button Já confirmei · verificar novamente", "button Ver alunos com atividades sem nota", "button Ir ao painel da turma"]);
  await page.locator('[data-action="verify-sender"]').focus();
  assert.deepEqual(await ringAround(page, '[data-action="verify-sender"]'), []);
  await context.close();
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const batch = await open({ width, height });
    await goBatch(batch.page);
    await batch.page.locator("h1").focus();
    const seen = [];
    for (let i = 0; i < 3; i++) { await batch.page.keyboard.press("Tab"); seen.push(await active(batch.page)); }
    assert.deepEqual(seen, ["button Voltar ao painel", "button Enviar para 6 alunos", "button Enviar feedback"], `${width}`);
    await sendButton(batch.page).focus();
    assert.deepEqual(await ringAround(batch.page, '[data-action="send-reminders-batch"]'), [], `${width}`);
    const covered = await batch.page.evaluate(() => { const b = document.querySelector('[data-action="send-reminders-batch"]').getBoundingClientRect(), nav = document.querySelector(".sidebar nav");
      const top = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : innerHeight; return b.bottom > top; });
    assert.equal(covered, false, `${width}: Enviar à vista, acima da barra inferior`);
    await sendButton(batch.page).focus();
    // Pelo teclado, o foco vai ao andamento e depois ao resultado, com o contorno inteiro.
    const h = batch.holdNext("send");
    await batch.page.keyboard.press("Enter");
    await h.arrived.promise;
    await settle(batch.page);
    assert.deepEqual(await ringAround(batch.page, "#trem-send-status"), [], `${width}: andamento`);
    const finished = done(batch.page, "send-reminders");
    h.gate.resolve();
    await finished;
    await batch.page.waitForTimeout(80);
    await settle(batch.page);
    assert.deepEqual(await ringAround(batch.page, "#trem-result-title"), [], `${width}: resultado`);
    await batch.context.close();
  }
});

test("RB10: estados — consultando, erro e ainda não consultado no remetente; consultando e erro no lote (Tentar novamente leva o foco ao resultado); sem elegíveis, sem Enviar; remetente não pronto", async () => {
  const { context, page, control, holdNext } = await open();
  const h = holdNext("sender");
  control.senderMode = "500";
  await page.locator('.sidebar nav [data-view="reminders"]').click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator(".trem-loading")), "Consultando seu remetente…");
  assert.equal(await page.locator("#trem-how-title, #trem-rules-title").count(), 2, "como enviar e regras enquanto consulta");
  h.gate.resolve();
  await soon(page.locator(".teacher-reminders [role=alert]"));
  assert.equal(await text(page.locator(".teacher-reminders > [role=alert]")), "Não foi possível carregar Erro interno. Tentar novamente");
  control.senderMode = "ok";
  const retried = done(page, "reminder-settings");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await retried;
  await settle(page);
  assert.match(await active(page), /^p#trem-sender-status/, "depois de tentar de novo, o foco vai à situação");
  control.previewMode = "500";
  await toBatch(page);
  assert.equal(await text(page.locator(".teacher-reminders > [role=alert]")), "Não foi possível carregar Erro interno. Tentar novamente");
  control.previewMode = "ok";
  control.ses = { ready: false, reason: NOT_VERIFIED };
  const reloaded = done(page, "pending-preview-batch");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await reloaded;
  await page.waitForTimeout(60);
  await settle(page);
  assert.match(await active(page), /^h2#trem-summary-title/, "depois de tentar de novo, o foco vai a Quem recebe");
  assert.equal(await read(sendButton(page), (l) => l.isDisabled()), true, "remetente não pronto: Enviar parado");
  assert.equal(await read(sendButton(page), (l) => l.getAttribute("aria-describedby")), "trem-send-reason");
  assert.equal(await text(page.locator("#trem-send-reason")), "O envio fica parado até o remetente ficar pronto.");
  assert.equal(await page.getByRole("button", { name: "Configurar meu remetente", exact: true }).count(), 1);
  control.withdrawn = new Set(STUDENTS.map((s) => s.id));
  const empty = done(page, "pending-preview-batch");
  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  await soon(page.locator('[data-action="reminders-batch"]'));
  await page.locator('[data-action="reminders-batch"]').click();
  await empty;
  await settle(page);
  assert.equal(await text(page.locator(".trem-count")), "0 de 9 alunos vão receber um lembrete agora.");
  assert.equal(await text(page.locator(".trem-none")), "Nenhum aluno elegível para receber o lembrete agora.");
  assert.equal(await sendButton(page).count(), 0);
  await context.close();
});

test("RB11: o admin vê as mesmas telas; o aluno não tem Lembretes", async () => {
  const { context, page } = await open({ role: "admin", view: "reminders" });
  await soon(page.locator("#trem-sender-status"));
  assert.equal(await page.locator(".teacher-reminders .trem-sender.is-action").count(), 1);
  await toBatch(page);
  assert.equal(await text(page.locator(".trem-count")), "6 de 9 alunos vão receber um lembrete agora.");
  await context.close();
  const student = await open({ role: "student" });
  assert.equal(await student.page.locator('.sidebar nav [data-view="reminders"]').count(), 0);
  await student.context.close();
});

test("RB12: composição — a moldura só na ação (no celular, sem moldura e botões na largura toda); caminhos lado a lado e nomes em colunas com largura; formas e cores de cada estado", async () => {
  const style = (page, selector, props, pseudo) => page.evaluate(([s, p, ps]) => { const el = document.querySelector(s); if (!el) return null; const c = getComputedStyle(el, ps);
    return Object.fromEntries(p.map((k) => [k, c[k]])); }, [selector, props, pseudo]);
  const columns = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0; }, selector);
  const wide = await open();
  await goBatch(wide.page);
  assert.deepEqual(await style(wide.page, ".trem-send", ["borderTopWidth", "borderLeftWidth", "backgroundColor"]), { borderTopWidth: "1px", borderLeftWidth: "1px", backgroundColor: "rgb(8, 40, 74)" });
  for (const plain of [".trem-summary", ".trem-message", ".trem-recipients"])
    assert.equal((await style(wide.page, plain, ["backgroundColor"]))?.backgroundColor, "rgba(0, 0, 0, 0)", `${plain}: sobre o fundo`);
  assert.ok(await columns(wide.page, ".trem-recipients .trem-names") >= 3, "nomes em colunas em 1440 px");
  wide.control.sendMode = "403";
  await send(wide.page);
  assert.equal((await style(wide.page, ".trem-op.is-error", ["borderLeftColor"]))?.borderLeftColor, "rgb(217, 107, 120)", "erro em vermelho");
  await wide.context.close();
  const narrow = await open({ width: 390, height: 844 });
  await goBatch(narrow.page);
  assert.deepEqual(await style(narrow.page, ".trem-send", ["borderLeftWidth", "borderTopWidth", "backgroundColor"]), { borderLeftWidth: "0px", borderTopWidth: "1px", backgroundColor: "rgba(0, 0, 0, 0)" });
  assert.equal(await columns(narrow.page, ".trem-recipients .trem-names"), 1, "uma coluna no celular");
  const widths = await narrow.page.evaluate(() => { const b = document.querySelector('[data-action="send-reminders-batch"]').getBoundingClientRect(), c = document.querySelector(".trem-send").getBoundingClientRect(); return [Math.round(b.width), Math.round(c.width)]; });
  assert.equal(widths[0], widths[1], "Enviar na largura toda");
  narrow.control.failIds = new Set(["31000"]);
  await send(narrow.page);
  assert.equal((await style(narrow.page, ".trem-alert", ["borderLeftColor"]))?.borderLeftColor, "rgb(242, 184, 75)", "sem confirmação em âmbar");
  await narrow.context.close();
  for (const [width, count] of [[1440, 2], [390, 1]]) {
    const { context, page } = await open({ width, height: 900, view: "reminders", sender: "pendente" });
    await soon(page.locator("#trem-sender-status"));
    assert.equal(await columns(page, ".trem-paths"), count, `caminhos em ${width} px`);
    await context.close();
  }
  const blocked = await open();
  blocked.control.ses = { ready: false, reason: NOT_VERIFIED };
  await goBatch(blocked.page);
  const ring = await shapeOf(blocked.page, ".trem-send .trem-state");
  assert.ok(ring?.ring, `remetente não pronto: anel ${JSON.stringify(ring)}`);
  assert.ok((await shapeOf(blocked.page, "#trem-send-reason"))?.ring, "o motivo do Enviar parado com o anel");
  await blocked.context.close();
});

// Como antes: o envio em lote devolve o erro (aviso), e a verificação, cuja resposta é de quem saiu, é descartada pelo handler.
test("RB13: sessão encerrada durante o envio ou a verificação — a entrada pública; o aviso de sempre no envio, nenhum na verificação", async () => {
  for (const [view, mode, expected] of [["overview", "sendMode", ["Sua sessão expirou. Entre novamente."]], ["reminders", "verifyMode", []]]) {
    const { context, page, errors, control } = await open({ view, sender: "pendente" });
    control[mode] = "401";
    if (view === "overview") { await goBatch(page); await sendButton(page).click(); }
    else { await soon(page.locator('[data-action="verify-sender"]')); await page.locator('[data-action="verify-sender"]').click(); }
    await soon(page.locator('[data-action="login"]'));
    if (expected.length) await soon(page.locator("#notices .notice"));
    else await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-action="login"]').count(), 1, `${mode}: a entrada pública`);
    assert.deepEqual(await notices(page), expected, `${mode}: o aviso, como antes`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("RB14: troca de turma e de tela durante a verificação — a outra turma fica livre; de volta à turma, o andamento; o resultado que chega com outra tela não redesenha nem avisa", async () => {
  const { context, page, errors, control, holdNext } = await open({ view: "reminders", sender: "pendente" });
  await soon(page.locator('[data-action="verify-sender"]'));
  const h = holdNext("verify");
  await page.locator('[data-action="verify-sender"]').click();
  await h.arrived.promise;
  await settle(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Solicitando a confirmação do seu e-mail…");
  await page.locator("#cohort").selectOption("BRSA0268");
  await soon(page.getByRole("heading", { name: "Painel da BRSA0268", exact: true }));
  await goSender(page);
  assert.equal(await page.locator("#trem-verify-status").count(), 0, "a outra turma não mostra o andamento");
  assert.equal(await read(page.locator('[data-action="verify-sender"]'), (l) => l.isEnabled()), true, "a outra turma fica livre");
  await page.locator("#cohort").selectOption("BRSA0267");
  await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
  await goSender(page);
  assert.equal(await text(page.locator("#trem-verify-status")), "Solicitando a confirmação do seu e-mail…", "de volta à turma, o andamento continua");
  assert.equal(await read(page.locator('[data-action="verify-sender"]'), (l) => l.isDisabled()), true);
  await page.locator('.sidebar nav [data-view="overview"]').click();
  await soon(page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }));
  await page.locator("#cohort").focus();
  await page.evaluate(() => { window.__renders = 0; new MutationObserver((list) => { window.__renders += list.length; }).observe(document.querySelector("#app"), { childList: true }); });
  const finished = done(page, "verify-sender");
  h.gate.resolve();
  await finished;
  await page.waitForTimeout(120);
  await settle(page);
  assert.equal(await page.evaluate(() => window.__renders), 0, "nenhum redesenho em outra tela");
  assert.deepEqual(await notices(page), [], "nenhum aviso");
  assert.match(await active(page), /^select#cohort/, "o foco fica onde estava");
  assert.equal(control.verifyMode, "ok");
  assert.deepEqual(errors, []);
  await context.close();
});

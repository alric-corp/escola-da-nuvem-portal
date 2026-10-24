// C1 — correções de confiabilidade pré-integração (docs/design-visual.md), com API fictícia (nunca AWS, Canvas,
// restauração real; tudo fora da origem local é abortado), relógio fixo e dados sintéticos:
// D03 — o resultado de uma restauração fica com a sessão que a começou: quem entra na aba (outra pessoa, ou a mesma
//       pessoa numa sessão nova) não vê sucesso, erro nem andamento dela, e a resposta antiga não dispara pedido;
// D04 — resultado desconhecido da restauração (rede, 5xx, resposta perdida) dito como dúvida, com a turma de origem e a
//       consulta segura; a recusa (4xx) continua dizendo que não restaurou; nada se repete sozinho;
// TODO 26 — o foco foi removido da interface; uma regressão preserva a leitura do payload legado sem controles ou escrita.
// Garantia do servidor preservada para restauração: 4xx recusa antes da escrita condicional; 5xx e ausência de resposta
// deixam o resultado desconhecido. Descartar resposta antiga na interface não desfaz uma operação já recebida.
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

const KEYS = ["previousCount", "currentCount", "studentsAdded", "studentsRemoved", "studentsUpdated", "activitiesAdded", "activitiesRemoved",
  "activitiesReleased", "activitiesPaused", "scalesChanged", "gradesChanged", "gradesAdded", "gradesRemoved"];
const counts = (c) => Object.fromEntries(KEYS.map((k) => [k, c[k] ?? 0]));
const pub = (cohort, id, publishedAt, base, c) => ({ id, cohort, base, publishedAt, filename: "canvas-api.csv", publishedBy: "system:canvas-sync", status: "published",
  createdAt: publishedAt, changes: counts(c) });
const HISTORY = {
  BRSA0267: [pub("BRSA0267", "p13", "2026-10-10T21:04:00Z", "p12", { previousCount: 24, currentCount: 24, gradesChanged: 12, gradesAdded: 12 }),
    pub("BRSA0267", "p12", "2026-10-09T21:04:00Z", "p11", { previousCount: 24, currentCount: 24, gradesChanged: 21, gradesAdded: 19, gradesRemoved: 2 }),
    pub("BRSA0267", "p11", "2026-10-09T09:03:00Z", null, { previousCount: 0, currentCount: 24, studentsAdded: 24, activitiesAdded: 12, activitiesReleased: 8 })],
  BRSA0268: [pub("BRSA0268", "q2", "2026-10-08T21:00:00Z", "q1", { previousCount: 18, currentCount: 18, gradesChanged: 9, gradesAdded: 9 }),
    pub("BRSA0268", "q1", "2026-10-01T21:00:00Z", null, { previousCount: 0, currentCount: 18, studentsAdded: 18, activitiesAdded: 12, activitiesReleased: 8 })],
};
const STUDENTS = Array.from({ length: 6 }, (_, i) => ({ id: String(31000 + i), name: `Aluna Fictícia ${i}`, email: `aluna${i}@example.test`, kc: 80, lab: 96,
  total: 88, completed: 8, pending: 0, progress: 100, status: "ok", portalLinked: true }));
const ACTIVITIES = Array.from({ length: 8 }, (_, i) => ({ id: `a${i + 1}`, name: `${200 + i}-KC - Atividade ${i + 1}`, kind: i % 2 ? "lab" : "kc", points: "100", active: true,
  completed: 4, pending: 2, needsReview: 1, average: 81, module: "Módulo", moduleOrder: 1 }));
const SYNC = { status: "unchanged", message: "Nenhuma mudança no Canvas desde a última publicação.", at: "2026-10-11T09:00:12Z", students: 6, publicationId: null };
const MESSAGES = {
  restore: { 409: "A turma foi atualizada. Recarregue o histórico.", 403: "Você não tem acesso a esta operação.", 500: "Erro interno ao restaurar.",
    integrity: "Esta publicação não pode ser restaurada porque não atende às validações atuais de integridade. 1 aluno(s) não pertence(m) à turma no Canvas. (IDs do Canvas: 999999)" },
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

// control: people, sessão e modo da restauração, com respostas controladas antes/depois da escrita fictícia.
// O campo focus nos relatórios é legado e permanece sem alteração. focusPosts detecta qualquer chamada indevida.
async function open({ width = 1440, height = 900, text = 1, role = "instructor", people, view = "history" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  people ||= role === "admin" ? ["admin.a@example.test", "admin.b@example.test"] : ["instrutor.a@example.test", "instrutor.b@example.test"];
  const errors = [], control = { people, who: 0, restoreMode: "ok", holds: {}, calls: [], restores: [], focusPosts: [], dialogs: [],
    server: { BRSA0267: { current: "p13", updateKind: "canvas", focus: { activityIds: ["a1", "a2", "a3"], version: "v0" } },
      BRSA0268: { current: "q2", updateKind: "canvas", focus: { activityIds: [], version: null } } } };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return dialog.accept(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view }) => {
    if (sessionStorage.getItem("c1-sessao")) return;
    sessionStorage.setItem("c1-sessao", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "teste-c1", expires: Date.now() + 3600000 }));
    localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view }));
  }, { email: people[0], view });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const reportOf = (code) => {
    const s = control.server[code], history = HISTORY[code], p = history.find((x) => x.id === s.current);
    return { cohort: code, publication: { ...p, releasedAt: {} }, focus: { ...s.focus }, students: code === "BRSA0268" ? STUDENTS.slice(0, 4) : STUDENTS, activities: ACTIVITIES,
      count: STUDENTS.length, warnings: [], thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436", canvasSync: SYNC, history, updatedAt: s.updateKind === "restore" ? "2026-10-11T18:00:00.000Z" : p.publishedAt, updateKind: s.updateKind };
  };
  const fail = (route, kind, mode) => (mode === 503 ? route.fulfill({ status: 503, contentType: "text/plain", body: "" })
    : route.fulfill({ status: mode === "integrity" ? 409 : mode, json: { error: MESSAGES[kind][mode] } }));
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4), method = request.method(), code = endpoint.split("/")[2];
    control.calls.push(`${method} ${endpoint}`);
    if (endpoint === "/me") {
      const email = control.people[control.who];
      return route.fulfill({ json: { userId: `uid-${email.split("@")[0]}`, email, roles: role === "admin" ? ["admin", "instructor"] : ["instructor"] } });
    }
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: ["BRSA0267", "BRSA0268"].map((c) => ({ code: c, name: `AWS re/Start · ${c}`, canTeach: true,
      autoSync: c === "BRSA0267", canvasCourseId: c === "BRSA0267" ? "4436" : "4437", thresholds: { kc: 70, lab: 95 }, current: control.server[c].current })) } });
    if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
    if (/^\/cohorts\/[\w-]+\/instructors$/.test(endpoint)) return route.fulfill({ json: { instructors: [] } });
    if (/^\/cohorts\/[\w-]+\/settings$/.test(endpoint)) return route.fulfill({ json: request.postDataJSON() || {} });
    if (endpoint.endsWith("/report")) {
      // Sessão expirada no servidor: o 401 da próxima leitura leva o portal à entrada pública (expireSession).
      if (control.expireNext) { control.expireNext = false; return route.fulfill({ status: 401, json: { error: "Sua sessão expirou. Entre novamente." } }); }
      return route.fulfill({ json: reportOf(code) });
    }
    if (endpoint.endsWith("/restore")) {
      const body = request.postDataJSON(), mode = control.restoreMode, s = control.server[code];
      control.restores.push({ code, ...body });
      await hold("restore");
      if (mode === "network") return route.abort("failed");
      if (mode !== "ok" && mode !== "lost") return fail(route, "restore", mode);
      if (body.expectedCurrent !== s.current) return fail(route, "restore", 409);
      s.current = body.publicationId; s.updateKind = "restore";
      return mode === "lost" ? route.abort("failed") : route.fulfill({ json: { restored: true } });
    }
    if (endpoint.endsWith("/focus-activities")) {
      control.focusPosts.push({ code, ...request.postDataJSON() });
      return route.fulfill({ status: 410, json: { error: "A interface não deve enviar esta operação." } });
    }
    return route.fulfill({ status: 404, json: { error: "não simulado: " + endpoint } });
  });
  await page.goto(origin);
  await page.locator(".layout .page-heading h1").waitFor();
  await quiet(page);
  return { context, page, errors, control, holdNext: (name) => (control.holds[name] = { arrived: deferred(), gate: deferred() }) };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// Espera com limite, sem falhar: um resultado errado ou ausente falha na asserção seguinte, não por tempo esgotado.
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {}).then(() => settle(page));
const quiet = async (page) => { await page.waitForTimeout(150); await settle(page); };
const notices = (page) => page.locator("#notices .notice span").allTextContents();
const text = async (locator) => ((await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, " ").trim() : null);
const restoreButton = (page, id) => page.locator(`[data-restore="${id}"]`);
const activeId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const topline = (page) => text(page.locator(".topline"));
// A resposta (ou a falha) do pedido chegou e a continuação dela teve tempo de rodar.
const settled = (page, suffix) => {
  const done = Promise.race([page.waitForResponse((r) => r.url().endsWith(suffix)), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith(suffix) })]).catch(() => null);
  return async () => { await done; await page.waitForTimeout(300); await settle(page); };
};
const openPublications = async (page) => { await page.locator('.sidebar nav [data-view="history"]').click(); await page.locator(".teacher-publications h1").waitFor(); await quiet(page); };
const openPanel = async (page) => { await page.locator('.sidebar nav [data-view="overview"]').click(); await page.locator(".teacher-home h1").waitFor(); await quiet(page); };
// Troca de pessoa na aba (como nas Expansões 8 e 9): o admin salva as configurações da turma, e o boot que vem depois consulta o
// /me de novo — quem responde é outra pessoa (ou a mesma, numa sessão nova).
async function switchPerson(page, control, who) {
  control.who = who;
  await page.locator('.sidebar nav [data-view="access"]').click();
  await page.locator("#cohort-settings-form button[type=submit]").waitFor();
  await page.locator("#cohort-settings-form button[type=submit]").click();
  await until(page, (email) => document.querySelector(".topline")?.innerText.includes(email) && !document.querySelector("[aria-busy=true], .aa-op.is-busy"), control.people[who]);
  await quiet(page);
}
// C2 (C2-01): longe de Publicações da turma, o aviso ficou curto — a operação, a turma, a dúvida e onde ver —, e a orientação
// inteira, com a consulta segura, fica em Publicações da turma de origem (tests/c2-robustness-browser.mjs).
const UNSURE_RESTORE = (code) => `Não foi possível confirmar a restauração da turma ${code}. Ela pode ter sido concluída: veja Publicações.`;

// ---------------------------------------------------------------- D03

test("C1-D03a: A restaura e B entra antes da resposta — o sucesso de A não aparece para B, nem o andamento dele, e a resposta antiga não dispara pedido", async () => {
  const { context, page, errors, control, holdNext } = await open({ role: "admin" });
  const h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  await switchPerson(page, control, 1);
  assert.match(await topline(page), /admin\.b@example\.test/);
  await openPublications(page);
  // O andamento é de A: B vê a turma livre (nenhum "Restaurando…", Restaurar disponível).
  assert.equal(await page.locator("#tpub-restore-status").count(), 0, "o andamento de A não aparece para B");
  assert.equal(await restoreButton(page, "p12").isDisabled(), false, "Restaurar livre para B");
  const before = control.calls.length;
  const done = settled(page, "/restore");
  h.gate.resolve();
  await done();
  assert.deepEqual(await notices(page), [], "nenhum aviso de A para B");
  assert.equal(await page.locator(".tpub-op").count(), 0, "nada de A na tela de B");
  assert.deepEqual(control.calls.slice(before), [], "a resposta antiga não dispara pedido (nem recarga)");
  assert.equal(control.restores.length, 1, "nenhuma repetição");
  assert.match(await topline(page), /admin\.b@example\.test/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C1-D03b: A restaura e B entra antes da resposta — o erro de A (recusa ou dúvida) não aparece para B", async () => {
  for (const mode of [409, "network", 500]) {
    const { context, page, errors, control, holdNext } = await open({ role: "admin" });
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await switchPerson(page, control, 1);
    await openPublications(page);
    const before = control.calls.length;
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.deepEqual(await notices(page), [], `${mode}: nenhum aviso de A para B`);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: nenhum erro de A na tela de B`);
    assert.deepEqual(control.calls.slice(before), [], `${mode}: nenhum pedido`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C1-D03c: A → B → A — a resposta da sessão anterior de A não vale para a sessão nova de A, mesmo com a mesma pessoa", async () => {
  for (const mode of ["ok", "network"]) {
    const { context, page, errors, control, holdNext } = await open({ role: "admin" });
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await switchPerson(page, control, 1);
    await switchPerson(page, control, 0);
    assert.match(await topline(page), /admin\.a@example\.test/);
    await openPublications(page);
    assert.equal(await page.locator("#tpub-restore-status").count(), 0, `${mode}: o andamento da sessão anterior não aparece`);
    const before = control.calls.length;
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.deepEqual(await notices(page), [], `${mode}: nenhum aviso da sessão anterior`);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: nada da sessão anterior na tela`);
    assert.deepEqual(control.calls.slice(before), [], `${mode}: nenhum pedido`);
    assert.deepEqual(errors, [], mode);
    await context.close();
  }
});

test("C1-D03d: B entra sem que a aba saiba e só a recarga do sucesso revela a troca — o sucesso de A não aparece para B", async () => {
  // A tela em que a resposta encontra a aba: Publicações (o resultado iria para a seção), o Painel e outra turma (iria para o aviso).
  const leave = { "Publicações": null, "Painel": openPanel,
    "outra turma": async (p) => { await p.locator("#cohort").selectOption("BRSA0268"); await p.locator(".teacher-home h1").waitFor(); await quiet(p); } };
  for (const [where, go] of Object.entries(leave)) {
    const { context, page, errors, control, holdNext } = await open();
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    if (go) await go(page);
    control.who = 1;   // a sessão da aba passou a ser de B (outra aba entrou como B); só o próximo /me conta
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    await until(page, () => document.querySelector(".topline")?.innerText.includes("instrutor.b@example.test"));
    assert.match(await topline(page), /instrutor\.b@example\.test/, where);
    assert.deepEqual(await notices(page), [], `nenhum aviso de A para B (${where})`);
    assert.equal(await page.locator(".tpub-op").count(), 0, `nenhum resultado de A na tela de B (${where})`);
    assert.equal(control.restores.length, 1, where);
    assert.deepEqual(errors, [], where);
    await context.close();
  }
});

test("C1-D03e: na sessão original — sucesso e recusa na própria tela, com o foco; clique duplo não repete o pedido; trocar de tela e de turma mantém o aviso de sempre", async () => {
  // Sucesso legítimo, com o foco no resultado.
  let { context, page, errors, control, holdNext } = await open();
  let h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  let done = settled(page, "/report");
  h.gate.resolve();
  await done();
  await until(page, () => !!document.querySelector("#tpub-restore-status.is-done"));
  assert.equal(await text(page.locator("#tpub-restore-status")), "Publicação restaurada.");
  assert.equal(await activeId(page), "tpub-restore-status");
  assert.equal(control.restores.length, 1, "um pedido só");
  assert.deepEqual(await notices(page), []);
  assert.deepEqual(errors, []);
  await context.close();
  // Clique duplo: uma pergunta e um pedido (o segundo clique cai no Restaurar já parado); um clique forçado num Restaurar de
  // outra publicação, sem o disabled (como no PB4), também não pergunta nem envia: a restauração em andamento é da turma.
  ({ context, page, errors, control, holdNext } = await open());
  h = holdNext("restore");
  await restoreButton(page, "p12").dblclick();
  await h.arrived.promise;
  await restoreButton(page, "p11").evaluate((b) => { b.disabled = false; b.click(); });
  await quiet(page);
  assert.equal(control.restores.length, 1, "clique forçado durante o andamento: nenhum pedido a mais");
  assert.equal(control.dialogs.length, 1, "clique forçado durante o andamento: nenhuma pergunta a mais");
  done = settled(page, "/report");
  h.gate.resolve();
  await done();
  await until(page, () => !!document.querySelector("#tpub-restore-status.is-done"));
  assert.equal(await text(page.locator("#tpub-restore-status")), "Publicação restaurada.");
  assert.equal(control.restores.length, 1, "clique duplo: um pedido só");
  assert.equal(control.dialogs.length, 1, "clique duplo: uma pergunta só");
  assert.deepEqual(errors, []);
  await context.close();
  // Recusa legítima (409) na própria tela.
  ({ context, page, errors, control, holdNext } = await open());
  control.restoreMode = 409;
  done = settled(page, "/restore");
  await restoreButton(page, "p12").click();
  await done();
  assert.equal(await text(page.locator("#tpub-restore-status")), `A publicação não foi restaurada. ${MESSAGES.restore[409]} Consultar atualização`);
  assert.equal(await activeId(page), "tpub-restore-status");
  assert.deepEqual(errors, []);
  await context.close();
  // Outra tela da mesma turma (Painel) e outra turma, com sucesso: o aviso de sempre, com a turma quando é outra.
  for (const [go, expected] of [[openPanel, "Publicação restaurada."], [async (p) => { await p.locator("#cohort").selectOption("BRSA0268"); await p.locator(".teacher-home h1").waitFor(); await quiet(p); }, "Publicação da BRSA0267 restaurada."]]) {
    ({ context, page, errors, control, holdNext } = await open());
    h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await go(page);
    done = settled(page, "/report");
    h.gate.resolve();
    await done();
    await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
    assert.deepEqual(await notices(page), [expected]);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("C1-D03f: a sessão expira durante a restauração (401 noutra leitura) — a resposta que chega depois não aparece na entrada pública nem dispara pedido", async () => {
  for (const mode of ["ok", "network", 409]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    control.expireNext = true;
    await page.locator('.tpub-refresh[data-action="refresh-report"]').click();
    await page.getByRole("button", { name: "Entrar no meu portal" }).waitFor();
    await quiet(page);
    const shown = await notices(page), before = control.calls.length;
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.deepEqual(await notices(page), shown, `${mode}: nada da sessão que expirou (só o aviso da expiração, de antes)`);
    assert.deepEqual(control.calls.slice(before), [], `${mode}: nenhum pedido`);
    assert.equal(await page.getByRole("button", { name: "Entrar no meu portal" }).count(), 1, `${mode}: a entrada pública continua`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C1-D03g: B restaura enquanto a restauração de A está pendente — B vê só o próprio andamento e o próprio resultado; a resposta de A não mexe neles, nem depois de um render", async () => {
  const { context, page, errors, control, holdNext } = await open({ role: "admin" });
  const hA = holdNext("restore");
  await restoreButton(page, "p12").click();
  await hA.arrived.promise;
  await switchPerson(page, control, 1);
  await openPublications(page);
  assert.equal(await restoreButton(page, "p11").isDisabled(), false, "Restaurar livre para B");
  const hB = holdNext("restore");
  await restoreButton(page, "p11").click();
  await Promise.race([hB.arrived.promise, page.waitForTimeout(3000)]);   // sem o pedido, falha na asserção abaixo
  assert.equal(control.dialogs.length, 2, "B confirma a própria restauração");
  assert.deepEqual(control.restores.map((r) => `${r.publicationId}←${r.expectedCurrent}`), ["p12←p13", "p11←p13"]);
  const mine = "Restaurando a publicação de 9 de outubro de 2026, 06:03…";
  assert.equal(await text(page.locator("#tpub-restore-status")), mine);
  // A resposta de A chega (o servidor aplicou a de A): nada muda para B, nem depois de um render (Painel e volta).
  const a = settled(page, "/restore");
  hA.gate.resolve();
  await a();
  await openPanel(page);
  await openPublications(page);
  assert.equal(await text(page.locator("#tpub-restore-status")), mine, "o andamento de B continua depois da resposta de A");
  assert.deepEqual(await page.locator("[data-restore]").evaluateAll((bs) => bs.map((b) => b.disabled)), [true, true], "Restaurar continua parado para B");
  assert.deepEqual(await notices(page), [], "nenhum aviso de A para B");
  // A resposta de B: a versão em vigor mudou (a de A); o servidor recusa (409, expectedCurrent) e B vê o próprio resultado na tela.
  const b = settled(page, "/restore");
  hB.gate.resolve();
  await b();
  assert.equal(await text(page.locator("#tpub-restore-status")), `A publicação não foi restaurada. ${MESSAGES.restore[409]} Consultar atualização`);
  assert.deepEqual(await notices(page), []);
  assert.equal(control.server.BRSA0267.current, "p12");
  assert.equal(control.restores.length, 2, "nenhuma repetição");
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------------------------------------------------------------- D04

test("C1-D04a: na própria tela — recusa diz que não restaurou; dúvida (500, 503, rede, resposta perdida) nunca diz isso e leva à consulta, que mostra o que o servidor aplicou; nada se repete", async () => {
  const cases = [
    [403, `A publicação não foi restaurada. ${MESSAGES.restore[403]}`, false],
    ["integrity", `A publicação não foi restaurada. ${MESSAGES.restore.integrity} Consultar atualização`, false],
    [500, `Não foi possível confirmar a restauração. ${MESSAGES.restore[500]} Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização`, false],
    [503, "Não foi possível confirmar a restauração. O portal está temporariamente indisponível. Tente novamente em instantes. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização", false],
    ["network", "Não foi possível confirmar a restauração. A conexão com o portal falhou. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização", false],
    ["lost", "Não foi possível confirmar a restauração. A conexão com o portal falhou. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização", true],
  ];
  for (const [mode, expected, applied] of cases) {
    const { context, page, errors, control } = await open();
    control.restoreMode = mode;
    const done = settled(page, "/restore");
    await restoreButton(page, "p12").click();
    await done();
    assert.equal(await text(page.locator("#tpub-restore-status")), expected, String(mode));
    assert.equal(await page.locator("#tpub-restore-status").getAttribute("role"), "alert");
    assert.equal(await activeId(page), "tpub-restore-status", `${mode}: o foco no resultado`);
    assert.doesNotMatch(await page.locator("main").innerText(), /Failed to fetch/);
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição automática`);
    // A consulta segura mostra a versão em vigor que o servidor tem (aplicada ou não), sem pedir outra restauração.
    if (await page.locator('#tpub-restore-status [data-action="refresh-report"]').count()) {
      const reload = settled(page, "/report");
      await page.locator('#tpub-restore-status [data-action="refresh-report"]').click();
      await reload();
      assert.equal(await text(page.locator(".tpub-current .tpub-version, .tpub-current")).then((t) => /versão restaurada/.test(t)), applied, `${mode}: a consulta mostra o que o servidor aplicou`);
      assert.equal(control.restores.length, 1, `${mode}: a consulta não restaura`);
    }
    assert.deepEqual(await notices(page), [], String(mode));
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C1-D04b: com outra turma na tela — a dúvida diz a turma de origem e a consulta segura, nunca 'não foi restaurada'; a recusa diz que não restaurou; nada aparece na outra turma", async () => {
  for (const [mode, expected] of [["network", UNSURE_RESTORE("BRSA0267")], [500, UNSURE_RESTORE("BRSA0267")], [503, UNSURE_RESTORE("BRSA0267")], ["lost", UNSURE_RESTORE("BRSA0267")],
    [403, `A publicação da BRSA0267 não foi restaurada. ${MESSAGES.restore[403]}`], [409, `A publicação da BRSA0267 não foi restaurada. ${MESSAGES.restore[409]}`]]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await page.locator("#cohort").selectOption("BRSA0268");
    await page.locator(".teacher-home h1").waitFor();
    await openPublications(page);
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
    assert.deepEqual(await notices(page), [expected], String(mode));
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: nada na tela da BRSA0268`);
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição`);
    // A consulta segura indicada: Publicações da turma de origem mostra a versão que o servidor tem.
    if (mode === "lost") {
      await page.locator("#cohort").selectOption("BRSA0267");
      await page.locator(".teacher-home h1").waitFor();
      await openPublications(page);
      assert.match(await text(page.locator(".tpub-current")), /versão restaurada/, "lost: a consulta mostra a versão aplicada");
      assert.equal(control.restores.length, 1);
    }
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C1-D04c: mesma turma — no Painel (o mesmo relatório) a dúvida espera em Publicações, sem afirmar nada; com o relatório trocado (Consultar atualização) em Publicações, a dúvida aparece ali (C2), sem aviso e sem 'Failed to fetch'", async () => {
  // O mesmo relatório (Painel e volta): nenhum aviso, nada de "não foi restaurada"; em Publicações, a dúvida na própria tela.
  for (const mode of ["network", 503]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await openPanel(page);
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.deepEqual(await notices(page), [], `${mode}: nada afirmado no Painel`);
    await openPublications(page);
    assert.match(await text(page.locator("#tpub-restore-status")), /^Não foi possível confirmar a restauração\. .* Ela pode ter sido concluída: consulte a atualização antes de tentar de novo\. Consultar atualização$/, String(mode));
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
  // Relatório trocado durante a restauração (Consultar atualização), com a pessoa em Publicações da turma: a dúvida aparece ali,
  // como alerta, sem aviso temporário (C2; na C1 ia ao aviso, porque a resposta não era deste relatório).
  for (const mode of ["network", 503, 500]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    const reload = settled(page, "/report");
    await page.locator('.tpub-refresh[data-action="refresh-report"]').click();
    await reload();
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso`);
    assert.match(await text(page.locator("#tpub-restore-status")), /^Não foi possível confirmar a restauração\. .* Ela pode ter sido concluída: consulte a atualização antes de tentar de novo\. Consultar atualização$/, `${mode}: a dúvida em Publicações`);
    assert.equal(await page.locator("#tpub-restore-status").getAttribute("role"), "alert", `${mode}: anunciada ali`);
    assert.doesNotMatch(await page.locator("main").innerText(), /Failed to fetch/, String(mode));
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

// ---------------------------------------------------------------- TODO 26

// O backend continua podendo devolver foco salvo. Esse dado legado não pode recriar o editor ou disparar escrita.
test("TODO26-R1: foco legado não reaparece no painel/atividades nem gera escrita ao navegar, consultar ou trocar de turma", async () => {
  for (const width of [1440, 390]) {
    const { context, page, errors, control } = await open({ width, view: "overview" });
    const noFocus = async () => {
      assert.equal(await page.getByRole("heading", { name: "Foco da turma", exact: true }).count(), 0);
      assert.equal(await page.locator("#focus-form, [data-add-focus], [data-remove-focus], #tp-focus-status").count(), 0);
    };
    await noFocus();
    await page.getByRole("button", { name: "Ver por atividade", exact: true }).click();
    await page.getByRole("heading", { name: "Visão por atividade", exact: true }).waitFor();
    await noFocus();
    await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await page.locator(".teacher-home h1").waitFor();
    const refreshed = settled(page, "/report");
    await page.locator('.teacher-home [data-action="refresh-report"]').click();
    await refreshed();
    await noFocus();
    for (const code of ["BRSA0268", "BRSA0267"]) {
      await page.locator("#cohort").selectOption(code);
      await page.getByRole("heading", { name: `Painel da ${code}`, exact: true }).waitFor();
      await noFocus();
    }
    assert.deepEqual(control.focusPosts, [], "nenhum pedido de escrita do foco");
    assert.equal(control.calls.filter((call) => call.includes("/focus-activities")).length, 0);
    assert.deepEqual(control.server.BRSA0267.focus, { activityIds: ["a1", "a2", "a3"], version: "v0" }, "dado legado preservado");
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// ---------------------------------------------------------------- PR #3 (fechamento, B1)

// A recusa (nada mudou no servidor) com a pessoa no Painel da mesma turma, com o mesmo relatório: antes, ela ficava guardada
// para Publicações sem nenhum aviso (o sucesso, no mesmo lugar, avisava). Agora vai ao aviso do portal, como o sucesso e
// como a recusa vista de outra turma (docs/design-visual.md, Publicações da turma), e não reaparece em Publicações.
// A dúvida no mesmo lugar continua esperando em Publicações, sem aviso (C1-D04c).
test("PR3-B1a: recusa da restauração (409, 403, integridade) com a pessoa no Painel da mesma turma — aviso de que não restaurou; nada reaparece em Publicações; nada se repete", async () => {
  for (const mode of [409, 403, "integrity"]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await openPanel(page);
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
    assert.deepEqual(await notices(page), [`A publicação não foi restaurada. ${MESSAGES.restore[mode]}`], `${mode}: o aviso diz que não restaurou e o motivo`);
    await openPublications(page);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: a recusa já avisada não reaparece em Publicações`);
    assert.deepEqual(await page.locator("[data-restore]").evaluateAll((bs) => bs.map((b) => b.disabled)), [false, false], `${mode}: Restaurar livre de novo`);
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

// Duas restaurações pendentes, uma em cada turma: o andamento era uma variável só, e o da segunda turma tomava o lugar do da
// primeira. De volta à primeira, "Restaurando…" sumia, os Restaurar dela voltavam e um segundo pedido saía. A trava é da turma.
test("PR3-B1b: restaurações pendentes em duas turmas — de volta à primeira, o andamento dela continua e nenhum Restaurar pergunta ou envia; cada resultado vai para a sua turma", async () => {
  const { context, page, errors, control, holdNext } = await open();
  const hA = holdNext("restore");
  await restoreButton(page, "p12").click();
  await hA.arrived.promise;
  await page.locator("#cohort").selectOption("BRSA0268");
  await page.locator(".teacher-home h1").waitFor();
  await openPublications(page);
  const hB = holdNext("restore");
  await restoreButton(page, "q1").click();
  await Promise.race([hB.arrived.promise, page.waitForTimeout(3000)]);
  assert.deepEqual(control.restores.map((r) => `${r.code} ${r.publicationId}`), ["BRSA0267 p12", "BRSA0268 q1"]);
  await page.locator("#cohort").selectOption("BRSA0267");
  await page.locator(".teacher-home h1").waitFor();
  await openPublications(page);
  assert.match(await text(page.locator("#tpub-restore-status")) ?? "", /^Restaurando a publicação de 9 de outubro de 2026, 18:04…$/, "o andamento da BRSA0267 continua na tela");
  assert.deepEqual(await page.locator("[data-restore]").evaluateAll((bs) => bs.map((b) => b.disabled)), [true, true], "Restaurar da BRSA0267 parado");
  // Um clique forçado num Restaurar sem o disabled (como em C1-D03e) também não pergunta nem envia.
  await restoreButton(page, "p11").evaluate((b) => { b.disabled = false; b.click(); });
  await quiet(page);
  assert.equal(control.dialogs.length, 2, "nenhuma pergunta a mais");
  assert.equal(control.restores.length, 2, "nenhum pedido a mais");
  // A BRSA0267 conclui com a pessoa na tela dela; a BRSA0268, depois, vai ao aviso com a turma.
  let done = settled(page, "/report");
  hA.gate.resolve();
  await done();
  await until(page, () => !!document.querySelector("#tpub-restore-status.is-done"));
  assert.equal(await text(page.locator("#tpub-restore-status")), "Publicação restaurada.");
  done = settled(page, "/report");
  hB.gate.resolve();
  await done();
  await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
  assert.deepEqual(await notices(page), ["Publicação da BRSA0268 restaurada."]);
  assert.equal(control.restores.length, 2, "nenhuma repetição");
  assert.deepEqual([control.server.BRSA0267.current, control.server.BRSA0268.current], ["p12", "q1"]);
  assert.deepEqual(errors, []);
  await context.close();
});

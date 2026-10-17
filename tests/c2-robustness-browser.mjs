// C2 — robustez pré-integração (docs/design-visual.md), com API fictícia (nunca AWS, Canvas, restauração ou foco reais; tudo
// fora da origem local é abortado), relógio fixo e dados sintéticos:
// C2-01 — a dúvida da restauração (rede, 5xx, resposta perdida) longe de Publicações da turma: um aviso curto (a operação, a
//         turma, a dúvida e onde ver) e a orientação inteira guardada em Publicações da turma de origem, para a sessão que
//         restaurou, até a consulta feita ali ou outra restauração da turma; anunciada uma vez; nada se repete sozinho.
// C2-02 — salvamentos do foco que se sobrepõem na mesma sessão (Consultar atualização ou a ida e volta de turma durante o
//         salvamento; a Visão por atividade muda o rascunho enquanto ele está pendente): a resposta de um não mexe no
//         andamento, no rascunho, no resultado nem no relatório do outro, e não se apresenta como o resultado do outro.
// Garantias do servidor (backend/portal.py): restauração e foco recusam tudo antes da escrita, que é condicional
// (expectedCurrent, versão do foco); 5xx e falta de resposta deixam o resultado desconhecido. Ignorar uma resposta antiga na
// tela não desfaz nada no servidor: o simulador grava como Portal._restore e Portal._focus_activities.
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
  restore: { 409: "A turma foi atualizada. Recarregue o histórico.", 403: "Você não tem acesso a esta operação.", 500: "Erro interno ao restaurar." },
  focus: { 409: "O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar.", 403: "Você não tem acesso a esta operação.", 500: "Erro interno ao salvar o foco." },
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

// control: people (o /me responde people[who], com userId próprio), who, expireNext, restoreMode e focusMode ("ok" | 409 | 403 |
// 500 | 503 | "network" | "lost" = o servidor aplica e a resposta se perde; lidos quando o pedido chega), holds ("restore",
// "focus": antes de gravar; "focus-after": depois de gravar, com a resposta retida), reports (leituras do relatório).
// O estado do servidor (versão em vigor e foco por turma) muda como em Portal._restore e Portal._focus_activities.
// window.__ann registra cada anúncio acessível: um aviso novo na região aria-live (#notices) ou um elemento com role="alert"
// ou role="status" que entra na página.
async function open({ width = 1440, height = 900, text = 1, role = "instructor", people, view = "history" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-11T15:00:00-03:00"));
  people ||= role === "admin" ? ["admin.a@example.test", "admin.b@example.test"] : ["instrutor.a@example.test", "instrutor.b@example.test"];
  const errors = [], control = { people, who: 0, restoreMode: "ok", focusMode: "ok", holds: {}, calls: [], restores: [], focusPosts: [], dialogs: [], reports: 0,
    focusVersion: 0, server: { BRSA0267: { current: "p13", updateKind: "canvas", focus: { activityIds: ["a1", "a2", "a3"], version: "v0" } },
      BRSA0268: { current: "q2", updateKind: "canvas", focus: { activityIds: [], version: null } } } };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { control.dialogs.push(dialog.message()); return dialog.accept(); });
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ email, view }) => {
    if (!sessionStorage.getItem("c2-sessao")) {
      sessionStorage.setItem("c2-sessao", "1");
      localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "teste-c2", expires: Date.now() + 3600000 }));
      localStorage.setItem("avanca.context", JSON.stringify({ owner: email, code: "BRSA0267", view }));
    }
    window.__ann = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.parentElement?.closest("[aria-live]")) window.__ann.push({ via: "aviso", text: n.innerText || n.textContent });
        for (const el of [n, ...n.querySelectorAll('[role="alert"], [role="status"]')])
          if (el.matches('[role="alert"], [role="status"]')) window.__ann.push({ via: el.getAttribute("role"), id: el.id, text: el.textContent });
      }
    }).observe(document, { childList: true, subtree: true });
  }, { email: people[0], view });
  const hold = async (name) => { const h = control.holds[name]; if (!h) return; delete control.holds[name]; h.arrived.resolve(); await h.gate.promise; };
  const reportOf = (code) => {
    const s = control.server[code], history = HISTORY[code], p = history.find((x) => x.id === s.current);
    return { cohort: code, publication: { ...p, releasedAt: {} }, focus: { ...s.focus }, students: code === "BRSA0268" ? STUDENTS.slice(0, 4) : STUDENTS, activities: ACTIVITIES,
      count: STUDENTS.length, warnings: [], thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436", canvasSync: SYNC, history, updatedAt: s.updateKind === "restore" ? "2026-10-11T18:00:00.000Z" : p.publishedAt, updateKind: s.updateKind };
  };
  const fail = (route, kind, mode) => (mode === 503 ? route.fulfill({ status: 503, contentType: "text/plain", body: "" })
    : route.fulfill({ status: mode, json: { error: MESSAGES[kind][mode] } }));
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
      control.reports++;
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
      const body = request.postDataJSON(), mode = control.focusMode, s = control.server[code];
      control.focusPosts.push({ code, ...body });
      await hold("focus");
      if (mode === "network") return route.abort("failed");
      if (mode !== "ok" && mode !== "lost") return fail(route, "focus", mode);
      if (body.expectedVersion !== s.focus.version) return fail(route, "focus", 409);
      s.focus = { activityIds: body.activityIds, version: `v${++control.focusVersion}` };
      const focus = { ...s.focus };
      await hold("focus-after");
      return mode === "lost" ? route.abort("failed") : route.fulfill({ json: { focus } });
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
// Um pedido esperado que um defeito impediria: espera no máximo 3 s e segue (a asserção seguinte acusa).
const arrive = (page, h) => Promise.race([h.arrived.promise, page.waitForTimeout(3000)]);
const notices = (page) => page.locator("#notices .notice span").allTextContents();
const text = async (locator) => ((await locator.count()) ? (await locator.first().innerText()).replace(/\s+/g, " ").trim() : null);
const restoreButton = (page, id) => page.locator(`[data-restore="${id}"]`);
const activeId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const topline = (page) => text(page.locator(".topline"));
const announced = (page, pattern) => page.evaluate((src) => window.__ann.filter((a) => new RegExp(src).test(a.text || "")).map((a) => a.via), pattern.source);
// A resposta (ou a falha) do pedido chegou e a continuação dela teve tempo de rodar.
const settled = (page, suffix) => {
  const done = Promise.race([page.waitForResponse((r) => r.url().endsWith(suffix)), page.waitForEvent("requestfailed", { predicate: (r) => r.url().endsWith(suffix) })]).catch(() => null);
  return async () => { await done; await page.waitForTimeout(300); await settle(page); };
};
const openPublications = async (page) => { await page.locator('.sidebar nav [data-view="history"]').click(); await page.locator(".teacher-publications h1").waitFor(); await quiet(page); };
const openPanel = async (page) => { await page.locator('.sidebar nav [data-view="overview"]').click(); await page.locator(".teacher-home h1").waitFor(); await quiet(page); };
const cohort = async (page, code) => { await page.locator("#cohort").selectOption(code); await page.getByRole("heading", { name: `Painel da ${code}`, exact: true }).waitFor(); await quiet(page); };
// "Consultar atualização" de uma área (Publicações, a orientação, o Painel) e a leitura do relatório que ela pede.
const consult = async (page, scope) => { const reload = settled(page, "/report"); await page.locator(`${scope} [data-action="refresh-report"]`).first().click(); await reload(); };
// Troca de pessoa na aba (como nas Expansões 8 e 9 e na C1): o admin salva as configurações da turma, e o boot que vem depois
// consulta o /me de novo — quem responde é outra pessoa (ou a mesma, numa sessão nova).
async function switchPerson(page, control, who) {
  control.who = who;
  await page.locator('.sidebar nav [data-view="access"]').click();
  await page.locator("#cohort-settings-form button[type=submit]").waitFor();
  await page.locator("#cohort-settings-form button[type=submit]").click();
  await until(page, (email) => document.querySelector(".topline")?.innerText.includes(email) && !document.querySelector("[aria-busy=true], .aa-op.is-busy"), control.people[who]);
  await quiet(page);
}
const doubt = (page) => page.locator(".tpub-op.is-error");
const focusStatus = (page) => page.locator("#tp-focus-status");
const removeFocus = (page, n) => page.getByRole("button", { name: `Remover ${200 + n - 1}-KC - Atividade ${n} do foco`, exact: true });
const saveFocus = (page) => page.locator('#focus-form [type="submit"]');
const focusNames = (page) => page.locator(".focus-list .tp-focus-name").allTextContents();
const NAME = (n) => `${200 + n - 1}-KC - Atividade ${n}`;
// A Visão por atividade (o link da seção do foco), uma atividade a mais no rascunho e a volta ao painel.
async function addFromOverview(page, id) {
  await page.locator('#focus-form [data-view="activity-overview"]').click();
  await page.getByRole("heading", { name: "Visão por atividade", exact: true }).waitFor();
  await page.locator(`[data-add-focus="${id}"]`).click();
  await quiet(page);
  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  await page.locator(".teacher-home h1").waitFor();
  await quiet(page);
}
const rerender = async (page) => { await openPublications(page); await openPanel(page); };

const TOAST = (code) => `Não foi possível confirmar a restauração da turma ${code}. Ela pode ter sido concluída: veja Publicações.`;
const REASON = { network: "A conexão com o portal falhou.", lost: "A conexão com o portal falhou.", 500: MESSAGES.restore[500],
  503: "O portal está temporariamente indisponível. Tente novamente em instantes." };
const GUIDANCE = (mode) => `Não foi possível confirmar a restauração. ${REASON[mode]} Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização`;
const PRIOR = {
  ok: (code) => `O salvamento anterior do foco da ${code} foi concluído.`,
  refused: (code, reason) => `O salvamento anterior do foco da ${code} foi recusado. ${reason}`,
  unsure: (code) => `Não foi possível confirmar o salvamento anterior do foco da ${code}: ele pode ter sido concluído.`,
};
// Começa uma restauração da p12 na BRSA0267, leva a pessoa à outra turma e solta a resposta (no modo pedido).
async function restoreAway(page, control, holdNext, mode) {
  control.restoreMode = mode;
  const h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  await cohort(page, "BRSA0268");
  const done = settled(page, "/restore");
  h.gate.resolve();
  await done();
  await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
}

// ---------------------------------------------------------------- C2-01

test("C2-N1: com outra turma na tela, a dúvida da restauração vem num aviso curto (a operação, a turma, a dúvida e onde ver) e a orientação inteira fica em Publicações da turma de origem até a consulta feita ali; nada se repete", async () => {
  for (const mode of ["network", 500, 503, "lost"]) {
    const { context, page, errors, control, holdNext } = await open();
    await restoreAway(page, control, holdNext, mode);
    assert.deepEqual(await notices(page), [TOAST("BRSA0267")], `${mode}: o aviso curto`);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: nada na tela da BRSA0268`);
    // De volta à turma de origem, Publicações mostra a orientação inteira (o texto da E5), na publicação que se tentou
    // restaurar, sem anunciar de novo (o aviso já anunciou) e com a consulta segura; Restaurar continua livre.
    await cohort(page, "BRSA0267");
    await openPublications(page);
    assert.equal(await text(doubt(page)), GUIDANCE(mode), `${mode}: a orientação em Publicações`);
    assert.equal(await page.locator("#tpub-p12 .tpub-op.is-error").count(), 1, `${mode}: na publicação que se tentou restaurar`);
    assert.equal(await doubt(page).getAttribute("role"), null, `${mode}: já anunciada pelo aviso`);
    assert.deepEqual(await announced(page, /confirmar a restauração/), ["aviso"], `${mode}: um anúncio só`);
    assert.equal(await restoreButton(page, "p11").isEnabled(), true, `${mode}: Restaurar livre`);
    assert.equal(control.restores.length, 1, `${mode}: nenhuma repetição`);
    // A consulta feita ali mostra a versão em vigor que o servidor tem e encerra a orientação; nada é restaurado.
    await consult(page, "#tpub-restore-status");
    assert.equal(await doubt(page).count(), 0, `${mode}: a consulta encerra a orientação`);
    assert.equal(/versão restaurada/.test(await text(page.locator(".tpub-current"))), mode === "lost", `${mode}: a versão em vigor do servidor`);
    assert.equal(control.restores.length, 1, `${mode}: a consulta não restaura`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C2-N2: recusa da restauração com outra turma na tela continua o aviso de recusa da C1, e nada fica guardado em Publicações", async () => {
  for (const mode of [403, 409]) {
    const { context, page, errors, control, holdNext } = await open();
    await restoreAway(page, control, holdNext, mode);
    assert.deepEqual(await notices(page), [`A publicação da BRSA0267 não foi restaurada. ${MESSAGES.restore[mode]}`], String(mode));
    await cohort(page, "BRSA0267");
    await openPublications(page);
    assert.equal(await page.locator(".tpub-op").count(), 0, `${mode}: nada guardado`);
    assert.equal(control.restores.length, 1);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

test("C2-N3: a navegação não resolve a dúvida — Painel, Publicações e a ida e volta de turma mantêm a orientação; consultar no Painel não a encerra; a consulta em Publicações sim; outra restauração da turma a substitui", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await restoreAway(page, control, holdNext, "network");
  await cohort(page, "BRSA0267");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "na volta");
  await openPanel(page);
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "Painel e volta");
  await cohort(page, "BRSA0268");
  await cohort(page, "BRSA0267");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "ida e volta de turma");
  await openPanel(page);
  await consult(page, ".teacher-home");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "consultar no Painel não encerra");
  // Outra restauração da turma: a dúvida antiga sai quando ela começa; o resultado novo fica na tela, como na E5.
  control.restoreMode = "ok";
  const done = settled(page, "/report");
  await restoreButton(page, "p11").click();
  await done();
  await until(page, () => !!document.querySelector("#tpub-restore-status.is-done"));
  assert.equal(await doubt(page).count(), 0, "a restauração nova substitui a dúvida");
  assert.equal(await text(page.locator("#tpub-restore-status")), "Publicação restaurada.");
  await cohort(page, "BRSA0268");
  await cohort(page, "BRSA0267");
  await openPublications(page);
  assert.equal(await doubt(page).count(), 0, "a dúvida antiga não volta");
  assert.equal(control.restores.length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-N4: relatório trocado durante a restauração (Consultar atualização) — em Publicações, a dúvida aparece ali, anunciada uma vez, sem aviso temporário; no Painel, o aviso curto (não o erro cru) e a orientação em Publicações", async () => {
  for (const mode of ["network", 500]) {
    const { context, page, errors, control, holdNext } = await open();
    control.restoreMode = mode;
    const h = holdNext("restore");
    await restoreButton(page, "p12").click();
    await h.arrived.promise;
    await consult(page, ".tpub-sync");
    const done = settled(page, "/restore");
    h.gate.resolve();
    await done();
    assert.equal(await text(doubt(page)), GUIDANCE(mode), String(mode));
    assert.equal(await doubt(page).getAttribute("role"), "alert", `${mode}: anunciada ali`);
    assert.deepEqual(await notices(page), [], `${mode}: sem aviso temporário`);
    assert.deepEqual(await announced(page, /confirmar a restauração/), ["alert"], `${mode}: um anúncio só`);
    assert.equal(control.restores.length, 1);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
  const { context, page, errors, control, holdNext } = await open();
  control.restoreMode = "network";
  const h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  await openPanel(page);
  await consult(page, ".teacher-home");
  const done = settled(page, "/restore");
  h.gate.resolve();
  await done();
  await until(page, () => document.querySelectorAll("#notices .notice").length > 0);
  assert.deepEqual(await notices(page), [TOAST("BRSA0267")], "Painel: o aviso curto");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "Painel: a orientação em Publicações");
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-N5: mesma turma e mesmo relatório no Painel (como na E5) — sem aviso; a dúvida espera em Publicações e é anunciada lá", async () => {
  const { context, page, errors, control, holdNext } = await open();
  control.restoreMode = "network";
  const h = holdNext("restore");
  await restoreButton(page, "p12").click();
  await h.arrived.promise;
  await openPanel(page);
  const done = settled(page, "/restore");
  h.gate.resolve();
  await done();
  assert.deepEqual(await notices(page), [], "sem aviso");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"));
  assert.equal(await doubt(page).getAttribute("role"), "alert");
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-N6: a orientação é da sessão que restaurou — não aparece para quem entra na aba, nem para a mesma pessoa numa sessão nova (A → B → A)", async () => {
  const { context, page, errors, control, holdNext } = await open({ role: "admin" });
  await restoreAway(page, control, holdNext, "network");
  await cohort(page, "BRSA0267");
  await openPublications(page);
  assert.equal(await text(doubt(page)), GUIDANCE("network"), "A vê a orientação");
  await switchPerson(page, control, 1);
  await openPublications(page);
  assert.match(await topline(page), /admin\.b@example\.test/);
  assert.equal(await doubt(page).count(), 0, "nada de A para B");
  await switchPerson(page, control, 0);
  await openPublications(page);
  assert.match(await topline(page), /admin\.a@example\.test/);
  assert.equal(await doubt(page).count(), 0, "a sessão anterior de A não volta");
  assert.equal(control.restores.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

// O limite: o aviso do portal (que a C2 não muda) tem cerca de 19 caracteres por linha a 390 com texto a 200%; a mensagem com a
// dúvida, "pode ter sido concluída" e onde ver ocupa 6 linhas (284 px, 34%; antes, 575 px e 68%). Medido antes de escolher: a frase
// única (24%) perde "pode ter sido concluída"; dizer "Publicações da BRSA0267" passa a 7 linhas (39%). Por isso 35%, não um terço.
test("C2-N7: no celular (390 com texto a 200%, 320) e com zoom a 200% — o aviso curto ocupa no máximo 35% da altura e fica dentro da largura; a orientação em Publicações cabe sem rolagem lateral", async () => {
  for (const cfg of [{ width: 390, height: 844, text: 2 }, { width: 320, height: 640 }, { width: 720, height: 450 }]) {
    const label = `${cfg.width}x${cfg.height}${cfg.text ? " texto 200%" : ""}`;
    const { context, page, errors, control, holdNext } = await open(cfg);
    await restoreAway(page, control, holdNext, "network");
    const m = await page.evaluate(() => {
      const n = document.querySelector("#notices .notice").getBoundingClientRect(), de = document.documentElement;
      return { fraction: n.height / innerHeight, inside: n.left >= 0 && n.right <= de.clientWidth + 0.5, sideways: de.scrollWidth > de.clientWidth };
    });
    assert.ok(m.fraction <= 0.35, `${label}: o aviso ocupa ${Math.round(m.fraction * 100)}% da altura`);
    assert.equal(m.inside, true, `${label}: o aviso dentro da largura`);
    assert.equal(m.sideways, false, `${label}: sem rolagem lateral`);
    await cohort(page, "BRSA0267");
    await openPublications(page);
    assert.equal(await text(doubt(page)), GUIDANCE("network"), label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${label}: Publicações sem rolagem lateral`);
    assert.deepEqual(errors, [], label);
    await context.close();
  }
});

test("C2-N8: teclado — a orientação guardada não rouba o foco ao abrir Publicações; o Tab chega da Restaurar dela à consulta, e Enter consulta", async () => {
  const { context, page, errors, control, holdNext } = await open();
  await restoreAway(page, control, holdNext, "network");
  await cohort(page, "BRSA0267");
  await openPublications(page);
  assert.notEqual(await activeId(page), "tpub-restore-status", "a navegação não leva o foco à orientação");
  await restoreButton(page, "p12").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.closest("#tpub-restore-status") && document.activeElement.textContent), "Consultar atualização");
  const reload = settled(page, "/report");
  await page.keyboard.press("Enter");
  await reload();
  assert.equal(await doubt(page).count(), 0, "Enter consulta e encerra a orientação");
  assert.equal(control.restores.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------------------------------------------------------------- C2-02

test("C2-F0: alcançabilidade — clique duplo, Enter com Salvar parado e renders não abrem um segundo salvamento; Consultar atualização e a ida e volta de turma abrem; a Visão por atividade muda o rascunho durante o salvamento", async () => {
  // Clique duplo, Enter e renders no mesmo relatório: um pedido só, Salvar parado.
  let { context, page, errors, control, holdNext } = await open({ view: "overview" });
  await removeFocus(page, 2).click();
  let h = holdNext("focus");
  await saveFocus(page).dblclick();
  await h.arrived.promise;
  await saveFocus(page).focus().catch(() => {});
  await page.keyboard.press("Enter");
  await rerender(page);
  assert.equal(await saveFocus(page).isDisabled(), true, "Salvar parado depois de renders");
  assert.equal(control.focusPosts.length, 1, "clique duplo, Enter e renders: um pedido");
  // Na mesma tela, a Visão por atividade continua aberta e muda o rascunho enquanto o salvamento espera.
  await addFromOverview(page, "a4");
  assert.deepEqual(await focusNames(page), [NAME(1), NAME(3), NAME(4)], "o rascunho mudou durante o salvamento");
  h.gate.resolve();
  await context.close();
  // Consultar atualização e a ida e volta de turma durante o salvamento: um relatório novo, com Salvar livre — um segundo
  // salvamento da mesma turma, na mesma sessão, começa pelo fluxo normal.
  for (const away of [(p) => consult(p, ".teacher-home"), async (p) => { await cohort(p, "BRSA0268"); await cohort(p, "BRSA0267"); }]) {
    ({ context, page, errors, control, holdNext } = await open({ view: "overview" }));
    await removeFocus(page, 2).click();
    h = holdNext("focus");
    await saveFocus(page).click();
    await h.arrived.promise;
    await away(page);
    assert.equal(await saveFocus(page).isDisabled(), false, "Salvar livre no relatório novo");
    await removeFocus(page, 3).click();
    const second = holdNext("focus");
    await saveFocus(page).click();
    await arrive(page, second);
    assert.equal(control.focusPosts.length, 2, "o segundo salvamento saiu com o primeiro pendente");
    h.gate.resolve(); second.gate.resolve();
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// A pendente; Consultar atualização; um rascunho novo e B pendente (a mesma turma, a mesma sessão).
async function twoSaves(page, control, holdNext, { modeA = "ok", modeB = "ok", afterA = false } = {}) {
  await removeFocus(page, 2).click();
  control.focusMode = modeA;
  const a = holdNext(afterA ? "focus-after" : "focus");
  await saveFocus(page).click();
  await a.arrived.promise;
  await consult(page, ".teacher-home");
  await removeFocus(page, afterA ? 1 : 3).click();
  control.focusMode = modeB;
  const b = holdNext("focus");
  await saveFocus(page).click();
  await arrive(page, b);
  assert.equal(control.focusPosts.length, 2, "dois salvamentos pendentes");
  return { a, b };
}
const release = async (page, h) => { const done = settled(page, "/focus-activities"); h.gate.resolve(); await done(); };

test("C2-F1: a resposta do salvamento anterior (sucesso) não desfaz o andamento nem o rascunho do novo, não se apresenta como dele e não mexe no relatório novo; o novo recebe a recusa do servidor", async () => {
  const { context, page, errors, control, holdNext } = await open({ view: "overview" });
  const { a, b } = await twoSaves(page, control, holdNext);
  await release(page, a);
  const checkB = async (label) => {
    assert.equal(await text(focusStatus(page)), "Salvando o foco da turma…", `${label}: o andamento de B`);
    assert.equal(await saveFocus(page).isDisabled(), true, `${label}: Salvar parado`);
    assert.deepEqual(await focusNames(page), [NAME(1), NAME(2)], `${label}: o rascunho de B`);
  };
  await checkB("resposta de A");
  assert.deepEqual(await notices(page), [PRIOR.ok("BRSA0267")], "o aviso é do salvamento anterior");
  await rerender(page);
  await checkB("depois de um render");
  // B partiu da versão de antes de A: o servidor recusa (409, versão) e B vê a recusa na seção, com o rascunho.
  await release(page, b);
  assert.equal(await text(focusStatus(page)), `O foco não foi salvo. ${MESSAGES.focus[409]}`);
  assert.deepEqual(await focusNames(page), [NAME(1), NAME(2)], "o rascunho de B continua");
  assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a1", "a3"], "o servidor ficou com A");
  assert.equal(control.focusPosts.length, 2, "nenhum pedido a mais");
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-F2: respostas invertidas — B confirmado primeiro; a recusa de A depois não aparece como de B; e o sucesso atrasado de A (gravado antes de B) não sobrescreve a confirmação de B", async () => {
  // B responde primeiro (gravou); A chega depois com 409 (a versão mudou): o aviso é do salvamento anterior.
  let { context, page, errors, control, holdNext } = await open({ view: "overview" });
  let { a, b } = await twoSaves(page, control, holdNext);
  await release(page, b);
  assert.equal(await text(focusStatus(page)), "Foco da BRSA0267 atualizado.");
  await release(page, a);
  assert.deepEqual(await notices(page), [PRIOR.refused("BRSA0267", MESSAGES.focus[409])]);
  assert.equal(await text(focusStatus(page)), "Foco da BRSA0267 atualizado.", "a seção continua com o resultado de B");
  assert.deepEqual(await focusNames(page), [NAME(1), NAME(2)]);
  assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a1", "a2"]);
  assert.deepEqual(errors, []);
  await context.close();
  // A gravou e a resposta atrasou; a consulta mostra A; B grava em cima de A e responde; a resposta de A chega por último.
  ({ context, page, errors, control, holdNext } = await open({ view: "overview" }));
  ({ a, b } = await twoSaves(page, control, holdNext, { afterA: true }));
  await release(page, b);
  assert.equal(await text(focusStatus(page)), "Foco da BRSA0267 atualizado.");
  assert.deepEqual(await focusNames(page), [NAME(3)]);
  await release(page, a);
  assert.deepEqual(await notices(page), [PRIOR.ok("BRSA0267")]);
  await rerender(page);
  assert.deepEqual(await focusNames(page), [NAME(3)], "a confirmação de B continua na tela");
  assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a3"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-F3: erro ou dúvida do salvamento anterior depois de o novo começar — o aviso diz que é do anterior; o novo segue e mostra o próprio resultado", async () => {
  for (const [modeA, expected] of [["network", PRIOR.unsure("BRSA0267")], [500, PRIOR.unsure("BRSA0267")], [403, PRIOR.refused("BRSA0267", MESSAGES.focus[403])]]) {
    const { context, page, errors, control, holdNext } = await open({ view: "overview" });
    const { a, b } = await twoSaves(page, control, holdNext, { modeA });
    await release(page, a);
    assert.deepEqual(await notices(page), [expected], String(modeA));
    assert.equal(await text(focusStatus(page)), "Salvando o foco da turma…", `${modeA}: o andamento de B`);
    await release(page, b);
    assert.equal(await text(focusStatus(page)), "Foco da BRSA0267 atualizado.", `${modeA}: o resultado de B`);
    assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a1", "a2"]);
    assert.equal(control.focusPosts.length, 2, `${modeA}: nenhum pedido a mais`);
    assert.deepEqual(errors, [], String(modeA));
    await context.close();
  }
});

test("C2-F4: troca de turma — a resposta do salvamento da turma de origem não desfaz o salvamento em andamento na outra, nem leva rascunho; o aviso diz a turma de origem", async () => {
  const { context, page, errors, control, holdNext } = await open({ view: "overview" });
  await removeFocus(page, 2).click();
  const a = holdNext("focus");
  await saveFocus(page).click();
  await a.arrived.promise;
  await cohort(page, "BRSA0268");
  assert.equal(await page.locator(".focus-list").count(), 0, "a outra turma começa sem o rascunho");
  await addFromOverview(page, "a5");
  const b = holdNext("focus");
  await saveFocus(page).click();
  await arrive(page, b);
  await release(page, a);
  assert.deepEqual(await notices(page), ["Foco da BRSA0267 atualizado."]);
  await rerender(page);
  assert.equal(await text(focusStatus(page)), "Salvando o foco da turma…", "o andamento da BRSA0268 continua");
  assert.equal(await saveFocus(page).isDisabled(), true);
  await release(page, b);
  assert.equal(await text(focusStatus(page)), "Foco da BRSA0268 atualizado.");
  assert.deepEqual(control.server.BRSA0268.focus.activityIds, ["a5"]);
  assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a1", "a3"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-F5: rascunho — o sucesso do salvamento não apaga uma escolha feita enquanto ele esperava (na mesma tela, pela Visão por atividade, ou num relatório novo); o relatório novo não muda de versão por baixo do rascunho", async () => {
  // Mesma tela: a Visão por atividade acrescentou a4 durante o salvamento; a resposta não apaga a escolha.
  let { context, page, errors, control, holdNext } = await open({ view: "overview" });
  await removeFocus(page, 2).click();
  let h = holdNext("focus");
  await saveFocus(page).click();
  await h.arrived.promise;
  await addFromOverview(page, "a4");
  await release(page, h);
  assert.deepEqual(await focusNames(page), [NAME(1), NAME(3), NAME(4)], "a escolha feita durante o salvamento continua");
  assert.equal(await text(focusStatus(page)), "Alterações ainda não salvas: os alunos continuam vendo o foco anterior.");
  assert.deepEqual(control.server.BRSA0267.focus.activityIds, ["a1", "a3"]);
  assert.deepEqual(errors, []);
  await context.close();
  // Relatório novo (Consultar atualização) com um rascunho: o sucesso de A não o apaga nem move a versão dele; salvar o
  // rascunho leva a versão de onde ele partiu, e o servidor recusa (409) — nada de "última escrita vence" no navegador.
  ({ context, page, errors, control, holdNext } = await open({ view: "overview" }));
  await removeFocus(page, 2).click();
  h = holdNext("focus");
  await saveFocus(page).click();
  await h.arrived.promise;
  await consult(page, ".teacher-home");
  await removeFocus(page, 3).click();
  await release(page, h);
  await rerender(page);
  assert.deepEqual(await focusNames(page), [NAME(1), NAME(2)], "o rascunho do relatório novo continua");
  assert.deepEqual(await notices(page), ["Foco da BRSA0267 atualizado."]);
  const done = settled(page, "/focus-activities");
  await saveFocus(page).click();
  await done();
  assert.equal(control.focusPosts.at(-1).expectedVersion, "v0", "a versão de onde o rascunho partiu");
  assert.equal(await text(focusStatus(page)), `O foco não foi salvo. ${MESSAGES.focus[409]}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-F6: sessão — A → B → A: a resposta da sessão anterior não desfaz o salvamento da sessão nova, nem avisa nada", async () => {
  const { context, page, errors, control, holdNext } = await open({ role: "admin", view: "overview" });
  await removeFocus(page, 2).click();
  const a = holdNext("focus");
  await saveFocus(page).click();
  await a.arrived.promise;
  await switchPerson(page, control, 1);
  await switchPerson(page, control, 0);
  await openPanel(page);
  await removeFocus(page, 3).click();
  const b = holdNext("focus");
  await saveFocus(page).click();
  await arrive(page, b);
  const shown = await notices(page);
  await release(page, a);
  assert.deepEqual(await notices(page), shown, "nada da sessão anterior");
  await rerender(page);
  assert.equal(await text(focusStatus(page)), "Salvando o foco da turma…");
  await release(page, b);
  assert.equal(await text(focusStatus(page)), `O foco não foi salvo. ${MESSAGES.focus[409]}`);
  assert.equal(control.focusPosts.length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test("C2-F7: sucesso só depois da resposta e nenhum pedido repetido sozinho — nem na dúvida (rede, 5xx), nem na recusa", async () => {
  for (const mode of ["ok", "network", 500, 409]) {
    const { context, page, errors, control, holdNext } = await open({ view: "overview" });
    control.focusMode = mode;
    await removeFocus(page, 2).click();
    const h = holdNext("focus");
    await saveFocus(page).click();
    await h.arrived.promise;
    assert.equal(await text(focusStatus(page)), "Salvando o foco da turma…", `${mode}: nada de sucesso antes da resposta`);
    await release(page, h);
    await page.waitForTimeout(500);
    assert.equal(control.focusPosts.length, 1, `${mode}: nenhum pedido repetido`);
    assert.deepEqual(errors, [], String(mode));
    await context.close();
  }
});

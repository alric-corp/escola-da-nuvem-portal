// Teste isolado com API fictícia. Nunca envia e-mail real nem acessa dados AWS.
// Cobre o todo/08: filtrar "Com atividades sem nota", revisar destinatários e motivos de
// pular, enviar em lote e ver o resultado por aluno. Depois, o ciclo de vida dos lembretes:
// prévia individual, remetente, envios, cópia, filtros do painel e respostas atrasadas.
import assert from "node:assert/strict";
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  let previewCalls = 0, sendCalls = 0;
  const students = [
    { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 50, lab: 100, total: 75, completed: 1, pending: 2, progress: 33, status: "attention" },
    { id: "2", name: "Bruna Teste", email: null, kc: 40, lab: 60, total: 50, completed: 0, pending: 3, progress: 0, status: "critical" },
    { id: "3", name: "Carla Teste", email: "carla@example.test", kc: 100, lab: 100, total: 100, completed: 2, pending: 0, progress: 100, status: "ok" },
  ];
  const publication = { id: "p1", publishedAt: "2026-09-24T12:00:00Z" };
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }] } });
    if (endpoint.endsWith("/report") && request.method() === "GET")
      return route.fulfill({ json: { students, publication, history: [], focus: { activityIds: [], version: null } } });
    if (endpoint.endsWith("/pending-preview-batch")) {
      previewCalls++;
      assert.deepEqual(new Set(request.postDataJSON().studentIds), new Set(["1", "2"]));
      return route.fulfill({ json: {
        publicationId: publication.id, publishedAt: publication.publishedAt,
        ses: { ready: true, reason: "Remetente confirmado." },
        sample: { from: "instrutor@example.test", subject: "Podemos ajudar? Atividades sem nota · BRSA0267", text: "Olá, Ana Teste!" },
        recipients: [
          { id: "1", name: "Ana Teste", email: "ana@example.test", pending: 2, skip: null },
          { id: "2", name: "Bruna Teste", email: null, pending: 3, skip: "no-email" },
        ],
      } });
    }
    if (endpoint.endsWith("/send-reminders")) {
      sendCalls++;
      // Só quem a prévia aprovou vai no envio: Bruna, pulada na prévia (sem e-mail), fica de fora (C7.2.3).
      assert.deepEqual(request.postDataJSON(), { studentIds: ["1"], expectedPublicationId: publication.id });
      return route.fulfill({ json: { publicationId: publication.id, results: [
        { id: "1", name: "Ana Teste", status: "sent" },
      ] } });
    }
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  await page.locator("#status-filter").selectOption("pending");
  assert.equal(await page.locator("tbody tr").count(), 2);
  const batchButton = page.getByRole("button", { name: "Enviar lembrete para 2 alunos", exact: true });
  await batchButton.waitFor();
  await batchButton.click();

  await page.getByRole("heading", { name: "Lembretes em lote", exact: true }).waitFor();
  await page.getByText(/1 de 2 alunos vai receber/).waitFor();
  assert.equal(previewCalls, 1);
  // Expansão 7: quem fica de fora vem agrupado por motivo.
  assert.match(await page.locator(".trem-out").innerText(), /Sem e-mail no Canvas · 1\s+Bruna Teste/);
  await page.getByText("Olá, Ana Teste!", { exact: true }).waitFor();

  // O envio é assíncrono: espera a resposta do mock (sendCalls já foi incrementado antes do
  // fulfill) em vez de conferir o contador logo após o clique.
  const sent = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/send-reminders"));
  await page.getByRole("button", { name: "Enviar para 1 aluno", exact: true }).click();
  await sent;
  assert.equal(sendCalls, 1);
  await page.getByText("1 aceito pelo serviço de envio.", { exact: true }).waitFor();
  assert.match(await page.locator(".trem-result").innerText(), /Aceitos pelo serviço de envio · 1\s+Ana Teste/);
  assert.doesNotMatch(await page.locator(".trem-result").innerText(), /Bruna Teste/);

  await page.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
  await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
  assert.equal(await page.locator("#status-filter").inputValue(), "pending");

  assert.deepEqual(errors, []);
  console.log("Lembretes em lote: filtro, destinatários pulados, prévia, envio e resultado por aluno OK.");

  // Ciclo de vida dos lembretes (1440px): prévia individual, lote, remetente, envios, cópia, filtros
  // do painel e respostas atrasadas. Caracteriza o comportamento atual; API e e-mail fictícios.
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  // Uma ida e volta de rede feita pela própria página: respostas já liberadas são processadas antes.
  const flushNetwork = (tab) => tab.evaluate(() => fetch("/index.html", { cache: "no-store" }).then((r) => r.text()).then(() => true));
  const snapshot = (tab, ...keys) => tab.evaluate((k) => JSON.parse(JSON.stringify(Object.fromEntries(k.map((key) => [key, window.__state[key]])))), keys);
  const noticeTexts = (tab) => tab.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));
  const filtersOf = async (tab) => [await tab.locator("#search").inputValue(), await tab.locator("#status-filter").inputValue(), await tab.locator("#student-sort").inputValue()];
  // Conta as mudanças em #app a partir de agora (render() troca o innerHTML de #app).
  const watchRenders = (tab) => tab.evaluate(() => {
    window.__renders = 0;
    window.__renderObserver?.disconnect();
    window.__renderObserver = new MutationObserver((list) => { window.__renders += list.length; });
    window.__renderObserver.observe(document.querySelector("#app"), { childList: true });
  });
  const rendersSince = (tab) => tab.evaluate(() => window.__renders + window.__renderObserver.takeRecords().length);
  const roster = {
    BRSA0267: [
      { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 50, lab: 100, total: 75, completed: 1, pending: 2, progress: 33, status: "attention" },
      { id: "2", name: "Bruna Teste", email: null, kc: 40, lab: 60, total: 50, completed: 0, pending: 3, progress: 0, status: "critical" },
      { id: "3", name: "Carla Teste", email: "carla@example.test", kc: 100, lab: 100, total: 100, completed: 2, pending: 0, progress: 100, status: "ok" },
    ],
    // Mesmo id "1" em outra turma: isola a guarda por turma da guarda por aluno.
    BRSA0268: [
      { id: "1", name: "Diego Teste", email: "diego@example.test", kc: 30, lab: 50, total: 40, completed: 0, pending: 4, progress: 0, status: "critical" },
      { id: "4", name: "Eva Teste", email: "eva@example.test", kc: 90, lab: 100, total: 95, completed: 3, pending: 1, progress: 75, status: "ok" },
    ],
  };
  const studentOf = (code, id) => roster[code].find((r) => r.id === id);
  const pendingFor = (code, id, delivery = null) => {
    const s = studentOf(code, id);
    return { student: { id: s.id, name: s.name, email: s.email }, publicationId: `pub-${code}`, publishedAt: "2026-09-24T12:00:00Z", previewHash: `hash-${code}-${id}`,
      activities: [{ id: "k1", name: "001 KC Pendente", kind: "kc", state: "pending", active: true, points: "100" }], remindersEnabled: true, delivery,
      ses: { ready: true, reason: "Remetente confirmado." },
      message: { from: "instrutor@example.test", to: s.email, subject: `Podemos ajudar? · ${code}`, text: `Olá, ${s.name}!` } };
  };
  const batchFor = (code, ids) => ({ publicationId: `pub-${code}`, publishedAt: "2026-09-24T12:00:00Z", ses: { ready: true, reason: "Remetente confirmado." },
    sample: { from: "instrutor@example.test", subject: `Podemos ajudar? · ${code}`, text: "Olá!" },
    recipients: ids.map((id) => { const s = studentOf(code, id); return { id, name: s.name, email: s.email, pending: s.pending, skip: s.email ? null : "no-email" }; }) });
  const senderFor = (code) => ({ enabled: true, ready: false, sender: `instrutor.${code.toLowerCase()}@example.test`, reason: `Confirme o remetente da ${code}.` });
  const held = (route, gate, json, status = 200) => gate.promise.then(() => route.fulfill({ status, json }));
  async function open() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const log = { requests: [], errors: [], dialogs: [], acceptConfirm: true, handle: null, delivery: {} };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice(4);
      const entry = { method: request.method(), path: endpoint, query: url.search, body: request.postData() ? request.postDataJSON() : null };
      log.requests.push(entry);
      const custom = log.handle?.({ route, entry });
      if (custom) return custom;
      const [, , code, op] = endpoint.split("/");
      if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: Object.keys(roster).map((c) => ({ code: c, canTeach: true })) } });
      if (op === "report") return route.fulfill({ json: { students: roster[code], publication: { id: `pub-${code}`, publishedAt: "2026-09-24T12:00:00Z" }, history: [], focus: { activityIds: [], version: null } } });
      if (op === "pending-preview") return route.fulfill({ json: pendingFor(code, entry.body.studentId, log.delivery[`${code}/${entry.body.studentId}`] || null) });
      if (op === "pending-preview-batch") return route.fulfill({ json: batchFor(code, entry.body.studentIds) });
      if (op === "reminder-settings") return route.fulfill({ json: senderFor(code) });
      if (op === "verify-sender") return route.fulfill({ json: { ...senderFor(code), reason: "Confirmação solicitada." } });
      if (op === "send-reminder") {
        log.delivery[`${code}/${entry.body.studentId}`] = { status: "sent" };
        return route.fulfill({ json: { delivery: { status: "sent" } } });
      }
      if (op === "send-reminders") return route.fulfill({ json: { publicationId: entry.body.expectedPublicationId, results: entry.body.studentIds.map((id) => {
        const s = studentOf(code, id);
        return s.email ? { id, name: s.name, status: "sent" } : { id, name: s.name, status: "skipped", reason: "no-email" };
      }) } });
      log.errors.push(`rota inesperada: ${entry.method} ${endpoint}`);
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const tab = await context.newPage();
    tab.on("pageerror", (error) => log.errors.push(error.message));
    tab.on("dialog", (dialog) => { log.dialogs.push({ type: dialog.type(), message: dialog.message() }); return log.acceptConfirm ? dialog.accept() : dialog.dismiss(); });
    await tab.goto(origin);
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    await tab.evaluate(async () => { window.__state = (await import("/state.js")).state; });
    return { context, tab, log };
  }
  const calls = (log, op) => log.requests.filter((r) => r.path.endsWith(`/${op}`));
  const heading = (tab, name) => tab.getByRole("heading", { name, exact: true });
  const button = (tab, name) => tab.getByRole("button", { name, exact: true });

  // Prévia individual: contrato, navegação e filtros do painel guardados em teacherFilters.
  {
    const { context, tab, log } = await open();
    await tab.locator("#search").fill("Ana");
    await tab.locator("#status-filter").selectOption("pending");
    await tab.locator("#student-sort").selectOption("pending");
    const before = log.requests.length;
    await button(tab, "Ver pendências de Ana Teste").click();
    await heading(tab, "Pendências de Ana Teste").waitFor();
    assert.deepEqual(log.requests.slice(before), [{ method: "POST", path: "/cohorts/BRSA0267/pending-preview", query: "", body: { studentId: "1" } }]);
    assert.deepEqual(await snapshot(tab, "view", "pendingStudentId", "pendingError", "teacherFilters"),
      { view: "student-pending", pendingStudentId: "1", pendingError: "", teacherFilters: { search: "Ana", filter: "pending", sort: "pending" } });
    // "Voltar ao painel": nenhum request; busca, filtro e ordenação voltam como estavam.
    const back = log.requests.length;
    await button(tab, "Voltar ao painel").click();
    await heading(tab, "Painel da BRSA0267").waitFor();
    assert.equal(log.requests.length, back);
    assert.equal((await snapshot(tab, "view")).view, "overview");
    assert.deepEqual(await filtersOf(tab), ["Ana", "pending", "pending"]);
    // Ir a outra tela e voltar pelo menu: busca e filtro zeram; a ordenação, que o menu não zera, fica.
    await button(tab, "Publicações da turma").click();
    await button(tab, "Painel do instrutor").click();
    await heading(tab, "Painel da BRSA0267").waitFor();
    assert.deepEqual(await filtersOf(tab), ["", "all", "pending"]);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Prévia individual: a resposta atrasada de outro aluno é descartada (guarda por aluno).
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview") || entry.body.studentId !== "1" || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, pendingFor("BRSA0267", "1"));
    };
    await button(tab, "Ver pendências de Ana Teste").click();
    await arrived.promise;
    await heading(tab, "Pendências do aluno").waitFor();
    assert.equal(await tab.getByText("Carregando pendências…", { exact: true }).count(), 1);
    await button(tab, "Voltar ao painel").click();
    await button(tab, "Ver pendências de Bruna Teste").click();
    await heading(tab, "Pendências de Bruna Teste").waitFor();
    const late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview") && r.request().postDataJSON()?.studentId === "1");
    gate.resolve();
    await late;
    await flushNetwork(tab);
    const s = await snapshot(tab, "view", "pendingStudentId", "pendingError", "pendingPreview");
    assert.deepEqual([s.view, s.pendingStudentId, s.pendingError, s.pendingPreview.student.id], ["student-pending", "2", "", "2"]);
    assert.equal(await heading(tab, "Pendências de Bruna Teste").count(), 1);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // C7.4: erro atrasado de outro aluno não altera a prévia atual nem produz toast.
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview") || entry.body.studentId !== "1" || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, { error: "Falha atrasada da prévia de Ana." }, 500);
    };
    await button(tab, "Ver pendências de Ana Teste").click();
    await arrived.promise;
    await button(tab, "Voltar ao painel").click();
    await button(tab, "Ver pendências de Bruna Teste").click();
    await heading(tab, "Pendências de Bruna Teste").waitFor();
    const late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview") && r.request().postDataJSON()?.studentId === "1");
    gate.resolve();
    await late;
    await flushNetwork(tab);
    const s = await snapshot(tab, "pendingStudentId", "pendingError", "pendingPreview");
    assert.deepEqual([s.pendingStudentId, s.pendingError, s.pendingPreview.student.id], ["2", "", "2"]);
    assert.equal(await tab.getByRole("alert").filter({ hasText: "Não foi possível carregar" }).count(), 0);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Prévia individual: a resposta atrasada de outra turma é descartada mesmo com o mesmo id de aluno (guarda por turma).
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (entry.path !== "/cohorts/BRSA0267/pending-preview" || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, pendingFor("BRSA0267", "1"));
    };
    await button(tab, "Ver pendências de Ana Teste").click();
    await arrived.promise;
    await tab.locator("#cohort").selectOption("BRSA0268");
    await heading(tab, "Painel da BRSA0268").waitFor();
    await button(tab, "Ver pendências de Diego Teste").click();
    await heading(tab, "Pendências de Diego Teste").waitFor();
    const late = tab.waitForResponse((r) => r.url().endsWith("/cohorts/BRSA0267/pending-preview"));
    gate.resolve();
    await late;
    await flushNetwork(tab);
    const s = await snapshot(tab, "code", "view", "pendingStudentId", "pendingPreview");
    assert.deepEqual([s.code, s.view, s.pendingStudentId, s.pendingPreview.student.name, s.pendingPreview.publicationId],
      ["BRSA0268", "student-pending", "1", "Diego Teste", "pub-BRSA0268"]);
    assert.equal(await heading(tab, "Pendências de Diego Teste").count(), 1);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Prévia individual: quem saiu da sub-view não recebe a prévia atrasada (guarda por view).
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview") || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, pendingFor("BRSA0267", "1"));
    };
    await button(tab, "Ver pendências de Ana Teste").click();
    await arrived.promise;
    await button(tab, "Voltar ao painel").click();
    await heading(tab, "Painel da BRSA0267").waitFor();
    const late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview"));
    gate.resolve();
    await late;
    await flushNetwork(tab);
    assert.deepEqual(await snapshot(tab, "view", "pendingStudentId", "pendingPreview", "pendingError"),
      { view: "overview", pendingStudentId: "1", pendingPreview: null, pendingError: "" });
    assert.equal(await heading(tab, "Painel da BRSA0267").count(), 1);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Prévia individual: erro mostra o painel de erro e também o aviso; "Tentar novamente" refaz a mesma prévia.
  {
    const { context, tab, log } = await open();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview") || log.failed) return;
      log.failed = true;
      return route.fulfill({ status: 500, json: { error: "Falha fictícia ao montar a prévia." } });
    };
    await button(tab, "Ver pendências de Ana Teste").click();
    await tab.getByRole("alert").filter({ hasText: "Falha fictícia ao montar a prévia." }).waitFor();
    assert.equal(await heading(tab, "Pendências do aluno").count(), 1);
    assert.deepEqual(await snapshot(tab, "view", "pendingStudentId", "pendingError", "pendingPreview"),
      { view: "student-pending", pendingStudentId: "1", pendingError: "Falha fictícia ao montar a prévia.", pendingPreview: null });
    assert.deepEqual(await noticeTexts(tab), [{ error: true, text: "Falha fictícia ao montar a prévia." }]);
    await button(tab, "Tentar novamente").click();
    await heading(tab, "Pendências de Ana Teste").waitFor();
    assert.deepEqual(calls(log, "pending-preview").map((r) => r.body), [{ studentId: "1" }, { studentId: "1" }]);
    assert.equal((await snapshot(tab, "pendingError")).pendingError, "");
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: quem saiu descarta a prévia atrasada (guarda por turma e view); na mesma tela, um lote antigo
  // que termina depois de um novo também é descartado (guarda por request).
  {
    const { context, tab, log } = await open();
    const gates = [deferred(), deferred()], arrivals = [deferred(), deferred()];
    let n = 0;
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch") || entry.body.studentIds.length !== 2 || n >= 2) return;
      const i = n++;
      arrivals[i].resolve();
      return held(route, gates[i], batchFor("BRSA0267", entry.body.studentIds));
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivals[0].promise;
    await heading(tab, "Lembretes em lote").waitFor();
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 1);
    assert.deepEqual(await snapshot(tab, "view", "batchIds", "teacherFilters"),
      { view: "reminders-batch", batchIds: ["1", "2"], teacherFilters: { search: "", filter: "pending", sort: "name" } });
    await button(tab, "Voltar ao painel").click();
    await heading(tab, "Painel da BRSA0267").waitFor();
    let late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch"));
    gates[0].resolve();
    await late;
    await flushNetwork(tab);
    assert.deepEqual(await snapshot(tab, "view", "batchPreview"), { view: "overview", batchPreview: null });
    // Mesma tela: lote A (2 alunos) fica preso; lote B (1 aluno) começa depois, também preso, e responde
    // primeiro. A chega por último e é descartado: nada muda no state nem na tela, e não há redesenho.
    const gateA = deferred(), arrivedA = deferred(), gateB = deferred(), arrivedB = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch")) return;
      if (entry.body.studentIds.length === 2) { arrivedA.resolve(); return held(route, gateA, batchFor("BRSA0267", entry.body.studentIds)); }
      arrivedB.resolve();
      return held(route, gateB, batchFor("BRSA0267", entry.body.studentIds));
    };
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivedA.promise;
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 1);
    await button(tab, "Voltar ao painel").click();
    await tab.locator("#search").fill("Ana");
    await button(tab, "Enviar lembrete para 1 aluno").click();
    await arrivedB.promise;
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 1);
    assert.deepEqual(await snapshot(tab, "batchIds", "batchPreview", "batchError", "batchResults"),
      { batchIds: ["1"], batchPreview: null, batchError: "", batchResults: null });
    gateB.resolve();
    await tab.getByText(/1 de 1 aluno vai receber/).waitFor();
    const afterB = await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults");
    assert.deepEqual([afterB.view, afterB.batchIds, afterB.batchPreview.recipients.map((r) => r.id), afterB.batchError, afterB.batchResults],
      ["reminders-batch", ["1"], ["1"], "", null]);
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 0);
    await watchRenders(tab);
    late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch") && r.request().postDataJSON()?.studentIds.length === 2);
    gateA.resolve();
    await late;
    await flushNetwork(tab);
    assert.equal(await rendersSince(tab), 0, "a resposta antiga não redesenha a tela");
    assert.deepEqual(await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults"), afterB);
    assert.equal(await tab.getByText(/1 de 1 aluno vai receber/).count(), 1);
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 0);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: a identidade é a da request, não a do conjunto de alunos. A1 [1,2] → B [1] → A2 [1,2], todas presas;
  // cada prévia traz a própria publicação (pub-1, pub-2, pub-3), visível no assunto. B termina com A2 pendente,
  // depois A2; A1 chega por último com os MESMOS alunos de A2 e ainda assim é descartada.
  {
    const { context, tab, log } = await open();
    const gates = [deferred(), deferred(), deferred()], arrivals = [deferred(), deferred(), deferred()];
    let started = 0;
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch")) return;
      const i = started++, preview = batchFor("BRSA0267", entry.body.studentIds);
      arrivals[i].resolve();
      return held(route, gates[i], { ...preview, publicationId: `pub-${i + 1}`, sample: { ...preview.sample, subject: `Podemos ajudar? · pub-${i + 1}` } });
    };
    const batchState = () => snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults");
    const consulting = () => tab.getByText("Consultando destinatários…", { exact: true }).count();
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivals[0].promise;
    await button(tab, "Voltar ao painel").click();
    await tab.locator("#search").fill("Ana");
    await button(tab, "Enviar lembrete para 1 aluno").click();
    await arrivals[1].promise;
    await button(tab, "Voltar ao painel").click();
    await tab.locator("#search").fill("");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivals[2].promise;
    assert.deepEqual(calls(log, "pending-preview-batch").map((r) => r.body), [{ studentIds: ["1", "2"] }, { studentIds: ["1"] }, { studentIds: ["1", "2"] }]);
    const pendingA2 = await batchState();
    assert.deepEqual(pendingA2, { view: "reminders-batch", batchIds: ["1", "2"], batchPreview: null, batchError: "", batchResults: null });
    assert.equal(await consulting(), 1);

    // B (antiga) termina com A2 (atual) pendente: nada muda e a tela continua consultando.
    await watchRenders(tab);
    let late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch"));
    gates[1].resolve();
    await late;
    await flushNetwork(tab);
    assert.equal(await rendersSince(tab), 0, "B, antiga, não redesenha a tela");
    assert.deepEqual(await batchState(), pendingA2);
    assert.equal(await consulting(), 1);
    assert.equal(await tab.getByText("Podemos ajudar? · pub-2", { exact: true }).count(), 0);

    // A2 (atual) termina: vira a prévia, com a publicação dela.
    await watchRenders(tab);
    gates[2].resolve();
    await tab.getByText("Podemos ajudar? · pub-3", { exact: true }).waitFor();
    assert.ok(await rendersSince(tab) > 0, "A2, atual, redesenha a tela");
    const afterA2 = await batchState();
    assert.deepEqual([afterA2.batchIds, afterA2.batchPreview.publicationId, afterA2.batchPreview.recipients.map((r) => r.id), afterA2.batchError, afterA2.batchResults],
      [["1", "2"], "pub-3", ["1", "2"], "", null]);
    assert.equal(await tab.getByText(/1 de 2 alunos vai receber/).count(), 1);
    assert.equal(await consulting(), 0);
    const domA2 = await tab.locator("#app").innerHTML();

    // A1 (antiga, com os mesmos alunos de A2) termina por último: é descartada.
    await watchRenders(tab);
    late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch"));
    gates[0].resolve();
    await late;
    await flushNetwork(tab);
    assert.equal(await rendersSince(tab), 0, "A1, com os mesmos alunos de A2, não redesenha a tela");
    assert.deepEqual(await batchState(), afterA2, "A1 não substitui a prévia de A2 (pub-3)");
    assert.equal(await tab.locator("#app").innerHTML(), domA2, "A1 não muda a tela");
    assert.equal(await consulting(), 0);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: um erro atrasado de um lote antigo não substitui a prévia do lote atual (guarda por request).
  {
    const { context, tab, log } = await open();
    const gateA = deferred(), arrivedA = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch") || entry.body.studentIds.length !== 2) return;
      arrivedA.resolve();
      return held(route, gateA, { error: "Falha atrasada do lote antigo." }, 500);
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivedA.promise;
    await button(tab, "Voltar ao painel").click();
    await tab.locator("#search").fill("Ana");
    await button(tab, "Enviar lembrete para 1 aluno").click();
    await tab.getByText(/1 de 1 aluno vai receber/).waitFor();
    const afterB = await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults");
    assert.deepEqual([afterB.batchIds, afterB.batchError], [["1"], ""]);
    await watchRenders(tab);
    const late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch") && r.request().postDataJSON()?.studentIds.length === 2);
    gateA.resolve();
    await late;
    await flushNetwork(tab);
    assert.equal(await rendersSince(tab), 0, "o erro antigo não redesenha a tela");
    assert.deepEqual(await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults"), afterB);
    assert.equal(await tab.getByRole("alert").filter({ hasText: "Falha atrasada do lote antigo." }).count(), 0);
    assert.equal(await tab.getByText(/1 de 1 aluno vai receber/).count(), 1);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: o erro do lote atual aparece mesmo com um lote antigo pendente; o antigo, ao terminar depois, é
  // descartado; e "Tentar novamente" refaz a prévia do lote atual.
  {
    const { context, tab, log } = await open();
    const gateA = deferred(), arrivedA = deferred();
    let failedB = false;
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch")) return;
      if (entry.body.studentIds.length === 2) { arrivedA.resolve(); return held(route, gateA, batchFor("BRSA0267", entry.body.studentIds)); }
      if (failedB) return;
      failedB = true;
      return route.fulfill({ status: 500, json: { error: "Falha fictícia no lote atual." } });
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrivedA.promise;
    await button(tab, "Voltar ao painel").click();
    await tab.locator("#search").fill("Ana");
    await button(tab, "Enviar lembrete para 1 aluno").click();
    await tab.getByRole("alert").filter({ hasText: "Falha fictícia no lote atual." }).waitFor();
    const afterB = await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults");
    assert.deepEqual(afterB, { view: "reminders-batch", batchIds: ["1"], batchPreview: null, batchError: "Falha fictícia no lote atual.", batchResults: null });
    assert.deepEqual(await noticeTexts(tab), []);
    await watchRenders(tab);
    const late = tab.waitForResponse((r) => r.url().endsWith("/pending-preview-batch") && r.request().postDataJSON()?.studentIds.length === 2);
    gateA.resolve();
    await late;
    await flushNetwork(tab);
    assert.equal(await rendersSince(tab), 0, "a prévia antiga não redesenha a tela");
    assert.deepEqual(await snapshot(tab, "view", "batchIds", "batchPreview", "batchError", "batchResults"), afterB);
    await button(tab, "Tentar novamente").click();
    await tab.getByText(/1 de 1 aluno vai receber/).waitFor();
    assert.deepEqual(calls(log, "pending-preview-batch").map((r) => r.body), [{ studentIds: ["1", "2"] }, { studentIds: ["1"] }, { studentIds: ["1"] }]);
    assert.equal((await snapshot(tab, "batchError")).batchError, "");
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: erro mostra o painel de erro, sem aviso; "Tentar novamente" refaz a prévia com os mesmos alunos.
  {
    const { context, tab, log } = await open();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch") || log.failed) return;
      log.failed = true;
      return route.fulfill({ status: 500, json: { error: "Falha fictícia ao consultar destinatários." } });
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await tab.getByRole("alert").filter({ hasText: "Falha fictícia ao consultar destinatários." }).waitFor();
    assert.deepEqual(await snapshot(tab, "view", "batchError", "batchPreview", "batchResults"),
      { view: "reminders-batch", batchError: "Falha fictícia ao consultar destinatários.", batchPreview: null, batchResults: null });
    assert.deepEqual(await noticeTexts(tab), []);
    await button(tab, "Tentar novamente").click();
    await tab.getByText(/1 de 2 alunos vai receber/).waitFor();
    assert.deepEqual(calls(log, "pending-preview-batch").map((r) => r.body), [{ studentIds: ["1", "2"] }, { studentIds: ["1", "2"] }]);
    assert.equal((await snapshot(tab, "batchError")).batchError, "");
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Lote: confirmação cancelada não envia; com confirmação, o botão fica ocupado (sem envio duplo),
  // o resultado mostra a falha, o aviso aparece e um novo lote limpa o resultado anterior. O envio leva só
  // Ana, a única aprovada na prévia (Bruna é pulada por não ter e-mail).
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/send-reminders")) return;
      arrived.resolve();
      return held(route, gate, { publicationId: "pub-BRSA0267", results: [{ id: "1", name: "Ana Teste", status: "failed" }] });
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await tab.getByText(/1 de 2 alunos vai receber/).waitFor();
    log.acceptConfirm = false;
    await button(tab, "Enviar para 1 aluno").click();
    assert.deepEqual(log.dialogs, [{ type: "confirm", message: "Enviar lembrete para 1 aluno da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.\n\n1 aluno selecionado fica de fora; os motivos estão na lista." }]);
    assert.equal(calls(log, "send-reminders").length, 0);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.equal((await snapshot(tab, "batchResults")).batchResults, null);
    log.acceptConfirm = true;
    const send = button(tab, "Enviar para 1 aluno");
    await send.click();
    await arrived.promise;
    assert.ok(await send.isDisabled());
    await send.click({ force: true });
    assert.deepEqual([calls(log, "send-reminders").length, log.dialogs.length], [1, 2]);
    gate.resolve();
    await tab.getByText("1 sem confirmação do envio.", { exact: true }).waitFor();
    assert.deepEqual(calls(log, "send-reminders"), [{ method: "POST", path: "/cohorts/BRSA0267/send-reminders", query: "", body: { studentIds: ["1"], expectedPublicationId: "pub-BRSA0267" } }]);
    assert.match(await tab.locator(".trem-result").innerText(), /Sem confirmação do envio · 1\s+Ana Teste/);
    // O clique no botão parado levou o foco ao <main>: o resultado não o recebe, e o aviso anuncia a resposta, sem afirmar o
    // desfecho (fechamento da E7; com o foco no andamento, o resultado recebe o foco e não há aviso).
    assert.deepEqual(await noticeTexts(tab), [{ error: false, text: "Chegou a resposta do envio em lote. Confira o resultado por aluno." }]);
    assert.equal((await snapshot(tab, "view")).view, "reminders-batch");
    // Um novo lote zera o resultado anterior enquanto a prévia carrega.
    await button(tab, "Voltar ao painel").click();
    assert.deepEqual(await filtersOf(tab), ["", "pending", "name"]);
    const gate2 = deferred(), arrived2 = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/pending-preview-batch")) return;
      arrived2.resolve();
      return held(route, gate2, batchFor("BRSA0267", entry.body.studentIds));
    };
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await arrived2.promise;
    assert.deepEqual(await snapshot(tab, "batchResults", "batchPreview"), { batchResults: null, batchPreview: null });
    assert.equal(await tab.getByText("Consultando destinatários…", { exact: true }).count(), 1);
    gate2.resolve();
    await tab.getByText(/1 de 2 alunos vai receber/).waitFor();
    assert.deepEqual([log.errors, log.dialogs.length], [[], 2]);
    await context.close();
  }

  // Lote: erro no envio fica na tela, junto do botão (Expansão 7: não vira aviso); a prévia continua e o botão volta a ficar
  // disponível.
  {
    const { context, tab, log } = await open();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/send-reminders")) return;
      return route.fulfill({ status: 500, json: { error: "Falha fictícia no envio em lote." } });
    };
    await tab.locator("#status-filter").selectOption("pending");
    await button(tab, "Enviar lembrete para 2 alunos").click();
    await tab.getByText(/1 de 2 alunos vai receber/).waitFor();
    await button(tab, "Enviar para 1 aluno").click();
    await tab.locator('#trem-send-status[role="alert"]').waitFor();
    assert.match(await tab.locator("#trem-send-status").innerText(), /^Não foi possível confirmar o envio\. Falha fictícia no envio em lote\./);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.equal((await snapshot(tab, "batchResults")).batchResults, null);
    assert.equal(await tab.getByText(/1 de 2 alunos vai receber/).count(), 1);
    assert.ok(await button(tab, "Enviar para 1 aluno").isEnabled());
    assert.deepEqual([log.errors, log.dialogs.length], [[], 1]);
    await context.close();
  }

  // C7.3: a navegação continua disponível com send pendente. A resposta antiga não pertence ao
  // contexto atual, mesmo na mesma turma. Requests reais do browser, API fictícia e gates sem sleeps.
  for (const failure of [false, true]) {
    for (const mode of ["new-preview", "new-send", "close", "sender", "cohort"]) {
      const { context, tab, log } = await open();
      const gateA = deferred(), arrivedA = deferred(), gateB = deferred(), arrivedB = deferred();
      let sends = 0;
      log.handle = ({ route, entry }) => {
        if (!entry.path.endsWith("/send-reminders")) return;
        const isA = sends++ === 0;
        (isA ? arrivedA : arrivedB).resolve();
        return held(route, isA ? gateA : gateB,
          isA ? (failure ? { error: "Erro do envio antigo A." } : { results: [{ id: "1", name: "Resultado antigo A", status: "sent" }] })
            : { error: "Erro do envio atual B." },
          isA && !failure ? 200 : 500);
      };
      await tab.locator("#status-filter").selectOption("pending");
      await button(tab, "Enviar lembrete para 2 alunos").click();
      await tab.getByText(/1 de 2 alunos vai receber/).waitFor();
      await button(tab, "Enviar para 1 aluno").click();
      await arrivedA.promise;
      const sendA = button(tab, "Enviar para 1 aluno");
      assert.ok(await sendA.isDisabled());
      await sendA.click({ force: true });
      assert.equal(calls(log, "send-reminders").length, 1, "double submit de A bloqueado");

      if (mode === "sender") {
        await button(tab, "Lembretes").click();
        await tab.getByText("Confirme o remetente da BRSA0267.", { exact: true }).waitFor();
      } else if (mode === "cohort") {
        await tab.locator("#cohort").selectOption("BRSA0268");
        await heading(tab, "Painel da BRSA0268").waitFor();
        await tab.locator("#status-filter").selectOption("pending");
        await button(tab, "Enviar lembrete para 2 alunos").click();
        await tab.getByText(/2 de 2 alunos vão receber/).waitFor();
      } else {
        await button(tab, "Voltar ao painel").click();
        await heading(tab, "Painel da BRSA0267").waitFor();
        if (mode !== "close") {
          await tab.locator("#search").fill("Ana");
          await button(tab, "Enviar lembrete para 1 aluno").click();
          await tab.getByText(/1 de 1 aluno vai receber/).waitFor();
        }
      }
      if (mode === "new-send") {
        await button(tab, "Enviar para 1 aluno").click();
        await arrivedB.promise;
        assert.ok(await button(tab, "Enviar para 1 aluno").isDisabled());
      }

      await tab.locator("#cohort").focus();
      await tab.evaluate(() => { window.__batchFocus = document.activeElement; });
      const keys = ["code", "view", "batchIds", "batchPreview", "batchResults", "batchError"];
      const before = await snapshot(tab, ...keys), html = await tab.locator("#app").innerHTML();
      const requestCount = log.requests.length, dialogCount = log.dialogs.length;
      await watchRenders(tab);
      const late = tab.waitForResponse((r) => r.url().endsWith("/send-reminders"));
      gateA.resolve();
      await (await late).finished();
      await flushNetwork(tab);
      assert.deepEqual(await snapshot(tab, ...keys), before, `${mode}: state de B intacto após A`);
      assert.equal(await tab.locator("#app").innerHTML(), html, `${mode}: DOM intacto`);
      assert.equal(await rendersSince(tab), 0, `${mode}: zero render stale`);
      assert.deepEqual(await noticeTexts(tab), [], `${mode}: zero notice stale`);
      assert.ok(await tab.evaluate(() => document.activeElement === window.__batchFocus), `${mode}: foco preservado`);
      assert.equal(log.requests.length, requestCount, "descartar não gera requests");
      assert.equal(log.dialogs.length, dialogCount);

      if (mode === "new-send") {
        const sendB = button(tab, "Enviar para 1 aluno");
        assert.ok(await sendB.isDisabled(), "finally de A não libera o botão de B");
        await sendB.click({ force: true });
        assert.equal(calls(log, "send-reminders").length, 2, "double submit de B bloqueado");
        assert.equal(log.dialogs.length, 2);
        assert.deepEqual(calls(log, "send-reminders").map((r) => r.body), [
          { studentIds: ["1"], expectedPublicationId: "pub-BRSA0267" },
          { studentIds: ["1"], expectedPublicationId: "pub-BRSA0267" },
        ]);
        gateB.resolve();
        // O erro do envio atual fica na tela, junto do botão (Expansão 7), sem aviso temporário.
        await tab.locator('#trem-send-status[role="alert"]').waitFor();
        assert.match(await tab.locator("#trem-send-status").innerText(), /Erro do envio atual B\./);
        assert.deepEqual(await noticeTexts(tab), []);
        assert.ok(await sendB.isEnabled(), "erro atual libera o botão");
        assert.deepEqual(await snapshot(tab, ...keys), before);
      } else assert.equal(calls(log, "send-reminders").length, 1);
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  }
  console.log("C7.3: sucesso/erro stale em nova prévia, novo envio, saída e troca de turma; state, DOM, foco, avisos, busy e requests OK.");

  // Remetente: contrato do GET e resposta atrasada de outra turma descartada (guarda por turma).
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (entry.path !== "/cohorts/BRSA0267/reminder-settings" || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, senderFor("BRSA0267"));
    };
    await button(tab, "Lembretes").click();
    await arrived.promise;
    await tab.getByText("Consultando seu remetente…", { exact: true }).waitFor();
    assert.equal((await snapshot(tab, "senderLoading")).senderLoading, true);
    await tab.locator("#cohort").selectOption("BRSA0268");
    await heading(tab, "Painel da BRSA0268").waitFor();
    assert.deepEqual(await snapshot(tab, "sender", "senderLoading", "senderError"), { sender: null, senderLoading: false, senderError: "" });
    await button(tab, "Lembretes").click();
    await tab.getByText("Confirme o remetente da BRSA0268.", { exact: true }).waitFor();
    const late = tab.waitForResponse((r) => r.url().endsWith("/cohorts/BRSA0267/reminder-settings"));
    gate.resolve();
    await late;
    await flushNetwork(tab);
    const s = await snapshot(tab, "sender", "senderLoading", "senderError");
    assert.deepEqual([s.sender.sender, s.senderLoading, s.senderError], ["instrutor.brsa0268@example.test", false, ""]);
    assert.equal(await tab.getByText("Confirme o remetente da BRSA0268.", { exact: true }).count(), 1);
    assert.deepEqual(calls(log, "reminder-settings"), [
      { method: "GET", path: "/cohorts/BRSA0267/reminder-settings", query: "", body: null },
      { method: "GET", path: "/cohorts/BRSA0268/reminder-settings", query: "", body: null }]);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Remetente: erro mostra o painel de erro, sem aviso; "Tentar novamente" consulta de novo.
  {
    const { context, tab, log } = await open();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/reminder-settings") || log.failed) return;
      log.failed = true;
      return route.fulfill({ status: 500, json: { error: "Falha fictícia ao consultar o remetente." } });
    };
    await button(tab, "Lembretes").click();
    await tab.getByRole("alert").filter({ hasText: "Falha fictícia ao consultar o remetente." }).waitFor();
    assert.deepEqual(await snapshot(tab, "sender", "senderLoading", "senderError"),
      { sender: null, senderLoading: false, senderError: "Falha fictícia ao consultar o remetente." });
    assert.deepEqual(await noticeTexts(tab), []);
    await button(tab, "Tentar novamente").click();
    await tab.getByText("Confirme o remetente da BRSA0267.", { exact: true }).waitFor();
    assert.deepEqual(await snapshot(tab, "senderLoading", "senderError"), { senderLoading: false, senderError: "" });
    assert.equal(calls(log, "reminder-settings").length, 2);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Verificação do remetente: contrato, botão ocupado (sem pedido duplo), state, aviso e nenhum recarregamento.
  // Erro: aviso de erro, remetente inalterado e botão disponível de novo.
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (!entry.path.endsWith("/verify-sender") || log.held) return;
      log.held = true; arrived.resolve();
      return held(route, gate, { ...senderFor("BRSA0267"), reason: "Confirmação solicitada." });
    };
    await button(tab, "Lembretes").click();
    await tab.getByText("Confirme o remetente da BRSA0267.", { exact: true }).waitFor();
    const verify = button(tab, "Solicitar confirmação do meu e-mail");
    await verify.click();
    await arrived.promise;
    assert.ok(await verify.isDisabled());
    await verify.click({ force: true });
    assert.equal(calls(log, "verify-sender").length, 1);
    gate.resolve();
    await tab.getByText("Confirmação solicitada.", { exact: true }).waitFor();
    assert.deepEqual(calls(log, "verify-sender"), [{ method: "POST", path: "/cohorts/BRSA0267/verify-sender", query: "", body: {} }]);
    assert.equal((await snapshot(tab, "sender")).sender.reason, "Confirmação solicitada.");
    // Foco no <main> (clique no botão parado): a situação nova não o recebe, e o aviso anuncia a resposta sem afirmar o desfecho.
    assert.deepEqual(await noticeTexts(tab), [{ error: false, text: "Chegou a resposta do pedido de confirmação. Confira a situação do seu remetente." }]);
    assert.equal(calls(log, "reminder-settings").length, 1);
    log.handle = ({ route, entry }) => entry.path.endsWith("/verify-sender") ? route.fulfill({ status: 500, json: { error: "Falha fictícia na verificação." } }) : undefined;
    await tab.getByRole("button", { name: "Fechar aviso" }).click();
    await button(tab, "Solicitar confirmação do meu e-mail").click();
    // O erro da verificação fica na tela, junto da ação (Expansão 7), sem aviso temporário.
    await tab.locator('#trem-verify-status[role="alert"]').waitFor();
    assert.match(await tab.locator("#trem-verify-status").innerText(), /^Não foi possível confirmar o pedido\. Falha fictícia na verificação\./);
    assert.deepEqual(await noticeTexts(tab), []);
    assert.equal((await snapshot(tab, "sender")).sender.reason, "Confirmação solicitada.");
    assert.ok(await button(tab, "Solicitar confirmação do meu e-mail").isEnabled());
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }

  // Detalhes acompanham a automação: nenhuma composição/cópia/envio manual, inclusive com mensagem legada na API.
  {
    const { context, tab, log } = await open();
    await button(tab, "Ver pendências de Ana Teste").click();
    await heading(tab, "Lembretes automáticos").waitFor();
    for (const name of ["Enviar e-mail para este aluno", "Copiar mensagem", "Configurar meu remetente"])
      assert.equal(await button(tab, name).count(), 0, name);
    assert.equal(await tab.locator(".email-preview").count(), 0);
    log.delivery["BRSA0267/1"] = { status: "delivered" };
    await button(tab, "Atualizar status do envio").focus();
    await tab.keyboard.press("Enter");
    await tab.getByText("Entregue ao servidor de e-mail do destinatário. Isso não confirma leitura ou chegada à caixa de entrada.", { exact: true }).waitFor();
    assert.equal(calls(log, "send-reminder").length, 0);
    assert.equal(calls(log, "pending-preview").length, 2);
    assert.deepEqual([log.errors, log.dialogs], [[], []]);
    await context.close();
  }
  console.log("Lembretes (ciclo de vida): filtros do painel, respostas atrasadas (aluno, turma, view, lote por request, remetente), erros, verificação, envio em lote e consulta individual sem envio manual OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

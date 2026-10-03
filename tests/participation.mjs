// Participação na turma (C7.2.3), sem navegador: o frontend só lê participationStatus ("WITHDRAWN" = desistente;
// ausência = ativo) e o lote envia só os IDs que a prévia exibida aprovou. Páginas renderizadas como texto; o handler
// de Lembretes roda com transporte falso. Dados fictícios.
import assert from "node:assert/strict";
import test from "node:test";

// ui.js lê location ao ser carregado (flag de demonstração); renderClassReport escreve em #app e notice() em #notices.
globalThis.location = { hostname: "portal.test", search: "" };
const app = { innerHTML: "" };
globalThis.document = {
  querySelector: (selector) => (selector === "#app" ? app : selector === "#notices" ? { replaceChildren() {} } : null),
  createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }),
};
const { state } = await import("../frontend/state.js");
const { teacherPage, filteredStudents } = await import("../frontend/pages/teacher.js");
const { renderClassReport } = await import("../frontend/pages/class-report.js");
const { batchPage, reminderPreview } = await import("../frontend/pages/reminders.js");
const remindersHandlers = await import("../frontend/handlers/reminders.js");
const api = await import("../frontend/api.js");

const WITHDRAWN = { participationStatus: "WITHDRAWN" };
// Alice e Caio são os desistentes nos cenários com marcas: em ordem alfabética eles não ficam no fim, então a
// ordenação "desistentes depois" é observável. Alice: crítica, sem portal, com pendências. Caio: na referência, sem e-mail.
const BASE = [
  { id: "1", name: "Ana Ativa", email: "ana@example.test", kc: 80, lab: 96, total: 88, completed: 5, pending: 0, progress: 100, status: "ok", portalLinked: true },
  { id: "2", name: "Bruno Atenção", email: "bruno@example.test", kc: 60, lab: 96, total: 78, completed: 4, pending: 1, progress: 80, status: "attention", portalLinked: false },
  { id: "3", name: "Carla Crítica", email: null, kc: 40, lab: 50, total: 45, completed: 2, pending: 3, progress: 40, status: "critical", portalLinked: true },
  { id: "4", name: "Alice Saiu", email: "alice@example.test", kc: 30, lab: 40, total: 35, completed: 1, pending: 4, progress: 20, status: "critical", portalLinked: false },
  { id: "5", name: "Caio Saiu", email: null, kc: 90, lab: 99, total: 94, completed: 5, pending: 0, progress: 100, status: "ok", portalLinked: true },
  { id: "6", name: "Abel Sem Média", email: "abel@example.test", kc: null, lab: null, total: null, completed: 0, pending: 2, progress: 0, status: "insufficient", portalLinked: true },
];
const rowsWith = (withdrawnIds = []) => BASE.map((r) => (withdrawnIds.includes(r.id) ? { ...r, ...WITHDRAWN } : { ...r }));
const nameOf = Object.fromEntries(BASE.map((r) => [r.id, r.name]));

const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const cards = (html) => [...html.matchAll(/data-filter="([^"]*)"[^>]*><span>([^<]*)<\/span><strong>([^<]*)<\/strong><small>([^<]*)<\/small>/g)]
  .map(([, filter, label, value, caption]) => ({ filter, label, value, caption }));
const metrics = (html) => [...html.matchAll(/<article class="metric[^"]*"><span>([^<]*)<\/span><strong>([^<]*)<\/strong><small>([^<]*)<\/small>/g)]
  .map(([, label, value, caption]) => ({ label, value, caption }));
const options = (html, id) => [...((html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`)) || ["", ""])[1])
  .matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(([, value, label]) => [value, label]);
const teacherRows = (html) => [...html.matchAll(/<tr><td class="cell-name">([\s\S]*?)<\/tr>/g)].map(([, row]) => ({
  name: row.match(/<strong>([^<]*)<\/strong>/)[1], withdrawnBadge: />Desistente</.test(row), status: (row.match(/<td class="cell-status"><span class="badge ([^"]*)"/) || [])[1],
  details: /data-student-pending=/.test(row) }));
const classRows = (html) => [...html.matchAll(/<tr><th scope="row">([\s\S]*?)<\/tr>/g)].map(([, row]) => ({
  name: row.match(/^([^<]*)/)[1].trim(), withdrawnBadge: />Desistente</.test(row), status: (row.match(/<span class="badge ([^"]*)">[^<]*<\/span><\/td>$/) || [])[1] }));

const TEACHER_KEYS = ["me", "cohorts", "code", "report", "filter", "search", "sort", "focusDraft", "studentView", "classReport", "classFilter", "classSearch",
  "view", "batchIds", "batchPreview", "batchError", "batchResults", "pendingPreview", "pendingStudentId", "teacherFilters"];
function withState(values, fn) {
  const saved = Object.fromEntries(TEACHER_KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true }], code: "BRSA0267",
    filter: "all", search: "", sort: "name", focusDraft: null, studentView: null, classFilter: "all", classSearch: "" }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
const report = (students) => ({ students, publication: { id: "p1", publishedAt: "2026-10-03T09:01:28Z" }, thresholds: { kc: 70, lab: 95 }, activities: [],
  focus: { activityIds: [], version: null }, history: [] });
const page = (students, values = {}) => withState({ report: report(students), ...values }, () => teacherPage());
const visible = (students, values = {}) => withState({ report: report(students), ...values }, () => filteredStudents().map((r) => r.name));

// A. Sem nenhuma marca, o painel é o de antes: mesmos cartões, valores, legendas, filtros, ordenação e nenhuma menção
// a desistente.
test("A: zero desistentes mantém cartões, filtros, tabela e ordenação atuais", () => {
  const html = page(rowsWith());
  assert.deepEqual(cards(html), [
    { filter: "all", label: "Alunos na publicação", value: "6", caption: "Ver todos os alunos" },
    { filter: "ok", label: "Médias na referência", value: "2", caption: "KCs ≥ 70% e Labs ≥ 95%" },
    { filter: "attention", label: "Atenção", value: "1", caption: "Uma média abaixo da referência" },
    { filter: "critical", label: "Crítico", value: "2", caption: "As duas médias abaixo da referência" },
    { filter: "no-portal", label: "Ainda não entraram", value: "2", caption: "No portal: sem conta ou com e-mail diferente do Canvas" },
  ]);
  assert.deepEqual(options(html, "status-filter"), [["all", "Todos os status"], ["missing-email", "Sem e-mail no Canvas"], ["pending", "Com atividades sem nota"],
    ["no-portal", "Ainda não entraram no portal"], ["ok", "Médias na referência"], ["attention", "Atenção"], ["critical", "Crítico"]]);
  assert.doesNotMatch(strip(html), /desistente|Ativos|withdrawn/i);
  assert.deepEqual(teacherRows(html).map((r) => r.name), ["Abel Sem Média", "Alice Saiu", "Ana Ativa", "Bruno Atenção", "Caio Saiu", "Carla Crítica"]);
  const expected = { all: ["Abel Sem Média", "Alice Saiu", "Ana Ativa", "Bruno Atenção", "Caio Saiu", "Carla Crítica"], ok: ["Ana Ativa", "Caio Saiu"],
    attention: ["Bruno Atenção"], critical: ["Alice Saiu", "Carla Crítica"], pending: ["Abel Sem Média", "Alice Saiu", "Bruno Atenção", "Carla Crítica"],
    "missing-email": ["Caio Saiu", "Carla Crítica"], "no-portal": ["Alice Saiu", "Bruno Atenção"] };
  for (const [filter, names] of Object.entries(expected)) assert.deepEqual(visible(rowsWith(), { filter }), names, filter);
  assert.deepEqual(visible(rowsWith(), { sort: "pending" }), ["Alice Saiu", "Carla Crítica", "Abel Sem Média", "Bruno Atenção", "Ana Ativa", "Caio Saiu"]);
  assert.deepEqual(visible(rowsWith(), { sort: "score" }), ["Abel Sem Média", "Alice Saiu", "Carla Crítica", "Bruno Atenção", "Ana Ativa", "Caio Saiu"]);
  const batch = page(rowsWith(), { filter: "pending" }).match(/data-action="reminders-batch" data-ids="([^"]*)"/)[1];
  assert.equal(batch, "6,4,2,3");
});

// B. O primeiro cartão passa a contar só ativos, com a legenda dos desistentes, e filtra Ativos.
test("B: com desistentes, o primeiro cartão vira Alunos ativos, com legenda singular ou plural", () => {
  assert.deepEqual(cards(page(rowsWith(["4", "5"])))[0], { filter: "active", label: "Alunos ativos", value: "4", caption: "2 desistentes" });
  assert.deepEqual(cards(page(rowsWith(["4"])))[0], { filter: "active", label: "Alunos ativos", value: "5", caption: "1 desistente" });
});

// C e D. Os cartões acadêmicos e "Ainda não entraram" usam só ativos; critérios e referências não mudam.
test("C/D: cartões acadêmicos e Ainda não entraram excluem desistentes", () => {
  const values = Object.fromEntries(cards(page(rowsWith(["4", "5"]))).map((c) => [c.filter, c.value]));
  assert.deepEqual(values, { active: "4", ok: "1", attention: "1", critical: "1", "no-portal": "1" });
  // Alice (desistente, portalLinked=false) não entra em Ainda não entraram; Bruno (ativo, false) entra.
  assert.equal(cards(page(rowsWith(["4"]))).find((c) => c.filter === "no-portal").value, "1");
  assert.equal(cards(page(rowsWith(["2"]))).find((c) => c.filter === "no-portal").value, "1");
});

// E. Badge discreto só na linha do desistente; nome, situação acadêmica e ação continuam.
test("E: a linha do desistente ganha o badge Desistente e mantém situação e ações", () => {
  const rows = teacherRows(page(rowsWith(["4", "5"])));
  assert.deepEqual(rows.filter((r) => r.withdrawnBadge).map((r) => r.name), ["Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.status])), {
    "Abel Sem Média": "insufficient", "Ana Ativa": "ok", "Bruno Atenção": "attention", "Carla Crítica": "critical", "Alice Saiu": "critical", "Caio Saiu": "ok" });
  assert.ok(rows.every((r) => r.details));
});

// F e ordenação. Ativos/Desistentes só aparecem com desistentes; Todos mostra os desistentes depois dos ativos,
// preservando a ordenação escolhida dentro de cada grupo.
test("F: filtros Ativos e Desistentes, e desistentes depois dos ativos em Todos", () => {
  const html = page(rowsWith(["4", "5"]));
  assert.deepEqual(options(html, "status-filter").slice(0, 3), [["all", "Todos os status"], ["active", "Ativos"], ["withdrawn", "Desistentes"]]);
  assert.equal(options(html, "status-filter").length, 9);
  const marks = rowsWith(["4", "5"]);
  assert.deepEqual(visible(marks, { filter: "active" }), ["Abel Sem Média", "Ana Ativa", "Bruno Atenção", "Carla Crítica"]);
  assert.deepEqual(visible(marks, { filter: "withdrawn" }), ["Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(visible(marks), ["Abel Sem Média", "Ana Ativa", "Bruno Atenção", "Carla Crítica", "Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(visible(marks, { sort: "pending" }), ["Carla Crítica", "Abel Sem Média", "Bruno Atenção", "Ana Ativa", "Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(visible(marks, { sort: "score" }), ["Abel Sem Média", "Carla Crítica", "Bruno Atenção", "Ana Ativa", "Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(visible(marks, { filter: "withdrawn", search: "caio" }), ["Caio Saiu"]);
  // Sem desistentes, um filtro Desistentes que sobrou (ex.: restaurado ao voltar ao painel) mostra Todos.
  assert.deepEqual(visible(rowsWith(), { filter: "withdrawn" }), visible(rowsWith()));
});

// G. Filtros acadêmicos e operacionais contam só ativos: um desistente nunca aparece como Crítico, sem nota etc.
test("G: filtros de situação, sem nota, sem e-mail e sem portal ignoram desistentes", () => {
  const marks = rowsWith(["4", "5"]);
  const expected = { ok: ["Ana Ativa"], attention: ["Bruno Atenção"], critical: ["Carla Crítica"], pending: ["Abel Sem Média", "Bruno Atenção", "Carla Crítica"],
    "missing-email": ["Carla Crítica"], "no-portal": ["Bruno Atenção"] };
  for (const [filter, names] of Object.entries(expected)) assert.deepEqual(visible(marks, { filter }), names, filter);
  // O lote a partir de "Com atividades sem nota" leva só ativos.
  assert.equal(page(marks, { filter: "pending" }).match(/data-action="reminders-batch" data-ids="([^"]*)"/)[1], "6,2,3");
});

// H. Notas da turma: mesma população ativa nos 4 cartões; desistentes continuam na tabela, com o badge, depois dos
// ativos em Todos; filtros de situação contam só ativos. Sem marcas, a tela é a de antes.
test("H: Notas da turma usa só ativos nos cartões e mantém o desistente na tabela", () => {
  const classStudents = (ids) => rowsWith(ids).map(({ name, kc, lab, total, completed, pending, status, participationStatus }) =>
    ({ name, kc, lab, total, completed, pending, status, ...(participationStatus ? { participationStatus } : {}) }));
  const render = (ids, values = {}) => withState({ classReport: { cohort: "BRSA0267", updatedAt: "2026-10-03T09:01:28Z", thresholds: { kc: 70, lab: 95 },
    students: classStudents(ids) }, ...values }, () => { renderClassReport(); return app.innerHTML; });
  const zero = render([]);
  assert.deepEqual(metrics(zero), [
    { label: "Alunos na publicação", value: "6", caption: "Última atualização da turma" }, { label: "Médias na referência", value: "2", caption: "KCs ≥ 70% e LABs ≥ 95%" },
    { label: "Atenção", value: "1", caption: "Uma média abaixo da referência" }, { label: "Crítico", value: "2", caption: "As duas médias abaixo da referência" }]);
  assert.doesNotMatch(strip(zero), /desistente|withdrawn/i);
  assert.deepEqual(classRows(zero).map((r) => r.name), ["Abel Sem Média", "Alice Saiu", "Ana Ativa", "Bruno Atenção", "Caio Saiu", "Carla Crítica"]);
  const marks = render(["4", "5"]);
  assert.deepEqual(metrics(marks).map((m) => [m.label, m.value, m.caption]), [["Alunos ativos", "4", "2 desistentes"],
    ["Médias na referência", "1", "KCs ≥ 70% e LABs ≥ 95%"], ["Atenção", "1", "Uma média abaixo da referência"], ["Crítico", "1", "As duas médias abaixo da referência"]]);
  const rows = classRows(marks);
  assert.deepEqual(rows.map((r) => r.name), ["Abel Sem Média", "Ana Ativa", "Bruno Atenção", "Carla Crítica", "Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(rows.filter((r) => r.withdrawnBadge).map((r) => r.name), ["Alice Saiu", "Caio Saiu"]);
  assert.deepEqual(rows.map((r) => r.status), ["insufficient", "ok", "attention", "critical", "critical", "ok"]);
  assert.deepEqual(classRows(render(["4", "5"], { classFilter: "critical" })).map((r) => r.name), ["Carla Crítica"]);
  assert.deepEqual(classRows(render(["4", "5"], { classFilter: "ok" })).map((r) => r.name), ["Ana Ativa"]);
});

// I. Detalhe do aluno: desistente vê o aviso e o envio fica desabilitado, com ou sem envio habilitado na instalação.
test("I: prévia individual de desistente avisa e desabilita o envio", () => {
  const preview = (extra = {}) => ({ student: { id: "4", name: "Alice Saiu", email: "alice@example.test" }, publicationId: "p1", publishedAt: "2026-10-03T09:01:28Z",
    previewHash: "h", delivery: null, ses: { ready: true, reason: "Remetente confirmado." }, activities: [{ id: "k1", name: "001 KC", kind: "kc", state: "pending" }],
    message: { from: "instrutor@example.test", to: "alice@example.test", subject: "Podemos ajudar?", text: "Olá, Alice!" }, ...extra });
  const sendButton = (html) => html.match(/<button class="button primary" data-action="send-reminder"[^>]*>/)[0];
  const active = reminderPreview(preview());
  assert.doesNotMatch(sendButton(active), /disabled/);
  assert.doesNotMatch(strip(active), /desistente/i);
  const withdrawn = reminderPreview(preview(WITHDRAWN));
  assert.match(sendButton(withdrawn), /disabled/);
  assert.match(strip(withdrawn), /Aluno desistente\. Lembretes estão desativados\./);
  const disabledInstallation = reminderPreview(preview({ ...WITHDRAWN, message: undefined }));
  assert.match(strip(disabledInstallation), /Aluno desistente\. Lembretes estão desativados\./);
  assert.doesNotMatch(disabledInstallation, /data-action="send-reminder"/);
});

// J. Motivo "withdrawn" do backend aparece traduzido na prévia e no resultado do lote, nunca cru.
test("J: skip withdrawn vira Desistente na prévia e no resultado do lote", () => {
  const preview = { publicationId: "p1", ses: { ready: true, reason: "ok" }, sample: { from: "i@example.test", subject: "s", text: "t" },
    recipients: [{ id: "1", name: "Ana Ativa", pending: 1, skip: null }, { id: "4", name: "Alice Saiu", pending: 4, skip: "withdrawn" },
      { id: "3", name: "Carla Crítica", pending: 3, skip: "no-email" }] };
  const html = withState({ batchPreview: preview, batchError: "", batchResults: null }, () => batchPage());
  assert.match(strip(html), /Alice Saiu 4 Desistente/);
  assert.match(strip(html), /Carla Crítica 3 Sem e-mail no Canvas/);
  const results = withState({ batchPreview: preview, batchError: "", batchResults: [{ id: "1", name: "Ana Ativa", status: "sent" },
    { id: "4", name: "Alice Saiu", status: "skipped", reason: "withdrawn" }] }, () => batchPage());
  assert.match(strip(results), /Alice Saiu Pulado · Desistente/);
  for (const out of [html, results]) assert.doesNotMatch(strip(out), /withdrawn/);
});

// Envio em lote com transporte falso: registra cada chamada e a confirmação pedida; notice() roda com DOM mínimo e
// sem timer.
async function sendWith(preview, { selected, results = [] } = {}) {
  const calls = [], confirms = [];
  const saved = { setTimeout: globalThis.setTimeout, confirm: globalThis.confirm };
  globalThis.setTimeout = () => 0;
  globalThis.confirm = (message) => { confirms.push(message); return true; };
  api.setTransport(async (path, options) => { calls.push({ path, body: options.body }); return { publicationId: preview.publicationId, results }; });
  remindersHandlers.configure({ render: () => {} });
  const keys = ["code", "view", "batchIds", "batchPreview", "batchResults", "batchError"];
  const before = Object.fromEntries(keys.map((key) => [key, state[key]]));
  try {
    Object.assign(state, { code: "BRSA0267", view: "reminders-batch", batchIds: selected ?? preview.recipients.map((r) => r.id), batchPreview: preview,
      batchResults: null, batchError: "" });
    await remindersHandlers.sendBatch();
    return { calls, confirms, batchResults: state.batchResults };
  } finally {
    Object.assign(state, before);
    Object.assign(globalThis, saved);
    remindersHandlers.configure({ render: null });
    api.setTransport(() => { throw new Error("Sem rede nos testes de participação."); });
  }
}
const recipient = (id, skip = null) => ({ id, name: nameOf[id] || `Aluno ${id}`, email: `${id}@example.test`, pending: 1, skip });
const batch = (recipients) => ({ publicationId: "p1", publishedAt: "2026-10-03T09:01:28Z", ses: { ready: true, reason: "ok" },
  sample: { from: "i@example.test", subject: "s", text: "t" }, recipients });

// K e o teste de payload: selecionados [A, B, C, D], prévia aprova [A, C] → o envio leva exatamente [A, C].
test("K: o envio leva só os IDs aprovados na prévia, nunca os selecionados originais", async () => {
  const preview = batch([recipient("1"), recipient("2", "no-email"), recipient("3"), recipient("4", "already-sent")]);
  const { calls, confirms } = await sendWith(preview, { selected: ["1", "2", "3", "4"] });
  assert.deepEqual(calls, [{ path: "/cohorts/BRSA0267/send-reminders", body: { studentIds: ["1", "3"], expectedPublicationId: "p1" } }]);
  assert.deepEqual(confirms, ["Enviar lembrete para 2 alunos?"]);
});

// L. Prévia sem aprovados: nenhuma confirmação e nenhuma requisição; a tela não oferece o botão de envio.
test("L: zero aprovados não pede confirmação nem envia", async () => {
  const preview = { ...batch([recipient("4", "withdrawn"), recipient("2", "no-email")]), sample: null };
  const { calls, confirms } = await sendWith(preview);
  assert.deepEqual([calls, confirms], [[], []]);
  const html = withState({ batchPreview: preview, batchError: "", batchResults: null }, () => batchPage());
  assert.doesNotMatch(html, /data-action="send-reminders-batch"/);
  assert.match(strip(html), /0 de 2 alunos vão receber/);
});

// M. Prévia mista: 10 selecionados, 6 elegíveis, 2 desistentes, 1 sem e-mail, 1 já contatado → exatamente os 6.
test("M: prévia mista envia exatamente os 6 elegíveis, na ordem da prévia, e as contagens batem", async () => {
  const skips = { 2: "withdrawn", 5: "withdrawn", 7: "no-email", 9: "already-sent" };
  const ids = ["10", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const preview = batch(ids.map((id) => recipient(id, skips[id] || null)));
  const { calls, confirms } = await sendWith(preview, { selected: ids });
  assert.deepEqual(calls.map((c) => c.body.studentIds), [["10", "1", "3", "4", "6", "8"]]);
  assert.deepEqual(confirms, ["Enviar lembrete para 6 alunos?"]);
  const html = withState({ batchPreview: preview, batchError: "", batchResults: null }, () => batchPage());
  assert.match(strip(html), /6 de 10 alunos vão receber/);
  assert.match(html, />Enviar para 6 alunos</);
  assert.equal((strip(html).match(/Desistente/g) || []).length, 2);
});

// N. Desistente na prévia e reativado antes do envio: o frontend não amplia o lote (vale para qualquer motivo).
test("N: quem a prévia não aprovou não entra no envio, mesmo que a situação mude depois", async () => {
  for (const skip of ["withdrawn", "no-email", "no-pending", "already-sent", "not-found"]) {
    const { calls } = await sendWith(batch([recipient("1"), recipient("2", skip)]), { selected: ["1", "2"] });
    assert.deepEqual(calls.map((c) => c.body.studentIds), [["1"]], skip);
  }
});

// O. Aprovado na prévia e marcado desistente depois: continua no envio; o backend é quem pula, e a tela traduz.
test("O: aprovado que vira desistente depois da prévia segue no envio e o resultado mostra Desistente", async () => {
  const { calls, batchResults } = await sendWith(batch([recipient("1"), recipient("4")]), {
    results: [{ id: "1", name: "Ana Ativa", status: "sent" }, { id: "4", name: "Alice Saiu", status: "skipped", reason: "withdrawn" }] });
  assert.deepEqual(calls.map((c) => c.body.studentIds), [["1", "4"]]);
  const html = withState({ batchPreview: null, batchError: "", batchResults }, () => batchPage());
  assert.match(strip(html), /1 enviado · 1 pulado · 0 com falha\./);
  assert.match(strip(html), /Alice Saiu Pulado · Desistente/);
});

// Prévia nova substitui a anterior: o envio usa os aprovados da prévia exibida, nunca os de uma prévia antiga.
test("Prévia nova: o envio usa só os aprovados da prévia exibida", async () => {
  const calls = [];
  const saved = Object.fromEntries(["code", "view", "batchIds", "batchPreview", "batchResults", "batchError"].map((key) => [key, state[key]]));
  const savedGlobals = { setTimeout: globalThis.setTimeout, confirm: globalThis.confirm };
  globalThis.setTimeout = () => 0;
  globalThis.confirm = () => true;
  const previews = [batch([recipient("1"), recipient("2", "no-email")]), batch([recipient("3", "withdrawn"), recipient("6")])];
  api.setTransport(async (path, options) => {
    calls.push({ path, body: options.body });
    return path.endsWith("/pending-preview-batch") ? previews.shift() : { publicationId: "p1", results: [] };
  });
  remindersHandlers.configure({ render: () => {} });
  try {
    Object.assign(state, { code: "BRSA0267", view: "reminders-batch", batchIds: ["1", "2"] });
    await remindersHandlers.loadBatchPreview();
    state.batchIds = ["3", "6"];
    await remindersHandlers.loadBatchPreview();
    await remindersHandlers.sendBatch();
    assert.deepEqual(calls.map((c) => c.body), [{ studentIds: ["1", "2"] }, { studentIds: ["3", "6"] }, { studentIds: ["6"], expectedPublicationId: "p1" }]);
  } finally {
    Object.assign(state, saved);
    Object.assign(globalThis, savedGlobals);
    remindersHandlers.configure({ render: null });
    api.setTransport(() => { throw new Error("Sem rede nos testes de participação."); });
  }
});

// Ver por atividade: as estatísticas vêm prontas do backend, que já exclui desistentes; a tela não recalcula a partir
// das linhas de alunos. Mesmo payload de atividades, com ou sem desistentes nas linhas → mesma tela, mesmos percentuais.
test("Ver por atividade reflete só as estatísticas do backend, com ou sem desistentes nas linhas", async () => {
  const { activityOverviewPage } = await import("../frontend/pages/activities-overview.js");
  const activities = [{ id: "a1", name: "001 KC Introdução", kind: "kc", active: true, completed: 3, pending: 1, needsReview: 1, average: 72.5, points: "100" },
    { id: "a2", name: "002 LAB Rede", kind: "lab", active: true, completed: 0, pending: 4, needsReview: 0, average: null, points: "100" }];
  const render = (students) => withState({ report: { ...report(students), activities }, activityOverviewKind: "all", activityOverviewModule: "all", activityOverviewSort: "name" },
    () => activityOverviewPage());
  const withMarks = render(rowsWith(["4", "5"]));
  assert.equal(withMarks, render(rowsWith()));
  assert.equal(withMarks, render([]));
  assert.match(strip(withMarks), /001 KC Introdução .* KC 75% 25% 33,33% 72,5%/);
  assert.match(strip(withMarks), /002 LAB Rede .* LAB 0% 100% — —/);
});

// C7.2.4. CSV exportado pelo portal (não o CSV de entrada do Canvas): coluna Participação sempre presente, no fim, com
// Ativo ou Desistente; Situação continua sendo a situação acadêmica. O export segue a população filtrada da tela.
const { studentsCsv } = await import("../frontend/pages/teacher.js");
const { pendingPage } = await import("../frontend/pages/reminders.js");
const OLD_HEADER = ["Nome", "E-mail", "Média KC (%)", "Média LAB (%)", "Média geral (%)", "Com nota (%)", "Sem nota", "Situação", "Entrou no portal"];
const parseCsv = (csv) => csv.replace(/^﻿/, "").split("\r\n").map((line) => line.split(";").map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"')));
const exportOf = (students, values = {}) => withState({ report: report(students), ...values }, () => parseCsv(studentsCsv(filteredStudents())));

test("CSV A: sem marcas, a única mudança é a coluna Participação no fim, com Ativo para todos", () => {
  const [header, ...rows] = exportOf(rowsWith());
  assert.deepEqual(header, [...OLD_HEADER, "Participação"]);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.length === 10 && r[9] === "Ativo"));
  assert.deepEqual(rows.find((r) => r[0] === "Alice Saiu"), ["Alice Saiu", "alice@example.test", "30", "40", "35", "20", "4", "Crítico", "Não", "Ativo"]);
  assert.deepEqual(rows.find((r) => r[0] === "Abel Sem Média"), ["Abel Sem Média", "abel@example.test", "", "", "", "0", "2", "Sem avaliação completa", "Sim", "Ativo"]);
});

test("CSV B–F: misto em Todos, Ativos e Desistentes, com Situação acadêmica intacta", () => {
  const marks = rowsWith(["4", "5"]);
  const [, ...all] = exportOf(marks);
  assert.deepEqual(all.map((r) => [r[0], r[7], r[9]]), [["Abel Sem Média", "Sem avaliação completa", "Ativo"], ["Ana Ativa", "Médias na referência", "Ativo"],
    ["Bruno Atenção", "Atenção", "Ativo"], ["Carla Crítica", "Crítico", "Ativo"], ["Alice Saiu", "Crítico", "Desistente"], ["Caio Saiu", "Médias na referência", "Desistente"]]);
  const [, ...active] = exportOf(marks, { filter: "active" });
  assert.deepEqual(active.map((r) => [r[0], r[9]]), [["Abel Sem Média", "Ativo"], ["Ana Ativa", "Ativo"], ["Bruno Atenção", "Ativo"], ["Carla Crítica", "Ativo"]]);
  const [, ...withdrawn] = exportOf(marks, { filter: "withdrawn" });
  assert.deepEqual(withdrawn.map((r) => [r[0], r[7], r[9]]), [["Alice Saiu", "Crítico", "Desistente"], ["Caio Saiu", "Médias na referência", "Desistente"]]);
  const [, ...critical] = exportOf(marks, { filter: "critical" });
  assert.deepEqual(critical.map((r) => [r[0], r[9]]), [["Carla Crítica", "Ativo"]]);
});

test("CSV G: escape de fórmula, aspas e ponto e vírgula continua igual, também na linha do desistente", () => {
  const tricky = [{ ...BASE[0], id: "9", name: '=SOMA(1;2) "x"', email: "+a@example.test", ...WITHDRAWN }];
  const csv = withState({ report: report(tricky) }, () => studentsCsv(filteredStudents()));
  assert.equal(csv.split("\r\n")[1], `"'=SOMA(1;2) ""x""";"'+a@example.test";"80";"96";"88";"100";"0";"Médias na referência";"Sim";"Desistente"`);
});

// Detalhe do aluno: uma só ação de participação, conforme o status que o servidor devolveu na prévia; o título tem
// id e tabindex para receber o foco depois da mudança.
const detailOf = (extra = {}) => withState({ pendingError: "", pendingPreview: { student: { id: "4", name: "Alice Saiu", email: "alice@example.test" }, publicationId: "p1",
  publishedAt: "2026-10-03T09:01:28Z", previewHash: "h", delivery: null, ses: { ready: true, reason: "Remetente confirmado." },
  activities: [{ id: "k1", name: "001 KC", kind: "kc", state: "pending" }], message: { from: "i@example.test", to: "alice@example.test", subject: "s", text: "t" }, ...extra } },
() => pendingPage());

test("Detalhe: ativo tem só Marcar como desistente; desistente tem só Reativar aluno, com o badge", () => {
  const active = detailOf();
  assert.match(active, /<h2 id="participation-heading" tabindex="-1">Participação na turma<\/h2>/);
  assert.match(active, /data-action="withdraw-student"[^>]*>Marcar como desistente<\/button>/);
  assert.doesNotMatch(active, /reactivate-student|Reativar aluno|class="badge withdrawn"/);
  const withdrawn = detailOf(WITHDRAWN);
  assert.match(withdrawn, /data-action="reactivate-student"[^>]*>Reativar aluno<\/button>/);
  assert.doesNotMatch(withdrawn, /data-action="withdraw-student"|Marcar como desistente/);
  assert.match(withdrawn, /<span class="badge withdrawn">Desistente<\/span>/);
  assert.equal((withdrawn.match(/data-action="(withdraw|reactivate)-student"/g) || []).length, 1);
});

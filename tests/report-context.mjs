// TODO 23: executa as funções reais do app com promises controladas, sem rede ou DOM de produção.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
const source = (name, async = false) => {
  const match = app.match(new RegExp(`^${async ? "async " : ""}function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, name); return match[0];
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const person = (id) => ({ email: `${id}@example.test`, userId: id, roles: ["instructor"] });
function reports() {
  const state = { me: person("A"), code: "TURMA-A", view: "overview", studentView: null, pendingStudentId: "", report: null, reportError: "" };
  const calls = [], exits = [];
  const read = () => { const d = deferred(); calls.push(d); return d.promise; };
  const api = { cohorts: { report: read, studentView: read, classReport: read } };
  return new Function("state", "api", "exits", `
    let readContext = [], reportRequest = 0, classReportRequest = 0, renders = 0;
    const history = { replaceState() {} };
    const remindersHandlers = { invalidateReads() {} }, feedbackHandlers = { invalidateReads() {} };
    ${source("syncReadContext")}
    function render() { syncReadContext(); renders++; }
    const exitStudentView = async (message) => exits.push(message);
    ${source("loadReport", true)}
    ${source("loadClassReport", true)}
    syncReadContext();
    return { state, calls: arguments[3], exits, load: loadReport, classLoad: () => loadClassReport("TURMA-A"), change: (patch) => { Object.assign(state, patch); render(); }, renders: () => renders };
  `)(state, api, exits, calls);
}
for (const failure of [false, true]) {
  for (const kind of ["guia", "turma", "usuario", "visualizacao"]) {
    test(`relatório: ${kind} A→B→A não aceita ${failure ? "erro" : "sucesso"} antigo`, async () => {
      const h = reports();
      if (kind === "visualizacao") h.change({ studentView: { code: "TURMA-A", studentId: "1" } });
      const job = h.load(), request = h.calls[0];
      const patch = kind === "guia" ? { view: "course-guide" } : kind === "turma" ? { code: "TURMA-B" }
        : kind === "usuario" ? { me: person("B") } : { studentView: { code: "TURMA-A", studentId: "2" } };
      const original = Object.fromEntries(Object.keys(patch).map((key) => [key, h.state[key]]));
      h.change(patch); h.change(original);
      const before = { report: h.state.report, error: h.state.reportError, renders: h.renders() };
      request[failure ? "reject" : "resolve"](failure ? new Error("resposta antiga") : { publication: { id: "antiga" } });
      await job;
      assert.deepEqual({ report: h.state.report, error: h.state.reportError, renders: h.renders() }, before);
      assert.deepEqual(h.exits, [], "erro da visualização antiga não fecha a visualização atual");
    });
  }
}
test("relatório: B vence A; erro antigo não substitui sucesso e a resposta atual continua válida", async () => {
  const h = reports(), a = h.load(), b = h.load();
  h.calls[1].resolve({ publication: { id: "B" } }); await b;
  h.calls[0].reject(new Error("erro A")); await a;
  assert.equal(h.state.report.publication.id, "B"); assert.equal(h.state.reportError, "");
});
test("relatório: troca de usuário antes de render não aceita dados do anterior", async () => {
  const h = reports(), job = h.load();
  h.state.me = person("B");
  h.calls[0].resolve({ publication: { id: "privado A" } }); await job;
  assert.equal(h.state.report, null);
});
for (const failure of [false, true]) test(`notas da turma: sair da tela descarta ${failure ? "erro" : "sucesso"} do refresh`, async () => {
  const h = reports(); h.state.classReport = { cohort: "TURMA-A" };
  const job = h.classLoad(); h.change({ classReport: null });
  h.calls[0][failure ? "reject" : "resolve"](failure ? new Error("erro antigo") : { cohort: "TURMA-A" });
  await job;
  assert.equal(h.state.classReport, null, "Atualizar antigo não reabre as notas depois de Voltar ao meu painel");
});
test("notas da turma: B termina primeiro; A não sobrescreve o relatório mais recente", async () => {
  const h = reports(); h.state.classReport = { cohort: "TURMA-A" };
  const a = h.classLoad(), b = h.classLoad();
  h.calls[1].resolve({ cohort: "TURMA-A", marker: "B" }); await b;
  h.calls[0].resolve({ cohort: "TURMA-A", marker: "A" }); await a;
  assert.equal(h.state.classReport.marker, "B");
});
test("notas da turma: retorno A→Guia→A não revalida a leitura anterior", async () => {
  const h = reports(); h.state.classReport = null;
  const job = h.classLoad(); h.change({ view: "course-guide" }); h.change({ view: "overview" });
  h.calls[0].resolve({ cohort: "TURMA-A" }); await job;
  assert.equal(h.state.classReport, null);
});

function boots() {
  const state = { me: person("inicial"), code: "TURMA-A", view: "overview", cohorts: [], studentView: null, pendingStudentId: "" };
  const calls = [], resets = [];
  const api = { me: { get: () => { const d = deferred(); calls.push(d); return d.promise; } }, cohorts: { list: async () => ({ cohorts: [{ code: "TURMA-A" }] }) } };
  const reset = { invalidateReads() {}, resetForUser: (id) => resets.push(id), resetDraftsForUser: (id) => resets.push(id), discardDrafts() {}, hasUnpublishedCsv: () => false };
  return new Function("h", `
    const { state, api, calls, reset, resets } = h;
    let bootRequest = 0, reportRequest = 0, sessionGeneration = 0, importFailure = null;
    const remindersHandlers = reset, feedbackHandlers = reset, importHandlers = reset, adminFeedbackHandlers = reset;
    const demo = false, config = {}, studentViews = ["overview", "course-guide"];
    const render = () => {}, publicPage = () => {}, clearSession = () => {}, saveContext = () => {};
    const admin = () => false, teacher = () => false, personOf = (me) => me?.userId || "";
    const localStorage = { getItem: () => null, removeItem() {} }, location = { assign() {} };
    const forgetStudentView = () => { state.studentView = null; }, logout = () => {}, confirm = () => true;
    const loadReport = async () => { state.report = { owner: state.me.email }; };
    ${source("expireSession")}
    ${source("signOut")}
    ${source("boot", true)}
    return { state, calls, resets, boot, expire: expireSession, logout: signOut };
  `)({ state, api, calls, reset, resets });
}
test("boot: resposta /me antiga não substitui usuário e relatório do boot mais recente", async () => {
  const h = boots(), a = h.boot(), b = h.boot();
  h.calls[1].resolve(person("B")); await b;
  h.calls[0].resolve(person("A")); await a;
  assert.equal(h.state.me.email, person("B").email); assert.equal(h.state.report.owner, person("B").email);
  assert.ok(!h.resets.includes(person("A").email), "resposta descartada não reinicia os rascunhos atuais");
});
for (const action of ["expire", "logout"]) test(`boot: ${action} invalida /me em andamento`, async () => {
  const h = boots(), a = h.boot(); h[action]();
  const before = h.state.me;
  h.calls[0].resolve(person("A")); await a;
  assert.equal(h.state.me, before); assert.deepEqual(h.resets.filter((id) => id === person("A").email), []);
});
test("boot: erro antigo não deixa bootError sobre um sucesso novo", async () => {
  const h = boots(), a = h.boot(), b = h.boot();
  h.calls[1].resolve(person("B")); await b;
  h.calls[0].reject(new Error("erro A")); await a;
  assert.equal(h.state.bootError, "");
});

// TODO 26: o Foco da turma deixou de ser uma operação da interface. Um backend anterior ainda pode devolver focus,
// mas nem esse payload nem um outcome antigo podem reintroduzir controles/avisos. A restauração continua na suíte C1 browser.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const { teacherPage } = await import("../frontend/pages/teacher.js");

test("TODO26-U1: foco legado e resultados antigos não reintroduzem editor, ações ou alertas no painel", () => {
  const previous = { me: state.me, report: state.report, cohorts: state.cohorts, code: state.code, filter: state.filter,
    search: state.search, sort: state.sort, canvasActivityFilter: state.canvasActivityFilter, studentView: state.studentView };
  const focus = { activityIds: ["a1"], version: "v0" };
  const persistedFocus = structuredClone(focus);
  try {
    Object.assign(state, { me: { roles: ["instructor"] }, code: "FIC001", cohorts: [{ code: "FIC001", canTeach: true }],
      filter: "all", search: "", sort: "name", canvasActivityFilter: "all", studentView: null,
      report: { cohort: "FIC001", publication: { id: "p1", publishedAt: "2026-10-23T12:00:00Z" }, focus,
        thresholds: { kc: 70, lab: 95 }, students: [], activities: [], history: [] } });
    for (const outcome of [{ kind: "saving" }, { kind: "saved", message: "Foco antigo salvo" },
      { kind: "error", unsure: true, message: "Erro antigo do foco" }]) {
      const html = teacherPage({ focus: outcome });
      assert.doesNotMatch(html, /Foco da turma|focus-form|data-add-focus|data-remove-focus|tp-focus-status/);
      assert.doesNotMatch(html, /Foco antigo salvo|Erro antigo do foco|Salvando o foco/);
      assert.match(html, /Painel da FIC001/);
      assert.match(html, /Ver por atividade/);
      assert.deepEqual(state.report.focus, persistedFocus, "a leitura não remove dados legados do backend");
    }
  } finally { Object.assign(state, previous); }
});

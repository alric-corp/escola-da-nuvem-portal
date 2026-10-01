// Estado compartilhado (frontend/state.js): contrato inicial e referência única entre módulos.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const ui = await import("../frontend/ui.js");
const { historyPage } = await import("../frontend/pages/history.js");
const initial = structuredClone(direct);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const PAGES = ["access", "activities-overview", "admin-feedback", "class-report", "feedback", "history",
  "import", "landing", "reminders", "student", "teacher"].map((page) => `pages/${page}.js`);
const CONSUMERS = ["app.js", ...PAGES];

// Contrato: as 57 propriedades, nesta ordem, com estes valores iniciais.
const EXPECTED = {
  me: null, cohorts: [], code: "", report: null, reportError: "", bootError: "", pendingError: "",
  sender: null, senderError: "", senderLoading: false, sort: "name", teacherFilters: null,
  acknowledgeRemoved: false, importLoading: false, view: "overview",
  activityKind: "all", activityModule: "all", activityOverviewKind: "all", activityOverviewModule: "all", activityOverviewSort: "name",
  focusDraft: null, filter: "all", search: "", requests: [], instructors: [],
  preview: null, csv: "", filename: "", dirty: false, accessLoading: false, accessError: "", requestsFilter: "pending",
  studentQuery: "", studentResults: null, studentSearchError: "", studentSearchLoading: false, editingStudentId: null,
  pendingPreview: null, pendingStudentId: "", batchIds: [], batchPreview: null, batchError: "", batchResults: null,
  classReport: null, studentView: null,
  feedbackDraft: { type: "", title: "", description: "" }, feedbackOrigin: "", feedbackSending: false, feedbackSent: false,
  feedbackFiles: [], feedbackUpload: { feedbackId: null, progress: "", failed: false }, feedbackAttachments: {}, feedbackCardUpload: {},
  myFeedback: { items: [], nextCursor: null, loading: false, error: "" },
  adminFeedback: { items: [], nextCursor: null, summary: null, loading: false, error: "", filters: { status: "", type: "", cohort: "" }, selectedId: null },
  classFilter: "all", classSearch: "",
};

// Altera propriedades do state durante fn e restaura os valores originais depois.
function withState(changes, fn) {
  const saved = Object.fromEntries(Object.keys(changes).map((key) => [key, direct[key]]));
  Object.assign(direct, changes);
  try { fn(); } finally { Object.assign(direct, saved); }
}

// Imports estáticos e dinâmicos de um módulo do frontend, resolvidos como caminhos relativos a frontend/.
function importsOf(file) {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return [...read(`frontend/${file}`).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)["'](\.[^"']+)["']/gm)]
    .map(([, spec]) => new URL(spec, `file:///${dir}`).pathname.slice(1));
}

test("state.js tem exatamente as 57 chaves esperadas, na mesma ordem", () => {
  assert.equal(Object.keys(initial).length, 57);
  assert.deepEqual(Object.keys(initial), Object.keys(EXPECTED));
});

test("valores iniciais e objetos aninhados idênticos ao contrato", () => {
  assert.deepEqual(initial, EXPECTED);
  for (const key of ["feedbackDraft", "feedbackUpload", "myFeedback", "adminFeedback"])
    assert.deepEqual(Object.keys(initial[key]), Object.keys(EXPECTED[key]), key);
  assert.deepEqual(Object.keys(initial.adminFeedback.filters), ["status", "type", "cohort"]);
});

test("state.js é uma folha: nenhum import e apenas o export de state", () => {
  const source = read("frontend/state.js");
  assert.deepEqual(importsOf("state.js"), []);
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.deepEqual([...source.matchAll(/^export\s+(?:let|const|function|\{)\s*(\w+)?/gm)].map((m) => m[1]), ["state"]);
});

test("ui.js observa na hora uma alteração feita via state.js", () => {
  withState({ view: "history", me: { roles: ["admin"], email: "admin@example.test" } }, () => {
    assert.match(ui.nav("history", "Meu histórico", "clock"), /class="nav-item active" data-view="history" aria-current="page"/);
    assert.doesNotMatch(ui.nav("overview", "Meu desempenho", "grid"), /active/);
    assert.equal(ui.pageLabel(), "Meu histórico");
    assert.equal(ui.admin(), true);
  });
  assert.equal(direct.view, "overview");
  assert.equal(ui.admin(), undefined);
});

test("uma página observa alterações feitas via state.js", () => {
  assert.doesNotMatch(historyPage(), /history-table/);
  const report = { history: [{ publishedAt: "2026-09-01T12:00:00Z", total: 50, kc: 40, lab: 60 }] };
  withState({ report }, () => assert.match(historyPage(), /history-table/));
  assert.equal(direct.report, null);
});

test("nenhuma propriedade fora do contrato é lida ou criada por app.js, ui.js ou pelas páginas", () => {
  const files = [...CONSUMERS, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js", "handlers/reminders.js"];
  const known = new Set(Object.keys(EXPECTED));
  for (const file of files) {
    const source = read(`frontend/${file}`);
    for (const [, key] of source.matchAll(/\bstate\.(?!js\b)(\w+)/g)) assert.ok(known.has(key), `${file}: state.${key}`);
    for (const [, literal] of source.matchAll(/Object\.assign\(\s*state\s*,\s*\{([^}]*)\}/g))
      for (const [, key] of literal.matchAll(/(\w+)\s*:/g)) assert.ok(known.has(key), `${file}: Object.assign(state, { ${key} })`);
    // Escritas dinâmicas (state[key] = …) percorrem listas literais de chaves.
    for (const match of source.matchAll(/\[((?:\s*"\w+",?)+)\]\.(?:map|forEach)|for \(const key of \[((?:\s*"\w+",?)+)\]\)/g)) {
      if (!source.slice(match.index, match.index + match[0].length + 120).includes("state[")) continue;
      for (const [, key] of (match[1] || match[2]).matchAll(/"(\w+)"/g)) assert.ok(known.has(key), `${file}: chave dinâmica ${key}`);
    }
  }
});

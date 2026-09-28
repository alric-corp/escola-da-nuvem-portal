// Estado compartilhado (frontend/state.js): contrato inicial e referência única entre módulos.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const ui = await import("../frontend/ui.js");
const { historyPage } = await import("../frontend/pages/history.js");
const importHandlers = await import("../frontend/handlers/import.js");
const adminFeedbackHandlers = await import("../frontend/handlers/admin-feedback.js");
const importPageModule = await import("../frontend/pages/import.js");
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

test("state.js e ui.js exportam a mesma referência", () => {
  assert.equal(ui.state, direct);
});

// O re-export continua enquanto módulos anteriores à migração podem estar em cache nos navegadores.
test("ui.js continua reexportando o mesmo binding de state.js", () => {
  const source = read("frontend/ui.js");
  assert.match(source, /^import \{ state \} from "\.\/state\.js";$/m);
  assert.match(source, /^export \{ state \};$/m);
});

test("app.js e as 11 páginas importam state direto de state.js, e nenhum de ui.js", () => {
  for (const file of CONSUMERS) {
    const imports = [...read(`frontend/${file}`).matchAll(/^import \{([^}]*)\} from "([^"]+)";$/gm)]
      .map(([, names, from]) => ({ names: names.split(",").map((name) => name.trim()), from }));
    const withState = imports.filter((i) => i.names.includes("state"));
    assert.deepEqual(withState.map((i) => i.from), [file === "app.js" ? "./state.js" : "../state.js"], file);
    assert.deepEqual(withState[0].names, ["state"], file);
  }
});

test("ui.js observa na hora uma alteração feita via state.js", () => {
  withState({ view: "history", me: { roles: ["admin"], email: "admin@example.test" } }, () => {
    assert.equal(ui.state.view, "history");
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

test("uma página que importa state.js direto observa uma escrita feita pelo state reexportado de ui.js", () => {
  const report = { history: [{ publishedAt: "2026-09-01T12:00:00Z", total: 50, kc: 40, lab: 60 }] };
  ui.state.report = report;
  try { assert.match(historyPage(), /history-table/); } finally { ui.state.report = null; }
  assert.equal(direct.report, null);
});

test("nenhuma propriedade fora do contrato é lida ou criada por app.js, ui.js ou pelas páginas", () => {
  const files = [...CONSUMERS, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js"];
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

test("build publica state.js e todo módulo alcançável a partir de app.js, sem ciclos de import", () => {
  const listed = new Set([...read("scripts/build_frontend.py").matchAll(/"([\w/-]+\.js)"/g)].map((m) => m[1]));
  assert.ok(listed.has("state.js"));
  const seen = new Set(), visiting = new Set();
  const visit = (file, trail) => {
    assert.ok(!visiting.has(file), `ciclo: ${[...trail, file].join(" → ")}`);
    if (seen.has(file)) return;
    assert.ok(listed.has(file), `${file} não está na lista do build`);
    visiting.add(file);
    for (const dep of importsOf(file)) visit(dep, [...trail, file]);
    visiting.delete(file);
    seen.add(file);
  };
  visit("app.js", []);
  assert.ok(seen.has("state.js") && seen.has("ui.js") && seen.has("api.js"));
  assert.deepEqual(importsOf("ui.js"), ["state.js"]);
});

// Turmas e acessos: orquestração fora de app.js, sem voltar a depender dele nem registrar listeners.
test("handlers/access.js importa só api, state e ui, não registra listeners e entra no build", () => {
  assert.deepEqual(importsOf("handlers/access.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(read("frontend/handlers/access.js"), /addEventListener/);
  assert.ok(importsOf("app.js").includes("handlers/access.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/access.js"'));
  assert.deepEqual(importsOf("state.js"), []);
});

// Importação: rascunhos, CSV, prévia e publicação fora de app.js. Listeners, busy, boot, saída e
// restauração de publicação continuam lá.
test("handlers/import.js importa só api, state e ui, não registra listeners e entra no build", () => {
  const source = read("frontend/handlers/import.js");
  assert.deepEqual(importsOf("handlers/import.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener/);
  assert.match(source, /^export function configure\(options\) \{\n  render = options\.render;\n\}$/m);
  assert.ok(importsOf("app.js").includes("handlers/import.js"));
  assert.equal((read("frontend/app.js").match(/importHandlers\.configure\(/g) || []).length, 1);
  assert.match(read("frontend/app.js"), /^importHandlers\.configure\(\{ render \}\);$/m);
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/import.js"'));
});

test("blockedByIntegrity mora só em handlers/import.js, e pages/import.js a importa de lá", () => {
  assert.match(read("frontend/handlers/import.js"), /^export function blockedByIntegrity\(p\) \{\n  return !!p\?\.integrity\?\.critical\?\.length;\n\}$/m);
  const page = read("frontend/pages/import.js");
  assert.doesNotMatch(page, /function blockedByIntegrity|blockedByIntegrity\s*=|integrity\?\.critical\?\.length/);
  assert.match(page, /^import \{ blockedByIntegrity \} from "\.\.\/handlers\/import\.js";$/m);
  // Compatibilidade de cache: a página continua exportando o mesmo binding do handler.
  assert.match(page, /^export \{ blockedByIntegrity \};$/m);
  assert.deepEqual(importsOf("pages/import.js").sort(), ["handlers/import.js", "state.js", "ui.js"]);
  assert.equal(importHandlers.blockedByIntegrity({ integrity: { critical: [{}] } }), true);
  assert.equal(importHandlers.blockedByIntegrity({ integrity: { critical: [] } }), false);
  assert.equal(importHandlers.blockedByIntegrity(null), false);
  assert.equal(importPageModule.blockedByIntegrity, importHandlers.blockedByIntegrity);
});

test("app.js não guarda mais rascunhos nem a lógica de importação", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/\bdrafts\b/, /\bdraftOwner\b/, /function (saveDraft|restoreDraft)\b/, /blockedByIntegrity/,
    /api\.cohorts\.(previewImport|publish)\b/, /file\.text\(\)/])
    assert.doesNotMatch(app, pattern);
  for (const kept of ['window.addEventListener("beforeunload"', "function signOut()", "async function boot()", "async function busy(",
    "api.cohorts.restore(", "importHandlers.hasUnpublishedCsv()", "importHandlers.discardDrafts()", "importHandlers.resetDraftsForUser(state.me.email)"])
    assert.ok(app.includes(kept), kept);
});

// A troca de usuário zera arquivo e prévia, mas não acknowledgeRemoved nem importLoading (comportamento
// anterior à extração, sem teste de navegador direto para importLoading).
test("resetDraftsForUser descarta os rascunhos e preserva acknowledgeRemoved e importLoading", () => {
  const keys = ["code", "csv", "filename", "preview", "dirty", "acknowledgeRemoved", "importLoading"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  try {
    importHandlers.resetDraftsForUser("primeiro@example.test");
    const preview = { activities: [] };
    Object.assign(direct, { code: "BRSA0001", csv: "a,b", filename: "notas.csv", preview, dirty: true, acknowledgeRemoved: true, importLoading: true });
    importHandlers.saveDraft();
    importHandlers.resetDraftsForUser("primeiro@example.test");
    assert.equal(direct.csv, "a,b");
    assert.equal(direct.preview, preview);
    direct.csv = "";
    assert.ok(importHandlers.hasUnpublishedCsv());
    direct.csv = "a,b";
    importHandlers.resetDraftsForUser("segundo@example.test");
    assert.deepEqual({ csv: direct.csv, filename: direct.filename, preview: direct.preview, dirty: direct.dirty },
      { csv: "", filename: "", preview: null, dirty: false });
    assert.equal(direct.importLoading, true);
    assert.equal(direct.acknowledgeRemoved, true);
    assert.ok(!importHandlers.hasUnpublishedCsv());
  } finally {
    importHandlers.discardDrafts();
    Object.assign(direct, saved);
  }
});

// Admin Feedback: listagem, filtros, paginação e status fora de app.js. Attachments, feedback
// próprio, listeners, busy, foco de DOM e "visualizar como aluno" continuam lá.
test("handlers/admin-feedback.js importa só api, state e ui, não registra listeners e entra no build", () => {
  const source = read("frontend/handlers/admin-feedback.js");
  assert.deepEqual(importsOf("handlers/admin-feedback.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(/);
  assert.match(source, /^export function configure\(options\) \{\n  render = options\.render;\n\}$/m);
  assert.ok(importsOf("app.js").includes("handlers/admin-feedback.js"));
  assert.equal((read("frontend/app.js").match(/adminFeedbackHandlers\.configure\(/g) || []).length, 1);
  assert.match(read("frontend/app.js"), /^adminFeedbackHandlers\.configure\(\{ render \}\);$/m);
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/admin-feedback.js"'));
});

test("handlers/admin-feedback.js não conhece feedback próprio, attachments nem student-view", () => {
  const source = read("frontend/handlers/admin-feedback.js");
  for (const pattern of [/feedbackFiles|feedbackDraft|feedbackUpload|feedbackAttachments|feedbackCardUpload/, /pickImages|uploadImage|loadAttachments/, /enterStudentView|viewAsFromFeedback|canViewAsStudent/, /\bboot\b/])
    assert.doesNotMatch(source, pattern);
});

test("app.js não guarda mais a listagem de Admin Feedback nem chama a API de admin/feedback direto", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/\badminFeedbackRequest\b/, /function loadAdminFeedback\b/, /api\.adminFeedback\.(list|setStatus)\(/])
    assert.doesNotMatch(app, pattern);
  for (const kept of ["async function viewAsFromFeedback(", "await exitStudentView(", "loadAttachments(", "$(\"#fb-detail-title\")", "$(\"#fb-status-select\").value", "async function busy("])
    assert.ok(app.includes(kept), kept);
});

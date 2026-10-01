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
const feedbackHandlers = await import("../frontend/handlers/feedback.js");
const feedbackPageModule = await import("../frontend/pages/feedback.js");
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
  const files = [...CONSUMERS, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js"];
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

// Corpo do bloco { … } que começa depois do primeiro trecho que casa com o padrão (ignora chaves em strings).
function blockAfter(source, pattern) {
  const found = source.match(pattern);
  assert.ok(found, `bloco não encontrado: ${pattern}`);
  const open = source.indexOf("{", found.index + found[0].length);
  let depth = 0, quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  assert.fail(`bloco sem fechamento: ${pattern}`);
}

// fbOpen: o detalhe do admin é composto em app.js (seleção pelo handler de Admin Feedback, foco no DOM e
// galeria pelo handler de Feedback). Os handlers não se conhecem.
test("fbOpen: app.js compõe o detalhe do admin com feedbackHandlers.loadAttachments; só o handler de Feedback implementa a galeria", () => {
  const app = read("frontend/app.js");
  const open = blockAfter(app, /if\s*\(\s*button\.dataset\.fbOpen\s*\)/);
  const steps = [
    /\badminFeedbackHandlers\.select\(\s*button\.dataset\.fbOpen\s*\)/,
    /\$\(\s*"#fb-detail-title"\s*\)\?\.focus\(\s*\)/,
    /\bif\s*\(\s*opened\?\.attachments\s*\)\s*busy\(\s*null\s*,\s*\(\)\s*=>\s*feedbackHandlers\.loadAttachments\(\s*opened\.id\s*\)/,
  ];
  const at = steps.map((step) => open.search(step));
  assert.ok(at.every((i) => i >= 0), `fbOpen sem seleção, foco ou galeria: ${JSON.stringify(at)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "fbOpen fora de ordem: seleção, foco, galeria");
  // Nenhuma implementação nem chamada local: todo loadAttachments do app.js passa pelo handler de Feedback.
  assert.doesNotMatch(app, /(?<!feedbackHandlers\.)\bloadAttachments\b/);
  // Uma única implementação, exportada pelo handler de Feedback.
  const modules = ["app.js", ...PAGES, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js"];
  assert.deepEqual(modules.filter((file) => /\bfunction\s+loadAttachments\b|\bloadAttachments\s*=/.test(read(`frontend/${file}`))), ["handlers/feedback.js"]);
  assert.match(read("frontend/handlers/feedback.js"), /^export async function loadAttachments\(/m);
  assert.equal(typeof feedbackHandlers.loadAttachments, "function");
  // O handler de Admin Feedback não importa nem chama anexos.
  assert.ok(!importsOf("handlers/admin-feedback.js").includes("handlers/feedback.js"));
  assert.doesNotMatch(read("frontend/handlers/admin-feedback.js"), /\bfeedbackHandlers\b|\bloadAttachments\b|\bapi\.feedback\./);
  assert.equal(adminFeedbackHandlers.loadAttachments, undefined);
});

test("app.js não guarda mais a listagem de Admin Feedback nem chama a API de admin/feedback direto", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/\badminFeedbackRequest\b/, /function loadAdminFeedback\b/, /api\.adminFeedback\.(list|setStatus)\(/])
    assert.doesNotMatch(app, pattern);
  for (const kept of ["async function viewAsFromFeedback(", "await exitStudentView(", "$(\"#fb-detail-title\")", "$(\"#fb-status-select\").value", "async function busy("])
    assert.ok(app.includes(kept), kept);
});

// Feedback próprio e anexos: "Meus feedbacks", envio, imagens escolhidas, envio ao S3 e galeria fora de
// app.js. O seletor de arquivos, os listeners, o busy, a navegação e o boot continuam lá.
test("handlers/feedback.js importa só api, state e ui, não registra listeners nem toca no DOM, e entra no build", () => {
  const source = read("frontend/handlers/feedback.js");
  assert.deepEqual(importsOf("handlers/feedback.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(|\bimagePicker\b|\bpickerTarget\b/);
  assert.match(source, /^export function configure\(options\) \{\n  render = options\.render;\n\}$/m);
  const app = read("frontend/app.js");
  assert.ok(importsOf("app.js").includes("handlers/feedback.js"));
  assert.equal((app.match(/\bfeedbackHandlers\.configure\(/g) || []).length, 1);
  assert.match(app, /^feedbackHandlers\.configure\(\{ render \}\);$/m);
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/feedback.js"'));
});

test("handlers/feedback.js expõe só a API do domínio; validação, envio e prévias continuam internos", () => {
  assert.deepEqual(Object.keys(feedbackHandlers).sort(), ["ATTACHMENT_MAX_BYTES", "ATTACHMENT_SLOTS", "ATTACHMENT_TYPES", "addPickedImages",
    "closeAttachments", "configure", "discardUploads", "loadAttachments", "loadMine", "removeFile", "retryUploads", "submit"]);
  const source = read("frontend/handlers/feedback.js");
  for (const pattern of [/adminFeedback/, /enterStudentView|exitStudentView|viewAsFromFeedback|studentView/, /\bboot\b/, /\bbusy\s*\(/, /toggleAttachments/])
    assert.doesNotMatch(source, pattern);
});

test("ATTACHMENT_* têm uma única definição (handlers/feedback.js); a página importa, usa e reexporta o mesmo binding", () => {
  const files = ["app.js", ...PAGES, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js"];
  for (const name of ["ATTACHMENT_TYPES", "ATTACHMENT_MAX_BYTES", "ATTACHMENT_SLOTS"]) {
    const defined = files.filter((file) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(read(`frontend/${file}`)));
    assert.deepEqual(defined, ["handlers/feedback.js"], name);
    assert.equal(feedbackPageModule[name], feedbackHandlers[name], name);
  }
  assert.deepEqual(feedbackHandlers.ATTACHMENT_TYPES, ["image/png", "image/jpeg", "image/webp"]);
  assert.equal(feedbackHandlers.ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(feedbackHandlers.ATTACHMENT_SLOTS, 3);
  const page = read("frontend/pages/feedback.js");
  assert.match(page, /^import \{ ATTACHMENT_MAX_BYTES, ATTACHMENT_SLOTS, ATTACHMENT_TYPES \} from "\.\.\/handlers\/feedback\.js";$/m);
  // Compatibilidade de cache: um app.js anterior importa as constantes desta página.
  assert.match(page, /^export \{ ATTACHMENT_MAX_BYTES, ATTACHMENT_SLOTS, ATTACHMENT_TYPES \};$/m);
  assert.deepEqual(importsOf("pages/feedback.js").sort(), ["handlers/feedback.js", "state.js", "ui.js"]);
  // O app.js novo lê as constantes pelo handler, nunca pela página.
  const app = read("frontend/app.js");
  assert.match(app, /^import \{ DESCRIPTION_MAX, TITLE_MAX, feedbackPage \} from "\.\/pages\/feedback\.js";$/m);
  assert.doesNotMatch(app, /(?<!\.)ATTACHMENT_(TYPES|MAX_BYTES|SLOTS)/);
  assert.ok(app.includes('accept: feedbackHandlers.ATTACHMENT_TYPES.join(",")'));
});

test("app.js não guarda mais o feedback próprio nem os anexos, mas mantém o seletor, os listeners e a composição", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/\bloadMyFeedback\b/, /function (pickImages|releaseFiles|uploadImages?|sendFormImages|loadAttachments|addPickedImages)\b/,
    /\bapi\.feedback\.|\bapi\.uploadAttachmentToS3\b/, /previewUrl/])
    assert.doesNotMatch(app, pattern);
  for (const kept of ['const imagePicker = Object.assign(document.createElement("input")', "document.body.append(imagePicker);", "let pickerTarget = null;",
    'imagePicker.value = "";', "busy(null, () => feedbackHandlers.addPickedImages(pickerTarget, files))",
    // Fechar a galeria continua fora do busy; só abrir (carregar) passa por ele.
    "if (state.feedbackAttachments[id]?.open) feedbackHandlers.closeAttachments(id);\n    else busy(button, () => feedbackHandlers.loadAttachments(id));",
    'if (id === "fb-title" || id === "fb-description")', 'if (target.name === "fb-type") state.feedbackDraft.type = target.value;',
    "async function viewAsFromFeedback(", "async function busy("])
    assert.ok(app.includes(kept), kept);
  assert.equal((app.match(/imagePicker\.addEventListener\(/g) || []).length, 1);
});

// Fechar a galeria é síncrono: um render, sem Promise, e lista e links continuam guardados.
test("closeAttachments fecha sem Promise, com um render, e mantém items e urls", () => {
  const saved = direct.feedbackAttachments;
  let renders = 0;
  feedbackHandlers.configure({ render: () => { renders++; } });
  try {
    const items = [{ attachmentId: "a1" }], urls = { a1: "https://arquivos.example.test/a1" };
    direct.feedbackAttachments = { f1: { open: true, loading: false, error: "", items, urls } };
    assert.equal(feedbackHandlers.closeAttachments("f1"), undefined);
    assert.equal(renders, 1);
    assert.equal(direct.feedbackAttachments.f1.open, false);
    assert.equal(direct.feedbackAttachments.f1.items, items);
    assert.equal(direct.feedbackAttachments.f1.urls, urls);
  } finally {
    feedbackHandlers.configure({ render: null });
    direct.feedbackAttachments = saved;
  }
});

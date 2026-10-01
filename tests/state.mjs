// Estado compartilhado (frontend/state.js): contrato inicial e referência única entre módulos.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const ui = await import("../frontend/ui.js");
const { historyPage } = await import("../frontend/pages/history.js");
const importHandlers = await import("../frontend/handlers/import.js");
const adminFeedbackHandlers = await import("../frontend/handlers/admin-feedback.js");
const feedbackHandlers = await import("../frontend/handlers/feedback.js");
const remindersHandlers = await import("../frontend/handlers/reminders.js");
const apiModule = await import("../frontend/api.js");
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

// state tem uma única fonte, state.js. ui.js só o usa internamente: o reexport de compatibilidade de cache
// saiu na C6.1, quando nem os módulos atuais nem o app.js publicado antes dela o importavam de ui.js.
test("state vem só de state.js: ui.js, api.js, as páginas e os handlers não o exportam", async () => {
  const modules = ["ui.js", "api.js", ...PAGES, ...["access", "import", "admin-feedback", "feedback", "reminders"].map((name) => `handlers/${name}.js`)];
  for (const file of modules) assert.equal("state" in (await import(`../frontend/${file}`)), false, file);
  assert.ok("state" in (await import("../frontend/state.js")));
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

test("blockedByIntegrity mora só em handlers/import.js; pages/import.js a importa e usa, sem reexportar", () => {
  assert.match(read("frontend/handlers/import.js"), /^export function blockedByIntegrity\(p\) \{\n  return !!p\?\.integrity\?\.critical\?\.length;\n\}$/m);
  const page = read("frontend/pages/import.js");
  assert.doesNotMatch(page, /function blockedByIntegrity|blockedByIntegrity\s*=|integrity\?\.critical\?\.length/);
  assert.match(page, /^import \{ blockedByIntegrity \} from "\.\.\/handlers\/import\.js";$/m);
  assert.deepEqual(importsOf("pages/import.js").sort(), ["handlers/import.js", "state.js", "ui.js"]);
  assert.equal(importHandlers.blockedByIntegrity({ integrity: { critical: [{}] } }), true);
  assert.equal(importHandlers.blockedByIntegrity({ integrity: { critical: [] } }), false);
  assert.equal(importHandlers.blockedByIntegrity(null), false);
  // O reexport de compatibilidade de cache saiu na C6.1: a página não exporta mais o binding.
  assert.equal("blockedByIntegrity" in importPageModule, false);
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

test("ATTACHMENT_* têm uma única definição (handlers/feedback.js); a página importa e usa, sem reexportar", () => {
  const files = ["app.js", ...PAGES, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js"];
  for (const name of ["ATTACHMENT_TYPES", "ATTACHMENT_MAX_BYTES", "ATTACHMENT_SLOTS"]) {
    const defined = files.filter((file) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(read(`frontend/${file}`)));
    assert.deepEqual(defined, ["handlers/feedback.js"], name);
    // O reexport de compatibilidade de cache saiu na C6.1: a página não exporta mais as constantes.
    assert.equal(name in feedbackPageModule, false, name);
  }
  assert.deepEqual(feedbackHandlers.ATTACHMENT_TYPES, ["image/png", "image/jpeg", "image/webp"]);
  assert.equal(feedbackHandlers.ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(feedbackHandlers.ATTACHMENT_SLOTS, 3);
  const page = read("frontend/pages/feedback.js");
  assert.match(page, /^import \{ ATTACHMENT_MAX_BYTES, ATTACHMENT_SLOTS, ATTACHMENT_TYPES \} from "\.\.\/handlers\/feedback\.js";$/m);
  assert.deepEqual(importsOf("pages/feedback.js").sort(), ["handlers/feedback.js", "state.js", "ui.js"]);
  // O app.js lê as constantes pelo handler, nunca pela página.
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

// Lembretes: prévias, envios, remetente e cópia fora de app.js. Listeners, busy, boot, a navegação global
// (inclusive "Voltar ao painel", que restaura teacherFilters) e as páginas continuam lá.
// Código sem as linhas de comentário, para os padrões não casarem com a documentação do módulo.
const codeOf = (file) => read(`frontend/${file}`).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
const HANDLERS = ["access", "import", "admin-feedback", "feedback", "reminders"].map((name) => `handlers/${name}.js`);

test("handlers/reminders.js importa só api, state e ui, não registra listeners nem toca no DOM, e entra no build", () => {
  const source = codeOf("handlers/reminders.js");
  assert.deepEqual(importsOf("handlers/reminders.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(/);
  assert.match(source, /^export function configure\(options\) \{\n  render = options\.render;\n\}$/m);
  const app = read("frontend/app.js");
  assert.ok(importsOf("app.js").includes("handlers/reminders.js"));
  assert.equal((app.match(/\bremindersHandlers\.configure\(/g) || []).length, 1);
  assert.match(app, /^remindersHandlers\.configure\(\{ render \}\);$/m);
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/reminders.js"'));
  // Só app.js importa o handler: nenhuma página, nenhum outro handler, nem ui/api/state.
  for (const file of [...PAGES, "ui.js", "api.js", "state.js", ...HANDLERS])
    assert.ok(!importsOf(file).includes("handlers/reminders.js"), file);
});

test("handlers/reminders.js expõe só as operações do domínio e não conhece busy, boot, navegação global, sessão nem student-view", () => {
  assert.deepEqual(Object.keys(remindersHandlers).sort(), ["configure", "copyReminder", "loadBatchPreview", "loadPending", "loadSender",
    "openBatch", "sendBatch", "sendReminder", "verifySender"]);
  const source = codeOf("handlers/reminders.js");
  for (const pattern of [/\bbusy\b/, /\bboot\b/, /\bstart\s*\(/, /studentView|allowedWhileViewing/, /\blocation\b|\bhistory\b|localStorage|sessionStorage/,
    /\blogin\b|\blogout\b|\bsession\b|auth\.js/, /Object\.assign\(\s*state\s*,\s*state\.teacherFilters\s*\)/])
    assert.doesNotMatch(source, pattern);
});

test("app.js não implementa mais Lembretes: as actions, o clique, a navegação e o boot só chamam o handler", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/function\s+(loadPending|loadBatchPreview|loadSender)\b/, /\bbatchPreviewRequest\b/, /\bapi\.reminders\./, /navigator\.clipboard/,
    /Enviar lembrete para \$\{|Enviar este lembrete para/, /Mensagem copiada\.|Envio em lote concluído|Mensagem aceita pelo serviço|Confira a mensagem de verificação/])
    assert.doesNotMatch(app, pattern);
  // Nenhuma chamada local a operações de Lembretes: todas passam por remindersHandlers.
  assert.doesNotMatch(app, /(?<![\w.$])(loadPending|loadBatchPreview|loadSender|openBatch|sendBatch|sendReminder|verifySender|copyReminder)\s*\(/);
  // Actions de Lembretes: um wrapper síncrono que devolve a Promise do handler (sem async/await extra).
  const actions = blockAfter(app, /\bconst actions\s*=/);
  const wrappers = {
    "retry-pending": /"retry-pending":\s*\(\)\s*=>\s*remindersHandlers\.loadPending\(\s*state\.pendingStudentId\s*\)\s*,/,
    "retry-batch-preview": /"retry-batch-preview":\s*\(\)\s*=>\s*remindersHandlers\.loadBatchPreview\(\s*\)\s*,/,
    "reminders-batch": /"reminders-batch":\s*\(button\)\s*=>\s*remindersHandlers\.openBatch\(\s*button\.dataset\.ids\s*\)\s*,/,
    "send-reminders-batch": /"send-reminders-batch":\s*\(\)\s*=>\s*remindersHandlers\.sendBatch\(\s*\)\s*,/,
    "copy-reminder": /"copy-reminder":\s*\(\)\s*=>\s*remindersHandlers\.copyReminder\(\s*\)\s*,/,
    "refresh-sender": /"refresh-sender":\s*\(\)\s*=>\s*remindersHandlers\.loadSender\(\s*\)\s*,/,
    "verify-sender": /"verify-sender":\s*\(\)\s*=>\s*remindersHandlers\.verifySender\(\s*\)\s*,/,
    "send-reminder": /"send-reminder":\s*\(\)\s*=>\s*remindersHandlers\.sendReminder\(\s*\)\s*,/,
  };
  for (const [key, wrapper] of Object.entries(wrappers)) assert.match(actions, wrapper, key);
  assert.equal((actions.match(/\bremindersHandlers\./g) || []).length, Object.keys(wrappers).length);
  // Clique do painel, menu "Lembretes" e boot: o mesmo ponto de busy/await de antes, agora pelo handler.
  assert.match(app, /if\s*\(\s*button\.dataset\.studentPending\s*\)\s*return\s+busy\(\s*button\s*,\s*\(\)\s*=>\s*remindersHandlers\.loadPending\(\s*button\.dataset\.studentPending\s*\)\s*\);/);
  assert.match(app, /else\s+if\s*\(\s*state\.view\s*===\s*"reminders"\s*\)\s*busy\(\s*button\s*,\s*remindersHandlers\.loadSender\s*\);/);
  assert.match(app, /if\s*\(\s*state\.view\s*===\s*"reminders"\s*&&\s*teacher\(\)\s*\)\s*await\s+remindersHandlers\.loadSender\(\s*\);/);
  assert.equal((app.match(/\bremindersHandlers\./g) || []).length, Object.keys(wrappers).length + 4);
  // Continuam em app.js: actions, listeners, busy, boot, roteamento e a navegação global com teacherFilters.
  for (const kept of ["const actions = {", "async function busy(", "async function boot()", "function allowedWhileViewing(",
    'document.addEventListener("click"', 'document.addEventListener("change"', 'document.addEventListener("input"', 'document.addEventListener("submit"',
    "if (button.dataset.view) {", "if (returning && state.teacherFilters) Object.assign(state, state.teacherFilters);",
    'if (state.view === "student-pending" && teacher()) return pendingPage();', 'if (state.view === "reminders-batch" && teacher()) return batchPage();',
    'if (state.view === "reminders" && teacher()) return senderPage();'])
    assert.ok(app.includes(kept), kept);
});

test("batchPreviewRequest mora só no handler de Lembretes, incrementado antes de qualquer efeito da prévia em lote", () => {
  const handler = codeOf("handlers/reminders.js");
  assert.match(handler, /^let batchPreviewRequest = 0;$/m);
  for (const file of ["app.js", "state.js", "ui.js", "api.js", ...PAGES, ...HANDLERS.filter((h) => h !== "handlers/reminders.js")])
    assert.doesNotMatch(read(`frontend/${file}`), /batchPreviewRequest/, file);
  assert.ok(!("batchPreviewRequest" in direct));
  assert.equal(remindersHandlers.batchPreviewRequest, undefined);
  const body = blockAfter(handler, /export async function loadBatchPreview\(\)/);
  const order = ["const code = state.code;", "const request = ++batchPreviewRequest;", 'state.batchError = "";', "render();", "await api.reminders.batchPreview("];
  const at = order.map((step) => body.indexOf(step));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.equal((body.match(/\+\+batchPreviewRequest/g) || []).length, 1);
  assert.equal((body.match(/if \(request === batchPreviewRequest && state\.code === code && state\.view === "reminders-batch"\) \{/g) || []).length, 2);
});

// Duas chamadas seguidas, sem navegador: só a mais recente aplica sucesso ou erro. O cenário completo
// (A1 → B → A2, com DOM e renders) fica na suíte de navegador.
test("loadBatchPreview: a chamada antiga que termina por último não aplica sucesso nem erro", async () => {
  const keys = ["code", "view", "batchIds", "batchPreview", "batchError", "batchResults"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  const calls = [];
  let renders = 0;
  apiModule.setTransport((path, options) => new Promise((resolve, reject) => calls.push({ path, body: options.body, resolve, reject })));
  remindersHandlers.configure({ render: () => { renders++; } });
  try {
    Object.assign(direct, { code: "BRSA0001", view: "reminders-batch", batchIds: ["1", "2"] });
    const older = remindersHandlers.loadBatchPreview();
    direct.batchIds = ["1"];
    const newer = remindersHandlers.loadBatchPreview();
    assert.deepEqual(calls.map((c) => [c.path, c.body]), [["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1", "2"] }],
      ["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1"] }]]);
    assert.equal(renders, 2);
    calls[1].resolve({ recipients: [{ id: "1" }] });
    await newer;
    calls[0].resolve({ recipients: [{ id: "1" }, { id: "2" }] });
    await older;
    assert.deepEqual([direct.batchPreview, direct.batchError, direct.batchResults, renders], [{ recipients: [{ id: "1" }] }, "", null, 3]);
    const olderFail = remindersHandlers.loadBatchPreview();
    const newerFail = remindersHandlers.loadBatchPreview();
    calls[3].reject(new Error("Falha da chamada atual."));
    await newerFail;
    calls[2].reject(new Error("Falha da chamada antiga."));
    await olderFail;
    assert.deepEqual([direct.batchPreview, direct.batchError, renders], [null, "Falha da chamada atual.", 6]);
  } finally {
    remindersHandlers.configure({ render: null });
    apiModule.setTransport(() => { throw new Error("Sem rede nos testes de state."); });
    Object.assign(direct, saved);
  }
});

// Actions do app.js pelas propriedades reais do objeto: o V8 avalia só o literal (nenhuma action roda),
// então chaves com e sem aspas contam igual.
function actionKeys() {
  const app = read("frontend/app.js"), marker = "const actions = ";
  assert.ok(app.includes(marker), "objeto actions não encontrado no app.js");
  const start = app.indexOf(marker) + marker.length;
  for (let end = app.indexOf("}", start); end >= 0; end = app.indexOf("}", end + 1)) {
    try { return Object.keys(vm.runInNewContext(`(${app.slice(start, end + 1)})`, Object.create(null))); }
    catch { /* literal ainda incompleto: segue até a chave que fecha o objeto */ }
  }
  assert.fail("objeto actions sem fechamento no app.js");
}

// class-grades nunca teve gatilho (nenhum data-action) e saiu na C6.1. O relatório da turma continua por
// ?turma= (start → loadClassReport) e pelos botões class-refresh e class-exit da própria tela.
test("a action morta class-grades saiu; class-refresh e class-exit continuam", () => {
  const keys = actionKeys();
  assert.equal(keys.includes("class-grades"), false);
  assert.ok(keys.includes("class-refresh") && keys.includes("class-exit"), JSON.stringify(keys));
});

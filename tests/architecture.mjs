// Arquitetura estática do frontend: imports e fronteiras dos módulos, composição no app.js, build, actions e
// contratos de export. Lê o código-fonte e importa módulos sem DOM; não executa o app.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const importHandlers = await import("../frontend/handlers/import.js");
const adminFeedbackHandlers = await import("../frontend/handlers/admin-feedback.js");
const feedbackHandlers = await import("../frontend/handlers/feedback.js");
const remindersHandlers = await import("../frontend/handlers/reminders.js");
const feedbackPageModule = await import("../frontend/pages/feedback.js");
const importPageModule = await import("../frontend/pages/import.js");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const PAGES = ["access", "activities-overview", "admin-feedback", "class-report", "feedback", "history",
  "import", "landing", "reminders", "student", "teacher"].map((page) => `pages/${page}.js`);
const CONSUMERS = ["app.js", ...PAGES];
const HANDLER_NAMES = ["access", "import", "admin-feedback", "feedback", "reminders"];
const HANDLERS = HANDLER_NAMES.map((name) => `handlers/${name}.js`);

// Imports estáticos e dinâmicos de um módulo do frontend, resolvidos como caminhos relativos a frontend/.
function importsOf(file) {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return [...read(`frontend/${file}`).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)["'](\.[^"']+)["']/gm)]
    .map(([, spec]) => new URL(spec, `file:///${dir}`).pathname.slice(1));
}

// Imports nomeados estáticos, por módulo de origem (Map "handlers/x.js" → Set de nomes). Aceita uma ou várias
// linhas, qualquer ordem e vírgula final; compara conjuntos, nunca o texto da linha.
function namedImports(file) {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  const byModule = new Map();
  for (const [, names, spec] of read(`frontend/${file}`).matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gm)) {
    const from = new URL(spec, `file:///${dir}`).pathname.slice(1);
    const set = byModule.get(from) || new Set();
    for (const part of names.split(",").map((name) => name.trim()).filter(Boolean)) set.add(part.split(/\s+as\s+/)[0]);
    byModule.set(from, set);
  }
  return byModule;
}

// Código sem comentários (// e /* */), preservando strings, templates e quebras de linha: um comentário que cite
// "boot" ou "document" não é uso. Os módulos checados não têm "//" nem aspas dentro de regex literais.
function stripComments(source) {
  let out = "", quote = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") out += source[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2), stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, "");
      i = stop - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}
const codeOf = (file) => stripComments(read(`frontend/${file}`));

// state tem uma única fonte, state.js. ui.js só o usa internamente: o reexport de compatibilidade de cache
// saiu na C6.1, quando nem os módulos atuais nem o app.js publicado antes dela o importavam de ui.js.
test("state vem só de state.js: ui.js, api.js, as páginas e os handlers não o exportam", async () => {
  const modules = ["ui.js", "api.js", ...PAGES, ...["access", "import", "admin-feedback", "feedback", "reminders"].map((name) => `handlers/${name}.js`)];
  for (const file of modules) assert.equal("state" in (await import(`../frontend/${file}`)), false, file);
  assert.ok("state" in (await import("../frontend/state.js")));
});

test("app.js e as 11 páginas importam state direto de state.js, e nenhum de ui.js", () => {
  for (const file of CONSUMERS) {
    const imports = namedImports(file);
    const withState = [...imports].filter(([, names]) => names.has("state")).map(([from]) => from);
    assert.deepEqual(withState, ["state.js"], file);
    assert.deepEqual([...imports.get("state.js")], ["state"], file);
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

// Injeção nos handlers: configure recebe um objeto e só guarda render. Tolerante a espaços, tabs, quebras de
// linha, ponto e vírgula e vírgula final; qualquer outra dependência configurável falha.
test("cada um dos 5 handlers expõe configure que só guarda render", async () => {
  for (const file of HANDLERS) {
    const module = await import(`../frontend/${file}`), code = codeOf(file);
    // Sanidade do código sem comentários: nenhum export some ao tirar os comentários.
    for (const name of Object.keys(module)) assert.match(code, new RegExp(`\\b${name}\\b`), `${file}: ${name}`);
    assert.equal(typeof module.configure, "function", file);
    const signature = code.match(/export\s+function\s+configure\s*\(\s*(\w+)\s*,?\s*\)\s*\{/);
    assert.ok(signature, `${file}: export function configure(options) não encontrado`);
    const body = blockAfter(code, /export\s+function\s+configure\s*\(/).replace(/\s+/g, "").replace(/;$/, "");
    assert.equal(body, `render=${signature[1]}.render`, `${file}: configure deve só guardar render`);
    assert.match(code, /\blet\s+render\b/, `${file}: render do módulo`);
    assert.equal((code.match(/\bconfigure\b/g) || []).length, 1, `${file}: configure definido uma vez e não chamado internamente`);
  }
});

test("app.js configura cada um dos 5 handlers exatamente uma vez, só com { render }", () => {
  const app = read("frontend/app.js");
  const namespaces = new Map([...app.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s+["']\.\/handlers\/([\w-]+)\.js["']/gm)].map(([, ns, name]) => [name, ns]));
  assert.deepEqual([...namespaces.keys()].sort(), [...HANDLER_NAMES].sort());
  const calls = [...app.matchAll(/\b(\w+)\.configure\s*\(([^)]*)\)/g)].map(([, ns, args]) => ({ ns, args: args.replace(/\s+/g, "").replace(/,(?=\})/, "") }));
  for (const ns of namespaces.values()) {
    const own = calls.filter((call) => call.ns === ns);
    assert.equal(own.length, 1, `${ns}.configure deve aparecer exatamente uma vez`);
    assert.equal(own[0].args, "{render}", `${ns}.configure deve receber só { render }`);
  }
  assert.equal(calls.filter((call) => [...namespaces.values()].includes(call.ns)).length, HANDLER_NAMES.length);
});

// Turmas e acessos: orquestração fora de app.js, sem voltar a depender dele nem registrar listeners.
test("handlers/access.js importa só api, state e ui, não registra listeners e entra no build", () => {
  assert.deepEqual(importsOf("handlers/access.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(codeOf("handlers/access.js"), /addEventListener/);
  assert.ok(importsOf("app.js").includes("handlers/access.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/access.js"'));
  assert.deepEqual(importsOf("state.js"), []);
});

// Importação: rascunhos, CSV, prévia e publicação fora de app.js. Listeners, busy, boot, saída e
// restauração de publicação continuam lá.
test("handlers/import.js importa só api, state e ui, não registra listeners e entra no build", () => {
  const source = codeOf("handlers/import.js");
  assert.deepEqual(importsOf("handlers/import.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener/);
  assert.ok(importsOf("app.js").includes("handlers/import.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/import.js"'));
});

test("blockedByIntegrity mora só em handlers/import.js; pages/import.js a importa e usa, sem reexportar", () => {
  // Uma única definição em todo o frontend, no handler; o comportamento é conferido abaixo, sem o texto da função.
  const defined = ["app.js", "ui.js", "api.js", ...PAGES, ...HANDLERS]
    .filter((file) => /\bfunction\s+blockedByIntegrity\b|\bblockedByIntegrity\s*=/.test(read(`frontend/${file}`)));
  assert.deepEqual(defined, ["handlers/import.js"]);
  assert.equal(typeof importHandlers.blockedByIntegrity, "function");
  const page = read("frontend/pages/import.js");
  assert.doesNotMatch(page, /integrity\?\.critical\?\.length/);
  assert.ok(namedImports("pages/import.js").get("handlers/import.js")?.has("blockedByIntegrity"));
  assert.match(page, /\bblockedByIntegrity\s*\(/);
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

// Admin Feedback: listagem, filtros, paginação e status fora de app.js. Attachments, feedback
// próprio, listeners, busy, foco de DOM e "visualizar como aluno" continuam lá.
test("handlers/admin-feedback.js importa só api, state e ui, não registra listeners e entra no build", () => {
  const source = codeOf("handlers/admin-feedback.js");
  assert.deepEqual(importsOf("handlers/admin-feedback.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(/);
  assert.ok(importsOf("app.js").includes("handlers/admin-feedback.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/admin-feedback.js"'));
});

// Código sem comentários: citar "boot" num comentário não é uso; chamar ou referenciar boot é.
test("handlers/admin-feedback.js não conhece feedback próprio, attachments nem student-view", () => {
  const source = codeOf("handlers/admin-feedback.js");
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
  const source = codeOf("handlers/feedback.js");
  assert.deepEqual(importsOf("handlers/feedback.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(|\bimagePicker\b|\bpickerTarget\b/);
  assert.ok(importsOf("app.js").includes("handlers/feedback.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/feedback.js"'));
});

test("handlers/feedback.js expõe só a API do domínio; validação, envio e prévias continuam internos", () => {
  assert.deepEqual(Object.keys(feedbackHandlers).sort(), ["ATTACHMENT_MAX_BYTES", "ATTACHMENT_SLOTS", "ATTACHMENT_TYPES", "addPickedImages",
    "closeAttachments", "configure", "discardUploads", "loadAttachments", "loadMine", "removeFile", "retryUploads", "submit"]);
  const source = codeOf("handlers/feedback.js");
  for (const pattern of [/adminFeedback/, /enterStudentView|exitStudentView|viewAsFromFeedback|studentView/, /\bboot\b/, /\bbusy\s*\(/, /toggleAttachments/])
    assert.doesNotMatch(source, pattern);
});

test("ATTACHMENT_* têm uma única definição (handlers/feedback.js); a página usa só o que importa do handler, sem reexportar", () => {
  const files = ["app.js", ...PAGES, "ui.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "handlers/feedback.js"];
  const ATTACHMENT = ["ATTACHMENT_TYPES", "ATTACHMENT_MAX_BYTES", "ATTACHMENT_SLOTS"];
  for (const name of ATTACHMENT) {
    const defined = files.filter((file) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(read(`frontend/${file}`)));
    assert.deepEqual(defined, ["handlers/feedback.js"], name);
    // O reexport de compatibilidade de cache saiu na C6.1: a página não exporta mais as constantes.
    assert.equal(name in feedbackPageModule, false, name);
  }
  assert.deepEqual(feedbackHandlers.ATTACHMENT_TYPES, ["image/png", "image/jpeg", "image/webp"]);
  assert.equal(feedbackHandlers.ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(feedbackHandlers.ATTACHMENT_SLOTS, 3);
  // A página usa só constantes importadas do handler. Não exige as que ela importa sem usar (backlog), para que
  // a futura remoção desses imports não precise mexer neste teste.
  const pageUses = read("frontend/pages/feedback.js").replace(/^\s*import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/gm, "");
  const fromHandler = namedImports("pages/feedback.js").get("handlers/feedback.js") || new Set();
  for (const name of ATTACHMENT.filter((n) => new RegExp(`\\b${n}\\b`).test(pageUses)))
    assert.ok(fromHandler.has(name), `pages/feedback.js usa ${name} sem importar de handlers/feedback.js`);
  assert.deepEqual(importsOf("pages/feedback.js").sort(), ["handlers/feedback.js", "state.js", "ui.js"]);
  // O app.js lê as constantes pelo handler, nunca pela página: da página vêm só a tela e os limites de texto.
  const app = read("frontend/app.js");
  const fromPage = namedImports("app.js").get("pages/feedback.js") || new Set();
  for (const required of ["feedbackPage", "DESCRIPTION_MAX", "TITLE_MAX"]) assert.ok(fromPage.has(required), `app.js não importa ${required} da página`);
  for (const name of ATTACHMENT) assert.equal(fromPage.has(name), false, `app.js importa ${name} da página`);
  assert.doesNotMatch(app, /(?<!\.)ATTACHMENT_(TYPES|MAX_BYTES|SLOTS)/);
  assert.match(app, /accept:\s*feedbackHandlers\.ATTACHMENT_TYPES\.join\(/);
});

test("app.js não guarda mais o feedback próprio nem os anexos, mas mantém o seletor, os listeners e a composição", () => {
  const app = read("frontend/app.js");
  for (const pattern of [/\bloadMyFeedback\b/, /function (pickImages|releaseFiles|uploadImages?|sendFormImages|loadAttachments|addPickedImages)\b/,
    /\bapi\.feedback\.|\bapi\.uploadAttachmentToS3\b/, /previewUrl/])
    assert.doesNotMatch(app, pattern);
  for (const kept of ['const imagePicker = Object.assign(document.createElement("input")', "document.body.append(imagePicker);", "let pickerTarget = null;",
    'imagePicker.value = "";', "busy(null, () => feedbackHandlers.addPickedImages(pickerTarget, files))",
    'if (id === "fb-title" || id === "fb-description")', 'if (target.name === "fb-type") state.feedbackDraft.type = target.value;',
    "async function viewAsFromFeedback(", "async function busy("])
    assert.ok(app.includes(kept), kept);
  // Fechar a galeria continua fora do busy; só abrir (carregar) passa por ele. Sem espaços, a checagem aceita
  // qualquer quebra de linha e chaves opcionais nos dois ramos.
  const toggle = blockAfter(app, /if\s*\(\s*button\.dataset\.fbToggleAttachments\s*\)/).replace(/\s+/g, "");
  assert.match(toggle, /if\(state\.feedbackAttachments\[id\]\?\.open\)\{?feedbackHandlers\.closeAttachments\(id\);?\}?else\{?busy\(button,\(\)=>feedbackHandlers\.loadAttachments\(id\)\);?\}?/);
  assert.doesNotMatch(toggle, /busy\([^;]*closeAttachments/);
  assert.equal((toggle.match(/closeAttachments\(/g) || []).length, 1);
  assert.equal((app.match(/imagePicker\.addEventListener\(/g) || []).length, 1);
});

// Lembretes: prévias, envios, remetente e cópia fora de app.js. Listeners, busy, boot, a navegação global
// (inclusive "Voltar ao painel", que restaura teacherFilters) e as páginas continuam lá.
test("handlers/reminders.js importa só api, state e ui, não registra listeners nem toca no DOM, e entra no build", () => {
  const source = codeOf("handlers/reminders.js");
  assert.deepEqual(importsOf("handlers/reminders.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\$\(/);
  assert.ok(importsOf("app.js").includes("handlers/reminders.js"));
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
  assert.match(handler, /\blet\s+batchPreviewRequest\s*=\s*0\b/);
  for (const file of ["app.js", "state.js", "ui.js", "api.js", ...PAGES, ...HANDLERS.filter((h) => h !== "handlers/reminders.js")])
    assert.doesNotMatch(read(`frontend/${file}`), /batchPreviewRequest/, file);
  assert.ok(!("batchPreviewRequest" in direct));
  assert.equal(remindersHandlers.batchPreviewRequest, undefined);
  // A ordem é semântica (turma, contador, efeitos, request); a formatação não: compara o corpo sem espaços.
  const body = blockAfter(handler, /export\s+async\s+function\s+loadBatchPreview\s*\(\s*\)/).replace(/\s+/g, "");
  const order = ["constcode=state.code", "constrequest=++batchPreviewRequest", 'state.batchError=""', "render()", "awaitapi.reminders.batchPreview("];
  const at = order.map((step) => body.indexOf(step));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "fora de ordem: turma, contador, efeitos, request");
  assert.equal((body.match(/\+\+batchPreviewRequest/g) || []).length, 1);
  assert.equal((body.match(/if\(request===batchPreviewRequest&&state\.code===code&&state\.view==="reminders-batch"\)/g) || []).length, 2);
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

// Todo arquivo de teste de tests/ (só o nível de cima) roda em npm test ou em test:browser, sem depender da ordem
// dos scripts. Exceções: live_browser.mjs e live_readiness.mjs rodam à mão contra o ambiente publicado (smoke e
// verificação pós-deploy) e por isso ficam fora dos dois scripts.
test("package.json registra todo arquivo de teste: unitários em npm test, suítes de navegador em test:browser", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  const listed = (script) => script.match(/tests\/[\w.-]+\.mjs/g) || [];
  const unit = listed(scripts.test), browser = listed(scripts["test:browser"]);
  for (const list of [unit, browser]) assert.equal(new Set(list).size, list.length, `arquivo repetido: ${list.join(" ")}`);
  const MANUAL = ["live_browser.mjs", "live_readiness.mjs"];
  const files = readdirSync(new URL("../tests/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs")).map((entry) => entry.name);
  for (const name of MANUAL) assert.ok(files.includes(name), `exceção que não existe mais: ${name}`);
  const isBrowser = (name) => name === "browser.mjs" || name.endsWith("-browser.mjs");
  assert.deepEqual([...browser].sort(), files.filter(isBrowser).map((name) => `tests/${name}`).sort());
  assert.deepEqual([...unit].sort(), files.filter((name) => !isBrowser(name) && !MANUAL.includes(name)).map((name) => `tests/${name}`).sort());
});

// Toda action precisa de um gatilho real, para não repetir o class-grades: um data-action="…" no markup (app.js,
// ui.js, páginas, index.html) ou o botão "Tentar novamente" do errorPanel(mensagem, "action"). O único data-action
// montado dinamicamente é o do errorPanel; um novo data-action dinâmico exige rever este teste.
test("toda action do app.js tem gatilho: data-action no markup ou errorPanel", () => {
  const markup = ["app.js", "ui.js", ...PAGES].map((file) => read(`frontend/${file}`)).concat(read("frontend/index.html")).join("\n");
  const dynamic = [...markup.matchAll(/data-action=["']\$\{\s*([\w.]+)\s*\}["']/g)].map(([, expression]) => expression);
  assert.deepEqual(dynamic, ["action"], "data-action dinâmico fora do errorPanel");
  assert.match(read("frontend/ui.js"), /export\s+function\s+errorPanel\s*\(\s*\w+\s*,\s*action\s*\)/);
  const literal = new Set([...markup.matchAll(/data-action=["']([\w-]+)["']/g)].map(([, name]) => name));
  const viaErrorPanel = new Set([...markup.matchAll(/errorPanel\(\s*[^,()]+,\s*["']([\w-]+)["']\s*\)/g)].map(([, name]) => name));
  const withoutTrigger = actionKeys().filter((key) => !literal.has(key) && !viaErrorPanel.has(key));
  assert.deepEqual(withoutTrigger, [], `actions sem gatilho: ${withoutTrigger.join(", ")}`);
});

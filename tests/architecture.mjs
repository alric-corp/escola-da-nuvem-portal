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
const PAGES = ["access", "activities-overview", "admin-feedback", "class-report", "course-guide", "feedback", "history",
  "import", "landing", "reminders", "signup-confirmation", "student", "teacher"].map((page) => `pages/${page}.js`);
const CONSUMERS = ["app.js", ...PAGES];
const HANDLER_NAMES = ["access", "import", "admin-feedback", "feedback", "reminders", "signup-confirmation"];
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
  const modules = ["ui.js", "api.js", ...PAGES, ...HANDLERS];
  for (const file of modules) assert.equal("state" in (await import(`../frontend/${file}`)), false, file);
  assert.ok("state" in (await import("../frontend/state.js")));
});

test("app.js e as 13 páginas importam state direto de state.js, e nenhum de ui.js", () => {
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

// Injeção nos handlers: configure guarda render; C7.4 recebe também syncContext na composição. Tolerante a espaços, tabs, quebras de
// linha, ponto e vírgula e vírgula final; qualquer outra dependência configurável falha.
test("cada um dos 6 handlers expõe configure que guarda os callbacks aprovados", async () => {
  for (const file of HANDLERS) {
    const module = await import(`../frontend/${file}`), code = codeOf(file);
    // Sanidade do código sem comentários: nenhum export some ao tirar os comentários.
    for (const name of Object.keys(module)) assert.match(code, new RegExp(`\\b${name}\\b`), `${file}: ${name}`);
    assert.equal(typeof module.configure, "function", file);
    const signature = code.match(/export\s+function\s+configure\s*\(\s*(\w+)\s*,?\s*\)\s*\{/);
    assert.ok(signature, `${file}: export function configure(options) não encontrado`);
    const body = blockAfter(code, /export\s+function\s+configure\s*\(/).replace(/\s+/g, "").replace(/;$/, "");
    const contextAware = ["handlers/feedback.js", "handlers/reminders.js"].includes(file);
    assert.equal(body, `render=${signature[1]}.render` + (contextAware ? `;syncContext=${signature[1]}.syncContext||(()=>{})` : ""), `${file}: configure só guarda callbacks da composição`);
    assert.match(code, /\blet\s+render\b/, `${file}: render do módulo`);
    assert.equal((code.match(/\bconfigure\b/g) || []).length, 1, `${file}: configure definido uma vez e não chamado internamente`);
  }
});

test("app.js configura cada um dos 6 handlers exatamente uma vez com os callbacks aprovados", () => {
  const app = read("frontend/app.js");
  const namespaces = new Map([...app.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s+["']\.\/handlers\/([\w-]+)\.js["']/gm)].map(([, ns, name]) => [name, ns]));
  assert.deepEqual([...namespaces.keys()].sort(), [...HANDLER_NAMES].sort());
  const calls = [...app.matchAll(/\b(\w+)\.configure\s*\(([^)]*)\)/g)].map(([, ns, args]) => ({ ns, args: args.replace(/\s+/g, "").replace(/,(?=\})/, "") }));
  for (const ns of namespaces.values()) {
    const own = calls.filter((call) => call.ns === ns);
    assert.equal(own.length, 1, `${ns}.configure deve aparecer exatamente uma vez`);
    assert.equal(own[0].args, ["feedbackHandlers", "remindersHandlers"].includes(ns) ? "{render,syncContext:syncReadContext}" : "{render}", `${ns}.configure deve receber só { render }`);
  }
  assert.equal(calls.filter((call) => [...namespaces.values()].includes(call.ns)).length, HANDLER_NAMES.length);
  // Nenhum handler pendente de ligação: todo arquivo de handlers/ está na lista acima.
  const present = readdirSync(new URL("../frontend/handlers/", import.meta.url)).filter((name) => name.endsWith(".js")).map((name) => `handlers/${name}`);
  assert.deepEqual(present.sort(), [...HANDLERS].sort(), "todo arquivo de handlers/ é ligado pelo app.js");
});

// Turmas e acessos: orquestração fora de app.js, sem voltar a depender dele nem registrar listeners.
test("handlers/access.js importa só api, state e ui, não registra listeners e entra no build", () => {
  assert.deepEqual(importsOf("handlers/access.js").sort(), ["api.js", "state.js", "ui.js"]);
  assert.doesNotMatch(codeOf("handlers/access.js"), /addEventListener/);
  assert.ok(importsOf("app.js").includes("handlers/access.js"));
  assert.ok(read("scripts/build_frontend.py").includes('"handlers/access.js"'));
  assert.deepEqual(importsOf("state.js"), []);
});

// Confirmação de cadastro: domínio do fluxo antes do login. Só api e state; sem DOM, listeners, rede direta,
// storage, console nem timers globais. Quem o importa: o app.js, que o liga, e a página da confirmação, que usa só as
// constantes e a máscara.
test("handlers/signup-confirmation.js importa só api e state, não toca em DOM, rede, storage nem console, e entra no build", () => {
  const file = "handlers/signup-confirmation.js", source = codeOf(file);
  assert.deepEqual(importsOf(file).sort(), ["api.js", "state.js"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\bwindow\b|\$\(|\bfetch\s*\(|localStorage|sessionStorage|\bconsole\b|setInterval|\blocation\b|auth\.js/);
  assert.ok(read("scripts/build_frontend.py").includes(`"${file}"`));
  const importers = ["app.js", ...PAGES, "ui.js", "api.js", "state.js", ...HANDLERS].filter((other) => importsOf(other).includes(file));
  assert.deepEqual(importers, ["app.js", "pages/signup-confirmation.js"]);
});

test("handlers/signup-confirmation.js expõe só o domínio do fluxo e usa a normalização e a política de privacidade do api.js", async () => {
  const module = await import("../frontend/handlers/signup-confirmation.js");
  assert.deepEqual(Object.keys(module).sort(), ["SIGNUP_ERRORS", "SIGNUP_STEPS", "configure", "confirm", "maskSignupEmail", "requestCode", "reset", "start"]);
  const source = codeOf("handlers/signup-confirmation.js");
  assert.match(source, /api\.normalizeSignupEmail\(/);
  assert.match(source, /api\.ACCOUNT_STATE_CATEGORIES/);
  assert.match(source, /api\.signupConfirmation\.resend\(/);
  assert.match(source, /api\.signupConfirmation\.confirm\(/);
  assert.doesNotMatch(source, /toLowerCase\(|cognito-idp|X-Amz-Target/, "sem segunda normalização nem chamada direta ao Cognito");
});

// A página da confirmação só apresenta: lê a fatia do state e usa as constantes e a máscara do handler. Rede, storage,
// listeners, timers, foco, sessão e a decisão do que fazer ficam com o handler e o app.js.
test("pages/signup-confirmation.js só apresenta: state, ui e as constantes e a máscara do handler, sem rede, storage, listeners, timers nem sessão", () => {
  const file = "pages/signup-confirmation.js", source = codeOf(file);
  assert.deepEqual(importsOf(file).sort(), ["handlers/signup-confirmation.js", "state.js", "ui.js"]);
  assert.deepEqual([...namedImports(file).get("handlers/signup-confirmation.js")].sort(), ["SIGNUP_ERRORS", "SIGNUP_STEPS", "maskSignupEmail"]);
  assert.doesNotMatch(source, /addEventListener|\bdocument\b|\bwindow\b|\$\(|\.focus\(|\bfetch\s*\(|\bapi\.|localStorage|sessionStorage|\bconsole\b|setTimeout|setInterval|\bDate\b|\blocation\b|auth\.js|app\.js/);
  assert.doesNotMatch(source, /\bstate\.\w+(\.\w+)*\s*=(?!=)|Object\.assign\(\s*state\b/, "a página não altera o state");
  assert.doesNotMatch(source, /\b(start|reset|requestCode|confirm)\s*\(|normalizeSignupEmail|ACCOUNT_STATE_CATEGORIES|toLowerCase|USER_NOT_FOUND|NOT_AUTHORIZED|cognito/,
    "nenhuma operação nem regra de domínio na página");
  assert.ok(read("scripts/build_frontend.py").includes(`"${file}"`));
});

// A confirmação chega ao app.js como os outros domínios: actions que só delegam ao handler, os dois formulários no
// submit e a composição da landing sem sessão. Rede, normalização, mensagens de erro e OAuth ficam onde já estavam.
test("app.js liga a confirmação de cadastro só pelo handler: actions finas, dois submits, sem Cognito, normalização, erros nem outro login", () => {
  const app = read("frontend/app.js"), code = stripComments(app);
  assert.doesNotMatch(code, /api\.signupConfirmation|normalizeSignupEmail|ACCOUNT_STATE_CATEGORIES|SIGNUP_ERRORS|maskSignupEmail|cognito-idp|X-Amz-Target|toLowerCase|oauth2|code_challenge|crypto\./);
  // Do handler, o app.js usa só configure, as quatro operações e a etapa CODE (para o timer do reenvio).
  assert.deepEqual([...new Set([...code.matchAll(/\bsignupConfirmationHandlers\.([\w.]+)/g)].map(([, member]) => member))].sort(),
    ["SIGNUP_STEPS.CODE", "configure", "confirm", "requestCode", "reset", "start"]);
  const actions = blockAfter(app, /\bconst actions\s*=/);
  const wrappers = {
    "signup-confirmation-start": /"signup-confirmation-start":\s*\(\)\s*=>\s*signupConfirmationHandlers\.start\(\s*\)\s*,/,
    "signup-confirmation-reset": /"signup-confirmation-reset":\s*\(\)\s*=>\s*signupConfirmationHandlers\.reset\(\s*\)\s*,/,
    "signup-confirmation-resend": /"signup-confirmation-resend":\s*\(\)\s*=>\s*signupConfirmationHandlers\.requestCode\(\s*\)\s*,/,
    "signup-confirmation-use-other-email": /"signup-confirmation-use-other-email":\s*\(\)\s*=>\s*signupConfirmationHandlers\.start\(\s*\)\s*,/,
  };
  for (const [key, wrapper] of Object.entries(wrappers)) assert.match(actions, wrapper, key);
  assert.equal((actions.match(/\bsignupConfirmationHandlers\./g) || []).length, Object.keys(wrappers).length);
  // "Fazer login" reaproveita a action login de sempre.
  assert.match(actions, /\blogin:\s*\(\)\s*=>\s*login\(\s*config\s*\)\s*,/);
  // Submits: cada formulário entrega o valor digitado ao handler; a fatia muda só por ele.
  const submit = blockAfter(app, /document\.addEventListener\(\s*"submit"/);
  assert.match(submit, /form\.id\s*===\s*"signup-email-form"[^}]*signupConfirmationHandlers\.requestCode\(\s*form\.elements\.email\.value\s*\)/);
  assert.match(submit, /form\.id\s*===\s*"signup-code-form"[^}]*signupConfirmationHandlers\.confirm\(\s*\w+\s*\)/);
  assert.doesNotMatch(code, /state\.signupConfirmation(\.\w+)*\s*=(?!=)|Object\.assign\(\s*state\.signupConfirmation/, "a fatia muda só pelo handler");
  // Sem sessão, a landing passa sempre pela composição: landing() só é chamada dentro de publicPage().
  assert.equal((code.match(/\blanding\(\)/g) || []).length, 1);
  assert.match(blockAfter(code, /\bfunction\s+publicPage\s*\(\s*\)/), /\blanding\(\)/);
  // Um único timer de reenvio, que só chama render; nenhum setInterval.
  assert.equal((code.match(/setTimeout\(\s*render\s*,/g) || []).length, 1);
  assert.doesNotMatch(code, /setInterval/);
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

// C7.5: o estado do Feedback é por usuário. O boot reinicia quando o /me muda e o logout reinicia sempre; o handler do
// admin guarda só a sua fila e expõe o reinício.
test("boot e logout reiniciam o estado do Feedback por usuário", () => {
  const app = read("frontend/app.js");
  const boot = blockAfter(app, /async function boot\(\)/).replace(/\s+/g, "");
  assert.match(boot, /importHandlers\.resetDraftsForUser\(state\.me\.email\);feedbackHandlers\.resetForUser\(state\.me\.email\);adminFeedbackHandlers\.resetForUser\(state\.me\.email\);/);
  const signOut = blockAfter(app, /function signOut\(\)/).replace(/\s+/g, "");
  assert.match(signOut, /importHandlers\.discardDrafts\(\);feedbackHandlers\.resetForUser\(""\);adminFeedbackHandlers\.resetForUser\(""\);/);
  assert.ok(Object.keys(adminFeedbackHandlers).includes("resetForUser"));
  assert.ok(Object.keys(feedbackHandlers).includes("resetForUser"));
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
    "closeAttachments", "configure", "discardUploads", "invalidateReads", "loadAttachments", "loadMine", "removeFile", "resetForUser", "retryUploads", "submit"]);
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
  // C7.5: depois de fechar ou abrir, o foco volta ao botão de anexos se o render o tirou do lugar.
  assert.match(toggle, /if\(state\.feedbackAttachments\[id\]\?\.open\)\{feedbackHandlers\.closeAttachments\(id\);restoreFocus\(toggle\);\}elsebusy\(button,\(\)=>feedbackHandlers\.loadAttachments\(id\)\)\.then\(\(\)=>restoreFocus\(toggle\)\);/);
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
  assert.deepEqual(Object.keys(remindersHandlers).sort(), ["configure", "copyReminder", "invalidateReads", "loadBatchPreview", "loadPending", "loadSender",
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
  // Actions de Lembretes: um wrapper síncrono que devolve a Promise do handler (sem async/await extra). As quatro ações das
  // telas de Lembretes (Expansão 7) passam por uma composição do app.js, como publicar (Expansão 6) e restaurar (Expansão 5):
  // cada uma chama a operação do handler uma vez e cuida só do que a pessoa vê (andamento, resultado e foco), sem tocar na API
  // nem no estado de Lembretes.
  const actions = blockAfter(app, /\bconst actions\s*=/);
  const wrappers = {
    "retry-pending": /"retry-pending":\s*\(\)\s*=>\s*remindersHandlers\.loadPending\(\s*state\.pendingStudentId\s*\)\s*,/,
    "reminders-batch": /"reminders-batch":\s*\(button\)\s*=>\s*remindersHandlers\.openBatch\(\s*button\.dataset\.ids\s*\)\s*,/,
  };
  const composed = {
    "retry-batch-preview": ["recheckReminderBatch", "loadBatchPreview"],
    "send-reminders-batch": ["sendReminderBatch", "sendBatch"],
    "refresh-sender": ["refreshReminderSender", "loadSender"],
    "verify-sender": ["verifyReminderSender", "verifySender"],
  };
  for (const [key, wrapper] of Object.entries(wrappers)) assert.match(actions, wrapper, key);
  for (const [key, [composition, operation]] of Object.entries(composed)) {
    assert.match(actions, new RegExp(`"${key}":\\s*\\(\\)\\s*=>\\s*${composition}\\(\\s*\\)\\s*,`), key);
    const body = blockAfter(app, new RegExp(`async function ${composition}\\s*\\(\\s*\\)`));
    assert.deepEqual(body.match(/\bremindersHandlers\.\w+\(/g), [`remindersHandlers.${operation}(`], `${composition} chama só ${operation}, uma vez`);
    assert.doesNotMatch(body, /\bapi\.|\bnotice\(|\bstate\.(sender|senderError|senderLoading|batchIds|batchPreview|batchError|batchResults)\s*=(?!=)/, `${composition}: só apresentação`);
  }
  assert.equal((actions.match(/\bremindersHandlers\./g) || []).length, Object.keys(wrappers).length);
  // Clique do painel, menu "Lembretes" e boot: o mesmo ponto de busy/await de antes, agora pelo handler. A quinta chamada é a
  // recarga do detalhe depois de marcar ou reativar participação (C7.2.4), composta no app.js com o relatório.
  assert.match(app, /if\s*\(\s*button\.dataset\.studentPending\s*\)\s*return\s+busy\(\s*button\s*,\s*\(\)\s*=>\s*remindersHandlers\.loadPending\(\s*button\.dataset\.studentPending\s*\)\s*\);/);
  assert.match(app, /else\s+if\s*\(\s*state\.view\s*===\s*"reminders"\s*\)\s*busy\(\s*button\s*,\s*remindersHandlers\.loadSender\s*\);/);
  assert.match(app, /if\s*\(\s*state\.view\s*===\s*"reminders"\s*&&\s*teacher\(\)\s*\)\s*await\s+remindersHandlers\.loadSender\(\s*\);/);
  assert.equal((app.match(/\bremindersHandlers\./g) || []).length, Object.keys(wrappers).length + Object.keys(composed).length + 8);
  assert.match(app, /await\s+remindersHandlers\.loadPending\(\s*studentId\s*\)/);
  // Continuam em app.js: actions, listeners, busy, boot, roteamento e a navegação global com teacherFilters.
  for (const kept of ["const actions = {", "async function busy(", "async function boot()", "function allowedWhileViewing(",
    'document.addEventListener("click"', 'document.addEventListener("change"', 'document.addEventListener("input"', 'document.addEventListener("submit"',
    "if (button.dataset.view) {", "if (returning && state.teacherFilters) Object.assign(state, state.teacherFilters);",
    'if (state.view === "student-pending" && teacher()) return pendingPage();', 'if (state.view === "reminders-batch" && teacher()) return batchPage(batchView());',
    'if (state.view === "reminders" && teacher()) return senderPage(senderView());'])
    assert.ok(app.includes(kept), kept);
});

test("batchPreviewRequest mora só no handler de Lembretes, incrementado antes de qualquer efeito da prévia em lote", () => {
  const handler = codeOf("handlers/reminders.js");
  assert.match(handler, /\blet\s+batchPreviewRequest\s*=\s*0\b/);
  for (const file of ["app.js", "state.js", "ui.js", "api.js", ...PAGES, ...HANDLERS.filter((h) => h !== "handlers/reminders.js")])
    assert.doesNotMatch(read(`frontend/${file}`), /batchPreviewRequest/, file);
  assert.ok(!("batchPreviewRequest" in direct));
  assert.equal(remindersHandlers.batchPreviewRequest, undefined);
  // TODO 23: sincronizar antes de capturar o dono evita que o render invalide a própria chamada legítima.
  const body = blockAfter(handler, /export\s+async\s+function\s+loadBatchPreview\s*\(\s*\)/).replace(/\s+/g, "");
  const order = ["syncContext()", "constcode=state.code", "request=++batchPreviewRequest", 'state.batchError=""', "render()", "awaitapi.reminders.batchPreview("];
  const at = order.map((step) => body.indexOf(step));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "fora de ordem: turma, contador, efeitos, request");
  assert.equal((body.match(/\+\+batchPreviewRequest/g) || []).length, 1);
  assert.match(body, /constcurrent=\(\)=>request===batchPreviewRequest&&state\.me===owner&&state\.code===code&&state\.view==="reminders-batch"/);
  assert.equal((body.match(/if\(current\(\)\)/g) || []).length, 2, "sucesso e erro só escrevem no contexto proprietário");
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

// Participação. C7.2.3: o frontend lê participationStatus; participation.js é regra pura (sem imports), usada pelas
// telas do instrutor e pelo app.js, e nenhuma tela do aluno conhece o status. C7.2.4: a rota de escrita é definida só no
// api.js e chamada só pelo app.js, a partir dos dois gatilhos do detalhe do aluno; handlers e telas do aluno não a
// conhecem, e o modo "visualizar como aluno" não libera essas actions.
const STUDENT_FACING = ["pages/student.js", "pages/history.js", "pages/landing.js", "pages/feedback.js", "pages/signup-confirmation.js", "student-journey.js", "canvas-links.js"];
const RUNTIME = ["app.js", "api.js", "ui.js", "state.js", "auth.js", "demo.js", "participation.js", "student-journey.js", "canvas-links.js", "course-guide-content.js", ...PAGES, ...HANDLERS];

test("participation.js: regra pura, usada pelo app.js e pelas telas do instrutor, nunca pelas telas do aluno", async () => {
  assert.deepEqual(importsOf("participation.js"), []);
  assert.deepEqual(Object.keys(await import("../frontend/participation.js")), ["isWithdrawn"]);
  const importers = RUNTIME.filter((file) => importsOf(file).includes("participation.js"));
  assert.deepEqual(importers.sort(), ["app.js", "pages/class-report.js", "pages/reminders.js", "pages/teacher.js"]);
  for (const file of STUDENT_FACING)
    assert.doesNotMatch(codeOf(file), /participationStatus|isWithdrawn|participation\.js|Desistente|withdraw-student|reactivate-student|setParticipation/, file);
});

test("rota de participação: definida só no api.js, chamada só pelo app.js, com gatilhos só no detalhe do aluno", async () => {
  const route = /\/participation\b(?!\.js)/;
  assert.deepEqual(RUNTIME.filter((file) => route.test(codeOf(file))), ["api.js"]);
  assert.deepEqual(RUNTIME.filter((file) => /\bsetParticipation\b/.test(codeOf(file))).sort(), ["api.js", "app.js"]);
  assert.equal(typeof (await import("../frontend/api.js")).cohorts.setParticipation, "function");
  assert.equal((codeOf("app.js").match(/api\.cohorts\.setParticipation\(/g) || []).length, 1);
  for (const action of ["withdraw-student", "reactivate-student"]) {
    assert.deepEqual(RUNTIME.filter((file) => codeOf(file).includes(action)).sort(), ["app.js", "pages/reminders.js"], action);
    assert.match(read("frontend/pages/reminders.js"), new RegExp(`data-action="${action}"`), action);
  }
  assert.doesNotMatch(blockAfter(read("frontend/app.js"), /function\s+allowedWhileViewing\s*\(\s*button\s*\)/), /withdraw-student|reactivate-student/);
});

// Regras (seletor + declarações) de um trecho do CSS, sem comentários e sem os blocos @media em volta.
function cssRules(section) {
  const rules = [];
  for (const [, prelude, body] of section.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const text = prelude.replace(/^[\s\S]*@media[^{]*$/, "").trim();
    const selectors = [];
    let depth = 0, current = "";
    for (const ch of text) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { selectors.push(current.trim()); current = ""; } else current += ch;
    }
    selectors.push(current.trim());
    rules.push({ selectors: selectors.filter(Boolean), properties: [...body.matchAll(/([\w-]+)\s*:/g)].map(([, p]) => p) });
  }
  return rules;
}
const cssSection = (css, title, next) => {
  const start = css.indexOf(title);
  assert.ok(start > 0, title);
  // Até o comentário que abre a próxima seção; a última seção vai até o fim do arquivo.
  const end = next ? css.indexOf(next, start) : -1;
  return css.slice(css.indexOf("*/", start) + 2, end > 0 ? css.lastIndexOf("/*", end) : css.length);
};

// Piloto visual (docs/design-visual.md): a seção 28 do CSS só alcança o painel do aluno. Todo seletor começa em
// .student-home ou em .layout:has(.student-home); um seletor solto mudaria outras telas sem revisão.
test("piloto visual: seção 28 do styles.css só tem seletores escopados ao painel do aluno", () => {
  const css = read("frontend/styles.css");
  const selectors = cssRules(cssSection(css, "28. Piloto visual", "29. Casca global")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 50, `seletores lidos: ${selectors.length}`);
  const outside = selectors.filter((s) => !/^(\.student-home\b|\.layout:has\(\.student-home\))/.test(s));
  assert.deepEqual(outside, []);
  // Tokens novos só como apelidos: nenhuma cor literal nova entre os tokens semânticos.
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  for (const [, value] of root.matchAll(/--color-[\w-]+:\s*([^;]+);/g)) assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i, value);
});

// Casca global (3ª iteração): a seção 29 vale para todas as telas, mas só alcança peças da casca (barra lateral, topo,
// barra inferior, rodapé, faixas globais, o <main> como alvo de foco e espaço da barra). Conteúdo de tela fica fora;
// :root sozinho só recebe o recuo de rolagem, e :root[data-sidebar|bottom-nav|header] (medidos pelo app.js) só
// alcançam peças da casca.
test("casca global: seção 29 do styles.css só tem seletores de peças da casca", () => {
  const rules = cssRules(cssSection(read("frontend/styles.css"), "29. Casca global", "30. Componentes do aluno"));
  // Atributos que o app.js escreve na raiz depois de medir a casca: só podem preceder peças da casca.
  const selectors = rules.flatMap((r) => r.selectors).map((s) => s.replace(/^:root\[data-(sidebar="(fixa|rola)"|bottom-nav="(fixa|fluxo)"|header="(linha|sair-abaixo|quebrado)")\]\s+/, ""));
  assert.ok(selectors.length > 40, `seletores lidos: ${selectors.length}`);
  const shell = /^(:root|\.sidebar|\.brand-logo|\.workspace-label|\.cohort-label|#cohort|\.nav-item|\.sidebar-bottom|\.support-card|\.account|\.avatar|\.topline|\.location-context|\.session-context|\.role-chip|\.main-footer|#main-content|\.demo-bar|\.student-view-banner|\.skip-link)(?![\w-])/;
  assert.deepEqual(selectors.filter((s) => !shell.test(s)), []);
  assert.deepEqual(selectors.filter((s) => /\.(student-home|panel|journey|goal|activity|metric|badge|page-heading|feedback|fb-|table)/.test(s)), [], "nenhum seletor de conteúdo");
  for (const rule of rules.filter((r) => r.selectors.includes(":root"))) assert.ok(rule.properties.length && rule.properties.every((p) => p.startsWith("scroll-padding")), rule.properties.join(", "));
});

// Componentes do aluno (seção 30): o que as telas do aluno no piloto usam igual. Só alcança essas telas: todo seletor
// começa num :is() com uma ou mais delas (painel, Minhas atividades, Meu histórico), e nada mais.
test("componentes do aluno: seção 30 do styles.css só alcança as telas do aluno no piloto", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "30. Componentes do aluno", "31. Expansão 1")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 25, `seletores lidos: ${selectors.length}`);
  const scope = /^:is\(\.student-(home|activities|history|feedback)(, \.student-(home|activities|history|feedback))*\) /;
  assert.deepEqual(selectors.filter((s) => !scope.test(s)), []);
  assert.ok(selectors.some((s) => s.startsWith(":is(.student-home, .student-activities, .student-history) ")), "peças comuns às três telas");
});

// Expansão 1 (seção 31): estilos de Minhas atividades ficam presos à tela; nada vaza para histórico, feedback ou
// telas do instrutor, que usam as mesmas classes (.activity-module, .tabs, .activity-card).
test("Minhas atividades: seção 31 do styles.css só tem seletores escopados à tela", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "31. Expansão 1", "32. Expansão 2")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 30, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.student-activities\b|\.layout:has\(\.student-activities\))/.test(s)), []);
});

// Expansão 2 (seção 32): estilos de Meu histórico ficam presos à tela do aluno; "Publicações da turma" (instrutor) usa a
// mesma página (history.js) e tem os seus na seção 35 (Expansão 5).
test("Meu histórico: seção 32 do styles.css só tem seletores escopados à tela do aluno", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "32. Expansão 2", "33. Expansão 3")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 30, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.student-history\b|\.layout:has\(\.student-history\))/.test(s)), []);
});

// Expansão 3 (seção 33): estilos do Feedback do aluno ficam presos à tela dele. Instrutor e admin usam a mesma página
// (feedback.js) pelo rodapé, e a área Feedbacks do admin, as mesmas classes (.feedback-list, .fb-*): continuam como antes.
test("Feedback do aluno: seção 33 do styles.css só tem seletores escopados à tela do aluno", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "33. Expansão 3", "34. Expansão 4")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 40, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.student-feedback\b|\.layout:has\(\.student-feedback\))/.test(s)), []);
});

// Expansão 4 (seção 34): estilos do Painel do instrutor ficam presos ao painel (.teacher-home), inclusive carregamento e
// erro. As outras telas do instrutor e do admin usam as mesmas peças genéricas (.panel, .button, tabelas) e não mudam.
test("Painel do instrutor: seção 34 do styles.css só tem seletores escopados ao painel", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "34. Expansão 4", "35. Expansão 5")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 60, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.teacher-home\b|\.layout:has\(\.teacher-home\))/.test(s)), []);
});

// Expansão 5 (seção 35): estilos de Publicações da turma ficam presos à tela (.teacher-publications), inclusive carregamento
// e erro. "Meu histórico" do aluno (mesmo history.js) e as outras telas do instrutor não têm a classe.
test("Publicações da turma: seção 35 do styles.css só tem seletores escopados à tela", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "35. Expansão 5", "36. Expansão 6")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 50, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.teacher-publications\b|\.layout:has\(\.teacher-publications\))/.test(s)), []);
});

// Expansão 6 (seção 36): estilos de Atualizar notas ficam presos à tela (.teacher-import). As outras telas do instrutor e do
// admin usam as mesmas peças genéricas (.button, .text-link, tabelas, formulários) e não mudam.
test("Atualizar notas: seção 36 do styles.css só tem seletores escopados à tela", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "36. Expansão 6", "37. Expansão 7")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 60, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.teacher-import\b|\.layout:has\(\.teacher-import\))/.test(s)), []);
});

// Expansão 7 (seção 37): estilos de Lembretes ficam presos às duas telas (.teacher-reminders: "Lembretes" e "Lembretes em lote").
// O detalhe do aluno, com a prévia e o envio individuais, não tem a classe e continua com as regras de antes.
test("Lembretes: seção 37 do styles.css só tem seletores escopados às telas de Lembretes", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "37. Expansão 7", "38. Expansão 8")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 50, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.teacher-reminders\b|\.layout:has\(\.teacher-reminders\))/.test(s)), []);
  const page = read("frontend/pages/reminders.js");
  for (const detail of ["export function pendingPage", "function participationPanel", "function studentDetail", "export function reminderPreview"])
    assert.doesNotMatch(blockAfter(page, new RegExp(detail.replace(/ /g, "\\s+") + "\\s*\\(")), /teacher-reminders|trem-/, `${detail}: o detalhe do aluno fica de fora`);
});

// Expansão 8 (seção 38): estilos de Turmas e acessos ficam presos à tela (.admin-access). A área Feedbacks do admin e as outras
// telas usam as mesmas peças genéricas (.button, .text-link, formulários) e não mudam.
test("Turmas e acessos: seção 38 do styles.css só tem seletores escopados à tela", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "38. Expansão 8", "39. Expansão 9", "40. Guia do curso")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 50, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.admin-access\b|\.layout:has\(\.admin-access\))/.test(s)), []);
});

// Expansão 9 (seção 39): estilos de Feedbacks administrativos ficam presos à tela (.admin-feedback). O Feedback do aluno e o envio
// pelo rodapé (feedback.js, as mesmas classes .fb-*, .feedback-list) e as outras telas não mudam.
test("Feedbacks administrativos: seção 39 do styles.css só tem seletores escopados à tela", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "39. Expansão 9", "40. Guia do curso")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 50, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.admin-feedback\b|\.layout:has\(\.admin-feedback\))/.test(s)), []);
});

// As regras da tela antiga de Feedbacks administrativos saíram com a Expansão 9: cartões que filtram no resumo, o cartão-botão da
// lista, os filtros e as ações do detalhe. Nenhuma fonte gera essas classes e nenhuma regra do CSS as alcança; a lista do envio
// pelo rodapé (li.feedback-card) continua.
test("Feedbacks administrativos: as classes da tela antiga não são geradas nem estilizadas", () => {
  const old = /(?<![\w-])(fb-filters|fb-actions|fb-summary)(?![\w-])/;
  assert.deepEqual(["app.js", "ui.js", ...PAGES, ...HANDLERS].filter((file) => old.test(codeOf(file))), []);
  const selectors = cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors);
  assert.deepEqual(selectors.filter((sel) => old.test(sel) || /button\.feedback-card/.test(sel)), []);
  assert.doesNotMatch(codeOf("pages/admin-feedback.js"), /feedback-card|metric/);
  assert.ok(selectors.includes(".feedback-card"), ".feedback-card (envio pelo rodapé) continua");
});

// As regras da tela antiga de Turmas e acessos saíram com a Expansão 8: .checkbox-line não é gerada por nenhuma fonte, e
// .approve-form só marca o formulário do pedido pendente para o app.js (o envio do vínculo), sem estilo próprio.
test("Turmas e acessos: as classes da tela antiga não são estilizadas; approve-form só marca o pedido para o app.js", () => {
  const rules = cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors);
  assert.deepEqual(rules.filter((sel) => /(?<![\w-])(approve-form|checkbox-line)(?![\w-])/.test(sel)), []);
  const generates = (cls) => ["app.js", "ui.js", ...PAGES, ...HANDLERS].filter((file) => new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(codeOf(file)));
  assert.deepEqual(generates("checkbox-line"), []);
  assert.deepEqual(generates("approve-form"), ["app.js", "pages/access.js"]);
  assert.match(read("frontend/app.js"), /form\.classList\.contains\("approve-form"\)/);
});

// As classes da tela antiga de Atualizar notas saíram com a Expansão 6: nenhuma fonte as gera e nenhuma regra do CSS as
// alcança (as regras foram apagadas junto). "next-steps" (painel do aluno) não é "steps".
test("Atualizar notas: as classes da tela antiga não são geradas nem estilizadas", () => {
  const old = /(?<![\w-])(steps|drop-zone|fallback-note|activity-options|publish-footer|removal-warning|import-warnings|import-comparison|change-groups|integrity-(panel|grid|roster|checks|critical|warnings))(?![\w-])/;
  const sources = ["app.js", "ui.js", ...PAGES, ...HANDLERS].filter((file) => old.test(codeOf(file)));
  assert.deepEqual(sources, []);
  assert.deepEqual(cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors).filter((sel) => old.test(sel)), []);
  assert.ok(cssRules(read("frontend/styles.css")).some((r) => r.selectors.some((sel) => /\.next-steps\b/.test(sel))), ".next-steps (painel do aluno) continua");
});

// A tabela e os cartões da tela antiga de Publicações saíram com a Expansão 5: nenhuma fonte gera as classes e nenhuma regra
// as alcança (as regras foram apagadas junto).
test("Publicações da turma: as classes da tabela antiga não são geradas nem estilizadas", () => {
  const old = /\b(history-table|h-(date|status|file|changes|action))\b/;
  const sources = ["app.js", "ui.js", ...PAGES, ...HANDLERS].filter((file) => old.test(codeOf(file)));
  assert.deepEqual(sources, []);
  assert.deepEqual(cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors).filter((sel) => old.test(sel)), []);
});

// As classes da lista e dos cartões do painel antigo saíram com a Expansão 4: nenhuma fonte as gera e nenhuma regra do CSS
// as alcança (as regras foram apagadas junto). .metric-filter saiu depois, na consolidação transversal (teste abaixo).
test("Painel do instrutor: as classes do painel antigo não são geradas nem estilizadas", () => {
  const old = /\b(student-table|student-tools|metrics-filters|metric-neutral|pending-count|portal-ok|pending-unit|focus-editor|cell-(name|kc|lab|progress|pending|status|portal|actions))\b/;
  const sources = ["app.js", "ui.js", ...PAGES, ...HANDLERS].filter((file) => old.test(codeOf(file)));
  assert.deepEqual(sources, []);
  const selectors = cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors).filter((sel) => old.test(sel));
  assert.deepEqual(selectors, []);
});

// Consolidação transversal: saíram as regras das doze classes que nenhuma fonte gerava desde antes do piloto (o gráfico simples, a
// marca e o ponto ao vivo antigos, o formulário de turma antigo e as outras). Nenhuma fonte do frontend as gera e nenhuma regra do
// CSS as alcança.
test("consolidação: as classes legadas sem fonte não são geradas nem estilizadas", () => {
  const LEGACY = "accent|brand-mark|brand-type|chart|chart-column|chart-track|class-entry|class-form|empty-icon|live-dot|pending-section|small-button";
  const token = new RegExp(`(?<![\\w-])(${LEGACY})(?![\\w-])`);
  const sources = [...RUNTIME.map((file) => [file, codeOf(file)]), ["index.html", read("frontend/index.html")]];
  assert.deepEqual(sources.filter(([, code]) => token.test(code)).map(([file]) => file), []);
  const selectors = cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors);
  assert.ok(selectors.length > 1000, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((sel) => new RegExp(`\\.(${LEGACY})(?![\\w-])`).test(sel)), []);
});

// Consolidação transversal: filterMetric (ui.js), o cartão que filtrava, ficou sem uso na Expansão 9 (a área Feedbacks passou aos
// atalhos de status); saiu com as regras de .metric-filter. Nenhuma fonte a chama nem gera a classe, e nenhuma regra a alcança.
test("consolidação: filterMetric e .metric-filter saíram (sem uso desde a Expansão 9)", () => {
  assert.deepEqual(RUNTIME.filter((file) => /\bfilterMetric\b|(?<![\w-])metric-filter(?![\w-])/.test(codeOf(file))), []);
  assert.deepEqual(cssRules(read("frontend/styles.css")).flatMap((r) => r.selectors).filter((sel) => /\.metric-filter(?![\w-])/.test(sel)), []);
});

// Consolidação transversal: com o mesmo seletor e o mesmo contexto (@media/@container), uma declaração que repete o valor da
// anterior da mesma propriedade deixa a anterior sem efeito (a de depois sempre vence). As repetidas saíram; outra não pode voltar.
test("consolidação: nenhuma declaração repete o valor da anterior com o mesmo seletor e contexto", () => {
  const css = read("frontend/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const last = new Map(), repeated = [];
  const walk = (text, ctx) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
      let depth = 1, j = open + 1;
      while (depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) walk(body, `${ctx}${prelude}|`);
      else for (const decl of body.split(";")) {
        const at = decl.indexOf(":");
        if (at < 0) continue;
        const key = `${ctx}${prelude}|${decl.slice(0, at).trim()}`, value = decl.slice(at + 1).trim();
        if (last.get(key) === value) repeated.push(`${prelude} { ${decl.trim()} }`);
        last.set(key, value);
      }
      i = j;
    }
  };
  walk(css, "");
  assert.ok(last.size > 3000, `declarações lidas: ${last.size}`);
  assert.deepEqual(repeated, []);
});

// Guia estático: uma página sem I/O e um catálogo simples de conteúdo, sem ciclos ou novo roteador.
test("Guia do curso só lê state, ui e o conteúdo centralizado, sem rede ou efeitos", () => {
  assert.deepEqual(importsOf("pages/course-guide.js").sort(), ["course-guide-content.js", "state.js", "ui.js"]);
  assert.doesNotMatch(codeOf("pages/course-guide.js"), /\bfetch\s*\(|\bapi\.|addEventListener|document\.(?:querySelector|getElement|createElement|body|addEventListener)|window\.|localStorage|sessionStorage|URLSearchParams/);
  assert.ok(importsOf("app.js").includes("pages/course-guide.js"));
  assert.doesNotMatch(codeOf("course-guide-content.js"), /\bfetch\s*\(|\bapi\.|localStorage|sessionStorage|document\.(?:querySelector|getElement|createElement|body|addEventListener)|window\./);
});

test("Guia do curso: seção 40 do CSS só alcança a nova página", () => {
  const selectors = cssRules(cssSection(read("frontend/styles.css"), "40. Guia do curso")).flatMap((r) => r.selectors);
  assert.ok(selectors.length >= 10, `seletores lidos: ${selectors.length}`);
  assert.deepEqual(selectors.filter((s) => !/^(\.course-guide\b|\.layout:has\(\.course-guide\))/.test(s)), []);
});

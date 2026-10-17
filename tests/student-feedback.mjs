// Expansão 3 do piloto visual (docs/design-visual.md): Feedback do aluno. A tela mostra os problemas de validação
// junto dos campos, todos de uma vez, antes de chamar o handler; o handler (handlers/feedback.js::submit) continua
// validando de novo e é a regra. Este teste prova que as duas validações coincidem caso a caso e que a tela liga cada
// problema ao seu campo. Sem rede, sem DOM: transporte fictício e HTML da página.
import assert from "node:assert/strict";
import test from "node:test";
globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const api = await import("../frontend/api.js");
const feedback = await import("../frontend/handlers/feedback.js");
const page = await import("../frontend/pages/feedback.js");

const TYPES = ["", "BUG", "OTHER"];
const TITLES = ["", " ", "ab", " ab ", "a b", "abc", "   abc   ", "\tab\t", "😀😀", "x".repeat(120)];
const DESCRIPTIONS = ["", "123456789", " 123456789 ", "1234567890", "\n\n12345\n6789\n", "linha 1\nlinha 2", " ".repeat(30)];

// O que o handler faz com o rascunho: recusa com uma mensagem (antes de qualquer rede) ou chega ao envio.
async function handlerVerdict(draft) {
  const saved = { ...state };
  let sent = null;
  Object.assign(state, { feedbackDraft: { ...draft }, feedbackFiles: [], feedbackUpload: { feedbackId: null, progress: "", failed: false }, code: "", feedbackOrigin: "" });
  feedback.configure({ render: () => {} });
  api.setTransport((path, options) => { sent = { path, method: options?.method }; return Promise.reject(new Error("rede fictícia")); });
  try {
    await feedback.submit();
    return { sent: true };
  } catch (err) {
    return sent ? { sent: true } : { message: err.message };
  } finally {
    api.setTransport(() => { throw new Error("Rede não autorizada no teste"); });
    feedback.configure({ render: null });
    Object.assign(state, saved);
  }
}

test("E3: os problemas que a tela mostra coincidem com a validação do handler, em todos os rascunhos da tabela", async () => {
  assert.equal(typeof page.feedbackProblems, "function", "pages/feedback.js exporta feedbackProblems");
  let compared = 0;
  for (const type of TYPES) for (const title of TITLES) for (const description of DESCRIPTIONS) {
    const draft = { type, title, description };
    const problems = page.feedbackProblems(draft);
    const verdict = await handlerVerdict(draft);
    const label = JSON.stringify(draft);
    if (verdict.sent) assert.deepEqual(problems, {}, `${label}: o handler envia, a tela não pode acusar problema`);
    else assert.equal(Object.values(problems)[0], verdict.message, `${label}: o primeiro problema é o que o handler recusa`);
    compared++;
  }
  assert.equal(compared, TYPES.length * TITLES.length * DESCRIPTIONS.length);
});

test("E3: todos os problemas de uma vez, na ordem dos campos, com os textos do handler", () => {
  assert.deepEqual(page.feedbackProblems({ type: "", title: " a ", description: "curta" }), {
    type: "Escolha o tipo do feedback.", title: "O título deve ter ao menos 3 caracteres.", description: "A descrição deve ter ao menos 10 caracteres." });
  assert.deepEqual(Object.keys(page.feedbackProblems({ type: "BUG", title: "", description: "" })), ["title", "description"]);
  assert.deepEqual(page.feedbackProblems({ type: "IMPROVEMENT", title: "Tela", description: "Descrição suficiente" }), {});
});

// HTML da tela do aluno com a tentativa de envio registrada (showProblems): cada problema perto do campo e ligado a ele.
function studentHtml(draft, showProblems, me = { email: "aluna@example.test", roles: ["student"] }) {
  const saved = { ...state };
  Object.assign(state, { me, code: "BRSA0267", feedbackOrigin: "activities", feedbackDraft: draft, feedbackFiles: [], feedbackSending: false, feedbackSent: false,
    feedbackUpload: { feedbackId: null, progress: "", failed: false }, feedbackAttachments: {}, feedbackCardUpload: {}, myFeedback: { items: [], nextCursor: null, loading: false, error: "" } });
  try { return page.feedbackPage({ showProblems }); } finally { Object.assign(state, saved); }
}

test("E3: sem tentativa de envio, nenhum problema na tela; com tentativa, cada um junto do campo, com aria-invalid e aria-describedby", () => {
  const draft = { type: "", title: "ab", description: "" };
  const quiet = studentHtml(draft, false);
  assert.doesNotMatch(quiet, /fb-(type|title|description)-error|aria-invalid/);
  const html = studentHtml(draft, true);
  for (const [key, text] of Object.entries(page.feedbackProblems(draft))) {
    assert.ok(html.includes(`<p class="fb-error" id="fb-${key}-error">${text}</p>`), `${key}: mensagem com id próprio`);
  }
  // Título e descrição: o campo aponta para a ajuda, a contagem e o problema, e se declara inválido.
  for (const key of ["title", "description"])
    assert.match(html, new RegExp(`id="fb-${key}"[^>]*aria-describedby="fb-${key}-hint fb-${key}-count fb-${key}-error" aria-invalid="true"`));
  // Tipo: cada opção aponta para a própria explicação e para o problema do grupo.
  assert.equal((html.match(/name="fb-type"[^>]*aria-describedby="fb-type-[a-z]+-hint fb-type-error"[^>]*aria-invalid="true"/g) || []).length, 4);
  // Corrigido o tipo, só os outros dois continuam.
  const fixed = studentHtml({ ...draft, type: "BUG" }, true);
  assert.doesNotMatch(fixed, /fb-type-error/);
  assert.match(fixed, /fb-title-error/);
  // Instrutor e admin (tela antiga) nunca recebem os problemas na tela, mesmo com a marca.
  for (const roles of [["instructor"], ["admin", "instructor"]])
    assert.doesNotMatch(studentHtml(draft, true, { email: "x@example.test", roles }), /fb-error|aria-invalid|student-feedback/);
});

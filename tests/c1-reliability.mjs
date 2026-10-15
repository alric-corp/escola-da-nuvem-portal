// C1 (D05), sem navegador: a seção Foco da turma do Painel do instrutor com o resultado do salvamento. A recusa (4xx: o
// servidor recusa antes de gravar) diz que o foco não foi salvo; a dúvida (rede, 5xx: a gravação pode ter acontecido) diz
// que não deu para confirmar, nunca que não salvou, explica a consulta (que descarta o que não foi salvo) e que salvar de
// novo não grava duas vezes. O motivo vem escapado e o rascunho continua na tela. Dados fictícios.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const teacher = await import("../frontend/pages/teacher.js");

const ACTIVITIES = [
  { id: "a1", name: "200-KC - Atividade 1", kind: "kc", active: true, completed: 4, pending: 1, needsReview: 3, average: 61 },
  { id: "a2", name: "201-KC - Atividade 2", kind: "lab", active: true, completed: 5, pending: 0, needsReview: 1, average: 90 },
  { id: "a3", name: "202-KC - Atividade 3", kind: "kc", active: true, completed: 5, pending: 0, needsReview: 1, average: 90 },
];
const report = { cohort: "BRSA0267", publication: { id: "p13", publishedAt: "2026-10-10T21:04:00Z" }, focus: { activityIds: ["a1", "a2", "a3"], version: "v0" }, activities: ACTIVITIES, students: [] };
function focus(draft, outcome) {
  const saved = { report: state.report, focusDraft: state.focusDraft };
  try {
    state.report = report; state.focusDraft = draft;
    return teacher.focusEditor({ focus: outcome });
  } finally { Object.assign(state, saved); }
}
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const status = (html) => (html.match(/<p class="tp-focus-status[\s\S]*?<\/p>/) || [""])[0];
const HELP = "A alteração pode ter sido salva. “Consultar atualização” mostra o foco em vigor, mas descarta as escolhas ainda não salvas; salvar de novo não grava duas vezes: se a alteração já tiver sido salva, o portal recusa a repetição.";

test("C1-U1: dúvida ao salvar o foco — não diz que não salvou, diz o motivo (escapado) e o que fazer; alerta; o rascunho continua", () => {
  for (const message of ["A conexão com o portal falhou.", "Erro <b>interno</b> ao salvar o foco."]) {
    const html = focus(["a1", "a3"], { kind: "error", unsure: true, message });
    const s = status(html);
    assert.match(s, /^<p class="tp-focus-status is-error" id="tp-focus-status" role="alert" tabindex="-1"><strong>Não foi possível confirmar a atualização do foco da turma\.<\/strong> /);
    assert.equal(strip(s), `Não foi possível confirmar a atualização do foco da turma. ${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")} ${HELP}`);
    assert.ok(!s.includes("<b>") && (message.includes("<b>") ? s.includes("&lt;b&gt;") : true), "motivo escapado");
    assert.doesNotMatch(s, /não foi salvo|Failed to fetch/);
    assert.deepEqual([...html.matchAll(/data-remove-focus="([^"]*)"/g)].map(([, id]) => id), ["a1", "a3"], "o rascunho continua");
  }
});

test("C1-U2: recusa ao salvar o foco — continua dizendo que não salvou, com o motivo do servidor, e não traz a explicação da dúvida", () => {
  const s = status(focus(["a1"], { kind: "error", message: "O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar." }));
  assert.equal(strip(s), "O foco não foi salvo. O foco foi alterado por outro instrutor. Consulte a atualização antes de salvar.");
  assert.match(s, /role="alert" tabindex="-1"><strong>O foco não foi salvo\.<\/strong>/);
  assert.doesNotMatch(s, /pode ter sido salva|confirmar/);
});

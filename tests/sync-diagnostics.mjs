// TODO29: composição real com dados fictícios; não consulta Canvas ou produção.
import assert from "node:assert/strict";
import test from "node:test";
globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null };
const { state } = await import("../frontend/state.js");
const { updateInfo } = await import("../frontend/ui.js");
const { historyPage } = await import("../frontend/pages/history.js");
const diagnostic = (extra = {}) => ({ status: "failed", scheduledFor: "2026-10-21T09:00:00Z", startedAt: "2026-10-21T09:00:01Z",
  finishedAt: "2026-10-21T09:01:00Z", stages: { catalog: "failed", roster: "succeeded", grades: "unchanged" }, ...extra });
const report = (extra = {}) => ({ cohort: "FIC001", publication: { id: "p1", publishedAt: "2026-10-20T09:00:00Z" },
  updatedAt: "2026-10-20T09:00:00Z", updateKind: "canvas", history: [], students: [], activities: [],
  canvasSync: { status: "unchanged", at: "2026-10-21T09:01:00Z" }, canvasSyncDiagnostics: diagnostic(), ...extra });
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function inState(extra, action = updateInfo) {
  const saved = { ...state };
  Object.assign(state, { me: { roles: ["instructor"] }, code: "FIC001", cohorts: [{ code: "FIC001", canTeach: true, autoSync: true }],
    report: report(), studentView: null, ...extra });
  try { return action(); } finally { Object.assign(state, saved); }
}

test("catálogo indisponível não transforma notas sem mudanças em sucesso completo", () => {
  const text = strip(inState({}));
  assert.match(text, /Verificação por etapas incompleta/);
  assert.match(text, /Catálogo: indisponível/);
  assert.match(text, /Matrículas: verificadas/);
  assert.match(text, /Notas: verificadas, sem mudanças/);
  assert.match(text, /Última mudança nas notas.*20\/10\/2026/);
  assert.match(text, /21\/10\/2026/);
});

test("histórico mostra qualidade atual separada da data original e não inventa publicação", () => {
  const text = strip(inState({}, historyPage));
  assert.match(text, /Publicação de 20 de outubro de 2026/);
  assert.match(text, /Catálogo: indisponível/);
  assert.match(text, /Notas: verificadas, sem mudanças/);
  assert.match(text, /21 de outubro de 2026/);
  assert.equal((text.match(/Publicação de/g) || []).length, 1);
});

test("nova prova completa retira aviso anterior; prova sem conclusão não afirma andamento atual", () => {
  const complete = diagnostic({ status: "succeeded", stages: { catalog: "succeeded", roster: "succeeded", grades: "published" } });
  const text = strip(inState({ report: report({ canvasSyncDiagnostics: complete }) }));
  assert.match(text, /Etapas da sincronização acadêmica verificadas/);
  assert.match(text, /Notas: publicadas/);
  assert.doesNotMatch(text, /incompleta|Catálogo: indisponível/);
  const running = strip(inState({ report: report({ canvasSyncDiagnostics: diagnostic({ status: "running", finishedAt: null,
    stages: { catalog: "pending", roster: "pending", grades: "pending" } }) }) }));
  assert.match(running, /sem conclusão registrada/);
  assert.doesNotMatch(running, /em andamento|verificadas, sem mudanças/);
});

test("backend anterior e diagnóstico indisponível não comprovam sucesso de todas as etapas", () => {
  const legacy = strip(inState({ report: report({ canvasSyncDiagnostics: undefined }) }));
  assert.match(legacy, /Diagnóstico por etapas não disponível/);
  assert.match(legacy, /somente as notas/);
  const unavailable = strip(inState({ report: report({ canvasSyncDiagnostics: diagnostic({ status: "unavailable" }) }) }));
  assert.match(unavailable, /Diagnóstico por etapas indisponível/);
  assert.doesNotMatch(unavailable, /Etapas da sincronização acadêmica verificadas/);
  const malformed = strip(inState({ report: report({ canvasSyncDiagnostics: diagnostic({ status: "succeeded", stages: { catalog: "<secret-token>", roster: "succeeded", grades: "unchanged" } }) }) }));
  assert.match(malformed, /Diagnóstico por etapas indisponível/);
  assert.doesNotMatch(malformed, /secret-token/);
});

test("aluno e administrador como aluno não recebem diagnóstico técnico na composição", () => {
  for (const extra of [{ cohorts: [{ code: "FIC001", canTeach: false, autoSync: true }] }, { studentView: { studentId: "100" } }]) {
    const text = strip(inState(extra));
    assert.doesNotMatch(text, /Catálogo:|Matrículas:|Verificação por etapas|Diagnóstico por etapas/);
  }
});

test("falha da primeira sincronização pode ser compreendida antes de haver publicação", () => {
  const data = report({ publication: null, canvasSync: { status: "failed", at: "2026-10-21T09:01:00Z" },
    canvasSyncDiagnostics: diagnostic({ stages: { catalog: "succeeded", roster: "failed", grades: "skipped" } }) });
  assert.match(strip(inState({ report: data })), /Matrículas: indisponíveis/);
  const text = strip(inState({ report: data }, historyPage));
  assert.match(text, /As atualizações publicadas aparecerão aqui/);
  assert.match(text, /Notas: não verificadas/);
  assert.doesNotMatch(text, /Publicação de|Última mudança nas notas/);
});

test("desligar autoSync não revive diagnóstico ou falha de uma configuração anterior", () => {
  const extra = { cohorts: [{ code: "FIC001", canTeach: true, autoSync: false }] };
  for (const fn of [updateInfo, historyPage]) assert.doesNotMatch(strip(inState(extra, fn)), /Catálogo:|Verificação por etapas|Diagnóstico por etapas/);
});

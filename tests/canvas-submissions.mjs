import assert from "node:assert/strict";
import test from "node:test";
globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const { activityCard, activitiesPage, submissionContext, withCanvasSubmissions } = await import("../frontend/pages/student.js");
const { pendingPage } = await import("../frontend/pages/reminders.js");
const at = "2026-10-22T12:00:00Z";
const activity = { id: "001 KC (123)", name: "Atividade fictícia", kind: "kc", state: "pending", active: true, percent: null, score: null };
const envelope = (value) => ({ courseId: "7", attemptedAt: at, status: "complete", items: { "123": value } });

test("entrega associa somente assignment ID e não modifica notas, universo ou atividades originais", () => {
  const list = [activity, { ...activity, id: "002 KC (456)" }];
  const before = structuredClone(list);
  assert.equal(withCanvasSubmissions(list, null), list, "backend anterior preserva a apresentação anterior");
  const result = withCanvasSubmissions(list, envelope({ state: "submitted", observedAt: at }));
  assert.equal(result[0].canvasSubmission.state, "submitted");
  assert.equal(result[1].canvasSubmission.state, "unknown", "mesmo nome não associa outra tarefa");
  assert.deepEqual(list, before);
  assert.deepEqual(result.map(({ canvasSubmission, ...a }) => a), before);
  for (const state of ["exempt", "unreleased"]) {
    const [row] = withCanvasSubmissions([{ ...activity, state }], envelope({ state: "unsubmitted" }));
    assert.equal(row.canvasSubmission.state, "not_applicable");
  }
});

test("rótulos são conservadores, com recência própria, zero acadêmico e retenção visível", () => {
  for (const [status, label] of [["submitted", "Entrega registrada; avaliação atual não confirmada"], ["pending_review", "Entrega em revisão"],
    ["graded", "Avaliação registrada no Canvas"], ["unsubmitted", "Sem entrega registrada"], ["unknown", "Sem informação de entrega"],
    ["not_applicable", "Situação da entrega não aplicável"], ["novo-estado", "Sem informação de entrega"]]) {
    const [row] = withCanvasSubmissions([activity], envelope({ state: status, observedAt: at, provenance: { status: "retained" } }));
    const html = activityCard(row);
    assert.ok(html.includes(label));
    assert.ok(html.includes("Sem nota"), "a situação acadêmica é independente");
    assert.match(html, /Informação retida/);
    assert.match(html, /datetime="2026-10-22T12:00:00Z"/);
  }
  assert.match(activityCard({ ...activity, state: "completed", percent: 0, canvasSubmission: { state: "submitted" } }), /0%/);
  const hidden = activityCard({ ...activity, canvasSubmission: { state: "submitted", provenance: { reason: "evaluation-unconfirmed" } } });
  assert.match(hidden, /avaliação atual não confirmada/);
  assert.doesNotMatch(hidden, /aguardando avaliação/);
  assert.doesNotMatch(activityCard({ ...activity, canvasSubmission: { state: "unknown", observedAt: "inválido" } }), /Invalid Date|datetime=/);
  assert.match(submissionContext({ status: "partial" }), /coleta está parcial/);
  assert.match(submissionContext({ status: "failed" }), /tentativa de coleta falhou/);
});

test("páginas e detalhe autorizado preservam filtros acadêmicos e distinguem publicação de observação atual", () => {
  Object.assign(state, { me: { roles: ["student"] }, cohorts: [], code: "FIC001", filter: "pending", activityKind: "all", activityModule: "all", search: "",
    report: { student: { activities: [activity] }, publication: { publishedAt: at }, thresholds: { kc: 70, lab: 95 },
      canvasSubmissions: envelope({ state: "submitted", observedAt: at }) } });
  const html = activitiesPage();
  assert.match(html, /Entrega registrada; aguardando avaliação/);
  assert.match(html, /separada das notas desta publicação/);
  assert.match(html, /Horário de Brasília/);
  assert.equal(state.report.student.activities[0].canvasSubmission, undefined);
  state.pendingPreview = { student: { id: "101", name: "Aluno fictício", email: null }, activities: [activity], allActivities: [activity],
    summary: { kc: 0, lab: null, pending: 1, completed: 0, progress: 0, status: "critical" }, history: [], publishedAt: at,
    remindersEnabled: false, canvasSubmissions: envelope({ state: "pending_review", observedAt: at }) };
  state.pendingError = null;
  assert.match(pendingPage(), /Entrega em revisão/);
  assert.doesNotMatch(pendingPage(), /correção do professor|reenviar atividade/i);
});

test("falha de coleta não transforma avaliação não confirmada em espera confirmada", () => {
  const before = { state: "submitted", observedAt: at, provenance: { status: "current", reason: "evaluation-unconfirmed" } };
  // A leitura preserva o estado/observação, mas o motivo descreve a falha mais recente.
  const after = { ...before, provenance: { status: "retained", reason: "failed" } };
  for (const value of [before, after]) {
    const html = activityCard({ ...activity, canvasSubmission: value });
    assert.match(html, /Entrega registrada; avaliação atual não confirmada/);
    assert.doesNotMatch(html, /aguardando avaliação/);
  }
  assert.match(activityCard({ ...activity, canvasSubmission: after }), /Informação retida/);
});

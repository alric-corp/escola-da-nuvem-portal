import assert from "node:assert/strict";
import test from "node:test";
import { activityModule, groupActivities, needsReview, nextActivities } from "../frontend/student-journey.js";

test("módulo e ordem vêm do backend (catálogo do Canvas), inclusive não liberadas", () => {
  const linux = { name: "226-LX-KC - Uma introdução ao Linux", kind: "kc", state: "unreleased", module: "Linux", moduleOrder: 7 };
  const bases = { name: "Qualquer título", kind: "lab", module: "Bases", moduleOrder: 11 };
  const intro = { name: "Qualquer título", kind: "kc", module: "Introdução ao Cloud Foundations", moduleOrder: 6 };
  const roll = { name: "Roll Call Attendance", kind: "lab", module: null, moduleOrder: null };
  assert.equal(activityModule(linux), "Linux");
  assert.equal(activityModule(roll), "Outras atividades");
  assert.deepEqual(groupActivities([roll, bases, linux, intro]).map(([name]) => name),
    ["Introdução ao Cloud Foundations", "Linux", "Bases", "Outras atividades"]);
  assert.deepEqual(groupActivities([roll, bases, linux, intro])[1][1], [linux]);
});

test("sem catálogo, nada é deduzido pelo título: tudo em Outras atividades", () => {
  const titled = { name: "226-LX-KC - Uma introdução ao Linux", kind: "kc" };
  assert.equal(activityModule(titled), "Outras atividades");
  assert.deepEqual(groupActivities([titled]).map(([name]) => name), ["Outras atividades"]);
});

test("revisão inclui zero, distingue limites de KC e LAB e não confunde ausência de nota", () => {
  for (const [kind, limit] of [["kc",70], ["lab",95]]) {
    for (const percent of [0, limit - 0.01]) assert.ok(needsReview({kind, state:"completed",percent}));
    for (const percent of [limit, 100, null, undefined, NaN]) assert.equal(needsReview({kind,state:"completed",percent}),false);
    for (const state of ["pending", "exempt", "unreleased"]) assert.equal(needsReview({kind,state,percent:0}),false);
  }
  assert.ok(needsReview({kind:"kc",state:"completed",percent:70,score:6.99999,points:"10"}));
  assert.ok(needsReview({kind:"kc",state:"completed",percent:70,needsReview:true}));
});

test("início limita três sugestões automáticas e ignora priorização legada por foco", () => {
  const activities = [
    {id:"review",kind:"kc",state:"completed",percent:0},
    ...[1,2,3,4].map(i=>({id:`p${i}`,kind:"lab",state:"pending"})),
    {id:"ok",kind:"lab",state:"completed",percent:100},
    {id:"exempt",kind:"lab",state:"exempt"},
  ];
  assert.deepEqual(nextActivities(activities).map(a=>a.id),["p1","p2","p3"]);
  assert.deepEqual(nextActivities(activities,["p4","review","ok"]).map(a=>a.id),["p1","p2","p3"]);
  assert.deepEqual(nextActivities(activities,["ok","exempt","missing"]).map(a=>a.id),["p1","p2","p3"]);
  assert.deepEqual(nextActivities(activities.filter((a) => ["ok", "exempt"].includes(a.id))), []);
  assert.deepEqual(nextActivities([]),[]);
});

test("sugere primeiro as atividades liberadas mais recentemente", () => {
  const activities = [
    {id:"antiga",kind:"kc",state:"pending",releasedAt:"2026-09-01T12:00:00Z"},
    {id:"sem-data",kind:"kc",state:"pending"},
    {id:"recente",kind:"lab",state:"pending",releasedAt:"2026-09-20T12:00:00Z"},
    {id:"media",kind:"lab",state:"pending",releasedAt:"2026-09-10T12:00:00Z"},
    {id:"revisar",kind:"kc",state:"completed",percent:10,releasedAt:"2026-09-21T12:00:00Z"},
  ];
  // Pendências vêm antes das revisões, mesmo que a revisão seja mais recente.
  assert.deepEqual(nextActivities(activities).map(a=>a.id),["recente","media","antiga"]);
  assert.deepEqual(nextActivities(activities.slice(0,2)).map(a=>a.id),["antiga","sem-data"]);
});

test("painel do aluno preserva sugestões automáticas mesmo com foco legado no relatório", async () => {
  globalThis.location = { hostname: "portal.test", search: "" };
  const { state } = await import("../frontend/state.js");
  const { studentPage } = await import("../frontend/pages/student.js");
  const saved = { ...state };
  const activities = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `Atividade ${i}`, kind: "kc", state: "pending", active: true }));
  const focus = { activityIds: ["p4"], version: "legada" };
  Object.assign(state, { me: { roles: ["student"] }, code: "FIC001", cohorts: [{ code: "FIC001", canTeach: false }], studentView: null,
    report: { publication: { id: "p1", publishedAt: "2026-10-23T12:00:00Z" }, focus, history: [], thresholds: { kc: 70, lab: 95 },
      student: { activities, completed: 0, pending: 4, progress: 0, kc: null, lab: null } } });
  try {
    const before = structuredClone(state.report);
    const html = studentPage("Pessoa fictícia");
    assert.match(html, /<h2 id="pending-heading">Por onde começar<\/h2>/);
    assert.doesNotMatch(html, /Foco indicado|Foco da turma|data-(?:add|remove)-focus|focus-form/);
    const next = html.slice(html.indexOf('<div class="next-list">'), html.indexOf('<p class="small next-note">'));
    assert.deepEqual([...next.matchAll(/<strong>(Atividade \d)<\/strong>/g)].map(([, name]) => name), ["Atividade 1", "Atividade 2", "Atividade 3"]);
    assert.deepEqual(state.report, before, "o foco armazenado não é apagado nem modificado");
  } finally { Object.assign(state, saved); }
});

test("visão por atividade mantém notas e filtros sem coluna ou ações de Foco", async () => {
  globalThis.location = { hostname: "portal.test", search: "" };
  const { state } = await import("../frontend/state.js");
  const { activityOverviewPage } = await import("../frontend/pages/activities-overview.js");
  const saved = { ...state };
  Object.assign(state, { activityOverviewKind: "all", activityOverviewModule: "all", activityOverviewSort: "name",
    report: { focus: { activityIds: ["a1"], version: "legada" }, activities: [
      { id: "a1", name: "Atividade fictícia", module: "Fundamentos", kind: "kc", active: true, completed: 1, pending: 3, needsReview: 1, average: 50 },
      { id: "a2", name: "Ainda não liberada", kind: "lab", active: false, completed: 0, pending: 0, needsReview: 0 },
    ] } });
  try {
    const html = activityOverviewPage();
    assert.doesNotMatch(html, /Foco|foco|data-add-focus|data-remove-focus/);
    assert.equal((html.match(/<th>/g) || []).length, 7);
    assert.equal((html.match(/<td>/g) || []).length, 7);
    assert.match(html, /<td>25%<\/td><td>75%<\/td><td>100%<\/td><td>50%<\/td>/);
    assert.doesNotMatch(html, /Ainda não liberada/);
    state.activityOverviewKind = "lab";
    assert.match(activityOverviewPage(), /Nenhuma atividade liberada encontrada neste filtro/);
  } finally { Object.assign(state, saved); }
});

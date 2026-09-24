import assert from "node:assert/strict";
import test from "node:test";
import { activityModule, groupActivities, needsReview, nextActivities } from "../frontend/student-journey.js";
import { canvasCatalogs } from "../frontend/canvas-links.js";

test("módulos respeitam catálogo, curso e título completo, inclusive não liberados", () => {
  const linux = { name: "226-LX-KC - Uma introdução ao Linux (123)", kind: "kc", state: "unreleased" };
  assert.equal(activityModule("BRSA0267", linux), "Linux");
  assert.equal(activityModule("BRSA0257", linux), "Outras atividades");
  assert.equal(activityModule("UNKNOWN", linux), "Outras atividades");
  assert.equal(activityModule("BRSA0267", {...linux, name: "226-KC - Outro assunto"}), "Outras atividades");
  const sandbox = { name: "1--Lab - Ambiente de Sandbox", kind: "lab" };
  assert.equal(activityModule("BRSA0267", sandbox), "Ambiente de sandbox");
  assert.equal(activityModule("BRSA0257", sandbox), "Introdução ao Cloud Foundations");
  for (const [code, course] of [["BRSA0267", "4436"], ["BRSA0257", "4413"]])
    for (const item of canvasCatalogs[course])
      assert.notEqual(activityModule(code, { name: item.title, kind: item.kind }), "Outras atividades", item.title);
  assert.equal(groupActivities("BRSA0267", [linux, sandbox])[0][0], "Ambiente de sandbox");
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

test("início limita três atividades e respeita foco, dispensa e notas já na referência", () => {
  const activities = [
    {id:"review",kind:"kc",state:"completed",percent:0},
    ...[1,2,3,4].map(i=>({id:`p${i}`,kind:"lab",state:"pending"})),
    {id:"ok",kind:"lab",state:"completed",percent:100},
    {id:"exempt",kind:"lab",state:"exempt"},
  ];
  assert.deepEqual(nextActivities(activities).map(a=>a.id),["p1","p2","p3"]);
  assert.deepEqual(nextActivities(activities,["p4","review","ok"]).map(a=>a.id),["p4","review"]);
  assert.deepEqual(nextActivities(activities,["ok","exempt","missing"]),[]);
  assert.deepEqual(nextActivities([]),[]);
});

test("sem foco, sugere primeiro as atividades liberadas mais recentemente", () => {
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

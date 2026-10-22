import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
const { canvasTimeZone, date, formatOperationalDate, instant, timeZoneLabel } = await import("../frontend/ui.js");

test("horários operacionais usam pt-BR e Brasília, inclusive nas viradas do dia e do ano", () => {
  assert.equal(canvasTimeZone, "America/Sao_Paulo");
  assert.equal(timeZoneLabel, "Horário de Brasília");
  assert.equal(date("2026-10-01T01:30:00Z"), "30/09/2026, 22:30");
  assert.equal(date("2026-09-30T22:30:00-03:00"), date("2026-10-01T01:30:00Z"));
  assert.equal(formatOperationalDate("2027-01-01T01:30:00Z", "longDate"), "31 de dezembro de 2026");
  assert.equal(formatOperationalDate("2027-01-01T01:30:00Z", "monthKey"), "12/2026");
  assert.equal(formatOperationalDate("2027-01-01T01:30:00Z", "year"), "2026");
  // A regra histórica IANA inclui o horário de verão; subtrair três horas daria outro dia.
  assert.equal(date("2018-12-01T02:30:00Z"), "01/12/2018, 00:30");
});

test("data civil não ganha hora/fuso presumidos e valores ausentes ou inválidos não inventam uma data", () => {
  assert.equal(date("2026-10-01"), "01/10/2026");
  assert.equal(formatOperationalDate("2026-10-01", "longDate"), "1 de outubro de 2026");
  assert.equal(formatOperationalDate("2024-02-29", "shortDate"), "29/02/2024");
  assert.equal(date(null), "Ainda não publicada");
  assert.equal(date(undefined), "Ainda não publicada");
  for (const value of ["inválido", "2026-02-30", "2026-02-30T01:30:00Z", "2026-10-01T01:30:00", "2026-10-01T24:00:00Z"]) {
    assert.equal(instant(value), null, value);
    assert.equal(date(value), "Data indisponível", value);
  }
  for (const value of [null, undefined, "", false, 0, new Date(NaN)]) {
    assert.equal(instant(value), null);
    assert.equal(formatOperationalDate(value), "Data não informada");
  }
});

const renderInZone = (timeZone) => {
  const script = `
    globalThis.location = { hostname: "portal.test", search: "" };
    const { state } = await import("./frontend/state.js");
    const ui = await import("./frontend/ui.js");
    const { historyPage } = await import("./frontend/pages/history.js");
    const { feedbackPage } = await import("./frontend/pages/feedback.js");
    const { adminFeedbackPage } = await import("./frontend/pages/admin-feedback.js");
    const { studentsCsv } = await import("./frontend/pages/teacher.js");
    const stamp = "2026-10-01T01:30:00Z";
    const publication = { id: "p1", publishedAt: stamp, filename: "notas.csv" };
    const row = { id: "s1", name: "=Aluno fictício", email: "aluno@example.test", kc: 70, lab: 95,
      total: 82, progress: 50, pending: 2, status: "attention", canvasActivity: {
        lastActivityAt: stamp, totalActivityTime: 0 } };
    Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" },
      cohorts: [{ code: "FIC001", canTeach: true, autoSync: false }], code: "FIC001", studentView: null,
      report: { publication, history: [publication], students: [row], activities: [], thresholds: { kc: 70, lab: 95 } } });
    state.myFeedback.items = [{ id: "f1", type: "BUG", status: "NEW", title: "Exemplo", description: "Descrição fictícia", createdAt: stamp }];
    state.adminFeedback.items = [{ ...state.myFeedback.items[0], createdByEmail: "ficticio@example.test", attachments: 0 }];
    console.log(JSON.stringify({ stamp: ui.date(stamp), civil: ui.date("2026-10-01"),
      history: historyPage(), feedback: feedbackPage(), admin: adminFeedbackPage(), csv: studentsCsv([row]) }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: timeZone }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("páginas e CSV reais conservam os mesmos valores em UTC, Brasília e Tóquio", () => {
  const reference = renderInZone("America/Sao_Paulo");
  for (const zone of ["UTC", "Asia/Tokyo"]) assert.deepEqual(renderInZone(zone), reference, zone);
  assert.match(reference.history, /30 de setembro/);
  assert.match(reference.history, /Setembro de 2026/);
  assert.match(reference.history, /22:30/);
  assert.match(reference.history, /Horário de Brasília/);
  assert.match(reference.history, /datetime="2026-10-01T01:30:00Z"/);
  assert.match(reference.feedback, /30\/09\/2026/);
  assert.match(reference.feedback, /Horário de Brasília/);
  assert.match(reference.admin, /30 de setembro de 2026/);
  assert.match(reference.admin, /Horário de Brasília/);
  assert.match(reference.csv, /Última atividade no Canvas \(Brasília\)/);
  assert.match(reference.csv, /30\/09\/2026, 22:30/);
  assert.match(reference.csv, /"'=Aluno fictício"/);
  assert.match(reference.csv, /"0min"/);
  assert.equal(reference.csv.split("\r\n")[0].split(";").length, 12, "contrato de colunas preservado");
});

// Painel do instrutor (Expansão 4), sem navegador: a página renderizada como texto. Contagens, filtros, ordenação e CSV
// são os de antes (tests/participation.mjs); aqui, o que a Expansão 4 decide: atalhos com o número do próprio filtro,
// médias com uma casa sem cruzar a referência, situação por texto e forma, Foco da turma com o estado do salvamento,
// estados vazios, semântica da tabela e texto do usuário sempre escapado. Dados fictícios.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const teacher = await import("../frontend/pages/teacher.js");

const WITHDRAWN = { participationStatus: "WITHDRAWN" };
const row = (id, name, extra) => ({ id, name, email: `${name.split(" ")[0].toLowerCase()}@example.test`, kc: 80, lab: 96, total: 88, completed: 5, pending: 0, progress: 100, status: "ok", portalLinked: true, ...extra });
const ROSTER = [
  row("1", "Ana Ativa"),
  row("2", "Bruno Atenção", { kc: 60, status: "attention", pending: 1, portalLinked: false }),
  row("3", "Carla Crítica", { kc: 40, lab: 50, status: "critical", pending: 3, email: null }),
  row("4", "Alice Saiu", { kc: 30, lab: 40, status: "critical", pending: 4, portalLinked: false, ...WITHDRAWN }),
  row("5", "Abel Sem Média", { kc: null, lab: 90, status: "insufficient", pending: 2 }),
  row("6", "Gil Graduado", { kc: 75, lab: 99, status: "graduated" }),
  row("7", "Davi Labs", { kc: 85, lab: 70, status: "attention" }),
];
const ACTIVITIES = [
  { id: "a1", name: "254-NF- KC Introdução à rede", kind: "kc", active: true, completed: 4, pending: 1, needsReview: 3, average: 61 },
  { id: "a2", name: "255--Lab - Sub-redes", kind: "lab", active: true, completed: 5, pending: 0, needsReview: 1, average: 90 },
];
const KEYS = ["me", "cohorts", "code", "report", "filter", "search", "sort", "focusDraft", "studentView", "canvasActivityFilter"];
function withState(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true }], code: "BRSA0267",
    filter: "all", search: "", sort: "name", canvasActivityFilter: "all", focusDraft: null, studentView: null }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
const report = (students = ROSTER, extra = {}) => ({ students, activities: ACTIVITIES, publication: { id: "p1", publishedAt: "2026-10-03T09:01:28Z" }, thresholds: { kc: 70, lab: 95 },
  focus: { activityIds: [], version: null }, history: [], updatedAt: "2026-10-03T09:01:28Z", updateKind: "canvas", ...extra });
const page = (values = {}, view = {}) => withState({ report: report(), ...values }, () => teacher.teacherPage(view));
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const shortcuts = (html) => [...html.matchAll(/<button type="button" class="tp-filter is-[\w-]+" data-filter="([^"]*)"[^>]*aria-pressed="(true|false)"><span>([^<]*)<\/span><strong>([^<]*)<\/strong>/g)]
  .map(([, filter, pressed, label, value]) => ({ filter, pressed: pressed === "true", label, value }));
const rows = (html) => [...html.matchAll(/<tr class="tp-row"[^>]*>([\s\S]*?)<\/tr>/g)].map(([, r]) => ({
  name: r.match(/<span class="tp-student">([^<]*)<\/span>/)?.[1],
  values: [...r.matchAll(/<span class="tp-value">([^<]*)/g)].map(([, v]) => v),
  below: [...r.matchAll(/class="tp-avg is-(kc|lab) is-below"/g)].map(([, k]) => k),
  state: r.match(/<span class="tp-state is-([^"]*)">([^<]*)<\/span>/)?.slice(1, 3), html: r }));
const visible = (values) => withState({ report: report(), ...values }, () => teacher.filteredStudents().length);

test("E4-U1: cada atalho da Situação da turma mostra o número que a lista mostra ao escolhê-lo, e só o filtro em uso fica pressionado", () => {
  const html = page();
  const found = shortcuts(html);
  assert.deepEqual(found.map((s) => s.filter), ["active", "ok", "attention", "critical", "pending", "no-portal"]);
  for (const s of found) assert.equal(Number(s.value), visible({ filter: s.filter }), s.filter);
  assert.deepEqual(found.map((s) => [s.label, s.value]), [["Alunos ativos", "6"], ["Médias na referência", "1"], ["Atenção", "2"], ["Crítico", "1"],
    ["Com atividades sem nota", "3"], ["Ainda não entraram", "1"]]);
  assert.deepEqual(shortcuts(page({ filter: "critical" })).filter((s) => s.pressed).map((s) => s.filter), ["critical"]);
  // Sem desistentes, o total é "Alunos na publicação" e filtra Todos.
  const all = shortcuts(withState({ report: report(ROSTER.filter((r) => !r.participationStatus)) }, () => teacher.teacherPage()))[0];
  assert.deepEqual([all.filter, all.label, all.value, all.pressed], ["all", "Alunos na publicação", "6", true]);
  // A busca não muda os números da Situação da turma (são da turma), só a contagem da lista.
  assert.deepEqual(shortcuts(page({ search: "ana" })).map((s) => s.value), found.map((s) => s.value));
  assert.match(strip(page({ search: "ana" })), /1 de 7 alunos/);
  assert.match(strip(page()), /\b7 alunos\b/);
});

test("E4-U2: médias com uma casa, como o aluno vê; duas quando uma casa mostraria a referência para quem está abaixo; nunca cruza a referência", () => {
  const students = [row("1", "Uma Casa", { kc: 87.53, lab: 96.25 }), row("2", "Quase KC", { kc: 69.96, lab: 94.95, status: "critical" }),
    row("3", "Na Medida", { kc: 70, lab: 95 }), row("4", "Sem Média", { kc: null, lab: 99, status: "insufficient" })];
  const r = rows(withState({ report: report(students) }, () => teacher.teacherPage()));
  assert.deepEqual(r.map((x) => [x.name, x.values.slice(0, 2)]), [["Na Medida", ["70%", "95%"]], ["Quase KC", ["69,96%", "94,95%"]],
    ["Sem Média", ["—", "99%"]], ["Uma Casa", ["87,5%", "96,3%"]]]);
  assert.match(r.find((x) => x.name === "Sem Média").html, /<span class="sr-only"> \(sem média\)<\/span>/);
  // Na referência não é abaixo: 70% e 95% sem anel; 69,96% e 94,95% com.
  assert.deepEqual(r.map((x) => [x.name, x.below]), [["Na Medida", []], ["Quase KC", ["kc", "lab"]], ["Sem Média", []], ["Uma Casa", []]]);
  // Varredura: abaixo da referência, o número exibido nunca chega nela; na referência ou acima, nunca fica abaixo.
  for (const ref of [70, 95, 72.5]) for (let i = 0; i <= 4000; i++) {
    const value = Math.round((ref - 20 + i * 0.01) * 100) / 100;
    const shown = Number(teacher.averageText(value, ref).replace("%", "").replace(",", "."));
    assert.equal(shown < ref, value < ref, `${value} com referência ${ref} aparece como ${shown}`);
  }
});

test("E4-U3: situação por texto e forma; cada média abaixo da referência leva o anel e o texto para leitura assistiva", () => {
  const r = Object.fromEntries(rows(page()).map((x) => [x.name, x]));
  assert.deepEqual(Object.values(r).map((x) => [x.name, x.state, x.below]), [
    ["Abel Sem Média", ["insufficient", "Sem avaliação completa"], ["lab"]], ["Ana Ativa", ["ok", "Médias na referência"], []],
    ["Bruno Atenção", ["attention", "Atenção"], ["kc"]], ["Carla Crítica", ["critical", "Crítico"], ["kc", "lab"]], ["Davi Labs", ["attention", "Atenção"], ["lab"]],
    ["Gil Graduado", ["graduated", "Graduado"], []], ["Alice Saiu", ["critical", "Crítico"], ["kc", "lab"]]]);
  assert.match(r["Bruno Atenção"].html, /60%<span class="sr-only">, abaixo da referência de 70%<\/span>/);
  assert.match(r["Davi Labs"].html, /70%<span class="sr-only">, abaixo da referência de 95%<\/span>/);
  // A régua em miniatura é decorativa: os números e a situação estão no texto.
  assert.ok([...page().matchAll(/<span class="tp-ruler"([^>]*)>/g)].every(([, attrs]) => / aria-hidden="true"/.test(attrs)));
  // Desistente e "não entrou no portal" como texto junto do nome; quem entrou não ganha marcação.
  assert.match(r["Alice Saiu"].html, /<span class="tp-tags"><span class="tp-tag">Desistente<\/span><span class="tp-tag is-portal">Não entrou no portal<\/span><\/span>/);
  assert.doesNotMatch(r["Ana Ativa"].html, /tp-tag/);
  assert.match(r["Carla Crítica"].html, /<span class="tp-email is-missing">E-mail ausente no Canvas<\/span>/);
});

test("E4-U4: quem fica fora das três situações é dito com palavras; a régua da turma é proporcional e decorativa", () => {
  assert.match(strip(page()), /Fora dessas situações: 1 sem avaliação completa e 1 graduado\./);
  assert.doesNotMatch(page({ report: report(ROSTER.filter((r) => !["insufficient", "graduated"].includes(r.status))) }), /Fora dessas situações/);
  const scale = (page().match(/<div class="tp-scale" aria-hidden="true">(.*?)<\/div>/) || ["", ""])[1];
  assert.deepEqual([...scale.matchAll(/class="is-(\w+)" style="flex-grow:(\d+)"/g)].map(([, k, n]) => [k, Number(n)]), [["ok", 1], ["attention", 2], ["critical", 1], ["other", 2]]);
});

test("E4-U5: Foco da turma — alterações pendentes, salvando, salvo e erro na própria seção; Salvar só é a ação principal com algo a salvar", () => {
  const saved = { activityIds: ["a1", "a2"], version: "v1" };
  const focus = (values, view) => (page({ report: report(ROSTER, { focus: saved }), ...values }, view).match(/<section class="tp-focus"[\s\S]*?<\/section>/) || [""])[0];
  const save = (html) => (html.match(/<button class="button (\w+)" type="submit"([^>]*)>Salvar foco da turma<\/button>/) || []).slice(1, 3);
  const plain = focus({});
  assert.deepEqual([...plain.matchAll(/<span class="tp-focus-name">([^<]*)<\/span>/g)].map(([, n]) => n), ["254-NF- KC Introdução à rede", "255--Lab - Sub-redes"]);
  assert.match(plain, /<ol class="focus-list">/);
  assert.match(strip(plain), /1 aluno sem nota · 3 em revisão/);
  assert.doesNotMatch(plain, /tp-focus-status/);
  assert.deepEqual(save(plain), ["secondary", ""]);
  // Rascunho igual ao salvo: nada a avisar. Outra ordem é outra escolha (o aluno vê na ordem do foco).
  assert.doesNotMatch(focus({ focusDraft: ["a1", "a2"] }), /tp-focus-status/);
  const reordered = focus({ focusDraft: ["a2", "a1"] });
  assert.match(strip(reordered), /Alterações ainda não salvas: os alunos continuam vendo o foco anterior\./);
  assert.deepEqual(save(reordered), ["primary", ' aria-describedby="tp-focus-status"']);
  // Salvando: Salvar e Remover parados, andamento anunciado.
  const saving = focus({ focusDraft: ["a1"] }, { focus: { kind: "saving" } });
  assert.match(saving, /<p class="tp-focus-status" id="tp-focus-status" role="status" tabindex="-1">Salvando o foco da turma…<\/p>/);
  assert.match(saving, /type="submit" disabled aria-describedby="tp-focus-status">/);
  assert.ok([...saving.matchAll(/<button class="text-link tp-remove"[^>]*>/g)].every(([b]) => / disabled/.test(b)));
  // Salvo: só enquanto nada mudou depois.
  const ok = { focus: { kind: "saved", message: "Foco da BRSA0267 atualizado." } };
  assert.match(focus({}, ok), /role="status" tabindex="-1">Foco da BRSA0267 atualizado\.<\/p>/);
  assert.doesNotMatch(focus({ focusDraft: ["a1"] }, ok), /atualizado/);
  // Erro: o motivo do servidor (escapado), como alerta, e o rascunho continua.
  const error = focus({ focusDraft: ["a1"] }, { focus: { kind: "error", message: "O foco foi alterado por <b>outro</b> instrutor." } });
  assert.match(error, /role="alert" tabindex="-1"><strong>O foco não foi salvo\.<\/strong> <span>O foco foi alterado por &lt;b&gt;outro&lt;\/b&gt; instrutor\.<\/span><\/p>/);
  assert.deepEqual([...error.matchAll(/data-remove-focus="([^"]*)"/g)].map(([, id]) => id), ["a1"]);
  // Vazio: Salvar parado (como antes) e a explicação do que o aluno vê sem seleção.
  const empty = (page().match(/<section class="tp-focus"[\s\S]*?<\/section>/) || [""])[0];
  assert.match(strip(empty), /Nenhuma atividade no foco: o aluno vê até três atividades na ordem da publicação, primeiro as sem nota e depois as de revisão\./);
  assert.deepEqual(save(empty), ["secondary", " disabled"]);
  // Atividade que saiu da publicação aparece pelo id, sem contagens; sem publicação, não há foco.
  assert.match(focus({ focusDraft: ["sumiu"] }), /<span class="tp-focus-name">sumiu<\/span><\/span><button/);
  assert.doesNotMatch(page({ report: report([], { publication: null }) }), /tp-focus/);
});

test("E4-U6: estados vazios dizem o que limita e oferecem limpar; turma sem publicação não mostra números vazios", () => {
  const none = strip(page({ search: "zzz" }));
  assert.match(none, /Nenhum aluno encontrado para “zzz”\./);
  assert.match(page({ search: "zzz" }), /<button class="button secondary" type="button" data-action="clear-filters">Limpar busca e filtros<\/button>/);
  assert.match(strip(page({ filter: "critical", search: "zzz" })), /Nenhum aluno encontrado para “zzz” com o filtro escolhido\./);
  assert.match(strip(page({ filter: "missing-email", report: report(ROSTER.filter((r) => r.email)) })), /Nenhum aluno encontrado neste filtro\./);
  assert.match(page({ search: "zzz" }), /data-action="export-csv" disabled>Exportar CSV \(0\)/);
  const start = page({ report: report([], { publication: null }) });
  assert.match(strip(start), /A turma está pronta para começar\. Importe o CSV do Canvas para publicar a primeira atualização\./);
  assert.doesNotMatch(start, /tp-overview|<table|id="search"/);
});

test("E4-U7: tabela semântica (legenda, cabeçalhos de coluna e de linha, papéis explícitos) e texto do usuário sempre escapado", () => {
  const evil = row("9", '<img src=x onerror="alert(1)">', { email: 'a"b@<x>.test' });
  const html = withState({ report: report([evil]) }, () => teacher.teacherPage());
  assert.doesNotMatch(html, /<img src=x|<x>/);
  assert.match(html, /<span class="tp-student">&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<\/span>/);
  assert.match(html, /<span class="tp-email">a&quot;b@<wbr>&lt;x&gt;\.test<\/span>/);
  const searched = withState({ report: report([evil]), search: '"><script>' }, () => teacher.teacherPage());
  assert.doesNotMatch(searched, /<script>/);
  assert.match(searched, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(searched, /Nenhum aluno encontrado para “&quot;&gt;&lt;script&gt;”\./);
  const table = (page().match(/<table[\s\S]*<\/table>/) || [""])[0];
  assert.match(table, /^<table role="table"><caption class="sr-only">Alunos da turma BRSA0267: médias, atividades sem nota, situação e atividade registrada no Canvas<\/caption>/);
  assert.equal((table.match(/<th scope="col" role="columnheader"/g) || []).length, 8);
  assert.equal((table.match(/<th scope="row" role="rowheader" class="tp-name">/g) || []).length, 7);
  assert.equal((table.match(/<tr class="tp-row" role="row">/g) || []).length, 7);
  assert.match(table, /Média KC <small>referência 70%<\/small>/);
  // Cada linha tem uma ação, com o nome do aluno no nome acessível e o texto visível dentro dele.
  assert.deepEqual([...table.matchAll(/aria-label="([^"]*)">([^<]*)<\/button>/g)].map(([, name, text]) => name.startsWith(`${text} de `)), Array(7).fill(true));
});

test("E4-U8: carregamento e erro na composição do painel; o erro mantém o título", () => {
  assert.equal(typeof teacher.teacherHomeState, "function");
  const loading = withState({}, () => teacher.teacherHomeState('<section class="panel empty" role="status">Carregando sua turma…</section>'));
  assert.equal(loading, '<div class="teacher-home"><section class="panel empty" role="status">Carregando sua turma…</section></div>');
  const error = withState({}, () => teacher.teacherHomeState('<section class="panel empty" role="alert">x</section>', true));
  assert.match(error, /^<div class="teacher-home"><div class="page-heading"><div><h1>Painel da BRSA0267<\/h1><\/div><\/div><section class="panel empty" role="alert">/);
});

const COLLECTION = "2026-10-20T12:00:00Z";
const activity = (seconds, last) => ({ totalActivityTime: seconds, lastActivityAt: last, collectedAt: COLLECTION });

test("Canvas: tempo zero, ausente, inválido, acumulado e datas em Brasília", () => {
  assert.equal(teacher.canvasTimeText(19200), "5h 20min");
  assert.equal(teacher.canvasTimeText(0), "0min");
  assert.equal(teacher.canvasTimeText(30), "<1min");
  for (const v of [null, undefined, NaN, Infinity, -1, "0"]) assert.equal(teacher.canvasTimeText(v), "Sem informação");
  assert.equal(teacher.canvasDateText("2026-10-20T01:00:00Z", true), "19/10/2026, 22:00");
  for (const v of [null, "invalid", "2026-02-30T00:00:00Z", "2026-10-20T01:00:00"]) assert.equal(teacher.canvasDateText(v), "Sem informação");
});

test("Canvas: mediana só dos ativos, zero válido e ausência fora dos inativos; sete dias é o limite", () => {
  const at = Date.parse(COLLECTION), week = 7 * 86400000;
  const rows = [row("1", "Zero", { canvasActivity: activity(0, new Date(at - 1000).toISOString()) }),
    row("2", "Antigo", { canvasActivity: activity(19200, new Date(at - week).toISOString()) }),
    row("3", "Sem dado", { canvasActivity: activity(null, null) }),
    row("4", "Saiu", { ...WITHDRAWN, canvasActivity: activity(999999, "2020-01-01T00:00:00Z") })];
  assert.deepEqual(teacher.canvasEngagementSummary(rows, at), { median: 9600, recent: 1, inactive: 1, unknown: 1, timeKnown: 2 });
  assert.equal(teacher.canvasActivityStatus(row("5", "Futuro", { canvasActivity: activity(0, "2099-01-01T00:00:00Z") }), at), "unknown");
  assert.equal(teacher.canvasEngagementSummary([]).median, null);
});

test("Canvas: filtro combina com Crítico/Atenção e busca; ordenação mantém desistentes ao fim e ausência após datas", () => {
  const now = Date.now(), old = new Date(now - 8 * 86400000).toISOString(), older = new Date(now - 20 * 86400000).toISOString();
  const rows = [row("1", "Crítica antiga", { status: "critical", canvasActivity: activity(0, old) }),
    row("2", "Atenção antiga", { status: "attention", canvasActivity: activity(10, older) }),
    row("3", "Crítica sem dado", { status: "critical" }), row("4", "Saiu", { ...WITHDRAWN, canvasActivity: activity(0, older) })];
  withState({ report: report(rows), canvasActivityFilter: "inactive", filter: "critical" }, () => {
    assert.deepEqual(teacher.filteredStudents().map((r) => r.id), ["1"]);
    state.filter = "attention"; assert.deepEqual(teacher.filteredStudents().map((r) => r.id), ["2"]);
    state.search = "zzz"; assert.deepEqual(teacher.filteredStudents(), []);
  });
  withState({ report: report(rows), sort: "last-activity" }, () => assert.deepEqual(teacher.filteredStudents().map((r) => r.id), ["2", "1", "3", "4"]));
});

test("Canvas: relatório antigo, coleta desatualizada e CSV pt-BR com duas colunas novas", () => {
  assert.match(strip(page()), /Engajamento no Canvas.*ainda não disponibilizou.*Coleta ainda não disponível/);
  const sample = row("1", "Aluno", { canvasActivity: activity(0, "2026-10-20T01:00:00Z") });
  const html = page({ report: report([sample], { canvasEngagement: { collectedAt: "2020-01-01T00:00:00Z" } }) });
  assert.match(strip(html), /Coleta desatualizada/);
  assert.match(html, /<time datetime="2026-10-20T01:00:00Z"/);
  const csv = teacher.studentsCsv([sample, row("2", "Sem dado")]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"Última atividade no Canvas \(Brasília\)";"Tempo no Canvas"/);
  assert.match(csv, /"19\/10\/2026, 22:00";"0min"/);
  assert.match(csv, /"Sem informação";"Sem informação"$/);
});

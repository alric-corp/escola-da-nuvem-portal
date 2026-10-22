// Publicações da turma (Expansão 5), sem navegador: a página renderizada como texto. O contrato é o de
// backend/portal.py::_report (instrutor): history com todos os registros PUB# (id, publishedAt, filename, base, publishedBy,
// changes = change_counts), publication (a versão em vigor), updatedAt e updateKind ("restore" depois de uma restauração).
// Aqui, o que a Expansão 5 decide: qual publicação está em vigor (pelo id, nunca pela posição), restauração sem trocar a
// data original, mudanças só com o que o contrato traz, comparação dita quando não é com a vizinha, Restaurar com o nome
// da publicação e parado durante a operação, estados e texto sempre escapado. Datas e horas: o mês e o dia das amostras
// são apresentados em Brasília, independentemente do fuso local do processo.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const history = await import("../frontend/pages/history.js");

const KEYS = ["previousCount", "currentCount", "studentsAdded", "studentsRemoved", "studentsUpdated", "activitiesAdded", "activitiesRemoved",
  "activitiesReleased", "activitiesPaused", "scalesChanged", "gradesChanged", "gradesAdded", "gradesRemoved"];
const counts = (c) => Object.fromEntries(KEYS.map((k) => [k, c[k] ?? 0]));
const SYNC = "system:canvas-sync";
const pub = (id, publishedAt, base, c, extra = {}) => ({ id, cohort: "BRSA0267", base, publishedAt, filename: "canvas-api.csv", publishedBy: SYNC, status: "published",
  changes: c === undefined ? undefined : counts(c), ...extra });
const P1 = pub("p1", "2026-08-28T20:31:00Z", null, { previousCount: 0, currentCount: 24, studentsAdded: 24, activitiesAdded: 166, activitiesReleased: 4 },
  { filename: "2026-08-28T1731_Notas-BRSA0267.csv", publishedBy: "uid-instrutor" });
const P2 = pub("p2", "2026-09-04T20:12:00Z", "p1", { previousCount: 24, currentCount: 25, studentsAdded: 1, gradesChanged: 61, activitiesReleased: 6, activitiesPaused: 1 },
  { filename: "2026-09-04T1712_Notas-BRSA0267.csv", publishedBy: "uid-instrutor" });
const P3 = pub("p3", "2026-10-07T21:05:00Z", "p2", { previousCount: 25, currentCount: 24, studentsRemoved: 1, gradesChanged: 21, gradesAdded: 19, gradesRemoved: 2 });
const P4 = pub("p4", "2026-10-09T21:04:00Z", "p3", { previousCount: 24, currentCount: 24, gradesChanged: 12, gradesAdded: 12 });
const P5 = pub("p5", "2026-10-10T21:04:00Z", "p4", { previousCount: 24, currentCount: 24, gradesChanged: 3, gradesAdded: 3, scalesChanged: 1, studentsUpdated: 1 });
const HISTORY = [P5, P4, P3, P2, P1];
const STUDENTS = Array.from({ length: 24 }, (_, i) => ({ id: String(i), name: `Aluno ${i}`, status: "ok" }));
const ACTIVITIES = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: `Atividade ${i}`, kind: "kc", active: i < 8 }));
const report = (extra = {}) => ({ cohort: "BRSA0267", publication: { ...P5, releasedAt: {} }, history: HISTORY, students: STUDENTS, activities: ACTIVITIES,
  updatedAt: P5.publishedAt, updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, canvasSync: { status: "unchanged", at: "2026-10-11T09:00:12Z", message: "" }, ...extra });
const restored = (extra = {}) => report({ publication: { ...P3, releasedAt: {} }, updateKind: "restore", updatedAt: "2026-10-11T12:10:00Z", ...extra });

const STATE_KEYS = ["me", "cohorts", "code", "report", "studentView", "view"];
function withState(values, fn) {
  const saved = Object.fromEntries(STATE_KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true, canvasCourseId: "4436" }],
    code: "BRSA0267", studentView: null, view: "history" }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
const page = (values = {}, view = {}) => withState({ report: report(), ...values }, () => history.historyPage(view));
// Texto como é lido: sem tags, espaços colapsados e sem espaço antes de vírgula (a vírgula da leitura assistiva).
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
const time = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const weekday = (iso) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" });
// Cada publicação do histórico: id, situação, origem, mudanças, nota de comparação e o botão Restaurar.
// As mudanças são uma lista dentro de cada publicação: cada entrada vai até a próxima (ou até o fim da lista do mês).
const entries = (html) => html.split(/(?=<li class="tpub-entry)/).slice(1).map((chunk) => {
  const [, cls, id] = chunk.match(/^<li class="tpub-entry([^"]*)" id="tpub-([^"]+)"/), body = chunk.split("</ol>")[0];
  return { id, current: / is-current/.test(cls), newer: / is-newer/.test(cls),
  heading: strip(body.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1] || ""),
  status: strip(body.match(/<p class="tpub-status[^"]*">([\s\S]*?)<\/p>/)?.[1] || "") || null,
  origin: strip(body.match(/<p class="tpub-origin">([\s\S]*?)<\/p>/)?.[1] || ""),
  facts: [...body.matchAll(/<li class="tpub-fact( is-attention)?">([\s\S]*?)<\/li>/g)].map(([, att, t]) => (att ? "! " : "") + strip(t)),
  note: strip(body.match(/<p class="tpub-note">([\s\S]*?)<\/p>/)?.[1] || "") || null,
  base: strip(body.match(/<p class="tpub-base">([\s\S]*?)<\/p>/)?.[1] || "") || null,
  restore: body.match(/<button type="button" class="text-link tpub-restore" data-restore="([^"]*)" aria-label="([^"]*)"([^>]*)>([^<]*)<\/button>/)?.slice(1, 5) || null,
  body };
});
// A região "Em vigor" vai do seu início até o histórico.
const region = (html) => strip(html.match(/<section class="tpub-current"[\s\S]*?(?=<section class="tpub-history"|$)/)?.[0] || "");

test("E5-U1: a publicação em vigor é a do relatório (pelo id), não a primeira da lista; depois de uma restauração, as mais recentes não estão em vigor", () => {
  // Normal: a mais recente em vigor, marcada uma vez; as outras sem rótulo repetido.
  let list = entries(page());
  assert.deepEqual(list.map((x) => x.id), ["p5", "p4", "p3", "p2", "p1"], "ordem do contrato, mais recentes primeiro");
  assert.deepEqual(list.map((x) => [x.current, x.status]), [[true, "Em vigor"], [false, null], [false, null], [false, null], [false, null]]);
  // Restaurada: p3 (07/10) volta a valer; p4 e p5 são mais recentes e não estão em vigor; p2 e p1 sem rótulo.
  list = entries(page({ report: restored() }));
  assert.deepEqual(list.map((x) => [x.id, x.current, x.newer, x.status]), [["p5", false, true, "Não está em vigor"], ["p4", false, true, "Não está em vigor"],
    ["p3", true, false, "Em vigor · versão restaurada"], ["p2", false, false, null], ["p1", false, false, null]]);
  // Sem a marca de restauração (updateKind de publicação), a mesma versão antiga em vigor não ganha "versão restaurada".
  list = entries(page({ report: restored({ updateKind: "publish" }) }));
  assert.equal(list.find((x) => x.current).status, "Em vigor");
  // A região "Em vigor" fala da publicação do relatório, não da primeira da lista.
  assert.match(region(page({ report: restored() })), /^Em vigor · versão restaurada .*Publicação de 7 de outubro de 2026/);
});

test("E5-U2: restauração com a data original da publicação e a data da restauração separadas; nada de restauração inventada", () => {
  const text = region(page({ report: restored() }));
  assert.match(text, new RegExp(`Publicação de 7 de outubro de 2026, ${weekday(P3.publishedAt)}, ${time(P3.publishedAt)}`));
  assert.match(text, new RegExp(`Restaurada em 11 de outubro de 2026, ${time("2026-10-11T12:10:00Z")}\\.`));
  assert.match(text, /A restauração não cria uma nova publicação: voltou a valer a versão de 7 de outubro de 2026, com as notas daquela publicação\./);
  assert.match(text, /As 2 publicações mais recentes que ela não estão em vigor\. Ver no histórico/);
  assert.match(page({ report: restored() }), /<a class="text-link" href="#tpub-p3">Ver no histórico<\/a>/);
  // Versão em vigor fora da lista do relatório: o aviso continua, sem atalho para um lugar que não existe.
  assert.doesNotMatch(page({ report: restored({ history: [P5, P4, P2, P1] }) }), /Ver no histórico/);
  // A sincronização automática continua: a consequência é dita, com o horário da próxima verificação.
  assert.match(text, /A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação \((hoje|amanhã) às \d+h\) publica uma nova versão\./);
  assert.doesNotMatch(region(page({ report: restored(), cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] })), /continua ligada/);
  // Sem curso do Canvas a sincronização não roda (backend/canvas_sync.py): nada de consequência, mesmo com autoSync.
  assert.doesNotMatch(region(page({ report: restored(), cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true, canvasCourseId: null }] })), /continua ligada/);
  // Sem restauração: nenhuma data de restauração, nenhum aviso de versões mais recentes, a data de publicação no título.
  const normal = region(page());
  assert.match(normal, new RegExp(`^Em vigor Publicação de 10 de outubro de 2026, ${weekday(P5.publishedAt)}, ${time(P5.publishedAt)}`));
  assert.doesNotMatch(normal, /Restaurada|restauração|mais recentes|Ver no histórico/);
  // O que a região diz da versão: origem, alunos e atividades liberadas (do relatório da versão em vigor).
  assert.match(normal, /Sincronização com o Canvas · 24 alunos · 8 de 10 atividades liberadas/);
});

test("E5-U3: mudanças só com o que o contrato traz, com o que pede atenção marcado; primeira publicação, sem mudança e registro antigo", () => {
  const list = entries(page());
  assert.equal(list.length, 5, "uma entrada por publicação");
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.deepEqual(by.p5.facts, ["3 notas alteradas", "1 cadastro alterado", "1 pontuação máxima alterada"]);
  assert.deepEqual(by.p4.facts, ["12 notas alteradas"]);
  assert.deepEqual(by.p3.facts, ["! 21 notas alteradas (2 removidas)", "! 1 aluno removido"]);
  assert.deepEqual(by.p2.facts, ["61 notas alteradas", "1 aluno adicionado", "6 atividades liberadas", "! 1 atividade retirada do cálculo"]);
  assert.deepEqual([by.p1.facts, by.p1.note], [[], "Primeira publicação da turma: 24 alunos e 166 atividades, 4 liberadas."]);
  // Publicação manual com o mesmo conteúdo da versão em vigor antes dela.
  const same = pub("p6", "2026-10-11T14:02:00Z", "p5", { previousCount: 24, currentCount: 24 }, { publishedBy: "uid-instrutor", filename: "igual.csv" });
  const six = entries(page({ report: report({ history: [same, ...HISTORY], publication: same }) }))[0];
  assert.deepEqual([six.facts, six.note], [[], "Nenhuma mudança em relação à versão em vigor antes dela."]);
  // Registros antigos: sem changes (texto de antes) e sem gradesRemoved (anteriores a 26/09/2026): nada de "(0 removidas)".
  const legacy = { ...P2, changes: undefined }, partial = { ...P3, changes: { studentsAdded: 0, studentsRemoved: 0, gradesChanged: 7, activitiesReleased: 0, activitiesPaused: 0 } };
  const old = entries(page({ report: report({ history: [P5, P4, partial, legacy, P1] }) }));
  assert.deepEqual([old[2].facts, old[2].note], [["7 notas alteradas"], null]);
  assert.deepEqual([old[3].facts, old[3].note], [[], "Comparação indisponível para esta publicação antiga."]);
  // Registro anterior à base (sem base e sem previousCount) não é "primeira publicação": mostra o que o contrato traz.
  const noBase = entries(page({ report: report({ history: [P5, { ...P4, base: undefined, changes: { studentsAdded: 0, studentsRemoved: 0, gradesChanged: 12, activitiesReleased: 0, activitiesPaused: 0 } }, P3, P2, P1] }) }))[1];
  assert.deepEqual([noBase.facts, noBase.note], [["12 notas alteradas"], null]);
  // Origem: sincronização, envio manual com o arquivo, ou só o arquivo quando o registro não diz quem publicou.
  assert.deepEqual([by.p5.origin, by.p1.origin], ["Sincronização com o Canvas", "Envio manual 2026-08-28T1731_Notas-BRSA0267.csv"]);
  const unknown = entries(page({ report: report({ history: [{ ...P5, publishedBy: undefined }, P4] }) }))[0];
  assert.equal(unknown.origin, "Arquivo canvas-api.csv");
});

test("E5-U4: a comparação é com a versão que estava em vigor (base); dita só quando não é a publicação logo abaixo", () => {
  // Depois da restauração de p3, uma publicação manual (base p3) fica acima de p5: comparada com p3, não com p5.
  const p6 = pub("p6", "2026-10-11T16:20:00Z", "p3", { previousCount: 24, currentCount: 24, gradesChanged: 2 }, { publishedBy: "uid-instrutor", filename: "correcao.csv" });
  const list = entries(page({ report: report({ history: [p6, ...HISTORY], publication: p6, updateKind: "publish" }) }));
  assert.equal(list.length, 6, "uma entrada por publicação");
  assert.equal(list[0].base, `Em relação à publicação de 7 de outubro de 2026, ${time(P3.publishedAt)}, que estava em vigor.`);
  assert.deepEqual(list.slice(1).map((x) => x.base), [null, null, null, null, null], "nas outras a base é a de baixo: nada a dizer");
  // Base fora da lista: nenhuma data inventada.
  const orphan = entries(page({ report: report({ history: [{ ...p6, base: "sumiu" }, ...HISTORY], publication: p6 }) }))[0];
  assert.equal(orphan.base, null);
});

test("E5-U5: Restaurar só fora da versão em vigor, com o nome da publicação; parado em todas durante uma restauração", () => {
  const list = entries(page());
  assert.equal(list.length, 5, "uma entrada por publicação");
  assert.equal(list[0].restore, null, "a versão em vigor não tem Restaurar");
  assert.deepEqual(list[1].restore, ["p4", `Restaurar a publicação de 9 de outubro de 2026, ${time(P4.publishedAt)}`, "", "Restaurar"]);
  assert.equal(list.filter((x) => x.restore).length, 4);
  // Durante a restauração de p4: todos os Restaurar parados e apontando para o andamento, que fica em p4.
  const busy = page({}, { restoring: "p4" });
  for (const x of entries(busy).filter((x) => x.restore)) assert.equal(x.restore[2], ' disabled aria-describedby="tpub-restore-status"', x.id);
  assert.match(entries(busy)[1].body, new RegExp(`<p class="tpub-op is-busy" id="tpub-restore-status" role="status" tabindex="-1">Restaurando a publicação de 9 de outubro de 2026, ${time(P4.publishedAt)}…</p>`));
  // Erro definitivo (409): na publicação, com a mensagem do servidor e a ação de consultar a atualização.
  const failed = page({}, { error: { publicationId: "p2", message: "A turma foi atualizada. Recarregue o histórico.", conflict: true } });
  const two = entries(failed)[3];
  assert.match(two.body, /<div class="tpub-op is-error" id="tpub-restore-status" role="alert" tabindex="-1"><p><strong>A publicação não foi restaurada\.<\/strong> <span>A turma foi atualizada\. Recarregue o histórico\.<\/span><\/p><button type="button" class="text-link" data-action="refresh-report">Consultar atualização<\/button><\/div>/);
  assert.equal(two.restore[2], ' aria-describedby="tpub-restore-status"', "o Restaurar volta a funcionar e aponta para o motivo");
  // Sem resposta do servidor: não diz que falhou nem que deu certo.
  const unsure = entries(page({}, { error: { publicationId: "p2", message: "A conexão com o portal falhou.", unsure: true } }))[3];
  assert.match(strip(unsure.body), /Não foi possível confirmar a restauração\. A conexão com o portal falhou\. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo\. Consultar atualização/);
  // Erro definitivo sem conflito (403): sem ação de consultar.
  const denied = entries(page({}, { error: { publicationId: "p2", message: "Você não tem acesso a esta operação." } }))[3];
  assert.doesNotMatch(denied.body, /refresh-report/);
  // Confirmação só no estado restaurado, na região "Em vigor".
  assert.match(page({ report: restored() }, { restored: { publicationId: "p3" } }), /<p class="tpub-op is-done" id="tpub-restore-status" role="status" tabindex="-1">Publicação restaurada\.<\/p>/);
  assert.doesNotMatch(page({ report: restored() }), /tpub-restore-status/);
});

test("E5-U6: histórico por mês, com quantas publicações e o período; datas por extenso com dia da semana e hora", () => {
  const html = page();
  assert.deepEqual([...html.matchAll(/<h3 class="tpub-month-title">([^<]*)<span>([^<]*)<\/span><\/h3>/g)].map(([, m, n]) => [m.trim(), n.trim()]),
    [["Outubro de 2026", "3 publicações"], ["Setembro de 2026", "1 publicação"], ["Agosto de 2026", "1 publicação"]]);
  assert.match(strip(html), /Histórico de publicações 5 publicações, de 28 de agosto a 10 de outubro de 2026\./);
  assert.equal(entries(html)[0].heading, `Publicação de 10 de outubro de 2026, ${weekday(P5.publishedAt)}, ${time(P5.publishedAt)}`);
  assert.match(entries(html)[0].body, /<time datetime="2026-10-10T21:04:00Z">10 de outubro<\/time>/);
  // Data inválida: dito com palavras, no fim, sem quebrar a página.
  const bad = page({ report: report({ history: [...HISTORY, { ...P1, id: "px", publishedAt: "não é data" }] }) });
  assert.equal(entries(bad).at(-1).heading, "Data não informada");
});

test("E5-U7: estados — sem publicação, carregamento e erro na composição da tela", () => {
  assert.equal(typeof history.teacherPublicationsState, "function", "composição dos estados da tela");
  const empty = withState({ report: { cohort: "BRSA0267", publication: null, students: [], history: [], thresholds: { kc: 70, lab: 95 } } }, () => history.historyPage());
  assert.match(strip(empty), /^Publicações da turma .* As atualizações publicadas aparecerão aqui\. A primeira chega pela sincronização com o Canvas \(próxima verificação: (hoje|amanhã) às \d+h\) ou por um CSV publicado em Atualizar notas\.$/);
  assert.doesNotMatch(empty, /tpub-current|Histórico de publicações/);
  const manual = withState({ cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }], report: { cohort: "BRSA0267", publication: null, students: [], history: [] } }, () => history.historyPage());
  assert.match(strip(manual), /As atualizações publicadas aparecerão aqui\. Publique o CSV do Canvas em Atualizar notas para criar a primeira\.$/);
  const noCourse = withState({ cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true, canvasCourseId: null }], report: { cohort: "BRSA0267", publication: null, students: [], history: [] } }, () => history.historyPage());
  assert.match(strip(noCourse), /Publique o CSV do Canvas em Atualizar notas para criar a primeira\.$/, "sem curso do Canvas não há sincronização");
  assert.equal(history.teacherPublicationsState('<section class="panel empty" role="status">Carregando sua turma…</section>'),
    '<div class="teacher-publications"><section class="panel empty" role="status">Carregando sua turma…</section></div>');
  assert.match(history.teacherPublicationsState("<p>erro</p>", true), /^<div class="teacher-publications"><div class="page-heading"><div><h1>Publicações da turma<\/h1>/);
  // Sem autoSync, a região diz como as notas mudam; com falha da sincronização, o texto inteiro.
  const failed = region(page({ report: report({ canvasSync: { status: "failed", at: "2026-10-11T09:00:12Z", message: "Token do Canvas expirado." } }) }));
  assert.match(failed, new RegExp(`A atualização automática pelo Canvas falhou em 11 de outubro de 2026, ${time("2026-10-11T09:00:12Z")}: Token do Canvas expirado\\. As notas exibidas são da última publicação bem-sucedida\\.`));
  const noAuto = region(page({ cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] }));
  assert.match(noAuto, /Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado em Atualizar notas\. Consultar atualização$/);
});

test("E5-U8: confirmação da restauração diz qual publicação, qual sai de vigor e a consequência da sincronização; texto escapado", () => {
  assert.equal(typeof history.restoreQuestion, "function", "pergunta da restauração vem da página");
  const question = withState({ report: report() }, () => history.restoreQuestion("p3"));
  assert.equal(question.split("\n\n")[0], `Restaurar a publicação de 7 de outubro de 2026, ${time(P3.publishedAt)}?`);
  assert.equal(question.split("\n\n")[1], `Os alunos passarão a ver as notas desta versão. A versão em vigor agora, publicada em 10 de outubro de 2026, ${time(P5.publishedAt)}, continua no histórico.`);
  assert.match(question.split("\n\n")[2], /^A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação \((hoje|amanhã) às \d+h\) publica uma nova versão\.$/);
  const manual = withState({ report: report(), cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] }, () => history.restoreQuestion("p3"));
  assert.equal(manual.split("\n\n").length, 2);
  // Publicação desconhecida: a pergunta de antes.
  assert.equal(withState({ report: report() }, () => history.restoreQuestion("sumiu")), "Restaurar esta publicação? Os alunos passarão a ver as notas desta versão.");
  // Arquivo e mensagens do servidor como texto.
  const evil = pub("p9", "2026-10-11T16:00:00Z", "p5", { gradesChanged: 1 }, { publishedBy: "uid", filename: '<img src=x onerror="alert(1)">.csv' });
  const html = page({ report: report({ history: [evil, ...HISTORY] }) }, { error: { publicationId: "p9", message: "<b>falhou</b>" } });
  assert.doesNotMatch(html, /<img|<b>falhou/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;\.csv/);
  assert.match(html, /&lt;b&gt;falhou&lt;\/b&gt;/);
});

test("E5-U9: Meu histórico do aluno continua o mesmo (a página do aluno não usa nada da do instrutor)", () => {
  const student = withState({ cohorts: [{ code: "BRSA0267", canTeach: false }], report: { cohort: "BRSA0267", publication: { id: "p5", publishedAt: P5.publishedAt },
    history: [{ publishedAt: P5.publishedAt, current: true, kc: 80, lab: 96, total: 88, changes: null }], updateKind: "canvas", updatedAt: P5.publishedAt } }, () => history.historyPage({ restoring: "p5" }));
  assert.match(student, /^<div class="student-history">/);
  assert.doesNotMatch(student, /tpub-|teacher-publications|data-restore/);
});

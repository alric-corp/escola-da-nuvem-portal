// Atualizar notas (Expansão 6), sem navegador: a página renderizada como texto e o handler da publicação com transporte
// falso. O contrato é o de backend/portal.py::_preview (= _save_draft + _integrity: draft, activities com filled, students,
// count, warnings, changes de changes.snapshot_changes, integrity de integrity.check) e _publish. Aqui, o que a Expansão 6
// decide: três etapas na ordem da tarefa, o nome do arquivo uma vez e o seletor nativo fora da vista, a versão em vigor no
// contexto, só o que muda, as atividades sem notas atrás de "Mostrar", Publicar antes dos resultados por aluno com o motivo
// ao lado quando parado, andamento e erros junto da ação, a pergunta da publicação e a troca de usuário durante a publicação.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const importPage = await import("../frontend/pages/import.js");
const importHandlers = await import("../frontend/handlers/import.js");
const api = await import("../frontend/api.js");

const ACTIVITIES = [
  { id: "10- CF - KC — S3 (2891001)", name: "10- CF - KC — S3", kind: "kc", points: "100.00", active: true, filled: 24 },
  { id: "11--Lab - EC2 (2891002)", name: "11--Lab - EC2", kind: "lab", points: "10.00", active: true, filled: 1 },
  { id: "119- PF -KC - Python (2893119)", name: "119- PF -KC - Python", kind: "kc", points: "2.5", active: false, filled: 3 },
  { id: "195-CERT-KC (2893195)", name: "195-CERT-KC", kind: "kc", points: "1", active: false, filled: 0 },
  { id: "196-CERT-Lab (2893196)", name: "196-CERT-Lab", kind: "lab", points: "100.00", active: false, filled: 0 },
];
const CHANGES = { previousCount: 24, currentCount: 24, studentsAdded: [], studentsRemoved: [], studentsUpdated: [{ id: "31006", name: "Felipe Lacerda" }],
  activitiesAdded: [], activitiesRemoved: [], activitiesReleased: [{ id: ACTIVITIES[1].id, name: ACTIVITIES[1].name }], activitiesPaused: [], scalesChanged: [],
  gradesChanged: 3, gradesAdded: 2, gradesRemoved: 1, gradeDetails: [{ student: "Ana Lima", activity: "10- CF - KC — S3", before: null, after: "62.50" },
    { student: "Bruno Reis", activity: "11--Lab - EC2", before: "7.00", after: "9.5" }, { student: "Carla Dias", activity: "10- CF - KC — S3", before: "80.00", after: null }] };
const SUMMARY = { studentsFound: 24, activitiesFound: 5, canvasConfigured: true, rosterCapturedAt: "2026-10-11T12:00:12Z", studentsExpected: 24,
  studentsExtra: 0, studentsMissing: 0, activitiesKnown: 5, activitiesReference: "catalog" };
const STUDENTS = [{ id: "31000", name: "Ana Lima", email: "ana@example.test", kc: 77, lab: 56.5, pending: 1, status: "attention" },
  { id: "31001", name: "Bruno Reis", email: null, kc: 60.75, lab: 62.25, pending: 2, status: "critical" }];
const preview = (extra = {}) => ({ draft: { id: "d1", cohort: "BRSA0267", base: "p13", status: "draft", filename: "2026-10-11T1450_Notas-BRSA0267.csv" },
  activities: ACTIVITIES.map((a) => ({ ...a })), students: STUDENTS, count: 24, warnings: ["Linha 27: aluno de teste do Canvas ignorado; não entra nas notas da turma."],
  changes: CHANGES, integrity: { critical: [], warnings: [], summary: SUMMARY }, ...extra });
const PUBLICATION = { id: "p13", publishedAt: "2026-10-10T21:04:00Z", filename: "canvas-api.csv", publishedBy: "system:canvas-sync" };
const report = (extra = {}) => ({ cohort: "BRSA0267", publication: PUBLICATION, updatedAt: PUBLICATION.publishedAt, updateKind: "canvas", history: [PUBLICATION], ...extra });

const KEYS = ["me", "cohorts", "code", "report", "reportError", "studentView", "view", "preview", "csv", "filename", "dirty", "acknowledgeRemoved", "importLoading"];
function withState(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true, canvasCourseId: "4436" }],
    code: "BRSA0267", report: report(), reportError: "", studentView: null, view: "import", preview: null, csv: "", filename: "", dirty: false, acknowledgeRemoved: false,
    importLoading: false }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
async function withStateAsync(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: true, canvasCourseId: "4436" }],
    code: "BRSA0267", report: report(), reportError: "", studentView: null, view: "import", preview: null, csv: "", filename: "", dirty: false, acknowledgeRemoved: false,
    importLoading: false }, values);
  try { return await fn(); } finally { Object.assign(state, saved); }
}
const page = (values = {}, view = {}) => withState(values, () => importPage.importPage(view));
const withFile = { csv: "Student,ID\n", filename: "2026-10-11T1450_Notas-BRSA0267.csv" };
const ready = (extra = {}, values = {}) => ({ ...withFile, preview: preview(extra), ...values });
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.:])/g, "$1").trim();
// Partes da página: cada etapa (li) e os resultados.
// Pré-condições com asserção: a estrutura existe antes de ser lida (o RED falha por asserção, não por TypeError).
const steps = (html) => {
  const list = html.split(/(?=<li class="timp-step )/).slice(1).map((chunk) => chunk.split(/<\/li><li class="timp-step |<\/ol>/)[0]);
  assert.equal(list.length, 3, "três etapas: Arquivo do Canvas, Prévia e Publicação");
  return list;
};
const contextOf = (html) => {
  const found = html.match(/<div class="timp-context">[\s\S]*?<\/div>/);
  assert.ok(found, "contexto da operação: versão em vigor e atualização automática");
  return found[0];
};
const block = (html, id) => html.match(new RegExp(`<section class="timp-block[^"]*" aria-labelledby="${id}">[\\s\\S]*?</section>`))?.[0] || "";
const time = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

test("E6-U1: três etapas na ordem da tarefa; antes da prévia, a 2 e a 3 dizem o que vem nelas; o arquivo escolhido aparece uma vez", () => {
  const empty = page();
  assert.match(empty, /^<div class="teacher-import">/);
  assert.match(empty, /<h1>Atualizar notas da BRSA0267<\/h1><p>Importe, confira e publique\. Os alunos verão as notas somente após a publicação\.<\/p>/);
  const [one, two, three] = steps(empty);
  assert.deepEqual([one, two, three].map((s) => strip(s.match(/<h2[^>]*>[\s\S]*?<\/h2>/)[0])), ["1 Arquivo do Canvas", "2 Prévia", "3 Publicação"]);
  assert.match(strip(two), /Depois de conferir o arquivo: integridade, o que muda ao publicar e as atividades liberadas\./);
  assert.match(strip(three), /Depois da prévia: publicar substitui as notas atuais da turma\./);
  assert.match(one, /class="timp-step-body timp-file is-action"/, "sem prévia, o arquivo é a ação (a superfície)");
  // O seletor nativo: o mesmo id, tipo e formatos aceitos; descrito pelo nome do arquivo e pelos limites reais.
  assert.match(one, /<input id="csv-file" class="timp-input" type="file" accept="\.csv,text\/csv" aria-describedby="timp-file-name timp-file-hint">/);
  assert.match(one, /<label for="csv-file" class="button secondary timp-choose">Escolher arquivo<\/label><p class="timp-file-name" id="timp-file-name">Nenhum arquivo selecionado<\/p>/);
  assert.match(strip(one), /CSV original exportado do Canvas, com a turma completa · UTF-8, com a linha Points Possible · até 2 MB/);
  assert.match(one, /<button class="button primary" type="submit">Conferir arquivo [^]*?<\/button><p class="timp-check-note">Conferir não publica: mostra a prévia e o que muda\.<\/p>/);
  // Arquivo escolhido: o nome uma vez, o botão vira "Trocar arquivo"; nenhuma prévia ainda.
  const picked = page(withFile);
  assert.equal((picked.match(/2026-10-11T1450_Notas-BRSA0267\.csv/g) || []).length, 1);
  assert.match(picked, />Trocar arquivo<\/label>/);
  assert.doesNotMatch(picked, /data-action="publish"|Conferência dos resultados/);
  // Com prévia: as três etapas com conteúdo, a publicação é a superfície, e os resultados por aluno vêm depois das etapas.
  const html = page(ready());
  const [file, review, publish] = steps(html);
  assert.match(file, /class="timp-step-body timp-file"/);
  assert.doesNotMatch(file, /type="submit"/, "com prévia, a conferência fica junto das atividades");
  assert.match(review, /<h2 class="timp-step-title" id="timp-review-title" tabindex="-1">/);
  assert.match(publish, /class="timp-step-body timp-publish is-action"/);
  assert.ok(html.indexOf('data-action="publish"') < html.indexOf("Conferência dos resultados"), "Publicar antes dos resultados por aluno");
  assert.ok(html.indexOf("integrity-heading") < html.indexOf("timp-changes-title") && html.indexOf("timp-changes-title") < html.indexOf("timp-warnings-title")
    && html.indexOf("timp-warnings-title") < html.indexOf("timp-activities-title"), "Integridade, O que muda, Avisos e as atividades, nessa ordem");
});

test("E6-U2: contexto — a versão em vigor (data, origem, restauração) e de onde mais vêm as notas; carregando, erro e turma sem publicação", () => {
  const ctx = (values) => strip(contextOf(page(values)));
  assert.match(ctx({}), /(hoje|amanhã) às \d+h/);
  assert.equal(ctx({}), `Em vigor Publicação de ${time(PUBLICATION.publishedAt)} · Sincronização com o Canvas Esta turma é atualizada automaticamente pelo Canvas. A próxima verificação é ${ctx({}).match(/(hoje|amanhã) às \d+h/)[0]}. Use o envio manual só se precisar publicar antes disso ou se a atualização automática falhar.`);
  const manual = { ...PUBLICATION, id: "p14", filename: "notas <b>.csv", publishedBy: "uid-instrutor" };
  assert.match(ctx({ report: report({ publication: manual }) }), /Publicação de .* · Envio manual notas &lt;b&gt;\.csv/);
  assert.match(page({ report: report({ publication: manual }) }), /notas &lt;b&gt;\.csv/, "nome do arquivo escapado");
  assert.match(ctx({ report: report({ publication: { ...manual, publishedBy: undefined } }) }), /· Arquivo notas &lt;b&gt;\.csv/);
  assert.match(ctx({ report: report({ updateKind: "restore", updatedAt: "2026-10-11T12:10:00Z" }) }), new RegExp(`· restaurada em ${time("2026-10-11T12:10:00Z")}`));
  assert.match(ctx({ report: report({ publication: null }) }), /^Em vigor A turma ainda não tem notas publicadas\./);
  assert.match(ctx({ report: null }), /^Em vigor Consultando a versão em vigor…/);
  const failed = page({ report: null, reportError: "Falha <x>" });
  assert.match(strip(contextOf(failed)), /Não foi possível consultar a versão em vigor: Falha &lt;x&gt; Consultar atualização/);
  assert.match(failed, /Falha &lt;x&gt; <button type="button" class="text-link" data-action="refresh-report">Consultar atualização<\/button>/);
  assert.match(ctx({ cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] }), /Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado aqui\./);
});

test("E6-U3: prévia — de qual arquivo, integridade (verificações, críticos com IDs, avisos) e nenhum e-mail", () => {
  const html = page(ready());
  const [, review] = steps(html);
  assert.match(strip(review), /2 Prévia 2026-10-11T1450_Notas-BRSA0267\.csv · 24 alunos · 2 de 5 atividades liberadas/);
  const integrity = strip(block(html, "integrity-heading"));
  assert.match(integrity, /^Integridade Alunos 24 esperados · 24 encontrados · 0 extras · 0 ausentes Atividades 5 encontradas · IDs compatíveis com o curso/);
  assert.match(integrity, new RegExp(`Matrícula conferida com o Canvas em ${time(SUMMARY.rosterCapturedAt)}\\. Alunos matriculados depois disso só aparecem após a próxima sincronização automática\\.`));
  assert.match(block(html, "integrity-heading"), /<li class="is-ok">IDs conferem com a matrícula do Canvas<\/li><li class="is-ok">atividades compatíveis com a turma<\/li><li class="is-ok">estrutura válida<\/li>/);
  const blocked = page(ready({ integrity: { critical: [{ code: "studentNotInRoster", count: 3, message: "3 aluno(s) não pertence(m) à turma no Canvas.", ids: ["999999", "999998"] }],
    warnings: [{ code: "testFilename", count: 1, message: "Este arquivo parece ser de teste." }], summary: { ...SUMMARY, studentsFound: 27, studentsExtra: 3 } } }));
  const b = block(blocked, "integrity-heading");
  assert.match(b, /<li class="is-fail">IDs não conferem com a matrícula do Canvas<\/li>/);
  assert.match(b, /<div class="timp-issues is-critical" role="alert"><p><strong>Publicação bloqueada: corrija o arquivo e confira de novo\.<\/strong><\/p><ul><li><strong>3 aluno\(s\) não pertence\(m\) à turma no Canvas\.<\/strong><small>Canvas IDs 999999, 999998 e mais 1<\/small><\/li><\/ul><\/div>/);
  assert.match(strip(b), /Avisos \(não impedem publicar\) Este arquivo parece ser de teste\./);
  assert.doesNotMatch(strip(b), /@/);
  // Sem curso do Canvas: a quantidade de alunos é conferida com a publicação atual.
  const noCanvas = block(page(ready({ integrity: { critical: [], warnings: [{ code: "rosterNotVerified", count: 1, message: "Matrícula não conferida: turma sem curso Canvas configurado." }],
    summary: { ...SUMMARY, canvasConfigured: false, rosterCapturedAt: null, studentsExpected: null, activitiesReference: "publication" } } })), "integrity-heading");
  assert.match(strip(noCanvas), /Alunos 24 alunos encontrados Atividades 5 encontradas · IDs compatíveis com o arquivo publicado/);
  assert.match(noCanvas, /<li class="is-ok">quantidade de alunos compatível com a publicação atual<\/li>/);
  assert.doesNotMatch(noCanvas, /Matrícula conferida/);
});

test("E6-U4: o que muda — só o que muda, com os nomes ao abrir; removidos e atividades que saem do cálculo em destaque; o resto numa linha", () => {
  const changes = block(page(ready()), "timp-changes-title");
  const rows = [...changes.matchAll(/<li class="timp-change( is-attention)?"><details><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details><\/li>/g)].map(([, att, s, body]) => [att ? "!" : "", strip(s), strip(body)]);
  assert.deepEqual(rows.map((r) => r.slice(0, 2)), [["!", "3 notas alteradas (2 notas novas, 1 removida)"], ["", "1 atividade será liberada"], ["", "1 cadastro alterado"]]);
  assert.equal(rows[0][2], "Notas na escala original do Canvas, antes da conversão para percentual. Até 100 alterações são exibidas. Ana Lima 10- CF - KC — S3 antes: Sem nota →, depois: 62,5 Bruno Reis 11--Lab - EC2 antes: 7 →, depois: 9,5 Carla Dias 10- CF - KC — S3 antes: 80 →, depois: Sem nota");
  assert.deepEqual(rows.slice(1).map((r) => r[2]), ["11--Lab - EC2", "Felipe Lacerda"]);
  assert.match(strip(changes), /Alunos: 24 → 24\. O arquivo substitui a publicação anterior por completo\./);
  assert.match(strip(changes), /Sem mudança em: alunos adicionados, alunos removidos, atividades adicionadas, atividades removidas, pontuações máximas\.$/);
  // Remoção: alerta com os nomes; a confirmação fica na etapa Publicação. Atividade que sai do cálculo: alerta com a lista.
  const removal = block(page(ready({ changes: { ...CHANGES, previousCount: 25, studentsRemoved: [{ id: "31023", name: "Zeca <Tavares>" }], activitiesPaused: [{ id: "x", name: "255--Lab" }, { id: "y", name: "254-NF" }] } })), "timp-changes-title");
  assert.match(removal, /<div class="timp-alert" role="alert"><p><strong>Atenção: 1 aluno deixa de aparecer na publicação atual\.<\/strong> Confira se exportou a turma completa\. O histórico permanece guardado\.<\/p><ul class="timp-names"><li>Zeca &lt;Tavares&gt;<\/li><\/ul><p>Para publicar, confirme a remoção na etapa Publicação\.<\/p><\/div>/);
  assert.match(strip(removal), /Atenção: 2 atividades saem do cálculo nesta publicação\. Elas estavam liberadas na publicação atual e ficarão fora da média até serem liberadas de novo\. 255--Lab 254-NF/);
  assert.match(removal, /<li class="timp-change is-attention"><details><summary>1 aluno removido<\/summary>/);
  assert.doesNotMatch(removal, /id="acknowledge-removed"/, "a confirmação não fica no alerta");
  // Sem mudança nenhuma; prévia sem comparação.
  const none = block(page(ready({ changes: { ...CHANGES, studentsUpdated: [], activitiesReleased: [], gradesChanged: 0, gradesAdded: 0, gradesRemoved: 0, gradeDetails: [] } })), "timp-changes-title");
  assert.doesNotMatch(none, /timp-change-list/);
  assert.match(strip(none), /Nenhuma mudança em relação à publicação em vigor\.$/);
  assert.match(strip(block(page(ready({ changes: undefined })), "timp-changes-title")), /^O que muda ao publicar A comparação não está disponível nesta prévia\.$/);
});

test("E6-U5: atividades — na ordem do curso, com id em cada caixa; tipo, notas e pontuação; mais de 6 sem notas ficam atrás de Mostrar (à vista se alguma estiver marcada)", () => {
  const html = block(page(ready()), "timp-activities-title");
  assert.match(strip(html), /^O que já foi liberado\? A seleção inicial usa as notas preenchidas\. Confirme as atividades que entram no cálculo\. 2 de 5 atividades liberadas/);
  const options = (h) => [...h.matchAll(/<input id="(timp-activity-\d+)" type="checkbox" data-activity="([^"]*)"([^>]*)>[\s\S]*?<span class="timp-option-meta">([\s\S]*?)<\/span><\/span><\/label>/g)].map(([, id, a, attrs, meta]) => [id, a, / checked/.test(attrs), strip(meta)]);
  assert.deepEqual(options(html), [
    ["timp-activity-0", ACTIVITIES[0].id, true, "KC · 24 notas preenchidas · máximo 100 pontos"],
    ["timp-activity-1", ACTIVITIES[1].id, true, "LAB · 1 nota preenchida · máximo 10 pontos"],
    ["timp-activity-2", ACTIVITIES[2].id, false, "KC · 3 notas preenchidas · máximo 2,5 pontos"],
    ["timp-activity-3", ACTIVITIES[3].id, false, "KC · 0 notas preenchidas · máximo 1 ponto"],
    ["timp-activity-4", ACTIVITIES[4].id, false, "LAB · 0 notas preenchidas · máximo 100 pontos"]]);
  assert.doesNotMatch(html, /timp-unfilled/, "com até 6 sem notas, a lista inteira, sem esconder nada");
  // O curso inteiro no arquivo (mais de 6 sem notas): as com notas à vista e as outras atrás do botão que diz quantas são.
  const course = [...ACTIVITIES, ...Array.from({ length: 7 }, (_, i) => ({ id: `3${i}-KC (${i})`, name: `3${i}-KC`, kind: "kc", points: "100.00", active: false, filled: 0 }))];
  const many = block(page(ready({ activities: course })), "timp-activities-title");
  assert.deepEqual(options(many).map(([id]) => id), ["timp-activity-0", "timp-activity-1", "timp-activity-2", "timp-activity-3", "timp-activity-4", ...[5, 6, 7, 8, 9, 10, 11].map((i) => `timp-activity-${i}`)]);
  assert.match(many, /<\/ul>\s*<button type="button" class="text-link timp-more" id="timp-unfilled-toggle" data-import-unfilled aria-expanded="false" aria-controls="timp-unfilled">Mostrar as 9 atividades sem notas preenchidas<\/button><ul class="timp-option-list is-unfilled" role="list" id="timp-unfilled" aria-label="Atividades sem notas preenchidas" hidden>/);
  const visible = many.split('id="timp-unfilled"')[0];
  assert.deepEqual(options(visible).map(([id]) => id), ["timp-activity-0", "timp-activity-1", "timp-activity-2"], "à vista, só as com notas");
  const open = block(page(ready({ activities: course }), { showUnfilled: true }), "timp-activities-title");
  assert.match(open, /aria-expanded="true" aria-controls="timp-unfilled">Ocultar as 9 atividades sem notas preenchidas<\/button><ul class="timp-option-list is-unfilled" role="list" id="timp-unfilled" aria-label="Atividades sem notas preenchidas">/);
  // Uma sem notas marcada (liberada antes): fica à vista, sem botão para escondê-la.
  const forced = block(page(ready({ activities: course.map((a, i) => ({ ...a, active: i === 8 || a.active })) })), "timp-activities-title");
  assert.doesNotMatch(forced, /timp-unfilled-toggle/);
  assert.match(forced, /id="timp-unfilled" aria-label="Atividades sem notas preenchidas">/);
  // Conferindo de novo ou publicando: caixas paradas. Atualizar prévia junto das atividades (o mesmo formulário).
  assert.equal((block(page(ready({}, { importLoading: true })), "timp-activities-title").match(/type="checkbox"[^>]* disabled/g) || []).length, 5);
  assert.equal((block(page(ready(), { publishing: true }), "timp-activities-title").match(/type="checkbox"[^>]* disabled/g) || []).length, 5);
  assert.match(html, /<button class="button secondary" type="submit" form="import-form">Atualizar prévia<\/button>/);
});

test("E6-U6: publicação — consequência, confirmação dos removidos junto do botão, motivo quando Publicar está parado e as mesmas condições de antes", () => {
  const publish = (values = {}, view = {}) => steps(page(values, view))[2];
  const ok = publish(ready());
  assert.match(strip(ok), /^3 Publicação Publicar substitui as notas atuais da turma pelo arquivo completo da BRSA0267\. A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação \((hoje|amanhã) às \d+h\) publica uma nova versão\. Publicar atualização$/);
  assert.match(ok, /<button class="button primary" data-action="publish">Publicar atualização/);
  assert.doesNotMatch(publish(ready({}, { cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] })), /continua ligada/);
  // Removidos: a confirmação (o mesmo id) junto do botão; sem ela, Publicar parado com o motivo, ligado ao botão.
  const removed = ready({ changes: { ...CHANGES, studentsRemoved: [{ id: "1", name: "A" }, { id: "2", name: "B" }] } });
  const pending = publish(removed);
  assert.match(pending, /<label class="timp-ack"><input id="acknowledge-removed" type="checkbox"><span>Conferi e confirmo a remoção de 2 alunos nesta publicação\.<\/span><\/label>/);
  assert.match(pending, /<p class="timp-reason" id="timp-publish-reason"><span>Confira e confirme os alunos removidos antes de publicar\.<\/span><\/p>/);
  assert.match(pending, /data-action="publish" disabled aria-describedby="timp-publish-reason"/);
  assert.match(publish({ ...removed, acknowledgeRemoved: true }), /<input id="acknowledge-removed" type="checkbox" checked>[\s\S]*data-action="publish">/);
  // Bloqueada e seleção alterada: o motivo de antes, com prioridade para o bloqueio.
  const blocked = ready({ integrity: { critical: [{ code: "studentNotInRoster", count: 1, message: "x" }], warnings: [], summary: SUMMARY } });
  assert.match(strip(publish(blocked)), /Publicação bloqueada pelas validações de integridade\. Confira os itens críticos no início da prévia\./);
  assert.match(strip(publish({ ...blocked, dirty: true })), /Publicação bloqueada pelas validações de integridade/);
  assert.match(strip(publish(ready({}, { dirty: true }))), /Você alterou a seleção\. Atualize a prévia antes de publicar\./);
  // Conferindo de novo: parado, sem motivo (o andamento está junto das atividades).
  const checking = publish(ready({}, { importLoading: true }));
  assert.match(checking, /data-action="publish" disabled>/);
  assert.doesNotMatch(checking, /timp-reason/);
  // Publicando: parado (inclusive a confirmação dos removidos) e o andamento com a turma, para o foco.
  const busy = publish({ ...removed, acknowledgeRemoved: true }, { publishing: true });
  assert.match(busy, /id="acknowledge-removed" type="checkbox" checked disabled>/);
  assert.match(busy, /data-action="publish" disabled>/);
  assert.match(busy, /<p class="timp-op is-busy" id="timp-publish-status" role="status" tabindex="-1">Publicando as notas da BRSA0267…<\/p>/);
  // As condições de antes, uma a uma (e nada além delas).
  const enabled = (values, view = {}) => !/data-action="publish"[^>]* disabled/.test(publish(values, view));
  assert.equal(enabled(ready()), true);
  for (const [why, values, view] of [["conferindo", ready({}, { importLoading: true })], ["seleção", ready({}, { dirty: true })], ["bloqueio", blocked], ["removidos", removed], ["publicando", ready(), { publishing: true }]])
    assert.equal(enabled(values, view), false, why);
});

test("E6-U7: andamento e erros junto da ação — o arquivo inválido é o do campo (aria-invalid); falha da publicação recusada ou incerta", () => {
  // Conferindo (primeira vez): o andamento no arquivo, com o nome; seletor e botão parados.
  const checking = steps(page({ ...withFile, importLoading: true }))[0];
  assert.match(checking, /<p class="timp-op is-busy" id="timp-check-status" role="status" tabindex="-1">Conferindo <span class="timp-filename">2026-10-11T1450_Notas-BRSA0267\.csv<\/span>…<\/p>/);
  assert.match(checking, /id="csv-file"[^>]* disabled>/);
  assert.match(checking, /type="submit" disabled>Conferindo…/);
  const failure = (extra) => ({ failure: { step: "check", message: "O CSV deve conter Student, ID e SIS Login ID, separado por vírgulas.", ...extra } });
  const file = steps(page(withFile, failure({ kind: "file", file: "notas <1>.csv" })))[0];
  assert.match(file, /<div class="timp-op is-error" id="timp-check-status" role="alert" tabindex="-1"><p><strong>notas &lt;1&gt;\.csv não passou na conferência\.<\/strong> <span>O CSV deve conter Student, ID e SIS Login ID, separado por vírgulas\.<\/span><\/p><\/div>/);
  // A mensagem do servidor é texto (nome de atividade com sinais de HTML, por exemplo), nunca marcação.
  const hostile = steps(page(withFile, failure({ kind: "file", file: "a.csv", message: 'Nota acima de Points Possible: <img src=x onerror="alert(1)"> / aluno 31007.' })))[0];
  assert.match(hostile, /<span>Nota acima de Points Possible: &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; \/ aluno 31007\.<\/span>/);
  assert.doesNotMatch(hostile, /<img/);
  assert.match(file, /aria-describedby="timp-file-name timp-file-hint timp-check-status" aria-invalid="true"/);
  assert.match(strip(steps(page(withFile, failure({ kind: "empty", file: "vazio.csv", message: "Selecione um arquivo CSV para continuar." })))[0]), /vazio\.csv está vazio\. Selecione um arquivo CSV para continuar\./);
  assert.match(strip(steps(page({}, failure({ kind: "missing", message: "Selecione um arquivo CSV para continuar." })))[0]), /Nenhum arquivo para conferir\. Selecione um arquivo CSV para continuar\./);
  // Problema que não é do arquivo: sem aria-invalid.
  const other = steps(page(withFile, failure({ kind: "other", unsure: true, message: "A conexão com o portal falhou. Tente de novo." })))[0];
  assert.match(strip(other), /Não foi possível conferir o arquivo\. A conexão com o portal falhou\. Tente de novo\./);
  assert.doesNotMatch(other, /aria-invalid|Consultar atualização|pode ter sido concluída/);
  // Com prévia, a conferência (e o erro dela) fica junto de Atualizar prévia.
  const again = page(ready(), failure({ kind: "other", message: "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente." }));
  assert.match(block(again, "timp-activities-title"), /id="timp-check-status" role="alert"/);
  assert.doesNotMatch(steps(again)[0], /timp-check-status|aria-invalid/);
  const atFailure = report();
  // Publicação recusada (4xx): o motivo do servidor; no 409 (a turma mudou ou a prévia já foi publicada — inclusive por uma
  // tentativa cuja resposta se perdeu), "não pode ser publicada" e a consulta; incerta (rede ou 5xx): pode ter acontecido.
  const refused = steps(page(ready(), { failure: { step: "publish", message: "Prévia não encontrada para sua conta." } }))[2];
  assert.match(refused, /<div class="timp-op is-error" id="timp-publish-status" role="alert" tabindex="-1"><p><strong>A atualização não foi publicada\.<\/strong> <span>Prévia não encontrada para sua conta\.<\/span><\/p><\/div>/);
  const conflict = steps(page(ready({}, { report: atFailure }), { failure: { step: "publish", conflict: true, message: "A turma foi atualizada ou esta prévia já foi publicada. Gere uma nova prévia.", report: atFailure } }))[2];
  assert.match(strip(conflict), /Esta prévia não pode ser publicada\. A turma foi atualizada ou esta prévia já foi publicada\. Gere uma nova prévia\. Consultar atualização$/);
  assert.doesNotMatch(conflict, /pode ter sido concluída/);
  const unsure = steps(page(ready({}, { report: atFailure }), { failure: { step: "publish", unsure: true, message: "A conexão com o portal falhou.", report: atFailure } }))[2];
  assert.match(strip(unsure), /Não foi possível confirmar a publicação\. A conexão com o portal falhou\. Ela pode ter sido concluída: consulte a versão em vigor antes de publicar de novo\. Consultar atualização$/);
  assert.match(unsure, /<button type="button" class="button secondary" data-action="refresh-report">Consultar atualização<\/button><\/div>/);
  assert.match(unsure, /data-action="publish">/, "nada impede tentar de novo: o servidor recusa a mesma prévia duas vezes");
  // Depois de consultar (outro relatório que o da falha), a versão em vigor aparece também no aviso, junto da ação.
  const failedWith = report(), published = { ...PUBLICATION, id: "d1", publishedAt: "2026-10-11T18:00:00Z", filename: "notas.csv", publishedBy: "uid-instrutor" };
  const sameReport = steps(page(ready({}, { report: failedWith }), { failure: { step: "publish", unsure: true, message: "x", report: failedWith } }))[2];
  assert.doesNotMatch(sameReport, /timp-recheck/, "antes de consultar, nada");
  const consulted = steps(page(ready({}, { report: report({ publication: published }) }), { failure: { step: "publish", unsure: true, message: "x", report: failedWith } }))[2];
  assert.match(strip(consulted), new RegExp(`Em vigor agora Publicação de ${time(published.publishedAt)} · Envio manual notas\\.csv Consultar atualização$`));
  assert.match(strip(steps(page(ready({}, { report: null }), { failure: { step: "publish", unsure: true, message: "x", report: failedWith } }))[2]), /Consultando a versão em vigor… Consultar atualização$/);
  assert.doesNotMatch(steps(page(ready({}, { report: null }), { failure: { step: "publish", kind: "refused", message: "x", report: failedWith } }))[2], /timp-recheck/, "só na dúvida");
});

test("E6-U8: resultados por aluno depois da publicação — tabela com papéis explícitos, percentuais do contrato e texto escapado", () => {
  const html = page(ready({ students: [...STUDENTS, { id: "9", name: '<img src=x onerror="alert(1)">', email: "x@example.test", kc: null, lab: 100, pending: 0, status: "insufficient" }] }));
  const results = html.slice(html.indexOf('<section class="timp-results"'));
  assert.match(results, /<h2 id="timp-results-title">Conferência dos resultados<\/h2>/);
  assert.match(results, /<table role="table"><caption class="sr-only">Alunos da BRSA0267 com esta prévia: médias, atividades sem nota e situação<\/caption><thead role="rowgroup">/);
  // Cada linha como é lida (os rótulos das linhas empilhadas ficam fora da leitura assistiva: ela ouve o cabeçalho).
  const rows = [...results.matchAll(/<tr class="timp-row" role="row">([\s\S]*?)<\/tr>/g)].map(([, r]) => strip(r.replace(/<span class="timp-cell-label" aria-hidden="true">[^<]*<\/span>/g, "")));
  assert.deepEqual(rows, ["Ana Lima 77% 56,5% 1 Atenção", "Bruno Reis E-mail ausente no Canvas 60,75% 62,25% 2 Crítico",
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; — 100% 0 Sem avaliação completa"]);
  assert.doesNotMatch(results, /<img/);
  assert.match(results, /<span class="timp-state is-critical">Crítico<\/span>/);
  assert.match(strip(results), /Médias, atividades sem nota e situação de cada aluno com esta prévia\./);
  const dirty = page(ready({}, { dirty: true }));
  assert.match(strip(dirty.slice(dirty.indexOf('<section class="timp-results"'))), /Estes resultados ainda são da seleção anterior\./);
});

test("E6-U9: publicação pelo handler — a pergunta diz a turma, os alunos, o arquivo, o que sai de vigor e a sincronização; o andamento só depois de confirmar", async () => {
  const calls = [];
  api.setTransport(async (path, options) => { calls.push([path, options?.body]); return { publication: { id: "d1" } }; });
  importHandlers.configure({ render() {} });
  const asked = [];
  const run = (answer, values = {}) => withStateAsync({ ...ready(), ...values }, async () => {
    importHandlers.resetDraftsForUser(state.me.email);
    Object.assign(state, { ...withFile, preview: preview(), ...values });
    globalThis.confirm = (message) => { asked.push(message); return answer; };
    const started = [];
    const result = await importHandlers.publish(() => started.push(calls.length));
    return { result, started, after: { csv: state.csv, filename: state.filename, preview: state.preview } };
  });
  try {
    const cancelled = await run(false);
    assert.deepEqual([cancelled.result, cancelled.started, calls.length], [false, [], 0], "cancelar: nada enviado, nenhum andamento");
    const [question] = asked;
    assert.match(question, /próxima verificação \((hoje|amanhã) às \d+h\)/, "a pergunta diz o que a sincronização faz");
    assert.equal(question, [`Publicar as notas para 24 alunos da BRSA0267?`, "Arquivo: 2026-10-11T1450_Notas-BRSA0267.csv",
      `A publicação substitui a versão em vigor, de ${time(PUBLICATION.publishedAt)}. Os alunos passam a ver as notas deste arquivo.`,
      `A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (${question.match(/(hoje|amanhã) às \d+h/)[0]}) publica uma nova versão.`].join("\n\n"));
    const done = await run(true);
    assert.deepEqual([done.result, done.started], [true, [0]], "o andamento começa depois de confirmar e antes do pedido");
    assert.deepEqual(calls, [["/cohorts/BRSA0267/publish", { draftId: "d1", acknowledgeRemoved: false }]]);
    // Primeira publicação, um aluno só e sem sincronização: o texto acompanha.
    asked.length = 0;
    await run(false, { report: report({ publication: null }), preview: { ...preview(), count: 1 }, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }] });
    assert.equal(asked[0], "Publicar as notas para 1 aluno da BRSA0267?\n\nArquivo: 2026-10-11T1450_Notas-BRSA0267.csv\n\nEsta será a primeira publicação da turma. Os alunos passam a ver as notas deste arquivo.");
  } finally {
    importHandlers.discardDrafts();
    importHandlers.configure({ render: null });
    delete globalThis.confirm;
  }
});

test("E6-U10: troca de usuário durante a publicação — o arquivo, a prévia e os rascunhos de quem entrou ficam intactos", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  api.setTransport(async () => { await held; return { publication: { id: "d1" } }; });
  importHandlers.configure({ render() {} });
  globalThis.confirm = () => true;
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  try {
    Object.assign(state, { code: "BRSA0267", ...withFile, preview: preview(), dirty: false, acknowledgeRemoved: false, report: report(), cohorts: [{ code: "BRSA0267", canTeach: true }] });
    importHandlers.resetDraftsForUser("a@example.test");
    Object.assign(state, { ...withFile, preview: preview() });
    const publishing = importHandlers.publish();
    // B entra na aba e escolhe um arquivo na mesma turma enquanto a publicação de A está em andamento.
    importHandlers.resetDraftsForUser("b@example.test");
    Object.assign(state, { csv: "de B", filename: "b.csv" });
    release();
    assert.equal(await publishing, false, "nada a fazer para B: nem painel nem aviso");
    assert.deepEqual({ csv: state.csv, filename: state.filename }, { csv: "de B", filename: "b.csv" });
    assert.ok(importHandlers.hasUnpublishedCsv(), "o arquivo de B continua não publicado");
  } finally {
    importHandlers.discardDrafts();
    importHandlers.configure({ render: null });
    delete globalThis.confirm;
    Object.assign(state, saved);
  }
});

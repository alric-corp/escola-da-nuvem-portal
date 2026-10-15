import { current, date, demo, e, heading, icon, labels, nextCanvasSync, percent, plural } from "../ui.js";
import { state } from "../state.js";
import { blockedByIntegrity } from "../handlers/import.js";

// Atualizar notas (Expansão 6; docs/design-visual.md). A operação é a de antes — escolher o CSV, conferir (POST /preview,
// que grava um rascunho e devolve a prévia), ajustar as atividades liberadas e publicar (POST /publish, com a confirmação) —,
// em três etapas na mesma tela: Arquivo do Canvas, Prévia e Publicação; os resultados por aluno vêm depois, para consulta.
// A tela não valida nem calcula nada: integridade, mudanças e médias vêm do backend, e os limites são os do handler e de
// backend/grades.py. view (app.js): publishing (publicação em andamento nesta turma), failure (o erro da conferência ou da
// publicação, preso ao arquivo e à prévia) e showUnfilled (atividades sem notas preenchidas à vista).

const SYNC_USER = "system:canvas-sync";
const studentCodes = ["rosterUnavailable", "studentNotInRoster", "emailBelongsToOtherStudent", "rosterShrink", "publicationShrink"];

// Valor na escala do Canvas como veio do arquivo ("100.00", "62.5", "EX"): só a vírgula decimal e sem zeros à direita;
// nada é arredondado.
const canvasNumber = (value) => (/^\d+\.\d+$/.test(String(value)) ? String(value).replace(/\.?0+$/, "").replace(".", ",") : String(value));
const syncs = () => !!(current()?.autoSync && current()?.canvasCourseId);
const syncConsequence = () => `A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (${nextCanvasSync()}) publica uma nova versão.`;
const title = (n, text, id, focusable = false) => `<h2 class="timp-step-title" id="${id}"${focusable ? ' tabindex="-1"' : ""}><span class="timp-n" aria-hidden="true">${n}</span> ${text}</h2>`;

// A versão em vigor (do relatório da turma): data, origem (pelo publishedBy) e restauração.
function inForceOf(r) {
  const p = r.publication;
  if (!p) return "A turma ainda não tem notas publicadas.";
  const origin = p.publishedBy === SYNC_USER ? "Sincronização com o Canvas"
    : p.filename ? `${p.publishedBy ? "Envio manual" : "Arquivo"} <span class="timp-filename">${e(p.filename)}</span>` : "Arquivo não informado";
  return `Publicação de ${e(date(p.publishedAt))} · ${origin}${r.updateKind === "restore" ? ` · restaurada em ${e(date(r.updatedAt))}` : ""}`;
}

// Contexto: a versão que a publicação substitui e de onde mais vêm as notas.
function context() {
  const r = state.report;
  const inForce = r ? inForceOf(r)
    : state.reportError ? `Não foi possível consultar a versão em vigor: ${e(state.reportError)} <button type="button" class="text-link" data-action="refresh-report">Consultar atualização</button>`
    : "Consultando a versão em vigor…";
  const canvas = current()?.autoSync
    ? `<strong>Esta turma é atualizada automaticamente pelo Canvas.</strong> A próxima verificação é ${nextCanvasSync()}. Use o envio manual só se precisar publicar antes disso ou se a atualização automática falhar.`
    : "Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado aqui.";
  return `<div class="timp-context"><p class="timp-in-force"><span class="timp-label">Em vigor</span> ${inForce}</p><p class="timp-auto">${canvas}</p></div>`;
}

// Andamento ou erro de uma operação, junto da ação: o mesmo id nos dois (o render devolve o foco a ele).
function failureBlock(id, f) {
  const head = f.step === "publish" ? (f.unsure ? "Não foi possível confirmar a publicação." : f.conflict ? "Esta prévia não pode ser publicada." : "A atualização não foi publicada.")
    : f.kind === "missing" ? "Nenhum arquivo para conferir."
    : f.kind === "empty" ? `${e(f.file || "O arquivo")} está vazio.`
    : f.kind === "file" ? `${e(f.file || "O arquivo")} não passou na conferência.`
    : "Não foi possível conferir o arquivo.";
  // Na dúvida (rede, 5xx) e no conflito (409: a turma mudou ou a prévia já foi publicada), a consulta da versão em vigor; depois
  // de consultar (o relatório não é mais o da falha), ela aparece aqui também, junto da ação.
  const unsure = f.step === "publish" && f.unsure, consult = unsure || (f.step === "publish" && f.conflict);
  const consulted = !consult || state.report === f.report ? ""
    : `<p class="timp-recheck">${state.report ? `<span class="timp-label">Em vigor agora</span> ${inForceOf(state.report)}` : state.reportError ? "Não foi possível consultar a versão em vigor." : "Consultando a versão em vigor…"}</p>`;
  return `<div class="timp-op is-error" id="${id}" role="alert" tabindex="-1"><p><strong>${head}</strong> <span>${e(f.message)}</span>${unsure ? " <span>Ela pode ter sido concluída: consulte a versão em vigor antes de publicar de novo.</span>" : ""}</p>${consulted}${consult ? '<button type="button" class="button secondary" data-action="refresh-report">Consultar atualização</button>' : ""}</div>`;
}
function checkStatus(view) {
  if (state.importLoading) return `<p class="timp-op is-busy" id="timp-check-status" role="status" tabindex="-1">Conferindo ${state.filename ? `<span class="timp-filename">${e(state.filename)}</span>` : "o arquivo"}…</p>`;
  return view.failure?.step === "check" ? failureBlock("timp-check-status", view.failure) : "";
}

// 1. Arquivo do Canvas. O seletor nativo fica só para o teclado e a leitura assistiva (o render recria o campo, que voltaria a
// dizer "nenhum arquivo"); o nome do arquivo escolhido aparece ao lado, uma vez. Sem prévia, a conferência fica aqui.
function fileStep(p, view) {
  const locked = demo || state.importLoading || view.publishing;
  const f = !p && view.failure?.step === "check" ? view.failure : null;
  const invalid = !!f && ["missing", "empty", "file"].includes(f.kind);
  const described = ["timp-file-name", "timp-file-hint", invalid ? "timp-check-status" : ""].filter(Boolean).join(" ");
  return `<section class="timp-step-body timp-file${p ? "" : " is-action"}" aria-labelledby="timp-file-title">${title(1, "Arquivo do Canvas", "timp-file-title")}
  <form id="import-form">
  <div class="timp-picker"><input id="csv-file" class="timp-input" type="file" accept=".csv,text/csv" aria-describedby="${described}"${invalid ? ' aria-invalid="true"' : ""}${locked ? " disabled" : ""}><label for="csv-file" class="button secondary timp-choose">${state.filename ? "Trocar arquivo" : "Escolher arquivo"}</label><p class="timp-file-name" id="timp-file-name">${state.filename ? `<span class="timp-filename">${e(state.filename)}</span>` : "Nenhum arquivo selecionado"}</p></div>
  <p class="timp-hint" id="timp-file-hint">CSV original exportado do Canvas, com a turma completa · UTF-8, com a linha Points Possible · até 2 MB</p>${demo ? '<p class="timp-hint">Na demonstração, o envio de arquivos fica desligado.</p>' : ""}
  ${p ? "" : `<div class="timp-check"><button class="button primary" type="submit"${locked ? " disabled" : ""}>${state.importLoading ? "Conferindo…" : "Conferir arquivo"} ${icon("arrow")}</button><p class="timp-check-note">Conferir não publica: mostra a prévia e o que muda.</p></div>${checkStatus(view)}`}
  </form></section>`;
}

// Etapas ainda sem conteúdo: o que vem nelas, em uma linha.
const waiting = (n, text, id, note) => `<section class="timp-step-body" aria-labelledby="${id}">${title(n, text, id)}<p class="timp-waiting">${note}</p></section>`;

const issueItem = (i) => `<li><strong>${e(i.message)}</strong>${i.ids?.length ? `<small>${i.ids.length === 1 ? "Canvas ID" : "Canvas IDs"} ${e(i.ids.join(", "))}${i.count > i.ids.length ? ` e mais ${i.count - i.ids.length}` : ""}</small>` : ""}</li>`;

// Integridade (backend/integrity.py, só para exibir: a publicação confere de novo no servidor).
function integrity(p) {
  const r = p.integrity;
  if (!r) return "";
  const s = r.summary;
  const has = (codes) => r.critical.some((i) => codes.includes(i.code));
  const check = (ok, label, failed) => `<li class="${ok ? "is-ok" : "is-fail"}">${ok ? label : failed}</li>`;
  const students = s.studentsExpected == null ? plural(s.studentsFound, "aluno encontrado", "alunos encontrados")
    : [`${s.studentsExpected} esperados`, `${s.studentsFound} encontrados`, plural(s.studentsExtra, "extra", "extras"), plural(s.studentsMissing, "ausente", "ausentes")].join(" · ");
  const activities = [plural(s.activitiesFound, "encontrada", "encontradas"), s.activitiesKnown == null ? ""
    : has(["activitiesFromOtherCourse"]) ? `${s.activitiesKnown} de ${s.activitiesFound} no curso da turma` : `IDs compatíveis com o ${s.activitiesReference === "catalog" ? "curso" : "arquivo publicado"}`].filter(Boolean).join(" · ");
  const roster = s.canvasConfigured && s.rosterCapturedAt ? `<p class="timp-roster">Matrícula conferida com o Canvas em <strong>${e(date(s.rosterCapturedAt))}</strong>. Alunos matriculados depois disso só aparecem após a próxima sincronização automática.</p>` : "";
  const checks = `<ul class="timp-checks">${s.canvasConfigured
    ? check(!has(studentCodes), "IDs conferem com a matrícula do Canvas", has(["rosterUnavailable"]) ? "matrícula do Canvas ainda não conferida" : "IDs não conferem com a matrícula do Canvas")
    : check(!has(studentCodes), "quantidade de alunos compatível com a publicação atual", "quantidade de alunos bem menor que a da publicação atual")}${check(!has(["activitiesFromOtherCourse"]), "atividades compatíveis com a turma", "atividades não pertencem ao curso desta turma")}${check(true, "estrutura válida")}</ul>`;
  return `<section class="timp-block timp-integrity" aria-labelledby="integrity-heading"><h3 id="integrity-heading">Integridade</h3>
  <dl class="timp-facts"><div><dt>Alunos</dt><dd>${students}</dd></div><div><dt>Atividades</dt><dd>${activities}</dd></div></dl>${roster}${checks}
  ${r.critical.length ? `<div class="timp-issues is-critical" role="alert"><p><strong>Publicação bloqueada: corrija o arquivo e confira de novo.</strong></p><ul>${r.critical.map(issueItem).join("")}</ul></div>` : ""}
  ${r.warnings.length ? `<div class="timp-issues is-warning"><p><strong>Avisos (não impedem publicar)</strong></p><ul>${r.warnings.map(issueItem).join("")}</ul></div>` : ""}</section>`;
}

// O que muda ao publicar (changes.snapshot_changes): só o que muda, com a lista de nomes ao abrir; o que tira algo do que
// os alunos veem leva o anel âmbar. Alunos removidos e atividades que saem do cálculo também em destaque, fora das listas.
const CHANGES = [
  ["activitiesReleased", "atividade será liberada", "atividades serão liberadas", "atividades liberadas"],
  ["studentsAdded", "aluno adicionado", "alunos adicionados", "alunos adicionados"],
  ["studentsRemoved", "aluno removido", "alunos removidos", "alunos removidos", true],
  ["studentsUpdated", "cadastro alterado", "cadastros alterados", "cadastros alterados"],
  ["activitiesAdded", "atividade adicionada", "atividades adicionadas", "atividades adicionadas"],
  ["activitiesRemoved", "atividade removida", "atividades removidas", "atividades removidas", true],
  ["scalesChanged", "pontuação máxima alterada", "pontuações máximas alteradas", "pontuações máximas"],
];
const grade = (value) => (value == null ? "Sem nota" : e(canvasNumber(value)));
const names = (items) => `<ul class="timp-names">${items.map((item) => `<li>${e(item.name)}</li>`).join("")}</ul>`;
const change = (attention, summary, body) => `<li class="timp-change${attention ? " is-attention" : ""}"><details><summary>${summary}</summary><div class="timp-change-body">${body}</div></details></li>`;
function changes(c) {
  const head = '<h3 id="timp-changes-title">O que muda ao publicar</h3>';
  if (!c) return `<section class="timp-block timp-changes" aria-labelledby="timp-changes-title">${head}<p class="timp-lead">A comparação não está disponível nesta prévia.</p></section>`;
  const removed = c.studentsRemoved?.length || 0, paused = c.activitiesPaused?.length || 0;
  const rows = [], unchanged = [];
  if (c.gradesChanged) {
    const split = c.gradesAdded == null || c.gradesRemoved == null ? "" : ` (${plural(c.gradesAdded, "nota nova", "notas novas")}, ${plural(c.gradesRemoved, "removida", "removidas")})`;
    rows.push(change(!!c.gradesRemoved, `${plural(c.gradesChanged, "nota alterada", "notas alteradas")}${split}`,
      `<p class="timp-note">Notas na escala original do Canvas, antes da conversão para percentual. Até 100 alterações são exibidas.</p>${c.gradeDetails?.length
        ? `<ul class="timp-grades" role="list">${c.gradeDetails.map((g) => `<li><span class="timp-grade-student">${e(g.student)}</span><span class="timp-grade-activity">${e(g.activity)}</span><span class="timp-grade-values"><span class="sr-only">antes: </span>${grade(g.before)}<span aria-hidden="true"> → </span><span class="sr-only">, depois: </span>${grade(g.after)}</span></li>`).join("")}</ul>`
        : "<p>Nenhuma nota existente alterada.</p>"}`));
  } else unchanged.push("notas");
  for (const [key, one, many, noun, attention] of CHANGES) {
    const items = c[key] || [];
    if (items.length) rows.push(change(attention, plural(items.length, one, many), names(items)));
    else unchanged.push(noun);
  }
  return `<section class="timp-block timp-changes" aria-labelledby="timp-changes-title">${head}
  <p class="timp-lead">Alunos: <strong>${e(c.previousCount)} → ${e(c.currentCount)}</strong>. O arquivo substitui a publicação anterior por completo.</p>
  ${removed ? `<div class="timp-alert" role="alert"><p><strong>Atenção: ${removed === 1 ? "1 aluno deixa" : `${removed} alunos deixam`} de aparecer na publicação atual.</strong> Confira se exportou a turma completa. O histórico permanece guardado.</p>${names(c.studentsRemoved)}<p>Para publicar, confirme a remoção na etapa Publicação.</p></div>` : ""}
  ${paused ? `<div class="timp-alert" role="alert"><p><strong>Atenção: ${paused === 1 ? "1 atividade sai" : `${paused} atividades saem`} do cálculo nesta publicação.</strong> ${paused === 1 ? "Ela estava liberada na publicação atual e ficará fora da média até ser liberada de novo." : "Elas estavam liberadas na publicação atual e ficarão fora da média até serem liberadas de novo."}</p>${names(c.activitiesPaused)}</div>` : ""}
  ${rows.length ? `<ul class="timp-change-list">${rows.join("")}</ul>` : ""}
  <p class="timp-unchanged">${rows.length ? `Sem mudança em: ${unchanged.join(", ")}.` : "Nenhuma mudança em relação à publicação em vigor."}</p></section>`;
}

// O que já foi liberado? Na ordem do curso. Quando o arquivo traz mais de 6 atividades sem nenhuma nota (o curso inteiro: no
// export real, a maioria), as com notas ficam à vista e essas atrás de "Mostrar" — à vista se alguma estiver marcada. Cada
// caixa com id, para o foco continuar nela depois de marcar.
function activities(p, view) {
  const locked = state.importLoading || view.publishing;
  const list = (p.activities || []).map((a, i) => ({ a, i }));
  const empty = list.filter(({ a }) => a.filled === 0), grouped = empty.length > 6;
  const shown = grouped ? list.filter(({ a }) => a.filled !== 0) : list;
  const forced = empty.some(({ a }) => a.active), open = forced || !!view.showUnfilled;
  const meta = (a) => [a.kind ? `<span class="timp-kind is-${a.kind === "lab" ? "lab" : "kc"}">${a.kind === "lab" ? "LAB" : "KC"}</span>` : "",
    a.filled == null ? "" : plural(a.filled, "nota preenchida", "notas preenchidas"),
    a.points == null ? "" : `máximo ${e(canvasNumber(a.points))} ${Number(a.points) < 2 ? "ponto" : "pontos"}`].filter(Boolean).join(" · ");
  const option = ({ a, i }) => `<li><label class="timp-option"><input id="timp-activity-${i}" type="checkbox" data-activity="${e(a.id)}"${locked ? " disabled" : ""}${a.active ? " checked" : ""}><span class="timp-option-text"><span class="timp-option-name">${e(a.name)}</span><span class="timp-option-meta">${meta(a)}</span></span></label></li>`;
  const released = list.filter(({ a }) => a.active).length;
  return `<section class="timp-block timp-activities" aria-labelledby="timp-activities-title"><h3 id="timp-activities-title">O que já foi liberado?</h3>
  <p class="timp-help">A seleção inicial usa as notas preenchidas. Confirme as atividades que entram no cálculo.</p>
  <p class="timp-count" id="timp-activities-count">${released} de ${list.length} ${list.length === 1 ? "atividade liberada" : "atividades liberadas"}</p>
  <fieldset class="timp-options" aria-describedby="timp-activities-count"><legend class="sr-only">Atividades que entram no cálculo</legend>
  ${shown.length ? `<ul class="timp-option-list" role="list">${shown.map(option).join("")}</ul>` : '<p class="timp-help">Nenhuma atividade tem notas preenchidas neste arquivo.</p>'}
  ${grouped ? `${forced ? "" : `<button type="button" class="text-link timp-more" id="timp-unfilled-toggle" data-import-unfilled aria-expanded="${open}" aria-controls="timp-unfilled">${open ? "Ocultar" : "Mostrar"} as ${empty.length} atividades sem notas preenchidas</button>`}<ul class="timp-option-list is-unfilled" role="list" id="timp-unfilled" aria-label="Atividades sem notas preenchidas"${open ? "" : " hidden"}>${empty.map(option).join("")}</ul>` : ""}
  </fieldset>
  <div class="timp-check"><button class="button secondary" type="submit" form="import-form"${locked || demo ? " disabled" : ""}>${state.importLoading ? "Conferindo…" : "Atualizar prévia"}</button></div>${checkStatus(view)}</section>`;
}

// 2. Prévia: de qual arquivo, quantos alunos e atividades; integridade, o que muda, avisos e a seleção das atividades.
function reviewStep(p, view) {
  const all = p.activities || [], released = all.filter((a) => a.active).length;
  return `<section class="timp-step-body timp-review" aria-labelledby="timp-review-title">${title(2, "Prévia", "timp-review-title", true)}
  <p class="timp-summary"><span class="timp-filename">${e(p.draft?.filename || state.filename)}</span> · ${plural(p.count, "aluno", "alunos")} · ${released} de ${all.length} ${all.length === 1 ? "atividade liberada" : "atividades liberadas"}</p>
  ${integrity(p)}${changes(p.changes)}
  ${p.warnings?.length ? `<section class="timp-block timp-warnings" aria-labelledby="timp-warnings-title"><h3 id="timp-warnings-title">Avisos da importação</h3><ul>${p.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></section>` : ""}
  ${activities(p, view)}</section>`;
}

// 3. Publicação: o que acontece, a confirmação dos removidos junto do botão e, quando Publicar está parado, o motivo ao lado.
function publishStep(p, view) {
  const blocked = blockedByIntegrity(p), removed = p.changes?.studentsRemoved?.length || 0, ack = !removed || state.acknowledgeRemoved;
  const reason = view.publishing || state.importLoading ? ""
    : blocked ? "<strong>Publicação bloqueada pelas validações de integridade.</strong> Confira os itens críticos no início da prévia."
    : state.dirty ? "Você alterou a seleção. Atualize a prévia antes de publicar."
    : ack ? "" : "Confira e confirme os alunos removidos antes de publicar.";
  const disabled = view.publishing || state.importLoading || state.dirty || blocked || !ack;
  const f = view.failure?.step === "publish" ? view.failure : null;
  return `<section class="timp-step-body timp-publish is-action" aria-labelledby="timp-publish-title">${title(3, "Publicação", "timp-publish-title")}
  <p class="timp-consequence">Publicar substitui as notas atuais da turma pelo arquivo completo da <strong>${e(state.code)}</strong>.</p>${syncs() ? `<p class="timp-sync-note">${syncConsequence()}</p>` : ""}
  ${removed ? `<label class="timp-ack"><input id="acknowledge-removed" type="checkbox"${state.acknowledgeRemoved ? " checked" : ""}${view.publishing ? " disabled" : ""}><span>Conferi e confirmo a remoção de ${plural(removed, "aluno", "alunos")} nesta publicação.</span></label>` : ""}
  ${reason ? `<p class="timp-reason" id="timp-publish-reason"><span>${reason}</span></p>` : ""}
  <div class="timp-publish-action"><button class="button primary" data-action="publish"${disabled ? " disabled" : ""}${reason ? ' aria-describedby="timp-publish-reason"' : ""}>Publicar atualização ${icon("check")}</button></div>
  ${view.publishing ? `<p class="timp-op is-busy" id="timp-publish-status" role="status" tabindex="-1">Publicando as notas da ${e(state.code)}…</p>` : f ? failureBlock("timp-publish-status", f) : ""}</section>`;
}

// Resultados por aluno com esta prévia (grades.summary): consulta, depois da publicação na ordem da tela.
function results(p) {
  const row = (s) => `<tr class="timp-row" role="row"><th scope="row" role="rowheader" class="timp-name"><span class="timp-student">${e(s.name)}</span>${s.email ? "" : '<span class="timp-missing">E-mail ausente no Canvas</span>'}</th><td role="cell" class="timp-avg is-kc"><span class="timp-cell-label" aria-hidden="true">Média KC</span> ${percent(s.kc)}</td><td role="cell" class="timp-avg is-lab"><span class="timp-cell-label" aria-hidden="true">Média LAB</span> ${percent(s.lab)}</td><td role="cell" class="timp-pending"><span class="timp-cell-label" aria-hidden="true">Sem nota</span> ${e(s.pending)}</td><td role="cell" class="timp-status"><span class="timp-state is-${e(s.status)}">${e(labels[s.status] || s.status)}</span></td></tr>`;
  return `<section class="timp-results" aria-labelledby="timp-results-title"><h2 id="timp-results-title">Conferência dos resultados</h2>
  <p class="timp-help">${state.dirty ? "Estes resultados ainda são da seleção anterior." : "Médias, atividades sem nota e situação de cada aluno com esta prévia."}</p>
  <div class="timp-table"><table role="table"><caption class="sr-only">Alunos da ${e(state.code)} com esta prévia: médias, atividades sem nota e situação</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader" class="timp-name">Aluno</th><th scope="col" role="columnheader" class="timp-avg is-kc">Média KC</th><th scope="col" role="columnheader" class="timp-avg is-lab">Média LAB</th><th scope="col" role="columnheader" class="timp-pending">Sem nota</th><th scope="col" role="columnheader" class="timp-status">Situação</th></tr></thead><tbody role="rowgroup">${(p.students || []).map(row).join("")}</tbody></table></div></section>`;
}

export function importPage(view = {}) {
  const p = state.preview;
  return `<div class="teacher-import">${heading("", `Atualizar notas da ${e(state.code)}`, "Importe, confira e publique. Os alunos verão as notas somente após a publicação.")}
  ${context()}
  <ol class="timp-steps" role="list"><li class="timp-step is-file">${fileStep(p, view)}</li><li class="timp-step is-review${p ? "" : " is-waiting"}">${p ? reviewStep(p, view)
    : waiting(2, "Prévia", "timp-review-title", "Depois de conferir o arquivo: integridade, o que muda ao publicar e as atividades liberadas.")}</li><li class="timp-step is-publish${p ? "" : " is-waiting"}">${p ? publishStep(p, view)
    : waiting(3, "Publicação", "timp-publish-title", "Depois da prévia: publicar substitui as notas atuais da turma.")}</li></ol>
  ${p ? results(p) : ""}</div>`;
}

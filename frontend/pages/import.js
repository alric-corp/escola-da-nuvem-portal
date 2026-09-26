import { badge, current, date, demo, e, heading, icon, nextCanvasSync, percent, plural, state } from "../ui.js";

// Resultado das validações de integridade calculadas pelo backend (backend/integrity.py). A tela só
// apresenta: a publicação é recalculada e bloqueada no servidor, com ou sem esta prévia.
export function blockedByIntegrity(p) {
  return !!p?.integrity?.critical?.length;
}
const studentCodes = ["rosterUnavailable", "studentNotInRoster", "emailBelongsToOtherStudent", "rosterShrink", "publicationShrink"];
const issueItem = (i) => `<li><strong>${e(i.message)}</strong>${i.ids?.length ? `<small>${i.ids.length === 1 ? "Canvas ID" : "Canvas IDs"} ${e(i.ids.join(", "))}${i.count > i.ids.length ? ` e mais ${i.count - i.ids.length}` : ""}</small>` : ""}</li>`;

export function integrityPanel(p) {
  const r = p?.integrity;
  if (!r) return "";
  const s = r.summary, c = p.changes || {};
  const has = (codes) => r.critical.some((i) => codes.includes(i.code));
  const check = (ok, label, failed) => `<li class="${ok ? "ok" : "fail"}"><span aria-hidden="true">${ok ? "✓" : "⚠"}</span> ${ok ? label : failed}</li>`;
  const students = s.studentsExpected == null
    ? `<li>${plural(s.studentsFound, "aluno encontrado", "alunos encontrados")}</li>`
    : `<li>${s.studentsExpected} esperados</li><li>${s.studentsFound} encontrados</li><li>${plural(s.studentsExtra, "extra", "extras")}</li><li>${plural(s.studentsMissing, "ausente", "ausentes")}</li>`;
  const activities = `<li>${plural(s.activitiesFound, "encontrada", "encontradas")}</li>${s.activitiesKnown == null ? "" : r.critical.some((i) => i.code === "activitiesFromOtherCourse") ? `<li>${s.activitiesKnown} de ${s.activitiesFound} no curso da turma</li>` : `<li>IDs compatíveis com o ${s.activitiesReference === "catalog" ? "curso" : "arquivo publicado"}</li>`}`;
  const changes = `<li>${plural(c.gradesAdded ?? 0, "nota nova", "notas novas")}</li><li>${plural(c.gradesRemoved ?? 0, "removida", "removidas")}</li><li>${plural(c.activitiesReleased?.length ?? 0, "atividade será liberada", "atividades serão liberadas")}</li>`;
  const roster = s.canvasConfigured
    ? s.rosterCapturedAt ? `<p class="integrity-roster">Matrícula conferida com o Canvas em <strong>${e(date(s.rosterCapturedAt))}</strong>. Alunos matriculados depois disso só aparecem após a próxima sincronização automática.</p>` : ""
    : "";
  return `<section class="panel integrity-panel" aria-labelledby="integrity-heading"><h2 id="integrity-heading">Integridade</h2>
  <div class="integrity-grid"><div><h3>Alunos</h3><ul>${students}</ul></div><div><h3>Atividades</h3><ul>${activities}</ul></div><div><h3>Mudanças</h3><ul>${changes}</ul></div></div>
  ${roster}<ul class="integrity-checks">${s.canvasConfigured ? check(!has(studentCodes), "IDs conferem com a matrícula do Canvas", has(["rosterUnavailable"]) ? "matrícula do Canvas ainda não conferida" : "IDs não conferem com a matrícula do Canvas") : check(!has(studentCodes), "quantidade de alunos compatível com a publicação atual", "quantidade de alunos bem menor que a da publicação atual")}${check(!has(["activitiesFromOtherCourse"]), "atividades compatíveis com a turma", "atividades não pertencem ao curso desta turma")}${check(true, "estrutura válida")}</ul>
  ${r.critical.length ? `<div class="integrity-critical" role="alert"><strong>Publicação bloqueada: corrija o arquivo e confira de novo.</strong><ul>${r.critical.map(issueItem).join("")}</ul></div>` : ""}
  ${r.warnings.length ? `<div class="integrity-warnings" role="status"><strong>Avisos (não impedem publicar)</strong><ul>${r.warnings.map(issueItem).join("")}</ul></div>` : ""}</section>`;
}

export function importComparison(c) {
  if (!c) return '<p class="small">A comparação não está disponível nesta prévia.</p>';
  const groups = [["studentsAdded", "Alunos adicionados"], ["studentsRemoved", "Alunos removidos"],
    ["studentsUpdated", "Cadastros alterados"], ["activitiesAdded", "Atividades adicionadas"],
    ["activitiesRemoved", "Atividades removidas"], ["activitiesReleased", "Atividades liberadas"],
    ["scalesChanged", "Pontuações máximas alteradas"]];
  return `<section class="panel import-comparison"><h2>O que muda ao publicar</h2><p>Alunos: <strong>${e(c.previousCount)} → ${e(c.currentCount)}</strong>. O arquivo substitui a publicação anterior por completo.</p>${c.studentsRemoved.length ? `<div class="removal-warning" role="alert"><strong>Atenção: ${c.studentsRemoved.length === 1 ? "1 aluno deixa" : `${c.studentsRemoved.length} alunos deixam`} de aparecer na publicação atual.</strong><p>Confira se exportou a turma completa. O histórico permanece guardado.</p><label><input id="acknowledge-removed" type="checkbox" ${state.acknowledgeRemoved ? "checked" : ""}> Conferi e confirmo a remoção desses alunos nesta publicação.</label></div>` : ""}${c.activitiesPaused.length ? `<div class="removal-warning" role="alert"><strong>Atenção: ${c.activitiesPaused.length === 1 ? "1 atividade sai" : `${c.activitiesPaused.length} atividades saem`} do cálculo nesta publicação.</strong><p>Elas estavam liberadas na publicação atual e ficarão fora da média até serem liberadas de novo.</p><ul>${c.activitiesPaused.map((item) => `<li>${e(item.name)}</li>`).join("")}</ul></div>` : ""}<div class="change-groups">${groups.map(([key, label]) => `<details><summary>${label}: ${c[key].length}</summary>${c[key].length ? `<ul>${c[key].map((item) => `<li>${e(item.name)}</li>`).join("")}</ul>` : '<p>Nenhuma alteração.</p>'}</details>`).join("")}</div><details><summary>Notas alteradas: ${e(c.gradesChanged)}</summary><p class="small">Notas na escala original do Canvas, antes da conversão para percentual. Até 100 alterações são exibidas.</p>${c.gradeDetails.length ? `<div class="table-scroll"><table><caption class="sr-only">Notas alteradas</caption><thead><tr><th>Aluno</th><th>Atividade</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${c.gradeDetails.map((g) => `<tr><td>${e(g.student)}</td><td>${e(g.activity)}</td><td>${e(g.before ?? "Sem nota")}</td><td>${e(g.after ?? "Sem nota")}</td></tr>`).join("")}</tbody></table></div>` : '<p>Nenhuma nota existente alterada.</p>'}</details></section>`;
}

export function importPage() {
  const p = state.preview;
  const auto = !!current()?.autoSync;
  return `${heading("", `Atualizar notas da ${e(state.code)}`, "Importe, confira e publique. Os alunos verão as notas somente após a publicação.")}
  ${auto ? `<section class="panel fallback-note" role="note"><strong>Esta turma é atualizada automaticamente pelo Canvas.</strong><p>A próxima verificação é ${nextCanvasSync()}. Use o envio manual só se precisar publicar antes disso ou se a atualização automática falhar.</p></section>` : ""}
  <div class="steps"><span class="active">1 <b>Enviar CSV</b></span><i></i><span class="${p ? "active" : ""}">2 <b>Conferir prévia</b></span><i></i><span>3 <b>Publicar</b></span></div>
  <section class="panel"><form id="import-form"><label class="drop-zone" for="csv-file">${icon("upload", 36)}<strong>Selecione o CSV exportado do Canvas</strong><span>Arquivo original UTF-8, com a linha Points Possible · até 2 MB</span><input id="csv-file" type="file" accept=".csv,text/csv" ${demo || state.importLoading ? "disabled" : ""}></label><div class="form-footer"><span class="small">${e(state.filename || "Nenhum arquivo selecionado")}</span><button class="button primary" type="submit" ${demo || state.importLoading ? "disabled" : ""}>${state.importLoading ? "Conferindo…" : p ? "Atualizar prévia" : "Conferir arquivo"} ${icon("arrow")}</button></div></form></section>
  ${
    p
      ? `${integrityPanel(p)}${importComparison(p.changes)}${p.warnings?.length ? `<section class="panel import-warnings" role="status"><h2>Avisos da importação</h2><ul>${p.warnings.map((w) => `<li>${e(w)}</li>`).join("")}</ul></section>` : ""}<section class="panel"><div class="panel-title"><div><span class="eyebrow">ATIVIDADES DESTA SEMANA</span><h2>O que já foi liberado?</h2><p class="small">A seleção inicial usa as notas preenchidas. Confirme as atividades que entram no cálculo.</p></div><span class="count-chip">${p.count} alunos</span></div><div class="activity-options">${p.activities.map((a) => `<label><input type="checkbox" data-activity="${e(a.id)}" ${state.importLoading ? "disabled" : ""} ${a.active ? "checked" : ""}><span><strong>${e(a.name)}</strong><small>${a.filled} notas preenchidas · máximo ${e(a.points)} pontos</small></span></label>`).join("")}</div></section>
  <section class="panel"><div class="panel-title"><div><h2>Conferência dos resultados</h2><p class="small">${state.dirty ? "Você alterou a seleção. Atualize a prévia antes de publicar." : "Confira os alunos e indicadores antes de disponibilizar a atualização."}</p></div></div><div class="table-scroll"><table><thead><tr><th>Aluno</th><th>KC</th><th>Lab</th><th>Pendências</th><th>Situação</th></tr></thead><tbody>${p.students.map((s) => `<tr><td>${e(s.name)}${!s.email ? '<small class="muted">E-mail ausente no Canvas</small>' : ""}</td><td>${percent(s.kc)}</td><td>${percent(s.lab)}</td><td>${s.pending}</td><td>${badge(s.status)}</td></tr>`).join("")}</tbody></table></div><div class="publish-footer"><p>${blockedByIntegrity(p) ? "<strong>Publicação bloqueada pelas validações de integridade.</strong> Confira os itens críticos no início da prévia." : `Publicar substitui as notas atuais da turma pelo arquivo completo da <strong>${e(state.code)}</strong>.`}</p><button class="button primary" data-action="publish" ${state.importLoading || state.dirty || blockedByIntegrity(p) || (p.changes?.studentsRemoved.length && !state.acknowledgeRemoved) ? "disabled" : ""}>Publicar atualização ${icon("check")}</button></div></section>`
      : ""
  }`;
}

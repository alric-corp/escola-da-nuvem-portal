import { badge, current, date, demo, e, filterMetric, heading, icon, labels, normalize, percent, plural, updateInfo } from "../ui.js";
import { state } from "../state.js";
import { isWithdrawn } from "../participation.js";

export function focusEditor() {
  if (!state.report.publication) return "";
  const ids = state.focusDraft || state.report.focus?.activityIds || [];
  const activities = state.report.activities || [];
  const named = (id) => activities.find((a) => a.id === id)?.name || id;
  return `<section class="panel focus-editor"><details><summary><strong>Foco da turma</strong> · até três atividades</summary><p>Escolha as atividades que aparecerão primeiro para o aluno quando estiverem sem nota ou com sugestão de revisão. Adicione pela <button class="text-link" type="button" data-view="activity-overview">visão por atividade</button>, que mostra pendências e médias antes de decidir. A escolha vale para toda a turma.</p>${ids.length ? `<ul class="focus-list">${ids.map((id) => `<li>${e(named(id))} <button class="button secondary" type="button" data-remove-focus="${e(id)}" ${demo ? "disabled" : ""}>Remover</button></li>`).join("")}</ul>` : '<p class="small">Nenhuma atividade selecionada ainda.</p>'}<p class="small">Sem seleção, o aluno verá até três atividades na ordem da publicação: primeiro sem nota, depois revisão. A seleção é mantida nas próximas publicações enquanto os itens existirem e estiverem liberados.</p><form id="focus-form" class="stack-form"><button class="button primary" type="submit" ${demo || !ids.length ? "disabled" : ""}>Salvar foco da turma</button></form></details></section>`;
}

// Desistentes só entram em Todos e em Desistentes; os demais filtros, Ativos inclusive, contam só ativos (um
// desistente não aparece como Crítico ou sem nota no painel).
function matchesFilter(r, filter) {
  if (filter === "all") return true;
  if (filter === "withdrawn") return isWithdrawn(r);
  if (isWithdrawn(r)) return false;
  return filter === "active" || r.status === filter || (filter === "missing-email" && !r.email) || (filter === "pending" && r.pending > 0) || (filter === "no-portal" && r.portalLinked === false);
}

// Alunos visíveis na tabela, com busca, filtro e ordenação ativos (usado também pelo CSV). Em Todos, os desistentes
// vêm depois dos ativos, cada grupo na ordenação escolhida.
export function filteredStudents() {
  const query = normalize(state.search);
  const rows = state.report.students || [];
  // O filtro Desistentes sem nenhum desistente na turma (ex.: restaurado ao voltar ao painel) vale como Todos.
  const filter = state.filter === "withdrawn" && !rows.some(isWithdrawn) ? "all" : state.filter;
  const filtered = rows.filter((r) => matchesFilter(r, filter) && normalize(`${r.name} ${r.email || ""}`).includes(query));
  return filtered.sort((a, b) => {
    if (isWithdrawn(a) !== isWithdrawn(b)) return isWithdrawn(a) ? 1 : -1;
    if (state.sort === "pending" && a.pending !== b.pending) return b.pending - a.pending;
    if (state.sort === "score" && a.total !== b.total) return (a.total ?? -1) - (b.total ?? -1);
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}

// Uma célula iniciada por = + - @ seria interpretada como fórmula pelo Excel/Sheets.
const csvCell = (value) => {
  const text = String(value ?? "");
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};

// Participação vem sempre, no fim (as colunas anteriores não mudam de posição); Situação continua sendo a acadêmica.
export function studentsCsv(rows) {
  const header = ["Nome", "E-mail", "Média KC (%)", "Média LAB (%)", "Média geral (%)", "Com nota (%)", "Sem nota", "Situação", "Entrou no portal", "Participação"];
  const lines = rows.map((r) => [r.name, r.email || "", r.kc ?? "", r.lab ?? "", r.total ?? "", r.progress ?? "", r.pending, labels[r.status] || r.status,
    r.portalLinked === undefined ? "" : r.portalLinked ? "Sim" : "Não", isWithdrawn(r) ? "Desistente" : "Ativo"]);
  // BOM para o Excel reconhecer UTF-8 (acentos); ponto e vírgula é o separador que ele espera em pt-BR.
  return "﻿" + [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n");
}

// Vínculo criado no primeiro acesso do aluno ao próprio relatório; "Não entrou" inclui quem
// ainda não criou conta e quem criou com um e-mail diferente do Canvas.
function portalCell(r) {
  if (r.portalLinked === undefined) return '<span class="portal-ok">—</span>';
  return r.portalLinked ? '<span class="small portal-ok">Entrou</span>'
    : '<span class="badge unreleased" title="Sem conta no portal ou conta com e-mail diferente do Canvas">Não entrou</span>';
}

// Uma linha da tabela; no celular o CSS transforma cada linha em card (sem rolagem lateral).
// data-label nomeia cada valor quando o cabeçalho da tabela não está visível.
function studentRow(r) {
  return `<tr><td class="cell-name"><strong>${e(r.name)}</strong>${isWithdrawn(r) ? ' <span class="badge withdrawn">Desistente</span>' : ""}<small>${e(r.email || "E-mail ausente no Canvas")}</small></td><td class="cell-kc" data-label="KCs">${percent(r.kc)}</td><td class="cell-lab" data-label="Labs">${percent(r.lab)}</td><td class="cell-progress" data-label="Com nota">${percent(r.progress)}</td><td class="cell-pending" data-label="Sem nota"><span class="pending-count">${r.pending}</span></td><td class="cell-status">${badge(r.status)}</td><td class="cell-portal">${portalCell(r)}</td><td class="cell-actions" data-label="Ações"><button class="text-link" data-student-pending="${e(r.id)}" aria-label="Ver pendências de ${e(r.name)}">Ver detalhes</button></td></tr>`;
}

export function teacherPage() {
  const report = state.report,
    rows = report.students || [];
  // Os cartões contam só ativos; com algum desistente, o primeiro vira "Alunos ativos" (filtra Ativos) com a legenda dos
  // desistentes. Sem desistentes, os cartões são os de sempre.
  const active = rows.filter((r) => !isWithdrawn(r)), withdrawn = rows.length - active.length;
  const filtered = filteredStudents();
  // Com atualização automática, o envio de CSV é só alternativa (antes do horário ou se a sincronização falhar).
  const auto = !!current()?.autoSync;
  return `${heading("", `Painel da ${e(state.code)}`, auto ? "Acompanhe o desempenho dos alunos. As notas chegam do Canvas automaticamente." : "Acompanhe todos os alunos identificados, filtre o desempenho e publique as notas.", `<button class="button secondary" data-view="activity-overview">Ver por atividade</button><button class="button ${auto ? "secondary" : "primary"}" data-view="import">${icon("upload")} ${auto ? "Enviar CSV manualmente" : "Atualizar notas"}</button>`)}
  ${updateInfo()}<section class="metrics metrics-filters" aria-label="Resumo da turma · selecione um cartão para filtrar a lista">${withdrawn ? filterMetric("Alunos ativos", active.length, plural(withdrawn, "desistente", "desistentes"), "metric-primary", "active") : filterMetric("Alunos na publicação", rows.length, "Ver todos os alunos", "metric-primary", "all")}${filterMetric("Médias na referência", active.filter((r) => r.status === "ok").length, `KCs ≥ ${(report.thresholds && report.thresholds.kc) ?? 70}% e Labs ≥ ${(report.thresholds && report.thresholds.lab) ?? 95}%`, "", "ok")}${filterMetric("Atenção", active.filter((r) => r.status === "attention").length, "Uma média abaixo da referência", "metric-warning", "attention")}${filterMetric("Crítico", active.filter((r) => r.status === "critical").length, "As duas médias abaixo da referência", "metric-danger", "critical")}${rows.some((r) => r.portalLinked !== undefined) ? filterMetric("Ainda não entraram", active.filter((r) => r.portalLinked === false).length, "No portal: sem conta ou com e-mail diferente do Canvas", "metric-neutral", "no-portal") : ""}</section>
  ${focusEditor()}<section class="panel"><div class="panel-title"><div><h2 id="students-heading" tabindex="-1">Desempenho dos alunos</h2><p class="small">Última publicação: ${date(report.publication?.publishedAt)}</p></div></div><div class="table-tools student-tools"><input id="search" type="search" placeholder="Buscar aluno ou e-mail…" aria-label="Buscar aluno" value="${e(state.search)}"><select id="status-filter" aria-label="Filtrar status">${[["all", "Todos os status"], ...(withdrawn ? [["active", "Ativos"], ["withdrawn", "Desistentes"]] : []), ["missing-email", "Sem e-mail no Canvas"], ["pending", "Com atividades sem nota"], ["no-portal", "Ainda não entraram no portal"], ...Object.entries(labels).filter(([k]) => ["ok", "attention", "critical"].includes(k))].map(([id, label]) => `<option value="${id}" ${state.filter === id ? "selected" : ""}>${label}</option>`).join("")}</select><select id="student-sort" aria-label="Ordenar alunos">${[["name", "Nome A–Z"], ["pending", "Mais atividades sem nota"], ["score", "Menores médias primeiro"]].map(([value, label]) => `<option value="${value}" ${state.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select><button class="button secondary" data-action="clear-filters">Limpar filtros</button><button class="button secondary" data-action="export-csv" ${filtered.length ? "" : "disabled"}>Exportar CSV (${filtered.length})</button></div>
  ${state.filter === "pending" && filtered.length ? `<p class="table-tools"><button class="button primary" data-action="reminders-batch" data-ids="${filtered.map((r) => e(r.id)).join(",")}">Enviar lembrete para ${plural(filtered.length, "aluno", "alunos")}</button></p>` : ""}
  ${rows.length ? `<div class="table-scroll student-table"><table><thead><tr><th class="cell-name">Aluno</th><th class="cell-kc">KCs</th><th class="cell-lab">Labs</th><th class="cell-progress">Com nota</th><th class="cell-pending">Sem nota</th><th class="cell-status">Situação</th><th class="cell-portal">Portal</th><th class="cell-actions">Ações</th></tr></thead><tbody>${filtered.map(studentRow).join("")}</tbody></table>${!filtered.length ? '<p class="empty">Nenhum aluno encontrado.</p>' : ""}</div>` : '<div class="empty"><h3>A turma está pronta para começar.</h3><p>Importe o CSV do Canvas para publicar a primeira atualização.</p></div>'}</section>`;
}

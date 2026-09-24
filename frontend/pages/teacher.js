import { badge, date, demo, e, heading, icon, labels, metric, percent, state, updateInfo } from "../ui.js";

export function focusEditor() {
  if (!state.report.publication) return "";
  const ids = state.focusDraft || state.report.focus?.activityIds || [];
  const activities = state.report.activities || [];
  const named = (id) => activities.find((a) => a.id === id)?.name || id;
  return `<section class="panel focus-editor"><details><summary><strong>Foco da turma</strong> · até três atividades</summary><p>Escolha as atividades que aparecerão primeiro para o aluno quando estiverem sem nota ou com sugestão de revisão. Adicione pela <button class="text-link" type="button" data-view="activity-overview">visão por atividade</button>, que mostra pendências e médias antes de decidir. A escolha vale para toda a turma.</p>${ids.length ? `<ul class="focus-list">${ids.map((id) => `<li>${e(named(id))} <button class="button secondary" type="button" data-remove-focus="${e(id)}" ${demo ? "disabled" : ""}>Remover</button></li>`).join("")}</ul>` : '<p class="small">Nenhuma atividade selecionada ainda.</p>'}<p class="small">Sem seleção, o aluno verá até três atividades na ordem da publicação: primeiro sem nota, depois revisão. A seleção é mantida nas próximas publicações enquanto os itens existirem e estiverem liberados.</p><form id="focus-form" class="stack-form"><button class="button primary" type="submit" ${demo || !ids.length ? "disabled" : ""}>Salvar foco da turma</button></form></details></section>`;
}

export function teacherPage() {
  const report = state.report,
    rows = report.students || [];
  const filtered = rows.filter(
    (r) =>
      (state.filter === "all" || r.status === state.filter || (state.filter === "missing-email" && !r.email) || (state.filter === "pending" && r.pending > 0)) &&
      `${r.name} ${r.email || ""}`
        .toLowerCase()
        .includes(state.search.toLowerCase()),
  );
  filtered.sort((a, b) => {
    if (state.sort === "pending" && a.pending !== b.pending) return b.pending - a.pending;
    if (state.sort === "score" && a.total !== b.total) return (a.total ?? -1) - (b.total ?? -1);
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
  return `${heading("GESTÃO DA TURMA", `Painel da ${e(state.code)}`, "Acompanhe todos os alunos identificados, filtre o desempenho e publique as notas.", `<button class="button secondary" data-view="activity-overview">Ver por atividade</button><button class="button primary" data-view="import">${icon("upload")} Atualizar notas</button>`)}
  ${updateInfo()}<section class="metrics">${metric("Alunos na publicação", rows.length, "Última atualização da turma", "metric-primary")}${metric("Médias na referência", rows.filter((r) => r.status === "ok").length, "KCs ≥ 70% e Labs ≥ 95%")}${metric("Atenção", rows.filter((r) => r.status === "attention").length, "Uma média abaixo da referência", "metric-warning")}${metric("Crítico", rows.filter((r) => r.status === "critical").length, "As duas médias abaixo da referência", "metric-danger")}</section>
  ${focusEditor()}<section class="panel"><div class="panel-title"><div><h2>Desempenho dos alunos</h2><p class="small">Última publicação: ${date(report.publication?.publishedAt)}</p></div></div><div class="table-tools"><input id="search" type="search" placeholder="Buscar aluno ou e-mail…" aria-label="Buscar aluno" value="${e(state.search)}"><select id="status-filter" aria-label="Filtrar status">${[["all", "Todos os status"], ["missing-email", "Sem e-mail no Canvas"], ["pending", "Com atividades sem nota"], ...Object.entries(labels).filter(([k]) => ["ok", "attention", "critical"].includes(k))].map(([id, label]) => `<option value="${id}" ${state.filter === id ? "selected" : ""}>${label}</option>`).join("")}</select><select id="student-sort" aria-label="Ordenar alunos">${[["name", "Nome A–Z"], ["pending", "Mais atividades sem nota"], ["score", "Menores médias primeiro"]].map(([value, label]) => `<option value="${value}" ${state.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select><button class="button secondary" data-action="clear-filters">Limpar filtros</button></div>
  ${state.filter === "pending" && filtered.length ? `<p class="table-tools"><button class="button primary" data-action="reminders-batch" data-ids="${filtered.map((r) => e(r.id)).join(",")}">Enviar lembrete para ${filtered.length} aluno(s)</button></p>` : ""}
  ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Aluno</th><th>KCs</th><th>Labs</th><th>Com nota</th><th>Sem nota</th><th>Situação</th></tr></thead><tbody>${filtered.map((r) => `<tr><td><strong>${e(r.name)}</strong><small>${e(r.email || "E-mail ausente no Canvas")}</small></td><td>${percent(r.kc)}</td><td>${percent(r.lab)}</td><td>${percent(r.progress)}</td><td><button class="text-link" data-student-pending="${e(r.id)}" aria-label="Ver pendências de ${e(r.name)}">${r.pending} · Ver detalhes</button></td><td>${badge(r.status)}</td></tr>`).join("")}</tbody></table>${!filtered.length ? '<p class="empty">Nenhum aluno encontrado.</p>' : ""}</div>` : '<div class="empty"><h3>A turma está pronta para começar.</h3><p>Importe o CSV do Canvas para publicar a primeira atualização.</p></div>'}</section>`;
}

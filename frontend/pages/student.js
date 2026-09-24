import { activityModule, groupActivities, needsReview, nextActivities } from "../student-journey.js";
import { canvasActivityLink, cohortCanvasCourses } from "../canvas-links.js";
import { badge, canvasLinksEnabled, demo, e, gradingHelp, heading, icon, metric, percent, personalChanges, state, updateInfo } from "../ui.js";

export function studentPage(name) {
  const s = state.report.student;
  const pending = s.activities.filter((a) => a.state === "pending");
  const review = s.activities.filter(needsReview);
  const focus = state.report.focus?.activityIds || [];
  const next = nextActivities(s.activities, focus);
  return `${heading("SUA JORNADA DE APRENDIZADO", `Bom ter você aqui, ${e(name)}.`, "Acompanhe suas conquistas e organize os próximos passos.")}${updateInfo()}
  <section class="journey student-summary"><div><span class="pill">TURMA ${e(state.code)}</span><h2>Seu resumo</h2><p>${s.completed} com nota · ${pending.length} sem nota · ${review.length} para revisar.</p><button class="button primary" data-view="activities">Ver minhas atividades ${icon("arrow")}</button></div><div class="ring" style="--progress:${s.progress || 0}%"><div><strong>${percent(s.progress)}</strong><span>das atividades<br>com nota</span></div></div></section>
  <section class="panel next-steps" aria-labelledby="pending-heading"><div class="panel-title"><div><span class="eyebrow">PRÓXIMOS PASSOS</span><h2 id="pending-heading">${focus.length ? "Foco indicado pelo instrutor" : "Por onde começar"}</h2><p class="small">${focus.length ? "Até três atividades indicadas para a turma. Aqui aparecem apenas as que estão sem nota ou podem ser revisadas por você." : "Até três atividades: primeiro as sem nota, na ordem da publicação; depois, sugestões de revisão."}</p></div></div>
  <div class="next-summary"><button class="button secondary" data-view="activities" data-pending="all">Ver minhas pendências · ${pending.length}</button><button class="button secondary" data-view="activities" data-activity-filter="review">Revisar resultados · ${review.length}</button></div>
  <p class="small">Sem nota pode significar entrega ou correção pendente. Se já entregou no Canvas, aguarde a próxima atualização.</p>
  ${next.length ? next.map(activityCard).join("") : `<p class="empty compact">${focus.length ? "Você já tem notas na referência nas atividades indicadas ou está dispensado delas. Consulte as demais atividades abaixo." : s.activities.some((a) => ["pending", "completed"].includes(a.state)) ? "As atividades avaliadas estão na referência. Continue acompanhando as próximas liberações." : "Ainda não há atividades para entrega ou revisão nesta publicação."}</p>`}
  <button class="text-link" data-view="activities">Ver todas as atividades ${icon("arrow", 16)}</button></section>  <div class="grade-context">${badge(s.status)}${gradingHelp()}</div>
  <section class="metrics" aria-label="Indicadores de desempenho">${metric("Média em KCs", percent(s.kc), "Referência: 70% ou mais", "metric-primary")}${metric("Média em Labs", percent(s.lab), "Referência: 95% ou mais")}${metric("Atividades com nota", s.completed, "Das atividades já liberadas")}${metric("Sem nota", s.pending, "Seu próximo ponto de partida", "metric-warning")}</section>
<section class="panel"><h2>O que mudou nas suas notas</h2>${personalChanges(state.report.history?.find((r) => r.current)?.changes)}<button class="text-link" data-view="history">Ver meu histórico</button></section><section class="panel"><span class="eyebrow">A CADA PUBLICAÇÃO</span><h2>Seu aprendizado evolui</h2>${evolution()}<p class="small">Média de KCs e Labs em cada publicação. Atividades novas podem mudar a média.</p></section>`;
}

export function activityCard(a) {
  const link = demo || !canvasLinksEnabled ? null : canvasActivityLink(cohortCanvasCourses[state.code], a);
  return `<div class="activity-card"><span class="activity-symbol ${a.kind}">${icon(a.kind === "kc" ? "book" : "network")}</span><div><small>${a.kind === "kc" ? "KNOWLEDGE CHECK" : "LABORATÓRIO"}</small><strong>${e(a.name)}</strong>${link ? `<a class="activity-link" href="${e(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${e(`${link.label}: ${a.name} (abre em nova aba)`)}">${e(link.label)} ${icon("external", 16)}</a>` : ""}</div>${a.state === "completed" ? `<div class="activity-result"><strong class="activity-grade">${percent(a.percent)}</strong>${needsReview(a) ? '<span class="review-hint">Sugestão de revisão</span>' : ""}</div>` : badge(a.state)}</div>`;
}

export function evolution() {
  const rows = [...(state.report.history || [])].reverse().slice(-8);
  if (!rows.length)
    return '<div class="empty compact">A evolução aparecerá após a primeira publicação.</div>';
  return `<div class="chart" role="img" aria-label="Médias nas últimas publicações; valores detalhados em Meu histórico">${rows.map((r) => `<div class="chart-column"><span>${percent(r.total)}</span><div class="chart-track"><i style="height:${Math.max(0, Math.min(100, r.total || 0))}%"></i></div><small>${new Date(r.publishedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small></div>`).join("")}</div>`;
}

export function activitiesPage() {
  const activities = state.report.student.activities;
  const filtered = activities.filter(
    (a) =>
      (state.filter === "all" || (state.filter === "review" ? needsReview(a) : a.state === state.filter)) &&
      (state.activityKind === "all" || a.kind === state.activityKind) &&
      (state.activityModule === "all" || activityModule(state.code, a) === state.activityModule) &&
      a.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").includes(state.search.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR")),
  );
  return `${heading("APRENDER E COLOCAR EM PRÁTICA", "Minhas atividades", "Notas registradas e atividades que ainda serão liberadas.")}${updateInfo()}${gradingHelp()}
  <section class="panel"><div class="table-tools"><label for="activity-kind">Tipo de atividade <select id="activity-kind">${[
    ["all", "KCs e LABs"],
    ["kc", "Somente KCs"],
    ["lab", "Somente LABs"],
  ]
    .map(
      ([key, label]) =>
        `<option value="${key}" ${state.activityKind === key ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><label for="activity-module">Módulo <select id="activity-module" aria-label="Módulo"><option value="all">Todos os módulos</option>${groupActivities(state.code, activities).map(([name]) => `<option value="${e(name)}" ${state.activityModule === name ? "selected" : ""}>${e(name)}</option>`).join("")}</select></label><span class="count-chip" role="status">${filtered.length} atividade(s)</span></div><div class="table-tools"><div class="tabs" role="group" aria-label="Filtrar atividades">${[
    ["all", "Todas"],
    ["pending", "Sem nota"],
    ["review", "Revisar resultados"],
    ["completed", "Com nota"],
    ["unreleased", "Não liberadas"],
    ["exempt", "Dispensadas"],
  ]
    .map(
      ([id, label]) =>
        `<button class="tab ${state.filter === id ? "selected" : ""}" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><input id="search" type="search" aria-label="Buscar atividade" placeholder="Buscar atividade…" value="${e(state.search)}"></div><p class="small">Revisão: KCs abaixo de 70% e LABs abaixo de 95%, entre as atividades com nota. É uma sugestão de estudo; confirme com o instrutor se há possibilidade de nova tentativa.</p><div id="activity-list">${filtered.length ? activityGroups(filtered) : '<div class="empty"><p>Nenhuma atividade encontrada neste filtro.</p><button class="button secondary" data-action="clear-filters">Limpar filtros</button></div>'}</div></section>`;
}

export function activityGroups(activities) {
  return groupActivities(state.code, activities).map(([name, items], i) => {
    const counts = `${items.filter((a) => a.state === "completed").length} com nota · ${items.filter((a) => a.state === "pending").length} sem nota · ${items.filter(needsReview).length} para revisar`;
    return `<details class="activity-module" ${(i === 0 || state.filter !== "all" || state.search || state.activityModule !== "all") ? "open" : ""}><summary><strong>${e(name)}</strong><span>${items.length} atividade(s) neste filtro · ${counts}</span></summary>${items.map(activityCard).join("")}</details>`;
  }).join("");
}

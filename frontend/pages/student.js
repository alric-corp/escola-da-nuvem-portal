import { activityModule, groupActivities, needsReview, nextActivities } from "../student-journey.js";
import { canvasActivityLink, cohortCanvasCourses } from "../canvas-links.js";
import { badge, canvasLinksEnabled, demo, e, gradingHelp, heading, icon, metric, normalize, percent, personalChanges, state, studentBadge, updateInfo } from "../ui.js";

export function studentPage(name) {
  const s = state.report.student;
  const pending = s.activities.filter((a) => a.state === "pending");
  const pendingKc = pending.filter((a) => a.kind === "kc").length;
  const pendingLab = pending.filter((a) => a.kind === "lab").length;
  const review = s.activities.filter(needsReview);
  const focus = state.report.focus?.activityIds || [];
  const next = nextActivities(s.activities, focus);
  const thresholds = state.report.thresholds || { kc: 70, lab: 95 };
  return `${heading("SUA JORNADA DE APRENDIZADO", `Bom ter você aqui, ${e(name)}.`, "Acompanhe suas conquistas e organize os próximos passos.")}${updateInfo()}
  <section class="journey student-summary"><div><span class="pill">TURMA ${e(state.code)}</span><h2>Seu resumo</h2><p>${s.completed} com nota · ${pending.length} sem nota · ${review.length} para revisar.</p><button class="button primary" data-view="activities">Ver minhas atividades ${icon("arrow")}</button></div><div class="ring" style="--progress:${s.progress || 0}%"><div><strong>${percent(s.progress)}</strong><span>das atividades<br>com nota</span></div></div></section>
  <section class="panel next-steps" aria-labelledby="pending-heading"><div class="panel-title"><div><span class="eyebrow">PRÓXIMOS PASSOS</span><h2 id="pending-heading">${focus.length ? "Foco indicado pelo instrutor" : "Por onde começar"}</h2><p class="small">${focus.length ? "Até três atividades indicadas para a turma. Aqui aparecem apenas as que estão sem nota ou podem ser revisadas por você." : "Até três atividades: primeiro as sem nota, na ordem da publicação; depois, sugestões de revisão."}</p></div></div>
  <div class="next-summary"><button class="button secondary" data-view="activities" data-pending="all">Ver minhas pendências · ${pending.length}</button><button class="button secondary" data-view="activities" data-activity-filter="review">Revisar resultados · ${review.length}</button></div>
  <p class="small">Sem nota pode significar entrega ou correção pendente. Se já entregou no Canvas, aguarde a próxima atualização.</p>
  ${next.length ? next.map(activityCard).join("") : `<p class="empty compact">${focus.length ? "Você já tem notas na referência nas atividades indicadas ou está dispensado delas. Consulte as demais atividades abaixo." : s.activities.some((a) => ["pending", "completed"].includes(a.state)) ? "As atividades avaliadas estão na referência. Continue acompanhando as próximas liberações." : "Ainda não há atividades para entrega ou revisão nesta publicação."}</p>`}
  <button class="text-link" data-view="activities">Ver todas as atividades ${icon("arrow", 16)}</button></section>  <div class="grade-context">${studentBadge(s, thresholds)}${gradingHelp(thresholds)}</div>
  <section class="metrics" aria-label="Indicadores de desempenho">${metric("Média em KCs", percent(s.kc), pendingKc ? `Referência: ${thresholds.kc}% ou mais · ${pendingKc} sem nota conta(m) como 0%` : `Referência: ${thresholds.kc}% ou mais`, "metric-primary")}${metric("Média em Labs", percent(s.lab), pendingLab ? `Referência: ${thresholds.lab}% ou mais · ${pendingLab} sem nota conta(m) como 0%` : `Referência: ${thresholds.lab}% ou mais`)}${metric("Atividades com nota", s.completed, "Das atividades já liberadas")}${metric("Sem nota", s.pending, "Seu próximo ponto de partida", "metric-warning")}</section>
<section class="panel"><h2>O que mudou nas suas notas</h2>${personalChanges(state.report.history?.find((r) => r.current)?.changes)}<button class="text-link" data-view="history">Ver meu histórico</button></section><section class="panel"><span class="eyebrow">A CADA PUBLICAÇÃO</span><h2>Seu aprendizado evolui</h2>${evolution()}<p class="small">Média de KCs e de LABs em cada publicação. Atividades novas podem mudar a média.</p></section>`;
}

export function activityCard(a) {
  const courseId = state.report?.canvasCourseId ?? cohortCanvasCourses[state.code];
  const link = demo || !canvasLinksEnabled ? null : canvasActivityLink(courseId, a);
  return `<div class="activity-card"><span class="activity-symbol ${a.kind}">${icon(a.kind === "kc" ? "book" : "network")}</span><div><small>${a.kind === "kc" ? "KNOWLEDGE CHECK" : "LABORATÓRIO"}</small><strong>${e(a.name)}</strong>${link ? `<a class="activity-link" href="${e(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${e(`${link.label}: ${a.name} (abre em nova aba)`)}">${e(link.label)} ${icon("external", 16)}</a>` : ""}</div>${a.state === "completed" ? `<div class="activity-result"><strong class="activity-grade">${percent(a.percent)}</strong>${needsReview(a) ? '<span class="review-hint">Sugestão de revisão</span>' : ""}</div>` : badge(a.state)}</div>`;
}

export function evolution() {
  const rows = [...(state.report.history || [])].reverse().slice(-8);
  if (!rows.length)
    return '<div class="empty compact">A evolução aparecerá após a primeira publicação.</div>';
  const t = state.report.thresholds || { kc: 70, lab: 95 };
  const W = 360, H = 180, left = 30, right = 10, top = 10, bottom = 24;
  const pw = W - left - right, ph = H - top - bottom;
  const x = (i) => (left + (rows.length === 1 ? pw / 2 : (i * pw) / (rows.length - 1))).toFixed(1);
  const y = (v) => (top + ph - (Math.max(0, Math.min(100, v)) / 100) * ph).toFixed(1);
  const series = (key) => {
    const points = rows.map((r, i) => (r[key] == null ? null : [x(i), y(r[key])])).filter(Boolean);
    if (!points.length) return "";
    return `<path class="evo-line evo-${key}" d="M${points.map((pt) => pt.join(" ")).join(" L")}"/>${points.map(([cx, cy]) => `<circle class="evo-dot evo-${key}" cx="${cx}" cy="${cy}" r="3"/>`).join("")}`;
  };
  const reference = (key, label) =>
    `<line class="evo-ref evo-${key}" x1="${left}" x2="${W - right}" y1="${y(t[key])}" y2="${y(t[key])}"/><text class="evo-ref-label evo-${key}" x="${W - right}" y="${(y(t[key]) - 3).toFixed(1)}" text-anchor="end">${label} ${t[key]}%</text>`;
  const grid = [0, 50, 100].map((v) => `<line class="evo-grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text class="evo-axis" x="${left - 4}" y="${(Number(y(v)) + 3).toFixed(1)}" text-anchor="end">${v}%</text>`).join("");
  const dates = rows.map((r, i) => `<text class="evo-axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${new Date(r.publishedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>`).join("");
  return `<figure class="evolution"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Médias de KCs e LABs nas últimas ${rows.length} publicações, com as referências da turma; valores detalhados em Meu histórico">${grid}${reference("kc", "KC")}${reference("lab", "LAB")}${series("kc")}${series("lab")}${dates}</svg><figcaption class="evolution-legend"><span class="evo-key evo-kc">KCs</span><span class="evo-key evo-lab">LABs</span><span class="evo-key evo-ref-key">referência da turma</span></figcaption></figure>`;
}

export function activitiesPage() {
  const activities = state.report.student.activities;
  const courseId = state.report.canvasCourseId;
  const thresholds = state.report.thresholds || { kc: 70, lab: 95 };
  const filtered = activities.filter(
    (a) =>
      (state.filter === "all" || (state.filter === "review" ? needsReview(a) : a.state === state.filter)) &&
      (state.activityKind === "all" || a.kind === state.activityKind) &&
      (state.activityModule === "all" || activityModule(state.code, a, courseId) === state.activityModule) &&
      normalize(a.name).includes(normalize(state.search)),
  );
  return `${heading("APRENDER E COLOCAR EM PRÁTICA", "Minhas atividades", "Notas registradas e atividades que ainda serão liberadas.")}${updateInfo()}${gradingHelp(thresholds)}
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
    )}</select></label><label for="activity-module">Módulo <select id="activity-module" aria-label="Módulo"><option value="all">Todos os módulos</option>${groupActivities(state.code, activities, courseId).map(([name]) => `<option value="${e(name)}" ${state.activityModule === name ? "selected" : ""}>${e(name)}</option>`).join("")}</select></label><span class="count-chip" role="status">${filtered.length} atividade(s)</span></div><div class="table-tools"><div class="tabs" role="group" aria-label="Filtrar atividades">${[
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
    )}</div><input id="search" type="search" aria-label="Buscar atividade" placeholder="Buscar atividade…" value="${e(state.search)}"></div><p class="small">Revisão: KCs abaixo de ${thresholds.kc}% e LABs abaixo de ${thresholds.lab}%, entre as atividades com nota. É uma sugestão de estudo; confirme com o instrutor se há possibilidade de nova tentativa.</p><div id="activity-list">${filtered.length ? activityGroups(filtered) : '<div class="empty"><p>Nenhuma atividade encontrada neste filtro.</p><button class="button secondary" data-action="clear-filters">Limpar filtros</button></div>'}</div></section>`;
}

export function activityGroups(activities) {
  return groupActivities(state.code, activities, state.report.canvasCourseId).map(([name, items], i) => {
    const counts = `${items.filter((a) => a.state === "completed").length} com nota · ${items.filter((a) => a.state === "pending").length} sem nota · ${items.filter(needsReview).length} para revisar`;
    return `<details class="activity-module" ${(i === 0 || state.filter !== "all" || state.search || state.activityModule !== "all") ? "open" : ""}><summary><strong>${e(name)}</strong><span>${items.length} atividade(s) neste filtro · ${counts}</span></summary>${items.map(activityCard).join("")}</details>`;
  }).join("");
}

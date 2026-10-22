import { activityModule, groupActivities, needsReview, nextActivities } from "../student-journey.js";
import { canvasActivityLink } from "../canvas-links.js";
import { badge, canvasLinksEnabled, current, demo, e, formatOperationalDate, goalIndicator, gradingHelp, heading, icon, nextCanvasSync, normalize, percent, percentStudent, personalChanges, plural, updateInfo } from "../ui.js";
import { state } from "../state.js";

export function studentPage(name) {
  const s = state.report.student;
  const pending = s.activities.filter((a) => a.state === "pending");
  const pendingKc = pending.filter((a) => a.kind === "kc").length;
  const pendingLab = pending.filter((a) => a.kind === "lab").length;
  const review = s.activities.filter(needsReview);
  const focus = state.report.focus?.activityIds || [];
  const next = nextActivities(s.activities, focus);
  const thresholds = state.report.thresholds || { kc: 70, lab: 95 };
  // Piloto visual (docs/design-visual.md): .student-home delimita os estilos novos. A ordem segue a leitura do aluno:
  // situação (cobertura e médias x referência, com a ajuda de leitura junto), atualização como contexto discreto, o
  // que fazer agora e, ao lado, o que mudou. A turma não se repete no resumo: já está no topo e no seletor.
  return `<div class="student-home">${heading("", `Bom ter você aqui, ${e(name)}.`, "Acompanhe suas conquistas e organize os próximos passos.")}
  <section class="journey student-summary" aria-labelledby="summary-heading"><div class="summary-overview"><div class="summary-text"><h2 id="summary-heading">Seu resumo</h2>${coverage(s)}${s.completed + s.pending ? `<ul class="summary-counts" role="list"><li class="count-pending">${pending.length} sem nota</li><li class="count-review">${review.length} para revisar</li></ul>` : ""}<button class="button primary" data-view="activities">Ver minhas atividades ${icon("arrow")}</button></div></div>
  <div class="summary-goals">${goalIndicator("Média em KCs", s.kc, thresholds.kc, pendingKc, "KC")}${goalIndicator("Média em Labs", s.lab, thresholds.lab, pendingLab, "LAB")}</div><div class="grade-context">${gradingHelp(thresholds)}</div></section>
  ${updateInfo()}
  <div class="student-columns"><section class="panel next-steps" aria-labelledby="pending-heading"><div class="panel-title"><div><h2 id="pending-heading">${focus.length ? "Foco indicado pelo instrutor" : "Por onde começar"}</h2><p class="small">${focus.length ? "Até três atividades indicadas para a turma. Aqui aparecem apenas as que estão sem nota ou podem ser revisadas por você." : "Até três atividades: primeiro as sem nota, na ordem da publicação; depois, sugestões de revisão."}</p></div></div>
  ${pending.length || review.length ? `<div class="next-summary">${pending.length ? `<button class="button secondary" data-view="activities" data-pending="all">Ver minhas pendências · ${pending.length}</button>` : ""}${review.length ? `<button class="button secondary" data-view="activities" data-activity-filter="review">Revisar resultados · ${review.length}</button>` : ""}</div>` : ""}
  ${next.length ? `<div class="next-list">${next.map((a) => activityCard(a)).join("")}</div>` : `<p class="empty compact">${focus.length ? "Você já tem notas na referência nas atividades indicadas ou está dispensado delas. Consulte as demais atividades abaixo." : s.activities.some((a) => ["pending", "completed"].includes(a.state)) ? "As atividades avaliadas estão na referência. Continue acompanhando as próximas liberações." : "Ainda não há atividades para entrega ou revisão nesta publicação."}</p>`}
  <p class="small next-note">${current()?.autoSync ? `Sem nota pode significar entrega ou correção pendente. Quando a nota sair no Canvas, ela aparece aqui na próxima verificação (${nextCanvasSync()}).` : "Sem nota pode significar entrega ou correção pendente. Se já entregou no Canvas, aguarde a próxima atualização."}</p>
  <button class="text-link" data-view="activities">Ver todas as atividades ${icon("arrow", 16)}</button></section>
  <div class="student-aside"><section class="panel"><h2>O que mudou nas suas notas</h2>${personalChanges(state.report.history?.find((r) => r.current)?.changes)}<button class="text-link" data-view="history">Ver meu histórico</button></section><section class="panel"><h2>Seu aprendizado evolui</h2>${evolution()}<p class="small">Média de KCs e de LABs em cada publicação. Atividades novas podem mudar a média.</p></section></div></div></div>`;
}

// Cobertura: quantas atividades liberadas já têm nota, em texto e numa régua com um segmento por atividade (cheio
// com nota, só contorno sem nota). Usa as contagens do relatório, as mesmas do progress do backend; sem porcentagem,
// para não se confundir com as médias. Acima de 24 segmentos, barra contínua.
function coverage(s) {
  const total = (s.completed || 0) + (s.pending || 0);
  if (!total) return '<div class="coverage"><p class="coverage-text">Nenhuma atividade liberada ainda</p></div>';
  const shape = total > 24
    ? `<span class="coverage-bar" aria-hidden="true"><b style="width:${s.progress ?? (s.completed / total) * 100}%"></b></span>`
    : `<span class="coverage-ruler" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i${i < s.completed ? ' class="is-graded"' : ""}></i>`).join("")}</span>`;
  return `<div class="coverage"><p class="coverage-text">${s.completed} de ${plural(total, "atividade", "atividades")} com nota</p>${shape}</div>`;
}

// Estados do painel do aluno fora do conteúdo normal (app.js decide quando): mesmos textos e papéis de antes,
// dentro de .student-home para seguirem o piloto. O esboço do resumo é estático (sem brilho animado) e fica fora da
// leitura assistiva; quem anuncia o carregamento continua sendo o role="status".
export function studentLoading() {
  return `<div class="student-home is-loading"><section class="panel empty" role="status">Carregando sua turma…</section><div class="journey student-summary summary-sketch" aria-hidden="true"><div class="summary-overview"><div class="summary-text"><i></i><i></i><i></i></div></div><div class="summary-goals"><div class="goal"><i></i><i></i><i></i></div><div class="goal"><i></i><i></i><i></i></div></div></div></div>`;
}

export function studentHomeState(html) {
  return `<div class="student-home">${html}</div>`;
}

// Expansão 1 (docs/design-visual.md): "Minhas atividades" e seus estados ficam dentro de .student-activities, que
// delimita os estilos da tela (seção 31 do CSS). titled: o estado leva o título da tela (3.3: no erro, para a tela
// continuar identificada; o carregamento fica sem título, e o foco da C7.1 depois da carga continua no <main>).
export function studentActivitiesState(html, titled = false) {
  return `<div class="student-activities">${titled ? activitiesHeading() : ""}${html}</div>`;
}

const activitiesHeading = () => heading("", "Minhas atividades", "Notas registradas e atividades que ainda serão liberadas.");

export function activityCard(a, studentView = true) {
  const link = demo || !canvasLinksEnabled ? null : canvasActivityLink(a);
  return `<div class="activity-card"><span class="activity-symbol ${a.kind}">${icon(a.kind === "kc" ? "book" : "network")}</span><div><small>${a.kind === "kc" ? "KNOWLEDGE CHECK" : "LABORATÓRIO"}</small><strong>${e(a.name)}</strong>${link ? `<a class="activity-link" href="${e(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${e(`${link.label}: ${a.name} (abre em nova aba)`)}">${e(link.label)} ${icon("external", 16)}</a>` : ""}</div>${a.state === "completed" ? `<div class="activity-result"><strong class="activity-grade">${(studentView ? percentStudent : percent)(a.percent)}</strong>${needsReview(a) ? '<span class="review-hint">Sugestão de revisão</span>' : ""}</div>` : badge(a.state)}</div>`;
}

export function evolution() {
  const rows = [...(state.report.history || [])].reverse().slice(-8);
  if (!rows.length)
    return '<div class="empty compact">A evolução aparecerá após a primeira publicação.</div>';
  const t = state.report.thresholds || { kc: 70, lab: 95 };
  // Margem direita reservada aos rótulos das referências: fora da área dos pontos, um rótulo não cobre a última nota.
  const W = 360, H = 180, left = 30, right = 72, top = 10, bottom = 24;
  const pw = W - left - right, ph = H - top - bottom;
  const x = (i) => (left + (rows.length === 1 ? pw / 2 : (i * pw) / (rows.length - 1))).toFixed(1);
  const y = (v) => (top + ph - (Math.max(0, Math.min(100, v)) / 100) * ph).toFixed(1);
  const series = (key) => {
    const points = rows.map((r, i) => (r[key] == null ? null : [x(i), y(r[key])])).filter(Boolean);
    if (!points.length) return "";
    return `<path class="evo-line evo-${key}" d="M${points.map((pt) => pt.join(" ")).join(" L")}"/>${points.map(([cx, cy]) => `<circle class="evo-dot evo-${key}" cx="${cx}" cy="${cy}" r="3"/>`).join("")}`;
  };
  // O marcador não leva a classe evo-kc/evo-lab: ela identifica as séries (linha e pontos), não as referências.
  // Referências próximas (ex.: 70% e 75%) teriam rótulos sobrepostos: o de LAB se afasta até haver 13 unidades entre eles.
  const labelY = { kc: Number(y(t.kc)) + 4, lab: Number(y(t.lab)) + 4 };
  if (Math.abs(labelY.kc - labelY.lab) < 13) labelY.lab = labelY.kc + (labelY.lab > labelY.kc ? 13 : -13);
  const reference = (key, label) =>
    `<line class="evo-ref evo-${key}" x1="${left}" x2="${W - right}" y1="${y(t[key])}" y2="${y(t[key])}"/><path class="evo-ref-mark ref-${key}" d="M${W - right} ${y(t[key])}l5 -4v8z"/><text class="evo-ref-label evo-${key}" x="${W - right + 8}" y="${labelY[key].toFixed(1)}" text-anchor="start">${label} ${t[key]}%</text>`;
  const grid = [0, 50, 100].map((v) => `<line class="evo-grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text class="evo-axis" x="${left - 4}" y="${(Number(y(v)) + 3).toFixed(1)}" text-anchor="end">${v}%</text>`).join("");
  const dates = rows.map((r, i) => `<text class="evo-axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${formatOperationalDate(r.publishedAt, "dayShort", "—")}</text>`).join("");
  return `<figure class="evolution"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Médias de KCs e LABs nas últimas ${rows.length} publicações, com as referências da turma; valores detalhados em Meu histórico">${grid}${reference("kc", "KC")}${reference("lab", "LAB")}${series("kc")}${series("lab")}${dates}</svg><figcaption class="evolution-legend"><span class="evo-key evo-kc">KCs</span><span class="evo-key evo-lab">LABs</span><span class="evo-key evo-ref-key">referência da turma</span></figcaption></figure>`;
}

export function activitiesPage() {
  const activities = state.report.student.activities;
  const thresholds = state.report.thresholds || { kc: 70, lab: 95 };
  const filtered = activities.filter(
    (a) =>
      (state.filter === "all" || (state.filter === "review" ? needsReview(a) : a.state === state.filter)) &&
      (state.activityKind === "all" || a.kind === state.activityKind) &&
      (state.activityModule === "all" || activityModule(a) === state.activityModule) &&
      normalize(a.name).includes(normalize(state.search)),
  );
  // Lista vazia em três cenários (3.4): sem atividades no relatório, nenhum filtro resolve (sem botão); com atividades,
  // quem esvaziou a lista foi a busca (o termo aparece, como digitado) ou o filtro. O botão diz o que vai limpar; a ação
  // é a mesma.
  const search = state.search, filtersOn = state.filter !== "all" || state.activityKind !== "all" || state.activityModule !== "all";
  const clear = (label) => `<button class="button secondary" data-action="clear-filters">${label}</button>`;
  const empty = !activities.length
    ? '<div class="empty"><p>Ainda não há atividades nesta publicação.</p></div>'
    : search
      ? `<div class="empty"><p>Nenhuma atividade encontrada para “${e(search)}”${filtersOn ? " com os filtros selecionados" : ""}.</p>${clear(filtersOn ? "Limpar busca e filtros" : "Limpar busca")}</div>`
      : `<div class="empty"><p>Nenhuma atividade encontrada neste filtro.</p>${clear("Limpar filtros")}</div>`;
  return `<div class="student-activities">${activitiesHeading()}${updateInfo()}${gradingHelp(thresholds)}
  <section class="panel"><div class="table-tools activity-filters"><label for="activity-kind">Tipo de atividade <select id="activity-kind">${[
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
    )}</select></label><label for="activity-module">Módulo <select id="activity-module" aria-label="Módulo"><option value="all">Todos os módulos</option>${groupActivities(activities).map(([name]) => `<option value="${e(name)}" ${state.activityModule === name ? "selected" : ""}>${e(name)}</option>`).join("")}</select></label><span class="count-chip" role="status">${plural(filtered.length, "atividade", "atividades")}</span></div><div class="table-tools"><div class="tabs" role="group" aria-label="Filtrar atividades">${[
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
    )}</div><input id="search" type="search" aria-label="Buscar atividade" placeholder="Buscar atividade…" value="${e(state.search)}"></div><p class="small">Revisão: KCs abaixo de ${thresholds.kc}% e LABs abaixo de ${thresholds.lab}%, entre as atividades com nota. É uma sugestão de estudo; confirme com o instrutor se há possibilidade de nova tentativa.</p><div id="activity-list">${filtered.length ? activityGroups(filtered) : empty}</div></section></div>`;
}

// Cabeçalho do módulo: progresso ("2 de 3 com nota") e, só quando houver, o que pede ação.
function moduleSummary(items, filtered) {
  const graded = items.filter((a) => a.state === "completed").length;
  const open = items.filter((a) => ["pending", "completed"].includes(a.state)).length;
  const pending = items.filter((a) => a.state === "pending").length;
  const review = items.filter(needsReview).length;
  const flags = `${pending ? `<span class="badge pending">${pending} sem nota</span>` : ""}${review ? `<span class="badge attention">${review} para revisar</span>` : ""}`;
  const progress = open ? `<span class="module-progress">${graded} de ${open} com nota<i aria-hidden="true"><b style="width:${Math.round(graded / open * 100)}%"></b></i></span>` : `<span class="module-progress">Sem atividades liberadas</span>`;
  return `<span class="module-meta">${progress}${flags}${filtered ? `<span class="module-count">${plural(items.length, "atividade neste filtro", "atividades neste filtro")}</span>` : ""}</span>`;
}

// filtered: a lista está filtrada (abre todos os módulos e mostra a contagem do filtro).
export function activityGroups(activities, filtered = state.filter !== "all" || !!state.search || state.activityModule !== "all" || state.activityKind !== "all", studentView = true) {
  const groups = groupActivities(activities);
  // Abre os módulos que pedem ação (sem nota ou para revisar); se nenhum pedir, abre o primeiro.
  const needsAction = (items) => items.some((a) => a.state === "pending" || needsReview(a));
  const anyAction = groups.some(([, items]) => needsAction(items));
  return groups.map(([name, items], i) => {
    const open = filtered || (anyAction ? needsAction(items) : i === 0);
    return `<details class="activity-module" ${open ? "open" : ""}><summary><strong>${e(name)}</strong>${moduleSummary(items, filtered)}</summary>${items.map((a) => activityCard(a, studentView)).join("")}</details>`;
  }).join("");
}

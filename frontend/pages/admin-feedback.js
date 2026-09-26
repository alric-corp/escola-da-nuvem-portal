import { date, e, heading, state } from "../ui.js";
import { feedbackStatuses, feedbackTypes, originLabel, shortDate, statusBadge } from "./feedback.js";

// Área administrativa de feedbacks. Filtros e paginação são aplicados no backend; a tela só
// monta os parâmetros. Conteúdo do usuário sempre como texto (e()).
const author = (f) => f.studentName || f.createdByEmail || "Autor desconhecido";

function summaryCard(label, value, status) {
  const active = state.adminFeedback.filters.status === status;
  return `<button type="button" class="metric metric-filter ${active ? "active" : ""}" data-fb-status="${status}" aria-pressed="${active}"><span>${label}</span><strong>${value}</strong></button>`;
}

function filters() {
  const f = state.adminFeedback.filters;
  const option = (value, label, current) => `<option value="${e(value)}" ${current === value ? "selected" : ""}>${e(label)}</option>`;
  return `<div class="table-tools fb-filters">
  <label for="fb-filter-status">Status <select id="fb-filter-status">${option("", "Todos (sem arquivados)", f.status)}${Object.entries(feedbackStatuses).map(([k, v]) => option(k, v, f.status)).join("")}${option("ALL", "Todos, inclusive arquivados", f.status)}</select></label>
  <label for="fb-filter-type">Tipo <select id="fb-filter-type">${option("", "Todos os tipos", f.type)}${Object.entries(feedbackTypes).map(([k, v]) => option(k, v, f.type)).join("")}</select></label>
  <label for="fb-filter-cohort">Turma <select id="fb-filter-cohort">${option("", "Todas as turmas", f.cohort)}${state.cohorts.map((c) => option(c.code, c.code, f.cohort)).join("")}</select></label></div>`;
}

function listItems() {
  const a = state.adminFeedback;
  if (a.error)
    return `<div class="empty compact" role="alert"><p>${e(a.error)}</p><button class="button secondary" data-action="admin-feedback-retry">Tentar novamente</button></div>`;
  if (!a.items.length) return a.loading ? '<p class="small" role="status">Carregando feedbacks…</p>' : '<p class="empty compact">Nenhum feedback neste filtro.</p>';
  return `<ul class="feedback-list">${a.items.map((f) => `<li><button type="button" class="feedback-card fb-open" data-fb-open="${e(f.id)}"><div class="feedback-meta"><span class="fb-type">${e(feedbackTypes[f.type] || f.type)}</span>${statusBadge(f.status)}</div><strong class="fb-title">${e(f.title)}</strong><small>${e(f.cohort || "Sem turma")} · ${e(author(f))} · ${e(shortDate(f.createdAt))}</small></button></li>`).join("")}</ul>${a.nextCursor ? `<button class="button secondary fb-more" data-action="admin-feedback-more" ${a.loading ? "disabled" : ""}>${a.loading ? "Carregando…" : "Carregar mais"}</button>` : ""}`;
}

function detail(f) {
  const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const student = f.studentName ? e(f.studentName) : f.canvasId ? `Fora da turma atual <small>(Canvas ID ${e(f.canvasId)})</small>` : "—";
  return `<section class="panel fb-detail" aria-labelledby="fb-detail-title"><button type="button" class="text-link" data-fb-back>← Voltar à lista</button>
  <div class="feedback-meta"><span class="fb-type">${e(feedbackTypes[f.type] || f.type)}</span>${statusBadge(f.status)}</div>
  <h2 id="fb-detail-title" class="fb-title">${e(f.title)}</h2><p class="fb-description">${e(f.description)}</p>
  <dl class="fb-facts">${row("Aluno", student)}${row("E-mail", e(f.createdByEmail || "—"))}${row("Turma", e(f.cohort || "Sem turma"))}${row("Enviado em", e(date(f.createdAt)))}${row("Página de origem", e(originLabel(f.page, !!f.canvasId) || "—"))}${row("Publicação", f.publicationId ? `<code>${e(f.publicationId)}</code>` : "—")}${f.updatedBy && f.updatedAt !== f.createdAt ? row("Última mudança de status", e(date(f.updatedAt))) : ""}</dl>
  <div class="fb-actions"><label for="fb-status-select">Status <select id="fb-status-select">${Object.entries(feedbackStatuses).map(([k, v]) => `<option value="${k}" ${k === f.status ? "selected" : ""}>${v}</option>`).join("")}</select></label><button type="button" class="button primary" data-fb-save="${e(f.id)}">Salvar status</button>
  ${f.canViewAsStudent ? `<button type="button" class="button secondary" data-fb-view-as="${e(f.id)}">Visualizar como aluno</button>` : ""}</div></section>`;
}

export function adminFeedbackPage() {
  const a = state.adminFeedback;
  const s = a.summary || { NEW: 0, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 };
  const selected = a.items.find((f) => f.id === a.selectedId);
  const title = heading("", "Feedbacks", "Bugs, sugestões e melhorias enviados por quem usa o portal.");
  if (selected) return `${title}${detail(selected)}`;
  return `${title}<section class="metrics fb-summary" aria-label="Resumo dos feedbacks">${summaryCard("Todos", s.NEW + s.IN_REVIEW + s.RESOLVED, "")}${summaryCard("Novos", s.NEW, "NEW")}${summaryCard("Em análise", s.IN_REVIEW, "IN_REVIEW")}${summaryCard("Resolvidos", s.RESOLVED, "RESOLVED")}</section>
  <section class="panel" aria-labelledby="fb-list-heading"><h2 id="fb-list-heading" class="sr-only">Lista de feedbacks</h2>${filters()}${listItems()}</section>`;
}

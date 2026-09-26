import { e, heading, state, teacher } from "../ui.js";

// Feedback da plataforma (backend/feedback.py). Todo conteúdo vindo do usuário passa por e():
// título e descrição são texto, nunca HTML.
export const feedbackTypes = { BUG: "Bug", SUGGESTION: "Sugestão", IMPROVEMENT: "Melhoria", OTHER: "Outro" };
export const feedbackStatuses = { NEW: "Novo", IN_REVIEW: "Em análise", RESOLVED: "Resolvido", ARCHIVED: "Arquivado" };
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

// Página de onde a pessoa veio (o backend só aceita estes valores), com o nome que o autor via:
// Painel e Publicações são as mesmas telas que Desempenho e Histórico, vistas por instrutor.
export function originLabel(page, asStudent = !teacher()) {
  return {
    overview: asStudent ? "Desempenho" : "Painel do instrutor",
    activities: "Atividades",
    history: asStudent ? "Histórico" : "Publicações da turma",
    import: "Atualizar notas",
    reminders: "Lembretes",
    "reminders-batch": "Lembretes em lote",
    "student-pending": "Pendências do aluno",
    "activity-overview": "Visão por atividade",
    access: "Turmas e acessos",
    "admin-feedback": "Feedbacks",
    onboarding: "Primeiro acesso",
  }[page] || "";
}

export const shortDate = (value) => new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function statusBadge(status) {
  return `<span class="fb-status fb-status-${e(status.toLowerCase())}">${e(feedbackStatuses[status] || status)}</span>`;
}

function myFeedbackList() {
  const list = state.myFeedback;
  if (list.error)
    return `<div class="empty compact" role="alert"><p>${e(list.error)}</p><button class="button secondary" data-action="feedback-retry">Tentar novamente</button></div>`;
  if (!list.items.length)
    return list.loading ? '<p class="small" role="status">Carregando seus feedbacks…</p>' : '<p class="empty compact">Você ainda não enviou feedbacks.</p>';
  return `<ul class="feedback-list">${list.items.map((f) => `<li class="feedback-card"><div class="feedback-meta"><span class="fb-type">${e(feedbackTypes[f.type] || f.type)}</span>${statusBadge(f.status)}</div><strong class="fb-title">${e(f.title)}</strong><small>${e(shortDate(f.createdAt))}</small></li>`).join("")}</ul>${list.nextCursor ? `<button class="button secondary fb-more" data-action="feedback-more" ${list.loading ? "disabled" : ""}>${list.loading ? "Carregando…" : "Carregar mais"}</button>` : ""}`;
}

export function feedbackPage() {
  const d = state.feedbackDraft;
  const origin = originLabel(state.feedbackOrigin);
  return `${heading("", "Ajude a melhorar a plataforma", "Encontrou um problema ou tem uma sugestão? Conte para nós.")}
  <section class="panel feedback-form-panel"><form id="feedback-form" novalidate>
  ${origin ? `<p class="feedback-origin">Sobre: <strong>${e(origin)}</strong></p>` : ""}
  <fieldset class="feedback-types"><legend>Tipo</legend>${Object.entries(feedbackTypes).map(([value, label]) => `<label class="fb-type-option"><input type="radio" name="fb-type" value="${value}" ${d.type === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>
  <label class="fb-field" for="fb-title">Título<input id="fb-title" name="title" maxlength="${TITLE_MAX}" autocomplete="off" value="${e(d.title)}" aria-describedby="fb-title-count"></label><small class="fb-count" id="fb-title-count">${d.title.length}/${TITLE_MAX}</small>
  <label class="fb-field" for="fb-description">Descrição<textarea id="fb-description" name="description" rows="6" maxlength="${DESCRIPTION_MAX}" aria-describedby="fb-description-count">${e(d.description)}</textarea></label><small class="fb-count" id="fb-description-count">${d.description.length}/${DESCRIPTION_MAX}</small>
  ${state.feedbackSent ? '<p class="feedback-success" role="status">Feedback enviado com sucesso.</p>' : ""}
  <div class="form-footer"><button class="button primary" type="submit" ${state.feedbackSending ? "disabled" : ""}>${state.feedbackSending ? "Enviando…" : "Enviar feedback"}</button></div>
  </form></section>
  <section class="panel" aria-labelledby="my-feedback-heading"><h2 id="my-feedback-heading">Meus feedbacks</h2>${myFeedbackList()}</section>`;
}

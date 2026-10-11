import { e, heading, plural, teacher } from "../ui.js";
import { state } from "../state.js";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_SLOTS, ATTACHMENT_TYPES } from "../handlers/feedback.js";

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

export const OPEN_STATUSES = ["NEW", "IN_REVIEW"];
export const fileSize = (bytes) => bytes >= 1024 * 1024
  ? `${(bytes / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
  : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;

// Imagens já aceitas de um feedback. O link de cada uma é temporário (5 minutos) e pedido um a um
// ao backend, que confere autor ou admin; a lista em si não traz links.
export function attachmentGallery(feedbackId) {
  const g = state.feedbackAttachments[feedbackId];
  if (!g) return "";
  if (g.error) return `<p class="small" role="alert">${e(g.error)}</p>`;
  if (g.loading) return '<p class="small" role="status">Carregando imagens…</p>';
  if (!g.items.length) return '<p class="small">Nenhuma imagem anexada.</p>';
  return `<ul class="fb-gallery">${g.items.map((a) => {
    const url = g.urls[a.attachmentId];
    return `<li class="fb-thumb">${url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${e(url)}" alt="" loading="lazy"></a>` : '<span class="fb-thumb-placeholder" aria-hidden="true"></span>'}<span class="fb-file-name">${e(a.originalName)}</span><small>${e(fileSize(a.size))}</small>${url ? `<a class="text-link" href="${e(url)}" target="_blank" rel="noopener noreferrer" aria-label="${e(`Visualizar ${a.originalName} (abre em nova aba)`)}">Visualizar</a>` : ""}</li>`;
  }).join("")}</ul>`;
}

// Imagens escolhidas e ainda não enviadas (prévia local, sem rede).
function selectedFiles() {
  const files = state.feedbackFiles;
  const status = { uploading: "Enviando…", done: "Anexada", failed: "Não foi anexada" };
  return files.length ? `<ul class="fb-files">${files.map((f) => `<li class="fb-file ${f.status === "failed" ? "failed" : ""}"><img src="${e(f.previewUrl)}" alt=""><span class="fb-file-info"><span class="fb-file-name">${e(f.name)}</span><small>${e(fileSize(f.size))}${status[f.status] ? ` · ${status[f.status]}` : ""}</small></span>${["ready", "failed"].includes(f.status) && !state.feedbackSending ? `<button type="button" class="button secondary fb-remove" data-fb-remove-file="${e(f.id)}" aria-label="${e(`Remover ${f.name}`)}">Remover</button>` : ""}</li>`).join("")}</ul>` : "";
}

export const shortDate = (value) => new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function statusBadge(status) {
  return `<span class="fb-status fb-status-${e(status.toLowerCase())}">${e(feedbackStatuses[status] || status)}</span>`;
}

function myFeedbackList() {
  const list = state.myFeedback;
  if (list.error && !list.items.length)
    return `<div class="empty compact" role="alert"><p>${e(list.error)}</p><button class="button secondary" data-action="feedback-retry">Tentar novamente</button></div>`;
  if (!list.items.length)
    return list.loading ? '<p class="small" role="status">Carregando seus feedbacks…</p>' : '<p class="empty compact">Você ainda não enviou feedbacks.</p>';
  return `<ul class="feedback-list">${list.items.map((f) => {
    const count = f.attachments || 0;
    const open = !!state.feedbackAttachments[f.id]?.open;
    const canAdd = OPEN_STATUSES.includes(f.status) && count < ATTACHMENT_SLOTS;
    const progress = state.feedbackCardUpload[f.id];
    return `<li class="feedback-card"><div class="feedback-meta"><span class="fb-type">${e(feedbackTypes[f.type] || f.type)}</span>${statusBadge(f.status)}</div><strong class="fb-title">${e(f.title)}</strong><small>${e(shortDate(f.createdAt))}${count ? ` · ${plural(count, "anexo", "anexos")}` : ""}</small>
    ${count || canAdd ? `<div class="fb-card-actions">${count ? `<button type="button" class="text-link" data-fb-toggle-attachments="${e(f.id)}" aria-expanded="${open}">${open ? "Ocultar anexos" : "Ver anexos"}</button>` : ""}${canAdd ? `<button type="button" class="text-link fb-card-add" data-fb-pick="${e(f.id)}" ${progress?.busy ? "disabled" : ""}>Adicionar imagem</button>` : ""}</div>` : ""}
    ${progress?.message ? `<p class="small fb-card-progress" role="status">${e(progress.message)}</p>` : ""}${open ? attachmentGallery(f.id) : ""}</li>`;
  }).join("")}</ul>${list.error ? `<div class="empty compact" role="alert"><p>${e(list.error)}</p><button class="button secondary fb-more" data-action="feedback-more">Tentar novamente</button></div>`
    : list.nextCursor ? `<button class="button secondary fb-more" data-action="feedback-more" ${list.loading ? "disabled" : ""}>${list.loading ? "Carregando…" : "Carregar mais"}</button>` : ""}`;
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
  <fieldset class="fb-attachments"><legend>Anexos (opcional)</legend>
  <p class="small">Você pode adicionar até 3 imagens PNG, JPEG ou WebP de até 5 MB cada.</p>
  <p class="small fb-privacy">Evite incluir senhas, documentos ou outras informações sensíveis na imagem.</p>
  ${selectedFiles()}${state.feedbackFiles.length < ATTACHMENT_SLOTS && !state.feedbackSending && !state.feedbackUpload.feedbackId ? `<button type="button" class="button secondary fb-add" data-fb-pick="form">+ Adicionar imagem</button>` : ""}
  </fieldset>
  ${state.feedbackUpload.progress ? `<p class="small fb-progress" role="status">${e(state.feedbackUpload.progress)}</p>` : ""}
  ${state.feedbackUpload.failed ? '<div class="fb-partial" role="alert"><p>Feedback enviado, mas não foi possível anexar uma das imagens.</p><button type="button" class="button secondary" data-action="feedback-retry-uploads">Tentar novamente</button><button type="button" class="text-link" data-action="feedback-discard-uploads">Descartar imagens</button></div>' : ""}
  ${state.feedbackSent ? '<p class="feedback-success" role="status">Feedback enviado com sucesso.</p>' : ""}
  <div class="form-footer"><button class="button primary" type="submit" ${state.feedbackSending || state.feedbackUpload.feedbackId ? "disabled" : ""}>${state.feedbackSending ? "Enviando…" : "Enviar feedback"}</button></div>
  </form></section>
  <section class="panel" aria-labelledby="my-feedback-heading"><h2 id="my-feedback-heading">Meus feedbacks</h2>${myFeedbackList()}</section>`;
}

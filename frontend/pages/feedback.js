import { e, formatOperationalDate, heading, instant, plural, teacher, timeZoneLabel } from "../ui.js";
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

export const shortDate = (value) => formatOperationalDate(value, "shortDate");

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

// Aluno (Expansão 3): a tela própria, abaixo. Instrutor e admin, que chegam pelo rodapé: a mesma tela de antes.
// view vem do app.js (o que só a tela do aluno guarda): showProblems depois de uma tentativa de envio com o rascunho
// atual; failure, o último envio que falhou ({ message, unsure }: unsure quando não houve resposta do servidor ou ele
// falhou por dentro, e o feedback pode ter chegado); picked, o resultado da última escolha de imagens ({ target: "form"
// ou o id do feedback, refused, attached }); open, os ids das mensagens abertas em "Meus feedbacks".
export function feedbackPage(view = {}) {
  return studentOnly() ? studentFeedbackPage(view) : ownFeedbackPage();
}

function ownFeedbackPage() {
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
  <section class="panel" aria-labelledby="my-feedback-heading"><h2 id="my-feedback-heading">Meus feedbacks</h2><p class="small">${timeZoneLabel}.</p>${myFeedbackList()}</section>`;
}

// Expansão 3 (docs/design-visual.md): Feedback do aluno. Escrever é a tarefa principal (formulário numa superfície
// discreta, à esquerda no desktop); "Meus feedbacks" é o registro do que já foi enviado, sobre o fundo e separado por
// linhas finas. Mesmos ids, data-* e handlers da tela de antes; o que muda é a apresentação: tipos com explicação,
// regras e limites junto dos campos, problemas de validação junto do campo (todos de uma vez), o que vai junto com o
// envio, estado de envio visível e, na lista, a mensagem enviada, a situação (texto e forma) e quando ela mudou.
// .student-feedback delimita os estilos da tela (seção 33 do CSS).
const studentOnly = () => !!state.me && !state.me.roles.some((r) => r === "admin" || r === "instructor");

// Problemas do rascunho com as regras e os textos de handlers/feedback.js::submit, que valida de novo antes de enviar e
// continua sendo a regra (um teste confere que os dois coincidem). Todos de uma vez, na ordem dos campos.
export function feedbackProblems(d) {
  const problems = {};
  if (!d.type) problems.type = "Escolha o tipo do feedback.";
  if (d.title.trim().length < 3) problems.title = "O título deve ter ao menos 3 caracteres.";
  if (d.description.trim().length < 10) problems.description = "A descrição deve ter ao menos 10 caracteres.";
  return problems;
}

// Uma linha de ajuda por tipo, na ordem do contrato (backend/feedback.py::TYPES).
const typeHints = { BUG: "Algo não funciona como deveria.", SUGGESTION: "Uma ideia nova para o portal.",
  IMPROVEMENT: "Algo que já existe pode ficar melhor.", OTHER: "Qualquer outro assunto." };
// Telas de onde o aluno chega ao Feedback, com o nome do menu dele.
const studentOrigins = { overview: "Meu desempenho", activities: "Minhas atividades", history: "Meu histórico", onboarding: "Primeiro acesso" };
const originName = (page) => studentOrigins[page] || originLabel(page, true);
// A data operacional usa Brasília, como em Meu histórico.
const longDate = (d) => formatOperationalDate(d, "longDate");
const validDate = instant;

const problem = (key, text) => text ? `<p class="fb-error" id="fb-${key}-error">${e(text)}</p>` : "";
const invalid = (text) => text ? ' aria-invalid="true"' : "";

function studentFeedbackPage({ showProblems = false, failure = null, picked = null, open = new Set() }) {
  const d = state.feedbackDraft, p = showProblems ? feedbackProblems(d) : {};
  const sending = state.feedbackSending, upload = state.feedbackUpload;
  const describe = (key) => `fb-${key}-hint fb-${key}-count${p[key] ? ` fb-${key}-error` : ""}`;
  const progress = upload.progress || (sending ? "Enviando seu feedback…" : "");
  // O que vai junto com o envio (handlers/feedback.js::submit manda a turma atual e a tela de origem, quando existem).
  const where = state.feedbackOrigin ? originName(state.feedbackOrigin) : "";
  const context = [state.code && `a turma <strong>${e(state.code)}</strong>`, where && `a tela de origem, <strong>${e(where)}</strong>`].filter(Boolean);
  // Com imagens que não foram anexadas, o envio fica parado até a pessoa tentar de novo ou descartar: o botão aponta para
  // o aviso que diz por quê. Depois de um envio que falhou, aponta para o motivo, que continua junto dele.
  const blocked = !sending && upload.failed;
  const reason = blocked ? "fb-partial-text" : failure && !sending ? "fb-send-error-text" : "";
  const refused = picked?.target === "form" ? picked.refused : "";
  return `<div class="student-feedback">${heading("", "Ajude a melhorar a plataforma", "Encontrou um problema ou tem uma sugestão? Conte para nós.")}
  <div class="feedback-layout"><section class="feedback-compose feedback-form-panel" aria-labelledby="fb-new-heading"><h2 id="fb-new-heading">Novo feedback</h2>
  <form id="feedback-form" novalidate${sending ? ' aria-busy="true"' : ""}><p class="fb-required">Tipo, título e descrição são obrigatórios.</p>
  <fieldset class="feedback-types"><legend>Tipo</legend><div class="fb-type-options">${Object.entries(feedbackTypes).map(([value, label]) => {
    const id = `fb-type-${value.toLowerCase()}`;
    return `<label class="fb-type-option"><input type="radio" name="fb-type" id="${id}" value="${value}" required aria-labelledby="${id}-name" aria-describedby="${id}-hint${p.type ? " fb-type-error" : ""}" ${d.type === value ? "checked" : ""}${invalid(p.type)}><span class="fb-type-text"><span class="fb-type-name" id="${id}-name">${label}</span> <span class="fb-type-hint" id="${id}-hint">${typeHints[value]}</span></span></label>`;
  }).join("")}</div>${problem("type", p.type)}</fieldset>
  <div class="fb-field-group"><label class="fb-field" for="fb-title">Título</label><p class="fb-hint" id="fb-title-hint">Em poucas palavras, de 3 a ${TITLE_MAX} caracteres.</p>
  <input id="fb-title" name="title" maxlength="${TITLE_MAX}" autocomplete="off" required value="${e(d.title)}" aria-describedby="${describe("title")}"${invalid(p.title)}>
  <div class="fb-field-foot">${problem("title", p.title)}<small class="fb-count" id="fb-title-count">${d.title.length}/${TITLE_MAX}</small></div></div>
  <div class="fb-field-group"><label class="fb-field" for="fb-description">Descrição</label><p class="fb-hint" id="fb-description-hint">O que aconteceu ou o que você sugere, e em qual tela. De 10 a ${DESCRIPTION_MAX.toLocaleString("pt-BR")} caracteres.</p>
  <textarea id="fb-description" name="description" rows="4" maxlength="${DESCRIPTION_MAX}" required aria-describedby="${describe("description")}"${invalid(p.description)}>${e(d.description)}</textarea>
  <div class="fb-field-foot">${problem("description", p.description)}<small class="fb-count" id="fb-description-count">${d.description.length}/${DESCRIPTION_MAX}</small></div></div>
  <fieldset class="fb-attachments"><legend>Anexos (opcional)</legend>
  <p class="small">Você pode adicionar até 3 imagens PNG, JPEG ou WebP de até 5 MB cada.</p>
  <p class="small fb-privacy">Evite incluir senhas, documentos ou outras informações sensíveis na imagem.</p>
  ${selectedFiles()}${refused ? `<p class="fb-error" id="fb-files-error" tabindex="-1">${e(refused)}</p>` : ""}${state.feedbackFiles.length < ATTACHMENT_SLOTS && !sending && !upload.feedbackId ? `<button type="button" class="button secondary fb-add" data-fb-pick="form"${refused ? ' aria-describedby="fb-files-error"' : ""}>+ Adicionar imagem</button>` : ""}
  </fieldset>
  ${progress ? `<p class="small fb-progress" role="status">${e(progress)}</p>` : ""}
  ${upload.failed ? `<div class="fb-partial" role="alert"><p id="fb-partial-text">${partialText()}</p><button type="button" class="button secondary" data-action="feedback-retry-uploads">Tentar novamente</button><button type="button" class="text-link" data-action="feedback-discard-uploads">Descartar imagens</button></div>` : ""}
  ${state.feedbackSent ? `<p class="feedback-success" id="fb-sent" role="status" tabindex="-1">${state.feedbackSent === "duplicate" ? "Este feedback já tinha sido enviado. Ele não foi registrado de novo e continua em Meus feedbacks." : "Feedback enviado com sucesso."}</p>` : ""}
  ${failure && !sending ? sendError(failure) : ""}
  <div class="form-footer">${context.length ? `<p class="feedback-origin">Junto com o feedback ${context.length > 1 ? "vão" : "vai"} ${context.join(" e ")}.</p>` : ""}<button class="button primary" type="submit" ${sending || upload.feedbackId ? "disabled" : ""}${reason ? ` aria-describedby="${reason}"` : ""}>${sending ? "Enviando…" : "Enviar feedback"}</button></div>
  </form></section>
  <section class="feedback-history" aria-labelledby="my-feedback-heading"><h2 id="my-feedback-heading">Meus feedbacks</h2><p class="small">${timeZoneLabel}.</p>${studentFeedbackList(open, picked)}</section></div></div>`;
}

// Envio que falhou: fica junto do botão até a próxima tentativa (recebe o foco; o botão aponta para ele). Com resposta do
// servidor (4xx), o feedback não entrou; sem resposta ou com erro interno, pode ter entrado, e enviar de novo o mesmo texto
// devolve o que já existe (backend/feedback.py: envio idêntico em 10 minutos) em vez de registrar outro.
function sendError({ message, unsure }) {
  return `<div class="fb-send-error" id="fb-send-error" tabindex="-1"><p id="fb-send-error-text"><strong>${unsure ? "Não foi possível confirmar o envio." : "O feedback não foi enviado."}</strong> ${e(message)}</p>
  <p>O que você escreveu continua no formulário.${unsure ? " Envie de novo: se ele já tiver chegado, não será registrado duas vezes." : ""}</p></div>`;
}

// Falha parcial das imagens: o feedback já está registrado; só as imagens que faltaram podem ser enviadas de novo (o
// mesmo slot, pelo clientToken) ou deixadas de lado. O texto não é enviado outra vez.
function partialText() {
  const total = state.feedbackFiles.length, failed = state.feedbackFiles.filter((f) => f.status === "failed").length;
  const which = failed <= 1 ? (total > 1 ? "uma das imagens" : "a imagem") : failed === total ? "as imagens" : `${failed} das imagens`;
  return `Feedback enviado, mas não foi possível anexar ${which}. <span class="fb-partial-help">Tente anexar de novo ou descarte ${failed > 1 ? "as que faltaram" : "a que faltou"}: o texto não é enviado outra vez.</span>`;
}

// "Meus feedbacks" do aluno: os mesmos estados da lista de antes (erro sem itens com recomeço; erro em "Carregar mais"
// mantendo os itens e repetindo a mesma página; carregando; vazio), com o registro no lugar dos cartões.
function studentFeedbackList(open, picked) {
  const list = state.myFeedback;
  if (list.error && !list.items.length)
    return `<div class="fb-list-state" role="alert"><p>${e(list.error)}</p><button class="button secondary" data-action="feedback-retry">Tentar novamente</button></div>`;
  if (!list.items.length)
    return list.loading ? '<p class="fb-list-state" role="status">Carregando seus feedbacks…</p>' : '<p class="fb-list-state">Você ainda não enviou feedbacks.</p>';
  return `<p class="fb-list-context">A situação de cada um é atualizada pela equipe do portal.</p>
  <ul class="feedback-list" role="list">${list.items.map((f) => studentFeedbackEntry(f, open.has(f.id), picked?.target === f.id ? picked : null)).join("")}</ul>${list.error ? `<div class="fb-list-state" role="alert"><p>${e(list.error)}</p><button class="button secondary fb-more" data-action="feedback-more">Tentar novamente</button></div>`
    : list.nextCursor ? `<button class="button secondary fb-more" data-action="feedback-more" ${list.loading ? "disabled" : ""}>${list.loading ? "Carregando…" : "Carregar mais"}</button>` : ""}`;
}

// Um feedback: título (o que a pessoa escreveu) e situação por texto e forma, com "desde" quando a equipe a mudou
// (updatedAt só muda com o status: backend/feedback.py::with_status); tipo, data do envio, tela de origem e anexos; a
// mensagem enviada (texto puro, com as quebras de linha). Ações de anexos como antes.
// Mensagem longa: o app.js mede depois de cada render e, com mais de 4 linhas na largura atual, marca .is-long e mostra
// o botão (sem a medida, a mensagem aparece inteira e sem botão). Recolhida, só as 3 primeiras linhas ficam à vista; o
// texto inteiro continua no DOM (leitor de tela, busca, seleção). `opened` vem do app.js e sobrevive aos renders.
function studentFeedbackEntry(f, opened, picked) {
  const count = f.attachments || 0;
  const open = !!state.feedbackAttachments[f.id]?.open;
  const canAdd = OPEN_STATUSES.includes(f.status) && count < ATTACHMENT_SLOTS;
  const progress = state.feedbackCardUpload[f.id];
  const sent = validDate(f.createdAt), changed = f.updatedAt && f.updatedAt !== f.createdAt ? validDate(f.updatedAt) : null;
  const meta = [e(feedbackTypes[f.type] || f.type), sent && `<span class="sr-only">enviado em </span><time datetime="${e(f.createdAt)}">${longDate(sent)}</time>`,
    f.page && originName(f.page) && `a partir de ${e(originName(f.page))}`, f.cohort && f.cohort !== state.code && `turma ${e(f.cohort)}`,
    count && plural(count, "anexo", "anexos")].filter(Boolean);
  // Andamento ou falha do envio pelo item (handler); depois de um envio que deu certo, "Imagem anexada" (app.js).
  const status = progress?.message || (picked?.attached ? "Imagem anexada ao feedback." : ""), refused = picked?.refused;
  const progressId = `fb-card-progress-${f.id}`, errorId = `fb-card-error-${f.id}`;
  const described = [status && progressId, refused && errorId].filter(Boolean).join(" ");
  const toggle = f.description ? `<button type="button" class="text-link fb-message-toggle" data-fb-message="${e(f.id)}" aria-controls="${e(`fb-text-${f.id}`)}" aria-expanded="${opened}" hidden>${opened ? "Recolher mensagem" : "Ler mensagem completa"}</button>` : "";
  return `<li class="feedback-card fb-entry"><div class="fb-entry-head"><h3 class="fb-title">${e(f.title)}</h3><p class="fb-state is-${e(String(f.status).toLowerCase())}"><span class="sr-only">Situação: </span><span class="fb-state-name">${e(feedbackStatuses[f.status] || f.status)}</span>${changed ? ` <span class="fb-state-since">desde <time datetime="${e(f.updatedAt)}">${longDate(changed)}</time></span>` : ""}</p></div>
  <p class="fb-entry-meta">${meta.join(" · ")}</p>${f.description ? `<p class="fb-entry-text${opened ? "" : " is-collapsed"}" id="${e(`fb-text-${f.id}`)}">${e(f.description)}</p>` : ""}
  ${toggle || count || canAdd ? `<div class="fb-card-actions">${toggle}${count ? `<button type="button" class="text-link" data-fb-toggle-attachments="${e(f.id)}" aria-expanded="${open}">${open ? "Ocultar anexos" : "Ver anexos"}</button>` : ""}${canAdd ? `<button type="button" class="text-link fb-card-add" data-fb-pick="${e(f.id)}" ${progress?.busy ? "disabled" : ""}${described ? ` aria-describedby="${e(described)}"` : ""}>Adicionar imagem</button>` : ""}</div>` : ""}
  ${refused ? `<p class="fb-error" id="${e(errorId)}" tabindex="-1">${e(refused)}</p>` : ""}${status ? `<p class="small fb-card-progress" id="${e(progressId)}" role="status" tabindex="-1">${e(status)}</p>` : ""}${open ? attachmentGallery(f.id) : ""}</li>`;
}

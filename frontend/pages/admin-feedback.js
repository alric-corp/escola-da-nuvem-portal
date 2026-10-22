import { e, formatOperationalDate, heading, instant, plural, timeZoneLabel } from "../ui.js";
import { state } from "../state.js";
import { attachmentGallery, feedbackStatuses, feedbackTypes, originLabel, statusBadge } from "./feedback.js";

// Feedbacks administrativos (Expansão 9): uma caixa de entrada do portal inteiro (backend/portal.py, só admin). Filtros e
// paginação são aplicados no backend; a tela só monta os parâmetros. O resumo é o do portal inteiro (os contadores por status,
// sem os filtros de tipo e turma) e também filtra por status. Cada linha: o título, que abre o feedback; o status por texto e
// forma; tipo, turma, quem enviou, quando e anexos; e o começo da mensagem numa linha só (a mensagem inteira fica no detalhe).
// O detalhe substitui a lista, como antes: a mensagem inteira (texto puro, com as quebras de linha), os anexos, os dados do envio
// e a mudança de status. view (do app.js) traz o andamento (busy: { id, status, title }), o erro (failure: { id, message, unsure,
// stale }) e o status escolhido no feedback aberto (pick). Conteúdo do usuário sempre como texto (e()); nenhum identificador
// interno (o sub do autor ou o de quem mudou o status).
const validDate = instant;
const longDate = (d) => formatOperationalDate(d, "longDate");
const time = (d) => formatOperationalDate(d, "clock");
const stamp = (d, iso) => `<time datetime="${e(iso)}">${longDate(d)} às ${time(d)}</time>`;
const author = (f) => f.studentName || f.createdByEmail || "Autor desconhecido";
const statusName = (status) => feedbackStatuses[status] || status;

// O começo da mensagem numa linha só (as quebras viram espaço), cortado numa palavra até 180 caracteres, com reticências. Conta
// por caractere (um emoji não é partido ao meio); sem espaço onde cortar, corta no limite.
const PREVIEW = 180;
function preview(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim(), chars = Array.from(flat);
  if (chars.length <= PREVIEW) return flat;
  const cut = chars.slice(0, PREVIEW).join(""), space = cut.lastIndexOf(" ");
  return `${(space > cut.length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// Resumo do portal inteiro: os mesmos atalhos de status de antes, com os arquivados; sem resumo (carga, erro), sem números. Cada
// atalho tem id: o render devolve o foco a ele depois da consulta.
const COUNTS = [["", "Todos (sem arquivados)"], ["NEW", "Novos"], ["IN_REVIEW", "Em análise"], ["RESOLVED", "Resolvidos"], ["ARCHIVED", "Arquivados"]];
const counted = (s, status) => (status ? Number(s[status]) || 0 : ["NEW", "IN_REVIEW", "RESOLVED"].reduce((total, key) => total + (Number(s[key]) || 0), 0));
function summary(a) {
  const value = (status) => (a.summary ? ` <strong>${counted(a.summary, status).toLocaleString("pt-BR")}</strong>` : "");
  return `<div class="afb-summary" role="group" aria-labelledby="afb-summary-label"><p class="afb-label" id="afb-summary-label">No portal inteiro</p>${COUNTS.map(([status, label]) =>
    `<button type="button" class="afb-count" id="afb-count-${status || "all"}" data-fb-status="${status}" aria-pressed="${a.filters.status === status}"><span>${label}</span>${value(status)}</button>`).join("")}</div>`;
}

function filters(f) {
  const option = (value, label, current) => `<option value="${e(value)}"${current === value ? " selected" : ""}>${e(label)}</option>`;
  const field = (id, label, options) => `<div class="afb-field"><label for="${id}">${label}</label><select id="${id}">${options}</select></div>`;
  return `<div class="afb-filters">${field("fb-filter-status", "Status", `${option("", "Todos (sem arquivados)", f.status)}${Object.entries(feedbackStatuses).map(([k, v]) => option(k, v, f.status)).join("")}${option("ALL", "Todos, inclusive arquivados", f.status)}`)}${
    field("fb-filter-type", "Tipo", `${option("", "Todos os tipos", f.type)}${Object.entries(feedbackTypes).map(([k, v]) => option(k, v, f.type)).join("")}`)}${
    field("fb-filter-cohort", "Turma", `${option("", "Todas as turmas", f.cohort)}${state.cohorts.map((c) => option(c.code, c.code, f.cohort)).join("")}`)}</div>`;
}

function row(f) {
  const sent = validDate(f.createdAt), text = preview(f.description);
  const meta = [statusBadge(f.status), e(feedbackTypes[f.type] || f.type), e(f.cohort || "Sem turma"), `<span class="sr-only">enviado por </span>${e(author(f))}`,
    sent && `<span class="sr-only">em </span><time datetime="${e(f.createdAt)}">${longDate(sent)}</time>`, f.attachments && plural(f.attachments, "anexo", "anexos")].filter(Boolean);
  return `<li class="afb-row"><h3 class="afb-title"><button type="button" class="fb-open" data-fb-open="${e(f.id)}">${e(f.title)}</button></h3><p class="afb-meta">${meta.join(" · ")}</p>${
    text ? `<p class="afb-preview">${e(text)}</p>` : ""}</li>`;
}

// Carga, erro, caixa vazia (sem nada, ou só com arquivados) e filtro sem resultado; com itens, a lista e o Carregar mais (o erro
// dele mantém os itens e repete a mesma página).
function inbox(a) {
  const filtered = !!(a.filters.status || a.filters.type || a.filters.cohort);
  let body;
  if (a.error && !a.items.length) body = `<div class="afb-error" role="alert"><p>${e(a.error)}</p><button class="button secondary" data-action="admin-feedback-retry">Tentar novamente</button></div>`;
  else if (!a.items.length) body = a.loading ? '<p class="afb-loading" role="status">Carregando feedbacks…</p>'
    : `<p class="afb-empty">${filtered ? "Nenhum feedback neste filtro." : Number(a.summary?.ARCHIVED) ? "Nenhum feedback fora os arquivados." : "Nenhum feedback recebido até agora."}</p>`;
  else body = `<ul class="afb-list" role="list">${a.items.map(row).join("")}</ul>${a.error ? `<div class="afb-error" role="alert"><p>${e(a.error)}</p><button class="button secondary fb-more" data-action="admin-feedback-more">Tentar novamente</button></div>`
    : a.nextCursor ? `<button class="button secondary fb-more" data-action="admin-feedback-more"${a.loading ? " disabled" : ""}>${a.loading ? "Carregando…" : "Carregar mais"}</button>` : ""}`;
  return `<section class="afb-inbox" aria-labelledby="fb-list-heading"><h2 id="fb-list-heading" class="sr-only">Lista de feedbacks</h2><div class="afb-tools">${summary(a)}${filters(a.filters)}</div>${body}</section>`;
}

// A mudança de status: a consequência dita; o seletor no status escolhido (no andamento, o pedido); Salvar status parado enquanto
// o escolhido é o atual (com o motivo) e, como o seletor, durante qualquer mudança em andamento (ligados a ela). O andamento e o
// erro ficam junto da ação, com o mesmo id (o foco fica nele): a recusa diz que nada mudou; a dúvida, que pode ter mudado, e
// leva à lista atualizada, como o 404 e o 409.
const OP = "afb-op-status", REASON = "afb-save-reason";
// O que muda para quem enviou (backend: o próprio feedback mostra o status; imagens só com Novo ou Em análise) e na lista.
const CONSEQUENCE = "Quem enviou vê o status no próprio feedback e só pode anexar imagens enquanto ele está Novo ou Em análise. Os arquivados saem da lista padrão e continuam no filtro Status.";
function opStatus(f, view) {
  const busy = view.busy, failure = view.failure?.id === f.id ? view.failure : null;
  if (busy) return `<p class="afb-op is-busy" id="${OP}" role="status" tabindex="-1">${e(busy.id === f.id ? `Mudando o status para ${statusName(busy.status)}…` : `Mudando o status de “${busy.title}” para ${statusName(busy.status)}…`)}</p>`;
  if (!failure) return "";
  return `<div class="afb-op is-error" id="${OP}" role="alert" tabindex="-1"><p><strong>${failure.unsure ? "Não foi possível confirmar a mudança de status." : "O status não foi alterado."}</strong> <span>${e(failure.message)}</span>${
    failure.unsure ? " <span>O pedido pode ter sido concluído: atualize a lista antes de tentar de novo.</span>" : ""}</p>${
    failure.unsure || failure.stale ? '<button type="button" class="button secondary" id="afb-op-retry" data-action="admin-feedback-consult">Atualizar a lista</button>' : ""}</div>`;
}
function statusAction(f, view) {
  const busy = view.busy, pick = busy?.id === f.id ? busy.status : view.pick || f.status, unchanged = !busy && pick === f.status;
  const stop = busy ? ` aria-describedby="${OP}" disabled` : "";
  return `<section class="afb-status-action" aria-labelledby="afb-status-title"><h3 id="afb-status-title">Mudar o status</h3><p class="afb-note">${CONSEQUENCE}</p><div class="afb-status-form"><label for="fb-status-select">Status</label><select id="fb-status-select"${stop}>${
    Object.entries(feedbackStatuses).map(([k, v]) => `<option value="${k}"${k === pick ? " selected" : ""}>${v}</option>`).join("")}</select><button type="button" class="button primary" data-fb-save="${e(f.id)}"${
    unchanged ? ` aria-describedby="${REASON}" disabled` : stop}>Salvar status</button>${unchanged ? `<p class="afb-reason" id="${REASON}">Escolha outro status para salvar.</p>` : ""}</div>${opStatus(f, view)}</section>`;
}

function detail(f, view) {
  const sent = validDate(f.createdAt), changed = f.updatedAt && f.updatedAt !== f.createdAt ? validDate(f.updatedAt) : null;
  const kind = [e(feedbackTypes[f.type] || f.type), sent && `enviado em ${stamp(sent, f.createdAt)}`].filter(Boolean).join(" · ");
  const student = f.studentName ? e(f.studentName) : f.canvasId ? `Fora da turma atual <small>(Canvas ID ${e(f.canvasId)})</small>` : "Sem vínculo de aluno";
  const fact = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<section class="afb-detail fb-detail" aria-labelledby="fb-detail-title"><button type="button" class="text-link afb-back" data-fb-back>← Voltar à lista</button><div class="afb-head"><p class="afb-kind">${kind}</p><h2 id="fb-detail-title" class="fb-title" tabindex="-1">${e(f.title)}</h2><p class="afb-state"><span class="sr-only">Status: </span>${statusBadge(f.status)}${
    changed ? ` <span class="afb-since">desde ${stamp(changed, f.updatedAt)}</span>` : ""}</p></div><div class="afb-body"><p class="fb-description afb-description">${e(f.description)}</p><section class="fb-detail-attachments afb-attachments" aria-labelledby="fb-attachments-heading"><h3 id="fb-attachments-heading">Anexos</h3>${
    f.attachments ? attachmentGallery(f.id) : '<p class="afb-note">Nenhuma imagem anexada.</p>'}</section></div><div class="afb-side"><section class="afb-sent" aria-labelledby="afb-sent-title"><h3 id="afb-sent-title">Detalhes do envio</h3><dl class="fb-facts afb-facts">${
    fact("Aluno", student)}${fact("E-mail", e(f.createdByEmail || "—"))}${fact("Turma", e(f.cohort || "Sem turma"))}${fact("Página de origem", e(originLabel(f.page, !!f.canvasId) || "—"))}${
    fact("Publicação", f.publicationId ? `<code>${e(f.publicationId)}</code>` : "—")}</dl>${f.canViewAsStudent ? `<button type="button" class="button secondary" data-fb-view-as="${e(f.id)}">Visualizar como aluno</button>` : ""}</section>${
    statusAction(f, view)}</div></section>`;
}

export function adminFeedbackPage(view = {}) {
  const a = state.adminFeedback;
  const selected = a.items.find((f) => f.id === a.selectedId);
  const title = heading("", "Feedbacks", "Bugs, sugestões e melhorias enviados por quem usa o portal, de todas as turmas.");
  return `<div class="admin-feedback">${title}<p class="small">${timeZoneLabel}.</p>${selected ? detail(selected, view) : inbox(a)}</div>`;
}

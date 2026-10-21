// Lembretes: prévia individual, prévia e envio em lote, remetente (consulta e verificação), envio
// individual e cópia da mensagem, com as entradas do painel nas prévias (filtros guardados em
// teacherFilters). Listeners, busy, boot, a navegação global (inclusive "Voltar ao painel", que
// restaura teacherFilters) e as páginas continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice, plural } from "../ui.js";

let render = null;
let syncContext = () => {};

export function configure(options) {
  render = options.render;
  syncContext = options.syncContext || (() => {});
}

let batchPreviewRequest = 0;
let senderRequest = 0;
let pendingRequest = 0;

// A composição invalida leituras ao sair do contexto, mesmo sem iniciar outra chamada.
export function invalidateReads() {
  batchPreviewRequest++;
  senderRequest++;
  pendingRequest++;
  state.sender = null;
  state.senderError = "";
  state.senderLoading = false;
  state.pendingPreview = null;
  state.pendingError = "";
}

export async function loadPending(studentId) {
  const code = state.code;
  if (!["student-pending", "reminders-batch"].includes(state.view)) state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
  state.view = "student-pending";
  state.pendingStudentId = studentId;
  syncContext();
  const request = ++pendingRequest, owner = state.me;
  const current = () => request === pendingRequest && state.me === owner && state.code === code &&
    state.view === "student-pending" && state.pendingStudentId === studentId;
  state.pendingError = "";
  state.pendingPreview = null;
  render();
  try {
    const preview = await api.reminders.pendingPreview(code, { studentId });
    if (current()) {
      state.pendingPreview = preview;
      render();
    }
  } catch (err) {
    if (current()) {
      state.pendingError = err.message;
      render();
      throw err;
    }
  }
}

export async function loadBatchPreview() {
  syncContext();
  const code = state.code, owner = state.me, request = ++batchPreviewRequest;
  const current = () => request === batchPreviewRequest && state.me === owner && state.code === code && state.view === "reminders-batch";
  state.batchError = "";
  state.batchPreview = null;
  state.batchResults = null;
  render();
  try {
    const preview = await api.reminders.batchPreview(code, { studentIds: state.batchIds });
    if (current()) {
      state.batchPreview = preview;
      render();
    }
  } catch (err) {
    if (current()) {
      state.batchError = err.message;
      render();
    }
  }
}

export async function loadSender() {
  syncContext();
  const code = state.code, owner = state.me, request = ++senderRequest;
  const current = () => request === senderRequest && state.me === owner && state.code === code && state.view === "reminders";
  state.sender = null;
  state.senderError = "";
  state.senderLoading = true;
  render();
  try {
    const sender = await api.reminders.senderSettings(code);
    if (current()) state.sender = sender;
  } catch (err) {
    if (current()) state.senderError = err.message;
  } finally {
    if (current()) { state.senderLoading = false; render(); }
  }
}

// ids: o data-ids do botão do painel, lido pelo app.js no clique.
export async function openBatch(ids) {
  state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
  state.view = "reminders-batch";
  state.batchIds = (ids || "").split(",").filter(Boolean);
  await loadBatchPreview();
}

// A pergunta do envio em lote (Expansão 7): a mesma confirmação, no mesmo ponto, dizendo a turma, quem envia, que o envio é
// imediato e sem volta e quantos dos selecionados ficam de fora (os motivos estão na lista).
function batchQuestion(code, p, approved) {
  const out = p.recipients.length - approved;
  return `Enviar lembrete para ${plural(approved, "aluno", "alunos")} da ${code}?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota${p.sample?.from ? `, enviado de ${p.sample.from}` : ""}. O envio começa agora e não pode ser desfeito.${out ? `\n\n${plural(out, "aluno selecionado fica", "alunos selecionados ficam")} de fora; os motivos estão na lista.` : ""}`;
}

// started: avisa quem chamou que o envio vai começar (depois da confirmação e antes do pedido). announce: depois do render do
// resultado, diz se o aviso temporário deve anunciá-lo — quem chama sabe se o resultado recebe o foco; com ele, o aviso
// repetiria a tela (fechamento da Expansão 7). O aviso não afirma o desfecho: o lote pode voltar aceito, sem confirmação ou
// interrompido por conflito.
export async function sendBatch(started = () => {}, announce = () => true) {
  syncContext();
  const code = state.code, owner = state.me, p = state.batchPreview;
  // Uma nova prévia invalida também o resultado do envio anterior, mesmo com os mesmos alunos/publicação.
  // Sair do lote ou trocar de turma torna a resposta irrelevante para a tela, sem cancelar o envio no servidor.
  const request = batchPreviewRequest;
  const current = () => request === batchPreviewRequest && state.me === owner && state.code === code && state.view === "reminders-batch";
  // Só quem a prévia exibida aprovou (sem motivo para pular), qualquer que seja o motivo dos demais: o lote nunca cresce
  // depois da prévia. O servidor revalida cada um e ainda pode pular quem mudou desde então.
  const approvedRecipientIds = p.recipients.filter((r) => !r.skip).map((r) => r.id);
  if (!approvedRecipientIds.length || !confirm(batchQuestion(code, p, approvedRecipientIds.length))) return;
  started();
  try {
    const result = await api.reminders.sendBatch(code, {
      studentIds: approvedRecipientIds, expectedPublicationId: p.publicationId });
    if (!current()) return;
    state.batchResults = result.results;
    render();
    if (announce()) notice("Chegou a resposta do envio em lote. Confira o resultado por aluno.");
  } catch (err) {
    // A sessão vencida (preflight ou 401) leva ao aviso global existente, sem preencher dados do lote.
    // Com outra pessoa autenticada, também esse erro antigo deixa de pertencer à tela atual.
    if (current() || (!state.me && (err.status === 401 || err.message === "Sua sessão expirou. Entre novamente."))) throw err;
  }
}

export async function copyReminder() {
  const message = state.pendingPreview?.message;
  if (!message) return;
  try {
    await navigator.clipboard.writeText(`${message.subject}\n\n${message.text}`);
  } catch {
    throw new Error("Não foi possível copiar. Selecione o texto da prévia e copie manualmente.");
  }
  notice("Mensagem copiada.");
}

// announce: como no envio em lote. O aviso não afirma o desfecho: o remetente pode já estar pronto ou parado por outro motivo.
export async function verifySender(announce = () => true) {
  syncContext();
  const code = state.code, owner = state.me, request = ++senderRequest;
  const current = () => request === senderRequest && state.me === owner && state.code === code && state.view === "reminders";
  try {
    const sender = await api.reminders.verifySender(code);
    if (!current()) return;
    state.sender = sender;
    state.senderLoading = false;
    render();
    if (announce()) notice("Chegou a resposta do pedido de confirmação. Confira a situação do seu remetente.");
  } catch (err) {
    if (current()) throw err;
  } finally {
    if (current() && state.senderLoading) { state.senderLoading = false; render(); }
  }
}

export async function sendReminder() {
  const code = state.code, p = state.pendingPreview;
  const owner = state.me;
  let request = pendingRequest;
  const current = () => request === pendingRequest && state.me === owner && state.code === code &&
    state.pendingStudentId === p?.student.id && state.view === "student-pending";
  if (!p?.message || !confirm(`Enviar este lembrete para ${p.message.to}, usando ${p.message.from}?`)) return;
  let failure;
  try {
    await api.reminders.send(code, {
      studentId: p.student.id, publicationId: p.publicationId, previewHash: p.previewHash });
  } catch (err) {
    failure = err;
  }
  if (!current()) return;
  if (!failure) notice("Mensagem aceita pelo serviço de envio. Consulte o status da entrega.");
  const refresh = loadPending(p.student.id);
  request = pendingRequest;
  await refresh;
  if (failure && current()) throw failure;
}

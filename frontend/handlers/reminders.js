// Lembretes: prévia individual, prévia e envio em lote, remetente (consulta e verificação), envio
// individual e cópia da mensagem, com as entradas do painel nas prévias (filtros guardados em
// teacherFilters). Listeners, busy, boot, a navegação global (inclusive "Voltar ao painel", que
// restaura teacherFilters) e as páginas continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice, plural } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

let batchPreviewRequest = 0;

export async function loadPending(studentId) {
  const code = state.code;
  if (!["student-pending", "reminders-batch"].includes(state.view)) state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
  state.pendingError = "";
  state.view = "student-pending";
  state.pendingStudentId = studentId;
  state.pendingPreview = null;
  render();
  try {
    const preview = await api.reminders.pendingPreview(code, { studentId });
    if (
      state.code === code &&
      state.view === "student-pending" &&
      state.pendingStudentId === studentId
    ) {
      state.pendingPreview = preview;
      render();
    }
  } catch (err) {
    if (
      state.code === code &&
      state.view === "student-pending" &&
      state.pendingStudentId === studentId
    ) {
      state.pendingError = err.message;
      render();
    }
    throw err;
  }
}

export async function loadBatchPreview() {
  const code = state.code;
  const request = ++batchPreviewRequest;
  state.batchError = "";
  state.batchPreview = null;
  state.batchResults = null;
  render();
  try {
    const preview = await api.reminders.batchPreview(code, { studentIds: state.batchIds });
    if (request === batchPreviewRequest && state.code === code && state.view === "reminders-batch") {
      state.batchPreview = preview;
      render();
    }
  } catch (err) {
    if (request === batchPreviewRequest && state.code === code && state.view === "reminders-batch") {
      state.batchError = err.message;
      render();
    }
  }
}

export async function loadSender() {
  const code = state.code;
  state.senderError = "";
  state.senderLoading = true;
  render();
  try {
    const sender = await api.reminders.senderSettings(code);
    if (state.code === code) state.sender = sender;
  } catch (err) {
    if (state.code === code) state.senderError = err.message;
  } finally {
    if (state.code === code) { state.senderLoading = false; render(); }
  }
}

// ids: o data-ids do botão do painel, lido pelo app.js no clique.
export async function openBatch(ids) {
  state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
  state.view = "reminders-batch";
  state.batchIds = (ids || "").split(",").filter(Boolean);
  await loadBatchPreview();
}

export async function sendBatch() {
  const code = state.code, p = state.batchPreview;
  const eligible = p.recipients.filter((r) => !r.skip);
  if (!eligible.length || !confirm(`Enviar lembrete para ${plural(eligible.length, "aluno", "alunos")}?`)) return;
  const result = await api.reminders.sendBatch(code, {
    studentIds: state.batchIds, expectedPublicationId: p.publicationId });
  if (state.code === code && state.view === "reminders-batch") {
    state.batchResults = result.results;
    render();
  }
  notice("Envio em lote concluído. Confira o resultado por aluno.");
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

export async function verifySender() {
  const code = state.code;
  const sender = await api.reminders.verifySender(code);
  if (code === state.code) { state.sender = sender; render(); }
  notice("Confira a mensagem de verificação no seu e-mail institucional e depois verifique novamente.");
}

export async function sendReminder() {
  const code = state.code, p = state.pendingPreview;
  if (!p?.message || !confirm(`Enviar este lembrete para ${p.message.to}, usando ${p.message.from}?`)) return;
  try {
    await api.reminders.send(code, {
      studentId: p.student.id, publicationId: p.publicationId, previewHash: p.previewHash });
    notice("Mensagem aceita pelo serviço de envio. Consulte o status da entrega.");
  } finally {
    if (state.code === code && state.pendingStudentId === p.student.id && state.view === "student-pending") await loadPending(p.student.id);
  }
}

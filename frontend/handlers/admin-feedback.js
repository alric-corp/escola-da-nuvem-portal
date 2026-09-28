// Admin Feedback: listagem, filtros, paginação e mudança de status. Attachments, feedback próprio,
// listeners, busy, foco de DOM e "visualizar como aluno" continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

let adminFeedbackRequest = 0;

export async function load(reset = true) {
  const a = state.adminFeedback;
  const request = ++adminFeedbackRequest;
  const cursor = reset ? null : a.nextCursor;
  Object.assign(a, { loading: true, error: "" }, reset ? { items: [], nextCursor: null } : {});
  render();
  try {
    const page = await api.adminFeedback.list(a.filters, cursor);
    if (request !== adminFeedbackRequest) return;
    Object.assign(a, { items: reset ? page.items : [...a.items, ...page.items], nextCursor: page.nextCursor, summary: page.summary });
  } catch (err) {
    if (request === adminFeedbackRequest) a.error = err.message || "Não foi possível carregar os feedbacks.";
  } finally {
    if (request === adminFeedbackRequest) {
      a.loading = false;
      if (state.view === "admin-feedback") render();
    }
  }
}

export async function setFilter(key, value) {
  state.adminFeedback.filters[key] = value;
  return load(true);
}

// Devolve o item selecionado para o app.js compor com o foco de DOM e o carregamento de attachments.
export function select(id) {
  state.adminFeedback.selectedId = id;
  render();
  return state.adminFeedback.items.find((f) => f.id === id);
}

export function back() {
  state.adminFeedback.selectedId = null;
  render();
}

export async function saveStatus(id, status) {
  const item = state.adminFeedback.items.find((f) => f.id === id);
  if (!item || status === item.status) return;
  const result = await api.adminFeedback.setStatus(item.id, { status, expectedStatus: item.status });
  Object.assign(item, result.feedback);
  render();
  notice("Status do feedback atualizado.");
}

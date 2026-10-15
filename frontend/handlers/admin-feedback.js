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
const newAdminFeedback = () => ({ items: [], nextCursor: null, summary: null, loading: false, error: "",
  filters: { status: "", type: "", cohort: "" }, selectedId: null });

// Outro usuário na mesma aba (ou nenhum, no logout): nada da fila, dos filtros nem da seleção do anterior fica.
// Trocar a referência impede que uma resposta em trânsito do usuário anterior (que guarda a lista antiga) escreva aqui.
let owner = null;
export function resetForUser(email) {
  if (owner === email) return;
  owner = email;
  state.adminFeedback = newAdminFeedback();
}

// quiet: atualiza a primeira página sem esvaziar a tela nem mostrar carregando (usado depois de um 409, para
// o detalhe aberto passar a refletir o servidor). Se falhar, a tela atual é mantida.
export async function load(reset = true, { quiet = false } = {}) {
  const a = state.adminFeedback;
  const request = ++adminFeedbackRequest;
  const cursor = reset ? null : a.nextCursor;
  if (!quiet) {
    Object.assign(a, { loading: true, error: "" }, reset ? { items: [], nextCursor: null } : {});
    render();
  }
  try {
    const page = await api.adminFeedback.list(a.filters, cursor);
    if (request !== adminFeedbackRequest) return;
    Object.assign(a, { items: reset ? page.items : [...a.items, ...page.items], nextCursor: page.nextCursor, summary: page.summary });
    if (quiet && !a.items.some((f) => f.id === a.selectedId)) a.selectedId = null;
  } catch (err) {
    if (request === adminFeedbackRequest && !quiet) a.error = err.message || "Não foi possível carregar os feedbacks.";
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
  let result;
  try {
    result = await api.adminFeedback.setStatus(item.id, { status, expectedStatus: item.status });
  } catch (err) {
    // 409: outra pessoa mudou o status. O expectedStatus local ficou velho (toda nova tentativa daria 409 de novo),
    // então a tela é atualizada com o servidor antes de o erro chegar ao usuário.
    if (err.status === 409) await load(true, { quiet: true });
    throw err;
  }
  Object.assign(item, result.feedback);
  render();
  notice("Status do feedback atualizado.");
}

// Turmas e acessos: solicitações de instrutores, vínculos com turmas e busca de alunos. Os listeners
// e o tratamento de erro (busy) continuam em app.js; aqui fica só a orquestração deste domínio.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

let accessRequest = 0;

export async function loadAccess() {
  const request = ++accessRequest;
  const code = state.code;
  state.accessLoading = true;
  state.accessError = "";
  state.requests = [];
  state.instructors = [];
  render();
  try {
    const [requests, instructors] = await Promise.all([
      api.access.requests(),
      code
        ? api.access.instructors(code)
        : Promise.resolve({ instructors: [] }),
    ]);
    if (request !== accessRequest || code !== state.code) return;
    state.requests = requests.requests;
    state.instructors = instructors.instructors;
  } catch (err) {
    if (request !== accessRequest || code !== state.code) return;
    state.accessError =
      "As solicitações e os vínculos não foram carregados. Tente novamente.";
  } finally {
    if (request === accessRequest && code === state.code) {
      state.accessLoading = false;
      if (state.view === "access") render();
    }
  }
}
export async function searchStudents(query) {
  const code = state.code;
  state.studentQuery = query;
  state.studentSearchError = "";
  state.studentSearchLoading = true;
  render();
  try {
    const result = await api.access.searchStudents(code, { query });
    if (state.code === code) {
      state.studentResults = result.results;
      state.editingStudentId = null;
    }
  } catch (err) {
    if (state.code === code) {
      state.studentSearchError = err.message;
      state.studentResults = null;
    }
  } finally {
    if (state.code === code) {
      state.studentSearchLoading = false;
      render();
    }
  }
}

export async function revokeInstructor(userId) {
  if (!confirm("Remover o acesso deste instrutor à turma selecionada?"))
    return;
  await api.access.revokeInstructor(state.code, { userId });
  await loadAccess();
  notice("Acesso removido.");
}

export async function rejectRequest(userId) {
  if (!confirm("Recusar esta solicitação de acesso?")) return;
  await api.access.rejectRequest(userId);
  await loadAccess();
  notice("Solicitação recusada.");
}

export async function unlinkStudent(canvasId) {
  if (!confirm("Desvincular este aluno? Ele poderá se vincular de novo pelo e-mail no próximo acesso.")) return;
  await api.access.unlinkStudent(state.code, { canvasId });
  await searchStudents(state.studentQuery);
  notice("Aluno desvinculado.");
}

export function startEditName(studentId) {
  state.editingStudentId = studentId;
  render();
}

export function cancelEditName() {
  state.editingStudentId = null;
  render();
}

export function setRequestsFilter(value) {
  state.requestsFilter = value;
  render();
}

export async function submitStudentSearch(form) {
  const query = new FormData(form).get("query").trim();
  if (!query) throw new Error("Digite ao menos um caractere para buscar.");
  await searchStudents(query);
}

export async function saveDisplayName(form) {
  const displayName = new FormData(form).get("displayName").trim();
  if (!displayName) throw new Error("Informe um nome.");
  await api.access.setDisplayName(state.code, { canvasId: form.dataset.editNameForm, displayName });
  await searchStudents(state.studentQuery);
  notice("Nome atualizado.");
}

// A turma vem do formulário da solicitação, não da turma selecionada no menu.
export async function approveInstructor(form) {
  const code = new FormData(form).get("cohort");
  await api.access.addInstructor(code, { userId: form.dataset.user });
  await loadAccess();
  notice("Instrutor vinculado à turma.");
}

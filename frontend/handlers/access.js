// Turmas e acessos: solicitações de instrutores, vínculos com turmas e busca de alunos. Os listeners
// e o tratamento de erro (busy) continuam em app.js; aqui fica só a orquestração deste domínio.
// Expansão 8: as perguntas dizem a pessoa, a turma e a consequência (8.1: também Vincular); started avisa quem chamou que a
// operação vai começar (depois da confirmação e antes do pedido); o resultado de quem saiu da aba não recarrega nem avisa para
// quem entrou; os avisos de sucesso dizem a pessoa e a turma; resposta antiga da busca e da carga é descartada.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

let accessRequest = 0;
let searchRequest = 0;

export async function loadAccess() {
  const request = ++accessRequest;
  const code = state.code, owner = state.me;
  const current = () => request === accessRequest && code === state.code && owner === state.me;
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
    if (!current()) return;
    state.requests = requests.requests;
    state.instructors = instructors.instructors;
  } catch (err) {
    if (!current()) return;
    state.accessError =
      "As solicitações e os vínculos não foram carregados. Tente novamente.";
  } finally {
    if (current()) {
      state.accessLoading = false;
      if (state.view === "access") render();
    }
  }
}
export async function searchStudents(query) {
  const code = state.code, owner = state.me, request = ++searchRequest;
  const current = () => request === searchRequest && state.code === code && state.me === owner;
  state.studentQuery = query;
  state.studentSearchError = "";
  state.studentSearchLoading = true;
  render();
  try {
    const result = await api.access.searchStudents(code, { query });
    if (current()) {
      state.studentResults = result.results;
      state.editingStudentId = null;
    }
  } catch (err) {
    if (current()) {
      state.studentSearchError = err.message;
      state.studentResults = null;
    }
  } finally {
    if (current()) {
      state.studentSearchLoading = false;
      render();
    }
  }
}

export async function revokeInstructor(userId, started = () => {}) {
  const code = state.code, owner = state.me;
  const email = state.instructors.find((i) => i.userId === userId)?.email;
  if (!confirm(`Remover o acesso ${email ? `de ${email}` : "deste instrutor"} à ${code}?\n\nA pessoa deixa de acompanhar a ${code}; o acesso a outras turmas não muda. Se ela for quem envia os lembretes automáticos da ${code}, eles param até outro remetente ser configurado.\n\nEsta tela não tem como devolver o acesso depois.`))
    return;
  started();
  await api.access.revokeInstructor(code, { userId });
  if (state.me !== owner) return;
  await loadAccess();
  notice(`Acesso ${email ? `de ${email} ` : ""}à ${code} removido.`);
}

export async function rejectRequest(userId, started = () => {}) {
  const owner = state.me, email = state.requests.find((r) => r.userId === userId)?.email;
  if (!confirm(`Recusar a solicitação ${email ? `de ${email}` : "deste instrutor"}?\n\nA pessoa não recebe acesso de instrutor. Esta tela não tem como reabrir uma solicitação recusada, e a pessoa não consegue pedir de novo.`)) return;
  started();
  await api.access.rejectRequest(userId);
  if (state.me !== owner) return;
  await loadAccess();
  notice(`Solicitação ${email ? `de ${email} ` : ""}recusada.`);
}

export async function unlinkStudent(canvasId, started = () => {}) {
  const code = state.code, owner = state.me, student = (state.studentResults || []).find((s) => s.id === canvasId);
  const who = student ? `${student.boundEmail ? ` ${student.boundEmail}` : ""} de ${student.name} (ID Canvas ${canvasId})` : ` do aluno ${canvasId}`;
  if (!confirm(`Desvincular a conta${who} na ${code}?\n\nO aluno continua na turma, com as notas; só a conta do portal deixa de estar ligada a ele. Ele poderá se vincular de novo pelo e-mail do Canvas no próximo acesso.`)) return;
  started();
  await api.access.unlinkStudent(code, { canvasId });
  if (state.me !== owner) return;
  await searchStudents(state.studentQuery);
  notice(`A conta de ${student?.name || `Canvas ID ${canvasId}`} foi desvinculada.`);
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

// Busca vazia: o problema fica na tela, onde a busca mostra os erros, sem pedido.
export async function submitStudentSearch(form) {
  const query = new FormData(form).get("query").trim();
  if (!query) {
    searchRequest++;
    Object.assign(state, { studentSearchError: "Digite ao menos um caractere para buscar.", studentResults: null, studentSearchLoading: false });
    render();
    return;
  }
  await searchStudents(query);
}

export async function saveDisplayName(form, started = () => {}) {
  const displayName = new FormData(form).get("displayName").trim();
  if (!displayName) throw new Error("Informe um nome.");
  const owner = state.me;
  started();
  await api.access.setDisplayName(state.code, { canvasId: form.dataset.editNameForm, displayName });
  if (state.me !== owner) return;
  await searchStudents(state.studentQuery);
  notice(`“${displayName}” é o novo nome de exibição.`);
}

// Vincular (Expansão 8.1): a turma é a escolhida no pedido (o app.js confere a escolha), não a do menu nem a primeira da lista. Só
// para um pedido pendente e uma turma da lista atual; a pergunta diz a pessoa, a turma (código e nome) e o que o vínculo permite
// (as rotas da turma que exigem instrutor), com os mesmos identificadores que vão no pedido. Cancelar não envia nada.
export async function approveInstructor(userId, code, started = () => {}) {
  const owner = state.me;
  const request = state.requests.find((r) => r.userId === userId && r.status === "pending");
  const cohort = state.cohorts.find((c) => c.code === code);
  if (!request || !cohort) return;
  const label = cohort.name && cohort.name !== cohort.code ? `${cohort.code} — ${cohort.name}` : cohort.code;
  if (!confirm(`Vincular ${request.email} à turma ${label}?\n\nA pessoa passa a acompanhar a ${code} com as permissões de instrutor: ver as notas de todos os alunos, publicar e restaurar notas, marcar desistências e enviar lembretes por e-mail aos alunos dessa turma. O acesso a outras turmas não muda.`))
    return;
  started();
  await api.access.addInstructor(code, { userId });
  if (state.me !== owner) return;
  await loadAccess();
  notice(`Acesso à ${code} concedido a ${request.email}.`);
}

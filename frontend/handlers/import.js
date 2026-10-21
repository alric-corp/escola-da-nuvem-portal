// Importação: rascunhos por turma, leitura do CSV, prévia e publicação. Os listeners, o tratamento
// de erro (busy), o boot e a navegação depois de publicar continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { current, date, nextCanvasSync, notice, plural } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

const drafts = new Map();
// Uma leitura/conferência por rascunho: uma seleção nova invalida a anterior sem cancelar pedidos de outra turma.
const draftRequests = new Map();
let draftOwner = "";
let draftEpoch = 0;

// Resultado das validações de integridade calculadas pelo backend (backend/integrity.py). A tela só
// apresenta: a publicação é recalculada e bloqueada no servidor, com ou sem esta prévia.
export function blockedByIntegrity(p) {
  return !!p?.integrity?.critical?.length;
}

// Outro usuário na mesma aba: descarta arquivo, confirmação e andamento do anterior;
// a mesma pessoa conserva o rascunho e as operações atuais.
export function resetDraftsForUser(email) {
  if (draftOwner !== email) {
    drafts.clear();
    draftRequests.clear();
    draftEpoch++;
    draftOwner = email;
    Object.assign(state, { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false, importLoading: false });
  }
}

export function saveDraft() {
  if (state.code) drafts.set(state.code, Object.fromEntries(
    ["csv", "filename", "preview", "dirty", "acknowledgeRemoved"].map((k) => [k, state[k]])));
}

// O state passa a ser a fonte da turma aberta: a cópia do Map sai, para não ficar desatualizada (e contar como
// arquivo não publicado) depois que o state mudar. O saveDraft grava de novo ao sair da turma.
export function restoreDraft() {
  Object.assign(state, { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false, importLoading: false }, drafts.get(state.code));
  drafts.delete(state.code);
}

export function hasUnpublishedCsv() {
  return state.csv || [...drafts.values()].some((d) => d.csv);
}

export function discardDrafts() {
  drafts.clear();
  draftRequests.clear();
  draftEpoch++;
  state.csv = "";
}

export async function selectCsv(file) {
  const code = state.code;
  if (!file) return;
  const request = {};
  draftRequests.set(code, request);
  state.importLoading = false;
  state.preview = null;
  state.csv = "";
  state.filename = "";
  if (file.size > 2000000) {
    render();
    throw new Error("Selecione um CSV de até 2 MB.");
  }
  let csv;
  try { csv = await file.text(); }
  catch (err) { if (draftRequests.get(code) === request) throw err; return; }
  if (draftRequests.get(code) !== request) return;
  if (state.code !== code) {
    drafts.set(code, { csv, filename: file.name, preview: null, dirty: false, acknowledgeRemoved: false });
    return;
  }
  state.csv = csv;
  state.filename = file.name;
  state.dirty = false;
  state.acknowledgeRemoved = false;
  render();
}

export function toggleActivity(id, checked) {
  state.preview.activities.find(
    (a) => a.id === id,
  ).active = checked;
  state.dirty = true;
  state.acknowledgeRemoved = false;
  render();
}

export function setAcknowledgeRemoved(checked) {
  state.acknowledgeRemoved = checked;
  render();
}

export async function previewImport() {
  if (state.importLoading) return;
  const code = state.code;
  if (!state.csv)
    throw new Error("Selecione um arquivo CSV para continuar.");
  const body = { csv: state.csv, filename: state.filename };
  if (state.preview)
    body.activeIds = state.preview.activities
      .filter((a) => a.active)
      .map((a) => a.id);
  const request = {};
  draftRequests.set(code, request);
  const current = () => draftRequests.get(code) === request;
  state.importLoading = true;
  render();
  let preview;
  try {
    preview = await api.cohorts.previewImport(code, body);
  } catch (err) {
    if (current()) throw err;
    return;
  } finally {
    if (current() && state.code === code) { state.importLoading = false; render(); }
  }
  if (!current()) return;
  if (state.code !== code) {
    if (drafts.get(code)?.csv === body.csv && drafts.get(code)?.filename === body.filename)
      drafts.set(code, { ...drafts.get(code), preview, dirty: false, acknowledgeRemoved: false });
    return;
  }
  if (state.csv !== body.csv || state.filename !== body.filename) return;
  state.preview = preview;
  state.dirty = false;
  state.acknowledgeRemoved = false;
  render();
  notice("Prévia pronta. Confira as atividades e os resultados.");
}

// Pergunta da publicação (Expansão 6): a turma, quantos alunos, o arquivo, o que sai de vigor e, com a sincronização
// ligada, o que a próxima verificação faz. A mesma confirmação de antes, no mesmo ponto (depois das conferências locais e
// antes do pedido); só o texto diz mais.
function publishQuestion(preview, code) {
  const inForce = state.report?.publication;
  const replaces = inForce ? `A publicação substitui a versão em vigor, de ${date(inForce.publishedAt)}.`
    : state.report ? "Esta será a primeira publicação da turma." : "A publicação substitui a versão em vigor.";
  const sync = current()?.autoSync && current()?.canvasCourseId
    ? [`A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (${nextCanvasSync()}) publica uma nova versão.`] : [];
  return [`Publicar as notas para ${plural(preview.count, "aluno", "alunos")} da ${code}?`, `Arquivo: ${preview.draft?.filename || state.filename}`,
    `${replaces} Os alunos passam a ver as notas deste arquivo.`, ...sync].join("\n\n");
}

// true só quando a publicação terminou na turma que continua aberta: aí app.js leva ao painel,
// recarrega e avisa. Nos outros casos não há mais nada a fazer. started: chamado depois da confirmação e
// antes do pedido (app.js mostra o andamento).
export async function publish(started = () => {}) {
  const code = state.code, preview = state.preview, epoch = draftEpoch;
  if (!preview || state.dirty) return false;
  if (blockedByIntegrity(preview))
    throw new Error("Publicação bloqueada pelas validações de integridade. Confira os itens críticos da prévia.");
  if (preview.changes?.studentsRemoved.length && !state.acknowledgeRemoved)
    throw new Error("Confira e confirme os alunos removidos antes de publicar.");
  if (!confirm(publishQuestion(preview, code))) return false;
  started();
  await api.cohorts.publish(code, { draftId: preview.draft.id, acknowledgeRemoved: state.acknowledgeRemoved });
  // Outra pessoa entrou na aba durante a publicação: os rascunhos e o arquivo na tela já são dela; nada muda nem é avisado.
  if (draftEpoch !== epoch) return false;
  if (drafts.get(code)?.preview === preview) drafts.delete(code);
  if (state.code !== code) { notice(`Atualização publicada na ${code}.`); return false; }
  if (state.preview !== preview) return false;
  state.preview = null;
  state.csv = "";
  state.filename = "";
  return true;
}

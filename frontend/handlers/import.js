// Importação: rascunhos por turma, leitura do CSV, prévia e publicação. Os listeners, o tratamento
// de erro (busy), o boot e a navegação depois de publicar continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

const drafts = new Map();
let draftOwner = "";

// Resultado das validações de integridade calculadas pelo backend (backend/integrity.py). A tela só
// apresenta: a publicação é recalculada e bloqueada no servidor, com ou sem esta prévia.
export function blockedByIntegrity(p) {
  return !!p?.integrity?.critical?.length;
}

// Outro usuário na mesma aba: descarta os rascunhos do anterior. acknowledgeRemoved e
// importLoading ficam como estão, como antes da extração.
export function resetDraftsForUser(email) {
  if (draftOwner !== email) {
    drafts.clear();
    draftOwner = email;
    Object.assign(state, { csv: "", filename: "", preview: null, dirty: false });
  }
}

export function saveDraft() {
  if (state.code) drafts.set(state.code, Object.fromEntries(
    ["csv", "filename", "preview", "dirty", "acknowledgeRemoved"].map((k) => [k, state[k]])));
}

export function restoreDraft() {
  Object.assign(state, { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false, importLoading: false }, drafts.get(state.code));
}

export function hasUnpublishedCsv() {
  return state.csv || [...drafts.values()].some((d) => d.csv);
}

export function discardDrafts() {
  drafts.clear();
  state.csv = "";
}

export async function selectCsv(file) {
  const code = state.code;
  if (!file) return;
  state.preview = null;
  state.csv = "";
  state.filename = "";
  if (file.size > 2000000) {
    render();
    throw new Error("Selecione um CSV de até 2 MB.");
  }
  const csv = await file.text();
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
  state.importLoading = true;
  render();
  let preview;
  try {
    preview = await api.cohorts.previewImport(code, body);
  } finally {
    if (state.code === code) { state.importLoading = false; render(); }
  }
  if (state.code !== code) {
    if (drafts.get(code)?.csv === body.csv)
      drafts.set(code, { ...drafts.get(code), preview, dirty: false, acknowledgeRemoved: false });
    return;
  }
  if (state.csv !== body.csv) return;
  state.preview = preview;
  state.dirty = false;
  state.acknowledgeRemoved = false;
  render();
  notice("Prévia pronta. Confira as atividades e os resultados.");
}

// true só quando a publicação terminou na turma que continua aberta: aí app.js leva ao painel,
// recarrega e avisa. Nos outros casos não há mais nada a fazer.
export async function publish() {
  const code = state.code, preview = state.preview;
  if (!preview || state.dirty) return false;
  if (blockedByIntegrity(preview))
    throw new Error("Publicação bloqueada pelas validações de integridade. Confira os itens críticos da prévia.");
  if (preview.changes?.studentsRemoved.length && !state.acknowledgeRemoved)
    throw new Error("Confira e confirme os alunos removidos antes de publicar.");
  if (!confirm(`Publicar as notas para ${state.preview.count} alunos da ${state.code}?`)) return false;
  await api.cohorts.publish(code, { draftId: preview.draft.id, acknowledgeRemoved: state.acknowledgeRemoved });
  drafts.delete(code);
  if (state.code !== code) { notice(`Atualização publicada na ${code}.`); return false; }
  state.preview = null;
  state.csv = "";
  state.filename = "";
  return true;
}

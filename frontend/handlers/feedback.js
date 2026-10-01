// Feedback próprio: "Meus feedbacks", envio do formulário, imagens escolhidas (prévias locais),
// envio dos anexos direto ao S3 e galeria de anexos. O seletor de arquivos, os listeners, o busy,
// a navegação, a inicialização e "visualizar como aluno" continuam em app.js.
import * as api from "../api.js";
import { state } from "../state.js";
import { notice } from "../ui.js";

let render = null;

export function configure(options) {
  render = options.render;
}

// Anexos (backend/feedback.py): só PNG, JPEG e WebP, até 5 MiB cada, no máximo 3 por feedback.
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_SLOTS = 3;

export async function loadMine(more = false) {
  const list = state.myFeedback;
  const cursor = more ? list.nextCursor : null;
  Object.assign(list, { loading: true, error: "" }, more ? {} : { items: [], nextCursor: null });
  render();
  try {
    const page = await api.feedback.listMine(cursor);
    Object.assign(list, { items: more ? [...list.items, ...page.items] : page.items, nextCursor: page.nextCursor });
  } catch (err) {
    list.error = err.message || "Não foi possível carregar seus feedbacks.";
  } finally {
    list.loading = false;
    if (state.view === "feedback") render();
  }
}

export async function submit() {
  const d = state.feedbackDraft;
  const title = d.title.trim(), description = d.description.trim();
  if (!d.type) throw new Error("Escolha o tipo do feedback.");
  if (title.length < 3) throw new Error("O título deve ter ao menos 3 caracteres.");
  if (description.length < 10) throw new Error("A descrição deve ter ao menos 10 caracteres.");
  state.feedbackSending = true;
  state.feedbackSent = false;
  render();
  try {
    const body = { type: d.type, title, description };
    if (state.code) body.cohort = state.code;
    if (state.feedbackOrigin) body.page = state.feedbackOrigin;
    const result = await api.feedback.create(body);
    state.feedbackDraft = { type: "", title: "", description: "" };
    // Duplicado (mesmo texto em 10 minutos): as imagens complementam o feedback existente.
    state.feedbackUpload = { feedbackId: result.feedback.id, progress: "", failed: false };
    if (!state.feedbackFiles.length || await sendFormImages()) {
      state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
      state.feedbackSent = true;
      notice(result.duplicate ? "Este feedback já tinha sido enviado." : "Feedback enviado com sucesso.");
    } else notice("Feedback enviado, mas não foi possível anexar uma das imagens.", true);
  } finally {
    state.feedbackSending = false;
    render();
  }
  await loadMine();
}

// Anexos do feedback. Validação local só para avisar cedo: o backend e a política do presigned POST
// recusam de novo tipo, tamanho e quantidade, e a conclusão confere os bytes do arquivo.
function pickImages(fileList, room) {
  const accepted = [], problems = new Set();
  for (const file of fileList) {
    if (accepted.length >= room) problems.add(`Você pode anexar até ${ATTACHMENT_SLOTS} imagens por feedback.`);
    else if (!ATTACHMENT_TYPES.includes(file.type)) problems.add("Envie imagens PNG, JPEG ou WebP.");
    else if (!file.size || file.size > ATTACHMENT_MAX_BYTES) problems.add("Cada imagem deve ter até 5 MB.");
    else accepted.push({ id: crypto.randomUUID(), file, name: file.name, size: file.size, type: file.type, previewUrl: URL.createObjectURL(file), status: "ready" });
  }
  if (problems.size) notice([...problems].join(" "), true);
  return accepted;
}

// Imagens escolhidas no seletor do app.js: "form" guarda para enviar junto com o feedback; o id de
// um feedback já enviado recebe a imagem na hora.
export async function addPickedImages(target, files) {
  if (target === "form") {
    state.feedbackFiles.push(...pickImages(files, ATTACHMENT_SLOTS - state.feedbackFiles.length));
    state.feedbackSent = false;
    render();
    return;
  }
  // Imagem nova num feedback já enviado (NEW ou IN_REVIEW, menos de 3): envia na hora.
  const item = state.myFeedback.items.find((f) => f.id === target);
  const entries = pickImages(files, ATTACHMENT_SLOTS - (item?.attachments || 0));
  if (!entries.length) return;
  const card = state.feedbackCardUpload[target] = { busy: true, message: "" };
  try {
    const failed = await uploadImages(target, entries, (text) => { card.message = text; render(); });
    card.message = failed ? "Não foi possível anexar a imagem. Tente de novo." : "";
    if (!failed) notice("Imagem anexada ao feedback.");
  } finally {
    card.busy = false;
    releaseFiles(entries);
    await loadMine();
    if (state.feedbackAttachments[target]?.open) await loadAttachments(target);
  }
}

function releaseFiles(files) {
  for (const f of files) URL.revokeObjectURL(f.previewUrl);
}

// Um anexo: pede o slot (o clientToken faz a repetição devolver o mesmo), envia direto ao S3 pelo
// presigned POST e pede a conclusão, onde o backend confere o arquivo.
async function uploadImage(feedbackId, entry) {
  const slot = await api.feedback.createAttachment(feedbackId, { fileName: entry.name, contentType: entry.type, size: entry.size, clientToken: entry.id });
  if (slot.status === "READY") return;
  await api.uploadAttachmentToS3(slot.upload, entry.file);
  await api.feedback.completeAttachment(feedbackId, slot.attachment.attachmentId);
}

async function uploadImages(feedbackId, entries, progress) {
  let failed = 0;
  for (const [index, entry] of entries.entries()) {
    progress(`Enviando imagem ${index + 1} de ${entries.length}…`);
    entry.status = "uploading";
    render();
    try {
      await uploadImage(feedbackId, entry);
      entry.status = "done";
    } catch (err) {
      entry.status = "failed";
      failed++;
    }
  }
  progress("");
  return failed;
}

async function sendFormImages() {
  const upload = state.feedbackUpload;
  const pending = state.feedbackFiles.filter((f) => f.status !== "done");
  const failed = await uploadImages(upload.feedbackId, pending, (text) => { upload.progress = text; render(); });
  if (failed) {
    upload.failed = true;
    return false;
  }
  releaseFiles(state.feedbackFiles);
  state.feedbackFiles = [];
  state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
  return true;
}

export function removeFile(id) {
  const removed = state.feedbackFiles.filter((f) => f.id === id);
  releaseFiles(removed);
  state.feedbackFiles = state.feedbackFiles.filter((f) => f.id !== id);
  if (state.feedbackUpload.feedbackId && !state.feedbackFiles.some((f) => f.status !== "done")) {
    state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
    state.feedbackSent = true;
  }
  render();
}

export async function retryUploads() {
  state.feedbackSending = true;
  state.feedbackUpload.failed = false;
  render();
  try {
    if (await sendFormImages()) {
      state.feedbackSent = true;
      notice("Imagens anexadas ao feedback.");
    }
  } finally {
    state.feedbackSending = false;
    render();
  }
  await loadMine();
}

export function discardUploads() {
  releaseFiles(state.feedbackFiles);
  state.feedbackFiles = [];
  state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
  render();
}

// Galeria de anexos, usada pelo autor e pelo detalhe do admin (a composição fica em app.js).
export async function loadAttachments(feedbackId) {
  const g = state.feedbackAttachments[feedbackId] = { ...state.feedbackAttachments[feedbackId], open: true, loading: true, error: "", items: [], urls: {} };
  render();
  try {
    g.items = (await api.feedback.attachments(feedbackId)).items;
    // No máximo 3: um link temporário por imagem visível, só quando a galeria abre.
    for (const a of g.items) g.urls[a.attachmentId] = (await api.feedback.attachmentUrl(feedbackId, a.attachmentId)).downloadUrl;
  } catch (err) {
    g.error = err.message || "Não foi possível carregar as imagens.";
  } finally {
    g.loading = false;
    render();
  }
}

// Fechar só esconde: lista e links continuam guardados; abrir de novo busca tudo outra vez.
export function closeAttachments(id) {
  state.feedbackAttachments[id].open = false;
  render();
}

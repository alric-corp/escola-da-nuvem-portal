import { callback, clearSession, login, logout, session } from "./auth.js";
import * as api from "./api.js";
import * as accessHandlers from "./handlers/access.js";
import { $, admin, demo, e, errorPanel, heading, icon, nav, notice, pageLabel, plural, roleLabel, sessionContext, studentViewBanner, teacher } from "./ui.js";
import { state } from "./state.js";
import { landing } from "./pages/landing.js";
import { renderClassReport } from "./pages/class-report.js";
import { activitiesPage, studentPage } from "./pages/student.js";
import { filteredStudents, studentsCsv, teacherPage } from "./pages/teacher.js";
import { activityOverviewPage } from "./pages/activities-overview.js";
import { batchPage, pendingPage, senderPage } from "./pages/reminders.js";
import { historyPage } from "./pages/history.js";
import { blockedByIntegrity, importPage } from "./pages/import.js";
import { accessPage } from "./pages/access.js";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_SLOTS, ATTACHMENT_TYPES, DESCRIPTION_MAX, TITLE_MAX, feedbackPage } from "./pages/feedback.js";
import { adminFeedbackPage } from "./pages/admin-feedback.js";

accessHandlers.configure({ render });

let demoRole = "student",
  config = {};
let reportRequest = 0;
let renderedView = "";
let lastFocusSelector = "";
const drafts = new Map();
let draftOwner = "";
// "Visualizar como aluno" vale só para esta aba: registro em sessionStorage e a marca
// ?modo=visualizar-aluno na URL. Os dois precisam existir para retomar ao recarregar; uma aba
// nova abre como admin normal. O aluno visualizado nunca vai para a URL nem para avanca.context.
const STUDENT_VIEW_KEY = "avanca.student-view";
const STUDENT_VIEW_MARK = "visualizar-aluno";
const studentViews = ["overview", "activities", "history"];

function saveContext() {
  if (!state.me || demo || state.studentView) return;
  localStorage.setItem("avanca.context", JSON.stringify({ owner: state.me.email, code: state.code,
    view: ["student-pending", "reminders-batch"].includes(state.view) ? "overview" : state.view,
    filter: state.filter, search: state.search, sort: state.sort, activityKind: state.activityKind, activityModule: state.activityModule }));
}
function persistStudentView() {
  try {
    sessionStorage.setItem(STUDENT_VIEW_KEY, JSON.stringify({ owner: state.me.email, code: state.studentView.code,
      studentId: state.studentView.studentId, view: studentViews.includes(state.view) ? state.view : "overview",
      returnTo: state.studentView.returnTo || null }));
  } catch { /* Sem sessionStorage a visualização apenas não sobrevive ao recarregar. */ }
}
function storedStudentView() {
  if (new URLSearchParams(location.search).get("modo") !== STUDENT_VIEW_MARK) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STUDENT_VIEW_KEY) || "null");
    if (saved?.owner === state.me.email && typeof saved.code === "string" && /^\d{1,32}$/.test(saved.studentId)) return saved;
  } catch { /* Registro danificado: abre como admin normal. */ }
  return null;
}
function forgetStudentView() {
  state.studentView = null;
  try { sessionStorage.removeItem(STUDENT_VIEW_KEY); } catch { /* Nada a limpar. */ }
  if (new URLSearchParams(location.search).get("modo") === STUDENT_VIEW_MARK) history.replaceState({}, "", location.pathname);
}
function resetStudentFilters() {
  Object.assign(state, { search: "", filter: "all", activityKind: "all", activityModule: "all" });
}
// returnTo: para onde "Sair da visualização" volta; sem ele, Turmas e acessos.
const validReturn = (r) => (r?.view === "admin-feedback" && /^[\w-]{1,40}$/.test(r.feedbackId || "") ? { view: r.view, feedbackId: r.feedbackId } : null);
async function enterStudentView(studentId, returnTo = null) {
  if (!admin() || demo || !state.code || !/^\d{1,32}$/.test(studentId)) return;
  state.studentView = { code: state.code, studentId, name: "", returnTo: validReturn(returnTo) };
  state.view = "overview";
  resetStudentFilters();
  history.replaceState({}, "", `${location.pathname}?modo=${STUDENT_VIEW_MARK}`);
  persistStudentView();
  window.scrollTo(0, 0);
  await loadReport();
}
async function exitStudentView(message = "") {
  const back = state.studentView?.returnTo;
  forgetStudentView();
  reportRequest++; // descarta uma resposta de visualização ainda em andamento
  state.report = null;
  state.reportError = "";
  state.view = back ? back.view : "access";
  resetStudentFilters();
  if (message) notice(message, true);
  if (back) {
    state.adminFeedback.selectedId = back.feedbackId;
    await loadAdminFeedback(true);
  } else await accessHandlers.loadAccess();
}
// Na visualização como aluno só navegação e leitura: nenhuma ação é executada em nome do aluno.
function allowedWhileViewing(button) {
  return studentViews.includes(button.dataset.view) || !!button.dataset.filter ||
    ["exit-student-view", "refresh-report", "clear-filters", "retry-boot", "logout"].includes(button.dataset.action);
}
function saveDraft() {
  if (state.code) drafts.set(state.code, Object.fromEntries(
    ["csv", "filename", "preview", "dirty", "acknowledgeRemoved"].map((k) => [k, state[k]])));
}
function restoreDraft() {
  Object.assign(state, { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false, importLoading: false }, drafts.get(state.code));
}
window.addEventListener("beforeunload", (event) => {
  if (state.csv || [...drafts.values()].some((d) => d.csv)) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function loadClassReport(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(code))
    throw new Error("Informe um código de turma válido.");
  const data = await api.cohorts.classReport(code);
  if (state.classReport?.cohort !== data.cohort) {
    state.classFilter = "all";
    state.classSearch = "";
  }
  state.classReport = data;
  history.replaceState({}, "", `?turma=${encodeURIComponent(code)}`);
  render();
}

function render() {
  if (!state.me) return landing();
  if (state.classReport) return renderClassReport();
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.selectionStart;
  const changedView = renderedView !== state.view;
  if (changedView) lastFocusSelector = "";
  else if (focusId) lastFocusSelector = `#${CSS.escape(focusId)}`;
  else if (focused?.matches("button")) {
    const attr = ["data-action", "data-view", "data-filter", "data-student-pending"].find((name) => focused.hasAttribute(name));
    if (attr) lastFocusSelector = `button[${attr}="${CSS.escape(focused.getAttribute(attr))}"]`;
  }
  renderedView = state.view;
  const name =
    state.report?.student?.name?.split(" ")[0] || state.me.email.split("@")[0];
  // A conta no menu é sempre de quem está autenticado, mesmo visualizando um aluno.
  const accountName = state.studentView ? state.me.email.split("@")[0] : name;
  $("#app").innerHTML =
    `${demo ? `<div class="demo-bar">Demonstração · dados fictícios <button data-action="demo-role">Ver como ${demoRole === "student" ? "instrutor" : "aluno"} ${icon("arrow", 14)}</button><a href="./">Sair da demonstração</a></div>` : ""}
  <a class="skip-link" href="#main-content">Pular para o conteúdo</a><div class="layout"><aside class="sidebar"><a href="./" class="brand"><img class="brand-logo" src="./logo.png" alt="Escola da Nuvem" width="112" height="112" /></a><div class="workspace-label">PORTAL AWS RE/START</div>
  <label class="cohort-label" for="cohort">${teacher() || admin() ? "Turma selecionada" : "Minha turma"}</label><select id="cohort">${state.cohorts.length ? state.cohorts.map((c) => `<option value="${e(c.code)}" ${c.code === state.code ? "selected" : ""}>${e(c.code)}</option>`).join("") : "<option>Nenhuma turma vinculada</option>"}</select>
  <nav aria-label="Menu principal">${nav("overview", teacher() ? "Painel do instrutor" : "Meu desempenho", "grid", teacher() ? "Painel" : "Desempenho")}${!teacher() ? nav("activities", "Minhas atividades", "book", "Atividades") : ""}${nav("history", teacher() ? "Publicações da turma" : "Meu histórico", "clock", teacher() ? "Publicações" : "Histórico")}${teacher() ? nav("import", "Atualizar notas", "upload", "Notas") + nav("reminders", "Lembretes", "out") : ""}${studentOnly() && !state.studentView ? nav("feedback", "Feedback", "message") : ""}${admin() && !state.studentView ? nav("access", "Turmas e acessos", "users", "Acessos") + nav("admin-feedback", "Feedbacks", "inbox") : ""}</nav>
  <div class="sidebar-bottom"><div class="support-card">${icon("network", 28)}<strong>Aprender abre caminhos.</strong><p>Cada atividade é mais um passo na sua jornada.</p></div><div class="account"><span class="avatar">${e(accountName.slice(0, 2).toUpperCase())}</span><div><strong>${e(accountName)}</strong><small>${roleLabel()}</small></div><button class="icon-button" data-action="logout" aria-label="Sair da conta">${icon("out")}</button></div></div></aside>
  <main class="main" id="main-content" tabindex="-1"><header class="topline"><div class="location-context"><span>${state.view === "access" ? "Administração do portal" : state.code ? `Turma ${e(state.code)}` : "Minha conta"}${demo ? " · Demonstração" : ""}</span><strong>${e(pageLabel())}</strong></div>${sessionContext()}</header>
  ${studentViewBanner()}${content(name)}<footer class="main-footer"><span>Escola da Nuvem · AWS re/Start</span>${!studentOnly() && !state.studentView && state.view !== "feedback" ? '<button type="button" class="text-link footer-feedback" data-view="feedback">Enviar feedback</button>' : ""}<span>Seu aprendizado, uma semana de cada vez.</span></footer></main></div>`;
  if (changedView) {
    const title = $("main h1") || $("main");
    title?.setAttribute("tabindex", "-1");
    title?.focus({ preventScroll: true });
  } else if (focusId && document.getElementById(focusId)) {
    const next = document.getElementById(focusId);
    next.focus({ preventScroll: true });
    if (selection != null && ["search", "text"].includes(next.type)) next.setSelectionRange(selection, selection);
  } else if (lastFocusSelector) $(lastFocusSelector)?.focus({ preventScroll: true });
  if (state.studentView) persistStudentView();
  saveContext();
}

// Aluno: Feedback no menu. Instrutor e admin: link discreto no rodapé (o menu deles já é longo).
function studentOnly() {
  return !!state.me && !state.me.roles.some((r) => r === "admin" || r === "instructor");
}

function content(name) {
  if (state.bootError) return errorPanel(state.bootError, "retry-boot");
  if (state.view === "feedback" && !state.studentView) return feedbackPage();
  if (state.view === "admin-feedback" && admin() && !state.studentView) return adminFeedbackPage();
  if (state.view === "access" && admin() && !state.studentView) return accessPage();
  if (!state.code)
    return `${heading("PRIMEIRO ACESSO", `Olá, ${e(name)}.`, "Sua conta está confirmada. Vamos localizar sua turma.")}<section class="panel onboarding"><h2>Ainda não encontramos notas para esta conta</h2><p>Você entrou com <strong>${e(state.me.email)}</strong>.</p><ol><li>Confira se este é o mesmo e-mail cadastrado no Canvas.</li><li>Se estiver correto, peça ao instrutor para conferir sua matrícula e a primeira publicação de notas.</li><li>Uma conta confirmada não cria automaticamente uma matrícula.</li></ol><div class="form-footer"><button class="button primary" data-action="retry-boot">Verificar novamente</button><button class="button secondary" data-action="switch-account">Entrar com outra conta</button></div>${state.me.instructorCandidate ? `<p>É instrutor? Solicite seu acesso e aguarde o vínculo com a turma.</p><button class="button secondary" data-action="request" ${state.me.request ? "disabled" : ""}>${state.me.request ? "Solicitação enviada ao administrador" : "Solicitar acesso de instrutor"}</button>` : ""}</section>`;
  if (state.view === "reminders" && teacher()) return senderPage();
  if (state.view === "import" && teacher()) return importPage();
  if (state.view === "student-pending" && teacher()) return pendingPage();
  if (state.view === "reminders-batch" && teacher()) return batchPage();
  if (state.view === "activity-overview" && teacher()) return activityOverviewPage();
  if (state.reportError) return errorPanel(state.reportError, "refresh-report");
  if (!state.report)
    return '<section class="panel empty" role="status">Carregando sua turma…</section>';
  if (state.view === "history") return historyPage();
  if (teacher()) return teacherPage();
  if (!state.report.student)
    return '<section class="panel empty">Ainda não há notas publicadas para sua conta.</section>';
  return state.view === "activities" ? activitiesPage() : studentPage(name);
}

async function loadPending(studentId) {
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

async function loadBatchPreview() {
  const code = state.code;
  state.batchError = "";
  state.batchPreview = null;
  state.batchResults = null;
  render();
  try {
    const preview = await api.reminders.batchPreview(code, { studentIds: state.batchIds });
    if (state.code === code && state.view === "reminders-batch") {
      state.batchPreview = preview;
      render();
    }
  } catch (err) {
    if (state.code === code && state.view === "reminders-batch") {
      state.batchError = err.message;
      render();
    }
  }
}

async function loadSender() {
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

async function loadReport() {
  const code = state.code;
  const request = ++reportRequest;
  const viewing = state.studentView;
  state.report = null;
  state.reportError = "";
  render();
  try {
    if (code) {
      // Visualização como aluno: o servidor confere admin, turma e matrícula a cada abertura.
      const report = viewing
        ? await api.cohorts.studentView(code, { studentId: viewing.studentId })
        : await api.cohorts.report(code);
      if (state.code !== code || request !== reportRequest || !state.me || state.studentView !== viewing) return;
      if (viewing) viewing.name = report.viewAs?.name || "";
      state.report = report;
      state.focusDraft = null;
    }
  } catch (err) {
    if (state.code !== code || request !== reportRequest || state.studentView !== viewing) return;
    if (viewing && state.me) {
      await exitStudentView(`Não foi possível visualizar este aluno: ${err.message || "tente novamente."}`);
      return;
    }
    state.reportError = err.message || "Confira sua conexão e tente novamente.";
  }
  if (state.me && request === reportRequest) render();
}
async function loadMyFeedback(more = false) {
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
let adminFeedbackRequest = 0;
async function loadAdminFeedback(reset = true) {
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
// Seletor de imagens único, fora da área redesenhada pelo render(): enquanto a janela de arquivos
// está aberta, a tela pode ser redesenhada (ex.: a lista de feedbacks termina de carregar) e um
// <input type=file> dentro dela seria trocado, perdendo a seleção.
const imagePicker = Object.assign(document.createElement("input"), { type: "file", accept: ATTACHMENT_TYPES.join(","), hidden: true });
imagePicker.id = "fb-image-picker";
document.body.append(imagePicker);
let pickerTarget = null;  // "form" ou o id do feedback que recebe a imagem
imagePicker.addEventListener("change", () => {
  const files = [...imagePicker.files];
  imagePicker.value = "";
  if (files.length && pickerTarget) busy(null, () => addPickedImages(pickerTarget, files));
});
async function addPickedImages(target, files) {
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
    await loadMyFeedback();
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
async function loadAttachments(feedbackId) {
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

async function viewAsFromFeedback(id) {
  const item = state.adminFeedback.items.find((f) => f.id === id);
  if (!item?.canViewAsStudent) return;
  if (state.code !== item.cohort) {
    state.code = item.cohort;
    state.report = null;
  }
  await enterStudentView(item.canvasId, { view: "admin-feedback", feedbackId: item.id });
}

async function boot() {
  state.bootError = "";
  try {
    const wasSignedIn = !!state.me;
    state.me = await api.me.get();
    if (draftOwner !== state.me.email) {
      drafts.clear();
      draftOwner = state.me.email;
      Object.assign(state, { csv: "", filename: "", preview: null, dirty: false });
    }
    if (!wasSignedIn && !demo) {
      try {
        const context = JSON.parse(localStorage.getItem("avanca.context") || "null");
        if (context?.owner === state.me.email) {
          for (const key of ["code", "view", "filter", "search", "sort", "activityKind", "activityModule"])
            if (typeof context[key] === "string") state[key] = context[key];
        }
      } catch { /* Ignore a damaged navigation preference. */ }
    }
    state.cohorts = (await api.cohorts.list()).cohorts;
    if (!wasSignedIn && !demo) {
      const resume = admin() ? storedStudentView() : null;
      if (resume && state.cohorts.some((c) => c.code === resume.code)) {
        state.code = resume.code;
        state.view = studentViews.includes(resume.view) ? resume.view : "overview";
        state.studentView = { code: resume.code, studentId: resume.studentId, name: "", returnTo: validReturn(resume.returnTo) };
        resetStudentFilters();
      } else forgetStudentView();
    }
    if (!state.cohorts.some((c) => c.code === state.code)) {
      state.code = state.cohorts[0]?.code || "";
      state.view = "overview";
    }
    await loadReport();
    if (state.view === "reminders" && teacher()) await loadSender();
    if (state.view === "access" && admin()) await accessHandlers.loadAccess();
    if (state.view === "feedback" && !state.studentView) await loadMyFeedback();
    if (state.view === "admin-feedback" && admin() && !state.studentView) await loadAdminFeedback(true);
  } catch (err) {
    state.bootError = err.message || "Não foi possível consultar sua conta.";
    render();
  }
}
async function busy(element, fn) {
  if (element?.disabled) return;
  if (element) element.disabled = true;
  try {
    await fn();
  } catch (err) {
    notice(err.message || "Não foi possível concluir a operação.", true);
  } finally {
    if (element?.isConnected) element.disabled = false;
  }
}

// Ações dos botões com data-action. Cada uma recebe o botão clicado; erros lançados
// viram aviso para o usuário via busy().
const actions = {
  "retry-boot": () => boot(),
  "refresh-report": () => loadReport(),
  "retry-pending": () => loadPending(state.pendingStudentId),
  "retry-batch-preview": () => loadBatchPreview(),
  "reminders-batch": async (button) => {
    state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
    state.view = "reminders-batch";
    state.batchIds = (button.dataset.ids || "").split(",").filter(Boolean);
    await loadBatchPreview();
  },
  "send-reminders-batch": async () => {
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
  },
  "clear-filters": () => {
    Object.assign(state, { search: "", filter: "all", activityKind: "all", activityModule: "all", sort: "name" });
    render();
  },
  "export-csv": () => {
    const rows = filteredStudents();
    const url = URL.createObjectURL(new Blob([studentsCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), {
      href: url, download: `${state.code}-alunos-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(`CSV exportado com ${plural(rows.length, "aluno", "alunos")}.`);
  },
  "copy-reminder": async () => {
    const message = state.pendingPreview?.message;
    if (!message) return;
    try {
      await navigator.clipboard.writeText(`${message.subject}\n\n${message.text}`);
    } catch {
      throw new Error("Não foi possível copiar. Selecione o texto da prévia e copie manualmente.");
    }
    notice("Mensagem copiada.");
  },
  "refresh-sender": () => loadSender(),
  "verify-sender": async () => {
    const code = state.code;
    const sender = await api.reminders.verifySender(code);
    if (code === state.code) { state.sender = sender; render(); }
    notice("Confira a mensagem de verificação no seu e-mail institucional e depois verifique novamente.");
  },
  "send-reminder": async () => {
    const code = state.code, p = state.pendingPreview;
    if (!p?.message || !confirm(`Enviar este lembrete para ${p.message.to}, usando ${p.message.from}?`)) return;
    try {
      await api.reminders.send(code, {
        studentId: p.student.id, publicationId: p.publicationId, previewHash: p.previewHash });
      notice("Mensagem aceita pelo serviço de envio. Consulte o status da entrega.");
    } finally {
      if (state.code === code && state.pendingStudentId === p.student.id && state.view === "student-pending") await loadPending(p.student.id);
    }
  },
  login: () => login(config),
  "class-grades": () => loadClassReport(state.code),
  "class-refresh": () => loadClassReport(state.classReport.cohort),
  "class-exit": async () => {
    state.classReport = null;
    history.replaceState({}, "", location.pathname);
    state.view = "overview";
    if (state.me) await boot();
    else render();
  },
  logout: () => signOut(),
  "exit-student-view": () => exitStudentView(),
  "feedback-retry": () => loadMyFeedback(),
  "feedback-more": () => loadMyFeedback(true),
  "admin-feedback-retry": () => loadAdminFeedback(true),
  "admin-feedback-more": () => loadAdminFeedback(false),
  "feedback-retry-uploads": async () => {
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
    await loadMyFeedback();
  },
  "feedback-discard-uploads": () => {
    releaseFiles(state.feedbackFiles);
    state.feedbackFiles = [];
    state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
    render();
  },
  "switch-account": () => signOut(),
  "demo-role": async () => {
    demoRole = demoRole === "student" ? "instructor" : "student";
    api.setTransport((await import("./demo.js")).demoAPI(demoRole));
    state.view = "overview";
    state.filter = "all";
    state.search = "";
    await boot();
  },
  request: async () => {
    await api.access.requestInstructorAccess();
    await boot();
    notice("Solicitação enviada ao administrador.");
  },
  "refresh-requests": () => accessHandlers.loadAccess(),
  publish: async () => {
    const code = state.code, preview = state.preview;
    if (!preview || state.dirty) return;
    if (blockedByIntegrity(preview))
      throw new Error("Publicação bloqueada pelas validações de integridade. Confira os itens críticos da prévia.");
    if (preview.changes?.studentsRemoved.length && !state.acknowledgeRemoved)
      throw new Error("Confira e confirme os alunos removidos antes de publicar.");
    if (!confirm(`Publicar as notas para ${state.preview.count} alunos da ${state.code}?`)) return;
    await api.cohorts.publish(code, { draftId: preview.draft.id, acknowledgeRemoved: state.acknowledgeRemoved });
    drafts.delete(code);
    if (state.code !== code) { notice(`Atualização publicada na ${code}.`); return; }
    state.preview = null;
    state.csv = "";
    state.filename = "";
    state.view = "overview";
    await boot();
    notice("Atualização publicada. Os alunos já podem consultar.");
  },
};

// Chamado pela camada de rede quando não há sessão válida ou a API responde 401. A requisição
// ainda falha em seguida, e o erro chega a quem chamou (busy/boot) como antes.
function expireSession() {
  saveContext();
  clearSession();
  state.me = null;
  state.classReport = null;
  state.report = null;
  landing();
}

function signOut() {
  if ((state.csv || [...drafts.values()].some((d) => d.csv)) && !confirm("Sair descarta os arquivos e prévias ainda não publicados. Deseja continuar?")) return;
  drafts.clear();
  state.csv = "";
  forgetStudentView();
  localStorage.removeItem("avanca.context");
  if (demo) location.assign("./");
  else logout(config);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (state.studentView && !allowedWhileViewing(button)) return;
  const action = button.dataset.action;
  if (button.dataset.viewAsStudent)
    return busy(button, () => enterStudentView(button.dataset.viewAsStudent));
  if (button.dataset.fbOpen) {
    state.adminFeedback.selectedId = button.dataset.fbOpen;
    render();
    $("#fb-detail-title")?.focus();
    const opened = state.adminFeedback.items.find((f) => f.id === button.dataset.fbOpen);
    if (opened?.attachments) busy(null, () => loadAttachments(opened.id));
    return;
  }
  if (button.dataset.fbPick) {
    pickerTarget = button.dataset.fbPick;
    imagePicker.multiple = pickerTarget === "form";
    imagePicker.click();
    return;
  }
  if (button.dataset.fbRemoveFile) {
    const removed = state.feedbackFiles.filter((f) => f.id === button.dataset.fbRemoveFile);
    releaseFiles(removed);
    state.feedbackFiles = state.feedbackFiles.filter((f) => f.id !== button.dataset.fbRemoveFile);
    if (state.feedbackUpload.feedbackId && !state.feedbackFiles.some((f) => f.status !== "done")) {
      state.feedbackUpload = { feedbackId: null, progress: "", failed: false };
      state.feedbackSent = true;
    }
    render();
    return;
  }
  if (button.dataset.fbToggleAttachments) {
    const id = button.dataset.fbToggleAttachments;
    if (state.feedbackAttachments[id]?.open) {
      state.feedbackAttachments[id].open = false;
      render();
    } else busy(button, () => loadAttachments(id));
    return;
  }
  if (button.hasAttribute("data-fb-back")) {
    state.adminFeedback.selectedId = null;
    render();
    return;
  }
  if (button.dataset.fbStatus !== undefined && state.view === "admin-feedback") {
    state.adminFeedback.filters.status = button.dataset.fbStatus;
    return busy(button, () => loadAdminFeedback(true));
  }
  if (button.dataset.fbSave)
    return busy(button, async () => {
      const item = state.adminFeedback.items.find((f) => f.id === button.dataset.fbSave);
      const status = $("#fb-status-select").value;
      if (!item || status === item.status) return;
      const result = await api.adminFeedback.setStatus(item.id, { status, expectedStatus: item.status });
      Object.assign(item, result.feedback);
      render();
      notice("Status do feedback atualizado.");
    });
  if (button.dataset.fbViewAs) return busy(button, () => viewAsFromFeedback(button.dataset.fbViewAs));
  if (button.dataset.studentPending)
    return busy(button, () => loadPending(button.dataset.studentPending));
  if (button.dataset.addFocus) {
    const current = state.focusDraft || state.report.focus?.activityIds || [];
    if (current.length < 3 && !current.includes(button.dataset.addFocus)) {
      state.focusDraft = [...current, button.dataset.addFocus];
      render();
    }
    return;
  }
  if (button.dataset.removeFocus) {
    const current = state.focusDraft || state.report.focus?.activityIds || [];
    state.focusDraft = current.filter((id) => id !== button.dataset.removeFocus);
    render();
    return;
  }
  if (button.dataset.view) {
    const previousView = state.view;
    const returning = ["student-pending", "reminders-batch", "activity-overview"].includes(state.view) && button.dataset.view === "overview";
    if (state.view === "overview" && button.dataset.view === "activity-overview")
      state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
    state.view = button.dataset.view;
    state.search = "";
    state.activityKind = "all";
    state.activityModule = "all";
    state.filter = button.dataset.activityFilter || (button.dataset.pending ? "pending" : "all");
    if (returning && state.teacherFilters) Object.assign(state, state.teacherFilters);
    if (state.view === "feedback") {
      // Página de origem: só a última tela antes do Feedback (valores aceitos pelo backend).
      if (previousView !== "feedback") state.feedbackOrigin = state.code ? previousView : "onboarding";
      state.feedbackSent = false;
      busy(button, () => loadMyFeedback());
    } else if (state.view === "admin-feedback") {
      state.adminFeedback.selectedId = null;
      busy(button, () => loadAdminFeedback(true));
    } else if (state.view === "access") busy(button, accessHandlers.loadAccess);
    else if (state.view === "reminders") busy(button, loadSender);
    else if (state.code && !state.report && state.view !== "import")
      busy(button, loadReport);
    else render();
    return;
  }
  if (button.dataset.filter) {
    state.filter = button.dataset.filter;
    render();
    // Cartões do painel filtram a lista abaixo: leva a vista e o foco até ela (no celular a
    // lista fica fora da tela).
    const target = button.dataset.scrollTo && document.getElementById(button.dataset.scrollTo);
    if (target) {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    }
    return;
  }
  if (button.dataset.revoke)
    return busy(button, () => accessHandlers.revokeInstructor(button.dataset.revoke));
  if (button.dataset.reject)
    return busy(button, () => accessHandlers.rejectRequest(button.dataset.reject));
  if (button.dataset.unlink)
    return busy(button, () => accessHandlers.unlinkStudent(button.dataset.unlink));
  if (button.dataset.startEditName) {
    accessHandlers.startEditName(button.dataset.startEditName);
    return;
  }
  if (button.hasAttribute("data-cancel-edit-name")) {
    accessHandlers.cancelEditName();
    return;
  }
  if (button.dataset.restore)
    return busy(button, async () => {
      if (
        !confirm(
          "Restaurar esta publicação? Os alunos passarão a ver as notas desta versão.",
        )
      )
        return;
      await api.cohorts.restore(state.code, {
        publicationId: button.dataset.restore,
        expectedCurrent: state.report.publication.id,
      });
      await boot();
      notice("Publicação restaurada.");
    });
  if (action && actions[action]) busy(button, () => actions[action](button));
});
document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "cohort")
    busy(null, async () => {
      if (state.studentView) {
        forgetStudentView();
        state.view = "overview";
      }
      saveDraft();
      state.code = target.value;
      state.report = null;
      state.reportError = "";
      state.sender = null;
      state.senderLoading = false;
      state.senderError = "";
      restoreDraft();
      state.search = "";
      state.activityModule = "all";
      state.activityKind = "all";
      state.activityOverviewModule = "all";
      state.activityOverviewKind = "all";
      state.activityOverviewSort = "name";
      state.focusDraft = null;
      state.filter = "all";
      state.sort = "name";
      state.studentQuery = "";
      state.studentResults = null;
      state.studentSearchError = "";
      state.editingStudentId = null;
      if (state.view === "access" && admin()) await accessHandlers.loadAccess();
      else {
        state.view = "overview";
        await loadReport();
      }
    });
  if (target.id === "student-sort") { state.sort = target.value; render(); }
  if (["fb-filter-status", "fb-filter-type", "fb-filter-cohort"].includes(target.id)) {
    state.adminFeedback.filters[target.id.slice("fb-filter-".length)] = target.value;
    busy(null, () => loadAdminFeedback(true));
  }
  if (target.name === "fb-type") state.feedbackDraft.type = target.value;
  if (target.id === "acknowledge-removed") { state.acknowledgeRemoved = target.checked; render(); }
  if (target.id === "class-status-filter") {
    state.classFilter = target.value;
    render();
  }
  if (target.id === "requests-filter") {
    accessHandlers.setRequestsFilter(target.value);
  }
  if (target.id === "activity-overview-kind") { state.activityOverviewKind = target.value; render(); }
  if (target.id === "activity-overview-module") { state.activityOverviewModule = target.value; render(); }
  if (target.id === "activity-overview-sort") { state.activityOverviewSort = target.value; render(); }
  if (target.id === "activity-module") { state.activityModule = target.value; render(); }
  if (target.id === "activity-kind") {
    state.activityKind = target.value;
    render();
  }
  if (target.id === "status-filter") {
    state.filter = target.value;
    render();
  }
  if (target.dataset.activity) {
    state.preview.activities.find(
      (a) => a.id === target.dataset.activity,
    ).active = target.checked;
    state.dirty = true;
    state.acknowledgeRemoved = false;
    render();
  }
  if (target.id === "csv-file")
    busy(null, async () => {
      const code = state.code;
      const file = target.files[0];
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
    });
});
document.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "fb-title" || id === "fb-description") {
    // Guarda o texto sem renderizar de novo (não tira o foco); só atualiza o contador.
    const key = id === "fb-title" ? "title" : "description";
    state.feedbackDraft[key] = event.target.value;
    const count = $(`#${id}-count`);
    if (count) count.textContent = `${event.target.value.length}/${key === "title" ? TITLE_MAX : DESCRIPTION_MAX}`;
    return;
  }
  if (!["search", "class-search"].includes(id)) return;
  const value = event.target.value,
    position = event.target.selectionStart;
  if (id === "class-search") state.classSearch = value;
  else state.search = value;
  render();
  $(`#${id}`).focus();
  if (position != null)
    $(`#${id}`).setSelectionRange(position, position);
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.studentView) return;
  const form = event.target;
  busy(
    form.querySelector('button[type="submit"], button:not([type])'),
    async () => {
      if (form.id === "feedback-form") {
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
        await loadMyFeedback();
      } else if (form.id === "focus-form") {
        const code = state.code;
        const ids = state.focusDraft || state.report.focus?.activityIds || [];
        const result = await api.cohorts.saveFocus(code, {
          activityIds: ids, expectedCurrent: state.report.publication.id, expectedVersion: state.report.focus?.version || null,
        });
        if (state.code === code && state.report) { state.report.focus = result.focus; state.focusDraft = null; render(); }
        notice(`Foco da ${code} atualizado.`);
      } else if (form.id === "import-form") {
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
      } else if (form.id === "cohort-form") {
        await api.cohorts.create(Object.fromEntries(new FormData(form)));
        await boot();
        notice("Turma criada.");
      } else if (form.id === "cohort-settings-form") {
        const data = new FormData(form);
        const kc = Number(data.get("kc")), lab = Number(data.get("lab"));
        const canvasCourseId = data.get("canvasCourseId").trim() || null;
        await api.cohorts.saveSettings(state.code, { thresholds: { kc, lab }, canvasCourseId, autoSync: data.get("autoSync") === "on" });
        await boot();
        notice("Configurações da turma atualizadas.");
      } else if (form.id === "student-search-form") {
        await accessHandlers.submitStudentSearch(form);
      } else if (form.dataset.editNameForm) {
        await accessHandlers.saveDisplayName(form);
      } else if (form.classList.contains("approve-form")) {
        await accessHandlers.approveInstructor(form);
      }
    },
  );
});

async function start() {
  try {
    config = await fetch("./config.json", { cache: "no-store" }).then((r) =>
      r.ok ? r.json() : {},
    );
    if (demo) {
      api.setTransport((await import("./demo.js")).demoAPI(demoRole));
      await boot();
      return;
    }
    const requestedCohort = new URLSearchParams(location.search).get("turma");
    if (requestedCohort && /^[A-Z0-9-]{3,32}$/.test(requestedCohort))
      localStorage.setItem("avanca.pending-cohort", requestedCohort);
    await callback(config);
    api.configure({ config, onSessionExpired: expireSession });
    if (session() && config.apiUrl) {
      await boot();
      const code = localStorage.getItem("avanca.pending-cohort");
      localStorage.removeItem("avanca.pending-cohort");
      if (code && teacher()) await loadClassReport(code);
    } else {
      clearSession();
      landing();
    }
  } catch (err) {
    state.classReport = null;
    if (state.me) render();
    else landing();
    notice(err.message || "Não foi possível carregar o portal.", true);
  }
}
start();

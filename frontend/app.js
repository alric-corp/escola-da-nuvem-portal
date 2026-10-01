import { callback, clearSession, login, logout, session } from "./auth.js";
import * as api from "./api.js";
import * as accessHandlers from "./handlers/access.js";
import * as importHandlers from "./handlers/import.js";
import * as adminFeedbackHandlers from "./handlers/admin-feedback.js";
import * as feedbackHandlers from "./handlers/feedback.js";
import * as remindersHandlers from "./handlers/reminders.js";
import { $, admin, demo, e, errorPanel, heading, icon, nav, notice, pageLabel, plural, roleLabel, sessionContext, studentViewBanner, teacher } from "./ui.js";
import { state } from "./state.js";
import { landing } from "./pages/landing.js";
import { renderClassReport } from "./pages/class-report.js";
import { activitiesPage, studentPage } from "./pages/student.js";
import { filteredStudents, studentsCsv, teacherPage } from "./pages/teacher.js";
import { activityOverviewPage } from "./pages/activities-overview.js";
import { batchPage, pendingPage, senderPage } from "./pages/reminders.js";
import { historyPage } from "./pages/history.js";
import { importPage } from "./pages/import.js";
import { accessPage } from "./pages/access.js";
import { DESCRIPTION_MAX, TITLE_MAX, feedbackPage } from "./pages/feedback.js";
import { adminFeedbackPage } from "./pages/admin-feedback.js";

accessHandlers.configure({ render });
importHandlers.configure({ render });
adminFeedbackHandlers.configure({ render });
feedbackHandlers.configure({ render });
remindersHandlers.configure({ render });

let demoRole = "student",
  config = {};
let reportRequest = 0;
let renderedView = "";
let lastFocusSelector = "";
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
    await adminFeedbackHandlers.load(true);
  } else await accessHandlers.loadAccess();
}
// Na visualização como aluno só navegação e leitura: nenhuma ação é executada em nome do aluno.
function allowedWhileViewing(button) {
  return studentViews.includes(button.dataset.view) || !!button.dataset.filter ||
    ["exit-student-view", "refresh-report", "clear-filters", "retry-boot", "logout"].includes(button.dataset.action);
}
window.addEventListener("beforeunload", (event) => {
  if (importHandlers.hasUnpublishedCsv()) {
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
// Seletor de imagens único, fora da área redesenhada pelo render(): enquanto a janela de arquivos
// está aberta, a tela pode ser redesenhada (ex.: a lista de feedbacks termina de carregar) e um
// <input type=file> dentro dela seria trocado, perdendo a seleção.
const imagePicker = Object.assign(document.createElement("input"), { type: "file", accept: feedbackHandlers.ATTACHMENT_TYPES.join(","), hidden: true });
imagePicker.id = "fb-image-picker";
document.body.append(imagePicker);
let pickerTarget = null;  // "form" ou o id do feedback que recebe a imagem
imagePicker.addEventListener("change", () => {
  const files = [...imagePicker.files];
  imagePicker.value = "";
  if (files.length && pickerTarget) busy(null, () => feedbackHandlers.addPickedImages(pickerTarget, files));
});

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
    importHandlers.resetDraftsForUser(state.me.email);
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
    if (state.view === "reminders" && teacher()) await remindersHandlers.loadSender();
    if (state.view === "access" && admin()) await accessHandlers.loadAccess();
    if (state.view === "feedback" && !state.studentView) await feedbackHandlers.loadMine();
    if (state.view === "admin-feedback" && admin() && !state.studentView) await adminFeedbackHandlers.load(true);
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
  "retry-pending": () => remindersHandlers.loadPending(state.pendingStudentId),
  "retry-batch-preview": () => remindersHandlers.loadBatchPreview(),
  "reminders-batch": (button) => remindersHandlers.openBatch(button.dataset.ids),
  "send-reminders-batch": () => remindersHandlers.sendBatch(),
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
  "copy-reminder": () => remindersHandlers.copyReminder(),
  "refresh-sender": () => remindersHandlers.loadSender(),
  "verify-sender": () => remindersHandlers.verifySender(),
  "send-reminder": () => remindersHandlers.sendReminder(),
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
  "feedback-retry": () => feedbackHandlers.loadMine(),
  "feedback-more": () => feedbackHandlers.loadMine(true),
  "admin-feedback-retry": () => adminFeedbackHandlers.load(true),
  "admin-feedback-more": () => adminFeedbackHandlers.load(false),
  "feedback-retry-uploads": () => feedbackHandlers.retryUploads(),
  "feedback-discard-uploads": () => feedbackHandlers.discardUploads(),
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
    if (!(await importHandlers.publish())) return;
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
  if (importHandlers.hasUnpublishedCsv() && !confirm("Sair descarta os arquivos e prévias ainda não publicados. Deseja continuar?")) return;
  importHandlers.discardDrafts();
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
    const opened = adminFeedbackHandlers.select(button.dataset.fbOpen);
    $("#fb-detail-title")?.focus();
    if (opened?.attachments) busy(null, () => feedbackHandlers.loadAttachments(opened.id));
    return;
  }
  if (button.dataset.fbPick) {
    pickerTarget = button.dataset.fbPick;
    imagePicker.multiple = pickerTarget === "form";
    imagePicker.click();
    return;
  }
  if (button.dataset.fbRemoveFile) {
    feedbackHandlers.removeFile(button.dataset.fbRemoveFile);
    return;
  }
  if (button.dataset.fbToggleAttachments) {
    const id = button.dataset.fbToggleAttachments;
    if (state.feedbackAttachments[id]?.open) feedbackHandlers.closeAttachments(id);
    else busy(button, () => feedbackHandlers.loadAttachments(id));
    return;
  }
  if (button.hasAttribute("data-fb-back")) {
    adminFeedbackHandlers.back();
    return;
  }
  if (button.dataset.fbStatus !== undefined && state.view === "admin-feedback") {
    return busy(button, () => adminFeedbackHandlers.setFilter("status", button.dataset.fbStatus));
  }
  if (button.dataset.fbSave)
    return busy(button, () => {
      const status = $("#fb-status-select").value;
      return adminFeedbackHandlers.saveStatus(button.dataset.fbSave, status);
    });
  if (button.dataset.fbViewAs) return busy(button, () => viewAsFromFeedback(button.dataset.fbViewAs));
  if (button.dataset.studentPending)
    return busy(button, () => remindersHandlers.loadPending(button.dataset.studentPending));
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
      busy(button, () => feedbackHandlers.loadMine());
    } else if (state.view === "admin-feedback") {
      state.adminFeedback.selectedId = null;
      busy(button, () => adminFeedbackHandlers.load(true));
    } else if (state.view === "access") busy(button, accessHandlers.loadAccess);
    else if (state.view === "reminders") busy(button, remindersHandlers.loadSender);
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
      importHandlers.saveDraft();
      state.code = target.value;
      state.report = null;
      state.reportError = "";
      state.sender = null;
      state.senderLoading = false;
      state.senderError = "";
      importHandlers.restoreDraft();
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
    busy(null, () => adminFeedbackHandlers.setFilter(target.id.slice("fb-filter-".length), target.value));
  }
  if (target.name === "fb-type") state.feedbackDraft.type = target.value;
  if (target.id === "acknowledge-removed") importHandlers.setAcknowledgeRemoved(target.checked);
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
  if (target.dataset.activity) importHandlers.toggleActivity(target.dataset.activity, target.checked);
  if (target.id === "csv-file") busy(null, () => importHandlers.selectCsv(target.files[0]));
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
        await feedbackHandlers.submit();
      } else if (form.id === "focus-form") {
        const code = state.code;
        const ids = state.focusDraft || state.report.focus?.activityIds || [];
        const result = await api.cohorts.saveFocus(code, {
          activityIds: ids, expectedCurrent: state.report.publication.id, expectedVersion: state.report.focus?.version || null,
        });
        if (state.code === code && state.report) { state.report.focus = result.focus; state.focusDraft = null; render(); }
        notice(`Foco da ${code} atualizado.`);
      } else if (form.id === "import-form") {
        await importHandlers.previewImport();
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

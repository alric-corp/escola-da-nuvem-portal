import { callback, clearSession, login, logout, session, validSession } from "./auth.js";
import { $, admin, demo, e, errorPanel, heading, icon, nav, pageLabel, roleLabel, sessionContext, state, teacher } from "./ui.js";
import { landing } from "./pages/landing.js";
import { renderClassReport } from "./pages/class-report.js";
import { activitiesPage, studentPage } from "./pages/student.js";
import { teacherPage } from "./pages/teacher.js";
import { activityOverviewPage } from "./pages/activities-overview.js";
import { batchPage, pendingPage, senderPage } from "./pages/reminders.js";
import { historyPage } from "./pages/history.js";
import { importPage } from "./pages/import.js";
import { accessPage } from "./pages/access.js";

let demoRole = "student",
  config = {},
  api;
let accessRequest = 0;
let reportRequest = 0;
let renderedView = "";
let lastFocusSelector = "";
const drafts = new Map();
let draftOwner = "";

function saveContext() {
  if (!state.me || demo) return;
  localStorage.setItem("avanca.context", JSON.stringify({ owner: state.me.email, code: state.code,
    view: ["student-pending", "reminders-batch"].includes(state.view) ? "overview" : state.view,
    filter: state.filter, search: state.search, sort: state.sort, activityKind: state.activityKind, activityModule: state.activityModule }));
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

function notice(message, error = false) {
  const item = document.createElement("div");
  item.className = `notice ${error ? "error" : ""}`;
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.className = "icon-button";
  close.type = "button";
  close.setAttribute("aria-label", "Fechar aviso");
  close.textContent = "×";
  close.addEventListener("click", () => item.remove());
  item.append(text, close);
  $("#notices").replaceChildren(item);
  setTimeout(() => item.remove(), 6500);
}

async function loadClassReport(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(code))
    throw new Error("Informe um código de turma válido.");
  const data = await api(`/cohorts/${encodeURIComponent(code)}/class-report`);
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
  $("#app").innerHTML =
    `${demo ? `<div class="demo-bar">Demonstração · dados fictícios <button data-action="demo-role">Ver como ${demoRole === "student" ? "instrutor" : "aluno"} ${icon("arrow", 14)}</button><a href="./">Sair da demonstração</a></div>` : ""}
  <a class="skip-link" href="#main-content">Pular para o conteúdo</a><div class="layout"><aside class="sidebar"><a href="./" class="brand"><img class="brand-logo" src="./logo.png" alt="Escola da Nuvem" width="112" height="112" /></a><div class="workspace-label">PORTAL AWS RE/START</div>
  <label class="cohort-label" for="cohort">${teacher() || admin() ? "Turma selecionada" : "Minha turma"}</label><select id="cohort">${state.cohorts.length ? state.cohorts.map((c) => `<option value="${e(c.code)}" ${c.code === state.code ? "selected" : ""}>${e(c.code)}</option>`).join("") : "<option>Nenhuma turma vinculada</option>"}</select>
  <nav aria-label="Menu principal">${nav("overview", teacher() ? "Painel do instrutor" : "Meu desempenho", "grid")}${!teacher() ? nav("activities", "Minhas atividades", "book") : ""}${nav("history", teacher() ? "Publicações da turma" : "Meu histórico", "clock")}${teacher() ? nav("import", "Atualizar notas", "upload") + nav("reminders", "Lembretes", "out") : ""}${admin() ? nav("access", "Turmas e acessos", "users") : ""}</nav>
  <div class="sidebar-bottom"><div class="support-card">${icon("network", 28)}<strong>Aprender abre caminhos.</strong><p>Cada atividade é mais um passo na sua jornada.</p></div><div class="account"><span class="avatar">${e(name.slice(0, 2).toUpperCase())}</span><div><strong>${e(name)}</strong><small>${roleLabel()}</small></div><button class="icon-button" data-action="logout" aria-label="Sair da conta">${icon("out")}</button></div></div></aside>
  <main class="main" id="main-content" tabindex="-1"><header class="topline"><div class="location-context"><span>${state.view === "access" ? "Administração do portal" : state.code ? `Turma ${e(state.code)}` : "Minha conta"}${demo ? " · Demonstração" : ""}</span><strong>${e(pageLabel())}</strong></div>${sessionContext()}</header>
  ${content(name)}<footer class="main-footer"><span>Escola da Nuvem · AWS re/Start</span><span>Seu aprendizado, uma semana de cada vez.</span></footer></main></div>`;
  if (changedView) {
    const title = $("main h1") || $("main");
    title?.setAttribute("tabindex", "-1");
    title?.focus({ preventScroll: true });
  } else if (focusId && document.getElementById(focusId)) {
    const next = document.getElementById(focusId);
    next.focus({ preventScroll: true });
    if (selection != null && ["search", "text"].includes(next.type)) next.setSelectionRange(selection, selection);
  } else if (lastFocusSelector) $(lastFocusSelector)?.focus({ preventScroll: true });
  saveContext();
}

function content(name) {
  if (state.bootError) return errorPanel(state.bootError, "retry-boot");
  if (state.view === "access" && admin()) return accessPage();
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
    const preview = await api(`/cohorts/${code}/pending-preview`, {
      method: "POST",
      body: { studentId },
    });
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
    const preview = await api(`/cohorts/${code}/pending-preview-batch`, {
      method: "POST",
      body: { studentIds: state.batchIds },
    });
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
    const sender = await api(`/cohorts/${code}/reminder-settings`);
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
  state.report = null;
  state.reportError = "";
  render();
  try {
    if (code) {
      const report = await api(`/cohorts/${encodeURIComponent(code)}/report`);
      if (state.code !== code || request !== reportRequest || !state.me) return;
      state.report = report;
      state.focusDraft = null;
    }
  } catch (err) {
    if (state.code !== code || request !== reportRequest) return;
    state.reportError = err.message || "Confira sua conexão e tente novamente.";
  }
  if (state.me && request === reportRequest) render();
}
async function loadAccess() {
  const request = ++accessRequest;
  const code = state.code;
  state.accessLoading = true;
  state.accessError = "";
  state.requests = [];
  state.instructors = [];
  render();
  try {
    const [requests, instructors] = await Promise.all([
      api("/requests"),
      code
        ? api(`/cohorts/${code}/instructors`)
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
async function searchStudents(query) {
  const code = state.code;
  state.studentQuery = query;
  state.studentSearchError = "";
  state.studentSearchLoading = true;
  render();
  try {
    const result = await api(`/cohorts/${code}/students-search`, {
      method: "POST",
      body: { query },
    });
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

async function boot() {
  state.bootError = "";
  try {
    const wasSignedIn = !!state.me;
    state.me = await api("/me");
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
    state.cohorts = (await api("/cohorts")).cohorts;
    if (!state.cohorts.some((c) => c.code === state.code)) {
      state.code = state.cohorts[0]?.code || "";
      state.view = "overview";
    }
    await loadReport();
    if (state.view === "reminders" && teacher()) await loadSender();
    if (state.view === "access" && admin()) await loadAccess();
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

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
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
    const returning = ["student-pending", "reminders-batch", "activity-overview"].includes(state.view) && button.dataset.view === "overview";
    if (state.view === "overview" && button.dataset.view === "activity-overview")
      state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
    state.view = button.dataset.view;
    state.search = "";
    state.activityKind = "all";
    state.activityModule = "all";
    state.filter = button.dataset.activityFilter || (button.dataset.pending ? "pending" : "all");
    if (returning && state.teacherFilters) Object.assign(state, state.teacherFilters);
    if (state.view === "access") busy(button, loadAccess);
    else if (state.view === "reminders") busy(button, loadSender);
    else if (state.code && !state.report && state.view !== "import")
      busy(button, loadReport);
    else render();
    return;
  }
  if (button.dataset.filter) {
    state.filter = button.dataset.filter;
    render();
    return;
  }
  if (button.dataset.revoke)
    return busy(button, async () => {
      if (!confirm("Remover o acesso deste instrutor à turma selecionada?"))
        return;
      await api(`/cohorts/${state.code}/revoke-instructor`, {
        method: "POST",
        body: { userId: button.dataset.revoke },
      });
      await loadAccess();
      notice("Acesso removido.");
    });
  if (button.dataset.reject)
    return busy(button, async () => {
      if (!confirm("Recusar esta solicitação de acesso?")) return;
      await api(`/requests/${button.dataset.reject}/reject`, { method: "POST", body: {} });
      await loadAccess();
      notice("Solicitação recusada.");
    });
  if (button.dataset.unlink)
    return busy(button, async () => {
      if (!confirm("Desvincular este aluno? Ele poderá se vincular de novo pelo e-mail no próximo acesso.")) return;
      await api(`/cohorts/${state.code}/unlink-student`, { method: "POST", body: { canvasId: button.dataset.unlink } });
      await searchStudents(state.studentQuery);
      notice("Aluno desvinculado.");
    });
  if (button.dataset.startEditName) {
    state.editingStudentId = button.dataset.startEditName;
    render();
    return;
  }
  if (button.hasAttribute("data-cancel-edit-name")) {
    state.editingStudentId = null;
    render();
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
      await api(`/cohorts/${state.code}/restore`, {
        method: "POST",
        body: {
          publicationId: button.dataset.restore,
          expectedCurrent: state.report.publication.id,
        },
      });
      await boot();
      notice("Publicação restaurada.");
    });
  if (action)
    busy(button, async () => {
      if (action === "retry-boot") await boot();
      if (action === "refresh-report") await loadReport();
      if (action === "retry-pending") await loadPending(state.pendingStudentId);
      if (action === "retry-batch-preview") await loadBatchPreview();
      if (action === "reminders-batch") {
        state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort };
        state.view = "reminders-batch";
        state.batchIds = (button.dataset.ids || "").split(",").filter(Boolean);
        await loadBatchPreview();
      }
      if (action === "send-reminders-batch") {
        const code = state.code, p = state.batchPreview;
        const eligible = p.recipients.filter((r) => !r.skip);
        if (!eligible.length || !confirm(`Enviar lembrete para ${eligible.length} aluno(s)?`)) return;
        const result = await api(`/cohorts/${code}/send-reminders`, { method: "POST", body: {
          studentIds: state.batchIds, expectedPublicationId: p.publicationId } });
        if (state.code === code && state.view === "reminders-batch") {
          state.batchResults = result.results;
          render();
        }
        notice("Envio em lote concluído. Confira o resultado por aluno.");
      }
      if (action === "clear-filters") {
        Object.assign(state, { search: "", filter: "all", activityKind: "all", activityModule: "all", sort: "name" });
        render();
      }
      if (action === "refresh-sender") await loadSender();
      if (action === "verify-sender") {
        const code = state.code;
        const sender = await api(`/cohorts/${code}/verify-sender`, { method: "POST", body: {} });
        if (code === state.code) { state.sender = sender; render(); }
        notice("Confira a mensagem de verificação no seu e-mail institucional e depois verifique novamente.");
      }
      if (action === "send-reminder") {
        const code = state.code, p = state.pendingPreview;
        if (!p?.message || !confirm(`Enviar este lembrete para ${p.message.to}, usando ${p.message.from}?`)) return;
        try {
          await api(`/cohorts/${code}/send-reminder`, { method: "POST", body: {
            studentId: p.student.id, publicationId: p.publicationId, previewHash: p.previewHash } });
          notice("Mensagem aceita pelo serviço de envio. Consulte o status da entrega.");
        } finally {
          if (state.code === code && state.pendingStudentId === p.student.id && state.view === "student-pending") await loadPending(p.student.id);
        }
      }
      if (action === "login") await login(config);
      if (action === "class-grades") await loadClassReport(state.code);
      if (action === "class-refresh") await loadClassReport(state.classReport.cohort);
      if (action === "class-exit") {
        state.classReport = null;
        history.replaceState({}, "", location.pathname);
        state.view = "overview";
        if (state.me) await boot();
        else render();
      }
      if (action === "logout" || action === "switch-account") {
        if ((state.csv || [...drafts.values()].some((d) => d.csv)) && !confirm("Sair descarta os arquivos e prévias ainda não publicados. Deseja continuar?")) return;
        drafts.clear();
        state.csv = "";
        localStorage.removeItem("avanca.context");
        if (demo) location.assign("./");
        else logout(config);
      }
      if (action === "demo-role") {
        demoRole = demoRole === "student" ? "instructor" : "student";
        api = (await import("./demo.js")).demoAPI(demoRole);
        state.view = "overview";
        state.filter = "all";
        state.search = "";
        await boot();
      }
      if (action === "request") {
        await api("/access-request", { method: "POST", body: {} });
        await boot();
        notice("Solicitação enviada ao administrador.");
      }
      if (action === "refresh-requests") await loadAccess();
      if (action === "publish") {
        const code = state.code, preview = state.preview;
        if (!preview || state.dirty) return;
        if (preview.changes?.studentsRemoved.length && !state.acknowledgeRemoved)
          throw new Error("Confira e confirme os alunos removidos antes de publicar.");
        if (
          !confirm(
            `Publicar as notas para ${state.preview.count} alunos da ${state.code}?`,
          )
        )
          return;
        await api(`/cohorts/${code}/publish`, {
          method: "POST",
          body: { draftId: preview.draft.id, acknowledgeRemoved: state.acknowledgeRemoved },
        });
        drafts.delete(code);
        if (state.code !== code) { notice(`Atualização publicada na ${code}.`); return; }
        state.preview = null;
        state.csv = "";
        state.filename = "";
        state.view = "overview";
        await boot();
        notice("Atualização publicada. Os alunos já podem consultar.");
      }
    });
});
document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "cohort")
    busy(null, async () => {
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
      if (state.view === "access" && admin()) await loadAccess();
      else {
        state.view = "overview";
        await loadReport();
      }
    });
  if (target.id === "student-sort") { state.sort = target.value; render(); }
  if (target.id === "acknowledge-removed") { state.acknowledgeRemoved = target.checked; render(); }
  if (target.id === "class-status-filter") {
    state.classFilter = target.value;
    render();
  }
  if (target.id === "requests-filter") {
    state.requestsFilter = target.value;
    render();
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
  const form = event.target;
  busy(
    form.querySelector('button[type="submit"], button:not([type])'),
    async () => {
      if (form.id === "focus-form") {
        const code = state.code;
        const ids = state.focusDraft || state.report.focus?.activityIds || [];
        const result = await api(`/cohorts/${code}/focus-activities`, { method: "POST", body: {
          activityIds: ids, expectedCurrent: state.report.publication.id, expectedVersion: state.report.focus?.version || null,
        } });
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
          preview = await api(`/cohorts/${code}/preview`, { method: "POST", body });
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
        await api("/cohorts", {
          method: "POST",
          body: Object.fromEntries(new FormData(form)),
        });
        await boot();
        notice("Turma criada.");
      } else if (form.id === "cohort-settings-form") {
        const data = new FormData(form);
        const kc = Number(data.get("kc")), lab = Number(data.get("lab"));
        const canvasCourseId = data.get("canvasCourseId").trim() || null;
        await api(`/cohorts/${state.code}/settings`, {
          method: "POST",
          body: { thresholds: { kc, lab }, canvasCourseId },
        });
        await boot();
        notice("Configurações da turma atualizadas.");
      } else if (form.id === "student-search-form") {
        const query = new FormData(form).get("query").trim();
        if (!query) throw new Error("Digite ao menos um caractere para buscar.");
        await searchStudents(query);
      } else if (form.dataset.editNameForm) {
        const displayName = new FormData(form).get("displayName").trim();
        if (!displayName) throw new Error("Informe um nome.");
        await api(`/cohorts/${state.code}/display-name`, {
          method: "POST",
          body: { canvasId: form.dataset.editNameForm, displayName },
        });
        await searchStudents(state.studentQuery);
        notice("Nome atualizado.");
      } else if (form.classList.contains("approve-form")) {
        const code = new FormData(form).get("cohort");
        await api(`/cohorts/${code}/instructors`, {
          method: "POST",
          body: { userId: form.dataset.user },
        });
        await loadAccess();
        notice("Instrutor vinculado à turma.");
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
      api = (await import("./demo.js")).demoAPI(demoRole);
      await boot();
      return;
    }
    const requestedCohort = new URLSearchParams(location.search).get("turma");
    if (requestedCohort && /^[A-Z0-9-]{3,32}$/.test(requestedCohort))
      localStorage.setItem("avanca.pending-cohort", requestedCohort);
    await callback(config);
    api = async (path, options = {}) => {
      const auth = await validSession(config);
      if (!auth || auth.expires <= Date.now()) {
        saveContext();
        clearSession();
        state.me = null;
        state.classReport = null;
        state.report = null;
        landing();
        throw new Error("Sua sessão expirou. Entre novamente.");
      }
      const method = options.method || "GET";
      // Só GET é repetido: reenviar um POST automaticamente arrisca duplicar uma ação
      // (publicar notas, enviar lembrete). Espera crescente com variação para não sincronizar
      // clientes que foram limitados juntos (ex.: uma turma inteira abrindo o portal).
      const attempts = method === "GET" ? 4 : 1;
      let res;
      for (let attempt = 0; attempt < attempts; attempt++) {
        res = await fetch(config.apiUrl + path, {
          method,
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(35000),
        });
        if (res.status !== 429 || attempt === attempts - 1) break;
        await new Promise((resolve) =>
          setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 200),
        );
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          saveContext();
          clearSession();
          state.me = null;
          state.classReport = null;
          state.report = null;
          landing();
        }
        if (res.status === 429)
          throw new Error(
            "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.",
          );
        throw new Error(
          data.error || "Não foi possível completar a solicitação.",
        );
      }
      return data;
    };
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

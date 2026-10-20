import { callback, clearSession, login, logout, session } from "./auth.js";
import * as api from "./api.js";
import * as accessHandlers from "./handlers/access.js";
import * as importHandlers from "./handlers/import.js";
import * as adminFeedbackHandlers from "./handlers/admin-feedback.js";
import * as feedbackHandlers from "./handlers/feedback.js";
import * as remindersHandlers from "./handlers/reminders.js";
import * as signupConfirmationHandlers from "./handlers/signup-confirmation.js";
import { $, admin, demo, e, errorPanel, heading, icon, nav, notice, pageLabel, plural, roleLabel, sessionContext, studentViewBanner, teacher } from "./ui.js";
import { state } from "./state.js";
import { isWithdrawn } from "./participation.js";
import { landing } from "./pages/landing.js";
import { signupConfirmationEntry, signupConfirmationPage } from "./pages/signup-confirmation.js";
import { renderClassReport } from "./pages/class-report.js";
import { activitiesPage, studentActivitiesState, studentHomeState, studentLoading, studentPage } from "./pages/student.js";
import { filteredStudents, studentsCsv, teacherHomeState, teacherPage } from "./pages/teacher.js";
import { activityOverviewPage } from "./pages/activities-overview.js";
import { batchPage, pendingPage, senderPage } from "./pages/reminders.js";
import { historyPage, restoreQuestion, studentHistoryState, teacherPublicationsState } from "./pages/history.js";
import { importPage } from "./pages/import.js";
import { accessPage } from "./pages/access.js";
import { DESCRIPTION_MAX, TITLE_MAX, feedbackPage, feedbackProblems } from "./pages/feedback.js";
import { adminFeedbackPage } from "./pages/admin-feedback.js";

accessHandlers.configure({ render });
importHandlers.configure({ render });
adminFeedbackHandlers.configure({ render });
feedbackHandlers.configure({ render, syncContext: syncReadContext });
remindersHandlers.configure({ render, syncContext: syncReadContext });
signupConfirmationHandlers.configure({ render });

let demoRole = "student",
  config = {};
let reportRequest = 0;
let readContext = [];

// Ownership das três leituras C7.4. Invalidar antes de desenhar evita exibir dados do
// contexto anterior e impede A → B → A de ressuscitar respostas ainda em trânsito.
function syncReadContext() {
  const next = [state.me, state.code, state.view, state.studentView, state.pendingStudentId];
  if (next.every((value, index) => value === readContext[index])) return;
  readContext = next;
  remindersHandlers.invalidateReads();
  feedbackHandlers.invalidateReads();
}
let renderedView = "";
let lastFocusSelector = "";
// Confirmação de cadastro: a etapa desenhada por último (o foco vai ao título só quando ela muda) e o timer que
// redesenha quando o intervalo de reenvio acaba.
let shownSignupStep = "";
let resendTimer = 0;
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
    filter: state.filter, search: state.search, sort: state.sort, canvasActivityFilter: state.canvasActivityFilter, activityKind: state.activityKind, activityModule: state.activityModule }));
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

// Casca (docs/design-visual.md, seção 29 do CSS), medida no layout real depois de cada render e quando muda de
// tamanho (janela, zoom, texto ampliado, rótulo que quebra linha). Só lê medidas e escreve na raiz (variável e
// atributos); não toca em estado, foco nem conteúdo, e não muda a ordem do DOM.
// - Celular: a barra inferior fica fixa até ~22% da altura da janela (25% até a 3.2); acima disso (texto ampliado, seis
//   destinos) vai para o fluxo, entre a turma e a conta, como no DOM. Entre 20% e 22% mantém o modo atual, para não
//   alternar no limite; a medida usa só as linhas da barra (sem os recuos), igual nos dois modos.
// - Celular: se logo, turma e Sair não cabem numa linha, o Sair vai à direita na linha seguinte (3.4) e, se nem a turma
//   cabe ao lado do logo, ela ganha linha própria.
// - Desktop: a barra lateral só fica fixa quando cabe inteira na janela.
// - O espaço no fim da página e o recuo de rolagem acompanham a altura real da barra fixa (zero quando no fluxo).
const shellObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => syncShell()) : null;
function syncShell() {
  const sidebar = $(".sidebar"), nav = sidebar?.querySelector("nav"), bottom = sidebar?.querySelector(".sidebar-bottom");
  if (!nav || !bottom) return;
  const root = document.documentElement, mobile = matchMedia("(max-width: 760px)").matches;
  // Quem já passou do cabeçalho não deve ver o conteúdo saltar quando o menu entra ou sai do fluxo acima dele.
  const main = $("#main-content"), readingTop = main?.getBoundingClientRect().top ?? 0;
  const navStyle = getComputedStyle(nav), rows = nav.getBoundingClientRect().height - parseFloat(navStyle.paddingTop) - parseFloat(navStyle.paddingBottom);
  const share = rows / innerHeight, flow = mobile && (share > 0.22 || (root.dataset.bottomNav === "fluxo" && share >= 0.2));
  root.dataset.bottomNav = flow ? "fluxo" : "fixa";
  const fixedBar = getComputedStyle(nav).position === "fixed";
  root.style.setProperty("--bottom-nav-height", `${fixedBar ? Math.ceil(nav.getBoundingClientRect().height) : 0}px`);
  if (mobile) {
    // Mede na disposição natural (uma linha, se couber) e só então decide.
    root.dataset.header = "linha";
    const center = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const logo = center(sidebar.querySelector(".brand")), select = center(sidebar.querySelector("#cohort")), out = center(bottom);
    const turma = Math.abs(select - logo) < 8, sair = Math.abs(out - logo) < 8;
    root.dataset.header = turma && (flow || sair) ? "linha" : turma ? "sair-abaixo" : "quebrado";
  }
  // Altura natural: do topo da barra lateral ao fim do menu, mais o bloco da conta; independe de estar fixa ou não.
  const top = sidebar.getBoundingClientRect().top, natural = nav.getBoundingClientRect().bottom - top + bottom.getBoundingClientRect().height + parseFloat(getComputedStyle(sidebar).paddingBottom);
  root.dataset.sidebar = !mobile && natural <= innerHeight - 1 ? "fixa" : "rola";
  // Se o navegador já compensou (ancoragem de rolagem), a diferença é zero.
  const shift = main ? main.getBoundingClientRect().top - readingTop : 0;
  if (readingTop < 0 && Math.abs(shift) >= 1) scrollBy(0, shift);
}
window.addEventListener("resize", syncShell);

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
  syncReadContext();
  if (!state.me) return publicPage();
  if (state.classReport) return renderClassReport();
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.selectionStart;
  const changedView = renderedView !== state.view;
  // O título focado ao entrar na view é recriado pelo render (ex.: quando a carga termina): o foco passa ao novo título.
  const titleFocused = !changedView && !!focused?.matches("main h1");
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
  <main class="main" id="main-content" tabindex="-1"><header class="topline"><div class="location-context"><span>${state.view === "access" || state.view === "admin-feedback" ? "Administração do portal" : state.code ? `Turma ${e(state.code)}` : "Minha conta"}${demo ? " · Demonstração" : ""}</span><strong>${e(pageLabel())}</strong></div>${sessionContext()}</header>
  ${studentViewBanner()}${content(name)}<footer class="main-footer"><span>Escola da Nuvem · AWS re/Start</span>${!studentOnly() && !state.studentView && state.view !== "feedback" ? '<button type="button" class="text-link footer-feedback" data-view="feedback">Enviar feedback</button>' : ""}<span>Seu aprendizado, uma semana de cada vez.</span></footer></main></div>`;
  fitFeedbackMessages();
  // Foco que continua na página depois do render (fora de #app, como o aviso) é escolha do usuário: não muda.
  const lost = focused === document.body || !focused?.isConnected;
  if (changedView || titleFocused) {
    const title = $("main h1") || $("main");
    title?.setAttribute("tabindex", "-1");
    title?.focus({ preventScroll: true });
  } else if (focusId && document.getElementById(focusId)) {
    const next = document.getElementById(focusId);
    next.focus({ preventScroll: true });
    if (selection != null && ["search", "text"].includes(next.type)) next.setSelectionRange(selection, selection);
  } else if (lastFocusSelector && lost) $(lastFocusSelector)?.focus({ preventScroll: true });
  if (state.studentView) persistStudentView();
  saveContext();
  shellObserver?.disconnect();
  shellObserver?.observe($(".sidebar nav"));
  syncShell();
  messageObserver?.disconnect();
  const messages = $(".student-feedback #my-feedback-heading");
  if (messages) messageObserver?.observe(messages);
}

// Sem sessão: a landing, e nela a confirmação de cadastro. Fechada, o botão que abre o fluxo fica logo depois de
// "Primeiro acesso?" (só com região e cliente do Cognito na configuração); aberta, a etapa ocupa a coluna de texto, e
// cabeçalho, arte e rodapé continuam os da landing.
function publicPage() {
  syncReadContext();
  const s = state.signupConfirmation;
  const focused = document.activeElement, focusId = focused?.id;
  const oldCodeField = $("#signup-code"), typed = oldCodeField?.value, caret = oldCodeField?.selectionStart;
  // Intervalo de reenvio: um único timer redesenha quando ele acaba; todo render o cancela e, se ainda falta, refaz.
  const wait = s.step === signupConfirmationHandlers.SIGNUP_STEPS.CODE ? Math.max(0, s.resendAvailableAt - Date.now()) : 0;
  clearTimeout(resendTimer);
  if (wait) resendTimer = setTimeout(render, wait);
  if (!s.step || !$(".welcome-grid > section")) landing();
  if (s.step) $(".welcome-grid > section").innerHTML = signupConfirmationPage(wait);
  else if (config.region && config.userPoolClientId) $(".first-access")?.insertAdjacentHTML("afterend", signupConfirmationEntry());
  // O código digitado e ainda não enviado continua no campo; o envio o limpa antes de confirmar.
  const field = $("#signup-code");
  if (field && typed) field.value = typed;
  // Etapa nova: foco no título (ao fechar, no botão que abre o fluxo). Mesma etapa: o foco volta ao mesmo controle ou,
  // se ele ficou desabilitado pelo envio, ao campo da etapa. Foco fora da coluna redesenhada não muda.
  const changedStep = s.step !== shownSignupStep;
  shownSignupStep = s.step;
  if (changedStep) (s.step ? $("#signup-title") : $('[data-action="signup-confirmation-start"]'))?.focus();
  else if (focusId && !focused.isConnected) {
    const next = document.getElementById(focusId);
    (next && !next.disabled ? next : $("#signup-code, #signup-email"))?.focus({ preventScroll: true });
    if (field && document.activeElement === field && caret != null) field.setSelectionRange(caret, caret);
  }
}

// Aluno: Feedback no menu. Instrutor e admin: link discreto no rodapé (o menu deles já é longo).
function studentOnly() {
  return !!state.me && !state.me.roles.some((r) => r === "admin" || r === "instructor");
}

// Feedback do aluno (Expansão 3 e consolidação): o que só a tela mostra fica aqui, fora do state.js, sempre preso ao
// rascunho ou à lista a que se refere. Um rascunho novo (outro usuário: resetForUser; envio concluído) ou uma lista nova
// (outro usuário, outra turma ou outra tela: invalidateReads, C7.4) começa sem nada, sem precisar apagar o anterior.
// - feedbackChecked: o rascunho conferido; os problemas de validação aparecem junto dos campos.
// - feedbackFailure: o envio que falhou ({ draft, message, unsure }), até a próxima tentativa ou a saída da tela.
// - feedbackPicked: o resultado da última escolha de imagens ({ owner, target, refused, attached }): os arquivos recusados
//   e, no feedback já enviado, se a imagem foi anexada; owner é o rascunho (formulário) ou a lista (feedback já enviado).
// - feedbackOpen: as mensagens abertas em "Meus feedbacks" (lista → ids). Pelo id, não pela posição: "Carregar mais" e a
//   recarga depois de um envio mantêm cada uma aberta no feedback certo.
// O problema de um campo some assim que ele fica válido, sem redesenhar a tela (foco e cursor ficam onde estão).
let feedbackChecked = null, feedbackFailure = null, feedbackPicked = null;
const feedbackOpen = new WeakMap();
function openMessages() {
  if (!feedbackOpen.has(state.myFeedback)) feedbackOpen.set(state.myFeedback, new Set());
  return feedbackOpen.get(state.myFeedback);
}
function feedbackView() {
  const draft = state.feedbackDraft, picked = feedbackPicked;
  return {
    showProblems: feedbackChecked === draft,
    failure: feedbackFailure?.draft === draft ? feedbackFailure : null,
    picked: picked && picked.owner === (picked.target === "form" ? draft : state.myFeedback) ? picked : null,
    open: openMessages(),
  };
}
function settleFeedbackProblem(key) {
  const id = `fb-${key}-error`, error = document.getElementById(id);
  if (!error || feedbackProblems(state.feedbackDraft)[key]) return;
  error.remove();
  for (const field of document.querySelectorAll(`[aria-describedby~="${id}"]`)) {
    field.removeAttribute("aria-invalid");
    field.setAttribute("aria-describedby", field.getAttribute("aria-describedby").replace(` ${id}`, ""));
  }
}

// Aluno: com problemas, nada é enviado; eles aparecem todos junto dos campos e o foco vai ao primeiro (o handler
// valida de novo antes de enviar). O resultado fica no formulário, sem aviso temporário: a confirmação (ou "já tinha sido
// enviado"), a falha parcial das imagens ou o motivo de um envio que falhou, que fica junto do botão até a próxima
// tentativa. O foco não se perde: vai a esse resultado (ou ao "Tentar novamente" das imagens). Instrutor e admin: como antes.
async function submitFeedback() {
  if (!studentOnly()) return feedbackHandlers.submit();
  const draft = state.feedbackDraft;
  const problems = Object.keys(feedbackProblems(draft));
  if (problems.length) {
    feedbackChecked = draft;
    render();
    return $(problems[0] === "type" ? '[name="fb-type"]' : `#fb-${problems[0]}`)?.focus();
  }
  // Arquivos recusados antes desta tentativa deixam de valer. O motivo de uma falha anterior some durante o envio e é
  // trocado pelo resultado: outra falha, ou um rascunho novo (envio concluído).
  if (feedbackPicked?.target === "form") feedbackPicked = null;
  ownFocus();
  try {
    await feedbackHandlers.submit(true);
  } catch (err) {
    // Sessão encerrada durante o envio (expirada antes de sair, ou 401): a tela já é a entrada pública, e o aviso do portal
    // diz o motivo (busy), como antes do piloto. Sem isso o erro ficava preso ao rascunho, fora da vista, e nada era dito.
    if (!state.me) throw err;
    // Preso ao rascunho que saiu: se outra pessoa entrou na aba durante o envio, o de B é outro e o erro de A não aparece.
    feedbackFailure = { draft, ...sendFailure(err) };
    render();
  } finally {
    showResult("#fb-sent", ".fb-partial .button", "#fb-send-error", '#feedback-form [type="submit"]');
  }
}
// Ações do aluno no Feedback que decidem o foco no fim (envio, imagens, mensagem): o foco que um render perder no caminho
// fica perdido até lá, em vez de voltar ao último controle com nome de um render anterior (um campo, outro botão), longe
// da ação. O foco que a pessoa levar a outro lugar continua sendo respeitado.
function ownFocus() {
  lastFocusSelector = "";
}
// O foco perdido pelo render vai ao resultado, que fica à vista (o recuo de rolagem da raiz desconta a barra inferior);
// foco que a pessoa levou a outro lugar fica onde está, sem rolar a tela.
function showResult(...selectors) {
  restoreFocus(...selectors);
  const active = document.activeElement;
  if (!active?.closest(".student-feedback") || !selectors.some((selector) => active.matches(selector))) return;
  // C3: "nearest" não rola quando o resultado já passa das duas bordas da área visível (texto ampliado, fonte mais larga) e
  // deixava o começo dele fora da tela; mais alto que a área, ele é alinhado pelo começo.
  const room = innerHeight - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0);
  active.scrollIntoView({ block: active.getBoundingClientRect().height > room ? "start" : "nearest" });
}
// Sem resposta (rede, tempo esgotado) ou com erro do servidor (5xx), o feedback pode ter entrado; com 4xx (409, 429, 403…)
// ou antes de sair (sessão expirada), não. A mensagem do servidor já diz o que fazer.
const sendFailure = (err) => err.network
  ? { message: "A conexão com o portal falhou.", unsure: true }
  : { message: err.message || "Não foi possível completar a solicitação.", unsure: err.status >= 500 };

// Aluno: arquivos recusados ficam junto de onde a pessoa os escolheu (formulário ou feedback já enviado) até a próxima
// escolha ou envio, e recebem o foco; sem recusa, o foco volta ao botão de adicionar (no formulário com 3 imagens, ao
// Remover da última; no feedback já enviado, ao botão, que aponta para "Imagem anexada"). O handler troca o registro do
// envio pelo item a cada tentativa e o deixa sem mensagem quando dá certo. Instrutor e admin seguem direto para o handler.
async function pickFeedbackImages(target, files) {
  const form = target === "form", owner = form ? state.feedbackDraft : state.myFeedback, before = state.feedbackCardUpload[target];
  feedbackPicked = null;
  ownFocus();
  const refused = await feedbackHandlers.addPickedImages(target, files, true);
  const card = form ? null : state.feedbackCardUpload[target];
  const attached = !!card && card !== before && !card.busy && !card.message;
  if (refused || attached) feedbackPicked = { owner, target, refused, attached };
  render();
  const button = `[data-fb-pick="${CSS.escape(target)}"]:not(:disabled)`;
  if (form) showResult("#fb-files-error", button, ".fb-files > li:last-child .fb-remove");
  else showResult(`#fb-card-error-${CSS.escape(target)}`, button, `#fb-card-progress-${CSS.escape(target)}`);
}

// Feedback do aluno: mensagem com mais de 4 linhas na largura atual fica com as 3 primeiras até a pessoa abrir; com até 4,
// aparece inteira e sem botão. Medido logo depois de cada render (antes de devolver o foco, que pode ser o próprio botão) e
// quando a coluna muda de largura ou o texto de tamanho: o título "Meus feedbacks" acompanha as duas coisas e não muda com
// as mensagens (observar a lista faria a medida disparar a si mesma). Só lê alturas e marca a classe e o hidden do botão.
const MESSAGE_LINES = 4;
const messageObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => fitFeedbackMessages()) : null;
function fitFeedbackMessages() {
  const texts = [...document.querySelectorAll(".student-feedback .fb-entry-text")];
  const long = texts.map((text) => text.scrollHeight > (MESSAGE_LINES + 0.5) * parseFloat(getComputedStyle(text).lineHeight));
  texts.forEach((text, index) => {
    text.classList.toggle("is-long", long[index]);
    const toggle = text.parentElement.querySelector(".fb-message-toggle");
    if (toggle) toggle.hidden = !long[index];
  });
}

function content(name) {
  if (state.bootError) return errorPanel(state.bootError, "retry-boot");
  if (state.view === "feedback" && !state.studentView) return feedbackPage(feedbackView());
  if (state.view === "admin-feedback" && admin() && !state.studentView) return adminFeedbackPage(adminFeedbackView());
  if (state.view === "access" && admin() && !state.studentView) return accessPage(accessView());
  if (!state.code)
    return `${heading("PRIMEIRO ACESSO", `Olá, ${e(name)}.`, "Sua conta está confirmada. Vamos localizar sua turma.")}<section class="panel onboarding"><h2>Ainda não encontramos notas para esta conta</h2><p>Você entrou com <strong>${e(state.me.email)}</strong>.</p><ol><li>Confira se este é o mesmo e-mail cadastrado no Canvas.</li><li>Se estiver correto, peça ao instrutor para conferir sua matrícula e a primeira publicação de notas.</li><li>Uma conta confirmada não cria automaticamente uma matrícula.</li></ol><div class="form-footer"><button class="button primary" data-action="retry-boot">Verificar novamente</button><button class="button secondary" data-action="switch-account">Entrar com outra conta</button></div>${state.me.instructorCandidate ? `<p>É instrutor? Solicite seu acesso e aguarde o vínculo com a turma.</p><button class="button secondary" data-action="request" ${state.me.request ? "disabled" : ""}>${state.me.request ? "Solicitação enviada ao administrador" : "Solicitar acesso de instrutor"}</button>` : ""}</section>`;
  if (state.view === "reminders" && teacher()) return senderPage(senderView());
  if (state.view === "import" && teacher()) return importPage(importView());
  if (state.view === "student-pending" && teacher()) return pendingPage();
  if (state.view === "reminders-batch" && teacher()) return batchPage(batchView());
  if (state.view === "activity-overview" && teacher()) return activityOverviewPage();
  // Telas do aluno no piloto visual (painel, Minhas atividades e Meu histórico): carregamento, erro e ausência de notas
  // usam a composição da própria tela (.student-home, .student-activities ou .student-history), com os mesmos textos e
  // papéis.
  const studentHome = state.view === "overview" && !teacher();
  const studentActivities = state.view === "activities" && !teacher();
  const studentHistory = state.view === "history" && !teacher();
  // Painel do instrutor (Expansão 4) e Publicações da turma (Expansão 5): carregamento e erro na composição da tela, o
  // erro com o título.
  const teacherHome = state.view === "overview" && teacher();
  const teacherPublications = state.view === "history" && teacher();
  const studentState = (html, titled) => (teacherPublications ? teacherPublicationsState(html, titled) : studentHome ? studentHomeState(html) : studentActivities ? studentActivitiesState(html, titled)
    : studentHistory ? studentHistoryState(html, titled) : teacherHome ? teacherHomeState(html, titled) : html);
  // No erro, Minhas atividades (3.3) e Meu histórico (Expansão 2) mantêm o título da tela; o painel e as outras telas
  // ficam como estavam.
  if (state.reportError) return studentState(errorPanel(state.reportError, "refresh-report"), true);
  if (!state.report)
    return studentHome ? studentLoading() : studentState('<section class="panel empty" role="status">Carregando sua turma…</section>');
  if (state.view === "history") return historyPage(publicationsView());
  if (teacher()) return teacherPage(teacherView());
  if (!state.report.student) return studentState('<section class="panel empty">Ainda não há notas publicadas para sua conta.</section>');
  return state.view === "activities" ? activitiesPage() : studentPage(name);
}

// Sessão do portal (C1): a geração muda quando quem está na aba muda (outro userId no /me) ou quando a sessão expira (401).
// A restauração e o foco guardam a geração em que começaram; a resposta que chega em outra — outra pessoa, ou a mesma pessoa
// numa sessão nova (A → B → A: o e-mail sozinho não distinguiria) — não aparece, não avisa, não dispara pedido e não desfaz
// o andamento de quem está na aba. O pedido pode ter sido concluído no servidor; quem está na aba vê a versão em vigor ao
// consultar. Sair navega para o logout: a página, com as respostas pendentes, acaba ali.
let sessionGeneration = 0;
const personOf = (me) => (me ? String(me.userId || me.email || "") : "");

// Foco da turma (Expansão 4): o andamento e o resultado do salvamento ficam na própria seção, presos ao relatório em que
// ele começou (outro relatório — Consultar atualização, outra turma — começa sem nada). Durante o envio, Salvar e Remover
// ficam parados mesmo que a tela seja redesenhada. O pedido, a regra e a atualização do foco são os de antes; se a resposta
// chega com outro relatório na tela, o resultado vai para o aviso do portal, com a turma (C1). Recusa (4xx: o servidor
// recusa antes de gravar) e dúvida (rede, 5xx: pode ter gravado) são ditas de jeitos diferentes; salvar de novo não grava
// duas vezes, porque o servidor confere a versão.
// C2: dois salvamentos da turma podem se sobrepor na mesma sessão (Consultar atualização ou a ida e volta de turma durante o
// envio dão um relatório novo, com Salvar livre; a Visão por atividade muda o rascunho enquanto ele espera). Cada salvamento é
// uma operação (op), e a resposta só mexe no que é dela: o andamento, só se ainda for o dela; o rascunho, só se ainda for o que
// ela enviou; o relatório na tela recebe o foco salvo se for o dela, ou um relatório novo que ainda mostra a versão de onde ela
// partiu e não tem rascunho (com rascunho, a versão mudaria por baixo do que a pessoa está fazendo e o próximo envio passaria por
// cima, sem a recusa do servidor; com outro salvamento pendente, o servidor recusa esse outro pela versão). Se outro salvamento
// da turma começou depois, o aviso diz que é o anterior. Ignorar a resposta na tela não desfaz nada no servidor.
let focusOutcome = null, focusLatest = null;
function teacherView() {
  return { focus: focusOutcome?.report === state.report ? focusOutcome : null };
}
async function saveFocus() {
  const code = state.code, report = state.report, session = sessionGeneration, draft = state.focusDraft;
  const ids = draft || report.focus?.activityIds || [], base = report.focus?.version || null;
  const op = { report, kind: "saving", code };
  focusOutcome = focusLatest = op;
  const prior = () => focusLatest !== op && focusLatest.code === code;
  ownFocus();
  render();
  restoreFocus("#tp-focus-status");
  try {
    const result = await api.cohorts.saveFocus(code, {
      activityIds: ids, expectedCurrent: report.publication.id, expectedVersion: base,
    });
    if (session !== sessionGeneration) return;
    const shown = state.code === code ? state.report : null;
    if (shown && (shown === report || ((shown.focus?.version || null) === base && !state.focusDraft))) shown.focus = result.focus;
    if (state.focusDraft === draft) state.focusDraft = null;
    if (state.report === report && focusOutcome === op) focusOutcome = { report, kind: "saved", message: `Foco da ${code} atualizado.` };
    else notice(prior() ? priorFocus.saved(code) : `Foco da ${code} atualizado.`);
  } catch (err) {
    if (session !== sessionGeneration) return;
    const failure = restoreError(err);
    if (state.report !== report || focusOutcome !== op) {
      throw new Error(failure.unsure ? (prior() ? priorFocus.unsure(code) : unsureFocus(code))
        : prior() ? priorFocus.refused(code, failure.message) : `O foco da ${code} não foi salvo. ${failure.message}`);
    }
    focusOutcome = { report, kind: "error", ...failure };
  } finally {
    // Só o próprio salvamento limpa o andamento dele: o de outro salvamento (outro relatório, outra turma, outra sessão) fica.
    if (focusOutcome === op) focusOutcome = null;
    // O resultado tem o mesmo id do andamento: o render devolve o foco a ele (foco que a pessoa levou a outro lugar fica).
    if (state.me && state.report === report) render();
  }
}

// Publicações da turma (Expansão 5): a restauração é a de antes — confirm(), o pedido com expectedCurrent (409 se a turma
// mudou) e boot() depois da resposta —, com a pergunta dizendo qual publicação e a consequência. O andamento fica preso à
// turma (todos os Restaurar dela parados, mesmo que a tela seja redesenhada: um segundo clique restaurava outra
// publicação); o erro e o resultado, ao relatório em que aconteceram, na própria tela e com o foco. O sucesso só aparece
// depois da resposta do servidor. Se a pessoa saiu da tela ou da turma, o resultado vai para o aviso do portal, como antes
// (com a turma, quando ela é outra).
// C1: o andamento, o erro e o resultado também ficam presos à sessão em que a restauração começou (D03); fora da tela, a
// dúvida (rede, 5xx) é dita como dúvida, com a turma de origem e a consulta segura, nunca como "não foi restaurada" (D04).
// C2: a dúvida (rede, 5xx, resposta perdida) fica guardada por turma, em memória e só para a sessão que restaurou, e aparece em
// Publicações da turma de origem — na publicação que se tentou restaurar, com o texto e a consulta da E5 — até a consulta
// feita ali trazer o relatório, outra restauração da turma começar ou a sessão mudar; navegar não a encerra. Longe dali, o
// aviso do portal é curto (a operação, a turma, a dúvida e onde ver) e já anuncia; por isso ela aparece em Publicações sem se
// anunciar de novo. Vista na hora (Publicações da turma, ou o mesmo relatório, como na E5), é um alerta, sem aviso.
// PR #3: o andamento e o resultado ficam guardados por turma. Numa variável só, a restauração de outra turma tomava o lugar
// da desta: a trava "Restaurando…" sumia e um segundo Restaurar saía. A recusa (nada mudou) não fica guardada como a
// dúvida: fora de Publicações (no Painel, mesmo da turma e do relatório) vai ao aviso do portal, como o sucesso.
const restoreOutcomes = new Map();
const restoreDoubts = new Map();
function publicationsView() {
  const o = restoreOutcomes.get(state.code);
  if (o && o.session === sessionGeneration) {
    if (o.kind === "restoring") return { restoring: o.publicationId };
    if (o.report === state.report) return { [o.kind]: o };
  }
  const doubt = restoreDoubts.get(state.code);
  return doubt?.session === sessionGeneration ? { error: doubt } : {};
}
async function restorePublication(publicationId) {
  const code = state.code, report = state.report, session = sessionGeneration;
  const running = restoreOutcomes.get(code);
  if (running?.kind === "restoring" && running.session === session) return;
  if (!confirm(restoreQuestion(publicationId))) return;
  restoreDoubts.delete(code);
  const mine = { code, publicationId, kind: "restoring", session };
  restoreOutcomes.set(code, mine);
  // Só a própria restauração troca ou apaga o que está guardado para a turma.
  const settle = (next) => {
    if (restoreOutcomes.get(code) !== mine) return;
    if (next) restoreOutcomes.set(code, next);
    else restoreOutcomes.delete(code);
  };
  ownFocus();
  render();
  restoreFocus("#tpub-restore-status");
  const gone = () => {
    if (session === sessionGeneration) return false;
    settle(null);
    return true;
  };
  try {
    await api.cohorts.restore(code, { publicationId, expectedCurrent: report.publication.id });
  } catch (err) {
    if (gone()) return;
    const sameReport = restoreOutcomes.get(code) === mine && state.code === code && state.report === report;
    const failure = restoreError(err);
    if (failure.unsure) {
      const watching = sameReport || (state.code === code && state.view === "history");
      settle(null);
      restoreDoubts.set(code, { session, publicationId, ...failure, quiet: !watching });
      if (state.me) render();
      if (!watching) throw new Error(unsureRestore(code));
      return;
    }
    const here = sameReport && state.view === "history";
    settle(here ? { code, report, publicationId, kind: "error", session, ...failure } : null);
    // O erro tem o mesmo id do andamento: o render devolve o foco a ele (foco que a pessoa levou a outro lugar fica).
    if (state.me) render();
    if (!here) throw new Error(`A publicação${state.code === code ? "" : ` da ${code}`} não foi restaurada. ${err.message || ""}`.trim());
    return;
  }
  if (gone()) return;
  await boot();
  if (gone()) return;
  const here = state.code === code && state.view === "history" && state.report?.publication?.id === publicationId;
  settle(here ? { code, report: state.report, publicationId, kind: "restored", session } : null);
  // O resultado também tem o id do andamento, que a recarga manteve com o foco na publicação restaurada.
  if (state.me) render();
  if (!here || restoreOutcomes.get(code)?.kind !== "restored") notice(state.code === code ? "Publicação restaurada." : `Publicação da ${code} restaurada.`);
}
// Sem resposta (rede) ou com erro do servidor (5xx), a restauração pode ter acontecido; com 4xx (409, 403, 404) ou antes de
// sair (sessão expirada), não. A mensagem do servidor é a de sempre.
const restoreError = (err) => err.network || err.status >= 500
  ? { unsure: true, message: err.network ? "A conexão com o portal falhou." : err.message || "Não foi possível concluir a operação." }
  : { message: err.message || "Não foi possível concluir a operação.", conflict: err.status === 409 };
const unsureRestore = (code) => `Não foi possível confirmar a restauração da turma ${code}. Ela pode ter sido concluída: veja Publicações.`;
const unsureFocus = (code) => `Não foi possível confirmar a atualização do foco da ${code}. A alteração pode ter sido salva: consulte a atualização no Painel do instrutor da ${code} antes de salvar de novo.`;
const priorFocus = {
  saved: (code) => `O salvamento anterior do foco da ${code} foi concluído.`,
  refused: (code, reason) => `O salvamento anterior do foco da ${code} foi recusado. ${reason}`,
  unsure: (code) => `Não foi possível confirmar o salvamento anterior do foco da ${code}: ele pode ter sido concluído.`,
};

// Atualizar notas (Expansão 6): conferir, trocar o arquivo e publicar são as operações do handler, com as mesmas chamadas e
// a mesma confirmação; a publicação leva ao painel e avisa, como antes. Durante a publicação, tudo da turma fica parado
// (arquivo, seleção, conferência, confirmação dos removidos e Publicar), mesmo que a tela seja redesenhada: antes, um arquivo
// escolhido nesse meio era descartado sem aviso e "Atualizar prévia" reabilitava Publicar com outro rascunho. Andamento e erro
// ficam na tela, junto da ação e com o foco. O erro fica na turma em que aconteceu até a pessoa trocar o arquivo, conferir de
// novo ou confirmar outra publicação (cancelar a pergunta não muda nada) e sai com os rascunhos quando outra pessoa entra na
// aba (boot). Fora da tela (outra tela ou outra turma), o aviso do portal, como antes, com a turma quando ela é outra; de outra
// pessoa que entrou na aba, nada. shownUnfilled: prévias com as atividades sem notas preenchidas à vista.
const publishing = new Set();
let importFailure = null;
const shownUnfilled = new WeakSet();
function importView() {
  const f = importFailure;
  return { publishing: publishing.has(state.code), showUnfilled: !!state.preview && shownUnfilled.has(state.preview),
    failure: f && f.code === state.code ? f : null };
}
// Sem resposta (rede) ou com erro do servidor (5xx), a publicação pode ter acontecido (unsure); com 4xx, não — o 409 (a turma
// mudou ou a prévia já foi publicada, inclusive por uma tentativa anterior cuja resposta se perdeu) não diz "não foi publicada".
// A mensagem é a do servidor ou a do handler, e a falha de rede ganha texto em português. Sessão encerrada: o aviso de sempre.
function importFailed(step, err, code, owner, detail = {}) {
  if (!state.me) throw err;
  if (state.me.email !== owner) return;
  const unsure = !!err.network || err.status >= 500;
  const message = err.network ? `A conexão com o portal falhou.${step === "check" ? " Tente de novo." : ""}` : err.message || "Não foi possível concluir a operação.";
  if (state.code !== code || state.view !== "import") {
    const where = state.code === code ? "" : ` da ${code}`;
    throw new Error(step === "check" ? `O arquivo${where} não foi conferido. ${message}`
      : unsure ? `Não foi possível confirmar a publicação${where}. ${message} Ela pode ter sido concluída: consulte as publicações da turma antes de publicar de novo.`
      : err.status === 409 ? `A prévia${where} não pode ser publicada. ${message}` : `A atualização${where} não foi publicada. ${message}`);
  }
  importFailure = { owner, code, report: state.report, step, unsure, conflict: err.status === 409, message, ...detail };
  render();
  restoreFocus(step === "publish" ? "#timp-publish-status" : "#timp-check-status");
}
async function pickCsv(file) {
  const code = state.code, owner = state.me?.email;
  if (importFailure?.code === code) importFailure = null;
  try {
    await importHandlers.selectCsv(file);
  } catch (err) {
    importFailed("check", err, code, owner, { kind: "file", file: file?.name || "" });
  }
}
// O andamento aparece já no render que o handler faz ao começar; o foco vai a ele e, no fim, à prévia (ou ao erro).
async function checkImport() {
  const code = state.code, owner = state.me?.email, shown = !!state.preview && shownUnfilled.has(state.preview);
  if (importFailure?.code === code) importFailure = null;
  ownFocus();
  const checking = importHandlers.previewImport();
  restoreFocus("#timp-check-status");
  try {
    await checking;
  } catch (err) {
    const kind = err.status === 400 || err.status === 413 ? "file" : err.status || err.network ? "other" : state.filename ? "empty" : "missing";
    return importFailed("check", err, code, owner, { kind, file: state.filename });
  }
  if (state.code !== code || state.view !== "import" || !state.preview) return;
  // A prévia nova continua com as atividades sem notas à vista, se estavam.
  if (shown && !shownUnfilled.has(state.preview)) {
    shownUnfilled.add(state.preview);
    render();
  }
  restoreFocus("#timp-review-title");
}
async function publishImport() {
  const code = state.code, owner = state.me?.email;
  if (publishing.has(code)) return;
  let published, failure;
  try {
    published = await importHandlers.publish(() => {
      if (importFailure?.code === code) importFailure = null;
      publishing.add(code);
      ownFocus();
      render();
      restoreFocus("#timp-publish-status");
    });
  } catch (err) {
    failure = err;
  }
  // Fim do andamento: a turma volta a ficar livre (com o erro, se houver, logo abaixo).
  if (publishing.delete(code) && !published && state.me && state.code === code && state.view === "import") render();
  if (failure) return importFailed("publish", failure, code, owner);
  if (!published) return;
  state.view = "overview";
  await boot();
  notice("Atualização publicada. Os alunos já podem consultar.");
}

// Lembretes (Expansão 7): consultar e verificar o remetente, consultar os destinatários e enviar o lote são as operações do
// handler, com as mesmas chamadas, a mesma confirmação e as mesmas guardas (C7.3 e C7.4); aqui fica só o que a pessoa vê. O
// andamento e o resultado ficam na própria tela, com o foco. O andamento da verificação fica preso à pessoa e à turma; o erro,
// à consulta do remetente que estava na tela. O envio fica preso à prévia do lote em que começou: durante ele, Enviar fica
// parado mesmo que a tela seja redesenhada, e uma prévia nova (consultar de novo, outro lote, outra turma ou outra pessoa)
// começa sem nada. A resposta que chega com outra prévia ou outra tela não redesenha nem avisa (o handler a descarta).
let senderVerifying = null;
let senderFailure = null;
const batchSending = new Set();
let batchFailure = null;
function senderView() {
  return { verifying: senderVerifying?.owner === state.me?.email && senderVerifying.code === state.code,
    failure: senderFailure?.sender === state.sender ? senderFailure : null };
}
function batchView() {
  const p = state.batchPreview;
  return { sending: batchSending.has(p), failure: batchFailure?.preview === p ? batchFailure : null };
}
// Fechamento da Expansão 7: o resultado da verificação e do envio recebe o foco que o render tirou do andamento (o foco vai ao
// <body> quando o andamento sai da tela, ou fica nele enquanto ele está à vista); se a pessoa levou o foco a outro lugar (um
// controle, ou o <main> num clique na página), ele fica lá, e só então o aviso temporário do handler anuncia a resposta. Com o
// foco no resultado, o aviso repetiria a tela.
const focusElsewhere = (progress) => () => document.activeElement !== document.body && !document.activeElement.matches(progress);
// A consulta começa redesenhando a tela (andamento): o foco vai a ele e, no fim, à situação (ou ao erro).
async function refreshReminderSender() {
  ownFocus();
  const loading = remindersHandlers.loadSender();
  restoreFocus("#trem-sender-loading");
  await loading;
  if (state.view === "reminders") restoreFocus("#trem-sender-status", ".teacher-reminders > .panel[role=alert] .button");
}
// Erros da verificação e do envio: sem resposta ou com 5xx, o pedido pode ter chegado (unsure); com 4xx, não. A mesma regra e
// as mesmas mensagens da restauração (restoreError).
async function verifyReminderSender() {
  const owner = state.me?.email, code = state.code, mine = { owner, code };
  senderVerifying = mine;
  ownFocus();
  render();
  restoreFocus("#trem-verify-status");
  let failure = null;
  try {
    await remindersHandlers.verifySender(focusElsewhere("#trem-verify-status"));
  } catch (err) {
    failure = err;
  }
  if (senderVerifying === mine) senderVerifying = null;
  // Outra pessoa (ou sessão encerrada), outra turma ou outra tela: nada muda (o handler já descarta a resposta).
  if (state.me?.email !== owner || state.code !== code || state.view !== "reminders") return;
  if (failure) senderFailure = { sender: state.sender, ...restoreError(failure) };
  // O erro tem o id do andamento (o render devolve o foco a ele); a situação nova recebe o foco perdido.
  render();
  restoreFocus("#trem-sender-status");
}
async function recheckReminderBatch() {
  ownFocus();
  const loading = remindersHandlers.loadBatchPreview();
  restoreFocus("#trem-batch-loading");
  await loading;
  if (state.view === "reminders-batch") restoreFocus("#trem-summary-title", ".teacher-reminders > .panel[role=alert] .button");
}
async function sendReminderBatch() {
  const preview = state.batchPreview;
  let started = false, failure = null;
  try {
    await remindersHandlers.sendBatch(() => {
      started = true;
      if (batchFailure?.preview === preview) batchFailure = null;
      batchSending.add(preview);
      ownFocus();
      render();
      restoreFocus("#trem-send-status");
    }, focusElsewhere("#trem-send-status"));
  } catch (err) {
    failure = err;
  }
  batchSending.delete(preview);
  // Sessão encerrada: o aviso de sempre.
  if (failure && !state.me) throw failure;
  if (!started || state.view !== "reminders-batch" || state.batchPreview !== preview) return;
  if (failure) batchFailure = { preview, ...restoreError(failure) };
  // O erro tem o id do andamento (o render devolve o foco a ele); o resultado recebe o foco perdido.
  render();
  if (!failure) restoreFocus("#trem-result-title");
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

// Participação na turma (C7.2.4), pelo detalhe do aluno. O estado esperado é o que a tela mostra (participationStatus da
// prévia; ausência = ativo) e o servidor recusa com 409 se outra pessoa mudou antes. Depois de mudar, ou de descobrir
// que mudou (409) ou que o aluno saiu da publicação (404), detalhe e relatório são recarregados: a tela segue o
// servidor, sem atualização otimista e sem nova tentativa automática.
async function setParticipation(status) {
  const code = state.code, p = state.pendingPreview;
  const expectedStatus = isWithdrawn(p) ? "WITHDRAWN" : "ACTIVE";
  if (!p || status === expectedStatus) return;
  const { id, name } = p.student;
  if (!confirm(status === "WITHDRAWN"
    ? `Marcar ${name} como desistente?\n\nO aluno deixará de participar das métricas e dos lembretes da turma. Os dados e notas do Canvas não serão removidos.`
    : `Reativar ${name}?\n\nO aluno voltará a participar das métricas e poderá receber lembretes. Nada é alterado no Canvas.`)) return;
  try {
    await api.cohorts.setParticipation(code, { canvasId: id, status, expectedStatus });
  } catch (err) {
    if (err.network) throw new Error("Não foi possível confirmar a alteração. Confira sua conexão e tente de novo.");
    if (err.status !== 409 && err.status !== 404) throw err;
    await reloadParticipation(code, id);
    throw err.status === 409 ? new Error("A participação deste aluno foi alterada por outra pessoa. Os dados foram atualizados.") : err;
  }
  await reloadParticipation(code, id);
  notice(status === "WITHDRAWN" ? "Aluno marcado como desistente." : "Aluno reativado.");
}

// Detalhe primeiro (some o botão antigo enquanto recarrega), depois o relatório; o foco vai para o título da participação.
// Um erro ao recarregar o detalhe aparece no próprio detalhe, com "Tentar novamente".
async function reloadParticipation(code, studentId) {
  if (state.code !== code) return;
  if (state.view === "student-pending" && state.pendingStudentId === studentId) {
    await remindersHandlers.loadPending(studentId).catch(() => {});
    $("#participation-heading")?.focus();
  }
  if (state.code === code) await loadReport();
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
  if (!files.length || !pickerTarget) return;
  if (studentOnly()) busy(null, () => pickFeedbackImages(pickerTarget, files));
  else busy(null, () => feedbackHandlers.addPickedImages(pickerTarget, files));
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
  remindersHandlers.invalidateReads();
  feedbackHandlers.invalidateReads();
  render();
  state.bootError = "";
  try {
    const wasSignedIn = !!state.me;
    const person = personOf(state.me);
    state.me = await api.me.get();
    if (person && personOf(state.me) !== person) sessionGeneration++;
    importHandlers.resetDraftsForUser(state.me.email);
    feedbackHandlers.resetForUser(state.me.email);
    adminFeedbackHandlers.resetForUser(state.me.email);
    if (importFailure?.owner !== state.me.email) importFailure = null;
    if (!wasSignedIn && !demo) {
      try {
        const context = JSON.parse(localStorage.getItem("avanca.context") || "null");
        if (context?.owner === state.me.email) {
          for (const key of ["code", "view", "filter", "search", "sort", "canvasActivityFilter", "activityKind", "activityModule"])
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
// Um render que recria o botão acionado deixa o foco no BODY: devolve-o ao controle equivalente, só se o foco
// realmente se perdeu (se a pessoa já foi para outro controle, ele fica onde está).
function restoreFocus(...selectors) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  for (const selector of selectors) {
    const target = $(selector);
    if (target) return target.focus({ preventScroll: true });
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

// Turmas e acessos (Expansão 8): as operações são as do handler (e, para criar turma e salvar configurações, as de antes no
// app.js), com as mesmas chamadas e confirmações; aqui fica só o que a pessoa vê. Durante uma operação, tudo que muda algo na
// tela fica parado e o andamento fica junto do alvo, com o foco. A recusa (4xx: nada mudou) e a dúvida (rede, 5xx: pode ter
// mudado) ficam junto do alvo, presas à pessoa e à lista em que aconteceram (uma recarga, outra turma ou outra pessoa começam
// sem elas); a dúvida e o conflito (404, 409) levam à consulta segura. Fora da tela (outra tela, ou outra turma nas operações
// da turma), o aviso do portal, como antes; de outra pessoa que entrou na aba, nada. O sucesso continua no aviso do portal,
// com a pessoa e a turma, e o foco vai à seção recarregada.
let accessBusy = null;
let accessFailure = null;
// A turma escolhida em cada pedido pendente (Vincular), da pessoa da sessão: o render refaz o seletor, e a escolha não volta
// sozinha à primeira turma — uma nova tentativa, depois de uma falha, iria para a turma errada. Expansão 8.1: sem escolha, o
// seletor fica em "Selecione uma turma" e Vincular, parado; outra pessoa na aba começa sem escolhas.
let approvePicks = { owner: null, picks: {} };
// Vincular só sai (Expansão 8.1) com a turma escolhida neste pedido (não um valor trocado sem escolher), pela pessoa da sessão,
// sem outra operação em andamento — o botão parado não é a única proteção. O handler confere o pedido pendente e a turma da
// lista atual e pergunta com esses mesmos identificadores, que vão no pedido.
const approvable = (userId, code) => !accessBusy && approvePicks.owner === state.me?.email && approvePicks.picks[userId] === code;
// Operações da turma selecionada (as outras valem para o portal inteiro): o andamento e o erro delas só aparecem na turma em que
// começaram — a mesma pessoa pode acompanhar as duas turmas, e a linha dela na outra turma não é o alvo.
const COHORT_OPS = ["revoke", "unlink", "rename", "settings"];
const accessList = (kind) => ({ approve: state.requests, reject: state.requests, revoke: state.instructors, unlink: state.studentResults, rename: state.studentResults,
  settings: state.cohorts.find((c) => c.code === state.code), create: state.cohorts })[kind];
function accessView() {
  const mine = (op) => !!op && op.owner === state.me?.email && (!COHORT_OPS.includes(op.kind) || op.code === state.code);
  return { busy: mine(accessBusy) ? accessBusy : null, failure: mine(accessFailure) && accessFailure.list === accessList(accessFailure.kind) ? accessFailure : null,
    picks: approvePicks.owner === state.me?.email ? approvePicks.picks : {} };
}
const accessError = (err) => ({ unsure: !!err.network || err.status >= 500, stale: err.status === 404 || err.status === 409,
  message: err.network ? "A conexão com o portal falhou." : err.message || "Não foi possível concluir a operação." });
async function accessOperation(op, run, focusTo) {
  const mine = { ...op, owner: state.me?.email, code: state.code };
  let started = false, failure = null;
  try {
    await run(() => { started = true; accessFailure = null; accessBusy = mine; ownFocus(); render(); restoreFocus("#aa-op-status"); });
  } catch (err) {
    failure = err;
  }
  if (accessBusy === mine) accessBusy = null;
  // Sessão encerrada, ou recusado antes do pedido (ex.: nome vazio): o aviso de sempre. Cancelado: nada.
  if (failure && (!state.me || !started)) throw failure;
  if (!started || state.me?.email !== mine.owner) return;
  const here = state.view === "access" && (!COHORT_OPS.includes(op.kind) || state.code === mine.code);
  if (failure && !here) throw failure;
  if (failure) accessFailure = { ...mine, list: accessList(op.kind), ...accessError(failure) };
  // O erro tem o id do andamento (o render devolve o foco a ele); no sucesso, o foco que se perdeu vai à seção recarregada (em
  // outra tela, ela não existe e nada muda).
  if (state.view === "access") render();
  if (!failure) restoreFocus(focusTo);
}
// Busca de alunos: o resultado (contagem ou erro) recebe o foco quando ele se perdeu ou ainda estava na busca.
async function searchAccessStudents(search) {
  ownFocus();
  await search();
  const active = document.activeElement;
  if (state.view === "access" && (active === document.body || !active?.isConnected || active.matches("#student-query, #student-search-form button")))
    $("#aa-students-count")?.focus();
}
// Consulta pedida na tela (Atualizar, Tentar novamente, Atualizar a lista, Consultar de novo): o foco que se perdeu (o botão do
// erro some na recarga) vai ao título da seção de onde a pessoa pediu; Atualizar, que continua na tela, fica com ele.
async function consultAccess(button, load) {
  const title = button?.closest(".aa-sub, .aa-section")?.querySelector("h2[id], h3[id]")?.id;
  await load();
  if (state.view === "access") restoreFocus(...(title ? [`#${title}`] : []), "#aa-requests-title");
}

// Feedbacks administrativos (Expansão 9): a mudança de status é a operação da tela, com a mesma chamada do handler (expectedStatus;
// no 409, a lista relida em silêncio, como na C7.5). Durante ela, o seletor e Salvar status ficam parados (em qualquer feedback
// aberto) e o andamento fica junto da ação, com o foco. A recusa (4xx: nada mudou) e a dúvida (rede, 5xx: pode ter mudado) ficam
// junto da ação, presas à pessoa e ao feedback como a lista o trouxe (a lista relida e outra pessoa começam sem elas); a dúvida, o
// 404 e o 409 levam à lista atualizada. Fora da tela (outra tela, ou o feedback que saiu da lista relida no 409), o aviso do
// portal, como antes; de outra pessoa que entrou na aba, nada. O sucesso continua no aviso do portal, e o foco volta ao seletor.
let feedbackStatusBusy = null;
let feedbackStatusFailure = null;
// O status escolhido em cada feedback (pelo item, como a lista o trouxe): o render refaz o seletor sem voltar ao status atual (o
// fim da carga das imagens, o andamento, o erro); a lista relida e outra pessoa começam sem escolhas.
const statusPicks = new WeakMap();
function adminFeedbackView() {
  const a = state.adminFeedback, selected = a.items.find((f) => f.id === a.selectedId);
  const mine = (op) => !!op && op.owner === state.me?.email;
  return { busy: mine(feedbackStatusBusy) ? feedbackStatusBusy : null, failure: mine(feedbackStatusFailure) && feedbackStatusFailure.item === selected ? feedbackStatusFailure : null,
    pick: selected && statusPicks.get(selected) };
}
// Uma mudança de cada vez: o botão parado não é a única proteção (clique duplo, clique forçado).
async function saveFeedbackStatus(id, status) {
  if (feedbackStatusBusy) return;
  const owner = state.me?.email, mine = { owner, id, status, title: state.adminFeedback.items.find((f) => f.id === id)?.title || "" };
  let started = false, failure = null;
  try {
    await adminFeedbackHandlers.saveStatus(id, status, () => { started = true; feedbackStatusFailure = null; feedbackStatusBusy = mine; ownFocus(); render(); restoreFocus("#afb-op-status"); });
  } catch (err) {
    failure = err;
  }
  if (feedbackStatusBusy === mine) feedbackStatusBusy = null;
  // Sessão encerrada, ou nada saiu: o aviso de sempre. Outra pessoa na aba: nada.
  if (failure && (!started || !state.me)) throw failure;
  if (!started || state.me?.email !== owner) return;
  const item = state.adminFeedback.items.find((f) => f.id === id);
  if (failure && !(state.view === "admin-feedback" && state.adminFeedback.selectedId === id && item)) throw failure;
  // O erro tem o id do andamento (o render devolve o foco a ele); a mesma regra de recusa e dúvida da Expansão 8.
  if (failure) feedbackStatusFailure = { ...mine, item, ...accessError(failure) };
  if (state.view === "admin-feedback") render();
}
// Atualizar a lista (depois da dúvida, do 404 ou do 409): de volta à lista, relida com os filtros dela; o foco vai à linha do
// feedback (ou ao título da página, se ele saiu da lista).
async function consultFeedback() {
  const id = state.adminFeedback.selectedId;
  state.adminFeedback.selectedId = null;
  ownFocus();
  await adminFeedbackHandlers.load(true);
  if (state.view !== "admin-feedback") return;
  $("main h1")?.setAttribute("tabindex", "-1");
  restoreFocus(`[data-fb-open="${CSS.escape(id || "")}"]`, "main h1");
}

// Ações dos botões com data-action. Cada uma recebe o botão clicado; erros lançados
// viram aviso para o usuário via busy().
const actions = {
  "retry-boot": (button) => (button?.closest(".admin-access") ? consultAccess(button, boot) : boot()),
  // C2: a consulta feita em Publicações mostra a versão em vigor: quando o relatório chega, a dúvida da restauração da turma acaba.
  "refresh-report": async () => {
    const code = state.code, doubt = state.view === "history" ? restoreDoubts.get(code) : undefined;
    await loadReport();
    if (doubt && restoreDoubts.get(code) === doubt && state.code === code && state.report && !state.reportError) {
      restoreDoubts.delete(code);
      render();
    }
  },
  "retry-pending": () => remindersHandlers.loadPending(state.pendingStudentId),
  "retry-batch-preview": () => recheckReminderBatch(),
  "reminders-batch": (button) => remindersHandlers.openBatch(button.dataset.ids),
  "send-reminders-batch": () => sendReminderBatch(),
  "clear-filters": () => {
    Object.assign(state, { search: "", filter: "all", activityKind: "all", activityModule: "all", sort: "name", canvasActivityFilter: "all" });
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
  "refresh-sender": () => refreshReminderSender(),
  "verify-sender": () => verifyReminderSender(),
  "withdraw-student": () => setParticipation("WITHDRAWN"),
  "reactivate-student": () => setParticipation("ACTIVE"),
  login: () => login(config),
  "signup-confirmation-start": () => signupConfirmationHandlers.start(),
  "signup-confirmation-reset": () => signupConfirmationHandlers.reset(),
  "signup-confirmation-resend": () => signupConfirmationHandlers.requestCode(),
  "signup-confirmation-use-other-email": () => signupConfirmationHandlers.start(),
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
  // Expansão 9: com a última página, Carregar mais some; o foco que se perdeu vai ao primeiro feedback que chegou.
  "admin-feedback-more": async () => {
    const before = state.adminFeedback.items.length;
    await adminFeedbackHandlers.load(false);
    if (state.view === "admin-feedback") restoreFocus(".fb-more", `.afb-row:nth-child(${before + 1}) .fb-open`);
  },
  "admin-feedback-consult": () => consultFeedback(),
  // Aluno: o resultado fica no formulário (sem aviso) e o foco vai a ele; ao descartar, ao botão de adicionar imagem.
  "feedback-retry-uploads": async () => {
    if (!studentOnly()) return feedbackHandlers.retryUploads();
    ownFocus();
    await feedbackHandlers.retryUploads(true);
    showResult("#fb-sent", ".fb-partial .button");
  },
  "feedback-discard-uploads": () => {
    if (!studentOnly()) return feedbackHandlers.discardUploads();
    ownFocus();
    feedbackHandlers.discardUploads();
    showResult('[data-fb-pick="form"]');
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
  "refresh-requests": (button) => consultAccess(button, accessHandlers.loadAccess),
  "repeat-student-search": () => searchAccessStudents(() => accessHandlers.searchStudents(state.studentQuery)),
  publish: () => publishImport(),
};

// Chamado pela camada de rede quando não há sessão válida ou a API responde 401. A requisição
// ainda falha em seguida, e o erro chega a quem chamou (busy/boot) como antes.
function expireSession() {
  sessionGeneration++;
  saveContext();
  clearSession();
  state.me = null;
  state.classReport = null;
  state.report = null;
  publicPage();
}

function signOut() {
  if (importHandlers.hasUnpublishedCsv() && !confirm("Sair descarta os arquivos e prévias ainda não publicados. Deseja continuar?")) return;
  remindersHandlers.invalidateReads();
  feedbackHandlers.invalidateReads();
  importHandlers.discardDrafts();
  feedbackHandlers.resetForUser("");
  adminFeedbackHandlers.resetForUser("");
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
    // Aluno: o botão some com a imagem; o foco vai ao botão de adicionar (ou ao Remover que sobrou, sem vaga).
    if (studentOnly()) ownFocus();
    feedbackHandlers.removeFile(button.dataset.fbRemoveFile);
    if (studentOnly()) showResult('[data-fb-pick="form"]', ".fb-files .fb-remove");
    return;
  }
  // Mensagem de "Meus feedbacks" (aluno): abrir e recolher. O foco volta ao botão; recolhida, a mensagem encolhe acima
  // dele, então ele é trazido de volta à vista.
  if (button.dataset.fbMessage) {
    const id = button.dataset.fbMessage, open = openMessages(), toggle = `[data-fb-message="${CSS.escape(id)}"]`;
    if (!open.delete(id)) open.add(id);
    ownFocus();
    render();
    restoreFocus(toggle);
    if (!open.has(id)) $(toggle)?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (button.dataset.fbToggleAttachments) {
    const id = button.dataset.fbToggleAttachments;
    const toggle = `[data-fb-toggle-attachments="${CSS.escape(id)}"]`;
    if (studentOnly()) ownFocus();
    if (state.feedbackAttachments[id]?.open) {
      feedbackHandlers.closeAttachments(id);
      restoreFocus(toggle);
    } else busy(button, () => feedbackHandlers.loadAttachments(id)).then(() => restoreFocus(toggle));
    return;
  }
  if (button.hasAttribute("data-fb-back")) {
    const opened = state.adminFeedback.selectedId;
    adminFeedbackHandlers.back();
    restoreFocus(`[data-fb-open="${CSS.escape(opened)}"]`, ".fb-open");
    return;
  }
  if (button.dataset.fbStatus !== undefined && state.view === "admin-feedback") {
    return busy(button, () => adminFeedbackHandlers.setFilter("status", button.dataset.fbStatus));
  }
  if (button.dataset.fbSave)
    return busy(button, () => {
      const status = $("#fb-status-select").value;
      return saveFeedbackStatus(button.dataset.fbSave, status);
    }).then(() => restoreFocus("#fb-status-select", ".fb-open"));
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
  // Foco da turma (Expansão 4): o botão some com a atividade; o foco fica na lista (o Remover que ocupou o lugar, ou o
  // último), senão em Salvar, senão em escolher atividades, em vez de voltar a um controle antigo da página.
  if (button.dataset.removeFocus) {
    const current = state.focusDraft || state.report.focus?.activityIds || [];
    const index = [...document.querySelectorAll(".tp-remove")].indexOf(button);
    state.focusDraft = current.filter((id) => id !== button.dataset.removeFocus);
    render();
    const removes = document.querySelectorAll(".tp-remove");
    (removes[Math.min(index, removes.length - 1)] || $('#focus-form [type="submit"]:not(:disabled)') || $('#focus-form [data-view="activity-overview"]'))?.focus();
    return;
  }
  if (button.dataset.view) {
    const previousView = state.view;
    const returning = ["student-pending", "reminders-batch", "activity-overview"].includes(state.view) && button.dataset.view === "overview";
    if (state.view === "overview" && button.dataset.view === "activity-overview")
      state.teacherFilters = { search: state.search, filter: state.filter, sort: state.sort, canvasActivityFilter: state.canvasActivityFilter };
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
      feedbackChecked = feedbackFailure = feedbackPicked = null;
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
  if (button.dataset.revoke) {
    const userId = button.dataset.revoke;
    return busy(button, () => accessOperation({ kind: "revoke", target: userId }, (started) => accessHandlers.revokeInstructor(userId, started), "#aa-instructors-title"));
  }
  if (button.dataset.reject) {
    const userId = button.dataset.reject;
    return busy(button, () => accessOperation({ kind: "reject", target: userId }, (started) => accessHandlers.rejectRequest(userId, started), "#aa-requests-title"));
  }
  if (button.dataset.unlink) {
    const canvasId = button.dataset.unlink;
    return busy(button, () => accessOperation({ kind: "unlink", target: canvasId }, (started) => accessHandlers.unlinkStudent(canvasId, started), "#aa-students-count"));
  }
  if (button.dataset.startEditName) {
    accessHandlers.startEditName(button.dataset.startEditName);
    return;
  }
  if (button.hasAttribute("data-cancel-edit-name")) {
    accessHandlers.cancelEditName();
    return;
  }
  if (button.dataset.restore) return busy(button, () => restorePublication(button.dataset.restore));
  // Atualizar notas: mostrar ou ocultar as atividades sem notas preenchidas (o botão tem id: o foco continua nele).
  if (button.hasAttribute("data-import-unfilled")) {
    if (state.preview && !shownUnfilled.delete(state.preview)) shownUnfilled.add(state.preview);
    render();
    return;
  }
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
      state.canvasActivityFilter = "all";
      state.studentQuery = "";
      state.studentResults = null;
      state.studentSearchError = "";
      state.studentSearchLoading = false;
      state.editingStudentId = null;
      if (state.view === "access" && admin()) await accessHandlers.loadAccess();
      else {
        state.view = "overview";
        await loadReport();
      }
    });
  if (target.id === "canvas-activity-filter") { state.canvasActivityFilter = target.value; render(); }
  if (target.id === "student-sort") { state.sort = target.value; render(); }
  if (["fb-filter-status", "fb-filter-type", "fb-filter-cohort"].includes(target.id)) {
    busy(null, () => adminFeedbackHandlers.setFilter(target.id.slice("fb-filter-".length), target.value));
  }
  // Expansão 9: a escolha fica no feedback aberto e o render liga Salvar status (ou o para, de volta ao status atual).
  if (target.id === "fb-status-select") {
    const item = state.adminFeedback.items.find((f) => f.id === state.adminFeedback.selectedId);
    if (item) statusPicks.set(item, target.value);
    render();
  }
  if (target.name === "fb-type") state.feedbackDraft.type = target.value;
  if (target.name === "fb-type") settleFeedbackProblem("type");
  if (target.id === "acknowledge-removed") importHandlers.setAcknowledgeRemoved(target.checked);
  if (target.id === "class-status-filter") {
    state.classFilter = target.value;
    render();
  }
  if (target.id === "requests-filter") {
    accessHandlers.setRequestsFilter(target.value);
  }
  if (target.name === "cohort" && target.closest(".approve-form")) {
    if (approvePicks.owner !== state.me?.email) approvePicks = { owner: state.me?.email, picks: {} };
    // A escolha é deste pedido; "Selecione uma turma" a desfaz. O render libera ou para Vincular (o foco volta ao seletor).
    const user = target.closest(".approve-form").dataset.user;
    if (target.value) approvePicks.picks[user] = target.value;
    else delete approvePicks.picks[user];
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
    // Marcada ou desmarcada entre as sem notas, a lista continua aberta (não some com o foco).
    if (state.preview && target.closest("#timp-unfilled")) shownUnfilled.add(state.preview);
    importHandlers.toggleActivity(target.dataset.activity, target.checked);
  }
  if (target.id === "csv-file") busy(null, () => pickCsv(target.files[0]));
});
document.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "fb-title" || id === "fb-description") {
    // Guarda o texto sem renderizar de novo (não tira o foco); só atualiza o contador.
    const key = id === "fb-title" ? "title" : "description";
    state.feedbackDraft[key] = event.target.value;
    const count = $(`#${id}-count`);
    if (count) count.textContent = `${event.target.value.length}/${key === "title" ? TITLE_MAX : DESCRIPTION_MAX}`;
    settleFeedbackProblem(key);
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
// Feedback do aluno: ao focar um campo de texto, o navegador só rola até o cursor; a descrição, mais alta, podia ficar com
// a borda de baixo atrás da barra inferior do celular. Quando o foco chega pelo Tab, o campo inteiro fica à vista (o recuo
// de rolagem da raiz desconta a barra). Só no Tab: clique e foco devolvido pelo render não rolam a tela.
document.addEventListener("keyup", (event) => {
  const field = event.target;
  if (event.key === "Tab" && field.id === "fb-description" && field.closest(".student-feedback")) field.scrollIntoView({ block: "nearest" });
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.studentView) return;
  const form = event.target;
  busy(
    form.querySelector('button[type="submit"], button:not([type])'),
    async () => {
      if (form.id === "feedback-form") {
        await submitFeedback();
      } else if (form.id === "focus-form") {
        await saveFocus();
      } else if (form.id === "import-form") {
        await checkImport();
      } else if (form.id === "cohort-form") {
        // Os campos são lidos antes do andamento (o render recria o formulário).
        const body = Object.fromEntries(new FormData(form)), code = String(body.code || "").trim().toUpperCase(), owner = state.me?.email;
        await accessOperation({ kind: "create", target: code }, async (started) => {
          started();
          await api.cohorts.create(body);
          await boot();
          if (state.me?.email === owner) notice(`Turma ${code} criada.`);
        }, "#aa-create-title");
      } else if (form.id === "cohort-settings-form") {
        const data = new FormData(form);
        const kc = Number(data.get("kc")), lab = Number(data.get("lab"));
        const canvasCourseId = data.get("canvasCourseId").trim() || null, autoSync = data.get("autoSync") === "on", code = state.code, owner = state.me?.email;
        await accessOperation({ kind: "settings", target: code }, async (started) => {
          started();
          await api.cohorts.saveSettings(code, { thresholds: { kc, lab }, canvasCourseId, autoSync });
          await boot();
          if (state.me?.email === owner) notice("Configurações da turma atualizadas.");
        }, "#aa-settings-title");
      } else if (form.id === "student-search-form") {
        await searchAccessStudents(() => accessHandlers.submitStudentSearch(form));
      } else if (form.dataset.editNameForm) {
        const canvasId = form.dataset.editNameForm;
        await accessOperation({ kind: "rename", target: canvasId }, (started) => accessHandlers.saveDisplayName(form, started), "#aa-students-count");
      } else if (form.classList.contains("approve-form")) {
        const userId = form.dataset.user, cohort = String(new FormData(form).get("cohort") || "");
        if (!approvable(userId, cohort)) return;
        await accessOperation({ kind: "approve", target: userId, cohort }, (started) => accessHandlers.approveInstructor(userId, cohort, started), "#aa-requests-title");
      } else if (form.id === "signup-email-form") {
        // O foco fica no campo durante o envio e depois dele, com erro ou falha.
        form.elements.email.focus();
        await signupConfirmationHandlers.requestCode(form.elements.email.value);
      } else if (form.id === "signup-code-form") {
        // O código vai direto ao handler e sai do campo a cada tentativa, inclusive com erro.
        const input = form.elements.code, code = input.value;
        input.value = "";
        input.focus();
        await signupConfirmationHandlers.confirm(code);
      }
    },
  );
});

async function start() {
  try {
    // Relativa ao módulo: numa release em releases/<id>/ cada versão lê a própria config
    // (contrato em .github/scripts/frontend_release.py). No dist plano continua sendo /config.json.
    config = await fetch(new URL("./config.json", import.meta.url), { cache: "no-store" }).then((r) =>
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
      publicPage();
    }
  } catch (err) {
    state.classReport = null;
    if (state.me) render();
    else publicPage();
    notice(err.message || "Não foi possível carregar o portal.", true);
  }
}
start();

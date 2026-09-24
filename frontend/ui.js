// Estado compartilhado e helpers de apresentação usados por várias páginas.
// Mantido separado de app.js (controlador: boot, rotas de API, eventos do DOM).
export const $ = (selector) => document.querySelector(selector);
export const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// Busca sem distinção de maiúsculas e acentos ("Joao" encontra "João").
export const normalize = (value) =>
  String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
export const percent = (value) =>
  value == null
    ? "—"
    : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const date = (value) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Ainda não publicada";
export const labels = {
  ok: "Médias na referência",
  attention: "Atenção",
  critical: "Crítico",
  graduated: "Graduado",
  insufficient: "Sem avaliação completa",
  pending: "Sem nota",
  completed: "Com nota",
  unreleased: "Não liberada",
  exempt: "Dispensada",
};
export const badge = (status) =>
  `<span class="badge ${e(status)}">${e(labels[status] || status)}</span>`;
// Rótulo do aluno para attention/critical: "Crítico" soa punitivo para quem não fez nada
// de errado (atividade liberada sem nota já conta como 0%). O instrutor continua vendo
// badge(s.status) com os rótulos originais.
export function studentStatusLabel(s, thresholds = { kc: 70, lab: 95 }) {
  if (s.status !== "attention" && s.status !== "critical") return labels[s.status] || s.status;
  const kcBelow = s.kc != null && s.kc < thresholds.kc;
  const labBelow = s.lab != null && s.lab < thresholds.lab;
  if (kcBelow && labBelow) return "Foque em KCs e LABs";
  if (labBelow) return "Foque nos LABs";
  if (kcBelow) return "Foque nos KCs";
  return labels[s.status];
}
export const studentBadge = (s, thresholds) =>
  `<span class="badge ${e(s.status)}">${e(studentStatusLabel(s, thresholds))}</span>`;
export const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    {
      grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
      book: '<path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3zM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5z"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
      users:
        '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
      external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      network:
        '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
      out: '<path d="M9 4H4v16h5m0-8h12m-4-4 4 4-4 4"/>',
    }[name] || ""
  }</svg>`;
export const demo =
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("demo");
// Ativado em 2026-09-24 para BRSA0267 (curso 4436) e BRSA0257 (curso 4413),
// as únicas turmas associadas em cohortCanvasCourses. Ver todo/02.
export const canvasLinksEnabled = true;

export let state = {
  me: null,
  cohorts: [],
  code: "",
  report: null,
  reportError: "",
  bootError: "",
  pendingError: "",
  sender: null,
  senderError: "",
  senderLoading: false,
  sort: "name",
  teacherFilters: null,
  acknowledgeRemoved: false,
  importLoading: false,
  view: "overview",
  activityKind: "all",
  activityModule: "all",
  activityOverviewKind: "all",
  activityOverviewModule: "all",
  activityOverviewSort: "name",
  focusDraft: null,
  filter: "all",
  search: "",
  requests: [],
  instructors: [],
  preview: null,
  csv: "",
  filename: "",
  dirty: false,
  accessLoading: false,
  accessError: "",
  requestsFilter: "pending",
  studentQuery: "",
  studentResults: null,
  studentSearchError: "",
  studentSearchLoading: false,
  editingStudentId: null,
  pendingPreview: null,
  pendingStudentId: "",
  batchIds: [],
  batchPreview: null,
  batchError: "",
  batchResults: null,
  classReport: null,
  classFilter: "all",
  classSearch: "",
};

export function errorPanel(message, action) {
  return `<section class="panel empty" role="alert"><h2>Não foi possível carregar</h2><p>${e(message)}</p><button class="button primary" data-action="${action}">Tentar novamente</button></section>`;
}

export function updateInfo() {
  const r = state.report;
  if (!r?.publication) return "";
  const source = r.updateKind === "canvas"
    ? "<p>Notas trazidas automaticamente do Canvas. O portal atualiza às 6h e às 18h; uma correção feita no Canvas aparece aqui na atualização seguinte.</p>"
    : "<p>As notas mudam quando o instrutor publica uma atualização. Entregas e correções são feitas no Canvas.</p>";
  return `<section class="update-line" aria-label="Atualização das notas"><div><strong>Última atualização das notas: ${date(r.updatedAt || r.publication.publishedAt)}</strong>${r.updateKind === "restore" ? `<p>Versão restaurada. Notas originalmente publicadas em ${date(r.publication.publishedAt)}.</p>` : ""}${source}${canvasSyncStatus(r.canvasSync)}</div><button class="button secondary" data-action="refresh-report">Consultar atualização</button></section>`;
}

// Só o relatório do instrutor traz canvasSync (backend/portal.py); o aluno não vê falhas técnicas.
function canvasSyncStatus(sync) {
  if (!sync) return "";
  if (sync.status === "failed")
    return `<p class="sync-failed" role="status">A atualização automática pelo Canvas falhou em ${date(sync.at)}: ${e(sync.message)} As notas exibidas são da última publicação bem-sucedida.</p>`;
  return `<p class="small">Última verificação no Canvas: ${date(sync.at)} · ${sync.status === "unchanged" ? "sem mudanças" : e(sync.message)}</p>`;
}

export function gradingHelp(thresholds = { kc: 70, lab: 95 }) {
  return `<details class="grading-help"><summary>Como interpretar minhas notas?</summary><p>Uma atividade sem nota registrada pode estar aguardando entrega ou correção. O portal não confirma a entrega.</p><p>Atividades liberadas sem nota contam como zero na média. Uma nota zero registrada conta como avaliada. Atividades dispensadas ou não liberadas ficam fora do cálculo.</p><p>As referências são ${thresholds.kc}% em KCs e ${thresholds.lab}% em LABs. Estar na referência não significa que todas as atividades tenham nota.</p></details>`;
}

export function current() {
  return state.cohorts.find((c) => c.code === state.code);
}
export function teacher() {
  return !!current()?.canTeach;
}
export function admin() {
  return state.me?.roles.includes("admin");
}
export function roleLabel() {
  return admin()
    ? "Administrador e instrutor"
    : state.me?.roles.includes("instructor")
      ? "Instrutor"
      : "Aluno";
}
export function sessionContext() {
  return state.me
    ? `<div class="session-context"><span class="role-chip">${e(roleLabel())}</span><small>${e(state.me.email)}</small></div>`
    : "";
}
export function pageLabel() {
  return (
    {
      overview: teacher() ? "Painel do instrutor" : "Meu desempenho",
      activities: "Minhas atividades",
      "student-pending": "Pendências do aluno",
      "reminders-batch": "Lembretes em lote",
      "activity-overview": "Visão por atividade",
      history: teacher() ? "Publicações da turma" : "Meu histórico",
      import: "Atualizar notas",
      access: "Turmas e acessos",
      reminders: "Lembretes",
    }[state.view] || "Meu painel"
  );
}
export function nav(id, label, symbol) {
  return `<button class="nav-item ${state.view === id ? "active" : ""}" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${icon(symbol)}${label}</button>`;
}

export function heading(kicker, title, subtitle, action = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
export function metric(label, value, caption, kind = "") {
  return `<article class="metric ${kind}"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`;
}

export function personalChanges(changes) {
  if (!changes) return '<p class="small">Primeira publicação disponível para comparação.</p>';
  const delta = (n) => n == null ? "sem comparação" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("pt-BR")} pontos percentuais`;
  return `<p>KCs: ${delta(changes.kc)} · LABs: ${delta(changes.lab)}</p><p>Atividades sem nota: ${e(changes.pendingBefore)} → ${e(changes.pendingAfter)}.</p>${changes.activities?.length || changes.removed?.length ? `<details><summary>Ver atividades que mudaram</summary><ul>${(changes.activities || []).map((a) => `<li><strong>${e(a.name)}</strong>: ${a.previousState ? `${e(labels[a.previousState])} ${percent(a.before)}` : "Adicionada"} → ${e(labels[a.state])} ${percent(a.after)}</li>`).join("")}${(changes.removed || []).map((name) => `<li>${e(name)}: removida desta publicação.</li>`).join("")}</ul></details>` : '<p class="small">Nenhuma alteração nas atividades.</p>'}`;
}

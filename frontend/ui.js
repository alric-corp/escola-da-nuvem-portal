// Helpers de apresentação usados por várias páginas (HTML, formatação, ícones, navegação visual).
// O estado compartilhado fica em state.js, a rede em api.js; app.js orquestra boot, eventos do DOM
// e navegação.
import { state } from "./state.js";

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
// Percentual nas telas do próprio aluno: no máximo 1 casa decimal, sem zero à direita
// (56,67% -> 56,7%; 70,00% -> 70%). Só a exibição arredonda; toda regra acadêmica (referência
// atingida, quanto falta) continua usando o valor bruto sem arredondar.
export const percentStudent = (value) =>
  value == null
    ? "—"
    : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
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
// "1 aluno" / "2 alunos": concordância real em vez de "aluno(s)".
export const plural = (n, one, many) => `${Number(n).toLocaleString("pt-BR")} ${Number(n) === 1 ? one : many}`;

// Indicador de média do aluno (KC ou LAB) com a referência da turma. Abaixo da referência
// mostra quanto falta, calculado dos valores reais, em âmbar (progresso, não erro). Usa o
// valor sem arredondar para decidir, como o backend (grades.summary).
export function goalIndicator(label, value, reference, pending, unit) {
  const reached = value != null && value >= reference;
  const gap = value == null ? null : reference - value;
  const shown = gap == null ? null : Math.round(gap * 100) / 100;
  const status = value == null
    ? "Ainda sem atividades avaliadas"
    : reached
      ? "Referência atingida"
      : gap < 0.01
        ? "Falta menos de 0,01 ponto para a referência"
        // Em português, com decimais o singular vai até antes de 2 ("falta 1,5 ponto").
        : `${shown < 2 ? "Falta" : "Faltam"} ${shown.toLocaleString("pt-BR")} ${shown < 2 ? "ponto" : "pontos"} para a referência`;
  const tone = value == null ? "neutral" : reached ? "reached" : "below";
  const fill = Math.max(0, Math.min(100, Number(value) || 0));
  return `<article class="goal goal-${tone} goal-${unit.toLowerCase()}"><span class="goal-label">${label}</span><strong>${percentStudent(value)}</strong>
  <div class="goal-bar" aria-hidden="true"><i style="width:${fill}%"></i><b style="left:${reference}%"></b></div>
  <p class="goal-reference">Referência: ${reference}%</p><p class="goal-status">${status}</p>${pending ? `<p class="goal-note">${plural(pending, `${unit} sem nota conta`, `${unit}s sem nota contam`)} como 0%</p>` : ""}</article>`;
}
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
      message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8m-8 3h5"/>',
      inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    }[name] || ""
  }</svg>`;
export const demo =
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("demo");
// Chave geral dos links "Abrir no Canvas" (todo/02). Os links vêm do catálogo do curso da
// turma, lido pela API do Canvas (todo/12).
export const canvasLinksEnabled = true;

export function errorPanel(message, action) {
  return `<section class="panel empty" role="alert"><h2>Não foi possível carregar</h2><p>${e(message)}</p><button class="button primary" data-action="${action}">Tentar novamente</button></section>`;
}

export function notice(message, error = false) {
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

// Horários da atualização automática pelo Canvas, em horário de Brasília. Espelha o
// agendamento do Terraform (infra/terraform/canvas-sync.tf, cron(0 6,18 * * ? *) em
// America/Sao_Paulo); a API não expõe o horário, então mude os dois juntos.
export const canvasSyncHours = [6, 18];
export const canvasTimeZone = "America/Sao_Paulo";
const syncZone = canvasTimeZone;

// Próximo horário de verificação a partir de agora, como "hoje às 18h" / "amanhã às 6h".
export function nextCanvasSync(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: syncZone, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, Number(p.value)]));
  const minutes = parts.hour * 60 + parts.minute;
  const hour = canvasSyncHours.find((h) => h * 60 > minutes);
  return hour === undefined ? `amanhã às ${canvasSyncHours[0]}h` : `hoje às ${hour}h`;
}

const syncSchedule = () => `às ${canvasSyncHours.map((h) => `${h}h`).join(" e às ")} (horário de Brasília)`;

export function updateInfo() {
  const r = state.report;
  if (!r?.publication) return "";
  const auto = !!current()?.autoSync;
  const instructor = teacher();
  const restored = r.updateKind === "restore" ? `<p>Versão restaurada. Notas originalmente publicadas em ${date(r.publication.publishedAt)}.</p>` : "";
  if (!auto) {
    const source = instructor
      ? "<p>Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado em Atualizar notas.</p>"
      : "<p>As notas mudam quando a equipe publica uma atualização. Entregas e correções são feitas no Canvas.</p>";
    // Sem autoSync, um SYNC antigo (de quando a sincronização estava ligada) não é mostrado.
    return `<section class="update-line" aria-label="Atualização das notas"><div><strong>Última atualização das notas: ${date(r.updatedAt || r.publication.publishedAt)}</strong>${restored}${source}</div><button class="button secondary" data-action="refresh-report">Consultar atualização</button></section>`;
  }
  // "Última atualização" é quando as notas mudaram (updatedAt); a última verificação no
  // Canvas (canvasSync) só vem no relatório do instrutor.
  return `<section class="update-line" aria-label="Atualização das notas"><div><strong>Atualizado automaticamente do Canvas ${syncSchedule()}</strong>
  <dl class="sync-times"><div><dt>Última mudança nas notas</dt><dd>${date(r.updatedAt || r.publication.publishedAt)}</dd></div>${instructor && r.canvasSync ? `<div><dt>Última verificação</dt><dd>${date(r.canvasSync.at)}${r.canvasSync.status === "unchanged" ? " · sem mudanças" : ""}</dd></div>` : ""}<div><dt>Próxima verificação</dt><dd>${nextCanvasSync()}</dd></div></dl>
  ${restored}${instructor ? "" : "<p>Uma correção feita no Canvas aparece aqui na verificação seguinte.</p>"}${r.canvasSync?.status === "failed" ? canvasSyncStatus(r.canvasSync) : ""}</div><button class="button secondary" data-action="refresh-report">Consultar atualização</button></section>`;
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
  // Na visualização como aluno o admin vê exatamente as telas do aluno.
  return !state.studentView && !!current()?.canTeach;
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
  if (state.me && state.studentView)
    return `<div class="session-context"><span class="role-chip">${e(roleLabel())}</span><small>Admin: ${e(state.me.email).replace("@", "@<wbr>")}</small><small class="viewing-as">Visualizando: ${e(state.studentView.name || "carregando…")}</small></div>`;
  return state.me
    ? `<div class="session-context"><span class="role-chip">${e(roleLabel())}</span><small>${e(state.me.email).replace("@", "@<wbr>")}</small></div>`
    : "";
}
// Faixa fixa enquanto o admin visualiza a conta de um aluno: deixa claro quem é quem e como sair.
export function studentViewBanner() {
  if (!state.studentView) return "";
  return `<section class="student-view-banner" role="region" aria-label="Visualização como aluno"><div><strong>Visualizando como: ${e(state.studentView.name || "carregando…")}</strong><small>Modo administrador · somente leitura</small></div><button class="button secondary" data-action="exit-student-view">Sair da visualização</button></section>`;
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
      feedback: "Feedback",
      "admin-feedback": "Feedbacks",
    }[state.view] || "Meu painel"
  );
}
// No celular o menu vira barra inferior: aparece o rótulo curto, e o nome completo continua
// sendo o nome acessível do botão (visualmente oculto, não removido).
export function nav(id, label, symbol, short = label) {
  return `<button class="nav-item ${state.view === id ? "active" : ""}" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${icon(symbol)}<span class="nav-label">${label}</span><span class="nav-short" aria-hidden="true">${short}</span></button>`;
}

// kicker: rótulo maiúsculo opcional acima do h1. O contexto da turma já aparece fixo no
// topo (topline); o kicker só entra quando adiciona algo que o h1 e o .topline não dizem.
export function heading(kicker, title, subtitle, action = "") {
  return `<div class="page-heading"><div>${kicker ? `<span class="eyebrow">${kicker}</span>` : ""}<h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${action}</div>`;
}
export function metric(label, value, caption, kind = "") {
  return `<article class="metric ${kind}"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`;
}
export function personalChanges(changes) {
  if (!changes) return '<p class="small">Primeira publicação disponível para comparação.</p>';
  const delta = (n) => n == null ? "sem comparação" : `${n > 0 ? "+" : ""}${Number(n).toLocaleString("pt-BR")} pontos percentuais`;
  return `<p>KCs: ${delta(changes.kc)} · LABs: ${delta(changes.lab)}</p><p>Atividades sem nota: ${e(changes.pendingBefore)} → ${e(changes.pendingAfter)}.</p>${changes.activities?.length || changes.removed?.length ? `<details><summary>Ver atividades que mudaram</summary><ul>${(changes.activities || []).map((a) => `<li><strong>${e(a.name)}</strong>: ${a.previousState ? `${e(labels[a.previousState])} ${percentStudent(a.before)}` : "Adicionada"} → ${e(labels[a.state])} ${percentStudent(a.after)}</li>`).join("")}${(changes.removed || []).map((name) => `<li>${e(name)}: removida desta publicação.</li>`).join("")}</ul></details>` : '<p class="small">Nenhuma alteração nas atividades.</p>'}`;
}

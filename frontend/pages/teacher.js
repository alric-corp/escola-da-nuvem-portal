import { current, demo, e, formatOperationalDate, heading, icon, labels, normalize, plural, updateInfo } from "../ui.js";
import { state } from "../state.js";
import { isWithdrawn } from "../participation.js";

// Painel do instrutor (Expansão 4, docs/design-visual.md): instrumento de acompanhamento da turma. Situação da turma
// (contagens que também filtram a lista), Foco da turma e a tabela de desempenho, na seção 34 do CSS (.teacher-home).
// Engajamento acrescenta informação auxiliar; os critérios acadêmicos e as ações existentes são preservados.

const thresholdsOf = (report) => ({ kc: report.thresholds?.kc ?? 70, lab: report.thresholds?.lab ?? 95 });
const WEEK = 7 * 86400000;
const DAY = 86400000;
const studentNames = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function canvasTimestamp(value) {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const day = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
  const at = Date.parse(value);
  return Number.isFinite(at) && day.getUTCMonth() === +parts[2] - 1 && day.getUTCDate() === +parts[3] ? at : null;
}

export function canvasTimeText(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Sem informação";
  if (value > 0 && value < 60) return "<1min";
  const minutes = Math.floor(value / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours.toLocaleString("pt-BR")}h ${minutes % 60}min` : `${minutes}min`;
}

export function canvasDateText(value, includeTime = false) {
  const at = canvasTimestamp(value);
  return at === null ? "Sem informação" : formatOperationalDate(new Date(at), includeTime ? "dateTime" : "shortDate");
}

export function canvasActivityStatus(row, at = Date.now()) {
  const last = canvasTimestamp(row.canvasActivity?.lastActivityAt);
  if (last === null || last > at) return "unknown";
  return at - last >= WEEK ? "inactive" : "recent";
}

// A coleta global não prova que cada campo foi observado. Valores legados continuam úteis,
// mas só provenance.current com data própria válida pode identificar uma observação atual.
export function canvasFieldObservation(row, field, at = Date.now()) {
  const activity = row.canvasActivity, value = activity?.[field];
  const valid = field === "totalActivityTime"
    ? typeof value === "number" && Number.isFinite(value) && value >= 0
    : canvasTimestamp(value) !== null && canvasTimestamp(value) <= at;
  const metadata = activity?.provenance?.[field];
  const timestamp = (v) => { const n = canvasTimestamp(v); return n !== null && n <= at ? n : null; };
  const observedAt = timestamp(metadata?.observedAt);
  const legacy = !metadata || metadata.reason === "legacy";
  const referenceAt = timestamp(metadata?.referenceAt) ?? (legacy ? timestamp(activity?.collectedAt) : null);
  const status = !valid ? "unknown" : metadata?.status === "current" && observedAt !== null ? "current" : "retained";
  const ageFrom = observedAt ?? referenceAt;
  return { value, valid, status, observedAt, referenceAt, legacy,
    stale: valid && ageFrom !== null && at - ageFrom > DAY };
}

export function canvasEngagementSummary(rows, at = Date.now()) {
  const active = rows.filter((r) => !isWithdrawn(r));
  const fields = Object.fromEntries(["totalActivityTime", "lastActivityAt"].map((field) => [field,
    active.map((row) => canvasFieldObservation(row, field, at))]));
  const times = fields.totalActivityTime.filter((f) => f.valid).map((f) => f.value).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const median = !times.length ? null : times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
  const count = (kind) => active.filter((r) => canvasActivityStatus(r, at) === kind).length;
  const coverage = Object.fromEntries(Object.entries(fields).map(([field, observations]) => [field, {
    known: observations.filter((f) => f.valid).length,
    current: observations.filter((f) => f.status === "current").length,
    retained: observations.filter((f) => f.valid && f.status === "retained").length,
    unknown: observations.filter((f) => !f.valid).length,
    stale: observations.filter((f) => f.stale).length,
    legacy: observations.filter((f) => f.valid && f.legacy).length,
  }]));
  return { median, recent: count("recent"), inactive: count("inactive"), unknown: count("unknown"),
    timeKnown: times.length, active: active.length, coverage };
}

function canvasEngagement(report) {
  const stats = canvasEngagementSummary(report.students || []), meta = report.canvasEngagement;
  const collected = canvasTimestamp(meta?.collectedAt), attempted = canvasTimestamp(meta?.attemptedAt);
  const known = stats.timeKnown || stats.recent || stats.inactive;
  const time = stats.coverage.totalActivityTime, last = stats.coverage.lastActivityAt;
  const population = plural(stats.active, "aluno ativo", "alunos ativos");
  const quality = meta?.status === "failed" ? "A última tentativa de coletar atividade falhou. Dados anteriores podem continuar visíveis."
    : meta?.status === "partial" ? "Coleta de atividade parcial; a cobertura de cada campo está indicada abaixo." : "";
  const retained = time.retained || last.retained
    ? `<span>Valores preservados: tempo de ${time.retained} e última atividade de ${last.retained} ${last.retained === 1 ? "aluno" : "alunos"}.</span>` : "";
  const dated = attempted !== null ? `Última tentativa de atividade: <time datetime="${e(meta.attemptedAt)}">${canvasDateText(meta.attemptedAt, true)}</time> (Brasília).`
    : collected !== null ? `Referência da coleta legada: <time datetime="${e(meta.collectedAt)}">${canvasDateText(meta.collectedAt, true)}</time> (Brasília); não comprova observação de cada campo.`
      : "Coleta ainda não disponível.";
  const stale = time.stale || last.stale || ((time.legacy || last.legacy) && collected !== null && Date.now() - collected > DAY)
    ? "Coleta desatualizada em parte dos dados. As contagens usam a última observação disponível; a coleta antiga não comprova ausência de atividade após a coleta." : "";
  return `<section class="tp-engagement" aria-labelledby="canvas-engagement-title"><h2 id="canvas-engagement-title">Engajamento no Canvas</h2>
    <p class="tp-engagement-note">Atividade registrada e acumulada no curso; não representa necessariamente tempo de estudo efetivo.</p>
    ${quality ? `<p class="tp-engagement-quality" role="status">${quality}</p>` : ""}
    ${known ? `<dl class="tp-engagement-stats"><div><dt>Tempo mediano registrado no Canvas</dt><dd>${canvasTimeText(stats.median)}<small>Mediana de ${time.known} de ${population} com tempo válido</small></dd></div><div><dt>Com última atividade conhecida nos últimos 7 dias</dt><dd>${stats.recent}</dd></div><div><dt>Última atividade conhecida há 7+ dias</dt><dd>${stats.inactive}</dd></div></dl>
      <p class="tp-engagement-meta">Cobertura de última atividade: ${last.known} de ${population}. ${stats.unknown ? `${plural(stats.unknown, "aluno ativo sem informação de última atividade", "alunos ativos sem informação de última atividade")}.` : ""}</p>`
    : `<p class="tp-engagement-empty">O Canvas ainda não disponibilizou dados de atividade para os alunos ativos.</p><p class="tp-engagement-meta">Cobertura: tempo válido de 0 de ${population}; última atividade conhecida de 0 de ${stats.active}.</p>`}
    <p class="tp-engagement-meta">${dated} ${retained} ${stale ? `<span>${stale}</span>` : ""}${time.legacy || last.legacy ? " <span>Há valores legados sem rastreio de coleta por campo.</span>" : ""}</p></section>`;
}

// Média com uma casa, como o aluno vê em "Meu desempenho"; duas quando uma casa mostraria a referência (ou mais) para
// quem está abaixo dela (94,96% não vira "95%"). A situação continua vindo do backend; o número só é exibido.
export function averageText(value, reference) {
  if (value == null) return "—";
  const one = Math.round(value * 10) / 10;
  const digits = value < reference && one >= reference ? 2 : 1;
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

// Atividades do foco com as contagens da turma (alunos ativos, do backend): ajudam a decidir se ainda vale manter.
// view.focus (app.js): { kind: "saving" | "saved" | "error", message, unsure } do último salvamento deste relatório. Com
// unsure (rede, 5xx), a gravação pode ter acontecido (C1): a seção diz isso e o que cada caminho faz com o que não foi salvo.
const UNSURE_FOCUS = "A alteração pode ter sido salva. “Consultar atualização” mostra o foco em vigor, mas descarta as escolhas ainda não salvas; salvar de novo não grava duas vezes: se a alteração já tiver sido salva, o portal recusa a repetição.";
export function focusEditor(view = {}) {
  if (!state.report.publication) return "";
  const ids = state.focusDraft || state.report.focus?.activityIds || [];
  const saved = state.report.focus?.activityIds || [];
  const activities = state.report.activities || [];
  const outcome = view.focus || null, saving = outcome?.kind === "saving";
  const changed = !!state.focusDraft && (ids.length !== saved.length || ids.some((id, i) => id !== saved[i]));
  const item = (id) => {
    const a = activities.find((x) => x.id === id), name = a?.name || id;
    const counts = a ? [plural(a.pending, "aluno sem nota", "alunos sem nota"), plural(a.needsReview, "em revisão", "em revisão")].join(" · ") : "";
    return `<li><span class="tp-focus-item">${a ? `<span class="tp-kind is-${a.kind === "lab" ? "lab" : "kc"}">${a.kind === "lab" ? "LAB" : "KC"}</span>` : ""}<span class="tp-focus-name">${e(name)}</span>${counts ? `<span class="tp-focus-meta">${counts}</span>` : ""}</span><button class="text-link tp-remove" type="button" data-remove-focus="${e(id)}" aria-label="Remover ${e(name)} do foco" ${demo || saving ? "disabled" : ""}>Remover</button></li>`;
  };
  const status = saving ? `<p class="tp-focus-status" id="tp-focus-status" role="status" tabindex="-1">Salvando o foco da turma…</p>`
    : outcome?.kind === "saved" && !changed ? `<p class="tp-focus-status is-saved" id="tp-focus-status" role="status" tabindex="-1">${e(outcome.message)}</p>`
    : outcome?.kind === "error" ? `<p class="tp-focus-status is-error" id="tp-focus-status" role="alert" tabindex="-1"><strong>${outcome.unsure ? "Não foi possível confirmar a atualização do foco da turma." : "O foco não foi salvo."}</strong> <span>${e(outcome.message)}</span>${outcome.unsure ? ` <span>${UNSURE_FOCUS}</span>` : ""}</p>`
    : changed ? '<p class="tp-focus-status is-pending" id="tp-focus-status">Alterações ainda não salvas: os alunos continuam vendo o foco anterior.</p>' : "";
  return `<section class="tp-focus" aria-labelledby="tp-focus-title"><h2 id="tp-focus-title">Foco da turma</h2><p class="tp-focus-help">Até três atividades que o aluno vê primeiro quando estão sem nota ou com sugestão de revisão. A escolha vale para toda a turma e continua nas próximas publicações enquanto as atividades existirem e estiverem liberadas.</p>${ids.length
    ? `<ol class="focus-list">${ids.map(item).join("")}</ol>`
    : '<p class="tp-focus-empty">Nenhuma atividade no foco: o aluno vê até três atividades na ordem da publicação, primeiro as sem nota e depois as de revisão.</p>'}${status}<form id="focus-form" class="tp-focus-actions"><button class="button ${changed ? "primary" : "secondary"}" type="submit"${demo || !ids.length || saving ? " disabled" : ""}${status ? ' aria-describedby="tp-focus-status"' : ""}>Salvar foco da turma</button><button class="text-link" type="button" data-view="activity-overview">Escolher na visão por atividade</button></form></section>`;
}

// Desistentes só entram em Todos e em Desistentes; os demais filtros, Ativos inclusive, contam só ativos (um
// desistente não aparece como Crítico ou sem nota no painel).
function matchesFilter(r, filter) {
  if (filter === "all") return true;
  if (filter === "withdrawn") return isWithdrawn(r);
  if (isWithdrawn(r)) return false;
  return filter === "active" || r.status === filter || (filter === "missing-email" && !r.email) || (filter === "pending" && r.pending > 0) || (filter === "no-portal" && r.portalLinked === false);
}

// Alunos visíveis na tabela, com busca, filtro e ordenação ativos (usado também pelo CSV). Em Todos, os desistentes
// vêm depois dos ativos, cada grupo na ordenação escolhida.
export function filteredStudents() {
  const query = normalize(state.search);
  const rows = state.report.students || [];
  // O filtro Desistentes sem nenhum desistente na turma (ex.: restaurado ao voltar ao painel) vale como Todos.
  const filter = state.filter === "withdrawn" && !rows.some(isWithdrawn) ? "all" : state.filter;
  const activityFilter = state.canvasActivityFilter || "all", at = Date.now();
  const filtered = rows.filter((r) => matchesFilter(r, filter) && normalize(`${r.name} ${r.email || ""}`).includes(query)
    && (activityFilter === "all" || (!isWithdrawn(r) && canvasActivityStatus(r, at) === activityFilter)));
  return filtered.sort((a, b) => {
    if (isWithdrawn(a) !== isWithdrawn(b)) return isWithdrawn(a) ? 1 : -1;
    if (state.sort === "pending" && a.pending !== b.pending) return b.pending - a.pending;
    if (state.sort === "score" && a.total !== b.total) return (a.total ?? -1) - (b.total ?? -1);
    if (state.sort === "last-activity") {
      const left = canvasActivityStatus(a, at) === "unknown" ? null : canvasTimestamp(a.canvasActivity.lastActivityAt);
      const right = canvasActivityStatus(b, at) === "unknown" ? null : canvasTimestamp(b.canvasActivity.lastActivityAt);
      if (left !== right) return left === null ? 1 : right === null ? -1 : left - right;
    }
    return studentNames.compare(a.name, b.name);
  });
}

// Uma célula iniciada por = + - @ seria interpretada como fórmula pelo Excel/Sheets.
const csvCell = (value) => {
  const text = String(value ?? "");
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};

// Engajamento é acrescentado após as dez colunas existentes; Situação continua sendo a acadêmica.
export function studentsCsv(rows) {
  const header = ["Nome", "E-mail", "Média KC (%)", "Média LAB (%)", "Média geral (%)", "Com nota (%)", "Sem nota", "Situação", "Entrou no portal", "Participação", "Última atividade no Canvas (Brasília)", "Tempo no Canvas"];
  const lines = rows.map((r) => [r.name, r.email || "", r.kc ?? "", r.lab ?? "", r.total ?? "", r.progress ?? "", r.pending, labels[r.status] || r.status,
    r.portalLinked === undefined ? "" : r.portalLinked ? "Sim" : "Não", isWithdrawn(r) ? "Desistente" : "Ativo",
    canvasDateText(r.canvasActivity?.lastActivityAt, true), canvasTimeText(r.canvasActivity?.totalActivityTime)]);
  // BOM para o Excel reconhecer UTF-8 (acentos); ponto e vírgula é o separador que ele espera em pt-BR.
  return "﻿" + [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n");
}

// Atalho de filtro da Situação da turma: o número é o mesmo que a lista mostra ao escolher o filtro (sem busca), porque
// conta com a mesma regra (matchesFilter). Rótulo, número e legenda, nessa ordem, como nos cartões de antes (C7.2).
function filterButton(rows, filter, label, caption, kind) {
  const active = state.filter === filter, count = rows.filter((r) => matchesFilter(r, filter)).length;
  return `<button type="button" class="tp-filter is-${kind}" data-filter="${filter}" data-scroll-to="students-heading" aria-pressed="${active}"><span>${label}</span><strong>${count.toLocaleString("pt-BR")}</strong><small>${caption}</small></button>`;
}

// Situação da turma: quantos alunos ativos estão na referência, em atenção (uma média abaixo) e críticos (as duas), numa
// régua proporcional (decorativa: os números estão no texto); quem fica fora dessas três (sem avaliação completa,
// graduado) é dito com palavras. Acompanhamento: atividades sem nota e quem ainda não entrou no portal.
function overview(rows, t) {
  const active = rows.filter((r) => !isWithdrawn(r)), withdrawn = rows.length - active.length;
  const count = (status) => active.filter((r) => r.status === status).length;
  const others = [["insufficient", "sem avaliação completa", "sem avaliação completa"], ["graduated", "graduado", "graduados"]]
    .filter(([status]) => count(status)).map(([status, one, many]) => plural(count(status), one, many));
  const scale = [["ok", count("ok")], ["attention", count("attention")], ["critical", count("critical")], ["other", active.length - count("ok") - count("attention") - count("critical")]]
    .filter(([, n]) => n).map(([kind, n]) => `<i class="is-${kind}" style="flex-grow:${n}"></i>`).join("");
  const total = withdrawn ? filterButton(rows, "active", "Alunos ativos", plural(withdrawn, "desistente", "desistentes"), "total")
    : filterButton(rows, "all", "Alunos na publicação", "Ver todos os alunos", "total");
  return `<section class="tp-overview" aria-labelledby="tp-overview-title"><div class="tp-overview-head"><h2 id="tp-overview-title">Situação da turma</h2>${total}</div>
  ${active.length ? `<div class="tp-scale" aria-hidden="true">${scale}</div>` : ""}<div class="tp-statuses">${filterButton(rows, "ok", labels.ok, `KC ≥ ${t.kc}% e LAB ≥ ${t.lab}%`, "ok")}${filterButton(rows, "attention", labels.attention, "Uma média abaixo da referência", "attention")}${filterButton(rows, "critical", labels.critical, "As duas médias abaixo da referência", "critical")}</div>
  ${others.length ? `<p class="tp-others">Fora dessas situações: ${others.join(" e ")}.</p>` : ""}<div class="tp-follow"><h3 class="tp-follow-title">Acompanhamento</h3>${filterButton(rows, "pending", "Com atividades sem nota", "Ao menos uma atividade liberada sem nota", "pending")}${rows.some((r) => r.portalLinked !== undefined) ? filterButton(rows, "no-portal", "Ainda não entraram", "No portal: sem conta ou com e-mail diferente do Canvas", "portal") : ""}</div></section>`;
}

// Média numa célula: número, régua em miniatura com a marca da referência (decorativa) e, abaixo dela, o anel âmbar e o
// texto para leitura assistiva. A cor é a da série (KC branco, LAB violeta), nunca a da situação.
function averageCell(kind, label, value, reference) {
  const below = value != null && value < reference, fill = Math.max(0, Math.min(100, Number(value) || 0));
  return `<td role="cell" class="tp-avg is-${kind}${below ? " is-below" : ""}"><span class="tp-cell-label" aria-hidden="true">${label}</span><span class="tp-value">${averageText(value, reference)}${value == null ? '<span class="sr-only"> (sem média)</span>' : below ? `<span class="sr-only">, abaixo da referência de ${reference}%</span>` : ""}</span>${value == null ? "" : `<span class="tp-ruler" aria-hidden="true"><i style="width:${fill}%"></i><b style="left:${Math.max(0, Math.min(100, reference))}%"></b></span>`}</td>`;
}

// Uma linha: nome (cabeçalho da linha), médias, atividades sem nota, situação por texto e forma, e o detalhe do aluno.
// Abaixo de 46rem de largura o CSS empilha a linha; os rótulos visíveis das células só existem nesse modo.
function canvasCells(r) {
  const value = r.canvasActivity?.lastActivityAt, valid = canvasActivityStatus(r) !== "unknown";
  const last = valid ? `<time datetime="${e(value)}" title="${canvasDateText(value, true)} (Brasília)" aria-label="${canvasDateText(value, true)} (Brasília)">${canvasDateText(value)}<small>${formatOperationalDate(value, "clock")}</small></time>` : "Sem informação";
  const quality = (field) => {
    const observation = canvasFieldObservation(r, field);
    if (!observation.valid) return "";
    const label = observation.legacy ? "Rastreio legado" : observation.status === "retained" ? "Dado preservado" : observation.stale ? "Coleta desatualizada" : "";
    if (!label) return "";
    const at = observation.observedAt ?? observation.referenceAt;
    const description = at === null ? "Sem data de observação confirmada para este campo."
      : `${observation.observedAt !== null ? "Observado em" : "Referência legada de"} ${canvasDateText(new Date(at).toISOString(), true)} (Brasília).`;
    return `<small class="tp-data-quality" title="${e(description)}">${label}<span class="sr-only">. ${e(description)}</span></small>`;
  };
  return `<td role="cell" class="tp-last-activity"><span class="tp-cell-label" aria-hidden="true">Última atividade conhecida no Canvas</span>${last}${quality("lastActivityAt")}</td><td role="cell" class="tp-canvas-time"><span class="tp-cell-label" aria-hidden="true">Tempo no Canvas</span>${e(canvasTimeText(r.canvasActivity?.totalActivityTime))}${quality("totalActivityTime")}</td>`;
}

function studentRow(r, t) {
  const tags = [isWithdrawn(r) && '<span class="tp-tag">Desistente</span>', r.portalLinked === false && '<span class="tp-tag is-portal">Não entrou no portal</span>'].filter(Boolean).join("");
  return `<tr class="tp-row" role="row"><th scope="row" role="rowheader" class="tp-name"><span class="tp-student">${e(r.name)}</span><span class="tp-email${r.email ? "" : " is-missing"}">${r.email ? e(r.email).replace("@", "@<wbr>") : "E-mail ausente no Canvas"}</span>${tags ? `<span class="tp-tags">${tags}</span>` : ""}</th>${averageCell("kc", "Média KC", r.kc, t.kc)}${averageCell("lab", "Média LAB", r.lab, t.lab)}<td role="cell" class="tp-pending${r.pending ? "" : " is-zero"}"><span class="tp-cell-label" aria-hidden="true">Sem nota</span><span class="tp-value">${r.pending}</span></td><td role="cell" class="tp-status"><span class="tp-state is-${e(r.status)}">${e(labels[r.status] || r.status)}</span></td>${canvasCells(r)}<td role="cell" class="tp-action"><button type="button" class="text-link tp-details" data-student-pending="${e(r.id)}" aria-label="Ver pendências de ${e(r.name)}">Ver pendências</button></td></tr>`;
}

// Lista vazia por filtro ou busca: diz o que está limitando e oferece limpar (a mesma action do botão Limpar filtros).
function noMatch() {
  const term = state.search ? `para “${e(state.search)}”` : "";
  const filtered = state.filter !== "all" || (state.canvasActivityFilter || "all") !== "all";
  const text = term && filtered ? `${term} com o filtro escolhido` : term || "neste filtro";
  return `<div class="tp-empty" role="status"><p>Nenhum aluno encontrado ${text}.</p><button class="button secondary" type="button" data-action="clear-filters">Limpar busca e filtros</button></div>`;
}

// Carregamento e erro na composição do painel: o erro mantém o título da tela, como nas telas do aluno.
export function teacherHomeState(html, titled = false) {
  return `<div class="teacher-home">${titled ? heading("", `Painel da ${e(state.code)}`) : ""}${html}</div>`;
}

// Reused by the initial page and by list-only interactions; filters/CSV still use the whole report.
export function teacherStudentResults(filtered = filteredStudents()) {
  const rows = state.report.students || [], t = thresholdsOf(state.report);
  const shown = filtered.length === rows.length ? plural(rows.length, "aluno", "alunos") : `${filtered.length.toLocaleString("pt-BR")} de ${plural(rows.length, "aluno", "alunos")}`;
  const table = `<div class="tp-table"><table role="table"><caption class="sr-only">Alunos da turma ${e(state.code)}: médias, atividades sem nota, situação e atividade registrada no Canvas</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader" class="tp-name">Aluno</th><th scope="col" role="columnheader" class="tp-avg">Média KC <small>referência ${t.kc}%</small></th><th scope="col" role="columnheader" class="tp-avg">Média LAB <small>referência ${t.lab}%</small></th><th scope="col" role="columnheader" class="tp-pending">Sem nota</th><th scope="col" role="columnheader" class="tp-status">Situação</th><th scope="col" role="columnheader" class="tp-last-activity">Última atividade conhecida no Canvas <small>Horário de Brasília</small></th><th scope="col" role="columnheader" class="tp-canvas-time">Tempo no Canvas <small>Acumulado no curso</small></th><th scope="col" role="columnheader" class="tp-action"><span class="sr-only">Ação</span></th></tr></thead><tbody role="rowgroup">${filtered.map((r) => studentRow(r, t)).join("")}</tbody></table></div>`;
  return `<div class="tp-result"><p class="tp-count" role="status">${shown}</p>${state.filter === "pending" && filtered.length ? `<button class="button primary" data-action="reminders-batch" data-ids="${filtered.map((r) => e(r.id)).join(",")}">Enviar lembrete para ${plural(filtered.length, "aluno", "alunos")}</button>` : ""}</div>${filtered.length ? table : noMatch()}`;
}

export function teacherPage(view = {}) {
  const report = state.report,
    rows = report.students || [];
  const t = thresholdsOf(report);
  const withdrawn = rows.some(isWithdrawn);
  const filtered = filteredStudents();
  // Com atualização automática, o envio de CSV é só alternativa (antes do horário ou se a sincronização falhar).
  const auto = !!current()?.autoSync;
  const filterOptions = [["all", "Todos os status"], ...(withdrawn ? [["active", "Ativos"], ["withdrawn", "Desistentes"]] : []), ["missing-email", "Sem e-mail no Canvas"], ["pending", "Com atividades sem nota"], ["no-portal", "Ainda não entraram no portal"], ...Object.entries(labels).filter(([k]) => ["ok", "attention", "critical"].includes(k))];
  const sortOptions = [["name", "Nome A–Z"], ["pending", "Mais atividades sem nota"], ["score", "Menor média geral primeiro"], ["last-activity", "Última atividade mais antiga primeiro"]];
  return `<div class="teacher-home">${heading("", `Painel da ${e(state.code)}`, "", `<div class="tp-actions"><button class="button secondary" data-view="activity-overview">Ver por atividade</button><button class="button ${auto ? "secondary" : "primary"}" data-view="import">${icon("upload")} ${auto ? "Enviar CSV manualmente" : "Atualizar notas"}</button></div>`)}
  ${updateInfo()}${rows.length ? `<div class="tp-summary">${overview(rows, t)}${focusEditor(view)}</div>` : focusEditor(view)}
  ${canvasEngagement(report)}
  <section class="tp-students" aria-labelledby="students-heading"><h2 id="students-heading" tabindex="-1">Desempenho dos alunos</h2>${rows.length ? `<div class="tp-tools"><div class="tp-field tp-search"><label for="search">Buscar aluno</label><input id="search" type="search" placeholder="Nome ou e-mail" value="${e(state.search)}"></div><div class="tp-field"><label for="status-filter">Filtrar</label><select id="status-filter">${filterOptions.map(([id, label]) => `<option value="${id}" ${state.filter === id ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="tp-field"><label for="canvas-activity-filter">Atividade no Canvas</label><select id="canvas-activity-filter">${[["all", "Todas as atividades"], ["inactive", "Última atividade conhecida há 7+ dias"], ["recent", "Com atividade nos últimos 7 dias"], ["unknown", "Sem informação de atividade"]].map(([id, label]) => `<option value="${id}" ${(state.canvasActivityFilter || "all") === id ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="tp-field"><label for="student-sort">Ordenar por</label><select id="student-sort">${sortOptions.map(([value, label]) => `<option value="${value}" ${state.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="tp-tool-actions"><button class="button secondary" data-action="clear-filters">Limpar filtros</button><button class="button secondary" data-action="export-csv" ${filtered.length ? "" : "disabled"}>Exportar CSV (${filtered.length})</button></div></div>
  <div id="teacher-student-results" data-cohort="${e(state.code)}">${teacherStudentResults(filtered)}</div>` : '<div class="tp-empty is-start"><h3>A turma está pronta para começar.</h3><p>Importe o CSV do Canvas para publicar a primeira atualização.</p></div>'}</section></div>`;
}

import { current, demo, e, heading, icon, labels, normalize, plural, updateInfo } from "../ui.js";
import { state } from "../state.js";
import { isWithdrawn } from "../participation.js";

// Painel do instrutor (Expansão 4, docs/design-visual.md): instrumento de acompanhamento da turma. Situação da turma
// (contagens que também filtram a lista), Foco da turma e a tabela de desempenho, na seção 34 do CSS (.teacher-home).
// Contagens, filtros, ordenação, CSV, ids, data-* e ações são os de antes; só a composição e os textos de apoio mudam.

const thresholdsOf = (report) => ({ kc: report.thresholds?.kc ?? 70, lab: report.thresholds?.lab ?? 95 });

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
  const filtered = rows.filter((r) => matchesFilter(r, filter) && normalize(`${r.name} ${r.email || ""}`).includes(query));
  return filtered.sort((a, b) => {
    if (isWithdrawn(a) !== isWithdrawn(b)) return isWithdrawn(a) ? 1 : -1;
    if (state.sort === "pending" && a.pending !== b.pending) return b.pending - a.pending;
    if (state.sort === "score" && a.total !== b.total) return (a.total ?? -1) - (b.total ?? -1);
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}

// Uma célula iniciada por = + - @ seria interpretada como fórmula pelo Excel/Sheets.
const csvCell = (value) => {
  const text = String(value ?? "");
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};

// Participação vem sempre, no fim (as colunas anteriores não mudam de posição); Situação continua sendo a acadêmica.
export function studentsCsv(rows) {
  const header = ["Nome", "E-mail", "Média KC (%)", "Média LAB (%)", "Média geral (%)", "Com nota (%)", "Sem nota", "Situação", "Entrou no portal", "Participação"];
  const lines = rows.map((r) => [r.name, r.email || "", r.kc ?? "", r.lab ?? "", r.total ?? "", r.progress ?? "", r.pending, labels[r.status] || r.status,
    r.portalLinked === undefined ? "" : r.portalLinked ? "Sim" : "Não", isWithdrawn(r) ? "Desistente" : "Ativo"]);
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
function studentRow(r, t) {
  const tags = [isWithdrawn(r) && '<span class="tp-tag">Desistente</span>', r.portalLinked === false && '<span class="tp-tag is-portal">Não entrou no portal</span>'].filter(Boolean).join("");
  return `<tr class="tp-row" role="row"><th scope="row" role="rowheader" class="tp-name"><span class="tp-student">${e(r.name)}</span><span class="tp-email${r.email ? "" : " is-missing"}">${r.email ? e(r.email).replace("@", "@<wbr>") : "E-mail ausente no Canvas"}</span>${tags ? `<span class="tp-tags">${tags}</span>` : ""}</th>${averageCell("kc", "Média KC", r.kc, t.kc)}${averageCell("lab", "Média LAB", r.lab, t.lab)}<td role="cell" class="tp-pending${r.pending ? "" : " is-zero"}"><span class="tp-cell-label" aria-hidden="true">Sem nota</span><span class="tp-value">${r.pending}</span></td><td role="cell" class="tp-status"><span class="tp-state is-${e(r.status)}">${e(labels[r.status] || r.status)}</span></td><td role="cell" class="tp-action"><button type="button" class="text-link tp-details" data-student-pending="${e(r.id)}" aria-label="Ver pendências de ${e(r.name)}">Ver pendências</button></td></tr>`;
}

// Lista vazia por filtro ou busca: diz o que está limitando e oferece limpar (a mesma action do botão Limpar filtros).
function noMatch() {
  const term = state.search ? `para “${e(state.search)}”` : "";
  const filtered = state.filter !== "all";
  const text = term && filtered ? `${term} com o filtro escolhido` : term || "neste filtro";
  return `<div class="tp-empty" role="status"><p>Nenhum aluno encontrado ${text}.</p><button class="button secondary" type="button" data-action="clear-filters">Limpar busca e filtros</button></div>`;
}

// Carregamento e erro na composição do painel: o erro mantém o título da tela, como nas telas do aluno.
export function teacherHomeState(html, titled = false) {
  return `<div class="teacher-home">${titled ? heading("", `Painel da ${e(state.code)}`) : ""}${html}</div>`;
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
  const sortOptions = [["name", "Nome A–Z"], ["pending", "Mais atividades sem nota"], ["score", "Menor média geral primeiro"]];
  const shown = filtered.length === rows.length ? plural(rows.length, "aluno", "alunos") : `${filtered.length.toLocaleString("pt-BR")} de ${plural(rows.length, "aluno", "alunos")}`;
  const table = `<div class="tp-table"><table role="table"><caption class="sr-only">Alunos da turma ${e(state.code)}: médias, atividades sem nota e situação</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader" class="tp-name">Aluno</th><th scope="col" role="columnheader" class="tp-avg">Média KC <small>referência ${t.kc}%</small></th><th scope="col" role="columnheader" class="tp-avg">Média LAB <small>referência ${t.lab}%</small></th><th scope="col" role="columnheader" class="tp-pending">Sem nota</th><th scope="col" role="columnheader" class="tp-status">Situação</th><th scope="col" role="columnheader" class="tp-action"><span class="sr-only">Ação</span></th></tr></thead><tbody role="rowgroup">${filtered.map((r) => studentRow(r, t)).join("")}</tbody></table></div>`;
  return `<div class="teacher-home">${heading("", `Painel da ${e(state.code)}`, "", `<div class="tp-actions"><button class="button secondary" data-view="activity-overview">Ver por atividade</button><button class="button ${auto ? "secondary" : "primary"}" data-view="import">${icon("upload")} ${auto ? "Enviar CSV manualmente" : "Atualizar notas"}</button></div>`)}
  ${updateInfo()}${rows.length ? `<div class="tp-summary">${overview(rows, t)}${focusEditor(view)}</div>` : focusEditor(view)}
  <section class="tp-students" aria-labelledby="students-heading"><h2 id="students-heading" tabindex="-1">Desempenho dos alunos</h2>${rows.length ? `<div class="tp-tools"><div class="tp-field tp-search"><label for="search">Buscar aluno</label><input id="search" type="search" placeholder="Nome ou e-mail" value="${e(state.search)}"></div><div class="tp-field"><label for="status-filter">Filtrar</label><select id="status-filter">${filterOptions.map(([id, label]) => `<option value="${id}" ${state.filter === id ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="tp-field"><label for="student-sort">Ordenar por</label><select id="student-sort">${sortOptions.map(([value, label]) => `<option value="${value}" ${state.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="tp-tool-actions"><button class="button secondary" data-action="clear-filters">Limpar filtros</button><button class="button secondary" data-action="export-csv" ${filtered.length ? "" : "disabled"}>Exportar CSV (${filtered.length})</button></div></div>
  <div class="tp-result"><p class="tp-count">${shown}</p>${state.filter === "pending" && filtered.length ? `<button class="button primary" data-action="reminders-batch" data-ids="${filtered.map((r) => e(r.id)).join(",")}">Enviar lembrete para ${plural(filtered.length, "aluno", "alunos")}</button>` : ""}</div>
  ${filtered.length ? table : noMatch()}` : '<div class="tp-empty is-start"><h3>A turma está pronta para começar.</h3><p>Importe o CSV do Canvas para publicar a primeira atualização.</p></div>'}</section></div>`;
}

import { canvasSyncHours, current, e, heading, labels, nextCanvasSync, percent, percentStudent, plural, teacher, updateInfo } from "../ui.js";
import { state } from "../state.js";

export function historyPage(view = {}) {
  return teacher() ? publicationsPage(view) : studentHistoryPage();
}

// Expansão 5 (docs/design-visual.md): "Publicações da turma" do instrutor e do admin. A versão em vigor é a do relatório
// (publication.id; depois de uma restauração ela não é a mais recente), com o que a sincronização fará com ela; abaixo, o
// histórico de todas as publicações, por mês, na ordem do contrato. Cada publicação mostra só o que o contrato traz
// (backend/portal.py::_report e changes.change_counts): as contagens de mudança em relação à versão que estava em vigor
// quando ela saiu (base), nunca uma conta entre itens da lista; quando a base não é a publicação logo abaixo (depois de
// uma restauração), isso é dito. A restauração é a de antes (confirm, expectedCurrent, boot() no app.js); o andamento, o
// erro e o resultado chegam em `view`. .teacher-publications delimita os estilos da tela (seção 35 do CSS) e os estados
// de carregamento e erro dela.
export function teacherPublicationsState(html, titled = false) {
  return `<div class="teacher-publications">${titled ? publicationsHeading() : ""}${html}</div>`;
}

const publicationsHeading = () => heading("", "Publicações da turma", "Confira o que mudou em relação à versão que estava publicada antes de cada atualização.");
// A sincronização publica com este usuário (backend/portal.py::SYNC_USER); o envio manual, com o de quem publicou.
const SYNC_USER = "system:canvas-sync";
const instant = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
const clock = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateTime = (iso) => { const d = instant(iso); return d ? `${longDate(d)}, ${clock(d)}` : "data não informada"; };
const tally = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
// A atualização automática só publica em turma com autoSync e curso do Canvas (backend/canvas_sync.py::run).
const syncs = () => !!(current()?.autoSync && current()?.canvasCourseId);
const syncConsequence = () => `A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (${nextCanvasSync()}) publica uma nova versão.`;

function publicationsPage(view) {
  const r = state.report, rows = r?.history || [];
  if (!r?.publication) {
    return teacherPublicationsState(`${publicationsHeading()}<div class="tpub-empty"><p>As atualizações publicadas aparecerão aqui.</p><p>${syncs()
      ? `A primeira chega pela sincronização com o Canvas (próxima verificação: ${nextCanvasSync()}) ou por um CSV publicado em Atualizar notas.`
      : "Publique o CSV do Canvas em Atualizar notas para criar a primeira."}</p></div>`);
  }
  return teacherPublicationsState(`${publicationsHeading()}${inForce(r, rows, view)}${rows.length ? publicationHistory(r, rows, view) : ""}`);
}

// A versão em vigor: de quando é (a data original da publicação), de onde veio, o que os alunos veem nela e, depois de uma
// restauração, quando ela voltou a valer — a restauração não cria publicação nem muda a data original. Por fim, o que
// pode mudá-la (a sincronização) e a consulta da atualização.
function inForce(r, rows, view) {
  const p = r.publication, restored = r.updateKind === "restore", when = instant(p.publishedAt);
  const newer = rows.filter((x) => x.id !== p.id && instant(x.publishedAt) > when).length, listed = rows.some((x) => x.id === p.id);
  const students = Array.isArray(r.students) ? plural(r.students.length, "aluno", "alunos") : "";
  const activities = Array.isArray(r.activities) && r.activities.length
    ? `${r.activities.filter((a) => a.active).length.toLocaleString("pt-BR")} de ${plural(r.activities.length, "atividade liberada", "atividades liberadas")}` : "";
  const facts = [origin(p), students, activities].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  return `<section class="tpub-current" aria-labelledby="tpub-current-title"><h2 class="tpub-status is-current" id="tpub-current-title">Em vigor${restored ? " · versão restaurada" : ""}</h2>${view.restored
    ? '<p class="tpub-op is-done" id="tpub-restore-status" role="status" tabindex="-1">Publicação restaurada.</p>' : ""}
  <p class="tpub-current-date"><span>Publicação de ${when ? `<time datetime="${e(p.publishedAt)}">${longDate(when)}</time>` : "data não informada"}</span>${when
    ? `<span class="sr-only">, </span> <span class="tpub-time">${weekdayTime(when)}</span>` : ""}</p>
  <p class="tpub-current-facts">${facts}</p>${restored
    ? `<p class="tpub-restored"><strong>Restaurada em ${dateTime(r.updatedAt)}.</strong> A restauração não cria uma nova publicação: voltou a valer a versão de ${when
      ? longDate(when) : "data não informada"}, com as notas daquela publicação.</p>` : ""}${newer
    ? `<p class="tpub-current-note">${newer === 1 ? "A publicação mais recente que ela não está em vigor." : `As ${newer.toLocaleString("pt-BR")} publicações mais recentes que ela não estão em vigor.`}${listed
      ? ` <a class="text-link" href="#tpub-${e(p.id)}">Ver no histórico</a>` : ""}</p>` : ""}${restored && syncs()
    ? `<p class="tpub-current-note">${syncConsequence()}</p>` : ""}${syncInfo(r)}</section>`;
}

// Mesmos textos da linha de atualização das outras telas (ui.js::updateInfo), com as datas por extenso desta tela; a
// "última mudança nas notas" já é a data da publicação (ou da restauração), acima.
function syncInfo(r) {
  const sync = r.canvasSync;
  const body = current()?.autoSync
    ? `<p>Atualizado automaticamente do Canvas às ${canvasSyncHours.map((h) => `${h}h`).join(" e às ")} (horário de Brasília).</p><dl class="tpub-sync-times">${sync?.at
      ? `<div><dt>Última verificação</dt><dd>${dateTime(sync.at)}${sync.status === "unchanged" ? " · sem mudanças" : ""}</dd></div>` : ""}<div><dt>Próxima verificação</dt><dd>${nextCanvasSync()}</dd></div></dl>${sync?.status === "failed"
      ? `<p class="tpub-sync-failed" role="status">A atualização automática pelo Canvas falhou em ${dateTime(sync.at)}: ${e(sync.message)} As notas exibidas são da última publicação bem-sucedida.</p>` : ""}`
    : "<p>Esta turma não tem atualização automática pelo Canvas: as notas mudam quando um CSV é publicado em Atualizar notas.</p>";
  return `<div class="tpub-sync">${body}<button type="button" class="text-link tpub-refresh" data-action="refresh-report">Consultar atualização</button></div>`;
}

// Histórico por mês (no fuso do navegador, como as datas), na ordem do contrato: mais recentes primeiro.
function publicationHistory(r, rows, view) {
  const byId = new Map(rows.map((p) => [p.id, p])), groups = [];
  rows.forEach((p, i) => {
    const d = instant(p.publishedAt), key = d ? `${d.getFullYear()}-${d.getMonth()}` : "";
    let group = groups.find((g) => g.key === key);
    if (!group) groups.push((group = { key, title: d ? monthTitle(d) : "Sem data", items: [] }));
    group.items.push(entry(p, rows[i + 1], r, byId, view));
  });
  const ordered = [...groups.filter((g) => g.key), ...groups.filter((g) => !g.key)];
  return `<section class="tpub-history" aria-labelledby="tpub-history-title"><div class="tpub-history-head"><h2 id="tpub-history-title">Histórico de publicações</h2><p class="tpub-context">${plural(rows.length, "publicação", "publicações")}${period(rows)}.</p></div>${ordered
    .map((g) => `<div class="tpub-month"><h3 class="tpub-month-title">${g.title} <span>${plural(g.items.length, "publicação", "publicações")}</span></h3><ol class="tpub-list" role="list">${g.items.join("")}</ol></div>`).join("")}</section>`;
}

const monthTitle = (d) => { const t = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return t[0].toUpperCase() + t.slice(1); };

function entry(p, next, r, byId, view) {
  const d = instant(p.publishedAt), current = p.id === r.publication.id;
  const newer = !current && !!d && d > instant(r.publication.publishedAt);
  const status = current ? `Em vigor${r.updateKind === "restore" ? " · versão restaurada" : ""}` : newer ? "Não está em vigor" : "";
  const failed = view.error?.publicationId === p.id ? view.error : null;
  const described = view.restoring || failed ? ' aria-describedby="tpub-restore-status"' : "";
  return `<li class="tpub-entry${current ? " is-current" : ""}${newer ? " is-newer" : ""}" id="tpub-${e(p.id)}" tabindex="-1"><div class="tpub-when"><h4>${d
    ? `<span class="sr-only">Publicação de </span><time datetime="${e(p.publishedAt)}">${dayMonth(d)}</time><span class="sr-only"> de ${d.getFullYear()},</span> <span class="tpub-time">${weekdayTime(d)}</span>`
    : "Data não informada"}</h4>${status ? `<p class="tpub-status ${current ? "is-current" : "is-newer"}">${status}</p>` : ""}</div>
  <p class="tpub-origin">${origin(p)}</p><div class="tpub-changes">${changes(p)}${p.changes ? baseNote(p, next, byId) : ""}</div>${current ? ""
    : `<div class="tpub-action"><button type="button" class="text-link tpub-restore" data-restore="${e(p.id)}" aria-label="Restaurar a publicação de ${dateTime(p.publishedAt)}"${view.restoring ? " disabled" : ""}${described}>Restaurar</button></div>`}${view.restoring === p.id
    ? `<p class="tpub-op is-busy" id="tpub-restore-status" role="status" tabindex="-1">Restaurando a publicação de ${dateTime(p.publishedAt)}…</p>` : failed ? restoreFailure(failed) : ""}</li>`;
}

// De onde veio a versão: a sincronização (pelo usuário que publicou) ou o arquivo enviado. Sem quem publicou no registro,
// só o arquivo, sem adivinhar a origem pelo nome.
function origin(p) {
  if (p.publishedBy === SYNC_USER) return "Sincronização com o Canvas";
  if (!p.filename) return "Arquivo não informado";
  return `${p.publishedBy ? "Envio manual" : "Arquivo"} <span class="tpub-file">${e(p.filename)}</span>`;
}

// Contagens de backend/changes.py::snapshot_changes na ordem de leitura; só o que mudou. O que tira algo do que os alunos
// veem (aluno, nota ou atividade removidos, atividade retirada do cálculo) pede atenção (forma e cor). gradesRemoved só
// existe nas publicações a partir de 26/09/2026: sem ele, nada sobre notas removidas.
const FACTS = [
  ["gradesChanged", "nota alterada", "notas alteradas"],
  ["studentsAdded", "aluno adicionado", "alunos adicionados"],
  ["studentsRemoved", "aluno removido", "alunos removidos", true],
  ["studentsUpdated", "cadastro alterado", "cadastros alterados"],
  ["activitiesReleased", "atividade liberada", "atividades liberadas"],
  ["activitiesPaused", "atividade retirada do cálculo", "atividades retiradas do cálculo", true],
  ["activitiesAdded", "atividade adicionada", "atividades adicionadas"],
  ["activitiesRemoved", "atividade removida", "atividades removidas", true],
  ["scalesChanged", "pontuação máxima alterada", "pontuações máximas alteradas"],
];
const note = (text) => `<p class="tpub-note">${text}</p>`;
function changes(p) {
  const c = p.changes;
  if (!c) return note("Comparação indisponível para esta publicação antiga.");
  // Primeira publicação (sem versão em vigor antes): o que ela trouxe, em vez de "24 alunos adicionados".
  if (p.base === null && !tally(c.previousCount)) {
    const parts = [plural(tally(c.currentCount), "aluno", "alunos"), tally(c.activitiesAdded) ? plural(tally(c.activitiesAdded), "atividade", "atividades") : ""].filter(Boolean);
    return note(`Primeira publicação da turma: ${parts.join(" e ")}${tally(c.activitiesReleased) ? `, ${plural(tally(c.activitiesReleased), "liberada", "liberadas")}` : ""}.`);
  }
  const facts = FACTS.filter(([key]) => tally(c[key]) > 0).map(([key, one, many, attention]) => {
    const removed = key === "gradesChanged" ? tally(c.gradesRemoved) : 0;
    return `<li class="tpub-fact${attention || removed ? " is-attention" : ""}">${plural(tally(c[key]), one, many)}${removed ? ` (${plural(removed, "removida", "removidas")})` : ""}</li>`;
  });
  return facts.length ? `<ul class="tpub-facts" role="list">${facts.join("")}</ul>` : note("Nenhuma mudança em relação à versão em vigor antes dela.");
}

// A base é a versão que estava em vigor quando a publicação saiu; normalmente é a de baixo. Depois de uma restauração não
// é: aí a tela diz com qual foi a comparação (se a base está na lista).
function baseNote(p, next, byId) {
  const base = p.base && next && next.id !== p.base ? byId.get(p.base) : null;
  return base ? `<p class="tpub-base">Em relação à publicação de ${dateTime(base.publishedAt)}, que estava em vigor.</p>` : "";
}

// Sem resposta do servidor (rede, 5xx) a restauração pode ter acontecido; com 4xx, não. Conflito e dúvida levam à consulta.
// A dúvida guardada que o aviso curto já anunciou (o.quiet, C2) aparece igual, sem se anunciar de novo.
function restoreFailure(o) {
  const lead = o.unsure ? "Não foi possível confirmar a restauração." : "A publicação não foi restaurada.";
  return `<div class="tpub-op is-error" id="tpub-restore-status"${o.quiet ? "" : ' role="alert"'} tabindex="-1"><p><strong>${lead}</strong> <span>${e(o.message)}</span>${o.unsure
    ? " <span>Ela pode ter sido concluída: consulte a atualização antes de tentar de novo.</span>" : ""}</p>${o.unsure || o.conflict
    ? '<button type="button" class="text-link" data-action="refresh-report">Consultar atualização</button>' : ""}</div>`;
}

// Pergunta da restauração (o confirm() de sempre, no app.js): qual publicação, qual sai de vigor e, com a sincronização
// ligada, a consequência. Publicação fora do relatório: a pergunta de antes.
export function restoreQuestion(publicationId) {
  const r = state.report, target = r?.history?.find((p) => p.id === publicationId);
  if (!target) return "Restaurar esta publicação? Os alunos passarão a ver as notas desta versão.";
  const now = r.publication;
  return [`Restaurar a publicação de ${dateTime(target.publishedAt)}?`,
    `Os alunos passarão a ver as notas desta versão.${now ? ` A versão em vigor agora, publicada em ${dateTime(now.publishedAt)}, continua no histórico.` : ""}`,
    ...(syncs() ? [syncConsequence()] : [])].join("\n\n");
}

// Expansão 2 (docs/design-visual.md): "Meu histórico" do aluno como registro cronológico. Uma publicação por item, na
// ordem do contrato (mais recentes primeiro, até 12): data e hora por extenso, versão em vigor, médias com o
// arredondamento de "Meu desempenho" e a variação que o backend calculou em relação à versão em vigor antes daquela
// publicação (nunca a diferença para o item de baixo: depois de uma restauração eles não são a mesma coisa). As mudanças
// nas atividades são classificadas a partir de previousState/state/before/after, sem inventar causa nem dado.
// .student-history delimita os estilos da tela (seção 32 do CSS) e os estados de carregamento e erro dela.
export function studentHistoryState(html, titled = false) {
  return `<div class="student-history">${titled ? historyHeading() : ""}${html}</div>`;
}

const historyHeading = () => heading("", "Meu histórico", "Confira o que mudou em relação à versão que estava publicada antes de cada atualização.");

function studentHistoryPage() {
  const rows = state.report?.history || [];
  const inForce = rows.findIndex((r) => r.current);
  return studentHistoryState(`${historyHeading()}${updateInfo()}${rows.length
    ? `${historyContext(rows)}<ol class="history-list" role="list">${rows.map((r, i) => publication(r, i, inForce)).join("")}</ol>${rows.length >= 12
      // O backend devolve as 12 publicações mais recentes (e a em vigor, se for mais antiga): com 12, pode haver outras.
      ? '<p class="history-limit">O histórico mostra no máximo 12 publicações: as mais recentes e a que está em vigor.</p>' : ""}`
    : '<p class="history-empty">As atualizações publicadas aparecerão aqui.</p>'}`);
}

// Datas por extenso no fuso do navegador, como o resto do portal: sem dd/mm ambíguo e com a hora, que separa duas
// publicações do mesmo dia (o Canvas é verificado às 6h e às 18h).
const longDate = (d) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const dayMonth = (d) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
const weekdayTime = (d) => d.toLocaleString("pt-BR", { weekday: "long", hour: "2-digit", minute: "2-digit" });

function historyContext(rows) {
  return `<p class="history-context">${plural(rows.length, "publicação", "publicações")}${period(rows)}. Variações das médias em pontos percentuais (p.p.).</p>`;
}

// De quando a quando: ", em 9 de outubro de 2026", ", de 28 de agosto a 9 de outubro de 2026" (anos diferentes: os dois).
function period(rows) {
  const dates = rows.map((r) => new Date(r.publishedAt)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  const first = dates[0], last = dates.at(-1);
  return !first ? "" : longDate(first) === longDate(last) ? `, em ${longDate(last)}`
    : `, de ${first.getFullYear() === last.getFullYear() ? dayMonth(first) : longDate(first)} a ${longDate(last)}`;
}

function publication(r, i, inForce) {
  const when = new Date(r.publishedAt), valid = !Number.isNaN(when.getTime());
  const c = r.changes;
  const status = r.current
    ? `Em vigor${state.report.updateKind === "restore" ? " · versão restaurada" : ""}`
    : inForce > i ? "Não está em vigor" : "";
  const items = c ? [...(c.activities || []).map((a) => ({ ...a, kind: changeKind(a) })), ...(c.removed || []).map((name) => ({ name, kind: "removed" }))] : [];
  const unchanged = c && !items.length && !c.kc && !c.lab && c.pendingBefore === c.pendingAfter;
  // A regra que explica a queda vem junto da publicação em que uma média caiu e houve atividade liberada sem nota.
  const why = c && (c.kc < 0 || c.lab < 0) && items.some((a) => ["released", "added"].includes(a.kind) && a.state === "pending");
  return `<li class="history-entry${r.current ? " is-current" : ""}"><div class="history-when"><h2><span class="sr-only">Publicação de </span>${valid
    ? `<time datetime="${e(r.publishedAt)}">${longDate(when)}</time><span class="sr-only">, </span><span class="history-time">${weekdayTime(when)}</span>`
    : "Data não informada"}</h2>${status ? `<p class="history-status">${status}</p>` : ""}</div>
  <dl class="history-figures">${figure("kc", "Média KC", r.kc, c && c.kc, !!c)}${figure("lab", "Média LAB", r.lab, c && c.lab, !!c)}${c && c.pendingAfter != null ? `<div class="history-figure pending"><dt>Sem nota</dt><dd><strong class="history-value">${count(c.pendingBefore, c.pendingAfter)}</strong></dd></div>` : ""}</dl>
  <div class="history-changes">${!c ? '<p class="history-note">Sem versão anterior com suas notas para comparar.</p>'
    : unchanged ? '<p class="history-note">Nenhuma mudança nas suas notas.</p>'
    : !items.length ? '<p class="history-note">Nenhuma mudança nas atividades.</p>'
    : `<details${r.current ? " open" : ""}><summary><span class="history-count">${plural(items.length, "mudança nas atividades", "mudanças nas atividades")}</span> <span class="history-kinds">${kindSummary(items)}</span></summary><ul class="history-activities" role="list">${items.map(activityChange).join("")}</ul></details>`}${why
      ? '<p class="history-why">Atividades liberadas sem nota contam como 0% na média até a nota sair.</p>' : ""}</div></li>`;
}

// Média e variação. Sem média: "sem média". Com comparação: a variação do contrato, com sinal, seta (forma) e cor; o
// leitor de tela ouve "subiu/caiu N pontos percentuais". Uma casa como as médias; duas quando uma casa daria zero.
function figure(kind, label, value, change, compared) {
  const delta = value == null ? '<span class="history-delta is-none">sem média</span>' : !compared ? "" : variation(change);
  return `<div class="history-figure ${kind}"><dt>${label}</dt><dd><strong class="history-value">${percentStudent(value)}</strong>${delta ? ` ${delta}` : ""}</dd></div>`;
}

function variation(n) {
  if (n == null) return '<span class="history-delta is-none">sem comparação</span>';
  if (Number(n) === 0) return '<span class="history-delta is-same">sem mudança</span>';
  const size = Math.abs(Number(n)), digits = Math.round(size * 10) ? 1 : 2;
  const shown = Math.round(size * 10 ** digits) / 10 ** digits, text = shown.toLocaleString("pt-BR", { maximumFractionDigits: digits });
  const up = n > 0;
  // Em português, com decimais o singular vai até antes de 2 ("caiu 1,5 ponto percentual"), como em goalIndicator.
  return `<span class="history-delta ${up ? "is-up" : "is-down"}"><span aria-hidden="true">${up ? "+" : "−"}${text} p.p.</span><span class="sr-only">${up ? "subiu" : "caiu"} ${text} ${shown < 2 ? "ponto percentual" : "pontos percentuais"}</span></span>`;
}

const arrow = '<span aria-hidden="true"> → </span><span class="sr-only"> para </span>';
const count = (before, after) => before == null || before === after ? e(after) : `<span class="sr-only">de </span>${e(before)}${arrow}${e(after)}`;

// Tipos de mudança numa atividade, na ordem do resumo: [rótulo da linha, singular, plural].
const KINDS = {
  registered: ["Nota registrada", "nota registrada", "notas registradas"],
  up: ["Nota subiu", "nota subiu", "notas subiram"],
  down: ["Nota caiu", "nota caiu", "notas caíram"],
  cleared: ["Ficou sem nota", "ficou sem nota", "ficaram sem nota"],
  released: ["Atividade liberada", "atividade liberada", "atividades liberadas"],
  added: ["Atividade nova", "atividade nova", "atividades novas"],
  exempt: ["Dispensada", "dispensada", "dispensadas"],
  unexempt: ["Deixou de ser dispensada", "deixou de ser dispensada", "deixaram de ser dispensadas"],
  paused: ["Retirada do cálculo", "retirada do cálculo", "retiradas do cálculo"],
  points: ["Pontuação alterada", "pontuação alterada", "pontuações alteradas"],
  other: ["Situação alterada", "situação alterada", "situações alteradas"],
  removed: ["Removida da publicação", "removida da publicação", "removidas da publicação"],
};

// backend/changes.py::student_changes lista a atividade quando ela é nova, ou quando muda a situação, a nota ou a
// pontuação máxima: com situação e nota iguais, só a pontuação mudou.
function changeKind(a) {
  const from = a.previousState, to = a.state;
  if (!from) return "added";
  if (from === to) return to === "completed" && a.before !== a.after ? (a.after > a.before ? "up" : "down") : "points";
  if (to === "completed") return from === "pending" ? "registered" : from === "unreleased" ? "released" : from === "exempt" ? "unexempt" : "other";
  if (to === "pending") return from === "completed" ? "cleared" : from === "unreleased" ? "released" : from === "exempt" ? "unexempt" : "other";
  if (to === "exempt") return "exempt";
  if (to === "unreleased") return "paused";
  return "other";
}

const kindSummary = (items) => Object.keys(KINDS).map((k) => [k, items.filter((x) => x.kind === k).length]).filter(([, n]) => n)
  .map(([k, n]) => `<span>${plural(n, KINDS[k][1], KINDS[k][2])}</span>`).join(" · ");

function activityChange(a) {
  let change = "";
  if (a.kind === "added") change = situation(a.state, a.after);
  else if (a.kind === "points") change = a.state === "completed" ? `${percentStudent(a.after)}, nota mantida` : situation(a.state, a.after);
  else if (a.kind !== "removed") {
    // Uma casa, como em Minhas atividades; se a casa esconder a diferença (60% → 60%), duas.
    const twin = a.previousState === "completed" && a.state === "completed" && percentStudent(a.before) === percentStudent(a.after);
    change = `${twin ? percent(a.before) : situation(a.previousState, a.before)}${arrow}${twin ? percent(a.after) : situation(a.state, a.after)}`;
  }
  return `<li class="history-activity is-${a.kind}"><span class="history-activity-kind">${KINDS[a.kind][0]}</span><strong>${e(a.name)}</strong>${change ? `<span class="history-transition">${change}</span>` : ""}</li>`;
}

const situation = (s, value) => s === "completed" ? percentStudent(value) : e(labels[s] || s);

// Feedbacks administrativos (Expansão 9), sem navegador: a tela renderizada como texto e o handler com transporte falso. O
// contrato é o de backend/portal.py (só admin): GET /admin/feedback (filtros status, type e cohort; sem arquivados por padrão;
// cursor; resumo por status do portal inteiro) e POST /admin/feedback/{id}/status ({ status, expectedStatus }; 409 se outra
// pessoa mudou antes), sem mudança. Aqui, o que a Expansão 9 decide: uma caixa de entrada em linhas (o título, que abre o
// feedback; o status por texto e forma; tipo, turma, quem enviou, quando e anexos; o começo da mensagem numa linha só); o resumo
// do portal inteiro, que também filtra, com os arquivados; caixa vazia diferente de filtro sem resultado; o detalhe com a
// mensagem inteira e os dados do envio, sem identificadores internos (o sub do autor e o de quem mudou o status); a mudança de
// status como a ação da tela, parada enquanto o status escolhido é o atual, com o andamento e o erro junto dela (recusa ×
// dúvida, com a lista atualizada como consulta segura); e nenhuma resposta de uma pessoa na tela de outra.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
const notices = [];
const element = () => ({ children: [], className: "", setAttribute() {}, addEventListener() {}, remove() {}, append(...c) { this.children.push(...c); } });
globalThis.document = { querySelector: (s) => (s === "#notices" ? { replaceChildren: (item) => notices.push(item.children[0].textContent) } : null), createElement: element };
const { state } = await import("../frontend/state.js");
const { adminFeedbackPage } = await import("../frontend/pages/admin-feedback.js");
const handlers = await import("../frontend/handlers/admin-feedback.js");
const api = await import("../frontend/api.js");

const LONG = "Ao abrir Minhas atividades no celular, a lista some depois de alguns segundos e volta só quando eu giro a tela. Aconteceu três vezes hoje,\nsempre depois de publicar as notas da semana. Passos: entrar como aluno, abrir Minhas atividades e esperar.";
const ITEMS = [
  { id: "20261013T120100000000-aaaaaaaa", type: "BUG", title: "KC aparece como pendente", description: LONG, page: "activities", cohort: "BRSA0267", status: "NEW",
    createdAt: "2026-10-13T12:01:00Z", createdBy: "uid-ana-sub", createdByEmail: "ana@example.test", canvasId: "101", publicationId: "pub-267", updatedAt: "2026-10-13T12:01:00Z",
    updatedBy: "uid-ana-sub", statusHistory: [{ status: "NEW", by: "uid-ana-sub", at: "2026-10-13T12:01:00Z" }], attachments: 2, studentName: "Ana Souza", inCohort: true, canViewAsStudent: true },
  { id: "20261012T090000000000-bbbbbbbb", type: "SUGGESTION", title: "Mostrar a <data> & a hora", description: "Curta.", page: "overview", cohort: null, status: "IN_REVIEW",
    createdAt: "2026-10-12T09:00:00Z", createdBy: "uid-prof-sub", createdByEmail: "prof@instituicao.example", canvasId: null, publicationId: null, updatedAt: "2026-10-13T15:00:00Z",
    updatedBy: "uid-admin-sub", statusHistory: [], attachments: 0, studentName: null, inCohort: false, canViewAsStudent: false },
  { id: "20261011T080000000000-cccccccc", type: "IMPROVEMENT", title: "Lista de lembretes", description: "Texto.", page: "history", cohort: "BRSA0267", status: "RESOLVED",
    createdAt: "2026-10-11T08:00:00Z", createdBy: "uid-saiu", createdByEmail: "saiu@example.test", canvasId: "202", publicationId: "p2", updatedAt: "2026-10-12T08:00:00Z",
    updatedBy: "uid-admin-sub", statusHistory: [], attachments: 0, studentName: null, inCohort: false, canViewAsStudent: false },
];
const SUMMARY = { NEW: 4, IN_REVIEW: 3, RESOLVED: 2, ARCHIVED: 1 };
const ADMIN = { email: "admin@example.test", roles: ["admin"] };
const fresh = (over = {}) => ({ items: ITEMS, nextCursor: null, summary: SUMMARY, loading: false, error: "", filters: { status: "", type: "", cohort: "" }, selectedId: null, ...over });
const KEYS = ["me", "cohorts", "code", "view", "adminFeedback", "feedbackAttachments"];
const BASE = () => ({ me: ADMIN, cohorts: [{ code: "BRSA0267" }, { code: "BRSA0268" }], code: "BRSA0267", view: "admin-feedback", adminFeedback: fresh(), feedbackAttachments: {} });
function withState(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, BASE(), values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
// Versão assíncrona (handler): o estado de cada teste só volta depois que a operação termina; o setTimeout do aviso não agenda nada.
async function withStateAsync(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]])), timer = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  Object.assign(state, BASE(), values);
  try { return await fn(); } finally { Object.assign(state, saved); globalThis.setTimeout = timer; }
}
const page = (values = {}, view = {}) => withState(values, () => adminFeedbackPage(view));
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.:;?)…])/g, "$1").replace(/\( /g, "(").trim();
const count = (html, needle) => html.split(needle).length - 1;
// A hora como o navegador a escreve no fuso em que o teste roda (local ou UTC): só a data é fixa.
const time = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
// O elemento inteiro (com os filhos) que tem a classe, do começo da tag até o fechamento correspondente.
function block(html, cls) {
  const at = html.search(new RegExp(`<(section|div|p|li|ul|dl|h2|h3)\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`));
  if (at < 0) return "";
  const tag = html.slice(at + 1).match(/^\w+/)[0], re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = at;
  let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[0][1] === "/" ? -1 : 1; if (!depth) return html.slice(at, m.index + m[0].length); }
  return html.slice(at);
}
const rows = (html) => [...html.matchAll(/<li class="afb-row"/g)].map((m) => block(html.slice(m.index), "afb-row"));
// A única linha de uma lista de um feedback (a asserção vem antes de qualquer leitura dela).
const only = (html) => { const found = rows(html); assert.equal(found.length, 1, "uma linha (li.afb-row)"); return found[0]; };
const headings = (html) => [...html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/g)].map((m) => `h${m[1]} ${strip(m[2])}`);
const facts = (html) => [...block(html, "afb-facts").matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => `${m[1]}: ${strip(m[2])}`);
const NOTE = "Quem enviou vê o status no próprio feedback e só pode anexar imagens enquanto ele está Novo ou Em análise. Os arquivados saem da lista padrão e continuam no filtro Status.";

test("AF1: uma caixa de entrada do portal inteiro — o título e a área, o resumo e os filtros juntos e as linhas; sem cartões de métrica nem painéis", () => {
  const html = page();
  assert.match(html, /^<div class="admin-feedback">/);
  assert.equal(strip(block(html, "page-heading")), "Feedbacks Bugs, sugestões e melhorias enviados por quem usa o portal, de todas as turmas.");
  assert.deepEqual(headings(html), ["h1 Feedbacks", "h2 Lista de feedbacks", "h3 KC aparece como pendente", "h3 Mostrar a &lt;data&gt; &amp; a hora", "h3 Lista de lembretes"]);
  assert.match(html, /<section class="afb-inbox" aria-labelledby="fb-list-heading"><h2 id="fb-list-heading" class="sr-only">Lista de feedbacks<\/h2><div class="afb-tools"><div class="afb-summary"/);
  assert.match(html, /<ul class="afb-list" role="list"><li class="afb-row">/);
  assert.doesNotMatch(html, /(?<![\w-])(metrics?|metric-filter|panel|feedback-card|feedback-list|fb-filters|fb-actions|table-tools)(?![\w-])|<table/, "nenhuma classe da tela antiga");
  assert.equal(rows(html).length, 3);
});

test("AF2: cada linha — o título como o botão que abre, o status por texto (com a forma), tipo, turma, quem enviou, quando e anexos, e o começo da mensagem; tudo como texto", () => {
  const all = rows(page());
  assert.equal(all.length, 3, "três linhas (li.afb-row)");
  const [first, second, third] = all;
  assert.match(first, /^<li class="afb-row"><h3 class="afb-title"><button type="button" class="fb-open" data-fb-open="20261013T120100000000-aaaaaaaa">KC aparece como pendente<\/button><\/h3><p class="afb-meta">/);
  assert.equal(block(first, "afb-meta"), '<p class="afb-meta"><span class="fb-status fb-status-new">Novo</span> · Bug · BRSA0267 · <span class="sr-only">enviado por </span>Ana Souza · '
    + '<span class="sr-only">em </span><time datetime="2026-10-13T12:01:00Z">13 de outubro de 2026</time> · 2 anexos</p>');
  // O começo da mensagem numa linha só (as quebras viram espaço), cortado numa palavra, com reticências; a mensagem inteira fica no detalhe.
  const preview = strip(block(first, "afb-preview")), flat = LONG.replace(/\s+/g, " ");
  assert.ok(preview.length <= 181 && preview.endsWith("…") && flat.startsWith(preview.slice(0, -1)) && flat[preview.length - 1] === " ", preview);
  assert.doesNotMatch(block(first, "afb-preview"), /\n/);
  // Sem turma e sem nome de aluno: "Sem turma" e o e-mail; título escapado, nunca HTML.
  assert.equal(strip(block(second, "afb-meta")), "Em análise · Sugestão · Sem turma · enviado por prof@instituicao.example · em 12 de outubro de 2026");
  assert.match(second, /data-fb-open="20261012T090000000000-bbbbbbbb">Mostrar a &lt;data&gt; &amp; a hora<\/button>/);
  assert.equal(block(second, "afb-preview"), '<p class="afb-preview">Curta.</p>', "mensagem curta: inteira, sem reticências");
  assert.match(block(third, "afb-meta"), /^<p class="afb-meta"><span class="fb-status fb-status-resolved">Resolvido<\/span> · Melhoria · BRSA0267 · <span class="sr-only">enviado por <\/span>saiu@example\.test · /);
  assert.doesNotMatch(page(), /uid-ana-sub|uid-prof-sub|uid-admin-sub|uid-saiu/, "nenhum sub interno na lista");
});

test("AF3: o resumo do portal inteiro, que também filtra — com os arquivados e o filtro ativo dito; durante a carga, sem números inventados", () => {
  const summary = block(page(), "afb-summary");
  assert.match(summary, /^<div class="afb-summary" role="group" aria-labelledby="afb-summary-label"><p class="afb-label" id="afb-summary-label">No portal inteiro<\/p><button/);
  const buttons = (html) => [...html.matchAll(/<button type="button" class="afb-count" id="afb-count-(\w+)" data-fb-status="(\w*)" aria-pressed="(true|false)">(.*?)<\/button>/g)]
    .map((m) => { assert.equal(m[1], m[2] || "all", "o id do atalho segue o status"); return `${m[2] || "-"} ${m[3]} ${strip(m[4])}`; });
  assert.deepEqual(buttons(summary), ["- true Todos (sem arquivados) 9", "NEW false Novos 4", "IN_REVIEW false Em análise 3", "RESOLVED false Resolvidos 2", "ARCHIVED false Arquivados 1"]);
  assert.match(summary, /id="afb-count-NEW" data-fb-status="NEW" aria-pressed="false"><span>Novos<\/span> <strong>4<\/strong><\/button>/);
  assert.deepEqual(buttons(block(page({ adminFeedback: fresh({ filters: { status: "ARCHIVED", type: "BUG", cohort: "" } }) }), "afb-summary")).map((b) => b.split(" ")[1]), ["false", "false", "false", "false", "true"]);
  assert.equal(count(block(page({ adminFeedback: fresh({ filters: { status: "ALL", type: "", cohort: "" } }) }), "afb-summary"), 'aria-pressed="true"'), 0, "Todos, inclusive arquivados: nenhum atalho ativo");
  // Milhares no formato do português.
  assert.match(block(page({ adminFeedback: fresh({ summary: { NEW: 1200, IN_REVIEW: 0, RESOLVED: 34, ARCHIVED: 0 } }) }), "afb-summary"), /<span>Todos \(sem arquivados\)<\/span> <strong>1\.234<\/strong>/);
  const loading = block(page({ adminFeedback: fresh({ items: [], summary: null, loading: true }) }), "afb-summary");
  assert.deepEqual(buttons(loading), ["- true Todos (sem arquivados)", "NEW false Novos", "IN_REVIEW false Em análise", "RESOLVED false Resolvidos", "ARCHIVED false Arquivados"]);
  assert.doesNotMatch(loading, /<strong>/, "sem números enquanto o resumo não chegou");
});

test("AF4: os filtros do contrato, com rótulo e o valor ativo — status (inclusive arquivados), tipo e turma", () => {
  const html = page({ adminFeedback: fresh({ filters: { status: "IN_REVIEW", type: "BUG", cohort: "BRSA0268" } }) });
  const tools = block(html, "afb-filters");
  for (const [id, label] of [["fb-filter-status", "Status"], ["fb-filter-type", "Tipo"], ["fb-filter-cohort", "Turma"]])
    assert.match(tools, new RegExp(`<div class="afb-field"><label for="${id}">${label}</label><select id="${id}">`));
  const options = (id) => [...tools.slice(tools.indexOf(`id="${id}"`)).split("</select>")[0].matchAll(/<option value="([\w-]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => `${m[1] || "-"}${m[2] ? "*" : ""} ${m[3]}`);
  assert.deepEqual(options("fb-filter-status"), ["- Todos (sem arquivados)", "NEW Novo", "IN_REVIEW* Em análise", "RESOLVED Resolvido", "ARCHIVED Arquivado", "ALL Todos, inclusive arquivados"]);
  assert.deepEqual(options("fb-filter-type"), ["- Todos os tipos", "BUG* Bug", "SUGGESTION Sugestão", "IMPROVEMENT Melhoria", "OTHER Outro"]);
  assert.deepEqual(options("fb-filter-cohort"), ["- Todas as turmas", "BRSA0267 BRSA0267", "BRSA0268* BRSA0268"]);
  assert.equal(count(block(page(), "afb-filters"), " selected>"), 3, "sem filtro: o primeiro de cada");
});

test("AF5: carregando, erro, caixa vazia e filtro sem resultado, cada um do seu jeito; Carregar mais, o andamento dele e o erro dele com os itens mantidos", () => {
  assert.match(page({ adminFeedback: fresh({ items: [], loading: true, summary: null }) }), /<\/div><\/div><p class="afb-loading" role="status">Carregando feedbacks…<\/p><\/section>/);
  assert.match(page({ adminFeedback: fresh({ items: [], error: "Falha <na> lista." }) }),
    /<div class="afb-error" role="alert"><p>Falha &lt;na&gt; lista\.<\/p><button class="button secondary" data-action="admin-feedback-retry">Tentar novamente<\/button><\/div><\/section>/);
  // Caixa vazia: sem nada, ou com arquivados (que ficam de fora da lista padrão).
  assert.match(page({ adminFeedback: fresh({ items: [], summary: { NEW: 0, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } }) }), /<p class="afb-empty">Nenhum feedback recebido até agora\.<\/p>/);
  assert.match(page({ adminFeedback: fresh({ items: [], summary: { NEW: 0, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 3 } }) }), /<p class="afb-empty">Nenhum feedback fora os arquivados\.<\/p>/);
  for (const filters of [{ status: "ARCHIVED", type: "", cohort: "" }, { status: "ALL", type: "", cohort: "" }, { status: "", type: "BUG", cohort: "" }, { status: "", type: "", cohort: "BRSA0268" }])
    assert.match(page({ adminFeedback: fresh({ items: [], filters }) }), /<p class="afb-empty">Nenhum feedback neste filtro\.<\/p>/, JSON.stringify(filters));
  assert.match(page({ adminFeedback: fresh({ nextCursor: "abc" }) }), /<\/ul><button class="button secondary fb-more" data-action="admin-feedback-more">Carregar mais<\/button><\/section>/);
  assert.match(page({ adminFeedback: fresh({ nextCursor: "abc", loading: true }) }), /<button class="button secondary fb-more" data-action="admin-feedback-more" disabled>Carregando…<\/button>/);
  assert.doesNotMatch(page(), /admin-feedback-more/, "sem próxima página, sem Carregar mais");
  const failed = page({ adminFeedback: fresh({ nextCursor: "abc", error: "Sem conexão." }) });
  assert.equal(rows(failed).length, 3, "os itens já carregados continuam");
  assert.match(failed, /<\/ul><div class="afb-error" role="alert"><p>Sem conexão\.<\/p><button class="button secondary fb-more" data-action="admin-feedback-more">Tentar novamente<\/button><\/div>/);
});

const detailOf = (over = {}, view = {}, id = ITEMS[0].id) => page({ adminFeedback: fresh({ selectedId: id, ...over }) }, view);
test("AF6: o detalhe — voltar à lista, tipo e quando, o título focável, o status (desde quando mudou), a mensagem inteira e os dados do envio, sem identificadores internos", () => {
  const html = detailOf();
  assert.doesNotMatch(html, /afb-inbox|afb-summary|afb-row/, "o detalhe substitui a lista, como antes");
  assert.deepEqual(headings(html), ["h1 Feedbacks", "h2 KC aparece como pendente", "h3 Anexos", "h3 Detalhes do envio", "h3 Mudar o status"]);
  const d = block(html, "afb-detail");
  assert.match(d, /^<section class="afb-detail fb-detail" aria-labelledby="fb-detail-title"><button type="button" class="text-link afb-back" data-fb-back>← Voltar à lista<\/button><div class="afb-head"><p class="afb-kind">/);
  assert.equal(strip(block(d, "afb-kind")), `Bug · enviado em 13 de outubro de 2026 às ${time(ITEMS[0].createdAt)}`);
  assert.match(block(d, "afb-kind"), /<time datetime="2026-10-13T12:01:00Z">13 de outubro de 2026 às \d\d:\d\d<\/time>/);
  assert.match(d, /<h2 id="fb-detail-title" class="fb-title" tabindex="-1">KC aparece como pendente<\/h2>/);
  assert.equal(block(d, "afb-state"), '<p class="afb-state"><span class="sr-only">Status: </span><span class="fb-status fb-status-new">Novo</span></p>', "sem mudança depois do envio: sem desde");
  assert.equal(block(d, "afb-description"), `<p class="fb-description afb-description">${LONG}</p>`, "a mensagem inteira, com as quebras de linha");
  assert.deepEqual(facts(d), ["Aluno: Ana Souza", "E-mail: ana@example.test", "Turma: BRSA0267", "Página de origem: Atividades", "Publicação: pub-267"]);
  assert.match(block(d, "afb-facts"), /<dd><code>pub-267<\/code><\/dd>/);
  assert.doesNotMatch(html, /uid-ana-sub|uid-admin-sub/, "nem o sub do autor nem o de quem mudou o status");
  // Status mudado depois do envio: desde quando; quem enviou sem vínculo de aluno (instrutor, admin) e sem turma; título escapado.
  const second = block(detailOf({}, {}, ITEMS[1].id), "afb-detail");
  assert.equal(strip(block(second, "afb-state")), `Status: Em análise desde 13 de outubro de 2026 às ${time(ITEMS[1].updatedAt)}`);
  assert.match(block(second, "afb-state"), /<span class="afb-since">desde <time datetime="2026-10-13T15:00:00Z">/);
  assert.deepEqual(facts(second), ["Aluno: Sem vínculo de aluno", "E-mail: prof@instituicao.example", "Turma: Sem turma", "Página de origem: Painel do instrutor", "Publicação: —"]);
  assert.match(second, /<h2 id="fb-detail-title" class="fb-title" tabindex="-1">Mostrar a &lt;data&gt; &amp; a hora<\/h2>/);
  // Aluno que saiu da turma: o Canvas ID do envio, como antes.
  const third = block(detailOf({}, {}, ITEMS[2].id), "afb-detail");
  assert.match(block(third, "afb-facts"), /<dt>Aluno<\/dt><dd>Fora da turma atual <small>\(Canvas ID 202\)<\/small><\/dd>/);
  // A página de origem com o nome que quem enviou via (aluno: Histórico; o mesmo history.js é Publicações da turma para o instrutor).
  assert.deepEqual(facts(third), ["Aluno: Fora da turma atual (Canvas ID 202)", "E-mail: saiu@example.test", "Turma: BRSA0267", "Página de origem: Histórico", "Publicação: p2"]);
  assert.equal(strip(block(third, "afb-kind")), `Melhoria · enviado em 11 de outubro de 2026 às ${time(ITEMS[2].createdAt)}`);
});

test("AF7: anexos e Visualizar como aluno como antes; a mudança de status com a consequência dita, parada (com o motivo) enquanto o status escolhido é o atual", () => {
  const d = block(detailOf(), "afb-detail");
  assert.match(d, /<section class="fb-detail-attachments afb-attachments" aria-labelledby="fb-attachments-heading"><h3 id="fb-attachments-heading">Anexos<\/h3><\/section>/,
    "com anexos, a galeria do handler (que ainda não começou: nada)");
  const loading = withState({ adminFeedback: fresh({ selectedId: ITEMS[0].id }), feedbackAttachments: { [ITEMS[0].id]: { open: true, loading: true, items: [], urls: {} } } }, () => adminFeedbackPage({}));
  assert.match(block(loading, "afb-attachments"), /<p class="small" role="status">Carregando imagens…<\/p>/);
  assert.match(block(detailOf({}, {}, ITEMS[1].id), "afb-attachments"), /<h3 id="fb-attachments-heading">Anexos<\/h3><p class="afb-note">Nenhuma imagem anexada\.<\/p><\/section>/);
  assert.match(block(d, "afb-sent"), /^<section class="afb-sent" aria-labelledby="afb-sent-title"><h3 id="afb-sent-title">Detalhes do envio<\/h3><dl class="fb-facts afb-facts">/);
  assert.match(block(d, "afb-sent"), /<\/dl><button type="button" class="button secondary" data-fb-view-as="20261013T120100000000-aaaaaaaa">Visualizar como aluno<\/button><\/section>$/);
  assert.doesNotMatch(detailOf({}, {}, ITEMS[1].id), /data-fb-view-as/, "sem aluno na turma, sem visualizar");
  const action = block(d, "afb-status-action");
  assert.equal(action, `<section class="afb-status-action" aria-labelledby="afb-status-title"><h3 id="afb-status-title">Mudar o status</h3><p class="afb-note">${NOTE}</p>`
    + '<div class="afb-status-form"><label for="fb-status-select">Status</label><select id="fb-status-select"><option value="NEW" selected>Novo</option><option value="IN_REVIEW">Em análise</option>'
    + '<option value="RESOLVED">Resolvido</option><option value="ARCHIVED">Arquivado</option></select><button type="button" class="button primary" data-fb-save="20261013T120100000000-aaaaaaaa" '
    + 'aria-describedby="afb-save-reason" disabled>Salvar status</button><p class="afb-reason" id="afb-save-reason">Escolha outro status para salvar.</p></div></section>');
  // Com outro status escolhido (o app.js guarda a escolha): o seletor continua nele e Salvar status fica livre, sem motivo.
  const picked = block(detailOf({}, { pick: "RESOLVED" }), "afb-status-action");
  assert.match(picked, /<option value="NEW">Novo<\/option><option value="IN_REVIEW">Em análise<\/option><option value="RESOLVED" selected>Resolvido<\/option>/);
  assert.match(picked, /data-fb-save="20261013T120100000000-aaaaaaaa">Salvar status<\/button><\/div><\/section>$/);
  assert.doesNotMatch(picked, /afb-save-reason/);
  // Escolher de volta o status atual para de novo.
  assert.match(block(detailOf({}, { pick: "NEW" }), "afb-status-action"), /aria-describedby="afb-save-reason" disabled>Salvar status/);
});

test("AF8: a mudança de status — andamento junto da ação, com os controles parados (ligados a ele) e o status de destino no seletor; recusa (nada mudou) e dúvida (pode ter mudado), com a lista atualizada como consulta", () => {
  const id = ITEMS[0].id;
  const busy = block(detailOf({}, { busy: { id, status: "RESOLVED", title: ITEMS[0].title } }), "afb-status-action");
  assert.match(busy, /<p class="afb-op is-busy" id="afb-op-status" role="status" tabindex="-1">Mudando o status para Resolvido…<\/p><\/section>$/);
  assert.match(busy, /<select id="fb-status-select" aria-describedby="afb-op-status" disabled>/);
  assert.match(busy, /<option value="RESOLVED" selected>Resolvido<\/option>/, "o seletor mostra o status pedido, não o de antes");
  assert.match(busy, /data-fb-save="[^"]+" aria-describedby="afb-op-status" disabled>Salvar status<\/button><\/div>/);
  assert.doesNotMatch(busy, /afb-save-reason/);
  // Andamento de outro feedback (a pessoa voltou à lista e abriu outro): este também fica parado, e o andamento diz qual.
  const other = block(detailOf({}, { busy: { id: ITEMS[1].id, status: "ARCHIVED", title: ITEMS[1].title } }), "afb-status-action");
  assert.match(other, /<p class="afb-op is-busy" id="afb-op-status" role="status" tabindex="-1">Mudando o status de “Mostrar a &lt;data&gt; &amp; a hora” para Arquivado…<\/p>/);
  assert.match(other, /<option value="NEW" selected>Novo<\/option>/);
  assert.match(other, /<select id="fb-status-select" aria-describedby="afb-op-status" disabled>/);
  const refused = block(detailOf({}, { pick: "RESOLVED", failure: { id, status: "RESOLVED", message: "Você não tem <acesso>." } }), "afb-status-action");
  assert.match(refused, /<div class="afb-op is-error" id="afb-op-status" role="alert" tabindex="-1"><p><strong>O status não foi alterado\.<\/strong> <span>Você não tem &lt;acesso&gt;\.<\/span><\/p><\/div><\/section>$/);
  assert.doesNotMatch(refused, /disabled|admin-feedback-consult/, "depois do erro, os controles voltam; recusa sem consulta");
  assert.match(refused, /<option value="RESOLVED" selected>/, "a escolha fica para a nova tentativa");
  const stale = block(detailOf({}, { failure: { id, status: "RESOLVED", stale: true, message: "Feedback não encontrado." } }), "afb-status-action");
  assert.match(stale, /<p><strong>O status não foi alterado\.<\/strong> <span>Feedback não encontrado\.<\/span><\/p><button type="button" class="button secondary" id="afb-op-retry" data-action="admin-feedback-consult">Atualizar a lista<\/button><\/div>/);
  const unsure = block(detailOf({}, { failure: { id, status: "RESOLVED", unsure: true, message: "A conexão com o portal falhou." } }), "afb-status-action");
  assert.equal(strip(block(unsure, "afb-op")), "Não foi possível confirmar a mudança de status. A conexão com o portal falhou. O pedido pode ter sido concluído: atualize a lista antes de tentar de novo. Atualizar a lista");
  assert.match(unsure, /<button type="button" class="button secondary" id="afb-op-retry" data-action="admin-feedback-consult">Atualizar a lista<\/button><\/div><\/section>$/);
  assert.equal(count(detailOf({}, { failure: { id: ITEMS[1].id, status: "NEW", message: "x" } }), 'id="afb-op-status"'), 0, "o erro de outro feedback não aparece neste");
});

test("AF9: robustez — mensagem sem espaços, emoji e mensagem vazia no começo da linha; data inválida não vira texto quebrado", () => {
  const item = (over) => ({ ...ITEMS[0], id: "20261013T120100000000-dddddddd", ...over });
  const word = "inconstitucionalissimamente".repeat(8);
  const hard = only(page({ adminFeedback: fresh({ items: [item({ description: word })] }) }));
  assert.equal(strip(block(hard, "afb-preview")), `${word.slice(0, 180)}…`, "sem espaço onde cortar: corta no limite");
  const emoji = "🙂".repeat(200);
  const faces = only(page({ adminFeedback: fresh({ items: [item({ description: emoji })] }) }));
  assert.equal(strip(block(faces, "afb-preview")), `${"🙂".repeat(180)}…`, "não parte um emoji ao meio");
  const exact = "a".repeat(180);
  assert.equal(strip(block(only(page({ adminFeedback: fresh({ items: [item({ description: exact })] }) })), "afb-preview")), exact, "até o limite, inteira");
  const empty = only(page({ adminFeedback: fresh({ items: [item({ description: "  \n " })] }) }));
  assert.doesNotMatch(empty, /afb-preview/, "sem mensagem, sem linha vazia");
  const broken = page({ adminFeedback: fresh({ items: [item({ createdAt: "ontem", updatedAt: "ontem" })] }) });
  assert.doesNotMatch(broken, /Invalid|NaN|undefined/);
  assert.equal(strip(block(only(broken), "afb-meta")), "Novo · Bug · BRSA0267 · enviado por Ana Souza · 2 anexos");
  const brokenDetail = page({ adminFeedback: fresh({ items: [item({ createdAt: "ontem", updatedAt: "2026-10-13T15:00:00Z" })], selectedId: "20261013T120100000000-dddddddd" }) });
  assert.equal(strip(block(brokenDetail, "afb-kind")), "Bug");
  assert.doesNotMatch(brokenDetail, /Invalid|NaN|undefined/);
});

// Handler com transporte falso: cada chamada fica pendente até o teste responder.
function harness() {
  const calls = [], order = [];
  api.setTransport((path, options = {}) => new Promise((resolve, reject) => { order.push(`${options.method || "GET"} ${path}`); calls.push({ path, method: options.method || "GET", body: options.body, resolve, reject }); }));
  handlers.configure({ render: () => order.push("render") });
  notices.length = 0;
  return { calls, order };
}
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("AF10: salvar status — started só quando um pedido vai sair (mesmo status ou feedback fora da lista: nada); sucesso só com a resposta; 409 relê a lista em silêncio e devolve o erro", async () => {
  await withStateAsync({ adminFeedback: fresh({ items: structuredClone(ITEMS), selectedId: ITEMS[0].id }) }, async () => {
    let h = harness(), started = 0;
    await handlers.saveStatus(ITEMS[0].id, "NEW", () => started++);
    await handlers.saveStatus("20261001T000000000000-zzzzzzzz", "RESOLVED", () => started++);
    assert.deepEqual([h.calls.length, started, notices], [0, 0, []], "mesmo status ou feedback desconhecido: nada sai");
    h = harness();
    const run = handlers.saveStatus(ITEMS[0].id, "RESOLVED", () => h.order.push("started"));
    await tick();
    assert.deepEqual(h.order, ["started", "POST /admin/feedback/20261013T120100000000-aaaaaaaa/status"]);
    assert.deepEqual(h.calls[0].body, { status: "RESOLVED", expectedStatus: "NEW" });
    assert.deepEqual(notices, [], "nada de sucesso antes da resposta");
    h.calls[0].resolve({ feedback: { ...ITEMS[0], status: "RESOLVED", updatedAt: "2026-10-14T13:00:00Z" } });
    await run;
    assert.deepEqual([state.adminFeedback.items[0].status, state.adminFeedback.items[0].updatedAt, notices, h.order.at(-1)], ["RESOLVED", "2026-10-14T13:00:00Z", ["Status do feedback atualizado."], "render"]);
    h = harness();
    const conflict = handlers.saveStatus(ITEMS[1].id, "RESOLVED", () => {});
    await tick();
    h.calls[0].reject(Object.assign(new Error("Alterado por outra pessoa."), { status: 409 }));
    await tick();
    assert.equal(h.calls[1]?.path, "/admin/feedback?limit=50", "409: relê a primeira página, com os filtros, em silêncio");
    h.calls[1].resolve({ items: [{ ...ITEMS[1], status: "RESOLVED" }], nextCursor: null, summary: SUMMARY });
    await assert.rejects(conflict, /Alterado por outra pessoa/);
    assert.deepEqual([notices, state.adminFeedback.items.map((f) => f.status)], [[], ["RESOLVED"]], "409 não vira sucesso; a tela passa a ter o status do servidor");
    // Outros erros: nada é relido, e o erro volta para quem chamou.
    for (const err of [Object.assign(new Error("Sem acesso."), { status: 403 }), Object.assign(new TypeError("Failed to fetch"), { network: true })]) {
      h = harness();
      const run2 = handlers.saveStatus(state.adminFeedback.items[0].id, "ARCHIVED", () => {});
      await tick();
      h.calls[0].reject(err);
      await tick();
      // Conta os pedidos antes de esperar o erro: uma releitura indevida ficaria pendente (e o teste, parado) — a asserção vem antes.
      const extra = h.calls.length;
      h.calls.slice(1).forEach((call) => call.resolve({ items: [], nextCursor: null, summary: SUMMARY }));
      assert.equal(extra, 1, `${err.message}: nada é relido`);
      await assert.rejects(run2, (thrown) => thrown === err);
      assert.deepEqual(notices, [], err.message);
    }
  });
});

test("AF11: outra pessoa entra na aba durante a mudança de status — a resposta de quem saiu não mexe na tela, não avisa nem relê a lista em nome dela", async () => {
  await withStateAsync({}, async () => {
    handlers.resetForUser(ADMIN.email);
    Object.assign(state.adminFeedback, { items: structuredClone(ITEMS), selectedId: ITEMS[0].id });
    let h = harness();
    const run = handlers.saveStatus(ITEMS[0].id, "RESOLVED", () => {});
    await tick();
    handlers.resetForUser("outra@example.test");
    state.me = { email: "outra@example.test", roles: ["admin"] };
    const fila = state.adminFeedback;
    h.calls[0].resolve({ feedback: { ...ITEMS[0], status: "RESOLVED" } });
    await run;
    assert.deepEqual([notices, h.order.filter((x) => x === "render").length, state.adminFeedback === fila, fila.items], [[], 0, true, []]);
    // 409 depois da troca: nem releitura em nome de quem saiu, nem aviso.
    handlers.resetForUser(ADMIN.email);
    state.me = ADMIN;
    Object.assign(state.adminFeedback, { items: structuredClone(ITEMS), selectedId: ITEMS[1].id });
    h = harness();
    const conflict = handlers.saveStatus(ITEMS[1].id, "RESOLVED", () => {});
    await tick();
    handlers.resetForUser("outra@example.test");
    state.me = { email: "outra@example.test", roles: ["admin"] };
    h.calls[0].reject(Object.assign(new Error("Alterado."), { status: 409 }));
    await tick();
    const extra = h.calls.length;
    h.calls.slice(1).forEach((call) => call.resolve({ items: [], nextCursor: null, summary: SUMMARY }));
    assert.equal(extra, 1, "sem releitura em nome de quem saiu");
    await assert.rejects(conflict, /Alterado/);
    assert.deepEqual(notices, []);
  });
});

// Turmas e acessos (Expansão 8), sem navegador: a tela renderizada como texto e o handler com transporte falso. O contrato é o
// de backend/portal.py (todas as rotas exigem admin): GET /requests, POST /requests/{id}/reject, POST /cohorts, GET e POST
// /cohorts/{code}/instructors, revoke-instructor, students-search, unlink-student, display-name e settings, sem mudança. Aqui,
// o que a Expansão 8 decide: o escopo dito (o portal inteiro × a turma selecionada), com a turma identificada por código e
// nome; pessoa, situação e data em cada solicitação; o papel e a turma de cada instrutor; a conta do portal de cada aluno,
// separada do e-mail do Canvas; ações que mudam algo distintas das de consulta e as de consequência (recusar, remover,
// desvincular) com outra ênfase; andamento, recusa e dúvida junto do alvo, com tudo que muda parado durante a operação; as
// perguntas com a pessoa, a turma e a consequência; os avisos de sucesso com a pessoa e a turma; e nenhum resultado de uma
// pessoa ou de uma busca antiga na tela de outra.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
const notices = [];
const element = () => ({ children: [], className: "", setAttribute() {}, addEventListener() {}, remove() {}, append(...c) { this.children.push(...c); } });
globalThis.document = { querySelector: (s) => (s === "#notices" ? { replaceChildren: (item) => notices.push(item.children[0].textContent) } : null), createElement: element };
const { state } = await import("../frontend/state.js");
const { accessPage } = await import("../frontend/pages/access.js");
const handlers = await import("../frontend/handlers/access.js");
const api = await import("../frontend/api.js");

const COHORTS = [
  { code: "BRSA0267", name: "AWS re/Start · Turma 267", canTeach: true, current: "pub-267", autoSync: true, canvasCourseId: "4436", thresholds: { kc: 60, lab: 90 } },
  { code: "BRSA0268", name: "AWS re/Start · Turma 268", canTeach: true, current: null, autoSync: false, canvasCourseId: null },
];
const REQUESTS = [
  { userId: "u-carla", email: "carla.dias@instituicao.example", status: "pending", createdAt: "2026-10-13T14:20:00Z" },
  { userId: "u-bruno", email: "bruno<b>@instituicao.example", status: "pending", createdAt: "2026-10-12T09:05:00Z" },
  { userId: "u-ana", email: "ana.lima@instituicao.example", status: "approved", createdAt: "2026-09-02T11:00:00Z" },
  { userId: "u-diego", email: "diego.melo@instituicao.example", status: "rejected", createdAt: "2026-09-20T16:40:00Z", rejectedAt: "2026-09-21T10:00:00Z" },
];
const INSTRUCTORS = [{ userId: "u-ana", email: "ana.lima@instituicao.example", code: "BRSA0267" }, { userId: "u-joao", email: "joao<i>@instituicao.example", code: "BRSA0267" }];
const STUDENTS = [
  { id: "31000", name: "Lia Mota", email: "lia.mota@example.test", bound: true, boundEmail: "lia.mota@example.test", boundAt: "2026-09-24T12:00:00Z" },
  { id: "31001", name: "Liam Duarte", email: "liam.duarte@example.test", bound: false, boundEmail: null, boundAt: null },
  { id: "31002", name: "Lis <i>Prado</i>", email: null, bound: false, boundEmail: null, boundAt: null },
  { id: "31003", name: "Lino Souza", email: "lino.souza@example.test", bound: true, boundEmail: null, boundAt: null },
];
const ADMIN = { email: "admin@example.test", roles: ["admin"] };
const KEYS = ["me", "cohorts", "code", "view", "studentView", "requests", "instructors", "accessLoading", "accessError", "requestsFilter", "studentQuery",
  "studentResults", "studentSearchError", "studentSearchLoading", "editingStudentId"];
function withState(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: ADMIN, cohorts: COHORTS, code: "BRSA0267", view: "access", studentView: null, requests: REQUESTS, instructors: INSTRUCTORS,
    accessLoading: false, accessError: "", requestsFilter: "pending", studentQuery: "", studentResults: null, studentSearchError: "", studentSearchLoading: false,
    editingStudentId: null }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
// Versão assíncrona (handler): o estado de cada teste só volta depois que a operação termina; o setTimeout do aviso não agenda nada.
async function withStateAsync(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]])), globals = { setTimeout: globalThis.setTimeout, confirm: globalThis.confirm, FormData: globalThis.FormData };
  globalThis.setTimeout = () => 0;
  Object.assign(state, { me: ADMIN, cohorts: COHORTS, code: "BRSA0267", view: "access", studentView: null, requests: REQUESTS, instructors: INSTRUCTORS,
    accessLoading: false, accessError: "", requestsFilter: "pending", studentQuery: "", studentResults: null, studentSearchError: "", studentSearchLoading: false,
    editingStudentId: null }, values);
  try { return await fn(); } finally { Object.assign(state, saved); Object.assign(globalThis, globals); }
}
const page = (values = {}, view = {}) => withState(values, () => accessPage(view));
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.:;?)])/g, "$1").replace(/\( /g, "(").trim();
const count = (html, needle) => html.split(needle).length - 1;
// Trecho de um elemento pela classe, contando o aninhamento do mesmo tipo de tag; vazio se ele não existe.
function block(html, cls) {
  const at = html.search(new RegExp(`<(section|div|p|li|ul|form|dl)\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`));
  if (at < 0) return "";
  const tag = html.slice(at + 1).match(/^\w+/)[0], re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = at;
  let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[0][1] === "/" ? -1 : 1; if (!depth) return html.slice(at, m.index + m[0].length); }
  return html.slice(at);
}
const rows = (html) => [...html.matchAll(/<li class="aa-row[^"]*"[^>]*>/g)].map((m) => block(html.slice(m.index), "aa-row"));
const tag = (html, attr) => (html.match(new RegExp(`<[^>]*${attr}[^>]*>`)) || [""])[0];
const headings = (html) => [...html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/g)].map((m) => `h${m[1]} ${strip(m[2])}`);

test("TODO28: vínculo adicional usa somente aprovados ainda não vinculados à turma, fora da aprovação inicial", () => {
  const html = page({ code: "BRSA0268", instructors: [], requestsFilter: "approved" }, { instructorPick: "u-ana" });
  const form = block(html, "aa-approved-link");
  assert.match(form, /id="approved-instructor-form"/);
  assert.match(form, /name="userId"/);
  assert.match(form, /value="u-ana" selected/);
  assert.doesNotMatch(form, /u-carla|u-bruno|u-diego/);
  assert.match(form, />Conceder acesso à turma<\/button>/);
  assert.doesNotMatch(form, / disabled/);
  assert.doesNotMatch(block(html, "aa-request-list"), /approve-form/, "pedido aprovado continua somente leitura");
  assert.doesNotMatch(page(), /id="approved-instructor-form"/, "não oferece vínculo duplicado na turma atual");
  for (const values of [{ accessLoading: true }, { accessError: "Falha de leitura" }])
    assert.doesNotMatch(page({ code: "BRSA0268", instructors: [], ...values }), /id="approved-instructor-form"/, "não concede com lista inconclusiva");
});

test("AA1: a tela diz o escopo — solicitações e criação de turma valem para o portal inteiro; instrutores, alunos e configurações, para a turma selecionada, identificada por código e nome — e o que é mais frequente vem antes", () => {
  const html = page();
  assert.match(html, /^<div class="admin-access">/);
  assert.deepEqual(headings(html), ["h1 Turmas e acessos", "h2 Solicitações de acesso", "h2 Turma BRSA0267", "h3 Instrutores da BRSA0267", "h3 Alunos e contas",
    "h3 Configurações da BRSA0267", "h2 Criar uma turma"]);
  assert.equal(strip(block(html, "page-heading")), "Turmas e acessos Pedidos de acesso de instrutores, quem acompanha cada turma e as contas dos alunos. Criar turma — ir para o formulário, no fim da página");
  assert.equal(count(html, '<p class="aa-scope">Portal inteiro</p>'), 2, "solicitações e criação de turma");
  assert.equal(strip(block(html, "aa-cohort-head")),
    "Turma selecionada Turma BRSA0267 AWS re/Start · Turma 267 Instrutores, contas dos alunos e configurações valem só para esta turma. Para cuidar de outra, troque no seletor de turma.");
  assert.match(html, /<h2 id="aa-requests-title" tabindex="-1">Solicitações de acesso<\/h2>/);
  assert.match(html, /<h3 id="aa-instructors-title" tabindex="-1">Instrutores da BRSA0267<\/h3>/);
  assert.match(html, /<h3 id="aa-students-title" tabindex="-1">Alunos e contas<\/h3>/);
  assert.match(html, /<h3 id="aa-settings-title" tabindex="-1">Configurações da BRSA0267<\/h3>/);
  assert.match(html, /<h2 id="aa-create-title" tabindex="-1">Criar uma turma<\/h2>/);
  // Nada da composição antiga: painéis iguais, colunas, rótulo decorativo e o bloco "Como funciona" (o conteúdo foi para cada seção).
  assert.doesNotMatch(html, /class="panel|two-columns|EQUIPE DE INSTRUÇÃO|Como funciona o acesso|class="eyebrow|<table/);
  const sameName = page({ cohorts: [{ code: "BRSA0267", name: "BRSA0267", canTeach: true }] });
  assert.equal(strip(block(sameName, "aa-cohort-head")).startsWith("Turma selecionada Turma BRSA0267 Instrutores"), true, "sem repetir o código como nome");
});

test("AA2: solicitações — pessoa, situação por texto e forma e a data do pedido; as pendentes com a turma escolhida no próprio formulário, Vincular e Recusar (esta com a ênfase de consequência), ligados à pessoa; filtro com as contagens", () => {
  const html = page();
  const filter = tag(html, 'id="requests-filter"');
  assert.match(html, /<label for="requests-filter">Mostrar<\/label>/);
  assert.deepEqual([...block(html, "aa-tools").matchAll(/<option value="(\w+)"( selected)?>([^<]*)<\/option>/g)].map((m) => `${m[1]}${m[2] ? "*" : ""} ${m[3]}`),
    ["pending* Pendentes (2)", "approved Aprovadas (1)", "rejected Recusadas (1)", "all Todas (4)"]);
  assert.ok(filter);
  assert.match(block(html, "aa-tools"), /<button class="text-link" data-action="refresh-requests">Atualizar<\/button>/);
  assert.equal(strip(block(html, "aa-requests-note")), "Instrutores pedem acesso com o e-mail institucional confirmado. Ao vincular, você escolhe a turma que a pessoa vai acompanhar.");
  const list = rows(block(html, "aa-request-list"));
  assert.equal(list.length, 2, "o filtro padrão mostra as pendentes");
  const [carla, bruno] = list;
  assert.match(carla, /<strong class="aa-email" id="aa-req-u-carla">carla\.dias@instituicao\.example<\/strong>/);
  assert.match(carla, /<span class="aa-status is-attention">Aguardando aprovação<\/span><span class="aa-date">pedido em 13 de outubro de 2026<\/span>/);
  assert.match(carla, /<form class="approve-form aa-link" data-user="u-carla">/, "a classe approve-form é a que o app.js usa para enviar");
  assert.match(carla, /<label for="approve-u-carla">Turma <span class="sr-only">para carla\.dias@instituicao\.example<\/span><\/label><select id="approve-u-carla" name="cohort" required>/);
  assert.deepEqual([...carla.matchAll(/<option value="([\w-]+)">([^<]*)<\/option>/g)].map((m) => `${m[1]}: ${m[2]}`),
    ["BRSA0267: BRSA0267 — AWS re/Start · Turma 267", "BRSA0268: BRSA0268 — AWS re/Start · Turma 268"]);
  assert.match(carla, /<select id="approve-u-carla" name="cohort" required><option value="" selected>Selecione uma turma<\/option>/);
  assert.match(carla, /<button class="button secondary" aria-describedby="aa-req-u-carla aa-pick-u-carla" disabled>Vincular à turma<\/button>/);
  assert.match(rows(block(page({}, { picks: { "u-carla": "BRSA0268" } }), "aa-request-list"))[0], /<button class="button secondary" aria-describedby="aa-req-u-carla">Vincular à turma<\/button>/);
  assert.match(carla, /<button class="button aa-danger" type="button" data-reject="u-carla" aria-describedby="aa-req-u-carla">Recusar<\/button>/);
  assert.match(bruno, /bruno&lt;b&gt;@instituicao\.example/);
  assert.doesNotMatch(html, /<b>/);
  const approved = rows(block(page({ requestsFilter: "approved" }), "aa-request-list"));
  assert.deepEqual(approved.map(strip), ["ana.lima@instituicao.example Aprovada pedido em 2 de setembro de 2026"]);
  assert.match(approved[0], /<span class="aa-status is-ok">Aprovada<\/span>/);
  assert.doesNotMatch(approved[0], /<form|<button/);
  const rejected = rows(block(page({ requestsFilter: "rejected" }), "aa-request-list"));
  assert.deepEqual(rejected.map(strip), ["diego.melo@instituicao.example Recusada pedido em 20 de setembro de 2026 · recusado em 21 de setembro de 2026"]);
  assert.match(rejected[0], /<span class="aa-status is-off">Recusada<\/span>/);
  assert.equal(rows(block(page({ requestsFilter: "all" }), "aa-request-list")).length, 4);
  const none = page({ requestsFilter: "rejected", requests: REQUESTS.slice(0, 3) });
  assert.match(none, /<p class="aa-empty">Nenhuma solicitação neste filtro\.<\/p>/);
  assert.match(block(none, "aa-tools"), /Recusadas \(0\)/);
  // A turma escolhida em cada pedido (view.picks) volta marcada quando a tela é refeita; turma que não existe não marca nada.
  const picked = rows(block(page({}, { picks: { "u-carla": "BRSA0268", "u-bruno": "BRSA9999" } }), "aa-request-list"));
  assert.deepEqual(picked.map((row) => [...row.matchAll(/<option value="([\w-]+)"( selected)?>/g)].filter((m) => m[2]).map((m) => m[1])), [["BRSA0268"], []]);
  const unknown = rows(block(page({ requestsFilter: "all", requests: [{ userId: "u-x", email: "x@instituicao.example", status: "suspended" }] }), "aa-request-list"));
  assert.equal(strip(unknown[0]), "x@instituicao.example suspended", "situação nova aparece com o código, sem data inventada");
});

// Controles da página (campo, seletor, botão): nome (rótulo do botão ou name/id do campo), parado ou não e a quem está ligado.
const controls = (html) => [...html.matchAll(/<(input|select|button)\b([^>]*)>([^<]*)/g)].map(([, tagName, attrs, text]) =>
  [tagName === "button" ? text : (attrs.match(/\b(?:name|id)="([^"]*)"/) || [])[1], /\sdisabled(?=\s|$)/.test(attrs) ? "parado" : "livre", (attrs.match(/aria-describedby="([^"]*)"/) || [, ""])[1]]);

test("AA3: carregando e erro na própria seção — sem listas vazias que pareçam resultado; na carga, campos e ações que mudam algo param, ligados ao aviso de carregamento (o fim da carga refaz os campos); no erro, alunos, configurações e criação continuam disponíveis", () => {
  const loading = page({ accessLoading: true, requests: [], instructors: [] });
  assert.match(block(loading, "aa-requests"), /<p class="aa-loading" id="aa-load-status" role="status">Carregando solicitações e instrutores…<\/p>/);
  assert.equal(count(loading, 'id="aa-load-status"'), 1);
  assert.doesNotMatch(loading, /Nenhuma solicitação neste filtro|Nenhum instrutor vinculado/);
  assert.match(block(loading, "aa-instructors"), /<p class="aa-note">Carregando os instrutores…<\/p>/);
  assert.deepEqual([...block(loading, "aa-tools").matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]), ["Pendentes", "Aprovadas", "Recusadas", "Todas"]);
  for (const html of [loading, page({ accessError: "As solicitações e os vínculos não foram carregados. Tente novamente.", requests: [], instructors: [] })])
    assert.match(html, /id="student-search-form"[\s\S]*id="cohort-settings-form"[\s\S]*id="cohort-form"/);
  // Na carga, com alunos na tela e um nome em edição: param os campos (o que se digitasse sumiria no fim da carga), Buscar e as
  // ações que mudam algo; continuam o filtro, Atualizar, Visualizar como aluno e Cancelar. A dica do código continua ligada.
  const parked = page({ accessLoading: true, requests: [], instructors: [], studentQuery: "li", studentResults: STUDENTS.slice(0, 2), editingStudentId: "31001" });
  assert.deepEqual(controls(parked), [
    ["requests-filter", "livre", ""], ["Atualizar", "livre", ""],
    ["student-query", "parado", "aa-load-status"], ["Buscar", "parado", "aa-load-status"],
    ["Visualizar como aluno", "livre", "aa-stu-31000"], ["Editar nome", "parado", "aa-stu-31000 aa-load-status"], ["Desvincular conta", "parado", "aa-stu-31000 aa-load-status"],
    ["edit-name-31001", "parado", "aa-load-status"], ["Salvar", "parado", "aa-load-status"], ["Cancelar", "livre", ""],
    ["kc", "parado", "aa-load-status"], ["lab", "parado", "aa-load-status"], ["canvasCourseId", "parado", "aa-load-status"], ["autoSync", "parado", "aa-load-status"],
    ["Salvar configurações", "parado", "aa-load-status"],
    ["code", "parado", "aa-code-hint aa-load-status"], ["name", "parado", "aa-load-status"], ["Criar turma", "parado", "aa-load-status"],
  ]);
  // Fora da carga (lista carregada ou erro), nada fica parado nem ligado a um aviso que não existe.
  const failed = page({ accessError: "As solicitações e os vínculos <não> foram carregados. Tente novamente.", requests: [], instructors: [] });
  const chosen = { picks: { "u-carla": "BRSA0268", "u-bruno": "BRSA0267" } };
  for (const html of [failed, page({ studentQuery: "li", studentResults: STUDENTS.slice(0, 2), editingStudentId: "31001" }, chosen)]) {
    assert.deepEqual(controls(html).filter(([, how]) => how === "parado"), []);
    assert.doesNotMatch(html, /aa-load-status/);
  }
  assert.equal(block(failed, "aa-error"),
    '<div class="aa-error" role="alert"><h3>Não foi possível carregar os acessos</h3><p>As solicitações e os vínculos &lt;não&gt; foram carregados. Tente novamente.</p><button class="button primary" id="aa-load-retry" data-action="refresh-requests">Tentar novamente</button></div>');
  assert.match(block(failed, "aa-instructors"), /<p class="aa-note">Os instrutores não foram carregados\.<\/p>/);
  assert.doesNotMatch(failed, /Nenhuma solicitação neste filtro|Nenhum instrutor vinculado/);
});

test("AA4: instrutores da turma — pessoa, o que ela faz e em qual turma, e Remover acesso com a ênfase de consequência, ligado à pessoa; vazio dito", () => {
  const html = page();
  assert.equal(strip(block(html, "aa-instructors-note")), "Quem acompanha esta turma pelo vínculo de instrutor. Administradores acessam todas as turmas sem precisar de vínculo. Pessoas já aprovadas podem receber acesso a outras turmas ou ter um vínculo removido concedido novamente.");
  const list = rows(block(html, "aa-instructor-list"));
  assert.equal(list.length, 2);
  assert.equal(list[0], '<li class="aa-row"><div class="aa-who"><strong class="aa-email" id="aa-ins-u-ana">ana.lima@instituicao.example</strong><span class="aa-role">Acompanha a BRSA0267</span></div><div class="aa-actions"><button class="button aa-danger" data-revoke="u-ana" aria-describedby="aa-ins-u-ana">Remover acesso</button></div></li>');
  assert.match(list[1], /joao&lt;i&gt;@instituicao\.example/);
  const empty = page({ instructors: [] });
  assert.match(block(empty, "aa-instructors"), /<p class="aa-empty">Nenhum instrutor vinculado à BRSA0267\. Administradores têm acesso a todas as turmas\.<\/p>/);
});

test("AA5: alunos e contas — busca com rótulo, a conta do portal separada do e-mail do Canvas, desde quando, e as ações de cada aluno; contagem anunciada; vazio, erro e edição do nome", () => {
  const initial = page();
  assert.equal(strip(block(initial, "aa-students-note")),
    "No primeiro acesso, o portal liga a conta ao aluno cujo e-mail no Canvas é o mesmo da conta. Busque um aluno da publicação em vigor para ver essa ligação, corrigir o nome de exibição ou ver o portal como o aluno vê.");
  assert.match(initial, /<form id="student-search-form" class="aa-search"><label for="student-query">Buscar aluno<\/label><div class="aa-search-row"><input id="student-query" name="query" placeholder="Nome, e-mail do Canvas ou ID" value=""><button class="button secondary" type="submit">Buscar<\/button><\/div><\/form>/);
  assert.match(initial, /<p class="aa-hint">Busque por nome, e-mail do Canvas ou ID para ver e corrigir vínculos\.<\/p>/);
  const searching = page({ studentQuery: "li", studentSearchLoading: true });
  assert.match(searching, /<button class="button secondary" type="submit" disabled>Buscar<\/button>/);
  assert.match(searching, /<p class="aa-loading" role="status">Buscando “li”…<\/p>/);
  const html = page({ studentQuery: "li", studentResults: STUDENTS });
  assert.match(html, /<p class="aa-count" id="aa-students-count" role="status" tabindex="-1">4 alunos encontrados para “li”\.<\/p>/);
  const list = rows(block(html, "aa-student-list"));
  assert.deepEqual(list.map(strip), [
    "Lia Mota ID Canvas 31000 E-mail no Canvas lia.mota@example.test Conta do portal lia.mota@example.test · desde 24 de setembro de 2026 Visualizar como aluno Editar nome Desvincular conta",
    "Liam Duarte ID Canvas 31001 E-mail no Canvas liam.duarte@example.test Conta do portal Sem conta vinculada Visualizar como aluno Editar nome",
    "Lis &lt;i&gt;Prado&lt;/i&gt; ID Canvas 31002 E-mail no Canvas Ausente no Canvas Conta do portal Sem conta vinculada Visualizar como aluno Editar nome",
    "Lino Souza ID Canvas 31003 E-mail no Canvas lino.souza@example.test Conta do portal Vínculo sem e-mail registrado Visualizar como aluno Editar nome Desvincular conta"]);
  assert.match(list[0], /<strong class="aa-name" id="aa-stu-31000">Lia Mota<\/strong>/);
  assert.match(list[0], /<button class="button secondary" data-view-as-student="31000" aria-describedby="aa-stu-31000">Visualizar como aluno<\/button><button class="button secondary" data-start-edit-name="31000" aria-describedby="aa-stu-31000">Editar nome<\/button><button class="button aa-danger" data-unlink="31000" aria-describedby="aa-stu-31000">Desvincular conta<\/button>/);
  assert.match(page({ studentQuery: "a", studentResults: Array.from({ length: 25 }, (_, i) => ({ ...STUDENTS[1], id: String(32000 + i) })) }),
    /<p class="aa-count" id="aa-students-count" role="status" tabindex="-1">Os 25 primeiros alunos encontrados para “a”\. Refine a busca para ver outros\.<\/p>/);
  assert.match(page({ studentQuery: "Lia", studentResults: STUDENTS.slice(0, 1) }), /1 aluno encontrado para “Lia”\./);
  assert.match(page({ studentQuery: "zz<z", studentResults: [] }), /<p class="aa-count" id="aa-students-count" role="status" tabindex="-1">Nenhum aluno encontrado com esses termos\.<\/p>/);
  assert.match(page({ studentQuery: "zz<z", studentResults: [] }), /value="zz&lt;z"/);
  assert.match(page({ studentQuery: "li", studentSearchError: "Publique as notas <antes> de buscar alunos." }),
    /<p class="aa-error-line" id="aa-students-count" role="alert" tabindex="-1">Publique as notas &lt;antes&gt; de buscar alunos\.<\/p>/);
  const editing = rows(block(page({ studentQuery: "li", studentResults: STUDENTS, editingStudentId: "31000" }), "aa-student-list"))[0];
  assert.equal(editing, '<li class="aa-row aa-student is-editing"><form class="aa-rename" data-edit-name-form="31000"><label for="edit-name-31000">Nome de exibição <span class="sr-only">de Lia Mota</span></label><input id="edit-name-31000" name="displayName" value="Lia Mota" maxlength="100" required><p class="aa-hint">O portal mostra este nome; o Canvas não muda.</p><div class="aa-actions"><button class="button primary" type="submit">Salvar</button><button class="button secondary" type="button" data-cancel-edit-name>Cancelar</button></div></form></li>');
});

test("AA6: configurações da turma e criação de turma — os mesmos campos, nomes e regras, com as explicações junto de cada um", () => {
  const html = page();
  const settings = block(html, "aa-settings");
  assert.equal(strip(block(settings, "aa-settings-note")), "Referências de aprovação e o curso do Canvas desta turma. Salvar não exige publicar as notas de novo.");
  assert.match(settings, /<form id="cohort-settings-form" class="aa-form">/);
  assert.match(settings, /<fieldset class="aa-thresholds"><legend>Referências da turma<\/legend><label>Referência de KC \(%\)<input type="number" name="kc" min="1" max="100" value="60" required><\/label><label>Referência de LAB \(%\)<input type="number" name="lab" min="1" max="100" value="90" required><\/label><\/fieldset>/);
  assert.match(settings, /<label>ID do curso no Canvas \(opcional\)<input name="canvasCourseId" placeholder="Ex\.: 4436" pattern="\[0-9\]\*" value="4436"><\/label>/);
  assert.match(settings, /<label class="aa-check"><input type="checkbox" name="autoSync" checked> Atualizar e publicar as notas automaticamente pelo Canvas \(6h e 18h\)<\/label>/);
  assert.match(strip(settings), /Módulos e links das atividades vêm desse curso do Canvas e aparecem para os alunos depois da próxima atualização \(6h ou 18h\), mesmo com a atualização automática desligada\./);
  assert.match(strip(settings), /Com a opção ligada, o portal publica sozinho as notas do curso acima, sem revisão, usando a mesma regra de atividades liberadas do envio de CSV\. Não publica se nada mudou ou se o Canvas devolver a turma vazia ou bem menor que a atual\. O envio de CSV continua disponível\./);
  assert.match(settings, /<button class="button primary" type="submit">Salvar configurações<\/button>/);
  const defaults = block(page({ code: "BRSA0268" }), "aa-settings");
  assert.match(defaults, /name="kc" min="1" max="100" value="70"/);
  assert.match(defaults, /name="lab" min="1" max="100" value="95"/);
  assert.match(defaults, /<input type="checkbox" name="autoSync" >|<input type="checkbox" name="autoSync">/);
  const create = block(html, "aa-create");
  assert.match(create, /<form id="cohort-form" class="aa-form"><label>Código da turma<input name="code" placeholder="BRSA0268" required pattern="\[A-Za-z0-9-\]\{3,32\}" maxlength="32" aria-describedby="aa-code-hint"><\/label><p class="aa-hint" id="aa-code-hint">Letras, números e hífen, de 3 a 32; o código fica em maiúsculas\.<\/p><label>Nome da turma<input name="name" placeholder="AWS re\/Start · nova turma" required maxlength="100"><\/label><div class="aa-actions"><button class="button primary">Criar turma<\/button><\/div><\/form>/);
  assert.equal(strip(block(create, "aa-create-note")), "A turma começa sem notas e sem instrutores. Escolha-a no seletor de turma para configurar o curso do Canvas e publicar as notas; os instrutores entram pelas solicitações.");
});

// Andamento e erro: kind, alvo e (vínculo) a turma escolhida. O texto vem do estado da tela (pessoa, aluno, turma).
const OPS = {
  approve: { view: { kind: "approve", target: "u-carla", cohort: "BRSA0268" }, busy: "Vinculando carla.dias@instituicao.example à BRSA0268…",
    refused: "O vínculo não foi feito.", unsure: "Não foi possível confirmar o vínculo.", retry: ["refresh-requests", "Atualizar a lista"] },
  reject: { view: { kind: "reject", target: "u-carla" }, busy: "Recusando a solicitação de carla.dias@instituicao.example…",
    refused: "A solicitação não foi recusada.", unsure: "Não foi possível confirmar a recusa.", retry: ["refresh-requests", "Atualizar a lista"] },
  revoke: { view: { kind: "revoke", target: "u-ana" }, busy: "Removendo o acesso de ana.lima@instituicao.example à BRSA0267…",
    refused: "O acesso não foi removido por este pedido.", unsure: "Não foi possível confirmar a remoção do acesso.", retry: ["refresh-requests", "Atualizar a lista"] },
  unlink: { view: { kind: "unlink", target: "31000" }, busy: "Desvinculando a conta de Lia Mota…",
    refused: "A conta não foi desvinculada por este pedido.", unsure: "Não foi possível confirmar o desvínculo.", retry: ["repeat-student-search", "Buscar de novo"] },
  rename: { view: { kind: "rename", target: "31000" }, busy: "Salvando o nome de exibição de Lia Mota…", editing: "31000",
    refused: "O nome não foi alterado.", unsure: "Não foi possível confirmar o novo nome.", retry: ["repeat-student-search", "Buscar de novo"] },
  settings: { view: { kind: "settings", target: "BRSA0267" }, busy: "Salvando as configurações da BRSA0267…",
    refused: "As configurações não foram salvas.", unsure: "Não foi possível confirmar se as configurações foram salvas.", retry: ["retry-boot", "Consultar de novo"] },
  create: { view: { kind: "create", target: "BRSA0299" }, busy: "Criando a turma BRSA0299…",
    refused: "A turma não foi criada.", unsure: "Não foi possível confirmar a criação da turma.", retry: ["retry-boot", "Consultar de novo"] },
};
const GUIDE = { "refresh-requests": "O pedido pode ter sido concluído: atualize a lista antes de tentar de novo.",
  "repeat-student-search": "O pedido pode ter sido concluído: busque de novo antes de tentar outra vez.", "retry-boot": "O pedido pode ter sido concluído: consulte de novo antes de tentar outra vez." };
const WRITES = /data-reject=|data-revoke=|data-unlink=|data-start-edit-name=|>Vincular à turma<|>Conceder acesso à turma<|>Salvar configurações<|>Criar turma<|>Salvar</;

test("AA7: andamento junto do alvo, com o foco, e tudo que muda parado (ligado ao andamento); recusa (nada mudou) e dúvida (pode ter mudado) ditas de jeitos diferentes, com a consulta segura", () => {
  for (const [kind, op] of Object.entries(OPS)) {
    const values = { studentQuery: "li", studentResults: STUDENTS, editingStudentId: op.editing || null };
    const chosen = { "u-carla": "BRSA0268", "u-bruno": "BRSA0267" };
    const busy = page(values, { busy: op.view, picks: chosen });
    assert.equal(count(busy, 'id="aa-op-status"'), 1, kind);
    assert.match(busy, new RegExp(`<p class="aa-op is-busy" id="aa-op-status" role="status" tabindex="-1">${op.busy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`), kind);
    // Todas as ações que mudam algo param, com o motivo ligado; consulta (filtro, Atualizar, Buscar, Visualizar) continua.
    const buttons = [...busy.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);
    for (const b of buttons.filter((x) => WRITES.test(x))) {
      assert.match(b, / disabled/, `${kind}: ${b}`);
      assert.match(b, /aria-describedby="[^"]*\baa-op-status\b[^"]*"/, `${kind}: ${b}`);
    }
    for (const b of buttons.filter((x) => /refresh-requests|data-view-as-student|>Buscar</.test(x))) assert.doesNotMatch(b, / disabled/, `${kind}: ${b}`);
    const target = op.view.kind === "settings" ? "aa-settings" : op.view.kind === "create" ? "aa-create" : null;
    if (target) assert.match(block(busy, target), /id="aa-op-status"/, kind);
    for (const [mode, failure] of [["refused", { message: "Motivo <do servidor>." }], ["stale", { message: "Vínculo não encontrado.", stale: true }],
      ["unsure", { unsure: true, message: "A conexão com o portal falhou." }]]) {
      const html = page(values, { failure: { ...op.view, ...failure }, picks: chosen });
      const alert = block(html, "aa-op");
      assert.match(alert, /^<div class="aa-op is-error" id="aa-op-status" role="alert" tabindex="-1">/, `${kind} ${mode}`);
      const head = mode === "unsure" ? op.unsure : op.refused;
      const guide = mode === "unsure" ? ` ${GUIDE[op.retry[0]]}` : "";
      const text = `${head} ${mode === "refused" ? "Motivo &lt;do servidor&gt;." : failure.message}${guide}${mode === "refused" ? "" : ` ${op.retry[1]}`}`;
      assert.equal(strip(alert), text, `${kind} ${mode}`);
      if (mode !== "refused") assert.match(alert, new RegExp(`<button type="button" class="button secondary" id="aa-op-retry" data-action="${op.retry[0]}">${op.retry[1]}</button>`), `${kind} ${mode}`);
      for (const b of [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]).filter((x) => WRITES.test(x))) assert.doesNotMatch(b, / disabled/, `${kind} ${mode}: livre depois do erro`);
    }
  }
  // O andamento e o erro só aparecem no alvo: outro alvo, nada.
  assert.equal(count(page({}, { busy: { kind: "revoke", target: "u-outro" } }), 'id="aa-op-status"'), 0);
  assert.equal(count(page({}, { failure: { kind: "reject", target: "u-ana", message: "x" } }), 'id="aa-op-status"'), 0, "a solicitação de u-ana não está no filtro");
});

test("AA8: sem nenhuma turma — a tela diz o que fazer, e Vincular fica parado com o motivo ligado", () => {
  const html = page({ cohorts: [], code: "", instructors: [] });
  assert.deepEqual(headings(html), ["h1 Turmas e acessos", "h2 Solicitações de acesso", "h2 Nenhuma turma no portal", "h2 Criar uma turma"]);
  assert.equal(strip(block(html, "aa-cohort")), "Turma selecionada Nenhuma turma no portal Crie a primeira turma abaixo; depois, ela aparece no seletor de turma.");
  const carla = rows(block(html, "aa-request-list"))[0];
  assert.match(carla, /<select id="approve-u-carla" name="cohort" required><option value="" selected>Selecione uma turma<\/option><\/select>/);
  assert.doesNotMatch(html, /id="aa-pick-/, "sem turmas, o motivo é o de criar uma");
  assert.match(carla, /<button class="button secondary" aria-describedby="aa-req-u-carla aa-no-cohorts" disabled>Vincular à turma<\/button>/);
  assert.match(carla, /<p class="aa-reason" id="aa-no-cohorts">Crie uma turma antes de vincular instrutores\.<\/p>/);
  assert.equal(count(html, 'id="aa-no-cohorts"'), 1, "um motivo só, no primeiro pedido pendente");
});

const APPROVE_QUESTION = "Vincular carla.dias@instituicao.example à turma BRSA0268 — AWS re/Start · Turma 268?\n\nA pessoa passa a acompanhar a BRSA0268 com as permissões de instrutor: ver as notas de todos os alunos, publicar e restaurar notas, marcar desistências e enviar lembretes por e-mail aos alunos dessa turma. O acesso a outras turmas não muda.";
// Handler com transporte falso: cada chamada fica pendente até o teste responder; a pergunta é registrada.
function harness() {
  const calls = [], dialogs = [], order = [];
  let accept = true;
  globalThis.confirm = (message) => { dialogs.push(message); order.push("confirm"); return accept; };
  api.setTransport((path, options = {}) => new Promise((resolve, reject) => { order.push(`${options.method || "GET"} ${path}`); calls.push({ path, method: options.method || "GET", body: options.body, resolve, reject }); }));
  handlers.configure({ render: () => order.push("render") });
  notices.length = 0;
  const answer = async (fn) => { await Promise.resolve(); await Promise.resolve(); for (let i = 0; i < 20 && calls.some((c) => !c.done); i++) { const c = calls.find((x) => !x.done); c.done = true; fn(c); await new Promise((r) => r()); await Promise.resolve(); } };
  return { calls, dialogs, order, notices, refuse: () => { accept = false; }, answer };
}
const reply = (c, overrides = {}) => {
  if (c.path === "/requests") return c.resolve({ requests: overrides.requests || REQUESTS });
  if (c.path.endsWith("/instructors") && c.method === "GET") return c.resolve({ instructors: overrides.instructors || [] });
  if (c.path.endsWith("/students-search")) return c.resolve({ results: overrides.results || STUDENTS });
  return c.resolve(overrides.write || {});
};
async function settle(promise, h, overrides) { const done = promise.then(() => "ok", (e) => e); for (let i = 0; i < 6; i++) await h.answer((c) => reply(c, overrides)); return done; }

test("AA9: perguntas com a pessoa, a turma e a consequência; o aviso de início só depois de confirmar; avisos de sucesso com a pessoa e a turma", async () => {
  await withStateAsync({}, async () => {
    // Remover acesso: a pergunta (o mesmo confirm, no mesmo ponto) e, cancelada, nada sai.
    let h = harness(), started = 0;
    h.refuse();
    // Sem esperar a promessa: se a pergunta fosse pulada, o pedido ficaria pendente; o que conta é o que aconteceu até aqui.
    handlers.revokeInstructor("u-ana", () => started++);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(h.dialogs, ["Remover o acesso de ana.lima@instituicao.example à BRSA0267?\n\nA pessoa deixa de acompanhar a BRSA0267; o acesso a outras turmas não muda. Se ela for quem envia os lembretes automáticos da BRSA0267, eles param até outro remetente ser configurado.\n\nSe já estiver aprovada no portal, você poderá conceder o vínculo novamente em Instrutores da turma."]);
    assert.deepEqual([h.calls.length, started], [0, 0]);
    h = harness();
    let run = handlers.revokeInstructor("u-ana", () => { started++; h.order.push("started"); });
    assert.equal(await settle(run, h), "ok");
    assert.deepEqual(h.order.slice(0, 3), ["confirm", "started", "POST /cohorts/BRSA0267/revoke-instructor"]);
    assert.deepEqual(h.calls[0].body, { userId: "u-ana" });
    assert.deepEqual(h.calls.slice(1).map((c) => `${c.method} ${c.path}`).sort(), ["GET /cohorts/BRSA0267/instructors", "GET /requests"]);
    assert.deepEqual(h.notices, ["Acesso de ana.lima@instituicao.example à BRSA0267 removido."]);
    // Recusar.
    h = harness();
    run = handlers.rejectRequest("u-carla", () => h.order.push("started"));
    assert.equal(await settle(run, h), "ok");
    assert.deepEqual(h.dialogs, ["Recusar a solicitação de carla.dias@instituicao.example?\n\nA pessoa não recebe acesso de instrutor. Esta tela não tem como reabrir uma solicitação recusada, e a pessoa não consegue pedir de novo."]);
    assert.deepEqual(h.order.slice(0, 3), ["confirm", "started", "POST /requests/u-carla/reject"]);
    assert.deepEqual(h.notices, ["Solicitação de carla.dias@instituicao.example recusada."]);
    // Vincular (Expansão 8.1): a pergunta diz a pessoa, a turma (código e nome) e o que o vínculo permite; cancelada, nada sai e o
    // andamento não começa; confirmada, um pedido com os mesmos identificadores da pergunta.
    h = harness();
    h.refuse();
    let begun = 0;
    handlers.approveInstructor("u-carla", "BRSA0268", () => begun++);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(h.dialogs, [APPROVE_QUESTION]);
    assert.deepEqual([h.calls.length, begun], [0, 0], "cancelada: nada sai");
    h = harness();
    run = handlers.approveInstructor("u-carla", "BRSA0268", () => h.order.push("started"));
    assert.equal(await settle(run, h), "ok");
    assert.deepEqual(h.dialogs, [APPROVE_QUESTION]);
    assert.deepEqual(h.order.slice(0, 3), ["confirm", "started", "POST /cohorts/BRSA0268/instructors"]);
    assert.deepEqual(h.calls[0].body, { userId: "u-carla" });
    assert.deepEqual(h.notices, ["Acesso à BRSA0268 concedido a carla.dias@instituicao.example."]);
    // Sem pedido pendente com esse id, ou com uma turma fora da lista: nem pergunta nem pedido.
    for (const [user, code] of [["u-ana", "BRSA0268"], ["u-x", "BRSA0268"], ["u-carla", "BRSA9999"], ["u-carla", ""]]) {
      h = harness();
      handlers.approveInstructor(user, code, () => h.order.push("started"));
      await Promise.resolve(); await Promise.resolve();
      assert.deepEqual([h.dialogs, h.calls.length, h.order], [[], 0, []], `${user} ${code}`);
    }
    const FormDataBefore = globalThis.FormData;
    globalThis.FormData = class { constructor(f) { this.f = f; } get(name) { return { displayName: "  Ana Apelido  ", query: " li " }[name]; } };
    try {
      // Desvincular e nome de exibição: os dados do aluno da busca na pergunta e no aviso.
      Object.assign(state, { studentQuery: "li", studentResults: STUDENTS });
      h = harness();
      run = handlers.unlinkStudent("31000", () => h.order.push("started"));
      assert.equal(await settle(run, h), "ok");
      assert.deepEqual(h.dialogs, ["Desvincular a conta lia.mota@example.test de Lia Mota (ID Canvas 31000) na BRSA0267?\n\nO aluno continua na turma, com as notas; só a conta do portal deixa de estar ligada a ele. Ele poderá se vincular de novo pelo e-mail do Canvas no próximo acesso."]);
      assert.deepEqual(h.order.slice(0, 3), ["confirm", "started", "POST /cohorts/BRSA0267/unlink-student"]);
      assert.deepEqual(h.notices, ["A conta de Lia Mota foi desvinculada."]);
      Object.assign(state, { studentResults: STUDENTS });
      h = harness();
      run = handlers.unlinkStudent("31003", () => {});
      await settle(run, h);
      assert.match(h.dialogs[0], /^Desvincular a conta de Lino Souza \(ID Canvas 31003\) na BRSA0267\?/, "sem e-mail registrado no vínculo");
      Object.assign(state, { studentResults: STUDENTS, editingStudentId: "31000" });
      h = harness();
      run = handlers.saveDisplayName({ dataset: { editNameForm: "31000" } }, () => h.order.push("started"));
      assert.equal(await settle(run, h), "ok");
      assert.deepEqual([h.order[0], h.calls[0].body], ["started", { canvasId: "31000", displayName: "Ana Apelido" }]);
      assert.deepEqual(h.notices, ["“Ana Apelido” é o novo nome de exibição."]);
    } finally { globalThis.FormData = FormDataBefore; }
  });
});

test("AA10: troca de pessoa e de turma — o resultado de quem saiu não recarrega nem avisa para quem entrou; com outra turma, o aviso diz a turma da operação; resposta antiga da busca e da carga descartada", async () => {
  await withStateAsync({}, async () => {
    // Pessoa: a remoção termina depois que outra pessoa entrou na aba.
    let h = harness();
    let run = handlers.revokeInstructor("u-ana", () => {});
    await Promise.resolve();
    state.me = { email: "outra@example.test", roles: ["admin"] };
    assert.equal(await settle(run, h), "ok");
    assert.deepEqual([h.calls.length, h.notices], [1, []], "nem recarga nem aviso");
    state.me = ADMIN;
    // Turma: a recarga é da turma atual, e o aviso diz a turma em que o acesso foi removido.
    h = harness();
    run = handlers.revokeInstructor("u-ana", () => {});
    await Promise.resolve();
    state.code = "BRSA0268";
    assert.equal(await settle(run, h), "ok");
    assert.deepEqual(h.calls.slice(1).map((c) => c.path).sort(), ["/cohorts/BRSA0268/instructors", "/requests"]);
    assert.deepEqual(h.notices, ["Acesso de ana.lima@instituicao.example à BRSA0267 removido."]);
    state.code = "BRSA0267";
    // Busca: duas buscas, a primeira responde por último — fica a segunda.
    h = harness();
    const first = handlers.searchStudents("li");
    const second = handlers.searchStudents("lia");
    await Promise.resolve();
    h.calls[1].resolve({ results: STUDENTS.slice(0, 1) }); h.calls[1].done = true;
    await second;
    h.calls[0].resolve({ results: STUDENTS }); h.calls[0].done = true;
    await first;
    assert.deepEqual([state.studentQuery, state.studentResults.map((s) => s.id)], ["lia", ["31000"]]);
    // Busca de quem saiu não aparece para quem entrou; busca vazia diz o problema na tela, sem pedido.
    h = harness();
    const old = handlers.searchStudents("lino");
    await Promise.resolve();
    state.me = { email: "outra@example.test", roles: ["admin"] };
    Object.assign(state, { studentResults: null, studentQuery: "" });
    h.calls[0].resolve({ results: STUDENTS.slice(3) }); h.calls[0].done = true;
    await old;
    assert.deepEqual([state.studentResults, state.studentQuery], [null, ""]);
    state.me = ADMIN;
    h = harness();
    globalThis.FormData = class { get() { return "   "; } };
    // Sem esperar a promessa (um pedido feito ficaria pendente): o que conta é o que aconteceu até aqui.
    handlers.submitStudentSearch({});
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual([h.calls.length, state.studentSearchError, state.studentResults], [0, "Digite ao menos um caractere para buscar.", null]);
    // Busca vazia com outra busca em andamento: a resposta da anterior chega depois e não apaga o problema dito.
    h = harness();
    const pending = handlers.searchStudents("li");
    await Promise.resolve();
    handlers.submitStudentSearch({});
    await Promise.resolve(); await Promise.resolve();
    h.calls[0].resolve({ results: STUDENTS }); h.calls[0].done = true;
    await pending;
    assert.deepEqual([state.studentSearchError, state.studentResults, state.studentSearchLoading], ["Digite ao menos um caractere para buscar.", null, false]);
    // Carga de quem saiu: descartada.
    h = harness();
    const load = handlers.loadAccess();
    await Promise.resolve();
    state.me = { email: "outra@example.test", roles: ["admin"] };
    for (const c of h.calls) { reply(c, { requests: [{ userId: "u-z", email: "z@instituicao.example", status: "pending" }], instructors: INSTRUCTORS }); c.done = true; }
    await load;
    assert.deepEqual([state.requests, state.instructors, state.accessLoading], [[], [], true], "os dados de quem saiu não ficam no estado");
  });
});

test("AA11: Vincular com a turma escolhida (Expansão 8.1) — o seletor começa em “Selecione uma turma” (valor vazio, nenhuma turma marcada) e Vincular fica parado, com o motivo ligado, até a escolha; turma que não está na lista volta ao começo; a escolha de um pedido não vale para outro", () => {
  const start = rows(block(page(), "aa-request-list"));
  for (const [row, user] of [[start[0], "u-carla"], [start[1], "u-bruno"]]) {
    assert.ok(row.includes(`<select id="approve-${user}" name="cohort" required><option value="" selected>Selecione uma turma</option><option value="BRSA0267">BRSA0267 — AWS re/Start · Turma 267</option><option value="BRSA0268">BRSA0268 — AWS re/Start · Turma 268</option></select>`), user);
    assert.ok(row.includes(`<button class="button secondary" aria-describedby="aa-req-${user} aa-pick-${user}" disabled>Vincular à turma</button>`), user);
    assert.ok(row.includes(`<p class="aa-reason" id="aa-pick-${user}">Escolha a turma para vincular.</p>`), user);
    assert.equal(count(row, " selected"), 1, `${user}: só "Selecione uma turma" marcada`);
  }
  const chosen = rows(block(page({}, { picks: { "u-carla": "BRSA0268" } }), "aa-request-list"));
  assert.ok(chosen[0].includes('<option value="">Selecione uma turma</option><option value="BRSA0267">BRSA0267 — AWS re/Start · Turma 267</option><option value="BRSA0268" selected>BRSA0268 — AWS re/Start · Turma 268</option>'));
  assert.ok(chosen[0].includes('<button class="button secondary" aria-describedby="aa-req-u-carla">Vincular à turma</button>'));
  assert.doesNotMatch(chosen[0], /aa-pick-u-carla/);
  assert.ok(chosen[1].includes('<option value="" selected>Selecione uma turma</option>'), "a escolha de um pedido não vale para outro");
  assert.ok(chosen[1].includes('aria-describedby="aa-req-u-bruno aa-pick-u-bruno" disabled>Vincular à turma'));
  // Turma que não está na lista atual (saiu ou nunca existiu): volta a "Selecione uma turma", parado, com o motivo.
  const gone = rows(block(page({}, { picks: { "u-carla": "BRSA9999" } }), "aa-request-list"))[0];
  assert.ok(gone.includes('<option value="" selected>Selecione uma turma</option>'));
  assert.ok(gone.includes('aria-describedby="aa-req-u-carla aa-pick-u-carla" disabled>Vincular à turma'));
  assert.equal(count(gone, " selected"), 1);
  // Durante outra operação, mesmo com a escolha, Vincular fica parado e ligado ao andamento.
  const busy = rows(block(page({}, { picks: { "u-carla": "BRSA0268" }, busy: { kind: "reject", target: "u-bruno" } }), "aa-request-list"))[0];
  assert.ok(busy.includes('<button class="button secondary" aria-describedby="aa-req-u-carla aa-op-status" disabled>Vincular à turma</button>'));
});

test("AA12: atalho Criar turma (Expansão 8.1) — no cabeçalho, um link para o título da seção que já existe (sem outro formulário), com o destino dito à leitura assistiva; também sem turmas", () => {
  const html = page();
  assert.match(block(html, "page-heading"), /<a class="text-link aa-create-link" href="#aa-create-title">Criar turma<span class="sr-only"> — ir para o formulário, no fim da página<\/span><\/a><\/div>$/);
  assert.deepEqual([count(html, 'href="#aa-create-title"'), count(html, 'id="aa-create-title"'), count(html, 'id="cohort-form"')], [1, 1, 1]);
  assert.match(html, /<h2 id="aa-create-title" tabindex="-1">Criar uma turma<\/h2>/);
  assert.equal(count(page({ cohorts: [], code: "", instructors: [] }), 'href="#aa-create-title"'), 1, "sem turmas, o atalho leva a criar a primeira");
});

test("TODO28: concessão posterior confirma pessoa/turma, usa a rota atual e recarrega sem repetir o POST", async () => {
  await withStateAsync({ code: "BRSA0268", instructors: [] }, async () => {
    let h = harness(), started = 0;
    h.refuse();
    assert.equal(await handlers.linkApprovedInstructor("u-ana", "BRSA0268", () => started++), false);
    assert.deepEqual([h.calls.length, started], [0, 0]);
    assert.match(h.dialogs[0], /Conceder acesso de instrutor a ana\.lima@instituicao\.example na turma BRSA0268 — AWS re\/Start · Turma 268/);
    assert.match(h.dialogs[0], /vínculos com outras turmas.*lembretes automáticos não mudam/);
    h = harness();
    const run = handlers.linkApprovedInstructor("u-ana", "BRSA0268", () => h.order.push("started"));
    assert.equal(await settle(run, h, { instructors: [{ userId: "u-ana", email: REQUESTS[2].email, code: "BRSA0268" }] }), "ok");
    assert.equal(await run, true);
    assert.deepEqual(h.order.slice(0, 3), ["confirm", "started", "POST /cohorts/BRSA0268/instructors"]);
    assert.deepEqual(h.calls[0].body, { userId: "u-ana" });
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 1);
    assert.deepEqual(h.notices, ["Acesso à BRSA0268 concedido a ana.lima@instituicao.example."]);
    h = harness();
    assert.equal(await handlers.linkApprovedInstructor("u-ana", "BRSA0268"), false, "lista recarregada não oferece duplicata");
    assert.deepEqual([h.calls.length, h.dialogs.length], [0, 0]);
  });
});

test("TODO28: pendente, recusado, desconhecido, duplicado, outra turma ou listas inconclusivas não concedem acesso", async () => {
  await withStateAsync({}, async () => {
    for (const [userId, code, changes] of [
      ["u-carla", "BRSA0268", {}], ["u-diego", "BRSA0268", {}], ["u-x", "BRSA0268", {}],
      ["u-ana", "BRSA0267", { code: "BRSA0267", instructors: INSTRUCTORS }],
      ["u-ana", "BRSA0267", {}], ["u-ana", "BRSA9999", { code: "BRSA9999" }],
      ["u-ana", "BRSA0268", { accessLoading: true }], ["u-ana", "BRSA0268", { accessError: "Leitura falhou" }],
      ["u-ana", "BRSA0268", { studentView: { studentId: "101" } }],
      ["u-ana", "BRSA0268", { me: { email: "other@example.test", roles: ["instructor"] } }],
    ]) {
      Object.assign(state, { me: ADMIN, code: "BRSA0268", instructors: [], studentView: null, accessLoading: false, accessError: "", ...changes });
      const h = harness(); let started = 0;
      assert.equal(await handlers.linkApprovedInstructor(userId, code, () => started++), false);
      assert.deepEqual([h.calls.length, h.dialogs.length, started], [0, 0, 0]);
    }
  });
});

test("TODO28: erros preservam o contexto; outra sessão, inclusive A→B→A, não recebe resposta nem recarga", async () => {
  await withStateAsync({ code: "BRSA0268", instructors: [] }, async () => {
    let h = harness();
    let run = handlers.linkApprovedInstructor("u-ana", "BRSA0268");
    h.calls[0].reject(Object.assign(new Error("Resposta incerta"), { status: 503 }));
    await assert.rejects(run, (err) => err.status === 503);
    assert.equal(h.calls.length, 1, "sem repetição ou consulta após falha do POST");
    assert.deepEqual(h.notices, []);
    for (const failure of [false, true]) {
      state.me = ADMIN;
      h = harness();
      run = handlers.linkApprovedInstructor("u-ana", "BRSA0268");
      state.me = { email: "other@example.test", roles: ["admin"] };
      state.me = { ...ADMIN };
      if (failure) h.calls[0].reject(new Error("Erro da sessão anterior"));
      else h.calls[0].resolve({ approved: true });
      await run;
      assert.deepEqual([h.calls.length, h.notices.length], [1, 0]);
    }
  });
});

test("TODO28 modo aluno: resposta do POST pendente não consulta acessos nem avisa depois da troca de modo", async () => {
  for (const failed of [false, true]) await withStateAsync({ code: "BRSA0268", instructors: [] }, async () => {
    const h = harness();
    const run = handlers.linkApprovedInstructor("u-ana", "BRSA0268");
    const requests = [{ userId: "outro", status: "approved" }], instructors = [{ userId: "outro" }];
    Object.assign(state, { studentView: { code: "BRSA0268", studentId: "31000" }, view: "overview", requests, instructors, accessLoading: true, accessError: "Estado do modo aluno" });
    if (failed) h.calls[0].reject(Object.assign(new Error("Falha do administrador anterior"), { status: 503 }));
    else h.calls[0].resolve({ approved: true });
    assert.equal(await settle(run, h), "ok", "erro antigo também é suprimido");
    assert.equal(h.calls.length, 1, "a conclusão do POST não inicia GET de acessos em modo aluno");
    assert.deepEqual(h.notices, []);
    assert.deepEqual([state.requests, state.instructors, state.accessLoading, state.accessError], [requests, instructors, true, "Estado do modo aluno"], "dados, erro e finally anteriores não escrevem no outro modo");
  });
});

test("TODO28 modo aluno: recarga de acessos já pendente não escreve dados, erro, loading ou aviso depois da troca de modo", async () => {
  for (const failed of [false, true]) await withStateAsync({ code: "BRSA0268", instructors: [] }, async () => {
    const h = harness();
    const run = handlers.linkApprovedInstructor("u-ana", "BRSA0268");
    h.calls[0].resolve({ approved: true }); h.calls[0].done = true;
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.calls.length, 3, "a leitura começa no contexto administrativo original");
    const requests = [{ userId: "outro", status: "approved" }], instructors = [{ userId: "outro" }];
    Object.assign(state, { studentView: { code: "BRSA0268", studentId: "31000" }, view: "overview", requests, instructors, accessLoading: true, accessError: "Estado do modo aluno" });
    if (failed) h.calls[1].reject(new Error("Leitura administrativa antiga"));
    else h.calls[1].resolve({ requests: REQUESTS });
    h.calls[1].done = true;
    h.calls[2].resolve({ instructors: INSTRUCTORS }); h.calls[2].done = true;
    await run;
    assert.deepEqual([state.requests, state.instructors, state.accessLoading, state.accessError], [requests, instructors, true, "Estado do modo aluno"], "releitura e finally respeitam o modo em que começaram");
    assert.deepEqual(h.notices, []);
  });
});

import { current, e, formatOperationalDate, heading, plural, timeZoneLabel } from "../ui.js";
import { state } from "../state.js";

// Turmas e acessos (Expansão 8): o escopo dito — as solicitações e a criação de turma valem para o portal inteiro; instrutores,
// contas dos alunos e configurações, para a turma selecionada, identificada por código e nome. As operações são as de antes (os
// mesmos ids, data-* e formulários que o app.js liga); view traz o andamento (busy) ou o erro (failure) de uma operação, { kind,
// target, cohort? }, que a tela mostra junto do alvo, com o mesmo id (o foco fica nele), e picks, a turma escolhida em cada
// pedido (o seletor refeito continua nela; Expansão 8.1: sem escolha, "Selecione uma turma" e Vincular parado). Durante uma
// operação, tudo que muda algo fica parado, ligado ao andamento; consulta (filtro, Atualizar, Buscar, Visualizar como aluno)
// continua. Durante a carga dos acessos, campos e ações que mudam algo ficam parados, ligados ao aviso de carregamento (antes, a
// carga escondia os formulários): o redesenho do fim da carga refaz os campos e apagaria o que fosse digitado neles.
const requestStatus = { pending: ["Aguardando aprovação", "is-attention"], approved: ["Aprovada", "is-ok"], rejected: ["Recusada", "is-off"] };
const filters = [["pending", "Pendentes"], ["approved", "Aprovadas"], ["rejected", "Recusadas"], ["all", "Todas"]];
const longDate = (iso) => formatOperationalDate(iso, "longDate");
const OP = "aa-op-status";

// Ações que mudam algo: paradas durante qualquer operação, com o andamento como motivo (somado às descrições próprias), e
// durante a carga dos acessos, com o aviso de carregamento como motivo.
const LOAD = "aa-load-status";
function writeAttrs(view, describedby = "") {
  const stop = view.busy || state.accessLoading;
  const ids = [describedby, view.busy ? OP : "", state.accessLoading ? LOAD : ""].filter(Boolean).join(" ");
  return `${ids ? ` aria-describedby="${e(ids)}"` : ""}${stop ? " disabled" : ""}`;
}
// Campos dos formulários e Buscar: só a carga dos acessos os para; durante uma operação, continuam disponíveis, como antes.
const fieldAttrs = (describedby = "") => (state.accessLoading ? ` aria-describedby="${[describedby, LOAD].filter(Boolean).join(" ")}" disabled` : describedby ? ` aria-describedby="${describedby}"` : "");

// Textos de cada operação: o andamento e o erro dizem quem e qual turma (do estado da tela); a recusa diz que nada mudou, a
// dúvida diz que pode ter mudado e leva à consulta segura (a lista, a busca ou a turma de novo). Os botões de consulta dos erros
// têm id próprio: somem na recarga, e o foco não passa a outro botão com o mesmo data-action (o app.js o leva à seção).
const RETRY = {
  list: ['<button type="button" class="button secondary" id="aa-op-retry" data-action="refresh-requests">Atualizar a lista</button>', "O pedido pode ter sido concluído: atualize a lista antes de tentar de novo."],
  search: ['<button type="button" class="button secondary" id="aa-op-retry" data-action="repeat-student-search">Buscar de novo</button>', "O pedido pode ter sido concluído: busque de novo antes de tentar outra vez."],
  boot: ['<button type="button" class="button secondary" id="aa-op-retry" data-action="retry-boot">Consultar de novo</button>', "O pedido pode ter sido concluído: consulte de novo antes de tentar outra vez."],
};
const emailOf = (list, key, id) => list.find((x) => x[key] === id)?.email || "";
const nameOf = (id) => (state.studentResults || []).find((s) => s.id === id)?.name || `Canvas ID ${id}`;
const OPS = {
  approve: { busy: (op) => `Vinculando ${emailOf(state.requests, "userId", op.target)} à ${op.cohort}…`, refused: "O vínculo não foi feito.", unsure: "Não foi possível confirmar o vínculo.", retry: RETRY.list },
  reject: { busy: (op) => `Recusando a solicitação de ${emailOf(state.requests, "userId", op.target)}…`, refused: "A solicitação não foi recusada.", unsure: "Não foi possível confirmar a recusa.", retry: RETRY.list },
  revoke: { busy: (op) => `Removendo o acesso de ${emailOf(state.instructors, "userId", op.target)} à ${state.code}…`, refused: "O acesso não foi removido por este pedido.",
    unsure: "Não foi possível confirmar a remoção do acesso.", retry: RETRY.list },
  unlink: { busy: (op) => `Desvinculando a conta de ${nameOf(op.target)}…`, refused: "A conta não foi desvinculada por este pedido.", unsure: "Não foi possível confirmar o desvínculo.", retry: RETRY.search },
  rename: { busy: (op) => `Salvando o nome de exibição de ${nameOf(op.target)}…`, refused: "O nome não foi alterado.", unsure: "Não foi possível confirmar o novo nome.", retry: RETRY.search },
  settings: { busy: () => `Salvando as configurações da ${state.code}…`, refused: "As configurações não foram salvas.", unsure: "Não foi possível confirmar se as configurações foram salvas.", retry: RETRY.boot },
  create: { busy: (op) => `Criando a turma ${op.target}…`, refused: "A turma não foi criada.", unsure: "Não foi possível confirmar a criação da turma.", retry: RETRY.boot },
};
function opStatus(view, kind, target) {
  const op = view.busy || view.failure;
  if (!op || op.kind !== kind || op.target !== target) return "";
  const text = OPS[kind];
  if (view.busy) return `<p class="aa-op is-busy" id="${OP}" role="status" tabindex="-1">${e(text.busy(op))}</p>`;
  const f = view.failure, [button, guide] = text.retry;
  return `<div class="aa-op is-error" id="${OP}" role="alert" tabindex="-1"><p><strong>${f.unsure ? text.unsure : text.refused}</strong> <span>${e(f.message)}</span>${f.unsure ? ` <span>${guide}</span>` : ""}</p>${f.unsure || f.stale ? button : ""}</div>`;
}

function requestRow(r, view, noCohortsReason) {
  const id = `aa-req-${r.userId}`, [label, shape] = requestStatus[r.status] || [r.status, ""];
  const dates = [r.createdAt ? `pedido em ${longDate(r.createdAt)}` : "", r.status === "rejected" && r.rejectedAt ? `recusado em ${longDate(r.rejectedAt)}` : ""].filter(Boolean).join(" · ");
  const who = `<div class="aa-who"><strong class="aa-email" id="${e(id)}">${e(r.email)}</strong><p class="aa-request-state"><span class="aa-status${shape ? ` ${shape}` : ""}">${e(label)}</span>${dates ? `<span class="aa-date">${dates}</span>` : ""}</p></div>`;
  if (r.status !== "pending") return `<li class="aa-row aa-request">${who}</li>`;
  // Expansão 8.1: a turma só vale se foi escolhida neste pedido e ainda está na lista; sem isso, "Selecione uma turma" (valor
  // vazio, nunca a primeira da lista) e Vincular parado, com o motivo à vista e ligado ao botão (sem turmas, não há escolha).
  const none = !state.cohorts.length;
  const pick = state.cohorts.some((c) => c.code === view.picks?.[r.userId]) ? view.picks[r.userId] : "";
  const pickReason = !none && !pick ? `<p class="aa-reason" id="aa-pick-${e(r.userId)}">Escolha a turma para vincular.</p>` : "";
  const reasons = `${id}${none ? " aa-no-cohorts" : pickReason ? ` aa-pick-${r.userId}` : ""}`;
  const link = `<button class="button secondary"${writeAttrs(view, reasons).replace(/ disabled$/, "")}${view.busy || !pick ? " disabled" : ""}>Vincular à turma</button>`;
  const options = `<option value=""${pick ? "" : " selected"}>Selecione uma turma</option>${state.cohorts.map((c) => `<option value="${e(c.code)}"${pick === c.code ? " selected" : ""}>${e(c.name && c.name !== c.code ? `${c.code} — ${c.name}` : c.code)}</option>`).join("")}`;
  return `<li class="aa-row aa-request">${who}<form class="approve-form aa-link" data-user="${e(r.userId)}"><label for="approve-${e(r.userId)}">Turma <span class="sr-only">para ${e(r.email)}</span></label><select id="approve-${e(r.userId)}" name="cohort" required>${options}</select><div class="aa-actions">${link}<button class="button aa-danger" type="button" data-reject="${e(r.userId)}"${writeAttrs(view, id)}>Recusar</button></div>${noCohortsReason}${pickReason}</form>${opStatus(view, "approve", r.userId)}${opStatus(view, "reject", r.userId)}</li>`;
}

function requestsSection(view) {
  const loaded = !state.accessLoading && !state.accessError;
  const counts = Object.fromEntries(filters.map(([value]) => [value, state.requests.filter((r) => value === "all" || r.status === value).length]));
  const filtered = state.requests.filter((r) => state.requestsFilter === "all" || r.status === state.requestsFilter);
  // O motivo de Vincular parado sem turmas aparece uma vez, no primeiro pedido pendente.
  let reason = !state.cohorts.length ? '<p class="aa-reason" id="aa-no-cohorts">Crie uma turma antes de vincular instrutores.</p>' : "";
  const list = filtered.map((r) => { const html = requestRow(r, view, r.status === "pending" ? reason : ""); if (r.status === "pending") reason = ""; return html; });
  const body = state.accessLoading ? `<p class="aa-loading" id="${LOAD}" role="status">Carregando solicitações e instrutores…</p>`
    : state.accessError ? `<div class="aa-error" role="alert"><h3>Não foi possível carregar os acessos</h3><p>${e(state.accessError)}</p><button class="button primary" id="aa-load-retry" data-action="refresh-requests">Tentar novamente</button></div>`
      : list.length ? `<ul class="aa-list aa-request-list">${list.join("")}</ul>` : '<p class="aa-empty">Nenhuma solicitação neste filtro.</p>';
  return `<section class="aa-section aa-requests" aria-labelledby="aa-requests-title"><div class="aa-section-head"><div><p class="aa-scope">Portal inteiro</p><h2 id="aa-requests-title" tabindex="-1">Solicitações de acesso</h2></div><div class="aa-tools"><label for="requests-filter">Mostrar</label><select id="requests-filter">${filters
    .map(([value, label]) => `<option value="${value}"${state.requestsFilter === value ? " selected" : ""}>${label}${loaded ? ` (${counts[value]})` : ""}</option>`).join("")}</select><button class="text-link" data-action="refresh-requests">Atualizar</button></div></div>
  <p class="aa-note aa-requests-note">Instrutores pedem acesso com o e-mail institucional confirmado. Ao vincular, você escolhe a turma que a pessoa vai acompanhar.</p>${body}</section>`;
}

function instructorsSection(view) {
  const body = state.accessLoading ? '<p class="aa-note">Carregando os instrutores…</p>'
    : state.accessError ? '<p class="aa-note">Os instrutores não foram carregados.</p>'
      : state.instructors.length
        ? `<ul class="aa-list aa-instructor-list">${state.instructors.map((i) => `<li class="aa-row"><div class="aa-who"><strong class="aa-email" id="aa-ins-${e(i.userId)}">${e(i.email)}</strong><span class="aa-role">Acompanha a ${e(i.code)}</span></div><div class="aa-actions"><button class="button aa-danger" data-revoke="${e(i.userId)}"${writeAttrs(view, `aa-ins-${i.userId}`)}>Remover acesso</button></div>${opStatus(view, "revoke", i.userId)}</li>`).join("")}</ul>`
        : `<p class="aa-empty">Nenhum instrutor vinculado à ${e(state.code)}. Administradores têm acesso a todas as turmas.</p>`;
  return `<section class="aa-sub aa-instructors" aria-labelledby="aa-instructors-title"><h3 id="aa-instructors-title" tabindex="-1">Instrutores da ${e(state.code)}</h3><p class="aa-note aa-instructors-note">Quem acompanha esta turma pelo vínculo de instrutor. Administradores acessam todas as turmas sem precisar de vínculo.</p>${body}</section>`;
}

function studentRow(s, view) {
  if (state.editingStudentId === s.id)
    return `<li class="aa-row aa-student is-editing"><form class="aa-rename" data-edit-name-form="${e(s.id)}"><label for="edit-name-${e(s.id)}">Nome de exibição <span class="sr-only">de ${e(s.name)}</span></label><input id="edit-name-${e(s.id)}" name="displayName" value="${e(s.name)}" maxlength="100" required${fieldAttrs()}><p class="aa-hint">O portal mostra este nome; o Canvas não muda.</p><div class="aa-actions"><button class="button primary" type="submit"${writeAttrs(view)}>Salvar</button><button class="button secondary" type="button" data-cancel-edit-name>Cancelar</button></div></form>${opStatus(view, "rename", s.id)}</li>`;
  const id = `aa-stu-${s.id}`;
  const account = s.bound ? `${e(s.boundEmail || "Vínculo sem e-mail registrado")}${s.boundAt ? ` · desde ${longDate(s.boundAt)}` : ""}` : "Sem conta vinculada";
  return `<li class="aa-row aa-student"><div class="aa-who"><strong class="aa-name" id="${e(id)}">${e(s.name)}</strong><span class="aa-meta">ID Canvas ${e(s.id)}</span></div><dl class="aa-facts"><div><dt>E-mail no Canvas</dt><dd>${e(s.email || "Ausente no Canvas")}</dd></div><div><dt>Conta do portal</dt><dd>${account}</dd></div></dl><div class="aa-actions"><button class="button secondary" data-view-as-student="${e(s.id)}" aria-describedby="${e(id)}">Visualizar como aluno</button><button class="button secondary" data-start-edit-name="${e(s.id)}"${writeAttrs(view, id)}>Editar nome</button>${s.bound ? `<button class="button aa-danger" data-unlink="${e(s.id)}"${writeAttrs(view, id)}>Desvincular conta</button>` : ""}</div>${opStatus(view, "unlink", s.id)}</li>`;
}

function studentsSection(view) {
  const q = state.studentQuery, results = state.studentResults;
  const count = (n) => (n >= 25 ? `Os 25 primeiros alunos encontrados para “${e(q)}”. Refine a busca para ver outros.` : `${plural(n, "aluno encontrado", "alunos encontrados")} para “${e(q)}”.`);
  const body = state.studentSearchLoading ? `<p class="aa-loading" role="status">Buscando “${e(q)}”…</p>`
    : state.studentSearchError ? `<p class="aa-error-line" id="aa-students-count" role="alert" tabindex="-1">${e(state.studentSearchError)}</p>`
      : results ? `<p class="aa-count" id="aa-students-count" role="status" tabindex="-1">${results.length ? count(results.length) : "Nenhum aluno encontrado com esses termos."}</p>${results.length ? `<ul class="aa-list aa-student-list">${results.map((s) => studentRow(s, view)).join("")}</ul>` : ""}`
        : '<p class="aa-hint">Busque por nome, e-mail do Canvas ou ID para ver e corrigir vínculos.</p>';
  return `<section class="aa-sub aa-students" aria-labelledby="aa-students-title"><h3 id="aa-students-title" tabindex="-1">Alunos e contas</h3><p class="aa-note aa-students-note">No primeiro acesso, o portal liga a conta ao aluno cujo e-mail no Canvas é o mesmo da conta. Busque um aluno da publicação em vigor para ver essa ligação, corrigir o nome de exibição ou ver o portal como o aluno vê.</p><form id="student-search-form" class="aa-search"><label for="student-query">Buscar aluno</label><div class="aa-search-row"><input id="student-query" name="query" placeholder="Nome, e-mail do Canvas ou ID" value="${e(q)}"${fieldAttrs()}><button class="button secondary" type="submit"${state.accessLoading ? fieldAttrs() : state.studentSearchLoading ? " disabled" : ""}>Buscar</button></div></form>${body}</section>`;
}

function settingsSection(view) {
  const cohort = current(), thresholds = cohort?.thresholds || { kc: 70, lab: 95 };
  return `<section class="aa-sub aa-settings" aria-labelledby="aa-settings-title"><h3 id="aa-settings-title" tabindex="-1">Configurações da ${e(state.code)}</h3><p class="aa-note aa-settings-note">Referências de aprovação e o curso do Canvas desta turma. Salvar não exige publicar as notas de novo.</p><form id="cohort-settings-form" class="aa-form"><fieldset class="aa-thresholds"><legend>Referências da turma</legend><label>Referência de KC (%)<input type="number" name="kc" min="1" max="100" value="${e(thresholds.kc)}" required${fieldAttrs()}></label><label>Referência de LAB (%)<input type="number" name="lab" min="1" max="100" value="${e(thresholds.lab)}" required${fieldAttrs()}></label></fieldset><label>ID do curso no Canvas (opcional)<input name="canvasCourseId" placeholder="Ex.: 4436" pattern="[0-9]*" value="${e(cohort?.canvasCourseId || "")}"${fieldAttrs()}></label><p class="aa-hint">Módulos e links das atividades vêm desse curso do Canvas e aparecem para os alunos depois da próxima atualização (6h ou 18h), mesmo com a atualização automática desligada.</p><label class="aa-check"><input type="checkbox" name="autoSync"${cohort?.autoSync ? " checked" : ""}${fieldAttrs()}> Atualizar e publicar as notas automaticamente pelo Canvas (6h e 18h)</label><p class="aa-hint">Com a opção ligada, o portal publica sozinho as notas do curso acima, sem revisão, usando a mesma regra de atividades liberadas do envio de CSV. Não publica se nada mudou ou se o Canvas devolver a turma vazia ou bem menor que a atual. O envio de CSV continua disponível.</p><div class="aa-actions"><button class="button primary" type="submit"${writeAttrs(view)}>Salvar configurações</button></div></form>${opStatus(view, "settings", state.code)}</section>`;
}

function cohortSection(view) {
  if (!state.code)
    return '<section class="aa-section aa-cohort" aria-labelledby="aa-cohort-title"><div class="aa-cohort-head"><p class="aa-scope">Turma selecionada</p><h2 id="aa-cohort-title">Nenhuma turma no portal</h2><p class="aa-note">Crie a primeira turma abaixo; depois, ela aparece no seletor de turma.</p></div></section>';
  const name = current()?.name;
  return `<section class="aa-section aa-cohort" aria-labelledby="aa-cohort-title"><div class="aa-cohort-head"><p class="aa-scope">Turma selecionada</p><h2 id="aa-cohort-title">Turma ${e(state.code)}</h2>${name && name !== state.code ? `<p class="aa-cohort-name">${e(name)}</p>` : ""}<p class="aa-note">Instrutores, contas dos alunos e configurações valem só para esta turma. Para cuidar de outra, troque no seletor de turma.</p></div>${instructorsSection(view)}${studentsSection(view)}${settingsSection(view)}</section>`;
}

function createSection(view) {
  const target = (view.busy || view.failure)?.kind === "create" ? (view.busy || view.failure).target : null;
  return `<section class="aa-section aa-create" aria-labelledby="aa-create-title"><p class="aa-scope">Portal inteiro</p><h2 id="aa-create-title" tabindex="-1">Criar uma turma</h2><p class="aa-note aa-create-note">A turma começa sem notas e sem instrutores. Escolha-a no seletor de turma para configurar o curso do Canvas e publicar as notas; os instrutores entram pelas solicitações.</p><form id="cohort-form" class="aa-form"><label>Código da turma<input name="code" placeholder="BRSA0268" required pattern="[A-Za-z0-9-]{3,32}" maxlength="32"${fieldAttrs("aa-code-hint")}></label><p class="aa-hint" id="aa-code-hint">Letras, números e hífen, de 3 a 32; o código fica em maiúsculas.</p><label>Nome da turma<input name="name" placeholder="AWS re/Start · nova turma" required maxlength="100"${fieldAttrs()}></label><div class="aa-actions"><button class="button primary"${writeAttrs(view)}>Criar turma</button></div></form>${target ? opStatus(view, "create", target) : ""}</section>`;
}

// Expansão 8.1: o atalho do cabeçalho leva ao formulário de criação que já existe, no fim da página (âncora para o título, que
// recebe o foco; nenhum pedido, nenhum redesenho), com o destino dito à leitura assistiva.
const createShortcut = '<a class="text-link aa-create-link" href="#aa-create-title">Criar turma<span class="sr-only"> — ir para o formulário, no fim da página</span></a>';

export function accessPage(view = {}) {
  return `<div class="admin-access">${heading("", "Turmas e acessos", "Pedidos de acesso de instrutores, quem acompanha cada turma e as contas dos alunos.", createShortcut)}<p class="small">${timeZoneLabel}.</p>${requestsSection(view)}${cohortSection(view)}${createSection(view)}</div>`;
}

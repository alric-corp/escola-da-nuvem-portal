import { current, e, heading, icon, state } from "../ui.js";

const requestStatusLabels = { pending: "Aguardando aprovação", approved: "Aprovada", rejected: "Recusada" };

function settingsSection() {
  if (!state.code) return "";
  const cohort = current();
  const thresholds = cohort?.thresholds || { kc: 70, lab: 95 };
  return `<section class="panel"><h2>Configurações da ${e(state.code)}</h2><p class="small">Limites de referência e curso do Canvas associado a esta turma. Não exige publicar notas de novo nem alterar código.</p><form id="cohort-settings-form" class="stack-form"><label>Referência de KC (%)<input type="number" name="kc" min="1" max="100" value="${e(thresholds.kc)}" required></label><label>Referência de LAB (%)<input type="number" name="lab" min="1" max="100" value="${e(thresholds.lab)}" required></label><label>ID do curso no Canvas (opcional)<input name="canvasCourseId" placeholder="Ex.: 4436" pattern="[0-9]*" value="${e(cohort?.canvasCourseId || "")}"></label><p class="small">Módulos e links das atividades vêm desse curso do Canvas e aparecem para os alunos depois da próxima atualização (6h ou 18h), mesmo com a atualização automática desligada.</p><label class="checkbox-line"><input type="checkbox" name="autoSync" ${cohort?.autoSync ? "checked" : ""}> Atualizar e publicar as notas automaticamente pelo Canvas (6h e 18h)</label><p class="small">Com a opção ligada, o portal publica sozinho as notas do curso acima, sem revisão, usando a mesma regra de atividades liberadas do envio de CSV. Não publica se nada mudou ou se o Canvas devolver a turma vazia ou bem menor que a atual. O envio de CSV continua disponível.</p><button class="button primary" type="submit">Salvar configurações</button></form></section>`;
}

function requestsSection() {
  const filtered = state.requests.filter((r) => state.requestsFilter === "all" || r.status === state.requestsFilter);
  return `<section class="panel"><div class="panel-title"><div><span class="eyebrow">EQUIPE DE INSTRUÇÃO</span><h2>Solicitações de acesso</h2></div><div class="table-tools"><select id="requests-filter" aria-label="Filtrar solicitações">${[
    ["pending", "Pendentes"],
    ["approved", "Aprovadas"],
    ["rejected", "Recusadas"],
    ["all", "Todas"],
  ]
    .map(([value, label]) => `<option value="${value}" ${state.requestsFilter === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select><button class="text-link" data-action="refresh-requests">Atualizar ${icon("arrow", 16)}</button></div></div>${
    filtered.length
      ? filtered
          .map((r) =>
            r.status === "pending"
              ? `<form class="approve-form" data-user="${e(r.userId)}"><div><strong>${e(r.email)}</strong><small>Aguardando aprovação</small></div><label class="sr-only" for="approve-${e(r.userId)}">Turma para ${e(r.email)}</label><select id="approve-${e(r.userId)}" name="cohort">${state.cohorts.map((c) => `<option value="${e(c.code)}">${e(c.code)}</option>`).join("")}</select><button class="button secondary" ${!state.cohorts.length ? "disabled" : ""}>Vincular à turma</button><button class="button secondary" type="button" data-reject="${e(r.userId)}">Recusar</button></form>`
              : `<div class="approve-form"><div><strong>${e(r.email)}</strong><small>${e(requestStatusLabels[r.status] || r.status)}</small></div></div>`,
          )
          .join("")
      : '<p class="empty compact">Nenhuma solicitação neste filtro.</p>'
  }</section>`;
}

function studentRow(s) {
  if (state.editingStudentId === s.id)
    return `<tr><td colspan="4"><form class="approve-form" data-edit-name-form="${e(s.id)}"><label class="sr-only" for="edit-name-${e(s.id)}">Nome de exibição para ${e(s.name)}</label><input id="edit-name-${e(s.id)}" name="displayName" value="${e(s.name)}" maxlength="100" required><button class="button primary" type="submit">Salvar</button><button class="button secondary" type="button" data-cancel-edit-name>Cancelar</button></form></td></tr>`;
  return `<tr><td><strong>${e(s.name)}</strong><small>ID ${e(s.id)}</small></td><td>${e(s.email || "Ausente no Canvas")}</td><td>${s.bound ? e(s.boundEmail || "Vínculo sem e-mail registrado") : "Sem vínculo"}</td><td><button class="button secondary" data-start-edit-name="${e(s.id)}">Editar nome</button>${s.bound ? `<button class="button secondary" data-unlink="${e(s.id)}">Desvincular</button>` : ""}</td></tr>`;
}

function studentsSection() {
  if (!state.code) return `<section class="panel"><h2>Alunos vinculados</h2><p class="small">Selecione uma turma para buscar alunos.</p></section>`;
  return `<section class="panel"><h2>Alunos vinculados da ${e(state.code)}</h2><form id="student-search-form" class="stack-form"><label class="sr-only" for="student-query">Buscar aluno</label><input id="student-query" name="query" placeholder="Nome, e-mail ou ID Canvas" value="${e(state.studentQuery)}"><button class="button primary" type="submit" ${state.studentSearchLoading ? "disabled" : ""}>Buscar</button></form>${
    state.studentSearchError
      ? `<p role="alert">${e(state.studentSearchError)}</p>`
      : state.studentResults
        ? state.studentResults.length
          ? `<div class="table-scroll"><table><thead><tr><th>Aluno</th><th>E-mail no Canvas</th><th>Conta vinculada</th><th>Ações</th></tr></thead><tbody>${state.studentResults.map(studentRow).join("")}</tbody></table></div>`
          : '<p class="empty compact">Nenhum aluno encontrado com esses termos.</p>'
        : '<p class="small">Busque por nome, e-mail do Canvas ou ID para ver e corrigir vínculos.</p>'
  }</section>`;
}

export function accessPage() {
  const title = heading(
    "",
    "Turmas e acessos",
    "Crie turmas e gerencie os acessos dos instrutores. As solicitações abaixo são de todo o portal.",
  );
  if (state.accessLoading)
    return `${title}<section class="panel empty" role="status">Carregando solicitações e vínculos de instrutores…</section>`;
  if (state.accessError)
    return `${title}<section class="panel empty" role="alert"><h2>Não foi possível carregar os acessos</h2><p>${e(state.accessError)}</p><button class="button primary" data-action="refresh-requests">Tentar novamente</button></section>`;
  return `${title}
  <div class="two-columns"><section class="panel"><h2>Criar uma turma</h2><form id="cohort-form" class="stack-form"><label>Código da turma<input name="code" placeholder="BRSA0268" required pattern="[A-Za-z0-9-]{3,32}" maxlength="32"></label><label>Nome da turma<input name="name" placeholder="AWS re/Start · nova turma" required maxlength="100"></label><button class="button primary">Criar turma ${icon("arrow")}</button></form></section><section class="panel"><h2>Como funciona o acesso</h2><p>Instrutores solicitam acesso com o e-mail institucional confirmado. Você aprova cada pessoa e escolhe as turmas que ela pode acompanhar.</p><p>Alunos são reconhecidos pelo e-mail do Canvas no primeiro acesso. O vínculo passa a usar o ID do aluno e a conta confirmada.</p></section></div>
  ${requestsSection()}
  <section class="panel"><h2>Instrutores da ${e(state.code || "turma selecionada")}</h2>${state.instructors.length ? state.instructors.map((i) => `<div class="approve-form"><div><strong>${e(i.email)}</strong><small>Acesso à turma ${e(i.code)}</small></div><button class="button secondary" data-revoke="${e(i.userId)}">Remover acesso</button></div>`).join("") : '<p class="small">Nenhum instrutor vinculado. Administradores têm acesso global.</p>'}</section>
  ${settingsSection()}
  ${studentsSection()}`;
}

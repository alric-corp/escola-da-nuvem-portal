import { e, heading, icon, state } from "../ui.js";

export function accessPage() {
  const title = heading(
    "ADMINISTRAÇÃO DO PORTAL",
    "Turmas e acessos",
    "Crie turmas e gerencie os acessos dos instrutores. As solicitações abaixo são de todo o portal.",
  );
  if (state.accessLoading)
    return `${title}<section class="panel empty" role="status">Carregando solicitações e vínculos de instrutores…</section>`;
  if (state.accessError)
    return `${title}<section class="panel empty" role="alert"><h2>Não foi possível carregar os acessos</h2><p>${e(state.accessError)}</p><button class="button primary" data-action="refresh-requests">Tentar novamente</button></section>`;
  return `${title}
  <div class="two-columns"><section class="panel"><h2>Criar uma turma</h2><form id="cohort-form" class="stack-form"><label>Código da turma<input name="code" placeholder="BRSA0268" required pattern="[A-Za-z0-9-]{3,32}" maxlength="32"></label><label>Nome da turma<input name="name" placeholder="AWS re/Start · nova turma" required maxlength="100"></label><button class="button primary">Criar turma ${icon("arrow")}</button></form></section><section class="panel"><h2>Como funciona o acesso</h2><p>Instrutores solicitam acesso com o e-mail institucional confirmado. Você aprova cada pessoa e escolhe as turmas que ela pode acompanhar.</p><p>Alunos são reconhecidos pelo e-mail do Canvas no primeiro acesso. O vínculo passa a usar o ID do aluno e a conta confirmada.</p></section></div>
  <section class="panel"><div class="panel-title"><div><span class="eyebrow">EQUIPE DE INSTRUÇÃO</span><h2>Solicitações de acesso</h2></div><button class="text-link" data-action="refresh-requests">Atualizar ${icon("arrow", 16)}</button></div>${state.requests.length ? state.requests.map((r) => `<form class="approve-form" data-user="${e(r.userId)}"><div><strong>${e(r.email)}</strong><small>${r.status === "approved" ? "Solicitação já aprovada · consulte os vínculos abaixo" : "Aguardando aprovação"}</small></div><label class="sr-only" for="approve-${e(r.userId)}">Turma para ${e(r.email)}</label><select id="approve-${e(r.userId)}" name="cohort">${state.cohorts.map((c) => `<option value="${e(c.code)}">${e(c.code)}</option>`).join("")}</select><button class="button secondary" ${!state.cohorts.length ? "disabled" : ""}>Vincular à turma</button></form>`).join("") : '<p class="empty compact">Nenhuma solicitação por enquanto.</p>'}</section>
  <section class="panel"><h2>Instrutores da ${e(state.code || "turma selecionada")}</h2>${state.instructors.length ? state.instructors.map((i) => `<div class="approve-form"><div><strong>${e(i.email)}</strong><small>Acesso à turma ${e(i.code)}</small></div><button class="button secondary" data-revoke="${e(i.userId)}">Remover acesso</button></div>`).join("") : '<p class="small">Nenhum instrutor vinculado. Administradores têm acesso global.</p>'}</section>`;
}

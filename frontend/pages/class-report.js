import { $, badge, date, e, heading, icon, labels, metric, normalize, percent, plural, sessionContext } from "../ui.js";
import { state } from "../state.js";
import { isWithdrawn } from "../participation.js";

export function renderClassReport() {
  const classReport = state.classReport;
  const rows = classReport.students;
  // Como no painel: cartões e filtros de situação contam só ativos; desistentes continuam na tabela, depois dos ativos.
  const active = rows.filter((s) => !isWithdrawn(s)), withdrawn = rows.length - active.length;
  const filtered = rows.filter(
    (s) =>
      (state.classFilter === "all" || (!isWithdrawn(s) && s.status === state.classFilter)) &&
      normalize(s.name).includes(normalize(state.classSearch)),
  );
  if (state.classFilter === "all")
    filtered.sort((a, b) =>
      isWithdrawn(a) !== isWithdrawn(b) ? (isWithdrawn(a) ? 1 : -1) : a.name.localeCompare(b.name, "pt-BR", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  $("#app").innerHTML =
    `<main class="class-page"><header class="welcome-header"><a class="brand" href="./"><img class="brand-logo" src="./logo.png" alt="Escola da Nuvem" width="112" height="112"></a><button class="button secondary" data-action="class-exit">Voltar ao meu painel</button><button class="button secondary" data-action="logout">Sair da conta</button></header>
    <div class="topline"><div class="location-context"><span>Turma ${e(classReport.cohort)}</span><strong>Notas da turma · somente leitura</strong></div>${sessionContext()}</div>
    ${heading("NOTAS DA TURMA", `Notas da ${e(classReport.cohort)}`, "Lista completa da turma, visível apenas para instrutores e administradores.", `<button class="button secondary" data-action="class-refresh">Atualizar ${icon("clock", 16)}</button>`)}
    <section class="metrics" aria-label="Indicadores da turma">${withdrawn ? metric("Alunos ativos", active.length, plural(withdrawn, "desistente", "desistentes"), "metric-primary") : metric("Alunos na publicação", rows.length, "Última atualização da turma", "metric-primary")}${metric("Médias na referência", active.filter((s) => s.status === "ok").length, `KCs ≥ ${(classReport.thresholds && classReport.thresholds.kc) ?? 70}% e LABs ≥ ${(classReport.thresholds && classReport.thresholds.lab) ?? 95}%`)}${metric("Atenção", active.filter((s) => s.status === "attention").length, "Uma média abaixo da referência", "metric-warning")}${metric("Crítico", active.filter((s) => s.status === "critical").length, "As duas médias abaixo da referência", "metric-danger")}</section>
    <section class="panel"><div class="panel-title"><div><h2>Resultados da turma</h2><p class="small">${classReport.updatedAt ? `Atualizados em ${date(classReport.updatedAt)}` : "O instrutor ainda não publicou as notas."}</p></div><span class="count-chip">${classReport.students.length} alunos</span></div>
    <div class="table-tools"><input id="class-search" type="search" aria-label="Buscar aluno" placeholder="Buscar nome…" value="${e(state.classSearch)}"><select id="class-status-filter" aria-label="Filtrar status">${[["all", "Todos os status"], ...["ok", "attention", "critical"].map((key) => [key, labels[key]])].map(([key, label]) => `<option value="${key}" ${state.classFilter === key ? "selected" : ""}>${label}</option>`).join("")}</select></div>
    ${classReport.students.length ? `<div class="table-scroll"><table><caption class="sr-only">Médias e pendências da turma ${e(classReport.cohort)}</caption><thead><tr><th scope="col">Aluno</th><th scope="col">Média KC</th><th scope="col">Média Lab</th><th scope="col">Média geral</th><th scope="col">Realizadas</th><th scope="col">Pendências</th><th scope="col">Situação</th></tr></thead><tbody>${filtered.map((s) => `<tr><th scope="row">${e(s.name)}${isWithdrawn(s) ? '<small><span class="badge withdrawn">Desistente</span></small>' : ""}</th><td>${percent(s.kc)}</td><td>${percent(s.lab)}</td><td>${percent(s.total)}</td><td>${e(s.completed)}</td><td>${e(s.pending)}</td><td>${badge(s.status)}</td></tr>`).join("")}</tbody></table></div>${!filtered.length ? '<p class="empty" role="status">Nenhum aluno encontrado neste filtro.</p>' : ""}<p class="small">Em Todos os status, os alunos aparecem de A a Z. Graduados e alunos sem avaliação completa aparecem em Todos os status.${withdrawn ? " Desistentes aparecem por último, só em Todos os status." : ""}</p>` : '<div class="empty compact">As notas aparecerão aqui após a primeira publicação.</div>'}</section>
    <footer class="main-footer">Escola da Nuvem · AWS re/Start</footer></main>`;
}

import { activityModule, groupActivities } from "../student-journey.js";
import { e, heading, percent } from "../ui.js";
import { state } from "../state.js";

// Na ordem dos módulos no curso, como na página do aluno.
function moduleOptions(activities) {
  return groupActivities(activities).map(([name]) => name);
}

export function activityOverviewPage() {
  const all = (state.report.activities || []).filter((a) => a.active);
  const filtered = all.filter(
    (a) =>
      (state.activityOverviewKind === "all" || a.kind === state.activityOverviewKind) &&
      (state.activityOverviewModule === "all" || activityModule(a) === state.activityOverviewModule),
  );
  const sorted = [...filtered].sort((x, y) => {
    if (state.activityOverviewSort === "pending" && x.pending !== y.pending) return y.pending - x.pending;
    if (state.activityOverviewSort === "review" && x.needsReview !== y.needsReview) return y.needsReview - x.needsReview;
    return x.name.localeCompare(y.name, "pt-BR", { sensitivity: "base" });
  });
  return `${heading(
    "",
    "Visão por atividade",
    "Veja onde a turma concentra pendências e notas baixas.",
    '<button class="button secondary" data-view="overview">Voltar ao painel</button>',
  )}<section class="panel"><div class="table-tools"><label for="activity-overview-kind">Tipo <select id="activity-overview-kind">${[
    ["all", "KCs e LABs"],
    ["kc", "Somente KCs"],
    ["lab", "Somente LABs"],
  ]
    .map(([value, label]) => `<option value="${value}" ${state.activityOverviewKind === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select></label><label for="activity-overview-module">Módulo <select id="activity-overview-module"><option value="all">Todos os módulos</option>${moduleOptions(all)
    .map((name) => `<option value="${e(name)}" ${state.activityOverviewModule === name ? "selected" : ""}>${e(name)}</option>`)
    .join("")}</select></label><select id="activity-overview-sort" aria-label="Ordenar atividades">${[
    ["name", "Nome A–Z"],
    ["pending", "Mais sem nota"],
    ["review", "Mais em revisão"],
  ]
    .map(([value, label]) => `<option value="${value}" ${state.activityOverviewSort === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select></div><p class="small">Só atividades já liberadas na publicação atual aparecem aqui.</p><div class="table-scroll"><table><thead><tr><th>Atividade</th><th>Módulo</th><th>Tipo</th><th>Com nota</th><th>Sem nota</th><th>Em revisão</th><th>Média</th></tr></thead><tbody>${sorted
    .map((a) => {
      const total = a.completed + a.pending;
      const pctCompleted = total ? (a.completed / total) * 100 : null;
      const pctPending = total ? (a.pending / total) * 100 : null;
      const pctReview = a.completed ? (a.needsReview / a.completed) * 100 : null;
      return `<tr><td>${e(a.name)}</td><td>${e(activityModule(a))}</td><td>${a.kind === "kc" ? "KC" : "LAB"}</td><td>${percent(pctCompleted)}</td><td>${percent(pctPending)}</td><td>${percent(pctReview)}</td><td>${percent(a.average)}</td></tr>`;
    })
    .join("")}</tbody></table>${!sorted.length ? '<p class="empty">Nenhuma atividade liberada encontrada neste filtro.</p>' : ""}</div></section>`;
}

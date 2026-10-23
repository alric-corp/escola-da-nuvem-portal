// Módulo de cada atividade: nome e posição vêm do backend, pelo catálogo do curso no
// Canvas (todo/12). Sem catálogo (curso ainda não lido), tudo cai em "Outras atividades".
export const otherActivities = "Outras atividades";

export function activityModule(activity) {
  return activity.module || otherActivities;
}

export function needsReview(activity) {
  if (activity.state !== "completed" || !["kc", "lab"].includes(activity.kind)) return false;
  if (typeof activity.needsReview === "boolean") return activity.needsReview;
  // Compatibilidade com API anterior e demonstração; zero é uma nota válida.
  const percent = activity.score != null && Number(activity.points) > 0
    ? Number(activity.score) / Number(activity.points) * 100 : activity.percent;
  return typeof percent === "number" && Number.isFinite(percent) && percent < (activity.kind === "kc" ? 70 : 95);
}

export function nextActivities(activities) {
  // Liberadas mais recentemente primeiro; sem data (publicação antiga), mantém a ordem da publicação.
  const recentFirst = (list) => list.map((a, i) => [a, i])
    .sort(([a, i], [b, j]) => (b.releasedAt || "").localeCompare(a.releasedAt || "") || i - j)
    .map(([a]) => a);
  return [...recentFirst(activities.filter((a) => a.state === "pending")), ...recentFirst(activities.filter(needsReview))].slice(0, 3);
}

export function groupActivities(activities) {
  const groups = new Map();
  for (const activity of activities) {
    const name = activityModule(activity);
    if (!groups.has(name)) groups.set(name, { order: activity.moduleOrder ?? 1e6, items: [] });
    groups.get(name).items.push(activity);
  }
  // Ordem dos módulos no curso; "Outras atividades" por último.
  return [...groups].sort(([a, x], [b, y]) => (a === otherActivities) - (b === otherActivities) || x.order - y.order)
    .map(([name, group]) => [name, group.items]);
}

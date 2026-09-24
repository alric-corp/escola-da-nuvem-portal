import { canvasActivityEntry, cohortCanvasCourses } from "./canvas-links.js";

const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
// Módulos dos catálogos fornecidos. O código só é usado após conferir título,
// tipo e curso; nunca classificar uma atividade desconhecida só pelo número.
const modules = [
  ["Introdução ao Cloud Foundations", [...range(2, 12), 208, 209]],
  ["Linux", range(225, 253)],
  ["Redes", range(254, 267)],
  ["Introdução à segurança", range(276, 298)],
  ["Programação Python", [...range(108, 141), 223]],
  ["Bases de dados", [...range(268, 275), ...range(299, 309), 160, 162]],
  ["Arquitetura AWS", [167]],
  ["Operações do sistema", [168, 210]],
  ["Ferramentas e automação", [169, 211]],
  ["Servidores", [170, 171, 172, 173, 212]],
  ["Escala e resolução de nomes", [174, 175, 176, 213]],
  ["Tecnologia sem servidor e contêineres", [177, 178, 214]],
  ["Serviços de banco de dados da AWS", [179, 215]],
  ["Serviços de redes da AWS", [180, 181, 216]],
  ["Armazenamento e arquivamento", [182, 183, 184, 185, 217]],
  ["Monitoramento e segurança", [186, 187, 218]],
  ["Gerenciando o consumo de recursos", [188, 189, 219]],
  ["Implantação automática e repetível", [190, 191, 192, 220]],
  ["Inteligência artificial", [316]],
  ["Preparação para certificação", range(195, 207)],
];

export function activityModule(cohort, activity, courseId) {
  // courseId (de COHORT#<code>/METADATA, ver todo/12) tem prioridade sobre o mapeamento
  // fixo em cohortCanvasCourses, que fica só como compatibilidade para turmas sem essa
  // configuração ainda.
  const course = courseId ?? cohortCanvasCourses[cohort];
  const entry = canvasActivityEntry(course, activity);
  if (!entry) return "Outras atividades";
  const code = Number(entry.title.match(/^\d+/)?.[0]);
  if (code === 1) return course === "4436" ? "Ambiente de sandbox" : "Introdução ao Cloud Foundations";
  return modules.find(([, codes]) => codes.includes(code))?.[0] || "Outras atividades";
}

export function needsReview(activity) {
  if (activity.state !== "completed" || !["kc", "lab"].includes(activity.kind)) return false;
  if (typeof activity.needsReview === "boolean") return activity.needsReview;
  // Compatibilidade com API anterior e demonstração; zero é uma nota válida.
  const percent = activity.score != null && Number(activity.points) > 0
    ? Number(activity.score) / Number(activity.points) * 100 : activity.percent;
  return typeof percent === "number" && Number.isFinite(percent) && percent < (activity.kind === "kc" ? 70 : 95);
}

export function nextActivities(activities, focusIds = []) {
  const actionable = (a) => a.state === "pending" || needsReview(a);
  if (focusIds.length) return focusIds.map((id) => activities.find((a) => a.id === id)).filter((a) => a && actionable(a)).slice(0, 3);
  // Liberadas mais recentemente primeiro; sem data (publicação antiga), mantém a ordem da publicação.
  const recentFirst = (list) => list.map((a, i) => [a, i])
    .sort(([a, i], [b, j]) => (b.releasedAt || "").localeCompare(a.releasedAt || "") || i - j)
    .map(([a]) => a);
  return [...recentFirst(activities.filter((a) => a.state === "pending")), ...recentFirst(activities.filter(needsReview))].slice(0, 3);
}

export function groupActivities(cohort, activities, courseId) {
  const groups = new Map();
  for (const activity of activities) {
    const name = activityModule(cohort, activity, courseId);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(activity);
  }
  const order = ["Ambiente de sandbox", ...modules.map(([name]) => name), "Outras atividades"];
  return [...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
}

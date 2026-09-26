const activities = [
  ["001 KC · Introdução à nuvem", "kc", 90],
  ["002 Lab · Conhecendo o console", "lab", 100],
  ["003 KC · Linux e linha de comando", "kc", 80],
  ["004 Lab · Trabalhando com arquivos", "lab", 100],
  ["005 KC · Fundamentos de redes", "kc", null],
  ["006 Lab · Redes na prática", "lab", null],
  ["007 KC · Segurança na nuvem", "kc", null],
  ["008 Lab · Identidades e permissões", "lab", null],
].map(([name, kind, percent], i) => ({
  id: name,
  name,
  kind,
  // Como o backend anota a partir do catálogo do Canvas (todo/12).
  module: ["Introdução ao Cloud Foundations", "Linux", "Redes", "Introdução à segurança"][Math.floor(i / 2)],
  moduleOrder: Math.floor(i / 2),
  points: "100",
  active: i < 6,
  filled: 22,
  score: percent,
  percent,
  state: i >= 6 ? "unreleased" : percent === null ? "pending" : "completed",
}));
const student = {
  id: "101",
  name: "Marina Costa",
  email: "marina@example.test",
  kc: 56.67,
  lab: 66.67,
  total: 61.67,
  progress: 66.67,
  pending: 2,
  completed: 4,
  status: "critical",
  activities,
};
const publication = {
  id: "demo-week-3",
  publishedAt: "2026-09-13T23:00:00Z",
  filename: "BRSA0267-semana-03.csv",
};
const students = [
  "Marina Costa",
  "Rafael Oliveira",
  "Beatriz Santos",
  "Lucas Ferreira",
  "Camila Souza",
  "Pedro Almeida",
].map((name, i) => ({
  ...student,
  id: `${101 + i}`,
  name,
  email: `aluno${i + 1}@example.test`,
  kc: [56.67, 85, 92, 65, 80, 76][i],
  lab: [66.67, 100, 100, 96, 80, 100][i],
  total: [61.67, 92.5, 96, 80.5, 80, 88][i],
  progress: [66.67, 100, 100, 83.33, 83.33, 100][i],
  pending: [2, 0, 0, 1, 1, 0][i],
  status: ["critical", "ok", "graduated", "attention", "attention", "ok"][i],
  portalLinked: [false, true, true, false, true, true][i],
}));
export function demoAPI(role) {
  return async (path, options = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (path.endsWith("/pending-preview")) {
      const own = students.find((s) => s.id === options.body.studentId);
      return {
        student: own,
        activities: own.activities.filter((a) => a.state === "pending"),
        publicationId: publication.id,
        publishedAt: publication.publishedAt,
        message: {
          to: own.email,
          from: "portal@example.test",
          replyTo: "instrutor@example.test",
          subject: "Podemos ajudar?",
          text: `Olá, ${own.name}!\n\nPrecisa de algum auxílio com as atividades pendentes?`,
        },
        ses: {
          ready: false,
          reason: "Envio indisponível na demonstração local.",
        },
        delivery: null,
      };
    }
    if (options.method === "POST")
      throw new Error(
        "Esta é uma demonstração. Alterações e publicações ficam disponíveis no portal conectado.",
      );
    if (path === "/me")
      return {
        userId: "demo",
        email: role === "student" ? student.email : "instrutor@example.test",
        roles: [role],
        instructorCandidate: false,
      };
    if (path === "/cohorts")
      return {
        cohorts: [
          {
            code: "BRSA0267",
            name: "AWS re/Start · BRSA0267",
            canTeach: role !== "student",
            current: publication.id,
            // Como as turmas em produção: atualização automática pelo Canvas ligada.
            autoSync: true,
          },
        ],
      };
    if (path === "/requests") return { requests: [] };
    // Feedback de demonstração: nada é gravado.
    if (/^\/feedback\/[^/]+\/attachments/.test(path)) return { items: [], canAdd: false };
    if (path.startsWith("/feedback") && options.method === "POST")
      return { duplicate: false, feedback: { id: "demo", ...options.body, status: "NEW", createdAt: new Date().toISOString() } };
    if (path.startsWith("/feedback"))
      return { nextCursor: null, items: [{ id: "demo-1", type: "SUGGESTION", title: "Adicionar modo escuro", description: "", status: "RESOLVED",
        createdAt: "2026-09-25T12:00:00Z", cohort: "BRSA0267", page: "overview" }] };
    if (path.endsWith("/class-report"))
      return {
        cohort: "BRSA0267",
        updatedAt: publication.publishedAt,
        thresholds: { kc: 70, lab: 95 },
        students: students.map(
          ({ name, kc, lab, total, completed, pending, status }) => ({
            name,
            kc,
            lab,
            total,
            completed,
            pending,
            status,
          }),
        ),
      };
    if (path.endsWith("/report"))
      return role !== "student"
        ? { publication, students, activities, history: [publication], thresholds: { kc: 70, lab: 95 }, canvasCourseId: "4436",
            updateKind: "canvas", canvasSync: { status: "unchanged", at: publication.publishedAt, message: "Nenhuma mudança no Canvas desde a última publicação." } }
        : {
            publication,
            student,
            thresholds: { kc: 70, lab: 95 },
            canvasCourseId: "4436",
            history: [
              {
                publishedAt: publication.publishedAt,
                total: 61.67,
                kc: 56.67,
                lab: 66.67,
              },
              {
                publishedAt: "2026-09-06T23:00:00Z",
                total: 48,
                kc: 46,
                lab: 50,
              },
              {
                publishedAt: "2026-08-30T23:00:00Z",
                total: 30,
                kc: 35,
                lab: 25,
              },
            ],
          };
    throw new Error("Página não encontrada.");
  };
}

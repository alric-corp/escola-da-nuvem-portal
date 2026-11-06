import { defaultPracticeExamId, practiceDomains, practiceExamById, practiceExams, practiceMetadata } from "./practice-content.js";

const questionsByExam = new Map(practiceExams.map((exam) => [exam.id, new Map(exam.questions.map((question) => [question.id, question]))]));
export const questionById = (id, examId = defaultPracticeExamId) => questionsByExam.get(examId)?.get(id);
export const freshPractice = (examId = defaultPracticeExamId) => ({ bank: examId, current: null, history: [] });
// O primeiro conjunto mantém a chave anterior para preservar tentativas já salvas.
export const practiceKey = (owner, examId = defaultPracticeExamId) => `avanca.practice.${encodeURIComponent(owner.trim().toLowerCase())}${examId === defaultPracticeExamId ? "" : `.exam.${encodeURIComponent(examId)}`}`;
export const practiceSelectionKey = (owner) => `${practiceKey(owner)}.selected`;
export const practiceTimeLimits = [90, 135, 180, null];
// Tentativas anteriores à escolha de tempo: exame com 90 min e prática sem limite.
export const timeLimitFor = (attempt) => attempt.timeLimitMinutes === undefined ? attempt.deadline === null ? null : practiceMetadata.minutes : attempt.timeLimitMinutes;
export function sameAnswers(question, answers = []) {
  return answers.length === question.correct.length && new Set(answers).size === answers.length &&
    question.correct.every((id) => answers.includes(id));
}
export function shuffleQuestions(ids, random = Math.random) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
export function startPractice(model, { mode = "study", domain = "all", count = "all", shuffle = true,
  timeLimitMinutes = practiceMetadata.minutes, questionIds = null } = {}, now = Date.now(), random = Math.random) {
  if (model.current && !model.current.completedAt) return false;
  const exam = practiceExamById(model.bank), byId = questionsByExam.get(model.bank);
  if (!exam) return false;
  if (!["study", "exam"].includes(mode) || !practiceTimeLimits.includes(timeLimitMinutes)) return false;
  if (questionIds !== null && (!Array.isArray(questionIds) || new Set(questionIds).size !== questionIds.length || !questionIds.every((id) => byId.has(id)))) return false;
  const pool = questionIds || exam.questions.filter((question) => mode === "exam" || domain === "all" || question.domain === domain).map(({ id }) => id);
  if (!pool.length) return false;
  const limit = mode === "exam" ? pool.length : Math.max(1, Math.min(pool.length, Number(count) || pool.length));
  model.current = {
    id: `${now}-${random().toString(36).slice(2, 10)}`, examId: exam.id, mode,
    questionIds: (mode === "exam" || shuffle ? shuffleQuestions(pool, random) : pool).slice(0, limit),
    answers: {}, checked: [], flagged: [], index: 0, startedAt: now,
    timeLimitMinutes, deadline: timeLimitMinutes === null ? null : now + timeLimitMinutes * 60000,
    completedAt: null, timedOut: false,
  };
  return true;
}
export const remainingSeconds = (attempt, now = Date.now()) => attempt?.deadline ? Math.max(0, Math.ceil((attempt.deadline - now) / 1000)) : null;
export const formatRemaining = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
export function selectPracticeAnswer(attempt, optionId, now = Date.now()) {
  if (!attempt || attempt.completedAt || (attempt.deadline && now >= attempt.deadline)) return false;
  const question = questionById(attempt.questionIds[attempt.index], attempt.examId);
  if (!question || !question.options.some(({ id }) => id === optionId) || attempt.checked.includes(question.id)) return false;
  const selected = attempt.answers[question.id] || [];
  if (question.correct.length === 1) attempt.answers[question.id] = [optionId];
  else if (selected.includes(optionId)) attempt.answers[question.id] = selected.filter((id) => id !== optionId);
  else if (selected.length < question.correct.length) attempt.answers[question.id] = [...selected, optionId].sort();
  else return false;
  return true;
}
export function checkPracticeAnswer(attempt) {
  if (!attempt || attempt.completedAt || attempt.mode !== "study") return false;
  const question = questionById(attempt.questionIds[attempt.index], attempt.examId);
  if (!question || (attempt.answers[question.id] || []).length !== question.correct.length || attempt.checked.includes(question.id)) return false;
  attempt.checked.push(question.id);
  return true;
}
export function finishPractice(model, now = Date.now(), timedOut = false) {
  const attempt = model.current;
  if (!attempt || attempt.completedAt) return false;
  attempt.timedOut = attempt.deadline !== null && (timedOut || now >= attempt.deadline);
  attempt.completedAt = attempt.timedOut ? attempt.deadline : Math.max(now, attempt.startedAt);
  // Um mesmo término nunca duplica o histórico, mesmo com clique e timer próximos.
  model.history = [structuredClone(attempt), ...model.history.filter(({ id }) => id !== attempt.id)].slice(0, 20);
  return true;
}
export function expirePractice(model, now = Date.now()) {
  return !!(model.current && !model.current.completedAt && model.current.deadline && now >= model.current.deadline && finishPractice(model, now, true));
}
export function practiceResult(attempt) {
  const questions = attempt.questionIds.map((id) => questionById(id, attempt.examId));
  const answered = questions.filter((question) => (attempt.answers[question.id] || []).length === question.correct.length).length;
  const correct = questions.filter((question) => sameAnswers(question, attempt.answers[question.id])).length;
  const domains = practiceDomains.map((domain) => {
    const items = questions.filter((question) => question.domain === domain.id);
    const hits = items.filter((question) => sameAnswers(question, attempt.answers[question.id])).length;
    return { ...domain, total: items.length, correct: hits, percent: items.length ? Math.round(hits / items.length * 100) : null };
  });
  return { total: questions.length, answered, unanswered: questions.length - answered, correct,
    incorrect: questions.length - correct, percent: Math.round(correct / questions.length * 100), domains,
    wrongIds: questions.filter((question) => !sameAnswers(question, attempt.answers[question.id])).map(({ id }) => id) };
}

// O armazenamento local não é uma fonte de pontuação: validar IDs e recalcular tudo com o banco vigente.
function validAttempt(attempt, examId, completed = false) {
  if (!attempt || typeof attempt.id !== "string" || attempt.id.length > 100 || !["study", "exam"].includes(attempt.mode)) return false;
  const byId = questionsByExam.get(examId);
  if (!byId || (attempt.examId ?? defaultPracticeExamId) !== examId) return false;
  const ids = attempt.questionIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > byId.size || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) return false;
  if (!Number.isInteger(attempt.index) || attempt.index < 0 || attempt.index >= ids.length) return false;
  if (!Number.isFinite(attempt.startedAt) || attempt.startedAt <= 0 || attempt.startedAt > 8640000000000000 || typeof attempt.timedOut !== "boolean") return false;
  const minutes = timeLimitFor(attempt);
  if (!practiceTimeLimits.includes(minutes) || attempt.deadline !== (minutes === null ? null : attempt.startedAt + minutes * 60000)) return false;
  if (attempt.timedOut && (attempt.deadline === null || attempt.completedAt !== attempt.deadline)) return false;
  if (attempt.completedAt !== null && (!Number.isFinite(attempt.completedAt) || attempt.completedAt < attempt.startedAt || attempt.completedAt > 8640000000000000)) return false;
  if (completed && attempt.completedAt === null) return false;
  if (!attempt.answers || typeof attempt.answers !== "object" || Array.isArray(attempt.answers)) return false;
  for (const [key, answers] of Object.entries(attempt.answers)) {
    const id = Number(key), question = byId.get(id);
    if (!ids.includes(id) || !Array.isArray(answers) || answers.length > question.correct.length || new Set(answers).size !== answers.length ||
      !answers.every((answer) => question.options.some(({ id }) => id === answer))) return false;
  }
  for (const list of [attempt.checked, attempt.flagged]) {
    if (!Array.isArray(list) || new Set(list).size !== list.length || !list.every((id) => ids.includes(id))) return false;
  }
  if (attempt.mode === "exam" && attempt.checked.length) return false;
  return attempt.checked.every((id) => (attempt.answers[id] || []).length === byId.get(id).correct.length);
}
export function restorePractice(serialized, examId = defaultPracticeExamId) {
  if (!serialized) return freshPractice(examId);
  try {
    const model = JSON.parse(serialized);
    if (!practiceExamById(examId) || model.bank !== examId || !Array.isArray(model.history) || model.history.length > 20 ||
      !model.history.every((attempt) => validAttempt(attempt, examId, true)) || (model.current !== null && !validAttempt(model.current, examId))) return freshPractice(examId);
    const normalize = (attempt) => ({ ...attempt, examId, timeLimitMinutes: timeLimitFor(attempt) });
    return { bank: model.bank, current: model.current ? normalize(model.current) : null, history: model.history.map(normalize) };
  } catch { return freshPractice(examId); }
}

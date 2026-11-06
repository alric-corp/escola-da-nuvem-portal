import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPracticeExamId, practiceDomains, practiceExams } from "../frontend/practice-content.js";
import { checkPracticeAnswer, expirePractice, finishPractice, freshPractice, practiceKey, practiceResult,
  questionById, remainingSeconds, restorePractice, sameAnswers, selectPracticeAnswer, startPractice } from "../frontend/practice.js";

const now = Date.parse("2026-11-06T12:00:00Z");
const practiceQuestions = practiceExams[0].questions;
const start = (options = {}) => { const model = freshPractice(); startPractice(model, { shuffle: false, ...options }, now, () => .25); return model; };
test("banco contém as 65 questões e o gabarito completo, incluindo a correção da questão 7", () => {
  const expected = "AB C AB A B A C C BC A D A D C B A A BD B D A C A B D A A D D B C C C A AC B BD AD A BD B C D B D D C D BE BE D CD B A B B A B B D A A A DE D".split(" ");
  assert.deepEqual(practiceQuestions.map(({ id }) => id), Array.from({ length: 65 }, (_, i) => i + 1));
  assert.deepEqual(practiceQuestions.map(({ correct }) => correct.join("")), expected);
  assert.equal(practiceDomains.reduce((total, domain) => total + domain.weight, 0), 100);
  for (const question of practiceQuestions) {
    assert.ok(question.options.length >= 4);
    assert.equal(question.options.length === 5, question.correct.length === 2);
    assert.ok(question.options.every((option) => option.text && option.explanation && /^[A-E]$/.test(option.id)));
    assert.ok(question.correct.every((id) => question.options.some((option) => option.id === id)));
    assert.match(question.source, /^https:\/\/(?:aws\.amazon\.com|docs\.aws\.amazon\.com)\//);
  }
});
test("múltipla escolha exige o conjunto exato, sem crédito parcial nem duplicatas", () => {
  const question = practiceQuestions[0];
  assert.equal(sameAnswers(question, ["B", "A"]), true);
  for (const selection of [[], ["A"], ["A", "C"], ["A", "A"], ["A", "B", "C"]]) assert.equal(sameAnswers(question, selection), false);
  const model = start(), attempt = model.current;
  selectPracticeAnswer(attempt, "A", now);
  assert.equal(checkPracticeAnswer(attempt), false);
  assert.equal(practiceResult(attempt).unanswered, 65);
  selectPracticeAnswer(attempt, "B", now);
  assert.equal(selectPracticeAnswer(attempt, "C", now), false, "não aceita uma terceira alternativa");
  assert.equal(checkPracticeAnswer(attempt), true);
  assert.equal(selectPracticeAnswer(attempt, "A", now), false, "resposta conferida não é alterada");
  assert.equal(practiceResult(attempt).correct, 1);
});
test("os dois simulados têm 65 questões em PT-BR, gabaritos próprios e referências em português", () => {
  assert.equal(practiceExams.length, 2);
  assert.equal(new Set(practiceExams.map(({ id }) => id)).size, 2);
  const expectedSecond = "D A B A B AC C B B C A C B B A B D C C A B D B D AE C C A B A C C A BE D A D C B AD A D B C CD A B D D AE A A B A D DE B A B A C AD C BC BE".split(" ");
  assert.deepEqual(practiceExams[1].questions.map(({ correct }) => correct.join("")), expectedSecond);
  assert.deepEqual(practiceDomains.map(({ id }) => practiceExams[1].questions.filter((question) => question.domain === id).length), [14, 20, 22, 9]);
  for (const exam of practiceExams) {
    assert.equal(exam.locale, "pt-BR");
    assert.deepEqual(exam.questions.map(({ id }) => id), Array.from({ length: 65 }, (_, i) => i + 1));
    for (const question of exam.questions) {
      assert.match(question.source, /^https:\/\/(?:aws\.amazon\.com\/pt\/|docs\.aws\.amazon\.com\/pt_br\/)/);
      assert.doesNotMatch(question.prompt, /\b(?:Which|What|According to|A company|A user)\b/);
      assert.ok(question.options.every((option) => option.text && option.explanation));
      assert.equal(question.options.length === 5, question.correct.length === 2);
      assert.ok(question.correct.every((answer) => question.options.some(({ id }) => id === answer)));
    }
  }
});
test("IDs iguais em simulados distintos usam o próprio gabarito e não aceitam histórico de outro conjunto", () => {
  const first = freshPractice(defaultPracticeExamId), second = freshPractice(practiceExams[1].id);
  for (const model of [first, second]) startPractice(model, { count: 1, shuffle: false }, now);
  for (const answer of ["A", "B"]) selectPracticeAnswer(first.current, answer, now);
  selectPracticeAnswer(second.current, "D", now);
  assert.equal(practiceResult(first.current).correct, 1);
  assert.equal(practiceResult(second.current).correct, 1);
  assert.deepEqual(questionById(1, first.bank).correct, ["A", "B"]);
  assert.deepEqual(questionById(1, second.bank).correct, ["D"]);
  finishPractice(first, now + 1000); finishPractice(second, now + 1000);
  assert.deepEqual(restorePractice(JSON.stringify(second), second.bank), second);
  assert.deepEqual(restorePractice(JSON.stringify(second), first.bank), freshPractice(first.bank));
  assert.deepEqual(restorePractice(JSON.stringify(first), second.bank), freshPractice(second.bank));
  const tampered = structuredClone(second); tampered.current.examId = first.bank;
  assert.deepEqual(restorePractice(JSON.stringify(tampered), second.bank), freshPractice(second.bank));
  assert.notEqual(practiceKey("one@example.test", first.bank), practiceKey("one@example.test", second.bank));
  assert.equal(practiceKey("one@example.test", first.bank), "avanca.practice.one%40example.test");
});
test("simulado usa todas as questões, não revela respostas e não permite conferir antes do fim", () => {
  const model = start({ mode: "exam", domain: "2", count: 10 });
  assert.equal(model.current.questionIds.length, 65);
  assert.equal(checkPracticeAnswer(model.current), false);
  assert.equal(remainingSeconds(model.current, now), 5400);
  const restored = restorePractice(JSON.stringify(model));
  assert.equal(remainingSeconds(restored.current, now + 60000), 5340);
  assert.equal(selectPracticeAnswer(restored.current, "A", now + 5400000), false);
  assert.equal(expirePractice(restored, now + 5400000), true);
  assert.equal(restored.current.timedOut, true);
  assert.equal(restored.current.completedAt, model.current.deadline);
  assert.equal(practiceResult(restored.current).unanswered, 65);
  assert.equal(expirePractice(restored, now + 5500000), false);
  assert.equal(finishPractice(restored, now + 5600000), false);
  assert.equal(restored.history.length, 1);
});
test("resultados por domínio totalizam o resultado e ausência de questões não vira 100%", () => {
  const model = start();
  for (const question of practiceQuestions) model.current.answers[question.id] = [...question.correct];
  const result = practiceResult(model.current);
  assert.equal(result.correct, 65); assert.equal(result.percent, 100);
  assert.equal(result.domains.reduce((sum, domain) => sum + domain.correct, 0), 65);
  assert.equal(result.unanswered, 0);
  finishPractice(model, now + 10000);
  const filtered = start({ domain: "2", count: 10 });
  assert.equal(filtered.current.questionIds.length, 10);
  assert.equal(practiceResult(filtered.current).domains[0].percent, null);
  assert.equal(practiceResult(filtered.current).domains[1].total, 10);
  assert.equal(startPractice(model, { domain: "invalid" }, now), false);
});
test("os dois modos aceitam 90, 135, 180 minutos ou tempo ilimitado e retomam o mesmo prazo", () => {
  for (const mode of ["study", "exam"]) for (const minutes of [90, 135, 180, null]) {
    const model = start({ mode, timeLimitMinutes: minutes });
    assert.equal(model.current.timeLimitMinutes, minutes);
    assert.equal(model.current.deadline, minutes === null ? null : now + minutes * 60000);
    const restored = restorePractice(JSON.stringify(model));
    assert.deepEqual(restored, model);
    assert.equal(remainingSeconds(restored.current, now + 60000), minutes === null ? null : (minutes - 1) * 60);
    if (minutes === null) {
      assert.equal(expirePractice(restored, now + 86400000), false);
      assert.equal(selectPracticeAnswer(restored.current, "A", now + 86400000), true);
      finishPractice(restored, now + 86400000, true);
      assert.equal(restored.current.timedOut, false);
      assert.equal(restored.current.completedAt, now + 86400000);
    } else {
      assert.equal(expirePractice(restored, now + minutes * 60000 - 1), false);
      assert.equal(expirePractice(restored, now + minutes * 60000), true);
      assert.equal(restored.current.completedAt, model.current.deadline);
    }
  }
  assert.equal(start().current.timeLimitMinutes, 90);
  for (const minutes of [0, 91, -1, "135", Infinity]) {
    const model = freshPractice();
    assert.equal(startPractice(model, { timeLimitMinutes: minutes }, now), false);
    assert.equal(model.current, null);
  }
});
test("tentativas antigas conservam os 90 minutos do exame e a prática sem limite", () => {
  for (const [mode, minutes] of [["exam", 90], ["study", null]]) {
    const model = start({ mode, timeLimitMinutes: minutes });
    finishPractice(model, now + 10000);
    const legacy = structuredClone(model);
    delete legacy.current.timeLimitMinutes; delete legacy.history[0].timeLimitMinutes;
    delete legacy.current.examId; delete legacy.history[0].examId;
    assert.deepEqual(restorePractice(JSON.stringify(legacy)), model);
  }
  const invalid = start({ timeLimitMinutes: 135 }); invalid.current.timeLimitMinutes = 180;
  assert.deepEqual(restorePractice(JSON.stringify(invalid)), freshPractice());
});

test("visibilidade é opcional no legado, pertence à tentativa e não muda prazo, resultado ou expiração", () => {
  const model = start(), original = structuredClone(model.current), result = practiceResult(model.current);
  model.current.timerVisible = false;
  const restored = restorePractice(JSON.stringify(model));
  assert.equal(restored.current.timerVisible, false);
  for (const key of ["id", "startedAt", "deadline", "timeLimitMinutes"]) assert.equal(restored.current[key], original[key]);
  assert.deepEqual(practiceResult(restored.current), result);
  assert.equal(expirePractice(restored, original.deadline), true);
  assert.equal(restored.history[0].timerVisible, false);
  startPractice(restored, {}, original.deadline + 1000);
  assert.equal(restored.current.timerVisible, true);
  delete restored.current.timerVisible;
  assert.equal(restorePractice(JSON.stringify(restored)).current.timerVisible, true);
});
test("não sobrescreve tentativa em andamento; conclusão é idempotente e histórico tem cópias independentes", () => {
  const model = start({ count: 10 });
  const original = model.current;
  assert.equal(startPractice(model, { mode: "exam" }, now), false);
  assert.equal(model.current, original);
  finishPractice(model, now + 1000); finishPractice(model, now + 2000);
  assert.equal(model.history.length, 1);
  model.current.answers[1] = ["A", "B"];
  assert.equal(model.history[0].answers[1], undefined);
  for (let i = 0; i < 25; i++) { startPractice(model, { count: 1 }, now + 3000 + i); finishPractice(model, now + 4000 + i); }
  assert.equal(model.history.length, 20);
});
test("storage corrompido, IDs inválidos e respostas forjadas não chegam à correção", () => {
  for (const serialized of ["invalid", "null", "[]", '{"bank":"antigo"}']) assert.deepEqual(restorePractice(serialized), freshPractice());
  const valid = start({ count: 10 });
  assert.deepEqual(restorePractice(JSON.stringify(valid)), valid);
  const mutations = [
    (model) => { model.current.questionIds = [1, 1]; },
    (model) => { model.current.answers = { 1: ["Z"] }; },
    (model) => { model.current.answers = { 999: ["A"] }; },
    (model) => { model.current.checked = [1]; },
    (model) => { model.current.index = 99; },
    (model) => { model.history = [model.current]; },
  ];
  for (const mutate of mutations) { const model = structuredClone(valid); mutate(model); assert.deepEqual(restorePractice(JSON.stringify(model)), freshPractice()); }
});
test("tentativas ficam separadas por conta; armazenamento indisponível mantém o treino em memória", async () => {
  globalThis.location = { hostname: "portal.test", search: "" };
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const { state } = await import("../frontend/state.js"), handlers = await import("../frontend/handlers/practice.js");
  handlers.configure({ render() {} });
  Object.assign(state, { view: "practice", studentView: null, practice: null, me: { email: "one@example.test" } });
  const begin = () => { handlers.action("setup"); handlers.setting("shuffle", false); handlers.setting("count", "10"); handlers.action("start"); };
  begin(); handlers.answer("A");
  assert.deepEqual(state.practice.model.current.answers[1], ["A"]);
  state.me = { email: "two@example.test" }; assert.equal(handlers.view().model.current, null);
  state.me = { email: "one@example.test" }; assert.deepEqual(handlers.view().model.current.answers[1], ["A"]);
  handlers.action("resume");
  assert.equal(state.practice.model.current.checked.length, 0, "não revela explicações com seleção dupla incompleta");
  assert.equal(handlers.answer("B"), "explanation");
  assert.deepEqual(state.practice.model.current.checked, [1], "revela a explicação imediatamente ao completar a seleção");
  handlers.action("jump", "1"); assert.equal(handlers.answer("C"), "explanation", "também corrige imediatamente a seleção única");
  assert.ok(storage.has(practiceKey("ONE@example.test")));
  state.studentView = { studentId: "101" }; assert.equal(handlers.view(), null);
  state.studentView = null; state.practice = null;
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  begin(); handlers.answer("A");
  assert.equal(state.practice.storageError, true); assert.deepEqual(state.practice.model.current.answers[1], ["A"]);
});
test("trocar de simulado preserva tentativas, históricos e seleção na própria conta", async () => {
  globalThis.location = { hostname: "portal.test", search: "" };
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const { state } = await import("../frontend/state.js"), handlers = await import("../frontend/handlers/practice.js");
  handlers.configure({ render() {} });
  Object.assign(state, { view: "practice", studentView: null, practice: null, me: { email: "multi@example.test" } });
  const begin = () => { handlers.action("setup"); handlers.setting("shuffle", false); handlers.setting("count", "10"); handlers.action("start"); };
  begin(); handlers.answer("A"); handlers.answer("B");
  const firstId = state.practice.model.current.id;
  handlers.action("home"); handlers.setting("exam", practiceExams[1].id);
  assert.equal(state.practice.model.current, null);
  begin(); handlers.answer("D");
  assert.equal(practiceResult(state.practice.model.current).correct, 1);
  handlers.action("home"); handlers.setting("exam", defaultPracticeExamId);
  assert.equal(state.practice.model.current.id, firstId);
  assert.deepEqual(state.practice.model.current.answers[1], ["A", "B"]);
  assert.equal(practiceResult(state.practice.model.current).correct, 1);
  handlers.action("resume"); handlers.action("request-finish"); handlers.action("finish");
  assert.equal(state.practice.model.history.length, 1);
  handlers.action("home"); handlers.setting("exam", practiceExams[1].id);
  assert.deepEqual(state.practice.model.current.answers[1], ["D"]);
  assert.equal(state.practice.model.history.length, 0);
  handlers.action("resume"); handlers.action("request-finish"); handlers.action("finish");
  state.practice = null;
  assert.equal(handlers.view().examId, practiceExams[1].id, "retoma o simulado selecionado após recarga");
  assert.equal(state.practice.model.history.length, 1);
  assert.equal(practiceResult(state.practice.model.history[0]).correct, 1);
  handlers.setting("exam", defaultPracticeExamId);
  assert.equal(state.practice.model.history.length, 1);
  assert.equal(practiceResult(state.practice.model.history[0]).correct, 1);
  state.me = { email: "another@example.test" };
  assert.equal(handlers.view().model.history.length, 0);
  assert.equal(state.practice.examId, defaultPracticeExamId);
});

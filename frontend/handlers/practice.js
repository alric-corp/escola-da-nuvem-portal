import { state } from "../state.js";
import { demo } from "../ui.js";
import { checkPracticeAnswer, expirePractice, finishPractice, formatRemaining, freshPractice, practiceKey, practiceSelectionKey,
  practiceResult, remainingSeconds, restorePractice, selectPracticeAnswer, startPractice } from "../practice.js";
import { defaultPracticeExamId, practiceDomains, practiceExamById } from "../practice-content.js";

let render = () => {};
const owner = () => state.me?.email?.trim().toLowerCase() || "";
const allowed = () => !!owner() && !state.studentView;
const freshSetup = (questionIds = null) => ({ mode: "study", extended: false, time: "135", domain: "all", count: "all", shuffle: true, questionIds });
function ensure() {
  if (!allowed()) return null;
  if (state.practice?.owner !== owner()) {
    let examId = defaultPracticeExamId, storageError = false;
    if (!demo) {
      try {
        const saved = localStorage.getItem(practiceSelectionKey(owner()));
        if (practiceExamById(saved)) examId = saved;
      }
      catch { storageError = true; }
    }
    let model = freshPractice(examId);
    if (!demo) {
      try { model = restorePractice(localStorage.getItem(practiceKey(owner(), examId)), examId); }
      catch { storageError = true; }
    }
    state.practice = { owner: owner(), examId, model, models: { [examId]: model }, screen: "home", reviewId: "", filter: "wrong", confirm: "", storageError, setup: freshSetup() };
  }
  if (expirePractice(state.practice.model)) {
    if (state.practice.screen === "attempt") {
      state.practice.screen = "result";
      state.practice.reviewId = state.practice.model.current.id;
      state.practice.confirm = "";
    }
    save();
  }
  return state.practice;
}
function save() {
  if (!allowed() || state.practice?.owner !== owner() || demo) return;
  try {
    localStorage.setItem(practiceKey(owner(), state.practice.examId), JSON.stringify(state.practice.model));
    localStorage.setItem(practiceSelectionKey(owner()), state.practice.examId);
    state.practice.storageError = false;
  } catch { state.practice.storageError = true; }
}
export function view() { return ensure(); }
export function setting(name, value) {
  if (!allowed() || state.view !== "practice") return;
  const ui = ensure();
  if (name === "timerVisible" && typeof value === "boolean" && ui.screen === "attempt" && ui.model.current?.deadline && !ui.model.current.completedAt) {
    ui.model.current.timerVisible = value;
    save();
    return true;
  }
  if (name === "exam" && ui.screen === "home" && practiceExamById(value)) {
    save();
    let model = ui.models[value];
    if (!model) {
      model = freshPractice(value);
      if (!demo) {
        try { model = restorePractice(localStorage.getItem(practiceKey(owner(), value)), value); }
        catch { ui.storageError = true; }
      }
      ui.models[value] = model;
    }
    ui.examId = value; ui.model = model; ui.reviewId = ""; ui.filter = "wrong"; ui.confirm = ""; ui.setup = freshSetup();
    expirePractice(model);
    save(); render();
    return;
  }
  if (ui.screen !== "setup") return;
  const valid = { mode: ["study", "exam"], time: ["135", "180", "none"], domain: ["all", ...practiceDomains.map(({ id }) => id)], count: ["10", "20", "all"], extended: [true, false], shuffle: [true, false] };
  if (!valid[name]?.includes(value)) return;
  ui.setup[name] = value;
  render();
}
export function configure(options) {
  render = options.render;
}
export function tick() {
  if (!allowed() || state.practice?.owner !== owner()) return null;
  const attempt = state.practice.model.current;
  if (!attempt || attempt.completedAt || !attempt.deadline) return null;
  if (expirePractice(state.practice.model)) {
    state.practice.confirm = "";
    save();
    if (state.view === "practice") { state.practice.screen = "result"; state.practice.reviewId = attempt.id; }
    return { expired: true };
  }
  return { remaining: formatRemaining(remainingSeconds(attempt)) };
}
export function answer(optionId) {
  if (!allowed() || state.view !== "practice") return;
  const ui = ensure();
  if (ui.screen !== "attempt") { render(); return; }
  if (selectPracticeAnswer(ui.model.current, optionId)) {
    save(); render();
  }
}
export function action(name, value = "") {
  if (!allowed() || state.view !== "practice") return;
  const ui = ensure(), attempt = ui.model.current;
  let moveFocus = false;
  if (name === "home") { ui.screen = "home"; ui.confirm = ""; moveFocus = true; }
  else if (name === "resume" && attempt && !attempt.completedAt) { ui.screen = "attempt"; moveFocus = true; }
  else if (name === "setup" && (!attempt || attempt.completedAt)) {
    ui.setup = freshSetup(); ui.screen = "setup"; ui.confirm = ""; moveFocus = true;
  } else if (name === "start" && ui.screen === "setup") {
    const settings = ui.setup;
    const timeLimitMinutes = !settings.extended ? 90 : settings.time === "none" ? null : Number(settings.time);
    if (startPractice(ui.model, { ...settings, timeLimitMinutes })) {
      ui.screen = "attempt"; ui.confirm = ""; ui.reviewId = ""; moveFocus = true;
    }
  } else if (name === "open-result") {
    const result = ui.model.history.find(({ id }) => id === value);
    if (!result) return;
    ui.reviewId = result.id; ui.screen = "result"; ui.filter = "wrong"; moveFocus = true;
  } else if (name === "filter") ui.filter = value === "all" ? "all" : "wrong";
  else if (name === "retry-wrong") {
    const result = ui.model.history.find(({ id }) => id === ui.reviewId);
    if (!result) return;
    const wrong = practiceResult(result).wrongIds;
    if (!wrong.length || (attempt && !attempt.completedAt)) return;
    ui.setup = freshSetup(wrong); ui.screen = "setup"; ui.confirm = ""; moveFocus = true;
  } else if (name === "request-discard" && attempt && !attempt.completedAt) ui.confirm = "discard";
  else if (name === "discard" && ui.confirm === "discard") { ui.model.current = null; ui.screen = "home"; ui.confirm = ""; }
  else if (name === "cancel") ui.confirm = "";
  else if (ui.screen === "attempt" && attempt && !attempt.completedAt) {
    if (name === "check") {
      if (!checkPracticeAnswer(attempt)) return;
      save(); render();
      return "explanation";
    } else if (name === "jump") {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= attempt.questionIds.length) return;
      attempt.index = index; ui.confirm = ""; moveFocus = true;
    } else if (name === "flag") {
      const id = attempt.questionIds[attempt.index];
      attempt.flagged = attempt.flagged.includes(id) ? attempt.flagged.filter((item) => item !== id) : [...attempt.flagged, id];
    } else if (name === "request-finish") ui.confirm = "finish";
    else if (name === "finish" && ui.confirm === "finish") {
      finishPractice(ui.model); ui.screen = "result"; ui.reviewId = attempt.id; ui.filter = "wrong"; ui.confirm = ""; moveFocus = true;
    }
  } else if (name === "resume" && attempt?.completedAt) { ui.screen = "result"; ui.reviewId = attempt.id; moveFocus = true; }
  else if (attempt?.completedAt && ui.screen === "result") moveFocus = true;
  else return;
  save(); render();
  return moveFocus || name === "cancel" ? "question" : ui.confirm ? "confirm" : "";
}

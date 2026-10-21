// TODO 23: prévia e envio em lote usam o contexto real da composição, sem rede ou envio de e-mail.
// Promises controladas demonstram A → B → A mesmo sem iniciar outra prévia ou repetir o POST.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const reminders = await import("../frontend/handlers/reminders.js");
const api = await import("../frontend/api.js");
const app = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
const syncSource = app.match(/^function syncReadContext\(\) \{[\s\S]*?^\}/m)?.[0];
const busySource = app.match(/^async function busy\(element, fn\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(syncSource && busySource, "as fronteiras reais da composição precisam continuar exercitadas");

const preview = (publicationId) => ({ publicationId,
  recipients: [{ id: "101", skip: null }, { id: "102", skip: "withdrawn" }, { id: "103", skip: null }] });
const results = [{ id: "101", status: "sent" }, { id: "103", status: "skipped", reason: "withdrawn" }];
const keys = ["code", "view", "batchIds", "batchPreview", "batchError", "batchResults"];

async function scenario(run) {
  const saved = { ...state }, calls = [], notices = [], confirms = [], buttons = [];
  const globals = ["document", "confirm", "setTimeout"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  let renders = 0, started = 0;
  globalThis.document = {
    createElement: () => ({ children: [], setAttribute() {}, addEventListener() {}, remove() {}, append(...items) { this.children.push(...items); } }),
    querySelector: () => ({ replaceChildren: (item) => notices.push(item.children[0].textContent) }),
  };
  globalThis.confirm = (question) => { confirms.push(question); return true; };
  globalThis.setTimeout = () => 0;
  const sync = new Function("state", "remindersHandlers", "feedbackHandlers",
    `let readContext = [], reportRequest = 0; ${syncSource}; return syncReadContext;`)(state, reminders, { invalidateReads() {} });
  const render = () => { sync(); renders++; for (const button of buttons) button.isConnected = false; };
  const busy = new Function("notice", `${busySource}; return busy;`)((message) => notices.push(message));
  Object.assign(state, { me: { email: "instructor@example.test", roles: ["instructor"] }, studentView: null,
    code: "BRSA0001", view: "reminders-batch", pendingStudentId: "", batchIds: ["101", "102", "103"],
    batchPreview: null, batchError: "", batchResults: null });
  reminders.configure({ render, syncContext: sync });
  sync();
  api.setTransport((path, options) => new Promise((resolve, reject) => calls.push({ path, ...options, resolve, reject })));
  const begin = (run) => {
    const button = { disabled: false, isConnected: true }; buttons.push(button);
    const promise = busy(button, run);
    return { promise, request: calls.at(-1), button };
  };
  const startPreview = () => begin(() => reminders.loadBatchPreview());
  const startSend = () => begin(() => reminders.sendBatch(() => { started++; render(); }));
  const settle = async (pending, value, failure = false) => {
    pending.request[failure ? "reject" : "resolve"](failure ? new Error(value) : value);
    await pending.promise;
  };
  const seed = async () => { const pending = startPreview(); await settle(pending, preview("publication-A")); };
  try {
    await run({ calls, notices, confirms, render, sync, startPreview, startSend, settle, seed,
      snapshot: () => structuredClone(Object.fromEntries(keys.map((key) => [key, state[key]]))),
      renders: () => renders, started: () => started });
  } finally {
    reminders.configure({ render: null });
    api.setTransport(() => { throw new Error("Rede não autorizada no teste"); });
    Object.assign(state, saved);
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

const modes = {
  preview: { begin: (h) => h.startPreview(), value: preview("publication-old"), path: "pending-preview-batch" },
  send: { begin: (h) => h.startSend(), value: { results }, path: "send-reminders" },
};
const contexts = {
  turma: () => ({ code: "BRSA0002" }),
  tela: () => ({ view: "overview" }),
  sessao: () => ({ me: null }),
};

for (const [mode, operation] of Object.entries(modes)) {
  for (const failure of [false, true]) {
    for (const [context, change] of Object.entries(contexts)) {
      test(`TODO23 batch ${mode}: ${context} A → B → A descarta ${failure ? "erro" : "sucesso"} sem novo pedido`, () => scenario(async (h) => {
        if (mode === "send") await h.seed();
        const pending = operation.begin(h), changed = change();
        const original = Object.fromEntries(Object.keys(changed).map((key) => [key, state[key]]));
        Object.assign(state, changed); h.render();
        Object.assign(state, original); h.render();
        const before = h.snapshot(), renders = h.renders(), callCount = h.calls.length;
        await h.settle(pending, failure ? "erro do contexto antigo" : operation.value, failure);
        assert.deepEqual(h.snapshot(), before);
        assert.equal(h.renders(), renders);
        assert.deepEqual(h.notices, []);
        assert.equal(h.calls.length, callCount, "não repete nem substitui o POST antigo");
        assert.equal(h.calls.filter((call) => call.path.endsWith(operation.path)).length, 1);
        assert.equal(pending.request.method, "POST");
        assert.equal(pending.request.signal, undefined, "trocar o contexto não cancela a operação já enviada");
      }));
    }
    test(`TODO23 batch ${mode}: identidade da sessão mudou sem outro render; ${failure ? "erro" : "sucesso"} não pertence ao novo usuário`, () => scenario(async (h) => {
      if (mode === "send") await h.seed();
      const pending = operation.begin(h), before = h.snapshot(), renders = h.renders();
      // Defesa de ownership independente da geração: sessão nova, inclusive com o mesmo e-mail.
      state.me = { ...state.me };
      await h.settle(pending, failure ? "erro do usuário anterior" : operation.value, failure);
      assert.deepEqual(h.snapshot(), before);
      assert.equal(h.renders(), renders);
      assert.deepEqual(h.notices, []);
    }));
  }
}

test("TODO23 batch: primeira prévia após entrar na tela sincroniza o contexto antes de capturar a geração", () => scenario(async (h) => {
  state.view = "overview";
  h.render();
  const pending = reminders.openBatch("101,102,103"), request = h.calls.at(-1), value = preview("current");
  request.resolve(value);
  await pending;
  assert.equal(state.batchPreview, value, "o render inicial não invalida a própria chamada legítima");
  assert.deepEqual(h.calls.map((call) => [call.path, call.body]), [["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["101", "102", "103"] }]]);
  assert.deepEqual(h.notices, []);
}));

test("TODO23 batch: envio atual sincroniza antes de capturar contexto e preserva somente os aprovados da prévia", () => scenario(async (h) => {
  await h.seed();
  state.pendingStudentId = "context-updated-before-send";
  const pending = h.startSend();
  assert.deepEqual(pending.request.body, { studentIds: ["101", "103"], expectedPublicationId: "publication-A" });
  assert.equal(h.started(), 1);
  assert.match(h.confirms[0], /Enviar lembrete para 2 alunos da BRSA0001/);
  assert.match(h.confirms[0], /1 aluno selecionado fica de fora/);
  await h.settle(pending, { results });
  assert.equal(state.batchResults, results);
  assert.deepEqual(h.notices, ["Chegou a resposta do envio em lote. Confira o resultado por aluno."]);
  assert.equal(h.calls.filter((call) => call.path.endsWith("send-reminders")).length, 1);
}));

test("TODO23 batch: falhas atuais continuam visíveis; prévia aprovada e payload de envio são preservados", () => scenario(async (h) => {
  const failedPreview = h.startPreview();
  await h.settle(failedPreview, "falha atual da prévia", true);
  assert.equal(state.batchError, "falha atual da prévia");
  await h.seed();
  assert.equal(state.batchError, "");
  const approved = state.batchPreview, pending = h.startSend();
  await h.settle(pending, "falha atual do envio", true);
  assert.equal(state.batchPreview, approved);
  assert.equal(state.batchResults, null);
  assert.deepEqual(h.notices, ["falha atual do envio"]);
  assert.equal(h.calls.filter((call) => call.path.endsWith("send-reminders")).length, 1);
}));

for (const status of [401, undefined]) {
  test(`TODO23 batch: ${status === 401 ? "401" : "preflight sem sessão"} mantém o aviso global sem preencher o resultado do lote`, () => scenario(async (h) => {
    await h.seed();
    const pending = h.startSend();
    // A API já chamou expireSession; a rejeição chega em seguida ao handler (sem status no preflight).
    state.me = null;
    h.render();
    pending.request.reject(Object.assign(new Error("Sua sessão expirou. Entre novamente."), { status }));
    await pending.promise;
    assert.equal(state.batchResults, null);
    assert.deepEqual(h.notices, ["Sua sessão expirou. Entre novamente."]);
    assert.equal(h.calls.filter((call) => call.path.endsWith("send-reminders")).length, 1);
  }));

  test(`TODO23 batch: ${status === 401 ? "401" : "erro de sessão"} antigo não avisa quando a outra sessão continua autenticada`, () => scenario(async (h) => {
    await h.seed();
    const pending = h.startSend();
    state.me = { email: "other@example.test", roles: ["instructor"] };
    h.render();
    const before = h.snapshot(), renders = h.renders();
    pending.request.reject(Object.assign(new Error("Sua sessão expirou. Entre novamente."), { status }));
    await pending.promise;
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.renders(), renders);
    assert.deepEqual(h.notices, []);
    assert.equal(h.calls.filter((call) => call.path.endsWith("send-reminders")).length, 1);
  }));
}

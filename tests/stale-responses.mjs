// C7.4: promises controladas, transporte fictício e a fronteira real de navegação/busy.
// Nenhum sleep, Cognito, AWS ou envio real.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const reminders = await import("../frontend/handlers/reminders.js");
const feedback = await import("../frontend/handlers/feedback.js");
const api = await import("../frontend/api.js");
const app = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8");
const busySource = app.match(/^async function busy\(element, fn\) \{[\s\S]*?^\}/m)[0];
const syncSource = app.match(/^function syncReadContext\(\) \{[\s\S]*?^\}/m)?.[0] || "function syncReadContext() {}";
const modes = {
  sender: { view: "reminders", run: () => reminders.loadSender(), keys: ["sender", "senderError", "senderLoading"],
    value: (tag) => ({ sender: `${tag}@example.test`, ready: true }), data: () => state.sender, error: () => state.senderError, loading: () => state.senderLoading },
  mine: { view: "feedback", run: (more = false) => feedback.loadMine(more), keys: ["myFeedback"],
    value: (tag) => ({ items: [{ id: tag, title: tag }], nextCursor: `${tag}-cursor` }), data: () => state.myFeedback.items, error: () => state.myFeedback.error, loading: () => state.myFeedback.loading },
  pending: { view: "student-pending", run: (id = "1") => reminders.loadPending(id), keys: ["pendingPreview", "pendingError", "pendingStudentId"],
    value: (tag) => ({ student: { id: "1", name: tag }, publicationId: tag, activities: [{ id: "k1", state: "pending" }], previewHash: tag, message: { from: "teacher@example.test", to: "student@example.test" } }), data: () => state.pendingPreview, error: () => state.pendingError,
    loading: () => !state.pendingPreview && !state.pendingError },
};
async function scenario(name, fn) {
  const saved = { ...state }, m = modes[name];
  const calls = [], notices = [], buttons = [];
  const globals = ["document", "confirm", "setTimeout"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.document = { createElement: () => ({ children: [], setAttribute() {}, addEventListener() {}, remove() {}, append(...children) { this.children.push(...children); } }),
    querySelector: () => ({ replaceChildren: (item) => notices.push(item.children[0].textContent) }) };
  globalThis.confirm = () => true; globalThis.setTimeout = () => 0;
  let renders = 0;
  const sync = new Function("state", "remindersHandlers", "feedbackHandlers", `let readContext = []; ${syncSource}; return syncReadContext;`)(state, reminders, feedback);
  const render = () => { sync(); renders++; for (const b of buttons) b.isConnected = false; };
  const busy = new Function("notice", `${busySource}; return busy;`)((message) => notices.push(message));
  Object.assign(state, { code: "BRSA0267", view: m.view, me: { email: "teacher@example.test", roles: ["instructor"] }, studentView: null,
    sender: null, senderError: "", senderLoading: false, pendingStudentId: "1", pendingPreview: null, pendingError: "",
    myFeedback: { items: [], nextCursor: null, error: "", loading: false } });
  reminders.configure({ render, syncContext: sync }); feedback.configure({ render, syncContext: sync });
  sync();
  api.setTransport((path, options = {}) => new Promise((resolve, reject) => calls.push({ path, body: options.body, resolve, reject })));
  const snapshot = () => structuredClone(Object.fromEntries(m.keys.map((key) => [key, state[key]])));
  const start = (arg, run = m.run) => {
    const button = { disabled: false, isConnected: true }; buttons.push(button);
    const promise = busy(button, () => run(arg));
    return { promise, request: calls.at(-1), button };
  };
  const settle = async (r, tag, fail = false) => { r.request[fail ? "reject" : "resolve"](fail ? new Error(tag) : m.value(tag)); await r.promise; };
  try { await fn({ ...m, calls, notices, start, settle, snapshot, render, sync, renders: () => renders,
    context: (change) => { Object.assign(state, change); render(); } }); }
  finally {
    reminders.configure({ render: null }); feedback.configure({ render: null });
    api.setTransport(() => { throw new Error("Rede não autorizada no teste"); });
    Object.assign(state, saved);
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}
for (const name of Object.keys(modes)) {
  test(`C7.4 ${name}: A/B, B termina primeiro; sucesso A não substitui B`, () => scenario(name, async (h) => {
    const a = h.start(), b = h.start(); await h.settle(b, "B");
    const before = h.snapshot(), renders = h.renders(); await h.settle(a, "A");
    assert.deepEqual(h.snapshot(), before); assert.equal(h.renders(), renders); assert.deepEqual(h.notices, []);
  }));
  test(`C7.4 ${name}: B falha; sucesso A não apaga o erro nem preenche dados`, () => scenario(name, async (h) => {
    const a = h.start(), b = h.start(); await h.settle(b, "erro B", true);
    const before = h.snapshot(), notices = [...h.notices]; await h.settle(a, "A");
    assert.deepEqual(h.snapshot(), before); assert.equal(h.error(), "erro B"); assert.deepEqual(h.notices, notices);
  }));
  test(`C7.4 ${name}: erro A obsoleto não contamina B`, () => scenario(name, async (h) => {
    const a = h.start(), b = h.start(); await h.settle(b, "B");
    const before = h.snapshot(); await h.settle(a, "erro A", true);
    assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.notices, []);
  }));
  for (const failure of [false, true]) {
    test(`C7.4 ${name}: finally A ${failure ? "erro" : "sucesso"} preserva loading e botão de B`, () => scenario(name, async (h) => {
      const a = h.start(), b = h.start();
      // O render de B desconectou A; representa o botão pertencente à nova tela.
      b.button.isConnected = true;
      const before = h.snapshot(); await h.settle(a, "A", failure);
      assert.deepEqual(h.snapshot(), before); assert.equal(h.loading(), true); assert.equal(b.button.disabled, true);
      assert.deepEqual(h.notices, []);
      await h.settle(b, "B"); assert.equal(h.loading(), false);
    }));
    const changes = { turma: () => ({ code: "BRSA0257" }), view: () => ({ view: "overview" }),
      usuario: () => ({ me: { email: "other@example.test", roles: ["instructor"] } }), sessao: () => ({ me: null }),
      visualizacao: () => ({ studentView: { code: "BRSA0267", studentId: "2" } }) };
    if (name === "pending") changes.aluno = () => ({ pendingStudentId: "2" });
    for (const [kind, change] of Object.entries(changes)) {
      test(`C7.4 ${name}: ${kind} invalida ${failure ? "erro" : "sucesso"} mesmo sem nova requisição`, () => scenario(name, async (h) => {
        const a = h.start(); h.context(change());
        const before = h.snapshot(), renders = h.renders(); await h.settle(a, "obsoleto", failure);
        assert.deepEqual(h.snapshot(), before); assert.equal(h.renders(), renders); assert.deepEqual(h.notices, []);
      }));
      test(`C7.4 ${name}: ${kind} A/B/A não ressuscita ${failure ? "erro" : "sucesso"} anterior`, () => scenario(name, async (h) => {
        const a = h.start(), changed = change(), original = Object.fromEntries(Object.keys(changed).map((key) => [key, state[key]]));
        h.context(changed); h.context(original);
        const before = h.snapshot(), renders = h.renders(); await h.settle(a, "obsoleto", failure);
        assert.deepEqual(h.snapshot(), before); assert.equal(h.renders(), renders); assert.deepEqual(h.notices, []);
      }));
    }
  }
  test(`C7.4 ${name}: dados do contexto anterior são limpos antes da próxima requisição`, () => scenario(name, async (h) => {
    const a = h.start(); await h.settle(a, "privado A");
    h.context({ me: { email: "new@example.test", roles: ["instructor"] } });
    assert.ok(h.data() == null || h.data().length === 0); assert.equal(h.error(), "");
    const b = h.start(); assert.ok(h.data() == null || h.data().length === 0);
    await h.settle(b, "B"); assert.ok(JSON.stringify(h.data()).includes("B"));
  }));
  test(`C7.4 ${name}: erro e resposta atuais continuam funcionando`, () => scenario(name, async (h) => {
    const a = h.start(); await h.settle(a, "erro atual", true); assert.equal(h.error(), "erro atual");
    const b = h.start(); assert.equal(h.error(), ""); await h.settle(b, "B");
    assert.ok(JSON.stringify(h.data()).includes("B")); assert.equal(h.loading(), false);
    assert.deepEqual(h.notices, name === "pending" ? ["erro atual"] : []);
  }));
}
test("C7.4 mine: paginação atual preserva itens e cursor; paginação antiga não contamina refresh", () => scenario("mine", async (h) => {
  const first = h.start(); await h.settle(first, "primeira");
  const more = h.start(true); assert.equal(more.request.path, "/feedback?limit=20&cursor=primeira-cursor");
  await h.settle(more, "segunda"); assert.deepEqual(state.myFeedback.items.map((i) => i.id), ["primeira", "segunda"]);
  const oldMore = h.start(true), refresh = h.start(); await h.settle(refresh, "nova");
  const before = h.snapshot(); await h.settle(oldMore, "antiga"); assert.deepEqual(h.snapshot(), before);
}));
test("C7.4 mine: substituição da lista invalida escrita na referência antiga", () => scenario("mine", async (h) => {
  const a = h.start(), old = state.myFeedback;
  state.myFeedback = { items: [], nextCursor: null, loading: false, error: "" };
  const before = structuredClone(old); await h.settle(a, "A");
  assert.deepEqual(old, before); assert.deepEqual(state.myFeedback.items, []);
}));
test("C7.4 pending: seleção B distinta preserva payload e resultado B", () => scenario("pending", async (h) => {
  const a = h.start("1"), b = h.start("2");
  assert.deepEqual(h.calls.map((r) => r.body), [{ studentId: "1" }, { studentId: "2" }]);
  await h.settle(b, "B"); const before = h.snapshot(); await h.settle(a, "A", true);
  assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.notices, []);
}));

for (const failure of [false, true]) {
  test(`C7.4 sender: verificação antiga ${failure ? "falha" : "conclui"} depois de uma consulta nova`, () => scenario("sender", async (h) => {
    const initial = h.start(); await h.settle(initial, "inicial");
    const verify = h.start(undefined, reminders.verifySender), next = h.start();
    await h.settle(next, "novo"); const before = h.snapshot();
    await h.settle(verify, "verificacao antiga", failure);
    assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.notices, []);
  }));
  test(`C7.4 pending: envio antigo ${failure ? "falha" : "conclui"} sem recarregar nem avisar na prévia nova`, () => scenario("pending", async (h) => {
    const initial = h.start(); await h.settle(initial, "inicial");
    const sending = h.start(undefined, reminders.sendReminder), next = h.start();
    assert.deepEqual(sending.request.body, { studentId: "1", publicationId: "inicial", previewHash: "inicial" });
    await h.settle(next, "nova"); const before = h.snapshot(), n = h.calls.length;
    sending.request[failure ? "reject" : "resolve"](failure ? new Error("envio antigo") : { delivery: { status: "sent" } });
    // Barreira de microtasks para observar a entrada no finally, sem dormir e sem liberar nova API.
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.calls.length, n, "finally antigo não inicia outra prévia");
    await sending.promise; assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.notices, []);
  }));
}
for (const navigate of [false, true]) {
  test(`C7.4 pending: erro do envio depois da recarga ${navigate ? "obsoleta é suprimido" : "atual continua visível"}`, () => scenario("pending", async (h) => {
    const initial = h.start(); await h.settle(initial, "inicial");
    const sending = h.start(undefined, reminders.sendReminder);
    sending.request.reject(new Error("falha do envio"));
    await Promise.resolve(); await Promise.resolve();
    const reload = h.calls.at(-1);
    assert.ok(reload.path.endsWith("/pending-preview"));
    if (navigate) { const newer = h.start(); await h.settle(newer, "nova"); }
    const before = h.snapshot(); reload.resolve(h.value("recarga")); await sending.promise;
    if (navigate) { assert.deepEqual(h.snapshot(), before); assert.deepEqual(h.notices, []); }
    else assert.deepEqual(h.notices, ["falha do envio"]);
  }));
}

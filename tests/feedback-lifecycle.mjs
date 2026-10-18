// C7.5 (TODO 24): lifecycle do Feedback e dos rascunhos de importação. Transporte e URL fictícios, promises
// controladas, nenhum sleep, Cognito ou AWS.
import assert from "node:assert/strict";
import test from "node:test";
globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const api = await import("../frontend/api.js");
const feedback = await import("../frontend/handlers/feedback.js");
const adminFeedback = await import("../frontend/handlers/admin-feedback.js");
const importHandlers = await import("../frontend/handlers/import.js");
const { adminFeedbackPage } = await import("../frontend/pages/admin-feedback.js");
const { feedbackPage } = await import("../frontend/pages/feedback.js");

const item = (id, extra = {}) => ({ id, type: "BUG", title: `Título ${id}`, description: "Descrição longa o bastante", status: "NEW", createdAt: "2026-10-10T12:00:00Z", ...extra });
const fresh = () => ({
  admin: () => ({ items: [], nextCursor: null, summary: null, loading: false, error: "", filters: { status: "", type: "", cohort: "" }, selectedId: null }),
  mine: () => ({ items: [], nextCursor: null, loading: false, error: "" }),
});
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// Ambiente: transporte controlado, URL.createObjectURL/revokeObjectURL contados, render com contagem.
async function scenario(fn) {
  const saved = { ...state }, calls = [], notices = [];
  const urls = { created: [], revoked: [] };
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => { const url = `blob:test/${urls.created.length}`; urls.created.push(url); return url; };
  URL.revokeObjectURL = (url) => urls.revoked.push(url);
  const globals = ["document", "confirm", "setTimeout"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.document = { createElement: () => ({ children: [], setAttribute() {}, addEventListener() {}, remove() {}, append(...c) { this.children.push(...c); } }),
    querySelector: () => ({ replaceChildren: (n) => notices.push(n.children[0].textContent) }) };
  globalThis.setTimeout = () => 0;
  let renders = 0;
  const render = () => { renders++; };
  Object.assign(state, { me: { email: "a@example.test", roles: ["admin"] }, code: "BRSA0267", view: "admin-feedback", studentView: null,
    adminFeedback: fresh().admin(), myFeedback: fresh().mine(), feedbackFiles: [], feedbackAttachments: {}, feedbackCardUpload: {},
    feedbackDraft: { type: "", title: "", description: "" }, feedbackUpload: { feedbackId: null, progress: "", failed: false },
    feedbackSending: false, feedbackSent: false, feedbackOrigin: "" });
  feedback.configure({ render }); adminFeedback.configure({ render });
  api.setTransport((path, options = {}) => new Promise((resolve, reject) => calls.push({ path, body: options.body, method: options.method, resolve, reject })));
  // Vigia: uma operação que ficou sem dono (promise de A nunca resolvida) falha o cenário em vez de travar a suíte.
  let timer;
  const watchdog = new Promise((_, reject) => { timer = realSetTimeout(() => reject(new assert.AssertionError({ message: "o cenário não terminou: operação pendente" })), 3000); });
  try { await Promise.race([fn({ calls, urls, notices, renders: () => renders }), watchdog]); }
  finally {
    realClearTimeout(timer);
    feedback.configure({ render: null }); adminFeedback.configure({ render: null });
    api.setTransport(() => { throw new Error("Rede não autorizada no teste"); });
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
    feedback.resetForUser?.(""); adminFeedback.resetForUser?.("");
    importHandlers.discardDrafts();
    Object.assign(state, saved);
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}
const bodyOf = (call) => (typeof call.body === "string" ? JSON.parse(call.body) : call.body);
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const file = (name = "p.png") => ({ name, size: 1000, type: "image/png" });
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ---- A: 409 no status do admin ----
test("A: 409 atualiza o item pelo servidor, mantém o detalhe e a nova tentativa usa o status real", () => scenario(async ({ calls }) => {
  const a = state.adminFeedback;
  Object.assign(a, { items: [item("f1")], selectedId: "f1", summary: { NEW: 1, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } });
  const save = adminFeedback.saveStatus("f1", "RESOLVED");
  const post = calls.at(-1);
  assert.deepEqual(bodyOf(post), { status: "RESOLVED", expectedStatus: "NEW" });
  post.reject(Object.assign(new Error("O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo."), { status: 409 }));
  await tick();
  const refresh = calls.at(-1);
  assert.match(refresh.path, /^\/admin\/feedback\?/, "o 409 recarrega a lista para saber o status real");
  assert.deepEqual([a.items.length, a.loading, a.selectedId], [1, false, "f1"], "durante a atualização a tela atual não é esvaziada");
  refresh.resolve({ items: [item("f1", { status: "IN_REVIEW" })], nextCursor: null, summary: { NEW: 0, IN_REVIEW: 1, RESOLVED: 0, ARCHIVED: 0 } });
  await assert.rejects(save, /outra pessoa/);
  assert.equal(a.items[0].status, "IN_REVIEW", "badge e select passam a refletir o servidor");
  assert.equal(a.selectedId, "f1");
  const retry = adminFeedback.saveStatus("f1", "RESOLVED");
  assert.deepEqual(bodyOf(calls.at(-1)), { status: "RESOLVED", expectedStatus: "IN_REVIEW" });
  calls.at(-1).resolve({ feedback: item("f1", { status: "RESOLVED" }) });
  await retry;
  assert.equal(a.items[0].status, "RESOLVED");
}));

test("A: 409 nunca é tratado como sucesso (sem aviso de status atualizado)", () => scenario(async ({ calls, notices }) => {
  Object.assign(state.adminFeedback, { items: [item("f1")], selectedId: "f1" });
  const save = adminFeedback.saveStatus("f1", "RESOLVED");
  calls.at(-1).reject(Object.assign(new Error("O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo."), { status: 409 }));
  await tick();
  calls.at(-1).reject(new Error("rede"));
  await assert.rejects(save);
  assert.deepEqual(notices, []);
  assert.equal(state.adminFeedback.items[0].status, "NEW", "falha também no refresh: nada inventado");
}));

test("A: item que sai do filtro depois do 409 volta para a lista", () => scenario(async ({ calls }) => {
  Object.assign(state.adminFeedback, { items: [item("f1")], selectedId: "f1", filters: { status: "NEW", type: "", cohort: "" } });
  const save = adminFeedback.saveStatus("f1", "RESOLVED");
  calls.at(-1).reject(Object.assign(new Error("O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo."), { status: 409 }));
  await tick();
  calls.at(-1).resolve({ items: [], nextCursor: null, summary: { NEW: 0, IN_REVIEW: 1, RESOLVED: 0, ARCHIVED: 0 } });
  await assert.rejects(save);
  assert.equal(state.adminFeedback.selectedId, null);
}));

// ---- B: "Carregar mais" ----
// Desde a Expansão 3 o aluno tem a própria lista (pages/feedback.js::studentFeedbackList); instrutor e admin, que chegam pelo
// rodapé, continuam com a de antes (myFeedbackList). O cenário entra como admin: o caso do aluno troca o papel, e cada caso
// confere que a tela desenhada é a do papel. Antes, o caso "aluno" desenhava a tela do rodapé, e as mutações da C7.5 da
// lista do aluno caíam na função do instrutor e do admin.
const asStudent = () => { state.me = { ...state.me, roles: ["student"] }; state.view = "feedback"; };
const asFooter = () => { state.view = "feedback"; };
const screenOf = (html) => html.includes('<div class="student-feedback">') ? "aluno" : "rodapé";
const twoMine = () => Object.assign(state.myFeedback, { items: [item("a"), item("b")], nextCursor: "c1" });
for (const [name, enter, setup, page, listOf, cursorOf] of [
  ["admin", () => {}, () => Object.assign(state.adminFeedback, { items: [item("a"), item("b")], nextCursor: "c1", summary: { NEW: 2, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } }),
    adminFeedbackPage, () => state.adminFeedback, () => state.adminFeedback.nextCursor],
  ["aluno", asStudent, twoMine, feedbackPage, () => state.myFeedback, () => state.myFeedback.nextCursor],
  ["rodapé", asFooter, twoMine, feedbackPage, () => state.myFeedback, () => state.myFeedback.nextCursor],
]) {
  test(`B ${name}: falha em Carregar mais mantém itens visíveis, cursor e oferece nova tentativa sem duplicar`, () => scenario(async ({ calls }) => {
    enter();
    setup();
    if (name !== "admin") assert.equal(screenOf(page()), name, `a tela desenhada é a do ${name}`);
    const more = name === "admin" ? () => adminFeedback.load(false) : () => feedback.loadMine(true);
    const first = more();
    assert.match(calls.at(-1).path, /cursor=c1/);
    calls.at(-1).reject(new Error("Falha fictícia"));
    await first;
    assert.deepEqual(listOf().items.map((i) => i.id), ["a", "b"]);
    assert.equal(cursorOf(), "c1", "o cursor não avança depois do erro");
    const html = page();
    assert.ok(html.includes("Título a") && html.includes("Título b"), "itens já carregados continuam na tela");
    assert.ok(html.includes("Falha fictícia"), "o erro aparece");
    assert.match(html, name === "admin" ? /data-action="admin-feedback-more"/ : /data-action="feedback-more"/, "a nova tentativa pede a mesma página");
    assert.doesNotMatch(html, name === "admin" ? /data-action="admin-feedback-retry"/ : /data-action="feedback-retry"/, "e não recomeça do zero");
    const retry = more();
    assert.match(calls.at(-1).path, /cursor=c1/);
    calls.at(-1).resolve({ items: [item("c")], nextCursor: null, summary: { NEW: 3, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } });
    await retry;
    assert.deepEqual(listOf().items.map((i) => i.id), ["a", "b", "c"]);
    assert.equal(listOf().error, "");
  }));
  test(`B ${name}: erro na primeira página continua mostrando só o erro com recomeço`, () => scenario(async ({ calls }) => {
    enter();
    const first = name === "admin" ? adminFeedback.load(true) : feedback.loadMine(false);
    calls.at(-1).reject(new Error("Falha inicial"));
    await first;
    const html = page();
    if (name !== "admin") assert.equal(screenOf(html), name, `a tela desenhada é a do ${name}`);
    assert.ok(html.includes("Falha inicial"));
    assert.match(html, name === "admin" ? /data-action="admin-feedback-retry"/ : /data-action="feedback-retry"/);
  }));
}

// ---- C: rascunhos da importação ----
test("C: restaurar rascunho não deixa cópia obsoleta no Map; zerar o arquivo na turma atual limpa o aviso", async () => {
  const saved = { ...state };
  try {
    importHandlers.resetDraftsForUser("c@example.test");
    Object.assign(state, { code: "A", csv: "x,y", filename: "a.csv", preview: null, dirty: false, acknowledgeRemoved: false });
    importHandlers.saveDraft();
    state.code = "B"; importHandlers.restoreDraft();
    state.code = "A"; importHandlers.restoreDraft();
    assert.equal(state.csv, "x,y", "o rascunho de A volta ao state");
    importHandlers.configure({ render() {} });
    await assert.rejects(importHandlers.selectCsv({ size: 3000000, name: "grande.csv" }), /até 2 MB/);
    assert.equal(state.csv, "");
    assert.ok(!importHandlers.hasUnpublishedCsv(), "nada não publicado: o state é a fonte da turma aberta");
    state.code = "B"; importHandlers.saveDraft(); state.code = "A";
    assert.ok(!importHandlers.hasUnpublishedCsv());
  } finally { importHandlers.discardDrafts(); Object.assign(state, saved); }
});

test("C: o rascunho de outra turma continua contando e voltando", () => {
  const saved = { ...state };
  try {
    importHandlers.resetDraftsForUser("c2@example.test");
    Object.assign(state, { code: "A", csv: "x,y", filename: "a.csv", preview: null, dirty: false, acknowledgeRemoved: false });
    importHandlers.saveDraft();
    state.code = "B"; importHandlers.restoreDraft();
    assert.equal(state.csv, "");
    assert.ok(importHandlers.hasUnpublishedCsv(), "A tem rascunho");
    state.code = "A"; importHandlers.restoreDraft();
    assert.deepEqual([state.csv, state.filename], ["x,y", "a.csv"]);
    assert.ok(importHandlers.hasUnpublishedCsv(), "o state de A conta");
  } finally { importHandlers.discardDrafts(); Object.assign(state, saved); }
});

// ---- D: troca de usuário ----
test("D: outro usuário não herda rascunho, imagens, anexos, uploads nem a fila do Feedback", () => scenario(async ({ urls }) => {
  feedback.resetForUser("a@example.test");
  Object.assign(state, { feedbackDraft: { type: "BUG", title: "segredo de A", description: "texto privado de A" }, feedbackOrigin: "history", feedbackSent: true,
    feedbackAttachments: { f1: { open: true, items: [], urls: { x: "https://s3.test/a" } } }, feedbackCardUpload: { f1: { busy: false, message: "m" } },
    feedbackUpload: { feedbackId: "f1", progress: "p", failed: true } });
  await feedback.addPickedImages("form", [file()]);
  Object.assign(state.myFeedback, { items: [item("mine-a")] });
  Object.assign(state.adminFeedback, { items: [item("adm-a")], selectedId: "adm-a", summary: { NEW: 9, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 }, filters: { status: "NEW", type: "BUG", cohort: "BRSA0267" } });
  feedback.resetForUser("a@example.test"); adminFeedback.resetForUser("a@example.test");
  assert.equal(state.feedbackDraft.title, "segredo de A", "mesmo usuário: nada muda");
  feedback.resetForUser("b@example.test"); adminFeedback.resetForUser("b@example.test");
  assert.deepEqual(state.feedbackDraft, { type: "", title: "", description: "" });
  assert.deepEqual([state.feedbackFiles, state.feedbackAttachments, state.feedbackCardUpload, state.feedbackOrigin, state.feedbackSent],
    [[], {}, {}, "", false]);
  assert.deepEqual(state.feedbackUpload, { feedbackId: null, progress: "", failed: false });
  assert.deepEqual(state.myFeedback.items, []);
  assert.deepEqual([state.adminFeedback.items, state.adminFeedback.selectedId, state.adminFeedback.summary, state.adminFeedback.filters],
    [[], null, null, { status: "", type: "", cohort: "" }]);
  assert.deepEqual(urls.revoked, urls.created, "as prévias de A foram liberadas");
}));

test("D: resposta tardia de A (lista de admin) não escreve no estado de B", () => scenario(async ({ calls }) => {
  adminFeedback.resetForUser("a@example.test");
  const load = adminFeedback.load(true);
  adminFeedback.resetForUser("b@example.test");
  calls.at(-1).resolve({ items: [item("do-A")], nextCursor: null, summary: { NEW: 1, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } });
  await load;
  assert.deepEqual(state.adminFeedback.items, []);
  assert.equal(state.adminFeedback.summary, null);
}));

test("D: envio em andamento de A não conclui, não anexa imagens nem notifica no estado de B", () => scenario(async ({ calls, notices }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  await feedback.addPickedImages("form", [file()]);
  const submit = feedback.submit();
  const created = calls.at(-1);
  feedback.resetForUser("b@example.test");
  Object.assign(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  state.feedbackSending = true;                 // B está enviando o próprio feedback
  const callsBefore = calls.length;
  created.resolve({ feedback: item("f-a"), duplicate: false });
  await submit;
  assert.equal(calls.length, callsBefore, "nenhuma imagem, nem carga de lista, é pedida em nome de A");
  assert.deepEqual(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  assert.equal(state.feedbackSending, true, "o fim do envio de A não desliga o envio de B");
  assert.deepEqual([state.feedbackSent, notices], [false, []]);
}));

// ---- E: ObjectURL ----
test("E: URL criada é liberada uma vez ao remover, e a restante ao descartar; nunca antes", () => scenario(async ({ urls }) => {
  await feedback.addPickedImages("form", [file("a.png"), file("b.png"), file("c.png")]);
  assert.equal(urls.created.length, 3);
  assert.deepEqual(urls.revoked, [], "nada liberado enquanto as prévias estão em uso");
  const [first, second] = state.feedbackFiles;
  feedback.removeFile(first.id);
  assert.deepEqual(urls.revoked, [first.previewUrl]);
  assert.ok(state.feedbackFiles.every((f) => !urls.revoked.includes(f.previewUrl)), "as outras continuam válidas");
  feedback.discardUploads();
  assert.deepEqual(urls.revoked.sort(), urls.created.slice().sort());
  assert.equal(new Set(urls.revoked).size, urls.revoked.length, "sem revogação em duplicidade");
}));

test("E: troca de usuário e logout liberam as prévias pendentes", () => scenario(async ({ urls }) => {
  feedback.resetForUser("a@example.test");
  await feedback.addPickedImages("form", [file(), file("b.png")]);
  feedback.resetForUser("");
  assert.deepEqual(urls.revoked.sort(), urls.created.slice().sort());
  assert.deepEqual(state.feedbackFiles, []);
}));

test("E: imagem enviada pelo cartão é liberada ao terminar, mesmo com falha", () => scenario(async ({ calls, urls }) => {
  state.view = "feedback";
  Object.assign(state.myFeedback, { items: [item("mine-1", { attachments: 0 })] });
  const add = feedback.addPickedImages("mine-1", [file()]);
  assert.equal(urls.created.length, 1);
  assert.deepEqual(urls.revoked, [], "ainda em uso durante o envio");
  calls.at(-1).reject(new Error("falha ao pedir o slot"));
  await tick();
  assert.match(calls.at(-1).path, /^\/feedback\?/, "depois do envio a lista é recarregada");
  calls.at(-1).resolve({ items: [item("mine-1", { attachments: 0 })], nextCursor: null });
  await add;
  assert.deepEqual(urls.revoked, urls.created);
}));

test("D: troca de usuário durante o envio das imagens não mexe no estado de B", () => scenario(async ({ calls, notices }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  await feedback.addPickedImages("form", [file()]);
  const submit = feedback.submit();
  calls.at(-1).resolve({ feedback: item("f-a"), duplicate: false });
  await tick();
  assert.match(calls.at(-1).path, /\/feedback\/f-a\/attachments$/, "a imagem de A está sendo enviada");
  const slot = calls.at(-1);
  feedback.resetForUser("b@example.test");
  Object.assign(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  slot.reject(new Error("falha ao pedir o slot"));
  await submit;
  assert.deepEqual(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  assert.deepEqual([state.feedbackUpload, state.feedbackSent, state.feedbackSending, notices],
    [{ feedbackId: null, progress: "", failed: false }, false, false, []], "nada de A (falha, aviso ou conclusão) chega a B");
}));

test("E: envio concluído com imagens libera as prévias do formulário", () => scenario(async ({ calls, urls }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  await feedback.addPickedImages("form", [file("a.png"), file("b.png")]);
  assert.deepEqual(urls.revoked, []);
  const submit = feedback.submit();
  calls.at(-1).resolve({ feedback: item("f-a"), duplicate: false });
  for (let n = 0; n < 2; n++) {                 // cada imagem: slot já pronto, nada mais a fazer
    await tick();
    assert.match(calls.at(-1).path, /\/feedback\/f-a\/attachments$/);
    calls.at(-1).resolve({ status: "READY", attachment: { attachmentId: `a${n}` } });
  }
  await tick();
  assert.match(calls.at(-1).path, /^\/feedback\?/, "depois do envio a lista é recarregada");
  calls.at(-1).resolve({ items: [], nextCursor: null });
  await submit;
  assert.deepEqual(state.feedbackFiles, []);
  assert.deepEqual(urls.revoked.sort(), urls.created.slice().sort());
}));

test("D: upload de A concluído depois da troca não apaga nem libera as imagens de B", () => scenario(async ({ calls, urls }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  await feedback.addPickedImages("form", [file("a.png")]);
  const submit = feedback.submit();
  calls.at(-1).resolve({ feedback: item("f-a"), duplicate: false });
  await tick();
  const slot = calls.at(-1);
  assert.match(slot.path, /\/feedback\/f-a\/attachments$/);
  feedback.resetForUser("b@example.test");
  await feedback.addPickedImages("form", [file("b.png")]);
  const bFiles = [...state.feedbackFiles], revokedBefore = urls.revoked.length;
  assert.equal(bFiles.length, 1);
  slot.resolve({ status: "READY", attachment: { attachmentId: "a0" } });    // o upload de A termina com sucesso
  await submit;
  assert.deepEqual(state.feedbackFiles, bFiles, "as imagens de B continuam");
  assert.equal(urls.revoked.length, revokedBefore, "e a prévia de B não foi liberada");
  assert.deepEqual(state.feedbackUpload, { feedbackId: null, progress: "", failed: false });
}));

// Upload iniciado por A e concluído depois da mudança para B: nada de A escreve em B, e nenhuma chamada nova
// (outro slot, envio ao S3, conclusão do anexo, nova lista) sai em nome de A com a sessão de B.
const pendingSlot = { status: "PENDING", upload: { url: "https://s3.test/upload", fields: {} }, attachment: { attachmentId: "a0" } };
async function withFetch(fn) {
  const original = globalThis.fetch, sent = [];
  globalThis.fetch = async (url) => { sent.push(url); return { ok: true }; };
  try { await fn(sent); } finally { if (original) globalThis.fetch = original; else delete globalThis.fetch; }
}

test("D: troca durante o upload do formulário não envia o resto das imagens de A nem conclui o anexo", () => withFetch((fetches) => scenario(async ({ calls, notices, urls }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  await feedback.addPickedImages("form", [file("1.png"), file("2.png"), file("3.png")]);
  const submit = feedback.submit();
  calls.at(-1).resolve({ feedback: item("f-a"), duplicate: false });
  await tick();
  const slot = calls.at(-1);
  assert.match(slot.path, /\/feedback\/f-a\/attachments$/);
  feedback.resetForUser("b@example.test");
  Object.assign(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  const before = calls.length;
  slot.resolve(pendingSlot);                       // a resposta de A chega depois da troca
  await submit;
  assert.equal(calls.length, before, "nenhuma chamada nova (outro slot, conclusão, lista) em nome de A");
  assert.deepEqual(fetches, [], "nada é enviado ao S3");
  assert.deepEqual(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  assert.deepEqual([state.feedbackFiles, state.feedbackAttachments, state.feedbackCardUpload, notices], [[], {}, {}, []]);
  assert.deepEqual(state.myFeedback.items, []);
})));

test("D: troca durante o upload pelo cartão não envia o resto, não avisa nem recarrega listas em nome de A", () => withFetch((fetches) => scenario(async ({ calls, notices, urls }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.myFeedback, { items: [item("mine-a", { attachments: 0 })] });
  const add = feedback.addPickedImages("mine-a", [file("1.png"), file("2.png")]);
  const slot = calls.at(-1);
  assert.match(slot.path, /\/feedback\/mine-a\/attachments$/);
  feedback.resetForUser("b@example.test");
  const before = calls.length;
  slot.resolve(pendingSlot);
  await add;
  assert.equal(calls.length, before, "sem segundo slot, conclusão nem releitura da lista");
  assert.deepEqual(fetches, []);
  assert.deepEqual([notices, state.feedbackCardUpload, state.feedbackAttachments, state.myFeedback.items], [[], {}, {}, []]);
  assert.deepEqual(urls.revoked, urls.created, "as prévias de A são liberadas");
})));

test("D: troca durante o envio ao S3 não conclui o anexo de A com a sessão de B", () => scenario(async ({ calls }) => {
  const original = globalThis.fetch, pending = deferred(), sent = [];
  globalThis.fetch = (url) => { sent.push(url); return pending.promise; };
  try {
    feedback.resetForUser("a@example.test");
    state.view = "feedback";
    Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
    await feedback.addPickedImages("form", [file("1.png")]);
    const submit = feedback.submit();
    calls.at(-1).resolve({ feedback: item("f-a"), duplicate: false });
    await tick();
    calls.at(-1).resolve(pendingSlot);
    await tick();
    assert.equal(sent.length, 1, "o envio ao S3 de A está em andamento");
    feedback.resetForUser("b@example.test");
    const before = calls.length;
    pending.resolve({ ok: true });
    await submit;
    assert.equal(calls.length, before, "a conclusão do anexo de A não é pedida");
    assert.deepEqual(state.feedbackFiles, []);
  } finally { if (original) globalThis.fetch = original; else delete globalThis.fetch; }
}));

test("D: slot de A já pronto depois da troca não mostra \"Imagem anexada\" a B", () => scenario(async ({ calls, notices }) => {
  feedback.resetForUser("a@example.test");
  state.view = "feedback";
  Object.assign(state.myFeedback, { items: [item("mine-a", { attachments: 0 })] });
  const add = feedback.addPickedImages("mine-a", [file("1.png"), file("2.png")]);
  const slot = calls.at(-1);
  feedback.resetForUser("b@example.test");
  const before = calls.length;
  slot.resolve({ status: "READY", attachment: { attachmentId: "a0" } });
  await add;
  assert.equal(calls.length, before);
  assert.deepEqual(notices, [], "nenhum aviso de A aparece para B");
}));

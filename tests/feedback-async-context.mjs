// TODO 23/24: fronteiras assíncronas do retry de upload e da galeria. Transporte e arquivos fictícios;
// promises controladas, sem temporizadores, autenticação, chamadas S3 ou dados reais.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const api = await import("../frontend/api.js");
const feedback = await import("../frontend/handlers/feedback.js");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let sequence = 0;

async function scenario(run) {
  const saved = { ...state }, revoke = URL.revokeObjectURL;
  const calls = [], revoked = [];
  let renders = 0;
  Object.assign(state, { me: { email: `a${++sequence}@example.test`, roles: ["student"] }, code: "BRSA0001", view: "feedback", studentView: null,
    myFeedback: { items: [], nextCursor: null, loading: false, error: "" }, feedbackAttachments: {}, feedbackFiles: [], feedbackCardUpload: {},
    feedbackUpload: { feedbackId: null, progress: "", failed: false }, feedbackSending: false, feedbackSent: false });
  feedback.resetForUser(state.me.email);
  feedback.configure({ render: () => { renders++; } });
  URL.revokeObjectURL = (url) => revoked.push(url);
  api.setTransport((path, options = {}) => {
    const pending = deferred(), call = { path, body: options.body, ...pending };
    calls.push(call);
    // A releitura legítima da lista termina imediatamente; assim o retry obsoleto também termina no RED.
    if (path.startsWith("/feedback?")) call.resolve({ items: [], nextCursor: null });
    return pending.promise;
  });
  const prepareRetry = () => {
    state.feedbackFiles = [{ id: "file-a", file: {}, name: "a.png", type: "image/png", size: 1, previewUrl: "blob:fake/a", status: "failed" }];
    state.feedbackUpload = { feedbackId: "feedback-a", progress: "", failed: true };
  };
  const changeUser = () => {
    state.me = { email: `b${sequence}@example.test`, roles: ["student"] };
    feedback.resetForUser(state.me.email);
  };
  // O app chama invalidateReads no limite da troca de contexto, inclusive em A → B → A.
  const navigate = (view) => { state.view = view; feedback.invalidateReads(); };
  try { await run({ calls, revoked, prepareRetry, changeUser, navigate, renders: () => renders }); }
  finally {
    feedback.resetForUser("");
    feedback.configure({ render: null });
    api.setTransport(() => { throw new Error("Rede não autorizada no teste."); });
    URL.revokeObjectURL = revoke;
    Object.assign(state, saved);
  }
}

for (const failure of [false, true]) {
  test(`retryUploads de A após troca de usuário não libera busy, consulta lista ou redesenha B (${failure ? "erro" : "sucesso"})`, () => scenario(async (h) => {
    h.prepareRetry();
    const retry = feedback.retryUploads(true), slot = h.calls.at(-1);
    h.changeUser();
    state.feedbackSending = true;
    state.feedbackDraft = { type: "OTHER", title: "Rascunho B", description: "Descrição fictícia de B" };
    state.myFeedback.items = [{ id: "somente-b" }];
    const before = { calls: h.calls.length, renders: h.renders(), draft: state.feedbackDraft, list: state.myFeedback };
    if (failure) slot.reject(new Error("Falha antiga de A"));
    else slot.resolve({ status: "READY" });
    await retry;
    assert.equal(state.feedbackSending, true, "finally de A não encerra o envio iniciado por B");
    assert.equal(h.calls.length, before.calls, "sem consulta da lista em nome do novo usuário");
    assert.equal(h.renders(), before.renders, "nem progresso tardio redesenha B");
    assert.equal(state.feedbackDraft, before.draft);
    assert.equal(state.myFeedback, before.list);
    assert.equal(state.feedbackSent, false);
  }));
}

test("retry atual conclui, libera sua prévia e atualiza a lista", () => scenario(async (h) => {
  h.prepareRetry();
  const retry = feedback.retryUploads(true);
  assert.deepEqual(h.revoked, [], "prévia em uso não é liberada antes da resposta");
  h.calls.at(-1).resolve({ status: "READY" });
  await retry;
  assert.equal(state.feedbackSending, false);
  assert.equal(state.feedbackSent, true);
  assert.deepEqual(state.feedbackFiles, []);
  assert.deepEqual(h.revoked, ["blob:fake/a"]);
  assert.equal(h.calls.filter((c) => c.path.startsWith("/feedback?")).length, 1);
}));

test("navegação da mesma pessoa não cancela retry legítimo nem revoga sua prévia prematuramente", () => scenario(async (h) => {
  h.prepareRetry();
  const retry = feedback.retryUploads(true), slot = h.calls.at(-1);
  h.navigate("overview");
  assert.deepEqual(h.revoked, []);
  assert.equal(state.feedbackSending, true);
  slot.resolve({ status: "READY" });
  await retry;
  assert.equal(state.feedbackSent, true);
  assert.equal(state.feedbackSending, false);
  assert.deepEqual(h.revoked, ["blob:fake/a"]);
  assert.equal(h.calls.length, 1, "fora do Feedback não se recarrega a lista");
}));

for (const failure of [false, true]) {
  test(`galeria aguardando a lista não consulta URLs nem redesenha outro usuário (${failure ? "erro" : "sucesso"})`, () => scenario(async (h) => {
    const pending = feedback.loadAttachments("feedback-a"), list = h.calls.at(-1);
    h.changeUser();
    const before = { calls: h.calls.length, renders: h.renders() };
    if (failure) list.reject(new Error("Erro antigo de A"));
    else list.resolve({ items: [{ attachmentId: "imagem-a" }] });
    await settle();
    if (h.calls.length > before.calls) h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/a" });
    await pending;
    assert.equal(h.calls.length, before.calls, "nenhuma URL de A é solicitada com a sessão de B");
    assert.equal(h.renders(), before.renders);
    assert.deepEqual(state.feedbackAttachments, {});
  }));
}

test("troca de usuário durante URL da primeira imagem não inicia a segunda nem redesenha B", () => scenario(async (h) => {
  const pending = feedback.loadAttachments("feedback-a");
  h.calls.at(-1).resolve({ items: [{ attachmentId: "imagem-a" }, { attachmentId: "imagem-b" }] });
  await settle();
  const firstUrl = h.calls.at(-1);
  assert.match(firstUrl.path, /imagem-a$/);
  h.changeUser();
  const before = { calls: h.calls.length, renders: h.renders() };
  firstUrl.resolve({ downloadUrl: "https://files.example.test/a" });
  await settle();
  if (h.calls.length > before.calls) h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/b" });
  await pending;
  assert.equal(h.calls.length, before.calls);
  assert.equal(h.renders(), before.renders);
  assert.deepEqual(state.feedbackAttachments, {});
}));

test("reabrir a mesma galeria torna a lista anterior obsoleta antes de pedir URLs", () => scenario(async (h) => {
  const first = feedback.loadAttachments("feedback-a"), older = h.calls.at(-1);
  const second = feedback.loadAttachments("feedback-a"), newer = h.calls.at(-1);
  newer.resolve({ items: [{ attachmentId: "atual" }] });
  await settle();
  h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/atual" });
  await second;
  const gallery = state.feedbackAttachments["feedback-a"], before = { calls: h.calls.length, renders: h.renders() };
  older.resolve({ items: [{ attachmentId: "antiga" }] });
  await settle();
  // No RED a implementação antiga pede essa URL; resolvê-la permite observar a falha sem travar a suíte.
  if (h.calls.length > before.calls) h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/antiga" });
  await first;
  assert.equal(h.calls.length, before.calls);
  assert.equal(h.renders(), before.renders);
  assert.equal(state.feedbackAttachments["feedback-a"], gallery);
  assert.deepEqual(gallery.urls, { atual: "https://files.example.test/atual" });
}));

test("fechar uma galeria pendente impede URLs tardias e encerra seu carregamento", () => scenario(async (h) => {
  const pending = feedback.loadAttachments("feedback-a"), list = h.calls.at(-1);
  feedback.closeAttachments("feedback-a");
  const before = { calls: h.calls.length, renders: h.renders() };
  list.resolve({ items: [{ attachmentId: "imagem-a" }] });
  await settle();
  if (h.calls.length > before.calls) h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/a" });
  await pending;
  assert.equal(h.calls.length, before.calls);
  assert.equal(h.renders(), before.renders);
  assert.equal(state.feedbackAttachments["feedback-a"].open, false);
  assert.equal(state.feedbackAttachments["feedback-a"].loading, false);
}));

test("contexto A → B → A não ressuscita galeria pendente nem inicia URLs antigas", () => scenario(async (h) => {
  const pending = feedback.loadAttachments("feedback-a"), list = h.calls.at(-1);
  h.navigate("overview"); h.navigate("feedback");
  const before = { calls: h.calls.length, renders: h.renders() };
  list.resolve({ items: [{ attachmentId: "imagem-a" }] });
  await settle();
  if (h.calls.length > before.calls) h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/a" });
  await pending;
  assert.equal(h.calls.length, before.calls);
  assert.equal(h.renders(), before.renders);
  assert.equal(state.feedbackAttachments["feedback-a"].open, false);
  assert.equal(state.feedbackAttachments["feedback-a"].loading, false);
}));

test("galeria atual carrega suas imagens e mantém seus links ao fechar", () => scenario(async (h) => {
  const pending = feedback.loadAttachments("feedback-a");
  h.calls.at(-1).resolve({ items: [{ attachmentId: "imagem-a" }, { attachmentId: "imagem-b" }] });
  await settle();
  h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/a" });
  await settle();
  h.calls.at(-1).resolve({ downloadUrl: "https://files.example.test/b" });
  await pending;
  const gallery = state.feedbackAttachments["feedback-a"], items = gallery.items, urls = gallery.urls;
  assert.deepEqual(urls, { "imagem-a": "https://files.example.test/a", "imagem-b": "https://files.example.test/b" });
  assert.deepEqual([gallery.loading, gallery.error, gallery.open], [false, "", true]);
  feedback.invalidateReads();
  assert.equal(gallery.open, true, "a troca de contexto não descarta uma galeria já carregada da mesma pessoa");
  assert.equal(gallery.urls, urls);
  feedback.closeAttachments("feedback-a");
  assert.equal(gallery.items, items); assert.equal(gallery.urls, urls);
  assert.deepEqual(h.revoked, [], "links temporários remotos não são ObjectURLs locais");
}));

// Consolidação da Expansão 3 (docs/design-visual.md): no Feedback do aluno, o resultado de cada ação fica na tela, sem
// aviso temporário. O handler ganhou só a opção `inline` (envio, imagens escolhidas e nova tentativa): ela não muda nada
// do envio — mesmas chamadas, mesmo estado —, só deixa de mandar o aviso e devolve o motivo dos arquivos recusados. Este
// teste prova isso caso a caso, prova que "já tinha sido enviado" chega ao estado (state.feedbackSent = "duplicate") e
// confere a marcação da tela do aluno (resultados, mensagens recolhidas). Transporte e URL fictícios, sem DOM nem rede.
import assert from "node:assert/strict";
import test from "node:test";
globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const api = await import("../frontend/api.js");
const feedback = await import("../frontend/handlers/feedback.js");
const page = await import("../frontend/pages/feedback.js");

const item = (id, extra = {}) => ({ id, type: "BUG", title: `Título ${id}`, description: "Descrição longa o bastante", status: "NEW", createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z", ...extra });
const file = (name = "p.png", extra = {}) => ({ name, size: 1000, type: "image/png", ...extra });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// Ambiente: o transporte responde com `answer(call)` (ou fica pendente, para o teste resolver); avisos e URLs contados.
async function scenario(answer, fn) {
  const saved = { ...state }, calls = [], notices = [], urls = { created: [], revoked: [] };
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => { const url = `blob:test/${urls.created.length}`; urls.created.push(url); return url; };
  URL.revokeObjectURL = (url) => urls.revoked.push(url);
  const globals = ["document", "setTimeout"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.document = { createElement: () => ({ children: [], setAttribute() {}, addEventListener() {}, remove() {}, append(...c) { this.children.push(...c); } }),
    querySelector: () => ({ replaceChildren: (n) => notices.push(n.children[0].textContent) }) };
  globalThis.setTimeout = () => 0;
  Object.assign(state, { me: { email: "a@example.test", roles: ["student"] }, code: "BRSA0267", view: "feedback", studentView: null,
    myFeedback: { items: [], nextCursor: null, loading: false, error: "" }, feedbackFiles: [], feedbackAttachments: {}, feedbackCardUpload: {},
    feedbackDraft: { type: "BUG", title: "Título A", description: "Descrição de A longa" }, feedbackUpload: { feedbackId: null, progress: "", failed: false },
    feedbackSending: false, feedbackSent: false, feedbackOrigin: "activities" });
  feedback.resetForUser("a@example.test");
  Object.assign(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" });
  feedback.configure({ render: () => {} });
  api.setTransport((path, options = {}) => new Promise((resolve, reject) => {
    const call = { path, method: options.method || "GET", body: options.body, resolve, reject };
    calls.push(call);
    const reply = answer?.(call);
    if (reply instanceof Error) reject(reply); else if (reply !== undefined) resolve(reply);
  }));
  try { return await fn({ calls, notices, urls }); }
  finally {
    feedback.configure({ render: null });
    api.setTransport(() => { throw new Error("Rede não autorizada no teste"); });
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
    feedback.resetForUser("");
    Object.assign(state, saved);
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

// Backend fictício: cria (ou devolve o existente, se `duplicate`), dá slot pronto às imagens (ou recusa as de `failing`)
// e devolve a lista vazia.
const backend = ({ duplicate = false, failing = [] } = {}) => (call) => {
  if (call.path === "/feedback" && call.method === "POST") return { feedback: item(duplicate ? "f-old" : "f-new"), duplicate };
  const slot = call.path.match(/^\/feedback\/([^/]+)\/attachments$/);
  if (slot && call.method === "POST") return failing.includes(call.body.fileName) ? new Error("slot recusado") : { status: "READY", attachment: { attachmentId: call.body.clientToken } };
  if (call.path.startsWith("/feedback?")) return { items: [], nextCursor: null };
  return new Error(`não simulado: ${call.method} ${call.path}`);
};
// O que importa do estado depois de cada passo (sem as URLs e ids gerados).
const snapshot = () => ({ sent: state.feedbackSent, sending: state.feedbackSending, upload: { ...state.feedbackUpload },
  files: state.feedbackFiles.map((f) => [f.name, f.status]), draft: { ...state.feedbackDraft }, cards: JSON.parse(JSON.stringify(state.feedbackCardUpload)) });
const requests = (calls) => calls.map((c) => `${c.method} ${c.path.replace(/\?.*/, "?…")}${c.body?.fileName ? ` ${c.body.fileName}` : ""}`);

// Roteiros do aluno, cada um executado com e sem `inline`.
const FLOWS = {
  "envio criado, sem imagens": { backend: {}, async run(inline) { await feedback.submit(inline); } },
  "envio duplicado, sem imagens": { backend: { duplicate: true }, async run(inline) { await feedback.submit(inline); } },
  "envio criado, imagens anexadas": { backend: {}, async run(inline) { await feedback.addPickedImages("form", [file("a.png"), file("b.png")], inline); await feedback.submit(inline); } },
  "falha parcial": { backend: { failing: ["b.png"] }, async run(inline) { await feedback.addPickedImages("form", [file("a.png"), file("b.png")], inline); await feedback.submit(inline); } },
  "falha parcial e nova tentativa": { backend: { failing: ["b.png"] }, async run(inline, b) {
    await feedback.addPickedImages("form", [file("a.png"), file("b.png")], inline); await feedback.submit(inline); b.failing.length = 0; await feedback.retryUploads(inline); } },
  "duplicado, falha parcial e nova tentativa": { backend: { duplicate: true, failing: ["b.png"] }, async run(inline, b) {
    await feedback.addPickedImages("form", [file("a.png"), file("b.png")], inline); await feedback.submit(inline); b.failing.length = 0; await feedback.retryUploads(inline); } },
  "duplicado, falha parcial e remoção da que falhou": { backend: { duplicate: true, failing: ["b.png"] }, async run(inline) {
    await feedback.addPickedImages("form", [file("a.png"), file("b.png")], inline); await feedback.submit(inline);
    feedback.removeFile(state.feedbackFiles.find((f) => f.status === "failed").id); } },
  "falha parcial e descarte": { backend: { failing: ["a.png"] }, async run(inline) {
    await feedback.addPickedImages("form", [file("a.png")], inline); await feedback.submit(inline); feedback.discardUploads(); } },
  "imagem pelo feedback já enviado": { backend: {}, async run(inline) { state.myFeedback.items = [item("mine-1", { attachments: 1 })]; return feedback.addPickedImages("mine-1", [file("c.png")], inline); } },
  "imagem pelo feedback já enviado, recusada no slot": { backend: { failing: ["c.png"] }, async run(inline) { state.myFeedback.items = [item("mine-1")]; return feedback.addPickedImages("mine-1", [file("c.png")], inline); } },
  "arquivos recusados no formulário": { backend: {}, async run(inline) {
    return [await feedback.addPickedImages("form", [file("a.svg", { type: "image/svg+xml" }), file("b.png", { size: 6 * 1024 * 1024 }), file("ok.png")], inline),
      await feedback.addPickedImages("form", [file("c.png"), file("d.png"), file("e.png")], inline)]; } },
  "arquivo recusado no feedback já enviado": { backend: {}, async run(inline) { state.myFeedback.items = [item("mine-1", { attachments: 2 })];
    return feedback.addPickedImages("mine-1", [file("a.gif", { type: "image/gif" })], inline); } },
};
const EXPECTED_NOTICES = {
  "envio criado, sem imagens": ["Feedback enviado com sucesso."],
  "envio duplicado, sem imagens": ["Este feedback já tinha sido enviado."],
  "envio criado, imagens anexadas": ["Feedback enviado com sucesso."],
  "falha parcial": ["Feedback enviado, mas não foi possível anexar uma das imagens."],
  "falha parcial e nova tentativa": ["Feedback enviado, mas não foi possível anexar uma das imagens.", "Imagens anexadas ao feedback."],
  "duplicado, falha parcial e nova tentativa": ["Feedback enviado, mas não foi possível anexar uma das imagens.", "Imagens anexadas ao feedback."],
  "duplicado, falha parcial e remoção da que falhou": ["Feedback enviado, mas não foi possível anexar uma das imagens."],
  "falha parcial e descarte": ["Feedback enviado, mas não foi possível anexar uma das imagens."],
  "imagem pelo feedback já enviado": ["Imagem anexada ao feedback."],
  "imagem pelo feedback já enviado, recusada no slot": [],
  "arquivos recusados no formulário": ["Envie imagens PNG, JPEG ou WebP. Cada imagem deve ter até 5 MB.", "Você pode anexar até 3 imagens por feedback."],
  "arquivo recusado no feedback já enviado": ["Envie imagens PNG, JPEG ou WebP."],
};

async function runFlow(name, inline) {
  const flow = FLOWS[name], b = { duplicate: false, failing: [], ...flow.backend, failing: [...(flow.backend.failing || [])] };
  return scenario(backend(b), async ({ calls, notices }) => {
    const returned = await flow.run(inline, b);
    await tick();
    return { state: snapshot(), requests: requests(calls), notices: [...notices], returned };
  });
}

test("consolidação: com inline o handler faz as mesmas chamadas e chega ao mesmo estado; só o aviso some (e o motivo dos arquivos recusados volta para a tela)", async () => {
  for (const name of Object.keys(FLOWS)) {
    const toast = await runFlow(name, false), inline = await runFlow(name, true);
    assert.deepEqual(toast.notices, EXPECTED_NOTICES[name], `${name}: avisos de sempre sem inline`);
    assert.deepEqual(inline.notices, [], `${name}: nenhum aviso com inline`);
    assert.deepEqual(inline.requests, toast.requests, `${name}: mesmas chamadas, na mesma ordem`);
    // Mesmo estado, inclusive o registro do envio pelo item (sem mensagem quando dá certo: C7.5).
    assert.deepEqual(inline.state, toast.state, `${name}: mesmo estado`);
    // Arquivos recusados: o motivo que ia para o aviso volta para quem chamou, só com inline.
    const refused = [toast.notices].flat().filter((n) => /Envie|Cada imagem|até 3/.test(n));
    if (refused.length) assert.deepEqual([inline.returned].flat(), refused, `${name}: o mesmo texto volta para a tela`);
    assert.ok([toast.returned].flat().every((r) => r === undefined || r === ""), `${name}: sem inline, nada novo volta`);
  }
});

test("consolidação: \"já tinha sido enviado\" chega ao estado e sobrevive à nova tentativa e à remoção da imagem que falhou", async () => {
  const sent = async (name) => (await runFlow(name, true)).state.sent;
  assert.equal(await sent("envio criado, sem imagens"), true);
  assert.equal(await sent("envio duplicado, sem imagens"), "duplicate");
  assert.equal(await sent("falha parcial"), false, "com imagens faltando, o envio não está concluído");
  assert.equal(await sent("falha parcial e nova tentativa"), true);
  assert.equal(await sent("duplicado, falha parcial e nova tentativa"), "duplicate");
  assert.equal(await sent("duplicado, falha parcial e remoção da que falhou"), "duplicate");
  assert.equal(await sent("falha parcial e descarte"), false);
});

test("consolidação: troca de usuário depois de um duplicado não deixa a marca para o próximo envio", () => scenario(backend({ duplicate: true, failing: ["b.png"] }), async () => {
  await feedback.addPickedImages("form", [file("a.png"), file("b.png")], true);
  await feedback.submit(true);
  assert.deepEqual([state.feedbackSent, state.feedbackUpload.failed], [false, true]);
  feedback.resetForUser("b@example.test");
  // B: o handler começa sem a marca; uma remoção que conclui o envio de B (estado montado) registra true.
  state.feedbackUpload = { feedbackId: "f-b", progress: "", failed: true };
  state.feedbackFiles = [{ id: "x", name: "x.png", status: "failed", previewUrl: "blob:b" }];
  feedback.removeFile("x");
  assert.equal(state.feedbackSent, true);
}));

test("consolidação: envio de A que termina depois da troca não escreve resultado nem avisa no estado de B, com ou sem inline", async () => {
  for (const inline of [false, true]) await scenario(undefined, async ({ calls, notices }) => {
    const submit = feedback.submit(inline);
    const created = calls.at(-1);
    feedback.resetForUser("b@example.test");
    Object.assign(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
    created.resolve({ feedback: item("f-a"), duplicate: true });
    await submit;
    assert.deepEqual([state.feedbackSent, state.feedbackUpload, notices], [false, { feedbackId: null, progress: "", failed: false }, []], `inline=${inline}`);
    assert.deepEqual(state.feedbackDraft, { type: "OTHER", title: "Título B", description: "Descrição de B longa" });
  });
});

test("consolidação: falha do envio continua chegando a quem chamou (o app.js decide onde mostrar), com ou sem inline", async () => {
  for (const inline of [false, true]) await scenario((call) => call.method === "POST" ? Object.assign(new Error("Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde."), { status: 429 }) : undefined,
    async ({ notices }) => {
      await assert.rejects(feedback.submit(inline), (err) => err.status === 429);
      assert.deepEqual([state.feedbackSent, state.feedbackSending, notices], [false, false, []]);
      assert.deepEqual(state.feedbackDraft, { type: "BUG", title: "Título A", description: "Descrição de A longa" }, "o rascunho fica");
    });
});

// ---- Marcação da tela do aluno ----
function html(view = {}, extra = {}, me = { email: "aluna@example.test", roles: ["student"] }) {
  const saved = { ...state };
  Object.assign(state, { me, code: "BRSA0267", feedbackOrigin: "activities", feedbackDraft: { type: "BUG", title: "Título", description: "Descrição longa" }, feedbackFiles: [],
    feedbackSending: false, feedbackSent: false, feedbackUpload: { feedbackId: null, progress: "", failed: false }, feedbackAttachments: {}, feedbackCardUpload: {},
    myFeedback: { items: [], nextCursor: null, loading: false, error: "" }, ...extra });
  try { return page.feedbackPage(view); } finally { Object.assign(state, saved); }
}
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("consolidação: confirmação distingue o feedback criado do que já existia", () => {
  assert.match(html({}, { feedbackSent: true }), /<p class="feedback-success" id="fb-sent" role="status" tabindex="-1">Feedback enviado com sucesso\.<\/p>/);
  const duplicate = html({}, { feedbackSent: "duplicate" });
  assert.match(duplicate, /id="fb-sent"[^>]*>Este feedback já tinha sido enviado\. Ele não foi registrado de novo e continua em Meus feedbacks\.<\/p>/);
  assert.doesNotMatch(duplicate, /enviado com sucesso/);
});

test("consolidação: envio que falhou fica junto do botão, com o motivo, a certeza e o rascunho; some durante a nova tentativa", () => {
  const certain = html({ failure: { message: "Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde.", unsure: false } });
  assert.match(certain, /<div class="fb-send-error" id="fb-send-error" tabindex="-1"><p id="fb-send-error-text"><strong>O feedback não foi enviado\.<\/strong> Você já enviou 5 feedbacks nesta hora\. Tente novamente mais tarde\.<\/p>/);
  assert.match(text(certain), /O que você escreveu continua no formulário\. Junto com/);
  assert.match(certain, /type="submit"  aria-describedby="fb-send-error-text">Enviar feedback/);
  // O bloco vem antes do rodapé: o próximo Tab a partir dele é o botão de enviar.
  assert.ok(certain.indexOf('id="fb-send-error"') < certain.indexOf('class="form-footer"'));
  const unsure = html({ failure: { message: "A conexão com o portal falhou.", unsure: true } });
  assert.match(text(unsure), /Não foi possível confirmar o envio\. A conexão com o portal falhou\. O que você escreveu continua no formulário\. Envie de novo: se ele já tiver chegado, não será registrado duas vezes\./);
  assert.doesNotMatch(certain, /registrado duas vezes/);
  assert.doesNotMatch(html({ failure: { message: "x", unsure: false } }, { feedbackSending: true }), /fb-send-error/, "durante a nova tentativa, só o andamento");
  assert.match(html({ failure: { message: '<img src=x onerror="alert(1)">', unsure: false } }), /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  // Sem falha: nada, e o botão sem descrição.
  assert.doesNotMatch(html(), /fb-send-error|aria-describedby="fb-(send|partial)/);
});

test("consolidação: arquivos recusados ficam junto de onde foram escolhidos e o botão de adicionar aponta para o motivo", () => {
  const form = html({ picked: { target: "form", refused: "Envie imagens PNG, JPEG ou WebP.", attached: false } });
  assert.match(form, /<p class="fb-error" id="fb-files-error" tabindex="-1">Envie imagens PNG, JPEG ou WebP\.<\/p><button type="button" class="button secondary fb-add" data-fb-pick="form" aria-describedby="fb-files-error">/);
  const items = [item("f1", { attachments: 1 }), item("f2")];
  const card = html({ picked: { target: "f2", refused: "Envie imagens PNG, JPEG ou WebP.", attached: false } }, { myFeedback: { items, nextCursor: null, loading: false, error: "" } });
  assert.doesNotMatch(card, /fb-files-error/, "o do feedback já enviado não aparece no formulário");
  assert.equal((card.match(/class="fb-error"/g) || []).length, 1);
  assert.match(card, /data-fb-pick="f2"  aria-describedby="fb-card-error-f2">Adicionar imagem<\/button><\/div>\s*<p class="fb-error" id="fb-card-error-f2" tabindex="-1">Envie imagens/);
  assert.doesNotMatch(card.slice(0, card.indexOf('data-fb-pick="f2"')), /fb-card-error/, "só no feedback escolhido");
  // Com o andamento (ou a falha) do envio pelo item, o botão aponta para os dois.
  const both = html({ picked: { target: "f2", refused: "Envie imagens PNG, JPEG ou WebP.", attached: false } }, { myFeedback: { items, nextCursor: null, loading: false, error: "" }, feedbackCardUpload: { f2: { busy: false, message: "Não foi possível anexar a imagem. Tente de novo." } } });
  assert.match(both, /aria-describedby="fb-card-progress-f2 fb-card-error-f2"/);
  assert.match(both, /<p class="small fb-card-progress" id="fb-card-progress-f2" role="status" tabindex="-1">Não foi possível anexar a imagem\. Tente de novo\.<\/p>/);
  // Imagem anexada (registrado pelo app.js): o resultado no próprio item, e o botão aponta para ele.
  const attached = html({ picked: { target: "f2", refused: "", attached: true } }, { myFeedback: { items, nextCursor: null, loading: false, error: "" }, feedbackCardUpload: { f2: { busy: false, message: "" } } });
  assert.match(attached, /data-fb-pick="f2"  aria-describedby="fb-card-progress-f2">Adicionar imagem<\/button><\/div>\s*<p class="small fb-card-progress" id="fb-card-progress-f2" role="status" tabindex="-1">Imagem anexada ao feedback\.<\/p>/);
  assert.equal((attached.match(/Imagem anexada/g) || []).length, 1, "só no item que recebeu a imagem");
});

test("consolidação: falha parcial diz quantas imagens faltaram e que o texto não é enviado de novo", () => {
  const partial = (statuses) => text(html({}, { feedbackUpload: { feedbackId: "f", progress: "", failed: true },
    feedbackFiles: statuses.map((status, i) => ({ id: `i${i}`, name: `${i}.png`, size: 1, type: "image/png", previewUrl: `blob:${i}`, status })) }).match(/<div class="fb-partial"[\s\S]*?<\/div>/)[0]);
  assert.match(partial(["failed"]), /^Feedback enviado, mas não foi possível anexar a imagem\. Tente anexar de novo ou descarte a que faltou: o texto não é enviado outra vez\. Tentar novamente Descartar imagens$/);
  assert.match(partial(["done", "failed", "done"]), /^Feedback enviado, mas não foi possível anexar uma das imagens\. Tente anexar de novo ou descarte a que faltou:/);
  assert.match(partial(["failed", "done", "failed"]), /^Feedback enviado, mas não foi possível anexar 2 das imagens\. Tente anexar de novo ou descarte as que faltaram:/);
  assert.match(partial(["failed", "failed"]), /^Feedback enviado, mas não foi possível anexar as imagens\. Tente anexar de novo ou descarte as que faltaram:/);
});

test("consolidação: cada mensagem de Meus feedbacks tem o botão que abre e recolhe, preso a ela pelo id; escondido até a medida dizer que é longa", () => {
  const items = [item("f1"), item("f2", { description: "Linha 1\nLinha 2 <b>negrito</b>" }), item("f3", { description: "" })];
  const list = html({ open: new Set(["f2"]) }, { myFeedback: { items, nextCursor: null, loading: false, error: "" } });
  assert.match(list, /<p class="fb-entry-text is-collapsed" id="fb-text-f1">Descrição longa o bastante<\/p>/);
  assert.match(list, /<button type="button" class="text-link fb-message-toggle" data-fb-message="f1" aria-controls="fb-text-f1" aria-expanded="false" hidden>Ler mensagem completa<\/button>/);
  // Sem id no botão: o render não o guarda como "último controle com nome" (o foco é decidido pela própria ação).
  assert.doesNotMatch(list, /id="fb-message-/);
  // Aberta: sem a classe de recolhida, o texto com as quebras e escapado, e o botão para recolher.
  assert.match(list, /<p class="fb-entry-text" id="fb-text-f2">Linha 1\nLinha 2 &lt;b&gt;negrito&lt;\/b&gt;<\/p>/);
  assert.match(list, /data-fb-message="f2" aria-controls="fb-text-f2" aria-expanded="true" hidden>Recolher mensagem<\/button>/);
  // Sem mensagem, sem botão (e sem linha de ações vazia além das de anexos).
  const f3 = list.slice(list.indexOf("Título f3"));
  assert.doesNotMatch(f3, /fb-message|fb-entry-text/);
  // O botão vem logo depois do texto, antes das ações de anexos.
  const f1 = list.slice(list.indexOf("Título f1"), list.indexOf("Título f2"));
  assert.ok(f1.indexOf("fb-entry-text") < f1.indexOf("fb-message-toggle") && f1.indexOf("fb-message-toggle") < f1.indexOf("Adicionar imagem"));
});

test("consolidação: instrutor e admin continuam com a tela antiga, sem nada disso, mesmo recebendo a visão do app.js", () => {
  const view = { showProblems: true, failure: { message: "x", unsure: true }, picked: { target: "form", refused: "Envie imagens PNG, JPEG ou WebP.", attached: false }, open: new Set(["f1"]) };
  const extra = { feedbackSent: "duplicate", myFeedback: { items: [item("f1")], nextCursor: null, loading: false, error: "" } };
  for (const roles of [["instructor"], ["admin", "instructor"]]) {
    const own = html(view, extra, { email: "x@example.test", roles });
    assert.doesNotMatch(own, /student-feedback|fb-send-error|fb-files-error|fb-message|fb-entry-text|já tinha sido enviado/);
    assert.match(own, /<p class="feedback-success" role="status">Feedback enviado com sucesso\.<\/p>/, "a tela antiga mostra o sucesso de sempre para qualquer envio concluído");
    assert.equal(own, html({}, extra, { email: "x@example.test", roles }), "a visão do app.js não muda nada na tela antiga");
  }
});

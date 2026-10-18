// Comportamento dos handlers sem navegador: render simulado e, quando há rede, transporte falso.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const importHandlers = await import("../frontend/handlers/import.js");
const feedbackHandlers = await import("../frontend/handlers/feedback.js");
const remindersHandlers = await import("../frontend/handlers/reminders.js");
const apiModule = await import("../frontend/api.js");
const { notice } = await import("../frontend/ui.js");

// A troca de usuário zera arquivo e prévia, mas não acknowledgeRemoved nem importLoading (comportamento
// anterior à extração, sem teste de navegador direto para importLoading).
test("resetDraftsForUser descarta os rascunhos e preserva acknowledgeRemoved e importLoading", () => {
  const keys = ["code", "csv", "filename", "preview", "dirty", "acknowledgeRemoved", "importLoading"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  try {
    importHandlers.resetDraftsForUser("primeiro@example.test");
    const preview = { activities: [] };
    Object.assign(direct, { code: "BRSA0001", csv: "a,b", filename: "notas.csv", preview, dirty: true, acknowledgeRemoved: true, importLoading: true });
    importHandlers.saveDraft();
    importHandlers.resetDraftsForUser("primeiro@example.test");
    assert.equal(direct.csv, "a,b");
    assert.equal(direct.preview, preview);
    direct.csv = "";
    assert.ok(importHandlers.hasUnpublishedCsv());
    direct.csv = "a,b";
    importHandlers.resetDraftsForUser("segundo@example.test");
    assert.deepEqual({ csv: direct.csv, filename: direct.filename, preview: direct.preview, dirty: direct.dirty },
      { csv: "", filename: "", preview: null, dirty: false });
    assert.equal(direct.importLoading, true);
    assert.equal(direct.acknowledgeRemoved, true);
    assert.ok(!importHandlers.hasUnpublishedCsv());
  } finally {
    importHandlers.discardDrafts();
    Object.assign(direct, saved);
  }
});

// Fechar a galeria é síncrono: um render, sem Promise, e lista e links continuam guardados.
test("closeAttachments fecha sem Promise, com um render, e mantém items e urls", () => {
  const saved = direct.feedbackAttachments;
  let renders = 0;
  feedbackHandlers.configure({ render: () => { renders++; } });
  try {
    const items = [{ attachmentId: "a1" }], urls = { a1: "https://arquivos.example.test/a1" };
    direct.feedbackAttachments = { f1: { open: true, loading: false, error: "", items, urls } };
    assert.equal(feedbackHandlers.closeAttachments("f1"), undefined);
    assert.equal(renders, 1);
    assert.equal(direct.feedbackAttachments.f1.open, false);
    assert.equal(direct.feedbackAttachments.f1.items, items);
    assert.equal(direct.feedbackAttachments.f1.urls, urls);
  } finally {
    feedbackHandlers.configure({ render: null });
    direct.feedbackAttachments = saved;
  }
});

// Duas chamadas seguidas, sem navegador: só a mais recente aplica sucesso ou erro. O cenário completo
// (A1 → B → A2, com DOM e renders) fica na suíte de navegador.
test("loadBatchPreview: a chamada antiga que termina por último não aplica sucesso nem erro", async () => {
  const keys = ["code", "view", "batchIds", "batchPreview", "batchError", "batchResults"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  const calls = [];
  let renders = 0;
  apiModule.setTransport((path, options) => new Promise((resolve, reject) => calls.push({ path, body: options.body, resolve, reject })));
  remindersHandlers.configure({ render: () => { renders++; } });
  try {
    Object.assign(direct, { code: "BRSA0001", view: "reminders-batch", batchIds: ["1", "2"] });
    const older = remindersHandlers.loadBatchPreview();
    direct.batchIds = ["1"];
    const newer = remindersHandlers.loadBatchPreview();
    assert.deepEqual(calls.map((c) => [c.path, c.body]), [["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1", "2"] }],
      ["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1"] }]]);
    assert.equal(renders, 2);
    calls[1].resolve({ recipients: [{ id: "1" }] });
    await newer;
    calls[0].resolve({ recipients: [{ id: "1" }, { id: "2" }] });
    await older;
    assert.deepEqual([direct.batchPreview, direct.batchError, direct.batchResults, renders], [{ recipients: [{ id: "1" }] }, "", null, 3]);
    const olderFail = remindersHandlers.loadBatchPreview();
    const newerFail = remindersHandlers.loadBatchPreview();
    calls[3].reject(new Error("Falha da chamada atual."));
    await newerFail;
    calls[2].reject(new Error("Falha da chamada antiga."));
    await olderFail;
    assert.deepEqual([direct.batchPreview, direct.batchError, renders], [null, "Falha da chamada atual.", 6]);
  } finally {
    remindersHandlers.configure({ render: null });
    apiModule.setTransport(() => { throw new Error("Sem rede nos testes de state."); });
    Object.assign(direct, saved);
  }
});

// C7.3: transporte pendente controlado. Executa o busy real de app.js para verificar a fronteira de
// erro/double submit/finally, sem manter uma cópia dessa lógica e sem importar o boot do aplicativo.
const busySource = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8")
  .match(/^async function busy\(element, fn\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(busySource, "Rever a fronteira busy se sua declaração mudar");
const batchBusy = new Function("notice", `${busySource}; return busy;`)(notice);
const batchKeys = ["code", "view", "batchIds", "batchPreview", "batchError", "batchResults", "teacherFilters"];
const batchSnapshot = () => structuredClone(Object.fromEntries(batchKeys.map((k) => [k, direct[k]])));
const batchPreview = (ids, publicationId) => ({ publicationId,
  recipients: ids.map((id) => ({ id, skip: id === "2" ? "withdrawn" : null })) });

async function batchScenario(run) {
  const saved = Object.fromEntries(batchKeys.map((k) => [k, direct[k]]));
  const globals = ["document", "confirm", "setTimeout"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const calls = [], notices = [], confirms = [];
  let renders = 0, currentButton = null;
  const render = () => { renders++; if (currentButton) currentButton.isConnected = false; currentButton = null; };
  globalThis.document = {
    createElement: () => ({ children: [], setAttribute() {}, addEventListener() {}, remove() {}, append(...children) { this.children.push(...children); } }),
    querySelector: (selector) => selector === "#notices"
      ? { replaceChildren: (item) => notices.push({ message: item.children[0].textContent, error: item.className.includes("error") }) }
      : selector === '[data-action="send-reminders-batch"]' ? currentButton : null,
  };
  globalThis.confirm = (message) => { confirms.push(message); return true; };
  globalThis.setTimeout = () => 0;
  apiModule.setTransport((path, { body }) => new Promise((resolve, reject) => calls.push({ path, body, resolve, reject })));
  remindersHandlers.configure({ render });
  Object.assign(direct, { code: "BRSA0001", view: "reminders-batch", batchIds: [], batchPreview: null, batchError: "", batchResults: null });
  const h = {
    calls, notices, confirms, renders: () => renders,
    button: () => { if (currentButton) currentButton.isConnected = false; return currentButton = { disabled: false, isConnected: true }; },
    click: (button) => batchBusy(button, remindersHandlers.sendBatch),
    close: (view = "overview", code = direct.code) => { direct.view = view; direct.code = code; render(); },
    async preview(ids, publicationId, open = false) {
      direct.batchIds = ids;
      const pending = open ? remindersHandlers.openBatch(ids.join(",")) : remindersHandlers.loadBatchPreview();
      calls.at(-1).resolve(batchPreview(ids, publicationId));
      await pending;
      return direct.batchPreview;
    },
  };
  try { await run(h); }
  finally {
    Object.assign(direct, saved);
    remindersHandlers.configure({ render: null });
    apiModule.setTransport(() => { throw new Error("Sem rede nos testes de lote."); });
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test("C7.3: envio atual preserva aprovados, resultado withdrawn, render e aviso", async () => batchScenario(async (h) => {
  const preview = await h.preview(["1", "2", "3"], "A");
  const send = h.click(h.button()), request = h.calls.at(-1), renders = h.renders();
  assert.deepEqual(request.body, { studentIds: ["1", "3"], expectedPublicationId: "A" });
  const results = [{ id: "1", status: "sent" }, { id: "3", status: "skipped", reason: "withdrawn" }];
  request.resolve({ results });
  await send;
  assert.equal(direct.batchPreview, preview);
  assert.equal(direct.batchResults, results);
  assert.equal(h.renders(), renders + 1);
  // Sem quem diga se o resultado recebe o foco (só o handler), o aviso anuncia a resposta, sem afirmar o desfecho (fechamento da E7):
  // o lote pode ter sido aceito, ficado sem confirmação ou interrompido por conflito.
  assert.deepEqual(h.notices, [{ message: "Chegou a resposta do envio em lote. Confira o resultado por aluno.", error: false }]);
  // A pergunta (Expansão 7) diz a turma, quantos aprovados e quantos ficam de fora; sem exemplo na prévia, sem remetente.
  assert.deepEqual(h.confirms, ["Enviar lembrete para 2 alunos da BRSA0001?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota. O envio começa agora e não pode ser desfeito.\n\n1 aluno selecionado fica de fora; os motivos estão na lista."]);
}));

test("C7.3: erro atual permanece visível e libera o botão sem apagar a prévia", async () => batchScenario(async (h) => {
  await h.preview(["1", "2"], "A");
  const before = batchSnapshot(), button = h.button(), renders = h.renders();
  const send = h.click(button);
  assert.equal(button.disabled, true);
  h.calls.at(-1).reject(new Error("Falha atual."));
  await send;
  assert.deepEqual(batchSnapshot(), before);
  assert.equal(h.renders(), renders);
  assert.equal(button.disabled, false);
  assert.deepEqual(h.notices, [{ message: "Falha atual.", error: true }]);
}));

for (const failure of [false, true]) {
  test(`C7.3: ${failure ? "erro" : "sucesso"} stale após nova prévia não altera B nem cria aviso`, async () => batchScenario(async (h) => {
    await h.preview(["1", "2"], "A");
    const send = h.click(h.button()), request = h.calls.at(-1);
    const previewB = await h.preview(["3", "2"], "B");
    const before = batchSnapshot(), renders = h.renders(), requests = h.calls.length;
    if (failure) request.reject(new Error("Falha antiga."));
    else request.resolve({ results: [{ id: "1", status: "sent" }] });
    await send;
    assert.deepEqual(batchSnapshot(), before);
    assert.equal(direct.batchPreview, previewB);
    assert.equal(h.renders(), renders);
    assert.deepEqual(h.notices, []);
    assert.equal(h.calls.length, requests);
    const sendB = h.click(h.button()), requestB = h.calls.at(-1);
    assert.deepEqual(requestB.body, { studentIds: ["3"], expectedPublicationId: "B" });
    requestB.resolve({ results: [] });
    await sendB;
  }));

  test(`C7.3: ${failure ? "erro" : "sucesso"} stale durante carregamento da nova prévia é ignorado`, async () => batchScenario(async (h) => {
    await h.preview(["1"], "A");
    const send = h.click(h.button()), request = h.calls.at(-1);
    const next = remindersHandlers.loadBatchPreview(), previewRequest = h.calls.at(-1);
    const before = batchSnapshot(), renders = h.renders();
    if (failure) request.reject(new Error("Falha antiga."));
    else request.resolve({ results: [{ id: "1", status: "sent" }] });
    await send;
    assert.deepEqual(batchSnapshot(), before);
    assert.equal(h.renders(), renders);
    assert.deepEqual(h.notices, []);
    previewRequest.resolve(batchPreview(["1"], "B"));
    await next;
  }));

  for (const [name, view, code] of [["fechar lote", "overview", "BRSA0001"], ["sair para Lembretes", "reminders", "BRSA0001"], ["trocar turma", "overview", "BRSA0002"]]) {
    test(`C7.3: ${name} descarta ${failure ? "erro" : "sucesso"} antigo`, async () => batchScenario(async (h) => {
      await h.preview(["1"], "A");
      const send = h.click(h.button()), request = h.calls.at(-1);
      h.close(view, code);
      const before = batchSnapshot(), renders = h.renders();
      if (failure) request.reject(new Error("Falha antiga."));
      else request.resolve({ results: [{ id: "1", status: "sent" }] });
      await send;
      assert.deepEqual(batchSnapshot(), before);
      assert.equal(h.renders(), renders);
      assert.deepEqual(h.notices, []);
    }));
  }
}

test("C7.3: voltar e reabrir os mesmos IDs na mesma turma inicia outro contexto", async () => batchScenario(async (h) => {
  await h.preview(["1", "2"], "mesma-publicacao");
  const send = h.click(h.button()), request = h.calls.at(-1);
  h.close();
  await h.preview(["1", "2"], "mesma-publicacao", true);
  const before = batchSnapshot(), renders = h.renders();
  request.resolve({ results: [{ id: "1", status: "sent" }] });
  await send;
  assert.deepEqual(batchSnapshot(), before);
  assert.equal(h.renders(), renders);
  assert.deepEqual(h.notices, []);
}));

test("C7.3: finally antigo não libera busy de B e double submit de B continua bloqueado", async () => batchScenario(async (h) => {
  await h.preview(["1"], "A");
  const buttonA = h.button(), sendA = h.click(buttonA), requestA = h.calls.at(-1);
  await h.click(buttonA);
  assert.equal(h.confirms.length, 1);
  await h.preview(["3"], "B", true);
  const buttonB = h.button(), sendB = h.click(buttonB), requestB = h.calls.at(-1);
  const before = batchSnapshot(), renders = h.renders();
  requestA.resolve({ results: [{ id: "1", status: "sent" }] });
  await sendA;
  assert.deepEqual(batchSnapshot(), before);
  assert.equal(h.renders(), renders);
  assert.equal(buttonB.disabled, true);
  assert.deepEqual(h.notices, []);
  await h.click(buttonB);
  assert.equal(h.calls.filter((r) => r.path.endsWith("/send-reminders")).length, 2);
  assert.equal(h.confirms.length, 2);
  requestB.reject(new Error("Falha atual de B."));
  await sendB;
  assert.equal(buttonB.disabled, false);
  assert.deepEqual(h.notices, [{ message: "Falha atual de B.", error: true }]);
}));

// Confirmação de cadastro. Aqui o handler roda isolado do app.js, com o api.js real, um fetch falso no lugar do
// Cognito, relógio fixo e render simulado. Valores fictícios, nenhuma chamada de rede real.
let signupModule;
const signupHandlers = async () => (signupModule ??= await import("../frontend/handlers/signup-confirmation.js"));
const signupConfig = { apiUrl: "https://api.example.test", authDomain: "https://auth.example.test", region: "sa-east-1", userPoolClientId: "exampleclient123" };
const cognitoReply = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/x-amz-json-1.1" } });
const awsError = (type, status = 400) => cognitoReply(status, { __type: type, message: "Mensagem bruta da AWS" });
const fail = (error) => () => { throw error; };
const accepted = cognitoReply(200, { CodeDeliveryDetails: { AttributeName: "email", DeliveryMedium: "EMAIL", Destination: "p***@e***" } });
const BLANK = { step: "", email: "", sending: false, confirming: false, error: "", resendAvailableAt: 0, confirmed: false };
const NOW = 1_700_000_000_000;

// Cenário isolado: respostas do "Cognito" em fila, relógio controlado e renders contados. Storage e console
// ficam vigiados: qualquer acesso falha o cenário. No fim tudo volta ao que era, inclusive a fatia do state.
async function signupScenario(responses, fn) {
  const handlers = await signupHandlers();
  const slice = direct.signupConfirmation, saved = { ...slice };
  const globals = ["fetch", "localStorage", "sessionStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const realNow = Date.now, realTimeout = AbortSignal.timeout, realConsole = { ...console };
  const calls = [], queue = [...responses], touched = [];
  let renders = 0, now = NOW;
  const watched = (name) => new Proxy({}, { get: (_, prop) => { touched.push(`${name}.${String(prop)}`); return () => null; } });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return queue.shift()(); };
  globalThis.localStorage = watched("localStorage");
  globalThis.sessionStorage = watched("sessionStorage");
  for (const method of ["log", "info", "warn", "error", "debug"]) console[method] = () => touched.push(`console.${method}`);
  Date.now = () => now;
  AbortSignal.timeout = () => new AbortController().signal;
  apiModule.configure({ config: signupConfig, onSessionExpired() {} });
  handlers.configure({ render: () => { renders++; } });
  try {
    await fn({ handlers, slice, calls, renders: () => renders, advance: (ms) => { now += ms; } });
    assert.deepEqual(touched, [], "sem storage nem console");
  } finally {
    handlers.configure({ render: null });
    Object.assign(slice, saved);
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    Object.assign(console, realConsole);
    Date.now = realNow;
    AbortSignal.timeout = realTimeout;
  }
}

test("signup: start abre o fluxo limpo na etapa EMAIL, com um render", async () => {
  await signupScenario([], async ({ handlers, slice, renders }) => {
    Object.assign(slice, { step: "success", email: "antiga@example.com", error: "WRONG_CODE", resendAvailableAt: NOW + 5, confirmed: true });
    assert.equal(handlers.start(), undefined);
    assert.deepEqual({ ...slice }, { ...BLANK, step: "email" });
    assert.equal(renders(), 1);
    assert.deepEqual(handlers.SIGNUP_STEPS, { CLOSED: "", EMAIL: "email", CODE: "code", SUCCESS: "success" });
    assert.ok(Object.isFrozen(handlers.SIGNUP_STEPS) && Object.isFrozen(handlers.SIGNUP_ERRORS));
  });
});

test("signup: e-mail inválido não chama a API e fica na etapa EMAIL com INVALID_EMAIL", async () => {
  await signupScenario([], async ({ handlers, slice, calls, renders }) => {
    handlers.start();
    assert.equal(await handlers.requestCode("sem-arroba.example.com"), undefined);
    assert.equal(calls.length, 0);
    assert.deepEqual({ ...slice }, { ...BLANK, step: "email", email: "sem-arroba.example.com", error: "INVALID_EMAIL" });
    assert.equal(renders(), 2);
  });
});

test("signup: envio aceito normaliza o e-mail, vai para CODE e inicia o intervalo de 60 s", async () => {
  await signupScenario([accepted], async ({ handlers, slice, calls, renders }) => {
    handlers.start();
    const pending = handlers.requestCode(" Pessoa@Example.COM ");
    assert.deepEqual({ ...slice }, { ...BLANK, step: "email", email: "pessoa@example.com", sending: true });
    await pending;
    assert.deepEqual(calls.map((c) => c.body), [{ ClientId: "exampleclient123", Username: "pessoa@example.com" }]);
    assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", resendAvailableAt: NOW + 60_000 });
    assert.equal(handlers.maskSignupEmail(slice.email), "pe***@example.com");
    assert.equal(slice.email, "pessoa@example.com", "a máscara não altera o e-mail do fluxo");
    assert.equal(renders(), 3);
  });
});

test("signup: maskSignupEmail mostra o domínio e reduz a parte local, sem quebrar em casos curtos", async () => {
  const { maskSignupEmail } = await signupHandlers();
  for (const [email, masked] of [["ana.souza@gmail.com", "an***@gmail.com"], ["ana@escola.org", "an***@escola.org"], ["ab@x.com", "a***@x.com"],
    ["a@x.com", "a***@x.com"], ["joão@exemplo.com.br", "jo***@exemplo.com.br"], ["😀😀😀@x.com", "😀😀***@x.com"]])
    assert.equal(maskSignupEmail(email), masked, email);
  for (const email of ["", "sem-arroba", "@x.com", null, undefined, 42]) assert.equal(maskSignupEmail(email), "", String(email));
});

// Privacidade: nada observável depois do reenvio pode distinguir conta inexistente, já confirmada, pendente, com
// falha de entrega ou no limite por usuário. Cada categoria de ACCOUNT_STATE_CATEGORIES deixa o mesmo estado,
// o mesmo número de renders e de chamadas e o mesmo retorno que um envio aceito (real ou simulado).
test("signup: todo resultado de reenvio que depende da conta deixa o mesmo estado observável que um envio aceito", async () => {
  const BY_CATEGORY = { USER_NOT_FOUND: "UserNotFoundException", INVALID_PARAMETER: "InvalidParameterException", NOT_AUTHORIZED: "NotAuthorizedException",
    TOO_MANY_ATTEMPTS: "LimitExceededException", DELIVERY_FAILED: "CodeDeliveryFailureException", ALIAS_EXISTS: "AliasExistsException" };
  assert.deepEqual(Object.keys(BY_CATEGORY).sort(), [...apiModule.ACCOUNT_STATE_CATEGORIES].sort(), "a tabela cobre todas as categorias da política");
  const outcomes = [["envio real", accepted], ["envio simulado", cognitoReply(200, {})], ...Object.entries(BY_CATEGORY).map(([category, type]) => [category, awsError(type)])];
  const snapshots = [];
  for (const [label, reply] of outcomes) {
    await signupScenario([reply], async ({ handlers, slice, calls, renders }) => {
      handlers.start();
      const result = await handlers.requestCode(" Pessoa@Example.com ");
      snapshots.push([label, { slice: structuredClone(slice), renders: renders(), calls: calls.length, result }]);
    });
  }
  const [[, reference], ...others] = snapshots;
  assert.deepEqual(reference.slice, { ...BLANK, step: "code", email: "pessoa@example.com", resendAvailableAt: NOW + 60_000 });
  for (const [label, observed] of others) assert.deepEqual(observed, reference, label);
});

test("signup: falhas técnicas no envio não fingem envio (rede, timeout, serviço, vazão e configuração)", async () => {
  for (const [label, reply, error] of [["NETWORK_ERROR", fail(new TypeError("Failed to fetch")), "TEMPORARY_FAILURE"],
    ["TIMEOUT", fail(new DOMException("The operation timed out.", "TimeoutError")), "TEMPORARY_FAILURE"],
    ["SERVICE_UNAVAILABLE", awsError("InternalErrorException", 500), "TEMPORARY_FAILURE"],
    ["RATE_LIMITED", awsError("TooManyRequestsException"), "TOO_MANY_ATTEMPTS"]]) {
    await signupScenario([reply], async ({ handlers, slice, calls }) => {
      handlers.start();
      await handlers.requestCode("pessoa@example.com");
      assert.equal(calls.length, 1, label);
      assert.deepEqual({ ...slice }, { ...BLANK, step: "email", email: "pessoa@example.com", error }, label);
    });
  }
  await signupScenario([], async ({ handlers, slice, calls }) => {
    apiModule.configure({ config: { apiUrl: "https://api.example.test" }, onSessionExpired() {} });
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    assert.equal(calls.length, 0);
    assert.deepEqual({ ...slice }, { ...BLANK, step: "email", email: "pessoa@example.com", error: "CONFIGURATION_FAILURE" });
  });
});

test("signup: reenvio em CODE usa o e-mail do fluxo, respeita o intervalo, limpa o erro e reinicia o intervalo", async () => {
  await signupScenario([accepted, accepted, awsError("TooManyRequestsException")], async ({ handlers, slice, calls, advance }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    slice.error = "WRONG_CODE";
    await handlers.requestCode("outra@example.com");
    assert.equal(calls.length, 1, "dentro do intervalo nada é enviado");
    advance(60_000);
    await handlers.requestCode("outra@example.com");
    assert.deepEqual(calls.map((c) => c.body.Username), ["pessoa@example.com", "pessoa@example.com"]);
    assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", resendAvailableAt: NOW + 120_000 });
    advance(60_000);
    await handlers.requestCode();
    assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", error: "TOO_MANY_ATTEMPTS", resendAvailableAt: NOW + 120_000 },
      "vazão do serviço mantém CODE, avisa e não reinicia o intervalo");
  });
});

test("signup: confirmação aceita vai para SUCCESS; código e Session não ficam em lugar nenhum do state", async () => {
  await signupScenario([accepted, cognitoReply(200, { Session: "sessao-ficticia-0123456789" })], async ({ handlers, slice, calls, renders }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    const pending = handlers.confirm(" 012345 ");
    assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", confirming: true, resendAvailableAt: NOW + 60_000 });
    assert.equal(await pending, undefined);
    assert.deepEqual(calls[1].body, { ClientId: "exampleclient123", Username: "pessoa@example.com", ConfirmationCode: "012345" });
    assert.deepEqual({ ...slice }, { ...BLANK, step: "success", email: "pessoa@example.com", resendAvailableAt: NOW + 60_000, confirmed: true });
    const everything = JSON.stringify(direct);
    assert.ok(!everything.includes("012345") && !everything.includes("sessao-ficticia"));
    assert.equal(renders(), 5);
  });
});

test("signup: erros da confirmação viram erros de domínio, ficam em CODE e nunca marcam confirmed", async () => {
  for (const [type, error, status] of [["CodeMismatchException", "WRONG_CODE"], ["UserNotFoundException", "WRONG_CODE"], ["ExpiredCodeException", "EXPIRED_CODE"],
    ["TooManyFailedAttemptsException", "TOO_MANY_ATTEMPTS"], ["LimitExceededException", "TOO_MANY_ATTEMPTS"], ["TooManyRequestsException", "TOO_MANY_ATTEMPTS"],
    ["NotAuthorizedException", "ALREADY_CONFIRMED_OR_UNAVAILABLE"], ["AliasExistsException", "ALREADY_CONFIRMED_OR_UNAVAILABLE"],
    ["InvalidParameterException", "INVALID_CODE"], ["InternalErrorException", "TEMPORARY_FAILURE", 500], ["ResourceNotFoundException", "CONFIGURATION_FAILURE"]]) {
    await signupScenario([accepted, awsError(type, status)], async ({ handlers, slice }) => {
      handlers.start();
      await handlers.requestCode("pessoa@example.com");
      await handlers.confirm("123456");
      assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", error, resendAvailableAt: NOW + 60_000 }, type);
    });
  }
  await signupScenario([accepted], async ({ handlers, slice, calls }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    await handlers.confirm("12 34");
    assert.equal(calls.length, 1, "código malformado não chega ao Cognito");
    assert.equal(slice.error, "INVALID_CODE");
  });
});

test("signup: UserNotFound na confirmação é indistinguível de código errado", async () => {
  const observed = [];
  for (const type of ["CodeMismatchException", "UserNotFoundException"]) {
    await signupScenario([accepted, awsError(type)], async ({ handlers, slice, calls, renders }) => {
      handlers.start();
      await handlers.requestCode("pessoa@example.com");
      const result = await handlers.confirm("123456");
      observed.push({ slice: structuredClone(slice), renders: renders(), calls: calls.length, result });
    });
  }
  assert.deepEqual(observed[1], observed[0]);
});

// O servidor pode ter confirmado e o navegador ter recebido timeout: a nova tentativa volta NotAuthorized.
// Sem prova de que a conta foi confirmada, o fluxo não marca confirmed; o erro permite sugerir o login.
test("signup: NotAuthorized depois de um timeout fica em ALREADY_CONFIRMED_OR_UNAVAILABLE, sem confirmed", async () => {
  await signupScenario([accepted, fail(new DOMException("The operation timed out.", "TimeoutError")), awsError("NotAuthorizedException")],
    async ({ handlers, slice }) => {
      handlers.start();
      await handlers.requestCode("pessoa@example.com");
      await handlers.confirm("123456");
      assert.equal(slice.error, "TEMPORARY_FAILURE");
      await handlers.confirm("123456");
      assert.deepEqual({ ...slice }, { ...BLANK, step: "code", email: "pessoa@example.com", error: "ALREADY_CONFIRMED_OR_UNAVAILABLE", resendAvailableAt: NOW + 60_000 });
    });
});

test("signup: reset fecha e limpa a fatia; start recomeça com outro e-mail; respostas pendentes são descartadas", async () => {
  let release;
  const held = () => new Promise((resolve) => { release = resolve; }).then(() => accepted());
  await signupScenario([held], async ({ handlers, slice, renders }) => {
    handlers.start();
    const pending = handlers.requestCode("pessoa@example.com");
    handlers.reset();
    assert.deepEqual({ ...slice }, BLANK);
    release();
    await pending;
    assert.deepEqual({ ...slice }, BLANK, "a resposta do envio cancelado não reabre o fluxo");
    assert.equal(renders(), 3);
  });
  await signupScenario([accepted, held], async ({ handlers, slice }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    const pending = handlers.confirm("123456");
    handlers.start();
    release();
    await pending;
    assert.deepEqual({ ...slice }, { ...BLANK, step: "email" }, "Usar outro e-mail descarta a confirmação em andamento");
  });
  await signupScenario([accepted, cognitoReply(200, {})], async ({ handlers, slice }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    await handlers.confirm("123456");
    handlers.reset();
    assert.deepEqual({ ...slice }, BLANK);
  });
});

test("signup: um envio ou uma confirmação por vez; confirmar fora da etapa CODE não faz nada", async () => {
  await signupScenario([accepted, accepted], async ({ handlers, calls }) => {
    handlers.start();
    await handlers.confirm("123456");
    assert.equal(calls.length, 0, "confirm na etapa EMAIL não chama a API");
    const first = handlers.requestCode("pessoa@example.com");
    await handlers.requestCode("pessoa@example.com");
    await first;
    assert.equal(calls.length, 1, "segundo envio durante o primeiro é ignorado");
    const confirming = handlers.confirm("123456");
    await handlers.confirm("123456");
    await confirming;
    assert.equal(calls.length, 2, "segunda confirmação durante a primeira é ignorada");
  });
});

test("signup: nenhuma etapa do fluxo guarda o código nem toca em storage ou console", async () => {
  await signupScenario([accepted, awsError("CodeMismatchException"), fail(new TypeError("Failed to fetch")), cognitoReply(200, {})], async ({ handlers, slice }) => {
    handlers.start();
    await handlers.requestCode("pessoa@example.com");
    for (const code of ["987650", "987651", "987652"]) {
      await handlers.confirm(code);
      assert.ok(!JSON.stringify(direct).includes(code), code);
    }
    assert.equal(slice.step, "success");
  });
});

// Camada de rede (frontend/api.js) sem navegador: fetch, relógio e sessão simulados.
import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
const config = { apiUrl: "https://api.example.test", authDomain: "https://auth.example.test", userPoolClientId: "client" };
const validSession = { accessToken: "tok", expires: Date.now() + 3600000 };
const timeouts = [];
AbortSignal.timeout = (ms) => {
  const signal = new AbortController().signal;
  timeouts.push({ ms, signal });
  return signal;
};

const json = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const raw = (status, body, type) => () => new Response(body, { status, headers: type ? { "content-type": type } : {} });
const UNAVAILABLE = "O portal está temporariamente indisponível. Tente novamente em instantes.";
const GENERIC = "Não foi possível completar a solicitação.";
const BUSY = "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.";
const EXPIRED = "Sua sessão expirou. Entre novamente.";

let version = 0;
// Módulo novo por teste: api.js guarda configuração e transporte no próprio módulo.
async function load({ session = validSession, responses = [json(200, {})], configured = true } = {}) {
  storage.clear();
  timeouts.length = 0;
  if (session) storage.set("avanca.session", JSON.stringify(session));
  const calls = [], queue = [...responses];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next();
  };
  const api = await import(`../frontend/api.js?v=${++version}`);
  const expired = [];
  if (configured) api.configure({ config, onSessionExpired: () => expired.push("callback") });
  return { api, calls, expired };
}

// Retentativas sem espera real: registra os atrasos pedidos e fixa a variação aleatória.
async function withFakeTimers(fn) {
  const setTimeoutReal = globalThis.setTimeout, randomReal = Math.random, delays = [];
  globalThis.setTimeout = (callback, ms) => { delays.push(ms); callback(); return 0; };
  Math.random = () => 0.5;
  try { await fn(); } finally { globalThis.setTimeout = setTimeoutReal; Math.random = randomReal; }
  return delays;
}

test("envia Authorization Bearer com o token da sessão e usa config.apiUrl como prefixo", async () => {
  const { api, calls } = await load();
  await api.me.get();
  assert.equal(calls[0].url, "https://api.example.test/me");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
});

test("Content-Type JSON só quando há body; GET não tem Content-Type nem body", async () => {
  const { api, calls } = await load();
  await api.me.get();
  await api.access.requestInstructorAccess();
  assert.deepEqual(Object.keys(calls[0].init.headers), ["Authorization"]);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(calls[1].init.headers, { Authorization: "Bearer tok", "Content-Type": "application/json" });
  assert.equal(calls[1].init.body, "{}");
});

test("body é o JSON.stringify do objeto do chamador, sem reconstrução", async () => {
  const { api, calls } = await load();
  const body = { type: "BUG", title: "Ação — título", description: "com \"aspas\" e ç", cohort: "BRSA0267", nested: { a: [1, null] } };
  await api.feedback.create(body);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, JSON.stringify(body));
});

test("init mantém cache no-store e timeout de 35 s em cada tentativa", async () => {
  const { api, calls } = await load();
  await api.cohorts.list();
  assert.deepEqual(Object.keys(calls[0].init), ["method", "headers", "body", "cache", "signal"]);
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(timeouts.map((t) => t.ms), [35000]);
  assert.equal(calls[0].init.signal, timeouts[0].signal);
});

test("GET com 429 tenta de novo com espera crescente e variação, e devolve a resposta seguinte", async () => {
  const { api, calls } = await load({ responses: [json(429, {}), json(429, {}), json(200, { ok: 1 })] });
  let data;
  const delays = await withFakeTimers(async () => { data = await api.me.get(); });
  assert.deepEqual(data, { ok: 1 });
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [500, 900]);
  assert.equal(timeouts.length, 3);
});

test("GET com 429 para no máximo de 4 tentativas e preserva data.error", async () => {
  const { api, calls, expired } = await load({ responses: [json(429, { error: "Limite de feedbacks." })] });
  const delays = await withFakeTimers(() => assert.rejects(api.cohorts.report("BRSA0267"), { message: "Limite de feedbacks." }));
  assert.equal(calls.length, 4);
  assert.deepEqual(delays, [500, 900, 1700]);
  assert.deepEqual(expired, []);
});

test("POST com 429 não é repetido e usa a mensagem padrão sem data.error", async () => {
  const { api, calls } = await load({ responses: [json(429, { message: "Too Many Requests" })] });
  const delays = await withFakeTimers(() => assert.rejects(api.feedback.create({ type: "BUG" }), { message: BUSY }));
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("502, 503 e 504 sem data.error mostram indisponibilidade; com data.error, a mensagem do backend", async () => {
  for (const status of [502, 503, 504]) {
    const { api } = await load({ responses: [raw(status, "<html>Gateway</html>", "text/html")] });
    await assert.rejects(api.me.get(), { message: UNAVAILABLE });
  }
  const { api } = await load({ responses: [json(502, { error: "Gateway explicou." })] });
  await assert.rejects(api.me.get(), { message: "Gateway explicou." });
});

test("400, 404, 409 e 500 preservam a mensagem do backend; sem ela, a mensagem genérica", async () => {
  for (const [status, error] of [[400, "Pedido inválido."], [404, "Não encontrado."], [409, "O status mudou desde a última leitura."], [500, "Falha interna."]]) {
    const { api } = await load({ responses: [json(status, { error })] });
    await assert.rejects(api.adminFeedback.setStatus("f1", { status: "RESOLVED", expectedStatus: "NEW" }), { message: error });
  }
  const { api } = await load({ responses: [json(500, { message: "sem error" })] });
  await assert.rejects(api.cohorts.publish("BRSA0267", { draftId: "d" }), { message: GENERIC });
});

test("resposta sem JSON vira {}: sucesso devolve {}, falha usa a mensagem genérica", async () => {
  let { api } = await load({ responses: [raw(200, "ok", "text/plain")] });
  assert.deepEqual(await api.access.requestInstructorAccess(), {});
  ({ api } = await load({ responses: [raw(200, "", null)] }));
  assert.deepEqual(await api.me.get(), {});
  ({ api } = await load({ responses: [raw(500, "<html>erro</html>", "text/html")] }));
  await assert.rejects(api.me.get(), { message: GENERIC });
});

test("JSON inválido com Content-Type JSON vira {}", async () => {
  let { api } = await load({ responses: [raw(200, "{quebrado", "application/json")] });
  assert.deepEqual(await api.me.get(), {});
  ({ api } = await load({ responses: [raw(500, "{quebrado", "application/json; charset=utf-8")] }));
  await assert.rejects(api.me.get(), { message: GENERIC });
});

test("erro de rede propaga o próprio erro do fetch, sem retentativa e sem expirar a sessão", async () => {
  const boom = new TypeError("Failed to fetch");
  const { api, calls, expired } = await load({ responses: [boom] });
  await assert.rejects(api.me.get(), (err) => err === boom);
  assert.equal(calls.length, 1);
  assert.deepEqual(expired, []);
});

test("sem sessão válida: chama onSessionExpired uma vez, antes de rejeitar, e não chama a API", async () => {
  for (const session of [null, { accessToken: "velho", expires: Date.now() - 1000 }]) {
    const { api, calls, expired } = await load({ session });
    await api.me.get().catch((err) => expired.push(`rejeitou: ${err.message}`));
    assert.deepEqual(expired, ["callback", `rejeitou: ${EXPIRED}`]);
    assert.equal(calls.length, 0);
  }
});

test("401 chama onSessionExpired exatamente uma vez, sem retentativa, e rejeita com a mensagem de sempre", async () => {
  let { api, calls, expired } = await load({ responses: [json(401, { error: "Token recusado." })] });
  await api.me.get().catch((err) => expired.push(`rejeitou: ${err.message}`));
  assert.deepEqual(expired, ["callback", "rejeitou: Token recusado."]);
  assert.equal(calls.length, 1);
  ({ api, expired } = await load({ responses: [raw(401, "", null)] }));
  await assert.rejects(api.access.requestInstructorAccess(), { message: GENERIC });
  assert.deepEqual(expired, ["callback"]);
});

test("400, 403, 404, 409, 429, 500, 502, 503 e 504 não chamam onSessionExpired", async () => {
  for (const status of [400, 403, 404, 409, 429, 500, 502, 503, 504]) {
    const { api, expired } = await load({ responses: [json(status, { error: `erro ${status}` })] });
    await assert.rejects(api.feedback.create({ type: "BUG" }), { message: `erro ${status}` });
    assert.deepEqual(expired, [], `status ${status}`);
  }
});

test("usa o access token renovado pelo auth.js quando a sessão está perto de vencer", async () => {
  const { api, calls } = await load({
    session: { accessToken: "quase", refreshToken: "r1", expires: Date.now() + 30000 },
    responses: [json(200, { access_token: "renovado", expires_in: 900 }), json(200, { email: "a@example.test" })],
  });
  await api.me.get();
  assert.equal(calls[0].url, "https://auth.example.test/oauth2/token");
  assert.equal(calls[1].init.headers.Authorization, "Bearer renovado");
});

test("configure: exige config e callback; requisição antes de configure falha sem chamar a rede", async () => {
  const { api, calls } = await load({ configured: false });
  await assert.rejects(api.me.get(), /configure\(\) precisa ser chamado/);
  assert.equal(calls.length, 0);
  assert.throws(() => api.configure({ config }), TypeError);
  assert.throws(() => api.configure({ onSessionExpired() {} }), TypeError);
  api.configure({ config, onSessionExpired() {} });
  await api.me.get();
  assert.equal(calls[0].url, "https://api.example.test/me");
});

test("setTransport troca o transporte: recebe (path, options) e devolve o resultado dele", async () => {
  const { api, calls } = await load();
  const seen = [];
  api.setTransport(async (path, options) => { seen.push([path, options]); return { de: "transporte" }; });
  assert.deepEqual(await api.me.get(), { de: "transporte" });
  assert.deepEqual(seen, [["/me", undefined]]);
  assert.equal(calls.length, 0);
  assert.throws(() => api.setTransport(null), TypeError);
});

test("demonstração: com demoAPI nenhuma chamada HTTP escapa, POST é recusado e a troca de papel continua funcionando", async () => {
  const { api, calls } = await load({ responses: [json(200, { email: "real@example.test" })] });
  assert.equal((await api.me.get()).email, "real@example.test");
  assert.equal(calls.length, 1);
  const { demoAPI } = await import("../frontend/demo.js");
  api.setTransport(demoAPI("student"));
  assert.deepEqual((await api.me.get()).roles, ["student"]);
  assert.ok((await api.cohorts.list()).cohorts.length);
  await assert.rejects(api.feedback.create({ type: "BUG" }), /Esta é uma demonstração/);
  api.setTransport(demoAPI("instructor"));
  assert.deepEqual((await api.me.get()).roles, ["instructor"]);
  assert.equal(calls.length, 1);
});

test("uploadAttachmentToS3 envia os fields do presigned POST na ordem, o arquivo por último e nenhum header", async () => {
  const { api, calls } = await load({ responses: [raw(204, null, null)] });
  const file = new File(["\x89PNG"], "captura.png", { type: "image/png" });
  const upload = { url: "https://bucket.example.test/", fields: { key: "tmp/f1/a1", "Content-Type": "image/png", policy: "p", "x-amz-signature": "s" } };
  assert.equal(await api.uploadAttachmentToS3(upload, file), undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bucket.example.test/");
  assert.deepEqual(Object.keys(calls[0].init), ["method", "body"]);
  assert.equal(calls[0].init.method, "POST");
  const entries = [...calls[0].init.body.entries()];
  assert.deepEqual(entries.slice(0, -1), Object.entries(upload.fields));
  assert.equal(entries.at(-1)[0], "file");
  assert.equal(entries.at(-1)[1].name, "captura.png");
  assert.deepEqual(timeouts, []);
});

test("upload ao S3 usa o fetch direto mesmo com outro transporte e falha com a mesma mensagem quando recusado", async () => {
  const { api, calls, expired } = await load({ responses: [raw(403, "<Error/>", "application/xml")] });
  api.setTransport(async () => { throw new Error("não deveria usar o transporte da API"); });
  await assert.rejects(api.uploadAttachmentToS3({ url: "https://bucket.example.test/", fields: {} }, new File(["x"], "a.png")),
    { message: "O envio da imagem foi recusado." });
  assert.equal(calls.length, 1);
  assert.deepEqual(expired, []);
});

// Contrato: cada função produz exatamente o (path, options) que o app.js montava antes da extração.
// Entradas com espaço, "/" e "?" deixam visível onde há (ou não) encodeURIComponent.
test("contrato das 34 chamadas: path, método e body idênticos aos do app.js anterior", async () => {
  const { api } = await load();
  const seen = [];
  api.setTransport(async (path, options) => { seen.push([path, options]); return {}; });
  const code = "A B/1?", id = "x y/z", att = "a/b c", body = { campo: 1 };
  const post = (b) => ({ method: "POST", body: b });
  const cases = [
    ["me.get", () => api.me.get(), "/me", undefined],
    ["cohorts.list", () => api.cohorts.list(), "/cohorts", undefined],
    ["cohorts.create", () => api.cohorts.create(body), "/cohorts", post(body)],
    ["cohorts.report", () => api.cohorts.report(code), "/cohorts/A%20B%2F1%3F/report", undefined],
    ["cohorts.studentView", () => api.cohorts.studentView(code, body), "/cohorts/A%20B%2F1%3F/student-view", post(body)],
    ["cohorts.classReport", () => api.cohorts.classReport(code), "/cohorts/A%20B%2F1%3F/class-report", undefined],
    ["cohorts.saveSettings", () => api.cohorts.saveSettings(code, body), "/cohorts/A B/1?/settings", post(body)],
    ["cohorts.saveFocus", () => api.cohorts.saveFocus(code, body), "/cohorts/A B/1?/focus-activities", post(body)],
    ["cohorts.previewImport", () => api.cohorts.previewImport(code, body), "/cohorts/A B/1?/preview", post(body)],
    ["cohorts.publish", () => api.cohorts.publish(code, body), "/cohorts/A B/1?/publish", post(body)],
    ["cohorts.restore", () => api.cohorts.restore(code, body), "/cohorts/A B/1?/restore", post(body)],
    ["reminders.pendingPreview", () => api.reminders.pendingPreview(code, body), "/cohorts/A B/1?/pending-preview", post(body)],
    ["reminders.batchPreview", () => api.reminders.batchPreview(code, body), "/cohorts/A B/1?/pending-preview-batch", post(body)],
    ["reminders.send", () => api.reminders.send(code, body), "/cohorts/A B/1?/send-reminder", post(body)],
    ["reminders.sendBatch", () => api.reminders.sendBatch(code, body), "/cohorts/A B/1?/send-reminders", post(body)],
    ["reminders.senderSettings", () => api.reminders.senderSettings(code), "/cohorts/A B/1?/reminder-settings", undefined],
    ["reminders.verifySender", () => api.reminders.verifySender(code), "/cohorts/A B/1?/verify-sender", post({})],
    ["access.requestInstructorAccess", () => api.access.requestInstructorAccess(), "/access-request", post({})],
    ["access.requests", () => api.access.requests(), "/requests", undefined],
    ["access.rejectRequest", () => api.access.rejectRequest(id), "/requests/x y/z/reject", post({})],
    ["access.instructors", () => api.access.instructors(code), "/cohorts/A B/1?/instructors", undefined],
    ["access.addInstructor", () => api.access.addInstructor(code, body), "/cohorts/A B/1?/instructors", post(body)],
    ["access.revokeInstructor", () => api.access.revokeInstructor(code, body), "/cohorts/A B/1?/revoke-instructor", post(body)],
    ["access.searchStudents", () => api.access.searchStudents(code, body), "/cohorts/A B/1?/students-search", post(body)],
    ["access.unlinkStudent", () => api.access.unlinkStudent(code, body), "/cohorts/A B/1?/unlink-student", post(body)],
    ["access.setDisplayName", () => api.access.setDisplayName(code, body), "/cohorts/A B/1?/display-name", post(body)],
    ["feedback.listMine", () => api.feedback.listMine(null), "/feedback?limit=20", undefined],
    ["feedback.listMine", () => api.feedback.listMine("c/1 2"), "/feedback?limit=20&cursor=c%2F1%202", undefined],
    ["feedback.create", () => api.feedback.create(body), "/feedback", post(body)],
    ["feedback.attachments", () => api.feedback.attachments(id), "/feedback/x%20y%2Fz/attachments", undefined],
    ["feedback.attachmentUrl", () => api.feedback.attachmentUrl(id, att), "/feedback/x%20y%2Fz/attachments/a%2Fb%20c", undefined],
    ["feedback.createAttachment", () => api.feedback.createAttachment(id, body), "/feedback/x%20y%2Fz/attachments", post(body)],
    ["feedback.completeAttachment", () => api.feedback.completeAttachment(id, att), "/feedback/x%20y%2Fz/attachments/a%2Fb%20c/complete", post({})],
    ["adminFeedback.list", () => api.adminFeedback.list({ status: "", type: "", cohort: "" }, null), "/admin/feedback?limit=50", undefined],
    ["adminFeedback.list", () => api.adminFeedback.list({ status: "NEW", type: "", cohort: "B 1" }, "c/1 2"), "/admin/feedback?limit=50&status=NEW&cohort=B+1&cursor=c%2F1+2", undefined],
    ["adminFeedback.setStatus", () => api.adminFeedback.setStatus(id, body), "/admin/feedback/x%20y%2Fz/status", post(body)],
  ];
  const covered = new Set();
  for (const [name, call, path, options] of cases) {
    seen.length = 0;
    await call();
    assert.deepEqual(seen, [[path, options]], name);
    if (options?.body === body) assert.equal(seen[0][1].body, body, `${name}: body repassado sem cópia`);
    covered.add(name);
  }
  const exported = ["me", "cohorts", "reminders", "access", "feedback", "adminFeedback"]
    .flatMap((group) => Object.keys(api[group]).map((fn) => `${group}.${fn}`));
  assert.equal(exported.length, 34);
  assert.deepEqual([...covered].sort(), exported.sort());
});

// Camada de rede (frontend/api.js) sem navegador: fetch, relógio e sessão simulados.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Participação (C7.2.4): a rota de escrita recebe exatamente o corpo montado pelo app.js e devolve a resposta do
// backend. Erros HTTP levam o status (o app.js recarrega o detalhe em 409 e 404); a falha de rede continua sendo o
// mesmo erro do fetch, só marcada como network.
test("setParticipation faz POST autenticado com o corpo exato e devolve a resposta", async () => {
  const reply = { canvasId: "101", participationStatus: "WITHDRAWN", updatedAt: "2026-10-04T12:00:00Z" };
  const { api, calls } = await load({ responses: [json(200, reply)] });
  const body = { canvasId: "101", status: "WITHDRAWN", expectedStatus: "ACTIVE" };
  assert.deepEqual(await api.cohorts.setParticipation("BRSA0267", body), reply);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/cohorts/BRSA0267/participation");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
});

test("erros HTTP levam o status; a falha de rede é o mesmo erro do fetch, marcado como network", async () => {
  for (const [status, error] of [[400, "Solicitação inválida."], [403, "Você não tem acesso a esta operação."], [404, "Aluno não encontrado nesta turma."],
    [409, "A participação deste aluno foi alterada por outra pessoa. Recarregue e tente de novo."], [500, "Falha interna."]]) {
    const { api } = await load({ responses: [json(status, { error })] });
    await assert.rejects(api.cohorts.setParticipation("BRSA0267", {}), { message: error, status });
  }
  for (const [response, message, status] of [[raw(503, "<html>Gateway</html>", "text/html"), UNAVAILABLE, 503], [json(429, {}), BUSY, 429], [json(500, {}), GENERIC, 500]]) {
    const { api } = await load({ responses: [response] });
    await assert.rejects(api.cohorts.setParticipation("BRSA0267", {}), { message, status });
  }
  const boom = new TypeError("Failed to fetch");
  const { api } = await load({ responses: [boom] });
  await assert.rejects(api.cohorts.setParticipation("BRSA0267", {}), (err) => err === boom && err.network === true && err.status === undefined);
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
    ["cohorts.setParticipation", () => api.cohorts.setParticipation(code, body), "/cohorts/A%20B%2F1%3F/participation", post(body)],
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
  assert.equal(exported.length, 35);
  assert.deepEqual([...covered].sort(), exported.sort());
});

// Contrato com a infraestrutura: o API Gateway só encaminha as rotas listadas em infra/terraform/api.tf. Uma chamada sem
// rota lá recebe 404 sem CORS, que o navegador mostra como falha de rede, e nunca chega à Lambda (o que aconteceu com a
// participação até a C7.2.4.1). As route keys vêm de todos os aws_apigatewayv2_route; formato desconhecido falha.
function gatewayRoutes() {
  const tf = readFileSync(new URL("../infra/terraform/api.tf", import.meta.url), "utf8");
  const keys = [];
  for (const { 0: header, 1: name, index } of tf.matchAll(/^resource "aws_apigatewayv2_route" "(\w+)" \{$/gm)) {
    const block = tf.slice(index, tf.indexOf("\n}\n", index));
    const literal = block.match(/route_key\s+= "([^"]+)"/);
    const listed = block.match(/for_each = toset\(\[([\s\S]*?)\]\)/);
    assert.ok(literal || (listed && /route_key\s+= each\.value/.test(block)), `${header}: route_key em formato não reconhecido (${name})`);
    keys.push(...(literal ? [literal[1]] : [...listed[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])));
  }
  return keys;
}
// Assinatura comparável: método + caminho sem query, com cada parâmetro ({code}, {userId}… ou o valor P0/P1/P2 usado na
// chamada) reduzido a {}.
const signature = (method, path) =>
  `${method} ${path.split("?")[0].split("/").map((s) => (/^\{[^}]+\}$|^P\d$/.test(s) ? "{}" : s)).join("/")}`;
// Rotas publicadas antes de o frontend chamá-las (rodada só de backend): entram aqui, com a rodada, até o frontend usar.
const PUBLISHED_BEFORE_FRONTEND = new Set();

test("contrato com o API Gateway: toda chamada do api.js tem rota no api.tf e toda rota do api.tf é chamada", async () => {
  const { api } = await load();
  let seen = [];
  api.setTransport(async (path, options) => { seen.push(signature(options?.method || "GET", path)); return {}; });
  // Grupos da API do portal: objetos exportados só com funções. Fora do API Gateway, de propósito: signupConfirmation
  // (Cognito direto) e uploadAttachmentToS3 (POST assinado direto no S3, que não é objeto).
  const groups = Object.entries(api).filter(([name, value]) => name !== "signupConfirmation" && value && typeof value === "object"
    && !Array.isArray(value) && Object.values(value).every((fn) => typeof fn === "function"));
  const calls = new Set();
  for (const [group, functions] of groups)
    for (const [name, fn] of Object.entries(functions)) {
      seen = [];
      await fn("P0", "P1", "P2");
      assert.equal(seen.length, 1, `${group}.${name}: exatamente uma chamada pelo transporte da API`);
      calls.add(seen[0]);
    }
  const keys = gatewayRoutes();
  assert.equal(new Set(keys).size, keys.length, "route key repetida no api.tf");
  const published = new Set(keys.map((key) => signature(...key.split(" "))));
  assert.deepEqual([...calls].filter((c) => !published.has(c)).sort(), [], "chamadas do frontend sem rota no API Gateway");
  assert.deepEqual([...published].filter((r) => !calls.has(r) && !PUBLISHED_BEFORE_FRONTEND.has(r)).sort(), [], "rotas do API Gateway que o frontend não chama");
  assert.ok(calls.has("POST /cohorts/{}/participation"), "api.cohorts.setParticipation → POST /cohorts/{code}/participation");
});

// Confirmação de cadastro: operações públicas do Cognito chamadas direto do navegador, fora do transporte
// autenticado. Região, client, e-mails e códigos são fictícios; nenhuma chamada de rede real.
const signupConfig = { ...config, region: "sa-east-1", userPoolClientId: "exampleclient123" };
const COGNITO = "https://cognito-idp.sa-east-1.amazonaws.com/";
const AWS_MESSAGE = "Mensagem bruta da AWS que não pode chegar à interface";
const awsError = (type, status = 400) => () =>
  new Response(JSON.stringify({ __type: type, message: AWS_MESSAGE }), { status, headers: { "content-type": "application/x-amz-json-1.1" } });
async function loadSignup({ signup = signupConfig, ...options } = {}) {
  const loaded = await load({ session: null, ...options, configured: false });
  loaded.api.configure({ config: signup, onSessionExpired: () => loaded.expired.push("callback") });
  return loaded;
}
const categoryOf = (promise) => promise.then(() => "resolveu", (err) => err.category);

test("normalizeSignupEmail: só trim e minúsculas; formato, tamanho e tipo inválidos viram null", async () => {
  const { api } = await load({ configured: false });
  for (const [input, expected] of [
    [" USER@Example.COM ", "user@example.com"],
    ["\tAna@Escola.ORG\n", "ana@escola.org"],
    ["First.Last+Tag@Example.com", "first.last+tag@example.com"],
    ["JOÃO@Exemplo.com.br", "joão@exemplo.com.br"],
    [`${"a".repeat(116)}@example.com`, `${"a".repeat(116)}@example.com`],
  ]) assert.equal(api.normalizeSignupEmail(input), expected, input);
  for (const input of ["", "   ", "sem-arroba.example.com", "user@localhost", "@example.com", "user@", "a b@example.com",
    "user@exa mple.com", "a@b@example.com", `${"a".repeat(117)}@example.com`, "ana\u0000@example.com", null, undefined, 42, {}])
    assert.equal(api.normalizeSignupEmail(input), null, String(input));
});

test("resend: POST no Cognito regional com o target, o ClientId e o Username normalizado, e devolve só { ok: true }", async () => {
  const { api, calls, expired } = await loadSignup({ responses: [json(200, { CodeDeliveryDetails: { Destination: "u***@e***" } })] });
  assert.deepEqual(await api.signupConfirmation.resend(" USER@Example.COM "), { ok: true });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, COGNITO);
  assert.deepEqual(Object.keys(init), ["method", "headers", "body", "cache", "credentials", "signal"]);
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.ResendConfirmationCode" });
  assert.deepEqual(JSON.parse(init.body), { ClientId: "exampleclient123", Username: "user@example.com" });
  assert.equal(init.cache, "no-store");
  assert.deepEqual(expired, []);
});

test("confirm: POST com ConfirmSignUp, ClientId, Username normalizado e o código como string, sem outros campos", async () => {
  const { api, calls } = await loadSignup();
  assert.deepEqual(await api.signupConfirmation.confirm(" Pessoa@Example.COM ", "987654"), { ok: true });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, COGNITO);
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.ConfirmSignUp" });
  assert.deepEqual(JSON.parse(init.body), { ClientId: "exampleclient123", Username: "pessoa@example.com", ConfirmationCode: "987654" });
});

test("zero Authorization, zero cookies e nenhuma chamada à API do portal, mesmo com sessão ativa", async () => {
  const { api, calls, expired } = await loadSignup({ session: validSession });
  api.setTransport(async () => { throw new Error("não deveria usar o transporte autenticado"); });
  await api.signupConfirmation.resend("user@example.com");
  await api.signupConfirmation.confirm("user@example.com", "123456");
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, COGNITO);
    assert.ok(!url.startsWith(config.apiUrl));
    assert.deepEqual(Object.keys(init.headers).map((h) => h.toLowerCase()).sort(), ["content-type", "x-amz-target"]);
    assert.equal(init.credentials, "omit");
    for (const forbidden of ["tok", "Bearer", "SecretHash", "Password", "Session", "ForceAliasCreation", "ClientMetadata", "UserContextData"])
      assert.ok(!init.body.includes(forbidden), forbidden);
  }
  assert.deepEqual(expired, []);
});

test("o código nunca vai na URL: endpoint fixo, sem query string", async () => {
  const { api, calls } = await loadSignup();
  await api.signupConfirmation.confirm("user@example.com", "987654");
  assert.equal(calls[0].url, COGNITO);
  assert.ok(!calls[0].url.includes("?") && !calls[0].url.includes("987654"));
});

test("código como string: preserva zero à esquerda e apara; número, vazio ou com espaço interno é recusado sem requisição", async () => {
  const { api, calls } = await loadSignup();
  await api.signupConfirmation.confirm("user@example.com", " 012345 ");
  assert.equal(JSON.parse(calls[0].init.body).ConfirmationCode, "012345");
  for (const code of [12345, "", "   ", "12 34", null, undefined])
    assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", code)), "INVALID_CODE", String(code));
  assert.equal(calls.length, 1);
});

test("e-mail inválido bloqueia a requisição com INVALID_EMAIL", async () => {
  const { api, calls } = await loadSignup();
  assert.equal(await categoryOf(api.signupConfirmation.resend("sem-arroba.example.com")), "INVALID_EMAIL");
  assert.equal(await categoryOf(api.signupConfirmation.confirm("", "123456")), "INVALID_EMAIL");
  assert.equal(calls.length, 0);
});

test("endpoint vem só de config.region; região malformada é CONFIG_ERROR sem requisição", async () => {
  for (const region of ["eu-west-2", "us-gov-west-1", "ap-southeast-2"]) {
    const { api, calls } = await loadSignup({ signup: { ...signupConfig, region } });
    await api.signupConfirmation.resend("user@example.com");
    assert.equal(calls[0].url, `https://cognito-idp.${region}.amazonaws.com/`);
  }
  for (const region of ["", "US-EAST-1", "us-east-1.evil.example", "https://evil.example", "us-east-1/", "us east 1", 1, null]) {
    const { api, calls } = await loadSignup({ signup: { ...signupConfig, region } });
    assert.equal(await categoryOf(api.signupConfirmation.resend("user@example.com")), "CONFIG_ERROR", String(region));
    assert.equal(calls.length, 0, String(region));
  }
});

test("configuração ausente ou incompleta: CONFIG_ERROR e nenhuma requisição", async () => {
  const { region, userPoolClientId, ...semNada } = signupConfig;
  for (const signup of [semNada, { ...signupConfig, region: undefined }, { ...signupConfig, userPoolClientId: undefined },
    { ...signupConfig, userPoolClientId: "cliente inválido!" }]) {
    const { api, calls } = await loadSignup({ signup });
    assert.equal(await categoryOf(api.signupConfirmation.resend("user@example.com")), "CONFIG_ERROR");
    assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", "123456")), "CONFIG_ERROR");
    assert.equal(calls.length, 0);
  }
  const { api, calls } = await load({ configured: false });
  assert.equal(await categoryOf(api.signupConfirmation.resend("user@example.com")), "CONFIG_ERROR");
  assert.equal(calls.length, 0);
});

test("Session devolvida pelo ConfirmSignUp não é propagada nem persistida", async () => {
  const session = "sessao-ficticia-0123456789abcdef";
  const writes = [];
  globalThis.sessionStorage = { getItem: () => null, setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) };
  try {
    const { api } = await loadSignup({ responses: [json(200, { Session: session })] });
    const result = await api.signupConfirmation.confirm("user@example.com", "123456");
    assert.deepEqual(result, { ok: true });
    assert.ok(!JSON.stringify(result).includes(session));
    assert.deepEqual([...storage.keys()], []);
    assert.deepEqual(writes, []);
  } finally { delete globalThis.sessionStorage; }
});

test("erros do código: CodeMismatch → CODE_MISMATCH e ExpiredCode → CODE_EXPIRED", async () => {
  for (const [type, category] of [["CodeMismatchException", "CODE_MISMATCH"], ["ExpiredCodeException", "CODE_EXPIRED"]]) {
    const { api } = await loadSignup({ responses: [awsError(type)] });
    assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", "123456")), category, type);
  }
});

test("limites: TooManyFailedAttempts e LimitExceeded → TOO_MANY_ATTEMPTS; TooManyRequests (vazão do serviço) → RATE_LIMITED", async () => {
  for (const [type, category] of [["TooManyFailedAttemptsException", "TOO_MANY_ATTEMPTS"], ["LimitExceededException", "TOO_MANY_ATTEMPTS"],
    ["TooManyRequestsException", "RATE_LIMITED"]]) {
    const { api } = await loadSignup({ responses: [awsError(type)] });
    assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", "123456")), category, type);
  }
});

test("estado da conta: NotAuthorized → NOT_AUTHORIZED e UserNotFound → USER_NOT_FOUND, sem texto sobre a conta", async () => {
  for (const [type, category] of [["NotAuthorizedException", "NOT_AUTHORIZED"], ["UserNotFoundException", "USER_NOT_FOUND"]]) {
    const { api } = await loadSignup({ responses: [awsError(type)] });
    const err = await api.signupConfirmation.confirm("user@example.com", "123456").catch((e) => e);
    assert.equal(err.category, category, type);
    assert.equal(err.message, category);
  }
});

test("serviço: HTTP 500, InternalError e 5xx sem corpo → SERVICE_UNAVAILABLE", async () => {
  for (const response of [awsError("InternalErrorException", 500), raw(500, "", null), raw(503, "<html>Service Unavailable</html>", "text/html")]) {
    const { api } = await loadSignup({ responses: [response] });
    assert.equal(await categoryOf(api.signupConfirmation.resend("user@example.com")), "SERVICE_UNAVAILABLE");
  }
});

test("tipo do erro com namespace no corpo ou no cabeçalho x-amzn-ErrorType; tipo desconhecido ou sem tipo → UNKNOWN", async () => {
  const header = () => new Response("", { status: 400, headers: { "x-amzn-ErrorType": "ExpiredCodeException:http://internal.amazon.com/coral/com.amazonaws.cognito.identity.idp/" } });
  for (const [response, category] of [[awsError("com.amazonaws.cognito.identity.idp.model#CodeMismatchException"), "CODE_MISMATCH"],
    [header, "CODE_EXPIRED"], [awsError("AlgoNovoException"), "UNKNOWN"], [awsError("constructor"), "UNKNOWN"], [awsError("__proto__"), "UNKNOWN"],
    [raw(400, "{quebrado", "application/x-amz-json-1.1"), "UNKNOWN"], [raw(429, "", null), "RATE_LIMITED"]]) {
    const { api } = await loadSignup({ responses: [response] });
    assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", "123456")), category);
  }
});

test("todos os erros documentados das duas operações têm categoria própria (nenhum cai em UNKNOWN)", async () => {
  const expected = {
    CodeMismatchException: "CODE_MISMATCH", ExpiredCodeException: "CODE_EXPIRED", TooManyFailedAttemptsException: "TOO_MANY_ATTEMPTS",
    LimitExceededException: "TOO_MANY_ATTEMPTS", TooManyRequestsException: "RATE_LIMITED", NotAuthorizedException: "NOT_AUTHORIZED",
    InvalidParameterException: "INVALID_PARAMETER", UserNotFoundException: "USER_NOT_FOUND", AliasExistsException: "ALIAS_EXISTS",
    CodeDeliveryFailureException: "DELIVERY_FAILED", InternalErrorException: "SERVICE_UNAVAILABLE", ForbiddenException: "SERVICE_UNAVAILABLE",
    ResourceNotFoundException: "CONFIG_ERROR", OperationNotEnabledException: "CONFIG_ERROR", InvalidEmailRoleAccessPolicyException: "CONFIG_ERROR",
    InvalidSmsRoleAccessPolicyException: "CONFIG_ERROR", InvalidSmsRoleTrustRelationshipException: "CONFIG_ERROR",
    InvalidLambdaResponseException: "CONFIG_ERROR", UnexpectedLambdaException: "CONFIG_ERROR", UserLambdaValidationException: "CONFIG_ERROR",
  };
  for (const [type, category] of Object.entries(expected)) {
    const { api } = await loadSignup({ responses: [awsError(type)] });
    const call = type === "CodeDeliveryFailureException" ? api.signupConfirmation.resend("user@example.com") : api.signupConfirmation.confirm("user@example.com", "123456");
    assert.equal(await categoryOf(call), category, type);
  }
});

test("erro público é só a categoria: sem mensagem da AWS, sem e-mail e sem código; o tipo AWS fica oculto", async () => {
  const { api } = await loadSignup({ responses: [awsError("CodeMismatchException")] });
  const err = await api.signupConfirmation.confirm("Pessoa@Example.com", "987654").catch((e) => e);
  assert.ok(err instanceof api.SignupConfirmationError);
  assert.equal(err.message, "CODE_MISMATCH");
  assert.equal(err.awsType, "CodeMismatchException");
  assert.ok(!Object.keys(err).includes("awsType"));
  const exposed = [err.message, String(err), JSON.stringify(err), err.stack].join("\n");
  for (const secret of [AWS_MESSAGE, "pessoa@example.com", "Pessoa@Example.com", "987654", "CodeMismatchException"])
    assert.ok(!exposed.includes(secret), secret);
});

test("resend: envio real e simulado resolvem igual; resultados que dependem do estado da conta ficam marcados", async () => {
  const results = [];
  for (const body of [{ CodeDeliveryDetails: { AttributeName: "email", DeliveryMedium: "EMAIL", Destination: "u***@e***" } }, {}]) {
    const { api } = await loadSignup({ responses: [json(200, body)] });
    results.push(await api.signupConfirmation.resend("user@example.com"));
  }
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  const { api } = await load({ configured: false });
  const accountState = new Set(api.ACCOUNT_STATE_CATEGORIES);
  for (const type of ["InvalidParameterException", "UserNotFoundException", "NotAuthorizedException", "LimitExceededException", "CodeDeliveryFailureException"]) {
    const loaded = await loadSignup({ responses: [awsError(type)] });
    assert.ok(accountState.has(await categoryOf(loaded.api.signupConfirmation.resend("user@example.com"))), type);
  }
  for (const response of [awsError("TooManyRequestsException"), awsError("InternalErrorException", 500), new TypeError("Failed to fetch")]) {
    const loaded = await loadSignup({ responses: [response] });
    assert.ok(!accountState.has(await categoryOf(loaded.api.signupConfirmation.resend("user@example.com"))));
  }
  assert.ok(Object.isFrozen(api.ACCOUNT_STATE_CATEGORIES));
});

test("falha de rede → NETWORK_ERROR; timeout do AbortSignal.timeout da camada → TIMEOUT", async () => {
  let { api, calls } = await loadSignup({ responses: [new TypeError("Failed to fetch")] });
  assert.equal(await categoryOf(api.signupConfirmation.resend("user@example.com")), "NETWORK_ERROR");
  assert.equal(calls.length, 1);
  ({ api, calls } = await loadSignup({ responses: [new DOMException("The operation timed out.", "TimeoutError")] }));
  assert.equal(await categoryOf(api.signupConfirmation.confirm("user@example.com", "123456")), "TIMEOUT");
  assert.equal(timeouts.length, 1);
  assert.equal(calls[0].init.signal, timeouts[0].signal);
  assert.ok(timeouts[0].ms > 0 && timeouts[0].ms <= 35000);
});

test("nada vai para o console nem para o storage em sucesso ou erro", async () => {
  const methods = ["log", "info", "warn", "error", "debug"], original = Object.fromEntries(methods.map((m) => [m, console[m]])), logged = [];
  for (const m of methods) console[m] = (...args) => logged.push([m, ...args]);
  try {
    for (const response of [json(200, { Session: "sessao-ficticia" }), awsError("CodeMismatchException"), new TypeError("Failed to fetch")]) {
      const { api } = await loadSignup({ responses: [response] });
      await api.signupConfirmation.resend("user@example.com").catch(() => {});
      await api.signupConfirmation.confirm("user@example.com", "012345").catch(() => {});
      assert.deepEqual([...storage.keys()], []);
    }
  } finally { Object.assign(console, original); }
  assert.deepEqual(logged, []);
});

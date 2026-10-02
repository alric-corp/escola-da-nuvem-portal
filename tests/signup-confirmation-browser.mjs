// Teste isolado com o Cognito simulado: região e ClientId fictícios, e-mails e códigos inventados. Nunca acessa a
// AWS: toda requisição que não vai ao servidor local é interceptada, e no fim nenhuma pode ter escapado.
// Confirmação de cadastro na landing: entrada, envio e reenvio do código, confirmação, mensagens fixas, a mesma tela
// para qualquer resultado que dependa da conta, intervalo de reenvio com relógio controlado, foco e teclado,
// respostas atrasadas, recarga, larguras de 375 a 1440 px e o login de sempre no fim.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// A região não existe (nenhum DNS resolve o endpoint); ClientId, domínio de login, e-mails e códigos são inventados.
const REGION = "xx-test-1", CLIENT_ID = "exampleclient123";
const COGNITO = `https://cognito-idp.${REGION}.amazonaws.com/`;
const AUTH = "https://auth.example.test";
const CONFIG = { apiUrl: `${origin}/api`, authDomain: AUTH, userPoolClientId: CLIENT_ID, region: REGION, redirectUri: `${origin}/`,
  logoutUri: `${origin}/`, scopes: ["openid", "email", "portal/access"] };
const T0 = Date.parse("2026-10-02T12:00:00Z"), NOW = T0 + 10_000;
const EMAIL = "ana.souza@example.test", MASKED = "an***@example.test";
const LONG_EMAIL = "ana.souza@turma-de-teste-com-um-dominio-bem-comprido.example.test";
const CODE_OK = "246813", CODE_BAD = "975310";
const BLANK = { step: "", email: "", sending: false, confirming: false, error: "", resendAvailableAt: 0, confirmed: false };
const INTRO = "Se você criou sua conta e não conseguiu concluir a confirmação, podemos enviar um novo código.";
const UNIFORM = (masked) => `Se houver um cadastro pendente para ${masked}, enviamos um código. Pode levar alguns minutos; confira o spam. Se você já confirmou sua conta, pode fazer login.`;
const WAIT = "Você poderá pedir outro código em até 1 minuto.";
const DONE = "Cadastro confirmado. Agora entre com seu e-mail e senha.";
const MESSAGES = {
  INVALID_EMAIL: "Digite um e-mail válido.",
  INVALID_CODE: "Digite o código recebido por e-mail.",
  WRONG_CODE: "Código incorreto. Use o código mais recente que enviamos.",
  EXPIRED_CODE: "Este código expirou. Peça um novo.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas. Aguarde alguns minutos.",
  ALREADY_CONFIRMED_OR_UNAVAILABLE: "Não foi possível confirmar com este código. Se você já confirmou, tente fazer login.",
  TEMPORARY_FAILURE: "Não foi possível concluir agora. Tente novamente em instantes.",
  CONFIGURATION_FAILURE: "A confirmação está indisponível no momento.",
};

// Respostas do "Cognito": aceite, erro da AWS (tipo em __type) e falha de rede.
const accepted = () => ({ status: 200, body: { CodeDeliveryDetails: { AttributeName: "email", DeliveryMedium: "EMAIL", Destination: "a***@e***" } } });
const confirmedReply = () => ({ status: 200, body: {} });
const awsError = (type, status = 400) => () => ({ status, body: { __type: type, message: "Mensagem bruta da AWS" } });
const offline = () => "abort";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const allowed = (url) => url.startsWith(`${origin}/`) || url === COGNITO || url.startsWith(`${AUTH}/oauth2/authorize?`);
const totals = { pages: 0, cognito: 0, external: 0, networkLog: 0 };
const measured = {};

let browser;

// Página nova com o relógio parado em NOW depois que a landing aparece. replies: fila de respostas por operação;
// sem nada na fila, o Cognito aceita.
async function open({ config = CONFIG, width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const log = { requests: [], cognito: [], portal: [], authorize: [], external: [], console: [] };
  const replies = { ResendConfirmationCode: [], ConfirmSignUp: [] };
  page.on("request", (request) => log.requests.push(request.url()));
  page.on("console", (message) => {
    // O próprio Chromium registra cada resposta de erro (4xx/5xx) ou falha de rede do Cognito simulado; não é saída do
    // app. Só essas linhas, com a origem no endpoint simulado, ficam de fora (e são contadas); qualquer outra conta.
    if (message.type() === "error" && message.location().url === COGNITO && /^Failed to load resource: /.test(message.text())) return void totals.networkLog++;
    log.console.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => log.console.push(`pageerror: ${error.message}`));
  await context.route((url) => url.origin !== origin || url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request(), url = request.url();
    if (url === COGNITO && request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type, x-amz-target" } });
    if (url === COGNITO) {
      const operation = (request.headers()["x-amz-target"] || "").replace("AWSCognitoIdentityProviderService.", "");
      log.cognito.push({ operation, method: request.method(), headers: request.headers(), body: request.postDataJSON() });
      const reply = await (replies[operation]?.shift() || (operation === "ConfirmSignUp" ? confirmedReply : accepted))();
      if (reply === "abort") return route.abort("failed");
      return route.fulfill({ status: reply.status, headers: { "content-type": "application/x-amz-json-1.1", "access-control-allow-origin": "*" },
        body: JSON.stringify(reply.body) });
    }
    // O login de sempre navega para o domínio do Cognito: 204 registra a navegação sem sair da página.
    if (url.startsWith(`${AUTH}/oauth2/authorize?`)) {
      log.authorize.push(url);
      return route.fulfill({ status: 204 });
    }
    if (new URL(url).origin === origin) {
      log.portal.push(url);
      return route.fulfill({ status: 401, json: { error: "não usado" } });
    }
    log.external.push(url);
    return route.abort("blockedbyclient");
  });
  await context.route(`${origin}/config.json`, (route) => route.fulfill({ json: config }));
  await page.addInitScript(() => {
    // Renders: cada troca do conteúdo de #app ou da coluna de texto da landing conta um.
    window.__renders = 0;
    new MutationObserver((records) => {
      for (const record of records)
        if (record.removedNodes.length && record.addedNodes.length && (record.target.id === "app" || record.target.matches?.(".welcome-grid > section")))
          window.__renders++;
    }).observe(document, { childList: true, subtree: true });
    // Escritas em storage, com chave e valor.
    window.__storage = [];
    for (const method of ["setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.__storage.push([this === window.localStorage ? "local" : "session", method, ...args]);
        return original.apply(this, args);
      };
    }
  });
  await page.clock.install({ time: T0 });
  await page.goto(origin);
  await page.locator("main.welcome").waitFor();
  await page.clock.pauseAt(NOW);
  totals.pages++;
  return { context, page, log, replies };
}

// Fim de cada página: nada além do servidor local, do Cognito simulado e do login simulado; nenhuma chamada à API do
// portal; console limpo.
async function close({ context, log }, label) {
  assert.deepEqual(log.requests.filter((url) => !allowed(url)), [], `${label}: requisição fora do esperado`);
  assert.deepEqual(log.external, [], `${label}: requisição externa sem simulação`);
  assert.deepEqual(log.portal, [], `${label}: a confirmação não chama a API do portal`);
  assert.deepEqual(log.console, [], `${label}: console limpo`);
  totals.cognito += log.cognito.length;
  totals.external += log.external.length;
  await context.close();
}

const entry = (page) => page.getByRole("button", { name: "Confirmar cadastro", exact: true });
const heading = (page, name) => page.getByRole("heading", { level: 1, name, exact: true });
const emailField = (page) => page.getByRole("textbox", { name: "E-mail", exact: true });
const codeField = (page) => page.getByRole("textbox", { name: "Código de confirmação", exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const alerts = (page) => page.locator("#app [role=alert]").allInnerTexts();
const renders = (page) => page.evaluate(() => window.__renders);
const storageWrites = (page) => page.evaluate(() => window.__storage.slice());
const slice = (page) => page.evaluate(async () => JSON.parse(JSON.stringify((await import("/state.js")).state.signupConfirmation)));
// Uma ida e volta de rede feita pela própria página: respostas já liberadas são processadas antes.
const flushNetwork = (page) => page.evaluate(() => fetch("/index.html", { cache: "no-store" }).then((r) => r.text()).then(() => true));
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "body";
  const name = el.labels?.[0]?.textContent.trim() || el.getAttribute("aria-label") || el.textContent.trim() || el.querySelector("img")?.alt || "";
  return `${el.tagName.toLowerCase()}:${name}`;
});
// Espera o envio ou a confirmação terminar (respostas não retidas).
async function settle(page) {
  for (let i = 0; i < 50; i++) {
    await flushNetwork(page);
    const s = await slice(page);
    if (!s.sending && !s.confirming) return;
  }
  assert.fail("o fluxo não terminou");
}
// O evento de request chega antes do handler da rota registrar a navegação de login: espera o registro.
async function authorizations(page, log, expected) {
  for (let i = 0; i < 20 && log.authorize.length < expected; i++) await flushNetwork(page);
  return log.authorize.length;
}
async function openFlow(page) {
  await entry(page).click();
  await heading(page, "Confirmar cadastro").waitFor();
}
async function sendCode(page, email = EMAIL) {
  await emailField(page).fill(email);
  await emailField(page).press("Enter");
  await heading(page, "Digite o código").waitFor();
}

try {
  browser = await chromium.launch({ headless: true });

  // 1. Entrada: "Confirmar cadastro" logo depois de "Primeiro acesso?", só com região e cliente do Cognito na
  // configuração. Sem eles, a landing é a de antes, byte a byte.
  {
    const full = await open(), { page } = full;
    assert.equal(await entry(page).count(), 1);
    assert.deepEqual(await entry(page).evaluate((el) => ({ type: el.type, action: el.dataset.action, after: el.previousElementSibling?.className,
      column: !!el.closest(".welcome-grid > section") })), { type: "button", action: "signup-confirmation-start", after: "first-access", column: true });
    assert.equal(await page.getByRole("button", { name: /Entrar no meu portal/ }).count(), 1);
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    const withoutEntry = await page.locator("#app").evaluate((app) => {
      const copy = app.cloneNode(true);
      copy.querySelector('[data-action="signup-confirmation-start"]').remove();
      return copy.innerHTML;
    });
    for (const config of [{ ...CONFIG, region: undefined }, { ...CONFIG, userPoolClientId: undefined }, { ...CONFIG, region: "" }, { apiUrl: CONFIG.apiUrl }, {}]) {
      const partial = await open({ config });
      assert.equal(await entry(partial.page).count(), 0, JSON.stringify(config));
      assert.equal(await partial.page.locator("#app").innerHTML(), withoutEntry, `sem região e cliente, a landing de antes: ${JSON.stringify(config)}`);
      await close(partial, "configuração incompleta");
    }
    assert.deepEqual([full.log.cognito, await storageWrites(page)], [[], [["local", "removeItem", "avanca.session"], ["local", "removeItem", "avanca.oauth"]]]);
    await close(full, "entrada");
  }

  // 2. Etapa EMAIL: título focado, texto, campo de e-mail e botões, no lugar da coluna de texto da landing. E-mail
  // inválido não chama o Cognito, mostra a mensagem fixa, mantém o que foi digitado (como texto) e leva o foco ao campo.
  {
    const opened = await open(), { page, log } = opened;
    let before = await renders(page);
    await openFlow(page);
    measured.abrir = (await renders(page)) - before;
    assert.equal(await focused(page), "h1:Confirmar cadastro");
    assert.equal(await heading(page, "Confirmar cadastro").getAttribute("tabindex"), "-1");
    await page.getByText(INTRO, { exact: true }).waitFor();
    assert.deepEqual(await emailField(page).evaluate((el) => ({ type: el.type, autocomplete: el.autocomplete, value: el.value, readOnly: el.readOnly })),
      { type: "email", autocomplete: "email", value: "", readOnly: false });
    assert.equal(await button(page, "Enviar código").getAttribute("type"), "submit");
    assert.equal(await button(page, "Voltar").getAttribute("type"), "button");
    // A coluna da landing saiu: um só título, nenhum botão de login nem de entrada duplicado; cabeçalho e arte ficam.
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll("h1").length, document.querySelectorAll('[data-action="login"]').length,
      document.querySelectorAll('[data-action="signup-confirmation-start"]').length, !!document.querySelector(".welcome-header .brand"),
      !!document.querySelector(".welcome-art"), !!document.querySelector(".welcome-footer")]), [1, 0, 0, true, true, true]);
    await button(page, "Enviar código").click();
    assert.deepEqual(await alerts(page), [MESSAGES.INVALID_EMAIL]);
    assert.equal(await focused(page), "input:E-mail");
    // Tentativa de injeção: continua texto no campo, nenhum elemento novo, nada executa.
    const payload = '"><img src=x onerror="window.__xss=1">';
    await emailField(page).fill(payload);
    before = await renders(page);
    await button(page, "Enviar código").click();
    measured.emailInvalido = (await renders(page)) - before;
    assert.equal(await page.locator("#app img:not(.brand-logo)").count(), 0, "a injeção não vira elemento");
    assert.deepEqual(await alerts(page), [MESSAGES.INVALID_EMAIL]);
    assert.equal(await emailField(page).inputValue(), payload);
    assert.equal(await emailField(page).getAttribute("aria-invalid"), "true");
    assert.equal(await focused(page), "input:E-mail");
    await flushNetwork(page);
    assert.equal(await page.evaluate(() => window.__xss), undefined, "a injeção não executa");
    assert.equal(await page.locator("#notices").innerHTML(), "", "erro na própria etapa, sem aviso global");
    assert.deepEqual(log.cognito, []);
    assert.deepEqual(await slice(page), { ...BLANK, step: "email", email: payload, error: "INVALID_EMAIL" });
    await close(opened, "e-mail inválido");
  }

  // 3. Primeiro envio: um POST ao Cognito simulado com o ClientId da configuração e o e-mail normalizado, sem
  // credenciais. Etapa CODE com a mensagem uniforme, e-mail mascarado, campo de código vazio e foco no título.
  {
    const opened = await open(), { page, log } = opened;
    await openFlow(page);
    const before = await renders(page);
    await emailField(page).fill("  Ana.Souza@Example.TEST ");
    await emailField(page).press("Enter");
    await heading(page, "Digite o código").waitFor();
    await flushNetwork(page);
    measured.envio = (await renders(page)) - before;
    assert.equal(log.cognito.length, 1);
    const [call] = log.cognito;
    assert.deepEqual([call.operation, call.method, call.headers["content-type"], call.body],
      ["ResendConfirmationCode", "POST", "application/x-amz-json-1.1", { ClientId: CLIENT_ID, Username: EMAIL }]);
    assert.ok(!("authorization" in call.headers) && !("cookie" in call.headers), JSON.stringify(call.headers));
    assert.equal(await focused(page), "h1:Digite o código");
    assert.equal(await heading(page, "Digite o código").getAttribute("tabindex"), "-1");
    await page.getByText(UNIFORM(MASKED), { exact: true }).waitFor();
    assert.deepEqual(await codeField(page).evaluate((el) => ({ type: el.type, inputMode: el.inputMode, autocomplete: el.autocomplete, value: el.value })),
      { type: "text", inputMode: "numeric", autocomplete: "one-time-code", value: "" });
    assert.equal((await page.locator("#app").innerText()).includes(EMAIL), false, "o e-mail completo não aparece");
    assert.deepEqual(await alerts(page), []);
    assert.equal(await button(page, "Confirmar").getAttribute("type"), "submit");
    assert.equal(await button(page, "Usar outro e-mail").count(), 1);
    assert.equal(await page.getByRole("button", { name: /Voltar|Enviar código|Fazer login|Confirmar cadastro/ }).count(), 0, "sem botões de outras etapas");
    assert.deepEqual(await slice(page), { ...BLANK, step: "code", email: EMAIL, resendAvailableAt: NOW + 60_000 });
    await close(opened, "primeiro envio");

    // Domínio com marcação: aparece só como texto na máscara.
    const odd = await open(), oddPage = odd.page;
    await openFlow(oddPage);
    await sendCode(oddPage, "ana@x<img/src=x/onerror=window.__xss=2>.test");
    await oddPage.getByText(UNIFORM("an***@x<img/src=x/onerror=window.__xss=2>.test"), { exact: true }).waitFor();
    assert.equal(await oddPage.locator("#app img:not(.brand-logo)").count(), 0);
    assert.equal(await oddPage.evaluate(() => window.__xss), undefined);
    await close(odd, "máscara com marcação");
  }

  // 4. Privacidade: todo resultado do envio que depende da conta deixa a mesma tela, o mesmo state, o mesmo foco e o
  // mesmo número de renders, requisições e escritas de um envio aceito.
  {
    const outcomes = { aceito: null, USER_NOT_FOUND: awsError("UserNotFoundException"), INVALID_PARAMETER: awsError("InvalidParameterException"),
      NOT_AUTHORIZED: awsError("NotAuthorizedException"), TOO_MANY_ATTEMPTS: awsError("TooManyFailedAttemptsException"),
      "TOO_MANY_ATTEMPTS (limite)": awsError("LimitExceededException"), DELIVERY_FAILED: awsError("CodeDeliveryFailureException"),
      ALIAS_EXISTS: awsError("AliasExistsException") };
    let reference;
    for (const [name, reply] of Object.entries(outcomes)) {
      const opened = await open(), { page, log, replies } = opened;
      if (reply) replies.ResendConfirmationCode.push(reply);
      await openFlow(page);
      await emailField(page).fill(EMAIL);
      await emailField(page).press("Enter");
      await settle(page);
      const observed = { html: await page.locator("#app").innerHTML(), slice: await slice(page), focus: await focused(page), renders: await renders(page),
        requests: log.cognito.length, url: page.url(), storage: await storageWrites(page), notices: await page.locator("#notices").innerHTML() };
      if (!reference) reference = observed;
      else assert.deepEqual(observed, reference, name);
      await close(opened, name);
    }
    assert.ok(reference.html.includes("enviamos um código"));
  }

  // 5. Falhas técnicas no envio aparecem como são: a mensagem fixa de cada uma, na etapa EMAIL, sem a mensagem
  // uniforme, sem intervalo e sem marcar o e-mail como inválido. Região fora do formato nem chega à rede.
  {
    const failures = [
      ["rede", offline, MESSAGES.TEMPORARY_FAILURE],
      ["serviço (500)", awsError("InternalErrorException", 500), MESSAGES.TEMPORARY_FAILURE],
      ["vazão (429)", awsError("TooManyRequestsException", 429), MESSAGES.TOO_MANY_ATTEMPTS],
      ["configuração do Cognito", awsError("ResourceNotFoundException"), MESSAGES.CONFIGURATION_FAILURE],
    ];
    for (const [name, reply, message] of failures) {
      const opened = await open(), { page, log, replies } = opened;
      replies.ResendConfirmationCode.push(reply);
      await openFlow(page);
      await emailField(page).fill(EMAIL);
      await emailField(page).press("Enter");
      await settle(page);
      assert.deepEqual(await alerts(page), [message], name);
      assert.equal(await heading(page, "Confirmar cadastro").count(), 1, name);
      assert.equal(await page.getByText(/enviamos um código/).count(), 0, `${name}: sem mensagem de envio`);
      assert.deepEqual([await emailField(page).inputValue(), await emailField(page).getAttribute("aria-invalid")], [EMAIL, null], name);
      assert.equal(await focused(page), "input:E-mail", name);
      assert.equal(log.cognito.length, 1, name);
      assert.equal((await slice(page)).resendAvailableAt, 0, name);
      assert.equal(await page.locator("#notices").innerHTML(), "", `${name}: sem aviso global`);
      await close(opened, name);
    }
    const opened = await open({ config: { ...CONFIG, region: "regiao invalida" } }), { page, log } = opened;
    await openFlow(page);
    await emailField(page).fill(EMAIL);
    await emailField(page).press("Enter");
    await settle(page);
    assert.deepEqual([await alerts(page), log.cognito.length], [[MESSAGES.CONFIGURATION_FAILURE], 0]);
    await close(opened, "região inválida");
  }

  // 6. Intervalo de reenvio com relógio controlado: bloqueado e explicado por 60 s, liberado por um único render no fim,
  // sem roubar o foco nem apagar o código sendo digitado. Reenviar usa o e-mail do fluxo e recomeça o intervalo; dois
  // cliques fazem uma requisição; falha técnica no reenvio aparece e não recomeça o intervalo. Trocar de etapa ou
  // fechar o fluxo cancela o timer.
  {
    const opened = await open(), { page, log, replies } = opened;
    await openFlow(page);
    await sendCode(page);
    const resend = button(page, "Reenviar código");
    assert.equal(await resend.isDisabled(), true);
    await page.getByText(WAIT, { exact: true }).waitFor();
    assert.equal(await resend.getAttribute("aria-describedby"), await page.getByText(WAIT, { exact: true }).getAttribute("id"));
    await codeField(page).click();
    await page.keyboard.type("24");
    const before = await renders(page);
    await page.clock.runFor(59_999);
    assert.equal(await renders(page), before, "nenhum render antes do fim do intervalo");
    assert.equal(await resend.isDisabled(), true);
    await page.clock.runFor(1);
    await page.getByText(WAIT, { exact: true }).waitFor({ state: "detached" });
    measured.fimDoIntervalo = (await renders(page)) - before;
    assert.equal(measured.fimDoIntervalo, 1, "o fim do intervalo redesenha uma vez");
    assert.equal(await resend.isDisabled(), false);
    assert.equal(await focused(page), "input:Código de confirmação", "o timer não tira o foco");
    assert.deepEqual(await codeField(page).evaluate((el) => [el.value, el.selectionStart]), ["24", 2], "o timer não apaga o que está sendo digitado");
    await page.clock.runFor(10 * 60_000);
    assert.equal(await renders(page), before + 1, "nenhum timer residual");
    assert.equal(log.cognito.length, 1, "nenhum reenvio durante o intervalo");
    // Reenvio retido, um clique: usa o e-mail do fluxo; com o botão desabilitado o foco passa ao campo do código, que
    // mantém o que foi digitado; o intervalo recomeça.
    let arrived = deferred(), gate = deferred();
    replies.ResendConfirmationCode.push(() => { arrived.resolve(); return gate.promise.then(accepted); });
    await resend.click();
    await arrived.promise;
    assert.deepEqual([await button(page, "Reenviando…").isDisabled(), await button(page, "Confirmar").isDisabled()], [true, true]);
    assert.equal(await focused(page), "input:Código de confirmação");
    gate.resolve();
    await page.getByText(WAIT, { exact: true }).waitFor();
    await settle(page);
    assert.deepEqual(log.cognito[1].body, { ClientId: CLIENT_ID, Username: EMAIL });
    assert.equal(await resend.isDisabled(), true, "o intervalo recomeça");
    assert.equal((await slice(page)).resendAvailableAt, NOW + 60_000 + 10 * 60_000 + 60_000);
    assert.deepEqual([await focused(page), await codeField(page).inputValue()], ["input:Código de confirmação", "24"]);
    // Dois cliques depois do intervalo: uma requisição. (O segundo clique cai no botão já desabilitado; o foco não é
    // conferido aqui.)
    await page.clock.runFor(60_000);
    await page.getByText(WAIT, { exact: true }).waitFor({ state: "detached" });
    arrived = deferred();
    gate = deferred();
    replies.ResendConfirmationCode.push(() => { arrived.resolve(); return gate.promise.then(accepted); });
    await resend.dblclick();
    await arrived.promise;
    await flushNetwork(page);
    assert.equal(log.cognito.length, 3, "dois cliques, uma requisição");
    gate.resolve();
    await page.getByText(WAIT, { exact: true }).waitFor();
    await settle(page);
    // Falha técnica no reenvio: mensagem própria, intervalo não recomeça, nada que pareça um envio novo.
    await page.clock.runFor(60_000);
    await page.getByText(WAIT, { exact: true }).waitFor({ state: "detached" });
    replies.ResendConfirmationCode.push(offline);
    await resend.click();
    await settle(page);
    assert.deepEqual(await alerts(page), [MESSAGES.TEMPORARY_FAILURE]);
    assert.deepEqual([await resend.isDisabled(), await page.getByText(WAIT).count(), log.cognito.length], [false, 0, 4]);
    // Trocar de etapa cancela o timer: com o intervalo correndo, "Usar outro e-mail" não deixa render atrasado.
    await resend.click();
    await page.getByText(WAIT, { exact: true }).waitFor();
    await settle(page);
    let marker = await renders(page);
    await button(page, "Usar outro e-mail").click();
    await heading(page, "Confirmar cadastro").waitFor();
    assert.equal(await focused(page), "h1:Confirmar cadastro");
    assert.deepEqual([await emailField(page).inputValue(), (await slice(page)).step], ["", "email"]);
    marker = await renders(page);
    await page.clock.runFor(2 * 60_000);
    assert.equal(await renders(page), marker, "o timer não sobrevive à troca de etapa");
    // Fechar o fluxo também cancela.
    await sendCode(page);
    await button(page, "Usar outro e-mail").click();
    await button(page, "Voltar").click();
    await entry(page).waitFor();
    marker = await renders(page);
    await page.clock.runFor(2 * 60_000);
    assert.equal(await renders(page), marker, "o timer não sobrevive ao fechamento");
    assert.equal(log.cognito.length, 6);
    await close(opened, "intervalo de reenvio");
  }

  // 7. Confirmação: cada erro tem sua mensagem fixa, o campo volta vazio com o foco nele e a etapa continua CODE; conta
  // inexistente é igual a código errado. O código vai só no corpo do POST. Sucesso: etapa final, sem Session, token,
  // storage nem login automático; "Fazer login" é o login de sempre (mesmo authorize, com PKCE, state e nonce).
  {
    const opened = await open(), { page, log, replies } = opened;
    const landingLogin = page.waitForRequest((request) => request.url().startsWith(`${AUTH}/oauth2/authorize?`));
    await page.getByRole("button", { name: /Entrar no meu portal/ }).click();
    const original = new URL((await landingLogin).url());
    await openFlow(page);
    await sendCode(page);
    const storageBefore = await storageWrites(page);
    const cases = [
      ["vazio", null, "", MESSAGES.INVALID_CODE, 0],
      ["código errado", awsError("CodeMismatchException"), CODE_BAD, MESSAGES.WRONG_CODE, 1],
      ["conta inexistente", awsError("UserNotFoundException"), CODE_BAD, MESSAGES.WRONG_CODE, 1],
      ["expirado", awsError("ExpiredCodeException"), CODE_BAD, MESSAGES.EXPIRED_CODE, 1],
      ["tentativas", awsError("TooManyFailedAttemptsException"), CODE_BAD, MESSAGES.TOO_MANY_ATTEMPTS, 1],
      ["NotAuthorized", awsError("NotAuthorizedException"), CODE_BAD, MESSAGES.ALREADY_CONFIRMED_OR_UNAVAILABLE, 1],
      ["parâmetro", awsError("InvalidParameterException"), CODE_BAD, MESSAGES.INVALID_CODE, 1],
      ["serviço", awsError("InternalErrorException", 500), CODE_BAD, MESSAGES.TEMPORARY_FAILURE, 1],
      ["rede", offline, CODE_BAD, MESSAGES.TEMPORARY_FAILURE, 1],
      ["configuração", awsError("ResourceNotFoundException"), CODE_BAD, MESSAGES.CONFIGURATION_FAILURE, 1],
    ];
    const htmlOf = {};
    for (const [name, reply, code, message, requests] of cases) {
      if (reply) replies.ConfirmSignUp.push(reply);
      const sent = log.cognito.length, before = await renders(page);
      await codeField(page).fill(code);
      await button(page, "Confirmar").click();
      await settle(page);
      if (name === "código errado") measured.confirmacaoComErro = (await renders(page)) - before;
      assert.deepEqual(await alerts(page), [message], name);
      assert.deepEqual([await codeField(page).inputValue(), await focused(page)], ["", "input:Código de confirmação"], `${name}: campo limpo e focado`);
      assert.equal(log.cognito.length - sent, requests, name);
      if (requests) assert.deepEqual([log.cognito.at(-1).operation, log.cognito.at(-1).body], ["ConfirmSignUp", { ClientId: CLIENT_ID, Username: EMAIL, ConfirmationCode: code }]);
      assert.deepEqual(await slice(page), { ...BLANK, step: "code", email: EMAIL, error: (await slice(page)).error, resendAvailableAt: NOW + 60_000 }, name);
      assert.equal(await page.locator("#notices").innerHTML(), "", `${name}: sem aviso global`);
      htmlOf[name] = await page.locator("#app").innerHTML();
    }
    assert.equal(htmlOf["conta inexistente"], htmlOf["código errado"], "conta inexistente é igual a código errado");
    const before = await renders(page);
    await codeField(page).fill(CODE_OK);
    await codeField(page).press("Enter");
    await heading(page, "Cadastro confirmado").waitFor();
    await settle(page);
    measured.confirmacao = (await renders(page)) - before;
    assert.equal(await focused(page), "h1:Cadastro confirmado");
    await page.getByText(DONE, { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#app button")].map((b) => [b.textContent.trim(), b.dataset.action])), [["Fazer login", "login"]]);
    assert.deepEqual(await slice(page), { ...BLANK, step: "success", email: EMAIL, resendAvailableAt: NOW + 60_000, confirmed: true });
    assert.deepEqual(await storageWrites(page), storageBefore, "confirmar não escreve storage");
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem("avanca.session"), sessionStorage.length]), [null, 0]);
    await page.clock.runFor(10 * 60_000);
    assert.equal(await authorizations(page, log, 2), 1, "sem login automático (o único authorize é o da landing)");
    // O código não ficou em lugar nenhum: state, URL, DOM (atributos, dataset, campos), storage e cookies.
    const traces = await page.evaluate(async () => ({ state: JSON.stringify((await import("/state.js")).state), url: location.href, html: document.documentElement.outerHTML,
      inputs: [...document.querySelectorAll("input")].map((input) => input.value), storage: JSON.stringify([{ ...localStorage }, { ...sessionStorage }, window.__storage]) }));
    for (const code of [CODE_OK, CODE_BAD])
      for (const [where, value] of Object.entries(traces)) assert.ok(!JSON.stringify(value).includes(code), `código em ${where}`);
    assert.deepEqual(await opened.context.cookies(), []);
    // "Fazer login": a mesma navegação do botão da landing.
    const finalLogin = page.waitForRequest((request) => request.url().startsWith(`${AUTH}/oauth2/authorize?`));
    const confirmations = log.cognito.length;
    await button(page, "Fazer login").click();
    const reused = new URL((await finalLogin).url());
    assert.equal(await authorizations(page, log, 2), 2);
    assert.equal(reused.origin + reused.pathname, original.origin + original.pathname);
    assert.deepEqual([...reused.searchParams.keys()].sort(), [...original.searchParams.keys()].sort());
    for (const key of ["client_id", "response_type", "lang", "redirect_uri", "scope", "code_challenge_method"])
      assert.equal(reused.searchParams.get(key), original.searchParams.get(key), key);
    for (const key of ["state", "nonce", "code_challenge"]) assert.ok(reused.searchParams.get(key) && reused.searchParams.get(key) !== original.searchParams.get(key), key);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("avanca.oauth"))).state, reused.searchParams.get("state"));
    assert.equal(log.cognito.length, confirmations, "o login não chama o Cognito da confirmação");
    await close(opened, "confirmação");
  }

  // 8. Envio e confirmação em dobro (duplo clique e Enter repetido): uma requisição cada.
  {
    const opened = await open(), { page, log, replies } = opened;
    await openFlow(page);
    let arrived = deferred(), gate = deferred();
    replies.ResendConfirmationCode.push(() => { arrived.resolve(); return gate.promise.then(accepted); });
    await emailField(page).fill(EMAIL);
    await button(page, "Enviar código").dblclick();
    await arrived.promise;
    await emailField(page).press("Enter");
    await flushNetwork(page);
    assert.equal(log.cognito.length, 1, "envio em dobro");
    gate.resolve();
    await heading(page, "Digite o código").waitFor();
    arrived = deferred();
    gate = deferred();
    replies.ConfirmSignUp.push(() => { arrived.resolve(); return gate.promise.then(confirmedReply); });
    await codeField(page).fill(CODE_OK);
    await button(page, "Confirmar").dblclick();
    await arrived.promise;
    await codeField(page).press("Enter");
    await flushNetwork(page);
    assert.equal(log.cognito.length, 2, "confirmação em dobro");
    gate.resolve();
    await heading(page, "Cadastro confirmado").waitFor();
    await settle(page);
    assert.deepEqual(log.cognito.map((c) => c.operation), ["ResendConfirmationCode", "ConfirmSignUp"]);
    await close(opened, "em dobro");
  }

  // 9. Voltar e Usar outro e-mail: nenhuma requisição, foco previsível e respostas atrasadas que não reaparecem.
  {
    const opened = await open(), { page, log, replies } = opened;
    await openFlow(page);
    let before = await renders(page);
    await button(page, "Voltar").click();
    await entry(page).waitFor();
    measured.voltar = (await renders(page)) - before;
    assert.deepEqual([await focused(page), await slice(page), log.cognito.length], ["button:Confirmar cadastro", BLANK, 0]);
    // Envio retido + Voltar: a resposta que chega depois é descartada.
    let arrived = deferred(), gate = deferred();
    replies.ResendConfirmationCode.push(() => { arrived.resolve(); return gate.promise.then(accepted); });
    await openFlow(page);
    await emailField(page).fill(EMAIL);
    await emailField(page).press("Enter");
    await arrived.promise;
    assert.deepEqual([await button(page, "Enviando…").isDisabled(), await emailField(page).evaluate((el) => el.readOnly), await button(page, "Voltar").isDisabled()],
      [true, true, false]);
    assert.equal(await focused(page), "input:E-mail");
    await button(page, "Voltar").click();
    await entry(page).waitFor();
    before = await renders(page);
    gate.resolve();
    await flushNetwork(page);
    await flushNetwork(page);
    assert.deepEqual([await renders(page), await slice(page), await heading(page, "Digite o código").count(), await alerts(page)], [before, BLANK, 0, []]);
    // Confirmação retida + Usar outro e-mail.
    await openFlow(page);
    await sendCode(page);
    arrived = deferred();
    gate = deferred();
    replies.ConfirmSignUp.push(() => { arrived.resolve(); return gate.promise.then(confirmedReply); });
    await codeField(page).fill(CODE_OK);
    await codeField(page).press("Enter");
    await arrived.promise;
    assert.deepEqual([await button(page, "Confirmando…").isDisabled(), await codeField(page).evaluate((el) => [el.readOnly, el.value])], [true, [true, ""]]);
    assert.equal(await focused(page), "input:Código de confirmação");
    await button(page, "Usar outro e-mail").click();
    await heading(page, "Confirmar cadastro").waitFor();
    before = await renders(page);
    gate.resolve();
    await flushNetwork(page);
    await flushNetwork(page);
    assert.deepEqual([await renders(page), (await slice(page)).step, (await slice(page)).confirmed, await heading(page, "Cadastro confirmado").count()],
      [before, "email", false, 0]);
    assert.equal(await focused(page), "h1:Confirmar cadastro");
    assert.equal(log.cognito.length, 3);
    await close(opened, "voltar e outro e-mail");
  }

  // 10. Recarregar: o fluxo não sobrevive (nada dele foi para storage) e nada que não é dele foi apagado.
  {
    const opened = await open(), { page } = opened;
    await page.evaluate(() => localStorage.setItem("teste.preferencia", "mantida"));
    const baseline = await storageWrites(page);
    await openFlow(page);
    await sendCode(page);
    await codeField(page).fill(CODE_BAD);
    await codeField(page).press("Enter");
    await settle(page);
    assert.deepEqual(await storageWrites(page), baseline, "o fluxo não escreve storage");
    await page.reload();
    await entry(page).waitFor();
    assert.deepEqual(await slice(page), BLANK);
    assert.equal(await heading(page, "Seu próximo passo começa aqui.").count(), 1);
    const kept = await page.evaluate(() => ({ preference: localStorage.getItem("teste.preferencia"), keys: [...Object.keys(localStorage), ...Object.keys(sessionStorage)] }));
    assert.deepEqual(kept, { preference: "mantida", keys: ["teste.preferencia"] });
    await close(opened, "recarga");
  }

  // 11. Só teclado, da landing ao login: Tab até a entrada, Enter em cada etapa, foco sempre no título da etapa nova,
  // ordem de tabulação natural, sem tabindex positivo nem armadilha de foco.
  {
    const opened = await open(), { page, log } = opened;
    for (let i = 0; i < 10 && (await focused(page)) !== "button:Confirmar cadastro"; i++) await page.keyboard.press("Tab");
    assert.equal(await focused(page), "button:Confirmar cadastro");
    await page.keyboard.press("Enter");
    await heading(page, "Confirmar cadastro").waitFor();
    assert.equal(await focused(page), "h1:Confirmar cadastro");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await focused(page), "a:Escola da Nuvem");
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    assert.deepEqual(order, ["input:E-mail", "button:Enviar código", "button:Voltar", "body"], "ordem natural e saída livre");
    await emailField(page).focus();
    await page.keyboard.type(EMAIL);
    await page.keyboard.press("Enter");
    await heading(page, "Digite o código").waitFor();
    assert.equal(await focused(page), "h1:Digite o código");
    await page.keyboard.press("Tab");
    assert.equal(await focused(page), "input:Código de confirmação");
    await page.keyboard.type(CODE_OK);
    await page.keyboard.press("Enter");
    await heading(page, "Cadastro confirmado").waitFor();
    assert.equal(await focused(page), "h1:Cadastro confirmado");
    await page.keyboard.press("Tab");
    assert.equal(await focused(page), "button:Fazer login");
    const navigation = page.waitForRequest((request) => request.url().startsWith(`${AUTH}/oauth2/authorize?`));
    await page.keyboard.press("Enter");
    await navigation;
    assert.equal(await authorizations(page, log, 1), 1);
    assert.deepEqual(await page.locator("[tabindex]").evaluateAll((els) => els.map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("tabindex")}`)), ["h1:-1"]);
    await close(opened, "teclado");
  }

  // 12. Larguras de 375 a 1440 px: sem rolagem lateral, título visível ao abrir, nada cortado (texto, campos, botões e
  // erros), e-mail mascarado longo quebrando dentro da coluna.
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    const height = width < 768 ? 800 : 900;
    const opened = await open({ width, height }), { page, replies } = opened;
    const check = async (label) => {
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
        parts: [...document.querySelectorAll(".welcome-grid > section :is(h1, p, input, button, [role=alert])")].map((el) => {
          const box = el.getBoundingClientRect();
          return { text: (el.textContent || el.name || "").trim().slice(0, 40), left: box.left, right: box.right, clipped: el.scrollWidth > el.clientWidth + 1 && el.tagName !== "INPUT" };
        }) }));
      assert.ok(layout.scrollWidth <= width, `${label} em ${width}px: rolagem lateral (${layout.scrollWidth})`);
      for (const part of layout.parts) assert.ok(part.left >= 0 && part.right <= width + 0.5 && !part.clipped, `${label} em ${width}px: ${JSON.stringify(part)}`);
      if (process.env.SIGNUP_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SIGNUP_SCREENSHOTS, `${width}-${label}.png`), fullPage: true });
    };
    await check("landing");
    await entry(page).scrollIntoViewIfNeeded();
    await entry(page).click();
    await heading(page, "Confirmar cadastro").waitFor();
    const title = await heading(page, "Confirmar cadastro").boundingBox();
    assert.ok(title.y >= 0 && title.y + title.height <= height, `título visível ao abrir em ${width}px: ${JSON.stringify(title)}`);
    await button(page, "Enviar código").click();
    await check("email-erro");
    await sendCode(page, LONG_EMAIL);
    await page.getByText(WAIT, { exact: true }).waitFor();
    await check("codigo");
    replies.ConfirmSignUp.push(awsError("CodeMismatchException"));
    await codeField(page).fill(CODE_BAD);
    await codeField(page).press("Enter");
    await settle(page);
    await check("codigo-erro");
    assert.equal(await codeField(page).getAttribute("inputmode"), "numeric");
    await codeField(page).fill(CODE_OK);
    await codeField(page).press("Enter");
    await heading(page, "Cadastro confirmado").waitFor();
    await check("sucesso");
    await close(opened, `${width}px`);
  }

  // 13. Tamanhos de notebook da landing: com a entrada, login e "Primeiro acesso?" continuam inteiros na tela e não
  // descem em relação à landing sem ela; sem rolagem lateral. A posição da entrada é medida, não imposta.
  {
    const plain = await open({ config: { apiUrl: CONFIG.apiUrl } }), withEntry = await open();
    measured.entradaNaPrimeiraDobra = {};
    for (const [width, height] of [[1512, 982], [1512, 850], [1512, 755], [1440, 780], [1280, 650], [1024, 640], [1800, 1050], [3024, 1964]]) {
      const measure = async (page) => {
        await page.setViewportSize({ width, height });
        return page.evaluate(() => {
          const box = (selector) => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom }; };
          return { scrollWidth: document.documentElement.scrollWidth, login: box('[data-action="login"]'), first: box(".first-access"),
            entry: box('[data-action="signup-confirmation-start"]') };
        });
      };
      const [a, b] = [await measure(plain.page), await measure(withEntry.page)];
      const size = `${width}x${height}`;
      assert.ok(b.scrollWidth <= width, `${size}: rolagem lateral`);
      assert.ok(b.login.top >= 0 && b.login.bottom <= height && b.first.bottom <= height, `${size}: login e primeiro acesso visíveis: ${JSON.stringify(b)}`);
      assert.ok(b.login.top <= a.login.top + 0.5 && b.first.bottom <= a.first.bottom + 0.5, `${size}: a entrada não empurra a landing: ${JSON.stringify([a, b])}`);
      measured.entradaNaPrimeiraDobra[size] = b.entry.bottom <= height;
    }
    await close(plain, "notebook sem entrada");
    await close(withEntry, "notebook com entrada");
  }

  assert.equal(totals.external, 0, "nenhuma requisição real fora do servidor local");
  console.log(`Confirmação de cadastro: ${totals.pages} páginas, ${totals.cognito} chamadas ao Cognito simulado, ${totals.external} requisições externas, ${totals.networkLog} linhas de rede do Chromium para erros simulados; entrada só com configuração, EMAIL, CODE, SUCCESS, mensagens fixas, privacidade, falhas técnicas, intervalo, foco, teclado, respostas atrasadas, recarga, larguras e login de sempre OK.`);
  console.log(`Renders medidos: ${JSON.stringify(measured)}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

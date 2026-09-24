// Teste isolado com Cognito e API fictícios. Nunca acessa a AWS.
// Um computador com o relógio errado (fuso configurado errado é comum) não pode impedir o
// login: a validade dos tokens é conferida pelo Cognito e pelo API Gateway, não pelo navegador.
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
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.assinatura`;

async function login(browser, skewMinutes, idClaims = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const realNow = Date.now();
  // Relógio do computador da aluna deslocado; o Cognito usa a hora certa.
  await page.clock.setSystemTime(new Date(realNow + skewMinutes * 60000));
  await page.addInitScript(() => localStorage.setItem("avanca.oauth", JSON.stringify({
    verifier: "v", state: "estado", nonce: "nonce-certo", created: Date.now() })));
  await page.route("**/config.json", (route) => route.fulfill({ json: {
    apiUrl: origin + "/api", authDomain: origin, userPoolClientId: "cliente", redirectUri: origin + "/", scopes: ["openid"] } }));
  let exchanged = 0;
  await page.route("**/oauth2/token", (route) => {
    exchanged++;
    const iat = Math.floor(realNow / 1000);
    return route.fulfill({ json: { access_token: "acesso", refresh_token: "renovacao", expires_in: 900,
      id_token: jwt({ nonce: "nonce-certo", aud: "cliente", iat, exp: iat + 900, ...idClaims }) } });
  });
  await page.route("**/api/**", (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["student"], email: "aluna@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [] } });
    return route.fulfill({ status: 404, json: { error: "não usado" } });
  });
  await page.goto(origin + "/?code=codigo&state=estado");
  return { page, errors, exchanged: () => exchanged };
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const skew of [0, 20, 180, -180]) {
    const { page, errors, exchanged } = await login(browser, skew);
    await page.getByRole("heading", { name: "Ainda não encontramos notas para esta conta" }).waitFor();
    assert.equal(exchanged(), 1);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("avanca.session"))).accessToken, "acesso");
    assert.deepEqual(errors, [], `relógio deslocado em ${skew} min`);
    await page.close();
  }
  // A proteção que importa continua: token emitido para outro login (nonce diferente) é recusado.
  const { page } = await login(browser, 0, { nonce: "de-outro-login" });
  await page.getByText("Sessão inválida. Entre novamente.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("avanca.session")), null);
  console.log("Login com relógio do computador errado (±3 h) funciona; nonce diferente continua recusado. OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

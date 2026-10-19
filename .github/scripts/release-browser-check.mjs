// Confere em Chromium a resolução de URLs de uma release empacotada, servida localmente como o S3 a serviria:
// ponteiro em /index.html, release em /releases/<id>/, MIME e Cache-Control do contrato, 403 para ausentes.
// Uso: node release-browser-check.mjs --release-dir <dir>   (exige Playwright e Chromium instalados)
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { values } = parseArgs({ options: { "release-dir": { type: "string" } } });
const releaseDir = path.resolve(values["release-dir"] || "");
const manifest = JSON.parse(readFileSync(path.join(releaseDir, "manifest.json"), "utf8"));
const id = manifest.release_id;
const prefix = `/releases/${id}/`;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png" };
// Raiz simulada: só o ponteiro e as dependências relativas ao documento (a baseline lê /config.json; demo usa {}).
const rootFiles = { "/index.html": readFileSync(path.join(releaseDir, "pointer.html")), "/logo.png": readFileSync(path.join(releaseDir, "logo.png")) };
if (manifest.document_relative.includes("config.json")) rootFiles["/config.json"] = Buffer.from("{}");

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = pathname === "/" ? "/index.html" : pathname;
  let body = rootFiles[rel];
  let cache = rel === "/index.html" ? "no-cache" : "public, max-age=300";
  if (!body && rel.startsWith(prefix)) {
    const file = path.join(releaseDir, rel.slice(prefix.length));
    if (file.startsWith(releaseDir + path.sep) && existsSync(file) && statSync(file).isFile()) {
      body = readFileSync(file);
      cache = "public, max-age=31536000, immutable";
    }
  }
  if (!body) { res.writeHead(403); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(rel)] || "application/octet-stream", "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff" });
  res.end(body);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const problems = [];
try {
  for (const query of ["?demo=1", "?turma=TESTE", "?code=x&state=y"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [], external = [], errors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      requests.push(url.pathname);
      return route.continue();
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${origin}/${query}`);
    const ready = query === "?demo=1" ? ".demo-bar" : "#app main, #app .welcome, #app section, #app .panel";
    const booted = await page.locator(ready).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const where = await page.evaluate(() => location.pathname);
    const assets = requests.filter((p) => /\.(js|css)$/.test(p));
    const configs = requests.filter((p) => p.endsWith("config.json"));
    const expectedConfig = manifest.mode === "modern" ? `${prefix}config.json` : "/config.json";
    if (!booted) problems.push(`${query}: app não subiu`);
    if (where !== "/") problems.push(`${query}: documento saiu da raiz (${where})`);
    if (assets.some((p) => !p.startsWith(prefix))) problems.push(`${query}: JS/CSS fora da release: ${assets.filter((p) => !p.startsWith(prefix))}`);
    if (configs.some((p) => p !== expectedConfig) || !configs.length) problems.push(`${query}: config lida de ${configs}, esperado ${expectedConfig}`);
    if (errors.length) problems.push(`${query}: erros de página: ${errors.slice(0, 2)}`);
    if (external.length) problems.push(`${query}: requisições externas bloqueadas: ${[...new Set(external)]}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error(`Release ${id} reprovada no navegador:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Release ${id}: demonstração, ?turma= e retorno OAuth na raiz; todo JS/CSS de ${prefix}; config conforme o modo.`);

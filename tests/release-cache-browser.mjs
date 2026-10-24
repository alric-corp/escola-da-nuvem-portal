// Releases imutáveis do frontend no Chromium (pipeline de deploy, P2). Releases reais preparadas pela CLI
// (.github/scripts/prepare-release.py) num clone temporário com a árvore de trabalho: baseline C7.3 (1daab31),
// R1 (main, config 1) e R2 (main + export nomeado novo em ui.js, config 2). Um servidor local imita o S3 atrás do
// CloudFront (MIME, Cache-Control, 403 para ausentes). Requisições para fora da origem local são abortadas e
// registradas. Não acessa a AWS nem a rede.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync,
  writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const ORIGIN = "https://portal.example.test"; // origem pública fictícia da config; o servidor local é outro
const TMP = mkdtempSync(path.join(os.tmpdir(), "release-cache-"));
const CLONE = path.join(TMP, "clone"), OUT = path.join(TMP, "releases"), BUCKET = path.join(TMP, "bucket");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const config = (marker) => ({
  apiUrl: `https://api${marker}teste01.execute-api.us-east-1.amazonaws.com`,
  authDomain: `https://portal-teste-${marker}.auth.us-east-1.amazoncognito.com`,
  instructorEmailDomain: "example.test", logoutUri: `${ORIGIN}/`, redirectUri: `${ORIGIN}/`, region: "us-east-1",
  scopes: ["openid", "email", "portal/access"], userPoolClientId: ("cliente" + marker.repeat(20)).slice(0, 26),
  userPoolId: `us-east-1_Teste${marker}`,
});
const childEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_|RUNNER_|ACTIONS_|AWS_)/.test(k))), ...extra,
});
const git = (...args) => execFileSync("git", ["-C", CLONE, "-c", "user.name=Teste", "-c", "user.email=teste@example.test", ...args],
  { env: childEnv({ GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" }), encoding: "utf8" });

// Clone com --shared (objetos do checkout, nada é gravado nele) + árvore de trabalho atual num commit filho do HEAD.
const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const checkoutStatus = () => execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
const statusBefore = checkoutStatus();
execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", ROOT, CLONE]);
git("checkout", "--quiet", "--detach", head);
for (const rel of execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString().split("\0")) {
  const source = path.join(ROOT, rel);
  if (!rel) continue;
  if (!existsSync(source)) { rmSync(path.join(CLONE, rel), { force: true }); continue; }
  if (!statSync(source).isFile()) continue;
  mkdirSync(path.dirname(path.join(CLONE, rel)), { recursive: true });
  copyFileSync(source, path.join(CLONE, rel));
}
git("add", "-A");
git("commit", "--quiet", "--allow-empty", "-m", "árvore de trabalho");
symlinkSync(path.join(ROOT, "node_modules"), path.join(CLONE, "node_modules"));

function prepare(source, marker = "") {
  const stdout = execFileSync("python3", ["-B", path.join(CLONE, ".github/scripts/prepare-release.py"), "--source", source, "--repo", CLONE,
    "--work", path.join(TMP, `work-${source}-${marker}`), "--out", OUT, "--public-origin", ORIGIN],
  { env: childEnv(marker ? { FRONTEND_CONFIG_JSON: JSON.stringify(config(marker)) } : {}), encoding: "utf8" });
  return stdout.match(/Release preparada: `([0-9a-f]{12}-[0-9a-f]{12})`/)[1];
}
const R0 = prepare("baseline");
const R1 = prepare("main", "1");
const flatIndex = readFileSync(path.join(CLONE, "frontend/dist/index.html"));
// R2: export nomeado novo em ui.js, importado pelo app.js (incompatível com o ui.js de R1).
writeFileSync(path.join(CLONE, "frontend/ui.js"), readFileSync(path.join(CLONE, "frontend/ui.js"), "utf8") + '\nexport const releaseMarker = "r2";\n');
const app = readFileSync(path.join(CLONE, "frontend/app.js"), "utf8");
assert.ok(app.includes('import { $, admin, demo, '));
writeFileSync(path.join(CLONE, "frontend/app.js"), app.replace("import { $, admin, demo, ", "import { $, admin, demo, releaseMarker, ")
  .replace('import { state } from "./state.js";', 'import { state } from "./state.js";\ndocument.documentElement.dataset.releaseMarker = releaseMarker;'));
git("commit", "--quiet", "-am", "R2: export nomeado novo");
const R2 = prepare("main", "2");
const releaseDir = (id) => path.join(OUT, id);

// Bucket: layout plano C7.3 na raiz (como está publicado hoje), /config.json da raiz e as três releases.
const baselineDist = path.join(TMP, "work-baseline-", "app/frontend/dist");
cpSync(baselineDist, BUCKET, { recursive: true, filter: (src) => path.basename(src) !== "config.json" });
writeFileSync(path.join(BUCKET, "config.json"), JSON.stringify(config("raiz")));
for (const id of [R0, R1, R2]) cpSync(releaseDir(id), path.join(BUCKET, "releases", id), { recursive: true });
const legacyIndex = readFileSync(path.join(BUCKET, "index.html"));
const activate = (id) => writeFileSync(path.join(BUCKET, "index.html"), readFileSync(path.join(BUCKET, "releases", id, "pointer.html")));
const restoreLegacy = () => writeFileSync(path.join(BUCKET, "index.html"), legacyIndex);

let root = BUCKET;
const responses = [];
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(root, rel);
  const ok = file.startsWith(root + path.sep) && existsSync(file) && statSync(file).isFile();
  responses.push({ path: pathname, status: ok ? 200 : 403 });
  if (!ok) return res.writeHead(403).end();
  const cache = rel === "/index.html" ? "no-cache" : rel.startsWith("/releases/") ? "public, max-age=31536000, immutable" : "public, max-age=300";
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

// Abre a página e registra requisições da origem, saídas bloqueadas e erros. stale: HTML servido no lugar de "/"
// (cópia antiga em cache do navegador ou do CloudFront antes da invalidação).
async function open(query = "?demo=1", { stale, ready, timeout = 15000 } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = { requests: [], external: [], errors: [] };
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { seen.external.push(url.href); return route.abort(); }
    seen.requests.push(url.pathname);
    if (stale && url.pathname === "/") return route.fulfill({ status: 200, contentType: MIME[".html"], body: stale });
    return route.continue();
  });
  page.on("pageerror", (err) => seen.errors.push(err.message));
  await page.goto(`${origin}/${query}`);
  const target = ready || (query.includes("demo") ? ".demo-bar" : "#app .welcome");
  seen.booted = await page.locator(target).first().waitFor({ timeout }).then(() => true, () => false);
  const assets = () => seen.requests.filter((p) => /\.(js|css)$/.test(p));
  const prefixes = () => [...new Set(assets().map((p) => (p.startsWith("/releases/") ? p.split("/").slice(0, 3).join("/") : "/")))];
  const configs = () => [...new Set(seen.requests.filter((p) => p.endsWith("config.json")))];
  return { context, page, seen, assets, prefixes, configs, close: () => context.close() };
}

test.after(async () => {
  await browser.close();
  server.close();
  rmSync(TMP, { recursive: true, force: true });
});

test("migração C7.3: layout plano → baseline (config da raiz) → release moderna (config por release)", async () => {
  restoreLegacy();
  const flat = await open();
  assert.ok(flat.seen.booted);
  assert.deepEqual(flat.prefixes(), ["/"]);
  assert.deepEqual(flat.configs(), ["/config.json"]);
  await flat.close();
  activate(R0);
  const base = await open();
  assert.ok(base.seen.booted, base.seen.errors.join("\n"));
  assert.deepEqual(base.prefixes(), [`/releases/${R0}`]);
  assert.deepEqual(base.configs(), ["/config.json"], "a baseline continua lendo a config da raiz");
  assert.equal(await base.page.locator('meta[name="portal-release"]').getAttribute("content"), R0);
  await base.close();
  activate(R1);
  const modern = await open();
  assert.ok(modern.seen.booted, modern.seen.errors.join("\n"));
  assert.deepEqual(modern.prefixes(), [`/releases/${R1}`]);
  assert.ok(modern.seen.requests.includes(`/releases/${R1}/demo.js`), "import dinâmico dentro da release");
  assert.deepEqual(modern.configs(), [`/releases/${R1}/config.json`]);
  assert.deepEqual([modern.seen.errors, modern.seen.external], [[], []]);
  await modern.close();
});

test("callback do Cognito, ?turma= e login ficam na raiz e usam a config da release ativa", async () => {
  activate(R1);
  const cohort = await open("?turma=BRSA0267");
  assert.ok(cohort.seen.booted);
  assert.equal(await cohort.page.evaluate(() => location.pathname), "/");
  assert.equal(await cohort.page.evaluate(() => localStorage.getItem("avanca.pending-cohort")), "BRSA0267");
  assert.deepEqual(cohort.prefixes(), [`/releases/${R1}`]);
  await cohort.close();
  const back = await open("?code=abc&state=xyz");
  assert.ok(back.seen.booted);
  assert.deepEqual(await back.page.evaluate(() => [location.pathname, location.search]), ["/", ""]);
  await back.page.getByText("O login expirou. Entre novamente.").waitFor();
  assert.deepEqual(back.seen.external, [], "estado inválido: nenhum POST ao Cognito");
  await back.close();
  for (const [id, marker] of [[R1, "1"], [R2, "2"]]) {
    activate(id);
    const landing = await open("");
    await landing.page.locator('[data-action="login"]').click();
    await landing.page.waitForTimeout(300);
    await expectEventually(() => landing.seen.external.length > 0);
    const authorize = new URL(landing.seen.external[0]);
    assert.equal(authorize.origin + authorize.pathname, `${config(marker).authDomain}/oauth2/authorize`);
    assert.equal(authorize.searchParams.get("redirect_uri"), `${ORIGIN}/`, "callback na raiz, nunca em /releases/");
    assert.equal(authorize.searchParams.get("client_id"), config(marker).userPoolClientId);
    await landing.close();
  }
});

test("links e imagens relativos ao documento resolvem contra a raiz", async () => {
  activate(R1);
  const before = responses.length;
  const landing = await open("");
  assert.ok(landing.seen.booted);
  const logo = await landing.page.locator(".brand-logo").evaluate((img) => ({ src: img.currentSrc, width: img.naturalWidth }));
  assert.deepEqual(logo, { src: `${origin}/logo.png`, width: logo.width });
  assert.ok(logo.width > 0, "logo.png da raiz carregou");
  assert.equal(await landing.page.locator("a.brand").evaluate((a) => a.href), `${origin}/`);
  assert.equal(await landing.page.locator('link[rel="icon"]').evaluate((l) => l.href), `${origin}/releases/${R1}/logo.png`);
  assert.deepEqual(responses.slice(before).filter((r) => r.status !== 200), [], "nenhum recurso ausente");
  await landing.close();
});

test("Guia do curso: normativa PDF usa a release ativa e a apresentação removida não integra o pacote atual", async () => {
  activate(R1);
  const guide = await open();
  try {
    await guide.page.getByRole("button", { name: "Guia do curso", exact: true }).click();
    await guide.page.getByRole("heading", { name: "Guia do curso", exact: true }).waitFor();
    const inaugural = "documents/aula-inaugural-regras-curso.pptx";
    const normativa = "documents/normativa-abono-faltas.pdf";
    assert.equal(await guide.page.locator(`a[href$="/${inaugural}"]`).count(), 0);
    await guide.page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).click();
    const href = await guide.page.locator(`a[href$="/${normativa}"]`).first().getAttribute("href");
    const manifest = JSON.parse(readFileSync(path.join(releaseDir(R1), "manifest.json"), "utf8"));
    assert.equal(manifest.files.some((file) => file.path.endsWith(".pptx")), false);
    assert.equal(existsSync(path.join(releaseDir(R1), inaugural)), false);
    assert.equal((await guide.page.request.get(`${origin}/releases/${R1}/${inaugural}`)).status(), 403);
    assert.equal(href, `${origin}/releases/${R1}/${normativa}`, "URL relativa ao módulo, nunca à raiz do documento");
    const response = await guide.page.request.get(href);
    assert.equal(response.status(), 200);
    const meta = manifest.files.find((file) => file.path === normativa);
    assert.ok(meta, "normativa listada no manifesto");
    assert.equal(response.headers()["content-type"], "application/pdf");
    assert.equal(response.headers()["cache-control"], meta.cache_control);
    const bytes = await response.body();
    assert.deepEqual(bytes, readFileSync(path.join(releaseDir(R1), normativa)));
    assert.equal(bytes.length, meta.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), meta.sha256);
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.equal((await guide.page.request.get(`${origin}/${normativa}`)).status(), 403, "o guia não depende de documentos na raiz");
    assert.deepEqual(guide.configs(), [`/releases/${R1}/config.json`]);
    assert.deepEqual([guide.seen.errors, guide.seen.external], [[], []]);
  } finally {
    await guide.close();
  }
});

test("HTML antigo em cache e duas releases ao mesmo tempo: cada página fica inteira na sua release", async () => {
  activate(R2);
  const fresh = await open();
  const stale = await open("?demo=1", { stale: readFileSync(path.join(BUCKET, "releases", R1, "pointer.html")) });
  for (const [page, id, marker] of [[fresh, R2, "r2"], [stale, R1, undefined]]) {
    assert.ok(page.seen.booted, page.seen.errors.join("\n"));
    assert.deepEqual(page.prefixes(), [`/releases/${id}`]);
    assert.deepEqual(page.configs(), [`/releases/${id}/config.json`]);
    assert.equal(await page.page.evaluate(() => document.documentElement.dataset.releaseMarker), marker);
    assert.deepEqual(page.seen.errors, []);
  }
  await Promise.all([fresh.close(), stale.close()]);
});

test("P2: módulos nomeados incompatíveis quebram o layout plano e não se misturam nas releases", async () => {
  // Layout plano no meio de um deploy: app.js de R2 já publicado, ui.js ainda de R1.
  const mixed = path.join(TMP, "plano-misto");
  cpSync(releaseDir(R1), mixed, { recursive: true });
  writeFileSync(path.join(mixed, "index.html"), flatIndex);
  copyFileSync(path.join(releaseDir(R2), "app.js"), path.join(mixed, "app.js"));
  root = mixed;
  try {
    const broken = await open("?demo=1", { timeout: 3000 });
    assert.equal(broken.seen.booted, false);
    assert.ok(broken.seen.errors.some((e) => /releaseMarker/.test(e)), broken.seen.errors.join("\n"));
    await broken.close();
  } finally {
    root = BUCKET;
  }
  activate(R2);
  const pointer = await open();
  assert.ok(pointer.seen.booted);
  assert.deepEqual(pointer.seen.errors, []);
  await pointer.close();
  // Upload parcial de R2 (ui.js ausente): 403 explícito, nenhum módulo de outra release é usado no lugar.
  const partial = path.join(BUCKET, "releases", R2, "ui.js");
  const saved = readFileSync(partial);
  rmSync(partial);
  try {
    const incomplete = await open("?demo=1", { timeout: 3000 });
    assert.equal(incomplete.seen.booted, false);
    assert.deepEqual(incomplete.prefixes(), [`/releases/${R2}`]);
    assert.ok(responses.some((r) => r.path === `/releases/${R2}/ui.js` && r.status === 403));
    await incomplete.close();
  } finally {
    writeFileSync(partial, saved);
  }
});

test("rollback: a aba aberta continua na release dela e o reload carrega a release reativada", async () => {
  activate(R2);
  const tab = await open();
  assert.deepEqual(tab.prefixes(), [`/releases/${R2}`]);
  activate(R1);
  const count = tab.seen.requests.length;
  await tab.page.locator('[data-action="demo-role"]').click();
  await tab.page.locator(".demo-bar").waitFor();
  assert.ok(tab.seen.requests.slice(count).every((p) => !/\.(js|css)$/.test(p) || p.startsWith(`/releases/${R2}/`)));
  tab.seen.requests.length = 0;
  await tab.page.reload();
  await tab.page.locator(".demo-bar").waitFor();
  assert.deepEqual(tab.prefixes(), [`/releases/${R1}`]);
  assert.deepEqual(tab.configs(), [`/releases/${R1}/config.json`]);
  assert.equal(await tab.page.evaluate(() => document.documentElement.dataset.releaseMarker), undefined);
  assert.deepEqual(tab.seen.errors, []);
  await tab.close();
});

test("release-browser-check.mjs (passo do workflow) aprova as releases preparadas e reprova config fora da release", () => {
  const check = (dir) => {
    try {
      return { code: 0, out: execFileSync("node", [path.join(ROOT, ".github/scripts/release-browser-check.mjs"), "--release-dir", dir],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: childEnv() }) };
    } catch (err) {
      return { code: err.status, out: String(err.stderr) };
    }
  };
  for (const id of [R0, R1]) assert.deepEqual(check(releaseDir(id)).code, 0, id);
  const bad = path.join(TMP, "release-config-documento");
  cpSync(releaseDir(R1), bad, { recursive: true });
  const appFile = path.join(bad, "app.js");
  writeFileSync(appFile, readFileSync(appFile, "utf8").replace('fetch(new URL("./config.json", import.meta.url)', 'fetch("./config.json"'));
  const result = check(bad);
  assert.equal(result.code, 1);
  assert.match(result.out, /config lida de/);
});

async function expectEventually(predicate, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("condição não atingida");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("o checkout não é alterado: releases, builds e clone ficam no diretório temporário", () => {
  assert.deepEqual(readdirSync(OUT).sort(), [R0, R1, R2].sort());
  assert.equal(checkoutStatus(), statusBefore);
});

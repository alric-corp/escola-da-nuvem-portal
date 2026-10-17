// Casca global, iteração 3.2 (docs/design-visual.md): navegação inferior adaptativa e cabeçalho do celular que quebra
// em linhas, com API fictícia (nunca AWS, Cognito ou Canvas). Mede a apresentação real: posição dos elementos, o que
// está por cima de quê, ordem visual x ordem do teclado, contorno de foco nos pixels e o modo ao longo de vários quadros.
// "Texto a 200%" = fonte padrão do navegador em 32 px (Page.setFontSizes); "zoom a 200%" = janela com metade do tamanho.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

const act = (id, name, kind, state, percent = null) => ({ id, name, kind, state, percent, score: percent, points: "100", active: state !== "unreleased",
  needsReview: state === "completed" && percent != null && percent < (kind === "kc" ? 70 : 95), module: "Linux", moduleOrder: 7,
  canvasUrl: ["pending", "completed"].includes(state) ? `https://awsrestart.instructure.com/courses/4436/modules/items/${9300 + Number(id.slice(1))}` : null, releasedAt: "2026-09-07T12:00:00Z" });
const activities = [act("a1", "226-LX-KC - Uma introdução ao Linux", "kc", "completed", 60), act("a2", "227--Lab - Linha de comando do Linux", "lab", "completed", 88.5),
  act("a3", "225--Lab - Introdução ao Linux", "lab", "completed", 100), act("a4", "254-NF- KC Introdução à rede", "kc", "pending")];
const student = { id: "1", name: "Maria Teste", email: "maria.conceicao@example.test", kc: 51.25, lab: 96.38, total: 73.81, completed: 3, pending: 1, progress: 75, status: "attention", activities };
const report = { cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-10T21:04:00Z", updateKind: "canvas",
  thresholds: { kc: 70, lab: 95 }, student, history: [{ publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 51.25, lab: 96.38, total: 73.81, changes: null }], focus: { activityIds: [], version: null } };
const ROLES = { student: ["student"], admin: ["admin", "instructor"] };
const RING = [0, 203, 221];

let browser, origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function open({ role = "student", width = 390, height = 844, text = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  // O protocolo só aceita inteiros (texto a 150%: 24 e 20 px).
  const setText = (scale) => cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * scale), fixed: Math.round(13 * scale) } });
  if (text !== 1) await setText(text);
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ROLES[role], email: role === "student" ? student.email : "admin@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? report : { ...report, students: [student], activities } });
    throw new Error("endpoint não simulado: " + endpoint);
  });
  await page.goto(origin);
  await page.locator(".layout .page-heading h1").waitFor();
  await settle(page);
  return { context, page, errors, setText };
}
const id = (o) => `${o.role || "student"} ${o.width}×${o.height}${o.text && o.text !== 1 ? ` texto ${o.text * 100}%` : ""}`;
// Espera alguns quadros: o modo só vale se não muda depois (sem oscilar).
const settle = (page) => page.evaluate(() => new Promise((resolve) => { let n = 0; const tick = () => (++n < 6 ? requestAnimationFrame(tick) : resolve()); requestAnimationFrame(tick); }));
async function modeOverFrames(page, frames = 12) {
  return page.evaluate((frames) => new Promise((resolve) => {
    const seen = new Set(); let n = 0;
    const tick = () => { seen.add(getComputedStyle(document.querySelector(".sidebar nav")).position); if (++n < frames) requestAnimationFrame(tick); else resolve([...seen]); };
    requestAnimationFrame(tick);
  }), frames);
}
const layoutOf = (page) => page.evaluate(() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const sb = document.querySelector(".sidebar"), nav = sb.querySelector("nav"), s = getComputedStyle(sb);
  const fixed = [...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).position === "fixed" && el.getClientRects().length).map((el) => ({ cls: el.className, share: el.getBoundingClientRect().height / innerHeight }));
  return { nav: rect(nav), position: getComputedStyle(nav).position, logo: rect(sb.querySelector(".brand-logo")), select: rect(sb.querySelector("#cohort")), sair: rect(sb.querySelector('[data-action="logout"]')),
    main: rect(document.querySelector("#main-content")), content: { left: sb.getBoundingClientRect().left + parseFloat(s.paddingLeft), right: sb.getBoundingClientRect().right - parseFloat(s.paddingRight) },
    padBottom: parseFloat(getComputedStyle(document.querySelector("#main-content")).paddingBottom), fixed, vw: innerWidth, vh: innerHeight,
    selectFont: parseFloat(getComputedStyle(sb.querySelector("#cohort")).fontSize), rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
    items: [...nav.querySelectorAll(".nav-item")].map((i) => ({ text: i.querySelector(".nav-short").textContent, current: i.getAttribute("aria-current") })) };
});
async function ringOnScreen(page) {
  const box = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth) }; });
  const { r, o, w } = box, mid = o + w / 2;
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  const shot = (await page.screenshot()).toString("base64");
  const colors = await page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
  return Object.entries(colors).filter(([, c]) => !c || c.some((v, i) => Math.abs(v - RING[i]) > 45)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
}
const ADMIN = ["Painel", "Publicações", "Notas", "Lembretes", "Acessos", "Feedbacks"];

test("N1: admin 320×640 com texto a 200% — menu no fluxo, logo abaixo da turma e antes da conta, sem área fixa acima de 22%", async () => {
  const o = { role: "admin", width: 320, height: 640, text: 2 };
  const { context, page, errors } = await open(o);
  const m = await layoutOf(page);
  assert.notEqual(m.position, "fixed", `${id(o)}: menu ainda fixo`);
  assert.deepEqual(m.items.map((i) => i.text), ADMIN, "seis destinos, na ordem");
  assert.deepEqual(m.items.map((i) => i.current), ["page", null, null, null, null, null], "aria-current na rota ativa");
  assert.ok(m.nav.top >= m.select.bottom - 0.5 && m.nav.bottom <= m.sair.top + 0.5 && m.nav.bottom <= m.main.top + 0.5, `${id(o)}: menu entre a turma e a conta, antes do conteúdo`);
  assert.ok(m.nav.left <= 0.5 && m.nav.right >= m.vw - 0.5, "menu na largura da tela");
  assert.ok(m.fixed.every((f) => f.share <= 0.22), `${id(o)}: área fixa grande: ${JSON.stringify(m.fixed)}`);
  assert.ok(m.padBottom <= 24, `${id(o)}: sem reserva da barra fixa (${m.padBottom} px)`);
  // Apresentação real: no fim da página o menu não está por cima de nada.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const hit = await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight - 4)?.closest(".sidebar nav"));
  assert.equal(hit, false, "menu não cobre o fim da página");
  // Nenhuma peça da casca passa da largura da tela. (O conteúdo do painel do instrutor tem dois botões que passam com
  // texto a 200% desde o HEAD; fica para a expansão daquela tela.)
  // C3: peças só para leitura assistiva (recortadas por clip-path inset(50%) ou clip rect(0 0 0 0)) não são vistas nem rolam;
  // o tamanho delas no layout depende da fonte (o nome da página escondido passava da tela com a DejaVu Sans do Linux).
  assert.deepEqual(await page.evaluate(() => {
    const seen = (el) => { for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.clipPath === "inset(50%)" || s.clip === "rect(0px, 0px, 0px, 0px)") return false; } return true; };
    return [...document.querySelectorAll(".sidebar, .sidebar *, .topline, .topline *")].filter((el) => el.getClientRects().length && seen(el) && (el.getBoundingClientRect().right > innerWidth + 0.5 || el.getBoundingClientRect().left < -0.5)).map((el) => el.className || el.tagName);
  }), [], "casca sem rolagem lateral");
  await page.evaluate(() => scrollTo(0, 0));
  // Teclado: logo → turma → seis destinos → Sair, e o contorno de cada destino inteiro (pixels).
  await page.locator(".skip-link").focus();
  const order = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => { const a = document.activeElement; return a.querySelector(".nav-short")?.textContent || a.getAttribute("aria-label") || a.id || (a.matches(".brand") ? "logo" : a.tagName); });
    order.push(name);
    if (ADMIN.includes(name)) assert.deepEqual(await ringOnScreen(page), [], `${id(o)}: contorno de ${name}`);
  }
  assert.deepEqual(order, ["logo", "cohort", ...ADMIN, "Sair da conta"], "ordem do teclado = ordem visual");
  // Último controle da página alcançável e visível.
  const last = await page.evaluate(() => { const all = [...document.querySelectorAll(".main :is(a, button, summary, input, select, textarea)")].filter((el) => el.getClientRects().length); const el = all.at(-1); el.focus(); const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  assert.ok(last, "último controle visível ao receber foco");
  assert.deepEqual(errors, []);
  await context.close();
});

test("N2: com texto normal a barra continua fixa e compacta (aluno 4 destinos, admin 6), com reserva no fim da página", async () => {
  for (const o of [{ role: "student", width: 390, height: 844 }, { role: "student", width: 320, height: 640 }, { role: "admin", width: 390, height: 844 }, { role: "admin", width: 320, height: 640 }]) {
    const { context, page } = await open(o);
    const m = await layoutOf(page);
    assert.equal(m.position, "fixed", `${id(o)}`);
    assert.equal(Math.round(m.nav.bottom), m.vh, `${id(o)}: barra no pé da tela`);
    assert.ok(m.nav.height <= (o.role === "student" ? 64 : 120), `${id(o)}: barra com ${m.nav.height} px`);
    assert.ok(Math.abs(m.padBottom - (Math.ceil(m.nav.height) + 16)) <= 1, `${id(o)}: reserva ${m.padBottom} para barra de ${m.nav.height}`);
    await context.close();
  }
});

// 3.3: o limite passou de 25%/23% para 22%/20% (só as linhas do menu, sem os recuos, como no app.js).
test("N3: redimensionar troca o modo uma vez, sem oscilar, com faixa de tolerância entre 20% e 22%", async () => {
  const o = { role: "admin", width: 320, height: 1200, text: 2 };
  const { context, page } = await open(o);
  assert.deepEqual(await modeOverFrames(page), ["fixed"], "janela alta: barra fixa");
  const rows = await page.evaluate(() => { const nav = document.querySelector(".sidebar nav"), s = getComputedStyle(nav); return nav.getBoundingClientRect().height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom); });
  const at = async (share) => { const height = Math.round(rows / share); await page.setViewportSize({ width: 320, height }); await settle(page); return [height, await modeOverFrames(page)]; };
  await page.setViewportSize({ width: 320, height: 640 });
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["static"], "janela baixa: menu no fluxo, estável");
  // Dentro da faixa (21% da altura): continua no modo em que estava, nos dois sentidos.
  let [h, mode] = await at(0.21);
  assert.deepEqual(mode, ["static"], `em ${h} px (21%) continua no fluxo`);
  // Abaixo da faixa (19%): volta a ser barra fixa.
  [h, mode] = await at(0.19);
  assert.deepEqual(mode, ["fixed"], `em ${h} px (19%) volta a fixa`);
  [h, mode] = await at(0.21);
  assert.deepEqual(mode, ["fixed"], `em ${h} px (21%) continua fixa`);
  // Acima da faixa (23%): vai para o fluxo.
  [h, mode] = await at(0.23);
  assert.deepEqual(mode, ["static"], `em ${h} px (23%) vai para o fluxo`);
  await context.close();
});

test("N4: mudar o tamanho do texto com a página aberta troca o modo, nos dois sentidos", async () => {
  const o = { role: "admin", width: 320, height: 640 };
  const { context, page, setText } = await open(o);
  assert.deepEqual(await modeOverFrames(page), ["fixed"]);
  await setText(2);
  await page.waitForTimeout(150);
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["static"], "texto a 200%: fluxo");
  await setText(1);
  await page.waitForTimeout(150);
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["fixed"], "texto normal de novo: fixa");
  await context.close();
});

test("N5: zoom a 200% (janela de 640×400): admin no fluxo, aluno com barra fixa", async () => {
  for (const [role, expected] of [["admin", "static"], ["student", "fixed"]]) {
    const { context, page } = await open({ role, width: 640, height: 400 });
    assert.deepEqual(await modeOverFrames(page), [expected], role);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${role}: sem rolagem lateral`);
    await context.close();
  }
});

test("N6: a troca de modo durante a leitura não faz o conteúdo saltar", async () => {
  const { context, page } = await open({ role: "admin", width: 320, height: 1200, text: 2 });
  const anchor = page.locator("main h2").first();
  await anchor.evaluate((el) => { el.scrollIntoView(); scrollBy(0, -200); });
  await settle(page);
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await page.setViewportSize({ width: 320, height: 640 });
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["static"]);
  const after = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(after - before) <= 2, `conteúdo saltou ${Math.round(after - before)} px`);
  await context.close();
});

// 3.4: espaços da casca do celular em px (o texto cresce, a moldura não). O cabeçalho usa a menor composição que
// cabe, sempre na ordem do DOM e do teclado: tudo numa linha; senão logo e turma numa linha e o Sair abaixo, à direita;
// senão a turma em linha própria (largura toda) e o Sair abaixo, à direita. No fluxo, o Sair vem depois do menu (N1, N8).
test("N7: cabeçalho do celular — uma linha quando cabe; senão logo e turma juntos e o Sair abaixo; senão turma em linha própria", async () => {
  for (const [o, expected] of [[{ width: 390, height: 844 }, "linha"], [{ width: 320, height: 640 }, "linha"], [{ role: "admin", width: 320, height: 640 }, "linha"], [{ width: 640, height: 400 }, "linha"],
    [{ width: 390, height: 844, text: 2 }, "linha"], [{ role: "admin", width: 412, height: 915, text: 2 }, "linha"], [{ width: 320, height: 640, text: 2 }, "sair-abaixo"],
    [{ role: "admin", width: 320, height: 640, text: 2 }, "fluxo"], [{ width: 320, height: 640, text: 3 }, "quebrado"]]) {
    const { context, page } = await open(o);
    const m = await layoutOf(page);
    const center = (r) => (r.top + r.bottom) / 2, sameRow = (a, b) => Math.abs(center(a) - center(b)) < 8;
    assert.deepEqual([Math.round(m.logo.width), Math.round(m.logo.height)], [48, 48], `${id(o)}: logo de 48 px`);
    assert.ok(Math.abs(m.selectFont - 0.875 * m.rootFont) < 0.5, `${id(o)}: fonte do seletor sem redução (${m.selectFont} px)`);
    assert.ok(m.sair.width >= 44 && m.sair.height >= 44 && m.sair.left >= 0 && m.sair.right <= m.vw, `${id(o)}: Sair visível com 44 px`);
    assert.ok(m.select.left >= m.content.left - 1 && m.select.right <= m.content.right + 1, `${id(o)}: turma dentro da faixa`);
    if (expected === "linha") assert.ok(sameRow(m.select, m.logo) && sameRow(m.sair, m.logo), `${id(o)}: logo, turma e Sair numa linha`);
    else if (expected === "sair-abaixo" || expected === "fluxo") {
      assert.ok(sameRow(m.select, m.logo) && m.select.left >= m.logo.right, `${id(o)}: turma na linha do logo`);
      assert.ok(m.sair.top >= m.select.bottom - 0.5 && Math.abs(m.sair.right - m.content.right) <= 1, `${id(o)}: Sair abaixo, à direita`);
      if (expected === "fluxo") assert.ok(m.sair.top >= m.nav.bottom - 0.5, `${id(o)}: no fluxo o Sair vem depois do menu`);
    } else {
      assert.ok(m.select.top >= m.logo.bottom - 0.5, `${id(o)}: turma em linha própria, abaixo do logo`);
      assert.ok(Math.abs(m.select.left - m.content.left) <= 1 && Math.abs(m.select.right - m.content.right) <= 1, `${id(o)}: turma na largura da linha`);
      assert.ok(m.sair.top >= m.select.bottom - 0.5 && Math.abs(m.sair.right - m.content.right) <= 1, `${id(o)}: Sair na linha seguinte, à direita`);
    }
    await context.close();
  }
});

// 3.3: com o limite de 22%, o admin com texto a 200% em 390×844 (menu com 22,8% da janela) deixa de ter uma barra fixa
// de ~200 px: o menu vai para o fluxo, com os mesmos seis destinos, ordem, teclado e contorno. Casos abaixo do limite
// (aluno; texto normal; admin em 412×915 com 21%) continuam com a barra fixa.
test("N8: limite de 22% — admin 390×844 com texto a 200% no fluxo; aluno, texto normal e 21% continuam com barra fixa", async () => {
  const o = { role: "admin", width: 390, height: 844, text: 2 };
  const { context, page, errors } = await open(o);
  const m = await layoutOf(page);
  assert.deepEqual(await modeOverFrames(page), ["static"], `${id(o)}: menu no fluxo, estável`);
  assert.deepEqual(m.items.map((i) => i.text), ADMIN, "seis destinos, na ordem");
  assert.deepEqual(m.items.map((i) => i.current), ["page", null, null, null, null, null], "aria-current na rota ativa");
  assert.ok(m.nav.top >= m.select.bottom - 0.5 && m.nav.bottom <= m.sair.top + 0.5 && m.nav.bottom <= m.main.top + 0.5, `${id(o)}: menu entre a turma e a conta, antes do conteúdo`);
  assert.ok(m.fixed.every((f) => f.share <= 0.22), `${id(o)}: área fixa grande: ${JSON.stringify(m.fixed)}`);
  assert.ok(m.padBottom <= 24, `${id(o)}: sem reserva da barra fixa (${m.padBottom} px)`);
  // Cabeçalho no fluxo: logo e turma cabem numa linha (o Sair vem depois do menu, à direita), turma sem redução.
  const center = (r) => (r.top + r.bottom) / 2;
  assert.ok(Math.abs(center(m.select) - center(m.logo)) < 8 && m.select.right <= m.content.right + 1, `${id(o)}: logo e turma na mesma linha`);
  assert.ok(Math.abs(m.selectFont - 0.875 * m.rootFont) < 0.5, `${id(o)}: fonte do seletor sem redução (${m.selectFont} px)`);
  assert.ok(m.sair.width >= 44 && m.sair.height >= 44 && Math.abs(m.sair.right - m.content.right) <= 1, `${id(o)}: Sair com 44 px, à direita`);
  await page.locator(".skip-link").focus();
  const order = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => { const a = document.activeElement; return a.querySelector(".nav-short")?.textContent || a.getAttribute("aria-label") || a.id || (a.matches(".brand") ? "logo" : a.tagName); });
    order.push(name);
    if (ADMIN.includes(name)) assert.deepEqual(await ringOnScreen(page), [], `${id(o)}: contorno de ${name}`);
  }
  assert.deepEqual(order, ["logo", "cohort", ...ADMIN, "Sair da conta"], "ordem do teclado = ordem visual");
  const last = await page.evaluate(() => { const all = [...document.querySelectorAll(".main :is(a, button, summary, input, select, textarea)")].filter((el) => el.getClientRects().length); const el = all.at(-1); el.focus(); const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  assert.ok(last, "último controle visível ao receber foco");
  assert.deepEqual(errors, []);
  await context.close();
  for (const p of [{ role: "admin", width: 412, height: 915, text: 2 }, { role: "admin", width: 390, height: 844 }, { role: "student", width: 390, height: 844 }, { role: "student", width: 390, height: 844, text: 2 }]) {
    const { context, page } = await open(p);
    assert.deepEqual(await modeOverFrames(page), ["fixed"], `${id(p)}: barra fixa`);
    const n = await layoutOf(page);
    assert.ok(Math.abs(n.padBottom - (Math.ceil(n.nav.height) + 16)) <= 1, `${id(p)}: reserva ${n.padBottom} para barra de ${n.nav.height}`);
    await context.close();
  }
});

test("N9: em 390×844 o admin troca de modo ao mudar o tamanho do texto (sem redimensionar) e ao redimensionar, sem o conteúdo saltar", async () => {
  const o = { role: "admin", width: 390, height: 844 };
  const { context, page, setText } = await open(o);
  assert.deepEqual(await modeOverFrames(page), ["fixed"]);
  await setText(2);
  await page.waitForTimeout(150);
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["static"], "texto a 200%: fluxo");
  await setText(1);
  await page.waitForTimeout(150);
  await settle(page);
  assert.deepEqual(await modeOverFrames(page), ["fixed"], "texto normal de novo: fixa");
  await context.close();
  const r = await open({ role: "admin", width: 390, height: 1200, text: 2 });
  assert.deepEqual(await modeOverFrames(r.page), ["fixed"], "janela alta: fixa");
  const anchor = r.page.locator("main h2").first();
  await anchor.evaluate((el) => { el.scrollIntoView(); scrollBy(0, -200); });
  await settle(r.page);
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await r.page.setViewportSize({ width: 390, height: 844 });
  await settle(r.page);
  assert.deepEqual(await modeOverFrames(r.page), ["static"]);
  const after = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(after - before) <= 2, `conteúdo saltou ${Math.round(after - before)} px`);
  await r.context.close();
});

// 3.4: texto ampliado em tela estreita (até 15em de largura, ex.: 320–480 px com texto a 200%). A casca não dobra os
// próprios espaços; o topo mostra só a identidade (papel e e-mail inteiro, quebrando depois do "@", nunca no meio de uma
// palavra) e o nome da página fica para a leitura assistiva (já está no item ativo do menu e no título). O título da tela
// aparece na primeira tela. Com texto normal o topo continua como antes.
test("N10: texto ampliado em tela estreita — casca compacta, identidade legível e título na primeira tela", async () => {
  for (const o of [{ width: 320, height: 568, text: 2 }, { width: 320, height: 640, text: 2 }, { width: 390, height: 844, text: 2 }, { width: 320, height: 568, text: 1.5 },
    { role: "admin", width: 390, height: 844, text: 2 }, { role: "admin", width: 320, height: 640, text: 2 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const { context, page } = await open(o);
    if (o.role !== "admin") {
      await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
      await page.getByRole("heading", { name: "Minhas atividades", level: 1 }).waitFor();
      await settle(page);
      await page.evaluate(() => scrollTo(0, 0));
    }
    const m = await page.evaluate(() => {
      const nav = document.querySelector(".sidebar nav"), fixed = getComputedStyle(nav).position === "fixed", h1 = document.querySelector("main h1").getBoundingClientRect();
      const email = document.querySelector(".session-context small"), breaks = [];
      let prevTop = null, text = "";
      for (const node of [...email.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)) for (let i = 0; i < node.length; i++) {
        const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const top = Math.round(r.getBoundingClientRect().top);
        if (prevTop !== null && top > prevTop + 2) breaks.push(text.slice(-1)); prevTop = top; text += node.data[i];
      }
      const loc = document.querySelector(".location-context"), lr = loc.getBoundingClientRect(), er = email.getBoundingClientRect();
      return { compact: matchMedia("(max-width: 15em)").matches, pad: getComputedStyle(document.querySelector(".sidebar")).paddingLeft, h1Bottom: h1.bottom, limit: fixed ? nav.getBoundingClientRect().top : innerHeight,
        email: text, breaks, emailInside: er.left >= 0 && er.right <= innerWidth, role: document.querySelector(".role-chip").getClientRects().length > 0,
        // Papel e e-mail no mesmo parágrafo: o e-mail começa na linha do papel.
        together: Math.abs(document.querySelector(".role-chip").getClientRects()[0].top - email.getClientRects()[0].top) < 4,
        // C3: o começo do e-mail (até o "@") cabe na linha do papel? Medido pelo próprio texto, sem depender de onde ele ficou.
        fitsBeside: (() => { const chip = document.querySelector(".role-chip"), first = [...email.childNodes].find((n) => n.nodeType === Node.TEXT_NODE), r = document.createRange();
          r.selectNodeContents(first); const w = [...r.getClientRects()].reduce((s, x) => s + x.width, 0), box = email.parentElement.getBoundingClientRect();
          return chip.getBoundingClientRect().right + parseFloat(getComputedStyle(chip).marginRight) + w <= box.right + 0.5; })(),
        startsLine: Math.abs(email.getClientRects()[0].left - email.parentElement.getBoundingClientRect().left) < 2,
        label: { text: loc.textContent, visible: lr.width > 2 && lr.height > 2 }, overflowX: document.documentElement.scrollWidth - innerWidth };
    });
    const label = id(o);
    assert.equal(m.pad, "16px", `${label}: espaço lateral da casca`);
    assert.ok(m.h1Bottom <= m.limit, `${label}: título termina em ${Math.round(m.h1Bottom)} px, além da primeira tela (${Math.round(m.limit)} px)`);
    assert.ok(m.role && m.emailInside && m.overflowX <= (o.role === "admin" && o.width === 320 ? 18 : 0), `${label}: identidade inteira na tela`);
    assert.match(m.email, /@example\.test$/, `${label}: e-mail inteiro`);
    // Papel curto ("Aluno"): o e-mail começa na mesma linha. (O do admin ocupa a linha toda; o e-mail segue na próxima.)
    // C3: com fonte mais larga (DejaVu Sans no Linux), o começo do e-mail pode não caber depois do papel; ele desce inteiro e
    // começa a linha seguinte, em vez de partir no meio de uma palavra.
    if (m.compact && o.role !== "admin") assert.ok(m.fitsBeside ? m.together : m.startsLine, `${label}: papel e e-mail em linhas separadas (cabe ao lado: ${m.fitsBeside})`);
    assert.ok(m.breaks.every((c) => c === "@"), `${label}: e-mail quebrado no meio de uma palavra (depois de "${m.breaks.join('", "')}")`);
    assert.match(m.label.text, o.role === "admin" ? /Painel do instrutor/ : /Minhas atividades/, `${label}: nome da página para leitura assistiva`);
    assert.equal(m.label.visible, !m.compact, `${label}: nome da página ${m.compact ? "oculto (já está no menu e no título)" : "visível"}`);
    await context.close();
  }
});

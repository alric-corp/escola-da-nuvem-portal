// Casca global, iteração 3.1 (docs/design-visual.md): navegação e acessibilidade em telas estreitas, janelas baixas,
// texto ampliado e zoom, com API fictícia (nunca AWS, Cognito ou Canvas). Mede o comportamento real no navegador:
// posições, sobreposição, o contorno de foco lido nos pixels de uma captura, e onde o conteúdo termina.
// "Texto a 200%" = fonte padrão do navegador em 32 px (Page.setFontSizes, o mesmo efeito da preferência "Tamanho da
// fonte"); "zoom a 200%" = metade da largura e da altura CSS da janela.
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
  canvasUrl: ["pending", "completed"].includes(state) ? `https://awsrestart.instructure.com/courses/4436/modules/items/${9200 + Number(id.slice(1))}` : null, releasedAt: "2026-09-07T12:00:00Z" });
const activities = [
  act("a1", "226-LX-KC - Uma introdução ao Linux", "kc", "completed", 60), act("a2", "227--Lab - Linha de comando do Linux", "lab", "completed", 88.5),
  act("a3", "225--Lab - Introdução ao Linux", "lab", "completed", 100), act("a4", "254-NF- KC Introdução à rede", "kc", "pending"),
  act("a5", "10- CF - KC — Introdução ao Amazon S3", "kc", "completed", 90), act("a6", "255--Lab - Sub-redes e tabelas de rotas", "lab", "completed", 97),
  act("a7", "12- CF -KC — Introdução ao Amazon EC2", "kc", "completed", 55), act("a8", "11--Lab - Introdução ao Amazon EC2", "lab", "completed", 100),
];
const student = { id: "1", name: "Maria Teste", email: "maria.conceicao@example.test", kc: 51.25, lab: 96.38, total: 73.81, completed: 7, pending: 1, progress: 87.5, status: "attention", activities };
const history = [
  { publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 51.25, lab: 96.38, total: 73.81, changes: null },
  { publishedAt: "2026-10-02T21:00:00Z", current: false, kc: 57.5, lab: 92.75, total: 75.13, changes: null },
];
const report = { cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-10T21:04:00Z",
  updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, student, history, focus: { activityIds: [], version: null } };
const ROLES = { student: ["student"], instructor: ["instructor"], admin: ["admin", "instructor"] };
const ADMIN_MENU = ["Painel", "Publicações", "Notas", "Lembretes", "Acessos", "Feedbacks"];
const RING = [0, 203, 221]; // --primary-hover, cor do contorno de foco

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
  if (text !== 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 16 * text, fixed: 13 * text } });
  }
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ROLES[role], email: role === "student" ? student.email : `${role}@example.test` } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? report : { ...report, students: [student], activities } });
    if (endpoint === "/feedback") return route.fulfill({ json: { items: [], nextCursor: null } });
    throw new Error("endpoint não simulado: " + endpoint);
  });
  await page.goto(origin);
  await page.locator(".layout .page-heading h1").waitFor();
  await page.waitForTimeout(100);
  return { context, page, errors };
}
const label = (o) => `${o.role || "student"} ${o.width}×${o.height}${o.text && o.text !== 1 ? ` texto ${o.text * 100}%` : ""}`;

// Contorno de foco lido nos pixels: o meio de cada lado do anel (fora ou dentro da borda, conforme outline-offset)
// precisa estar na tela e ter a cor do contorno. x/y de amostra evitam a marca do item ativo.
async function ringOnScreen(page) {
  const box = await page.evaluate(() => {
    const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth), style: s.outlineStyle, vw: innerWidth, vh: innerHeight };
  });
  const { r, o, w } = box, mid = o + w / 2;
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  const shot = (await page.screenshot()).toString("base64");
  const colors = await page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
  const bad = Object.entries(colors).filter(([, c]) => !c || c.some((v, i) => Math.abs(v - RING[i]) > 45)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
  return { style: box.style, bad };
}

test("A1: o seletor de turma mostra o código e o Sair continua visível, com texto normal, texto a 200% e zoom a 200%", async () => {
  for (const o of [{ width: 320, height: 640 }, { width: 320, height: 640, text: 2 }, { width: 390, height: 844 }, { width: 390, height: 844, text: 2 },
    { width: 720, height: 450 }, { width: 640, height: 400 }, { role: "admin", width: 320, height: 640, text: 2 }]) {
    const { context, page, errors } = await open(o);
    const m = await page.evaluate(() => {
      const sel = document.querySelector("#cohort"), s = getComputedStyle(sel), ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
      const out = document.querySelector('[data-action="logout"]'), logo = document.querySelector(".brand-logo");
      return { texto: ctx.measureText(sel.value).width, espaco: sel.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 18, sel: rect(sel), sair: rect(out), logo: rect(logo), vw: innerWidth };
    });
    const id = label(o);
    assert.ok(m.espaco >= m.texto, `${id}: código da turma precisa de ${Math.round(m.texto)} px e tem ${Math.round(m.espaco)} px`);
    assert.ok(m.sel.height >= 44 && m.sair.width >= 44 && m.sair.height >= 44, `${id}: seletor e Sair com área de toque de 44 px`);
    assert.ok(m.sair.left >= 0 && m.sair.right <= m.vw && m.sel.left >= 0 && m.sel.right <= m.vw, `${id}: seletor e Sair dentro da tela`);
    assert.deepEqual([Math.round(m.logo.width), Math.round(m.logo.height)], [48, 48], `${id}: logo fixo em 48 px`);
    const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    assert.ok(!overlap(m.sel, m.sair) && !overlap(m.sel, m.logo) && !overlap(m.sair, m.logo), `${id}: logo, seletor e Sair não se sobrepõem`);
    // Ordem visual (de cima para baixo, da esquerda para a direita) = ordem do teclado.
    const visual = [["logo", m.logo], ["seletor", m.sel], ["sair", m.sair]].sort(([, a], [, b]) => (Math.abs(a.top - b.top) > a.height / 2 ? a.top - b.top : a.left - b.left)).map(([k]) => k);
    assert.deepEqual(visual, ["logo", "seletor", "sair"], `${id}: ordem visual do cabeçalho`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("A2: os seis destinos do admin cabem sem sobreposição nem corte, na ordem, em 320 e 390 px, com texto normal e a 200%", async () => {
  for (const o of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 320, height: 640, text: 2 }, { width: 390, height: 844, text: 2 }]) {
    const { context, page } = await open({ role: "admin", ...o });
    const items = await page.locator(".sidebar nav .nav-item").evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect(), short = el.querySelector(".nav-short"), range = document.createRange();
      range.selectNodeContents(short);
      const t = range.getBoundingClientRect();
      return { text: short.textContent, item: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, label: { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
        overflow: short.scrollWidth - short.clientWidth, font: parseFloat(getComputedStyle(short).fontSize), vw: innerWidth,
        lines: Math.round(t.height / parseFloat(getComputedStyle(short).lineHeight)) };
    }));
    const id = label({ role: "admin", ...o });
    assert.deepEqual(items.map((i) => i.text), ADMIN_MENU, `${id}: seis destinos, na ordem`);
    for (const i of items) {
      assert.ok(i.overflow <= 0.5, `${id}: "${i.text}" transborda ${i.overflow} px`);
      assert.ok(i.label.left >= i.item.left - 0.5 && i.label.right <= i.item.right + 0.5 && i.label.top >= i.item.top - 0.5 && i.label.bottom <= i.item.bottom + 0.5, `${id}: "${i.text}" fora do próprio item`);
      assert.ok(i.item.left >= -0.5 && i.item.right <= i.vw + 0.5, `${id}: "${i.text}" dentro da tela`);
      assert.ok(i.font >= 12, `${id}: "${i.text}" com ${i.font} px`);
      // Os rótulos são uma palavra só: se três colunas não comportam a palavra, a grade passa a duas, sem partir a palavra.
      assert.equal(i.lines, 1, `${id}: "${i.text}" partido em ${i.lines} linhas`);
    }
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      const p = items[a].label, q = items[b].label;
      assert.ok(!(p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5), `${id}: "${items[a].text}" e "${items[b].text}" se sobrepõem`);
    }
    // Ordem visual = ordem dos destinos; colunas por linha: 3 com texto normal, no máximo 3 com texto ampliado.
    const rows = [...new Set(items.map((i) => Math.round(i.item.top)))];
    const visual = [...items].sort((p, q) => (Math.round(p.item.top) - Math.round(q.item.top)) || (p.item.left - q.item.left)).map((i) => i.text);
    assert.deepEqual(visual, ADMIN_MENU, `${id}: ordem visual`);
    const perRow = rows.map((t) => items.filter((i) => Math.round(i.item.top) === t).length);
    if (!o.text) assert.deepEqual(perRow, [3, 3], `${id}: três colunas e duas linhas`);
    else assert.ok(perRow.every((n) => n <= 3) && perRow.length >= 2, `${id}: até três por linha (${perRow})`);
    await context.close();
  }
});

test("A3: o contorno de foco dos itens da barra inferior aparece inteiro (pixels), sem sair da tela", async () => {
  for (const o of [{ role: "admin", width: 320, height: 640 }, { role: "admin", width: 320, height: 640, text: 2 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const { context, page } = await open(o);
    const count = await page.locator(".sidebar nav .nav-item").count();
    await page.locator(".sidebar nav .nav-item").first().focus();
    // O primeiro item recebe foco programático; os demais vêm pelo Tab, na ordem.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    for (let i = 0; i < count; i++) {
      const name = await page.evaluate(() => document.activeElement.querySelector(".nav-short")?.textContent);
      assert.ok(name, `${label(o)}: foco fora do menu no item ${i + 1}`);
      const ring = await ringOnScreen(page);
      assert.equal(ring.style, "solid", `${label(o)}: ${name}`);
      assert.deepEqual(ring.bad, [], `${label(o)}: contorno de "${name}" incompleto`);
      await page.keyboard.press("Tab");
    }
    await context.close();
  }
});

test("A4: em janelas baixas e com zoom, o contorno de foco dos controles da barra lateral aparece inteiro (pixels)", async () => {
  for (const o of [{ role: "admin", width: 1024, height: 500 }, { role: "admin", width: 800, height: 450 }, { role: "admin", width: 960, height: 540 }, { role: "admin", width: 1440, height: 900, text: 2 }]) {
    const { context, page } = await open(o);
    await page.locator(".skip-link").focus();
    let seen = 0;
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      const inSidebar = await page.evaluate(() => !!document.activeElement.closest(".sidebar") && !document.activeElement.closest(".brand"));
      if (!inSidebar) { if (seen) break; continue; }
      seen++;
      const name = await page.evaluate(() => { const a = document.activeElement; return (a.getAttribute("aria-label") || a.querySelector(".nav-label")?.textContent || a.id).trim(); });
      const ring = await ringOnScreen(page);
      assert.deepEqual(ring.bad, [], `${label(o)}: contorno de "${name}" incompleto`);
    }
    assert.ok(seen >= 8, `${label(o)}: turma, seis destinos e Sair pelo teclado (${seen})`);
    await context.close();
  }
});

test("A5: a barra lateral só fica fixa quando cabe; senão rola com a página, sem rolagem interna, e o Sair fica logo abaixo do menu", async () => {
  for (const o of [{ role: "admin", width: 1440, height: 900 }, { role: "admin", width: 1280, height: 600 }, { role: "admin", width: 1024, height: 500 },
    { role: "admin", width: 960, height: 540 }, { role: "admin", width: 800, height: 450 }, { role: "student", width: 1440, height: 900, text: 2 }, { role: "student", width: 1440, height: 900 }]) {
    const { context, page } = await open(o);
    const m = await page.evaluate(() => {
      const sb = document.querySelector(".sidebar"), s = getComputedStyle(sb), nav = sb.querySelector("nav").getBoundingClientRect(), bottom = sb.querySelector(".sidebar-bottom").getBoundingClientRect(), top = sb.getBoundingClientRect();
      const natural = nav.bottom - top.top + bottom.height + parseFloat(s.paddingBottom);
      const out = document.querySelector('[data-action="logout"]');
      let scroller = null;
      for (let el = out.parentElement; el && el !== document.body; el = el.parentElement) { const ov = getComputedStyle(el).overflowY; if (["auto", "scroll", "hidden"].includes(ov) && el.scrollHeight > el.clientHeight + 1) scroller = el.className || el.tagName; }
      const outRect = out.getBoundingClientRect();
      return { natural: Math.round(natural), vh: innerHeight, position: s.position, scroller, sairVisivel: outRect.top >= 0 && outRect.bottom <= innerHeight, contaAposMenu: Math.round(bottom.top - nav.bottom) };
    });
    const id = label(o);
    assert.equal(m.scroller, null, `${id}: Sair dentro de uma área com rolagem própria (${m.scroller})`);
    if (m.natural <= m.vh) {
      assert.equal(m.position, "sticky", `${id}: cabe (${m.natural} ≤ ${m.vh}), fica fixa`);
      assert.ok(m.sairVisivel, `${id}: Sair visível ao abrir`);
    } else {
      assert.notEqual(m.position, "sticky", `${id}: não cabe (${m.natural} > ${m.vh}), rola com a página`);
      // A conta (com Sair) começa logo depois do menu, sem o espaço automático que a levava ao fim da página.
      assert.ok(Math.abs(m.contaAposMenu) <= 1, `${id}: conta a ${m.contaAposMenu} px do fim do menu`);
    }
    // Pelo teclado, o Sair aparece inteiro quando recebe foco.
    await page.locator('[data-action="logout"]').focus();
    assert.ok(await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `${id}: Sair visível com foco`);
    await context.close();
  }
});

test("A6: o degradê acima da barra é de no máximo 16 px e não apaga indicadores acadêmicos na primeira tela", async () => {
  for (const o of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 720, height: 450 }, { width: 390, height: 844, text: 2 }, { width: 320, height: 640, text: 2 }]) {
    const { context, page } = await open(o);
    const m = await page.evaluate(() => {
      const nav = document.querySelector(".sidebar nav").getBoundingClientRect(), fade = getComputedStyle(document.querySelector(".sidebar nav"), "::before");
      const h = fade.content === "none" ? 0 : parseFloat(fade.height) || 0, band = { top: nav.top - h, bottom: nav.top };
      const dim = [];
      for (const el of document.querySelectorAll(".student-summary :is(.goal-label, .goal > strong, .goal-reference, .goal-status, .goal-note, .coverage-text, .summary-counts li)")) {
        const r = el.getBoundingClientRect();
        if (!h || r.top >= nav.top || r.bottom <= band.top) continue;
        const visTop = r.top, visBottom = Math.min(r.bottom, nav.top), overlapTop = Math.max(visTop, band.top), overlap = visBottom - overlapTop;
        const meanAlpha = ((overlapTop + visBottom) / 2 - band.top) / h;
        if (overlap / (visBottom - visTop) > 0.3 && meanAlpha > 0.25) dim.push(el.textContent.trim().slice(0, 40));
      }
      return { h, dim };
    });
    assert.ok(m.h <= 16, `${label(o)}: degradê de ${m.h} px`);
    assert.deepEqual(m.dim, [], `${label(o)}: indicadores apagados pelo degradê`);
    await context.close();
  }
});

test("A7: o menu do aluno (quatro destinos) usa 12 px em uma linha, sem a compactação do menu do admin", async () => {
  for (const [width, height] of [[320, 640], [375, 812], [390, 844]]) {
    const { context, page } = await open({ width, height });
    const items = await page.locator(".sidebar nav .nav-item").evaluateAll((els) => els.map((el) => {
      const short = el.querySelector(".nav-short"), s = getComputedStyle(short), r = el.getBoundingClientRect();
      return { text: short.textContent, font: parseFloat(s.fontSize), lines: Math.round(short.getBoundingClientRect().height / parseFloat(s.lineHeight)), top: Math.round(r.top) };
    }));
    assert.equal(items.length, 4);
    for (const i of items) assert.ok(i.font >= 12 && i.lines === 1, `${width}px: "${i.text}" com ${i.font} px em ${i.lines} linha(s)`);
    assert.equal(new Set(items.map((i) => i.top)).size, 1, `${width}px: quatro destinos numa linha`);
    await context.close();
  }
});

test("A8: o espaço no fim da página e o recuo do foco acompanham a altura real da barra (duas linhas, texto ampliado)", async () => {
  for (const o of [{ role: "admin", width: 320, height: 640 }, { role: "admin", width: 320, height: 640, text: 2 }, { role: "admin", width: 390, height: 844, text: 2 }, { width: 390, height: 844 }, { width: 320, height: 640, text: 2 }]) {
    const { context, page } = await open(o);
    const id = label(o);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const end = await page.evaluate(() => {
      // 3.2: com a barra fixa, o limite é o topo dela (e do degradê, se houver); com o menu no fluxo, o pé da janela.
      const nav = document.querySelector(".sidebar nav"), r = nav.getBoundingClientRect(), fade = getComputedStyle(nav, "::before"), h = fade.content === "none" ? 0 : parseFloat(fade.height) || 0;
      const limit = getComputedStyle(nav).position === "fixed" ? r.top - h : innerHeight;
      const last = Math.max(...[...document.querySelectorAll(".main-footer > *")].filter((e) => e.getBoundingClientRect().height && getComputedStyle(e).display !== "none").map((e) => e.getBoundingClientRect().bottom));
      return { folga: Math.round(limit - last), barra: Math.round(r.height) };
    });
    assert.ok(end.folga >= 0, `${id}: fim da página ${-end.folga} px sob a barra/degradê (barra ${end.barra} px)`);
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator("#main-content").focus();
    const hidden = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => { const a = document.activeElement; if (!a.closest(".main")) return null;
        const nav = document.querySelector(".sidebar nav"), n = nav.getBoundingClientRect(), fade = getComputedStyle(nav, "::before"), h = fade.content === "none" ? 0 : parseFloat(fade.height) || 0, r = a.getBoundingClientRect();
        const limit = getComputedStyle(nav).position === "fixed" ? n.top - h : innerHeight;
        return { name: (a.textContent || a.id || a.name).trim().slice(0, 30), ok: r.top >= 0 && r.bottom <= limit + 0.5 }; });
      if (!f) break;
      if (!f.ok) hidden.push(f.name);
    }
    assert.deepEqual(hidden, [], `${id}: controles sob a barra ou o degradê`);
    await context.close();
  }
});

test("A9: a barra lateral não tem a régua repetida; separação por linha fina e marca só no item ativo", async () => {
  const { context, page } = await open({ width: 1440, height: 900 });
  const m = await page.evaluate(() => { const s = getComputedStyle(document.querySelector(".sidebar")), a = document.querySelector('.sidebar nav [aria-current="page"]');
    return { image: s.backgroundImage, border: s.borderRightWidth, mark: getComputedStyle(a, "::before").backgroundColor, tip: getComputedStyle(a, "::after").content }; });
  assert.equal(m.image, "none", "sem marcações repetidas");
  assert.equal(m.border, "1px");
  assert.equal(m.mark, "rgb(0, 175, 232)");
  assert.notEqual(m.tip, "none");
  await context.close();
});

test("A10: com texto a 200% e zoom, nenhum controle do painel do aluno fica recortado ou fora da tela", async () => {
  for (const o of [{ width: 320, height: 640, text: 2 }, { width: 390, height: 844, text: 2 }, { width: 720, height: 450 }, { width: 320, height: 640 }]) {
    const { context, page } = await open(o);
    const cut = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll(".student-home :is(a, button, summary, select, input)")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let clip = { left: 0, right: innerWidth };
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
        }
        if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5 || el.scrollWidth > el.clientWidth + 1) bad.push(`${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 32)} (${Math.round(r.left)}–${Math.round(r.right)} em ${Math.round(clip.left)}–${Math.round(clip.right)})`);
      }
      return bad;
    });
    assert.deepEqual(cut, [], `${label(o)}: controles recortados`);
    await context.close();
  }
});

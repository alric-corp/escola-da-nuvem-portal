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

async function open({ role = "student", width = 390, height = 844, text = 1, codes = ["BRSA0267"] } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } });
  }
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ROLES[role], email: role === "student" ? student.email : `${role}@example.test` } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: codes.map((code) => ({ code, canTeach: role !== "student", autoSync: true })) } });
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

// PR #3 (fechamento, M1): de 761 a 1279 px a barra lateral tinha largura fixa em px (210 e 244 px), e logo, turma e menu crescem
// com o texto. Com texto a partir de 150%, os rótulos passavam da barra e eram pintados sobre o conteúdo (a 200%, sobre o
// título "Situação da turma" e a borda de controles; um clique na borda de "Como interpretar minhas notas?" abria "Meu
// desempenho"), o código da turma era cortado e o logo saía da barra. Em 768, 1024, 1100, 1101, 1200, 1279, 1280 e 1440 px,
// com texto de 100% a 250%, nos três papéis, com a fonte do sistema (DejaVu Sans no Linux) e com uma fonte larga (Verdana;
// no Linux, DejaVu Sans):
// 1. rótulos do menu inteiros, dentro da barra, e ícones sem encolher;
// 2. o código da turma inteiro (o seletor tem pelo menos a largura intrínseca dele);
// 3. o logo dentro da barra;
// 4. nada da barra pintado fora dela, e o conteúdo começa depois dela;
// 5. nenhum controle coberto: o centro e os cantos de cada controle da barra e do conteúdo junto dela são do próprio controle;
// 6–7. clique real do mouse no centro de cada item do menu e do Sair, e na borda esquerda de cada controle do conteúdo junto
//    da barra, chega ao próprio controle (registrado na captura e cancelado: nada navega);
// 8. o Tab percorre a barra na ordem visual: logo, turma, menu e Sair;
// 9. o contorno de foco do menu e do Sair aparece inteiro (pixels), em parte da matriz;
// 10. de 1024 a 1279 px, a barra mais larga não empurra o conteúdo para uma rolagem lateral da página. Abaixo disso, com
//    texto a 250% (e a 768 px com 200% e a fonte larga), barra e conteúdo juntos não cabem na janela: a página rola de lado
//    em vez de a barra cobrir o conteúdo (limitação registrada no fechamento do PR #3).
// Com texto normal, a barra continua com 210 px (tablet) e 244 px (até 1279 px); a partir de 1280 px, 15,25rem.
const WIDE_FONT = ':root { --font-ui: Verdana, "DejaVu Sans", sans-serif; }';
const BAND = 240;   // o transbordamento medido no 242f834 chegava a 217 px além da barra

// Contorno de foco lido nos pixels, como em ringOnScreen, mas no meio de cada lado e atravessando a faixa inteira do contorno:
// com texto ampliado a posição é fracionária, e o pixel do meio da faixa pode sair só meio coberto (antialiasing); no canto,
// o contorno acompanha o arredondamento. Basta um pixel com a cor do contorno em cada lado.
async function ringAcross(page) {
  const box = await page.evaluate(() => {
    const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth), style: s.outlineStyle };
  });
  const { r, o, w } = box, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  const band = (from) => Array.from({ length: Math.ceil(w) + 2 }, (_, k) => from - 1 + k);
  const sides = { cima: band(r.top - o - w).map((y) => [cx, y]), baixo: band(r.bottom + o).map((y) => [cx, y]),
    esquerda: band(r.left - o - w).map((x) => [x, cy]), direita: band(r.right + o).map((x) => [x, cy]) };
  const shot = (await page.screenshot()).toString("base64");
  const colors = await page.evaluate(async ({ shot, sides }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(sides).map(([k, pts]) => [k, pts.map(([x, y]) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]))]));
  }, { shot, sides });
  const bad = Object.entries(colors).filter(([, cs]) => !cs.some((c) => c && c.every((v, i) => Math.abs(v - RING[i]) <= 45))).map(([k, cs]) => `${k}: ${cs.map((c) => (c ? `rgb(${c})` : "fora da tela")).join(" ")}`);
  return { style: box.style, bad };
}

async function sidebarCheck(page) {
  return page.evaluate((BAND) => {
    const r1 = (x) => Math.round(x * 10) / 10, problems = [];
    const sb = document.querySelector(".sidebar"), s = sb.getBoundingClientRect(), ss = getComputedStyle(sb);
    const inner = { left: s.left + parseFloat(ss.paddingLeft), right: s.right - parseFloat(ss.paddingRight) };
    const main = document.querySelector("#main-content").getBoundingClientRect();
    const name = (el) => (el.getAttribute("aria-label") || el.querySelector?.(".nav-label")?.textContent || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    // Caixa visível: recortada pelos ancestrais com overflow, como o navegador pinta.
    // Para um fragmento de texto, el é o próprio elemento que o contém (o overflow dele recorta o texto).
    const visible = (el, r, self = false) => {
      let { left, right } = r;
      for (let p = self ? el : el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); left = Math.max(left, c.left); right = Math.min(right, c.right); }
      }
      return { left, right };
    };
    // 1. Rótulos e ícones.
    for (const item of sb.querySelectorAll("nav .nav-item")) {
      if (!item.getClientRects().length) continue;
      const label = item.querySelector(".nav-label"), g = document.createRange();
      g.selectNodeContents(label);
      const frags = [...g.getClientRects()].filter((x) => x.width > 0.5), ir = item.getBoundingClientRect();
      const right = Math.max(...frags.map((x) => x.right)), left = Math.min(...frags.map((x) => x.left));
      if (right > Math.min(ir.right, inner.right) + 0.5 || left < inner.left - 0.5) problems.push(`rótulo "${label.textContent}" passa ${r1(right - Math.min(ir.right, inner.right))} px do item ou da barra`);
      const icon = item.querySelector("svg").getBoundingClientRect();
      if (icon.width < icon.height - 0.5) problems.push(`ícone de "${label.textContent}" encolhido (${r1(icon.width)}×${r1(icon.height)} px)`);
    }
    // 2. Código da turma: um clone do seletor com largura automática mede texto, preenchimento e seta.
    const sel = sb.querySelector("#cohort"), cs = getComputedStyle(sel), clone = sel.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.cssText = "position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none;flex:none";
    for (const p of ["font-family", "font-size", "font-weight", "letter-spacing", "padding-left", "padding-right", "border-left-width", "border-right-width"]) clone.style.setProperty(p, cs.getPropertyValue(p));
    sel.parentNode.append(clone);
    const need = clone.getBoundingClientRect().width, have = sel.getBoundingClientRect().width;
    clone.remove();
    if (have < need - 0.5) problems.push(`código da turma cortado: o seletor tem ${r1(have)} px e o código pede ${r1(need)} px`);
    const sr = sel.getBoundingClientRect();
    if (sr.left < inner.left - 0.5 || sr.right > inner.right + 0.5) problems.push(`seletor da turma fora da barra (${r1(sr.left)}–${r1(sr.right)} px; barra ${r1(inner.left)}–${r1(inner.right)} px)`);
    // 3. Logo.
    const logo = sb.querySelector(".brand-logo").getBoundingClientRect();
    if (logo.left < inner.left - 0.5 || logo.right > inner.right + 0.5) problems.push(`logo fora da barra (${r1(logo.left)}–${r1(logo.right)} px; barra ${r1(inner.left)}–${r1(inner.right)} px)`);
    // 4. Nada da barra pintado fora dela (caixas e fragmentos de texto), e o conteúdo começa depois dela.
    let reach = s.right, who = "";
    for (const el of sb.querySelectorAll("*")) for (const r of el.getClientRects()) {
      const v = visible(el, r);
      if (v.right - v.left > 0.5 && v.right > reach + 0.5) { reach = v.right; who = name(el); }
    }
    const walker = document.createTreeWalker(sb, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      const g = document.createRange(); g.selectNodeContents(n);
      for (const r of g.getClientRects()) { const v = visible(n.parentElement, r, true); if (v.right - v.left > 0.5 && v.right > reach + 0.5) { reach = v.right; who = `texto "${n.data.trim().slice(0, 30)}"`; } }
    }
    if (reach > s.right + 0.5) problems.push(`${who} pintado ${r1(reach - s.right)} px além da barra`);
    if (main.left < s.right - 0.5) problems.push(`o conteúdo começa ${r1(s.right - main.left)} px antes do fim da barra`);
    // 5. Malha 3×3 de cada controle da barra e do conteúdo junto dela, na primeira tela: 2 px para dentro, ou mais nos cantos
    //    arredondados (um ponto fora do arco é do pai, não de outro controle); num link que quebra em linhas, a primeira linha.
    const controls = [...sb.querySelectorAll("a[href], select, button")].filter((el) => el.getClientRects().length && !el.closest(".support-card"));
    const near = [...document.querySelectorAll("#main-content :is(a[href], button, select, input:not([type=hidden]), textarea, summary)")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1 && r.top >= 0 && r.bottom <= innerHeight && r.left < s.right + BAND;
    });
    for (const el of [...controls, ...near]) {
      const r = el.getClientRects()[0];
      if (!r || r.bottom < 0 || r.top > innerHeight) continue;
      const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2), d = Math.max(2, Math.ceil(radius * 0.3) + 1);
      const xs = [r.left + d, (r.left + r.right) / 2, r.right - d], ys = [r.top + d, (r.top + r.bottom) / 2, r.bottom - d];
      const byBar = [], byOther = [];
      for (const x of xs) for (const y of ys) {
        if (y < 0 || y > innerHeight - 1 || x < 0 || x > innerWidth - 1) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) continue;
        if (hit && !sb.contains(el) && sb.contains(hit)) byBar.push(name(hit.closest(".nav-item, a, select, button") || hit));
        else if (!hit || hit.closest("a[href], button, select, input, textarea, summary") || !el.contains(hit) && !hit.contains(el)) byOther.push(hit ? name(hit.closest("a[href], button, select, input, textarea, summary, h1, h2, h3, p") || hit) : "nada");
      }
      if (byBar.length) problems.push(`"${name(el)}" coberto pela barra em ${byBar.length} de 9 pontos (${[...new Set(byBar)].join(", ")})`);
      if (byOther.length) problems.push(`"${name(el)}" coberto em ${byOther.length} de 9 pontos (por ${[...new Set(byOther)].join(", ")})`);
    }
    // Pontos para o clique real (6–7): centro dos itens do menu e do Sair; borda esquerda dos controles do conteúdo junto da barra.
    document.querySelectorAll("[data-pr3-alvo]").forEach((el) => el.removeAttribute("data-pr3-alvo"));
    const clicks = [];
    [...sb.querySelectorAll("nav .nav-item"), sb.querySelector('[data-action="logout"]')].filter((el) => el.getClientRects().length).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight - 1) return;
      el.dataset.pr3Alvo = `barra ${clicks.length}`; clicks.push({ id: el.dataset.pr3Alvo, name: name(el), x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    });
    near.filter((el) => el.tagName !== "SELECT" && !el.disabled).forEach((el) => {
      const r = el.getBoundingClientRect();
      el.dataset.pr3Alvo = `conteúdo ${clicks.length}`; clicks.push({ id: el.dataset.pr3Alvo, name: name(el), x: r.left + 2, y: (r.top + r.bottom) / 2 });
    });
    // 8. Ordem visual da barra (de cima para baixo; na mesma linha, da esquerda para a direita) = ordem do DOM.
    const order = controls.map((el) => ({ el, r: el.getBoundingClientRect() }));
    const visual = [...order].sort((a, b) => (Math.abs(a.r.top - b.r.top) > Math.min(a.r.height, b.r.height) / 2 ? a.r.top - b.r.top : a.r.left - b.r.left));
    if (visual.some((v, i) => v.el !== order[i].el)) problems.push(`ordem visual da barra diferente da ordem do teclado: ${visual.map((v) => name(v.el)).join(" › ")}`);
    return { problems, clicks, dom: controls.map(name), width: r1(s.width), root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      scroll: document.documentElement.scrollWidth - innerWidth };
  }, BAND);
}

test("PR3-M1: barra lateral com texto ampliado (768–1440 px, 100–250%, três papéis, fonte do sistema e fonte larga) — rótulos, turma e logo inteiros dentro da barra, nada sobre o conteúdo, cliques e Tab no alvo certo, contorno de foco inteiro", async () => {
  const problems = [];
  const widths = [768, 1024, 1100, 1101, 1200, 1279, 1280, 1440], rings = new Set(["1100-2.5", "1101-2", "1200-1.75", "1279-2.5", "1280-2"]);
  for (const role of ["student", "instructor", "admin"]) for (const font of ["sistema", "larga"]) for (const text of [1, 1.5, 1.75, 2, 2.5]) {
    const { context, page, errors } = await open({ role, width: widths[0], height: 900, text });
    if (font === "larga") await page.addStyleTag({ content: WIDE_FONT });
    await page.evaluate(() => {
      window.__pr3 = [];
      window.addEventListener("click", (e) => { window.__pr3.push(e.target.closest?.("[data-pr3-alvo]")?.dataset.pr3Alvo ?? e.target.tagName.toLowerCase()); e.preventDefault(); e.stopImmediatePropagation(); }, true);
    });
    for (const width of widths) {
      const id = `${role} ${width}×900 texto ${text * 100}% fonte ${font}`;
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(60);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await sidebarCheck(page);
      problems.push(...m.problems.map((p) => `${id}: ${p}`));
      if (width >= 1024 && width <= 1279 && m.scroll > 0) problems.push(`${id}: rolagem lateral da página de ${m.scroll} px`);
      if (text === 1) {
        const expected = width >= 1280 ? 15.25 * m.root : width > 1100 ? 244 : 210;
        if (Math.abs(m.width - expected) > 0.5) problems.push(`${id}: com texto normal a barra tem ${m.width} px (esperado ${expected} px)`);
      }
      // 6–7. Clique real: cada um registrado na captura e cancelado.
      for (const c of m.clicks) {
        await page.evaluate(() => { window.__pr3 = []; });
        await page.mouse.click(c.x, c.y);
        const got = await page.evaluate(() => window.__pr3);
        if (got.length !== 1 || got[0] !== c.id) problems.push(`${id}: o clique em "${c.name}" foi para ${got.join(", ") || "nada"}`);
      }
      // 8. Tab: do "Pular para o conteúdo" até sair da barra, na ordem do DOM (logo, turma, menu, Sair).
      await page.locator(".skip-link").focus();
      const tabs = [];
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press("Tab");
        const [at, brand] = await page.evaluate(() => { const a = document.activeElement; return a.closest(".sidebar") ? [(a.getAttribute("aria-label") || a.querySelector?.(".nav-label")?.textContent || a.textContent || a.id || a.tagName).trim().replace(/\s+/g, " ").slice(0, 40), !!a.closest(".brand")] : [null, false]; });
        if (at === null) { if (tabs.length) break; continue; }
        tabs.push(at);
        // 9. Contorno de foco (pixels) da turma, do menu e do Sair, em parte da matriz (o logo fica de fora, como em A4).
        if (rings.has(`${width}-${text}`) && !brand) {
          // O pior caso: o mouse parado no item de baixo (o fundo do hover dele não pode esconder o contorno deste).
          const below = await page.evaluate(() => { const n = document.activeElement.nextElementSibling; if (!n?.matches(".nav-item")) return null; const r = n.getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; });
          await page.mouse.move(...(below || [0, 0]));
          const ring = await ringAcross(page);
          if (ring.bad.length) problems.push(`${id}: contorno de foco de "${at}" incompleto (${ring.bad.join("; ")})`);
        }
      }
      if (tabs.join(" › ") !== m.dom.join(" › ")) problems.push(`${id}: Tab na barra ${tabs.join(" › ")} (esperado ${m.dom.join(" › ")})`);
    }
    if (errors.length) problems.push(`${role} texto ${text * 100}% fonte ${font}: erros na página: ${errors.join("; ")}`);
    await context.close();
  }
  // 2. Código de turma longo (o formato aceita até 32 caracteres): o seletor, e com ele a barra, ficam com a largura do código
  // mais longo da lista, que aparece inteiro.
  for (const text of [1, 2, 2.5]) {
    const { context, page, errors } = await open({ role: "admin", width: 1100, height: 900, text, codes: ["BRSA0267", "BRSA0267-NOITE-EXTRA"] });
    for (const width of [1100, 1101, 1279]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(60);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await sidebarCheck(page);
      problems.push(...m.problems.map((p) => `admin ${width}×900 texto ${text * 100}% código longo: ${p}`));
    }
    if (errors.length) problems.push(`admin texto ${text * 100}% código longo: erros na página: ${errors.join("; ")}`);
    await context.close();
  }
  assert.deepEqual(problems, [], `${problems.length} problema(s):\n${problems.slice(0, 60).join("\n")}`);
});

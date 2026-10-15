// Expansão 1 do piloto visual: "Minhas atividades" como registro acadêmico (docs/design-visual.md), com API fictícia
// (nunca AWS, Cognito ou Canvas). Cobre o que a tela promete: escopo, módulos com régua de cobertura, linhas em vez de
// cartões, situação por forma/cor/texto, filtros e busca intactos, marca do filtro ativo, estados, texto a 200%, zoom,
// teclado e contorno de foco lido nos pixels, sem rolagem lateral nem controle recortado.
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

let n = 0;
const act = (name, kind, state, percent, module, moduleOrder) => ({ id: `a${++n}`, name, kind, state, percent: percent ?? null, score: percent ?? null, points: "100",
  active: state !== "unreleased", needsReview: state === "completed" && percent != null && percent < (kind === "kc" ? 70 : 95), module, moduleOrder,
  canvasUrl: ["pending", "completed"].includes(state) ? `https://awsrestart.instructure.com/courses/4436/modules/items/${9400 + n}` : null, releasedAt: "2026-09-07T12:00:00Z" });
const activities = [
  act("10- CF - KC — Introdução ao Amazon S3", "kc", "completed", 90, "Introdução ao Cloud Foundations", 6),
  act("11--Lab - Introdução ao Amazon EC2", "lab", "completed", 100, "Introdução ao Cloud Foundations", 6),
  act("12- CF -KC — Introdução ao Amazon EC2", "kc", "completed", 55, "Introdução ao Cloud Foundations", 6),
  act("225--Lab - Introdução ao Linux", "lab", "completed", 100, "Linux", 7),
  act("226-LX-KC - Uma introdução ao Linux", "kc", "completed", 60, "Linux", 7),
  act("227--Lab - Linha de comando do Linux", "lab", "completed", 88.5, "Linux", 7),
  act("254-NF- KC Introdução à rede", "kc", "pending", null, "Redes", 8),
  act("255--Lab - Sub-redes e tabelas de rotas na Amazon VPC", "lab", "completed", 97, "Redes", 8),
  act("119- PF -KC - Introdução ao Python", "kc", "exempt", null, "Programação Python", 10),
  act("195-CERT-KC -Preparação da Certificação do Cenário de Avaliação", "kc", "unreleased", null, "Preparação para certificação", 25),
];
const MODULES = ["Introdução ao Cloud Foundations", "Linux", "Redes", "Programação Python", "Preparação para certificação"];
const student = (list) => ({ id: "1", name: "Maria Teste", email: "maria@example.test", kc: 51.25, lab: 96.38, total: 73.81, status: "attention",
  completed: list.filter((a) => a.state === "completed").length, pending: list.filter((a) => a.state === "pending").length, progress: 87.5, activities: list });
const report = (list = activities) => ({ cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-10T21:04:00Z",
  updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, student: student(list), history: [{ publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 51.25, lab: 96.38, total: 73.81, changes: null }],
  focus: { activityIds: [], version: null } });
// Muitos módulos e títulos longos.
const many = () => { const list = []; for (let m = 1; m <= 8; m++) for (let i = 1; i <= 5; i++) list.push(act(`${m}${i}-MOD${m}-${i % 2 ? "KC" : "Lab"} - Gerenciamento de identidades e acessos com AWS IAM, políticas baseadas em recursos e limites de permissões (${m}.${i})`, i % 2 ? "kc" : "lab", i === 5 ? "pending" : "completed", i === 5 ? null : 60 + i * 8, `Módulo ${m} — Segurança, conformidade e governança na nuvem AWS com práticas recomendadas`, m)); return report(list); };
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

async function open({ width = 1440, height = 900, text = 1, data = () => report(), mode = "ok", role = "student", view = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], control = { mode };
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: 16 * text, fixed: 13 * text } }); }
  await page.addInitScript((view) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
    if (view) localStorage.setItem("avanca.context", JSON.stringify({ owner: "maria@example.test", code: "BRSA0267", view }));
  }, view);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role === "student" ? "maria@example.test" : "instrutor@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) {
      if (control.mode === "hang") return;
      if (control.mode === "error") return route.fulfill({ status: 503, body: "" });
      const r = data();
      return route.fulfill({ json: role === "student" ? r : { ...r, students: [r.student], activities: r.student.activities } });
    }
    throw new Error("endpoint não simulado: " + endpoint);
  });
  await page.goto(origin);
  await (mode === "hang" ? page.locator("[role=status]").first() : mode === "error" ? page.locator("[role=alert]").first() : page.locator(".layout .page-heading h1")).waitFor();
  return { context, page, errors, control };
}
async function toActivities(page) {
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
  await page.getByRole("heading", { name: "Minhas atividades", level: 1 }).waitFor();
}
const clipped = (page, scope) => page.evaluate((scope) => {
  const bad = [];
  for (const el of document.querySelectorAll(`${scope} :is(a, button, summary, select, input)`)) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clip = { left: 0, right: innerWidth };
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { const c = p.getBoundingClientRect(); clip = { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right) }; }
    if (r.left < clip.left - 0.5 || r.right > clip.right + 0.5) bad.push((el.textContent || el.getAttribute("aria-label") || el.id || el.tagName).trim().slice(0, 30));
  }
  return bad;
}, scope);
async function ringOnScreen(page) {
  const box = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return { r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, o: parseFloat(s.outlineOffset), w: parseFloat(s.outlineWidth) }; });
  const { r, o, w } = box, mid = o + w / 2;
  const points = { cima: [r.left + Math.min(10, r.width / 4), r.top - mid], baixo: [r.left + Math.min(10, r.width / 4), r.bottom + mid], esquerda: [r.left - mid, r.top + r.height / 2], direita: [r.right + mid, r.top + r.height / 2] };
  const colors = await colorsAt(page, points);
  return Object.entries(colors).filter(([, c]) => !isRing(c)).map(([k, c]) => `${k}: ${c ? `rgb(${c})` : "fora da tela"}`);
}
const isRing = (c) => !!c && c.every((v, i) => Math.abs(v - RING[i]) <= 45);
async function colorsAt(page, points) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ shot, points }) => {
    const img = new Image(); img.src = "data:image/png;base64," + shot; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, x < 0 || y < 0 || x >= img.width || y >= img.height ? null : [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)]]));
  }, { shot, points });
}

test("B1: a expansão vale só para Minhas atividades do aluno; o histórico tem a própria (Expansão 2) e as telas do instrutor continuam como antes", async () => {
  const { context, page, errors } = await open();
  await toActivities(page);
  assert.equal(await page.locator(".student-activities").count(), 1);
  assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  assert.match(await page.locator(".student-activities .page-heading h1").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
  await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
  await page.getByRole("heading", { name: "Meu histórico", level: 1 }).waitFor();
  assert.equal(await page.locator(".student-activities").count(), 0);
  // Expansão 2: Meu histórico tem o próprio escopo (.student-history, seção 32), não o de Minhas atividades.
  assert.equal(await page.locator(".student-history .page-heading h1").count(), 1, "Meu histórico na Expansão 2");
  assert.deepEqual(errors, []);
  await context.close();
  const teacher = await open({ role: "instructor" });
  assert.equal(await teacher.page.locator(".student-activities").count(), 0);
  await teacher.context.close();
});

test("B2: registro sem painel em volta; módulos na ordem dos dados, com régua de cobertura e situação por forma", async () => {
  const { context, page } = await open();
  await toActivities(page);
  const m = await page.evaluate(() => {
    const panel = getComputedStyle(document.querySelector(".student-activities > .panel"));
    const modules = [...document.querySelectorAll(".student-activities .activity-module")].map((d) => {
      // A forma precisa ter caixa de verdade: pseudo-elemento inline ignora largura e altura e vira um traço "|" de 1px.
      const bar = d.querySelector(".module-progress i"), b = bar && getComputedStyle(bar), flags = [...d.querySelectorAll(".module-meta .badge")].map((f) => { const s = getComputedStyle(f), mark = getComputedStyle(f, "::before"), range = document.createRange(); range.selectNodeContents(f);
        return { text: f.textContent, bg: s.backgroundColor, mark: mark.content !== "none" && mark.content !== "normal", markDisplay: mark.display, textOffset: range.getClientRects()[0].left - f.getBoundingClientRect().left }; });
      return { name: d.querySelector("summary strong").textContent, progress: d.querySelector(".module-progress").textContent.trim(), bar: b && { border: b.borderTopWidth, hidden: bar.getAttribute("aria-hidden"), fill: getComputedStyle(bar.firstElementChild).backgroundColor }, flags };
    });
    const left = (sel) => document.querySelector(sel).getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector(sel)).paddingLeft);
    return { panel: { bg: panel.backgroundColor, border: panel.borderTopWidth }, modules, edges: [".student-activities h1", ".student-activities .update-line", ".student-activities > .grading-help", ".student-activities .table-tools", ".student-activities .activity-module > summary"].map((s) => [s, left(s)]) };
  });
  assert.deepEqual([m.panel.bg, m.panel.border], ["rgba(0, 0, 0, 0)", "0px"], "sem caixa em volta do registro");
  // Um alinhamento só à esquerda: título, atualização, ajuda, filtros e módulos começam na mesma coluna.
  for (const [sel, x] of m.edges) assert.ok(Math.abs(x - m.edges[0][1]) < 1, `${sel} alinhado ao título (${x} × ${m.edges[0][1]})`);
  assert.deepEqual(m.modules.map((x) => x.name), MODULES);
  assert.deepEqual(m.modules.map((x) => x.progress), ["3 de 3 com nota", "3 de 3 com nota", "1 de 2 com nota", "Sem atividades liberadas", "Sem atividades liberadas"]);
  for (const x of m.modules.filter((x) => x.bar)) {
    assert.equal(x.bar.hidden, "true");
    assert.notEqual(x.bar.border, "0px", `${x.name}: régua de cobertura com contorno`);
    assert.notEqual(x.bar.fill, "rgb(0, 175, 232)", `${x.name}: cobertura em cinza neutro, não no ciano de ação`);
  }
  for (const f of m.modules.flatMap((x) => x.flags)) {
    assert.equal(f.bg, "rgba(0, 0, 0, 0)", `"${f.text}" sem selo`);
    assert.ok(f.mark, `"${f.text}" com forma`);
    assert.notEqual(f.markDisplay, "inline", `"${f.text}": forma com caixa, não traço inline`);
    assert.ok(f.textOffset >= 6, `"${f.text}": forma visível antes do texto (${f.textOffset.toFixed(1)}px)`);
  }
  await context.close();
});

test("B3: atividades em linhas (não cartões), sem ícone em caixa, tipo com a cor da série e situação por forma, cor e texto", async () => {
  const { context, page } = await open();
  await toActivities(page);
  const rows = (await page.locator(".student-activities .activity-card").evaluateAll((els) => els.filter((el) => el.closest("details")?.open).map((el) => {
    const s = getComputedStyle(el), tipo = getComputedStyle(el.querySelector("small"), "::before"), status = el.querySelector(".badge, .review-hint"), result = el.querySelector(".activity-result");
    const shape = (node, pseudo = "::before") => { const p = node && getComputedStyle(node, pseudo); return p && p.content !== "none" && p.content !== "normal" ? p.borderTopColor : null; };
    return { name: el.querySelector("strong").textContent, kind: el.querySelector("small").textContent, card: [s.backgroundColor, s.borderLeftWidth, s.borderRightWidth, s.borderRadius].join(" "),
      icon: !!el.querySelector(".activity-symbol")?.getClientRects().length, series: tipo.borderTopColor, link: !!el.querySelector("a.activity-link"), neutral: !!el.querySelector(".badge.exempt, .badge.unreleased"),
      status: status?.textContent || null, statusColor: status && getComputedStyle(status).color, statusShape: shape(status), resultShape: shape(result?.querySelector(".activity-grade")) };
  })));
  assert.ok(rows.length >= 8, `linhas visíveis: ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.card, "rgba(0, 0, 0, 0) 0px 0px 0px", `${r.name}: linha sem caixa`);
    assert.equal(r.icon, false, `${r.name}: sem ícone em caixa`);
    assert.equal(r.series, r.kind === "LABORATÓRIO" ? "rgb(180, 156, 255)" : "rgb(255, 255, 255)", `${r.name}: cor da série`);
    // Só atividades liberadas (sem nota ou com nota) têm link do Canvas; dispensada e não liberada, não.
    assert.equal(r.link, !r.neutral, `${r.name}: link do Canvas na própria linha`);
  }
  const by = (name) => rows.find((r) => r.name === name);
  assert.deepEqual([by("254-NF- KC Introdução à rede").status, by("254-NF- KC Introdução à rede").statusColor], ["Sem nota", "rgb(242, 184, 75)"]);
  assert.ok(by("254-NF- KC Introdução à rede").statusShape, "sem nota: forma");
  assert.deepEqual([by("226-LX-KC - Uma introdução ao Linux").status, by("226-LX-KC - Uma introdução ao Linux").statusColor], ["Sugestão de revisão", "rgb(242, 184, 75)"]);
  assert.ok(by("226-LX-KC - Uma introdução ao Linux").statusShape, "revisão: forma");
  assert.equal(by("225--Lab - Introdução ao Linux").resultShape, "rgb(0, 235, 210)", "na referência: visto verde-água");
  // Dispensada e não liberada aparecem pelos filtros: texto em cinza, com forma neutra.
  for (const [filter, text] of [["exempt", "Dispensada"], ["unreleased", "Não liberada"]]) {
    await page.locator(`.student-activities [data-filter="${filter}"]`).click();
    const s = await page.locator(".student-activities .activity-card .badge").first().evaluate((el) => ({ text: el.textContent, color: getComputedStyle(el).color, shape: getComputedStyle(el, "::before").content !== "none" }));
    assert.deepEqual(s, { text, color: "rgb(185, 203, 218)", shape: true }, filter);
  }
  await context.close();
});

test("B4: filtros, busca, seleção, módulos abertos/fechados e limpar filtros funcionam como antes; marca no filtro ativo", async () => {
  const { context, page } = await open();
  await toActivities(page);
  const count = () => page.locator(".student-activities .count-chip").innerText();
  assert.equal(await count(), "10 atividades");
  await page.locator('.student-activities [data-filter="pending"]').click();
  assert.equal(await page.locator('.student-activities [data-filter="pending"]').getAttribute("aria-pressed"), "true");
  assert.equal(await count(), "1 atividade");
  const marks = await page.locator(".student-activities .tab").evaluateAll((els) => els.map((el) => ({ pressed: el.getAttribute("aria-pressed"), mark: getComputedStyle(el, "::after").content !== "none" && getComputedStyle(el, "::after").backgroundColor === "rgb(0, 175, 232)" })));
  assert.ok(marks.every((t) => (t.pressed === "true") === t.mark), `marca só no filtro ativo: ${JSON.stringify(marks)}`);
  await page.locator('.student-activities [data-filter="all"]').click();
  await page.getByLabel("Buscar atividade").fill("linux");
  await page.waitForTimeout(100);
  assert.equal(await count(), "3 atividades");
  await page.getByLabel("Buscar atividade").fill("zzz");
  await page.waitForTimeout(100);
  // 3.4: a busca sem resultado tem texto próprio, com o termo (B9).
  assert.match(await page.locator(".student-activities #activity-list").innerText(), /Nenhuma atividade encontrada para “zzz”/);
  await page.locator('.student-activities [data-action="clear-filters"]').click();
  assert.equal(await count(), "10 atividades");
  await page.locator("#activity-kind").selectOption("lab");
  assert.equal(await count(), "4 atividades");
  await page.locator("#activity-kind").selectOption("all");
  await page.locator("#activity-module").selectOption("Redes");
  assert.equal(await count(), "2 atividades");
  await page.locator("#activity-module").selectOption("all");
  // Módulo fechado abre pelo teclado.
  const closed = page.locator(".student-activities .activity-module:not([open]) > summary").first();
  await closed.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".student-activities .activity-module").nth(3).getAttribute("open"), "");
  await context.close();
});

test("B5: sem rolagem lateral nem controle recortado em 320–1440 px, com texto a 200%, zoom a 200%, muitos módulos e títulos longos", async () => {
  for (const o of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 390, height: 844, text: 2 }, { width: 320, height: 640, text: 2 },
    { width: 640, height: 400 }, { width: 390, height: 844, data: many }, { width: 1440, height: 900, data: many }]) {
    const { context, page } = await open(o);
    await toActivities(page);
    await page.locator(".student-activities .activity-module").evaluateAll((ds) => ds.forEach((d) => { d.open = true; }));
    const label = `${o.width}×${o.height}${o.text ? " texto 200%" : ""}${o.data ? " muitos módulos" : ""}`;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: rolagem lateral`);
    assert.deepEqual(await clipped(page, ".student-activities"), [], `${label}: controles recortados`);
    const tabs = await page.locator(".student-activities .tab").evaluateAll((els) => els.every((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; }));
    assert.ok(tabs, `${label}: todos os filtros visíveis e inteiros`);
    // Cobertura do módulo: se o texto precisa quebrar, a régua desce para baixo dele em vez de ficar ao lado, longe.
    const beside = await page.evaluate(() => [...document.querySelectorAll(".student-activities .module-progress")].filter((p) => {
      const bar = p.querySelector("i"); if (!bar) return false;
      const range = document.createRange(); range.selectNodeContents(p.firstChild);
      const rects = [...range.getClientRects()], lines = new Set(rects.map((r) => Math.round(r.top))).size;
      return lines > 1 && bar.getBoundingClientRect().top < Math.max(...rects.map((r) => r.bottom)) - 1;
    }).map((p) => p.textContent));
    assert.deepEqual(beside, [], `${label}: régua ao lado de texto quebrado`);
    // No celular, tipo, módulo e busca empilham na largura toda da barra (alvo grande, sem campo espremido).
    if (o.width <= 600) {
      const widths = await page.evaluate(() => ["#activity-kind", "#activity-module", "#search"].map((s) => { const el = document.querySelector(`.student-activities ${s}`), box = el.closest(".table-tools"), cs = getComputedStyle(box);
        return [s, el.getBoundingClientRect().width, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)]; }));
      for (const [s, w, full] of widths) assert.ok(Math.abs(w - full) <= 1, `${label}: ${s} na largura toda (${w} × ${full})`);
      // A ação "Consultar atualização" desce para a esquerda: o texto dela começa na coluna do título.
      const [btn, h1] = await page.evaluate(() => [".student-activities .update-line .button", ".student-activities h1"].map((s) => { const el = document.querySelector(s); return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft); }));
      assert.ok(Math.abs(btn - h1) < 1, `${label}: ação da atualização fora da coluna (${btn} × ${h1})`);
    }
    await context.close();
  }
});

test("B6: teclado na ordem visual e contorno de foco inteiro (pixels) em filtros, busca, módulo e link do Canvas", async () => {
  for (const o of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await open(o);
    await toActivities(page);
    for (const sel of ['.student-activities [data-filter="review"]', ".student-activities #search", ".student-activities .activity-module > summary", ".student-activities a.activity-link"]) {
      await page.locator(sel).first().focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      assert.deepEqual(await ringOnScreen(page), [], `${o.width}px ${sel}: contorno incompleto`);
    }
    // Os filtros se encostam: o contorno fica dentro do próprio filtro e não pinta o vizinho (o padrão é 3 px por fora).
    await page.locator('.student-activities [data-filter="review"]').focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); return { left: b.left, right: b.right, y: b.top + b.height / 2 }; });
    const outside = await colorsAt(page, { esquerda: [r.left - 4.5, r.y], direita: [r.right + 4.5, r.y] });
    assert.deepEqual(Object.entries(outside).filter(([, c]) => isRing(c)).map(([k]) => k), [], `${o.width}px: contorno do filtro invade o vizinho`);
    // Ordem: tipo, módulo, filtros, busca, primeiro módulo — e a tela mostra na mesma ordem (linha a linha, da esquerda
    // para a direita), sem reordenação visual.
    await page.locator("#activity-kind").focus();
    const order = [], boxes = [];
    for (let i = 0; i < 10; i++) {
      // Coordenadas do documento: o foco rola a página entre um passo e outro.
      const [id, box] = await page.evaluate(() => { const a = document.activeElement, b = a.getBoundingClientRect(); return [a.id || a.dataset.filter || a.tagName, { left: b.left + scrollX, right: b.right + scrollX, top: b.top + scrollY, bottom: b.bottom + scrollY }]; });
      order.push(id); boxes.push([id, box]);
      await page.keyboard.press("Tab");
    }
    assert.deepEqual(order, ["activity-kind", "activity-module", "all", "pending", "review", "completed", "unreleased", "exempt", "search", "SUMMARY"], `${o.width}px: ordem do teclado`);
    for (let i = 1; i < boxes.length; i++) {
      const [pa, a] = boxes[i - 1], [pb, b] = boxes[i], sameRow = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < Math.min(a.bottom - a.top, b.bottom - b.top) / 2;
      assert.ok(sameRow ? b.left >= a.right - 1 : b.top >= a.bottom - 1, `${o.width}px: ${pb} aparece antes de ${pa} na tela`);
    }
    await context.close();
  }
});

test("B7: carregamento, erro recuperável e lista vazia usam a composição da tela, com os mesmos papéis acessíveis", async () => {
  const { context, page, control } = await open();
  await toActivities(page);
  control.mode = "error";
  await page.locator('[data-action="refresh-report"]').first().click();
  const alert = page.locator("[role=alert]").filter({ hasText: "Não foi possível carregar" }).first();
  await alert.waitFor();
  // Erro dentro do escopo da tela, com a borda de alerta (as outras bordas são linha fina).
  const err = await alert.evaluate((el) => { const s = getComputedStyle(el); return { scoped: !!el.closest(".student-activities"), left: s.borderLeftWidth, accent: s.borderLeftColor !== s.borderTopColor }; });
  assert.deepEqual(err, { scoped: true, left: "3px", accent: true }, "erro na composição da tela");
  control.mode = "ok";
  await alert.getByRole("button", { name: "Tentar novamente" }).click();
  await page.getByRole("heading", { name: "Minhas atividades", level: 1 }).waitFor();
  assert.equal(await page.locator(".student-activities .activity-module").count(), 5);
  await context.close();
  // 3.3: relatório sem atividades tem texto próprio e não oferece "Limpar filtros" (não resolveria); o filtro sem
  // resultado continua com o texto e a ação de antes (B4, B9).
  const empty = await open({ data: () => report([]) });
  await toActivities(empty.page);
  assert.equal((await empty.page.locator(".student-activities #activity-list").innerText()).trim(), "Ainda não há atividades nesta publicação.");
  assert.equal(await empty.page.locator('.student-activities [data-action="clear-filters"]').count(), 0);
  // Sem moldura e alinhados à esquerda, com o registro (a base centraliza num bloco alto).
  const frame = (el) => { const s = getComputedStyle(el); return { scoped: !!el.closest(".student-activities"), border: s.borderTopWidth, bg: s.backgroundColor, align: s.textAlign }; };
  assert.deepEqual(await empty.page.locator(".student-activities #activity-list > .empty").evaluate(frame), { scoped: true, border: "0px", bg: "rgba(0, 0, 0, 0)", align: "left" }, "lista vazia sem moldura");
  await empty.context.close();
  // Carregamento: a tela de atividades aberta (contexto salvo) enquanto o relatório ainda não chegou.
  const loading = await open({ mode: "hang", view: "activities" });
  const status = loading.page.locator("[role=status]").filter({ hasText: "Carregando sua turma…" }).first();
  await status.waitFor();
  assert.equal(await status.innerText(), "Carregando sua turma…");
  assert.deepEqual(await status.evaluate(frame), { scoped: true, border: "0px", bg: "rgba(0, 0, 0, 0)", align: "left" }, "carregamento na composição da tela, sem moldura");
  await loading.context.close();
});

// 3.4.1: com largura (linha de pelo menos 40rem, que acompanha o texto), o link do Canvas fica numa coluna própria logo
// depois do título, alinhado à última linha dele, na altura do tipo + título: a linha não cresce (densidade da 3.3) e a
// caixa real de 44 px não cobre nada — nem o texto da linha (na 3.3 o clique no título longo abria o Canvas), nem outros
// controles — e o contorno de foco fica dentro da linha. O título tem no máximo 36rem, e o link de títulos longos fica
// sempre na mesma posição, longe da nota. Linhas estreitas (tablet, texto ampliado) e o celular: link na própria linha.
test("B8: link do Canvas ao lado do título quando há largura, sem sobrepor nada; senão na própria linha", async () => {
  for (const o of [{ width: 1440, height: 900, wide: true }, { width: 1280, height: 800, wide: true }, { width: 1024, height: 768, wide: true }, { width: 1440, height: 900, data: many, wide: true },
    { width: 768, height: 1024 }, { width: 768, height: 1024, data: many }, { width: 768, height: 1024, text: 2 }, { width: 1440, height: 900, text: 2 }, { width: 390, height: 844 }, { width: 320, height: 640 },
    { width: 390, height: 844, text: 2 }, { width: 320, height: 640, text: 2 }]) {
    const { context, page } = await open(o);
    await toActivities(page);
    await page.locator(".student-activities .activity-module").evaluateAll((ds) => ds.forEach((d) => { d.open = true; }));
    const label = `${o.width}×${o.height}${o.text ? " texto 200%" : ""}${o.data ? " títulos longos" : ""}`;
    const rows = await page.evaluate(() => {
      const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const textRects = (el) => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.data.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); out.push(...r.getClientRects()); } return out; };
      const controls = [...document.querySelectorAll(":is(a, button, summary, select, input)")];
      return [...document.querySelectorAll(".student-activities .activity-card")].filter((card) => card.querySelector("a.activity-link")).map((card) => {
        const link = card.querySelector("a.activity-link"), title = card.querySelector("strong"), result = card.querySelector(".activity-result, .activity-card > .badge");
        // elementFromPoint só enxerga a janela: cada linha é medida no meio dela.
        card.scrollIntoView({ block: "center" });
        const titleLines = textRects(title), last = titleLines.at(-1), b = link.getBoundingClientRect(), c = card.getBoundingClientRect(), t = textRects(link)[0];
        const ring = { left: b.left - 6, right: b.right + 6, top: b.top - 6, bottom: b.bottom + 6 };
        const hit = (x, y) => document.elementFromPoint(x, y)?.closest("a.activity-link") === link;
        const height = c.height; link.style.display = "none"; const without = card.getBoundingClientRect().height; link.style.display = "";
        return { name: title.textContent, box: b.height, left: Math.round(b.left), clickable: hit(b.left + b.width / 2, b.top + 2) && hit(b.left + b.width / 2, b.bottom - 2) && hit(b.left + 2, b.top + b.height / 2),
          added: height - without, oneLineLabel: textRects(link).length === 1,
          besideTitle: titleLines.every((r) => r.right <= b.left + 0.5) && Math.abs((t.top + t.bottom) / 2 - (last.top + last.bottom) / 2) < 4,
          ownLine: b.top >= last.bottom - 1 && Math.abs(b.left - titleLines[0].left) <= 1,
          coversText: [...card.querySelectorAll("small, strong, .badge, .review-hint")].flatMap(textRects).some((r) => inter(b, r) > 1),
          coversControl: controls.some((el) => el !== link && el.getClientRects().length && inter(b, el.getBoundingClientRect()) > 1),
          titleClickOpensLink: titleLines.some((r) => inter(b, r) > 1 && hit(Math.max(r.left, b.left) + 1, Math.max(r.top, b.top) + 1)),
          ringInside: ring.top >= c.top - 0.5 && ring.bottom <= c.bottom + 0.5, insideCard: b.left >= c.left - 0.5 && b.right <= c.right + 0.5,
          gapToResult: result ? result.getBoundingClientRect().left - b.right : Infinity, titleInside: titleLines.every((r) => r.left >= c.left - 0.5 && r.right <= c.right + 0.5),
          textOverflow: getComputedStyle(title).textOverflow, href: link.href, target: link.target, rel: link.rel };
      });
    });
    assert.ok(rows.length >= 7, `${label}: linhas com link (${rows.length})`);
    for (const r of rows) {
      const id = `${label} "${r.name.slice(0, 30)}"`;
      assert.ok(r.box >= 44 && r.clickable, `${id}: área do link com ${r.box} px, inteira clicável (${r.clickable})`);
      assert.ok(!r.coversText && !r.coversControl && !r.titleClickOpensLink, `${id}: a caixa do link cobre texto ou controle`);
      assert.ok(r.insideCard && r.titleInside, `${id}: link e título dentro da linha`);
      assert.notEqual(r.textOverflow, "ellipsis", `${id}: título truncado`);
      if (o.wide) {
        assert.ok(r.besideTitle, `${id}: link fora da coluna ao lado do título`);
        assert.ok(r.oneLineLabel, `${id}: rótulo do link quebrado na coluna ao lado do título`);
        assert.ok(r.added <= 4, `${id}: o link acrescenta ${r.added.toFixed(1)} px à linha`);
        assert.ok(r.ringInside, `${id}: contorno de foco sai da linha`);
        assert.ok(r.gapToResult >= 48, `${id}: link encostado na nota (${Math.round(r.gapToResult)} px)`);
      } else assert.ok(r.ownLine, `${id}: link fora da própria linha (abaixo do título, na coluna dele)`);
    }
    // Títulos longos: o link fica sempre na mesma posição.
    if (o.wide && o.data) assert.equal(new Set(rows.map((r) => r.left)).size, 1, `${label}: links em posições diferentes`);
    // A nota e a situação ficam na borda da linha (à direita no desktop, na coluna do título no celular).
    const edges = await page.evaluate(() => [...document.querySelectorAll(".student-activities .activity-card")].filter((c) => c.getClientRects().length).map((card) => {
      const c = card.getBoundingClientRect(), s = getComputedStyle(card), status = card.querySelector(".activity-grade, .activity-card > .badge, .review-hint"), r = status.getBoundingClientRect();
      return { name: card.querySelector("strong").textContent, right: c.right - parseFloat(s.paddingRight) - r.right, left: r.left - (c.left + parseFloat(s.paddingLeft)) };
    }));
    for (const x of edges) assert.ok(Math.abs(o.width > 600 ? x.right : x.left) <= 1, `${label} "${x.name}": nota/situação fora da borda (${(o.width > 600 ? x.right : x.left).toFixed(1)} px)`);
    // Destino e comportamento do link preservados.
    const first = rows.find((r) => r.name === "10- CF - KC — Introdução ao Amazon S3");
    if (first) assert.deepEqual([first.href, first.target, first.rel], ["https://awsrestart.instructure.com/courses/4436/modules/items/9401", "_blank", "noopener noreferrer"]);
    // Clique real do mouse nas bordas de cima e de baixo da caixa: abre o Canvas (a requisição sai; o teste a bloqueia).
    if (!o.data && !o.text) for (const edge of ["top", "bottom"]) {
      const link = page.locator(".student-activities a.activity-link").first();
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      const [request] = await Promise.all([context.waitForEvent("request", (r) => r.url().startsWith("https://awsrestart.instructure.com/")), page.mouse.click(box.x + box.width / 2, edge === "top" ? box.y + 3 : box.y + box.height - 3)]);
      assert.equal(request.url(), "https://awsrestart.instructure.com/courses/4436/modules/items/9401", `${label}: clique na borda ${edge === "top" ? "de cima" : "de baixo"}`);
      for (const p of context.pages()) if (p !== page) await p.close();
    }
    await context.close();
  }
});

// 3.4: lista vazia em três cenários, cada um com o próprio texto: a turma sem nenhuma atividade (nenhum filtro resolve:
// sem botão), filtro sem resultado e busca sem resultado (com o termo buscado). O botão diz o que vai limpar ("Limpar
// filtros", "Limpar busca", "Limpar busca e filtros"); a ação é a mesma de antes. Carregamento e erro não viram lista vazia.
test("B9: lista vazia em três cenários — turma sem atividades, filtro sem resultado, busca sem resultado", async () => {
  const NONE = "Ainda não há atividades nesta publicação.", FILTER = "Nenhuma atividade encontrada neste filtro.";
  const empty = (page) => page.locator(".student-activities #activity-list > .empty").evaluate((el) => ({ text: el.querySelector("p").textContent, button: el.querySelector('[data-action="clear-filters"]')?.textContent.trim() || null }));
  const count = (page) => page.locator(".student-activities .count-chip").innerText();
  const search = async (page, value) => { await page.getByLabel("Buscar atividade").fill(value); await page.waitForTimeout(100); };
  // Turma sem atividades: filtros e busca não resolvem.
  const a = await open({ data: () => report([]) });
  await toActivities(a.page);
  assert.deepEqual(await empty(a.page), { text: NONE, button: null });
  await a.page.locator('.student-activities [data-filter="pending"]').click();
  await search(a.page, "linux");
  assert.deepEqual(await empty(a.page), { text: NONE, button: null }, "sem atividades, com filtro e busca");
  await a.context.close();
  const b = await open();
  await toActivities(b.page);
  // Filtro sem resultado: filtros preservados; "Limpar filtros" resolve.
  await b.page.locator("#activity-kind").selectOption("lab");
  await b.page.locator('.student-activities [data-filter="pending"]').click();
  assert.deepEqual(await empty(b.page), { text: FILTER, button: "Limpar filtros" });
  assert.deepEqual([await b.page.locator("#activity-kind").inputValue(), await b.page.locator('.student-activities [data-filter="pending"]').getAttribute("aria-pressed")], ["lab", "true"], "filtros preservados");
  await b.page.locator('.student-activities [data-action="clear-filters"]').click();
  assert.equal(await count(b.page), "10 atividades");
  // Busca sem resultado: o termo aparece; "Limpar busca" resolve.
  await search(b.page, "zzz");
  assert.deepEqual(await empty(b.page), { text: "Nenhuma atividade encontrada para “zzz”.", button: "Limpar busca" });
  assert.equal(await b.page.getByLabel("Buscar atividade").inputValue(), "zzz", "busca preservada");
  await b.page.locator('.student-activities [data-action="clear-filters"]').click();
  assert.deepEqual([await count(b.page), await b.page.getByLabel("Buscar atividade").inputValue()], ["10 atividades", ""]);
  // Busca e filtros juntos sem resultado.
  await b.page.locator("#activity-kind").selectOption("lab");
  await b.page.locator('.student-activities [data-filter="pending"]').click();
  await search(b.page, "linux");
  assert.deepEqual(await empty(b.page), { text: "Nenhuma atividade encontrada para “linux” com os filtros selecionados.", button: "Limpar busca e filtros" });
  await b.page.locator('.student-activities [data-action="clear-filters"]').click();
  assert.deepEqual([await count(b.page), await b.page.getByLabel("Buscar atividade").inputValue(), await b.page.locator("#activity-kind").inputValue(), await b.page.locator('.student-activities [data-filter="all"]').getAttribute("aria-pressed")], ["10 atividades", "", "all", "true"]);
  // Busca só com espaços: quem esvaziou a lista foi a busca, não um filtro.
  await search(b.page, "   ");
  assert.deepEqual(await empty(b.page), { text: "Nenhuma atividade encontrada para “   ”.", button: "Limpar busca" });
  // O termo é texto (não HTML).
  await search(b.page, "<b>zz</b>");
  assert.deepEqual(await empty(b.page), { text: "Nenhuma atividade encontrada para “<b>zz</b>”.", button: "Limpar busca" });
  assert.equal(await b.page.locator(".student-activities #activity-list b").count(), 0);
  await b.context.close();
  // Termo longo, sem espaços, no celular com texto a 200%: quebra dentro da tela.
  const narrow = await open({ width: 320, height: 640, text: 2 });
  await toActivities(narrow.page);
  await search(narrow.page, "x".repeat(60));
  assert.ok(await narrow.page.evaluate(() => { const p = document.querySelector(".student-activities #activity-list > .empty p").getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && p.right <= innerWidth; }), "termo longo dentro da tela");
  await narrow.context.close();
  // Carregamento e erro não são lista vazia.
  const loading = await open({ mode: "hang", view: "activities" });
  assert.doesNotMatch(await loading.page.locator("main").innerText(), /Ainda não há atividades nesta publicação|Nenhuma atividade encontrada/);
  await loading.context.close();
  const failed = await open({ mode: "error", view: "activities" });
  assert.doesNotMatch(await failed.page.locator("main").innerText(), /Ainda não há atividades nesta publicação|Nenhuma atividade encontrada/);
  assert.equal(await failed.page.locator(".student-activities #activity-list").count(), 0);
  await failed.context.close();
});

// 3.3 — erro: a tela continua identificada (título "Minhas atividades", turma no topo e no seletor), com a mensagem, a
// ação de tentar de novo e o foco da C7.1. O relatório é zerado a cada carga (C7.4); os filtros e a busca, não.
test("B10: com erro, Minhas atividades mantém título, turma, mensagem, Tentar novamente, foco e filtros", async () => {
  const { context, page, control, errors } = await open();
  await toActivities(page);
  await page.locator('.student-activities [data-filter="pending"]').click();
  await page.getByLabel("Buscar atividade").fill("rede");
  await page.waitForTimeout(100);
  control.mode = "error";
  await page.locator('.student-activities [data-action="refresh-report"]').click();
  const alert = page.locator("[role=alert]").filter({ hasText: "Não foi possível carregar" });
  await alert.waitFor();
  const shown = await page.evaluate(() => ({ h1: [...document.querySelectorAll("main h1")].map((h) => h.textContent), scoped: !!document.querySelector("main h1")?.closest(".student-activities"),
    beforeAlert: !!(document.querySelector("main h1")?.compareDocumentPosition(document.querySelector("[role=alert]")) & Node.DOCUMENT_POSITION_FOLLOWING),
    topline: document.querySelector(".topline .location-context").innerText.replace(/\s+/g, " "), cohort: document.querySelector("#cohort").value, focused: document.activeElement.textContent.trim() }));
  assert.deepEqual(shown.h1, ["Minhas atividades"], "título da tela no erro");
  assert.ok(shown.scoped && shown.beforeAlert, "título na composição da tela, antes do alerta");
  assert.match(shown.topline, /Turma BRSA0267.*Minhas atividades/);
  assert.equal(shown.cohort, "BRSA0267");
  assert.equal(shown.focused, "Tentar novamente", "foco no Tentar novamente (mesma ação que falhou), como antes");
  assert.equal(await alert.getByRole("heading", { level: 2 }).innerText(), "Não foi possível carregar");
  // Tentar novamente com sucesso: lista de volta, com o filtro e a busca de antes.
  control.mode = "ok";
  await alert.getByRole("button", { name: "Tentar novamente" }).click();
  await page.locator(".student-activities .activity-module").first().waitFor();
  assert.equal(await page.locator('.student-activities [data-filter="pending"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByLabel("Buscar atividade").inputValue(), "rede");
  assert.equal(await page.locator(".student-activities .count-chip").innerText(), "1 atividade");
  // Troca de tela pelo teclado com o erro ativo: sem relatório, a troca recarrega (loadReport); o foco fica no <main>
  // depois da carga (C7.1), como antes, e a tela de erro continua com o título.
  control.mode = "error";
  await page.locator('.student-activities [data-action="refresh-report"]').click();
  await alert.waitFor();
  await page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
  await page.locator("[role=alert]").first().waitFor();
  await page.getByRole("button", { name: "Minhas atividades", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.locator(".student-activities [role=alert]").waitFor();
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, [...document.querySelectorAll("main h1")].map((h) => h.textContent)]), ["main-content", ["Minhas atividades"]]);
  assert.deepEqual(errors, []);
  await context.close();
  // Erro já na abertura, com a tela salva em Minhas atividades: título presente e foco no <main> (C7.1), como antes.
  const boot = await open({ mode: "error", view: "activities" });
  assert.deepEqual(await boot.page.evaluate(() => [[...document.querySelectorAll("main h1")].map((h) => h.textContent), document.activeElement.id]), [["Minhas atividades"], "main-content"]);
  await boot.context.close();
});

// 3.3 — filtros no celular: os seis continuam visíveis (sem rolagem lateral, sem select, sem menu oculto), em até duas
// linhas com texto normal em 320 e 390 px, com a fonte e a área de 44 px de antes; seleção, combinação, sem resultado
// e limpar filtros funcionam; ordem visual = ordem do teclado; contorno de foco inteiro.
test("B11: no celular os filtros de situação ficam visíveis em até duas linhas, sem rolagem lateral, e funcionam como antes", async () => {
  for (const o of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 320, height: 640, text: 2 }, { width: 390, height: 844, text: 2 }]) {
    const { context, page } = await open(o);
    await toActivities(page);
    const label = `${o.width}×${o.height}${o.text ? " texto 200%" : ""}`;
    const m = await page.evaluate(() => {
      const group = document.querySelector(".student-activities .tabs"), tabs = [...group.querySelectorAll(".tab")], rs = tabs.map((t) => t.getBoundingClientRect());
      const order = tabs.map((t, i) => [t.dataset.filter, rs[i]]).sort(([, a], [, b]) => (Math.abs(a.top - b.top) > 1 ? a.top - b.top : a.left - b.left)).map(([f]) => f);
      return { count: tabs.length, lines: new Set(rs.map((r) => Math.round(r.top))).size, inside: rs.every((r) => r.left >= 0 && r.right <= innerWidth && r.width > 0), minH: Math.min(...rs.map((r) => r.height)), minW: Math.min(...rs.map((r) => r.width)),
        font: parseFloat(getComputedStyle(tabs[0]).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize), overflow: getComputedStyle(group).overflowX, cut: tabs.some((t) => t.scrollWidth > t.clientWidth + 1),
        pageX: document.documentElement.scrollWidth - innerWidth, order, dom: tabs.map((t) => t.dataset.filter), select: !!document.querySelector(".student-activities .tabs select, .student-activities select[aria-label='Filtrar atividades']") };
    });
    assert.equal(m.count, 6, `${label}: seis filtros`);
    assert.ok(m.inside && !m.cut && m.pageX <= 0 && m.overflow === "visible", `${label}: filtros inteiros na tela, sem rolagem lateral`);
    assert.equal(m.select, false, `${label}: sem select no lugar dos filtros`);
    assert.ok(m.minH >= 44 && m.minW >= 44, `${label}: área de toque ${m.minW}×${m.minH}`);
    assert.ok(Math.abs(m.font - 0.875) < 0.01, `${label}: fonte dos filtros ${m.font}rem`);
    assert.deepEqual(m.order, m.dom, `${label}: ordem visual = ordem do teclado`);
    if (!o.text) assert.ok(m.lines <= 2, `${label}: filtros em ${m.lines} linhas`);
    // A marca do filtro ativo acompanha o recuo do texto (começa e termina onde o rótulo começa e termina).
    const mark = await page.locator('.student-activities .tab[aria-pressed="true"]').evaluate((el) => { const s = getComputedStyle(el), a = getComputedStyle(el, "::after"); return [a.left, a.right, s.paddingLeft, s.paddingRight]; });
    assert.deepEqual(mark.slice(0, 2), mark.slice(2), `${label}: marca do filtro ativo fora do recuo do texto`);
    // Seleção, combinação, sem resultado e limpar.
    const review = page.locator('.student-activities [data-filter="review"]');
    await review.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.deepEqual(await ringOnScreen(page), [], `${label}: contorno do filtro`);
    await page.keyboard.press("Enter");
    assert.equal(await review.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".student-activities .count-chip").innerText(), "3 atividades");
    await page.locator('.student-activities [data-filter="pending"]').click();
    assert.equal(await page.locator(".student-activities .count-chip").innerText(), "1 atividade");
    await page.locator("#activity-kind").selectOption("lab");
    assert.match(await page.locator(".student-activities #activity-list").innerText(), /Nenhuma atividade encontrada neste filtro/);
    const clear = page.locator('.student-activities [data-action="clear-filters"]');
    assert.equal(await clear.count(), 1);
    await clear.click();
    assert.equal(await page.locator(".student-activities .count-chip").innerText(), "10 atividades");
    assert.equal(await page.locator('.student-activities [data-filter="all"]').getAttribute("aria-pressed"), "true");
    await context.close();
  }
});

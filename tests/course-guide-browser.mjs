// Guia real servido sob prefixo versionado; APIs e identidades fictícias. Não abre serviços externos.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist"), prefix = "/releases/guide-test-release/";
const mime = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".pdf": "application/pdf" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1);
  const file = path.resolve(root, relative || "index.html");
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
const code = "TURMA-TESTE", email = (role) => `${role}@example.test`;
const report = { cohort: code, publication: { id: "p-test", publishedAt: "2026-10-10T21:00:00Z" }, updatedAt: "2026-10-10T21:00:00Z", updateKind: "canvas", thresholds: { kc: 70, lab: 95 },
  student: { id: "101", name: "Aluna de Teste", email: "aluna@example.test", kc: 80, lab: 100, status: "ok", completed: 0, pending: 0, progress: 0, activities: [] },
  students: [], activities: [], history: [], focus: { activityIds: [], version: null } };
let browser, origin;
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); await new Promise((r) => server.close(r)); });
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function open({ role = "student", cohorts = true, mode = "ok", savedGuide = false, studentView = false, signedIn = true, width = 1440, height = 900, text = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage(), calls = [], errors = [], external = [], feedbackPosts = [];
  let finish; const held = new Promise((r) => { finish = r; });
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) { const cdp = await context.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * text), fixed: Math.round(13 * text) } }); }
  await page.addInitScript(({ role, code, savedGuide, studentView, signedIn }) => {
    if (signedIn) localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "fake-test-only", expires: Date.now() + 3600000 }));
    if (savedGuide) localStorage.setItem("avanca.context", JSON.stringify({ owner: `${role}@example.test`, code: "", view: "course-guide", guideTab: "support" }));
    if (studentView && !sessionStorage.getItem("avanca.student-view")) sessionStorage.setItem("avanca.student-view", JSON.stringify({ owner: `${role}@example.test`, code, studentId: "101", view: "overview" }));
  }, { role, code, savedGuide, studentView, signedIn });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.endsWith("/config.json")) return route.fulfill({ json: { apiUrl: origin + "/api", authDomain: "https://auth.example.test", userPoolClientId: "test-client", redirectUri: origin + prefix, logoutUri: origin + prefix, scopes: "openid email" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4); calls.push(`${request.method()} ${endpoint}`);
    if (endpoint === "/me") return route.fulfill({ json: { roles: role === "admin" ? ["admin", "instructor"] : [role], email: email(role) } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: cohorts ? [{ code, canTeach: role !== "student", autoSync: true }, { code: code + "-2", canTeach: role !== "student", autoSync: true }] : [] } });
    if (endpoint.endsWith("/report")) {
      if (mode === "loading") await held;
      if (mode === "error" || mode === "unpublished") return route.fulfill({ status: mode === "error" ? 500 : 404, json: { error: mode === "error" ? "Falha fictícia do relatório." : "Nenhuma publicação." } });
      return route.fulfill({ json: report });
    }
    if (endpoint === "/feedback") {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); feedbackPosts.push(body);
        return route.fulfill({ json: { feedback: { id: "feedback-test", ...body, status: "NEW", createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z" }, duplicate: false } });
      }
      return route.fulfill({ json: { items: [], nextCursor: null } });
    }
    if (endpoint.endsWith("/student-view")) return route.fulfill({ json: { ...report, viewAs: { studentId: "101", name: "Aluna de Teste" } } });
    return route.fulfill({ status: 404, json: { error: "Rota não simulada." } });
  });
  await page.goto(origin + prefix + (studentView ? "?modo=visualizar-aluno" : ""));
  if (signedIn) await page.getByRole("button", { name: "Guia do curso", exact: true }).waitFor();
  return { page, context, calls, errors, external, feedbackPosts, release: finish, close: async () => { finish(); await context.close(); } };
}
async function guide(page) {
  await page.getByRole("button", { name: "Guia do curso", exact: true }).click();
  await page.getByRole("heading", { name: "Guia do curso", exact: true, level: 1 }).waitFor();
  await settle(page);
}
const active = (page) => page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-guide-tab");

test("menu único acessível nos três perfis e retorno à tela acadêmica sem chamadas para o guia", async () => {
  for (const role of ["student", "instructor", "admin"]) {
    const c = await open({ role });
    await c.page.locator(".page-heading h1").waitFor(); await settle(c.page);
    const before = [...c.calls];
    assert.equal(await c.page.getByRole("button", { name: "Guia do curso", exact: true }).count(), 1);
    await guide(c.page);
    assert.equal(await active(c.page), "rules");
    assert.deepEqual(c.calls, before, `${role}: conteúdo estático sem requisições acadêmicas`);
    assert.equal(await c.page.locator('[data-view="course-guide"]').getAttribute("aria-current"), "page");
    await c.page.locator('[data-view="overview"]').click();
    await c.page.locator(".page-heading h1").waitFor();
    assert.notEqual(await c.page.locator(".page-heading h1").textContent(), "Guia do curso");
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []); await c.close();
  }
});

test("guia não depende de turma, publicação ou relatório carregando/com erro", async () => {
  for (const options of [{ cohorts: false }, { mode: "unpublished" }, { mode: "error" }, { mode: "loading" }]) {
    const c = await open(options);
    await guide(c.page);
    assert.match(await c.page.locator('[role="tabpanel"]:visible').innerText(), /requisitos de graduação/i);
    assert.equal(await c.page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).isVisible(), true);
    const before = [...c.calls];
    await c.page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).click();
    assert.deepEqual(c.calls, before);
    c.release(); await settle(c.page);
    assert.equal(await c.page.getByRole("heading", { name: "Guia do curso", exact: true, level: 1 }).isVisible(), true);
    assert.deepEqual(c.errors, []); await c.close();
  }
});

test("guia restaurado sem turma evita busca de relatório e continua disponível na troca de turma", async () => {
  const c = await open({ savedGuide: true, cohorts: false });
  await c.page.getByRole("heading", { name: "Guia do curso", exact: true, level: 1 }).waitFor();
  assert.equal(c.calls.some((call) => call.endsWith("/report")), false);
  assert.equal(await active(c.page), "support");
  await c.close();
  const other = await open(); await guide(other.page);
  const before = [...other.calls];
  await other.page.locator("#cohort").selectOption(code + "-2"); await settle(other.page);
  assert.equal(await other.page.getByRole("heading", { name: "Guia do curso", exact: true, level: 1 }).isVisible(), true);
  assert.deepEqual(other.calls, before, "troca no guia não recarrega relatório");
  await other.close();
});

test("admin em Visualizar como aluno navega pelas abas sem perder contexto nem ampliar permissões", async () => {
  const c = await open({ role: "admin", studentView: true });
  await c.page.locator(".student-view-banner").waitFor();
  const before = [...c.calls], initialUrl = c.page.url();
  await guide(c.page);
  await c.page.getByRole("tab", { name: "Plantões e comunidade", exact: true }).click();
  assert.equal(await active(c.page), "support");
  assert.equal(c.page.url(), initialUrl);
  assert.equal(await c.page.locator(".student-view-banner").isVisible(), true);
  assert.equal(await c.page.getByRole("button", { name: "Turmas e acessos", exact: true }).count(), 0);
  assert.deepEqual(c.calls, before);
  await c.page.reload();
  await c.page.getByRole("heading", { name: "Guia do curso", exact: true, level: 1 }).waitFor();
  assert.equal(await c.page.locator(".student-view-banner").isVisible(), true);
  assert.deepEqual(c.errors, []); await c.close();
});

test("abas roving tabindex: setas, Home/End, ativação e foco previsível sem alterar URL OAuth", async () => {
  const c = await open(); await guide(c.page); const initialUrl = c.page.url();
  await c.page.getByRole("tab", { name: "Regras do curso", exact: true }).focus();
  for (const [key, expected] of [["ArrowRight", "support"], ["ArrowRight", "requests"], ["ArrowRight", "rules"], ["ArrowLeft", "requests"], ["Home", "rules"], ["End", "requests"]]) {
    await c.page.keyboard.press(key);
    assert.equal(await active(c.page), expected, key);
    assert.equal(await c.page.evaluate(() => document.activeElement.dataset.guideTab), expected, `${key}: foco`);
    assert.equal(await c.page.locator('[role="tabpanel"]:visible').count(), 1);
    assert.equal(await c.page.locator('[role="tab"][tabindex="0"]').count(), 1);
    const ring = await c.page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
    assert.ok(ring[0] !== "none" && ring[1] >= 2, `foco visível: ${ring}`);
  }
  assert.equal(c.page.url(), initialUrl, "sem reutilizar code/state nem acrescentar query de aba");
  await c.page.locator('[data-view="overview"]').click(); await guide(c.page); assert.equal(await active(c.page), "rules", "nova entrada começa em Regras");
  await c.close();
});

test("abas adaptam a largura ao texto ampliado, sem cortar nomes nem reduzir a fonte", async () => {
  const measurements = [];
  // Ampliação de texto real no Chromium: fonte padrão 16 → 24/32px via CDP,
  // sem mudar deviceScaleFactor, aplicar zoom CSS ou escalar a página.
  for (const width of [1440, 390, 320]) for (const text of [1, 1.5, 2]) {
    const c = await open({ width, height: width === 1440 ? 900 : 844, text, cohorts: false });
    try {
      await guide(c.page);
      const layout = await c.page.locator(".cg-tabs").evaluate((tabs) => ({
        height: tabs.getBoundingClientRect().height,
        width: tabs.getBoundingClientRect().width,
        orientation: tabs.getAttribute("aria-orientation"),
        overflow: document.documentElement.scrollWidth - innerWidth,
        rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
        buttons: [...tabs.children].map((button) => {
          // Um intervalo por palavra detecta quebras intrapalavra, além do overflow do controle.
          const node = button.firstChild, words = [];
          for (const match of button.textContent.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
            words.push({ text: match[0], fragments: range.getClientRects().length });
          }
          return { text: button.textContent, font: parseFloat(getComputedStyle(button).fontSize),
            width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
            clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1, words };
        }),
      }));
      measurements.push({ viewport: width, textPercent: text * 100, ...layout });
      assert.equal(layout.orientation, width !== 1440 && text > 1 ? "vertical" : "horizontal");
      assert.ok(layout.overflow <= 1, `${width}/${text}: página sem scroll horizontal`);
      assert.deepEqual(layout.buttons.map(({ text: label }) => label), ["Regras do curso", "Plantões e comunidade", "Faltas e solicitações"]);
      for (const button of layout.buttons) {
        assert.equal(button.font, layout.rootFont * (width <= 600 ? 0.875 : 0.9375), "fonte rem preservada, sem redução para compensar ampliação");
        assert.ok(layout.rootFont >= 16 * text, "a ampliação real chega à fonte do documento");
        assert.equal(button.clipped, false, button.text);
        assert.ok(button.height >= 44, "alvo de foco e clique preservado");
        if (layout.orientation === "vertical") assert.ok(button.words.every(({ fragments }) => fragments === 1), `${button.text}: palavras inteiras`);
      }
      if (process.env.COURSE_GUIDE_LAYOUT_EVIDENCE) {
        const destination = process.env.COURSE_GUIDE_LAYOUT_EVIDENCE;
        await mkdir(destination, { recursive: true });
        await c.page.locator(".cg-tabs").screenshot({ path: path.join(destination, `after-${width}-text${text * 100}-tabs.png`) });
        if (text === 1 || width === 320 && text === 2) {
          await c.page.locator(".cg-tabs").scrollIntoViewIfNeeded();
          await c.page.screenshot({ path: path.join(destination, `after-${width}-text${text * 100}.png`) });
        }
      }
      assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
    } finally { await c.close(); }
  }
  if (process.env.COURSE_GUIDE_LAYOUT_EVIDENCE) await writeFile(path.join(process.env.COURSE_GUIDE_LAYOUT_EVIDENCE, "after.json"), JSON.stringify({
    chromium: browser.version(), technique: "CDP Page.setFontSizes: standard16/24/32px; fixed13/20/26px; deviceScaleFactor inalterado", measurements,
  }, null, 2) + "\n");
});

test("resize conserva seleção e foco; orientação e setas acompanham a disposição das abas", async () => {
  const c = await open({ width: 1440, height: 900, text: 1.5 });
  try {
    await guide(c.page);
    const tabs = c.page.getByRole("tablist"), selected = c.page.getByRole("tab", { name: "Faltas e solicitações", exact: true });
    await selected.click(); await selected.focus();
    let original = await selected.elementHandle();
    for (const width of [320, 390, 1440]) {
      await c.page.setViewportSize({ width, height: 900 });
      const orientation = width === 1440 ? "horizontal" : "vertical";
      await c.page.waitForFunction((expected) => document.querySelector(".cg-tabs")?.getAttribute("aria-orientation") === expected, orientation);
      assert.equal(await original.evaluate((element) => element.isConnected && document.activeElement === element), true, "resize não recria abas nem abandona foco");
      assert.equal(await active(c.page), "requests");
      assert.equal(await tabs.getAttribute("aria-orientation"), orientation);
      const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight", previousKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
      // Direção ortogonal continua disponível para navegação/rolagem do navegador.
      await c.page.keyboard.press(orientation === "vertical" ? "ArrowRight" : "ArrowDown");
      assert.equal(await active(c.page), "requests");
      for (const [key, expected] of [[nextKey, "rules"], [previousKey, "requests"], ["Home", "rules"], ["End", "requests"]]) {
        await c.page.keyboard.press(key);
        assert.equal(await active(c.page), expected);
        assert.equal(await c.page.evaluate(() => document.activeElement.dataset.guideTab), expected);
        assert.equal(await c.page.locator('[role="tabpanel"]:visible').count(), 1);
        assert.equal(await c.page.locator('[role="tab"][tabindex="0"]').count(), 1);
        const tab = c.page.locator(`[data-guide-tab="${expected}"]`), panelId = await tab.getAttribute("aria-controls");
        assert.equal(await c.page.locator(`#${panelId}`).getAttribute("aria-labelledby"), await tab.getAttribute("id"));
      }
      await c.page.keyboard.press("Tab");
      assert.equal(await c.page.evaluate(() => document.activeElement.id), "guide-panel-requests", "Tab acessa o painel selecionado");
      await selected.focus();
      // As teclas ativam por render conforme o contrato existente; guarda a nova referência para o próximo resize.
      await original.dispose();
      original = await selected.elementHandle();
    }
    await original.dispose();
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
  } finally { await c.close(); }
});

test("regras mantêm LAB 100% e graduação no Canvas sem material inaugural ou comparação com o painel", async () => {
  const c = await open();
  try {
    await guide(c.page);
    const panel = c.page.locator('#guide-panel-rules');
    const text = await panel.innerText();
    assert.match(text, /Laboratórios[\s\S]*100%/);
    assert.match(text, /KCs[\s\S]*70%/);
    assert.match(text, /Graduado.*acompanha a graduação registrada no Canvas/);
    assert.doesNotMatch(text, /95%|Acompanhamento do painel|Abrir material da aula inaugural|PPTX/);
    assert.equal(await c.page.locator('.cg-note, #cg-panel-note, a[href$=".pptx"]').count(), 0);
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
  } finally { await c.close(); }
});

test("links têm nomes e abertura externa segura, sem PDF normativo descontinuado ou PPTX", async () => {
  const c = await open(); await guide(c.page);
  for (const tab of ["rules", "support", "requests"]) {
    await c.page.locator(`[data-guide-tab="${tab}"]`).click();
    const links = await c.page.locator('[role="tabpanel"]:visible a').evaluateAll((els) => els.map((el) => ({ href: el.href, target: el.target, rel: el.rel, name: el.getAttribute("aria-label") || el.textContent, type: el.type })));
    for (const link of links) {
      assert.ok(link.name.trim(), "nome acessível");
      assert.doesNotMatch(link.href, /\.(?:pdf|pptx)(?:[?#]|$)/i);
      if (link.target === "_blank") { assert.ok(link.rel.includes("noopener") && link.rel.includes("noreferrer")); assert.match(link.name, /nova aba/i); }
    }
  }
  assert.equal(await c.page.locator('a[href$=".pdf"], a[href$=".pptx"]').count(), 0);
  assert.equal(c.calls.some((call) => /\.(pdf|pptx)(?:[?#]|$)/.test(call)), false);
  assert.equal(await c.page.locator("iframe, video, form, input[type=checkbox]").count(), 0);
  assert.deepEqual(c.external, [], "não abre reuniões, vídeos nem formulários durante renderização");
  await c.close();
});

test("desktop/mobile e texto ampliado: conteúdo e menu sem sobreposição, foco e links acessíveis", async () => {
  for (const options of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 320, height: 640, text: 2 }, { role: "admin", width: 390, height: 844 }, { role: "admin", width: 320, height: 640, text: 2 }]) {
    const c = await open(options); await guide(c.page);
    for (const tab of ["rules", "support", "requests"]) {
      await c.page.locator(`[data-guide-tab="${tab}"]`).click();
      await c.page.locator('[role="tabpanel"]:visible details').evaluateAll((els) => els.forEach((el) => { el.open = true; }));
      await settle(c.page);
      const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const overflowDetails = overflow > 1 ? await c.page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map((el) => ({ tag: el.tagName, cls: el.className, text: el.textContent.trim().slice(0, 55), width: Math.round(el.getBoundingClientRect().width) })).slice(0, 12)) : [];
      assert.ok(overflow <= 1, `${JSON.stringify(options)} ${tab}: rolagem lateral ${overflow}: ${JSON.stringify(overflowDetails)}`);
      const clipped = await c.page.locator('[role="tabpanel"]:visible :is(a, summary), [role="tab"], .sidebar nav .nav-item').evaluateAll((els) => els.filter((el) => {
        const r = el.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > innerWidth + 0.5 || el.scrollWidth > el.clientWidth + 1);
      }).map((el) => el.textContent.trim()));
      assert.deepEqual(clipped, [], `${JSON.stringify(options)} ${tab}: controles inteiros`);
      const links = c.page.locator('[role="tabpanel"]:visible a');
      const last = await links.count() ? links.last() : c.page.locator('[role="tabpanel"]:visible summary').last();
      await last.focus();
      assert.equal(await last.evaluate((el) => { const r = el.getBoundingClientRect(), nav = document.querySelector(".sidebar nav"), nr = nav.getBoundingClientRect(); return r.top >= -1 && r.bottom <= (getComputedStyle(nav).position === "fixed" ? nr.top : innerHeight) + 1; }), true, `${JSON.stringify(options)} ${tab}: link não escondido pela barra`);
      if (process.env.COURSE_GUIDE_SCREENSHOTS && !options.text && (options.width === 1440 && tab === "rules" || options.width === 390 && tab === "requests") && !options.role) {
        await mkdir(process.env.COURSE_GUIDE_SCREENSHOTS, { recursive: true });
        await c.page.evaluate(() => scrollTo(0, 0));
        await settle(c.page);
        await c.page.screenshot({ path: path.join(process.env.COURSE_GUIDE_SCREENSHOTS, options.width === 1440 ? "desktop.png" : "mobile.png"), fullPage: true });
      }
    }
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []); await c.close();
  }
});

test("sem sessão o guia não expõe menu autenticado e o fluxo de login permanece disponível", async () => {
  const c = await open({ signedIn: false });
  await c.page.getByRole("button", { name: /Entrar/i }).first().waitFor();
  assert.equal(await c.page.getByRole("button", { name: "Guia do curso", exact: true }).count(), 0);
  assert.equal(c.calls.length, 0); assert.deepEqual(c.errors, []); await c.close();
});


test("feedback a partir do guia conserva o contrato existente do backend sem origem não reconhecida", async () => {
  for (const role of ["instructor", "admin"]) {
    const c = await open({ role }); await guide(c.page);
    await c.page.locator(".footer-feedback").click();
    await c.page.getByRole("heading", { name: "Ajude a melhorar a plataforma", exact: true }).waitFor();
    await c.page.locator(".fb-type-option", { hasText: "Bug" }).click();
    await c.page.locator("#fb-title").fill("Relato fictício do guia");
    await c.page.locator("#fb-description").fill("Descrição de teste sem qualquer dado pessoal real.");
    await c.page.getByRole("button", { name: "Enviar feedback", exact: true }).click();
    await c.page.locator(".feedback-success").waitFor();
    assert.equal(c.feedbackPosts.length, 1);
    assert.deepEqual(c.feedbackPosts[0], { type: "BUG", title: "Relato fictício do guia", description: "Descrição de teste sem qualquer dado pessoal real.", cohort: code });
    assert.equal("page" in c.feedbackPosts[0], false, "course-guide não é enviado como enum novo ao backend antigo");
    assert.deepEqual(c.errors, []); await c.close();
  }
});

test("Faltas e solicitações: cards uniformes, ações no rodapé, aviso antes da ação e teclado sem PDF", async () => {
  const measurements = [];
  // Texto ampliado por Page.setFontSizes, não por deviceScaleFactor ou CSS scale.
  for (const width of [1440, 1280, 1101, 1024, 768, 390, 320]) for (const text of [1, 1.5, 2]) {
    const c = await open({ width, height: width > 1100 ? 900 : 844, text, cohorts: false });
    try {
      await guide(c.page);
      const unchangedPanels = {};
      for (const tab of ["rules", "support"]) {
        await c.page.locator(`[data-guide-tab="${tab}"]`).click();
        unchangedPanels[tab] = await c.page.locator(`#guide-panel-${tab}`).evaluate((panel) => [...panel.querySelectorAll(".cg-section > h2, .cg-requirements, .cg-card, .cg-card-action, .button")].map((el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return { text: el.textContent, width: r.width, height: r.height,
            display: s.display, gap: s.gap, padding: s.padding, font: s.font, border: s.border, background: s.backgroundColor };
        }));
      }
      await c.page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).click();
      const cards = await c.page.locator(".cg-steps .cg-card").evaluateAll((els) => els.map((card) => {
        const r = card.getBoundingClientRect(), s = getComputedStyle(card), button = card.querySelector(".button"), b = button.getBoundingClientRect();
        const paragraphs = [...card.querySelectorAll("p")], warning = paragraphs.find((p) => p.textContent.includes("endereço de acompanhamento"));
        return { height: r.height, top: r.top, left: r.left, padding: s.padding,
          button: { top: b.top, bottom: b.bottom, height: b.height, bottomInset: r.bottom - b.bottom,
            clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1 },
          paddingBottom: parseFloat(s.paddingBottom), borderBottom: parseFloat(s.borderBottomWidth),
          mainLinks: card.querySelectorAll("a").length,
          footerLast: card.lastElementChild?.classList.contains("cg-card-action"),
          warningBeforeButton: !warning || !!(warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) };
      }));
      measurements.push({ width, textPercent: text * 100, overflow: await c.page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        cards, unchangedPanels });
      if (process.env.COURSE_GUIDE_REQUESTS_EVIDENCE) {
        const destination = process.env.COURSE_GUIDE_REQUESTS_EVIDENCE, phase = process.env.COURSE_GUIDE_REQUESTS_PHASE || "after";
        await mkdir(destination, { recursive: true });
        if ([1440, 390].includes(width) && text === 1 || width === 320 && text === 2)
          await c.page.locator(".cg-steps").screenshot({ path: path.join(destination, `${phase}-${width}-text${text * 100}.png`) });
      }
      assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
    } finally { await c.close(); }
  }
  if (process.env.COURSE_GUIDE_REQUESTS_EVIDENCE) {
    const phase = process.env.COURSE_GUIDE_REQUESTS_PHASE || "after";
    await writeFile(path.join(process.env.COURSE_GUIDE_REQUESTS_EVIDENCE, `${phase}.json`), JSON.stringify({ chromium: browser.version(),
      technique: "CDP Page.setFontSizes standard16/24/32px, fixed13/20/26px; sem scale ou deviceScaleFactor", measurements }, null, 2) + "\n");
  }
  for (const { width, textPercent, overflow, cards } of measurements) {
    const id = `${width}px/${textPercent}%`;
    assert.equal(cards.length, 3);
    assert.ok(overflow <= 1, `${id}: sem rolagem horizontal da página`);
    assert.equal(new Set(cards.map((c) => c.padding)).size, 1, `${id}: preenchimento uniforme`);
    for (const card of cards) {
      assert.equal(card.mainLinks, 1, `${id}: somente a ação principal, sem PDF`);
      assert.equal(card.footerLast, true, `${id}: nenhum aviso abaixo do botão`);
      assert.equal(card.warningBeforeButton, true, `${id}: aviso de acompanhamento antes da ação`);
      assert.equal(card.button.clipped, false, `${id}: botão inteiro`);
      assert.ok(card.button.height >= 44, `${id}: alvo acessível`);
      assert.ok(Math.abs(card.button.bottomInset - card.paddingBottom - card.borderBottom) <= 1, `${id}: ação no limite inferior do conteúdo`);
    }
    if (Math.max(...cards.map((c) => c.top)) - Math.min(...cards.map((c) => c.top)) <= 1) {
      assert.ok(Math.max(...cards.map((c) => c.height)) - Math.min(...cards.map((c) => c.height)) <= 1, `${id}: alturas dos cards lado a lado iguais`);
      assert.ok(Math.max(...cards.map((c) => c.button.top)) - Math.min(...cards.map((c) => c.button.top)) <= 1, `${id}: topo dos botões alinhado`);
      assert.ok(Math.max(...cards.map((c) => c.button.bottom)) - Math.min(...cards.map((c) => c.button.bottom)) <= 1, `${id}: base dos botões alinhada`);
    }
  }
  for (const width of [1440, 390, 320]) {
    const c = await open({ width, height: 844, text: width === 1440 ? 1 : 2, cohorts: false });
    try {
      await guide(c.page);
      await c.page.getByRole("tab", { name: "Faltas e solicitações", exact: true }).click();
      await c.page.locator("#guide-panel-requests").focus();
      for (const label of ["Consultar minhas faltas", "Abrir formulário de solicitação", "Acompanhar minhas solicitações"]) {
        await c.page.keyboard.press("Tab");
        const focused = await c.page.evaluate(() => { const a = document.activeElement, s = getComputedStyle(a), r = a.getBoundingClientRect(), nav = document.querySelector(".sidebar nav"), n = nav.getBoundingClientRect();
          return { name: a.getAttribute("aria-label"), target: a.target, rel: a.rel,
            visible: r.top >= -1 && r.bottom <= (getComputedStyle(nav).position === "fixed" ? n.top : innerHeight) + 1,
            outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 }; });
        assert.equal(focused.name, `${label} (abre em nova aba)`);
        assert.equal(focused.target, "_blank"); assert.ok(focused.rel.includes("noopener") && focused.rel.includes("noreferrer"));
        assert.ok(focused.visible && focused.outline, `${width}: foco visível na ação ${label}`);
      }
      assert.equal(await c.page.locator('#guide-panel-requests a[href$=".pdf"]').count(), 0);
      assert.deepEqual(c.external, [], "o teste navega por teclado, sem abrir serviços de terceiros");
    } finally { await c.close(); }
  }
});

// Fluxos reais de estudo/simulado em release estática, com sessão e API fictícias.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { practiceExams } from "../frontend/practice-content.js";
import { practiceKey } from "../frontend/practice.js";
const require = createRequire(import.meta.url);
const practiceQuestions = practiceExams[0].questions;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist"), prefix = "/releases/practice-test/", email = "student@example.test";
const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"), relative = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname.slice(1);
  const file = path.resolve(root, relative || "index.html");
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
let browser, origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server.close(resolve)); });
async function open({ width = 1440, text = 1, role = "student", cohorts = true, blockedStorage = false, corruptStorage = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "pt-BR" });
  const page = await context.newPage(), errors = [], calls = [], external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (text !== 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: 16 * text, fixed: 13 * text } });
  }
  await page.addInitScript(({ email, blockedStorage, corruptStorage, key }) => {
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test-only", expires: Date.now() + 86400000 }));
    if (corruptStorage) localStorage.setItem(key, "invalid");
    if (blockedStorage) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) { if (name.startsWith("avanca.practice.")) throw new Error("blocked"); return original.call(this, name, value); };
    }
  }, { email, blockedStorage, corruptStorage, key: practiceKey(email) });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.endsWith("/config.json")) return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    calls.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === "/api/me") return route.fulfill({ json: { email, roles: [role] } });
    if (url.pathname === "/api/cohorts") return route.fulfill({ json: { cohorts: cohorts ? [{ code: "TESTE", canTeach: role !== "student" }] : [] } });
    if (url.pathname.endsWith("/report")) return route.fulfill({ json: {
      cohort: "TESTE", thresholds: { kc: 70, lab: 95 }, publication: { id: "p1", publishedAt: "2026-11-01T12:00:00Z" },
      student: { id: "101", name: "Aluna Teste", email, kc: 80, lab: 100, completed: 0, pending: 0, progress: 0, activities: [] },
      students: [], activities: [], history: [],
    } });
    return route.fulfill({ status: 404, json: { error: "Rota não simulada" } });
  });
  await page.goto(origin + prefix);
  await page.locator(".page-heading h1").waitFor();
  await page.getByRole("button", { name: "Simulados AWS", exact: true }).click();
  await page.getByRole("heading", { name: "Simulados AWS", exact: true }).waitFor();
  return { page, calls, errors, external, context, close: () => context.close() };
}
const saved = (page, examId) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), practiceKey(email, examId));
const finish = async (page) => {
  await page.getByRole("button", { name: "Revisar e concluir tentativa", exact: true }).click();
  await page.getByRole("button", { name: "Concluir e ver resultado", exact: true }).click();
};
const openSetup = async (page) => {
  await page.locator('[data-practice-action="setup"]').click();
  await page.getByRole("heading", { name: "Escolha seu modo de teste", exact: true }).waitFor();
};
const chooseTime = async (page, minutes = 90) => {
  const toggle = page.getByRole("switch", { name: "Estender tempo", exact: true });
  if (minutes === 90) await toggle.uncheck();
  else { await toggle.check(); await page.locator(`#practice-time-${minutes === null ? "none" : minutes}`).check(); }
};
const startStudy = async (page, count = "10", domain = "all") => {
  await openSetup(page);
  await page.locator("#practice-domain").selectOption(domain);
  await page.locator("#practice-count").selectOption(count);
  await page.locator("#practice-shuffle").uncheck();
  await page.getByRole("button", { name: /^Iniciar (prática|exame)$/, exact: true }).click();
};
const startExam = async (page, minutes = 90) => {
  await openSetup(page);
  await page.locator("#practice-mode-exam").check();
  await chooseTime(page, minutes);
  await page.getByRole("button", { name: /^Iniciar (prática|exame)$/, exact: true }).click();
};
async function evidence(page, name) {
  if (!process.env.PRACTICE_EVIDENCE) return;
  await mkdir(process.env.PRACTICE_EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(process.env.PRACTICE_EVIDENCE, name + ".png"), fullPage: true });
}

test("primeira configuração tem nomes neutros; retomada mantém a tentativa e nova tentativa depende do histórico deste simulado", async () => {
  const c = await open(), { page } = c;
  try {
    await page.getByRole("button", { name: "Configurar simulado", exact: true }).click();
    assert.deepEqual(await page.locator(".practice-mode-copy > strong").allTextContents(), ["Modo de prática", "Modo de exame"]);
    assert.doesNotMatch(await page.locator("#practice-setup").innerText(), /Repetir/);
    assert.equal(await page.getByRole("button", { name: "Iniciar prática", exact: true }).count(), 1);
    await page.locator("#practice-mode-exam").check();
    await page.getByRole("button", { name: "Iniciar exame", exact: true }).click();
    const id = (await saved(page)).current.id;
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
    assert.equal((await saved(page)).current.id, id);
    await finish(page);
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Nova tentativa", exact: true }).count(), 1);
    await page.locator("#practice-exam").selectOption(practiceExams[1].id);
    assert.equal(await page.getByRole("button", { name: "Configurar simulado", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Nova tentativa", exact: true }).count(), 0);
  } finally { await c.close(); }
});

test("modo foco reutiliza a navegação modal, preserva questão e prazo e restaura o portal ao sair", async () => {
  for (const options of [{ width: 1440 }, { width: 390 }, { width: 320, text: 2 }]) {
    const c = await open(options), { page } = c;
    try {
      assert.equal(await page.locator(".practice-focus").count(), 0);
      await startStudy(page);
      await page.locator("#practice-option-A").check();
      await page.getByRole("button", { name: "Marcar para revisar", exact: true }).click();
      const before = (await saved(page)).current;
      await page.evaluate(() => { window.practiceQuestionNode = document.querySelector(".practice-question"); });
      const trigger = page.getByRole("button", { name: "Abrir menu de navegação", exact: true });
      const dialog = page.getByRole("dialog", { name: "Navegação do portal", exact: true });
      await trigger.click();
      assert.equal(await trigger.getAttribute("aria-expanded"), "true");
      assert.equal(await dialog.evaluate((el) => el.matches(":modal")), true);
      assert.equal(await page.locator(".sidebar").count(), 1, "não duplica a navegação");
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
        assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
      }
      await page.evaluate(() => document.getElementById("practice-option-B").focus());
      assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, "conteúdo de fundo é inerte");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.getElementById("practice-menu-toggle").getAttribute("aria-expanded") === "false");
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.practiceQuestionNode === document.querySelector(".practice-question")), true);
      assert.deepEqual((await saved(page)).current, before);
      await trigger.click(); await page.getByRole("button", { name: "Fechar menu", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("practice-menu-toggle").getAttribute("aria-expanded") === "false");
      assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
      await trigger.click(); await dialog.getByRole("button", { name: "Guia do curso", exact: true }).click();
      assert.equal(await page.locator(".practice-focus").count(), 0);
      assert.equal(await page.locator(".layout > .sidebar").count(), 1);
      await page.getByRole("button", { name: "Simulados AWS", exact: true }).click();
      assert.equal(await page.locator(".practice-focus").count(), 1);
      assert.deepEqual((await saved(page)).current, before);
      await page.reload(); await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
      assert.equal(await page.locator(".practice-focus").count(), 1);
      assert.deepEqual((await saved(page)).current, before);
      await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
      assert.equal(await page.locator(".practice-focus").count(), 0);
      assert.equal(await page.locator(".layout > .sidebar").count(), 1);
      assert.deepEqual(c.errors, []);
    } finally { await c.close(); }
  }
});

test("estudo corrige seleção dupla, mantém respostas, revisa erros e inicia novo estudo com os erros", async () => {
  const c = await open(), { page } = c;
  try {
    const calls = [...c.calls]; await evidence(page, "home-desktop");
    await startStudy(page);
    await page.locator("#practice-option-A").check();
    assert.equal(await page.locator("#practice-explanation").count(), 0, "sem correção enquanto a seleção está incompleta");
    await page.locator("#practice-option-B").check();
    assert.equal(await page.locator("#practice-option-C").isDisabled(), true);
    await page.getByRole("heading", { name: "Resposta correta", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), "practice-explanation");
    await page.getByRole("button", { name: "Próxima questão", exact: true }).click();
    await page.locator("#practice-option-C").check();
    await page.getByRole("heading", { name: "Resposta correta", exact: true }).waitFor();
    await page.getByRole("button", { name: "Questão anterior", exact: true }).click();
    assert.equal(await page.locator("#practice-option-A").isChecked(), true);
    assert.equal(await page.locator("#practice-option-A").isDisabled(), true);
    await page.getByRole("button", { name: "Marcar para revisar", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Marcada para revisar", exact: true }).getAttribute("aria-pressed"), "true");
    await finish(page);
    await page.getByRole("heading", { name: "2 de 10 questões corretas", exact: true }).waitFor();
    assert.equal(await page.locator(".practice-review details").count(), 8);
    await page.getByRole("button", { name: "Todas (10)", exact: true }).click();
    assert.equal(await page.locator(".practice-review details").count(), 10);
    await evidence(page, "result-desktop");
    await page.getByRole("button", { name: "Repetir estas questões", exact: true }).click();
    await page.getByRole("heading", { name: "Escolha seu modo de teste", exact: true }).waitFor();
    await page.locator("#practice-mode-exam").check();
    await page.getByRole("button", { name: /^Iniciar (prática|exame)$/, exact: true }).click();
    const next = (await saved(page)).current;
    assert.equal(next.questionIds.length, 8);
    assert.equal(next.mode, "exam");
    assert.equal(next.questionIds.some((id) => [1, 2].includes(id)), false);
    assert.deepEqual(c.calls, calls);
    await page.reload(); await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
    assert.deepEqual((await saved(page)).current.questionIds, next.questionIds);
    assert.deepEqual(c.calls.slice(calls.length), ["GET /api/me", "GET /api/cohorts"]);
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
  } finally { await c.close(); }
});

test("antes do início, a escolha de modo e tempo funciona por teclado e não inicia o relógio", async () => {
  const c = await open(), { page } = c;
  try {
    await openSetup(page);
    assert.equal(await page.locator("#practice-mode-study").isChecked(), true);
    assert.equal(await page.getByRole("switch", { name: "Estender tempo", exact: true }).isChecked(), false);
    assert.equal(await page.locator("#practice-time-options").isHidden(), true);
    assert.equal(await page.locator(".practice-time-limit").innerText(), "90 minutos (padrão)");
    await evidence(page, "setup-desktop");
    await page.locator("#practice-mode-study").focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#practice-mode-exam").isChecked(), true);
    assert.equal(await page.locator(".practice-custom-settings").isHidden(), true);
    await page.getByRole("switch", { name: "Estender tempo", exact: true }).focus(); await page.keyboard.press("Space");
    assert.equal(await page.locator("#practice-time-135").isChecked(), true);
    assert.equal(await page.locator(".practice-time-limit").innerText(), "135 minutos");
    await evidence(page, "setup-desktop-extended");
    await page.locator("#practice-time-180").check();
    await chooseTime(page, 90);
    assert.equal(await page.locator(".practice-time-limit").innerText(), "90 minutos (padrão)");
    await page.getByRole("switch", { name: "Estender tempo", exact: true }).check();
    assert.equal(await page.locator("#practice-time-180").isChecked(), true);
    await page.locator("#practice-time-none").check();
    await page.locator("#practice-mode-study").check();
    assert.match(await page.locator(".practice-setup-summary").innerText(), /Modo de prática · Sem limite de tempo/);
    assert.equal((await saved(page)).current, null);
    assert.equal(await page.locator("#practice-clock").count(), 0);
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    assert.equal((await saved(page)).current, null);
    assert.deepEqual(c.errors, []);
  } finally { await c.close(); }
});

test("135, 180 minutos e tempo ilimitado continuam corretos após 90 minutos e recarga", async () => {
  for (const minutes of [135, 180, null]) {
    const c = await open(), { page } = c;
    try {
      await page.clock.install(); await startExam(page, minutes);
      const initial = (await saved(page)).current;
      assert.equal(initial.timeLimitMinutes, minutes);
      if (minutes === null) assert.equal(await page.locator("#practice-clock").count(), 0);
      else assert.equal(await page.locator("#practice-clock").innerText(), `${minutes}:00`);
      await page.clock.fastForward(90 * 60000);
      assert.equal(await page.locator("#practice-question-title").isVisible(), true);
      await page.reload(); await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
      const resumed = (await saved(page)).current;
      assert.equal(resumed.deadline, initial.deadline); assert.equal(resumed.timeLimitMinutes, minutes);
      assert.equal(await page.locator(".practice-explanations").count(), 0);
      if (minutes === null) {
        await page.clock.fastForward(4 * 60 * 60000);
        assert.equal((await saved(page)).current.completedAt, null);
        await finish(page);
        assert.equal((await saved(page)).current.timedOut, false);
      } else {
        await page.clock.fastForward((minutes - 90) * 60000 + 1);
        await page.getByRole("heading", { name: "Resultado da tentativa", exact: true }).waitFor();
        assert.equal((await saved(page)).current.timedOut, true);
      }
      assert.equal((await saved(page)).history.length, 1);
      assert.deepEqual(c.errors, []);
    } finally { await c.close(); }
  }
});

test("simulado retoma o mesmo prazo, mantém foco durante o relógio e conclui uma única vez no limite", async () => {
  const c = await open(), { page } = c;
  try {
    await page.clock.install();
    await startExam(page);
    assert.equal(await page.locator("#practice-clock").innerText(), "90:00");
    const initial = (await saved(page)).current;
    await page.locator("#practice-option-A").check();
    await page.locator("#practice-option-A").focus();
    await page.clock.fastForward(3000);
    assert.equal(await page.evaluate(() => document.activeElement.id), "practice-option-A");
    assert.equal(await page.getByRole("button", { name: "Conferir resposta", exact: true }).count(), 0);
    assert.equal(await page.locator(".practice-explanations").count(), 0);
    await page.reload();
    await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
    assert.equal((await saved(page)).current.deadline, initial.deadline);
    assert.equal(await page.locator("#practice-option-A").isChecked(), true);
    await page.clock.fastForward(5400001);
    await page.getByRole("heading", { name: "Resultado da tentativa", exact: true }).waitFor();
    const model = await saved(page);
    assert.equal(model.current.timedOut, true); assert.equal(model.history.length, 1);
    await page.clock.fastForward(60000); assert.equal((await saved(page)).history.length, 1);
    assert.deepEqual(c.errors, []);
  } finally { await c.close(); }
});

test("filtro por domínio, cancelamento de descarte e conta sem turma funcionam sem requisições acadêmicas", async () => {
  const c = await open({ cohorts: false }), { page } = c;
  try {
    const calls = [...c.calls];
    await startStudy(page, "all", "2");
    const ids = (await saved(page)).current.questionIds;
    assert.equal(ids.length, practiceQuestions.filter((question) => question.domain === "2").length);
    assert.ok(ids.every((id) => practiceQuestions[id - 1].domain === "2"));
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    await page.getByRole("button", { name: "Descartar tentativa", exact: true }).click();
    await page.getByRole("button", { name: "Continuar respondendo", exact: true }).click();
    assert.ok((await saved(page)).current);
    await page.getByRole("button", { name: "Descartar tentativa", exact: true }).click();
    await page.locator(".practice-confirm").getByRole("button", { name: "Descartar tentativa", exact: true }).click();
    assert.equal((await saved(page)).current, null);
    assert.deepEqual(c.calls, calls); assert.deepEqual(c.errors, []);
  } finally { await c.close(); }
});

test("dois simulados têm seleção, gabaritos, retomada e históricos independentes em PT-BR", async () => {
  const c = await open(), { page } = c;
  const [first, second] = practiceExams;
  try {
    assert.equal(await page.locator("#practice-exam option").count(), 2);
    await startStudy(page);
    await page.locator("#practice-option-A").check(); await page.locator("#practice-option-B").check();
    await page.getByRole("heading", { name: "Resposta correta", exact: true }).waitFor();
    const firstAttempt = (await saved(page, first.id)).current;
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    await page.locator("#practice-exam").selectOption(second.id);
    assert.equal(await page.getByRole("button", { name: "Retomar tentativa", exact: true }).count(), 0);
    await evidence(page, "second-exam-home-desktop");
    await openSetup(page);
    assert.equal(await page.getByRole("switch", { name: "Estender tempo", exact: true }).isChecked(), false);
    assert.equal(await page.locator(".practice-time-limit").innerText(), "90 minutos (padrão)");
    await page.locator("#practice-count").selectOption("10"); await page.locator("#practice-shuffle").uncheck();
    await page.getByRole("button", { name: /^Iniciar (prática|exame)$/, exact: true }).click();
    assert.match(await page.locator("#practice-question-title").innerText(), /failover de DNS/);
    assert.equal(await page.locator("#practice-option-D").getAttribute("type"), "radio");
    await page.locator("#practice-option-D").check();
    await page.getByRole("heading", { name: "Resposta correta", exact: true }).waitFor();
    const url = await page.locator("#practice-explanation a").getAttribute("href");
    assert.match(url, /^https:\/\/docs\.aws\.amazon\.com\/pt_br\//);
    await evidence(page, "second-exam-explanation-desktop");
    await page.reload();
    assert.equal(await page.locator("#practice-exam").inputValue(), second.id);
    await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
    assert.equal(await page.locator("#practice-option-D").isChecked(), true);
    await finish(page);
    await page.getByRole("heading", { name: "1 de 10 questões corretas", exact: true }).waitFor();
    await page.getByRole("button", { name: "Voltar aos simulados", exact: true }).click();
    assert.equal(await page.locator(".practice-history li").count(), 1);
    await page.locator("#practice-exam").selectOption(first.id);
    assert.equal(await page.locator(".practice-history li").count(), 0);
    await page.getByRole("button", { name: "Retomar tentativa", exact: true }).click();
    assert.equal(await page.locator("#practice-option-A").isChecked(), true);
    assert.equal(await page.locator("#practice-option-B").isChecked(), true);
    assert.equal((await saved(page, first.id)).current.id, firstAttempt.id);
    await finish(page);
    await page.getByRole("heading", { name: "1 de 10 questões corretas", exact: true }).waitFor();
    assert.equal((await saved(page, first.id)).history.length, 1);
    assert.equal((await saved(page, second.id)).history.length, 1);
    assert.deepEqual((await saved(page, first.id)).history[0].answers[1], ["A", "B"]);
    assert.deepEqual((await saved(page, second.id)).history[0].answers[1], ["D"]);
    assert.deepEqual(c.errors, []); assert.deepEqual(c.external, []);
  } finally { await c.close(); }
});

test("falha de storage e registro corrompido não impedem responder", async () => {
  for (const options of [{ blockedStorage: true }, { corruptStorage: true }]) {
    const c = await open(options);
    try {
      await startStudy(c.page);
      await c.page.locator("#practice-option-A").check(); await c.page.locator("#practice-option-B").check();
      await c.page.getByRole("heading", { name: "Resposta correta", exact: true }).waitFor();
      if (options.blockedStorage) assert.match(await c.page.locator(".practice-content-note").innerText(), /não pôde ser salvo/);
      assert.deepEqual(c.errors, []);
    } finally { await c.close(); }
  }
});

test("interface em celular e texto ampliado não transborda no início, configuração, questão e resultado", async () => {
  // A fonte larga reproduz no macOS o reflow que falhou no CI Linux a 320 px e texto a 200%.
  const wideFont = 'Verdana, "DejaVu Sans", sans-serif';
  for (const options of [{ width: 320 }, { width: 390 }, { width: 320, text: 2 }, { width: 1440, text: 2 }, { width: 320, text: 2, font: wideFont }]) {
    const c = await open(options), { page } = c;
    const fits = async () => {
      const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll(".practice-page *")].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((node) => ({ tag: node.tagName, class: node.className, text: node.textContent.slice(0, 80) })),
        modeTextOverflow: [...document.querySelectorAll(".practice-mode-copy > *")].filter((node) => {
          const box = node.closest(".practice-mode-choice").getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(node);
          return [...range.getClientRects()].some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1);
        }).map((node) => node.textContent) }));
      if (metrics.scroll > metrics.width + 1 || metrics.modeTextOverflow.length) await evidence(page, `overflow-${options.width}-${options.text || 1}`);
      assert.ok(metrics.scroll <= metrics.width + 1, JSON.stringify({ options, ...metrics }));
      assert.deepEqual(metrics.modeTextOverflow, [], JSON.stringify({ options, ...metrics }));
    };
    try {
      if (options.font) await page.addStyleTag({ content: `:root { --font-ui: ${options.font}; }` });
      await page.evaluate(() => document.fonts.ready);
      await fits(); if (options.width === 390) await evidence(page, "home-mobile");
      await openSetup(page);
      await fits();
      if (options.font) await evidence(page, "setup-mobile-text-200-wide");
      if (options.width === 390) await evidence(page, "setup-mobile");
      await page.getByRole("switch", { name: "Estender tempo", exact: true }).check();
      await fits();
      if (options.width === 390) await evidence(page, "setup-mobile-extended");
      await page.locator("#practice-count").selectOption("10");
      await page.locator("#practice-shuffle").uncheck();
      await page.getByRole("button", { name: /^Iniciar (prática|exame)$/, exact: true }).click(); await fits();
      if (options.width === 390) await evidence(page, "question-mobile");
      await page.locator("#practice-option-A").check(); await page.locator("#practice-option-B").check();
      await finish(page); await fits();
      if (options.width === 390) await evidence(page, "result-mobile");
      assert.deepEqual(c.errors, []);
    } finally { await c.close(); }
  }
});

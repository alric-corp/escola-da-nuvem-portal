// Piloto visual do painel do aluno (docs/design-visual.md), com API fictícia. Nunca acessa AWS, Cognito ou Canvas.
// Cobre o que o piloto promete além da aparência: escopo (.student-home só em "Meu desempenho" do aluno), estados de
// carregamento e erro com os mesmos papéis acessíveis, foco visível, movimento reduzido, rótulos do gráfico fora dos
// pontos, arredondamento do aluno no primeiro cartão e ausência de rolagem lateral em 320–1440 px.
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const activity = (id, name, kind, state, percent = null) => ({ id, name, kind, state, percent, score: percent, points: "100", active: state !== "unreleased",
  needsReview: state === "completed" && percent != null && percent < (kind === "kc" ? 70 : 95), module: "Linux", moduleOrder: 7, canvasUrl: null });
// Sem pendências: o primeiro cartão de "Por onde começar" é uma revisão com nota de duas casas.
const activities = [
  activity("a1", "226-LX-KC - Uma introdução ao Linux", "kc", "completed", 56.67),
  activity("a2", "227--Lab - Linha de comando do Linux", "lab", "completed", 88.25),
  activity("a3", "225--Lab - Introdução ao Linux", "lab", "completed", 100),
];
const student = { id: "1", name: "Ana Teste", email: "ana@example.test", kc: 56.67, lab: 94.13, total: 75.4, completed: 3, pending: 0, progress: 100, status: "critical", activities };
const history = [
  { publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 56.67, lab: 94.13, total: 75.4, changes: null },
  { publishedAt: "2026-10-02T21:00:00Z", current: false, kc: 50, lab: 99, total: 74.5, changes: null },
];
const report = { cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-09T21:00:00Z",
  updateKind: "publish", thresholds: { kc: 70, lab: 95 }, student, history, focus: { activityIds: [], version: null } };

let browser;
try {
  browser = await chromium.launch({ headless: true });

  async function open({ width = 1440, role = "student", reportMode = "ok", reducedMotion = "no-preference" } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
    const page = await context.newPage();
    const errors = [], external = [];
    const control = { reportMode, release: null };
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const endpoint = url.pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: role + "@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role === "instructor" }] } });
      if (endpoint.endsWith("/report")) {
        if (control.reportMode === "hang") return new Promise((resolve) => { control.release = () => resolve(route.fulfill({ json: report })); });
        if (control.reportMode === "error") return route.fulfill({ status: 503, body: "" });
        return route.fulfill({ json: role === "instructor" ? { ...report, students: [student], activities } : report });
      }
      throw new Error("endpoint não simulado: " + endpoint);
    });
    await page.goto(origin);
    return { context, page, errors, external, control };
  }

  {
    // Conteúdo normal: escopo, cartão de revisão com arredondamento do aluno e rótulos do gráfico fora dos pontos.
    const { context, page, errors, external } = await open();
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    assert.equal(await page.locator(".student-home").count(), 1);
    assert.equal(await page.locator(".student-home .student-summary .goal").count(), 2);
    const first = page.locator(".next-steps .activity-card").first();
    assert.match(await first.innerText(), /226-LX-KC[\s\S]*56,7%/);
    assert.doesNotMatch(await first.innerText(), /56,67%/, "o primeiro cartão usa o arredondamento do aluno, como os demais");
    const chart = await page.locator(".evolution svg").evaluate((svg) => ({
      labels: [...svg.querySelectorAll(".evo-ref-label")].map((t) => { const b = t.getBBox(); return { x: b.x, width: b.width }; }),
      dots: [...svg.querySelectorAll(".evo-dot")].map((c) => Number(c.getAttribute("cx")) + Number(c.getAttribute("r"))),
      kcLines: svg.querySelectorAll("path.evo-kc").length,
      width: svg.viewBox.baseVal.width,
    }));
    assert.equal(chart.kcLines, 1, "o marcador da referência não conta como série de KC");
    for (const box of chart.labels) {
      assert.ok(box.x > Math.max(...chart.dots), "rótulo da referência à direita do último ponto");
      assert.ok(box.x + box.width <= chart.width + 0.5, "rótulo dentro do gráfico");
    }
    // Foco de teclado na ação principal: contorno visível de 3 px.
    await page.getByRole("button", { name: /Ver minhas atividades/ }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.textContent.trim(), s.outlineStyle, s.outlineWidth]; });
    assert.deepEqual(outline, ["Ver minhas atividades", "solid", "3px"]);
    // A moldura da mesma tela segue o piloto; "Minhas atividades" (Expansão 1) e "Meu histórico" (Expansão 2) têm
    // escopo próprio.
    assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
    await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
    await page.getByRole("heading", { name: "Minhas atividades", level: 1 }).waitFor();
    assert.equal(await page.locator(".student-home").count(), 0);
    assert.equal(await page.locator(".student-activities").count(), 1);
    assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
    await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Meu histórico", level: 1 }).waitFor();
    assert.equal(await page.locator(".student-home, .student-activities").count(), 0);
    assert.equal(await page.locator(".student-history").count(), 1);
    assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await context.close();
  }

  {
    // Carregamento: o anúncio continua no role="status"; o esboço do resumo é estático e fora da árvore acessível.
    const { context, page, errors, control } = await open({ reportMode: "hang" });
    const status = page.locator(".student-home [role=status]");
    await status.waitFor();
    assert.equal(await status.innerText(), "Carregando sua turma…");
    assert.equal(await page.locator(".student-home .summary-sketch").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator(".student-home .summary-sketch").evaluate((el) => el.getAnimations({ subtree: true }).length), 0);
    while (!control.release) await page.waitForTimeout(10);
    control.release();
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    assert.equal(await page.locator(".summary-sketch").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }

  {
    // Erro recuperável: mesmo alerta e mesma action; "Tentar novamente" carrega o painel.
    const { context, page, errors, control } = await open({ reportMode: "error" });
    const alert = page.locator(".student-home [role=alert]");
    await alert.waitFor();
    assert.match(await alert.innerText(), /Não foi possível carregar[\s\S]*temporariamente indisponível/);
    control.reportMode = "ok";
    await alert.getByRole("button", { name: "Tentar novamente" }).click();
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }

  {
    // Instrutor: o painel dele não usa as peças do painel do aluno; desde a Expansão 4 tem a composição própria
    // (.teacher-home), também na fonte do sistema.
    const { context, page, errors } = await open({ role: "instructor" });
    await page.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.equal(await page.locator(".student-home").count(), 0);
    assert.equal(await page.locator(".teacher-home").count(), 1);
    assert.match(await page.locator(".layout").evaluate((el) => getComputedStyle(el).fontFamily), /^system-ui/);
    assert.deepEqual(errors, []);
    await context.close();
  }

  {
    // Movimento reduzido: nenhuma transição no piloto; o estado aberto da ajuda continua visível pela seta girada.
    const { context, page } = await open({ reducedMotion: "reduce" });
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    const durations = await page.evaluate(() => [".student-home .journey .button", ".student-home .next-summary .button", ".student-home summary"]
      .map((s) => getComputedStyle(document.querySelector(s)).transitionDuration));
    assert.deepEqual([...new Set(durations)], ["0s"]);
    const summary = page.locator(".grade-context summary");
    const closed = await summary.evaluate((el) => getComputedStyle(el, "::before").transform);
    await summary.click();
    assert.notEqual(await summary.evaluate((el) => getComputedStyle(el, "::before").transform), closed);
    await context.close();
  }

  for (const width of [320, 390, 768, 1440]) {
    const { context, page } = await open({ width });
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sem rolagem lateral em ${width}px`);
    const kcTop = await page.locator(".student-summary .goal").first().evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(kcTop < 800, `média de KC na primeira tela em ${width}px`);
    await context.close();
  }

  console.log("Piloto visual do aluno: escopo, estados, foco, movimento reduzido, gráfico, arredondamento e 4 larguras OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

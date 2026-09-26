// Teste isolado com API fictícia. Nunca acessa dados AWS reais.
// "Visualizar como aluno": o admin, ainda autenticado como admin, abre as telas do aluno
// (Desempenho, Atividades, Histórico) somente leitura, a partir de Turmas e acessos.
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
// Só a parte da URL que o portal controla (caminho, query e hash); a porta aleatória do servidor
// de teste pode conter "101" sem que o ID do aluno esteja exposto.
const appUrlPart = (url) => { const u = new URL(url); return u.pathname + u.search + u.hash; };
assert.doesNotMatch(appUrlPart("http://127.0.0.1:61101/?modo=visualizar-aluno"), /101/);
for (const leaked of ["http://127.0.0.1:5000/?studentId=101", "http://127.0.0.1:5000/aluno/101", "http://127.0.0.1:5000/#101"])
  assert.match(appUrlPart(leaked), /101/, leaked);

const activity = (n, name, kind, percent, state, module) => ({ id: `${name} (${n})`, name, kind, points: "100", active: state !== "unreleased",
  filled: 10, score: percent, percent, state, needsReview: false, module, moduleOrder: n < 3 ? 0 : 1 });
const studentReport = {
  cohort: "BRSA0267",
  publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" },
  updatedAt: "2026-09-24T21:00:00Z", updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, canvasCourseId: null,
  focus: { activityIds: [], version: null },
  student: { id: "101", name: "Ana Beatriz de Albuquerque Figueiredo Santos Nascimento Pereira", email: "ana@example.test",
    kc: 80, lab: 50, total: 65, progress: 75, pending: 1, completed: 3, status: "attention",
    activities: [
      activity(1, "001 KC Introdução", "kc", 80, "completed", "Cloud Foundations"),
      activity(2, "002 Lab Console", "lab", 100, "completed", "Cloud Foundations"),
      activity(3, "003 KC Linux", "kc", 80, "completed", "Linux"),
      activity(4, "004 Lab Arquivos", "lab", null, "pending", "Linux"),
      activity(5, "005 KC Redes", "kc", null, "unreleased", "Linux"),
    ] },
  history: [
    { publishedAt: "2026-09-24T21:00:00Z", current: true, kc: 80, lab: 50, total: 65,
      changes: { kc: 10, lab: 0, pendingBefore: 2, pendingAfter: 1, activities: [{ name: "003 KC Linux", before: null, after: 80, previousState: "pending", state: "completed" }], removed: [] } },
    { publishedAt: "2026-09-17T21:00:00Z", current: false, kc: 70, lab: 50, total: 60, changes: null },
  ],
};
const adminReport = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, students: [], activities: [], history: [],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: "2026-09-24T21:00:00Z" };

let browser;
try {
  browser = await chromium.launch({ headless: true });

  // Uma API fictícia por contexto (as abas do mesmo contexto compartilham a mesma API).
  async function openContext(role, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Sao_Paulo" });
    const api = { viewCalls: [], mutations: [], viewStatus: 200, errors: [] };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: `${role}@example.test` } });
      if (endpoint === "/cohorts")
        return route.fulfill({ json: { cohorts: ["BRSA0267", "BRSA0268"].map((code) => ({ code, canTeach: role !== "student" })) } });
      if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
      if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? studentReport : adminReport });
      if (endpoint === "/cohorts/BRSA0267/students-search")
        return route.fulfill({ json: { results: [{ id: "101", name: studentReport.student.name, email: "ana@example.test", bound: false, boundEmail: null, boundAt: null }] } });
      if (endpoint === "/cohorts/BRSA0267/student-view" && request.method() === "POST") {
        api.viewCalls.push(request.postDataJSON());
        if (api.viewStatus !== 200) return route.fulfill({ status: api.viewStatus, json: { error: "Aluno não encontrado nesta turma." } });
        return route.fulfill({ json: { ...studentReport, viewAs: { studentId: "101", name: studentReport.student.name } } });
      }
      api.mutations.push(`${request.method()} ${endpoint}`);
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const newPage = async () => {
      const page = await context.newPage();
      page.on("pageerror", (error) => api.errors.push(error.message));
      page.on("dialog", (dialog) => { api.errors.push("diálogo inesperado: " + dialog.message()); dialog.dismiss(); });
      return page;
    };
    return { context, api, newPage };
  }

  const banner = (page) => page.locator(".student-view-banner");
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  // Conteúdo da página sem a faixa e sem o cabeçalho de identidade: deve ser igual ao do aluno real.
  const pageContent = (page) => page.evaluate(() => {
    const main = document.querySelector("main").cloneNode(true);
    main.querySelectorAll(".topline, .student-view-banner").forEach((el) => el.remove());
    return main.innerText;
  });
  async function enterFromAccess(page) {
    await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await page.locator("#student-query").fill("ana");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.getByRole("button", { name: "Visualizar como aluno", exact: true }).click();
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
  }

  // Referência: o que o próprio aluno vê em cada página.
  const reference = {};
  {
    const { context, api, newPage } = await openContext("student");
    const page = await newPage();
    await page.goto(origin);
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    reference.overview = await pageContent(page);
    await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
    await page.getByRole("heading", { name: "Minhas atividades" }).waitFor();
    reference.activities = await pageContent(page);
    await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Meu histórico" }).waitFor();
    reference.history = await pageContent(page);
    // O aluno não tem Acessos nem o botão, e a marca na URL com registro forjado não ativa nada.
    assert.equal(await page.getByRole("button", { name: "Turmas e acessos" }).count(), 0);
    await page.evaluate(() => sessionStorage.setItem("avanca.student-view", JSON.stringify({ owner: "student@example.test", code: "BRSA0267", studentId: "202", view: "overview" })));
    await page.goto(origin + "/?modo=visualizar-aluno");
    await page.getByRole("heading", { name: "Meu histórico" }).waitFor(); // última página do aluno
    assert.equal(new URL(page.url()).search, "", "marca descartada fora do modo");
    assert.equal(await banner(page).count(), 0);
    assert.equal(await page.getByText("Visualizar como aluno").count(), 0);
    assert.deepEqual(api.viewCalls, []);
    assert.deepEqual(api.errors, []);
    await context.close();
  }

  // Instrutor (não admin): sem Acessos e sem o botão.
  {
    const { context, api, newPage } = await openContext("instructor");
    const page = await newPage();
    await page.goto(origin);
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Turmas e acessos" }).count(), 0);
    assert.equal(await page.getByText("Visualizar como aluno").count(), 0);
    assert.deepEqual(api.viewCalls, []);
    await context.close();
  }

  // Admin: entrar, navegar, recarregar, outra aba, sair, trocar de turma, aluno removido.
  {
    const { context, api, newPage } = await openContext("admin");
    const page = await newPage();
    await page.goto(origin);
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    await enterFromAccess(page);
    assert.deepEqual(api.viewCalls, [{ studentId: "101" }]);

    // Faixa e identidade: admin real separado do aluno visualizado.
    const name = studentReport.student.name;
    assert.match(await banner(page).innerText(), new RegExp(`Visualizando como: ${name}`));
    assert.match(await banner(page).innerText(), /Modo administrador · somente leitura/);
    assert.ok(await banner(page).getByRole("button", { name: "Sair da visualização" }).isVisible());
    const identity = await page.locator(".session-context").innerText();
    assert.match(identity, /Admin: admin@example\.test/);
    assert.match(identity, new RegExp(`Visualizando: ${name}`));
    assert.match(await page.locator(".account").innerText(), /admin/);
    assert.doesNotMatch(await page.locator(".account").innerText(), /Ana/);

    // Menu do aluno, sem as áreas de instrutor e administração.
    for (const label of ["Meu desempenho", "Minhas atividades", "Meu histórico"])
      assert.ok(await page.getByRole("button", { name: label, exact: true }).isVisible());
    for (const label of ["Turmas e acessos", "Atualizar notas", "Lembretes", "Painel do instrutor"])
      assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, label);

    // Estado só nesta aba: URL sem o ID do aluno, nada em avanca.context.
    assert.equal(new URL(page.url()).search, "?modo=visualizar-aluno");
    assert.doesNotMatch(appUrlPart(page.url()), /101/);
    const stored = await page.evaluate(() => ({ local: localStorage.getItem("avanca.context") || "", session: sessionStorage.getItem("avanca.student-view") }));
    assert.doesNotMatch(stored.local, /101|studentView|student-view/);
    assert.equal(JSON.parse(stored.session).studentId, "101");

    // As três páginas com o mesmo conteúdo que o aluno real vê.
    assert.equal(await pageContent(page), reference.overview);
    await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
    await page.getByRole("heading", { name: "Minhas atividades" }).waitFor();
    assert.equal(await pageContent(page), reference.activities);
    await page.locator('.tab[data-filter="pending"]').click();
    assert.equal(await page.locator("#activity-list .activity-card").count(), 1);
    await page.getByRole("button", { name: "Meu histórico", exact: true }).click();
    await page.getByRole("heading", { name: "Meu histórico" }).waitFor();
    assert.equal(await pageContent(page), reference.history);
    assert.equal(api.viewCalls.length, 1, "trocar de página não chama a API de novo");

    // Recarregar mantém o modo e a página, revalidando no servidor.
    await page.reload();
    await page.getByRole("heading", { name: "Meu histórico" }).waitFor();
    assert.ok(await banner(page).isVisible());
    assert.equal(api.viewCalls.length, 2);

    // Outra aba do mesmo navegador continua como admin normal.
    const other = await newPage();
    await other.goto(origin);
    await other.getByRole("button", { name: "Turmas e acessos", exact: true }).waitFor();
    assert.equal(await banner(other).count(), 0);
    assert.doesNotMatch(await other.locator(".session-context").innerText(), /Visualizando/);
    assert.equal(api.viewCalls.length, 2);
    await other.close();
    assert.ok(await banner(page).isVisible(), "a aba original continua no modo");

    // Sair volta para Turmas e acessos como admin.
    await banner(page).getByRole("button", { name: "Sair da visualização" }).click();
    await page.getByRole("heading", { name: "Turmas e acessos" }).waitFor();
    assert.equal(await banner(page).count(), 0);
    assert.equal(new URL(page.url()).search, "");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("avanca.student-view")), null);
    assert.ok(await page.getByRole("button", { name: "Turmas e acessos", exact: true }).isVisible());
    await page.reload();
    await page.getByRole("heading", { name: "Turmas e acessos" }).waitFor();
    assert.equal(await banner(page).count(), 0);
    assert.equal(api.viewCalls.length, 2);

    // Trocar de turma sai do modo.
    await page.locator("#student-query").fill("ana");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.getByRole("button", { name: "Visualizar como aluno", exact: true }).click();
    await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
    await page.locator("#cohort").selectOption("BRSA0268");
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    assert.equal(await banner(page).count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("avanca.student-view")), null);

    // Aluno removido da turma: ao recarregar, o servidor recusa e o modo termina com aviso.
    await page.locator("#cohort").selectOption("BRSA0267");
    await enterFromAccess(page);
    api.viewStatus = 404;
    await page.reload();
    await page.getByRole("heading", { name: "Turmas e acessos" }).waitFor();
    await page.getByText(/Não foi possível visualizar este aluno: Aluno não encontrado nesta turma\./).waitFor();
    assert.equal(await banner(page).count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("avanca.student-view")), null);

    assert.deepEqual(api.mutations, [], "nenhuma outra chamada à API durante os testes");
    assert.deepEqual(api.errors, []);
    await context.close();
  }

  // Larguras: faixa sempre visível (também ao rolar) e sem rolagem lateral.
  for (const width of [375, 768, 1440]) {
    const { context, api, newPage } = await openContext("admin", width);
    const page = await newPage();
    await page.goto(origin);
    await page.getByRole("button", { name: "Turmas e acessos", exact: true }).waitFor();
    await enterFromAccess(page);
    for (const [label, heading] of [["Meu desempenho", "Seu resumo"], ["Minhas atividades", "Minhas atividades"], ["Meu histórico", "Meu histórico"]]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("heading", { name: heading }).first().waitFor();
      assert.ok(await noHorizontalScroll(page), `sem rolagem lateral em ${label} (${width}px)`);
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      const box = await banner(page).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 900, `faixa visível ao rolar em ${label} (${width}px)`);
      const fits = await page.evaluate(() => [...document.querySelectorAll(".student-view-banner, .student-view-banner *")].every((el) => el.getBoundingClientRect().right <= innerWidth + 0.5));
      assert.ok(fits, `faixa dentro da tela em ${width}px`);
      if (width < 760) {
        // A barra inferior do aluno continua fixa e não cobre a faixa.
        assert.equal(await page.locator(".sidebar nav").evaluate((el) => getComputedStyle(el).position), "fixed");
        const navTop = await page.locator(".sidebar nav").evaluate((el) => el.getBoundingClientRect().top);
        assert.ok(box.y + box.height <= navTop);
      }
      await page.evaluate(() => scrollTo(0, 0));
      if (process.env.STUDENT_VIEW_SCREENSHOTS)
        await page.screenshot({ path: path.join(process.env.STUDENT_VIEW_SCREENSHOTS, `student-view-${width}-${heading.split(" ")[0].toLowerCase()}.png`), fullPage: false });
    }
    assert.deepEqual(api.mutations, []);
    assert.deepEqual(api.errors, []);
    await context.close();
  }
  console.log("Visualizar como aluno: entrada, faixa, identidade, 3 páginas iguais às do aluno, refresh, outra aba, saída, troca de turma, aluno removido e 375/768/1440 OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

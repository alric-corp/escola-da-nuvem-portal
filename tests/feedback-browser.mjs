// Teste isolado com API fictícia. Nunca acessa dados AWS reais.
// Feedback da plataforma: aluno envia e acompanha os próprios; admin lista, filtra, muda status
// e abre "Visualizar como aluno" a partir de um feedback.
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

const activity = (n, name, state, percent) => ({ id: `${name} (${n})`, name, kind: "kc", points: "100", active: true, filled: 10, score: percent, percent, state, needsReview: false });
const studentReport = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, updatedAt: "2026-09-24T21:00:00Z", updateKind: "canvas",
  thresholds: { kc: 70, lab: 95 }, canvasCourseId: null, focus: { activityIds: [], version: null }, history: [],
  student: { id: "101", name: "Ana Souza", email: "ana@example.test", kc: 80, lab: null, total: 80, progress: 50, pending: 1, completed: 1, status: "insufficient",
    activities: [activity(1, "001 KC Introdução", "completed", 80), activity(2, "002 KC Linux", "pending", null)] } };
const adminReport = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, students: [], activities: [], history: [],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: "2026-09-24T21:00:00Z" };
const longWord = "x".repeat(140);
const feedbackItem = (i, extra = {}) => ({ id: `20260926T12000000000${i}-0000000${i}`, type: "BUG", title: `Relato ${i}`, description: `Descrição ${i}`,
  status: "NEW", createdAt: `2026-09-2${6 - (i % 3)}T12:00:00Z`, cohort: "BRSA0267", page: "activities", updatedAt: "2026-09-26T12:00:00Z", ...extra });
const adminItems = [
  feedbackItem(1, { title: "KC aparece como pendente", description: `Linha 1\nLinha 2 <script>alert(1)</script> ${longWord}`, createdByEmail: "ana@example.test",
    createdBy: "s1", canvasId: "101", publicationId: "p2", studentName: "Ana Souza", inCohort: true, canViewAsStudent: true, statusHistory: [] }),
  feedbackItem(2, { type: "SUGGESTION", title: "Adicionar modo escuro", status: "IN_REVIEW", createdByEmail: "saiu@example.test", createdBy: "s2", canvasId: "202",
    publicationId: "p1", studentName: null, inCohort: false, canViewAsStudent: false, page: "history", statusHistory: [] }),
];

let browser;
try {
  browser = await chromium.launch({ headless: true });
  async function open(role, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Sao_Paulo" });
    const api = { posts: [], gets: [], statusPosts: [], viewCalls: [], errors: [], dialogs: 0, mine: [], rateLimited: false };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: `${role}@example.test` } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student" }, { code: "BRSA0268", canTeach: role !== "student" }] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? studentReport : adminReport });
      if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
      if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
      if (endpoint === "/feedback" && request.method() === "POST") {
        const body = request.postDataJSON();
        api.posts.push(body);
        if (api.rateLimited) return route.fulfill({ status: 429, json: { error: "Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde." } });
        const item = { id: `20260926T13000000000${api.posts.length}-aaaaaaaa`, ...body, status: "NEW", createdAt: "2026-09-26T13:00:00Z", updatedAt: "2026-09-26T13:00:00Z" };
        api.mine.unshift(item);
        return route.fulfill({ json: { feedback: item, duplicate: false } });
      }
      if (endpoint === "/feedback") {
        api.gets.push(Object.fromEntries(url.searchParams));
        const all = [...api.mine, ...Array.from({ length: 22 }, (_, i) => feedbackItem(i + 3, { title: i === 0 ? "<script>alert(1)</script>" : `Antigo ${i}` }))];
        const start = url.searchParams.get("cursor") ? 20 : 0;
        return route.fulfill({ json: { items: all.slice(start, start + 20), nextCursor: start === 0 && all.length > 20 ? "Y3Vyc29y" : null } });
      }
      if (endpoint === "/admin/feedback") {
        api.gets.push(Object.fromEntries(url.searchParams));
        const status = url.searchParams.get("status");
        const items = adminItems.filter((f) => !status || f.status === status || status === "ALL");
        return route.fulfill({ json: { items, nextCursor: null, summary: { NEW: 1, IN_REVIEW: 1, RESOLVED: 0, ARCHIVED: 3 } } });
      }
      const statusMatch = endpoint.match(/^\/admin\/feedback\/([^/]+)\/status$/);
      if (statusMatch) {
        const body = request.postDataJSON();
        api.statusPosts.push({ id: decodeURIComponent(statusMatch[1]), ...body });
        const item = adminItems.find((f) => f.id === decodeURIComponent(statusMatch[1]));
        return route.fulfill({ json: { feedback: { ...item, status: body.status, updatedBy: "admin", updatedAt: "2026-09-26T14:00:00Z" } } });
      }
      if (endpoint === "/cohorts/BRSA0267/student-view") {
        api.viewCalls.push(request.postDataJSON());
        return route.fulfill({ json: { ...studentReport, viewAs: { studentId: "101", name: "Ana Souza" } } });
      }
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => api.errors.push(error.message));
    page.on("dialog", (dialog) => { api.dialogs++; dialog.dismiss(); });
    await page.goto(origin);
    return { context, page, api };
  }
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const navItems = (page) => page.locator(".sidebar nav .nav-item").evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect(), short = el.querySelector(".nav-short");
    // Rótulo curto em uma linha só (sem quebrar no meio da palavra) e sem transbordar.
    const oneLine = getComputedStyle(short).display === "none" || short.getBoundingClientRect().height <= parseFloat(getComputedStyle(short).lineHeight) * 1.3;
    return { label: el.querySelector(".nav-label").textContent, h: r.height, w: r.width, oneLine,
      clipped: !oneLine || el.scrollWidth > el.clientWidth + 1 || short.scrollWidth > short.clientWidth + 1, inside: r.left >= 0 && r.right <= innerWidth };
  }));

  for (const width of [375, 768, 1440]) {
    // Aluno: 4 itens no menu, Feedback a partir de Atividades, envio e "Meus feedbacks".
    {
      const { context, page, api } = await open("student", width);
      await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
      const items = await navItems(page);
      assert.deepEqual(items.map((i) => i.label), ["Meu desempenho", "Minhas atividades", "Meu histórico", "Feedback"]);
      assert.ok(items.every((i) => i.h >= 44 && !i.clipped && i.inside), `menu do aluno legível em ${width}px: ${JSON.stringify(items)}`);
      await page.getByRole("button", { name: "Minhas atividades", exact: true }).click();
      await page.getByRole("heading", { name: "Minhas atividades" }).waitFor();
      await page.getByRole("button", { name: "Feedback", exact: true }).click();
      await page.getByRole("heading", { name: "Ajude a melhorar a plataforma" }).waitFor();
      assert.match(await page.locator(".feedback-origin").innerText(), /Sobre: Atividades/);
      await page.getByText("<script>alert(1)</script>", { exact: true }).waitFor();  // texto, não HTML
      assert.equal(await page.locator(".feedback-list script").count(), 0);
      // Validação local antes de enviar: sem tipo, nada vai para a API.
      await page.locator("#fb-title").fill("KC aparece como pendente");
      await page.locator("#fb-description").fill("A atividade 254 continua sem nota depois da correção.");
      await page.getByRole("button", { name: "Enviar feedback" }).click();
      await page.getByText("Escolha o tipo do feedback.").waitFor();
      assert.equal(api.posts.length, 0);
      await page.locator(".fb-type-option", { hasText: "Bug" }).click();
      assert.equal(await page.locator("#fb-title").inputValue(), "KC aparece como pendente", "o texto digitado continua no formulário");
      assert.equal(await page.locator("#fb-description-count").innerText(), "53/2000");
      assert.ok(await noOverflow(page), `formulário sem rolagem lateral em ${width}px`);
      if (process.env.FEEDBACK_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOTS, `feedback-aluno-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Enviar feedback" }).click();
      await page.locator(".feedback-success").waitFor();
      assert.equal(await page.locator(".feedback-success").innerText(), "Feedback enviado com sucesso.");
      assert.deepEqual(api.posts[0], { type: "BUG", title: "KC aparece como pendente", description: "A atividade 254 continua sem nota depois da correção.",
        cohort: "BRSA0267", page: "activities" });
      assert.equal(await page.locator("#fb-title").inputValue(), "");
      const first = page.locator(".feedback-list .feedback-card").first();
      assert.match(await first.innerText(), /Bug\s+Novo\s+KC aparece como pendente\s+26\/09\/2026/);
      // Paginação: "Carregar mais" pede a próxima página com o cursor do backend.
      assert.equal(await page.locator(".feedback-list .feedback-card").count(), 20);
      await page.getByRole("button", { name: "Carregar mais" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".feedback-list .feedback-card").length === 23);
      assert.deepEqual(api.gets.at(-1), { limit: "20", cursor: "Y3Vyc29y" });
      assert.equal(await page.getByRole("button", { name: "Carregar mais" }).count(), 0);
      // Limite por hora: a mensagem do backend aparece.
      api.rateLimited = true;
      await page.locator(".fb-type-option", { hasText: "Sugestão" }).click();
      await page.locator("#fb-title").fill("Outra ideia");
      await page.locator("#fb-description").fill("Mais uma sugestão para o portal.");
      await page.getByRole("button", { name: "Enviar feedback" }).click();
      await page.getByText("Você já enviou 5 feedbacks nesta hora. Tente novamente mais tarde.").waitFor();
      assert.equal(await page.locator("#fb-title").inputValue(), "Outra ideia", "o rascunho fica quando o envio falha");
      assert.ok(await noOverflow(page), `lista sem rolagem lateral em ${width}px`);
      assert.equal(await page.locator(".footer-feedback").count(), 0, "aluno usa o menu, não o rodapé");
      assert.deepEqual([api.errors, api.dialogs], [[], 0]);
      await context.close();
    }
    // Admin: 6 itens, resumo, filtros, detalhe, status e Visualizar como aluno.
    {
      const { context, page, api } = await open("admin", width);
      await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
      const items = await navItems(page);
      assert.equal(items.length, 6);
      assert.equal(items.at(-1).label, "Feedbacks");
      assert.ok(items.every((i) => i.h >= 44 && !i.clipped && i.inside), `menu do admin em ${width}px: ${JSON.stringify(items)}`);
      assert.equal(await page.locator(".footer-feedback").count(), 1, "admin envia pelo link do rodapé");
      await page.getByRole("button", { name: "Feedbacks", exact: true }).click();
      await page.getByRole("heading", { name: "Feedbacks", exact: true }).waitFor();
      await page.locator(".fb-open").first().waitFor();
      assert.deepEqual(api.gets.at(-1), { limit: "50" }, "sem filtro: arquivados ficam de fora no backend");
      assert.match(await page.locator(".fb-summary").innerText(), /Todos\s+2\s+Novos\s+1\s+Em análise\s+1\s+Resolvidos\s+0/);
      await page.locator("#fb-filter-status").selectOption("ARCHIVED");
      await page.waitForFunction(() => document.querySelector("#fb-filter-status")?.value === "ARCHIVED");
      await page.getByText("Nenhum feedback neste filtro.").waitFor();
      assert.equal(api.gets.at(-1).status, "ARCHIVED");
      await page.locator("#fb-filter-status").selectOption("");
      await page.locator(".fb-open").first().waitFor();
      await page.locator("#fb-filter-type").selectOption("SUGGESTION");
      await page.locator(".fb-open").first().waitFor();
      assert.deepEqual(api.gets.at(-1), { limit: "50", type: "SUGGESTION" });
      await page.locator("#fb-filter-type").selectOption("");
      await page.locator("#fb-filter-cohort").selectOption("BRSA0268");
      await page.locator(".fb-open").first().waitFor();
      assert.deepEqual(api.gets.at(-1), { limit: "50", cohort: "BRSA0268" });
      await page.locator("#fb-filter-cohort").selectOption("");
      await page.locator(".fb-open").first().waitFor();
      await page.locator('[data-fb-status="IN_REVIEW"]').click();
      await page.waitForFunction(() => document.querySelectorAll(".fb-open").length === 1);
      assert.equal(api.gets.at(-1).status, "IN_REVIEW");
      await page.locator('[data-fb-status=""]').click();
      await page.waitForFunction(() => document.querySelectorAll(".fb-open").length === 2);
      assert.ok(await noOverflow(page), `lista e filtros sem rolagem lateral em ${width}px`);
      if (process.env.FEEDBACK_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOTS, `feedback-admin-lista-${width}.png`), fullPage: true });
      // Aluno que saiu da turma: sem botão de visualizar, com e-mail.
      await page.locator(".fb-open", { hasText: "Adicionar modo escuro" }).click();
      await page.locator(".fb-detail").waitFor();
      assert.match(await page.locator(".fb-facts").innerText(), /Fora da turma atual \(Canvas ID 202\)[\s\S]*saiu@example\.test[\s\S]*Histórico/);
      assert.equal(await page.getByRole("button", { name: "Visualizar como aluno" }).count(), 0);
      await page.locator("[data-fb-back]").click();
      // Detalhe completo, texto puro com quebras de linha.
      await page.locator(".fb-open", { hasText: "KC aparece como pendente" }).click();
      const detail = page.locator(".fb-detail");
      await detail.waitFor();
      assert.equal(await page.locator(".fb-description").innerText(), `Linha 1\nLinha 2 <script>alert(1)</script> ${longWord}`);
      assert.equal(await page.locator(".fb-detail script").count(), 0);
      assert.equal(await page.locator(".fb-description").evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap");
      const facts = await page.locator(".fb-facts").innerText();
      for (const expected of ["Ana Souza", "ana@example.test", "BRSA0267", "Atividades", "p2"]) assert.ok(facts.includes(expected), expected);
      assert.ok(await noOverflow(page), `detalhe sem rolagem lateral em ${width}px`);
      if (process.env.FEEDBACK_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOTS, `feedback-admin-detalhe-${width}.png`), fullPage: true });
      await page.locator("#fb-status-select").selectOption("RESOLVED");
      await page.getByRole("button", { name: "Salvar status" }).click();
      await page.getByText("Status do feedback atualizado.").waitFor();
      assert.deepEqual(api.statusPosts.at(-1), { id: adminItems[0].id, status: "RESOLVED", expectedStatus: "NEW" });
      assert.match(await detail.locator(".fb-status").innerText(), /Resolvido/);
      // Visualizar como aluno reaproveita o modo existente e volta para o feedback.
      await page.getByRole("button", { name: "Visualizar como aluno" }).click();
      await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
      assert.deepEqual(api.viewCalls, [{ studentId: "101" }]);
      assert.match(await page.locator(".student-view-banner").innerText(), /Visualizando como: Ana Souza/);
      const viewNav = (await navItems(page)).map((i) => i.label);
      assert.deepEqual(viewNav, ["Meu desempenho", "Minhas atividades", "Meu histórico"], "sem Feedback nem áreas de admin no modo aluno");
      assert.equal(await page.locator(".footer-feedback").count(), 0);
      await page.reload();
      await page.getByRole("heading", { name: "Seu resumo" }).waitFor();
      assert.equal(JSON.parse(await page.evaluate(() => sessionStorage.getItem("avanca.student-view"))).returnTo.view, "admin-feedback");
      await page.getByRole("button", { name: "Sair da visualização" }).click();
      await page.locator(".fb-detail").waitFor();
      assert.match(await page.locator(".fb-detail h2").innerText(), /KC aparece como pendente/);
      assert.equal(await page.locator(".student-view-banner").count(), 0);
      assert.deepEqual([api.errors, api.dialogs], [[], 0]);
      await context.close();
    }
  }

  // Instrutor: link discreto no rodapé, sem área de admin.
  {
    const { context, page, api } = await open("instructor");
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Feedbacks", exact: true }).count(), 0);
    await page.locator(".footer-feedback").click();
    await page.getByRole("heading", { name: "Ajude a melhorar a plataforma" }).waitFor();
    assert.match(await page.locator(".feedback-origin").innerText(), /Sobre: Painel do instrutor/);
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  }
  console.log("Feedback: menu do aluno (4) e do admin (6), envio, origem, texto puro, paginação, 429, filtros, detalhe, status, Visualizar como aluno e 375/768/1440 OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

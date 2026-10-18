// C7.5 (TODO 24) no navegador: API local com estado, nenhuma chamada à AWS. Cobre 409 com servidor que aplica
// expectedStatus, erro em "Carregar mais" visível no DOM e foco depois de renders assíncronos.
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

const entry = (i, extra = {}) => ({ id: `fb-${i}`, type: "BUG", title: `Relato ${i}`, description: `Descrição ${i} completa`, status: "NEW",
  createdAt: "2026-09-26T12:00:00Z", updatedAt: "2026-09-26T12:00:00Z", cohort: "BRSA0267", page: "activities", createdByEmail: "ana@example.test",
  createdBy: "s1", canvasId: "101", studentName: "Ana Souza", inCohort: true, canViewAsStudent: false, publicationId: "p2", statusHistory: [], ...extra });
const studentReport = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, updatedAt: "2026-09-24T21:00:00Z", updateKind: "canvas",
  thresholds: { kc: 70, lab: 95 }, canvasCourseId: null, focus: { activityIds: [], version: null }, history: [],
  student: { id: "101", name: "Ana Souza", email: "ana@example.test", kc: 80, lab: null, total: 80, progress: 50, pending: 0, completed: 1, status: "insufficient", activities: [] } };
const adminReport = { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, students: [], activities: [], history: [],
  thresholds: { kc: 70, lab: 95 }, focus: { activityIds: [], version: null }, updateKind: "canvas", updatedAt: "2026-09-24T21:00:00Z" };

let browser;
try {
  browser = await chromium.launch({ headless: true });
  // `server` guarda o estado real do backend fictício: o status só muda se expectedStatus coincidir.
  async function open(role, emails = [`${role}@example.test`]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Sao_Paulo" });
    const api = { items: [entry(1), entry(2)], mine: [], statusPosts: [], errors: [], dialogs: 0, failMore: false, adminPages: null, minePages: null, gets: [], emails, meCalls: 0 };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
    // Prévias locais criadas e liberadas pela página (URL.createObjectURL/revokeObjectURL).
    await context.addInitScript(() => {
      window.__urls = { created: [], revoked: [] };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { const url = create(blob); window.__urls.created.push(url); return url; };
      URL.revokeObjectURL = (url) => { window.__urls.revoked.push(url); revoke(url); };
    });
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: api.emails[Math.min(api.meCalls++, api.emails.length - 1)] } });
      if (endpoint === "/requests") return route.fulfill({ json: { requests: [] } });
      if (/^\/cohorts\/[^/]+\/instructors$/.test(endpoint)) return route.fulfill({ json: { instructors: [] } });
      if (request.method() === "POST" && endpoint === "/cohorts/BRSA0267/settings") return route.fulfill({ json: {} });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student" }] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? studentReport : adminReport });
      if (endpoint === "/admin/feedback") {
        const cursor = url.searchParams.get("cursor");
        api.gets.push({ cursor });
        if (cursor && api.failMore) { api.failMore = false; return route.fulfill({ status: 500, json: { error: "Falha fictícia ao carregar mais." } }); }
        const pages = api.adminPages;
        const items = pages ? (cursor ? pages[1] : pages[0]) : api.items;
        return route.fulfill({ json: { items, nextCursor: pages && !cursor ? "c1" : null, summary: { NEW: items.length, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 } } });
      }
      const status = endpoint.match(/^\/admin\/feedback\/([^/]+)\/status$/);
      if (status) {
        const body = request.postDataJSON(), item = api.items.find((f) => f.id === status[1]);
        api.statusPosts.push({ id: item.id, ...body });
        if (item.status !== body.expectedStatus) return route.fulfill({ status: 409, json: { error: "O status deste feedback foi alterado por outra pessoa. Recarregue e tente de novo." } });
        item.status = body.status;
        return route.fulfill({ json: { feedback: item } });
      }
      if (endpoint === "/feedback") {
        const cursor = url.searchParams.get("cursor");
        api.gets.push({ cursor });
        if (cursor && api.failMore) { api.failMore = false; return route.fulfill({ status: 500, json: { error: "Falha fictícia ao carregar mais." } }); }
        const pages = api.minePages;
        if (!pages) return route.fulfill({ json: { items: [], nextCursor: null } });
        return route.fulfill({ json: { items: cursor ? pages[1] : pages[0], nextCursor: cursor ? null : "c1" } });
      }
      let match = endpoint.match(/^\/feedback\/([^/]+)\/attachments$/);
      if (match) return (api.hold ? api.hold.promise : Promise.resolve()).then(() => route.fulfill({ json: { items: [{ attachmentId: "a1", originalName: "p.png", size: 1000 }] } }));
      if (/^\/feedback\/[^/]+\/attachments\/a1$/.test(endpoint)) return route.fulfill({ json: { downloadUrl: origin + "/logo.png" } });
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => api.errors.push(error.message));
    page.on("dialog", (dialog) => { api.dialogs++; dialog.dismiss(); });
    await page.goto(origin);
    await page.evaluate(async () => { window.__state = (await import("/state.js")).state; });
    return { context, page, api };
  }
  const failures = [];
  const block = async (name, fn) => { try { await fn(); console.log("ok:", name); } catch (err) { failures.push(name); console.log("FALHOU:", name, "->", err.message.split("\n")[0]); } };
  const focused = (page) => page.evaluate(() => { const el = document.activeElement; return { tag: el.tagName, id: el.id, text: el.textContent.trim().slice(0, 40), data: Object.keys(el.dataset).join(",") }; });
  const noticeTexts = (page) => page.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));
  const openAdminList = async (page) => {
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    await page.getByRole("button", { name: "Feedbacks", exact: true }).click();
    await page.locator(".fb-open").first().waitFor();
  };

  // 409: o servidor muda o status por trás (IN_REVIEW). A tela mostra o status real e a nova tentativa funciona.
  await block('admin 409 com servidor que aplica expectedStatus', async () => {
    const { context, page, api } = await open("admin");
    await openAdminList(page);
    await page.locator(".fb-open", { hasText: "Relato 1" }).click();
    await page.locator(".fb-detail").waitFor();
    api.items[0].status = "IN_REVIEW";                      // outra pessoa mudou
    await page.locator("#fb-status-select").selectOption("RESOLVED");
    const answered = page.waitForResponse((r) => r.url().includes("/status"));
    await page.getByRole("button", { name: "Salvar status" }).click();
    await answered;
    // Expansão 9: o erro fica junto da ação (role=alert), não num aviso solto.
    await page.waitForFunction(() => !!document.querySelector("#afb-op-status.is-error, #notices .notice"), null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.locator("#afb-op-status.is-error").count(), 1, "o erro junto da ação");
    assert.deepEqual(await noticeTexts(page), []);
    assert.match(await page.locator("#afb-op-status").innerText(), /^O status não foi alterado\. .*alterado por outra pessoa/);
    assert.ok(!(await page.getByText("Status do feedback atualizado.").count()), "409 não vira confirmação");
    assert.equal(await page.locator(".fb-detail").count(), 1, "o detalhe continua aberto");
    assert.match(await page.locator(".fb-detail .fb-status").innerText(), /Em análise/, "o badge mostra o status real");
    assert.equal(await page.locator("#fb-status-select").inputValue(), "IN_REVIEW", "o select concorda com o badge");
    assert.deepEqual(await focused(page), { tag: "DIV", id: "afb-op-status", text: (await focused(page)).text, data: "" }, "o foco vai ao erro, junto do campo em conflito");
    await page.locator("#fb-status-select").selectOption("RESOLVED");
    await page.getByRole("button", { name: "Salvar status" }).click();
    await page.getByText("Status do feedback atualizado.").waitFor();
    assert.deepEqual(api.statusPosts.map((p) => [p.status, p.expectedStatus]), [["RESOLVED", "NEW"], ["RESOLVED", "IN_REVIEW"]]);
    assert.match(await page.locator(".fb-detail .fb-status").innerText(), /Resolvido/);
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });

  // Foco: voltar à lista, salvar com sucesso.
  await block('admin foco ao salvar e ao voltar', async () => {
    const { context, page, api } = await open("admin");
    await openAdminList(page);
    await page.locator(".fb-open", { hasText: "Relato 2" }).click();
    await page.locator(".fb-detail").waitFor();
    await page.locator("#fb-status-select").selectOption("IN_REVIEW");
    await page.getByRole("button", { name: "Salvar status" }).click();
    await page.getByText("Status do feedback atualizado.").waitFor();
    assert.equal((await focused(page)).id, "fb-status-select", "depois de salvar o foco não cai em BODY");
    await page.locator("[data-fb-back]").click();
    await page.locator(".fb-open").first().waitFor();
    const back = await focused(page);
    assert.equal(back.tag, "BUTTON");
    assert.match(back.text, /Relato 2/, "voltar devolve o foco ao cartão que foi aberto");
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });

  // "Carregar mais" com erro: os itens continuam na tela, a nova tentativa pede a mesma página e não duplica.
  await block('admin Carregar mais com erro', async () => {
    const { context, page, api } = await open("admin");
    api.adminPages = [[entry(1), entry(2)], [entry(3)]];
    await openAdminList(page);
    api.failMore = true;
    await page.getByRole("button", { name: "Carregar mais" }).click();
    await page.getByText("Falha fictícia ao carregar mais.").waitFor();
    assert.equal(await page.locator(".fb-open").count(), 2, "os dois primeiros itens continuam visíveis");
    assert.equal(await page.getByRole("button", { name: "Tentar novamente" }).count(), 1);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".fb-open").length === 3);
    assert.deepEqual(api.gets.map((g) => g.cursor), [null, "c1", "c1"], "a repetição usa o mesmo cursor");
    assert.equal(await page.getByText("Falha fictícia ao carregar mais.").count(), 0);
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });
  await block('aluno Carregar mais com erro', async () => {
    const { context, page, api } = await open("student");
    api.minePages = [[entry(1), entry(2)], [entry(3)]];
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    await page.locator(".feedback-list .feedback-card").first().waitFor();
    api.failMore = true;
    await page.getByRole("button", { name: "Carregar mais" }).click();
    await page.getByText("Falha fictícia ao carregar mais.").waitFor();
    assert.equal(await page.locator(".feedback-list .feedback-card").count(), 2);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".feedback-list .feedback-card").length === 3);
    assert.deepEqual(api.gets.map((g) => g.cursor), [null, "c1", "c1"]);
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });

  // Foco: alternar anexos em "Meus feedbacks" mantém o foco no botão que foi acionado.
  await block('aluno foco ao alternar anexos', async () => {
    const { context, page, api } = await open("student");
    api.minePages = [[entry(1, { attachments: 1 })], []];
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    await page.locator(".feedback-card").first().waitFor();
    await page.getByRole("button", { name: "Ver anexos" }).click();
    await page.locator(".fb-gallery").waitFor();
    let now = await focused(page);
    assert.deepEqual([now.tag, now.text], ["BUTTON", "Ocultar anexos"], "depois de abrir, o foco continua no botão de anexos");
    await page.getByRole("button", { name: "Ocultar anexos" }).click();
    now = await focused(page);
    assert.deepEqual([now.tag, now.text], ["BUTTON", "Ver anexos"], "depois de ocultar, também");
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });
  // Foco escolhido pela pessoa não é roubado: a galeria demora, a pessoa vai para o título, a resposta chega.
  await block("foco escolhido pelo usuário durante a carga de anexos é preservado", async () => {
    const { context, page, api } = await open("student");
    api.minePages = [[entry(1, { attachments: 1 })], []];
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    await page.locator(".feedback-card").first().waitFor();
    let release; api.hold = { promise: new Promise((resolve) => { release = resolve; }) };
    await page.getByRole("button", { name: "Ver anexos" }).click();
    await page.locator("#fb-title").focus();
    release();
    await page.locator(".fb-gallery").waitFor();
    assert.equal((await focused(page)).id, "fb-title", "o foco continua onde a pessoa o colocou");
    await context.close();
  });
  // Troca de usuário no mesmo carregamento (o boot recebe outro /me): rascunho e imagens de A não passam para B.
  await block("troca de usuário reinicia o formulário e libera as prévias", async () => {
    const { context, page, api } = await open("admin", ["a-admin@example.test", "b-admin@example.test"]);
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    await page.getByRole("button", { name: "Feedbacks", exact: true }).click();
    await page.locator(".fb-open").first().waitFor();
    assert.equal(await page.evaluate(() => window.__state.adminFeedback.items.length), 2, "a fila de A está carregada");
    await page.locator(".footer-feedback").click();
    await page.locator("#fb-title").fill("Segredo de A");
    await page.locator("#fb-description").fill("Texto privado de A, longo o bastante");
    const chooser = page.waitForEvent("filechooser");
    await page.locator("[data-fb-pick=form]").click();
    await (await chooser).setFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await page.locator(".fb-file").waitFor();
    assert.deepEqual(await page.evaluate(() => [window.__urls.created.length, window.__urls.revoked.length]), [1, 0], "prévia em uso: nada liberado");
    await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    // Expansão 8: o aviso de quem salvou não aparece para quem entrou; a espera é pela pessoa nova no topo (o boot terminou).
    await page.locator(".session-context small").filter({ hasText: "b-admin@example.test" }).waitFor();
    assert.equal(api.meCalls, 2, "o boot consultou o /me de novo");
    assert.equal(await page.evaluate(() => window.__state.adminFeedback.items.length), 0, "a fila de A não passa para B");
    await page.locator(".footer-feedback").click();
    await page.locator("#fb-title").waitFor();
    assert.equal(await page.locator("#fb-title").inputValue(), "");
    assert.equal(await page.locator("#fb-description").inputValue(), "");
    assert.equal(await page.locator(".fb-file").count(), 0);
    assert.deepEqual(await page.evaluate(() => [window.__urls.created.length, window.__urls.revoked.length]), [1, 1], "a prévia de A foi liberada");
    assert.deepEqual([api.errors, api.dialogs], [[], 0]);
    await context.close();
  });
  // Mesmo usuário: o boot não apaga o que a pessoa digitou.
  await block("mesmo usuário mantém o rascunho no boot", async () => {
    const { context, page, api } = await open("admin", ["a-admin@example.test"]);
    await page.getByRole("button", { name: "Painel do instrutor", exact: true }).waitFor();
    await page.locator(".footer-feedback").click();
    await page.locator("#fb-title").fill("Continua aqui");
    await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    await page.getByText("Configurações da turma atualizadas.", { exact: true }).waitFor();
    await page.locator(".footer-feedback").click();
    assert.equal(await page.locator("#fb-title").inputValue(), "Continua aqui");
    await context.close();
  });
  if (failures.length) throw new Error(`${failures.length} bloco(s) falharam: ${failures.join("; ")}`);
  console.log("Feedback C7.5: 409 com servidor real, Carregar mais com erro (admin e aluno) e foco OK.");
} finally {
  await browser?.close();
  server.close();
}

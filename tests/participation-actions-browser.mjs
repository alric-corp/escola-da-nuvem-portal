// Ações de participação (C7.2.4) no navegador, com API fictícia e com estado: marcar como desistente e reativar pelo
// detalhe do aluno, com confirmação, uma requisição só, recarga real do relatório e do detalhe, 409 quando outra pessoa
// mudou antes, erros sem atualização otimista, CSV com a coluna Participação e larguras de 375 a 1440 px. Nunca chama
// API real; dados fictícios.
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

const ROSTER = [
  { id: "1", name: "Ana Ativa", email: "ana@example.test", kc: 80, lab: 96, total: 88, completed: 5, pending: 1, progress: 83, status: "ok", portalLinked: true },
  { id: "2", name: "Bruno Atenção", email: "bruno@example.test", kc: 60, lab: 96, total: 78, completed: 4, pending: 1, progress: 80, status: "attention", portalLinked: false },
  { id: "3", name: "Carla Crítica", email: null, kc: 40, lab: 50, total: 45, completed: 2, pending: 3, progress: 40, status: "critical", portalLinked: true },
];
const publication = { id: "pub-1", publishedAt: "2026-10-03T09:01:28Z" };
const CONFLICT = "A participação deste aluno foi alterada por outra pessoa. Recarregue e tente de novo.";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

let browser;
try {
  browser = await chromium.launch({ headless: true });

  // Uma aba com a API fictícia. marks: {canvasId: "WITHDRAWN"} — o estado do "backend", mutável pelo teste (outra
  // pessoa mudando) e pela própria rota de participação, que confere expectedStatus como o servidor real.
  async function open({ marks = {}, width = 1440 } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const log = { requests: [], posts: [], dialogs: [], errors: [], accept: true, handle: null, marks: { ...marks } };
    const roster = () => ROSTER.map((s) => (log.marks[s.id] ? { ...s, participationStatus: log.marks[s.id] } : { ...s }));
    log.apply = (body) => {
      const keys = Object.keys(body).sort().join(",");
      if (keys !== "canvasId,expectedStatus,status") return { status: 400, json: { error: "Solicitação inválida." } };
      const current = log.marks[body.canvasId] || "ACTIVE";
      if (current !== body.expectedStatus) return { status: 409, json: { error: CONFLICT } };
      if (body.status === "WITHDRAWN") log.marks[body.canvasId] = "WITHDRAWN";
      else delete log.marks[body.canvasId];
      return { json: { canvasId: body.canvasId, participationStatus: body.status, updatedAt: "2026-10-04T12:00:00Z" } };
    };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice(4);
      const op = endpoint.split("/")[3] || endpoint;
      const entry = { method: request.method(), op, body: request.postData() ? request.postDataJSON() : null };
      log.requests.push(entry);
      const custom = log.handle?.({ route, entry });
      if (custom) return custom;
      if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }] } });
      if (op === "report") return route.fulfill({ json: { students: roster(), publication, history: [], focus: { activityIds: [], version: null }, thresholds: { kc: 70, lab: 95 } } });
      if (op === "pending-preview") {
        const s = roster().find((x) => x.id === entry.body.studentId);
        return route.fulfill({ json: { student: { id: s.id, name: s.name, email: s.email }, publicationId: publication.id, publishedAt: publication.publishedAt, previewHash: `hash-${s.id}`,
          activities: [{ id: "k1", name: "001 KC Pendente", kind: "kc", state: "pending", active: true, points: "100" }], remindersEnabled: true, delivery: null,
          ses: { ready: true, reason: "Remetente confirmado." }, message: { from: "instrutor@example.test", to: s.email, subject: "Podemos ajudar?", text: `Olá, ${s.name}!` },
          ...(s.participationStatus ? { participationStatus: s.participationStatus } : {}) } });
      }
      if (op === "participation") { log.posts.push(entry.body); return route.fulfill(log.apply(entry.body)); }
      log.errors.push(`rota inesperada: ${entry.method} ${endpoint}`);
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const tab = await context.newPage();
    tab.on("pageerror", (error) => log.errors.push(error.message));
    tab.on("dialog", (dialog) => { log.dialogs.push({ type: dialog.type(), message: dialog.message() }); return log.accept ? dialog.accept() : dialog.dismiss(); });
    await tab.goto(origin);
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    return { context, tab, log };
  }
  const openDetail = async (tab, name) => {
    await tab.getByRole("button", { name: `Ver pendências de ${name}`, exact: true }).click();
    await tab.getByRole("heading", { name: `Pendências de ${name}`, exact: true }).waitFor();
    await tab.getByRole("heading", { name: "Participação na turma", exact: true }).waitFor();
  };
  const button = (tab, name) => tab.getByRole("button", { name, exact: true });
  const noticeTexts = (tab) => tab.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));
  const opsSince = (log, n) => log.requests.slice(n).map((r) => `${r.method} ${r.op}`);
  // Uma ida e volta de rede feita pela própria página: qualquer requisição que o app fosse disparar já teria saído.
  const flushNetwork = (tab) => tab.evaluate(() => fetch("/index.html", { cache: "no-store" }).then((r) => r.text()).then(() => true));
  // Atalhos de filtro da Situação da turma (Expansão 4; antes, cartões .metric): rótulo, número e legenda.
  const cardsOf = (tab) => tab.locator(".teacher-home .tp-filter").evaluateAll((els) => els.map((el) => [el.querySelector("span").textContent, el.querySelector("strong").textContent, el.querySelector("small").textContent]));
  const noPageScroll = (tab) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const insideViewport = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });

  // Marcar e reativar: confirmação com o nome, exatamente uma requisição com o corpo mínimo, recarga real do relatório
  // e do detalhe (o detalhe antes, para não sobrar o botão antigo), foco no título da participação, e os efeitos da C7.2.3 vindo do relatório recarregado.
  {
    const { context, tab, log } = await open();
    await openDetail(tab, "Ana Ativa");
    assert.equal(await button(tab, "Reativar aluno").count(), 0);
    let mark = log.requests.length;
    await button(tab, "Marcar como desistente").click();
    await button(tab, "Reativar aluno").waitFor();
    assert.deepEqual(log.dialogs, [{ type: "confirm", message: "Marcar Ana Ativa como desistente?\n\nO aluno deixará de participar das métricas e dos lembretes da turma. Os dados e notas do Canvas não serão removidos." }]);
    assert.deepEqual(log.posts, [{ canvasId: "1", status: "WITHDRAWN", expectedStatus: "ACTIVE" }]);
    assert.deepEqual(opsSince(log, mark), ["POST participation", "POST pending-preview", "GET report"]);
    await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).waitFor();
    assert.ok(await button(tab, "Enviar e-mail para este aluno").isDisabled());
    assert.equal(await button(tab, "Marcar como desistente").count(), 0);
    assert.equal(await tab.locator("main .badge.withdrawn").count(), 1);
    assert.equal(await tab.evaluate(() => document.activeElement.id), "participation-heading");
    assert.deepEqual(await noticeTexts(tab), [{ error: false, text: "Aluno marcado como desistente." }]);
    await button(tab, "Voltar ao painel").click();
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.deepEqual((await cardsOf(tab))[0], ["Alunos ativos", "2", "1 desistente"]);
    assert.deepEqual((await tab.locator("#status-filter option").evaluateAll((els) => els.map((el) => el.value))).slice(0, 3), ["all", "active", "withdrawn"]);
    assert.equal(await tab.locator(".teacher-home .tp-row .tp-tag:not(.is-portal)").count(), 1);

    await openDetail(tab, "Ana Ativa");
    mark = log.requests.length;
    await button(tab, "Reativar aluno").click();
    await button(tab, "Marcar como desistente").waitFor();
    assert.deepEqual(log.dialogs[1], { type: "confirm", message: "Reativar Ana Ativa?\n\nO aluno voltará a participar das métricas e poderá receber lembretes. Nada é alterado no Canvas." });
    assert.deepEqual(log.posts[1], { canvasId: "1", status: "ACTIVE", expectedStatus: "WITHDRAWN" });
    assert.deepEqual(opsSince(log, mark), ["POST participation", "POST pending-preview", "GET report"]);
    assert.equal(await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).count(), 0);
    assert.ok(await button(tab, "Enviar e-mail para este aluno").isEnabled());
    assert.equal(await tab.evaluate(() => document.activeElement.id), "participation-heading");
    assert.deepEqual((await noticeTexts(tab)).at(-1), { error: false, text: "Aluno reativado." });
    await button(tab, "Voltar ao painel").click();
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.deepEqual((await cardsOf(tab))[0], ["Alunos na publicação", "3", "Ver todos os alunos"]);
    assert.equal(await tab.locator('#status-filter option[value="withdrawn"]').count(), 0);
    assert.equal(await tab.locator(".teacher-home .tp-row .tp-tag:not(.is-portal)").count(), 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Cancelar nos dois sentidos: nenhuma requisição, nenhuma recarga, nenhum aviso; o foco fica no botão.
  {
    const { context, tab, log } = await open({ marks: { 2: "WITHDRAWN" } });
    log.accept = false;
    for (const [name, label] of [["Ana Ativa", "Marcar como desistente"], ["Bruno Atenção", "Reativar aluno"]]) {
      await openDetail(tab, name);
      const before = log.requests.length;
      await button(tab, label).click();
      await flushNetwork(tab);
      assert.deepEqual([opsSince(log, before), log.posts, await noticeTexts(tab)], [[], [], []], name);
      assert.equal(await tab.evaluate(() => document.activeElement.textContent), label);
      assert.ok(await button(tab, label).isEnabled());
      await button(tab, "Voltar ao painel").click();
      await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    }
    assert.deepEqual(log.dialogs.map((d) => d.message.split("\n")[0]), ["Marcar Ana Ativa como desistente?", "Reativar Bruno Atenção?"]);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Duplo clique: enquanto a requisição está em andamento o botão fica ocupado; uma confirmação e uma requisição só.
  {
    const { context, tab, log } = await open();
    const gate = deferred(), arrived = deferred();
    log.handle = ({ route, entry }) => {
      if (entry.op !== "participation") return;
      log.posts.push(entry.body);
      arrived.resolve();
      return gate.promise.then(() => route.fulfill(log.apply(entry.body)));
    };
    await openDetail(tab, "Ana Ativa");
    const mark = button(tab, "Marcar como desistente");
    await mark.click();
    await arrived.promise;
    assert.ok(await mark.isDisabled());
    await mark.click({ force: true });
    await mark.dblclick({ force: true });
    assert.deepEqual([log.posts.length, log.dialogs.length], [1, 1]);
    gate.resolve();
    await button(tab, "Reativar aluno").waitFor();
    await flushNetwork(tab);
    assert.equal(log.posts.length, 1);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // 409 nos dois sentidos: outra pessoa mudou depois que a tela carregou. Sem nova tentativa automática; aviso
  // amigável, recarga e o detalhe passa a mostrar o estado atual do servidor.
  for (const [initial, change, clickLabel, expectedAfter, body] of [
    [{}, (marks) => { marks["1"] = "WITHDRAWN"; }, "Marcar como desistente", "Reativar aluno", { canvasId: "1", status: "WITHDRAWN", expectedStatus: "ACTIVE" }],
    [{ 1: "WITHDRAWN" }, (marks) => { delete marks["1"]; }, "Reativar aluno", "Marcar como desistente", { canvasId: "1", status: "ACTIVE", expectedStatus: "WITHDRAWN" }],
  ]) {
    const { context, tab, log } = await open({ marks: initial });
    await openDetail(tab, "Ana Ativa");
    change(log.marks);
    const before = log.requests.length;
    await button(tab, clickLabel).click();
    await button(tab, expectedAfter).waitFor();
    assert.deepEqual(log.posts, [body], clickLabel);
    assert.deepEqual(opsSince(log, before), ["POST participation", "POST pending-preview", "GET report"], clickLabel);
    assert.deepEqual(await noticeTexts(tab), [{ error: true, text: "A participação deste aluno foi alterada por outra pessoa. Os dados foram atualizados." }]);
    assert.equal(await tab.evaluate(() => document.activeElement.id), "participation-heading");
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Falha de rede: aviso amigável, nada recarregado nem marcado na tela; uma nova tentativa manual funciona.
  {
    const { context, tab, log } = await open();
    let fail = true;
    log.handle = ({ route, entry }) => (entry.op === "participation" && fail ? route.abort("failed") : null);
    await openDetail(tab, "Ana Ativa");
    const before = log.requests.length;
    await button(tab, "Marcar como desistente").click();
    await tab.locator("#notices .notice").waitFor();
    await flushNetwork(tab);
    assert.deepEqual(await noticeTexts(tab), [{ error: true, text: "Não foi possível confirmar a alteração. Confira sua conexão e tente de novo." }]);
    assert.deepEqual(opsSince(log, before), ["POST participation"]);
    assert.ok(await button(tab, "Marcar como desistente").isEnabled());
    assert.equal(await tab.locator("main .badge.withdrawn").count(), 0);
    assert.equal(await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).count(), 0);
    fail = false;
    await button(tab, "Marcar como desistente").click();
    await button(tab, "Reativar aluno").waitFor();
    assert.deepEqual(log.posts, [{ canvasId: "1", status: "WITHDRAWN", expectedStatus: "ACTIVE" }]);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Outros erros do servidor: a mensagem do backend; 400, 403 e 500 mantêm a tela como estava, 404 recarrega.
  for (const [status, error, reload] of [[400, "Solicitação inválida.", false], [403, "Você não tem acesso a esta operação.", false],
    [500, "Não foi possível concluir a operação. Tente novamente.", false], [404, "Aluno não encontrado nesta turma.", true]]) {
    const { context, tab, log } = await open();
    log.handle = ({ route, entry }) => (entry.op === "participation" ? route.fulfill({ status, json: { error } }) : null);
    await openDetail(tab, "Ana Ativa");
    const before = log.requests.length;
    await button(tab, "Marcar como desistente").click();
    await tab.locator("#notices .notice").waitFor();
    await flushNetwork(tab);
    assert.deepEqual(await noticeTexts(tab), [{ error: true, text: error }], String(status));
    assert.deepEqual(opsSince(log, before), reload ? ["POST participation", "POST pending-preview", "GET report"] : ["POST participation"], String(status));
    assert.ok(await button(tab, "Marcar como desistente").isEnabled(), String(status));
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // CSV exportado pelo portal: Participação mantém a posição, antes de Canvas; Situação continua acadêmica.
  {
    const { context, tab, log } = await open({ marks: { 2: "WITHDRAWN" } });
    const exportCsv = async (count) => {
      const download = tab.waitForEvent("download");
      await button(tab, `Exportar CSV (${count})`).click();
      return (await readFile(await (await download).path(), "utf8")).replace(/^﻿/, "").split("\r\n");
    };
    const all = await exportCsv(3);
    assert.match(all[0], /"Situação";"Entrou no portal";"Participação";"Última atividade no Canvas \(Brasília\)";"Tempo no Canvas"$/);
    assert.deepEqual(all.slice(1).map((line) => line.split(";").map((c) => c.replace(/"/g, ""))).map((c) => [c[0], c[7], c[9]]),
      [["Ana Ativa", "Médias na referência", "Ativo"], ["Carla Crítica", "Crítico", "Ativo"], ["Bruno Atenção", "Atenção", "Desistente"]]);
    await tab.locator("#status-filter").selectOption("withdrawn");
    const withdrawn = await exportCsv(1);
    assert.equal(withdrawn.length, 2);
    assert.match(withdrawn[1], /^"Bruno Atenção";.*;"Atenção";"Não";"Desistente";"Sem informação";"Sem informação"$/);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Larguras de 375 a 1440 px: detalhe ativo e, depois de marcar, desistente (badge, botão e aviso) sem rolagem
  // horizontal da página e com o botão dentro da tela.
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    const { context, tab, log } = await open({ width });
    await openDetail(tab, "Ana Ativa");
    assert.ok(await noPageScroll(tab), `ativo ${width}`);
    assert.ok(await insideViewport(button(tab, "Marcar como desistente")), `botão ${width}`);
    await button(tab, "Marcar como desistente").click();
    await button(tab, "Reativar aluno").waitFor();
    await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).waitFor();
    assert.ok(await noPageScroll(tab), `desistente ${width}`);
    assert.ok(await insideViewport(button(tab, "Reativar aluno")), `reativar ${width}`);
    assert.ok(await insideViewport(tab.locator("main .badge.withdrawn")), `badge ${width}`);
    assert.deepEqual(log.errors, [], `erros ${width}`);
    await context.close();
  }
  console.log("Participação (ações): marcar, reativar, cancelar, duplo clique, 409, rede, erros, CSV e 6 larguras OK.");
} finally {
  await browser?.close();
  server.close();
}

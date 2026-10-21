// Participação na turma (C7.2.3) no navegador, com API fictícia: painel, Notas da turma, lembrete individual e lote
// com desistentes, e as mesmas telas de antes quando não há nenhuma marca. Nunca chama a rota de participação nem
// envia e-mail real; dados fictícios.
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

const WITHDRAWN = { participationStatus: "WITHDRAWN" };
// Alice e Caio são os desistentes quando há marcas: em ordem alfabética não ficam no fim, então "desistentes depois
// dos ativos" é observável. Alice: crítica e sem portal; Caio: na referência e sem e-mail.
const rosterOf = (marks) => [
  { id: "1", name: "Ana Ativa", email: "ana@example.test", kc: 80, lab: 96, total: 88, completed: 5, pending: 1, progress: 83, status: "ok", portalLinked: true },
  { id: "2", name: "Bruno Atenção", email: "bruno@example.test", kc: 60, lab: 96, total: 78, completed: 4, pending: 1, progress: 80, status: "attention", portalLinked: false },
  { id: "3", name: "Carla Crítica", email: null, kc: 40, lab: 50, total: 45, completed: 2, pending: 3, progress: 40, status: "critical", portalLinked: true },
  { id: "4", name: "Alice Saiu", email: "alice@example.test", kc: 30, lab: 40, total: 35, completed: 1, pending: 4, progress: 20, status: "critical", portalLinked: false, ...(marks ? WITHDRAWN : {}) },
  { id: "5", name: "Caio Saiu", email: null, kc: 90, lab: 99, total: 94, completed: 5, pending: 0, progress: 100, status: "ok", portalLinked: true, ...(marks ? WITHDRAWN : {}) },
];
const classRows = (marks) => rosterOf(marks).map(({ name, kc, lab, total, completed, pending, status, participationStatus }) =>
  ({ name, kc, lab, total, completed, pending, status, ...(participationStatus ? { participationStatus } : {}) }));
const publication = { id: "pub-1", publishedAt: "2026-10-03T09:01:28Z" };
const pendingFor = (s) => ({ student: { id: s.id, name: s.name, email: s.email }, publicationId: publication.id, publishedAt: publication.publishedAt, previewHash: `hash-${s.id}`,
  activities: [{ id: "k1", name: "001 KC Pendente", kind: "kc", state: "pending", active: true, points: "100" }], remindersEnabled: true, delivery: null,
  ses: { ready: true, reason: "Remetente confirmado." }, message: { from: "instrutor@example.test", to: s.email, subject: "Podemos ajudar? · BRSA0267", text: `Olá, ${s.name}!` },
  ...(s.participationStatus ? { participationStatus: s.participationStatus } : {}) });
const batchOf = (recipients) => ({ publicationId: publication.id, publishedAt: publication.publishedAt, ses: { ready: true, reason: "Remetente confirmado." },
  sample: recipients.some((r) => !r.skip) ? { from: "instrutor@example.test", subject: "Podemos ajudar? · BRSA0267", text: "Olá!" } : null, recipients });

let browser;
try {
  browser = await chromium.launch({ headless: true });

  // Uma aba com a API fictícia. marks: com ou sem desistentes. log.handle permite respostas específicas do cenário.
  async function open({ marks = true, width = 1440, url = origin } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const log = { requests: [], errors: [], dialogs: [], handle: null, marks: { ...Object.fromEntries(rosterOf(marks).map((s) => [s.id, s.participationStatus])) } };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice(4);
      const entry = { method: request.method(), path: endpoint, body: request.postData() ? request.postDataJSON() : null };
      log.requests.push(entry);
      const custom = log.handle?.({ route, entry });
      if (custom) return custom;
      const op = endpoint.split("/")[3];
      const roster = rosterOf(false).map((s) => (log.marks[s.id] ? { ...s, participationStatus: log.marks[s.id] } : s));
      if (endpoint === "/me") return route.fulfill({ json: { roles: ["instructor"], email: "instrutor@example.test" } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true }] } });
      if (op === "report") return route.fulfill({ json: { students: roster, publication, history: [], focus: { activityIds: [], version: null }, thresholds: { kc: 70, lab: 95 } } });
      if (op === "class-report") return route.fulfill({ json: { cohort: "BRSA0267", updatedAt: publication.publishedAt, thresholds: { kc: 70, lab: 95 }, students: classRows(marks) } });
      if (op === "pending-preview") return route.fulfill({ json: pendingFor(roster.find((s) => s.id === entry.body.studentId)) });
      log.errors.push(`rota inesperada: ${entry.method} ${endpoint}`);
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const tab = await context.newPage();
    tab.on("pageerror", (error) => log.errors.push(error.message));
    tab.on("dialog", (dialog) => { log.dialogs.push(dialog.message()); dialog.accept(); });
    await tab.goto(url);
    return { context, tab, log };
  }
  // Cartões de Notas da turma e, no painel (Expansão 4), os atalhos de filtro da Situação da turma: rótulo, número e legenda.
  const cardsOf = (tab) => tab.locator(".metrics .metric, .teacher-home .tp-filter").evaluateAll((els) => els.map((el) => [el.dataset.filter ?? null,
    el.querySelector("span").textContent, el.querySelector("strong").textContent, el.querySelector("small").textContent]));
  const rowsOf = (tab) => tab.locator(".teacher-home .tp-row").evaluateAll((els) => els.map((tr) => [tr.querySelector(".tp-student").textContent,
    tr.querySelector(".tp-name").textContent.includes("Desistente"), tr.querySelector(".tp-status .tp-state").textContent]));
  const optionsOf = (tab, id) => tab.locator(`#${id} option`).evaluateAll((els) => els.map((el) => el.value));
  const noPageScroll = (tab) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const calls = (log, op) => log.requests.filter((r) => r.path.endsWith(`/${op}`));
  const noticeTexts = (tab) => tab.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));

  // Sem nenhuma marca: os cartões, filtros, tabela e Notas da turma de antes, sem nenhuma menção a desistente.
  {
    const { context, tab, log } = await open({ marks: false });
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.deepEqual(await cardsOf(tab), [["all", "Alunos na publicação", "5", "Ver todos os alunos"], ["ok", "Médias na referência", "2", "KC ≥ 70% e LAB ≥ 95%"],
      ["attention", "Atenção", "1", "Uma média abaixo da referência"], ["critical", "Crítico", "2", "As duas médias abaixo da referência"],
      ["pending", "Com atividades sem nota", "4", "Ao menos uma atividade liberada sem nota"],
      ["no-portal", "Ainda não entraram", "2", "No portal: sem conta ou com e-mail diferente do Canvas"]]);
    assert.deepEqual(await optionsOf(tab, "status-filter"), ["all", "missing-email", "pending", "no-portal", "ok", "attention", "critical"]);
    assert.deepEqual((await rowsOf(tab)).map(([name, badge]) => [name, badge]), [["Alice Saiu", false], ["Ana Ativa", false], ["Bruno Atenção", false], ["Caio Saiu", false], ["Carla Crítica", false]]);
    assert.doesNotMatch(await tab.locator("main").innerText(), /desistente/i);
    await context.close();
    const classTab = await open({ marks: false, url: `${origin}/?turma=BRSA0267` });
    await classTab.tab.getByRole("heading", { name: "Notas da BRSA0267", exact: true }).waitFor();
    assert.deepEqual(await cardsOf(classTab.tab), [[null, "Alunos na publicação", "5", "Última atualização da turma"], [null, "Médias na referência", "2", "KCs ≥ 70% e LABs ≥ 95%"],
      [null, "Atenção", "1", "Uma média abaixo da referência"], [null, "Crítico", "2", "As duas médias abaixo da referência"]]);
    assert.doesNotMatch(await classTab.tab.locator("main").innerText(), /desistente/i);
    assert.deepEqual([log.errors, classTab.log.errors], [[], []]);
    await classTab.context.close();
  }

  // Painel com desistentes: cartões só com ativos, badge, desistentes depois dos ativos, filtros Ativos/Desistentes,
  // filtros acadêmicos sem desistentes e foco onde o usuário escolheu (C7.1).
  {
    const { context, tab, log } = await open();
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.deepEqual(await cardsOf(tab), [["active", "Alunos ativos", "3", "2 desistentes"], ["ok", "Médias na referência", "1", "KC ≥ 70% e LAB ≥ 95%"],
      ["attention", "Atenção", "1", "Uma média abaixo da referência"], ["critical", "Crítico", "1", "As duas médias abaixo da referência"],
      ["pending", "Com atividades sem nota", "3", "Ao menos uma atividade liberada sem nota"],
      ["no-portal", "Ainda não entraram", "1", "No portal: sem conta ou com e-mail diferente do Canvas"]]);
    assert.deepEqual(await rowsOf(tab), [["Ana Ativa", false, "Médias na referência"], ["Bruno Atenção", false, "Atenção"], ["Carla Crítica", false, "Crítico"],
      ["Alice Saiu", true, "Crítico"], ["Caio Saiu", true, "Médias na referência"]]);
    assert.deepEqual((await optionsOf(tab, "status-filter")).slice(0, 3), ["all", "active", "withdrawn"]);

    // Como um usuário que troca o filtro: o select já tem o foco, e o render não o tira dali.
    await tab.locator("#status-filter").focus();
    await tab.locator("#status-filter").selectOption("withdrawn");
    assert.deepEqual((await rowsOf(tab)).map(([name]) => name), ["Alice Saiu", "Caio Saiu"]);
    assert.equal(await tab.evaluate(() => document.activeElement.id), "status-filter");
    await tab.locator("#status-filter").selectOption("critical");
    assert.deepEqual((await rowsOf(tab)).map(([name]) => name), ["Carla Crítica"]);
    await tab.locator("#status-filter").selectOption("no-portal");
    assert.deepEqual((await rowsOf(tab)).map(([name]) => name), ["Bruno Atenção"]);
    await tab.locator("#status-filter").selectOption("pending");
    assert.deepEqual((await rowsOf(tab)).map(([name]) => name), ["Ana Ativa", "Bruno Atenção", "Carla Crítica"]);
    assert.equal(await tab.locator('[data-action="reminders-batch"]').getAttribute("data-ids"), "1,2,3");

    await tab.locator('[data-filter="active"]').click();
    assert.equal(await tab.locator("#status-filter").inputValue(), "active");
    assert.deepEqual((await rowsOf(tab)).map(([name]) => name), ["Ana Ativa", "Bruno Atenção", "Carla Crítica"]);
    assert.equal(await tab.evaluate(() => document.activeElement.id), "students-heading");
    assert.equal(await tab.locator('[data-filter="active"]').getAttribute("aria-pressed"), "true");
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Notas da turma com desistentes: cartões só com ativos, desistentes listados depois, com o badge.
  {
    const { context, tab, log } = await open({ url: `${origin}/?turma=BRSA0267` });
    await tab.getByRole("heading", { name: "Notas da BRSA0267", exact: true }).waitFor();
    assert.deepEqual((await cardsOf(tab)).map(([, label, value, caption]) => [label, value, caption]), [["Alunos ativos", "3", "2 desistentes"],
      ["Médias na referência", "1", "KCs ≥ 70% e LABs ≥ 95%"], ["Atenção", "1", "Uma média abaixo da referência"], ["Crítico", "1", "As duas médias abaixo da referência"]]);
    const rows = await tab.locator("tbody tr").evaluateAll((els) => els.map((tr) => [tr.querySelector("th").textContent.replace("Desistente", "").trim(),
      tr.querySelector("th").textContent.includes("Desistente"), tr.querySelector("td:last-child .badge").textContent]));
    assert.deepEqual(rows, [["Ana Ativa", false, "Médias na referência"], ["Bruno Atenção", false, "Atenção"], ["Carla Crítica", false, "Crítico"],
      ["Alice Saiu", true, "Crítico"], ["Caio Saiu", true, "Médias na referência"]]);
    await tab.locator("#class-status-filter").selectOption("critical");
    assert.deepEqual(await tab.locator("tbody tr th").allTextContents(), ["Carla Crítica"]);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Detalhe é somente consulta: desistentes mantêm o aviso e ativos também não recebem botão de envio.
  {
    const { context, tab, log } = await open();
    await tab.getByRole("button", { name: "Ver pendências de Alice Saiu", exact: true }).click();
    await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).waitFor();
    assert.equal(await tab.getByRole("button", { name: "Enviar e-mail para este aluno", exact: true }).count(), 0);
    await tab.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await tab.getByRole("button", { name: "Ver pendências de Ana Ativa", exact: true }).click();
    await tab.getByRole("heading", { name: "Lembretes automáticos", exact: true }).waitFor();
    assert.equal(await tab.getByRole("button", { name: "Enviar e-mail para este aluno", exact: true }).count(), 0);
    assert.equal(calls(log, "send-reminder").length, 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Lote misto a partir de "Com atividades sem nota": a prévia pula Bruno (marcado depois que o painel carregou) e
  // Carla (sem e-mail); o envio leva exatamente Ana. Depois, Ana e Bruno aprovados e Bruno marcado antes do envio: os
  // dois vão no envio e o resultado traduz o motivo. Por fim, uma prévia sem aprovados não oferece envio.
  {
    const { context, tab, log } = await open();
    const previews = [
      batchOf([{ id: "1", name: "Ana Ativa", email: "ana@example.test", pending: 1, skip: null }, { id: "2", name: "Bruno Atenção", email: "bruno@example.test", pending: 1, skip: "withdrawn" },
        { id: "3", name: "Carla Crítica", email: null, pending: 3, skip: "no-email" }]),
      batchOf([{ id: "1", name: "Ana Ativa", email: "ana@example.test", pending: 1, skip: null }, { id: "2", name: "Bruno Atenção", email: "bruno@example.test", pending: 1, skip: null },
        { id: "3", name: "Carla Crítica", email: null, pending: 3, skip: "no-email" }]),
      batchOf([{ id: "1", name: "Ana Ativa", email: "ana@example.test", pending: 1, skip: "already-sent" }, { id: "2", name: "Bruno Atenção", email: "bruno@example.test", pending: 1, skip: "withdrawn" },
        { id: "3", name: "Carla Crítica", email: null, pending: 3, skip: "no-email" }]),
    ];
    const results = [[{ id: "1", name: "Ana Ativa", status: "sent" }],
      [{ id: "1", name: "Ana Ativa", status: "sent" }, { id: "2", name: "Bruno Atenção", status: "skipped", reason: "withdrawn" }]];
    log.handle = ({ route, entry }) => {
      if (entry.path.endsWith("/pending-preview-batch")) return route.fulfill({ json: previews.shift() });
      if (entry.path.endsWith("/send-reminders")) return route.fulfill({ json: { publicationId: publication.id, results: results.shift() } });
    };
    const openBatch = async () => {
      await tab.locator("#status-filter").selectOption("pending");
      await tab.getByRole("button", { name: "Enviar lembrete para 3 alunos", exact: true }).click();
      await tab.getByRole("heading", { name: "Lembretes em lote", exact: true }).waitFor();
    };
    await openBatch();
    await tab.getByText(/1 de 3 alunos vai receber/).waitFor();
    assert.equal(await tab.evaluate(() => document.activeElement.textContent), "Lembretes em lote");
    // Expansão 7: quem fica de fora vem agrupado por motivo, com o nome e quantas atividades sem nota.
    const previewText = await tab.locator(".trem-out").innerText();
    assert.match(previewText, /Desistente · 1\s+Bruno Atenção\s+1 sem nota/);
    assert.doesNotMatch(previewText, /withdrawn/);
    await tab.getByRole("button", { name: "Enviar para 1 aluno", exact: true }).click();
    await tab.getByText("1 aceito pelo serviço de envio.", { exact: true }).waitFor();
    assert.deepEqual(calls(log, "send-reminders").map((r) => r.body), [{ studentIds: ["1"], expectedPublicationId: publication.id }]);

    await tab.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    await openBatch();
    await tab.getByText(/2 de 3 alunos vão receber/).waitFor();
    await tab.getByRole("button", { name: "Enviar para 2 alunos", exact: true }).click();
    await tab.getByText("1 aceito pelo serviço de envio · 1 ficou de fora.", { exact: true }).waitFor();
    assert.deepEqual(calls(log, "send-reminders").map((r) => r.body.studentIds), [["1"], ["1", "2"]]);
    assert.match(await tab.locator(".trem-result").innerText(), /Ficaram de fora · 1\s+Desistente · 1\s+Bruno Atenção/);

    await tab.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    await openBatch();
    await tab.getByText(/0 de 3 alunos vão receber/).waitFor();
    assert.equal(await tab.locator('[data-action="send-reminders-batch"]').count(), 0);
    assert.equal(calls(log, "send-reminders").length, 2);
    // A pergunta (Expansão 7): a mesma confirmação, com a turma, quem envia e quantos dos selecionados ficam de fora.
    const question = (n, out) => `Enviar lembrete para ${n === 1 ? "1 aluno" : `${n} alunos`} da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.\n\n${out === 1 ? "1 aluno selecionado fica" : `${out} alunos selecionados ficam`} de fora; os motivos estão na lista.`;
    assert.deepEqual(log.dialogs, [question(1, 2), question(2, 1)]);
    assert.deepEqual(log.errors, []);
    await context.close();
  }

  // Larguras de 375 a 1440 px: painel, Notas da turma, detalhe do desistente e prévia do lote sem rolagem horizontal
  // da página; o badge fica dentro da tela.
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    const { context, tab, log } = await open({ width });
    await tab.getByRole("heading", { name: "Painel da BRSA0267", exact: true }).waitFor();
    assert.ok(await noPageScroll(tab), `painel ${width}`);
    assert.ok(await tab.locator(".teacher-home .tp-row .tp-tag:not(.is-portal)").evaluateAll((els) => els.length === 2 && els.every((el) => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })), `badge ${width}`);
    await tab.locator("#status-filter").selectOption("withdrawn");
    assert.ok(await noPageScroll(tab), `filtro ${width}`);
    await tab.locator("#status-filter").selectOption("all");
    await tab.getByRole("button", { name: "Ver pendências de Alice Saiu", exact: true }).click();
    await tab.getByText("Aluno desistente. Lembretes estão desativados.", { exact: true }).waitFor();
    assert.ok(await noPageScroll(tab), `detalhe ${width}`);
    log.handle = ({ route, entry }) => {
      if (entry.path.endsWith("/pending-preview-batch")) return route.fulfill({ json: batchOf([
        { id: "1", name: "Ana Ativa", email: "ana@example.test", pending: 1, skip: null }, { id: "2", name: "Bruno Atenção", email: "bruno@example.test", pending: 1, skip: "withdrawn" },
        { id: "3", name: "Carla Crítica", email: null, pending: 3, skip: "no-email" }]) });
    };
    await tab.getByRole("button", { name: "Voltar ao painel", exact: true }).click();
    await tab.locator("#status-filter").selectOption("pending");
    await tab.getByRole("button", { name: "Enviar lembrete para 3 alunos", exact: true }).click();
    await tab.getByText(/1 de 3 alunos vai receber/).waitFor();
    assert.ok(await noPageScroll(tab), `lote ${width}`);
    await context.close();
    const classTab = await open({ width, url: `${origin}/?turma=BRSA0267` });
    await classTab.tab.getByRole("heading", { name: "Notas da BRSA0267", exact: true }).waitFor();
    assert.ok(await noPageScroll(classTab.tab), `Notas da turma ${width}`);
    assert.deepEqual([log.errors, classTab.log.errors], [[], []], `erros ${width}`);
    await classTab.context.close();
  }
  console.log("Participação: zero marcas igual, cartões, badge, filtros, Notas da turma, lembrete individual, 409, lote só com aprovados e 6 larguras OK.");
} finally {
  await browser?.close();
  server.close();
}

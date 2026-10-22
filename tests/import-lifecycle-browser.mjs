// Ciclo de vida de "Atualizar notas" com API fictícia (nunca acessa dados reais): rascunho por turma,
// troca de usuário, saída e aviso ao fechar com arquivo não publicado, limite do arquivo, contrato
// da prévia e da publicação, respostas atrasadas depois de trocar turma ou arquivo, e erro 409.
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

const A = "BRSA0267", B = "BRSA0268";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const report = { students: [], activities: [], history: [], publication: { id: "p1", publishedAt: "2026-09-20T12:00:00Z" }, focus: { activityIds: [], version: null } };
const removedChanges = { previousCount: 2, currentCount: 1, studentsAdded: [], studentsRemoved: [{ id: "900002", name: "Aluno Removido" }], studentsUpdated: [],
  activitiesAdded: [], activitiesRemoved: [], activitiesReleased: [], activitiesPaused: [], scalesChanged: [], gradesChanged: 0, gradesAdded: 0, gradesRemoved: 0, gradeDetails: [] };
// Cada resposta é um objeto novo: a tela altera a seleção de atividades da prévia recebida.
const preview = (code, n, { removed = false } = {}) => ({
  draft: { id: `draft-${code}-${n}` }, count: 1, warnings: [],
  activities: [
    { id: "a1", name: "Atividade 1", kind: "kc", points: "10", active: true, filled: 3 },
    { id: "a2", name: "Atividade 2", kind: "lab", points: "20", active: false, filled: 0 },
  ],
  students: [{ id: "900001", name: `Prévia ${code}-${n}`, email: "aluno@example.test", kc: 80, lab: 50, pending: 1, status: "attention" }],
  ...(removed ? { changes: removedChanges } : {}),
});
const csvA = "Student,ID\nAluno A,900001\n", csvB = "Student,ID\nAluno B,900001\n";

let browser;
// Portal com API fictícia: /me, /cohorts e /report fixos; o restante vem do cenário. Rota não prevista falha o teste.
async function openPortal({ role = "instructor", emails = [`${role}@example.test`], respond = () => undefined } = {}) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  tab.setDefaultTimeout(10000);
  const log = { calls: [], errors: [], dialogs: [], acceptConfirm: true };
  tab.on("pageerror", (error) => log.errors.push(error.message));
  tab.on("dialog", (dialog) => {
    log.dialogs.push({ type: dialog.type(), message: dialog.message() });
    return dialog.type() === "confirm" && !log.acceptConfirm ? dialog.dismiss() : dialog.accept();
  });
  // A sessão é criada só no primeiro carregamento da aba: depois de sair, a página recarregada fica deslogada.
  await tab.addInitScript(() => {
    if (!location.protocol.startsWith("http") || sessionStorage.getItem("teste-sessao")) return;
    sessionStorage.setItem("teste-sessao", "1");
    localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 }));
  });
  await tab.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  let meCalls = 0;
  await tab.route("**/api/**", async (route) => {
    const request = route.request();
    const call = { method: request.method(), endpoint: new URL(request.url()).pathname.slice(4), body: request.method() === "POST" ? request.postDataJSON() : null };
    log.calls.push(call);
    if (call.endpoint === "/me") return route.fulfill({ json: { roles: [role], email: emails[Math.min(meCalls++, emails.length - 1)] } });
    if (call.endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: A, canTeach: true }, { code: B, canTeach: true }] } });
    if (call.endpoint.endsWith("/report")) return route.fulfill({ json: report });
    const reply = await respond(call);
    if (!reply) throw new Error(`Rota inesperada: ${call.method} ${call.endpoint}`);
    return route.fulfill({ status: reply.status || 200, json: reply.json });
  });
  await tab.goto(origin);
  await tab.getByRole("heading", { name: `Painel da ${A}`, exact: true }).waitFor();
  const calls = (method, endpoint) => log.calls.filter((c) => c.method === method && c.endpoint === endpoint);
  return { tab, log, calls };
}

const openImport = async (tab) => {
  await tab.getByRole("button", { name: "Atualizar notas", exact: true }).first().click();
  await tab.locator("#import-form").waitFor();
};
const switchCohort = async (tab, code) => {
  await tab.locator("#cohort").selectOption(code);
  await tab.getByRole("heading", { name: `Painel da ${code}`, exact: true }).waitFor();
};
// Expansão 6: o nome do arquivo escolhido fica ao lado do botão de escolher (uma vez só na tela).
const selectCsv = async (tab, name, content) => {
  await tab.locator("#csv-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });
  await tab.locator("#import-form .timp-file-name").getByText(name, { exact: true }).waitFor();
};
const filename = (tab) => tab.locator("#import-form .timp-file-name").innerText();
const hasPreview = async (tab) => (await tab.getByRole("heading", { name: "Conferência dos resultados", exact: true }).count()) > 0;
const notices = (tab) => tab.locator("#notices");
const importState = (tab) => tab.evaluate(async () => {
  const { state } = await import("/state.js");
  return { csv: state.csv, filename: state.filename, preview: state.preview?.draft?.id ?? null, dirty: state.dirty, acknowledgeRemoved: state.acknowledgeRemoved };
});
// Uma ida e volta de rede feita pela página depois de uma resposta garante que ela já foi processada.
const flushNetwork = (tab) => tab.evaluate(() => fetch("/index.html", { cache: "no-store" }).then((r) => r.text()).then(() => true));
// Sai da página navegando (dispara o beforeunload); devolve os tipos de diálogo que apareceram.
// page.close({ runBeforeUnload: true }) não mostra o diálogo no Chromium headless usado nos testes.
async function leaveWithUnload(tab, log) {
  const before = log.dialogs.length;
  await tab.goto("about:blank");
  const types = log.dialogs.slice(before).map((d) => d.type);
  await tab.close();
  return types;
}

try {
  browser = await chromium.launch({ headless: true });

  // Rascunho por turma, corpo da prévia e seleção de atividades preservada ao voltar.
  {
    let n = 0;
    const { tab, log, calls } = await openPortal({ respond: ({ endpoint }) => (endpoint === `/cohorts/${A}/preview` ? { json: preview(A, ++n) } : undefined) });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    await notices(tab).getByText("Prévia pronta. Confira as atividades e os resultados.", { exact: true }).waitFor();
    const [first] = calls("POST", `/cohorts/${A}/preview`);
    assert.deepEqual(Object.keys(first.body), ["csv", "filename"]);
    assert.deepEqual(first.body, { csv: csvA, filename: "notas-a.csv" });

    await tab.locator('input[data-activity="a2"]').check();
    await tab.getByText("Você alterou a seleção. Atualize a prévia antes de publicar.", { exact: true }).waitFor();
    assert.ok(await tab.getByRole("button", { name: /Publicar atualização/ }).isDisabled());
    await tab.getByRole("button", { name: /Atualizar prévia/ }).click();
    await tab.getByText(`Prévia ${A}-2`, { exact: true }).waitFor();
    const second = calls("POST", `/cohorts/${A}/preview`)[1];
    assert.deepEqual(Object.keys(second.body), ["csv", "filename", "activeIds"]);
    assert.deepEqual(second.body, { csv: csvA, filename: "notas-a.csv", activeIds: ["a1", "a2"] });

    // Seleção alterada e ainda não conferida: faz parte do rascunho de A.
    await tab.locator('input[data-activity="a2"]').check();
    assert.deepEqual(await importState(tab), { csv: csvA, filename: "notas-a.csv", preview: `draft-${A}-2`, dirty: true, acknowledgeRemoved: false });

    await switchCohort(tab, B);
    await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.equal(await hasPreview(tab), false);
    assert.equal(await tab.locator("input[data-activity]").count(), 0);
    await tab.getByRole("button", { name: "Conferir arquivo" }).waitFor();
    assert.deepEqual(await importState(tab), { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false });

    await switchCohort(tab, A);
    await openImport(tab);
    assert.equal(await filename(tab), "notas-a.csv");
    await tab.getByText(`Prévia ${A}-2`, { exact: true }).waitFor();
    assert.ok(await tab.locator('input[data-activity="a2"]').isChecked());
    await tab.getByText("Você alterou a seleção. Atualize a prévia antes de publicar.", { exact: true }).waitFor();
    assert.deepEqual(await importState(tab), { csv: csvA, filename: "notas-a.csv", preview: `draft-${A}-2`, dirty: true, acknowledgeRemoved: false });
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: rascunho por turma, corpo da prévia e seleção preservada OK.");
  }

  // Outro usuário no mesmo carregamento: rascunhos e confirmação da pessoa anterior são descartados.
  {
    const { tab, log, calls } = await openPortal({
      role: "admin", emails: ["admin@example.test", "outro.admin@example.test"],
      respond: ({ method, endpoint }) => {
        if (endpoint === `/cohorts/${A}/preview`) return { json: preview(A, 1, { removed: true }) };
        if (method === "POST" && endpoint === `/cohorts/${A}/settings`) return { json: {} };
        if (endpoint === "/requests") return { json: { requests: [] } };
        if (endpoint === `/cohorts/${A}/instructors`) return { json: { instructors: [] } };
      },
    });
    await switchCohort(tab, B);
    await openImport(tab);
    await selectCsv(tab, "notas-b.csv", csvB);
    await switchCohort(tab, A);
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    await tab.locator('input[data-activity="a2"]').check();
    await tab.locator("#acknowledge-removed").check();
    assert.deepEqual(await importState(tab), { csv: csvA, filename: "notas-a.csv", preview: `draft-${A}-1`, dirty: true, acknowledgeRemoved: true });

    await tab.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await tab.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    // Expansão 8: o aviso de quem salvou não aparece para quem entrou; a espera é pela pessoa nova no topo (o boot terminou).
    await tab.locator(".session-context small").filter({ hasText: "outro.admin@example.test" }).waitFor();
    assert.equal(calls("GET", "/me").length, 2);
    assert.deepEqual(await importState(tab), { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false });
    await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.equal(await hasPreview(tab), false);
    await switchCohort(tab, B);
    await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.deepEqual(await leaveWithUnload(tab, log), []);
    assert.deepEqual(log.errors, []);
    console.log("Importação: troca de usuário descarta rascunhos, andamento e confirmação OK.");
  }

  // Sair com arquivo não publicado: confirmação, inclusive quando o arquivo está no rascunho de outra turma.
  {
    const leaving = "Sair descarta os arquivos e prévias ainda não publicados. Deseja continuar?";
    const { tab, log } = await openPortal();
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    log.acceptConfirm = false;
    await tab.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await tab.evaluate(() => {});
    assert.deepEqual(log.dialogs, [{ type: "confirm", message: leaving }]);
    assert.equal(await filename(tab), "notas-a.csv");
    assert.equal((await importState(tab)).csv, csvA);

    await switchCohort(tab, B);
    assert.equal((await importState(tab)).csv, "");
    await tab.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await tab.evaluate(() => {});
    assert.deepEqual(log.dialogs.slice(1), [{ type: "confirm", message: leaving }]);
    await tab.getByRole("heading", { name: `Painel da ${B}`, exact: true }).waitFor();

    // Confirmado: os rascunhos são descartados antes de sair, então fechar a página não pede confirmação de novo.
    log.acceptConfirm = true;
    await tab.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await tab.locator("main.welcome").waitFor();
    assert.deepEqual(log.dialogs.slice(2), [{ type: "confirm", message: leaving }]);
    assert.equal(await tab.evaluate(() => localStorage.getItem("avanca.session")), null);
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: sair com rascunho cancelado e confirmado OK.");
  }

  // Aviso ao fechar: só quando há arquivo não publicado, na turma atual ou em outra.
  {
    let portal = await openPortal();
    await openImport(portal.tab);
    await selectCsv(portal.tab, "notas-a.csv", csvA);
    assert.deepEqual(await leaveWithUnload(portal.tab, portal.log), ["beforeunload"]);

    portal = await openPortal();
    await openImport(portal.tab);
    await selectCsv(portal.tab, "notas-a.csv", csvA);
    await switchCohort(portal.tab, B);
    assert.deepEqual(await leaveWithUnload(portal.tab, portal.log), ["beforeunload"]);

    portal = await openPortal();
    await openImport(portal.tab);
    assert.deepEqual(await leaveWithUnload(portal.tab, portal.log), []);
    console.log("Importação: aviso ao fechar com arquivo na turma atual, em outra turma e sem arquivo OK.");
  }

  // Limite de 2 MB e arquivo vazio.
  {
    const { tab, log, calls } = await openPortal({ respond: ({ endpoint }) => (endpoint === `/cohorts/${A}/preview` ? { json: preview(A, 1) } : undefined) });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    await tab.locator("#csv-file").setInputFiles({ name: "grande.csv", mimeType: "text/csv", buffer: Buffer.alloc(2000001, "a") });
    await tab.locator("#timp-check-status", { hasText: "Selecione um CSV de até 2 MB." }).waitFor();
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.equal(await hasPreview(tab), false);
    assert.deepEqual(await importState(tab), { csv: "", filename: "", preview: null, dirty: false, acknowledgeRemoved: false });

    await selectCsv(tab, "vazio.csv", "");
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.locator("#timp-check-status", { hasText: "Selecione um arquivo CSV para continuar." }).waitFor();
    assert.equal(calls("POST", `/cohorts/${A}/preview`).length, 1);
    assert.deepEqual(await notices(tab).locator(".notice.error").count(), 0, "o motivo fica na tela (Expansão 6), sem aviso temporário");
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: limite de 2 MB e arquivo vazio OK.");
  }

  // Prévia que chega depois da troca de turma: não aparece em B e fica no rascunho de A.
  {
    const gate = deferred(), arrived = deferred();
    const { tab, log } = await openPortal({
      respond: async ({ endpoint }) => {
        if (endpoint !== `/cohorts/${A}/preview`) return undefined;
        arrived.resolve();
        await gate.promise;
        return { json: preview(A, 1) };
      },
    });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await arrived.promise;
    await switchCohort(tab, B);
    await openImport(tab);
    const finished = tab.waitForEvent("requestfinished", (request) => request.url().endsWith(`/cohorts/${A}/preview`));
    gate.resolve();
    await finished;
    await flushNetwork(tab);
    assert.equal(await hasPreview(tab), false);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.doesNotMatch(await notices(tab).innerText(), /Prévia pronta/);
    await switchCohort(tab, A);
    await openImport(tab);
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    assert.equal(await filename(tab), "notas-a.csv");
    assert.ok(await tab.getByRole("button", { name: /Atualizar prévia/ }).isEnabled());
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: prévia atrasada depois de trocar de turma vai para o rascunho certo OK.");
  }

  // Prévia que chega depois de outro arquivo ser escolhido na mesma turma: descartada.
  {
    let n = 0;
    const gate = deferred(), arrived = deferred();
    const { tab, log, calls } = await openPortal({
      respond: async ({ endpoint }) => {
        if (endpoint !== `/cohorts/${A}/preview`) return undefined;
        const k = ++n;
        if (k === 1) { arrived.resolve(); await gate.promise; }
        return { json: preview(A, k) };
      },
    });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await arrived.promise;
    await switchCohort(tab, B);
    await switchCohort(tab, A);
    await openImport(tab);
    await selectCsv(tab, "notas-a2.csv", csvB);
    const finished = tab.waitForEvent("requestfinished", (request) => request.url().endsWith(`/cohorts/${A}/preview`));
    gate.resolve();
    await finished;
    await flushNetwork(tab);
    assert.equal(await hasPreview(tab), false);
    assert.equal(await filename(tab), "notas-a2.csv");
    assert.doesNotMatch(await notices(tab).innerText(), /Prévia pronta/);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-2`, { exact: true }).waitFor();
    assert.deepEqual(calls("POST", `/cohorts/${A}/preview`).map((c) => c.body.filename), ["notas-a.csv", "notas-a2.csv"]);
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: prévia atrasada de um arquivo substituído é descartada OK.");
  }

  // Publicar: contrato, aviso, recarga e remoção só do rascunho publicado.
  {
    const { tab, log, calls } = await openPortal({
      respond: ({ method, endpoint }) => {
        if (endpoint === `/cohorts/${A}/preview`) return { json: preview(A, 1) };
        if (endpoint === `/cohorts/${B}/preview`) return { json: preview(B, 1) };
        if (method === "POST" && endpoint === `/cohorts/${A}/publish`) return { json: { publication: { id: "p2" } } };
      },
    });
    await switchCohort(tab, B);
    await openImport(tab);
    await selectCsv(tab, "notas-b.csv", csvB);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${B}-1`, { exact: true }).waitFor();
    await switchCohort(tab, A);
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    const meBefore = calls("GET", "/me").length;
    await tab.getByRole("button", { name: /Publicar atualização/ }).click();
    await notices(tab).getByText("Atualização publicada. Os alunos já podem consultar.", { exact: true }).waitFor();
    await tab.getByRole("heading", { name: `Painel da ${A}`, exact: true }).waitFor();
    const inForce = new Date(report.publication.publishedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    assert.equal(log.dialogs.at(-1).message, `Publicar as notas para 1 aluno da ${A}?\n\nArquivo: notas-a.csv\n\nA publicação substitui a versão em vigor, de ${inForce}. Os alunos passam a ver as notas deste arquivo.`);
    assert.deepEqual(calls("POST", `/cohorts/${A}/publish`).map((c) => c.body), [{ draftId: `draft-${A}-1`, acknowledgeRemoved: false }]);
    assert.equal(calls("GET", "/me").length, meBefore + 1);
    await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.equal(await hasPreview(tab), false);
    await switchCohort(tab, B);
    await openImport(tab);
    assert.equal(await filename(tab), "notas-b.csv");
    await tab.getByText(`Prévia ${B}-1`, { exact: true }).waitFor();
    assert.deepEqual(log.errors, []);
    // O rascunho de B continua não publicado: fechar ainda pede confirmação.
    assert.deepEqual(await leaveWithUnload(tab, log), ["beforeunload"]);
    console.log("Importação: publicar com draftId, aviso, recarga e remoção só do rascunho publicado OK.");
  }

  // Publicação que termina depois da troca de turma: aviso com a turma publicada, sem recarregar a atual.
  {
    const gate = deferred(), arrived = deferred();
    const { tab, log, calls } = await openPortal({
      respond: async ({ method, endpoint }) => {
        if (endpoint === `/cohorts/${A}/preview`) return { json: preview(A, 1) };
        if (method === "POST" && endpoint === `/cohorts/${A}/publish`) {
          arrived.resolve();
          await gate.promise;
          return { json: { publication: { id: "p2" } } };
        }
      },
    });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    await tab.getByRole("button", { name: /Publicar atualização/ }).click();
    await arrived.promise;
    await switchCohort(tab, B);
    const meBefore = calls("GET", "/me").length;
    gate.resolve();
    await notices(tab).getByText(`Atualização publicada na ${A}.`, { exact: true }).waitFor();
    assert.equal(await tab.locator("#cohort").inputValue(), B);
    await tab.getByRole("heading", { name: `Painel da ${B}`, exact: true }).waitFor();
    assert.equal(calls("GET", "/me").length, meBefore);
    assert.deepEqual(calls("POST", `/cohorts/${A}/publish`).map((c) => c.body), [{ draftId: `draft-${A}-1`, acknowledgeRemoved: false }]);
    await switchCohort(tab, A);
    await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado");
    assert.equal(await hasPreview(tab), false);
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Importação: publicação concluída depois de trocar de turma OK.");
  }

  // Publicar com 409: mensagem do servidor, rascunho intacto e nova tentativa possível.
  {
    const conflict = "A prévia foi gerada a partir de uma versão antiga. Gere a prévia novamente.";
    let publishes = 0;
    const { tab, log, calls } = await openPortal({
      respond: ({ method, endpoint }) => {
        if (endpoint === `/cohorts/${A}/preview`) return { json: preview(A, 1) };
        if (method === "POST" && endpoint === `/cohorts/${A}/publish`)
          return ++publishes === 1 ? { status: 409, json: { error: conflict } } : { json: { publication: { id: "p2" } } };
      },
    });
    await openImport(tab);
    await selectCsv(tab, "notas-a.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click();
    await tab.getByText(`Prévia ${A}-1`, { exact: true }).waitFor();
    const meBefore = calls("GET", "/me").length;
    const publish = tab.getByRole("button", { name: /Publicar atualização/ });
    await publish.click();
    await tab.locator("#timp-publish-status", { hasText: conflict }).waitFor();
    assert.equal(await notices(tab).locator(".notice.error").count(), 0, "o motivo fica na tela (Expansão 6)");
    assert.doesNotMatch(await notices(tab).innerText(), /Atualização publicada/);
    assert.equal(calls("GET", "/me").length, meBefore);
    assert.ok(await hasPreview(tab));
    assert.equal(await filename(tab), "notas-a.csv");
    assert.ok(await publish.isEnabled());
    assert.deepEqual(await importState(tab), { csv: csvA, filename: "notas-a.csv", preview: `draft-${A}-1`, dirty: false, acknowledgeRemoved: false });

    await publish.click();
    await notices(tab).getByText("Atualização publicada. Os alunos já podem consultar.", { exact: true }).waitFor();
    assert.deepEqual(calls("POST", `/cohorts/${A}/publish`).map((c) => c.body), [
      { draftId: `draft-${A}-1`, acknowledgeRemoved: false }, { draftId: `draft-${A}-1`, acknowledgeRemoved: false }]);
    assert.deepEqual(log.errors, []);
    // Publicado e sem outros rascunhos: fechar não pede confirmação.
    assert.deepEqual(await leaveWithUnload(tab, log), []);
    console.log("Importação: publicar com 409 mantém o rascunho e permite tentar de novo OK.");
  }

  // File.text pode terminar depois de /me mudar. A nova pessoa não herda esse CSV nem um draft oculto.
  {
    const { tab, log } = await openPortal({ role: "admin", emails: ["csv-a@example.test", "csv-b@example.test"],
      respond: ({ method, endpoint }) => {
        if (method === "POST" && endpoint === `/cohorts/${A}/settings`) return { json: {} };
        if (endpoint === "/requests") return { json: { requests: [] } };
        if (endpoint === `/cohorts/${A}/instructors`) return { json: { instructors: [] } };
      } });
    await tab.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = function () {
        if (this.name !== "lento-a.csv") return original.call(this);
        window.__csvReadStarted = true;
        return new Promise((resolve) => { window.__finishCsvRead = () => original.call(this).then(resolve); });
      };
    });
    await openImport(tab);
    await tab.locator("#csv-file").setInputFiles({ name: "lento-a.csv", mimeType: "text/csv", buffer: Buffer.from(csvA) });
    await tab.waitForFunction(() => window.__csvReadStarted);
    await tab.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await tab.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    await tab.locator(".session-context small").filter({ hasText: "csv-b@example.test" }).waitFor();
    await openImport(tab); await selectCsv(tab, "atual-b.csv", csvB);
    await tab.evaluate(() => window.__finishCsvRead()); await flushNetwork(tab);
    assert.deepEqual(await importState(tab), { csv: csvB, filename: "atual-b.csv", preview: null, dirty: false, acknowledgeRemoved: false });
    await switchCohort(tab, B); await openImport(tab);
    assert.equal(await filename(tab), "Nenhum arquivo selecionado", "nenhum CSV de A no Map de B");
    await switchCohort(tab, A); await openImport(tab); assert.equal(await filename(tab), "atual-b.csv");
    assert.deepEqual(log.errors, []); await tab.close();
    console.log("Importação C7.5: File.text de outro usuário não reaparece no DOM nem no Map OK.");
  }

  // Mesma turma, nome e bytes: a identidade da operação ainda distingue A da nova conferência de B.
  {
    const arrived = [deferred(), deferred()], gates = [deferred(), deferred()]; let previews = 0;
    const { tab, log } = await openPortal({ role: "admin", emails: ["preview-a@example.test", "preview-b@example.test"],
      respond: async ({ method, endpoint }) => {
        if (endpoint === `/cohorts/${A}/preview`) { const n = previews++; arrived[n].resolve(); await gates[n].promise; return { json: preview(A, n + 1) }; }
        if (method === "POST" && endpoint === `/cohorts/${A}/settings`) return { json: {} };
        if (endpoint === "/requests") return { json: { requests: [] } };
        if (endpoint === `/cohorts/${A}/instructors`) return { json: { instructors: [] } };
      } });
    await openImport(tab); await selectCsv(tab, "notas.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click(); await arrived[0].promise;
    await tab.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await tab.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    await tab.locator(".session-context small").filter({ hasText: "preview-b@example.test" }).waitFor();
    await openImport(tab); await selectCsv(tab, "notas.csv", csvA);
    await tab.getByRole("button", { name: "Conferir arquivo" }).click(); await arrived[1].promise;
    const oldFinished = tab.waitForEvent("requestfinished", (request) => request.url().endsWith(`/cohorts/${A}/preview`));
    gates[0].resolve(); await oldFinished; await flushNetwork(tab);
    assert.equal((await importState(tab)).preview, null);
    assert.equal(await tab.evaluate(async () => (await import("/state.js")).state.importLoading), true, "finally de A não encerra a conferência de B");
    assert.equal(await tab.locator("#timp-check-status").isVisible(), true);
    assert.doesNotMatch(await notices(tab).innerText(), /Prévia pronta/);
    gates[1].resolve(); await tab.getByText(`Prévia ${A}-2`, { exact: true }).waitFor();
    assert.equal(await tab.evaluate(async () => (await import("/state.js")).state.importLoading), false);
    assert.equal((await importState(tab)).preview, `draft-${A}-2`);
    assert.deepEqual(log.errors, []); await tab.close();
    console.log("Importação C7.5: prévia/finally de A não encerram a nova conferência de B OK.");
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

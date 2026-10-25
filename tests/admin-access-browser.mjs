// Teste isolado com API fictícia. Nunca acessa dados AWS reais.
// Cobre o todo/11: buscar aluno, ver vínculo, desvincular, editar nome de exibição,
// recusar solicitação e filtrar por status. Cobre também o todo/12: configurar limites
// de referência e o ID do curso Canvas da turma sem editar código.
// E ainda: vincular e remover instrutor, criar turma, confirmação cancelada, erros 403/409,
// clique duplo durante a operação e resposta atrasada de uma turma que já não está selecionada.
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
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  let requests = [
    { userId: "t1", email: "prof1@escoladanuvem.org", status: "pending" },
    { userId: "t2", email: "prof2@escoladanuvem.org", status: "approved" },
  ];
  let rejectCalls = 0, unlinkCalls = 0, renameCalls = 0, settingsCalls = 0;
  let bound = true;
  let cohortSettings = { thresholds: { kc: 70, lab: 95 }, canvasCourseId: null, autoSync: false };
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await page.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ["admin"], email: "admin@example.test" } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: true, ...cohortSettings }] } });
    if (endpoint.endsWith("/settings") && request.method() === "POST") {
      settingsCalls++;
      cohortSettings = request.postDataJSON();
      return route.fulfill({ json: cohortSettings });
    }
    if (endpoint === "/requests") return route.fulfill({ json: { requests } });
    if (endpoint.endsWith("/instructors")) return route.fulfill({ json: { instructors: [] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: { students: [], publication: null, history: [] } });
    if (endpoint.match(/\/requests\/t1\/reject$/)) {
      rejectCalls++;
      assert.deepEqual(request.postDataJSON(), {});
      requests = requests.map((r) => (r.userId === "t1" ? { ...r, status: "rejected" } : r));
      return route.fulfill({ json: { ...requests[0] } });
    }
    if (endpoint.endsWith("/students-search")) {
      assert.equal(request.postDataJSON().query, "ana");
      return route.fulfill({ json: { results: [
        { id: "101", name: "Ana Teste", email: "ana@example.test", bound, boundEmail: bound ? "ana@example.test" : null, boundAt: bound ? "2026-09-24T12:00:00Z" : null },
      ] } });
    }
    if (endpoint.endsWith("/unlink-student")) {
      unlinkCalls++;
      assert.deepEqual(request.postDataJSON(), { canvasId: "101" });
      bound = false;
      return route.fulfill({ json: { unlinked: true } });
    }
    if (endpoint.endsWith("/display-name")) {
      renameCalls++;
      assert.deepEqual(request.postDataJSON(), { canvasId: "101", displayName: "Ana Apelido" });
      return route.fulfill({ json: { canvasId: "101", displayName: "Ana Apelido" } });
    }
    throw new Error("Rota inesperada: " + endpoint);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
  await page.getByRole("heading", { name: "Solicitações de acesso", exact: true }).waitFor();
  // Expansão 8: o título aparece já durante a carga; a lista, quando o aviso de carregamento sai.
  await page.locator("#aa-load-status").waitFor({ state: "detached" });

  // Filtro de solicitações: só a pendente aparece por padrão. (Expansão 8: uma linha por solicitação, .aa-request; a classe
  // approve-form fica só no formulário do pedido pendente.)
  assert.equal(await page.locator(".aa-request").count(), 1);
  await page.locator("#requests-filter").selectOption("all");
  assert.equal(await page.locator(".aa-request").count(), 2);
  await page.getByText("Aprovada", { exact: true }).waitFor();
  await page.locator("#requests-filter").selectOption("pending");

  // Recusar solicitação pendente. A espera pela resposta do mock (o contador sobe antes do fulfill)
  // é criada antes do clique, para não perder uma requisição rápida.
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/requests/t1/reject"));
  await page.locator('[data-reject="t1"]').click();
  await rejected;
  assert.equal(rejectCalls, 1);
  // Expansão 8: o aviso diz de quem era a solicitação.
  await page.locator("#notices").getByText("Solicitação de prof1@escoladanuvem.org recusada.", { exact: true }).waitFor();
  await page.locator("#requests-filter").selectOption("all");
  await page.getByText("Recusada", { exact: true }).waitFor();

  // Buscar aluno, ver o vínculo, desvincular.
  await page.locator("#student-query").fill("ana");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("ana@example.test", { exact: true }).first().waitFor();
  const unlinked = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/unlink-student"));
  await page.locator('[data-unlink="101"]').click();
  await unlinked;
  assert.equal(unlinkCalls, 1);
  // Expansão 8: "Sem conta vinculada" (a conta do portal, separada do e-mail do Canvas) e o aviso com o aluno.
  await page.getByText("Sem conta vinculada", { exact: true }).waitFor();
  await page.locator("#notices").getByText("A conta de Ana Teste foi desvinculada.", { exact: true }).waitFor();

  // Editar nome de exibição.
  await page.locator('[data-start-edit-name="101"]').click();
  await page.locator('input[name="displayName"]').fill("Ana Apelido");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("“Ana Apelido” é o novo nome de exibição.", { exact: true }).waitFor();
  assert.equal(renameCalls, 1);

  // Configurações da turma: limites e ID do curso Canvas, sem editar código.
  await page.locator('#cohort-settings-form input[name="kc"]').fill("60");
  await page.locator('#cohort-settings-form input[name="lab"]').fill("90");
  await page.locator('#cohort-settings-form input[name="canvasCourseId"]').fill("4436");
  await page.locator('#cohort-settings-form input[name="autoSync"]').check();
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await page.getByText("Configurações da turma atualizadas.", { exact: true }).waitFor();
  assert.equal(settingsCalls, 1);
  assert.deepEqual(cohortSettings, { thresholds: { kc: 60, lab: 90 }, canvasCourseId: "4436", autoSync: true });
  assert.equal(await page.locator('#cohort-settings-form input[name="kc"]').inputValue(), "60");
  assert.equal(await page.locator('#cohort-settings-form input[name="canvasCourseId"]').inputValue(), "4436");
  assert.ok(await page.locator('#cohort-settings-form input[name="autoSync"]').isChecked());

  assert.deepEqual(errors, []);
  console.log("Admin: filtro de solicitações, recusar, buscar aluno, desvincular, editar nome e configurar turma OK.");

  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  // Página de admin com a API fictícia do cenário: registra cada chamada; rota não prevista falha o teste.
  async function adminPage(respond) {
    const tab = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    tab.setDefaultTimeout(10000);
    const log = { calls: [], errors: [], dialogs: [], acceptDialogs: true };
    tab.on("pageerror", (error) => log.errors.push(error.message));
    tab.on("dialog", (dialog) => { log.dialogs.push(dialog.message()); return log.acceptDialogs ? dialog.accept() : dialog.dismiss(); });
    await tab.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
    await tab.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await tab.route("**/api/**", async (route) => {
      const request = route.request();
      const call = { method: request.method(), endpoint: new URL(request.url()).pathname.slice(4), body: request.method() === "POST" ? request.postDataJSON() : null };
      log.calls.push(call);
      const reply = await respond(call);
      if (!reply) throw new Error(`Rota inesperada: ${call.method} ${call.endpoint}`);
      return route.fulfill({ status: reply.status || 200, json: reply.json });
    });
    const since = (mark) => log.calls.slice(mark).map((c) => `${c.method} ${c.endpoint}`);
    return { tab, log, since };
  }

  // Instrutores, turma nova e erros, numa turma com dois códigos disponíveis.
  {
    let cohorts = [{ code: "BRSA0267", canTeach: true }, { code: "BRSA0268", canTeach: true }];
    let requests = [{ userId: "t9", email: "novo.prof@example.test", status: "pending" }];
    const instructors = { BRSA0267: [{ userId: "i1", email: "prof.a@example.test", code: "BRSA0267" }], BRSA0268: [] };
    let revokeReply = null, unlinkReply = null, revokeGate = null, revokeArrived = null;
    const { tab, log, since } = await adminPage(async ({ method, endpoint, body }) => {
      if (endpoint === "/me") return { json: { roles: ["admin"], email: "admin@example.test" } };
      if (endpoint === "/cohorts" && method === "GET") return { json: { cohorts } };
      if (endpoint === "/cohorts" && method === "POST") { cohorts = [...cohorts, { code: body.code, canTeach: true }]; return { json: { cohort: { code: body.code } } }; }
      if (endpoint.endsWith("/report")) return { json: { students: [], publication: null, history: [] } };
      if (endpoint === "/requests") return { json: { requests } };
      const match = endpoint.match(/^\/cohorts\/([\w-]+)\/(instructors|revoke-instructor|students-search|unlink-student)$/);
      if (!match) return undefined;
      const [, code, action] = match;
      if (action === "instructors" && method === "GET") return { json: { instructors: instructors[code] } };
      if (action === "instructors") {
        instructors[code].push({ userId: body.userId, email: "novo.prof@example.test", code });
        requests = requests.map((r) => (r.userId === body.userId ? { ...r, status: "approved" } : r));
        return { json: {} };
      }
      if (action === "revoke-instructor") {
        revokeArrived?.resolve();
        if (revokeGate) await revokeGate.promise;
        if (revokeReply) return revokeReply;
        instructors[code] = instructors[code].filter((i) => i.userId !== body.userId);
        return { json: {} };
      }
      if (action === "students-search") return { json: { results: [{ id: "101", name: "Aluno Fictício", email: "aluno@example.test", bound: true, boundEmail: "aluno@example.test" }] } };
      if (action === "unlink-student") return unlinkReply || { json: { unlinked: true } };
    });
    const notices = tab.locator("#notices");
    await tab.goto(origin);
    await tab.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await tab.getByText("prof.a@example.test", { exact: true }).waitFor();

    // Vincular: a turma vem do formulário da solicitação, não do menu; depois a lista é recarregada.
    let mark = log.calls.length;
    await tab.locator("#approve-t9").selectOption("BRSA0268");
    await tab.getByRole("button", { name: "Vincular à turma", exact: true }).click();
    // Expansão 8: o aviso diz a turma e a pessoa.
    await notices.getByText("Acesso à BRSA0268 concedido a novo.prof@example.test.", { exact: true }).waitFor();
    // Expansão 8.1: Vincular pergunta antes, com a pessoa e a turma que vão no pedido.
    const approveQuestion = "Vincular novo.prof@example.test à turma BRSA0268?\n\nA pessoa passa a acompanhar a BRSA0268 com as permissões de instrutor: ver as notas de todos os alunos, publicar e restaurar notas, marcar desistências e enviar lembretes por e-mail aos alunos dessa turma. O acesso a outras turmas não muda.";
    assert.deepEqual(log.dialogs, [approveQuestion]);
    assert.deepEqual(log.calls[mark], { method: "POST", endpoint: "/cohorts/BRSA0268/instructors", body: { userId: "t9" } });
    assert.deepEqual(since(mark + 1).sort(), ["GET /cohorts/BRSA0267/instructors", "GET /requests"]);
    await tab.locator('form[data-user="t9"]').waitFor({ state: "detached" });
    await tab.getByText("Nenhuma solicitação neste filtro.", { exact: true }).waitFor();

    // Remover acesso, confirmação cancelada: nenhuma chamada, lista e aviso intactos.
    const revoke = tab.locator('[data-revoke="i1"]');
    mark = log.calls.length;
    log.acceptDialogs = false;
    await revoke.click();
    await tab.evaluate(() => {});
    // Expansão 8: a pergunta diz a pessoa, a turma e as consequências (a mesma confirmação, no mesmo ponto).
    assert.deepEqual(log.dialogs, [approveQuestion, "Remover o acesso de prof.a@example.test à BRSA0267?\n\nA pessoa deixa de acompanhar a BRSA0267; o acesso a outras turmas não muda. Se ela for quem envia os lembretes automáticos da BRSA0267, eles param até outro remetente ser configurado.\n\nSe já estiver aprovada no portal, você poderá conceder o vínculo novamente em Instrutores da turma."]);
    assert.deepEqual(since(mark), []);
    assert.ok(await revoke.isEnabled());
    assert.doesNotMatch(await notices.innerText(), /Acesso removido/);
    log.acceptDialogs = true;

    // Remover acesso com 403: a mensagem do backend fica junto da pessoa (Expansão 8: na tela, não no aviso); nada é recarregado.
    revokeReply = { status: 403, json: { error: "Sem permissão para alterar esta turma." } };
    mark = log.calls.length;
    await revoke.click();
    await tab.locator("#aa-op-status", { hasText: "O acesso não foi removido por este pedido. Sem permissão para alterar esta turma." }).waitFor();
    assert.equal(await notices.locator(".notice.error").count(), 0);
    assert.deepEqual(since(mark), ["POST /cohorts/BRSA0267/revoke-instructor"]);
    assert.ok(await revoke.isEnabled());
    await tab.getByText("prof.a@example.test", { exact: true }).waitFor();
    revokeReply = null;

    // Remover acesso confirmado, com segundo clique enquanto a primeira chamada está pendente.
    revokeGate = deferred();
    revokeArrived = deferred();
    mark = log.calls.length;
    const dialogsBefore = log.dialogs.length;
    const revokeHandle = await revoke.elementHandle();
    await revoke.click();
    await revokeArrived.promise;
    assert.ok(await revoke.isDisabled());
    await revoke.click({ force: true });
    revokeGate.resolve();
    await notices.getByText("Acesso de prof.a@example.test à BRSA0267 removido.", { exact: true }).waitFor();
    await revoke.waitFor({ state: "detached" });
    assert.equal(log.dialogs.length - dialogsBefore, 1);
    assert.deepEqual(log.calls[mark], { method: "POST", endpoint: "/cohorts/BRSA0267/revoke-instructor", body: { userId: "i1" } });
    assert.deepEqual(since(mark + 1).sort(), ["GET /cohorts/BRSA0267/instructors", "GET /requests"]);
    assert.equal(await revokeHandle.evaluate((el) => el.isConnected), false);
    revokeGate = null;

    // Desvincular com 409: a mensagem do backend junto do aluno (Expansão 8: na tela, com a nova busca), resultado da busca preservado.
    await tab.locator("#student-query").fill("aluno");
    await tab.getByRole("button", { name: "Buscar", exact: true }).click();
    const unlink = tab.locator('[data-unlink="101"]');
    await unlink.waitFor();
    unlinkReply = { status: 409, json: { error: "O vínculo deste aluno mudou. Busque novamente." } };
    mark = log.calls.length;
    await unlink.click();
    await tab.locator("#aa-op-status", { hasText: "A conta não foi desvinculada por este pedido. O vínculo deste aluno mudou. Busque novamente." }).waitFor();
    assert.equal(await notices.locator(".notice.error").count(), 0);
    assert.deepEqual(log.calls.slice(mark), [{ method: "POST", endpoint: "/cohorts/BRSA0267/unlink-student", body: { canvasId: "101" } }]);
    assert.ok(await unlink.isEnabled());
    assert.doesNotMatch(await notices.innerText(), /Aluno desvinculado/);
    unlinkReply = null;

    // Criar turma: campos do formulário como estão, depois o portal é recarregado.
    mark = log.calls.length;
    await tab.getByLabel("Código da turma").fill("BRSA0299");
    await tab.getByLabel("Nome da turma").fill("Turma de teste");
    await tab.getByRole("button", { name: "Criar turma" }).click();
    await notices.getByText("Turma BRSA0299 criada.", { exact: true }).waitFor();
    assert.deepEqual(log.calls[mark], { method: "POST", endpoint: "/cohorts", body: { code: "BRSA0299", name: "Turma de teste" } });
    const reload = since(mark + 1);
    assert.deepEqual(reload.slice(0, 2), ["GET /me", "GET /cohorts"]);
    assert.ok(reload.includes("GET /requests") && reload.includes("GET /cohorts/BRSA0267/instructors"));
    assert.equal(await tab.locator('#cohort option[value="BRSA0299"]').count(), 1);

    assert.equal(log.calls.filter((c) => c.endpoint.endsWith("/revoke-instructor")).length, 2);
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Admin: vincular e remover instrutor, confirmação cancelada, 403/409, clique duplo e criar turma OK.");
  }

  // Troca de turma com a carga anterior ainda pendente: a resposta atrasada não sobrescreve a atual.
  {
    const gate = deferred(), arrived = { requests: deferred(), instructors: deferred() };
    let requestsCalls = 0;
    const { tab, log } = await adminPage(async ({ endpoint }) => {
      if (endpoint === "/me") return { json: { roles: ["admin"], email: "admin@example.test" } };
      if (endpoint === "/cohorts") return { json: { cohorts: [{ code: "BRSA0267", canTeach: true }, { code: "BRSA0268", canTeach: true }] } };
      if (endpoint.endsWith("/report")) return { json: { students: [], publication: null, history: [] } };
      if (endpoint === "/requests") {
        if (++requestsCalls > 1) return { json: { requests: [{ userId: "f1", email: "atual@example.test", status: "pending" }] } };
        arrived.requests.resolve();
        await gate.promise;
        return { json: { requests: [{ userId: "s1", email: "antiga@example.test", status: "pending" }] } };
      }
      if (endpoint === "/cohorts/BRSA0267/instructors") {
        arrived.instructors.resolve();
        await gate.promise;
        return { json: { instructors: [{ userId: "a1", email: "prof.antigo@example.test", code: "BRSA0267" }] } };
      }
      if (endpoint === "/cohorts/BRSA0268/instructors") return { json: { instructors: [{ userId: "b1", email: "prof.atual@example.test", code: "BRSA0268" }] } };
      if (endpoint === "/cohorts/BRSA0268/students-search") return { json: { results: [{ id: "201", name: "Aluno B", email: "aluno.b@example.test", bound: false }] } };
    });
    await tab.goto(origin);
    await tab.getByRole("button", { name: "Turmas e acessos", exact: true }).click();
    await Promise.all([arrived.requests.promise, arrived.instructors.promise]);
    await tab.locator("#cohort").selectOption("BRSA0268");
    await tab.getByText("atual@example.test", { exact: true }).waitFor();
    await tab.getByText("prof.atual@example.test", { exact: true }).waitFor();
    const staleFinished = Promise.all(["/api/requests", "/api/cohorts/BRSA0267/instructors"].map((pathname) =>
      tab.waitForEvent("requestfinished", (request) => new URL(request.url()).pathname === pathname)));
    gate.resolve();
    await staleFinished;
    // A busca redesenha a tela a partir do state depois que as respostas antigas já chegaram.
    await tab.locator("#student-query").fill("b");
    await tab.getByRole("button", { name: "Buscar", exact: true }).click();
    await tab.getByText("aluno.b@example.test", { exact: true }).waitFor();
    assert.equal(await tab.getByText("antiga@example.test", { exact: true }).count(), 0);
    assert.equal(await tab.getByText("prof.antigo@example.test", { exact: true }).count(), 0);
    assert.equal(await tab.getByText("atual@example.test", { exact: true }).count(), 1);
    assert.equal(await tab.getByText("prof.atual@example.test", { exact: true }).count(), 1);
    await tab.getByRole("heading", { name: "Instrutores da BRSA0268", exact: true }).waitFor();
    assert.equal(log.calls.filter((c) => c.endpoint === "/requests").length, 2);
    assert.deepEqual(log.errors, []);
    await tab.close();
    console.log("Admin: resposta atrasada da turma anterior descartada OK.");
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

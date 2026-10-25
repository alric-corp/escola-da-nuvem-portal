// Smoke MUTANTE explícito: só contas/turma sintéticas do live_accounts.py.
// Importar este módulo não abre navegador, lê senhas ou acessa rede.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifyPublishedConfig } from "./live_readiness.mjs";

export async function verifyStudentReport(api, prefix, id) {
  const report = await api(`${prefix}/report`);
  assert.equal(report.student?.id, id, "Relatório deve pertencer ao próprio aluno");
  assert.equal(report.students, undefined, "Aluno não recebe lista de colegas");
  await api(`${prefix}/class-report`, undefined, 403);
  return report;
}

export async function runSyntheticSmoke(context) {
  assert.match(context.run, /^[a-f0-9]{12}$/, "Contexto sintético inválido");
  assert.equal(context.cohort, `SMOKE-${context.run.toUpperCase()}`);
  for (const role of ["admin", "student1", "student2", "instructor"]) {
    const domain = role === "instructor" ? "escoladanuvem.org" : "example.test";
    assert.equal(context.actors?.[role]?.username, `portal-smoke-${context.run}-${role}@${domain}`);
    assert.ok(context.actors[role].sub && context.actors[role].password, "Execute setup antes do smoke");
  }
  const output = context.output;
  const frontend = await verifyPublishedConfig(output);
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function login(actor) {
    const bc = await browser.newContext();
    const page = await bc.newPage();
    page.setDefaultNavigationTimeout(60000);
    await page.goto(output.portal_url, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Entrar no meu portal" }).click();
    await page.locator('input[name="username"]:visible').fill(actor.username);
    await page.locator('input[name="password"]:visible').fill(actor.password);
    await page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();
    await page.waitForURL((url) => url.origin === new URL(output.portal_url).origin,
      { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!localStorage.getItem("avanca.session"), null, { timeout: 30000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("avanca.session")).accessToken);
    return { page, bc, token };
  }
  async function api(actor, path, body, expected = 200) {
    const response = await fetch(output.api_url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${actor.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000),
    });
    assert.equal(response.status, expected, `${path}: HTTP ${response.status}`);
    return response.json();
  }
  try {
    assert.equal((await fetch(output.api_url + "/me")).status, 401);
    const admin = await login(context.actors.admin);
    assert.deepEqual((await api(admin, "/me")).roles, ["admin"]);
    await api(admin, "/cohorts", { code: context.cohort, name: "Teste temporário de implantação" });
    const prefix = `/cohorts/${context.cohort}`;
    const csv = "Student,ID,SIS Login ID,001 KC (1),002 Lab (2)\nPoints Possible,,,10,100\n" +
      `Aluno Um,101,${context.actors.student1.username},7,100\nAluno Dois,102,${context.actors.student2.username},9,50\n`;
    const preview = await api(admin, prefix + "/preview", { csv, filename: "smoke.csv" });
    assert.equal(preview.students.length, 2);
    assert.equal(preview.students[0].kc, 70);
    await api(admin, prefix + "/publish", { draftId: preview.draft.id });
    const classReport = await api(admin, prefix + "/class-report");
    assert.deepEqual(classReport.students.map((s) => s.name).sort(), ["Aluno Dois", "Aluno Um"]);
    assert.equal(JSON.stringify(classReport).includes("@"), false);
    assert.equal(classReport.snapshot, undefined);
    results.push("Administrador publica CSV sintético; relatório autorizado sem e-mails/snapshot");
    for (const [role, id] of [["student1", "101"], ["student2", "102"]]) {
      const actor = await login(context.actors[role]);
      const report = await verifyStudentReport((...args) => api(actor, ...args), prefix, id);
      const other = context.actors[role === "student1" ? "student2" : "student1"].username;
      assert.equal(JSON.stringify(report).includes(other), false);
      await actor.page.getByRole("heading", { name: /Bom ter você aqui/ }).waitFor();
      assert.equal(await actor.page.getByRole("button", { name: "Notas da turma", exact: true }).count(), 0);
      assert.equal(await actor.page.getByRole("button", { name: "Minha visibilidade", exact: true }).count(), 0);
      await actor.page.getByRole("button", { name: "Guia do curso", exact: true }).click();
      await actor.page.getByRole("heading", { name: "Guia do curso", exact: true }).waitFor();
      await actor.page.getByRole("button", { name: "Meu desempenho", exact: true }).click();
      await actor.page.getByRole("heading", { name: /Bom ter você aqui/ }).waitFor();
      await api(actor, prefix + "/preview", { csv }, 403);
      await actor.bc.close();
    }
    results.push("Alunos isolados: dados próprios, class-report 403 e Guia; sem controles legados");
    const next = await api(admin, prefix + "/preview", { csv, filename: "smoke-next.csv" });
    await api(admin, prefix + "/publish", { draftId: next.draft.id });
    await api(admin, prefix + "/restore", { publicationId: preview.draft.id, expectedCurrent: next.draft.id });
    assert.equal((await api(admin, prefix + "/report")).publication.id, preview.draft.id);
    results.push("Publicação e restauração restritas à turma sintética");
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await guest.newPage();
    await page.goto(`${output.portal_url}/?turma=${context.cohort}`);
    await page.getByRole("button", { name: "Entrar no meu portal" }).waitFor();
    assert.equal(await page.locator("tbody tr").count(), 0);
    assert.equal((await fetch(`${output.api_url}${prefix}/class-report`)).status, 401);
    assert.equal((await fetch(`${output.api_url}/guest/cohorts/${context.cohort}`)).status, 404);
    await guest.close();
    const instructor = await login(context.actors.instructor);
    await api(instructor, prefix + "/class-report", undefined, 403);
    await api(instructor, prefix + "/preview", { csv }, 403);
    await api(instructor, "/access-request", {});
    await api(admin, prefix + "/instructors", { userId: context.actors.instructor.sub });
    assert.equal((await api(instructor, prefix + "/report")).students.length, 2);
    assert.equal((await api(instructor, prefix + "/class-report")).students.length, 2);
    await instructor.page.reload();
    await instructor.page.getByRole("heading", { name: `Painel da ${context.cohort}`, exact: true }).waitFor();
    await api(admin, prefix + "/revoke-instructor", { userId: context.actors.instructor.sub });
    await api(instructor, prefix + "/report", undefined, 403);
    results.push("Instrutor sem vínculo recusado; aprovação e revogação por turma preservadas");
    const after = await verifyPublishedConfig(output);
    assert.equal(after.releaseId, frontend.releaseId, "Release mudou durante o smoke; repetir somente após diagnóstico");
    return { testedAt: new Date().toISOString(), portalUrl: output.portal_url, frontend, backendVersion: null,
      limitation: "Smoke sintético não comprova QA com identidades reais, permissões Canvas ou versão do backend.", results };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = JSON.parse(await readFile(process.argv[2], "utf8"));
  const result = await runSyntheticSmoke(context);
  await mkdir("infra/terraform/.build", { recursive: true });
  await writeFile("infra/terraform/.build/live-smoke-results.json", JSON.stringify(result, null, 2) + "\n");
  console.log(result.results.map((text) => `PASS: ${text}`).join("\n"));
}

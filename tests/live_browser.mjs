// Smoke test explícito contra o deploy real, usando somente contas sintéticas.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const context = JSON.parse(await readFile(process.argv[2], "utf8"));
const output = context.output;
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
  await page
    .locator('input[type="submit"]:visible, button[type="submit"]:visible')
    .first()
    .click();
  await page.waitForURL(
    (url) => url.origin === new URL(output.portal_url).origin,
    { timeout: 60000, waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => !!sessionStorage.getItem("avanca.session"),
    null,
    {
      timeout: 30000,
    },
  );
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("avanca.session")).accessToken,
  );
  return { page, bc, token };
}
async function api(actor, path, body, expected = 200) {
  const response = await fetch(output.api_url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path}: ${response.status} ${JSON.stringify(result).slice(0, 250)}`,
  );
  return result;
}
try {
  const anonymous = await fetch(output.api_url + "/me");
  assert.equal(anonymous.status, 401);
  results.push("API recusa acesso anônimo");
  const admin = await login(context.actors.admin);
  assert.deepEqual((await api(admin, "/me")).roles, ["admin"]);
  results.push("Login Cognito com PKCE e identificação do administrador");
  await api(admin, "/cohorts", {
    code: context.cohort,
    name: "Teste temporário de implantação",
  });
  const prefix = `/cohorts/${context.cohort}`;
  const csv =
    "Student,ID,SIS Login ID,001 KC (1),002 Lab (2)\nPoints Possible,,,10,100\n" +
    `Aluno Um,101,${context.actors.student1.username},7,100\nAluno Dois,102,${context.actors.student2.username},9,50\n`;
  const preview = await api(admin, prefix + "/preview", {
    csv,
    filename: "smoke.csv",
  });
  assert.equal(preview.students.length, 2);
  assert.equal(preview.students[0].kc, 70);
  await api(admin, prefix + "/publish", { draftId: preview.draft.id });
  results.push(
    "CSV real processado pela Lambda, salvo no S3 e publicado no DynamoDB",
  );
  async function classReport() {
    const res = await fetch(`${output.api_url}${prefix}/class-report`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const data = await res.json();
    assert.equal(JSON.stringify(data).includes("@"), false);
    assert.equal(JSON.stringify(data).includes("snapshot"), false);
    assert.equal(JSON.stringify(data).includes('"id"'), false);
    return data;
  }
  assert.deepEqual((await classReport()).students.map((s) => s.name).sort(), [
    "Aluno Dois",
    "Aluno Um",
  ]);
  assert.equal((await fetch(`${output.api_url}${prefix}/privacy`)).status, 401);
  for (const [role, id] of [
    ["student1", "101"],
    ["student2", "102"],
  ]) {
    const actor = await login(context.actors[role]);
    const report = await api(actor, prefix + "/report");
    assert.equal(report.student.id, id);
    assert.equal(report.students, undefined);
    assert.equal(
      JSON.stringify(report).includes(
        context.actors[role === "student1" ? "student2" : "student1"].username,
      ),
      false,
    );
    assert.equal(
      (await api(actor, prefix + "/class-report")).students.length,
      2,
    );
    await actor.page
      .getByRole("button", { name: "Notas da turma", exact: true })
      .click();
    await actor.page
      .getByRole("heading", { name: `Notas da ${context.cohort}` })
      .waitFor();
    assert.equal(await actor.page.locator("tbody tr").count(), 2);
    await actor.page
      .getByRole("button", { name: "Voltar ao meu painel", exact: true })
      .first()
      .click();
    await api(actor, prefix + "/preview", { csv }, 403);
    await actor.page
      .getByRole("heading", { name: /Bom ter você aqui/ })
      .waitFor();
    if (role === "student1") {
      await actor.page
        .getByRole("button", { name: "Minha visibilidade", exact: true })
        .click();
      const hide = actor.page.getByRole("checkbox", {
        name: "Ocultar meu nome na consulta da turma",
      });
      await hide.waitFor();
      assert.equal(await hide.isChecked(), false);
      await hide.check();
      await actor.page
        .getByRole("button", { name: "Salvar visibilidade" })
        .click();
      await actor.page
        .getByText("Seu nome foi ocultado na consulta da turma.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        JSON.stringify(await classReport()).includes("Aluno Um"),
        false,
      );
      assert.equal(
        (await api(admin, prefix + "/report")).students.some(
          (s) => s.name === "Aluno Um",
        ),
        true,
      );
      const next = await api(admin, prefix + "/preview", {
        csv,
        filename: "smoke-next.csv",
      });
      await api(admin, prefix + "/publish", { draftId: next.draft.id });
      assert.equal(
        JSON.stringify(await classReport()).includes("Aluno Um"),
        false,
      );
      await api(admin, prefix + "/restore", {
        publicationId: preview.draft.id,
        expectedCurrent: next.draft.id,
      });
      assert.equal(
        JSON.stringify(await classReport()).includes("Aluno Um"),
        false,
      );
    } else {
      await api(
        actor,
        prefix + "/privacy",
        { showName: true, studentId: "101" },
        400,
      );
      assert.equal(
        JSON.stringify(await classReport()).includes("Aluno Um"),
        false,
      );
    }
  }
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`${output.portal_url}/?turma=${context.cohort}`, {
    timeout: 60000,
  });
  await guestPage
    .getByRole("button", { name: "Entrar no meu portal" })
    .waitFor();
  assert.equal(await guestPage.locator("tbody tr").count(), 0);
  assert.equal(
    (await fetch(`${output.api_url}${prefix}/class-report`)).status,
    401,
  );
  assert.equal(
    (await fetch(`${output.api_url}/guest/cohorts/${context.cohort}`)).status,
    404,
  );
  await guestContext.close();
  results.push(
    "Login obrigatório, acesso por turma e ocultação individual mantida após publicar/restaurar",
  );
  results.push("Duas contas de aluno isoladas e sem permissão de publicação");
  const instructor = await login(context.actors.instructor);
  await api(instructor, prefix + "/class-report", undefined, 403);
  await api(instructor, prefix + "/preview", { csv }, 403);
  await api(instructor, "/access-request", {});
  await api(admin, prefix + "/instructors", {
    userId: context.actors.instructor.sub,
  });
  assert.equal((await api(instructor, prefix + "/report")).students.length, 2);
  await api(admin, prefix + "/revoke-instructor", {
    userId: context.actors.instructor.sub,
  });
  await api(instructor, prefix + "/report", undefined, 403);
  results.push(
    "Aprovação por turma e revogação de instrutor sem troca de token",
  );
  await writeFile(
    "infra/terraform/.build/live-smoke-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        portalUrl: output.portal_url,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(results.map((r) => "PASS: " + r).join("\n"));
} finally {
  await browser.close();
}

// PLAYWRIGHT_MODULE aponta para uma instalação de teste; o frontend não depende dela.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist");
const server = createServer(async (req, res) => {
  const filename = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(
    root,
    "." + (filename === "/" ? "/index.html" : filename),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
      }[path.extname(file)] || "text/plain",
    );
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await mkdir("/private/tmp/avanca-preview", { recursive: true });
  await page.goto(origin);
  await page.getByRole("button", { name: "Entrar no meu portal" }).waitFor();
  await page.screenshot({
    path: "/private/tmp/avanca-preview/login.png",
    fullPage: true,
  });
  assert.equal(
    await page.getByRole("link", { name: /Explorar uma demonstração/ }).count(),
    0,
  );
  // Retina changes physical pixels, not the layout viewport available to CSS.
  const macPage = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 1512, height: 850 },
  });
  macPage.on("pageerror", (err) => errors.push(err.message));
  await macPage.goto(origin);
  await macPage.getByRole("button", { name: "Entrar no meu portal" }).waitFor();
  for (const [width, height] of [
    [1512, 982],
    [1512, 850],
    [1512, 755],
    [1440, 780],
    [1280, 650],
    [1024, 640],
    [1800, 1050],
    [3024, 1964],
  ]) {
    await macPage.setViewportSize({ width, height });
    const layout = await macPage.evaluate(() => {
      const footer = document
        .querySelector(".welcome-footer")
        .getBoundingClientRect();
      const entry = document
        .querySelector('[data-action="login"]')
        .getBoundingClientRect();
      const instructions = document
        .querySelector(".first-access")
        .getBoundingClientRect();
      return {
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        footerBottom: footer.bottom,
        entryTop: entry.top,
        entryBottom: entry.bottom,
        instructionsBottom: instructions.bottom,
      };
    });
    assert.ok(
      layout.entryTop >= 0 && layout.entryBottom <= height,
      `Login must remain visible ${width}x${height}: ${JSON.stringify(layout)}`,
    );
    assert.ok(layout.scrollWidth <= width, `No horizontal scroll at ${width}`);
    assert.ok(
      layout.entryTop >= 0 &&
        layout.entryBottom <= height &&
        layout.instructionsBottom <= height &&
        layout.footerBottom <= layout.scrollHeight,
      "Login e primeiro acesso visíveis; rodapé alcançável por rolagem",
    );
    if (width === 1512 && height === 850)
      await macPage.screenshot({
        path: "/private/tmp/avanca-preview/login-macbook.png",
        fullPage: true,
      });
  }
  await macPage.close();
  await page.goto(origin + "/?demo=1");
  await page
    .getByRole("heading", { name: /Bom ter você aqui, Marina/ })
    .waitFor();
  assert.equal(await page.locator(".next-steps .activity-card").count(), 2);
  await page.getByRole("button", { name: /Ver minhas pendências/ }).click();
  assert.equal(await page.locator(".activity-card").count(), 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Sem nota", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByLabel("Tipo de atividade").selectOption("lab");
  assert.equal(await page.locator(".activity-card").count(), 1);
  assert.ok(
    (await page.locator(".activity-card").innerText()).includes(
      "Redes na prática",
    ),
  );
  await page.getByLabel("Tipo de atividade").selectOption("kc");
  assert.equal(await page.locator(".activity-card").count(), 1);
  assert.ok(
    (await page.locator(".activity-card").innerText()).includes(
      "Fundamentos de redes",
    ),
  );
  await page
    .getByRole("button", { name: "Meu desempenho", exact: true })
    .click();
  await page.screenshot({
    path: "/private/tmp/avanca-preview/aluno.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Minhas atividades", exact: true })
    .click();
  await page.getByRole("button", { name: "Sem nota", exact: true }).click();
  assert.equal(await page.locator(".activity-card").count(), 2);
  await page.getByRole("searchbox").fill("redes");
  assert.equal(await page.locator(".activity-card").count(), 2);
  await page.getByRole("searchbox").fill("não existe");
  assert.equal(await page.locator(".activity-card").count(), 0);
  await page.getByRole("button", { name: /Ver como instrutor/ }).click();
  await page.getByRole("heading", { name: "Desempenho dos alunos" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 6);
  assert.deepEqual(
    await page.locator(".metrics .metric > span").allTextContents(),
    ["Alunos na publicação", "Médias na referência", "Atenção", "Crítico"],
  );
  assert.deepEqual(
    await page.locator("#status-filter option").allTextContents(),
    ["Todos os status", "Sem e-mail no Canvas", "Com atividades sem nota", "Médias na referência", "Atenção", "Crítico"],
  );
  assert.deepEqual(
    await page.locator(".metrics .metric > strong").allTextContents(),
    ["6", "2", "2", "1"],
  );

  await page.screenshot({
    path: "/private/tmp/avanca-preview/instrutor.png",
    fullPage: true,
  });
  // Desktop legibility must grow with the viewport, without page overflow.
  let previousTableSize = 0;
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    const sizes = await page.evaluate(() => ({
      table: parseFloat(
        getComputedStyle(document.querySelector("table")).fontSize,
      ),
      content: document.querySelector(".main").getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.ok(sizes.table > previousTableSize, `Text must grow at ${width}px`);
    assert.ok(
      sizes.content > width * 0.65,
      `Use the available width at ${width}px`,
    );
    assert.equal(sizes.overflow, false, `No page overflow at ${width}px`);
    previousTableSize = sizes.table;
    await page.screenshot({
      path: `/private/tmp/avanca-preview/instrutor-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel("Filtrar status").selectOption("ok");
  assert.equal(await page.locator("tbody tr").count(), 2);
  await page
    .getByRole("button", { name: "Atualizar notas", exact: true })
    .first()
    .click();
  assert.equal(await page.locator("#csv-file").isDisabled(), true);
  await page.getByRole("button", { name: /Ver como aluno/ }).click();
  for (const width of [1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 1440 });
    assert.ok(
      await page
        .locator(".ring > div")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", { name: /Bom ter você aqui, Marina/ })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/private/tmp/avanca-preview/mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);

  // Exercita o frontend de produção com respostas HTTP simuladas, incluindo XSS.
  const adminPage = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  adminPage.on("pageerror", (err) => errors.push(err.message));
  adminPage.on("dialog", (dialog) => dialog.accept());
  await adminPage.addInitScript(() =>
    sessionStorage.setItem(
      "avanca.session",
      JSON.stringify({
        accessToken: "test-only",
        expires: Date.now() + 600000,
      }),
    ),
  );
  const malicious = '<img src=x onerror="window.injected=true">';
  const activity = {
    id: "001 KC",
    name: "001 KC",
    kind: "kc",
    points: "10",
    active: true,
    filled: 1,
  };
  const row = {
    id: "101",
    name: malicious,
    email: null,
    kc: 70,
    lab: null,
    progress: 100,
    pending: 0,
    status: "insufficient",
  };
  let published = false,
    previews = 0;
  let failAccess = true;
  let sesReady = false,
    reminderSent = false;
  const reportReads = [];
  await adminPage.route("**/config.json", (route) =>
    route.fulfill({ json: { apiUrl: origin + "/api" } }),
  );
  await adminPage.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace("/api", "");
    let result;
    if (p === "/me")
      result = {
        roles: ["admin"],
        email: "admin@example.test",
        userId: "admin",
      };
    else if (p === "/cohorts")
      result = {
        cohorts: [
          { code: "BRSA0267", name: "AWS re/Start", canTeach: true },
          { code: "BRSA0268", name: "Outra turma", canTeach: true },
        ],
      };
    else if (p.endsWith("/pending-preview")) {
      assert.equal(route.request().headers().authorization, "Bearer test-only");
      result = {
        student: { id: "101", name: malicious, email: "student@example.test" },
        publicationId: "p1",
        publishedAt: "2026-09-14T12:00:00Z",
        previewHash: "preview-hash",
        activities: [
          { ...activity, state: "pending" },
          {
            ...activity,
            id: "002 Lab",
            name: "002 Lab",
            kind: "lab",
            state: "pending",
          },
        ],
        message: {
          from: "portal@example.test",
          to: "student@example.test",
          replyTo: "admin@example.test",
          subject: "Podemos ajudar?",
          text: `Olá, ${malicious}!\nKCs sem nota: 001 KC\nLABs sem nota: 002 Lab\nPrecisa de algum auxílio?`,
        },
        ses: {
          ready: sesReady,
          reason:
            "O SES aguarda liberação de produção pela AWS para enviar aos alunos.",
        },
        delivery: reminderSent ? { status: "sent" } : null,
      };
    } else if (p.endsWith("/send-reminder")) {
      assert.deepEqual(route.request().postDataJSON(), {
        studentId: "101",
        publicationId: "p1",
        previewHash: "preview-hash",
      });
      assert.ok(!reminderSent);
      reminderSent = true;
      result = { delivery: { status: "sent" } };
    } else if (p === "/requests") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (failAccess)
        return route.fulfill({ status: 500, json: { error: "Erro simulado" } });
      result = { requests: [] };
    } else if (p.endsWith("/class-report"))
      result = { cohort: p.split("/")[2], updatedAt: null, students: [] };
    else if (p.endsWith("/instructors")) result = { instructors: [] };
    else if (p.endsWith("/report")) {
      reportReads.push(p);
      result = {
        students: published ? [row] : [],
        publication: published
          ? { id: "p1", publishedAt: new Date().toISOString() }
          : null,
        history: [],
      };
    } else if (p.endsWith("/preview")) {
      previews++;
      result = {
        draft: { id: "draft" },
        activities: [activity],
        students: [row],
        count: 1,
        warnings: [
          "Linha 4: aluno de teste do Canvas ignorado; não entra nas notas da turma.",
        ],
      };
    } else if (p.endsWith("/publish")) {
      published = true;
      result = { publication: { id: "p1" } };
    } else result = { requests: [], instructors: [] };
    await route.fulfill({ json: result });
  });
  await adminPage.goto(origin);
  await adminPage
    .getByRole("heading", { name: "Desempenho dos alunos" })
    .waitFor();
  await adminPage
    .getByRole("button", { name: "Atualizar notas", exact: true })
    .first()
    .click();
  await adminPage.locator("#csv-file").setInputFiles({
    name: "notas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Student,ID,SIS Login ID\n"),
  });
  await adminPage.getByRole("button", { name: "Conferir arquivo" }).click();
  await adminPage
    .getByRole("heading", { name: "Conferência dos resultados" })
    .waitFor();
  await adminPage
    .getByText(
      "Linha 4: aluno de teste do Canvas ignorado; não entra nas notas da turma.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await adminPage.locator("tbody img").count(), 0);
  await adminPage
    .locator("tbody")
    .getByText("E-mail ausente no Canvas", { exact: true })
    .waitFor();
  assert.equal(
    await adminPage
      .locator("tbody")
      .innerText()
      .then((t) => t.includes(malicious)),
    true,
  );
  await adminPage.getByRole("checkbox").uncheck();
  assert.equal(
    await adminPage
      .getByRole("button", { name: "Publicar atualização" })
      .isDisabled(),
    true,
  );
  await adminPage.getByRole("checkbox").check();
  await adminPage.getByRole("button", { name: "Atualizar prévia" }).click();
  await adminPage.getByRole("button", { name: "Publicar atualização" }).click();
  await adminPage
    .getByRole("heading", { name: "Desempenho dos alunos" })
    .waitFor();
  assert.equal(published, true);
  assert.equal(previews, 2);
  assert.equal(await adminPage.evaluate(() => window.injected), undefined);
  await adminPage.locator('[data-student-pending="101"]').click();
  await adminPage
    .getByRole("heading", { name: "Atividades sem nota registrada" })
    .waitFor();
  assert.equal(await adminPage.locator(".activity-card").count(), 2);
  assert.equal(
    await adminPage
      .getByRole("heading", { name: "Prévia do e-mail de apoio" })
      .count(),
    0,
  );
  assert.equal(
    await adminPage.locator('[data-action="send-reminder"]').count(),
    1,
  );
  await adminPage
    .getByRole("button", { name: "Atualizar pendências", exact: true })
    .click();
  await adminPage
    .getByRole("heading", { name: "Atividades sem nota registrada" })
    .waitFor();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await adminPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await adminPage.screenshot({
    path: "/private/tmp/avanca-preview/pendencias-sem-email.png",
    fullPage: true,
  });
  await adminPage
    .getByRole("button", { name: "Voltar ao painel", exact: true })
    .click();
  await adminPage.setViewportSize({ width: 1280, height: 1000 });
  await adminPage
    .getByRole("button", { name: "Turmas e acessos", exact: true })
    .click();
  await adminPage
    .getByRole("status")
    .filter({ hasText: "Carregando solicitações" })
    .waitFor();
  await adminPage
    .getByRole("alert")
    .filter({ hasText: "Não foi possível carregar os acessos" })
    .waitFor();
  assert.equal(
    await adminPage.locator('.nav-item[aria-current="page"]').innerText(),
    "Turmas e acessos",
  );
  failAccess = false;
  await adminPage
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await adminPage
    .getByRole("heading", { name: "Solicitações de acesso" })
    .waitFor();
  await adminPage.locator("#cohort").selectOption("BRSA0268");
  await adminPage
    .getByRole("heading", { name: "Instrutores da BRSA0268" })
    .waitFor();
  assert.equal(
    await adminPage.locator('.nav-item[aria-current="page"]').innerText(),
    "Turmas e acessos",
  );
  await adminPage.screenshot({
    path: "/private/tmp/avanca-preview/acessos.png",
    fullPage: true,
  });
  await adminPage
    .getByRole("button", { name: "Painel do instrutor", exact: true })
    .click();
  await adminPage
    .getByRole("heading", { name: "Desempenho dos alunos" })
    .waitFor();
  assert.equal(reportReads.at(-1), "/cohorts/BRSA0268/report");
  assert.equal(await adminPage.getByRole("button", { name: "Notas da turma", exact: true }).count(), 0);
  await adminPage.goto(origin + "/?turma=BRSA0268");
  await adminPage.getByRole("heading", { name: "Notas da BRSA0268" }).waitFor();
  assert.equal(
    await adminPage.locator(".session-context small").innerText(),
    "admin@example.test",
  );
  assert.equal(
    await adminPage.locator(".role-chip").innerText(),
    "Administrador e instrutor",
  );
  await adminPage.reload();
  await adminPage.getByRole("heading", { name: "Notas da BRSA0268" }).waitFor();
  assert.equal(
    await adminPage.locator(".session-context small").innerText(),
    "admin@example.test",
  );
  await adminPage.screenshot({
    path: "/private/tmp/avanca-preview/publica-logado.png",
    fullPage: true,
  });
  await adminPage
    .getByRole("button", { name: "Voltar ao meu painel", exact: true })
    .first()
    .click();
  await adminPage
    .getByRole("heading", { name: "Desempenho dos alunos" })
    .waitFor();
  assert.equal(
    await adminPage.locator('.nav-item[aria-current="page"]').innerText(),
    "Painel do instrutor",
  );

  // Links diretos exigem login. Alunos recebem somente o resumo autorizado, sem e-mails.
  const guestPage = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  guestPage.on("pageerror", (err) => errors.push(err.message));
  await guestPage.route("**/config.json", (route) =>
    route.fulfill({ json: { apiUrl: origin + "/api" } }),
  );
  let classReads = 0;
  let expired = false;
  await guestPage.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    assert.equal(route.request().headers().authorization, "Bearer test-only");
    if (p.endsWith("/me"))
      return route.fulfill({
        json: { roles: ["student"], email: "student@example.test" },
      });
    if (p.endsWith("/cohorts"))
      return route.fulfill({
        json: { cohorts: [{ code: "BRSA0267", canTeach: false }] },
      });
    if (p.endsWith("/report"))
      return route.fulfill({ json: { student: null } });
    assert.ok(p.endsWith("/class-report"));
    classReads++;
    if (expired)
      return route.fulfill({ status: 401, json: { error: "Sessão expirada" } });
    return route.fulfill({
      json: {
        cohort: "BRSA0267",
        updatedAt: "2026-09-14T12:00:00Z",
        students: [
          {
            name: malicious,
            nameVisible: true,
            kc: 70,
            lab: 100,
            total: 85,
            completed: 2,
            pending: 0,
            status: "ok",
          },
          {
            name: "Aluno sem identificação 02",
            nameVisible: false,
            kc: 60,
            lab: 90,
            total: 75,
            completed: 1,
            pending: 1,
            status: "critical",
          },
        ],
      },
    });
  });
  await guestPage.goto(origin + "/?turma=BRSA0267");
  await guestPage
    .getByRole("button", { name: "Entrar no meu portal" })
    .waitFor();
  assert.equal(
    await guestPage.getByText("Entrar como convidado", { exact: true }).count(),
    0,
  );
  assert.equal(await guestPage.locator("tbody tr").count(), 0);
  assert.equal(classReads, 0);
  await guestPage.evaluate(() =>
    sessionStorage.setItem(
      "avanca.session",
      JSON.stringify({
        accessToken: "test-only",
        expires: Date.now() + 600000,
      }),
    ),
  );
  await guestPage.reload();
  await guestPage.getByText("Ainda não há notas publicadas para sua conta.", {exact: true}).waitFor();
  assert.equal(classReads, 0, "Aluno não consulta dados de colegas");
  assert.equal(await guestPage.getByRole("button", {name: "Notas da turma", exact: true}).count(), 0);
  assert.equal(await guestPage.getByRole("button", {name: "Minha visibilidade", exact: true}).count(), 0);

  const studentPage = await browser.newPage();
  let showName = true;
  studentPage.on("pageerror", (err) => errors.push(err.message));
  await studentPage.addInitScript(() =>
    sessionStorage.setItem(
      "avanca.session",
      JSON.stringify({
        accessToken: "test-only",
        expires: Date.now() + 600000,
      }),
    ),
  );
  await studentPage.route("**/config.json", (route) =>
    route.fulfill({ json: { apiUrl: origin + "/api" } }),
  );
  await studentPage.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    let json;
    if (p.endsWith("/me"))
      json = { roles: ["student"], email: "student@example.test" };
    else if (p.endsWith("/cohorts"))
      json = { cohorts: [{ code: "BRSA0267", canTeach: false }] };
    else if (p.endsWith("/report"))
      json = {
        student: {
          ...row,
          name: "Aluno Teste",
          activities: [
            ...Array.from({ length: 6 }, (_, i) => ({
              ...activity,
              id: `kc${i}`,
              name: `${i + 1} KC pendente`,
              state: "pending",
            })),
            {
              ...activity,
              id: "lab1",
              kind: "lab",
              name: "LAB pendente",
              state: "pending",
            },
            {
              ...activity,
              id: "zero",
              name: "KC realizado com zero",
              state: "completed",
              percent: 0,
            },
            {
              ...activity,
              id: "future",
              name: "KC não liberado",
              state: "unreleased",
            },
            {
              ...activity,
              id: "exempt",
              name: "KC dispensado",
              state: "exempt",
            },
          ],
          pending: 7,
          completed: 1,
        },
        history: [],
        publication: { publishedAt: "2026-09-14T12:00:00Z" },
      };
    else if (p.endsWith("/privacy")) {
      assert.equal(route.request().headers().authorization, "Bearer test-only");
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        assert.deepEqual(Object.keys(body), ["showName"]);
        showName = body.showName;
      }
      json = { showName };
    } else throw new Error("Unexpected route " + p);
    return route.fulfill({ json });
  });
  await studentPage.goto(origin);
  await studentPage
    .getByRole("heading", { name: "Por onde começar" })
    .waitFor();
  assert.equal(await studentPage.locator(".next-steps .activity-card").count(), 3);
  assert.ok(!(await studentPage.locator(".next-steps").innerText()).includes("KC realizado com zero"));
  await studentPage
    .getByRole("button", { name: /Ver minhas pendências/ })
    .click();
  assert.equal(await studentPage.locator(".activity-card").count(), 7);
  await studentPage.getByLabel("Tipo de atividade").selectOption("lab");
  assert.equal(await studentPage.locator(".activity-card").count(), 1);
  await studentPage
    .getByRole("button", { name: "Dispensadas", exact: true })
    .click();
  assert.equal(await studentPage.locator(".activity-card").count(), 0);
  await studentPage.getByLabel("Tipo de atividade").selectOption("kc");
  assert.equal(await studentPage.locator(".activity-card").count(), 1);
  assert.equal(await studentPage.getByRole("button", {name: "Minha visibilidade", exact: true}).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser: fluxos pessoais e do instrutor, login obrigatório na consulta da turma, acesso individual, mobile e escape HTML passaram.",
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

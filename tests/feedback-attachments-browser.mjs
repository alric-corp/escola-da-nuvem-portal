// Teste isolado com API e S3 fictícios. Nunca acessa dados AWS reais.
// Anexos do feedback: prévia local, validação, envio direto ao S3 (presigned POST), conclusão,
// falha parcial com nova tentativa, "Meus feedbacks" e detalhe do admin.
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
const S3 = "https://feedback-files.example.test";

// Imagem 1x1 real (as miniaturas renderizam); o tipo declarado muda por arquivo.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const image = (name, mimeType, buffer = pixel) => ({ name, mimeType, buffer });
const longName = `captura-${"muito-longa-".repeat(12)}final.png`;
const ready = (id, originalName, size = 1_887_437) => ({ attachmentId: id.padEnd(32, "0"), originalName, mimeType: "image/png", size, createdAt: "2026-09-26T12:00:00Z" });

let browser;
try {
  browser = await chromium.launch({ headless: true });
  async function open(role, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Sao_Paulo" });
    const api = { feedbackPosts: [], slots: [], s3: [], completes: [], downloads: [], lists: [], mineGets: 0, unexpected: [], errors: [], failS3Once: false, holdS3: null, duplicate: false };
    await context.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "t", expires: Date.now() + 3600000 })));
    await context.route("**/config.json", (route) => route.fulfill({ json: { apiUrl: origin + "/api" } }));
    await context.route(`${S3}/**`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataBuffer().toString("latin1");
        api.s3.push({ key: /name="key"\r\n\r\n([^\r]+)/.exec(body)?.[1], type: /name="Content-Type"\r\n\r\n([^\r]+)/.exec(body)?.[1], hasFile: body.includes('name="file"') });
        const headers = { "Access-Control-Allow-Origin": origin };
        // Envio retido até o teste liberar (para observar o estado durante o upload).
        if (api.holdS3) { const hold = api.holdS3; api.holdS3 = null; hold.arrived.resolve(); await hold.gate.promise; }
        if (api.failS3Once) { api.failS3Once = false; return route.fulfill({ status: 403, headers, body: "" }); }
        return route.fulfill({ status: 204, headers, body: "" });
      }
      return route.fulfill({ status: 200, contentType: "image/png", body: pixel });
    });
    await context.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice(4);
      if (endpoint === "/me") return route.fulfill({ json: { roles: [role], email: `${role}@example.test` } });
      if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student" }] } });
      if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student"
        ? { cohort: "BRSA0267", publication: { id: "p2", publishedAt: "2026-09-24T21:00:00Z" }, updatedAt: "2026-09-24T21:00:00Z", thresholds: { kc: 70, lab: 95 }, history: [], focus: { activityIds: [] },
            student: { id: "101", name: "Ana Souza", kc: 80, lab: null, progress: 50, pending: 0, completed: 1, activities: [] } }
        : { students: [], activities: [], history: [], publication: null } });
      if (endpoint === "/feedback" && request.method() === "POST") {
        api.feedbackPosts.push(request.postDataJSON());
        return route.fulfill({ json: { duplicate: api.duplicate, feedback: { id: api.duplicate ? "20260926T110000000000-dddddddd" : "20260926T130000000000-aaaaaaaa", status: "NEW", attachments: api.duplicate ? 1 : 0 } } });
      }
      if (endpoint === "/feedback" && ++api.mineGets) return route.fulfill({ json: { nextCursor: null, items: [
        { id: "20260926T120000000000-11111111", type: "BUG", title: "KC aparece como pendente", status: "NEW", createdAt: "2026-09-26T12:00:00Z", attachments: 2 },
        { id: "20260925T120000000000-22222222", type: "SUGGESTION", title: "Modo escuro", status: "RESOLVED", createdAt: "2026-09-25T12:00:00Z", attachments: 1 },
      ] } });
      if (endpoint === "/admin/feedback") return route.fulfill({ json: { nextCursor: null, summary: { NEW: 1, IN_REVIEW: 0, RESOLVED: 0, ARCHIVED: 0 }, items: [
        { id: "20260926T120000000000-11111111", type: "BUG", title: "KC aparece como pendente", description: "Veja a imagem.", status: "NEW", createdAt: "2026-09-26T12:00:00Z",
          cohort: "BRSA0267", createdByEmail: "ana@example.test", studentName: "Ana Souza", canvasId: "101", canViewAsStudent: true, inCohort: true, page: "activities", attachments: 2, statusHistory: [] }] } });
      let match = endpoint.match(/^\/feedback\/([^/]+)\/attachments$/);
      if (match && request.method() === "POST") {
        const body = request.postDataJSON();
        api.slots.push({ feedbackId: match[1], ...body });
        const attachmentId = body.clientToken.replace(/-/g, "").slice(0, 32);
        return route.fulfill({ json: { status: "PENDING", attachment: { attachmentId, originalName: body.fileName, mimeType: body.contentType, size: body.size },
          upload: { url: `${S3}/`, fields: { key: `tmp/${match[1]}/${attachmentId}`, "Content-Type": body.contentType, policy: "p", "x-amz-signature": "s" } } } });
      }
      if (match && api.lists.push(match[1])) return route.fulfill({ json: { canAdd: match[1].endsWith("11111111"), items: match[1].endsWith("11111111")
        ? [ready("a1", "captura-erro.png"), ready("a2", '<img src=x onerror="window.__xss=1">.png', 320_000)] : [ready("b1", "modo-escuro.png")] } });
      match = endpoint.match(/^\/feedback\/([^/]+)\/attachments\/([^/]+)\/complete$/);
      if (match) { api.completes.push(match[2]); return route.fulfill({ json: { status: "READY", attachment: { attachmentId: match[2] } } }); }
      match = endpoint.match(/^\/feedback\/([^/]+)\/attachments\/([^/]+)$/);
      if (match) { api.downloads.push(match[2]); return route.fulfill({ json: { downloadUrl: `${S3}/feedback/${match[1]}/${match[2]}?X-Amz-Expires=300`, expiresIn: 300 } }); }
      api.unexpected.push(`${request.method()} ${endpoint}`);
      return route.fulfill({ status: 404, json: { error: "Rota inesperada no teste." } });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => api.errors.push(error.message));
    page.on("dialog", (dialog) => { api.errors.push("diálogo: " + dialog.message()); dialog.dismiss(); });
    await page.goto(origin);
    return { context, page, api };
  }
  // Como uma pessoa: clica no botão e escolhe na janela de arquivos.
  const pick = async (page, trigger, files) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
    await chooser.setFiles(files);
  };
  const addButton = (page) => page.getByRole("button", { name: "+ Adicionar imagem" });
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const fillForm = async (page) => {
    await page.locator(".fb-type-option", { hasText: "Bug" }).click();
    await page.locator("#fb-title").fill("Nota não aparece");
    await page.locator("#fb-description").fill("A imagem mostra a atividade sem nota.");
  };

  for (const width of [375, 768, 1440]) {
    // Aluno: seleção, validação local, envio completo e falha parcial com nova tentativa.
    {
      const { context, page, api } = await open("student", width);
      await page.getByRole("button", { name: "Feedback", exact: true }).click();
      await page.getByRole("heading", { name: "Ajude a melhorar a plataforma" }).waitFor();
      const attachments = page.locator(".fb-attachments");
      assert.match(await attachments.innerText(), /Você pode adicionar até 3 imagens PNG, JPEG ou WebP de até 5 MB cada\./);
      assert.match(await attachments.innerText(), /Evite incluir senhas, documentos ou outras informações sensíveis na imagem\./);
      // Tipos e tamanhos recusados já no navegador.
      await pick(page, addButton(page), image("desenho.svg", "image/svg+xml", Buffer.from("<svg/>")));
      await page.getByText("Envie imagens PNG, JPEG ou WebP.").waitFor();
      await pick(page, addButton(page), image("enorme.png", "image/png", Buffer.alloc(5 * 1024 * 1024 + 1)));
      await page.getByText("Cada imagem deve ter até 5 MB.").waitFor();
      assert.equal(await page.locator(".fb-file").count(), 0);
      // Três imagens: miniatura local, nome, tamanho e Remover; o botão de adicionar some.
      // A tela é redesenhada com a janela de arquivos aberta (ex.: a lista termina de carregar): a
      // seleção não pode se perder.
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), addButton(page).click()]);
      await page.evaluate(() => { const app = document.querySelector("#app"); app.innerHTML = app.innerHTML; });
      await chooser.setFiles([image(longName, "image/png"), image("foto.jpg", "image/jpeg"), image("tela.webp", "image/webp")]);
      await page.waitForFunction(() => document.querySelectorAll(".fb-file").length === 3);
      assert.equal(await addButton(page).count(), 0, "com 3 imagens o botão de adicionar some");
      assert.ok((await page.locator(".fb-file img").first().getAttribute("src")).startsWith("blob:"));
      assert.match(await page.locator(".fb-file").first().innerText(), /captura-muito-longa-[\s\S]*1 KB/);
      assert.ok(await noOverflow(page), `3 prévias sem rolagem lateral em ${width}px`);
      const removeBox = await page.locator(".fb-remove").first().boundingBox();
      assert.ok(removeBox.height >= 44 && removeBox.x + removeBox.width <= width, `Remover alcançável em ${width}px`);
      if (process.env.ATTACHMENT_SCREENSHOTS) await page.locator(".feedback-form-panel").screenshot({ path: path.join(process.env.ATTACHMENT_SCREENSHOTS, `anexos-form-${width}.png`) });
      // Remover libera a vaga (e a URL local).
      await page.locator(".fb-remove").nth(1).click();
      assert.equal(await page.locator(".fb-file").count(), 2);
      await pick(page, addButton(page), image("foto2.jpg", "image/jpeg"));
      await page.waitForFunction(() => document.querySelectorAll(".fb-file").length === 3);
      // Envio com uma falha no S3: feedback criado, aviso de falha parcial, nova tentativa.
      api.failS3Once = true;
      await fillForm(page);
      await page.getByRole("button", { name: "Enviar feedback" }).click();
      await page.getByText("Feedback enviado, mas não foi possível anexar uma das imagens.").first().waitFor();
      assert.equal(api.feedbackPosts.length, 1);
      assert.deepEqual(Object.keys(api.feedbackPosts[0]).sort(), ["cohort", "description", "page", "title", "type"]);
      assert.equal(api.slots.length, 3);
      assert.deepEqual(api.slots.map((s) => [s.feedbackId, s.contentType]), [["20260926T130000000000-aaaaaaaa", "image/png"],
        ["20260926T130000000000-aaaaaaaa", "image/webp"], ["20260926T130000000000-aaaaaaaa", "image/jpeg"]]);  // a JPEG removida foi trocada por outra no fim
      assert.ok(api.slots.every((s) => /^[0-9a-f-]{36}$/.test(s.clientToken) && !("objectKey" in s)));
      assert.ok(api.s3.every((u) => u.key.startsWith("tmp/") && u.hasFile));
      assert.equal(api.completes.length, 2);  // a do S3 recusado não é concluída
      assert.match(await page.locator(".fb-file.failed").innerText(), /Não foi anexada/);
      assert.ok(await page.getByRole("button", { name: "Enviar feedback" }).isDisabled(), "não reenvia o feedback");
      const failedToken = api.slots[0].clientToken;
      await page.getByRole("button", { name: "Tentar novamente" }).click();
      await page.locator(".feedback-success").waitFor();
      assert.equal(api.slots.at(-1).clientToken, failedToken, "a nova tentativa usa o mesmo clientToken (mesmo slot)");
      assert.equal(api.feedbackPosts.length, 1);
      assert.equal(api.completes.length, 3);
      assert.equal(await page.locator(".fb-file").count(), 0);
      // Meus feedbacks: contagem, galeria com link temporário, nome como texto, adicionar só se aberto.
      const cards = page.locator(".feedback-list .feedback-card");
      assert.match(await cards.nth(0).innerText(), /2 anexos/);
      assert.match(await cards.nth(1).innerText(), /1 anexo/);
      assert.equal(await cards.nth(0).getByText("Adicionar imagem").count(), 1);
      assert.equal(await cards.nth(1).getByText("Adicionar imagem").count(), 0, "RESOLVED não aceita imagens novas");
      await cards.nth(0).getByRole("button", { name: "Ver anexos" }).click();
      await cards.nth(0).locator(".fb-thumb img").nth(1).waitFor();
      assert.match(await cards.nth(0).locator(".fb-gallery").innerText(), /<img src=x onerror="window.__xss=1">\.png/);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      const link = cards.nth(0).getByRole("link", { name: /Visualizar captura-erro\.png/ });
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.match(await link.getAttribute("href"), /X-Amz-Expires=300/);
      assert.ok(await noOverflow(page), `Meus feedbacks sem rolagem lateral em ${width}px`);
      if (process.env.ATTACHMENT_SCREENSHOTS) await page.locator(".feedback-list").screenshot({ path: path.join(process.env.ATTACHMENT_SCREENSHOTS, `anexos-meus-${width}.png`) });
      // Adicionar imagem pelo card envia na hora para aquele feedback.
      await pick(page, cards.nth(0).getByRole("button", { name: "Adicionar imagem" }), image("mais-uma.png", "image/png"));
      await page.getByText("Imagem anexada ao feedback.").waitFor();
      assert.equal(api.slots.at(-1).feedbackId, "20260926T120000000000-11111111");
      assert.deepEqual(api.errors, []);
      await context.close();
    }
    // Admin: galeria no detalhe, só leitura.
    {
      const { context, page, api } = await open("admin", width);
      await page.getByRole("button", { name: "Feedbacks", exact: true }).click();
      await page.locator(".fb-open").first().waitFor();
      assert.match(await page.locator(".fb-open").first().innerText(), /2 anexos/);
      await page.locator(".fb-open").first().click();
      await page.locator(".fb-detail .fb-thumb img").nth(1).waitFor();
      const gallery = page.locator(".fb-detail-attachments");
      assert.match(await gallery.innerText(), /Anexos[\s\S]*captura-erro\.png[\s\S]*1,8 MB[\s\S]*Visualizar/);
      assert.equal(await gallery.locator("input, [data-fb-remove-file], .fb-add").count(), 0, "admin só lê");
      assert.equal(api.downloads.length, 2, "um link temporário por imagem visível");
      assert.ok(await noOverflow(page), `detalhe do admin sem rolagem lateral em ${width}px`);
      if (process.env.ATTACHMENT_SCREENSHOTS) await page.locator(".fb-detail").screenshot({ path: path.join(process.env.ATTACHMENT_SCREENSHOTS, `anexos-admin-${width}.png`) });
      assert.deepEqual(api.errors, []);
      await context.close();
    }
  }

  // Feedback duplicado: as imagens vão para o feedback existente devolvido pelo backend.
  {
    const { context, page, api } = await open("student");
    api.duplicate = true;
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    await pick(page, addButton(page), image("esqueci.png", "image/png"));
    await fillForm(page);
    await page.getByRole("button", { name: "Enviar feedback" }).click();
    await page.getByText("Este feedback já tinha sido enviado.").waitFor();
    assert.equal(api.slots[0].feedbackId, "20260926T110000000000-dddddddd");
    assert.equal(api.completes.length, 1);
    assert.deepEqual(api.errors, []);
    await context.close();
  }
  // Cenários adicionais em 1440px: caracterizam o comportamento atual antes de mover o código.
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const exposeState = (page) => page.evaluate(async () => { window.__state = (await import("/state.js")).state; });
  const snapshot = (page, key) => page.evaluate((k) => JSON.parse(JSON.stringify(window.__state[k])), key);
  const noticeTexts = (page) => page.locator("#notices .notice").evaluateAll((els) => els.map((el) => ({ error: el.classList.contains("error"), text: el.querySelector("span").textContent })));
  // Espiona os object URLs da página sem mudar o comportamento: o que foi criado (e para qual arquivo) e o que foi liberado.
  const spyUrls = (page) => page.evaluate(() => {
    const created = [], revoked = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => { const url = create(object); created.push({ url, name: object?.name ?? null }); return url; };
    URL.revokeObjectURL = (url) => { revoked.push(url); return revoke(url); };
    window.__urls = { created, revoked };
  });
  const urls = (page) => page.evaluate(() => ({ created: window.__urls.created.map((c) => ({ ...c })), revoked: [...window.__urls.revoked] }));
  const urlOf = (list, name) => list.created.find((c) => c.name === name).url;
  const fileCount = (page, n) => page.waitForFunction((count) => document.querySelectorAll(".fb-file").length === count, n);
  const openForm = async () => {
    const opened = await open("student");
    await opened.page.getByRole("button", { name: "Feedback", exact: true }).click();
    await opened.page.getByRole("heading", { name: "Ajude a melhorar a plataforma" }).waitFor();
    await exposeState(opened.page);
    await spyUrls(opened.page);
    return opened;
  };
  const emptyUpload = { feedbackId: null, progress: "", failed: false };
  // Três imagens e o primeiro envio ao S3 recusado: o feedback é criado, 2 anexam e 1 falha.
  const partialFailure = async (page, api) => {
    await pick(page, addButton(page), [image("x1.png", "image/png"), image("x2.png", "image/png"), image("x3.png", "image/png")]);
    await fileCount(page, 3);
    api.failS3Once = true;
    await fillForm(page);
    await page.getByRole("button", { name: "Enviar feedback" }).click();
    await page.locator(".fb-partial").waitFor();
    assert.deepEqual((await snapshot(page, "feedbackFiles")).map((f) => [f.name, f.status]), [["x1.png", "failed"], ["x2.png", "done"], ["x3.png", "done"]]);
    assert.deepEqual([api.slots.length, api.s3.length, api.completes.length], [3, 3, 2]);
    assert.deepEqual((await urls(page)).revoked, [], "nada é liberado na falha parcial");
  };

  // Limite de 3 imagens, remoção e envio completo: cada URL local é liberada uma vez, no momento certo.
  {
    const { context, page, api } = await openForm();
    await pick(page, addButton(page), [image("a.png", "image/png"), image("b.jpg", "image/jpeg")]);
    await fileCount(page, 2);
    // Só cabe mais uma: a quarta é recusada, sem URL local, e as já aceitas continuam.
    await pick(page, addButton(page), [image("c.webp", "image/webp"), image("d.png", "image/png")]);
    await page.getByText("Você pode anexar até 3 imagens por feedback.").waitFor();
    assert.deepEqual(await noticeTexts(page), [{ error: true, text: "Você pode anexar até 3 imagens por feedback." }]);
    await fileCount(page, 3);
    let files = await snapshot(page, "feedbackFiles");
    let u = await urls(page);
    assert.deepEqual(files.map((f) => f.name), ["a.png", "b.jpg", "c.webp"]);
    assert.deepEqual(u.created.map((c) => c.name), ["a.png", "b.jpg", "c.webp"], "a recusada não ganha URL local");
    assert.deepEqual(files.map((f) => f.previewUrl), u.created.map((c) => c.url));
    assert.equal(await addButton(page).count(), 0);
    // Remover libera só a URL do arquivo removido.
    await page.locator(".fb-file", { hasText: "b.jpg" }).locator(".fb-remove").click();
    await fileCount(page, 2);
    u = await urls(page);
    assert.deepEqual(u.revoked, [urlOf(u, "b.jpg")]);
    files = await snapshot(page, "feedbackFiles");
    assert.deepEqual(files.map((f) => [f.name, f.previewUrl]), [["a.png", urlOf(u, "a.png")], ["c.webp", urlOf(u, "c.webp")]]);
    // Envio completo (feedback, slot, S3 e conclusão): as URLs enviadas são liberadas e a lista local zera.
    await fillForm(page);
    await page.getByRole("button", { name: "Enviar feedback" }).click();
    await page.locator(".feedback-success").waitFor();
    u = await urls(page);
    assert.deepEqual(u.revoked, [urlOf(u, "b.jpg"), urlOf(u, "a.png"), urlOf(u, "c.webp")]);
    assert.deepEqual(await snapshot(page, "feedbackFiles"), []);
    assert.deepEqual(await snapshot(page, "feedbackUpload"), emptyUpload);
    assert.deepEqual([api.feedbackPosts.length, api.slots.length, api.s3.length, api.completes.length], [1, 2, 2, 2]);
    assert.deepEqual([api.errors, api.unexpected], [[], []]);
    await context.close();
  }

  // Falha parcial e "Descartar imagens": libera todas as URLs locais, zera o envio e não apaga nada no backend.
  {
    const { context, page, api } = await openForm();
    await partialFailure(page, api);
    const u0 = await urls(page);
    await page.getByRole("button", { name: "Descartar imagens" }).click();
    await fileCount(page, 0);
    const u = await urls(page);
    assert.deepEqual(u.revoked, u0.created.map((c) => c.url));
    assert.deepEqual(await snapshot(page, "feedbackFiles"), []);
    assert.deepEqual(await snapshot(page, "feedbackUpload"), emptyUpload);
    assert.equal(await snapshot(page, "feedbackSent"), false);
    assert.equal(await page.locator(".feedback-success").count(), 0);
    assert.equal(await page.locator(".fb-partial").count(), 0);
    assert.ok(await page.getByRole("button", { name: "Enviar feedback" }).isEnabled());
    assert.deepEqual([api.slots.length, api.s3.length, api.completes.length], [3, 3, 2], "nenhum envio novo");
    assert.deepEqual([api.errors, api.unexpected], [[], []], "nada é apagado no backend");
    await context.close();
  }

  // Falha parcial e remoção da imagem que falhou: o envio fica concluído com as imagens anexadas.
  {
    const { context, page, api } = await openForm();
    await partialFailure(page, api);
    const u0 = await urls(page);
    await page.locator(".fb-file.failed .fb-remove").click();
    await fileCount(page, 2);
    const u = await urls(page);
    assert.deepEqual(u.revoked, [urlOf(u0, "x1.png")]);
    // As duas já anexadas continuam na lista local, com as URLs vivas (comportamento atual).
    assert.deepEqual((await snapshot(page, "feedbackFiles")).map((f) => [f.name, f.status, f.previewUrl]),
      [["x2.png", "done", urlOf(u0, "x2.png")], ["x3.png", "done", urlOf(u0, "x3.png")]]);
    assert.deepEqual(await snapshot(page, "feedbackUpload"), emptyUpload);
    assert.equal(await snapshot(page, "feedbackSent"), true);
    assert.equal(await page.locator(".feedback-success").innerText(), "Feedback enviado com sucesso.");
    assert.equal(await page.locator(".fb-partial").count(), 0);
    assert.deepEqual([api.slots.length, api.s3.length, api.completes.length], [3, 3, 2]);
    assert.deepEqual([api.errors, api.unexpected], [[], []]);
    await context.close();
  }

  // Card: fechar e reabrir a galeria; envio pelo card com falha e depois com sucesso.
  {
    const { context, page, api } = await open("student");
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    const card = page.locator(".feedback-list .feedback-card").first();
    await card.waitFor();
    await exposeState(page);
    await spyUrls(page);
    const id = "20260926T120000000000-11111111";
    const gallery = () => page.evaluate((key) => JSON.parse(JSON.stringify(window.__state.feedbackAttachments[key])), id);
    await card.getByRole("button", { name: "Ver anexos" }).click();
    await card.locator(".fb-thumb img").nth(1).waitFor();
    const opened = await gallery();
    const downloads = api.downloads.length, lists = api.lists.length;
    // Fechar só esconde: lista e links ficam no cache, sem download novo nem URL liberada.
    await card.getByRole("button", { name: "Ocultar anexos" }).click();
    await card.locator(".fb-gallery").waitFor({ state: "detached" });
    assert.deepEqual(await gallery(), { ...opened, open: false });
    assert.deepEqual([api.downloads.length, api.lists.length], [downloads, lists]);
    assert.deepEqual((await urls(page)).revoked, []);
    // Reabrir busca de novo a lista e os links temporários.
    await card.getByRole("button", { name: "Ver anexos" }).click();
    await card.locator(".fb-thumb img").nth(1).waitFor();
    assert.deepEqual([api.downloads.length, api.lists.length], [downloads + 2, lists + 1]);
    // Envio pelo card retido no S3: o card fica ocupado e mostra o progresso.
    const settle = async () => {
      const reload = page.waitForResponse((r) => r.request().method() === "GET" && r.url().endsWith(`/feedback/${id}/attachments`));
      return async () => { await reload; await page.waitForFunction((key) => !window.__state.feedbackAttachments[key].loading, id); };
    };
    const hold = { arrived: deferred(), gate: deferred() };
    api.holdS3 = hold;
    api.failS3Once = true;
    const before = { mine: api.mineGets, lists: api.lists.length, completes: api.completes.length };
    await pick(page, card.getByRole("button", { name: "Adicionar imagem" }), image("falha.png", "image/png"));
    await hold.arrived.promise;
    assert.deepEqual((await snapshot(page, "feedbackCardUpload"))[id], { busy: true, message: "Enviando imagem 1 de 1…" });
    assert.ok(await card.getByRole("button", { name: "Adicionar imagem" }).isDisabled());
    assert.equal(await card.locator(".fb-card-progress").innerText(), "Enviando imagem 1 de 1…");
    let u = await urls(page);
    assert.deepEqual(u.created.map((c) => c.name), ["falha.png"]);
    assert.deepEqual(u.revoked, []);
    const failed = await settle();
    hold.gate.resolve();
    await failed();
    assert.deepEqual((await snapshot(page, "feedbackCardUpload"))[id], { busy: false, message: "Não foi possível anexar a imagem. Tente de novo." });
    assert.equal(await card.locator(".fb-card-progress").innerText(), "Não foi possível anexar a imagem. Tente de novo.");
    assert.ok(await card.getByRole("button", { name: "Adicionar imagem" }).isEnabled());
    assert.deepEqual((await urls(page)).revoked, [urlOf(u, "falha.png")], "o finally libera a URL local");
    assert.deepEqual([api.mineGets, api.lists.length, api.completes.length], [before.mine + 1, before.lists + 1, before.completes],
      "recarrega Meus feedbacks e a galeria aberta; o anexo recusado não é concluído");
    assert.match(await card.innerText(), /2 anexos/);
    assert.equal(await card.locator(".fb-thumb").count(), 2);
    assert.equal(await page.getByText("Imagem anexada ao feedback.").count(), 0);
    // Sem nova tentativa automática: é preciso escolher de novo. O sucesso também libera a URL.
    const done = await settle();
    await pick(page, card.getByRole("button", { name: "Adicionar imagem" }), image("ok.png", "image/png"));
    await page.getByText("Imagem anexada ao feedback.").waitFor();
    await done();
    u = await urls(page);
    assert.deepEqual(u.revoked, [urlOf(u, "falha.png"), urlOf(u, "ok.png")]);
    assert.deepEqual((await snapshot(page, "feedbackCardUpload"))[id], { busy: false, message: "" });
    assert.deepEqual([api.mineGets, api.completes.length], [before.mine + 2, before.completes + 1]);
    assert.deepEqual([api.errors, api.unexpected], [[], []]);
    await context.close();
  }
  console.log("Anexos: validação local, prévias, envio direto ao S3, falha parcial e nova tentativa, Meus feedbacks, admin, duplicado e 375/768/1440 OK; limite de 3, URLs locais, descarte, remoção após falha, card com falha e galeria fechada OK.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

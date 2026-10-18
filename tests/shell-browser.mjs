// Casca global do produto (piloto visual, 3ª iteração; docs/design-visual.md), com API fictícia. Nunca acessa AWS,
// Cognito ou Canvas. Cobre o que a casca promete em todas as telas e papéis (aluno, instrutor, admin): sem moldura de
// foco no <main> e mesmo destino de foco (C7.1), marca de referência no item ativo, fonte do sistema só na casca,
// topo compacto, cabeçalho e barra inferior do celular mais baixos, foco nunca atrás da barra e nada fora da tela.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});

const canvas = (n) => `https://awsrestart.instructure.com/courses/4436/modules/items/${n}`;
const act = (id, name, kind, state, percent = null) => ({ id, name, kind, state, percent, score: percent, points: "100", active: state !== "unreleased",
  needsReview: state === "completed" && percent != null && percent < (kind === "kc" ? 70 : 95), module: "Linux", moduleOrder: 7,
  canvasUrl: ["pending", "completed"].includes(state) ? canvas(9100 + Number(id.slice(1))) : null, releasedAt: "2026-09-07T12:00:00Z" });
const activities = [
  act("a1", "226-LX-KC - Uma introdução ao Linux", "kc", "completed", 60),
  act("a2", "227--Lab - Linha de comando do Linux", "lab", "completed", 88.5),
  act("a3", "225--Lab - Introdução ao Linux", "lab", "completed", 100),
  act("a4", "254-NF- KC Introdução à rede", "kc", "pending"),
  act("a5", "255--Lab - Sub-redes e tabelas de rotas", "lab", "completed", 97),
];
const student = { id: "1", name: "Maria Teste", email: "maria@example.test", kc: 60, lab: 95.17, total: 77.6, completed: 4, pending: 1, progress: 80, status: "attention", activities };
const history = [
  { publishedAt: "2026-10-09T21:00:00Z", current: true, kc: 60, lab: 95.17, total: 77.6, changes: null },
  { publishedAt: "2026-10-02T21:00:00Z", current: false, kc: 55, lab: 92, total: 73.5, changes: null },
];
const report = { cohort: "BRSA0267", publication: { id: "p1", publishedAt: "2026-10-09T21:00:00Z" }, updatedAt: "2026-10-09T21:00:00Z",
  updateKind: "canvas", thresholds: { kc: 70, lab: 95 }, student, history, focus: { activityIds: [], version: null } };
const ROLES = { student: ["student"], instructor: ["instructor"], admin: ["admin", "instructor"] };
// Telas por papel: [botão do menu (nome acessível), título h1 esperado].
const VIEWS = {
  student: [["Meu desempenho", "Bom ter você aqui, Maria."], ["Minhas atividades", "Minhas atividades"], ["Meu histórico", "Meu histórico"], ["Feedback", "Ajude a melhorar a plataforma"]],
  // O Feedback do instrutor (pelo rodapé) fica fora do piloto: é onde a fonte da casca não vem também da regra da tela (as telas
  // expandidas dão a fonte do sistema ao .layout inteiro), então só ela prova a regra da casca (seção 29). Até a Expansão 5 era
  // "Atualizar notas"; na Expansão 6, "Lembretes".
  instructor: [["Painel do instrutor", "Painel da BRSA0267"], ["Publicações da turma", "Publicações da turma"], ["Atualizar notas", "Atualizar notas da BRSA0267"], ["Lembretes", "Lembretes por e-mail"],
    ["Enviar feedback", "Ajude a melhorar a plataforma"]],
  admin: [["Painel do instrutor", "Painel da BRSA0267"]],
};

let browser, origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function open({ role = "student", width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [], external = [];
  // Pedidos à API em andamento: idle() espera todos terminarem e a tela redesenhar (a carga de uma tela redesenha a página
  // inteira, inclusive o link "Pular para o conteúdo").
  let inflight = 0, waiters = [];
  const api = (request) => new URL(request.url()).pathname.startsWith("/api/");
  page.on("request", (request) => { if (api(request)) inflight++; });
  const finished = (request) => { if (api(request) && --inflight === 0) waiters.splice(0).forEach((resolve) => resolve()); };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  const idle = async () => {
    if (inflight) await new Promise((resolve) => waiters.push(resolve));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({ accessToken: "test", expires: Date.now() + 3600000 })));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname === "/config.json") return route.fulfill({ json: { apiUrl: origin + "/api" } });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const endpoint = url.pathname.slice(4);
    if (endpoint === "/me") return route.fulfill({ json: { roles: ROLES[role], email: `${role}@example.test` } });
    if (endpoint === "/cohorts") return route.fulfill({ json: { cohorts: [{ code: "BRSA0267", canTeach: role !== "student", autoSync: true }] } });
    if (endpoint.endsWith("/report")) return route.fulfill({ json: role === "student" ? report : { ...report, students: [student], activities } });
    if (endpoint === "/feedback") return route.fulfill({ json: { items: [], nextCursor: null } });
    if (endpoint.endsWith("/reminder-settings")) return route.fulfill({ json: { enabled: true, ready: true, sender: `${role}@example.test`, reason: "Remetente confirmado." } });
    throw new Error("endpoint não simulado: " + endpoint);
  });
  await page.goto(origin);
  await page.locator(".layout .page-heading h1").waitFor();
  return { context, page, errors, external, idle };
}
async function go(page, label, title) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("heading", { name: title, level: 1 }).waitFor();
}

test("S1: o <main> não ganha moldura de foco em nenhuma tela; o destino do foco (C7.1) continua o mesmo", async () => {
  for (const role of ["student", "instructor"]) {
    const { context, page, errors, idle } = await open({ role });
    // Começa pela segunda tela: Enter no item da tela atual não troca de tela (o foco fica no botão, como antes).
    for (const [label, title] of [...VIEWS[role].slice(1), VIEWS[role][0]]) {
      // Troca de tela pelo teclado: foco no h1 da tela (C7.1), como antes.
      await page.getByRole("button", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: title, level: 1 }).waitFor();
      // Com a carga da tela terminada: se ela chegasse com o foco em "Pular para o conteúdo", o render recriaria o link e o foco
      // iria ao <body> (regra de foco do render(), C7.1, registrada à parte) — era a instabilidade deste teste em Lembretes e no
      // Feedback, reproduzida de forma determinística nos dois builds.
      await idle();
      assert.deepEqual(await page.evaluate(() => [document.activeElement.tagName, document.activeElement.textContent.trim()]), ["H1", title], `${role}: ${label}`);
      // Pular para o conteúdo → <main>, sem a moldura do navegador; o próximo Tab mostra o contorno de 3 px.
      await page.locator(".skip-link").focus();
      await page.keyboard.press("Enter");
      const main = await page.evaluate(() => [document.activeElement.id, getComputedStyle(document.activeElement).outlineStyle]);
      assert.deepEqual(main, ["main-content", "none"], `${role}: ${label}`);
      await page.keyboard.press("Tab");
      assert.deepEqual(await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; }), ["solid", "3px"], `${role}: ${label}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("S2: o item ativo do menu leva a marca de referência (régua + triângulo), no desktop e no celular", async () => {
  for (const width of [1440, 390]) {
    const { context, page } = await open({ width });
    for (const [label, title] of VIEWS.student) {
      await go(page, label, title);
      // Leitura numa chamada só: locator.evaluateAll consulta e avalia em duas, e o Feedback redesenha quando a lista
      // chega; no meio, os itens consultados ficavam desanexados (getComputedStyle vazio) e o teste falhava sem defeito.
      const marks = await page.evaluate(() => [...document.querySelectorAll(".sidebar nav .nav-item")].map((el) => {
        const rule = getComputedStyle(el, "::before"), tip = getComputedStyle(el, "::after");
        return { current: el.getAttribute("aria-current") === "page", rule: rule.content !== "none" && rule.display !== "none", tip: tip.content !== "none" && tip.display !== "none", color: rule.backgroundColor };
      }));
      assert.equal(marks.filter((m) => m.current).length, 1, `um item atual em ${label}`);
      for (const m of marks) {
        assert.equal(m.rule && m.tip, m.current, `marca só no item atual (${label}, ${width}px): ${JSON.stringify(m)}`);
        if (m.current) assert.equal(m.color, "rgb(0, 175, 232)", "marca no ciano da navegação");
      }
    }
    await context.close();
  }
});

test("S3: a casca usa a fonte do sistema em todas as telas; o conteúdo das telas fora do piloto não muda", async () => {
  for (const role of ["student", "instructor", "admin"]) {
    const { context, page } = await open({ role });
    for (const [label, title] of VIEWS[role]) {
      await go(page, label, title);
      const fonts = await page.evaluate(() => Object.fromEntries([".sidebar", ".topline", ".main-footer"].map((s) => [s, getComputedStyle(document.querySelector(s)).fontFamily])));
      for (const [part, family] of Object.entries(fonts)) assert.match(family, /^system-ui/, `${role} · ${label} · ${part}`);
      // Cada texto da casca, não só os contêineres (regras antigas davam monoespaçada a rótulos). Monoespaçada só em
      // códigos: o seletor da turma e as iniciais da conta.
      const odd = await page.evaluate(() => [...document.querySelectorAll(".sidebar *, .topline *, .main-footer *")]
        .filter((el) => el.getClientRects().length && [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) && !el.matches("#cohort, #cohort *, .avatar"))
        .filter((el) => !/^system-ui/.test(getComputedStyle(el).fontFamily)).map((el) => `${el.className || el.tagName}: ${getComputedStyle(el).fontFamily.split(",")[0]}`));
      assert.deepEqual(odd, [], `${role} · ${label}: textos da casca fora da fonte do sistema`);
      // Expandidas: Meu desempenho, Minhas atividades, (Expansão 2) Meu histórico, (Expansão 3) Feedback do aluno,
      // (Expansão 4) o Painel do instrutor, (Expansão 5) Publicações da turma, (Expansão 6) Atualizar notas e (Expansão 7)
      // Lembretes, de instrutor e admin. As demais telas, e o Feedback de instrutor e admin, ficam como estavam. A leitura é de
      // uma vez só: a lista do Feedback pode chegar e recriar o título entre localizar e ler o estilo (um elemento já fora da
      // página tem estilo vazio).
      const expanded = role === "student" ? ["Meu desempenho", "Minhas atividades", "Meu histórico", "Feedback"].includes(label) : ["Painel do instrutor", "Publicações da turma", "Atualizar notas", "Lembretes"].includes(label);
      (expanded ? assert.match : assert.doesNotMatch)(await page.evaluate(() => getComputedStyle(document.querySelector(".page-heading h1")).fontFamily), /^system-ui/, `conteúdo de ${label}: ${expanded ? "expandido" : "fica para a expansão"}`);
    }
    await context.close();
  }
});

test("S4: no desktop o topo é uma linha compacta (contexto à esquerda, sessão à direita)", async () => {
  for (const role of ["student", "instructor"]) {
    const { context, page } = await open({ role });
    for (const [label, title] of VIEWS[role]) {
      await go(page, label, title);
      const top = await page.evaluate(() => {
        const bar = document.querySelector(".topline").getBoundingClientRect(), a = document.querySelector(".location-context").getBoundingClientRect(), b = document.querySelector(".session-context").getBoundingClientRect();
        return { height: Math.round(bar.height), sameRow: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 8, contextRow: (() => {
          const span = document.querySelector(".location-context > span").getBoundingClientRect(), strong = document.querySelector(".location-context strong").getBoundingClientRect();
          return Math.abs((span.top + span.bottom) / 2 - (strong.top + strong.bottom) / 2) <= 6; })() };
      });
      assert.ok(top.height <= 64, `${role} · ${label}: topo com ${top.height}px`);
      assert.ok(top.sameRow && top.contextRow, `${role} · ${label}: turma, tela e sessão numa linha`);
    }
    await context.close();
  }
});

test("S5: no celular o cabeçalho é baixo e o Sair tem área de toque de 44 px", async () => {
  for (const [width, height] of [[390, 844], [320, 640]]) {
    const { context, page } = await open({ width, height });
    const header = await page.evaluate(() => {
      const bar = document.querySelector(".sidebar").getBoundingClientRect(), logo = document.querySelector(".brand-logo").getBoundingClientRect(), out = document.querySelector('[data-action="logout"]').getBoundingClientRect();
      return { height: Math.round(bar.height), logo: Math.round(logo.height), out: [Math.round(out.width), Math.round(out.height)] };
    });
    assert.ok(header.height <= 64, `cabeçalho com ${header.height}px em ${width}px`);
    // O logo (PNG com o nome dentro do círculo) não desce de 48 px para continuar legível; quem limita é a faixa.
    assert.ok(header.logo >= 44 && header.logo <= 48, `logo com ${header.logo}px em ${width}px`);
    assert.ok(header.out.every((n) => n >= 44), `Sair com ${header.out.join("×")} em ${width}px`);
    assert.ok(await page.locator("#cohort").isVisible());
    assert.equal(await page.locator("#cohort").inputValue(), "BRSA0267");
    await context.close();
  }
});

// 3.1 (aprovado): com 6 destinos a barra ganha uma segunda linha em vez de espremer os rótulos, e o degradê saiu (mesmo
// com 16 px apagava a média de KC na primeira tela em 320×640); a borda da barra é uma linha nítida.
test("S6: a barra inferior tem uma linha com 4 destinos e duas com 6, borda nítida sem degradê, e não esconde o fim da página", async () => {
  for (const role of ["student", "admin"]) for (const [width, height] of [[390, 844], [320, 640]]) {
    const { context, page } = await open({ role, width, height });
    const nav = await page.locator(".sidebar nav").evaluate((el) => {
      const r = el.getBoundingClientRect(), fade = getComputedStyle(el, "::before"), s = getComputedStyle(el);
      return { height: Math.round(r.height), position: s.position, overlay: fade.content !== "none" && fade.content !== "normal", border: s.borderTopWidth,
        rows: new Set([...el.querySelectorAll(".nav-item")].map((i) => Math.round(i.getBoundingClientRect().top))).size,
        items: [...el.querySelectorAll(".nav-item")].map((i) => { const b = i.getBoundingClientRect(); return b.height >= 44 && b.left >= 0 && b.right <= innerWidth; }) };
    });
    assert.equal(nav.position, "fixed");
    assert.equal(nav.rows, role === "student" ? 1 : 2, `${role}: linhas da barra em ${width}px`);
    assert.ok(nav.height <= (role === "student" ? 64 : 120), `${role}: barra com ${nav.height}px em ${width}px`);
    assert.ok(!nav.overlay && nav.border === "1px", `${role}: borda nítida, sem camada sobre o conteúdo em ${width}px`);
    assert.ok(nav.items.every(Boolean), `${role}: itens com 44 px e dentro da tela em ${width}px`);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const gap = await page.evaluate(() => document.querySelector(".sidebar nav").getBoundingClientRect().top - document.querySelector(".main-footer").getBoundingClientRect().bottom);
    assert.ok(gap >= 0, `${role}: rodapé acima da barra em ${width}px`);
    await context.close();
  }
});

test("S7: em todas as telas do aluno, o foco pelo teclado nunca fica atrás da barra inferior", async () => {
  for (const [width, height] of [[390, 844], [320, 640]]) {
    const { context, page } = await open({ width, height });
    for (const [label, title] of VIEWS.student) {
      await go(page, label, title);
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator("#main-content").focus();
      const hidden = [];
      for (let i = 0; i < 50; i++) {
        await page.keyboard.press("Tab");
        const spot = await page.evaluate(() => { const a = document.activeElement; if (!a.closest(".main")) return null;
          const r = a.getBoundingClientRect(), nav = document.querySelector(".sidebar nav").getBoundingClientRect();
          return { text: (a.textContent || a.id || a.name).trim().slice(0, 30), ok: r.top >= 0 && r.bottom <= nav.top + 0.5 }; });
        if (!spot) break;
        if (!spot.ok) hidden.push(spot.text);
      }
      assert.deepEqual(hidden, [], `${label} em ${width}px`);
    }
    await context.close();
  }
});

test("S8: nenhum papel tem rolagem lateral ou item de menu fora da tela, de 320 a 1440 px", async () => {
  for (const role of ["student", "instructor", "admin"]) for (const width of [320, 390, 768, 1440]) {
    const { context, page, errors, external } = await open({ role, width });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${role} em ${width}px`);
    assert.ok(await page.locator(".sidebar nav .nav-item").evaluateAll((els) => els.every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; })), `${role}: menu em ${width}px`);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await context.close();
  }
});

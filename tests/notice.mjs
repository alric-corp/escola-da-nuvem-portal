// notice() de frontend/ui.js: contrato do aviso, com DOM mínimo e relógio controlado.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };

// DOM mínimo: só o que notice() usa.
function element(tag) {
  const node = {
    tag, className: "", type: "", textContent: "", attributes: {}, children: [], parent: null, listeners: {},
    setAttribute(name, value) { node.attributes[name] = String(value); },
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
    append(...kids) { for (const kid of kids) { kid.parent = node; node.children.push(kid); } },
    replaceChildren(...kids) { for (const kid of node.children) kid.parent = null; node.children = []; node.append(...kids); },
    remove() { if (node.parent) { node.parent.children = node.parent.children.filter((c) => c !== node); node.parent = null; } },
    click() { for (const fn of node.listeners.click || []) fn({}); },
  };
  return node;
}
const container = element("div");
globalThis.document = { createElement: element, querySelector: (selector) => (selector === "#notices" ? container : null) };

// Relógio controlado: registra os timers sem esperar.
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };

const { notice } = await import("../frontend/ui.js");
const { state } = await import("../frontend/state.js");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function reset() { container.replaceChildren(); timers.length = 0; }

test("aviso normal: div.notice com texto e botão de fechar", () => {
  reset();
  assert.equal(notice("Turma criada."), undefined);
  assert.equal(container.children.length, 1);
  const [item] = container.children;
  assert.equal(item.tag, "div");
  assert.equal(item.className, "notice ");
  const [text, close] = item.children;
  assert.equal(text.tag, "span");
  assert.equal(text.textContent, "Turma criada.");
  assert.equal(close.tag, "button");
  assert.equal(close.className, "icon-button");
  assert.equal(close.type, "button");
  assert.deepEqual(close.attributes, { "aria-label": "Fechar aviso" });
  assert.equal(close.textContent, "×");
});

test("aviso de erro: classe notice error", () => {
  reset();
  notice("Falhou.", true);
  assert.equal(container.children[0].className, "notice error");
});

test("um aviso novo substitui o anterior", () => {
  reset();
  notice("Primeiro.");
  notice("Segundo.");
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].children[0].textContent, "Segundo.");
});

test("a mensagem entra como texto, sem interpretar HTML", () => {
  reset();
  notice('<img src=x onerror="alert(1)">');
  const text = container.children[0].children[0];
  assert.equal(text.textContent, '<img src=x onerror="alert(1)">');
  assert.equal(text.innerHTML, undefined);
  assert.equal(text.children.length, 0);
});

test("o botão × remove o aviso", () => {
  reset();
  notice("Fechar.");
  container.children[0].children[1].click();
  assert.equal(container.children.length, 0);
});

test("o aviso some sozinho após 6500 ms", () => {
  reset();
  notice("Temporário.");
  assert.deepEqual(timers.map((t) => t.ms), [6500]);
  timers[0].fn();
  assert.equal(container.children.length, 0);
});

test("o timer de um aviso substituído não remove o aviso seguinte", () => {
  reset();
  notice("Antigo.");
  notice("Novo.");
  timers[0].fn();
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].children[0].textContent, "Novo.");
});

test("não altera o state", () => {
  reset();
  const before = structuredClone(state);
  notice("Sem efeito no estado.");
  notice("Nem com erro.", true);
  assert.deepEqual(state, before);
});

test("app.js usa a notice() de ui.js, sem cópia local, com 28 pontos de chamada incluindo o vínculo posterior (10 + 6 + 2 + 1 + 5 + 4)", () => {
  const app = read("frontend/app.js");
  const fromUi = [...app.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/ui\.js["']/g)]
    .flatMap(([, names]) => names.split(",").map((name) => name.trim()));
  assert.ok(fromUi.includes("notice"), "app.js deve importar notice de ./ui.js");
  assert.doesNotMatch(app, /\bfunction\s+notice\s*\(/);
  assert.match(read("frontend/ui.js"), /^export function notice\s*\(/m);
  // Chamadas reais: o nome no import não é seguido de "(". Os avisos de Turmas e acessos, Importação,
  // Admin Feedback, Feedback próprio e Lembretes moram nos handlers. A retirada do Foco da turma remove um aviso;
  // participação (C7.2.4) e Restore continuam compostos no app.js. O vínculo posterior
  // do TODO 28 acrescenta seu aviso de sucesso no handler de acessos.
  const count = (source) => (source.match(/(?<![\w.$])notice\s*\(/g) || []).length;
  const counts = [count(app), ...["access", "import", "admin-feedback", "feedback", "reminders"].map((name) => count(read(`frontend/handlers/${name}.js`)))];
  assert.deepEqual(counts, [10, 6, 2, 1, 5, 4]);
  assert.equal(counts.reduce((total, n) => total + n, 0), 28);
});

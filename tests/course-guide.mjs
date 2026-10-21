// Conteúdo institucional e apresentação pura: sem sessão real, rede ou dados pessoais.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

globalThis.location = { hostname: "portal.test", search: "" };
const { state } = await import("../frontend/state.js");
const { courseGuidePage } = await import("../frontend/pages/course-guide.js");
const { courseGuideContent: content } = await import("../frontend/course-guide-content.js");
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const htmlFor = (tab, changes = {}) => {
  const keys = ["guideTab", ...Object.keys(changes)], saved = Object.fromEntries(keys.map((key) => [key, state[key]]));
  Object.assign(state, changes, { guideTab: tab });
  try { return courseGuidePage(); } finally { Object.assign(state, saved); }
};
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("Guia apresenta três abas com seleção, associação e painéis inativos ocultos", () => {
  assert.deepEqual(content.tabs.map(({ id }) => id), ["rules", "support", "requests"]);
  for (const tab of content.tabs) {
    const html = htmlFor(tab.id);
    assert.match(html, /Guia do curso/);
    assert.match(plain(html), /As informações e os canais de apoio para acompanhar sua jornada\./);
    assert.equal((html.match(/role="tab"/g) || []).length, 3);
    assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
    for (const { id } of content.tabs) {
      const button = html.match(new RegExp(`<button\\b[^>]*data-guide-tab="${id}"[^>]*>`))?.[0];
      const panel = html.match(new RegExp(`<[^>]+\\bid="guide-panel-${id}"[^>]*>`))?.[0];
      assert.ok(button && panel, id);
      assert.match(button, new RegExp(`id="guide-tab-${id}"`));
      assert.match(button, new RegExp(`aria-controls="guide-panel-${id}"`));
      assert.match(panel, new RegExp(`aria-labelledby="guide-tab-${id}"`));
      assert.match(button, new RegExp(`aria-selected="${id === tab.id}"`));
      assert.equal(/\bhidden(?:\s|>|=)/.test(panel), id !== tab.id, `${id}: ocultação real`);
    }
  }
});

test("conteúdo informativo independe de notas, turma e estado do relatório", () => {
  const baseline = htmlFor("rules", { me: { roles: ["student"] }, code: "", report: null, reportError: "", bootError: "" });
  for (const roles of [["student"], ["instructor"], ["admin", "instructor"]])
    assert.equal(htmlFor("rules", { me: { roles }, code: "", report: null, reportError: "Falha de relatório", bootError: "" }), baseline);
});

test("requisitos diferenciam graduação, referência acadêmica e voucher sem decisão automática", () => {
  const text = plain(htmlFor("rules"));
  for (const pattern of [/Laboratórios/i, /100%/, /KCs|Quizzes/, /70%/, /80%/, /slides/i,
    /todos os KCs/i, /média elevada/i, /referências do painel/i, /não significa.*requisitos de graduação/i,
    /voucher/i, /simulado/i, /Cloud Practitioner/, /remot[ao]/i]) assert.match(text, pattern);
  assert.doesNotMatch(text, /Apto à graduação|Voucher liberado|BRSAOXXX|\b80% de média\b/i);
  assert.doesNotMatch(read("frontend/course-guide-content.js"), /https?:[^\s"']*(?:cartilha|gravacoes)/i,
    "não inventa destinos para recursos sem link fornecido");
});

test("canais e jornada mantêm exatamente os endereços fornecidos e horários explícitos", () => {
  const serialized = JSON.stringify(content);
  for (const url of ["https://meet.google.com/wgf-qmna-ajg", "https://meet.google.com/agy-gbwe-jtr",
    "https://discord.com/invite/yMPZrPUc4V", "https://2sh9po.s.gy/faltas-EDN", "https://2sh9po.s.gy/Solicita",
    "https://docs.google.com/forms/d/e/1FAIpQLSdFFlPkfcSqNNm5pcIzPToBgQ09PJfTyIH5wEuBq5yT-NsBug/viewform",
    "https://youtu.be/Kt6rDq2hbP4", "https://youtu.be/X__7yCzRxc4"]) assert.ok(serialized.includes(url), url);
  const support = plain(htmlFor("support"));
  for (const phrase of [/8h às 9h/, /18h às 19h/, /Quintas-feiras, às 14h/, /Brasília/, /não é uma aula expositiva/i]) assert.match(support, phrase);
  assert.doesNotMatch(support, /14h45|Ao vivo|24 horas|atendimento imediato/);
  const requests = plain(htmlFor("requests"));
  for (const phrase of [/terças e quintas-feiras/, /Enviar o formulário não significa.*aprovada/, /deferida/, /indeferida/, /inválida/]) assert.match(requests, phrase);
  assert.doesNotMatch(requests, /semana passada/);
});

test("resumo da normativa preserva ressalvas e contexto de prazos", () => {
  const text = plain(htmlFor("requests"));
  for (const phrase of [/justificativa não anula automaticamente/i, /sete faltas justificadas/i, /dois dias úteis/i,
    /término do impedimento/i, /CID não é obrigatório/i, /rasurados/i, /prints/i, /duas faltas/i,
    /internet/i, /energia/i, /individua[il]/i, /generalizad/i, /não previstos.*(?:artigo|art\.) 3/i, /uma semana/i]) assert.match(text, phrase);
  assert.match(text, /não significa sete abonos garantidos/i);
  assert.doesNotMatch(text, /(?:você tem|garantimos) sete abonos|aprovação garantida|voucher garantido/i);
});

test("documentos institucionais reais têm caminhos estáveis e não vazios", () => {
  for (const [file, signature] of [["normativa-abono-faltas.pdf", "%PDF-"], ["aula-inaugural-regras-curso.pptx", "PK\x03\x04"]]) {
    const bytes = readFileSync(new URL(`../frontend/documents/${file}`, import.meta.url));
    assert.equal(bytes.subarray(0, Buffer.byteLength(signature)).toString(), signature);
    assert.ok(bytes.length > 1000, file);
    const all = ["rules", "requests"].map((tab) => htmlFor(tab)).join("");
    assert.ok(all.includes(file), `${file}: link para arquivo existente`);
  }
  assert.match(content.metadata.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(content.metadata.timeZone, "America/Sao_Paulo");
});

test("guia só apresenta conteúdo; sessão/OAuth e rede continuam fora da página e do conteúdo", () => {
  for (const file of ["frontend/pages/course-guide.js", "frontend/course-guide-content.js"])
    assert.doesNotMatch(read(file), /\bfetch\s*\(|\bapi\.|localStorage|sessionStorage|addEventListener|URLSearchParams|document\.(?:querySelector|getElement|createElement|body|addEventListener)|window\./, file);
  const app = read("frontend/app.js");
  assert.doesNotMatch(app, /(?:get|set)\(["'](?:code|state)["'][^\n]*guide/i);
  assert.doesNotMatch(read("frontend/pages/course-guide.js"), /<iframe|<video|<form|type="checkbox"/i);
});

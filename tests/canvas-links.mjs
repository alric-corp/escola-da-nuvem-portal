import assert from "node:assert/strict";
import test from "node:test";
import { canvasActivityLink, canvasCatalogs, cohortCanvasCourses } from "../frontend/canvas-links.js";

const kc = { name: "10- CF - KC — Introdução ao Amazon S3", kind: "kc", state: "pending" };
const lab = { name: "11--Lab - Introdução ao Amazon EC2", kind: "lab", state: "pending" };

test("usa os itens de módulo fornecidos, não o ID da tarefa do CSV", () => {
  assert.deepEqual(canvasActivityLink("4436", { ...kc, id: `${kc.name} (643105)` }), {
    url: "https://awsrestart.instructure.com/courses/4436/modules/items/2892243",
    label: "Abrir KC no Canvas",
  });
  assert.deepEqual(canvasActivityLink("4436", lab), {
    url: "https://awsrestart.instructure.com/courses/4436/modules/items/2892246",
    label: "Abrir LAB no Canvas",
  });
});

test("tolera formatação do CSV, preservando o título completo", () => {
  const formatted = { ...kc, name: " 10_CF_KC - INTRODUCAO AO AMAZON S3 (643105) " };
  assert.deepEqual(canvasActivityLink("4436", formatted), canvasActivityLink("4436", kc));
  assert.equal(canvasActivityLink("4436", { ...kc, name: "10-CF-KC - Outro assunto" }), null);
  assert.equal(canvasActivityLink("4436", { ...kc, kind: "lab" }), null);
});

test("não reaproveita itens de um curso para outro", () => {
  assert.equal(cohortCanvasCourses.BRSA0267, "4436");
  assert.equal(canvasActivityLink(cohortCanvasCourses.BRSA0267, kc).url,
    "https://awsrestart.instructure.com/courses/4436/modules/items/2892243");
  for (const course of [undefined, "", "4437", "toString", "__proto__"])
    assert.equal(canvasActivityLink(course, kc), null);
  assert.equal(cohortCanvasCourses.BRSA0257, "4413");
  assert.equal(canvasActivityLink(cohortCanvasCourses.BRSA0257, kc).url,
    "https://awsrestart.instructure.com/courses/4413/modules/items/2877585");
  assert.equal(canvasActivityLink(cohortCanvasCourses.BRSA0257, lab).url,
    "https://awsrestart.instructure.com/courses/4413/modules/items/2877588");
  assert.equal(cohortCanvasCourses.BRSA0268, undefined);
});

test("não usa outro catálogo para preencher atividades ausentes", () => {
  const cli = { ...lab, name: "168--Lab - Instalar e configurar a CLI da AWS" };
  assert.equal(canvasActivityLink("4413", cli).url,
    "https://awsrestart.instructure.com/courses/4413/modules/items/2877640");
  assert.equal(canvasActivityLink("4436", cli).url,
    "https://awsrestart.instructure.com/courses/4436/modules/items/2892476");
  const python = { ...kc, name: "119- PF -KC - Introdução ao Python" };
  assert.ok(canvasActivityLink("4436", python));
  assert.equal(canvasActivityLink("4413", python), null);
});

test("não inventa links para lacunas da lista", () => {
  for (const name of [
    "999-KC - Atividade fictícia sem catálogo",
    "195-CERT-KC - Outro conteúdo de certificação",
  ]) assert.equal(canvasActivityLink("4436", { ...kc, name }), null);
});

test("resolve títulos com colchetes e desafios para o curso correspondente", () => {
  const activity = { ...kc, name: "167-[JAWS]-KC - Well-Architected Framework (643121)" };
  assert.equal(canvasActivityLink("4436", activity).url,
    "https://awsrestart.instructure.com/courses/4436/modules/items/2892463");
  assert.equal(canvasActivityLink("4413", activity).url,
    "https://awsrestart.instructure.com/courses/4413/modules/items/2877627");
  const challenge = { ...lab, name: "177--Lab - [Desafio] Exercício do AWS Lambda (643131)" };
  assert.equal(canvasActivityLink("4436", challenge).url,
    "https://awsrestart.instructure.com/courses/4436/modules/items/2892516");
  assert.equal(canvasActivityLink("4413", challenge).url,
    "https://awsrestart.instructure.com/courses/4413/modules/items/2877680");
});

test("mantém notas e não oferece ação para atividade não liberada ou dispensada", () => {
  const completed = { ...kc, state: "completed", percent: 0 };
  assert.equal(canvasActivityLink("4436", completed).label, "Ver atividade no Canvas");
  assert.equal(completed.percent, 0);
  assert.equal(completed.state, "completed");
  for (const state of ["unreleased", "exempt", undefined])
    assert.equal(canvasActivityLink("4436", { ...kc, state }), null);
});

test("catálogos têm destinos únicos e cada título resolve para seu próprio link", () => {
  for (const [courseId, expectedCount] of [["4436", 170], ["4413", 75]]) {
    const catalog = canvasCatalogs[courseId];
    assert.equal(catalog.length, expectedCount);
    assert.equal(new Set(catalog.map((a) => a.url)).size, catalog.length);
    for (const item of catalog) {
      const url = new URL(item.url);
      assert.equal(url.origin, "https://awsrestart.instructure.com");
      assert.match(url.pathname, new RegExp(`^/courses/${courseId}/modules/items/\\d+$`));
      assert.equal(canvasActivityLink(courseId, { name: item.title, kind: item.kind, state: "pending" }).url, item.url);
    }
  }
});

test("link do catálogo do Canvas tem prioridade e só aceita item de módulo do Canvas", () => {
  const item = "https://awsrestart.instructure.com/courses/4999/modules/items/123";
  const activity = { name: "Título sem correspondência na lista fixa", kind: "kc", state: "pending", canvasUrl: item };
  assert.deepEqual(canvasActivityLink("4999", activity), { url: item, label: "Abrir KC no Canvas" });
  assert.equal(canvasActivityLink("4999", { ...activity, state: "unreleased" }), null);
  assert.equal(canvasActivityLink("4436", { ...kc, state: "pending", canvasUrl: null }), null);
  for (const url of ["javascript:alert(1)", "https://evil.test/courses/1/modules/items/2", item + "?x=1"])
    assert.equal(canvasActivityLink("4999", { ...activity, canvasUrl: url }), null, url);
});

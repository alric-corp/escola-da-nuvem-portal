import assert from "node:assert/strict";
import test from "node:test";
import { canvasActivityLink } from "../frontend/canvas-links.js";

const item = "https://awsrestart.instructure.com/courses/4436/modules/items/2892243";
const kc = { name: "10- CF - KC — Introdução ao Amazon S3", kind: "kc", state: "pending", canvasUrl: item };

test("usa o item de módulo que o backend anotou na atividade", () => {
  assert.deepEqual(canvasActivityLink(kc), { url: item, label: "Abrir KC no Canvas" });
  assert.deepEqual(canvasActivityLink({ ...kc, kind: "lab" }), { url: item, label: "Abrir LAB no Canvas" });
  assert.equal(canvasActivityLink({ ...kc, state: "completed" }).label, "Ver atividade no Canvas");
});

test("sem link para atividade não liberada ou dispensada", () => {
  for (const state of ["unreleased", "exempt", "inactive"])
    assert.equal(canvasActivityLink({ ...kc, state }), null, state);
});

test("sem catálogo ou fora de módulo, não há link (nem por título)", () => {
  const { canvasUrl, ...plain } = kc;
  assert.equal(canvasActivityLink(plain), null);
  assert.equal(canvasActivityLink({ ...kc, canvasUrl: null }), null);
});

test("só aceita item de módulo do Canvas da AWS re/Start", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://evil.test/courses/1/modules/items/2",
    "http://awsrestart.instructure.com/courses/4436/modules/items/1",
    "https://awsrestart.instructure.com/courses/4436/assignments/1",
    item + "?x=1",
    item + "/../../evil",
  ]) assert.equal(canvasActivityLink({ ...kc, canvasUrl: url }), null, url);
});

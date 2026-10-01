// Comportamento dos handlers sem navegador: render simulado e, quando há rede, transporte falso.
import assert from "node:assert/strict";
import test from "node:test";

// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const { state: direct } = await import("../frontend/state.js");
const importHandlers = await import("../frontend/handlers/import.js");
const feedbackHandlers = await import("../frontend/handlers/feedback.js");
const remindersHandlers = await import("../frontend/handlers/reminders.js");
const apiModule = await import("../frontend/api.js");

// A troca de usuário zera arquivo e prévia, mas não acknowledgeRemoved nem importLoading (comportamento
// anterior à extração, sem teste de navegador direto para importLoading).
test("resetDraftsForUser descarta os rascunhos e preserva acknowledgeRemoved e importLoading", () => {
  const keys = ["code", "csv", "filename", "preview", "dirty", "acknowledgeRemoved", "importLoading"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  try {
    importHandlers.resetDraftsForUser("primeiro@example.test");
    const preview = { activities: [] };
    Object.assign(direct, { code: "BRSA0001", csv: "a,b", filename: "notas.csv", preview, dirty: true, acknowledgeRemoved: true, importLoading: true });
    importHandlers.saveDraft();
    importHandlers.resetDraftsForUser("primeiro@example.test");
    assert.equal(direct.csv, "a,b");
    assert.equal(direct.preview, preview);
    direct.csv = "";
    assert.ok(importHandlers.hasUnpublishedCsv());
    direct.csv = "a,b";
    importHandlers.resetDraftsForUser("segundo@example.test");
    assert.deepEqual({ csv: direct.csv, filename: direct.filename, preview: direct.preview, dirty: direct.dirty },
      { csv: "", filename: "", preview: null, dirty: false });
    assert.equal(direct.importLoading, true);
    assert.equal(direct.acknowledgeRemoved, true);
    assert.ok(!importHandlers.hasUnpublishedCsv());
  } finally {
    importHandlers.discardDrafts();
    Object.assign(direct, saved);
  }
});

// Fechar a galeria é síncrono: um render, sem Promise, e lista e links continuam guardados.
test("closeAttachments fecha sem Promise, com um render, e mantém items e urls", () => {
  const saved = direct.feedbackAttachments;
  let renders = 0;
  feedbackHandlers.configure({ render: () => { renders++; } });
  try {
    const items = [{ attachmentId: "a1" }], urls = { a1: "https://arquivos.example.test/a1" };
    direct.feedbackAttachments = { f1: { open: true, loading: false, error: "", items, urls } };
    assert.equal(feedbackHandlers.closeAttachments("f1"), undefined);
    assert.equal(renders, 1);
    assert.equal(direct.feedbackAttachments.f1.open, false);
    assert.equal(direct.feedbackAttachments.f1.items, items);
    assert.equal(direct.feedbackAttachments.f1.urls, urls);
  } finally {
    feedbackHandlers.configure({ render: null });
    direct.feedbackAttachments = saved;
  }
});

// Duas chamadas seguidas, sem navegador: só a mais recente aplica sucesso ou erro. O cenário completo
// (A1 → B → A2, com DOM e renders) fica na suíte de navegador.
test("loadBatchPreview: a chamada antiga que termina por último não aplica sucesso nem erro", async () => {
  const keys = ["code", "view", "batchIds", "batchPreview", "batchError", "batchResults"];
  const saved = Object.fromEntries(keys.map((key) => [key, direct[key]]));
  const calls = [];
  let renders = 0;
  apiModule.setTransport((path, options) => new Promise((resolve, reject) => calls.push({ path, body: options.body, resolve, reject })));
  remindersHandlers.configure({ render: () => { renders++; } });
  try {
    Object.assign(direct, { code: "BRSA0001", view: "reminders-batch", batchIds: ["1", "2"] });
    const older = remindersHandlers.loadBatchPreview();
    direct.batchIds = ["1"];
    const newer = remindersHandlers.loadBatchPreview();
    assert.deepEqual(calls.map((c) => [c.path, c.body]), [["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1", "2"] }],
      ["/cohorts/BRSA0001/pending-preview-batch", { studentIds: ["1"] }]]);
    assert.equal(renders, 2);
    calls[1].resolve({ recipients: [{ id: "1" }] });
    await newer;
    calls[0].resolve({ recipients: [{ id: "1" }, { id: "2" }] });
    await older;
    assert.deepEqual([direct.batchPreview, direct.batchError, direct.batchResults, renders], [{ recipients: [{ id: "1" }] }, "", null, 3]);
    const olderFail = remindersHandlers.loadBatchPreview();
    const newerFail = remindersHandlers.loadBatchPreview();
    calls[3].reject(new Error("Falha da chamada atual."));
    await newerFail;
    calls[2].reject(new Error("Falha da chamada antiga."));
    await olderFail;
    assert.deepEqual([direct.batchPreview, direct.batchError, renders], [null, "Falha da chamada atual.", 6]);
  } finally {
    remindersHandlers.configure({ render: null });
    apiModule.setTransport(() => { throw new Error("Sem rede nos testes de state."); });
    Object.assign(direct, saved);
  }
});

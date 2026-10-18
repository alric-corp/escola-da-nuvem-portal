// C2 (C2-01), sem navegador: Publicações da turma com a dúvida da restauração. A dúvida guardada para depois (a pessoa estava
// longe e o aviso curto já a anunciou) aparece na publicação que se tentou restaurar com o texto inteiro da E5 e a consulta
// segura, sem role (não se anuncia de novo); a dúvida vista na hora continua um alerta, como na E5. Em ambas, o Restaurar da
// publicação aponta para ela (aria-describedby). Dados fictícios.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.location = { hostname: "portal.test", search: "" };
globalThis.document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} }) };
const { state } = await import("../frontend/state.js");
const { historyPage } = await import("../frontend/pages/history.js");

const pub = (id, publishedAt, base) => ({ id, cohort: "BRSA0267", base, publishedAt, filename: "canvas-api.csv", publishedBy: "system:canvas-sync", status: "published",
  createdAt: publishedAt, changes: { previousCount: 24, currentCount: 24, gradesChanged: 3 } });
const history = [pub("p13", "2026-10-10T21:04:00Z", "p12"), pub("p12", "2026-10-09T21:04:00Z", "p11"), pub("p11", "2026-10-09T09:03:00Z", null)];
function page(error) {
  const saved = { report: state.report, cohorts: state.cohorts, code: state.code, studentView: state.studentView };
  try {
    Object.assign(state, { code: "BRSA0267", studentView: null, cohorts: [{ code: "BRSA0267", canTeach: true, autoSync: false }],
      report: { cohort: "BRSA0267", publication: { ...history[0], releasedAt: {} }, history, updatedAt: history[0].publishedAt, updateKind: "canvas", students: [], activities: [] } });
    return historyPage({ error });
  } finally { Object.assign(state, saved); }
}
const block = (html) => (html.match(/<div class="tpub-op is-error"[^>]*>[\s\S]*?<\/div>/) || [""])[0];
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const GUIDANCE = "Não foi possível confirmar a restauração. A conexão com o portal falhou. Ela pode ter sido concluída: consulte a atualização antes de tentar de novo. Consultar atualização";

test("C2-U1: a dúvida guardada aparece na publicação que se tentou restaurar, inteira e com a consulta, sem se anunciar de novo; a vista na hora continua alerta", () => {
  for (const [quiet, role] of [[true, null], [false, "alert"]]) {
    const html = page({ publicationId: "p12", unsure: true, message: "A conexão com o portal falhou.", quiet });
    const b = block(html);
    assert.equal(strip(b), GUIDANCE, `quiet=${quiet}`);
    assert.equal((b.match(/ role="([^"]+)"/) || [])[1] || null, role, `quiet=${quiet}: role`);
    assert.match(b, /^<div class="tpub-op is-error" id="tpub-restore-status"[^>]* tabindex="-1">/, `quiet=${quiet}: o id e o tabindex da E5`);
    assert.match(b, /data-action="refresh-report">Consultar atualização</, `quiet=${quiet}: a consulta segura`);
    const start = html.indexOf('id="tpub-p12"'), next = html.indexOf('<li class="tpub-entry', start);
    const entry = html.slice(start, next < 0 ? undefined : next);
    assert.ok(entry.includes(b), `quiet=${quiet}: dentro da publicação que se tentou restaurar`);
    assert.match(entry, /data-restore="p12"[^>]* aria-describedby="tpub-restore-status"/, `quiet=${quiet}: o Restaurar aponta para ela`);
  }
});

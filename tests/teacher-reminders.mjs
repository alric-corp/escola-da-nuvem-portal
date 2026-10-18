// Lembretes (Expansão 7), sem navegador: as duas telas renderizadas como texto e o envio em lote do handler com transporte
// falso. O contrato é o de backend/portal.py::_reminder_settings ({enabled, sender, ready, reason}) e _reminder_batch (prévia:
// publicationId, publishedAt, ses, sample, recipients com skip; envio: results com status sent/failed/skipped e reason). Aqui,
// o que a Expansão 7 decide: o remetente como a única superfície de "Lembretes", com a situação por texto e forma e o motivo do
// servidor; a verificação com andamento e erro junto da ação; os dois caminhos de envio e as regras; no lote, quem recebe e
// quem fica de fora por motivo, a mensagem, o envio como a única superfície e a lista; Enviar parado sem remetente pronto e
// durante o envio; recusa, conflito e dúvida junto da ação; o resultado sem confundir "aceito" com entrega; a pergunta do envio;
// e o detalhe do aluno (prévia e envio individuais) igual.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

globalThis.location = { hostname: "portal.test", search: "" };
const element = () => ({ setAttribute() {}, addEventListener() {}, append() {}, remove() {} });
globalThis.document = { querySelector: (selector) => (selector === "#notices" ? { replaceChildren() {} } : null), createElement: element };
const { state } = await import("../frontend/state.js");
const { date } = await import("../frontend/ui.js");
const pages = await import("../frontend/pages/reminders.js");
const handlers = await import("../frontend/handlers/reminders.js");
const api = await import("../frontend/api.js");

const KEYS = ["me", "cohorts", "code", "view", "studentView", "sender", "senderError", "senderLoading", "batchIds", "batchPreview", "batchError", "batchResults",
  "pendingPreview", "pendingError", "pendingStudentId"];
function withState(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, state[key]]));
  Object.assign(state, { me: { roles: ["instructor"], email: "instrutor@example.test" }, cohorts: [{ code: "BRSA0267", canTeach: true }], code: "BRSA0267",
    view: "reminders", studentView: null, sender: null, senderError: "", senderLoading: false, batchIds: [], batchPreview: null, batchError: "", batchResults: null }, values);
  try { return fn(); } finally { Object.assign(state, saved); }
}
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.:;?])/g, "$1").trim();
const count = (html, needle) => html.split(needle).length - 1;
// Trecho de uma seção pela classe; vazio se ela não existe (a asserção seguinte falha, sem TypeError).
const section = (html, cls) => {
  const at = html.search(new RegExp(`<(section|div|p) class="[^"]*\\b${cls}\\b`));
  if (at < 0) return "";
  const close = `</${html.slice(at + 1).match(/^\w+/)[0]}>`;
  return html.slice(at, html.indexOf(close, at) + close.length);
};
const block = (html, cls) => { const at = html.search(new RegExp(`<section class="[^"]*\\b${cls}\\b`)); return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at) + 10); };
const tag = (html, attr) => (html.match(new RegExp(`<[^>]*${attr}[^>]*>`)) || [""])[0];
const at = (html, needle) => html.indexOf(needle);

const SENDER = "instrutor@example.test";
const senders = {
  pronto: { enabled: true, sender: SENDER, ready: true, reason: "Remetente verificado e envio habilitado." },
  pendente: { enabled: true, sender: SENDER, ready: false, reason: "Confirme o e-mail de verificação que o SES enviou ao seu endereço institucional." },
  desligado: { enabled: false, sender: SENDER, ready: false, reason: "O envio de lembretes está desativado nesta instalação." },
};
const senderPage = (values = {}, view = {}) => withState(values, () => pages.senderPage(view));

test("TR1: Lembretes — o remetente é a única superfície, com o e-mail uma vez e a situação por texto e forma (o motivo é o do servidor)", () => {
  for (const [name, sender] of Object.entries(senders)) {
    const html = senderPage({ sender });
    assert.match(html, /^<div class="teacher-reminders">/, name);
    assert.match(strip(html), /^Lembretes por e-mail Confirme seu remetente e revise cada mensagem antes de enviar\./, name);
    assert.equal(count(html, "is-action"), 1, `${name}: uma superfície`);
    assert.match(block(html, "trem-sender"), /class="trem-sender is-action"/, `${name}: a superfície é o remetente`);
    assert.equal(count(html, SENDER), 1, `${name}: o e-mail uma vez`);
    const status = section(html, "trem-state");
    const shape = { pronto: "is-ok", pendente: "is-attention", desligado: "is-off" }[name];
    assert.match(status, new RegExp(`class="trem-state ${shape}" id="trem-sender-status" role="status" tabindex="-1"`), name);
    assert.equal(strip(status), { pronto: "Pronto para enviar. Remetente verificado e envio habilitado.", pendente: "Ainda não é possível enviar. Confirme o e-mail de verificação que o SES enviou ao seu endereço institucional.",
      desligado: "O envio de lembretes está desativado nesta instalação." }[name]);
    assert.equal(count(strip(html), sender.reason), 1, `${name}: o motivo do servidor uma vez`);
    assert.equal(/Os lembretes saem deste e-mail, e as respostas dos alunos chegam nele\./.test(strip(html)), sender.enabled, `${name}: de onde saem e para onde voltam`);
    assert.equal(/data-action="verify-sender"/.test(html), name === "pendente", `${name}: solicitar confirmação só sem remetente pronto`);
    assert.equal((html.match(/data-action="refresh-sender"[^>]*>([^<]*)</) || [, ""])[1], name === "pendente" ? "Já confirmei · verificar novamente" : "Verificar novamente", name);
    assert.ok(at(html, "trem-sender") < at(html, "trem-how") && at(html, "trem-how") < at(html, "trem-rules"), `${name}: remetente, como enviar, regras`);
  }
});

test("TR2: Lembretes — consultando, com erro e ainda não consultado, sempre com como enviar e as regras; textos do servidor escapados", () => {
  const loading = senderPage({ senderLoading: true });
  assert.match(loading, /<p class="trem-loading" id="trem-sender-loading" role="status" tabindex="-1">Consultando seu remetente…<\/p>/, "o andamento recebe o foco na nova consulta");
  assert.equal(count(loading, "is-action"), 0);
  const failed = senderPage({ senderError: "Use seu e-mail <institucional>." });
  assert.match(failed, /role="alert"><h2>Não foi possível carregar<\/h2><p>Use seu e-mail &lt;institucional&gt;\.<\/p><button class="button primary" data-action="refresh-sender">Tentar novamente<\/button>/);
  const none = senderPage({ sender: null });
  assert.match(strip(none), /Seu remetente A situação do seu e-mail no serviço de envio ainda não foi consultada\. Consultar remetente/);
  assert.match(none, /<button class="button primary" data-action="refresh-sender">Consultar remetente<\/button>/);
  for (const html of [loading, failed, none]) {
    assert.match(html, /^<div class="teacher-reminders">/);
    assert.ok(block(html, "trem-how") && block(html, "trem-rules"), "como enviar e regras em todos os estados");
  }
  const hostile = senderPage({ sender: { enabled: true, ready: false, sender: '<img src=x onerror="alert(1)">@example.test', reason: "<script>x</script>" } });
  assert.doesNotMatch(hostile, /<img|<script/);
  assert.match(hostile, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;@example\.test/);
});

test("TR3: Lembretes — a verificação em andamento para as duas ações; o erro junto delas, recusado ou incerto, com o motivo escapado", () => {
  const busy = senderPage({ sender: senders.pendente }, { verifying: true });
  assert.match(busy, /<p class="trem-op is-busy" id="trem-verify-status" role="status" tabindex="-1">Solicitando a confirmação do seu e-mail…<\/p>/);
  assert.match(tag(busy, 'data-action="verify-sender"'), / disabled/);
  assert.match(tag(busy, 'data-action="refresh-sender"'), / disabled/);
  const free = senderPage({ sender: senders.pendente });
  assert.doesNotMatch(tag(free, 'data-action="verify-sender"'), /disabled/);
  assert.doesNotMatch(free, /trem-verify-status/);
  const refused = senderPage({ sender: senders.pendente }, { failure: { message: "Use seu e-mail <institucional> para enviar lembretes." } });
  const alert = section(refused, "trem-op");
  assert.match(alert, /^<div class="trem-op is-error" id="trem-verify-status" role="alert" tabindex="-1">/);
  assert.equal(strip(alert), "A confirmação não foi solicitada. Use seu e-mail &lt;institucional&gt; para enviar lembretes.");
  const unsure = senderPage({ sender: senders.pendente }, { failure: { unsure: true, message: "A conexão com o portal falhou." } });
  assert.equal(strip(section(unsure, "trem-op")), "Não foi possível confirmar o pedido. A conexão com o portal falhou. Ele pode ter chegado: verifique de novo para ver a situação do seu e-mail.");
  assert.doesNotMatch(tag(unsure, 'data-action="refresh-sender"'), /disabled/, "a nova consulta fica disponível depois do erro");
});

test("TR4: Lembretes — os dois caminhos de envio que existem, o atalho para o filtro do painel e as regras do servidor", () => {
  const html = senderPage({ sender: senders.pronto });
  const how = block(html, "trem-how");
  assert.match(strip(how), /^Como enviar Para um aluno No painel, “Ver pendências” do aluno mostra a mensagem dele, o envio e a situação da entrega\. Para vários alunos No painel, o filtro “Com atividades sem nota” oferece “Enviar lembrete para…”: a lista diz quem recebe e quem fica de fora, com o motivo\. Ver alunos com atividades sem nota Ir ao painel da turma$/);
  assert.match(how, /<button type="button" class="text-link" data-view="overview" data-pending="1">Ver alunos com atividades sem nota<\/button>/);
  assert.match(how, /<button class="button secondary" data-view="overview">Ir ao painel da turma<\/button>/);
  const rules = [...block(html, "trem-rules").matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(rules, ["Cada aluno recebe no máximo um lembrete por publicação de notas: quem já tem lembrete registrado nesta publicação fica de fora.",
    "Também ficam de fora desistentes, alunos sem e-mail no Canvas e alunos sem atividades sem nota.",
    "A mensagem é montada pelo portal com as atividades sem nota da publicação em vigor, e você a revisa antes de enviar.",
    "“Aceito pelo serviço de envio” ainda não é a entrega: a situação de cada aluno aparece nas pendências dele.",
    "Publicar notas nunca dispara lembretes automaticamente."]);
});

// Prévia do lote como _reminder_batch a devolve: recipients na ordem dos ids pedidos, com skip (evaluate_recipient).
const R = (id, name, pending, skip = null) => ({ id, name, email: name ? `${id}@example.test` : null, pending, skip });
const SAMPLE = { from: SENDER, replyTo: SENDER, to: "31000@example.test", subject: "Podemos ajudar? Atividades sem nota · BRSA0267", text: "Olá, Ana Lima!\n\nKCs sem nota registrada:\n- 10- CF - KC <S3>" };
const preview = (recipients, extra = {}) => ({ publicationId: "p1", publishedAt: "2026-10-09T21:00:00Z", ses: { ready: true, reason: "Remetente verificado e envio habilitado." },
  sample: recipients.some((r) => !r.skip) ? SAMPLE : null, recipients, ...extra });
const MIXED = [R("31000", "Ana Lima", 4), R("31001", "Bruno Reis", 1, "withdrawn"), R("31002", "Carla Dias", 2), R("31003", "Diego Melo", 3, "already-sent"),
  R("31004", "Elisa Rocha", 1, "no-email"), R("31005", "Felipe Souza", 0, "no-pending"), R("31099", null, 0, "not-found"), R("31006", "Gabi Lins", 2, "motivo-novo"),
  R("31007", "Heitor Prado", 1, "already-sent"), R("31008", "Isa Nunes", 5)];
const batchPage = (values = {}, view = {}) => withState({ view: "reminders-batch", ...values }, () => pages.batchPage(view));

test("TR5: Lote — quem recebe, quem fica de fora por motivo (na ordem, com o código quando o motivo é novo), a mensagem, o envio e a lista, nessa ordem", () => {
  const html = batchPage({ batchPreview: preview(MIXED) });
  assert.match(html, /^<div class="teacher-reminders">/);
  const summary = block(html, "trem-summary");
  assert.match(summary, /<h2 id="trem-summary-title" tabindex="-1">Quem recebe<\/h2>/);
  assert.match(strip(summary), new RegExp(`^Quem recebe 3 de 10 alunos vão receber um lembrete agora\\. A mensagem usa as notas da publicação de ${date("2026-10-09T21:00:00Z").replace(/[/.]/g, "\\$&")}\\. Ficam de fora · 7 `));
  const groups = [...summary.matchAll(/<h4>([^<]*)<\/h4>(<ul class="trem-names">.*?<\/ul>)/g)].map(([, title, list]) => `${title}: ${strip(list)}`);
  // Na ordem dos motivos (o registro antes dos demais), não na de chegada (aqui, o desistente vem primeiro na lista).
  assert.deepEqual(groups, ["Lembrete já registrado nesta publicação · 2: Diego Melo 3 sem nota Heitor Prado 1 sem nota", "Desistente · 1: Bruno Reis 1 sem nota",
    "Sem e-mail no Canvas · 1: Elisa Rocha 1 sem nota", "Sem atividades sem nota · 1: Felipe Souza 0 sem nota", "Não encontrado nesta publicação · 1: Canvas ID 31099 0 sem nota",
    "motivo-novo · 1: Gabi Lins 2 sem nota"]);
  assert.doesNotMatch(strip(html), /\b(already-sent|withdrawn|no-email|no-pending|not-found)\b/, "nenhum código cru");
  const message = block(html, "trem-message");
  assert.equal(strip(message), "Exemplo de mensagem Cada aluno recebe uma versão com as próprias atividades sem nota; esta é a do primeiro aluno da lista. De instrutor@example.test Para o e-mail de cada aluno no Canvas Assunto Podemos ajudar? Atividades sem nota · BRSA0267 Olá, Ana Lima! KCs sem nota registrada: - 10- CF - KC &lt;S3&gt;");
  assert.match(message, /<pre class="trem-text">Olá, Ana Lima!\n\nKCs sem nota registrada:\n- 10- CF - KC &lt;S3&gt;<\/pre>/, "o texto como o aluno recebe, com as quebras");
  assert.equal(count(html, "is-action"), 1);
  assert.match(block(html, "trem-send"), /class="trem-send is-action"/);
  assert.equal(strip(block(html, "trem-recipients")), "Recebem agora · 3 Ana Lima 4 sem nota Carla Dias 2 sem nota Isa Nunes 5 sem nota");
  const order = ["trem-summary", "trem-message", "trem-send", "trem-recipients"].map((cls) => at(html, `class="${cls}`));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
});

test("TR6: Lote — Enviar parado sem remetente pronto (com o motivo ligado) e durante o envio; a consequência diz para quantos; sem elegíveis, nenhum botão", () => {
  const ready = batchPage({ batchPreview: preview(MIXED) });
  const button = tag(ready, 'data-action="send-reminders-batch"');
  assert.match(button, /class="button primary"/);
  assert.doesNotMatch(button, /disabled|aria-describedby/);
  assert.match(ready, />Enviar para 3 alunos<\/button>/);
  const send = block(ready, "trem-send");
  assert.match(strip(send), /^Envio Remetente verificado e envio habilitado\. De instrutor@example\.test Ao confirmar, o portal envia agora um e-mail para cada um dos 3 alunos da lista\. Um e-mail enviado não pode ser desfeito\. Enviar para 3 alunos$/);
  assert.match(send, /class="trem-state is-ok"/);
  const one = batchPage({ batchPreview: preview([R("31000", "Ana Lima", 4)]) });
  assert.match(strip(block(one, "trem-send")), /envia agora um e-mail para o aluno da lista\./);
  assert.match(strip(one), /1 de 1 aluno vai receber um lembrete agora\./);
  const blocked = batchPage({ batchPreview: preview(MIXED, { ses: { ready: false, reason: "Confirme o e-mail de verificação." } }) });
  assert.match(tag(blocked, 'data-action="send-reminders-batch"'), / disabled aria-describedby="trem-send-reason"/);
  assert.match(blocked, /<p class="trem-reason" id="trem-send-reason">O envio fica parado até o remetente ficar pronto\.<\/p>/);
  assert.match(blocked, /<button class="button secondary" data-view="reminders">Configurar meu remetente<\/button>/);
  assert.match(block(blocked, "trem-send"), /class="trem-state is-attention"><span>Confirme o e-mail de verificação\.<\/span>/);
  const sending = batchPage({ batchPreview: preview(MIXED) }, { sending: true });
  assert.match(tag(sending, 'data-action="send-reminders-batch"'), / disabled/);
  assert.match(sending, /<p class="trem-op is-busy" id="trem-send-status" role="status" tabindex="-1">Enviando lembretes para 3 alunos… O resultado aparece aqui\. Sair desta tela não cancela o envio\.<\/p>/);
  assert.match(batchPage(), /<p class="trem-loading" id="trem-batch-loading" role="status" tabindex="-1">Consultando destinatários…<\/p>/, "o andamento do lote recebe o foco na nova consulta");
  const none = batchPage({ batchPreview: preview([R("31003", "Diego Melo", 3, "withdrawn"), R("31004", "Elisa Rocha", 1, "no-email")]) });
  assert.doesNotMatch(none, /data-action="send-reminders-batch"|trem-recipients/);
  assert.match(strip(none), /0 de 2 alunos vão receber um lembrete agora\..* Nenhum aluno elegível para receber o lembrete agora\./);
});

test("TR7: Lote — o erro do envio junto da ação: recusa (nada saiu), conflito e dúvida, que levam à nova consulta antes de enviar de novo", () => {
  const p = preview(MIXED);
  const refused = batchPage({ batchPreview: p }, { failure: { message: "Use seu e-mail <institucional> para enviar lembretes." } });
  const alert = section(refused, "trem-op");
  assert.match(alert, /^<div class="trem-op is-error" id="trem-send-status" role="alert" tabindex="-1">/);
  assert.equal(strip(alert), "Nenhum lembrete foi enviado. Use seu e-mail &lt;institucional&gt; para enviar lembretes.");
  assert.doesNotMatch(refused, /data-action="retry-batch-preview"/);
  assert.match(tag(refused, 'data-action="send-reminders-batch"'), /class="button primary"/);
  // 429 (limite do API Gateway, antes da Lambda) também é recusa: o backend não tem 429 nesta rota e valida tudo antes do 1º aluno.
  const limited = batchPage({ batchPreview: p }, { failure: { message: "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente." } });
  assert.equal(strip(section(limited, "trem-op")), "Nenhum lembrete foi enviado. O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.");
  assert.doesNotMatch(limited, /data-action="retry-batch-preview"/);
  const conflict = batchPage({ batchPreview: p }, { failure: { conflict: true, message: "As notas foram atualizadas. Consulte a prévia de novo antes de enviar." } });
  assert.equal(strip(section(conflict, "trem-op")), "Nenhum lembrete foi enviado. As notas foram atualizadas. Consulte a prévia de novo antes de enviar. Consultar destinatários de novo");
  assert.match(tag(conflict, 'data-action="send-reminders-batch"'), /class="button secondary"/, "a nova consulta vem antes");
  const unsure = batchPage({ batchPreview: p }, { failure: { unsure: true, message: "A conexão com o portal falhou." } });
  assert.equal(strip(section(unsure, "trem-op")), "Não foi possível confirmar o envio. A conexão com o portal falhou. Parte dos lembretes pode ter sido enviada, e o envio pode continuar no servidor. Antes de enviar de novo, consulte os destinatários: quem já tem lembrete registrado nesta publicação fica de fora e não recebe outro. Consultar destinatários de novo");
  assert.match(section(unsure, "trem-op"), /<button type="button" class="button primary" data-action="retry-batch-preview">Consultar destinatários de novo<\/button>/);
  const button = tag(unsure, 'data-action="send-reminders-batch"');
  assert.match(button, /class="button secondary"/);
  assert.doesNotMatch(button, /disabled/, "enviar de novo continua possível: o servidor não repete quem já tem lembrete");
});

test("TR8: Lote — resultado: aceito pelo serviço de envio (não é entrega), sem confirmação e quem ficou de fora por motivo; só o que não é zero; envio interrompido por conflito, sem afirmar a causa; nova consulta quando falta confirmação ou houve conflito", () => {
  const results = [{ id: "31000", name: "Ana Lima", status: "sent" }, { id: "31002", name: "Carla <b>Dias</b>", status: "sent" }, { id: "31008", name: "Isa Nunes", status: "failed" },
    { id: "31003", name: "Diego Melo", status: "skipped", reason: "withdrawn" }, { id: "31009", name: "João Paz", status: "skipped", reason: "publication-changed" },
    { id: "31010", name: "Kiara Luz", status: "skipped", reason: "publication-changed" }];
  const html = batchPage({ batchPreview: preview(MIXED), batchResults: results });
  const result = block(html, "trem-result");
  // Fechamento: o título, que recebe o foco, descreve as quantidades (o anúncio que o aviso temporário fazia).
  assert.match(result, /<h2 id="trem-result-title" tabindex="-1" aria-describedby="trem-result-count">Resultado do envio<\/h2>/);
  assert.match(result, /<p class="trem-count" id="trem-result-count">/);
  assert.match(strip(result), /^Resultado do envio 2 aceitos pelo serviço de envio · 1 sem confirmação do envio · 3 ficaram de fora\. “Aceito pelo serviço de envio” ainda não é a entrega na caixa do aluno: a situação de cada um aparece em “Ver pendências”, no painel\./);
  const alerts = [...result.matchAll(/<div class="trem-alert"><p>(.*?)<\/p><\/div>/g)].map((m) => strip(m[1]));
  assert.deepEqual(alerts, ["1 aluno ficou sem confirmação do envio. O serviço de envio recusou a mensagem ou não respondeu. Na nova consulta, quem teve a recusa confirmada volta a aparecer para envio; quem ficou sem resposta continua com o lembrete registrado e não recebe outro, para não haver duplicação.",
    // O servidor devolve publication-changed para qualquer conflito na reserva — outra reserva do mesmo aluno (outro lote, o envio
    // individual ou o automático), outra transação na turma ao mesmo tempo, publicação nova ou outra alteração da turma — e o repete
    // para todos os seguintes, mesmo os que ficariam de fora por outro motivo: a tela não afirma a causa nem que eles ficaram sem lembrete.
    "Envio interrompido por conflito. O servidor encontrou um conflito ao registrar um lembrete e parou o envio; este envio não mandou lembrete para 2 alunos (em “Envio interrompido por conflito”). A causa pode ser outro envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma; o portal não sabe qual. Antes de enviar de novo, consulte os destinatários: a nova consulta mostra quem já tem lembrete registrado, inclusive por outro envio, e quem ainda pode receber. Se as notas mudaram, ela já é da publicação nova, em que quem recebeu agora pode aparecer de novo."]);
  assert.doesNotMatch(strip(result), /a turma mudou|as notas foram atualizadas|ficaram sem lembrete|Interrompido:/);
  assert.match(result, /<button type="button" class="button secondary" data-action="retry-batch-preview">Consultar destinatários de novo<\/button>/);
  const groups = [...result.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(groups, ["Aceitos pelo serviço de envio · 2", "Sem confirmação do envio · 1", "Ficaram de fora · 3"]);
  assert.match(strip(result), /Ficaram de fora · 3 Desistente · 1 Diego Melo Envio interrompido por conflito · 2 João Paz Kiara Luz$/);
  const one = block(batchPage({ batchResults: [{ id: "31000", name: "Ana Lima", status: "sent" }, { id: "31009", name: "João Paz", status: "skipped", reason: "publication-changed" }] }), "trem-result");
  assert.match(strip(one), /este envio não mandou lembrete para 1 aluno \(em “Envio interrompido por conflito”\)\./);
  assert.match(strip(one), /^Resultado do envio 1 aceito pelo serviço de envio · 1 ficou de fora\./, "as quantidades, como antes");
  assert.doesNotMatch(result, /<b>|withdrawn|publication-changed/);
  assert.equal(count(html, "is-action"), 0, "depois do envio, nada a fazer na superfície");
  const sent = block(batchPage({ batchResults: [{ id: "31000", name: "Ana Lima", status: "sent" }] }), "trem-result");
  assert.match(strip(sent), /^Resultado do envio 1 aceito pelo serviço de envio\. /);
  assert.doesNotMatch(sent, /trem-alert|retry-batch-preview|sem confirmação|de fora/);
  const other = block(batchPage({ batchResults: [{ id: "31000", name: "Ana Lima", status: "queued" }] }), "trem-result");
  assert.match(strip(other), /^Resultado do envio 1 com outro resultado\..*Outro resultado · 1 Ana Lima$/);
});

test("TR11: Fechamento — o aviso temporário do envio e da verificação só quando o resultado não recebe o foco (quem chama decide, depois do render); o texto não afirma o desfecho; resposta antiga, nada", async () => {
  const BATCH = "Chegou a resposta do envio em lote. Confira o resultado por aluno.";
  const VERIFY = "Chegou a resposta do pedido de confirmação. Confira a situação do seu remetente.";
  const notices = [], order = [], saved = { document: globalThis.document, setTimeout: globalThis.setTimeout, confirm: globalThis.confirm };
  const keys = ["me", "code", "view", "batchPreview", "batchResults", "batchError", "sender", "senderError", "senderLoading"];
  const before = Object.fromEntries(keys.map((k) => [k, state[k]]));
  globalThis.document = { createElement: () => ({ children: [], className: "", setAttribute() {}, addEventListener() {}, remove() {}, append(...c) { this.children.push(...c); } }),
    querySelector: (s) => (s === "#notices" ? { replaceChildren: (item) => notices.push(item.children[0].textContent) } : null) };
  globalThis.setTimeout = () => 0;
  globalThis.confirm = () => true;
  handlers.configure({ render: () => order.push("render") });
  const ask = (answer) => (answer === undefined ? undefined : () => { order.push("announce"); return answer; });
  try {
    state.me = { email: "instrutor@example.test" };
    for (const [answer, expected] of [[undefined, [BATCH]], [true, [BATCH]], [false, []]]) {
      notices.length = order.length = 0;
      Object.assign(state, { code: "BRSA0267", view: "reminders-batch", batchPreview: preview(MIXED), batchResults: null, batchError: "" });
      api.setTransport(async () => ({ publicationId: "p13", results: [{ id: "31000", name: "Ana Lima", status: "sent" }, { id: "31009", name: "João Paz", status: "skipped", reason: "publication-changed" }] }));
      await handlers.sendBatch(() => {}, ask(answer));
      assert.deepEqual(notices, expected, `envio, announce=${answer}`);
      assert.equal(state.batchResults.length, 2, "o resultado do servidor, sempre");
      if (answer !== undefined) assert.deepEqual(order.slice(-2), ["render", "announce"], "decide com o resultado já desenhado");
    }
    for (const [answer, expected] of [[undefined, [VERIFY]], [true, [VERIFY]], [false, []]]) {
      notices.length = order.length = 0;
      Object.assign(state, { code: "BRSA0267", view: "reminders", sender: null, senderError: "", senderLoading: false });
      api.setTransport(async () => ({ enabled: true, sender: "instrutor@example.test", ready: true, reason: "Remetente verificado e envio habilitado." }));
      await handlers.verifySender(ask(answer));
      assert.deepEqual(notices, expected, `verificação, announce=${answer}`);
      assert.equal(state.sender.ready, true);
      if (answer !== undefined) assert.ok(order.indexOf("announce") > order.indexOf("render"), "decide com a situação já desenhada");
    }
    // Resposta que chega com outra tela: nem render, nem pergunta, nem aviso (C7.3/C7.4, como antes).
    for (const [run, view] of [[(a) => handlers.sendBatch(() => {}, a), "reminders-batch"], [(a) => handlers.verifySender(a), "reminders"]]) {
      notices.length = order.length = 0;
      let answer;
      Object.assign(state, { code: "BRSA0267", view, batchPreview: preview(MIXED), batchResults: null, sender: null });
      api.setTransport(() => new Promise((resolve) => { answer = resolve; }));
      const pending = run(ask(true));
      await Promise.resolve();
      state.view = "overview";
      answer(view === "reminders" ? { enabled: true, sender: "x", ready: true, reason: "r" } : { publicationId: "p13", results: [] });
      await pending;
      assert.deepEqual([notices, order.filter((o) => o === "announce")], [[], []], `${view}: resposta antiga`);
    }
  } finally {
    Object.assign(globalThis, saved);
    Object.assign(state, before);
    handlers.configure({ render: () => {} });
  }
});

// Envio com transporte falso: registra a ordem de confirmação, aviso de início e pedido.
async function sendWith(p, { accept = true } = {}) {
  const events = [], saved = { confirm: globalThis.confirm, setTimeout: globalThis.setTimeout };
  globalThis.confirm = (message) => { events.push(["confirm", message]); return accept; };
  globalThis.setTimeout = () => 0;
  api.setTransport(async (path, options) => { events.push(["request", path, options.body]); return { publicationId: p.publicationId, results: [] }; });
  handlers.configure({ render: () => {} });
  const keys = ["code", "view", "batchPreview", "batchResults", "batchError"], before = Object.fromEntries(keys.map((k) => [k, state[k]]));
  try {
    Object.assign(state, { code: "BRSA0267", view: "reminders-batch", batchPreview: p, batchResults: null, batchError: "" });
    await handlers.sendBatch(() => events.push(["started"]));
    return events;
  } finally {
    Object.assign(state, before);
    Object.assign(globalThis, saved);
    handlers.configure({ render: null });
    api.setTransport(() => { throw new Error("Sem rede nos testes de Lembretes."); });
  }
}

test("TR9: a pergunta do envio em lote — a mesma confirmação, no mesmo ponto: turma, quantos, quem envia, sem volta e quantos ficam de fora; o andamento só depois de confirmar", async () => {
  const events = await sendWith(preview(MIXED));
  assert.deepEqual(events.map(([kind]) => kind), ["confirm", "started", "request"]);
  assert.equal(events[0][1], "Enviar lembrete para 3 alunos da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.\n\n7 alunos selecionados ficam de fora; os motivos estão na lista.");
  assert.deepEqual(events[2], ["request", "/cohorts/BRSA0267/send-reminders", { studentIds: ["31000", "31002", "31008"], expectedPublicationId: "p1" }]);
  const one = await sendWith(preview([R("31000", "Ana Lima", 4), R("31004", "Elisa Rocha", 1, "no-email")]));
  assert.equal(one[0][1], "Enviar lembrete para 1 aluno da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.\n\n1 aluno selecionado fica de fora; os motivos estão na lista.");
  const all = await sendWith({ ...preview([R("31000", "Ana Lima", 4)]), sample: null });
  assert.equal(all[0][1], "Enviar lembrete para 1 aluno da BRSA0267?\n\nCada aluno recebe um e-mail individual com as próprias atividades sem nota. O envio começa agora e não pode ser desfeito.");
  assert.deepEqual((await sendWith(preview(MIXED), { accept: false })).map(([kind]) => kind), ["confirm"], "cancelar: nem andamento nem pedido");
  assert.deepEqual(await sendWith(preview([R("31003", "Diego Melo", 3, "withdrawn")])), [], "sem aprovados: nem pergunta");
});

// O detalhe do aluno (prévia e envio individuais, participação e histórico) continua o de antes: as impressões digitais foram
// tiradas da árvore anterior à Expansão 7, com datas nulas (independem do fuso).
const sha = (s) => createHash("sha256").update(s).digest("hex");
test("TR10: o detalhe do aluno — prévia e envio individuais, participação e histórico — continua igual (impressões digitais da árvore de antes)", () => {
  const activities = [{ id: "a1", name: "10- CF - KC — <Introdução> & S3", kind: "kc", state: "pending", active: true, points: "100", module: "Cloud", moduleOrder: 1 },
    { id: "a2", name: "11--Lab - EC2", kind: "lab", state: "pending", active: true, points: "100", module: "Cloud", moduleOrder: 1 }];
  const base = (extra = {}) => ({ student: { id: "31007", name: "Aluna <b>Fictícia</b>", email: "aluna@example.test" }, activities, publicationId: "p1", publishedAt: null,
    message: { from: "instrutor@example.test", to: "aluna@example.test", subject: "Podemos ajudar? · BRSA0267", text: "Olá, Aluna!\n\n- <tarefa>" }, previewHash: "h", delivery: null,
    ses: { ready: true, reason: "Remetente verificado e envio habilitado." }, remindersEnabled: true,
    summary: { kc: 50, lab: 80, total: 65, progress: 60, completed: 3, pending: 2, status: "critical" }, allActivities: activities, thresholds: { kc: 70, lab: 95 },
    history: [{ publishedAt: null, current: true, kc: 50, lab: 80, total: 65 }], ...extra });
  const cases = { ativo: base(), desistente: base({ participationStatus: "WITHDRAWN" }), desligado: base({ message: undefined, remindersEnabled: false }),
    ...Object.fromEntries(["sent", "sending", "unknown", "failed", "delivered", "bounced", "complained", "rejected", "delayed", "outro"].map((s) => [s, base({ delivery: { status: s } })])),
    "nao-pronto": base({ ses: { ready: false, reason: "Confirme o e-mail de verificação." } }) };
  const EXPECTED = {
    ativo: ["ce7b84af1d91fb4796d1484e4e6f38fce7d25ddd531134d48778e9b040bf5126", "03708f71c4d76dd67031d91169cb10af657bb8b9809b3b41d9246e26d11b949d"],
    desistente: ["462276a4949e21365c80df773991a3a81b62cc33c27d01c0e7c921a45417384a", "7b0d08ed70098d6560fa85bc5318c2127bdf9e626a559756c7799aa94b7fd2a0"],
    desligado: ["98f859b1d915ba74b81d4c2d497dea88a25c3f8d0031123845b4a58a788b28ca", "96b2928d86ef96f6a43262f7347348d8541dc3fcb2819297a477ea15537efceb"],
    sent: ["4a75f9a28a272c6de12aa56f1ef9dcea5aa8d8e838b88d160adbd8f451854f44", "4888529ff2e0093ebc2a5b1713a4e62a0a3ca6583d529f576094367117c8e953"],
    sending: ["9dd60c76b6aab1644046279a9c100c5bb04da59858abcff6e7af1961e5eda785", "12a55bf8eb70f92c7dc9ebf75d96101c7234d9e0acd07ff3d7cc59c90f3063cb"],
    unknown: ["e1b94511df8c864bdd3d02245f65a9708488269c1d8a4e23e48d203dd6de7887", "90f2a244402ac41a3eecaa03d40b1c452ad46c8d82a08fc96b4f4f2a65254691"],
    failed: ["b96e3f899d2e8689924137dba422b39005256113346ee24e9280cabd9251c317", "5ef824dfa9b2b5b2773855f8cfe510c70c5c647b1a941e826d217ecf9552cf34"],
    delivered: ["3e7556b9c4673b33a14cd4f8fe1664ef4317fa8e596cd2f2138df6e0769d17ad", "6eb869477f3e6938731cfc6664386cc037c80e437ee3ef4950ca494398015fd2"],
    bounced: ["116758250eb308fe31e47948d4c72e3fafefc73de3d9e739ea4fe986fa506a10", "ee47045621f4ace697b65dfb2eca072e3c0256d8ba99519c8f1f00f132a19977"],
    complained: ["58ff69e374ab622963594552180fd8ac6a9265bebfbe19dbe09e5bedfdd19854", "d7583635b4135b30973f8321be35fc5ace30abb9f2221a9ec1a736e49f9f603a"],
    rejected: ["b4cb9bf5a76af9b759097d31d13413db7e5baf6b0f14f886f594427f6c30da3b", "a6b14e9ebb788651b7a43bbc3b070cd1eae6c587c88a9c5152ee4babf9b89abc"],
    delayed: ["cc6e37951e6387506670be171d7e9a21ed392f18b262f8124ea5c5cef62c4351", "02d56c0215fd3be8c76c0bf5eaf7daf4800ee26a1257df8c28a4f1aa955a7c10"],
    outro: ["5e9a365c3e73545e72f17b4559983c5a16479c950e8c680c00ef0ab7d38f1d23", "2aaba8cca38eb8383f3980aa6dde5ed5b22854d42b1b79afe446f91fc582a439"],
    "nao-pronto": ["e7bcff546d2448b45f4eb0d8970252f6d79a8cbef777b19d411a37cba315cdb9", "de83a4ea185dbca37809245b6022b4a65874738cef4c59d06c5bd0f1d2e45765"],
  };
  for (const [name, p] of Object.entries(cases))
    assert.deepEqual(withState({ view: "student-pending", pendingPreview: p, pendingError: "", pendingStudentId: "31007" }, () => [sha(pages.pendingPage()), sha(pages.reminderPreview(p))]), EXPECTED[name], name);
  assert.equal(withState({ view: "student-pending", pendingPreview: null, pendingError: "Falha <x>." }, () => sha(pages.pendingPage())), "b2cc1f646b06236d74a81a71605b3432003ea19b17ce199ad0cb3259246810f7");
  assert.equal(withState({ view: "student-pending", pendingPreview: null, pendingError: "" }, () => sha(pages.pendingPage())), "f549444c717ac2e74275a0653b010f346d3ddff9e5b19a245dacbfff951faf57");
});

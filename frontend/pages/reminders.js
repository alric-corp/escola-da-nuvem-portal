import { badge, date, demo, e, errorPanel, heading, metric, percent, plural, timeZoneLabel } from "../ui.js";
import { state } from "../state.js";
import { isWithdrawn } from "../participation.js";
import { activityCard, activityGroups, submissionContext, withCanvasSubmissions } from "./student.js";

// Lembretes (Expansão 7; docs/design-visual.md): "Lembretes" (o remetente) e "Lembretes em lote", sob .teacher-reminders. As
// operações são as do handler, com as mesmas chamadas, a mesma confirmação e as mesmas guardas; a tela só mostra o que o
// contrato traz (backend/portal.py::_reminder_settings e _reminder_batch) e não decide quem recebe: elegíveis e motivos vêm do
// servidor. view (app.js): verifying e failure (verificação do remetente); sending e failure (envio do lote). O detalhe do aluno
// (pendingPage) consulta o status dos lembretes; não oferece composição nem envio individual.

// Situação do remetente pelo contrato: envio ligado na instalação (enabled) e e-mail pronto no serviço de envio (ready); o
// motivo é sempre o do servidor.
const senderState = (s) => (!s.enabled ? { kind: "is-off", label: "" } : s.ready ? { kind: "is-ok", label: "Pronto para enviar." }
  : { kind: "is-attention", label: "Ainda não é possível enviar." });

function senderBlock(view) {
  const head = '<h2 id="trem-sender-title">Seu remetente</h2>';
  if (state.senderLoading) return '<p class="trem-loading" id="trem-sender-loading" role="status" tabindex="-1">Consultando seu remetente…</p>';
  if (state.senderError) return errorPanel(state.senderError, "refresh-sender");
  const s = state.sender;
  if (!s) return `<section class="trem-sender is-action" aria-labelledby="trem-sender-title">${head}<p class="trem-note">A situação do seu e-mail no serviço de envio ainda não foi consultada.</p><div class="trem-actions"><button class="button primary" data-action="refresh-sender">Consultar remetente</button></div></section>`;
  const st = senderState(s), verify = s.enabled && !s.ready, busy = !!view.verifying, f = view.failure;
  // Andamento e erro da verificação, junto da ação (o mesmo id nos dois: o render devolve o foco a ele).
  const op = busy ? '<p class="trem-op is-busy" id="trem-verify-status" role="status" tabindex="-1">Solicitando a confirmação do seu e-mail…</p>'
    : f ? `<div class="trem-op is-error" id="trem-verify-status" role="alert" tabindex="-1"><p><strong>${f.unsure ? "Não foi possível confirmar o pedido." : "A confirmação não foi solicitada."}</strong> <span>${e(f.message)}</span>${f.unsure ? " <span>Ele pode ter chegado: verifique de novo para ver a situação do seu e-mail.</span>" : ""}</p></div>` : "";
  return `<section class="trem-sender is-action" aria-labelledby="trem-sender-title">${head}
  <p class="trem-address"><strong>${e(s.sender)}</strong></p>${s.enabled ? '<p class="trem-note">Os lembretes saem deste e-mail, e as respostas dos alunos chegam nele.</p>' : ""}
  <p class="trem-state ${st.kind}" id="trem-sender-status" role="status" tabindex="-1"><span>${st.label ? `<strong>${st.label}</strong> ` : ""}<span>${e(s.reason)}</span></span></p>
  ${verify ? '<p class="trem-hint">A confirmação é individual e vale para todas as suas turmas. Ao solicitar pela primeira vez, a Amazon Web Services envia uma mensagem de verificação para esse e-mail: abra o link dela (procure também na pasta de spam) e depois verifique de novo. Solicitar outra vez não reenvia a mensagem.</p>' : ""}
  <div class="trem-actions">${verify ? `<button class="button primary" data-action="verify-sender"${busy ? " disabled" : ""}>Solicitar confirmação do meu e-mail</button>` : ""}<button class="button secondary" data-action="refresh-sender"${busy ? " disabled" : ""}>${verify ? "Já confirmei · verificar novamente" : "Verificar novamente"}</button></div>${op}</section>`;
}

// Consulta individual de entrega e envio em lote de apoio; as regras de elegibilidade continuam no servidor.
// O atalho leva ao filtro "Com atividades sem nota" do painel.
const howToSend = () => `<section class="trem-how" aria-labelledby="trem-how-title"><h2 id="trem-how-title">Como enviar</h2>
  <ul class="trem-paths"><li><h3>Para um aluno</h3><p>No painel, “Ver pendências” do aluno mostra suas atividades e a situação da entrega. Nas turmas habilitadas, o envio é automático.</p></li><li><h3>Para vários alunos</h3><p>No painel, o filtro “Com atividades sem nota” oferece “Enviar lembrete para…”: a lista diz quem recebe e quem fica de fora, com o motivo.</p><button type="button" class="text-link" data-view="overview" data-pending="1">Ver alunos com atividades sem nota</button></li></ul>
  <div class="trem-actions"><button class="button secondary" data-view="overview">Ir ao painel da turma</button></div></section>`;
const sendingRules = () => `<section class="trem-rules" aria-labelledby="trem-rules-title"><h2 id="trem-rules-title">O que vale para todo envio</h2>
  <ul class="trem-rule-list"><li>Cada aluno recebe no máximo um lembrete por publicação de notas: quem já tem lembrete registrado nesta publicação fica de fora.</li><li>Também ficam de fora desistentes, alunos sem e-mail no Canvas e alunos sem atividades sem nota.</li><li>A mensagem é montada pelo portal com as atividades sem nota da publicação em vigor, e você a revisa antes de enviar.</li><li>“Aceito pelo serviço de envio” ainda não é a entrega: a situação de cada aluno aparece nas pendências dele.</li><li>Publicar notas nunca dispara lembretes automaticamente.</li></ul></section>`;

export function senderPage(view = {}) {
  return `<div class="teacher-reminders">${heading("", "Lembretes por e-mail", "Confirme seu remetente e revise cada mensagem antes de enviar.")}${senderBlock(view)}${howToSend()}${sendingRules()}</div>`;
}

export function pendingPage() {
  const p = state.pendingPreview;
  const title = heading(
    "",
    p ? `Pendências de ${e(p.student.name)}` : "Pendências do aluno",
    "Pendências, notas, módulos e histórico do aluno na última publicação.",
    '<button class="button secondary" data-view="overview">Voltar ao painel</button>',
  ) + (p?.publishedAt || p?.history?.some((h) => h.publishedAt) ? `<p class="small">${timeZoneLabel}.</p>` : "");
  if (state.pendingError) return title + errorPanel(state.pendingError, "retry-pending");
  if (!p)
    return `${title}<section class="panel" role="status">Carregando pendências…</section>`;
  return `${title}${submissionContext(p.canvasSubmissions)}<section class="panel"><div class="panel-title"><div><h2>Atividades sem nota registrada</h2><p class="small">${e(p.student.email || "E-mail ausente no Canvas")} · Publicação de ${date(p.publishedAt)}</p></div><button class="button secondary" data-student-pending="${e(p.student.id)}">Atualizar pendências</button></div><div class="two-columns">${[
    ["kc", "KCs sem nota"],
    ["lab", "LABs sem nota"],
  ]
    .map(([kind, label]) => {
      const items = withCanvasSubmissions(p.activities, p.canvasSubmissions).filter((a) => a.kind === kind);
      return `<section aria-label="${label}"><h3>${label} (${items.length})</h3>${items.length ? items.map(activityCard).join("") : '<p class="small">Nenhuma pendência nesta categoria.</p>'}</section>`;
    })
    .join("")}</div></section>${participationPanel(p)}${reminderPreview(p)}${studentDetail(p)}`;
}

// Participação na turma (C7.2.4): uma só ação, conforme o status que o servidor devolveu na prévia. Confirmação,
// requisição e recarga ficam no app.js; o título recebe o foco depois da mudança.
function participationPanel(p) {
  const withdrawn = isWithdrawn(p);
  return `<section class="panel" aria-labelledby="participation-heading"><h2 id="participation-heading" tabindex="-1">Participação na turma</h2><p>${withdrawn
    ? '<span class="badge withdrawn">Desistente</span> Fora das métricas e dos lembretes desta turma. As notas continuam vindo do Canvas.'
    : "Ativo: conta nas métricas e pode receber lembretes."}</p>${withdrawn
    ? `<button class="button secondary" data-action="reactivate-student" ${demo ? "disabled" : ""}>Reativar aluno</button>`
    : `<button class="button secondary" data-action="withdraw-student" ${demo ? "disabled" : ""}>Marcar como desistente</button>`}</section>`;
}

// Detalhe completo do aluno para a conversa de acompanhamento (todo/10), somente leitura.
function studentDetail(p) {
  if (!p.summary || !p.allActivities) return "";
  const s = p.summary, t = p.thresholds || { kc: 70, lab: 95 };
  return `<section class="metrics" aria-label="Desempenho do aluno">${metric("Média em KCs", percent(s.kc), `Referência: ${t.kc}% ou mais`, "metric-primary")}${metric("Média em Labs", percent(s.lab), `Referência: ${t.lab}% ou mais`)}${metric("Com nota", percent(s.progress), `${plural(s.completed, "atividade", "atividades")} · ${s.pending} sem nota`)}${metric("Situação", badge(s.status), "Critério da turma")}</section>
  <section class="panel"><h2>Todas as atividades</h2><p class="small">Notas, pendências e sugestões de revisão por módulo, como o aluno vê.</p>${activityGroups(withCanvasSubmissions(p.allActivities, p.canvasSubmissions), false)}</section>
  ${p.history?.length ? `<section class="panel"><h2>Histórico do aluno</h2><div class="table-scroll"><table><thead><tr><th>Publicação</th><th>KCs</th><th>Labs</th><th>Média geral</th></tr></thead><tbody>${p.history.map((h) => `<tr><td>${date(h.publishedAt)}${h.current ? " · atual" : ""}</td><td>${percent(h.kc)}</td><td>${percent(h.lab)}</td><td>${percent(h.total)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
}

// Quem fica de fora e por quê (backend/reminders.py::evaluate_recipient e o envio em lote), na ordem em que os grupos
// aparecem; um motivo que o contrato ainda não tem aparece por último, com o código.
const skipLabels = {
  "already-sent": "Lembrete já registrado nesta publicação",
  withdrawn: "Desistente",
  "no-email": "Sem e-mail no Canvas",
  "no-pending": "Sem atividades sem nota",
  "not-found": "Não encontrado nesta publicação",
  // Qualquer conflito na reserva (backend/portal.py::_reminder_batch), repetido para todos os seguintes: não prova a causa.
  "publication-changed": "Envio interrompido por conflito",
};
const byReason = (rows, key) => [...new Set([...Object.keys(skipLabels), ...rows.map((r) => r[key])])]
  .map((reason) => [reason, rows.filter((r) => r[key] === reason)]).filter(([, list]) => list.length);
const names = (rows, pending) => `<ul class="trem-names">${rows.map((r) => `<li><span class="trem-name">${r.name ? e(r.name) : `Canvas ID ${e(r.id)}`}</span>${pending ? ` <span class="trem-pending">${e(r.pending)} sem nota</span>` : ""}</li>`).join("")}</ul>`;
const reasonGroups = (rows, key, pending) => byReason(rows, key)
  .map(([reason, list]) => `<div class="trem-group"><h4>${e(skipLabels[reason] || reason || "Outro motivo")} · ${list.length}</h4>${names(list, pending)}</div>`).join("");

// Quem recebe: a contagem (o texto de antes), a publicação a que o lote se refere e, por motivo, quem fica de fora.
function batchSummary(p, eligible, out) {
  return `<section class="trem-summary" aria-labelledby="trem-summary-title"><h2 id="trem-summary-title" tabindex="-1">Quem recebe</h2>
  <p class="trem-count">${eligible.length} de ${plural(p.recipients.length, "aluno", "alunos")} ${eligible.length === 1 ? "vai" : "vão"} receber um lembrete agora.</p>${p.publishedAt ? `<p class="trem-note">A mensagem usa as notas da publicação de ${e(date(p.publishedAt))}.</p>` : ""}
  ${out.length ? `<div class="trem-out"><h3>Ficam de fora · ${out.length}</h3>${reasonGroups(out, "skip", true)}</div>` : ""}</section>`;
}
const sampleMessage = (m) => `<section class="trem-message" aria-labelledby="trem-message-title"><h2 id="trem-message-title">Exemplo de mensagem</h2>
  <p class="trem-note">Cada aluno recebe uma versão com as próprias atividades sem nota; esta é a do primeiro aluno da lista.</p>
  <dl class="trem-envelope"><div><dt>De</dt><dd>${e(m.from)}</dd></div><div><dt>Para</dt><dd>o e-mail de cada aluno no Canvas</dd></div><div><dt>Assunto</dt><dd>${e(m.subject)}</dd></div></dl>
  <pre class="trem-text">${e(m.text)}</pre></section>`;

// Erro do envio, junto da ação (o mesmo id do andamento: o render devolve o foco a ele). Com 4xx nada saiu: o backend valida
// tudo (acesso, publicação da prévia, remetente) antes do primeiro aluno e não tem 4xx depois dele, e o 429 vem do limite do
// API Gateway, antes da Lambda. Sem resposta ou com 5xx (unsure), parte pode ter saído. Na dúvida e no conflito (409), a nova
// consulta vem antes de enviar de novo.
function sendFailure(f) {
  const head = f.unsure ? "Não foi possível confirmar o envio." : "Nenhum lembrete foi enviado.";
  const unsure = f.unsure ? " <span>Parte dos lembretes pode ter sido enviada, e o envio pode continuar no servidor. Antes de enviar de novo, consulte os destinatários: quem já tem lembrete registrado nesta publicação fica de fora e não recebe outro.</span>" : "";
  return `<div class="trem-op is-error" id="trem-send-status" role="alert" tabindex="-1"><p><strong>${head}</strong> <span>${e(f.message)}</span>${unsure}</p>${f.unsure || f.conflict ? '<button type="button" class="button primary" data-action="retry-batch-preview">Consultar destinatários de novo</button>' : ""}</div>`;
}

// Envio: a única superfície da tela. O remetente e a prontidão vêm da prévia; Enviar fica parado sem remetente pronto (como
// antes, com o motivo ligado ao botão) e durante o envio, mesmo que a tela seja redesenhada.
function sendBlock(p, n, view) {
  const ready = !!p.ses?.ready, sending = !!view.sending, f = view.failure, again = !!f && (f.unsure || f.conflict);
  const who = n === 1 ? "o aluno da lista" : `cada um dos ${n} alunos da lista`;
  return `<section class="trem-send is-action" aria-labelledby="trem-send-title"><h2 id="trem-send-title">Envio</h2>
  <p class="trem-state ${ready ? "is-ok" : "is-attention"}"><span>${e(p.ses?.reason || "")}</span></p>
  <p class="trem-address"><span class="trem-label">De</span> <strong>${e(p.sample.from)}</strong></p>
  <p class="trem-consequence">Ao confirmar, o portal envia agora um e-mail para ${who}. Um e-mail enviado não pode ser desfeito.</p>
  ${ready ? "" : '<div class="trem-actions"><button class="button secondary" data-view="reminders">Configurar meu remetente</button></div><p class="trem-reason" id="trem-send-reason">O envio fica parado até o remetente ficar pronto.</p>'}
  <div class="trem-send-action"><button class="button ${again ? "secondary" : "primary"}" data-action="send-reminders-batch"${ready && !sending ? "" : " disabled"}${ready ? "" : ' aria-describedby="trem-send-reason"'}>Enviar para ${plural(n, "aluno", "alunos")}</button></div>
  ${sending ? `<p class="trem-op is-busy" id="trem-send-status" role="status" tabindex="-1">Enviando lembretes para ${plural(n, "aluno", "alunos")}… O resultado aparece aqui. Sair desta tela não cancela o envio.</p>` : f ? sendFailure(f) : ""}</section>`;
}
const recipients = (list) => `<section class="trem-recipients" aria-labelledby="trem-recipients-title"><h2 id="trem-recipients-title">Recebem agora · ${list.length}</h2>${names(list, true)}</section>`;

// Resultado por aluno, como o servidor o devolve: "sent" é a mensagem aceita pelo serviço de envio (a entrega aparece no
// detalhe do aluno); "failed" não diz se a recusa foi certa ou se a resposta não chegou (a próxima consulta diz); "skipped",
// com o motivo. Só o que não é zero. "publication-changed" é o primeiro conflito na reserva (outra reserva do mesmo aluno —
// outro lote, o envio individual ou o automático —, outra transação na turma, publicação nova ou outra alteração da turma),
// repetido para todos os seguintes, mesmo os que ficariam de fora por outro motivo: a tela não afirma a causa. O título,
// que recebe o foco, descreve as quantidades.
function batchResult(results) {
  const of = (status) => results.filter((r) => r.status === status);
  const sent = of("sent"), failed = of("failed"), skipped = of("skipped"), other = results.filter((r) => !["sent", "failed", "skipped"].includes(r.status));
  const changed = skipped.filter((r) => r.reason === "publication-changed").length;
  const facts = [sent.length && `${plural(sent.length, "aceito", "aceitos")} pelo serviço de envio`, failed.length && `${failed.length} sem confirmação do envio`,
    skipped.length && `${plural(skipped.length, "ficou", "ficaram")} de fora`, other.length && `${other.length} com outro resultado`].filter(Boolean);
  const group = (title, list, body = names(list, false)) => (list.length ? `<div class="trem-group"><h3>${title} · ${list.length}</h3>${body}</div>` : "");
  return `<section class="trem-result" aria-labelledby="trem-result-title"><h2 id="trem-result-title" tabindex="-1" aria-describedby="trem-result-count">Resultado do envio</h2>
  <p class="trem-count" id="trem-result-count">${facts.join(" · ")}.</p>
  <p class="trem-note">“Aceito pelo serviço de envio” ainda não é a entrega na caixa do aluno: a situação de cada um aparece em “Ver pendências”, no painel.</p>
  ${failed.length ? `<div class="trem-alert"><p><strong>${plural(failed.length, "aluno ficou", "alunos ficaram")} sem confirmação do envio.</strong> O serviço de envio recusou a mensagem ou não respondeu. Na nova consulta, quem teve a recusa confirmada volta a aparecer para envio; quem ficou sem resposta continua com o lembrete registrado e não recebe outro, para não haver duplicação.</p></div>` : ""}
  ${changed ? `<div class="trem-alert"><p><strong>Envio interrompido por conflito.</strong> O servidor encontrou um conflito ao registrar um lembrete e parou o envio; este envio não mandou lembrete para ${plural(changed, "aluno", "alunos")} (em “Envio interrompido por conflito”). A causa pode ser outro envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma; o portal não sabe qual. Antes de enviar de novo, consulte os destinatários: a nova consulta mostra quem já tem lembrete registrado, inclusive por outro envio, e quem ainda pode receber. Se as notas mudaram, ela já é da publicação nova, em que quem recebeu agora pode aparecer de novo.</p></div>` : ""}
  ${failed.length || changed ? '<div class="trem-actions"><button type="button" class="button secondary" data-action="retry-batch-preview">Consultar destinatários de novo</button></div>' : ""}
  ${group("Aceitos pelo serviço de envio", sent)}${group("Sem confirmação do envio", failed)}${group("Ficaram de fora", skipped, reasonGroups(skipped, "reason", false))}${group("Outro resultado", other)}</section>`;
}

export function batchPage(view = {}) {
  const page = (html) => `<div class="teacher-reminders">${heading(
    "",
    "Lembretes em lote",
    "Revise a lista e a prévia antes de enviar. Cada aluno recebe uma mensagem individual, com suas próprias pendências.",
    '<button class="button secondary" data-view="overview">Voltar ao painel</button>',
  )}<p class="small">${timeZoneLabel}.</p>${html}</div>`;
  if (state.batchError) return page(errorPanel(state.batchError, "retry-batch-preview"));
  if (state.batchResults) return page(batchResult(state.batchResults));
  const p = state.batchPreview;
  if (!p) return page('<p class="trem-loading" id="trem-batch-loading" role="status" tabindex="-1">Consultando destinatários…</p>');
  const eligible = p.recipients.filter((r) => !r.skip), out = p.recipients.filter((r) => r.skip);
  return page(`${batchSummary(p, eligible, out)}${p.sample ? `${sampleMessage(p.sample)}${sendBlock(p, eligible.length, view)}` : '<p class="trem-none">Nenhum aluno elegível para receber o lembrete agora.</p>'}${eligible.length ? recipients(eligible) : ""}`);
}

export function reminderPreview(p) {
  // Somente consulta: o Scheduler e a worker existentes continuam responsáveis pelo envio automático.
  const withdrawn = isWithdrawn(p) ? '<p role="status"><strong>Aluno desistente.</strong> Lembretes estão desativados.</p>' : "";
  const status = p.delivery?.status;
  const deliveryLabels = { sent: "Aceito pelo serviço de envio; entrega ainda não confirmada.",
    sending: "Envio em processamento. Aguarde e atualize o status da entrega.",
    unknown: "Resultado do envio incerto. Não reenvie para evitar duplicação; procure a coordenação.",
    failed: "O serviço rejeitou a tentativa. Consulte a coordenação.",
    delivered: "Entregue ao servidor de e-mail do destinatário. Isso não confirma leitura ou chegada à caixa de entrada.",
    bounced: "E-mail devolvido. Confira o endereço do aluno com a coordenação.",
    complained: "O destinatário marcou a mensagem como indesejada. Não reenvie.",
    rejected: "Mensagem rejeitada pelo serviço de e-mail.", delayed: "Entrega atrasada. Aguarde e consulte novamente." };
  const statusText = status ? deliveryLabels[status] || "Consulte a coordenação sobre o envio."
    : p.remindersEnabled === false ? "Informações de entrega indisponíveis nesta consulta."
    : "Nenhum lembrete registrado para este aluno nesta publicação.";
  return `<section class="panel reminder-panel"><h2>Lembretes automáticos</h2><p>Nas turmas habilitadas, os lembretes são enviados automaticamente às terças e sextas, às 20h (horário de Brasília), conforme as pendências e as regras da turma. Não é necessário enviar e-mail por esta tela.</p>${withdrawn}<p role="status">${e(statusText)}</p><button class="button secondary" data-student-pending="${e(p.student.id)}">Atualizar status do envio</button></section>`;
}

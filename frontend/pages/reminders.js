import { badge, date, demo, e, errorPanel, heading, metric, percent, state } from "../ui.js";
import { groupActivities, needsReview } from "../student-journey.js";
import { activityCard } from "./student.js";

export function senderPage() {
  const title = heading("APOIO AO ALUNO", "Lembretes por e-mail", "Confirme seu remetente e revise cada mensagem antes de enviar.");
  if (state.senderLoading) return title + '<section class="panel" role="status">Consultando seu remetente…</section>';
  if (state.senderError) return title + errorPanel(state.senderError, "refresh-sender");
  const s = state.sender;
  if (!s) return title + '<button class="button primary" data-action="refresh-sender">Consultar remetente</button>';
  return `${title}<section class="panel"><h2>Seu remetente</h2><p><strong>${e(s.sender)}</strong></p><p role="status">${e(s.reason)}</p>${s.enabled && !s.ready ? '<button class="button primary" data-action="verify-sender">Solicitar confirmação do meu e-mail</button>' : ""}<button class="button secondary" data-action="refresh-sender">Já confirmei · verificar novamente</button><p>A confirmação é individual. Procure a mensagem de verificação da Amazon Web Services no seu e-mail institucional, incluindo a pasta de spam.</p><p>Para enviar, abra um aluno no painel e confira a prévia. Publicar notas nunca dispara lembretes automaticamente.</p><button class="button secondary" data-view="overview">Ir ao painel da turma</button></section>`;
}

export function pendingPage() {
  const p = state.pendingPreview;
  const title = heading(
    "ACOMPANHAMENTO DO ALUNO",
    p ? `Pendências de ${e(p.student.name)}` : "Pendências do aluno",
    "Pendências, notas, módulos e histórico do aluno na última publicação.",
    '<button class="button secondary" data-view="overview">Voltar ao painel</button>',
  );
  if (state.pendingError) return title + errorPanel(state.pendingError, "retry-pending");
  if (!p)
    return `${title}<section class="panel" role="status">Carregando pendências…</section>`;
  return `${title}<section class="panel"><div class="panel-title"><div><h2>Atividades sem nota registrada</h2><p class="small">${e(p.student.email || "E-mail ausente no Canvas")} · Publicação de ${date(p.publishedAt)}</p></div><button class="button secondary" data-student-pending="${e(p.student.id)}">Atualizar pendências</button></div><div class="two-columns">${[
    ["kc", "KCs sem nota"],
    ["lab", "LABs sem nota"],
  ]
    .map(([kind, label]) => {
      const items = p.activities.filter((a) => a.kind === kind);
      return `<section aria-label="${label}"><h3>${label} (${items.length})</h3>${items.length ? items.map(activityCard).join("") : '<p class="small">Nenhuma pendência nesta categoria.</p>'}</section>`;
    })
    .join("")}</div></section>${reminderPreview(p)}${studentDetail(p)}`;
}

// Detalhe completo do aluno para a conversa de acompanhamento (todo/10), somente leitura.
function studentDetail(p) {
  if (!p.summary || !p.allActivities) return "";
  const s = p.summary, t = p.thresholds || { kc: 70, lab: 95 };
  const groups = groupActivities(p.allActivities);
  return `<section class="metrics" aria-label="Desempenho do aluno">${metric("Média em KCs", percent(s.kc), `Referência: ${t.kc}% ou mais`, "metric-primary")}${metric("Média em Labs", percent(s.lab), `Referência: ${t.lab}% ou mais`)}${metric("Com nota", percent(s.progress), `${s.completed} atividade(s) · ${s.pending} sem nota`)}${metric("Situação", badge(s.status), "Critério da turma")}</section>
  <section class="panel"><h2>Todas as atividades</h2><p class="small">Notas, pendências e sugestões de revisão por módulo, como o aluno vê.</p>${groups.map(([name, items], i) => `<details class="activity-module" ${i === 0 ? "open" : ""}><summary><strong>${e(name)}</strong><span>${items.filter((a) => a.state === "completed").length} com nota · ${items.filter((a) => a.state === "pending").length} sem nota · ${items.filter(needsReview).length} para revisar</span></summary>${items.map(activityCard).join("")}</details>`).join("")}</section>
  ${p.history?.length ? `<section class="panel"><h2>Histórico do aluno</h2><div class="table-scroll"><table><thead><tr><th>Publicação</th><th>KCs</th><th>Labs</th><th>Média geral</th></tr></thead><tbody>${p.history.map((h) => `<tr><td>${date(h.publishedAt)}${h.current ? " · atual" : ""}</td><td>${percent(h.kc)}</td><td>${percent(h.lab)}</td><td>${percent(h.total)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
}

const skipLabels = {
  "no-email": "Sem e-mail no Canvas",
  "no-pending": "Sem atividades sem nota",
  "already-sent": "Já contatado nesta publicação",
  "not-found": "Não encontrado nesta publicação",
  "publication-changed": "Notas atualizadas durante o envio",
};
const resultLabels = { sent: "Enviado", failed: "Falhou", skipped: "Pulado" };

export function batchPage() {
  const title = heading(
    "ACOMPANHAMENTO DA TURMA",
    "Lembretes em lote",
    "Revise a lista e a prévia antes de enviar. Cada aluno recebe uma mensagem individual, com suas próprias pendências.",
    '<button class="button secondary" data-view="overview">Voltar ao painel</button>',
  );
  if (state.batchError) return title + errorPanel(state.batchError, "retry-batch-preview");
  if (state.batchResults) {
    const counts = state.batchResults.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    return `${title}<section class="panel"><h2>Resultado do envio</h2><p>${counts.sent || 0} enviado(s) · ${counts.skipped || 0} pulado(s) · ${counts.failed || 0} com falha.</p><div class="table-scroll"><table><thead><tr><th>Aluno</th><th>Resultado</th></tr></thead><tbody>${state.batchResults.map((r) => `<tr><td>${e(r.name || r.id)}</td><td>${resultLabels[r.status] || r.status}${r.reason ? ` · ${e(skipLabels[r.reason] || r.reason)}` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  const p = state.batchPreview;
  if (!p) return `${title}<section class="panel" role="status">Consultando destinatários…</section>`;
  const eligible = p.recipients.filter((r) => !r.skip);
  return `${title}<section class="panel"><h2>Destinatários</h2><p>${eligible.length} de ${p.recipients.length} aluno(s) vão receber um lembrete agora. Os demais aparecem com o motivo por que serão pulados.</p><div class="table-scroll"><table><thead><tr><th>Aluno</th><th>Sem nota</th><th>Situação</th></tr></thead><tbody>${p.recipients.map((r) => `<tr><td>${e(r.name || r.id)}</td><td>${r.pending}</td><td>${r.skip ? e(skipLabels[r.skip] || r.skip) : "Será enviado"}</td></tr>`).join("")}</tbody></table></div></section>${p.sample ? `<section class="panel reminder-panel"><h2>Exemplo de mensagem</h2><p class="small">Cada aluno recebe uma versão com suas próprias pendências; este é só um exemplo.</p><dl><dt>De</dt><dd>${e(p.sample.from)}</dd><dt>Assunto</dt><dd>${e(p.sample.subject)}</dd></dl><pre class="email-preview">${e(p.sample.text)}</pre><p role="status">${e(p.ses?.reason || "")}</p>${!p.ses?.ready ? '<button class="button secondary" data-view="reminders">Configurar meu remetente</button>' : ""}<button class="button primary" data-action="send-reminders-batch" ${eligible.length && p.ses?.ready ? "" : "disabled"}>Enviar para ${eligible.length} aluno(s)</button></section>` : '<section class="panel"><p>Nenhum aluno elegível para receber o lembrete agora.</p></section>'}`;
}

export function reminderPreview(p) {
  if (!p.message) return '<section class="panel"><h2>Lembrete por e-mail</h2><p>O envio está desativado nesta instalação. Você pode consultar as atividades acima.</p></section>';
  const status = p.delivery?.status;
  const deliveryLabels = { sent: "Aceito pelo serviço de envio; entrega ainda não confirmada.",
    sending: "Envio em processamento. Atualize o status antes de tentar novamente.",
    unknown: "Resultado do envio incerto. Não reenvie para evitar duplicação; procure a coordenação.",
    failed: "O serviço rejeitou a tentativa. Você pode revisar e tentar novamente.",
    delivered: "Entregue ao servidor de e-mail do destinatário. Isso não confirma leitura ou chegada à caixa de entrada.",
    bounced: "E-mail devolvido. Confira o endereço do aluno com a coordenação.",
    complained: "O destinatário marcou a mensagem como indesejada. Não reenvie.",
    rejected: "Mensagem rejeitada pelo serviço de e-mail.", delayed: "Entrega atrasada. Aguarde e consulte novamente." };
  const allowed = !demo && p.ses?.ready && p.student.email && p.activities.length && (!status || status === "failed");
  return `<section class="panel reminder-panel"><h2>Prévia do lembrete</h2><dl><dt>De</dt><dd>${e(p.message.from)}</dd><dt>Para</dt><dd>${e(p.message.to || "E-mail ausente no Canvas")}</dd><dt>Assunto</dt><dd>${e(p.message.subject)}</dd></dl><pre class="email-preview">${e(p.message.text)}</pre><p role="status">${e(status ? deliveryLabels[status] || "Consulte a coordenação sobre o envio." : p.ses?.reason || "Verifique seu remetente.")}</p>${!p.ses?.ready ? '<button class="button secondary" data-view="reminders">Configurar meu remetente</button>' : ""}<button class="button primary" data-action="send-reminder" ${allowed ? "" : "disabled"}>Enviar e-mail para este aluno</button><button class="button secondary" data-action="copy-reminder">Copiar mensagem</button><button class="button secondary" data-student-pending="${e(p.student.id)}">Atualizar status do envio</button></section>`;
}

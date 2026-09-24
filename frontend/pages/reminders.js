import { date, demo, e, errorPanel, heading, state } from "../ui.js";
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
    "Confira as atividades da última publicação e ofereça apoio ao aluno.",
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
    .join("")}</div></section>${reminderPreview(p)}`;
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
  return `<section class="panel reminder-panel"><h2>Prévia do lembrete</h2><dl><dt>De</dt><dd>${e(p.message.from)}</dd><dt>Para</dt><dd>${e(p.message.to || "E-mail ausente no Canvas")}</dd><dt>Assunto</dt><dd>${e(p.message.subject)}</dd></dl><pre class="email-preview">${e(p.message.text)}</pre><p role="status">${e(status ? deliveryLabels[status] || "Consulte a coordenação sobre o envio." : p.ses?.reason || "Verifique seu remetente.")}</p>${!p.ses?.ready ? '<button class="button secondary" data-view="reminders">Configurar meu remetente</button>' : ""}<button class="button primary" data-action="send-reminder" ${allowed ? "" : "disabled"}>Enviar e-mail para este aluno</button><button class="button secondary" data-student-pending="${e(p.student.id)}">Atualizar status do envio</button></section>`;
}

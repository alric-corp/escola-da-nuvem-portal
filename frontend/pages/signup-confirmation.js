// Confirmação de cadastro antes do login: o botão que abre o fluxo e a etapa aberta, montados a partir de
// state.signupConfirmation. O app.js encaixa os dois na landing e informa quanto falta para liberar o reenvio. O código
// digitado nunca passa por aqui: o campo nasce vazio.
import { e, icon, plural } from "../ui.js";
import { state } from "../state.js";
import { SIGNUP_ERRORS, SIGNUP_STEPS, maskSignupEmail } from "../handlers/signup-confirmation.js";

// Um texto fixo por erro de domínio; conta inexistente não tem texto próprio.
const MESSAGES = {
  [SIGNUP_ERRORS.INVALID_EMAIL]: "Digite um e-mail válido.",
  [SIGNUP_ERRORS.INVALID_CODE]: "Digite o código recebido por e-mail.",
  [SIGNUP_ERRORS.WRONG_CODE]: "Código incorreto. Use o código mais recente que enviamos.",
  [SIGNUP_ERRORS.EXPIRED_CODE]: "Este código expirou. Peça um novo.",
  [SIGNUP_ERRORS.TOO_MANY_ATTEMPTS]: "Muitas tentativas. Aguarde alguns minutos.",
  [SIGNUP_ERRORS.ALREADY_CONFIRMED_OR_UNAVAILABLE]: "Não foi possível confirmar com este código. Se você já confirmou, tente fazer login.",
  [SIGNUP_ERRORS.TEMPORARY_FAILURE]: "Não foi possível concluir agora. Tente novamente em instantes.",
  [SIGNUP_ERRORS.CONFIGURATION_FAILURE]: "A confirmação está indisponível no momento.",
};

export function signupConfirmationEntry() {
  return '<button type="button" class="button secondary signup-entry" data-action="signup-confirmation-start">Confirmar cadastro</button>';
}

const title = (text) => `<h1 id="signup-title" tabindex="-1">${text}</h1>`;
const errorMessage = (error) => (error ? `<p class="signup-error" id="signup-error" role="alert">${MESSAGES[error] || MESSAGES[SIGNUP_ERRORS.TEMPORARY_FAILURE]}</p>` : "");

// resendWait: milissegundos até o reenvio ser liberado (0 quando já pode reenviar).
export function signupConfirmationPage(resendWait = 0) {
  const s = state.signupConfirmation;
  const described = s.error ? ' aria-describedby="signup-error"' : "";
  if (s.step === SIGNUP_STEPS.EMAIL)
    return `<div class="signup-confirmation">${title("Confirmar cadastro")}<p>Se você criou sua conta e não conseguiu concluir a confirmação, podemos enviar um novo código.</p>
  <form id="signup-email-form" class="stack-form" novalidate><label for="signup-email">E-mail<input id="signup-email" name="email" type="email" autocomplete="email" value="${e(s.email)}"${s.sending ? " readonly" : ""}${s.error === SIGNUP_ERRORS.INVALID_EMAIL ? ' aria-invalid="true"' : ""}${described}></label>${errorMessage(s.error)}
  <div class="signup-actions"><button type="submit" class="button primary" id="signup-send"${s.sending ? " disabled" : ""}>${s.sending ? "Enviando…" : "Enviar código"}</button><button type="button" class="button secondary" id="signup-back" data-action="signup-confirmation-reset">Voltar</button></div></form></div>`;
  if (s.step === SIGNUP_STEPS.CODE) {
    const busy = s.sending || s.confirming;
    return `<div class="signup-confirmation">${title("Digite o código")}<p>Se houver um cadastro pendente para <strong>${e(maskSignupEmail(s.email))}</strong>, enviamos um código. Pode levar alguns minutos; confira o spam. Se você já confirmou sua conta, pode fazer login.</p>
  <form id="signup-code-form" class="stack-form" novalidate><label for="signup-code">Código de confirmação<input id="signup-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"${s.confirming ? " readonly" : ""}${described}></label>${errorMessage(s.error)}
  <div class="signup-actions"><button type="submit" class="button primary" id="signup-confirm"${busy ? " disabled" : ""}>${s.confirming ? "Confirmando…" : "Confirmar"}</button></div></form>
  <div class="signup-actions"><button type="button" class="button secondary" id="signup-resend" data-action="signup-confirmation-resend"${busy || resendWait > 0 ? " disabled" : ""}${resendWait > 0 ? ' aria-describedby="signup-wait"' : ""}>${s.sending ? "Reenviando…" : "Reenviar código"}</button><button type="button" class="text-link" id="signup-other-email" data-action="signup-confirmation-use-other-email">Usar outro e-mail</button></div>
  ${resendWait > 0 ? `<p class="signup-wait" id="signup-wait">Você poderá pedir outro código em até ${plural(Math.ceil(resendWait / 60_000), "minuto", "minutos")}.</p>` : ""}</div>`;
  }
  if (s.step === SIGNUP_STEPS.SUCCESS)
    return `<div class="signup-confirmation">${title("Cadastro confirmado")}<p>Cadastro confirmado. Agora entre com seu e-mail e senha.</p><button type="button" class="button primary" id="signup-login" data-action="login">Fazer login ${icon("arrow")}</button></div>`;
  return "";
}

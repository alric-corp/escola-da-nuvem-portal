// Confirmação de cadastro antes do login: pedir ou reenviar o código e confirmar a conta UNCONFIRMED com o
// código que a própria pessoa digita. Resultados de reenvio que dependem da conta (ACCOUNT_STATE_CATEGORIES)
// deixam o mesmo estado de um envio aceito, para não revelar se a conta existe, já foi confirmada ou atingiu o
// limite; falhas técnicas continuam visíveis. O código só passa por confirm(), nunca pelo state. Listeners,
// foco e a tela ficam com app.js e a página.
import * as api from "../api.js";
import { state } from "../state.js";

let render = null;

export function configure(options) {
  render = options.render;
}

export const SIGNUP_STEPS = Object.freeze({ CLOSED: "", EMAIL: "email", CODE: "code", SUCCESS: "success" });

// Erros de domínio; a página escolhe o texto. Conta inexistente nunca tem erro próprio.
export const SIGNUP_ERRORS = Object.freeze({
  INVALID_EMAIL: "INVALID_EMAIL",
  INVALID_CODE: "INVALID_CODE",
  WRONG_CODE: "WRONG_CODE",
  EXPIRED_CODE: "EXPIRED_CODE",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
  ALREADY_CONFIRMED_OR_UNAVAILABLE: "ALREADY_CONFIRMED_OR_UNAVAILABLE",
  TEMPORARY_FAILURE: "TEMPORARY_FAILURE",
  CONFIGURATION_FAILURE: "CONFIGURATION_FAILURE",
});

// Vazão do serviço não depende da conta: avisa e não finge envio. As demais categorias técnicas viram falha
// temporária.
const RESEND_ERRORS = new Map([["INVALID_EMAIL", SIGNUP_ERRORS.INVALID_EMAIL], ["RATE_LIMITED", SIGNUP_ERRORS.TOO_MANY_ATTEMPTS],
  ["CONFIG_ERROR", SIGNUP_ERRORS.CONFIGURATION_FAILURE]]);
// USER_NOT_FOUND tem o mesmo erro de código errado; NotAuthorized não prova confirmação (pode ser outra causa).
const CONFIRM_ERRORS = new Map([["INVALID_CODE", SIGNUP_ERRORS.INVALID_CODE], ["INVALID_PARAMETER", SIGNUP_ERRORS.INVALID_CODE],
  ["CODE_MISMATCH", SIGNUP_ERRORS.WRONG_CODE], ["USER_NOT_FOUND", SIGNUP_ERRORS.WRONG_CODE], ["CODE_EXPIRED", SIGNUP_ERRORS.EXPIRED_CODE],
  ["TOO_MANY_ATTEMPTS", SIGNUP_ERRORS.TOO_MANY_ATTEMPTS], ["RATE_LIMITED", SIGNUP_ERRORS.TOO_MANY_ATTEMPTS],
  ["NOT_AUTHORIZED", SIGNUP_ERRORS.ALREADY_CONFIRMED_OR_UNAVAILABLE], ["ALIAS_EXISTS", SIGNUP_ERRORS.ALREADY_CONFIRMED_OR_UNAVAILABLE],
  ["CONFIG_ERROR", SIGNUP_ERRORS.CONFIGURATION_FAILURE]]);
const domainError = (errors, err) => errors.get(err?.category) ?? SIGNUP_ERRORS.TEMPORARY_FAILURE;

const RESEND_COOLDOWN_MS = 60_000;
// Fatia inicial, como definida em state.js (lida antes de qualquer alteração).
const BLANK = Object.freeze({ ...state.signupConfirmation });
// Geração das chamadas: start() e reset() descartam respostas ainda em andamento.
let signupRequest = 0;

// "ana.souza@gmail.com" → "an***@gmail.com": domínio visível; da parte local, 2 caracteres (1 se for curta).
export function maskSignupEmail(email) {
  const at = typeof email === "string" ? email.lastIndexOf("@") : -1;
  if (at < 1) return "";
  const local = Array.from(email.slice(0, at));
  return `${local.slice(0, local.length > 2 ? 2 : 1).join("")}***${email.slice(at)}`;
}

// Abre o fluxo, ou recomeça com outro e-mail: etapa EMAIL, sem nada da tentativa anterior.
export function start() {
  signupRequest++;
  Object.assign(state.signupConfirmation, BLANK, { step: SIGNUP_STEPS.EMAIL });
  render();
}

// Fecha o fluxo e limpa só a sua fatia (voltar, sair, navegar).
export function reset() {
  signupRequest++;
  Object.assign(state.signupConfirmation, BLANK);
  render();
}

// "Enviar código" na etapa EMAIL (e-mail digitado) e "Reenviar código" na etapa CODE (sempre o e-mail do fluxo,
// depois do intervalo).
export async function requestCode(input) {
  const s = state.signupConfirmation;
  if (s.sending || s.confirming || (s.step !== SIGNUP_STEPS.EMAIL && s.step !== SIGNUP_STEPS.CODE)) return;
  if (s.step === SIGNUP_STEPS.CODE && Date.now() < s.resendAvailableAt) return;
  const email = s.step === SIGNUP_STEPS.CODE ? s.email : api.normalizeSignupEmail(input);
  if (!email) {
    Object.assign(s, { email: typeof input === "string" ? input : "", error: SIGNUP_ERRORS.INVALID_EMAIL });
    render();
    return;
  }
  const request = ++signupRequest;
  Object.assign(s, { email, sending: true, error: "" });
  render();
  let error = "";
  try {
    await api.signupConfirmation.resend(email);
  } catch (err) {
    if (!api.ACCOUNT_STATE_CATEGORIES.includes(err?.category)) error = domainError(RESEND_ERRORS, err);
  }
  if (request !== signupRequest) return;
  if (error) Object.assign(s, { sending: false, error });
  else Object.assign(s, { step: SIGNUP_STEPS.CODE, sending: false, error: "", resendAvailableAt: Date.now() + RESEND_COOLDOWN_MS });
  render();
}

// Confirma o e-mail do fluxo com o código digitado; confirmed só depois da resposta de sucesso do Cognito.
export async function confirm(code) {
  const s = state.signupConfirmation;
  if (s.step !== SIGNUP_STEPS.CODE || s.sending || s.confirming) return;
  const request = ++signupRequest;
  Object.assign(s, { confirming: true, error: "" });
  render();
  let error = "";
  try {
    await api.signupConfirmation.confirm(s.email, code);
  } catch (err) {
    error = domainError(CONFIRM_ERRORS, err);
  }
  if (request !== signupRequest) return;
  if (error) Object.assign(s, { confirming: false, error });
  else Object.assign(s, { step: SIGNUP_STEPS.SUCCESS, confirming: false, error: "", confirmed: true });
  render();
}

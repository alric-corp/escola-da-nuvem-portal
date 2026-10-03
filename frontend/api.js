// Rede do portal: API autenticada, envio direto ao S3 e confirmação de cadastro no Cognito. Não conhece estado, DOM nem navegação;
// quem chama decide o que mostrar. Os caminhos repetem exatamente os que o app já usava,
// inclusive onde o código da turma não passa por encodeURIComponent.
import { validSession } from "./auth.js";

let config = null;
let onSessionExpired = null;
let transport = http;

export function configure(options) {
  if (!options?.config || typeof options.onSessionExpired !== "function")
    throw new TypeError("configure() precisa de config e de onSessionExpired.");
  config = options.config;
  onSessionExpired = options.onSessionExpired;
}

// A demonstração troca o transporte inteiro por dados fictícios com a mesma assinatura (path, options).
export function setTransport(fn) {
  if (typeof fn !== "function") throw new TypeError("setTransport() precisa de uma função.");
  transport = fn;
}

async function http(path, options = {}) {
  if (!config) throw new Error("configure() precisa ser chamado antes da primeira requisição.");
  const auth = await validSession(config);
  if (!auth || auth.expires <= Date.now()) {
    onSessionExpired();
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  const method = options.method || "GET";
  // Só GET é repetido: reenviar um POST automaticamente arrisca duplicar uma ação
  // (publicar notas, enviar lembrete). Espera crescente com variação para não sincronizar
  // clientes que foram limitados juntos (ex.: uma turma inteira abrindo o portal).
  const attempts = method === "GET" ? 4 : 1;
  let res;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Sem resposta (rede ou tempo esgotado): o próprio erro do fetch, marcado como network para quem precisa distinguir.
    res = await fetch(config.apiUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
    }).catch((err) => { throw Object.assign(err, { network: true }); });
    if (res.status !== 429 || attempt === attempts - 1) break;
    await new Promise((resolve) =>
      setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 200),
    );
  }
  // O gateway pode devolver HTML ou corpo vazio (ex.: 502/504); só a API responde JSON.
  const data = (res.headers.get("content-type") || "").includes("application/json")
    ? await res.json().catch(() => ({}))
    : {};
  if (!res.ok) {
    // O status acompanha a mensagem: quem chama pode tratar um conflito (409) de outro jeito sem ler o texto.
    const failure = (message) => Object.assign(new Error(message), { status: res.status });
    if (res.status === 401) onSessionExpired();
    if (res.status === 429)
      throw failure(
        data.error || "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.",
      );
    if ([502, 503, 504].includes(res.status) && !data.error)
      throw failure(
        "O portal está temporariamente indisponível. Tente novamente em instantes.",
      );
    throw failure(
      data.error || "Não foi possível completar a solicitação.",
    );
  }
  return data;
}

const request = (path, options) => transport(path, options);
const post = (path, body) => request(path, { method: "POST", body });
const attachmentsPath = (feedbackId) => `/feedback/${encodeURIComponent(feedbackId)}/attachments`;

export const me = {
  get: () => request("/me"),
};

export const cohorts = {
  list: () => request("/cohorts"),
  create: (body) => post("/cohorts", body),
  report: (code) => request(`/cohorts/${encodeURIComponent(code)}/report`),
  studentView: (code, body) => post(`/cohorts/${encodeURIComponent(code)}/student-view`, body),
  classReport: (code) => request(`/cohorts/${encodeURIComponent(code)}/class-report`),
  saveSettings: (code, body) => post(`/cohorts/${code}/settings`, body),
  saveFocus: (code, body) => post(`/cohorts/${code}/focus-activities`, body),
  previewImport: (code, body) => post(`/cohorts/${code}/preview`, body),
  publish: (code, body) => post(`/cohorts/${code}/publish`, body),
  restore: (code, body) => post(`/cohorts/${code}/restore`, body),
  // Marcar ou reativar desistente: { canvasId, status, expectedStatus }; quem pediu vem da sessão, no servidor.
  setParticipation: (code, body) => post(`/cohorts/${encodeURIComponent(code)}/participation`, body),
};

export const reminders = {
  pendingPreview: (code, body) => post(`/cohorts/${code}/pending-preview`, body),
  batchPreview: (code, body) => post(`/cohorts/${code}/pending-preview-batch`, body),
  send: (code, body) => post(`/cohorts/${code}/send-reminder`, body),
  sendBatch: (code, body) => post(`/cohorts/${code}/send-reminders`, body),
  senderSettings: (code) => request(`/cohorts/${code}/reminder-settings`),
  verifySender: (code) => post(`/cohorts/${code}/verify-sender`, {}),
};

export const access = {
  requestInstructorAccess: () => post("/access-request", {}),
  requests: () => request("/requests"),
  rejectRequest: (userId) => post(`/requests/${userId}/reject`, {}),
  instructors: (code) => request(`/cohorts/${code}/instructors`),
  addInstructor: (code, body) => post(`/cohorts/${code}/instructors`, body),
  revokeInstructor: (code, body) => post(`/cohorts/${code}/revoke-instructor`, body),
  searchStudents: (code, body) => post(`/cohorts/${code}/students-search`, body),
  unlinkStudent: (code, body) => post(`/cohorts/${code}/unlink-student`, body),
  setDisplayName: (code, body) => post(`/cohorts/${code}/display-name`, body),
};

export const feedback = {
  listMine: (cursor) => request(`/feedback?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  create: (body) => post("/feedback", body),
  attachments: (feedbackId) => request(attachmentsPath(feedbackId)),
  attachmentUrl: (feedbackId, attachmentId) =>
    request(`${attachmentsPath(feedbackId)}/${encodeURIComponent(attachmentId)}`),
  // clientToken no body: repetir o pedido devolve o mesmo slot em vez de criar outro.
  createAttachment: (feedbackId, body) => post(attachmentsPath(feedbackId), body),
  completeAttachment: (feedbackId, attachmentId) =>
    post(`${attachmentsPath(feedbackId)}/${encodeURIComponent(attachmentId)}/complete`, {}),
};

export const adminFeedback = {
  list: (filters, cursor) => {
    const params = new URLSearchParams({ limit: "50" });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (cursor) params.set("cursor", cursor);
    return request(`/admin/feedback?${params}`);
  },
  setStatus: (feedbackId, body) => post(`/admin/feedback/${encodeURIComponent(feedbackId)}/status`, body),
};

// Presigned POST: vai direto ao S3, sem Authorization e fora do transporte da API. A conclusão
// (completeAttachment) confere o arquivo no backend.
export async function uploadAttachmentToS3(upload, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", file);
  const sent = await fetch(upload.url, { method: "POST", body: form });
  if (!sent.ok) throw new Error("O envio da imagem foi recusado.");
}

// Confirmação de cadastro (contas UNCONFIRMED): ResendConfirmationCode e ConfirmSignUp são operações públicas
// do Cognito, sem IAM, token ou cookies, chamadas direto do navegador e fora do transporte autenticado. Dependem
// só de config.region e config.userPoolClientId. Falhas saem como categorias estáveis; a mensagem da AWS, o
// e-mail e o código nunca aparecem no erro.
const SIGNUP_TIMEOUT_MS = 15000;
const SIGNUP_ERROR_CATEGORIES = new Map(Object.entries({
  CodeMismatchException: "CODE_MISMATCH",
  ExpiredCodeException: "CODE_EXPIRED",
  TooManyFailedAttemptsException: "TOO_MANY_ATTEMPTS",
  LimitExceededException: "TOO_MANY_ATTEMPTS",
  TooManyRequestsException: "RATE_LIMITED",
  NotAuthorizedException: "NOT_AUTHORIZED",
  InvalidParameterException: "INVALID_PARAMETER",
  UserNotFoundException: "USER_NOT_FOUND",
  AliasExistsException: "ALIAS_EXISTS",
  CodeDeliveryFailureException: "DELIVERY_FAILED",
  InternalErrorException: "SERVICE_UNAVAILABLE",
  ForbiddenException: "SERVICE_UNAVAILABLE",
  ResourceNotFoundException: "CONFIG_ERROR",
  OperationNotEnabledException: "CONFIG_ERROR",
  InvalidEmailRoleAccessPolicyException: "CONFIG_ERROR",
  InvalidSmsRoleAccessPolicyException: "CONFIG_ERROR",
  InvalidSmsRoleTrustRelationshipException: "CONFIG_ERROR",
  InvalidLambdaResponseException: "CONFIG_ERROR",
  UnexpectedLambdaException: "CONFIG_ERROR",
  UserLambdaValidationException: "CONFIG_ERROR",
}));

// Resultados que dependem da existência ou do estado da conta: quem mostra a resposta deve tratá-los sem
// revelar qual deles ocorreu.
export const ACCOUNT_STATE_CATEGORIES = Object.freeze(["USER_NOT_FOUND", "INVALID_PARAMETER", "NOT_AUTHORIZED",
  "TOO_MANY_ATTEMPTS", "DELIVERY_FAILED", "ALIAS_EXISTS"]);

export class SignupConfirmationError extends Error {
  constructor(category, awsType = null) {
    super(category);
    this.name = "SignupConfirmationError";
    this.category = category;
    // Só para diagnóstico e testes: não enumerável, fica fora de JSON e da exibição do objeto.
    Object.defineProperty(this, "awsType", { value: awsType });
  }
}

// O pool usa o e-mail como username: só apara e passa para minúsculas, sem regras de provedor (pontos, +tag).
// null quando não serve como Username do Cognito (até 128 caracteres).
export function normalizeSignupEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 128 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[\u0000-\u001f\u007f]/.test(email) ? email : null;
}

// Endpoint montado só a partir da região configurada; nada vindo do usuário entra na URL.
function signupTarget() {
  const region = config?.region, clientId = config?.userPoolClientId;
  if (typeof region !== "string" || !/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(region)) return null;
  if (typeof clientId !== "string" || !/^[\w+]{1,128}$/.test(clientId)) return null;
  return { endpoint: `https://cognito-idp.${region}.amazonaws.com/`, clientId };
}

async function cognito(operation, endpoint, payload) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${operation}` },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(SIGNUP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new SignupConfirmationError(err?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR");
  }
  // Sucesso sem ler o corpo: CodeDeliveryDetails e Session não saem daqui.
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  // O tipo vem em __type (às vezes com namespace "…#Tipo") ou no cabeçalho x-amzn-ErrorType ("Tipo:url").
  const name = String(data?.__type || res.headers.get("x-amzn-ErrorType") || "").split(":")[0].split("#").pop().trim();
  const awsType = /^[A-Za-z]{1,64}$/.test(name) ? name : null;
  const category = SIGNUP_ERROR_CATEGORIES.get(awsType)
    ?? (res.status >= 500 ? "SERVICE_UNAVAILABLE" : res.status === 429 ? "RATE_LIMITED" : "UNKNOWN");
  throw new SignupConfirmationError(category, awsType);
}

export const signupConfirmation = {
  async resend(email) {
    const target = signupTarget();
    if (!target) throw new SignupConfirmationError("CONFIG_ERROR");
    const username = normalizeSignupEmail(email);
    if (!username) throw new SignupConfirmationError("INVALID_EMAIL");
    return cognito("ResendConfirmationCode", target.endpoint, { ClientId: target.clientId, Username: username });
  },
  async confirm(email, code) {
    const target = signupTarget();
    if (!target) throw new SignupConfirmationError("CONFIG_ERROR");
    const username = normalizeSignupEmail(email);
    if (!username) throw new SignupConfirmationError("INVALID_EMAIL");
    // Sempre string (zeros à esquerda contam), só no corpo HTTPS; nunca em URL, storage ou mensagem.
    const confirmationCode = typeof code === "string" ? code.trim() : "";
    if (!/^\S{1,2048}$/.test(confirmationCode)) throw new SignupConfirmationError("INVALID_CODE");
    return cognito("ConfirmSignUp", target.endpoint, { ClientId: target.clientId, Username: username, ConfirmationCode: confirmationCode });
  },
};

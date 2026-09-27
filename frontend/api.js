// Rede do portal: API autenticada e envio direto ao S3. Não conhece estado, DOM nem navegação;
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
    res = await fetch(config.apiUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
    });
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
    if (res.status === 401) onSessionExpired();
    if (res.status === 429)
      throw new Error(
        data.error || "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente.",
      );
    if ([502, 503, 504].includes(res.status) && !data.error)
      throw new Error(
        "O portal está temporariamente indisponível. Tente novamente em instantes.",
      );
    throw new Error(
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

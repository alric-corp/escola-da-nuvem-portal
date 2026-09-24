const key = "avanca.session";
const flowKey = "avanca.oauth";
let refreshing = null;
const b64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export function session() {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}
export function clearSession() {
  sessionStorage.removeItem(key);
  sessionStorage.removeItem(flowKey);
}
export async function login(config) {
  if (!config.authDomain || !config.userPoolClientId)
    throw new Error("O acesso ao portal ainda está sendo preparado.");
  const verifier = random(),
    state = random(),
    nonce = random();
  const challenge = b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  sessionStorage.setItem(
    flowKey,
    JSON.stringify({ verifier, state, nonce, created: Date.now() }),
  );
  const url = new URL("/oauth2/authorize", config.authDomain);
  url.search = new URLSearchParams({
    client_id: config.userPoolClientId,
    response_type: "code",
    lang: "pt-BR",
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  location.assign(url);
}
export async function callback(config) {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;
  const flow = JSON.parse(sessionStorage.getItem(flowKey) || "null");
  sessionStorage.removeItem(flowKey);
  history.replaceState({}, "", location.pathname);
  if (
    !flow ||
    flow.state !== params.get("state") ||
    Date.now() - flow.created > 600000
  )
    throw new Error("O login expirou. Entre novamente.");
  if (params.has("error"))
    throw new Error("O login não foi concluído. Tente novamente.");
  const res = await fetch(new URL("/oauth2/token", config.authDomain), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.userPoolClientId,
      redirect_uri: config.redirectUri,
      code: params.get("code"),
      code_verifier: flow.verifier,
    }),
  });
  if (!res.ok)
    throw new Error("Não foi possível concluir o login. Tente novamente.");
  const tokens = await res.json();
  const encoded = tokens.id_token
    .split(".")[1]
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const id = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    ),
  );
  // O ID token só é usado para correlacionar o nonce; a API valida o access token.
  if (
    id.nonce !== flow.nonce ||
    id.aud !== config.userPoolClientId ||
    id.exp * 1000 <= Date.now()
  )
    throw new Error("Sessão inválida. Entre novamente.");
  sessionStorage.setItem(
    key,
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
    }),
  );
}
export async function validSession(config) {
  const current = session();
  if (!current) return null;
  if (current.expires > Date.now() + 60000) return current;
  if (!current.refreshToken) return current.expires > Date.now() ? current : null;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch(new URL("/oauth2/token", config.authDomain), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: config.userPoolClientId,
        refresh_token: current.refreshToken }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 400 || res.status === 401) {
      if (session()?.refreshToken === current.refreshToken) clearSession();
      return null;
    }
    if (!res.ok) throw new Error("Não foi possível renovar a sessão. Tente novamente.");
    const tokens = await res.json();
    if (!tokens.access_token || !(tokens.expires_in > 0))
      throw new Error("Não foi possível renovar a sessão. Tente novamente.");
    // Um logout ou uma troca de conta durante a requisição não pode ser desfeito.
    if (session()?.refreshToken !== current.refreshToken) return null;
    const next = { accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || current.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000 };
    sessionStorage.setItem(key, JSON.stringify(next));
    return next;
  })();
  try { return await refreshing; }
  finally { refreshing = null; }
}

export function logout(config) {
  clearSession();
  if (!config.authDomain) {
    location.assign(location.pathname);
    return;
  }
  const url = new URL("/logout", config.authDomain);
  url.search = new URLSearchParams({
    client_id: config.userPoolClientId,
    logout_uri: config.logoutUri,
  });
  location.assign(url);
}

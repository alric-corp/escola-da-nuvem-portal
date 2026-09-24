import assert from "node:assert/strict";
import test from "node:test";
import { validSession, clearSession, session } from "../frontend/auth.js";

const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) || null,
  setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
const config = { authDomain: "https://auth.example.test", userPoolClientId: "client" };
const expired = { accessToken: "old", refreshToken: "refresh", expires: Date.now() - 1000 };
const store = (value) => localStorage.setItem("avanca.session", JSON.stringify(value));

test("renova uma única vez para chamadas simultâneas", async () => {
  store(expired);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), "https://auth.example.test/oauth2/token");
    assert.equal(options.body.get("grant_type"), "refresh_token");
    assert.equal(options.body.get("refresh_token"), "refresh");
    return { ok: true, json: async () => ({ access_token: "new", expires_in: 900 }) };
  };
  const results = await Promise.all([validSession(config), validSession(config)]);
  assert.equal(calls, 1);
  assert.equal(results[0].accessToken, "new");
  assert.equal(results[1].accessToken, "new");
  assert.equal(session().refreshToken, "refresh");
});

test("não renova token ainda válido", async () => {
  store({ ...expired, expires: Date.now() + 600000 });
  globalThis.fetch = () => { throw new Error("Não deve chamar rede"); };
  assert.equal((await validSession(config)).accessToken, "old");
});

test("falha temporária preserva sessão para tentar novamente", async () => {
  store(expired);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(validSession(config), /renovar/);
  assert.equal(session().refreshToken, "refresh");
});

test("refresh revogado limpa sessão", async () => {
  store(expired);
  globalThis.fetch = async () => ({ ok: false, status: 400 });
  assert.equal(await validSession(config), null);
  assert.equal(session(), null);
});

test("logout durante renovação não reabre sessão", async () => {
  store(expired);
  let complete;
  globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
  const request = validSession(config);
  clearSession();
  complete({ ok: true, json: async () => ({ access_token: "late", expires_in: 900 }) });
  assert.equal(await request, null);
  assert.equal(session(), null);
});

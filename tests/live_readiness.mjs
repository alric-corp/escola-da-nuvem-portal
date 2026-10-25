// Verificação pública explícita; importar este módulo não faz consultas.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

async function read(url, fetchImpl, label) {
  const response = await fetchImpl(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${label} indisponível (HTTP ${response.status})`);
  return response.text();
}

export async function verifyPublishedConfig(outputs, fetchImpl = fetch) {
  const origin = new URL(outputs.portal_url);
  assert.equal(origin.protocol, "https:", "Portal deve usar HTTPS");
  const html = await read(new URL("/", origin), fetchImpl, "Portal");
  const match = html.match(/<meta\s+name="portal-release"\s+content="([^"]+)"/);
  const releaseId = match?.[1] || null;
  let manifest = null, configPath = "/config.json", mode = "legacy";
  if (releaseId) {
    assert.match(releaseId, /^[0-9a-f]{12}-[0-9a-f]{12}$/, "Identificação da release inválida");
    manifest = JSON.parse(await read(new URL(`/releases/${releaseId}/manifest.json`, origin), fetchImpl, "Manifesto"));
    assert.equal(manifest.release_id, releaseId, "Manifesto não corresponde à release ativa");
    assert.match(manifest.source_sha, /^[0-9a-f]{40}$/, "Revisão da release inválida");
    assert.equal(manifest.source_sha.slice(0, 12), releaseId.slice(0, 12));
    assert.ok(["modern", "baseline"].includes(manifest.mode), "Modo da release desconhecido");
    mode = manifest.mode;
    if (mode === "modern") configPath = `/releases/${releaseId}/config.json`;
  }
  const body = await read(new URL(configPath, origin), fetchImpl, "Configuração ativa");
  if (mode === "modern") {
    const file = manifest.files?.find((entry) => entry.path === "config.json");
    assert.match(file?.sha256 || "", /^[0-9a-f]{64}$/, "Manifesto sem hash de configuração");
    assert.equal(createHash("sha256").update(body).digest("hex"), file.sha256, "Hash da configuração diverge do manifesto");
  }
  assert.deepEqual(JSON.parse(body), outputs.frontend_config, "Configuração ativa difere dos endpoints provisionados");
  return { releaseId, sourceSha: manifest?.source_sha || null, mode, configPath };
}

export async function readiness(outputs, fetchImpl = fetch, log = console.log) {
  const frontend = await verifyPublishedConfig(outputs, fetchImpl);
  const cases = [
    ["API sem autenticação", `${outputs.api_url}/me`, 401],
    ["Resumo da turma exige login", `${outputs.api_url}/cohorts/BRSA0267/class-report`, 401],
    ["Rota de convidados removida", `${outputs.api_url}/guest/cohorts/BRSA0267`, 404],
    ["Acesso direto ao S3 web", `https://${outputs.frontend_bucket}.s3.us-east-1.amazonaws.com/index.html`, 403],
    ["Acesso anônimo ao S3 de notas", `https://${outputs.imports_bucket}.s3.us-east-1.amazonaws.com/`, 403],
  ];
  // Apenas GETs sem autenticação. POSTs de lembrete/prévia ficam no roteiro sintético.
  for (const [label, url, status] of cases) {
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, status, label);
    log(`PASS: ${label} → HTTP ${response.status}`);
  }
  log(`PASS: Configuração de ${frontend.mode} em ${frontend.configPath}`);
  return { testedAt: new Date().toISOString(), frontend, backendVersion: null,
    limitation: "Disponibilidade pública não comprova QA autenticado nem a versão implantada do backend." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = JSON.parse(await readFile(process.argv[2], "utf8"));
  const outputs = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.value]));
  console.log(JSON.stringify(await readiness(outputs), null, 2));
}

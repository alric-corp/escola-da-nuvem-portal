// Verificação pública pós-deploy; não usa credenciais ou contas de aluno.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const raw = JSON.parse(await readFile(process.argv[2], "utf8"));
const outputs = Object.fromEntries(
  Object.entries(raw).map(([k, v]) => [k, v.value]),
);
const cases = [
  ["Portal HTTPS", outputs.portal_url, 200],
  ["Prévia de pendências exige login", outputs.api_url + "/cohorts/BRSA0267/pending-preview", 401, "POST"],
  ["Envio de lembrete exige login", outputs.api_url + "/cohorts/BRSA0267/send-reminder", 401, "POST"],
  ["API sem autenticação", outputs.api_url + "/me", 401],
  [
    "Resumo da turma exige login",
    outputs.api_url + "/cohorts/BRSA0267/class-report",
    401,
  ],
  [
    "Rota de convidados removida",
    outputs.api_url + "/guest/cohorts/BRSA0267",
    404,
  ],
  [
    "Acesso direto ao S3 web",
    `https://${outputs.frontend_bucket}.s3.us-east-1.amazonaws.com/index.html`,
    403,
  ],
  [
    "Acesso anônimo ao S3 de notas",
    `https://${outputs.imports_bucket}.s3.us-east-1.amazonaws.com/`,
    403,
  ],
];
for (const [label, url, status, method = "GET"] of cases) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status, label);
  console.log(`PASS: ${label} → HTTP ${response.status}`);
}
const config = await fetch(outputs.portal_url + "/config.json", {
  cache: "no-store",
}).then((r) => r.json());
assert.deepEqual(config, outputs.frontend_config);
console.log(
  "PASS: Configuração pública corresponde aos endpoints provisionados",
);

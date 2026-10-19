// Rotas da API usadas por um frontend (api.js de qualquer versão) e conferência contra o contrato OpenAPI do pipeline.
// Uso: node release-api-routes.mjs --api <api.js> --source-openapi <yaml da versão> --contract-openapi <yaml do pipeline> --out <json>
// Reutiliza o extrator e o parser de tests/contracts; não acessa a rede (fetch é bloqueado durante a captura).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { frontendRoutes } from "../../tests/contracts/sources.mjs";
import { parseContract, operations } from "../../tests/contracts/openapi.mjs";

const { values } = parseArgs({
  options: { api: { type: "string" }, "source-openapi": { type: "string" }, "contract-openapi": { type: "string" }, out: { type: "string" } },
});
for (const name of ["api", "source-openapi", "contract-openapi", "out"]) {
  if (!values[name]) throw new Error(`--${name} é obrigatório`);
}
// ui.js lê location ao ser carregado (flag de demonstração).
globalThis.location = { hostname: "portal.test", search: "" };
const routes = [...new Set((await frontendRoutes(pathToFileURL(values.api))).map((r) => r.signature))].sort();
const contract = new Set(operations(parseContract(readFileSync(values["contract-openapi"], "utf8"))).map((op) => op.signature));
const missing = routes.filter((r) => !contract.has(r));
const sourceOpenapi = readFileSync(values["source-openapi"]);
const result = { routes, openapi_sha256: createHash("sha256").update(sourceOpenapi).digest("hex"), contract_missing: missing };
writeFileSync(values.out, JSON.stringify(result, null, 2) + "\n");
console.log(`rotas da API: ${routes.length}; ausentes no contrato do pipeline: ${missing.length}`);
if (missing.length) {
  console.error(`Rotas usadas pelo frontend e ausentes no OpenAPI do pipeline: ${missing.join(", ")}`);
  process.exit(1);
}

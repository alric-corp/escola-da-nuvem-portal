// Compare complete bundled trees, including component names/references and all editorial fields.
// No route allowlist, semantic-field filtering or frozen historical baseline is used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseContract } from "./openapi.mjs";

export function equivalentContracts(before, after) {
  assert.deepStrictEqual(parseContract(after), parseContract(before), "OpenAPI contract changed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after] = process.argv.slice(2);
  assert(before && after && process.argv.length === 4, "Usage: node tests/contracts/openapi_equivalence.mjs before.yaml after.yaml");
  equivalentContracts(readFileSync(before, "utf8"), readFileSync(after, "utf8"));
  console.log("OpenAPI: árvores completas equivalentes, incluindo components e referências locais.");
}

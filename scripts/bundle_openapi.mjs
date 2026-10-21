// Redocly resolves/validates OpenAPI; this wrapper only manages local paths and output bytes.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false }, root: { type: "string" } } });
const root = resolve(values.root ?? fileURLToPath(new URL("../", import.meta.url)));
const cli = fileURLToPath(new URL("../node_modules/@redocly/cli/bin/cli.js", import.meta.url));
const offline = fileURLToPath(new URL("./openapi_offline.mjs", import.meta.url));
const source = join(root, "openapi/src/portal.yaml");
const config = join(root, "openapi/redocly.yaml");
const target = join(root, "openapi/portal.yaml");
const temporary = mkdtempSync(join(tmpdir(), "portal-openapi-bundle-"));
const generated = join(temporary, "portal.yaml");
const header = "# Gerado por npm run openapi:bundle. Edite openapi/src/; não edite este arquivo.\n";

function redocly(args) {
  const result = spawnSync(process.execPath, ["--import", offline, cli, ...args, "--config", config, "--lint-config", "error"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, REDOCLY_TELEMETRY: "off", REDOCLY_SUPPRESS_UPDATE_NOTICE: "true" },
  });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message ?? `${result.stdout}${result.stderr}`);
}

try {
  redocly(["lint", source]);
  redocly(["bundle", source, "--output", generated, "--ext", "yaml", "--component-renaming-conflicts-severity", "error"]);
  const bytes = Buffer.from(header + readFileSync(generated, "utf8").replaceAll("\r\n", "\n"), "utf8");
  if (values.check) {
    let existing;
    try { existing = readFileSync(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!existing?.equals(bytes))
      throw new Error("openapi/portal.yaml ausente ou desatualizado. Execute npm run openapi:bundle e versione o resultado.");
    console.log("OpenAPI válido: bundle versionado corresponde às fontes.");
  } else {
    writeFileSync(target, bytes);
    console.log("OpenAPI válido: openapi/portal.yaml gerado a partir de openapi/src/.");
  }
} catch (error) {
  console.error(`Falha no OpenAPI: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

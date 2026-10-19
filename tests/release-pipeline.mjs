// Pipeline de deploy do frontend: invariantes estáticas do workflow, das composite actions e dos scripts de release,
// e a D1 (config.json relativa ao módulo). Lê os arquivos; não executa o workflow nem acessa rede ou AWS.
// O comportamento dos scripts é coberto em tests/integration/test_frontend_release_*.py e no Chromium em
// tests/release-cache-browser.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import bundle from "playwright-core/lib/utilsBundle";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const yaml = (file) => {
  const document = bundle.yaml.parseDocument(read(file), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${file}: ${document.errors.map((e) => e.message).join("; ")}`);
  return document.toJS({ maxAliasCount: 0 });
};
const WORKFLOW = ".github/workflows/deploy-frontend.yml";
const ACTIONS = ["build-frontend", "validate-release", "publish-release", "activate-release"];
const workflow = yaml(WORKFLOW);
const actions = Object.fromEntries(ACTIONS.map((name) => [name, yaml(`.github/actions/${name}/action.yml`)]));
const jobs = workflow.jobs;
const steps = (job) => jobs[job].steps;
const usesOf = (step) => (step.uses || "").split("@")[0];
const AWS_ACTION = "aws-actions/configure-aws-credentials";
const ENV_GATE = "python3 -B .github/scripts/check-deploy-gate.py --stage environment";
// Argumentos de cada chamada `name(...)`, com parênteses balanceados (o texto Python tem chamadas aninhadas).
function callArgs(text, name) {
  const found = [];
  for (let start = text.indexOf(name); start >= 0; start = text.indexOf(name, start + 1)) {
    let depth = 1, i = start + name.length;
    for (; i < text.length && depth; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    found.push(text.slice(start + name.length, i - 1));
  }
  return found;
}
const SCRIPTS = readdirSync(new URL("../.github/scripts/", import.meta.url)).map((name) => `.github/scripts/${name}`);

test("D1: app.js carrega config.json relativo ao módulo, sem cache e sem ?v=", () => {
  const app = read("frontend/app.js");
  assert.ok(app.includes('fetch(new URL("./config.json", import.meta.url), { cache: "no-store" })'), "D1: config.json relativa ao módulo");
  assert.ok(!/fetch\(\s*["']\.\/config\.json["']/.test(app), "config relativa ao documento quebra a release (P2)");
  for (const file of ["frontend/index.html", "frontend/app.js"]) assert.doesNotMatch(read(file), /\?v=/, `${file}: ?v= não resolve o P2`);
});

test("workflow: só workflow_dispatch, padrão prepare e nenhum input escolhe commit", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.operation.options, ["prepare", "verify", "publish", "activate", "rollback"]);
  assert.equal(inputs.operation.default, "prepare");
  assert.deepEqual(inputs.source.options, ["main", "baseline"]);
  assert.equal(inputs.source.default, "main");
  assert.equal(inputs.expected_main_sha.required, true);
  assert.equal(inputs.s3_probe.default, false);
  assert.equal(inputs.allow_config_change.default, false);
  assert.deepEqual(Object.keys(inputs).sort(), ["allow_config_change", "confirm_release_id", "expected_active_release",
    "expected_main_sha", "operation", "release_id", "s3_probe", "source"]);
  // expected_main_sha só é comparado no gate; nenhum checkout recebe ref, repository ou SHA.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps.filter((s) => usesOf(s) === "actions/checkout")) {
      assert.deepEqual(Object.keys(step.with).filter((k) => !["persist-credentials", "fetch-depth"].includes(k)), [], `${name}: checkout com ${Object.keys(step.with)}`);
      assert.equal(step.with["persist-credentials"], false, `${name}: checkout guardaria o token`);
    }
  }
  const text = read(WORKFLOW);
  // Cada uso alimenta só uma comparação (gates e guarda antes da escrita), nunca um checkout ou ref.
  const uses = text.split("\n").filter((line) => line.includes("inputs.expected_main_sha"));
  assert.ok(uses.length >= 5, uses.join("\n"));
  for (const line of uses) assert.match(line, /^\s+(EXPECTED_MAIN_SHA|expected-main-sha): \$\{\{ inputs\.expected_main_sha \}\}$/, line);
});

test("workflow: permissões mínimas, id-token só nos jobs com OIDC e concorrência sem cancelamento", () => {
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "frontend-production", "cancel-in-progress": false });
  for (const [name, job] of Object.entries(jobs)) {
    const oidc = job.steps.some((s) => usesOf(s) === AWS_ACTION);
    const expected = name === "gate" ? { contents: "read", actions: "read" } : oidc ? { contents: "read", "id-token": "write" } : { contents: "read" };
    assert.deepEqual(job.permissions, expected, name);
  }
  assert.deepEqual(Object.keys(jobs).filter((n) => steps(n).some((s) => usesOf(s) === AWS_ACTION)).sort(), ["activate", "publish", "verify"]);
});

test("workflow: cada operação roda só os seus jobs, sempre depois do gate e no environment production", () => {
  const ops = { prepare: ["build"], verify: ["verify"], publish: ["build", "publish"], activate: ["activate"], rollback: ["activate"] };
  const runs = (job, operation) => {
    const condition = jobs[job].if;
    if (!condition) return true;
    const alternatives = condition.split("||").map((part) => part.trim().match(/^inputs\.operation == '(\w+)'$/));
    assert.ok(alternatives.every(Boolean), `${job}: condição fora do padrão: ${condition}`);
    return alternatives.some((m) => m[1] === operation);
  };
  for (const [operation, expected] of Object.entries(ops)) {
    assert.deepEqual(Object.keys(jobs).filter((job) => job !== "gate" && runs(job, operation)), expected, operation);
  }
  assert.equal(jobs.gate.environment, undefined, "o gate não tem environment (não consome aprovação nem variables)");
  assert.equal(jobs.gate.if, undefined);
  for (const [name, job] of Object.entries(jobs)) {
    if (name === "gate") continue;
    assert.ok([].concat(job.needs).includes("gate"), `${name} sem needs: gate`);
    assert.equal(job.environment, "production", name);
    assert.equal(job["runs-on"], "ubuntu-24.04", name);
    assert.ok(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 30, name);
  }
  assert.deepEqual([].concat(jobs.publish.needs), ["gate", "build"]);
});

test("workflow: o gate do environment roda antes de qualquer credencial, artefato ou dependência", () => {
  for (const [name, job] of Object.entries(jobs)) {
    if (name === "gate") {
      assert.match(job.steps.at(-1).run, /check-deploy-gate\.py --stage repository$/);
      continue;
    }
    const index = job.steps.findIndex((s) => s.run === ENV_GATE);
    assert.equal(index, 1, `${name}: o gate do environment precisa vir logo depois do checkout`);
    assert.equal(usesOf(job.steps[0]), "actions/checkout");
    const env = job.steps[index].env;
    assert.deepEqual(Object.keys(env).sort(), ["AWS_ACCESS_KEY_ID", "AWS_REGION", "AWS_ROLE_ARN", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
      "CLOUDFRONT_DISTRIBUTION_ID", "EXPECTED_MAIN_SHA", "FRONTEND_BUCKET", "FRONTEND_CONFIG_JSON", "GH_TOKEN", "OPERATION", "PUBLIC_ORIGIN",
      "SOURCE"]);
    // Verificação B: o HEAD da main é relido depois da aprovação, com o GITHUB_TOKEN do job (contents: read).
    assert.equal(env.GH_TOKEN, "${{ github.token }}", name);
    assert.equal(env.EXPECTED_MAIN_SHA, "${{ inputs.expected_main_sha }}", name);
    for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) assert.equal(env[key], `\${{ secrets.${key} }}`);
    const oidc = job.steps.findIndex((s) => usesOf(s) === AWS_ACTION);
    if (oidc >= 0) {
      assert.ok(oidc > index, name);
      const w = job.steps[oidc].with;
      assert.deepEqual(Object.keys(w).sort(), ["aws-region", "mask-aws-account-id", "role-duration-seconds", "role-session-name", "role-to-assume"]);
      assert.equal(w["role-to-assume"], "${{ vars.AWS_ROLE_ARN }}");
      assert.equal(w["mask-aws-account-id"], true);
      assert.ok(w["role-duration-seconds"] <= 3600);
      assert.equal(w["role-session-name"], "frontend-${{ github.run_id }}-${{ github.run_attempt }}");
    }
  }
  // Os segredos só aparecem para provar que não existem chaves estáticas.
  const secrets = [...read(WORKFLOW).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]);
  assert.equal(secrets.length, 3 * (Object.keys(jobs).length - 1));
});

test("workflow e composites: actions externas fixadas por SHA e nenhuma expressão dentro de run", () => {
  const files = [WORKFLOW, ...ACTIONS.map((name) => `.github/actions/${name}/action.yml`)];
  for (const file of files) {
    for (const [, ref, comment] of read(file).matchAll(/uses:\s*([^\s#]+)(\s*#\s*\S+)?/g)) {
      if (ref.startsWith("./")) {
        assert.ok(ACTIONS.includes(ref.replace("./.github/actions/", "")), `${file}: action local desconhecida ${ref}`);
        continue;
      }
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${ref} não está fixada por SHA`);
      assert.match(comment || "", /# v\d+\.\d+\.\d+$/, `${file}: ${ref} sem a versão em comentário`);
    }
  }
  const runSteps = [...Object.values(jobs).flatMap((job) => job.steps), ...Object.values(actions).flatMap((a) => a.runs.steps)].filter((s) => s.run);
  assert.ok(runSteps.length >= 10);
  for (const step of runSteps) assert.doesNotMatch(step.run, /\$\{\{/, `expressão interpolada no shell: ${step.name || step.run}`);
  for (const [name, action] of Object.entries(actions)) {
    assert.equal(action.runs.using, "composite", name);
    for (const step of action.runs.steps.filter((s) => s.run)) assert.equal(step.shell, "bash", `${name}: ${step.name}`);
  }
});

test("HEAD da main revalidado no gate, depois da aprovação e imediatamente antes da primeira escrita AWS", () => {
  // Verificação A: o gate tem token e o SHA confirmado; B: conferida no teste do gate do environment acima.
  assert.equal(steps("gate").at(-1).env.EXPECTED_MAIN_SHA, "${{ inputs.expected_main_sha }}");
  // Verificação C: as composites que escrevem recebem o SHA confirmado e o token do job, só por env.
  for (const name of ["publish-release", "activate-release"]) {
    const action = actions[name];
    assert.equal(action.inputs["expected-main-sha"].required, true, name);
    const run = action.runs.steps.at(-1);
    assert.equal(run.env.GH_TOKEN, "${{ github.token }}", name);
    assert.equal(run.env.EXPECTED_MAIN_SHA, "${{ inputs.expected-main-sha }}", name);
  }
  for (const [job, uses] of [["publish", "./.github/actions/publish-release"], ["activate", "./.github/actions/activate-release"]]) {
    assert.equal(steps(job).find((s) => s.uses === uses).with["expected-main-sha"], "${{ inputs.expected_main_sha }}", job);
  }
  const probe = steps("verify").at(-1);
  assert.match(probe.run, /verify-access\.py/);
  assert.equal(probe.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(probe.env.EXPECTED_MAIN_SHA, "${{ inputs.expected_main_sha }}");
  // Os scripts chamam a guarda antes de escrever: publicação, ativação/rollback e sonda.
  assert.match(read(".github/scripts/publish-release.py"), /publish_release\([^)]*before_write=main_head_guard\(\)\)/);
  assert.match(read(".github/scripts/release_cli.py"), /before_write=main_head_guard\(\)\)/);
  const access = read(".github/scripts/verify-access.py");
  assert.ok(access.indexOf("main_head_guard()()") > 0 && access.indexOf("main_head_guard()()") < access.indexOf("results = probe("));
  // Nenhuma permissão de escrita para o GITHUB_TOKEN: a leitura da referência usa contents: read.
  for (const job of Object.values(jobs)) assert.ok(!Object.entries(job.permissions).some(([k, v]) => v === "write" && k !== "id-token"));
});

test("workflow: variables lidas são as do contrato e o kill switch fica no repositório", () => {
  const vars = [...new Set([...read(WORKFLOW).matchAll(/vars\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(vars, ["AWS_REGION", "AWS_ROLE_ARN", "CLOUDFRONT_DISTRIBUTION_ID", "FRONTEND_BUCKET", "FRONTEND_CONFIG_JSON",
    "FRONTEND_DEPLOY_ENABLED", "PUBLIC_ORIGIN"]);
  assert.equal(steps("gate").at(-1).env.DEPLOY_ENABLED, "${{ vars.FRONTEND_DEPLOY_ENABLED }}");
  assert.equal(steps("gate").at(-1).env.GH_TOKEN, "${{ github.token }}");
});

test("publicação e ativação: build sem credencial, pacote revalidado e registro da ativação preservado", () => {
  assert.ok(!steps("build").some((s) => usesOf(s) === AWS_ACTION));
  assert.deepEqual(steps("build").map((s) => s.uses || s.run).slice(2), ["./.github/actions/build-frontend", "./.github/actions/validate-release",
    "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9"]);
  const publish = steps("publish");
  const order = (predicate) => publish.findIndex(predicate);
  const download = order((s) => usesOf(s) === "actions/download-artifact");
  const revalidate = order((s) => /validate-release\.py/.test(s.run || ""));
  const oidc = order((s) => usesOf(s) === AWS_ACTION);
  const send = order((s) => s.uses === "./.github/actions/publish-release");
  assert.ok(download < revalidate && revalidate < oidc && oidc < send, "publish: baixar, revalidar, credencial, enviar");
  assert.match(publish[revalidate].run, /BUILT_RELEASE_ID/);
  assert.equal(publish[download].with.name, "release-${{ needs.build.outputs.release-id }}");
  const upload = steps("activate").at(-1);
  assert.equal(usesOf(upload), "actions/upload-artifact");
  assert.equal(upload.if, "always()");
  assert.equal(steps("activate").find((s) => s.uses === "./.github/actions/activate-release").with.mode, "${{ inputs.operation }}");
  assert.match(actions["activate-release"].runs.steps.at(-1).run, /activate\) script=activate-release\.py ;;\n\s*rollback\) script=rollback-release\.py ;;\n\s*\*\)/);
});

test("scripts de release: S3 só com escrita condicional e nenhuma exclusão ou sync", () => {
  const core = read(".github/scripts/frontend_release.py");
  const puts = callArgs(core, "s3.put_object(");
  assert.equal(puts.length, 2, "frontend_release.py: um PutObject de release e um do index.html");
  assert.ok(puts.every((args) => /IfNoneMatch="\*"/.test(args) || /Key="index\.html"[\s\S]*IfMatch=active\["etag"\]/.test(args)), puts.join("\n"));
  for (const file of [...SCRIPTS, WORKFLOW, ...ACTIONS.map((name) => `.github/actions/${name}/action.yml`)]) {
    const text = read(file);
    assert.doesNotMatch(text, /delete_object|DeleteObject|s3 sync|--delete\b|s3 rm\b|put_bucket|copy_object/, file);
    assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}|\b\d{12}\b(?!\})|aws_secret_access_key\s*=/, `${file}: valor sensível`);
  }
  // A sonda nunca grava o index.html sem condição: todo PutObject dele leva If-None-Match ou If-Match.
  const probe = read(".github/scripts/verify-access.py");
  for (const [line] of probe.matchAll(/attempt\(Key="index\.html".*$/gm)) assert.match(line, /IfNoneMatch="\*"|IfMatch=/, line);
  assert.match(probe, /nunca é impresso/);
  assert.doesNotMatch(probe, /print\([^)]*(jwt|token|value)\b/i);
});

test("baseline fixada: C7.3 (1daab31), 30 arquivos, config da raiz e piso de rollback", () => {
  const baseline = JSON.parse(read(".github/release/baseline.json"));
  assert.equal(baseline.schema, "escola-da-nuvem/frontend-baseline@1");
  assert.equal(baseline.source_sha, "1daab314413e675cec9cf1d8b3be2aa8b5e1dc25");
  assert.equal(baseline.rollback_floor_sha, baseline.source_sha);
  assert.equal(baseline.config_mode, "document-root");
  assert.equal(Object.keys(baseline.files).length, 30);
  for (const [file, meta] of Object.entries(baseline.files)) {
    assert.match(meta.sha256, /^[0-9a-f]{64}$/, file);
    assert.match(meta.md5, /^[0-9a-f]{32}$/, file);
    assert.ok(Number.isInteger(meta.size) && meta.size > 0, file);
  }
});

test("CI roda as suítes da pipeline: histórico completo, mutações da release e bootstrap", () => {
  const ci = yaml(".github/workflows/ci.yml");
  for (const job of ["python", "node"]) {
    const checkout = ci.jobs[job].steps.find((s) => usesOf(s) === "actions/checkout");
    assert.equal(checkout.with?.["fetch-depth"], 0, `${job}: a baseline 1daab31 precisa do histórico`);
  }
  // As mutações da release precisam de Moto e Chromium: job node (Ubuntu 24.04), depois do setup-python.
  const node = ci.jobs.node.steps;
  const mutations = node.findIndex((s) => s.run === "python tests/contracts/release_mutations.py");
  assert.ok(mutations > node.findIndex((s) => usesOf(s) === "actions/setup-python"));
  assert.ok(node.findIndex((s) => usesOf(s) === "actions/setup-python") > node.findIndex((s) => /lifecycle_mutations/.test(s.run || "")));
  assert.ok(mutations > node.findIndex((s) => /playwright install/.test(s.run || "")));
  const bootstrap = ci.jobs["cicd-bootstrap"];
  assert.equal(bootstrap.defaults.run["working-directory"], "infra/cicd-bootstrap");
  assert.deepEqual(bootstrap.steps.filter((s) => s.run).map((s) => s.run),
    ["terraform fmt -check -recursive", "terraform init -backend=false", "terraform validate", "terraform test",
      "python3 ../../tests/contracts/bootstrap_mutations.py"]);
});

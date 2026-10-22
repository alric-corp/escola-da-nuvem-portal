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
const ACTIONS = ["build-frontend", "validate-release", "setup-deploy-python", "publish-release", "activate-release"];
const workflow = yaml(WORKFLOW);
const actions = Object.fromEntries(ACTIONS.map((name) => [name, yaml(`.github/actions/${name}/action.yml`)]));
const jobs = workflow.jobs;
const steps = (job) => jobs[job].steps;
const usesOf = (step) => (step.uses || "").split("@")[0];
const AWS_ACTION = "aws-actions/configure-aws-credentials";
const ENV_GATE = "python3 -B .github/scripts/check-deploy-gate.py --stage environment";
// Depois do gate, operação, origem e SHA esperado vêm só dos outputs do gate (no automático não há inputs).
const GATE_OUT = (key) => `\${{ needs.gate.outputs.${key} }}`;
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
const SCRIPTS = readdirSync(new URL("../.github/scripts/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => `.github/scripts/${entry.name}`);

test("governança: checks obrigatórios cobrem todo PR sem credenciais nem aprovação humana", () => {
  const ci = yaml(".github/workflows/ci.yml");
  const ruleset = JSON.parse(read(".github/rulesets/main.json"));
  assert.deepEqual(ci.on, { push: { branches: ["main"] }, pull_request: null });
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.equal(ruleset.enforcement, "active");
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.deepEqual(ruleset.conditions, { ref_name: { include: ["refs/heads/main"], exclude: [] } });
  assert.deepEqual(ruleset.rules.map((r) => r.type).sort(), ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
  const pr = ruleset.rules.find((r) => r.type === "pull_request").parameters;
  assert.deepEqual(pr, {
    required_approving_review_count: 0, dismiss_stale_reviews_on_push: false,
    require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false,
  });
  const checks = ruleset.rules.find((r) => r.type === "required_status_checks").parameters;
  assert.equal(checks.strict_required_status_checks_policy, false);
  assert.equal(checks.do_not_enforce_on_create, false);
  assert.equal(checks.required_status_checks.length, 4);
  assert.deepEqual(checks.required_status_checks.map((c) => c.context).sort(), Object.values(ci.jobs).map((j) => j.name).sort());
  for (const check of checks.required_status_checks) assert.equal(check.integration_id, 15368);
  for (const job of Object.values(ci.jobs)) {
    for (const key of ["if", "needs", "strategy", "continue-on-error", "environment", "permissions"])
      assert.equal(job[key], undefined, `${job.name}: ${key} pode omitir um check ou elevar privilégios no PR`);
    for (const step of job.steps) assert.equal(step["continue-on-error"], undefined, job.name);
  }
  assert.doesNotMatch(read(".github/workflows/ci.yml"), /secrets\.|id-token|configure-aws-credentials|pull_request_target/);
});

test("CI: Chromium tem instalação separada e limitada antes das suítes, sem ocultar falhas", () => {
  const ci = yaml(".github/workflows/ci.yml");
  assert.deepEqual(Object.fromEntries(Object.entries(ci.jobs).map(([id, job]) => [id, job.name])), {
    python: "Backend (Python + Moto)",
    node: "Frontend (Node + Playwright)",
    terraform: "Terraform (fmt, validate, test)",
    "cicd-bootstrap": "Bootstrap do deploy do frontend (fmt, validate, test)",
  });
  const frontend = ci.jobs.node;
  assert.equal(frontend["runs-on"], "ubuntu-24.04");
  assert.equal(frontend["timeout-minutes"], 30);
  assert.equal(frontend.steps.find((step) => usesOf(step) === "actions/setup-node").with["node-version"], "22");
  const installs = frontend.steps.filter((step) => /npx playwright install/.test(step.run || ""));
  assert.deepEqual(installs, [
    { name: "Instala dependências do sistema para Chromium", "timeout-minutes": 5, run: "npx playwright install-deps chromium" },
    { name: "Baixa o Chromium do Playwright", "timeout-minutes": 5, run: "npx playwright install chromium" },
  ]);
  const index = (step) => frontend.steps.indexOf(step);
  const npm = frontend.steps.findIndex((step) => step.run === "npm ci");
  const browser = frontend.steps.findIndex((step) => step.run === "npm run test:browser");
  assert.ok(npm >= 0 && npm < index(installs[0]));
  assert.ok(index(installs[0]) + 1 === index(installs[1]) && index(installs[1]) < browser);
  // Os comandos exatos acima não têm || true; sem condições/dispensa, o GitHub só avança após sucesso.
  for (const step of frontend.steps.slice(index(installs[0]))) {
    assert.equal(step.if, undefined, step.name || step.run || step.uses);
    assert.equal(step["continue-on-error"], undefined, step.name || step.run || step.uses);
  }
  assert.equal(frontend["continue-on-error"], undefined);
  assert.equal(frontend.strategy, undefined, "a entrega não introduz sharding ou matriz");
  assert.equal(frontend.steps.filter((step) => step.run === "npm test").length, 1);
  assert.equal(frontend.steps.filter((step) => step.run === "npm run test:browser").length, 1);
  for (const script of ["stale_mutations.py", "lifecycle_mutations.py", "release_mutations.py"])
    assert.ok(frontend.steps.some((step) => (step.run || "").endsWith(`tests/contracts/${script}`)), script);
});

test("CI: backend e Moto usam Python 3.13; o runtime isolado de deploy continua separado", () => {
  const ci = yaml(".github/workflows/ci.yml");
  const backend = ci.jobs.python.steps;
  const interpreter = backend.findIndex((step) => usesOf(step) === "actions/setup-python");
  assert.equal(backend[interpreter].with["python-version"], "3.13");
  const version = backend.findIndex((step) => step.run === "python --version");
  const install = backend.findIndex((step) => step.run === "python -m pip install -r requirements-dev.txt");
  assert.ok(interpreter < version && version < install);
  assert.equal(backend.filter((step) => usesOf(step) === "actions/setup-python").length, 1);
  const suites = [
    "python -m unittest discover -s backend", "python -m unittest discover -s tests/integration",
    "python tests/contracts/claim_mutations.py", "python tests/contracts/manual_recovery_mutations.py",
  ];
  const setupDeploy = backend.findIndex((step) => step.uses === "./.github/actions/setup-deploy-python");
  for (const command of suites) {
    const index = backend.findIndex((step) => step.run === command);
    assert.ok(install < index && index < setupDeploy, command);
  }
  assert.equal(backend[install].if, undefined);
  assert.equal(backend[install]["continue-on-error"], undefined);
  assert.equal(ci.jobs.python.strategy, undefined);
  assert.equal(actions["setup-deploy-python"].runs.steps[0].with["python-version"], "3.12");
  assert.equal(ci.jobs.node.steps.find((step) => usesOf(step) === "actions/setup-python").with["python-version"], "3.12",
    "o intérprete das mutações de release pertence a outro contexto");
  // As garantias de venv, lock com hashes e instalação anterior ao OIDC são conferidas por P-SC1 abaixo.
});

test("D1: app.js carrega config.json relativo ao módulo, sem cache e sem ?v=", () => {
  const app = read("frontend/app.js");
  assert.ok(app.includes('fetch(new URL("./config.json", import.meta.url), { cache: "no-store" })'), "D1: config.json relativa ao módulo");
  assert.ok(!/fetch\(\s*["']\.\/config\.json["']/.test(app), "config relativa ao documento quebra a release (P2)");
  for (const file of ["frontend/index.html", "frontend/app.js"]) assert.doesNotMatch(read(file), /\?v=/, `${file}: ?v= não resolve o P2`);
});

test("workflow: gatilhos automático (CI verde na main) e manual, padrão prepare e nenhum input escolhe commit", () => {
  // Automático: o CI concluído na main (todo push, inclusive merge de PR), sem filtro de caminhos; nada de push direto,
  // pull_request ou workflow_run de outras branches. O gate exige o CI verde de push neste repositório.
  assert.deepEqual(Object.keys(workflow.on), ["workflow_run", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_run, { workflows: ["CI"], types: ["completed"], branches: ["main"] });
  const ci = yaml(".github/workflows/ci.yml");
  assert.equal(ci.name, "CI", "o workflow_run segue o CI pelo nome");
  assert.deepEqual(ci.on.push, { branches: ["main"] }, "o CI roda em todo push na main, sem filtro de caminhos");
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.operation.options, ["prepare", "verify", "publish", "activate", "rollback", "deploy"]);
  assert.equal(inputs.operation.default, "prepare");
  assert.deepEqual(inputs.source.options, ["main", "baseline"]);
  assert.equal(inputs.source.default, "main");
  assert.equal(inputs.expected_main_sha.required, true);
  assert.equal(inputs.s3_probe.default, false);
  assert.equal(inputs.allow_config_change.default, false);
  assert.deepEqual(Object.keys(inputs).sort(), ["allow_config_change", "approved_manifest_sha256", "approved_release_id", "confirm_release_id", "expected_active_release",
    "expected_main_sha", "operation", "release_id", "s3_probe", "source"]);
  // expected_main_sha só é comparado no gate; nenhum checkout recebe ref, repository ou SHA.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps.filter((s) => usesOf(s) === "actions/checkout")) {
      assert.deepEqual(Object.keys(step.with).filter((k) => !["persist-credentials", "fetch-depth"].includes(k)), [], `${name}: checkout com ${Object.keys(step.with)}`);
      assert.equal(step.with["persist-credentials"], false, `${name}: checkout guardaria o token`);
    }
  }
  const text = read(WORKFLOW);
  // O input só entra no gate; depois dele, o SHA esperado é o output do gate. Cada uso alimenta só uma comparação
  // (gates e guarda antes da escrita), nunca um checkout ou ref.
  const input = text.split("\n").filter((line) => line.includes("inputs.expected_main_sha"));
  assert.deepEqual(input.map((line) => line.trim()), ["EXPECTED_MAIN_SHA: ${{ inputs.expected_main_sha }}"]);
  const uses = text.split("\n").filter((line) => line.includes("expected-main-sha }}"));
  assert.ok(uses.length >= 7, uses.join("\n"));
  for (const line of uses) {
    assert.match(line, /^\s+(EXPECTED_MAIN_SHA|expected-main-sha): \$\{\{ (needs|steps)\.gate\.outputs\.expected-main-sha \}\}$/, line);
  }
  assert.deepEqual(jobs.gate.outputs, { operation: "${{ steps.gate.outputs.operation }}", source: "${{ steps.gate.outputs.source }}",
    "expected-main-sha": "${{ steps.gate.outputs.expected-main-sha }}",
    "approved-release-id": "${{ steps.gate.outputs.approved-release-id }}",
    "approved-manifest-sha256": "${{ steps.gate.outputs.approved-manifest-sha256 }}" });
  assert.equal(steps("gate").at(-1).id, "gate");
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
  const ops = { prepare: ["build"], verify: ["verify"], publish: ["build", "publish"], activate: ["activate"], rollback: ["activate"],
    deploy: ["build", "publish"] };
  const runs = (job, operation) => {
    const condition = jobs[job].if;
    if (!condition) return true;
    const alternatives = condition.split("||").map((part) => part.trim().match(/^needs\.gate\.outputs\.operation == '(\w+)'$/));
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
    assert.equal(env.EXPECTED_MAIN_SHA, GATE_OUT("expected-main-sha"), name);
    assert.equal(env.OPERATION, GATE_OUT("operation"), name);
    assert.equal(env.SOURCE, GATE_OUT("source"), name);
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

test("P-SC1: dependências com hashes e venv novo antes do OIDC, sem instalação após credenciais", () => {
  const setup = "./.github/actions/setup-deploy-python";
  const expand = (list) => list.flatMap((step) => step.uses?.startsWith("./.github/actions/")
    ? expand(actions[step.uses.replace("./.github/actions/", "")].runs.steps) : [step]);
  for (const name of ["publish", "verify", "activate"]) {
    const list = steps(name);
    const prepare = list.findIndex((s) => s.uses === setup);
    const oidc = list.findIndex((s) => usesOf(s) === AWS_ACTION);
    assert.equal(list.filter((s) => s.uses === setup).length, 1, name);
    assert.ok(prepare > list.findIndex((s) => s.run === ENV_GATE) && prepare < oidc, name);
    assert.equal(list[prepare].if, undefined, `${name}: instalação não pode ser opcional`);
    assert.equal(list[prepare]["continue-on-error"], undefined, `${name}: erro de instalação deve impedir OIDC`);
    const flattened = expand(list);
    const authenticated = flattened.findIndex((s) => usesOf(s) === AWS_ACTION);
    for (const step of flattened.slice(authenticated + 1)) {
      assert.notEqual(usesOf(step), "actions/setup-python", `${name}: troca de intérprete depois do OIDC`);
      assert.doesNotMatch(step.run || "", /\bpip\b|\b(?:npm|uv)\s+(?:ci|install|sync)\b/, `${name}: instalação depois do OIDC`);
    }
    const claims = list.findIndex((s) => /verify-access\.py --claims/.test(s.run || ""));
    if (claims >= 0) assert.ok(prepare < claims, "instalação deve preceder a primeira requisição de token OIDC");
  }
  const install = actions["setup-deploy-python"].runs.steps.at(-1);
  assert.equal(install.if, undefined);
  assert.equal(install["continue-on-error"], undefined);
  assert.match(install.run, /set -euo pipefail/);
  assert.match(install.run, /mktemp -d/);
  assert.match(install.run, /python3 -m venv "\$deploy_venv"/);
  assert.doesNotMatch(install.run, /--system-site-packages|--no-require-hashes/);
  assert.match(install.run, /"\$deploy_venv\/bin\/python" -m pip --isolated install/);
  for (const flag of ["--no-cache-dir", "--require-hashes", "--only-binary=:all:", "-r .github/requirements-deploy.txt"])
    assert.ok(install.run.includes(flag), flag);
  const lock = read(".github/requirements-deploy.txt").split("\n").filter((line) => line && !line.startsWith("#"));
  assert.equal(lock.length, 7);
  for (const line of lock) assert.match(line, /^[a-z0-9-]+==[\d.]+(?:post\d+)? --hash=sha256:[a-f0-9]{64}$/);
  const boto = lock.find((line) => line.startsWith("boto3==")).split(" ")[0];
  assert.ok(read("requirements-dev.txt").split("\n").includes(boto));
  const ci = yaml(".github/workflows/ci.yml");
  const backend = ci.jobs.python.steps;
  assert.equal(backend.at(-2).uses, setup, "CI instala o mesmo lock real, sem credenciais, após as suítes Moto");
  assert.match(backend.at(-1).run, /import boto3, botocore, s3transfer/);
  assert.deepEqual(ci.permissions, { contents: "read" });
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
  for (const [job, uses] of [["publish", "./.github/actions/publish-release"], ["publish", "./.github/actions/activate-release"],
    ["activate", "./.github/actions/activate-release"]]) {
    assert.equal(steps(job).find((s) => s.uses === uses).with["expected-main-sha"], GATE_OUT("expected-main-sha"), `${job} ${uses}`);
  }
  const probe = steps("verify").at(-1);
  assert.match(probe.run, /verify-access\.py/);
  assert.equal(probe.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(probe.env.EXPECTED_MAIN_SHA, GATE_OUT("expected-main-sha"));
  // Os scripts chamam a guarda antes de escrever: publicação, ativação/rollback e sonda.
  assert.match(read(".github/scripts/publish-release.py"), /publish_release\([^)]*before_write=main_head_guard\(\), approve=approve\)/);
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

test("publicação e ativação: build sem credencial, pacote revalidado, deploy ativa só depois de publicar e registro preservado", () => {
  assert.ok(!steps("build").some((s) => usesOf(s) === AWS_ACTION));
  assert.deepEqual(steps("build").map((s) => s.uses || s.run).slice(2), ["./.github/actions/build-frontend", "./.github/actions/validate-release",
    'python3 -B .github/scripts/check-publication-approval.py --release-dir "$RELEASE_DIR"',
    "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9"]);
  const publish = steps("publish");
  const order = (predicate) => publish.findIndex(predicate);
  const download = order((s) => usesOf(s) === "actions/download-artifact");
  const revalidate = order((s) => /validate-release\.py/.test(s.run || ""));
  const oidc = order((s) => usesOf(s) === AWS_ACTION);
  const send = order((s) => s.uses === "./.github/actions/publish-release");
  const deploy = order((s) => s.uses === "./.github/actions/activate-release");
  assert.ok(download < revalidate && revalidate < oidc && oidc < send && send < deploy, "publish: baixar, revalidar, credencial, enviar, ativar");
  assert.match(publish[revalidate].run, /BUILT_RELEASE_ID/);
  assert.equal(publish[download].with.name, "release-${{ needs.build.outputs.release-id }}");
  // Só o deploy ativa no job publish: a release recém-publicada, para frente (sem release ativa esperada nem confirmação).
  assert.equal(publish[deploy].if, "needs.gate.outputs.operation == 'deploy'");
  assert.deepEqual(publish[deploy].with, { "expected-main-sha": GATE_OUT("expected-main-sha"), mode: "activate",
    "release-id": "${{ needs.build.outputs.release-id }}", bucket: "${{ vars.FRONTEND_BUCKET }}",
    "distribution-id": "${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}", region: "${{ vars.AWS_REGION }}", "public-origin": "${{ vars.PUBLIC_ORIGIN }}",
    "record-out": "${{ runner.temp }}/activation-record.json" });
  assert.equal(steps("publish")[0].with["fetch-depth"], 0, "a ativação do deploy confere a ancestralidade na main");
  assert.equal(publish.at(-1).if, "always() && needs.gate.outputs.operation == 'deploy'");
  assert.equal(usesOf(publish.at(-1)), "actions/upload-artifact");
  const upload = steps("activate").at(-1);
  assert.equal(usesOf(upload), "actions/upload-artifact");
  assert.equal(upload.if, "always()");
  assert.equal(steps("activate").find((s) => s.uses === "./.github/actions/activate-release").with.mode, GATE_OUT("operation"));
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

test("aprovação externa: gate, build e pacote recebido vinculados antes do OIDC e da escrita", () => {
  const keys = { APPROVED_RELEASE_ID: "approved_release_id", APPROVED_MANIFEST_SHA256: "approved_manifest_sha256" };
  for (const [key, input] of Object.entries(keys)) {
    assert.equal(workflow.on.workflow_dispatch.inputs[input].required, false);
    assert.equal(workflow.on.workflow_dispatch.inputs[input].type, "string");
    assert.equal(steps("gate").at(-1).env[key], `\${{ inputs.${input} }}`);
    for (const job of ["build", "publish"]) assert.equal(jobs[job].env[key], GATE_OUT(input.replaceAll("_", "-")));
  }
  for (const name of ["build", "publish"]) {
    const check = steps(name).findIndex(s => /check-publication-approval\.py/.test(s.run || ""));
    assert.ok(check > 1, name);
    assert.equal(steps(name)[check].if, undefined);
    assert.equal(steps(name)[check]["continue-on-error"], undefined);
    assert.equal(jobs[name].env.OPERATION, GATE_OUT("operation"));
    assert.equal(jobs[name].env.SOURCE, GATE_OUT("source"));
    assert.equal(jobs[name].env.EXPECTED_MAIN_SHA, GATE_OUT("expected-main-sha"));
    assert.equal(steps(name)[check].env.BUILT_RELEASE_ID, name === "build"
      ? "${{ steps.build.outputs.release-id }}" : "${{ needs.build.outputs.release-id }}");
    if (name === "publish") assert.ok(check < steps(name).findIndex(s => usesOf(s) === AWS_ACTION));
    else assert.ok(check < steps(name).findIndex(s => usesOf(s) === "actions/upload-artifact"));
  }
  assert.equal(steps("publish").find(s => s.uses === "./.github/actions/publish-release").with["built-release-id"],
    "${{ needs.build.outputs.release-id }}");
  assert.equal(actions["publish-release"].inputs["built-release-id"].required, true);
  assert.equal(actions["publish-release"].runs.steps.at(-1).env.BUILT_RELEASE_ID, "${{ inputs.built-release-id }}");
  const cli = read(".github/scripts/publish-release.py");
  assert.match(cli, /authorize_write\(/);
  assert.match(cli, /approve=approve/);
  assert.ok(cli.indexOf("check_package(args.release_dir") < cli.indexOf("s3, _, _ = aws_clients"));
  const core = read(".github/scripts/frontend_release.py");
  const publication = core.slice(core.indexOf("def publish_release("), core.indexOf("def remote_manifest("));
  assert.match(publication, /\*, approve\)/, "callback obrigatório, sem default que permita omissão");
  assert.ok(publication.indexOf("approve(manifest, assets, pointer, manifest_bytes)") < publication.indexOf("_put_release_object("));
  assert.match(publication, /\("manifest.json", manifest_bytes, MIME\[".json"\]\)/);
});

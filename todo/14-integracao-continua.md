# 14 · Integração contínua (GitHub Actions)

**Status:** ✅ concluída (rodando no GitHub Actions) · **Prioridade:** média · **Esforço:** pequeno · **Área:** qualidade

## Problema
Havia cerca de 100 testes (Python, Moto, Node, Playwright, Terraform), mas eles dependiam de instalações manuais em `/private/tmp` e nada rodava automaticamente.

## O que foi feito
- `package.json` (novo, raiz do projeto): `"type": "module"` (os testes e o frontend já são ESM; elimina o aviso do Node sobre isso), `playwright` como devDependency (`1.63.0`), e dois scripts:
  - `npm test` — só os testes Node que não abrem navegador (`auth-refresh.mjs`, `canvas-links.mjs`, `student-journey.mjs`).
  - `npm run test:browser` — builda o frontend (`scripts/build_frontend.py`) e roda os 8 testes de navegador (`browser.mjs`, `journey-browser.mjs`, `student-journey-browser.mjs`, `canvas-links-browser.mjs`, `rate-limit-browser.mjs`, `reminders-batch-browser.mjs`, `activity-overview-browser.mjs`, `admin-access-browser.mjs`). Os dois arquivos `tests/live_*.mjs` ficam de fora — dependem de uma implantação real já publicada, não fazem sentido em CI.
- `package-lock.json` (novo) — gerado com `npm install`, para instalação reprodutível (`npm ci`) em CI.
- `requirements-dev.txt` (novo, raiz) — `boto3==1.42.97` e `moto==5.1.22`, as versões já usadas localmente.
- **Os quatro testes de navegador que tiravam screenshot** (`browser.mjs`, `journey-browser.mjs`, `canvas-links-browser.mjs`, `student-journey-browser.mjs`) salvavam em `/private/tmp/avanca-preview`, um caminho específico do macOS que não existe (e não seria gravável) num runner Linux. Trocado por `path.join(os.tmpdir(), "avanca-preview")`, portátil entre sistemas — o comportamento local no Mac não muda (`os.tmpdir()` resolve para dentro de `/private/tmp` lá).
- Os arquivos de teste **já** caem de volta para `require("playwright")` quando a variável `PLAYWRIGHT_MODULE` não está definida (`process.env.PLAYWRIGHT_MODULE || "playwright"`); não precisaram de mudança nesse ponto. Bastava o Playwright estar instalado como dependência real do projeto (antes, cada sessão de desenvolvimento instalava num diretório temporário à parte e apontava a variável de ambiente para lá).
- `.gitignore`: adicionado `node_modules/`.
- `.github/workflows/ci.yml` (novo) — três jobs paralelos, em push para `main` e em todo pull request:
  - **python**: `pip install -r requirements-dev.txt`, depois `python -m unittest discover -s backend` e `python -m unittest discover -s tests/integration` (Moto — nunca toca AWS real).
  - **node**: `npm ci`, `npm test`, instala o Chromium do Playwright, `npm run test:browser`.
  - **terraform**: `terraform fmt -check -recursive`, `terraform init -backend=false` (evita exigir `backend.hcl`, que é local e não versionado), `terraform validate`, `terraform test` (usa `mock_provider`, nunca toca a conta AWS real).

## Validado nesta sessão
- `npm test` e `npm run test:browser`: rodados do zero (`npm ci`, sem `PLAYWRIGHT_MODULE`, sem diretório `/tmp` manual) — **16 + 8 = 24 testes**, todos passando.
- `python -m unittest discover -s backend` e `-s tests/integration`: rodados numa venv limpa só com `requirements-dev.txt` instalado — **93 + 14 = 107 testes**, todos passando. (`tests/integration` também recolhe outros arquivos além de `test_aws.py`, ex. o citado em `infra/SES.md`.)
- `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`, `terraform test`: simulados a partir de uma cópia completa do repositório (sem `backend.hcl`, sem `terraform.tfvars`, sem `.terraform/` pré-existente, sem credenciais AWS no ambiente) — passam exatamente como rodariam num runner do GitHub Actions.

## Commitado e enviado em 2026-09-24
Enviado ao `alric-corp/main` (6 commits, incluindo o trabalho das tarefas 02–09, 11 e este). Primeira execução do workflow (`gh run watch`): **os três jobs passaram** — Terraform (25s), Backend (30s), Frontend/Playwright (1m3s). Únicos avisos: depreciação do Node 20 nas actions oficiais (`actions/checkout@v4`, `setup-python@v5`, `setup-terraform@v3`) e aviso futuro sobre `ubuntu-latest` migrar para Ubuntu 26 em outubro — nada do código deste projeto, não bloqueiam o CI.

## Proposta original
- [x] `package.json` na raiz, com Playwright como devDependency e scripts `test`, `test:browser`.
- [x] `requirements-dev.txt` com `boto3` e `moto` fixados.
- [x] Workflow `.github/workflows/ci.yml` que roda em cada PR, cobrindo backend, integração (Moto), Node, build + testes de navegador, e Terraform (`fmt -check`, `validate`, `test`).
- [x] Testes ajustados para não exigir `PLAYWRIGHT_MODULE` apontando para `/private/tmp` (o fallback para `require("playwright")` já existia; o que precisava de ajuste eram os caminhos de screenshot, agora portáveis).

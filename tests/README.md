# Testes

Índice das suítes do portal: o que cada uma cobre, como rodar e onde roda na CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Nenhuma suíte automatizada acessa a AWS real. As únicas exceções são as verificações manuais `live_*` ([abaixo](#verificações-manuais-contra-o-ambiente-publicado)).

Os comandos rodam a partir da raiz do repositório.

## Preparação

```sh
pip install -r requirements-dev.txt   # boto3 e Moto
npm ci                                 # Playwright, na versão fixada em package.json
npx playwright install chromium
```

## Comandos

| Suíte | Comando | Job da CI |
| --- | --- | --- |
| Unitários Node, sem navegador | `npm test` | Frontend (Node + Playwright) |
| Navegador (Playwright; gera o build antes) | `npm run test:browser` | Frontend (Node + Playwright) |
| Backend Python | `python -m unittest discover -s backend` | Backend (Python + Moto) |
| Integração com Moto | `python -m unittest discover -s tests/integration` | Backend (Python + Moto) |
| Terraform | `cd infra/terraform && terraform init -backend=false && terraform validate && terraform test` | Terraform (fmt, validate, test) |
| Bootstrap do deploy do frontend | `cd infra/cicd-bootstrap && terraform init -backend=false && terraform validate && terraform test` | Bootstrap do deploy do frontend |
| Contratos, mutações e transições | ver [Mutações e transições](#mutações-e-transições) | conforme a tabela |

As suítes de navegador medem layout com as fontes do sistema. A evidência verde da CI é do Ubuntu 24.04, como explica o comentário do job Frontend no workflow; em outro sistema, medidas próximas do limite podem variar.

## Regras da organização

- `tests/` é plano. Todo `tests/*.mjs` do nível de cima precisa estar registrado em `package.json`: os unitários em `test` e as suítes de navegador (`browser.mjs` ou `*-browser.mjs`) em `test:browser`. `tests/architecture.mjs` falha quando um arquivo falta ou sobra. As exceções são `live_browser.mjs` e `live_readiness.mjs`.
- As suítes de navegador servem `frontend/dist`, resolvido a partir do diretório atual: rode da raiz. `PLAYWRIGHT_MODULE` pode apontar para outra instalação do Playwright. Algumas suítes gravam capturas em `avanca-preview/`, dentro do diretório temporário do sistema (`os.tmpdir()`).
- Os testes Python do backend ficam em `backend/test_*.py` e são excluídos do pacote das Lambdas pela lista `excludes` de [`infra/terraform/api.tf`](../infra/terraform/api.tf). Teste novo que não pode entrar no pacote fica em `tests/integration/`, como `test_hygiene.py`.
- Responsabilidades dos testes do frontend: [docs/arquitetura.md](../docs/arquitetura.md#testes-do-frontend).

## Unitários Node (`npm test`)

| Área | Arquivos |
| --- | --- |
| Fundamentos | `state.mjs` (contrato do `state`), `architecture.mjs` (fronteiras, imports, build, actions e guardas da suíte), `api.mjs` (camada de rede com fetch, relógio e sessão simulados), `auth-refresh.mjs` (renovação de token), `handlers.mjs` (handlers com render simulado e transporte falso), `notice.mjs` (contrato do aviso), `openapi.mjs` (OpenAPI × frontend × backend) |
| Regras puras | `canvas-links.mjs` (links do Canvas anotados pelo backend), `student-journey.mjs` (módulos, revisão e próximos passos), `participation.mjs` (participação na turma, C7.2.3) |
| Concorrência e lifecycle | `stale-responses.mjs` (C7.4, respostas assíncronas obsoletas), `feedback-lifecycle.mjs` (C7.5, Feedback e rascunhos de importação) |
| Telas renderizadas como texto | `student-feedback.mjs`, `student-feedback-outcomes.mjs`, `teacher-home.mjs`, `teacher-publications.mjs`, `teacher-import.mjs`, `teacher-reminders.mjs`, `admin-access-page.mjs`, `admin-feedback-page.mjs`, `c1-reliability.mjs`, `c2-robustness.mjs` |
| Pipeline de deploy do frontend | `release-pipeline.mjs` (invariantes do workflow `deploy-frontend.yml`, das composite actions e dos scripts de release; config relativa ao módulo, D1) |

## Navegador (`npm run test:browser`)

Todas usam API fictícia (e, quando aplicável, Cognito ou S3 fictícios), sem acesso à AWS real.

| Área | Arquivos |
| --- | --- |
| Fluxos gerais | `browser.mjs`, `journey-browser.mjs`, `login-clock-browser.mjs`, `signup-confirmation-browser.mjs`, `rate-limit-browser.mjs`, `mobile-ux-browser.mjs` |
| Aluno | `student-home-browser.mjs`, `student-home-v2-browser.mjs`, `student-activities-browser.mjs`, `student-history-browser.mjs`, `student-feedback-browser.mjs`, `student-journey-browser.mjs`, `canvas-links-browser.mjs`, `student-view-browser.mjs` |
| Instrutor | `teacher-home-browser.mjs`, `teacher-publications-browser.mjs`, `teacher-import-browser.mjs`, `teacher-reminders-browser.mjs`, `activity-overview-browser.mjs`, `instructor-tools-browser.mjs`, `reminders-batch-browser.mjs`, `import-integrity-browser.mjs`, `import-lifecycle-browser.mjs`, `participation-browser.mjs`, `participation-actions-browser.mjs` |
| Administração | `admin-access-browser.mjs`, `admin-access-page-browser.mjs`, `admin-feedback-page-browser.mjs` |
| Feedback | `feedback-browser.mjs`, `feedback-attachments-browser.mjs`, `feedback-lifecycle-browser.mjs` |
| Casca global | `shell-browser.mjs`, `shell-a11y-browser.mjs`, `shell-adaptive-browser.mjs` |
| Robustez | `stale-browser.mjs` (C7.4), `c1-reliability-browser.mjs`, `c2-robustness-browser.mjs` |
| Releases do frontend | `release-cache-browser.mjs`: releases reais preparadas num clone temporário (baseline C7.3 e main), servidas como o S3; P2, HTML antigo em cache, duas releases simultâneas, callback do Cognito, `?turma=`, rollback e migração do layout plano |

As suítes `student-home*`, `student-activities-*`, `student-history-*`, `student-feedback*`, `teacher-*`, `admin-access-page*`, `admin-feedback-page*`, `shell-*`, `c1-*` e `c2-*` (navegador e unitárias) correspondem às etapas do redesign registradas em [docs/design-visual.md](../docs/design-visual.md).

## Contratos (`tests/contracts/`)

| Arquivo | Papel |
| --- | --- |
| `sources.mjs` | Raiz do repositório, leitura das fontes e extração das rotas do frontend e do backend |
| `openapi.mjs` | Leitura e validação de `openapi/portal.yaml`, com o parser YAML do Playwright fixado |
| `openapi_routes.mjs` | Ponte JSON entre o contrato e `tests/integration/test_api_routes.py` |
| `backend_routes.py` | Rotas públicas do backend extraídas por AST, sem importar o runtime nem acessar a AWS |

## Mutações e transições

Os mutantes rodam em cópias temporárias: o checkout não é alterado. Uma mutação sobrevivente faz o script sair com código diferente de zero.

| Script | Cobre | Job da CI |
| --- | --- | --- |
| `python tests/contracts/claim_mutations.py` | Claim dos lembretes automáticos (DynamoDB Moto) | Backend |
| `python tests/contracts/manual_recovery_mutations.py` | Autorização da recuperação manual (DynamoDB Moto) | Backend |
| `python3 tests/contracts/stale_mutations.py` | C7.4: proteções contra respostas obsoletas (Node e navegador) | Frontend |
| `python3 tests/contracts/lifecycle_mutations.py` | C7.5: lifecycle do Feedback e dos rascunhos (unitário, arquitetura e navegador) | Frontend |
| `python3 ../../tests/contracts/terraform_mutations.py` | OpenAPI como fonte das rotas, avaliado pelo `terraform test` com mocks | Terraform (em `infra/terraform`, depois do `init`) |
| `python3 ../../tests/contracts/manual_alias_transitions.py` | Transições e mutações do alias manual, com HCL real e mocks | Terraform (em `infra/terraform`, depois do `init`) |
| `python tests/contracts/release_mutations.py` | Pipeline de release do frontend: publicação, ativação, rollback, gates, workflow e D1 (Moto e Chromium locais, clone temporário) | Frontend (depois do `setup-python`) |
| `python3 ../../tests/contracts/bootstrap_mutations.py` | Trust e policy da role de deploy do frontend, avaliadas pelo `terraform test` com mocks | Bootstrap do deploy (em `infra/cicd-bootstrap`, depois do `init`) |

As mutações do frontend precisam do `npm ci` e do Chromium do Playwright.

## Integração (`tests/integration/`, Moto)

| Arquivo | Cobre |
| --- | --- |
| `test_aws.py` | `Repository` real com boto3 e serviços Moto |
| `test_api_routes.py` | Dispatchers públicos do backend ↔ OpenAPI, sem importar o runtime |
| `test_automatic_claim.py` | Claim real dos lembretes automáticos em DynamoDB Moto, com SES e relógio locais |
| `test_manual_recovery.py` | Recuperação pelo alias protegido, com DynamoDB/S3 Moto e SES fictício |
| `test_ses.py` | Contrato do SES com o Stubber do botocore, sem enviar e-mail |
| `test_hygiene.py` | Higiene do backend (C7.6): compilação sem avisos e `Content-Disposition` |
| `test_frontend_release_package.py` | Releases do frontend: build determinístico, id, manifesto SHA-256, grafo de imports, MIME, config por release, ponteiro, baseline C7.3 e CLIs num clone temporário |
| `test_frontend_release_s3.py` | Publicação com `If-None-Match`, ativação com `If-Match`, corrida, upload parcial, falhas antes e depois do `index.html` e rollback, em S3/CloudFront Moto |
| `test_frontend_release_gate.py` | Gates do workflow (main, SHA, CI, environment protegido, variables, chaves estáticas), claims OIDC sem expor o token e a sonda S3 |

`release_fixtures.py` reúne os builds reais, o bloqueio de rede (só sockets locais) e os simuladores dessas três suítes. Os testes da baseline extraem `1daab31` do Git: o checkout precisa do histórico completo (`fetch-depth: 0` na CI).

## Fora de `tests/`

- `backend/test_canvas.py`, `test_grades.py`, `test_identity.py`, `test_journey.py`, `test_portal.py` e `test_reminders.py`: unitários do backend.
- `infra/terraform/tests/*.tftest.hcl` (`automatic-pilot`, `automatic-reminders`, `infrastructure`, `manual-alias`, `manual-recovery`, `routes`): `terraform test` com `mock_provider`.
- `infra/cicd-bootstrap/tests/*.tftest.hcl` (`bootstrap`, `hardening`): trust e policy da role de deploy do frontend, com `mock_provider` (job Bootstrap do deploy).

## Verificações manuais contra o ambiente publicado

Não fazem parte de `npm test`, `npm run test:browser` nem da CI. **Acessam o ambiente de produção: só executar com autorização explícita**, conforme [infra/DEPLOYMENT.md](../infra/DEPLOYMENT.md).

| Arquivo | O que faz |
| --- | --- |
| `live_readiness.mjs` | Verificação pública pós-deploy, somente leitura; não usa credenciais nem contas de aluno |
| `live_accounts.py` | Contas efêmeras para o smoke real, com envio de e-mail suprimido; cria recursos temporários |
| `live_browser.mjs` | Smoke no navegador contra o deploy real, só com contas sintéticas; cria recursos temporários |

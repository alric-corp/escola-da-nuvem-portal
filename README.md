# Portal Escola da Nuvem · AWS re/Start

Portal de acompanhamento do programa AWS re/Start: alunos consultam seu desempenho e o Guia do curso; instrutores acompanham a turma e as notas, atualizadas pelo Canvas nas turmas com sincronização habilitada ou por importação de CSV; administradores gerenciam turmas e acessos.

## Onde está cada coisa

| Pasta | Conteúdo |
| --- | --- |
| [`frontend/`](frontend/README.md) | Interface (HTML/JS sem bundler), login Cognito com PKCE, telas de aluno, instrutor e admin. |
| `backend/` | Lambda Python da API (regras de notas, publicação, vínculos, lembretes). |
| [`infra/`](infra/README.md) | Terraform da AWS (Cognito, API Gateway, Lambda, DynamoDB, S3, CloudFront, SES). |
| [`docs/`](docs/README.md) | Índice da documentação: produto (jornadas e regras), engenharia (arquitetura e direção visual), guias, backlog e histórico. |
| [`docs/todo/`](docs/todo/README.md) | Backlog ativo: itens parciais, pendentes e dependências externas. |
| [`docs/todo/concluido/`](docs/todo/concluido/README.md) | Tarefas implementadas, histórico e mapa de evidências de código/testes. |
| [`docs/todo/despriorizado/`](docs/todo/despriorizado/README.md) | Propostas preservadas para reavaliação, fora do planejamento atual. |
| [`docs/historico/`](docs/historico/README.md) | Registros de entregas e operações concluídas (API e automação de lembretes). |
| [`tests/`](tests/README.md) | Testes de navegador (Playwright), de Node, de integração (Moto), contratos e mutações. |

## Testes

```bash
npm ci  # parser YAML também usado pelos testes Python de contrato
python3.13 -m venv .venv
. .venv/bin/activate
python --version
python -m pip install -r requirements-dev.txt
python -m unittest discover -s backend
python -m unittest discover -s tests/integration

npx playwright install chromium
npm test
npm run test:browser

cd infra/terraform && terraform init -backend=false && terraform validate && terraform test
```

O mesmo conjunto roda no GitHub Actions a cada push e pull request (`.github/workflows/ci.yml`). Nenhum desses testes acessa a AWS real. O índice das suítes, com contratos, mutações e verificações manuais, está em [tests/README.md](tests/README.md).

Os testes de backend, integração/Moto e suas mutações usam Python 3.13, alinhado ao runtime declarado das Lambdas. O ambiente isolado das ferramentas de deploy continua em Python 3.12; passar nos testes do runner não certifica o ambiente AWS/ARM64.

## Implantação e operação

O frontend já usa releases versionadas e publicação automática:

**PR → CI aprovado → merge → deploy automático do frontend (push na main, sem repetir a suíte).**

O workflow publica a release imutável no S3, ativa o index, invalida apenas `/` e `/index.html` no CloudFront e verifica a entrega pública. O deploy depende dos gates existentes e de `FRONTEND_DEPLOY_ENABLED=true`. Operações manuais, diagnóstico e rollback estão no [runbook de releases](infra/FRONTEND-RELEASES.md), a referência operacional do frontend.

| Operação | Procedimento |
| --- | --- |
| Publicar frontend | Fluxo GitHub Actions acima; [runbook](infra/FRONTEND-RELEASES.md) |
| Implantar backend ou alterar infraestrutura | Processo separado com plano Terraform revisado em [infra/README.md](infra/README.md#5-operação-posterior); o deploy do frontend não atualiza Lambdas |
| Publicar notas acadêmicas | Sincronização Canvas das turmas habilitadas ou prévia/publicação de CSV pelo instrutor; [jornada do instrutor](docs/jornada-instrutor.md) |

`scripts/deploy_frontend.sh` é legado do layout plano, fora do procedimento normal de releases. Não usar sincronização na raiz ou invalidação ampla para atualizar o portal versionado.

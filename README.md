# Portal Escola da Nuvem · AWS re/Start

Portal de acompanhamento de notas do programa AWS re/Start: alunos consultam o próprio desempenho, instrutores importam o CSV do Canvas, publicam as notas e acompanham a turma, e administradores gerenciam turmas e acessos.

## Onde está cada coisa

| Pasta | Conteúdo |
| --- | --- |
| [`frontend/`](frontend/README.md) | Interface (HTML/JS sem bundler), login Cognito com PKCE, telas de aluno, instrutor e admin. |
| `backend/` | Lambda Python da API (regras de notas, publicação, vínculos, lembretes). |
| [`infra/`](infra/README.md) | Terraform da AWS (Cognito, API Gateway, Lambda, DynamoDB, S3, CloudFront, SES). |
| [`docs/`](docs/README.md) | Índice da documentação: produto (jornadas e regras), engenharia (arquitetura e direção visual), guias, backlog e histórico. |
| [`docs/todo/`](docs/todo/README.md) | Backlog ativo: itens parciais, pendentes e dependências externas. |
| [`docs/todo/concluido/`](docs/todo/concluido/README.md) | Tarefas implementadas, histórico e mapa de evidências de código/testes. |
| [`docs/historico/`](docs/historico/README.md) | Registros de entregas e operações concluídas (API e automação de lembretes). |
| [`tests/`](tests/README.md) | Testes de navegador (Playwright), de Node, de integração (Moto), contratos e mutações. |

## Testes

```bash
pip install -r requirements-dev.txt
python -m unittest discover -s backend
python -m unittest discover -s tests/integration

npm ci
npx playwright install chromium
npm test
npm run test:browser

cd infra/terraform && terraform init -backend=false && terraform validate && terraform test
```

O mesmo conjunto roda no GitHub Actions a cada push e pull request (`.github/workflows/ci.yml`). Nenhum desses testes acessa a AWS real. O índice das suítes, com contratos, mutações e verificações manuais, está em [tests/README.md](tests/README.md).

## Implantação

Infraestrutura com `terraform plan`/`apply` em `infra/terraform` (ver [infra/README.md](infra/README.md)); frontend com `scripts/deploy_frontend.sh`. A conta é de produção: revise o plano antes de aplicar.

A publicação do frontend é manual, por esse script. O GitHub Actions roda só a CI, sem etapa de publicação. A publicação do redesign integrado pelo PR #3 está bloqueada pelo risco P2, de cache misto de módulos: com `max-age=300` e arquivos sem hash no nome, o navegador pode combinar módulos novos e antigos, e o portal não abre. Ver [Cache e ES modules](docs/arquitetura.md#cache-e-es-modules).

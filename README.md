# Portal Escola da Nuvem · AWS re/Start

Portal de acompanhamento de notas do programa AWS re/Start: alunos consultam o próprio desempenho, instrutores importam o CSV do Canvas, publicam as notas e acompanham a turma, e administradores gerenciam turmas e acessos.

## Onde está cada coisa

| Pasta | Conteúdo |
| --- | --- |
| [`frontend/`](frontend/README.md) | Interface (HTML/JS sem bundler), login Cognito com PKCE, telas de aluno, instrutor e admin. |
| `backend/` | Lambda Python da API (regras de notas, publicação, vínculos, lembretes). |
| [`infra/`](infra/README.md) | Terraform da AWS (Cognito, API Gateway, Lambda, DynamoDB, S3, CloudFront, SES). |
| [`docs/`](docs/README.md) | Jornadas por perfil, arquitetura e notas de contexto. |
| [`todo/`](todo/README.md) | Melhorias planejadas e o registro do que já foi feito. |
| `tests/` | Testes de navegador (Playwright), de Node e de integração (Moto). |
| [`legacy/`](legacy/README.md) | Ferramenta local original (abria o CSV direto no navegador), preservada como referência. |

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

O mesmo conjunto roda no GitHub Actions a cada push e pull request (`.github/workflows/ci.yml`). Nenhum desses testes acessa a AWS real.

## Implantação

Infraestrutura com `terraform plan`/`apply` em `infra/terraform` (ver [infra/README.md](infra/README.md)); frontend com `scripts/deploy_frontend.sh`. A conta é de produção: revise o plano antes de aplicar.

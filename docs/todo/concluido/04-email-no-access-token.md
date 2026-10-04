# 04 · Remover a chamada ao /oauth2/userInfo em cada requisição

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída (aplicado em produção) · **Prioridade:** alta (antes de novas turmas) · **Esforço:** médio · **Área:** backend / infra

## Problema
`authenticate()` (`backend/portal.py`) chamava o Cognito `/oauth2/userInfo` em toda requisição para obter o e-mail. Isso soma latência e consome a cota do endpoint. Com várias turmas entrando ao mesmo tempo, pode gerar erros 503.

## O que foi feito
- `backend/auth_trigger.py` (novo): handler do gatilho Cognito **pre token generation** (evento V2_0). Lê `email`/`email_verified` de `event.request.userAttributes` e os inclui no access token via `claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride`.
- `infra/terraform/auth-trigger.tf` (novo): Lambda dedicada para o gatilho (role própria, mínima — só grava os próprios logs, sem acesso a DynamoDB/S3), reaproveitando o zip já empacotado em `data.archive_file.api`. Permissão (`aws_lambda_permission`) restrita ao user pool do portal (`principal = cognito-idp.amazonaws.com`, `source_arn` = ARN do user pool).
- `infra/terraform/auth.tf`: `aws_cognito_user_pool.portal` ganhou `lambda_config.pre_token_generation_config { lambda_arn, lambda_version = "V2_0" }`.
- `backend/portal.py` (`authenticate`): se a claim `email` já vier no access token (gatilho ativo), usa `email`/`email_verified` direto do JWT — **sem nenhuma chamada de rede**. Só cai no fallback (`/oauth2/userInfo`) quando a claim não existir, cobrindo a transição (tokens emitidos antes do gatilho entrar em vigor; como o access token dura 15 minutos, a janela é curta). Um e-mail não verificado continua sendo recusado com 403 nos dois caminhos.
- `infra/terraform/tests/infrastructure.tftest.hcl`: três novas asserções (`lambda_config`/`pre_token_generation_config` aponta para a lambda certa e usa `V2_0`; handler é `auth_trigger.handler`; só o user pool do portal pode invocar a lambda).
- `backend/test_portal.py`: dois testes novos — claim de e-mail verificado no token pula `userInfo` (`urlopen.assert_not_called()`); claim de e-mail não verificado é recusado com 403, também sem chamar `userInfo`.

## Validado nesta sessão
- `terraform validate` ✅.
- `terraform test` (`infra/terraform/tests/infrastructure.tftest.hcl`) ✅ — 1 passed, 0 failed.
- `terraform plan` contra a infraestrutura real (conta `712107929769`, user pool `us-east-1_LUKZ5lBuw`): **5 a criar, 3 a atualizar (rehash do zip do Lambda), 0 a destruir**. O `aws_cognito_user_pool.portal` é atualizado *in-place* (só ganha o bloco `lambda_config`), sem substituição — não há risco de recriar o pool ou invalidar contas existentes. O plano já confirma que o tier Essentials aceita o `pre_token_generation_config` V2_0 sem erro.
- `python3 -m unittest discover -p "test_*.py"` em `backend/`: 80/80 testes passando, incluindo os dois novos.

## Critérios de aceite
- [x] Nenhuma chamada a `userInfo` no caminho normal (uma vez o gatilho aplicado e o token reemitido).
- [x] Access token sem e-mail verificado continua recusado (403), nos dois caminhos (claim ou fallback).
- [x] Terraform com o gatilho e teste em `infra/terraform/tests`.

## Aplicado em produção em 2026-09-24
`terraform apply` executado contra a conta `712107929769` (user pool `us-east-1_LUKZ5lBuw`): **5 recursos criados, 3 atualizados, 0 destruídos**. `terraform plan` logo depois confirmou "No changes" — infraestrutura e configuração batem.
- Tokens novos (emitidos a partir do próximo login/refresh de cada usuário) já vêm com as claims `email`/`email_verified`; o fallback para `/oauth2/userInfo` deixa de ser usado organicamente. Como o access token dura só 15 minutos, a transição é rápida.
- Nenhuma ação do usuário final é necessária.
- Recomendado: observar por alguns dias os logs do CloudWatch da lambda `restart-portal-prod-auth-trigger` e da função principal (`restart-portal-prod-identity`) para confirmar ausência de erros e queda das chamadas a `userInfo`.

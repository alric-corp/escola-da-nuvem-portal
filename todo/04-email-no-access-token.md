# 04 · Remover a chamada ao /oauth2/userInfo em cada requisição

**Prioridade:** alta (antes de novas turmas) · **Esforço:** médio · **Área:** backend / infra

## Problema
`authenticate()` (`backend/portal.py`) chama o Cognito `/oauth2/userInfo` em toda requisição para obter o e-mail. Isso soma latência e consome a cota do endpoint. Com várias turmas entrando ao mesmo tempo, pode gerar erros 503.

## Proposta
- Adicionar um gatilho Lambda *pre token generation* (evento V2) que inclua `email` e `email_verified` no access token.
- Ler esses claims direto do JWT, já validado pelo API Gateway, e manter `userInfo` só como fallback durante a transição.

## Critérios de aceite
- [ ] Nenhuma chamada a `userInfo` no caminho normal.
- [ ] Access token sem e-mail verificado continua recusado (403).
- [ ] Terraform com o gatilho e teste em `infra/terraform/tests`.

## Atenção
O evento V2 de pre-token para access token exige o plano Essentials, que o pool já usa. Validar em `plan` antes do `apply`.

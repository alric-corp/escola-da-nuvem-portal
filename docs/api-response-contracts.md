# Contratos concretos de relatório

Fontes editáveis: `openapi/src/components/report-schemas.yaml` e os domínios
`cohorts`, `grades` e `reminders`. O bundle continua sendo gerado por
`npm run openapi:bundle` e conferido por `npm run openapi:check`.

| Resposta | Contrato conferido pelo dispatcher real |
| --- | --- |
| `GET /cohorts` | Lista autorizada, código, publicação corrente nullable e canTeach; configuração opcional existente. |
| `GET /cohorts/{code}/class-report` | Turma, atualização nullable, referências e linhas com nome, médias nullable, contagens e enum acadêmico. Sem IDs/e-mails/engajamento individual nesta visão. |
| `GET /cohorts/{code}/report` | Ramos distintos: sem publicação, instrutor/admin e aluno. Campos obrigatórios refletem o ramo real; coleção vazia difere de null/ausência. |
| Relatório individual / `student-view` | Somente o aluno autorizado, suas atividades, histórico de até 12 publicações e envelope auxiliar opcional de entregas atuais. |
| `POST /cohorts/{code}/pending-preview` | Detalhe individual já autorizado, atividades acadêmicas, histórico e envelope opcional; envio de lembrete permanece separado. |

O histórico mantém `publishedAt`, `current`, médias nullable e mudanças pessoais.
Não recebe observações recentes de entregas como se fossem históricas. Os estados
acadêmicos permanecem `ok`, `attention`, `critical`, `insufficient` e `graduated`.
Campos de outro perfil e payload/nota oculta de submissão são rejeitados pelos
contratos específicos; extensões legítimas continuam possíveis, sem fechar todo
objeto com `additionalProperties: false`.

Os testes de integração executam o Portal real com dados fictícios e validam os
JSONs com `OAS30Validator`, incluindo `nullable`, composição e formato date-time.
`openapi-schema-validator==0.9.0` é dependência fixada **somente de testes**, para
não improvisar um validador nem interpretar nullable como OpenAPI 3.1. Veja a
[documentação oficial](https://python-openapi.org/openapi-schema-validator/docs/latest/validation.html).
Não entra no frontend ou no pacote de runtime das Lambdas; o lock isolado de deploy
não muda. Casos negativos retiram campos obrigatórios, trocam tipos/enums, injetam
null indevido ou expõem campos de outro perfil.

## Bytes e histórico de releases

Referência anterior: `142d4fa2150cece27cdc65a29f6b358dd3d9c6c3`.

- SHA-256 anterior de `openapi/portal.yaml`: `c1f3053efea150543be19cf583707772861664dda87844462a328cca332df5e0`.
- SHA-256 desta alteração: `d0a0d9df167b05cd77a044e049a28cc1a607c43aa6678459ddd324939bfe79c2`.

Há mudanças legítimas de schemas e campos auxiliares; não é uma alegação de
equivalência byte a byte com a versão anterior. As 35 rotas, métodos, operationIds,
JWT/scopes e endereços Terraform permanecem. `openapi_sha256` continua representando
bytes brutos. Manifestos históricos e baseline não são reescritos; rollback para
uma release com hash diferente continua exigindo `confirm_release_id` explícito.

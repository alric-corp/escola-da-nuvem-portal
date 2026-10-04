# API-2 — OpenAPI como fonte das rotas Terraform

**Entrega local para aprovação, em 04/10/2026 UTC.** As 35 rotas mantêm
addresses e atributos: **0 to add / 0 to change / 0 to destroy** no plano
direcionado e no recorte de rotas do full plan. API-2 não foi commitada,
publicada nem aplicada. Nenhum endpoint do portal foi chamado.

## Encerramento da API-1

- Safety check: somente os oito arquivos aprovados de contrato, testes,
  package.json e documentação. Os 78 arquivos existentes protegidos
  permaneceram iguais; `git diff --check` passou.
- Commit: `c64921b68952872be2a316e613b560cc7977767c`.
- Mensagem: `feat: adicionar contrato OpenAPI do portal`.
- Push concluído para `alric-corp/main`.
- [CI 37170775085](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37170775085):
  **success** nos jobs Frontend, Backend e Terraform;
  encerrado em **2026-10-04 02:24:27 UTC**.
- API-2 começou somente após esse resultado, a partir desse SHA, sem
  alterações rastreadas pendentes. Não houve deploy da API-1.
- [api-1.md](api-1.md) permanece como registro histórico da primeira entrega.

## Baseline e contrato congelado

`openapi/portal.yaml` continua byte a byte igual ao commit API-1:

```text
SHA-256 61479fe37c8981747f8a5b20988e3bb47be53839365f998355e09d59424c8347
```

OpenAPI **3.0.3**, versão **1.0.0**, 35 operações. Não houve alteração de
path, método, operationId, payload, respostas, segurança, parâmetros ou tags.
Não foram adicionados servidores, IDs AWS, ARNs, e-mails, tokens ou dados de
alunos ao contrato. As exclusões de Cognito direto, S3 direto e serviços
externos continuam as documentadas na API-1.

## Derivação no Terraform

Antes, `api.tf` continha um set literal de 34 route keys, além de `GET /me`.
Agora [api.tf](../infra/terraform/api.tf) lê o contrato uma única vez:

```hcl
openapi_spec = yamldecode(file("${path.module}/../../openapi/portal.yaml"))
```

A derivação usa somente HCL nativo, sem external data source, local-exec,
provider novo, código gerador ou cópia do YAML. A função é documentada pela
[HashiCorp](https://developer.hashicorp.com/terraform/language/functions/yamldecode).

| Elemento | Derivação / finalidade |
| --- | --- |
| `openapi_http_methods` | Filtro explícito: get, post, put, patch, delete, head, options |
| `openapi_operations` | Percorre paths e somente operações HTTP; produz objetos mínimos |
| `route_key` | `"${upper(method)} ${path}"`, sem normalizar placeholders |
| `authorization_type` | `PortalJwt` → JWT; `security: []` → NONE |
| `authorization_scopes` | Set de `x-portal-authorization-scopes` da operação |
| `routes` | Map das 35 operações pela route key exata |
| `me_route_key` | Única constante de seleção: `GET /me` |
| `portal_routes` | As outras 34 entradas; nenhuma lista manual paralela |
| `openapi_routing_valid` | Preconditions para recusar paths/métodos/segurança não suportados |

Os valores transportam somente route key, tipo de autorização e scopes.
Responses, schemas, tags e descrições não entram nos atributos das rotas.
`parameters`, `summary`, `description`, `servers` e extensões `x-*`
do Path Item não viram operações.

Os nomes `{code}`, `{userId}`, `{id}`, `{feedbackId}` e
`{attachmentId}` permanecem literais. `operationId` não participa da key.

### Segurança e IDs de ambiente

Segurança declarada na operação tem precedência sobre a declaração global.
O adapter aceita exatamente `[{PortalJwt: []}]` ou lista vazia sem scopes.
Schemes desconhecidos e alternativas OR/AND não suportadas são recusados
pelas preconditions de ambos os recursos. Na baseline, todas as 35 operações
resultam em **JWT + portal/access**.

O tipo e os scopes vêm do contrato; `portal/access` não foi hardcoded no
HCL de provisionamento. Os testes preservam explicitamente a política da
baseline, para exigir revisão quando ela mudar.

Terraform continua resolvendo os IDs por ambiente:

- Authorizer: `aws_apigatewayv2_authorizer.portal.id`, somente para JWT;
  para operação pública, `authorizer_id = null`.
- Target: `integrations/${aws_apigatewayv2_integration.identity.id}`,
  a integração existente. Nenhuma integração nova.
- API: `aws_apigatewayv2_api.portal.id`, sem alteração.

### Addresses preservados

```text
aws_apigatewayv2_route.me
aws_apigatewayv2_route.portal["METHOD /path"]
```

`me` consome route key, autorização e scopes do mesmo map derivado.
As 34 chaves do antigo set permanecem as chaves do novo map, preservando
os addresses do for_each. Não há moved block, state mv, state rm, import
ou ignore_changes novo. Não foi necessário mover state.

## Contratos e testes

| Fonte | Operações | Missing | Extra |
| --- | ---: | ---: | ---: |
| OpenAPI congelado | 35 | 0 | 0 |
| Recursos Terraform avaliados | 35 = 1 me + 34 portal | 0 | 0 |
| Chamadas frontend ao Portal API | 35 | 0 | 0 nesta baseline |
| Dispatchers públicos do backend | 35 | 0 | 0 |

O teste principal do frontend exige inclusão no OpenAPI. A proteção anterior
mais estrita da C7.2.4.1 continua bidirecional, com exceções explícitas vazias.
O contrato Python agora compara todos os dispatchers públicos e seus handlers,
ampliando a cobertura anterior limitada às operações de turma.

- [routes.tftest.hcl](../infra/terraform/tests/routes.tftest.hcl):
  Terraform avalia os próprios locals e recursos, com providers AWS/archive
  simulados e `command = plan`. Confere 35/34, /me separado, keys,
  JWT/scopes, API, authorizer e integration. Não lê HCL por regex.
- O fingerprint de chaves ordenadas da API-1 é
  `c30736ca652e8d28253caba8b0e986730812b3a3163ddd37666826f2471d1af6`.
  É uma expectativa de teste, não uma segunda lista de provisionamento.
- [tests/openapi.mjs](../tests/openapi.mjs) mantém 21 testes estruturais,
  de segurança, equivalência e mutações. A equivalência com Terraform
  foi transferida para o teste nativo; o parser HCL estático foi removido.
- [tests/api.mjs](../tests/api.mjs) preserva a proteção frontend da C7.2.4.1,
  usando OpenAPI como referência.
- [test_api_routes.py](../tests/integration/test_api_routes.py) compara
  AST do backend com OpenAPI por método, path e handler; sem importar runtime.
- [openapi_routes.mjs](../tests/contracts/openapi_routes.mjs) é uma ponte
  JSON para Python reutilizar o parser YAML existente. Não deriva Terraform.

O job Python do [CI](../.github/workflows/ci.yml) agora instala Node 22 e
executa `npm ci` antes da integração. Não há dependência nova nem mudança
de lockfile. O job Terraform também executará as mutações nativas.
O parser interno do Playwright permanece isolado no adapter existente;
o LOW da API-1 não foi ampliado para uma dependência de runtime.

## Mutações A–H e casos adicionais

[terraform_mutations.py](../tests/contracts/terraform_mutations.py) executa
os cenários em cópias temporárias do módulo e do contrato. Alterações por
âncoras textuais únicas produzem fixtures; **quem deriva as rotas é Terraform**.
Não há parser YAML/HCL nem implementação paralela da derivação no script.

| Caso | Resultado observado nos recursos avaliados |
| --- | --- |
| A — adicionar rota | 36 operações / 35 portal; nova key presente |
| B — remover participation | 34 operações / 33 portal; key ausente |
| C — POST vira GET | Key POST removida, key GET criada |
| D — remover scope | JWT mantido; scopes ficam vazios; baseline rejeita |
| E — tornar pública | NONE, authorizer null, scopes vazios; baseline rejeita |
| F — metadata de Path Item | Nenhuma rota extra; fingerprint preservado |
| G — renomear operationId | Route keys preservadas; novo nome válido e handler correto aceitos pelo contrato |
| H — path com espaço, key inválida | Preconditions recusam o contrato |
| I — scheme desconhecido | Preconditions recusam o contrato |
| J — segurança global herdada | JWT + portal/access derivados corretamente |
| K — demais métodos suportados | PUT/PATCH/DELETE/HEAD/OPTIONS entram automaticamente; 40 operações |

**11 cenários passaram**. Além das asserções específicas, A–E executam o
teste original da baseline e produzem **5 rejeições esperadas**.
O teste Node de chaves YAML duplicadas continua recusando duplicação;
operationId duplicado e handler divergente também são detectados.

Não se exige falha para toda renomeação válida de operationId: o vínculo
semântico é `x-portal-backend-operation`. Terraform não usa esse nome na key.

Nenhuma fixture modifica o contrato original. Hashes dos arquivos de origem
foram conferidos antes/depois. As cópias não incluem state, tfvars ou
backend.hcl; providers são mocks. Diretórios temporários foram removidos.

## Testes finais

| Comando | Fechamento API-1 | API-2 local |
| --- | ---: | ---: |
| `npm test` | 163 passaram | 163 passaram |
| `TZ=UTC npm test` | 163 passaram | 163 passaram |
| `npm run test:browser` | 19 passaram | 19 passaram |
| `TZ=UTC npm run test:browser` | 19 passaram | 19 passaram |
| `npm run build` | passou | passou |
| `python3 -m unittest discover -s backend` | 220 passaram | 220 passaram |
| `python3 -m unittest discover -s tests/integration` | 24 passaram | 24 passaram |
| `terraform -chdir=infra/terraform fmt -check -recursive` | passou | passou |
| `terraform -chdir=infra/terraform validate` | passou | passou |
| `terraform -chdir=infra/terraform test` | 2 passaram | 3 passaram |
| `node --test tests/openapi.mjs` | 21 passaram | 21 passaram |
| `python3 tests/contracts/terraform_mutations.py` | não existia | 11 cenários + 5 rejeições esperadas |
| `actionlint .github/workflows/ci.yml` e parse YAML | não repetido nesta fase | passaram |

OpenAPI já está incluído nos 163 testes Node; não somar seus 21 novamente.
Os testes de browser usam Chromium e API simulada; integração usa Moto.
Ambiente local: Node 26.7.0, Python 3.9.6, Terraform 1.15.8.
O aviso preexistente de suporte do Boto3/Python 3.9 não causou falha.
API-2 ainda não possui execução de CI remoto, pois não foi commitada.

## AWS × state — somente leitura

Conferência concluída em **2026-10-04 02:46:14 UTC**, state serial **56**,
antes dos planos. `terraform state pull` e operações AWS CLI
`apigatewayv2 get-api/get-integration/get-authorizer/get-routes`.
State e respostas brutas ficaram somente em memória.

| Recurso | Quantidade conferida | Resultado |
| --- | ---: | --- |
| API | 1 | Identidade, protocolo, endpoint, seleção, CORS e demais campos comparados iguais |
| Integration existente | 1 | Tipo, destino, método, payload, timeout e parâmetros comparados iguais |
| Authorizer existente | 1 | JWT, issuer, audience e fontes de identidade comparados iguais |
| Routes | 35 | IDs, keys, auth, scopes, authorizer, target e opções comparados iguais |

**Zero divergência funcional nos campos comparados.** Campos opcionais vazios
foram normalizados na comparação, por exemplo ausência de modelos como null
ou map vazio. Isso é distinto da representação literal do state no refresh
descrita abaixo. Não foram impressos IDs de ambiente, credenciais ou PII.

## Prova por planos

Após os testes locais verdes, foi executado o plano direcionado autorizado:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color \
  -lock=false -detailed-exitcode \
  -refresh=false \
  -target=aws_apigatewayv2_route.me \
  -target=aws_apigatewayv2_route.portal \
  -out=<arquivo-temporario>
```

Conclusão em **2026-10-04 02:54:11 UTC**, exit code **0**:

- 35 rotas, exatamente `me` + 34 `portal`.
- **0 add / 0 change / 0 destroy** nas rotas e no conjunto gerenciado do plano.
- Addresses iguais aos anteriores; todos os atributos before/after das
  35 rotas iguais, não apenas route key.
- Aviso esperado de resource targeting; nenhum apply.

O full plan normal, com refresh e sem targets, usou os mesmos argumentos
comuns, removendo `-refresh=false` e os dois `-target`. A leitura inicial
terminou às **02:55:31 UTC**; uma segunda leitura, às **02:57:45 UTC**, detalhou
os campos do refresh. Ambas tiveram o mesmo resultado de ações:

| Escopo | Add | Change | Destroy |
| --- | ---: | ---: | ---: |
| 35 routes | 0 | 0 | 0 |
| Todos os recursos gerenciados | 1 | 0 | 0 |

Único create: **`aws_acm_certificate.portal`**, drift conhecido.
Exit code **2** do full plan significa diferenças propostas, não erro.
Não houve mudança, substituição ou destruição planejada em rota.

Os planos binários foram criados com permissões restritas, lidos por
`terraform show -json` em memória e descartados. Só resumos sanitizados foram
retidos temporariamente fora do repositório. `-lock=false` evitou escrever
lock remoto; nenhum apply, refresh-only apply ou state push foi executado.

### Diferenças registradas pelo refresh

Cinco rotas registraram **exclusivamente `request_models: null → {}`**:

- `GET /feedback/{feedbackId}/attachments`;
- `GET /feedback/{feedbackId}/attachments/{attachmentId}`;
- `POST /cohorts/{code}/participation`;
- `POST /feedback/{feedbackId}/attachments`;
- `POST /feedback/{feedbackId}/attachments/{attachmentId}/complete`.

É uma diferença de representação de ausência de modelos no state lido pelo
provider; os dois planos completos mantiveram essas rotas em no-op.
Não houve diferença de autorização, scope, integração, método ou path.
Portanto ela não contradiz o resultado 0/0/0 da migração.

Outras diferenças de refresh foram registradas, sem correção:

| Recurso | Campos indicados pelo refresh | Ação planejada |
| --- | --- | --- |
| ACM portal | Recurso ausente no refresh | Create conhecido |
| Stage portal | deployment_id | Nenhuma |
| Cognito user pool | estimated_number_of_users | Nenhuma |
| Item initial_cohort | item | Nenhuma; ignore_changes preexistente porque o conteúdo pertence à aplicação |
| IAM role api | inline_policy | Nenhuma |
| S3 feedback | cors_rule, lifecycle_rule, policy, tags, versioning | Nenhuma |

Não se atribuiu causa a todas essas diferenças. Em particular, não se
concluiu apenas pelo histórico que S3 seja novamente um falso drift.
Elas não geraram ações de atualização nesse plano e estão fora da migração.
Nenhum valor do item DynamoDB nem conteúdo sensível foi incluído no relatório.

## Revisão adversarial

Revisão local com esforço alto, após testes e evidências de state/plan.

| Classificação | Achado |
| --- | --- |
| BLOCKER | Nenhum |
| IMPORTANT | Nenhum |
| LOW | Parser YAML continua dependendo do adapter interno da versão fixada do Playwright; upgrade exige conferir esse export |
| LOW | Integração Python agora requer Node + npm ci; CI foi ajustado, sem dependência nova |
| LOW | Extrator AST e âncoras das fixtures são deliberadamente limitados ao formato atual e falham pedindo revisão quando esse formato muda |
| LOW | Novos métodos além de GET/POST são derivados, mas CORS mantém a política atual; sua adoção futura por browser requer revisão explícita de CORS |
| NÃO PROBLEMA | Contagens/fingerprint fixos estão nos testes da baseline, não numa lista paralela que provisiona rotas |
| NÃO PROBLEMA | /me permanece separado, consumindo atributos do OpenAPI e preservando seu address |
| NÃO PROBLEMA | operationId é validado como identificador do contrato; handler é conferido pela extensão, sem afetar for_each |
| NÃO PROBLEMA | Não há dependência circular: arquivo → locals → rotas; authorizer/integration independem da leitura das rotas |
| NÃO PROBLEMA | Adições, remoções e método/security/scopes alterados se refletem nos recursos avaliados; testes exigem revisão da baseline |
| NÃO PROBLEMA | Refresh null/{} nas cinco rotas não produz alteração planejada |

Não há mudança de runtime, lista manual paralela, novo serviço, endpoint
externo no contrato, novo ID de ambiente no OpenAPI ou geração de cliente.
Validação Python, `require(teach)` e autorização de negócio continuam no
backend. A migração não muda payloads nem o estado de participação existente.

## Escopo completo do diff

| Arquivo | Alteração |
| --- | --- |
| infra/terraform/api.tf | Locals derivados, atributos das duas routes, preconditions; retirada da lista manual |
| infra/terraform/tests/routes.tftest.hcl | Teste nativo novo dos recursos avaliados |
| tests/contracts/terraform_mutations.py | Fixtures temporárias e execução dos testes nativos |
| tests/contracts/openapi_routes.mjs | Ponte JSON para o teste de integração Python |
| tests/contracts/openapi.mjs | Segurança da baseline; equivalência Terraform transferida para HCL |
| tests/contracts/sources.mjs | Remoção do leitor estático de HCL |
| tests/openapi.mjs | Contratos e mutações usam OpenAPI/backend e os testes Terraform nativos |
| tests/api.mjs | Proteção C7.2.4.1 passa a ler OpenAPI |
| tests/integration/test_api_routes.py | Todos os dispatchers públicos ↔ OpenAPI, incluindo handler |
| .github/workflows/ci.yml | Parser existente disponível na integração; execução das mutações Terraform |
| docs/arquitetura.md | Arquitetura atualizada |
| docs/api-2.md | Esta entrega e suas evidências |

`git diff -- frontend/`, `git diff -- backend/` e o diff de
`openapi/portal.yaml`, package.json e lockfile estão vazios.
Nenhum outro arquivo funcional Terraform mudou: domain/CDN/Cognito/DynamoDB/
IAM/Lambda/S3/SES permanecem iguais. Dentro de api.tf, mudanças limitadas
aos locals e aos dois blocos de route.

O diff completo, incluindo arquivos novos, acompanha a entrega em
`/private/tmp/API-2-review.diff`. Não foi necessário stage/commit para gerá-lo.

## Próximos passos — dependem de aprovação

1. Revisar esta entrega e o diff. Se aprovada, safety check e commit sugerido:
   `refactor: derivar rotas Terraform do contrato OpenAPI`.
2. Push para `alric-corp/main` e aguardar CI completo, agora incluindo as
   mutações nativas. API-2 ainda não foi commitada nem enviada.
3. Não há frontend/Lambda a publicar. Para esta migração estrutural, planos
   sem diferenças de rotas não exigem alteração de recurso na AWS.
4. Qualquer decisão posterior de apply deve revisar novamente o plano.
   O full plan atual inclui ACM, que não integra a API-2 e não está aprovado
   para aplicação nesta entrega. Nenhum plano binário desta prova foi mantido.

**Zero apply, deploy, alteração AWS, mutation de participação ou chamada de
endpoint do portal nesta execução. Somente API-1 recebeu commit/push.
API-2 permanece local para aprovação.**

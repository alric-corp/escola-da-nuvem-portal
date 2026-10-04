# API-1 — caracterização OpenAPI do portal

Implementação local sobre `1f77bc6`. Nenhum endpoint foi chamado nesta rodada.
A C7.2 em produção continua com participação real persistida; esta documentação
não executa E2E, mudança de aluno, provisionamento ou publicação.

## Baseline e isolamento

O HEAD inicial foi `1f77bc62e2f7739bbb1b6aef23686c06dbfda75d`.
Os cinco commits conferidos: `1f77bc6`, `571bc0c`, `5a9a9c2`,
`883470e` e `d4c571a`. `git diff --check` passou.
A preparação identificou um relatório local anterior; API-1 não o editou nem
o removeu. Para iniciar de árvore limpa, a baseline e a implementação foram
feitas em worktree temporário destacado no mesmo HEAD. A conferência da
árvore principal antes da transferência retornou limpa, ainda no mesmo HEAD.
As alterações API-1 são entregues na árvore principal sem commit.

| Verificação | Baseline | API-1 final |
| --- | ---: | ---: |
| `npm test` | 142 passaram | 163 passaram |
| `TZ=UTC npm test` | 142 passaram | 163 passaram |
| `npm run test:browser` | 19 passaram | 19 passaram |
| `TZ=UTC npm run test:browser` | 19 passaram | 19 passaram |
| `npm run build` | passou | passou |
| `python3 -m unittest discover -s backend` | 220 passaram | 220 passaram |
| `python3 -m unittest discover -s tests/integration` | 24 passaram | 24 passaram |
| `terraform -chdir=infra/terraform fmt -check -recursive` | passou | passou |
| `terraform -chdir=infra/terraform validate` | passou | passou |
| `terraform -chdir=infra/terraform test` | 2 passaram | 2 passaram |
| `node --test tests/openapi.mjs` | inexistente | 21 passaram |

Os testes de browser usam API simulada e Chromium local; integração usa Moto;
Terraform usa `mock_provider`. Browser/fornecedores Terraform precisaram rodar
fora do sandbox por restrições de localhost/processos. Não foi um erro da
baseline do produto. Nenhum plano ou apply foi executado.
Ambiente local: Node 26.7.0, Python 3.9.6 e Terraform 1.15.8.
O aviso preexistente do Boto3 sobre Python 3.9 não impediu os testes; o job
Python do CI já declara 3.12. API-1 não mudou dependências nem CI.

## Contrato e decisões

- Arquivo: [openapi/portal.yaml](../openapi/portal.yaml), OpenAPI **3.0.3**,
  título **Escola da Nuvem Portal API**, versão **1.0.0**.
- São **35 operações**, todas da API do portal: 1 recurso Terraform `me`
  e 34 instâncias do recurso `portal`. Não há rota HTTP especial excluída.
  O OPTIONS gerenciado por CORS não é operação declarada.
- Tags: `access`, `cohorts`, `grades`, `reminders`, `import`, `feedback`.
- Cada operação tem `operationId` único, baseado no nome do frontend/domínio,
  e `x-portal-backend-operation` validado contra o dispatcher. A extensão é
  necessária porque vários métodos HTTP compartilham um handler, e algumas
  operações são implementadas inline em `Portal.dispatch`.
- Todos os parâmetros de path são strings e obrigatórios. Os nomes
  `code`, `userId`, `id`, `feedbackId`, `attachmentId` são preservados.
- `PortalJwt` usa `type: http`, `scheme: bearer`, `bearerFormat: JWT`.
  Cada operação declara explicitamente `security: [{PortalJwt: []}]` e
  `x-portal-authorization-scopes: [portal/access]`. O requisito bearer
  padrão não transporta scopes; a extensão guarda só essa informação.
  Emissor, audiência, authorizer e integration continuam no Terraform por ambiente.
  Referência: [OpenAPI 3.0.3 — Security Requirement Object](https://spec.openapis.org/oas/v3.0.3.html#security-requirement-object).
- Parser: YAML já distribuído em `playwright-core/lib/utilsBundle`, via
  Playwright **1.63.0**, dependência de desenvolvimento existente e fixada.
  Adapter isolado em `tests/contracts/openapi.mjs`. Nenhuma dependência nova;
  nenhum parser YAML caseiro. PyYAML existe no ambiente local, mas não integra
  as dependências declaradas necessárias do job Node; não foi escolhido.
- Validação estrutural própria da caracterização, usando parser YAML real:
  versão, metadata, métodos, operationIds, parâmetros, refs, responses e security.
  Não se afirma validação integral por ferramenta oficial OpenAPI.
- Não há `servers`, exemplos de dados, IDs de ambiente, ARNs, tokens, e-mails,
  domínio de produção ou client ID no contrato.
- Estilo: dois espaços, ordem determinística de paths/operações, respostas
  numéricas em ordem; sem aliases YAML, duplicação de chaves ou trailing whitespace.

## Inventário anterior ao contrato

Fontes: [api.tf](../infra/terraform/api.tf),
[api.js](../frontend/api.js),
[Portal.dispatch e subdispatchers](../backend/portal.py),
[testes frontend existentes](../tests/api.mjs) e
[contrato backend existente](../tests/integration/test_api_routes.py).

**Segurança em todas as linhas:** `JWT` + `portal/access`, derivada de ambos
os recursos `aws_apigatewayv2_route` atuais, não presumida por convenção.
Todas usam o mesmo authorizer e integration do portal no Terraform.

**Respostas comuns (C):** 200, 400, 401, 403, 413, 429, 500, 502, 503, 504.
A última coluna acrescenta códigos específicos a C; a origem e os limites
dessas evidências são explicados abaixo. Campos de body abaixo são conhecidos;
obrigatoriedade e permissividade estão no YAML, não são inferidas só da tabela.

| Método e path | operationId | Frontend | Backend | Tag | Path params | Query conhecida | Body conhecido | Além de C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /access-request` | `requestInstructorAccess` | `access.requestInstructorAccess` | `Portal.dispatch` | access | — | — | objeto vazio no frontend | 409 |
| `GET /admin/feedback` | `listAdminFeedback` | `adminFeedback.list` | `Portal._admin_feedback` | feedback | — | limit, cursor, status, type, cohort | — | 404 |
| `POST /admin/feedback/{id}/status` | `setFeedbackStatus` | `adminFeedback.setStatus` | `Portal._feedback_status` | feedback | id | — | status, expectedStatus | 404, 409 |
| `GET /cohorts` | `listCohorts` | `cohorts.list` | `Portal.dispatch` | cohorts | — | — | — | 404 |
| `POST /cohorts` | `createCohort` | `cohorts.create` | `Portal.dispatch` | cohorts | — | — | code, name | 409 |
| `GET /cohorts/{code}/class-report` | `getCohortClassReport` | `cohorts.classReport` | `class_report` | grades | code | — | — | 404 |
| `POST /cohorts/{code}/display-name` | `setDisplayName` | `access.setDisplayName` | `Portal._set_display_name` | access | code | — | canvasId, displayName | 404, 409 |
| `POST /cohorts/{code}/focus-activities` | `saveFocus` | `cohorts.saveFocus` | `Portal._focus_activities` | grades | code | — | activityIds, expectedCurrent, expectedVersion | 404, 409 |
| `GET /cohorts/{code}/instructors` | `listInstructors` | `access.instructors` | `Portal.dispatch` | access | code | — | — | 404 |
| `POST /cohorts/{code}/instructors` | `addInstructor` | `access.addInstructor` | `Portal._approve_instructor` | access | code | — | userId | 404, 409 |
| `POST /cohorts/{code}/participation` | `setParticipation` | `cohorts.setParticipation` | `Portal._set_participation` | cohorts | code | — | ParticipationRequest | 404, 409 |
| `POST /cohorts/{code}/pending-preview` | `pendingPreview` | `reminders.pendingPreview` | `Portal._reminder_flow` | reminders | code | — | studentId | 404, 409 |
| `POST /cohorts/{code}/pending-preview-batch` | `previewReminderBatch` | `reminders.batchPreview` | `Portal._reminder_batch` | reminders | code | — | studentIds | 404, 409 |
| `POST /cohorts/{code}/preview` | `previewImport` | `cohorts.previewImport` | `Portal._preview` | import | code | — | csv, filename, activeIds | 404, 409 |
| `POST /cohorts/{code}/publish` | `publish` | `cohorts.publish` | `Portal._publish` | import | code | — | draftId, acknowledgeRemoved | 404, 409 |
| `GET /cohorts/{code}/reminder-settings` | `getReminderSettings` | `reminders.senderSettings` | `Portal._reminder_settings` | reminders | code | — | — | 404 |
| `GET /cohorts/{code}/report` | `getCohortReport` | `cohorts.report` | `Portal._report` | grades | code | — | — | 404, 409 |
| `POST /cohorts/{code}/restore` | `restore` | `cohorts.restore` | `Portal._restore` | import | code | — | publicationId, expectedCurrent | 404, 409 |
| `POST /cohorts/{code}/revoke-instructor` | `revokeInstructor` | `access.revokeInstructor` | `Portal._revoke_instructor` | access | code | — | userId | 404, 409 |
| `POST /cohorts/{code}/send-reminder` | `sendReminder` | `reminders.send` | `Portal._reminder_flow` | reminders | code | — | studentId, publicationId, previewHash | 404, 409 |
| `POST /cohorts/{code}/send-reminders` | `sendReminderBatch` | `reminders.sendBatch` | `Portal._reminder_batch` | reminders | code | — | studentIds, expectedPublicationId | 404, 409 |
| `POST /cohorts/{code}/settings` | `saveSettings` | `cohorts.saveSettings` | `Portal._set_cohort_settings` | cohorts | code | — | thresholds, canvasCourseId, autoSync | 404, 409 |
| `POST /cohorts/{code}/student-view` | `studentView` | `cohorts.studentView` | `Portal._student_view` | grades | code | — | studentId | 404, 409 |
| `POST /cohorts/{code}/students-search` | `searchStudents` | `access.searchStudents` | `Portal._students_search` | access | code | — | query | 404, 409 |
| `POST /cohorts/{code}/unlink-student` | `unlinkStudent` | `access.unlinkStudent` | `Portal._unlink_student` | access | code | — | canvasId | 404, 409 |
| `POST /cohorts/{code}/verify-sender` | `verifySender` | `reminders.verifySender` | `Portal._reminder_settings` | reminders | code | — | objeto vazio no frontend | 404 |
| `GET /feedback` | `listMyFeedback` | `feedback.listMine` | `Portal._feedback_route` | feedback | — | limit, cursor | — | — |
| `POST /feedback` | `createFeedback` | `feedback.create` | `Portal._create_feedback` | feedback | — | — | type, title, description, cohort, page | 404, 409 |
| `GET /feedback/{feedbackId}/attachments` | `listAttachments` | `feedback.attachments` | `Portal._attachment_route` | feedback | feedbackId | — | — | 404 |
| `POST /feedback/{feedbackId}/attachments` | `createAttachment` | `feedback.createAttachment` | `Portal._attachment_slot` | feedback | feedbackId | — | fileName, contentType, size, clientToken | 404, 409 |
| `GET /feedback/{feedbackId}/attachments/{attachmentId}` | `getAttachmentUrl` | `feedback.attachmentUrl` | `Portal._attachment_route` | feedback | feedbackId, attachmentId | — | — | 404 |
| `POST /feedback/{feedbackId}/attachments/{attachmentId}/complete` | `completeAttachment` | `feedback.completeAttachment` | `Portal._attachment_complete` | feedback | feedbackId, attachmentId | — | objeto vazio no frontend | 404, 409 |
| `GET /me` | `getMe` | `me.get` | `Portal.me` | access | — | — | — | — |
| `GET /requests` | `listAccessRequests` | `access.requests` | `Portal.dispatch` | access | — | — | — | — |
| `POST /requests/{userId}/reject` | `rejectRequest` | `access.rejectRequest` | `Portal.dispatch` | access | userId | — | objeto vazio no frontend | 409 |

## Evidência de respostas e payloads

`portal.handler` devolve **200** para todos os resultados bem-sucedidos de
dispatch; não há 201/202/204 explícito nesta baseline. O mesmo wrapper valida
JSON/dict (400), limita corpo decodificado em 4.000.000 bytes (413), converte
`Conflict` em 409 e captura exceção inesperada como 500.
Isso também explica 400/413 em GET com corpo malformado/excessivo, sem
documentar um request body como necessário para GET.

`authenticate` sustenta 401/403 e 503 no fallback de identidade;
`require(teach)`, `require(self.admin)` e regras de domínio sustentam
as recusas de negócio. 404/409 específicos da tabela vêm dos guards e das
operações de repositório dos handlers mapeados, incluindo funções chamadas
por eles. Exemplo: `GET /cohorts/{code}/report` pode criar vínculo de conta
e sofrer conflito; não é descrito como necessariamente sem efeitos internos.

429 tem suporte no throttling do stage em `api.tf` e nos testes de transporte
em `tests/api.mjs`; `_create_feedback` também impõe limite próprio.
502/503/504 de integração são situações **simuladas nos testes de transporte**,
tratadas por `api.js`; não são medição de produção nem respostas de negócio
garantidas por cada handler. Não se inventa formato único para 502/504.
`_attachment_complete` tem adicionalmente 502 explícito quando a promoção
do arquivo falha. 503 pode ter JSON do backend ou HTML de integração.
Não há 405 na operação publicada: o guard de `_reminder_settings` o usa
para método incompatível com a rota, e não para seu método publicado.

Os erros JSON do backend usam `ErrorResponse` (`error`); respostas do
gateway podem usar `GatewayErrorResponse` (`message`). Components de
respostas reutilizam esses schemas. Sucessos complexos reutilizam
`SuccessObject` permissivo, sem inventar required/nullable de relatórios.

As regras de body foram lidas em `Portal`, `grades.parse_csv` e
`feedback.clean_new/clean_slot_request`. Contratos com conjunto exato
de campos usam `additionalProperties: false` somente onde a implementação
o exige. Exemplos: participation, student-view, busca, unlink, display-name,
settings, status do feedback, slots de anexo, prévias/envios de lembretes.
Importação/publicação/restauração/foco e aprovação/revogação de instrutor
aceitam campos adicionais no runtime e continuam permissivos.
A recusa de solicitação e conclusão de anexo aceitam body ausente ou objeto
vazio. `verify-sender` exige vazio apenas quando lembretes estão habilitados;
se desabilitados retorna antes desse guard.

Campos convertidos com `str(...)` não foram artificialmente limitados a
string de entrada. Limites do feedback após normalização não viraram limites
do texto bruto. Para dígitos validados com regex Python, não se impôs regex
ECMAScript mais estreita; os IDs fortes continuam strings com comprimento
sustentado pelo código. A implementação segue responsável por esses detalhes.

### Participation

`POST /cohorts/{code}/participation` → `setParticipation` →
`Portal._set_participation`, JWT + `portal/access`.

`ParticipationRequest`: objeto com exatamente `canvasId` (string),
`status` e `expectedStatus` (ACTIVE ou WITHDRAWN), todos obrigatórios.
Ausência de registro significa ACTIVE; `expectedStatus` é conferido antes
da idempotência. Conflito retorna 409; aluno fora da publicação, 404;
entrada inválida, 400; sem autorização, 401/403 conforme camada.
Sucesso retorna `canvasId`, `participationStatus`, `updatedAt`;
este último pode ser null para ACTIVE sem item persistido. Isso está
sustentado pelo retorno explícito e pelos testes de participação em
`backend/test_portal.py`. Notas e dados Canvas não são apagados pela operação.

## Equivalência e exceções

| Fonte | Quantidade | Missing no contrato | Extra em relação ao contrato |
| --- | ---: | ---: | ---: |
| OpenAPI | 35 | 0 | 0 |
| Terraform | 35 | 0 | 0 |
| Frontend Portal API | 35 | 0 | 0 nesta baseline |
| Backend público | 35 | 0 | 0 |

O teste frontend exige inclusão, não igualdade: publicar uma operação sem
cliente frontend é permitido pelo teste novo. O teste antigo mais estrito
é preservado, inclusive sua lista explícita de exceções vazia.

`signature(method, path)` em `tests/contracts/sources.mjs` é o único
normalizador novo: método uppercase, path literal com placeholders
preservados. Não reduz nomes de parâmetros a `{}`. A única tradução
explícita é o argumento JS `adminFeedback.setStatus(feedbackId)` para
o placeholder público `{id}` já existente no Terraform e dispatcher.

O extractor Python usa AST, sem importar runtime ou conectar à AWS.
Lê o dispatch raiz, feedback e anexos; deriva métodos do guard delegado de
reminder-settings/verify-sender. Quatro templates apenas nomeiam capturas
posicionais dos regex existentes, sem repetir lista de 35 operações.
Formato novo/desconhecido exige revisão do helper. O teste também compara
o handler efetivo da rota com `x-portal-backend-operation`.

Fora do contrato: `signupConfirmation` (Cognito direto), upload externo
`uploadAttachmentToS3`, OAuth, URL assinada de download, Canvas/SES e
serviços AWS. A obtenção/conclusão de slots e obtenção de URL pelo portal
continuam incluídas. Helpers exportados de configuração/normalização não
são operações HTTP. Novos exports desconhecidos provocam revisão no teste.

`sync_from_canvas` é fluxo interno, sem rota HTTP; `identity.handler`
é implementação legada, enquanto a Lambda publicada configura
`portal.handler`. Não há operação HTTP interna deliberadamente omitida
dos dispatchers públicos atuais. Nenhuma exceção de rota foi adicionada.

## Mutações e proteção do incidente

As mutações usam cópias em memória; J usa uma cópia Python em diretório
temporário, apagada em finally. Os originais nunca são removidos/trocados.
Cada mutação A–J confere SHA-256 do YAML, Terraform, api.js e portal.py
antes/depois. Não é necessário restaurar runtime em disco.

| Mutação | Proteção que falhou como esperado |
| --- | --- |
| A — remover participation | OpenAPI ↔ Terraform, rota ausente |
| B — adicionar rota fantasma | OpenAPI ↔ Terraform, rota extra |
| C — participation vira GET | OpenAPI ↔ Terraform, método diferente |
| D — path/placeholder errado | OpenAPI ↔ Terraform, path diferente |
| E — operationId repetido | Validação estrutural |
| F — parâmetro de path ausente | Validação estrutural |
| G — JWT vira público | Equivalência de segurança |
| H — retirar portal/access | Equivalência de scopes |
| I — chamada nova real na cópia de api.js | Inclusão frontend → OpenAPI |
| J — branch público novo na cópia do dispatcher | OpenAPI ↔ backend |

Também se testa handler backend incorreto, mutation da segurança no próprio
texto Terraform, chaves YAML duplicadas e contagem que ignora metadata.
A, C e H reproduzem as três classes pedidas para participation.
Os testes C7.2.4.1 `tests/api.mjs` e
`tests/integration/test_api_routes.py` permanecem byte a byte intactos.

## Revisão adversarial

- **BLOCKER:** nenhum encontrado na revisão local concluída.
- **IMPORTANT:** nenhum encontrado na revisão local concluída.
- **LOW — modelagem:** respostas complexas são objetos permissivos; validações
  condicionais, coerções, regex Python e normalização não são reproduzidas
  integralmente no schema. Não usar API-1 como validador de payload em runtime.
- **LOW — tooling:** parser reaproveitado do bundle de desenvolvimento do
  Playwright, cuja API não é compromisso público de estabilidade. Está isolado
  e a versão travada; atualizar Playwright deve executar estes testes.
- **LOW — extração:** leitores de Terraform/AST suportam formas atuais, não
  são interpretadores genéricos. Mudança na sintaxe de routing exige revisar
  testes. O extractor Python usa apenas stdlib; Python3 já é exigido pelo build.
- **NÃO PROBLEMA:** 35/35 rotas, nomes de parâmetros preservados, IDs únicos,
  handlers mapeados, JWT/scopes equivalentes, nenhuma rota pública esquecida;
  Cognito e uploads externos conscientemente excluídos.
- **NÃO PROBLEMA:** schemas vazios/permissivos em campos coercíveis evitam
  prometer rigidez inexistente. `updatedAt: nullable` da participation tem
  evidência explícita. Valores de dados e credenciais não entram no contrato.
- **NÃO PROBLEMA:** duplicação temporária dos testes antigos é intencional
  nesta API-1 e evita retirar proteção da C7.2.4.1.

## Plano API-2 (não implementado)

`openapi/portal.yaml → yamldecode(file(...)) → local.routes → aws_apigatewayv2_route`.

Ler paths e filtrar explicitamente somente os métodos HTTP suportados
(não contar parameters/description/extensions). Construir mapa com chave
exatamente `UPPER(method) + " " + path`; cada valor contém tipo de
autorização e scopes, derivados de `PortalJwt` e da extensão.
Manter referências de authorizer e integration no Terraform.

Preservar os addresses existentes exige manter **GET /me no recurso
`aws_apigatewayv2_route.me`**. O recurso `portal` recebe o mapa derivado
excluindo essa chave e usa `route_key = each.key`; suas 34 chaves
`portal["METHOD /path"]` permanecem iguais. Ambos passam a consumir
atributos do contrato sem manter lista manual de rotas.

Critério: após revisão independente, plano da migração deve mostrar
**0 to add, 0 to change, 0 to destroy** para as rotas, com segurança, target,
authorizer e parâmetros atuais preservados. Não precisa de state move com
esses addresses. Consolidar também `me` dentro de `portal` exigiria
`moved` explícito; isso não é necessário e não é a proposta.

Um full plan futuro pode expor drift preexistente alheio à migração
(por exemplo ACM conhecido). Isso deve ser separado e revisado; não é
autorização para aplicá-lo. Nenhum plan foi necessário nem executado em API-1.
Na API-2, adaptar leitores/testes que hoje esperam a lista literal no HCL;
preservar equivalência por plano/valores avaliados. Na API-3, retirar
duplicação antiga só após proteção equivalente e consolidar documentação.

OpenAPI não substitui validação Python, `require(teach)`, autorização
de negócio ou verificação de identidade. Não gerar cliente, Swagger UI
público, endpoint de docs nem validação automática de runtime nesta fase.

## Escopo do diff e entrega

Esperados: YAML, três helpers de testes, `tests/openapi.mjs`, registro
do teste em `package.json`, este inventário e a seção de arquitetura.
Sem dependência nova nem mudança no lockfile.

Foram conferidos contra HEAD **78 arquivos rastreados** em frontend, backend,
infra, contratos antigos e lockfile: **zero alteração**. Isso cobre runtime
e infraestrutura funcional; a adição do teste está somente em package.json.
`git diff --check` passou. O teste de dados sensíveis no contrato passou.
Os hashes abaixo são evidência local; não foram obtidos consultando produção.

| Arquivo | SHA-256 após as mutações |
| --- | --- |
| frontend/api.js | `4d0ee5555b2fbfec0cde9679bc53732d3c1fef8a45f26d952a46fd09bdeee730` |
| backend/portal.py | `9200b69ea4a7d57817d713ed8c293a8f35bf8ece95dec95962ecb2c7dce0c793` |
| infra/terraform/api.tf | `3e9f192644351313a16b8b7fe66251be7958f24d56ecd6b347da4c8ec0438b93` |
| tests/api.mjs | `f8a365190c2e0e5c6227bf83af0c4a8f3595ffaf85d3f24be4dbc858853941e7` |
| tests/integration/test_api_routes.py | `15ccdc40be15291d0dff3201d0149a4dbd8a84210a4903cd3a7f8e4b8a71ee09` |
| openapi/portal.yaml | `61479fe37c8981747f8a5b20988e3bb47be53839365f998355e09d59424c8347` |

Alterações: `openapi/portal.yaml`, `tests/openapi.mjs`,
`tests/contracts/{sources.mjs,openapi.mjs,backend_routes.py}`,
`package.json`, `docs/arquitetura.md` e `docs/api-1.md`.
O diff integral é entregue separadamente como artefato local de revisão,
incluindo os arquivos novos, sem adicioná-los ao index.

**Zero commit, push, deploy, apply, alteração de usuário ou alteração AWS.**
API-2 não implementada. Entrega interrompida para revisão/aprovação.

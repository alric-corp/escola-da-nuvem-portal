# AUTO-2.3 — infraestrutura de lembretes, desabilitada

## Encerramento — 07/10/2026

**AUTO-2.3 concluída em produção, infraestrutura desabilitada.** As partes A,
B e C foram verificadas. A habilitação operacional permanece na AUTO-4, que
não foi iniciada. Os horários deste registro usam `America/Sao_Paulo`, salvo
timestamps com offset explícito.

| Parte | Evidência de conclusão |
| --- | --- |
| A — deploy original | Apply do plano aprovado em 05/10, 01h44min25s–01h45min04s: **12 add / 7 change / 0 destroy**, 19 recursos concluídos, state 56 → 58 |
| B — primeiro Canvas Sync natural | Ocorrência de 05/10 às 06h; Lambda executou das 06h00min46s às 06h01min30s, **1 invocação / 0 erros**, sem sync manual |
| C — gate LIVE | Após o ajuste autorizado para 23h30, uma invocação direta em 06/10 às 23h40min07s retornou **`infrastructure-disabled`**; **1 invocação / 0 erros / 0 throttles** nesse ajuste |
| Convergência | Full plan após o ajuste: somente a criação conhecida de ACM; **0 alterações AUTO-2.3**, 35 rotas sem ação; planos consumidos removidos |

### Parte B — publicação e prova

| Turma | SYNC legado | SYNC_RUN | Etapas | Prova |
| --- | --- | --- | --- | --- |
| BRSA0257 | `published`, 56 alunos | `succeeded` | Catálogo e matrícula `succeeded`; notas `published` | Publicação existente e correspondente, metadataVersion válido |
| BRSA0267 | `published`, 59 alunos | `succeeded` | Catálogo e matrícula `succeeded`; notas `published` | Publicação existente e correspondente, metadataVersion válido |

Ambos registraram o slot real `2026-10-05T09:00:00Z`,
`source=portal.scheduler`, `attemptNumber=1` e executionId válido. O tipo
`canvas-sync` foi conferido no input do Scheduler; não é um campo persistido
em SYNC_RUN. Logs técnicos sem PII ou evento bruto. A prova do primeiro sync
foi observada após o deploy original; o ajuste posterior mudou somente a
validação de horário em `automatic_reminders.py` entre os 14 módulos do ZIP.

### Travas no encerramento

- BRSA0257 e BRSA0267: schedules `DISABLED`, terça/sexta **23h30**, flexible `OFF`.
- Worker: `AUTOMATIC_REMINDERS_ENABLED=false`; IAM mínimo e configuração verificados.
- `AUTO_REMINDER#=0`, nenhum novo `REMINDER#` automático, nenhum envio automático;
  `REMINDER_SETTINGS` ausente e inalterado nas duas turmas.
- Canvas Scheduler continua `ENABLED` às 06h/18h, com contexto nativo do Scheduler.
- Há duas invocações sintéticas autorizadas no histórico: a das 23h00 retornou
  `window-expired` e não comprovou o gate; a das 23h40 comprovou
  `infrastructure-disabled`. Nenhuma foi uma execução automática de schedule.
- Nenhum dry-run real ou tráfego artificial de auth/delivery foi executado.
- `senderUserId`, settings, quotas/readiness SES, dry-run real e eventual
  habilitação continuam reservados à AUTO-4, em uma etapa separada.

## Ajuste de horário solicitado em 06/10/2026

Calendário do worker e dos dois schedules alterado para terça/sexta às **23h30**
em `America/Sao_Paulo`, com janela de 30 minutos, terminando à meia-noite.
O SYNC_RUN exigido continua sendo o das 18h da mesma data local da ocorrência.
Schedules permanecem `DISABLED` e `AUTOMATIC_REMINDERS_ENABLED=false`.
A ordem de validação continua calendário, janela e gate; o smoke LIVE sintético
na janela retornou `infrastructure-disabled`, sem construir clientes AWS.
REMINDER_SETTINGS, dry-run real e habilitação continuam fora deste ajuste.
Os hashes e resultados históricos abaixo pertencem às revisões anteriores.

### Validação em produção desse ajuste

- Apply em 06/10/2026, das 23h12min39s às 23h13min17s, São Paulo:
  **0 added / 7 changed / 0 destroyed**; cinco ZIPs de Lambda e dois horários.
- State serial 58 → 60. IAM e demais configurações das Lambdas preservados;
  todas `Active/Successful`. Canvas Scheduler continua habilitado às 06h/18h.
- ZIP SHA-256: `aed414b934632fe414a2597572c6500136d8578cf4e72c5e381cb58884fa6800`.
- Testes locais: backend 290, integração Moto 39 e Terraform 4 passaram.
  O teste instrumentado do próprio ZIP confirmou zero construções de Repository,
  SESMailer e clientes AWS no caminho LIVE desabilitado.
- Uma invocação direta às **23h40min07s**, dentro da janela autorizada, com
  `scheduledFor=2026-10-07T02:30:00Z` e `dryRun=false`, retornou
  **`infrastructure-disabled`**, sem erro e com todas as contagens zeradas.
  Não houve retry. O log contém somente resumo técnico, sem PII ou evento bruto.
- Leituras posteriores: `AUTO_REMINDER#=0`, `REMINDER#=0` e
  `REMINDER_SETTINGS` ausente nas duas turmas; dados de lembrete e settings
  inalterados. Schedules continuam `DISABLED` e gate `false`.
  A ausência de operações AWS de domínio nesse caminho é comprovada pelo código
  e hash publicados, resposta e teste instrumentado local; não há contadores
  por chamada AWS instrumentados em produção.
- Full plan de auditoria: **1 add / 0 change / 0 destroy**, exclusivamente
  `aws_acm_certificate.portal`; AUTO-2.3 convergida e 35 rotas sem ação.
  O plano aplicado foi removido após confirmação de convergência.
- Nenhum dry-run real, configuração de remetente, habilitação ou início da AUTO-4.

## Registro da revisão original

Implementação **local, sem commit, push, apply ou deploy**. Nenhum e-mail real,
endpoint de envio ou escrita AWS foi executado. REMINDER_SETTINGS real não foi
consultado nem alterado. Os dois schedules novos e o gate do adaptador estão fechados.

## AUTO-2.2 encerrada

- SHA: `f9223539b11e5d90fa9d2ae70efb94421fd00e55`.
- Commit: `feat: adicionar worker de lembretes automáticos`.
- Push para `alric-corp/main`, sem force, somente os cinco arquivos aprovados.
- [CI 37247656097](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37247656097):
  Frontend, Backend/Moto e Terraform verdes. AUTO-2.3 começou depois do CI completo.
- Fechamento: backend 282; integração 39; Node 177/177; browser 19/19;
  OpenAPI 21; Terraform 3; build e diff check passaram.
- A conferência corrigiu o limite explicitamente solicitado: sync terminado às
  20h01 não autoriza uma tentativa às 20h05. O limite é a ocorrência original das
  20h, inclusive. Houve RED/GREEN e nova mutação desse limite, além das 20 anteriores.

## Mapa e arquivos

| Arquivo | Alteração AUTO-2.3 |
| --- | --- |
| `backend/automatic_reminders.py` | Thin adapter `handler`, validação do evento/configuração, clientes e resposta para retry assíncrono |
| `backend/sync_runs.py` | Normalização estrita do contador nativo do Scheduler na borda |
| `backend/canvas_sync.py` | Usa essa normalização antes de chamar o domínio existente |
| `backend/test_reminders.py` | Cinco testes do adaptador automático |
| `backend/test_canvas.py` | Um teste do adaptador Canvas, com evento novo e legado |
| `infra/terraform/api.tf` | ConditionCheckItem da API limitado por função de origem |
| `infra/terraform/canvas-sync.tf` | ConditionCheckItem e input nativo do Scheduler existente |
| `infra/terraform/automatic-reminders.tf` | Worker, IAM, grupo/schedules desabilitados, retry e alarmes |
| `infra/terraform/tests/automatic-reminders.tftest.hcl` | Contrato dos recursos, segurança, gates e contexto |
| `docs/auto-2.3.md` | Este registro |

Frontend, OpenAPI, dependências e GitHub Actions têm zero diff. O domínio e as
regras da AUTO-2.2 permanecem no worker; não houve cópia de elegibilidade, dedupe,
prova, claim/lease ou reserva. Nenhum endpoint novo.

## IAM e pacote compartilhado

As funções existentes identity/API, canvas_sync, reminder_events/delivery e
auth_trigger usam o mesmo `data.archive_file.api`. O ZIP inclui os 14 módulos
runtime, incluindo automatic_reminders.py e sync_runs.py, sem testes, pycache ou
pytest cache. Os módulos necessários foram comparados byte a byte com os fontes.

SHA-256 do ZIP revisado:
`3bc39b90230a5ef688d276fab7e8a6f3bfd3a794ae229cf7af636dd12594587a`.

O plan mostra atualização de source_code_hash nas quatro funções existentes. Não
altera seus handlers, memória, timeout, ambiente ou role. A futura publicação desse
pacote inclui também AUTO-2.1/2.2; não é seguro publicar a Lambda API isoladamente
antes da permissão nova.

| Caminho | Autorização adicionada / preservada |
| --- | --- |
| API | ConditionCheckItem somente na tabela atual, condicionado ao ARN sem versão da função identity |
| Canvas Sync | ConditionCheckItem na tabela atual; outras ações existentes preservadas |
| Worker | GetItem, Query, PutItem e ConditionCheckItem somente na tabela atual |
| Worker/S3 | Somente GetObject em `cohorts/*` do bucket de importações |
| Worker/SES | GetEmailIdentity institucional, GetAccount e SendEmail com FromAddress institucional e configuration set existente |
| Worker/logs | CreateLogStream e PutLogEvents no próprio log group |
| Delivery | Nenhuma nova autorização efetiva de ConditionCheckItem |
| Auth trigger | Continua sem DynamoDB |

A API e delivery **já compartilham a role api**. Por isso a ação nova fica em
statement separado com `ArnEquals: lambda:SourceFunctionArn`, sem IfExists. O ARN
é composto dos dados de ambiente e nome atual para evitar ciclo role/policy/Lambda.
O teste exige essa condição: outra Lambda com a mesma role não satisfaz a concessão.
Fundamento: [condição de função de origem da Lambda](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html).

Não foi adicionada a permissão fictícia `dynamodb:TransactWriteItems`: a AWS
autoriza as ações subjacentes, incluindo
[ConditionCheckItem](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).
O worker usa Put nas reservas/finalizações e não usa counters/UpdateItem,
DeleteItem ou Scan. Não recebe Cognito, segredo Canvas, CreateEmailIdentity,
escrita S3, acesso ao bucket de feedback ou permissão administrativa SES.
GetAccount usa Resource `*` porque essa consulta não tem recurso individual.

## Lambda e adaptadores

`automatic_reminders.handler`, Python 3.13/arm64, 256 MB, timeout 300 s e concorrência
reservada 2. Memória e timeout seguem o porte do Canvas; uma invocação atende uma
turma e mantém envios sequenciais com intervalo de 250 ms. O worker conserva a
parada voluntária com menos de dez segundos e o limite original de 30 minutos.

O handler exige evento com chaves exatas, version=1, dryRun booleano e cohortCode
pertencente à allowlist configurada por Terraform. Não confia no payload para
sender, recipients ou publicação. O domínio continua recebendo o contexto original.
Nenhuma identidade SES é criada pelo automático.

`AUTOMATIC_REMINDERS_ENABLED=false` espelha conservadoramente o gate fechado de
infraestrutura: mesmo uma invocação live direta fica bloqueada. Dry-run explícito
continua disponível, sem claim/reserva/SES SendEmail. A habilitação futura precisa
revisar esse gate junto dos schedules; REMINDER_SETTINGS.automaticEnabled permanece
o gate operacional separado de cada turma.

## Contexto real do Scheduler

Canvas conserva cron `cron(0 6,18 * * ? *)`, America/Sao_Paulo, flexible OFF,
target, role e maximum_retry_attempts=0. O único delta do schedule é o input:

```json
{
  "source": "portal.scheduler",
  "type": "canvas-sync",
  "scheduledFor": "<aws.scheduler.scheduled-time>",
  "executionId": "<aws.scheduler.execution-id>",
  "attemptNumber": "<aws.scheduler.attempt-number>"
}
```

O input do automático adiciona `version: 1`, `cohortCode`, `dryRun: false` e usa
`type: automatic-reminders`. Nenhum e-mail, senderUserId, studentId ou publicationId.

São [atributos nativos documentados pela AWS](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html).
O target Lambda exige [JSON válido antes da invocação](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_Target.html).
Por isso attemptNumber fica entre aspas no template; o adaptador converte a string
decimal positiva para int, sem inventar data ou tentativa. Eventos Canvas sem
contexto agendado continuam com o comportamento legado.

Terraform `jsonencode` [escapa `<` e `>`](https://developer.hashicorp.com/terraform/language/functions/jsonencode).
Dois replace removem somente esses escapes no input, preservando JSON válido e os
keywords literais documentados. Os testes conferem o texto bruto e o JSON; o plan
final confirma os três placeholders literais. Não se depende de a AWS reconhecer
uma representação escapada não exemplificada na documentação.

## Schedules, autorização e retry

| Propriedade | Valor |
| --- | --- |
| Turmas | BRSA0257 e BRSA0267, variável set `automatic_reminder_cohorts` |
| Frequência atual | `cron(30 23 ? * TUE,FRI *)` |
| Timezone | America/Sao_Paulo, sem offset fixo |
| Flexible window | OFF |
| Estado novo | **DISABLED**, literal no código, teste e plan |
| Gate do adaptador | false |
| Retry de entrega Scheduler | Máximo 2, idade máxima 1800 s |
| Retry assíncrono Lambda | Máximo 2, idade máxima 1800 s |

O grupo dedicado permite restringir a trust policy do Scheduler por conta e
SourceArn do grupo. AWS exige o [ARN do grupo nessa condição](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html),
nunca o ARN de um schedule individual. A execution role só permite InvokeFunction
na worker. Não existe URL de função nem rota HTTP.

Não se criou aws_lambda_permission: na mesma conta a
[execution role autoriza a invocação do Scheduler](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html).
Criar uma concessão genérica ao principal Scheduler seria redundante. Operadores
que já tenham IAM de InvokeFunction continuam sujeitos ao IAM; o campo source do
evento é validação de formato, não autenticação de quem chamou.

Scheduler entrega ao serviço Lambda de forma assíncrona. Seu retry não observa a
resposta do worker. O adaptador converte partial/retryable em RuntimeError sanitizado
para solicitar [retry assíncrono da Lambda](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html).
Contenção de lease ativo também solicita retry: o lease pode ser de uma tentativa
interrompida. Isso não reabre sending/unknown nem permite sobrepor o owner atual.
Recusas de negócio (sync/configuração/sender/janela/already-finished) retornam
normalmente e não geram Lambda Errors.

As duas idades de fila não substituem a janela de negócio: uma entrega atrasada
pode chegar depois das 20h30, mas o worker a recusa antes de escrever/enviar. Não há
garantia de esgotar todos os destinatários em duas retentativas; pendências ficam
no resumo e uma retomada operacional dentro da mesma janela preserva o dedupe.

## Observabilidade e limites do MVP

- Log group próprio, retenção de 30 dias; início/resumo/motivos sem PII.
- Alarmes Lambda Errors e Throttles, Sum >=1 em 300 s, tópico alerts existente.
- Missing data é notBreaching; nenhum alarme de ausência com schedules desligados.
- Contenção de lease e falha parcial retomável podem gerar alerta técnico durante
  recuperação; o alarme não significa necessariamente falha definitiva ou duplicidade.
- Não havia DLQ de Scheduler para reutilizar. Não se adicionou fila nesta etapa.
  Falha de entrega anterior à invocação não aparece no log/Errors da worker; métricas
  nativas do Scheduler precisam entrar no checklist de ativação. DLQ/alarme de
  entrega e alertas de skips/ausência ficam para a revisão AUTO-4/5.
- Volume real e quota SES serão conferidos antes de habilitar. Nesta rodada não se
  enviou e-mail para medir throughput. A concorrência reservada limita execuções,
  não garante por si só uma taxa SES global.

## Testes e mutações

| Validação final AUTO-2.3 | Resultado |
| --- | ---: |
| Backend | 288 passaram (282 + 6 de adaptadores) |
| Integração/Moto | 39 passaram |
| Node local / UTC | 177 / 177 |
| Browser local / UTC | 19 / 19 |
| OpenAPI | 21 passaram |
| Terraform test | 4 passaram |
| Build / fmt-check / validate / diff-check | Passaram |
| Mutações infra | 12/12 detectadas |
| Mutações OpenAPI/Terraform existentes | 11 cenários + 5 rejeições esperadas |

RED dos adaptadores foi observado antes da implementação. Casos: evento nativo,
allowlist/chaves/version/tipos inválidos recusados antes dos clientes, gates/dry-run,
partial retomável, lease ativo versus skips de negócio, Canvas novo e legado.

Mutações em cópias descartáveis, com providers mockados e hashes conferidos:

| Caso | Mutação detectada |
| --- | --- |
| A | Remover ConditionCheckItem da API |
| B | Remover ConditionCheckItem do Canvas |
| C | Conceder dynamodb:* ao worker |
| D | Schedule ENABLED |
| E | Timezone UTC |
| F | Cron diferente |
| G | E-mail no input |
| H | Canvas perde scheduled-time nativo |
| I | ConditionCheckItem vaza da API para outra origem |
| J | Idade assíncrona sobe para seis horas |
| K/L | Placeholder fica escapado no input do worker/Canvas |

Nenhuma mutação foi feita no workspace. Sem alterações de workflow, actionlint não
foi necessário. Falhas de sandbox ao abrir localhost/providers foram ambientais;
as suítes completas passaram fora dessa restrição, usando apenas dados simulados.

## AWS × state e full plan

Comparação somente leitura em **2026-10-05 02:16:12 UTC** (04/10 23:16:12 São Paulo),
state serial 56: **105 comparações, zero divergências**. Conferidos quatro Lambdas
(incluindo hashes/ambientes), quatro roles/trust/policies, Scheduler Canvas,
quatro log groups e três alarmes relevantes. Respostas brutas e state ficaram em
memória; o relatório reteve apenas campos/resultados e hashes técnicos.

GetAccountSettings mostrou 400 de concorrência total/não reservada, suficiente
para a reserva nova de 2. Não houve alteração da concorrência real.

Full plan normal, refresh ligado, **sem targets**, `-lock=false` para não escrever
lock remoto. Nenhum apply, state push, import ou state move. Um primeiro plan
motivou a proteção de placeholders; depois dos testes o plan foi gerado novamente.

Conferência final em **2026-10-05 02:39:44 UTC**: **13 add / 7 change / 0 destroy**.
Exit code 2 significa diferenças propostas, não erro. Breakdown:

| Resource | Ação | Motivo | AUTO-2.3? | Esperado? |
| --- | --- | --- | --- | --- |
| aws_iam_role_policy.portal_data | update | ConditionCheckItem só para identity | Sim | Sim |
| aws_iam_role_policy.canvas_sync | update | ConditionCheckItem para prova SYNC_RUN | Sim | Sim |
| aws_scheduler_schedule.canvas_sync | update | Somente input de contexto | Sim | Sim |
| aws_lambda_function.identity | update | ZIP compartilhado | Sim | Sim |
| aws_lambda_function.canvas_sync | update | ZIP compartilhado | Sim | Sim |
| aws_lambda_function.reminder_events | update | ZIP compartilhado | Sim | Sim |
| aws_lambda_function.auth_trigger | update | ZIP compartilhado | Sim | Sim |
| aws_cloudwatch_log_group.automatic_reminders | create | Logs próprios | Sim | Sim |
| aws_iam_role.automatic_reminders | create | Role do worker | Sim | Sim |
| aws_iam_role_policy.automatic_reminders | create | Ações mínimas do worker | Sim | Sim |
| aws_lambda_function.automatic_reminders | create | Worker dedicado | Sim | Sim |
| aws_lambda_function_event_invoke_config.automatic_reminders | create | Retry assíncrono limitado | Sim | Sim |
| aws_scheduler_schedule_group.automatic_reminders | create | Escopo da trust policy | Sim | Sim |
| aws_iam_role.automatic_reminders_scheduler | create | Execution role dedicada | Sim | Sim |
| aws_iam_role_policy.automatic_reminders_scheduler | create | InvokeFunction somente worker | Sim | Sim |
| aws_scheduler_schedule.automatic_reminders[BRSA0257] | create | Schedule DISABLED | Sim | Sim |
| aws_scheduler_schedule.automatic_reminders[BRSA0267] | create | Schedule DISABLED | Sim | Sim |
| aws_cloudwatch_metric_alarm.automatic_reminders[Errors] | create | Alerta técnico | Sim | Sim |
| aws_cloudwatch_metric_alarm.automatic_reminders[Throttles] | create | Alerta técnico | Sim | Sim |
| aws_acm_certificate.portal | create | Certificado ausente, drift conhecido | **Não** | Conhecido, fora desta entrega |

**AUTO-2.3 isolada: 12 add / 7 change / 0 destroy.** Nenhum delete/replacement.
As 35 routes estão no-op. As quatro Lambdas existentes só mudam source_code_hash
e last_modified computado. Os dois novos schedules estão DISABLED no binário do
plan; todos os placeholders estão literais. Canvas mantém todo atributo além do input.

O refresh também apresentou diferenças sem ações corretivas planejadas: request_models
null/map vazio em cinco rotas, deployment_id do stage, estimativa de usuários Cognito,
representação do item inicial, inline_policy computada da role e atributos agregados
do bucket feedback. As políticas efetivas comparadas diretamente eram iguais ao
state; esses deltas de refresh não viraram updates desses recursos. Não se corrigiu
nenhum drift externo automaticamente.

Plan e logs brutos ficam somente no diretório temporário privado
`/private/tmp/auto23-5o3vbgnn`, fora do Git. O plano é evidência de revisão, **não uma
autorização de apply**, e contém ACM fora de escopo. SHA-256 do plan final:
`2e742f387d97ed1cb8db06aa130f81907ce4f052ed8027d3cd74778b2b160a51`.

## Revisão adversarial e próxima aprovação

- **BLOCKER local: 0. IMPORTANT local: 0.** Conferidos ConditionCheckItem, isolamento
  da role compartilhada, pacote, contexto real/literal, janela/retry, DISABLED,
  IAM/SES/DynamoDB, logs, duas turmas, ausência de configuração real e full plan.
- **Pré-condição de deploy permanece:** IAM real ainda não foi alterado. Não publicar
  o pacote AUTO-2.1/2.2/2.3 isoladamente com as policies antigas. As dependências HCL
  colocam as policies antes das funções e o input Canvas depois da função atualizada.
- **LOW:** sem DLQ/alarme de entrega do Scheduler e sem alerta de skip/ausência;
  explicados acima e a revisar antes da ativação. Contenção recuperável pode alertar.
- **NÃO PROBLEMA:** ZIP altera hashes de handlers sem delta funcional; contador de
  tentativa via string é normalizado na borda; não criar lambda_permission para
  Scheduler na mesma conta; ACM não pertence à automação.

Sequência futura, ainda sujeita a aprovação: revisar este diff e plan; commit/push/CI
da AUTO-2.3; decidir separadamente como excluir o ACM de um plano aplicável; revisar
o pacote e a ordem IAM → funções → input/schedules; publicar infraestrutura com
schedules DISABLED e gate false; conferir estado/hashes/permissões. Só em AUTO-4
tratar REMINDER_SETTINGS, dry-run real, observabilidade/quota e habilitação por turma.

Nesta entrega: **zero commit da AUTO-2.3, zero apply, zero deploy, zero ativação,
zero configuração real de turma, zero envio real**. Parar para aprovação.

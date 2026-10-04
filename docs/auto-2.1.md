# AUTO-2.1 — domínio compartilhado de lembretes e prova do sync

Implementação local para revisão. Nenhum schedule, worker, Lambda, IAM, endpoint,
configuração real ou envio automático é criado nesta etapa.

## Base

HEAD inicial: `53b2376` (`fix: docs`), árvore limpa. Esse commit já continha a frase
aprovada “conversar com a pessoa instrutora”; não foi necessário outro commit.

Baseline: Node 177 em cada fuso, browser 19 em cada fuso, backend 220, integração 24,
OpenAPI 21, Terraform 3; build e validate passaram. Os servidores locais do browser
e os providers Terraform precisaram de execução fora do sandbox.

## Remetente automático

`reminders.reminder_settings` produz somente `senderUserId`, `automaticEnabled`,
`version` inteiro positivo e `updatedAt` normalizado para UTC. Destino futuro:
`COHORT#<code>/REMINDER_SETTINGS`. O helper não grava configuração.

`automatic_sender_readiness` lê a configuração, resolve o e-mail do vínculo atual
`COHORT#<code>/TEACH#<senderUserId>` e exige também o vínculo reverso
`USER#<senderUserId>/TEACH#<code>`. Essa é a fonte persistida existente; não há uma
consulta nova ao Cognito. Readiness usa `SESMailer.readiness`, sem criar identidade.
Ausência, configuração inválida, flag desligado, vínculo removido ou e-mail inválido
falham sem escolher outro remetente. Não há e-mail nem readiness em REMINDER_SETTINGS.

O gate de infraestrutura futuro e `automaticEnabled` são independentes: os dois
precisarão permitir o envio. Calendário e ativação pertencem às etapas posteriores.

## Reserva e envio compartilhados

`fixed_publication`, `evaluate_recipient`, `message_for`, `reserve_reminder` e
`send_reserved_reminder` são as primitives para o futuro worker. Os adaptadores
manuais continuam responsáveis por JWT, `require(teach)`, previewHash e formato HTTP.

A reserva condiciona, na mesma transação:

- METADATA igual à publicação/configuração lida;
- PARTICIPATION ausente (ACTIVE implícito) ou igual ao registro ACTIVE lido;
- REMINDER ausente ou igual ao `failed` anterior.

`Repository.transaction(..., checks=...)` gera ConditionCheck real, sem criar um
registro PARTICIPATION para alunos implicitamente ativos. O envio manual individual
e o batch usam essa mesma reserva. Uma desistência concorrente antes da transação
causa 409 individual ou `skipped/withdrawn` no batch, sem reserva e sem SES.

A fronteira é a reserva: se ela venceu com o aluno ACTIVE, uma desistência posterior
não recolhe o e-mail autorizado/em trânsito. Nenhuma transação envolve o SES.

A chave permanece `REMINDER#<publicationId>#<studentId>`. `sent`, `sending` e `unknown`
não reabrem. Rejeição definitiva mantém `failed`; publicação nova permite chave nova.
Conflitos restantes preservam o comportamento manual `publication-changed` no batch.

## SYNC_RUN

Contexto opcional explícito do Canvas:

```json
{
  "source": "portal.scheduler",
  "type": "canvas-sync",
  "scheduledFor": "2026-10-06T18:00:00-03:00",
  "executionId": "execution-example",
  "attemptNumber": 1
}
```

O exemplo é sintético. `scheduledFor` deve identificar exatamente 06h ou 18h em
`America/Sao_Paulo`, com timezone. A chave usa o instante UTC canônico:
`COHORT#<code>/SYNC_RUN#<scheduledFor>`. `evening_sync_key` deriva as 18h da mesma
data local de uma ocorrência automática, incluindo as regras IANA de horário de verão.

`executionId` e `attemptNumber` são telemetria de tentativa; não compõem a chave.
Uma tentativa com número maior substitui a anterior condicionalmente. Duplicatas e
tentativas antigas são recusadas sem sobrescrever a prova; uma finalização atrasada
também falha na comparação condicional. A integração real dessa telemetria e do
input do Scheduler será revisada na AUTO-2.3. Não há orquestração de retries aqui.

O registro contém origem, ocorrência, tentativa, início/fim, status, publicationId,
metadataVersion e etapas. Estados: `running` (incompleto), `succeeded`, `failed`.
Catálogo e matrícula precisam ter sucesso; notas precisam terminar `published` ou
`unchanged`. Uma falha de catálogo compartilhado invalida a prova de cada turma
dependente, sem impedir turmas independentes.

Na publicação, a prova integra a mesma transação de METADATA/PUB. Em `unchanged`,
a prova identifica a publicação comparada e faz ConditionCheck do METADATA dessa
comparação. Não relê um current posterior para atribuí-lo ao sync. O hash inclui
updatedAt/updateKind, distinguindo uma restauração para o mesmo ID. Mudança da
configuração do curso durante a leitura do Canvas também impede sucesso da prova.

Sem contexto agendado, o sync mantém o caminho legado e não cria SYNC_RUN. O SYNC
legado conserva inclusive publicationId nulo em `unchanged`. Falha do monitor de
validade do token, após os dados, não invalida uma prova já concluída.

Os novos registros não incluem evento bruto, nomes, e-mails, mensagens ou tokens.

## Validação e próxima etapa

RED comprovou envio indevido quando a desistência ocorria entre leitura e reserva,
e quando o segundo aluno se tornava desistente durante o lote. As condições reais
foram verificadas com Moto. Comparação contra o HEAD encontrou respostas idênticas
em 15 cenários manuais sem concorrência.

Mutações A–J foram executadas em cópias temporárias: 11 variantes detectadas (J foi
verificada separadamente para individual e batch). Os hashes dos fontes e testes
permaneceram iguais aos verificados após as mutações; nenhum mutante foi aplicado
ao workspace.

| Mutação | Resultado |
| --- | --- |
| A — retirar ConditionCheck de participação do Repository real | Detectada pelo Moto |
| B — permitir WITHDRAWN | Detectada |
| C — recusar ACTIVE implícito | Detectada |
| D — adicionar slot à chave REMINDER | Detectada |
| E — unchanged sem publicationId | Detectada |
| F — evento manual inventar prova agendada | Detectada |
| G — chave usar o relógio em vez de scheduledFor | Detectada |
| H — prova adotar current posterior à comparação | Detectada |
| I — persistir e-mail em REMINDER_SETTINGS | Detectada |
| J — adaptador manual ignorar reserva compartilhada | Detectada nos dois adaptadores |

| Validação | Baseline | Final |
| --- | ---: | ---: |
| Node, fuso local / UTC | 177 / 177 | 177 / 177 |
| Browser, fuso local / UTC | 19 / 19 | 19 / 19 |
| Backend unitário | 220 | 249 |
| Integração, incluindo Moto | 24 | 32 |
| OpenAPI | 21 | 21 |
| Terraform test, providers mockados | 3 | 3 |
| Build / Terraform validate / diff check | Passaram | Passaram |

O ZIP local inclui `sync_runs.py` e os cinco módulos runtime alterados com bytes
iguais aos fontes; os testes continuam excluídos. O pacote é compartilhado pelas
Lambdas existentes: a revisão de publicação desse pacote pertence à etapa de deploy,
sem mudança de recursos nesta rodada.

Revisão adversarial local: 0 BLOCKER e 0 IMPORTANT. Foram revisadas resolução de
remetente, remoção de vínculo, prova de published/unchanged, slots 06h/18h, corrida
de publicação, tentativas concorrentes, WITHDRAWN antes/depois da reserva, dedupe,
privacidade, imports e regressão manual. Não há ciclo de importação novo.

Limite de integração para AUTO-2.3: o contexto agendado é sintético nesta etapa. O
input real deve fornecer a ocorrência original e a telemetria de tentativa coerente;
reentregar o mesmo attemptNumber não inicia outra execução de sync nem substitui a
prova existente. Essa integração ainda não foi ativada ou validada na AWS.

AUTO-2.2 poderá compor essas primitives com o worker, os gates de calendário/frescor
e o registro AUTO_REMINDER da ocorrência. Esta etapa não cria AUTO_REMINDER, worker,
claim de envio, política de retry, schedule ou recurso AWS. Frontend, OpenAPI e
recursos Terraform permanecem sem alteração.

As oportunidades futuras continuam terça e sexta às 20h em America/Sao_Paulo, sem
garantia de dois e-mails semanais: a mesma publicação já enviada continua deduplicada.
AUTO-2.2 deverá fixar a ocorrência e a prova das 18h, tratar turmas independentemente,
respeitar ambos os gates e limitar retries elegíveis à mesma ocorrência por até 30
minutos. `sending` e `unknown` não serão reabertos; não haverá fallback para publicação
antiga ou outro remetente. Nenhuma dessas regras de orquestração foi antecipada aqui.

Entrega local sem commit, push, deploy, apply, chamada AWS ou e-mail real.

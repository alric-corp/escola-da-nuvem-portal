# AUTO-2.2 — worker de lembretes automáticos

Implementação aprovada para commit, sem ativação. Nenhuma Lambda, IAM,
Scheduler, rota HTTP ou configuração real foi criada. Nenhum e-mail real foi enviado.

## Fechamento da AUTO-2.1

- Commit: `c06ff65f41354f8df1454a9b51bc62fb549c58ff`.
- Mensagem: `feat: preparar domínio compartilhado de lembretes automáticos`.
- Push: `alric-corp/main`, sem force.
- [CI 37239073052](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37239073052):
  backend/Moto, frontend e Terraform concluídos com sucesso.
- Safety check: os dez arquivos aprovados, hashes de código/testes iguais à revisão,
  nenhuma alteração em frontend, OpenAPI, Terraform ou dependências.
- AUTO-2.2 começou somente após esse CI, com árvore limpa.

## Entrada e configuração

`backend/automatic_reminders.py:run` é um worker interno com repository, mailer,
relógio, orçamento de tempo e logging injetáveis. Não cria clientes AWS nem possui
handler Lambda nesta etapa. O adaptador real pertence à AUTO-2.3.

O contexto exige somente `source=portal.scheduler`, `type=automatic-reminders`,
`scheduledFor`, `executionId` e `attemptNumber`. Campos extras são recusados.
Remetente, destinatários, turmas e habilitação não vêm do evento.

As turmas são uma lista explícita da configuração do chamador; não há códigos nem
e-mails de produção fixados no Python. O adaptador futuro deverá configurar as duas
turmas aprovadas. Não há descoberta automática de todas as turmas.

`enabled=False` e `dry_run=True` são os padrões. Envios exigem `enabled=True` e
REMINDER_SETTINGS habilitado. O gate de infraestrutura é fornecido pelo adaptador
futuro; este worker não consulta ou modifica o estado de um Scheduler.

## Ocorrência e calendário

Horário definitivo decidido na AUTO-4 (07/10/2026): 20h. O horário temporário de
23h30 usado na validação da AUTO-2.3 foi removido.

- Toda ocorrência é exatamente às 20h em `America/Sao_Paulo`, usando regras IANA,
  inclusive DST. Outro horário, segundo ou fração é evento inválido, sem clientes AWS.
- LIVE (`dryRun=false`) segue o calendário operacional: somente terça e sexta. Em
  outro dia o resultado é `not-due`, antes de qualquer leitura ou cliente AWS, mesmo
  com o gate de infraestrutura aberto.
- Dry-run (`dryRun=true`) é diagnóstico: qualquer dia entre 21h30 e 22h, mantendo
  `scheduledFor` às 20h da mesma data local, com as mesmas provas
  (SYNC_RUN das 18h do mesmo dia, publicação atual, REMINDER_SETTINGS, vínculos e
  readiness) e zero escrita, reserva, AUTO_REMINDER ou SendEmail. Não há exceção por
  data; o resultado traz `status=dry-run` e `dryRun=true`, sem estado persistido.
- A ocorrência é turma + `scheduledFor` original, normalizado em UTC.
- Janela LIVE: de 20h inclusive até 20h30 exclusive. Janela do dry-run: de 21h30
  inclusive até 22h exclusive, conforme ajuste autorizado na AUTO-4 em 07/10/2026.
  O diagnóstico não amplia a janela LIVE nem o limite das 20h para a prova do sync.
  Ajuste temporário autorizado em 09/10: somente BRSA0257 usa 00h30–01h do dia
  seguinte, preservando a ocorrência das 20h e sua prova das 18h. BRSA0267 permanece
  com diagnóstico às 21h30–22h até a restauração definitiva após a validação.
- Retry não troca scheduledFor nem reinicia a janela; executionId/attemptNumber
  são telemetria, inclusive quando uma reentrega mantém o mesmo evento.
- O relógio é conferido novamente antes de cada reserva. Não inicia novas reservas
  depois da janela ou quando o orçamento informado é inferior a dez segundos.
- Terça e sexta são oportunidades: publicação já enviada continua deduplicada.

## Prova, publicação e remetente

O worker busca deterministicamente o SYNC_RUN das 18h da mesma data local. Exige
origem agendada, status succeeded, catálogo e matrícula succeeded, notas published
ou unchanged, horários coerentes e término até as 20h da ocorrência original,
inclusive. Tentativa posterior não amplia esse limite. SYNC legado, slot das 06h,
prova antiga, falha ou execução incompleta não autorizam envio.

`publicationId` e `metadataVersion` precisam corresponder ao METADATA atual. A
publicação fica fixada na primeira aquisição da ocorrência e não muda na retomada,
mesmo se houver outra publicação com prova válida. Não há fallback.

O remetente usa `automatic_sender_readiness` da AUTO-2.1. REMINDER_SETTINGS, ambos
os vínculos e readiness precisam permitir. Não chama ensure_identity. A ocorrência
guarda versão e hash da configuração/vínculos, sem copiar e-mail ou senderUserId.
Troca de remetente/configuração interrompe a ocorrência, sem escolher substituto.

## AUTO_REMINDER e lease

Chave: `COHORT#<code>/AUTO_REMINDER#<scheduledFor UTC canônico>`.

O item contém ocorrência, publicação/metadata fixados, referência ao SYNC_RUN,
versão/hash do remetente, tentativa, owner técnico, leaseUntil, horários, status,
retryable e contagens. Não contém alunos, destinatários ou conteúdo de mensagem.

Claim e renovações usam compare-and-swap na transação real do Repository, com
condições sobre METADATA, SYNC_RUN e configuração/vínculos. O lease dura até 120
segundos, limitado pelo fim da janela, e é renovado antes de autorizar destinatário.
Outro worker encontra lease-active enquanto a posse estiver válida.

A chamada compartilhada `reserve_reminder(..., checks=...)` recebeu um parâmetro
opcional. O automático inclui nela a posse da ocorrência, prova e configuração,
na mesma transação que já verifica publicação, participação e REMINDER disponível.
Os adaptadores manuais não mudam sua chamada ou comportamento.

Perder a posse impede novas reservas e a finalização sobre o sucessor. Lease
expirado permite retomada dentro da janela, com novo owner, mantendo a publicação.
Uma reserva já autorizada pode concluir seu envio; o novo worker não reabre sua
chave REMINDER. Nenhuma transação tenta incluir o SES.

| Estado | Significado |
| --- | --- |
| running | Tentativa em curso; sem lease válido representa interrupção/incompletude |
| completed | Passagem concluída sem pendências de execução |
| partial / retryable=true | Há destinatário seguramente retomável e tempo na janela |
| partial / retryable=false | Sem retry seguro, janela encerrada ou contexto alterado |

Recusas antes do claim são retornadas e registradas em log, sem criar um item de
execução. Um running abandonado não é convertido artificialmente em sucesso; após
a janela permanece evidência incompleta, com lease vencido e REMINDERs existentes.

## Envio e retomada

O worker reutiliza fixed_publication, evaluate_recipient, message_for,
reserve_reminder e send_reserved_reminder. WITHDRAWN é recusado atomicamente por
destinatário. A seleção inicial nunca substitui essa autorização.

A chave permanece `REMINDER#publicationId#studentId`, compartilhada com o manual.
sent, sending e unknown não reabrem; failed permite uma tentativa na nova passagem.
O worker não faz loop de retry, polling ou chamada recursiva de envio.

Uma passagem parcial pode ser invocada novamente com a mesma ocorrência. Ela relê
REMINDER para pular enviados e retomar somente failed/ausentes elegíveis. Isso cobre
queda depois de persistir sent e antes do resumo. Se SES aceitou e a persistência
final falhou, sending permanece bloqueado, sem promessa de entrega exatamente uma vez.

Cada turma é processada independentemente. Uma falha não impede a outra. O retorno
retryable permite ao adaptador futuro definir a reentrega, sempre na mesma janela;
nenhuma política ou recurso de retry foi provisionado nesta etapa.

## Dry-run e observabilidade

Dry-run executa leituras, readiness e classificação, sem claim, reserva, envio ou
qualquer escrita. Pode ser usado com o gate de infraestrutura desligado, mantendo
as verificações de REMINDER_SETTINGS, calendário, prova e publicação fixada.

Logs estruturados registram início e resultado ou motivo de skip. Não incluem
exceções brutas, evento bruto, headers, nome, e-mail ou mensagem. Erros inesperados
usam execution-error, preservando o estado persistido para uma retomada segura.

O resumo é reconstruído dos REMINDERs, não depende apenas de contadores em memória:

- total: população do snapshot fixado;
- eligible: ativos com e-mail e pendência, antes do dedupe;
- pending: trabalho seguramente retomável agora, incluindo failed elegível;
- sent/failed/unknown/sending: estados persistidos atribuídos à ocorrência;
- skipped e skipReasons: os motivos do domínio compartilhado.

pending pode sobrepor failed; não é uma parcela adicional para somar à população.
As contagens representam o estado observado na passagem. Não são histórico de todas
as tentativas. O resumo persistido mede duração desde o início da ocorrência,
incluindo intervalos entre retomadas.

## Validação

33 testes unitários novos e sete Moto. RED também comprovou os casos de lease
expirado antes da reserva, dry-run adotando publicação posterior, configuração de
turmas como string e retry indicado após a janela em falha do resumo. Todos GREEN.

20 mutações A–T detectadas em cópias temporárias: calendário, janela, prova do sync,
metadata, identidade da ocorrência, claim sem condição, lease sem fence, ausência de
condições de sender/sync, dry-run gravando, resumo sem registros duráveis, reabertura
de unknown/sending, remoção da condição WITHDRAWN, deadline por destinatário,
redefinição da publicação, dry-run sem publicação fixada, lease expirado, timezone
fixo, e-mail no resumo, configuração ambígua de turmas e retry fora da janela.
Hashes conferidos após as mutações; os fontes do workspace não foram mutados.

Na conferência de fechamento, os testes da prova passaram a cobrir explicitamente
uma tentativa às 20h05 com sync terminado às 20h01: essa prova é recusada, mesmo
estando dentro da janela de retry. O limite inclusivo das 20h também foi verificado
para published e unchanged. Os 20 mutantes foram reexecutados, com mais uma mutação
que troca esse limite pelo horário da tentativa.

| Validação | Baseline AUTO-2.1 | AUTO-2.2 |
| --- | ---: | ---: |
| Node local / UTC | 177 / 177 | 177 / 177 |
| Browser local / UTC | 19 / 19 | 19 / 19 |
| Backend | 249 | 282 |
| Integração/Moto | 32 | 39 |
| OpenAPI | 21 | 21 |
| Terraform test, mocks | 3 | 3 |
| Build, Terraform validate, diff check | Passaram | Passaram |

ZIP local conferido: worker e helper com bytes exatos dos fontes, sem arquivos de
testes. Zero diff em frontend, OpenAPI, recursos Terraform, dependências, Portal,
Canvas Sync ou Repository na AUTO-2.2.

Revisão adversarial: nenhum BLOCKER de implementação local e um BLOCKER de
deploy, descrito abaixo. Foram revisados limites de calendário/lease, CAS, posse
perdida, preflight/reserva concorrentes, publicação fixada, dedupe manual/automático,
falhas parciais, privacidade e isolamento por turma.

**BLOCKER de deploy — permissão antes de publicar o backend:** as políticas versionadas em
`infra/terraform/api.tf` e `infra/terraform/canvas-sync.tf` não incluem
`dynamodb:ConditionCheckItem`. Essa é a permissão da ação ConditionCheck nas transações,
conforme a [documentação AWS](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).
A primitive introduzida na AUTO-2.1 e o worker precisam dessa autorização. A AUTO-2.3
deverá tratar API, Canvas Sync e a role do worker com o escopo mínimo da tabela,
antes de publicar o código. Não alterar a condição para contornar a permissão.

Este achado complementa a revisão anterior da AUTO-2.1: o CI/Moto verde não comprova
a autorização IAM em produção. IAM real não foi consultado nesta execução. Nenhuma
política foi alterada; o pacote não deve ser publicado isoladamente com as políticas
versionadas atuais.

## Próxima etapa

AUTO-2.2 foi aprovada para commit, push e CI. Somente após CI verde, AUTO-2.3 deverá fornecer o adaptador
de execução e configuração das turmas, IAM e Scheduler inicialmente desabilitado,
ligar o contexto real do Canvas Sync e definir a reentrega usando os resultados do
worker. Deploy, dry-run real e ativação exigem as etapas de revisão correspondentes.

Nenhum frontend/OpenAPI alterado, envio real, recurso AWS novo, apply ou deploy.

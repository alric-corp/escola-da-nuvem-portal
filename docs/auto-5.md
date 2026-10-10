# AUTO-5 — ativação controlada dos lembretes automáticos

**Em andamento. LIVE manual BRSA0267 PASS; envio manual normal BRSA0257 PASS, 22 enviados/22 deliveries. Scheduler natural pendente.**

**Estado atual — 10/10 às 18h54:** gate automático aplicado em operação única
**0/1/0**, state **84**, worker versão **4** Active/Successful com automático
**true** e manual **false**. Alias manual permanece na versão **3 desabilitada**,
sem routing weights; IAM temporário revogado. Ambos schedules continuam
**DISABLED**. Os **49 REMINDER sent / 49 deliveries** anteriores e os settings
estão preservados, sem nova invocação da worker, envio, Bounce/Complaint ou
Errors/Throttles observados. Full plan pós-gate **1/0/0 somente ACM**, antes da
preparação do piloto. O plano para habilitar somente BRSA0267 está em preparação
e exige aprovação separada; BRSA0257 permanece fora do piloto. Seções 22–23.

**Checkpoint do envio — 10/10 às 17h07:** após aprovação explícita do lote revisado,
uma única chamada autenticada ao fluxo normal da BRSA0257 retornou HTTP 200:
**22 sent, zero failed/skips**, com os mesmos 22 destinatários aprovados.
DynamoDB confirma 22 REMINDER sent e SES confirma 22 deliveries correlacionados,
sem duplicidade, envio para WITHDRAWN, aluno sem pendências ou fora do lote.
AUTO_REMINDER BRSA0257=0. Settings intactos, gates automático/manual=false e
ambos schedules DISABLED. SES Send/Delivery=22/22; Errors/Throttles=0,
sem Bounce/Complaint observados. Sessão encerrada; nenhum retry.
Evidências na seção 20.
Os checkpoints abaixo preservam o histórico anterior ao envio.

**Checkpoint anterior — 10/10 às 15h52:** state **83**, alias `manual-recovery`
na versão **3 desabilitada**, ambas as flags false, IAM temporário revogado e
ambos schedules DISABLED. BRSA0267 mantém 27 envios/27 deliveries, sem novos
bounces ou complaints observados. A recuperação da BRSA0257 de sexta foi
**bloqueada**: o Canvas natural de sábado às 06h substituiu a publicação.
O operador escolheu o fluxo manual normal do portal para a publicação atual.
A prévia técnica de **22 elegíveis** foi aprovada condicionalmente. O operador
informou uma operação de envio pelo portal autenticado, mas a auditoria ainda
**não confirmou o envio**: BRSA0257 permanece com REMINDER=0 e AUTO_REMINDER=0;
os logs da API de 00h00 até 14h32 não mostram prévia nem envio de lembretes.
Publicação, metadataVersion e settings continuam intactos. Nenhuma repetição
foi executada. Detalhes do LIVE BRSA0267 na seção 11, do bloqueio na seção 12,
das prévias nas seções 13–14 e desta divergência na seção 15.
O operador solicitou preparar o uso programático da API normal: contratos e
configuração AWS conferidos, mesmos 22 elegíveis, nenhum envio. A sessão
isolada aberta às 15h54 expirou e foi encerrada às 16h04, sem executar a prévia.
Às 16h35, a partição da BRSA0257 e os controles permaneciam intactos. O login
da nova sessão passou às 16h45, mas um erro local de importação encerrou o
helper antes da prévia. Após correção e nova autenticação legítima, a prévia
pela API foi concluída às **16h55**: login Cognito, TEACH e SES readiness PASS,
publicação e metadataVersion intactas, mesmos **22 elegíveis distintos**.
Entretanto, a classificação mudou para **38 ACTIVE / 18 WITHDRAWN**, com zero
skip por falta de e-mail: um aluno já excluído por falta de e-mail passou a
WITHDRAWN. **PARADA para revisão da população alterada; nenhum envio.**
REMINDER=0, AUTO_REMINDER=0; gates false e ambos schedules DISABLED na leitura
pós-prévia. Detalhes nas seções 16–19.
Os demais checkpoints abaixo preservam o histórico de cada etapa.

Correção do falso conflito **publicada em produção em 09/10, 22h00**, apply
**0/6/0**, state 72 e full plan somente ACM **1/0/0**. Cinco Lambdas
Active/Successful; schedules DISABLED, gate false e contagens de lembretes zero.
**Sem reativação, migração ou novo LIVE; AUTO-5 continua bloqueada**:
[diagnóstico, RED/GREEN e evidências do deploy](auto-5-claim.md#7-deploy-aprovado-e-concluído--0910-22h00).

A preparação de recovery de **10/10 foi encerrada sem LIVE**: horário de 00h45
perdido durante os checkpoints, sem autorização posterior recebida a tempo.
Janela definitiva restaurada às 01h04, state 79, gate false e ambos schedules
DISABLED. [Registro da preparação e restauração](auto-5-claim.md#8-preparação-de-recovery-de-1010--encerrada-sem-live).

## Estado após o kill switch — checkpoint histórico de 09/10, 20h08

| Controle | Estado real |
| --- | --- |
| BRSA0267 schedule | DISABLED, kill switch às 20h07 |
| BRSA0257 schedule | DISABLED |
| Worker gate | false, kill switch às 20h07 |
| Worker / outras quatro Lambdas | Active / Successful, mesmo ZIP da AUTO-4 |
| Cron dos lembretes | terça/sexta, 20h, America/Sao_Paulo, flexible OFF |
| Canvas | ENABLED, 06h/18h; sync natural das 18h PASS nas duas turmas |
| Settings / readiness | versão 1, automaticEnabled=true, PASS nas duas |
| AUTO_REMINDER / REMINDER / EMAIL/DELIVERY | 0 nas duas turmas |
| Worker Invocations / Errors / Throttles | 1 / 0 / 0 desde a abertura do gate |
| Alarmes | Errors e Throttles OK |
| Primeiro LIVE natural BRSA0267 | skipped / claim-conflict, retryable=false |

Nenhum LIVE manual foi executado. O piloto foi interrompido antes da primeira
reserva e de qualquer envio. **BRSA0257 não será habilitada sem aprovação
explícita posterior. AUTO-5 não está concluída.**

## Primeiro LIVE natural — 09/10, 20h00 — BLOCKED

- Scheduler: uma tentativa na ocorrência de sexta-feira, 20h. Lambda START às
  **20h00min44,820s**, resultado às **20h00min48,776s**, END/REPORT às
  **20h00min48,816s**; duração **3.995,14 ms**. Nenhuma invocação manual ou retry
  observado. As primeiras consultas chegaram antes da ingestão completa dos logs;
  a Lambda já havia terminado, sem timeout.
- Resultado técnico: `status=skipped`, `reason=claim-conflict`, `retryable=false`,
  `dryRun=false`, turma BRSA0267, slot `2026-10-09T23:00:00Z`.
- Contadores emitidos: avaliados, elegíveis, enviados, falhos, pendentes, sending,
  unknown e skipped **todos zero**, `skipReasons={}`. A avaliação dos alunos não
  começou; esses zeros não significam ausência de alunos elegíveis.
- Dados consistentes nas duas turmas: **AUTO_REMINDER=0, REMINDER=0 e
  EMAIL/DELIVERY=0**. Zero reservas/envios WITHDRAWN e zero duplicatas observadas.
  Dedupe, seleção e entrega LIVE continuam sem validação operacional, pois o
  fluxo parou antes deles. Não existe registro AUTO_REMINDER para correlacionar
  executionId/attemptNumber; o contexto passou pela validação do handler, mas
  não foi persistido devido ao cancelamento da transação.
- CloudWatch: **Scheduler InvocationAttemptCount=1; Lambda Invocations=1,
  Errors=0, Throttles=0**. SES Send/Delivery/Bounce/Complaint/Reject observados
  zero; Lambda de delivery sem invocações. Alarmes Errors/Throttles **OK**.
  Logs com um START/END/REPORT e resumo técnico, sem padrões de PII, evento bruto
  ou erro inesperado. `Errors=0` não é aceite funcional: o bloqueio é tratado
  pelo handler como resultado normal.
- A prova do Canvas natural das 18h continua válida nas duas turmas: publicação
  current, metadataVersion igual e etapas succeeded/published, concluídas antes
  das 20h. Readiness e settings lógicos continuam PASS, versão 1 e
  automaticEnabled=true; essa validação não cobre a serialização transacional.

### Causa identificada por leitura

`Repository.transaction` compara o atributo DynamoDB `data` como texto com
`Repository._encode(expected)`, que usa `json.dumps(..., ensure_ascii=False,
sort_keys=True)`. O `REMINDER_SETTINGS` existente **nas duas turmas** tem JSON
semanticamente equivalente, mas os bytes não coincidem com essa representação:
as chaves persistidas não estão ordenadas. Assim, a condição `#d = :old` desse
item falha no estado observado.

A auditoria somente leitura comparou as cinco condições da aquisição:
METADATA, SYNC_RUN e vínculos direto/reverso coincidem; somente REMINDER_SETTINGS
diverge da serialização exigida. Todos esses registros são idênticos aos da
baseline anterior ao LIVE, inclusive os settings. O item da ocorrência não
existe. Isso explica o `claim-conflict` no primeiro `acquire`, antes de qualquer
escrita confirmada ou chamada de envio. O log não preserva os CancellationReasons
do DynamoDB, portanto não identifica nominalmente a condição cancelada; a
incompatibilidade foi demonstrada comparando o estado real com o código publicado.

Os dry-runs passam pelo readiness e pela avaliação, mas não executam a aquisição
transacional; por isso não exercitaram essa comparação. **Nenhum settings foi
reescrito, nenhuma regra/runtime foi alterada e nenhum LIVE foi repetido.**
A correção e uma nova tentativa dependem de revisão separada.

### Participação atualizada pelo portal durante a observação

Entre a baseline das 19h01 e o LIVE, houve três alterações humanas
ACTIVE → WITHDRAWN na BRSA0267 e uma na BRSA0257. Às 19h59, a baseline foi
revalidada: BRSA0267 com **59 alunos, 34 ativos e 25 WITHDRAWN**; BRSA0257 com
**56, 40 e 16**. Após as 20h ocorreu mais uma alteração humana na BRSA0257,
ficando **56, 39 e 17**.

As alterações foram correlacionadas aos pares PARTICIPATION/AUDIT, com mesmo
ator não sistêmico, aluno e timestamp, sem imprimir identificadores. Esses
registros explicam as diferenças da tabela e o alerta inicial conservador do
observador; não foram escritos pela worker. Publicação, prova e settings
permaneceram intactos. A interrupção do piloto decorre do `claim-conflict`.

### Interrupção autorizada — 20h07

- Gate false solicitado às **20h07min18,660s**; schedule BRSA0267 DISABLED às
  **20h07min19,363s**; releitura final às **20h07min22,140s**: worker Active /
  Successful, gate false e ambos schedules DISABLED.
- Aplicado o procedimento sistêmico da seção 6, porque a incompatibilidade de
  settings existe nas duas turmas. A Lambda observada já havia terminado.
  Não houve cancelamento de execução, rollback de código ou nova invocação.
- ZIP, configurações restantes, cron terça/sexta 20h, timezone, flexible,
  target/input/retries e settings preservados. Somente o gate e o estado do
  schedule piloto foram fechados pela API de configuração.
- Terraform e seus testes alinhados a gate false / ambos DISABLED, impedindo
  reativação por um próximo apply. Full plan final, somente leitura e sem `-out`:
  **1 add / 0 change / 0 destroy**, exclusivamente `aws_acm_certificate.portal`.
  Nenhuma ação residual AUTO-5. O state persistido continua no serial **70**:
  o refresh usado pelo plan leu o kill switch real, sem persistir esse refresh.
  Nenhum plano de reativação foi criado ou aplicado.
- Regressões da reconciliação: **300 backend, 40 integração, quatro Terraform**,
  fmt/validate e diff-check PASS. A primeira execução local de integração
  encontrou a dependência `playwright-core` ausente nesse checkout; após
  `npm ci --ignore-scripts`, os 40 testes passaram, sem mudança em código ou
  lockfile. O CI completo do commit de interrupção deve ser conferido no GitHub.

**Parada para revisão. Não habilitar BRSA0257; não declarar AUTO-5 concluída.**

## AUTO-5.2 — piloto BRSA0267 aplicado em 09/10, 18h59

- Commit `f35ed39753bd90010218dea97527e0ee913808d4`;
  [CI completo SUCCESS](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37996168647).
  Regressões locais: 300 backend, 40 integração, quatro Terraform; fmt/validate verdes.
- Plano isolado com refresh **0/1/0**, única ação no schedule BRSA0267 e único
  campo alterado `state: DISABLED → ENABLED`. Sem mudança de worker, cron,
  timezone, flexible, target, input, retries ou ACM.
- SHA-256 do plano consumido:
  `0520586a6ccbb0f551119801ae4fb61cd652a57bdc487bafb4a6ce2e9ba91d9f`.
- Apply único do arquivo salvo: **18h59min42s–18h59min47s**, resultado **0/1/0**.
  State **69 → 70**, com uma hora de margem antes do primeiro LIVE.
- Pós-apply: IAM/configuração PASS (67 + 160 verificações); BRSA0267 ENABLED,
  BRSA0257 DISABLED, gate true; readiness/settings/provas de hoje válidos.
- Full plan sem ação residual AUTO-5: somente ACM conhecido **1/0/0**.
  Plano consumido removido após convergência. Nenhum código runtime mudou.
- Baseline de observação às 19h01: 424 registros; zero AUTO_REMINDER/REMINDER/delivery.
  Snapshot BRSA0267: 59 alunos, 37 ativos, 22 WITHDRAWN; BRSA0257: 56, 41 e 15.
  Esses números não antecipam elegíveis ou envios do LIVE. O gate e os applies
  não invocaram a worker. Procedimento de interrupção documentado na seção 6.

## AUTO-5.1 — gate global aplicado em 09/10, 18h51

- Commit `800167b965cc18666b2a946bcdfe10c0537ffcba`;
  [CI completo SUCCESS](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37995410587).
- Plano isolado com refresh: **0 add / 1 change / 0 destroy**. Única ação:
  `aws_lambda_function.automatic_reminders`, exclusivamente environment
  `AUTOMATIC_REMINDERS_ENABLED: false → true`. ZIP e demais campos idênticos.
  ACM fora das ações; nenhum schedule alterado. Warning de targeting esperado.
- SHA-256 do plano consumido:
  `a861bafe8b7159c548295d1b7a2c2cabc07b2d55625fc818fc2c871775d8e247`.
- Apply único do arquivo salvo: **18h51min18s–18h51min30s**, resultado **0/1/0**.
  State **68 → 69**. A comparação anterior do state detectou apenas ordenação
  variável dos mesmos nove `check_results`; conteúdo, recursos e serial iguais.
- Pós-apply: worker Active/Successful com gate true; **ambos schedules DISABLED**;
  IAM/configuração real PASS (67 + 160 verificações). Readiness/settings e provas
  de hoje continuam válidos. Zero START da worker, AUTO_REMINDER, REMINDER e delivery.
- Full plan somente leitura: **1 add / 0 change / 0 destroy**, exclusivamente ACM;
  sem ação residual AUTO-5.1. Plano consumido removido após convergência.

AUTO-5.2 preparada com uma única mudança funcional: state do schedule BRSA0267
DISABLED → ENABLED. BRSA0257 permanece DISABLED; worker gate permanece true.
Commit/CI, plano isolado, apply e observação do LIVE serão registrados após execução.

## Checkpoint — 09/10, 18h44

O Canvas natural das 18h executou uma vez, com Errors=0 e Throttles=0.
Ambas as turmas publicaram e têm SYNC_RUN `succeeded`, source `portal.scheduler`,
catalog/roster succeeded, grades published, attemptNumber 1 e executionId válido.
BRSA0257 terminou às **18h01min13s**; BRSA0267, às **18h01min38s**.
PublicationId continua current, metadataVersion confere e o snapshot existe.
SYNC legado permanece published. Logs observados sem erro, PII ou evento bruto.

Preflight real repetido às 18h43: readiness PASS nas duas, settings versão 1
e vínculos válidos, schedules DISABLED, gate false, cinco Lambdas Successful,
SES ProductionAccessEnabled/SendingEnabled true e HEALTHY; quota 50.000/24h,
14/s e SentLast24Hours=1. Alarmes Errors/Throttles OK. Baseline antes da ativação:
AUTO_REMINDER=0, REMINDER=0, EMAIL/DELIVERY=0 nas duas turmas; 10 SYNC_RUN por
turma, 424 registros globais. Nenhuma invocação da worker desde a restauração.
Métricas de worker e SES sem atividade observada até 18h41; últimos dois minutos
excluídos por atraso de publicação. Git/remote e CI final da AUTO-4 revalidados.

AUTO-5.1 preparada com uma única mudança funcional: gate false → true.
Ambos schedules permanecem DISABLED. Regressões locais passaram: 300 testes de
backend, 40 de integração, quatro Terraform; fmt e validate verdes. Commit/CI,
revisão de plano e apply serão registrados após execução. O piloto continua condicionado à sequência
autorizada e a BRSA0257 permanece fora da ativação inicial.

Evidências deste checkpoint:
`/private/tmp/auto5-evening-20261009-8ycp_4m2`.

## Checkpoint inicial — 09/10, 01h03

Checkpoint de **09/10/2026, 01h03**, em `America/Sao_Paulo`. O próximo requisito
é observar o **Canvas natural das 18h de 09/10**. A prova de 08/10 não autoriza
o envio de hoje. Nenhuma invocação manual, dry-run, envio, mudança de settings,
gate ou schedule foi realizada neste checkpoint.

Escopo autorizado: abrir o gate global, depois habilitar **somente BRSA0267**,
cada etapa com commit, CI completo, plano isolado revisado e apply do plano
salvo. **Parar após o primeiro LIVE natural da BRSA0267 e entregar o relatório.**
A BRSA0257 continuará DISABLED até aprovação explícita posterior, mesmo se o
piloto passar. AUTO-5 não está concluída.

Os encerramentos históricos em [auto-2.3.md](auto-2.3.md) e
[auto-4.md](auto-4.md) foram preservados.

## 1. Fechamento da AUTO-4 e código de entrada

- HEAD e `main` remoto: `cfe0a01a056e3c03c67f8c55817678619806141a`.
- [CI final da AUTO-4](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37881014172):
  **COMPLETED / SUCCESS**, incluindo backend, integração, frontend, navegador,
  Terraform e contratos.
- Checkout isolado `escola-da-nuvem-portal-auto-5`, branch `codex/auto-5-pilot`,
  criado nesse SHA: `git status --porcelain` vazio e `git diff --check` verde
  antes desta documentação. O relatório não rastreado
  `AUTO-2.3-aprovacao-apply.md` permanece intacto no checkout original.
- Os 14 módulos runtime do ZIP correspondem byte a byte ao HEAD aprovado.
  As cinco Lambdas publicadas têm o mesmo hash e estão Active / Successful.
- SHA-256 do ZIP: `3a1f3a5b4ff5257905cdd258b6f911a0923a78b1215042f264ff62192dbeef3d`.
- CodeSha256: `Oh86W0/1JXkFzdJYtvkRoJI6eLEhUELyZP9iGS2+7z0=`.
- Código definitivo: LIVE terça/sexta às 20h; diagnóstico diário às 20h;
  janela de 30 minutos, fim exclusivo. Não há deslocamento temporário por turma.
- Nenhuma regra de negócio foi alterada pela AUTO-5.

## 2. Preflight em produção — somente leitura

Conta **712107929769**, região **us-east-1**, state serial **68**.

| Verificação | BRSA0257 | BRSA0267 |
| --- | --- | --- |
| REMINDER_SETTINGS | presente, versão 1 | presente, versão 1 |
| automaticEnabled | true | true |
| Vínculos direto/reverso | válidos | válidos |
| Readiness real do remetente | PASS | PASS |
| GetEmailIdentity | HTTP 200 | HTTP 200 |
| VerificationStatus / DKIM | SUCCESS / SUCCESS | SUCCESS / SUCCESS |
| VerifiedForSendingStatus | true | true |
| Schedule | DISABLED | DISABLED |
| Cron | `cron(0 20 ? * TUE,FRI *)` | `cron(0 20 ? * TUE,FRI *)` |
| Timezone / flexible | America/Sao_Paulo / OFF | America/Sao_Paulo / OFF |

Readiness foi executada pela lógica real `automatic_sender_readiness` /
`SESMailer.readiness`, com adaptador de leitura para o repositório. Nenhuma
identidade foi criada e nenhum e-mail de confirmação foi solicitado. Os registros
consultados foram relidos para verificar estabilidade durante a auditoria.

Worker: **Active / Successful**, `AUTOMATIC_REMINDERS_ENABLED=false`, Python 3.13,
arm64, 256 MB, timeout 300 s, concorrência reservada 2. Sem Function URL ou
integração API para a worker. Input dos schedules mantém contexto nativo do
Scheduler, `dryRun=false` e somente campos técnicos aprovados.

SES: GetAccount HTTP 200, `ProductionAccessEnabled=true`, `SendingEnabled=true`,
`EnforcementStatus=HEALTHY`. Quotas atuais: **50.000/24h e 14/s**;
`SentLast24Hours=1` é o contador da conta, sem atribuição à automação. Não deve
ser apresentado como zero envios da conta nas últimas 24 horas.

IAM real coincide com o state: API ConditionCheckItem restrito à identity;
Canvas com ConditionCheckItem; worker com policy mínima; execution role do
Scheduler invoca somente a worker. Delivery sem ConditionCheckItem efetivo e
auth trigger sem DynamoDB. Auditoria IAM: **67 verificações PASS**.
Auditoria de configuração real das Lambdas, schedules e observabilidade:
**160 verificações PASS**.

Errors e Throttles da worker: alarmes **OK**, ações no tópico esperado;
retenção de logs de 30 dias. Canvas continua ENABLED, 06h/18h, timezone
America/Sao_Paulo, flexible OFF, sem mudança de input, target ou retries.

Full plan somente leitura, sem `-out` e sem apply:

```text
Plan: 1 to add, 0 to change, 0 to destroy.
aws_acm_certificate.portal: create
```

Nenhuma ação residual AUTO-4/AUTO-5; state permanece no serial 68.
Esse full plan não é um plano de ativação e não será aplicado.

## 3. Baseline inicial — repetir imediatamente antes da ativação

Contagens às 01h02; nenhum dado de aluno ou remetente foi impresso.

| Contagem | BRSA0257 | BRSA0267 |
| --- | ---: | ---: |
| AUTO_REMINDER | 0 | 0 |
| REMINDER | 0 | 0 |
| REMINDER automático | 0 | 0 |
| EMAIL/DELIVERY correlacionado com REMINDER | 0 | 0 |
| SYNC_RUN existente | 8 | 8 |

Tabela: 412 registros; EMAIL/DELIVERY global: 0. A baseline inicial não substitui
a captura após o sync das 18h e imediatamente antes da ativação.

Métricas consultadas entre **00h46min28s e 01h00min35s**: somas observadas zero
para worker Invocations/Errors/Throttles e SES Send/Delivery/Bounce/Complaint/Reject.
Não havia datapoints nesse intervalo. Ausência de datapoints, isoladamente,
não prova ausência de atividade; foi cruzada com dados, gates e zero START nos
logs da worker desde a restauração. Os dois minutos finais foram excluídos da
consulta de métricas para acomodar atraso de publicação. O dry-run manual da
AUTO-4 às 00h39 é anterior a esse intervalo.

## 4. Requisito do Canvas natural das 18h — validado

Não executar sync manual. Para cada turma, consultar a prova da ocorrência
`2026-10-09T21:00:00Z` (18h locais). No checkpoint das 01h03 esse SYNC_RUN
ainda não existia; a ocorrência natural passou e foi validada às 18h44, conforme
o checkpoint acima. Revalidar a prova antes do envio.

Critérios: source `portal.scheduler`; status `succeeded`; catalog e roster
(`enrollment`) succeeded; grades (`notes`) published ou unchanged;
publicationId presente e ainda current; metadataVersion/prova coerente;
contexto Scheduler válido; término até `2026-10-09T23:00:00Z` (20h).

Sem prova válida da BRSA0267, **não ativar nada hoje**. Uma falha exclusiva da
BRSA0257 mantém essa turma DISABLED e não bloqueia o piloto da BRSA0267.
Não usar a prova de ontem, nem modificar a janela para antecipar o LIVE.

## 5. Sequência aprovada de ativação

### AUTO-5.1 — gate global

Após a prova e nova baseline, mudar somente o environment da worker
`AUTOMATIC_REMINDERS_ENABLED: false → true`. Ambos schedules continuam DISABLED.
Rodar regressões necessárias, commit separado, push e CI completo verde.
Comparar AWS × state; revisar plano salvo **0 add / 1 change / 0 destroy**,
com única mudança funcional na variável acima, sem ação ACM ou alteração de ZIP.
Aplicar exatamente esse plano. Verificar gate true, schedules DISABLED,
zero novas invocações automáticas e zero envios. Remover plano consumido após
convergência comprovada.

### AUTO-5.2 — piloto BRSA0267

Mudar somente `aws_scheduler_schedule.automatic_reminders["BRSA0267"].state`
de DISABLED para ENABLED. BRSA0257 fica DISABLED; gate permanece true.
Novo commit, CI verde e plano salvo **0/1/0**, somente esse campo do schedule.
Reconfirmar cron, timezone, flexible OFF, input, target e retries preservados.
Qualquer mudança funcional adicional exige parar antes do apply.

Aplicar com margem antes das 20h; não aplicar no instante da ocorrência.
Se as verificações/CI não deixarem margem suficiente, manter o piloto desabilitado
e usar uma próxima ocorrência natural com sua própria prova das 18h.
Não executar LIVE manual. Parar diante de falha parcial de apply; sem segundo
apply automático e sem rollback improvisado de código.

## 6. Procedimento de interrupção antes do primeiro LIVE

Conta/região: **712107929769 / us-east-1**. Recursos:

- Grupo Scheduler: `restart-portal-prod-automatic-reminders`.
- Schedule piloto: `restart-portal-prod-reminders-BRSA0267`.
- Worker: `restart-portal-prod-automatic-reminders`.

**Problema restrito à BRSA0267:** no EventBridge Scheduler, abrir esse grupo e
schedule, editar somente o estado para **DISABLED**, mantendo cron, timezone,
flexible, target, input e retries; salvar e reler o schedule para confirmar.

**Problema sistêmico:** na configuração de environment da Lambda acima,
alterar somente `AUTOMATIC_REMINDERS_ENABLED` para **false**, preservando todas
as demais variáveis. Desabilitar também o schedule BRSA0267. Confirmar
LastUpdateStatus Successful, gate false e schedule DISABLED pela leitura real.

O schedule desabilitado interrompe novas ocorrências. Não tratar isso como
cancelamento de eventos já entregues à fila assíncrona da Lambda ou de retries
já pendentes. O gate false bloqueia LIVE nas novas execuções que carregarem a
configuração atualizada. **Nenhuma dessas medidas cancela uma Lambda já em
execução.** Continuar observando reservas, resultados SES e delivery dessa
execução; não fazer rollback isolado de ZIP ou reenvio manual.

Registrar horário, motivo e resultado da interrupção. Reconciliar depois o
Terraform com o estado desabilitado, em mudança revisada, para que outro apply
não reabilite acidentalmente o piloto. BRSA0257 permanece DISABLED.

## 7. Critérios de aceite — primeiro LIVE bloqueado

A ocorrência de 09/10 não atendeu ao aceite: `claim-conflict` impediu a aquisição
e os envios. O resultado e a interrupção estão registrados no início deste
documento. Os critérios abaixo permanecem necessários para uma futura tentativa
aprovada; não executar nova tentativa neste checkpoint.

Observar a ocorrência natural das 20h, com Scheduler executionId/attemptNumber
correlacionados à Lambda e ao registro AUTO_REMINDER. Reportar somente agregados:
avaliados, ativos, WITHDRAWN, elegíveis, enviados, falhos, sending/unknown,
skipped e motivos reais. Não reutilizar 33 como expectativa fixa de elegíveis.

Reconciliar AUTO_REMINDER, REMINDER por publicação/aluno, MessageId e delivery
em memória, sem imprimir esses identificadores nem PII. Provar zero duplicata
por aluno/publicação, WITHDRAWN sem reserva/envio e already-sent sem reenvio.
Se houver retries, verificar dedupe em todas as tentativas. Duplicidade é blocker:
desabilitar piloto antes da próxima ocorrência.

Comparar envios SES com `sent`; considerar delivery assíncrono. Complaint > 0
bloqueia avanço. Bounce inesperado relevante exige revisão. Errors/Throttles
devem permanecer zero, alarmes OK, sem erro sistêmico SES/DynamoDB ou PII nos logs.

PASS exige publicação/prova corretas, contagens coerentes, dedupe e WITHDRAWN
válidos, nenhuma escrita indevida, ausência de reclamação/erro crítico e piloto
ENABLED com gate true. Emitir relatório e **PARAR para revisão**, sem habilitar
BRSA0257 automaticamente. A segunda turma e o encerramento AUTO-5 estão pendentes.

## Evidências locais

Artefatos fora do Git, diretório privado:
`/private/tmp/auto5-preflight-20261009-z2r6n4je`.
Contém preflight Git/CI, auditorias IAM/infraestrutura, baseline sanitizada,
state reservado e saída do full plan somente leitura. Não publicar state ou
dados internos. Revalidar todas as condições voláteis antes de qualquer ativação.

## 8. Recuperação manual controlada — implementação de 10/10/2026

**Checkpoint: código preparado para revisão de deploy; sem apply ou envio nesta etapa.**
AUTO-5 continua em andamento e bloqueada para nova ativação automática. Este modo
não comprova o primeiro LIVE natural do Scheduler nem autoriza BRSA0257.
O claim-fix já publicado permanece intacto; não há migração de REMINDER_SETTINGS.

### Motivo e limite

A ocorrência original BRSA0267 de sexta 09/10/2026 às 20h São Paulo falhou antes
do claim. Uma execução tardia precisa de autorização própria: o gate e a janela
do Scheduler não devem ser ampliados para recuperá-la.

- Ocorrência de negócio: `2026-10-09T23:00:00Z` (sexta 20h).
- Prova obrigatória: `SYNC_RUN#2026-10-09T21:00:00Z` (sexta 18h natural).
- Calendário automático continua terça/sexta 20h–20h30; dry-run continua no
  horário definitivo. Nenhuma nova ocorrência de sábado é criada.
- `Repository`, seleção, claim, dedupe, reserva, participação, prova,
  readiness, pacing e mensagem usam o mesmo caminho de domínio existente.

### Autorização IAM e servidor

O alias `manual-recovery` da própria worker aponta para uma versão publicada.
Uma role dedicada confia em um único principal IAM operador, explicitado no
plano. Sua única ação é `lambda:InvokeFunction` no ARN exato do alias, com
`aws:CurrentTime` entre início e expiração absolutos. Não recebe acesso direto
a DynamoDB, SES, S3, Scheduler ou configuração da Lambda.

A role atual do Scheduler conserva somente o ARN **não qualificado**. A AWS
avalia separadamente esses ARNs na autorização
([documentação IAM/Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html)).
O handler exige também o alias exato em `context.invoked_function_arn`, fornecido
pelo runtime ([contexto Lambda](https://docs.aws.amazon.com/lambda/latest/dg/python-context.html)).
`source`, `ClientContext` e campos enviados pelo cliente não autenticam.
Invocar pelo ARN sem alias, `$LATEST`, versão numérica ou outro alias não abre
o modo manual. Permissões administrativas da conta continuam sendo administrativas;
a execução operacional deverá usar a role dedicada.

Configuração independente, entregue fechada:

| Campo | Valor no deploy de código |
| --- | --- |
| `AUTOMATIC_REMINDERS_ENABLED` | `false` |
| `MANUAL_RECOVERY_ENABLED` | `false` |
| Turma manual | BRSA0267 |
| `scheduledFor` autorizado | `2026-10-09T23:00:00Z` |
| Início/expiração | Datas no passado; nenhuma autorização ativa |
| Schedules BRSA0257 / BRSA0267 | DISABLED / DISABLED |

Ativação futura exige plano separado com início e expiração absolutos, intervalo
positivo de no máximo 30 minutos. A expiração é exclusiva e conferida antes de
criar clientes, antes do claim, ao renovar lease, antes de cada reserva e antes
de iniciar SES. Se uma reserva atravessar a expiração, permanece conservadoramente
`sending`, sem iniciar envio; não é liberada automaticamente para repetição.
Requisição SES já iniciada e Lambda em execução não são canceladas pela troca
de configuração. O lease continua limitado à expiração.

O alias tem retry assíncrono zero como defesa adicional. A execução aprovada
deve usar `InvocationType=RequestResponse`, cliente sem retries e uma única
chamada. Timeout não autoriza repetição: a Lambda pode continuar processando.

### Contrato manual

```json
{
  "source": "portal.operator",
  "type": "automatic-reminders",
  "mode": "manual-recovery",
  "version": 1,
  "cohortCode": "BRSA0267",
  "scheduledFor": "2026-10-09T23:00:00Z",
  "executionId": "recovery-brsa0267-original-friday",
  "attemptNumber": 2,
  "dryRun": false
}
```

O evento não admite campos adicionais, remetentes, destinatários, alunos ou
publicação. `executionId` é telemetria: a chave AUTO_REMINDER e o ator continuam
baseados na ocorrência original. SYNC_RUN precisa estar succeeded, com etapas
válidas, concluído até sexta 20h e com publicação/METADATA ainda correspondentes.
Não há fallback de publicação.

### Evidências e testes

Preflight somente leitura: conta `712107929769`, região `us-east-1`, state serial
`79`, cinco Lambdas com o ZIP definitivo do claim-fix, worker Active/Successful,
gate automático false, dois schedules DISABLED e zero AUTO_REMINDER/REMINDER
em ambas as turmas. Readiness BRSA0267 PASS, settings v1/automaticEnabled true,
prova original válida; SES HEALTHY, production/sending enabled, quota 50.000/dia,
14/s e SentLast24Hours zero; alarmes Errors/Throttles OK. Revalidar antes do LIVE.

Os testes Moto usam o writer AUTO-4 v1 e o caminho LIVE real do handler até
claim, reserva e envio SES mockado. O cenário autorizado ficou RED no código
anterior e GREEN com a implementação. Cobertura inclui acesso pelo alias,
flag, expiração, escopo, publicação, sync, settings, WITHDRAWN, concorrência,
retry/dedupe e expiração durante reserva/envio. Dry-run continua zero-write.
Regressão local: 300 backend, 82 integração/Moto, 177 Node, 19 arquivos browser,
9 cenários Terraform; fmt/validate/build verdes e 11 cenários de mutação OpenAPI
aprovados. Mutations: 12/12 do claim e 11/11 da autorização manual eliminadas,
zero sobreviventes. O CI completo do commit também deve estar verde antes do apply.
Evidências sanitizadas e logs locais: `/private/tmp/auto5-manual-20261010-ed_sdipt`.

### Próximos checkpoints — ainda não executados

1. Aprovar o plano isolado de código/IAM/alias, sem ACM, gates false e schedules
   DISABLED. Aplicar somente o plano salvo e confirmar hashes/configurações.
2. Revalidar somente leitura prova, publicação current, settings, vínculos,
   readiness, quotas, claim original ausente, dedupe e **população atual**.
   Apresentar o número real de destinatários, sem reutilizar estimativa anterior.
3. Aprovar plano separado de autorização manual BRSA0267/ocorrência original,
   com validade curta. Gate automático e schedules continuam fechados.
4. Obter aprovação explícita dos destinatários e da execução real; assumir a
   role dedicada e realizar uma única invocação síncrona pelo alias.
5. Registrar claim, agregados, dedupe, WITHDRAWN, SES/delivery/bounce/complaint,
   Errors/Throttles e logs sanitizados. Sem retry manual em falha/timeout.
6. Encerrar autorização: `manual_recovery.enabled=false`, revogar a janela IAM,
   publicar versão com flag false e **reapontar o alias**. Alterar apenas `$LATEST`
   não fecha um alias que ainda aponta para uma versão habilitada. Confirmar
   configuração da versão efetivamente apontada pelo alias e negação IAM.
   A expiração absoluta permanece como proteção mesmo antes dessa reconciliação.

Depois parar para revisão. Não habilitar BRSA0257 nem declarar AUTO-5 concluída.

## 9. Deploy fechado do modo manual — 10/10/2026, 02h38

**Modo manual publicado em produção, desabilitado. AUTO-5 continua bloqueada
para nova execução e não está concluída.** Nenhuma flag foi ativada, nenhum
schedule foi habilitado e nenhuma Lambda foi invocada para teste ou envio.
A revisão da população atual e a autorização de uma execução real ficam para
rodada separada.

### Preflight final e artefatos consumidos

- HEAD aprovado: `3dd32c7c2c476b4a7c6e4ec6472099a6b1dc938f`; remoto main no
  mesmo SHA, árvore rastreada limpa e `git diff --check` sem erros. O documento
  local não rastreado `AUTO-2.3-aprovacao-apply.md` foi preservado.
- CI [38026236426](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/38026236426):
  COMPLETED / SUCCESS nos três jobs.
- State serial **79**, reconfirmado imediatamente antes do apply.
- ZIP SHA-256:
  `e5084d5657a71161dcb91da283a683746482fa566a0505f45e33eb9c7d9b4308`.
- ZIP / CodeSha256:
  `5QhNVlenEWHcuR2ig6aDdGSC+lZqBQX0XjPrnH2bQwg=`.
- Plano aprovado: `infra/terraform/.build/auto5-manual-code.tfplan`.
- Plano SHA-256:
  `286f93920b0bf93ebf5eced6cf3096f37d08aeeb9ff05a0a2f25eee7ccdd91da`.
- Os 14 módulos do ZIP correspondem byte a byte ao commit aprovado. Em relação
  ao pacote anteriormente publicado, somente `automatic_reminders.py` mudou;
  o claim-fix de `repository.py` permanece intacto.
- Plano reaberto em texto e JSON: somente quatro criações e cinco atualizações
  aprovadas. Zero ações em ACM, Scheduler, IAM existente, DynamoDB,
  REMINDER_SETTINGS e API Gateway; nenhum destroy/replacement.
- Flags, turma, ocorrência original e datas expiradas conferidas no plano.
  Verificação local apenas da função pura de autorização: desabilitada, flag
  ausente, expirada, expiração ausente e autorização ausente foram recusadas,
  com zero clientes AWS. Não foi usado InvokeFunction.

### Apply único do plano salvo

Executado exatamente:

```sh
terraform -chdir=infra/terraform apply .build/auto5-manual-code.tfplan
```

Início **10/10 02:37:33.686**, término **02:38:17.472**, America/Sao_Paulo
(05:37:33.686–05:38:17.472 UTC). Resultado: **4 added / 5 changed / 0 destroyed**,
exit code 0, sem falha parcial ou segundo apply. Não foi gerado novo plano
de deploy.

| Recurso | Resultado |
| --- | --- |
| Role IAM do operador manual | Criada |
| Policy IAM do operador manual | Criada |
| Alias `manual-recovery` | Criado, versão 1 |
| Configuração de invocação do alias | Criada, retry 0 / idade máxima 60 s |
| Lambda identity | ZIP atualizado, Active / Successful |
| Lambda canvas_sync | ZIP atualizado, Active / Successful |
| Lambda reminder_events | ZIP atualizado, Active / Successful |
| Lambda auth_trigger | ZIP atualizado, Active / Successful |
| Lambda automatic_reminders | ZIP/configuração fechada atualizados, versão publicada, Active / Successful |

Todas as cinco Lambdas apresentam o CodeSha256 aprovado. Handler, runtime,
arquitetura, memória, timeout, role, layers e concorrência permanecem iguais;
o environment das quatro funções existentes não mudou. A worker recebeu
somente os seis campos de configuração manual previstos, com gate false.

### Alias, versão e IAM reais

- Alias aponta exclusivamente para a **versão publicada 1**, sem roteamento
  ponderado. Código e environment dessa versão correspondem ao pacote e à
  configuração aprovados; a conferência incluiu a versão, além de `$LATEST`.
- Na versão 1 e em `$LATEST`: `AUTOMATIC_REMINDERS_ENABLED=false` e
  `MANUAL_RECOVERY_ENABLED=false`; início/expiração em
  `1970-01-01T00:00:00Z`. Nenhuma autorização manual ativa.
- Role confia exclusivamente no principal IAM aprovado no plano. A única
  policy inline permite somente `lambda:InvokeFunction` no alias manual,
  com datas expiradas. Nenhuma policy gerenciada anexada, wildcard de Lambda,
  permissão IAM ampla ou acesso à função não qualificada/versões numéricas.
- A simulação da role real retorna `implicitDeny` para alias manual, função
  não qualificada e versão numérica no horário atual. Trust e policy reais
  são iguais aos documentos aprovados.
- Policies existentes de API, Canvas, worker, Scheduler e auth trigger
  permanecem iguais ao baseline. Nenhum novo principal além do operador
  aprovado recebeu uma concessão; não há nova resource policy nem Function URL.
- Alias manual: `MaximumRetryAttempts=0`, idade máxima 60 s. Configuração
  automática existente preservada: retry 2, idade máxima 1800 s.

### Estado final e convergência

| Controle | Estado confirmado |
| --- | --- |
| BRSA0257 / BRSA0267 schedules | DISABLED / DISABLED |
| Cron / timezone / flexible | `cron(0 20 ? * TUE,FRI *)` / America/Sao_Paulo / OFF |
| Gate automático / manual | false / false |
| AUTO_REMINDER / REMINDER | 0 / 0 em ambas as turmas |
| REMINDER_SETTINGS | Idênticos byte a byte, sem migração |
| Worker novas Invocations / Errors / Throttles | 0 / 0 / 0 observados |
| Worker novos START nos logs | 0 |
| SES Send / Bounce / Complaint | 0 / 0 / 0 observados |
| SES SentLast24Hours | 0 |
| Alarmes | Errors OK / Throttles OK |
| State | 79 → 81; schedules e alias reconciliados |
| Rotas API Gateway | 35, correspondentes ao state, nenhuma ação |

Métricas podem ter atraso de ingestão; a coleta foi complementada por logs,
contagens consistentes e GetAccount. Esta operação não realizou InvokeFunction,
SendEmail nem escrita de dados de domínio. As escritas foram as alterações
de infraestrutura aprovadas e a atualização do state pelo Terraform.

Full plan executado **somente leitura**, sem `-out` e sem apply:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color
```

Resultado **1 add / 0 change / 0 destroy**, exclusivamente
`aws_acm_certificate.portal`. Zero ação residual do modo manual/AUTO-5.
State permaneceu no serial 81 após a auditoria. Depois da convergência,
o tfplan consumido foi apagado; preservados somente evidências e texto/JSON
não aplicáveis no diretório privado:
`/private/tmp/auto5-manual-deploy-20261010-1tdwz3ha`.

### Futura ativação — não autorizada neste deploy

A versão 1 é imutável e permanece desabilitada. Uma futura ativação exigirá,
após revisão da população atual, um **novo plano separado** que configure
somente BRSA0267/`2026-10-09T23:00:00Z`, uma validade absoluta curta de até
30 minutos e a flag manual true. O Terraform deverá publicar uma **nova versão**,
reapontar o alias para ela e ajustar a janela IAM da role. Alterar somente
`$LATEST` não ativa o alias existente. Conferir a versão efetivamente apontada,
seu hash, flags, escopo e expiração antes de qualquer execução aprovada.

O gate automático permanece false e os dois schedules DISABLED durante essa
rodada futura. Publicação/prova, settings, readiness, quotas e destinatários
reais precisam ser revalidados e apresentados antes da aprovação explícita
do envio. A desativação também exige revogar a autorização IAM e reapontar
o alias para uma nova versão com flag false; a expiração absoluta continua
protegendo versões anteriores. Nenhuma mudança cancela uma execução já iniciada.

**Parada após o deploy fechado.** Não ativar manual, invocar Lambda, enviar
e-mail ou habilitar schedules. Não iniciar BRSA0257 nem encerrar AUTO-5.

## 10. Preparação da recuperação manual — 10/10/2026, somente leitura

**Estado: readiness PASS; ativação e envio aguardam aprovação explícita.**
Este registro sucede o deploy fechado acima. Nenhuma versão autorizada foi
publicada, nenhum alias foi alterado e nenhuma Lambda foi invocada nesta preparação.

### Ocorrência e prova

Auditoria concluída às **03:16:46 America/Sao_Paulo**, conta `712107929769`,
região `us-east-1`. State continua **81**. HEAD
`3dd32c7c2c476b4a7c6e4ec6472099a6b1dc938f`; CI `38026236426`
reconsultado: `completed/success`. A alteração rastreada local é a documentação
do deploy/preparação; não houve mudança de código ou configuração Terraform.

- Ocorrência original: **sexta, 09/10/2026, 20:00 local**,
  `scheduledFor=2026-10-09T23:00:00Z`.
- Prova: SYNC_RUN natural de sexta às **18:00 local**,
  `2026-10-09T21:00:00Z`, source `portal.scheduler`, status `succeeded`.
- Execução natural: **18:01:14–18:01:38**, portanto terminou antes do limite
  original das 20h.
- Catálogo e matrícula (`catalog`/`roster`): `succeeded`; notas (`grades`):
  `published`.
- PublicationId presente, mesma publicação do primeiro LIVE, ainda `current`;
  `metadataVersion` corresponde ao METADATA atual. Nenhum fallback.
- Claim da ocorrência original ausente. A recuperação mantém a mesma chave
  transacional; o novo executionId não cria ocorrência de sábado.

### Infraestrutura e remetente

Cinco Lambdas `Active/Successful`, configurações equivalentes ao deploy aprovado.
Worker com timeout 300s e reserved concurrency 2. Alias `manual-recovery`
continua na **versão 1**, sem roteamento ponderado, com configuração assíncrona
de zero retries e idade máxima 60s.

ZIP SHA-256:
`e5084d5657a71161dcb91da283a683746482fa566a0505f45e33eb9c7d9b4308`.
CodeSha256 de produção:
`5QhNVlenEWHcuR2ig6aDdGSC+lZqBQX0XjPrnH2bQwg=`.

Tanto `$LATEST` como versão 1 têm gate automático false e autorização manual
false/expirada. Ambos schedules permanecem DISABLED, cron
`cron(0 20 ? * TUE,FRI *)`, timezone `America/Sao_Paulo`, flexible OFF.

BRSA0267: REMINDER_SETTINGS v1 inalterado, `automaticEnabled=true`, sender
igual ao aprovado e vínculos direto/reverso válidos. Executada a lógica real
`automatic_sender_readiness` / `SESMailer.readiness`, somente leitura:

- GetAccount HTTP 200; ProductionAccessEnabled=true, SendingEnabled=true,
  EnforcementStatus=HEALTHY.
- GetEmailIdentity HTTP 200; VerificationStatus=SUCCESS,
  VerifiedForSendingStatus=true, DKIMStatus=SUCCESS.
- Resultado `ready=true`. Nenhuma identidade criada e nenhum e-mail solicitado.

### População recalculada e baseline

Classificação feita pelas funções reais `fixed_publication`, `withdrawn_ids`
e `evaluate_recipient`, sem chamar handler, claim, reserva ou envio.

| Medida | Contagem |
| --- | ---: |
| Total | 59 |
| Ativos | 34 |
| WITHDRAWN / skip withdrawn | 25 |
| Skip no-email | 0 |
| Skip no-pending | 7 |
| Skip already-sent | 0 |
| Outros skips | 0 |
| **Elegíveis atuais** | **27** |
| Endereços distintos entre elegíveis | 27 |

AUTO_REMINDER=0 e REMINDER=0 em ambas as turmas. Delivery global e atribuível
à recuperação=0. Nenhuma duplicata student/publication; nenhum aluno duplicado
no snapshot. Settings de ambas as turmas continuam idênticos ao deploy fechado.

Leituras DynamoDB consistentes, com comparação da partição BRSA0267, vínculo
reverso, publicação e snapshot antes/depois: estáveis. Isso caracteriza o
intervalo observado; não congela os dados até a execução. Fingerprints privados
da população e domínio foram guardados para a revalidação anterior ao LIVE.
Mudança de destinatários exige nova aprovação, mesmo que a contagem permaneça 27.

Métricas consultadas de 02:38:18 a 03:16:43 local: nenhum datapoint de invocação,
Errors, Throttles, SES Send/Delivery/Bounce/Complaint/Reject. Alarmes Errors e
Throttles OK. Ausência de datapoints e possível atraso do CloudWatch não equivalem
a auditoria completa de chamadas SES. GetAccount informa **SentLast24Hours=0**;
esta auditoria realizou **zero Invoke, zero SendEmail e zero escrita de domínio**.

Capacidade SES: **50.000/24h disponíveis**, **14/s**. Worker sequencial com pausa
de 250ms por tentativa: teto de pacing 4/s, inferior à quota. Para 27 destinatários,
as pausas somam 6,75s; somam-se leituras, transações e latência SES. Estimativa de
planejamento **1–3 minutos em condições normais**, sem medição de LIVE nem garantia
de duração. Timeout 300s, margem interna de parada 10s. Lentidão pode produzir
resultado parcial; não autoriza repetir a invocação.

### Autorização e plano de ativação preparado, não aplicado

Proposta absoluta: **10/10/2026, 03:30–04:00 America/Sao_Paulo**, início incluso,
fim exclusivo (`2026-10-10T06:30:00Z` até `2026-10-10T07:00:00Z`).
Invocar somente depois das 03:30 e **antes das 03:50**, preservando margem para
execução e fechamento. Se a aprovação não chegar em tempo, não aplicar este
plano nem estender automaticamente a validade; apresentar nova revisão.

Somente BRSA0267 e `2026-10-09T23:00:00Z`. Gate automático permanece false;
BRSA0257 e BRSA0267 permanecem DISABLED. Nenhuma alteração de código/ZIP.

Plano salvo: `infra/terraform/.build/auto5-manual-activate.tfplan`.
SHA-256: `f035150c80a6d38a8960bbad94ae218e227af2427d071a427548a87b68ba244f`.
State de referência 81. Resultado revisado: **0 add / 3 change / 0 destroy**:

1. `aws_lambda_function.automatic_reminders`: apenas MANUAL_RECOVERY_ENABLED
   false→true e as duas datas absolutas; publica nova versão, com mesmo ZIP.
2. `aws_lambda_alias.manual_recovery`: versão 1→nova versão publicada. Número
   calculado no apply; não presumir que será 2 antes de consultar a AWS.
3. `aws_iam_role_policy.manual_recovery_operator[0]`: somente validade da
   permissão existente, exclusivamente InvokeFunction no alias manual.

Zero ações em ACM, Scheduler, DynamoDB/settings, API Gateway e IAM não relacionado.
O tfvars proposto está em `.build/auto5-manual-activate.tfvars.json`, ignorado e
carregado somente quando explicitamente passado; não é um auto.tfvars.

Também executado full plan do **estado fechado atual**, sem `-out` e sem carregar
esse tfvars: **1 add / 0 change / 0 destroy**, exclusivamente ACM conhecido.
Nenhum drift residual da recuperação. State permaneceu 81; flags e alias
reconsultados após a preparação continuam false/versão 1 e schedules DISABLED.

Comando de preparação executado somente para gerar o plano:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color \
  -refresh=false -lock=false \
  -var-file=.build/auto5-manual-activate.tfvars.json \
  -target=aws_lambda_function.automatic_reminders \
  -target=aws_lambda_alias.manual_recovery \
  '-target=aws_iam_role_policy.manual_recovery_operator[0]' \
  -out=.build/auto5-manual-activate.tfplan
```

Refresh foi desabilitado após comparar AWS e state para o escopo. Isso evita que
dependências transitivas incluam o ACM conhecido; a lista integral de ações do
plano foi inspecionada. Antes de aplicar: refazer preflight de serial/hash/flags,
AWS×state e dados/população, e parar se houver divergência. O state pull pode
ordenar `check_results` diferentemente; comparação por config_addr confirmou
mesmo conteúdo, recursos, lineage e serial, sem write de state.

Trust da role: principal exato já aprovado, sem novo principal. Somente uma
policy inline, sem managed policies anexadas. IAM real atual nega Invoke no
alias, função não qualificada e versão numérica por autorização expirada.
Simulação da policy proposta permite **apenas InvokeFunction no alias durante
a janela**; não permite alterar função, alias ou IAM. Fora da janela nega tudo.

Dez verificações locais da função real de autorização, sem handler/clientes AWS:
autorização fechada, expirada ou sem expiração bloqueia; outra turma/ocorrência,
sábado como ocorrência, ARN não qualificado e versão numérica bloqueiam.
Envelope autorizado da ocorrência original passa fora do calendário atual com
gate automático false. Escopo/datas também são conferidos durante o domínio.
O evento sozinho não autentica; o runtime deve informar o ARN exato do alias.

### Sequência proposta após aprovação específica

Os comandos de mutação abaixo **não foram executados**.

1. Revalidar população exata, prova/publicação, settings/vínculos, readiness,
   quotas, claim/reminders, serial 81, hashes e validade disponível. Confirmar
   aprovação dos **27 destinatários atuais**, da janela e da execução real.
2. Aplicar exclusivamente o plano revisado:

   ```sh
   terraform -chdir=infra/terraform apply .build/auto5-manual-activate.tfplan
   ```

3. Confirmar nova versão Active/Successful, mesmo hash, escopo/datas corretos,
   alias apontando para ela, IAM correto, automatic=false e schedules DISABLED.
   `$LATEST` também terá manual=true temporariamente; a checagem do ARN rejeita
   invocação manual não qualificada. Ainda assim seu fechamento é obrigatório.
4. Assumir a role `restart-portal-prod-manual-recovery-operator` pelo principal
   aprovado, sessão STS de 900s, sem registrar credenciais. A role não administra
   a configuração; fechamento usa a identidade administrativa aprovada.
5. Registrar marcador local exclusivo antes da única chamada síncrona. Usar
   cliente Lambda com `connect_timeout=5`, `read_timeout=330` e
   `retries={"mode":"standard","total_max_attempts":1}`. Nunca usar credenciais
   administrativas para o Invoke. O marker não é autorização do servidor.

   ```python
   # Esboço para execução futura com credenciais STS da role restrita.
   response = operator_lambda.invoke(
       FunctionName="restart-portal-prod-automatic-reminders",
       Qualifier="manual-recovery",
       InvocationType="RequestResponse",
       Payload=json.dumps(event).encode(),
   )
   ```

   Evento proposto, sem dados de remetente/destinatário:

   ```json
   {
     "source": "portal.operator",
     "type": "automatic-reminders",
     "mode": "manual-recovery",
     "version": 1,
     "cohortCode": "BRSA0267",
     "scheduledFor": "2026-10-09T23:00:00Z",
     "executionId": "recovery-brsa0267-20261009T230000Z-attempt2",
     "attemptNumber": 2,
     "dryRun": false
   }
   ```

6. Conferir ExecutedVersion, FunctionError e payload, além de claim, reservas,
   contagens, WITHDRAWN, dedupe, SES e logs sanitizados. HTTP 200 isolado não
   comprova sucesso de negócio. O retry assíncrono zero do alias não substitui
   desabilitar retries do cliente da chamada síncrona.
7. Fechar imediatamente após a execução, ou diante de resultado desconhecido,
   pelo procedimento abaixo. Nunca repetir Invoke automaticamente.

### Kill switch, fechamento e reconciliação

Preparar antes da ativação cópias privadas da policy desabilitada e do environment
fechado completo. O environment deve preservar todas as outras variáveis.
Essas cópias já foram preparadas neste diretório de evidências, sem write AWS:
`operator-policy-disabled.json` e `environment-disabled.json`.
Sequência de fechamento proposta, também sujeita à aprovação desta operação:

```sh
aws iam put-role-policy \
  --role-name restart-portal-prod-manual-recovery-operator \
  --policy-name invoke-only-manual-recovery \
  --policy-document file://CAMINHO_PRIVADO/operator-policy-disabled.json

aws lambda update-alias --region us-east-1 \
  --function-name restart-portal-prod-automatic-reminders \
  --name manual-recovery --function-version 1 \
  --revision-id REVISAO_DO_ALIAS_REVALIDADA

aws lambda update-function-configuration --region us-east-1 \
  --function-name restart-portal-prod-automatic-reminders \
  --environment file://CAMINHO_PRIVADO/environment-disabled.json \
  --revision-id REVISAO_DA_FUNCAO_REVALIDADA
```

Revalidar escopo, hash e RevisionId imediatamente antes dos updates. A policy
fechada mantém o mesmo único ARN e datas epoch, revogando novas invocações.
Alias volta imediatamente para a versão 1 desabilitada; `$LATEST` volta a
MANUAL_RECOVERY_ENABLED=false com datas epoch e automatic=false. Confirmar
Successful, flags e simulação IAM deny; não chamar a Lambda para testar o bloqueio.

Esses controles **bloqueiam novas invocações; não cancelam uma execução iniciada**.
A versão autorizada é imutável e conserva suas datas, que expiram independentemente
do cliente. Uma execução em andamento continua até parar pelo domínio, terminar
ou atingir o timeout. Não descrever mudança de alias/flag como cancelamento.

O fechamento direto cria drift temporário em relação ao state da ativação.
Depois de comprovar o fechamento na AWS, comparar AWS×state, gerar **novo** plano
isolado com defaults manual=false/datas epoch, contra o serial pós-ativação:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color \
  -refresh=false -lock=false \
  -target=aws_lambda_function.automatic_reminders \
  -target=aws_lambda_alias.manual_recovery \
  '-target=aws_iam_role_policy.manual_recovery_operator[0]' \
  -out=.build/auto5-manual-close.tfplan
```

Revisar o delta restrito a esses três endereços, sem ACM e sem reabertura; aplicar
somente o plano salvo aprovado para fechamento. Terraform poderá publicar outra
versão **desabilitada** e reapontar o alias a ela, pois o alias acompanha `.version`.
Assim, versão 1 é o retorno imediato; versão final pode ser uma nova versão fechada.
Não presumir versão final, não usar plano de rollback gerado antes da ativação,
não manipular o state manualmente e não reverter código ou dados enviados.

Depois: full plan somente leitura (`terraform -chdir=infra/terraform plan
-input=false -no-color`), esperado apenas ACM conhecido, sem residual da recuperação.
Remover planos consumidos; preservar evidências sanitizadas.

### Timeout, incerteza e limites do aceite

Timeout/desconexão/FunctionError não autoriza uma segunda chamada. Preservar
marker, executionId, horário e resposta parcial; executar fechamento; observar
logs/REPORT, AUTO_REMINDER da ocorrência, REMINDER por student/publication e eventos
SES somente leitura. Aguardar o limite da execução e a chegada assíncrona das
métricas/deliveries. `sending`/`unknown` continuam bloqueados; não apagar/resetar
registros nem transformar ausência imediata de delivery em permissão para reenviar.

A autorização não é um token de uso único: dentro da janela, uma segunda chamada
para a mesma ocorrência ainda poderia chegar ao domínio. Claim/lease/dedupe
protegem a identidade original; a operação impõe uma única chamada e fecha depois.
Não há autorização para retomar falhas ou repetir o envio nesta rodada.

Se a população/prova mudar antes do Invoke, parar para nova revisão. Se houver
claim-conflict sem concorrência real, Complaint ou outro erro crítico, fechar
e investigar. Entrega SES é assíncrona; aceitação de SendEmail não comprova inbox.

Referências operacionais: [versões Lambda imutáveis](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html),
[invocação síncrona e desconexão](https://docs.aws.amazon.com/lambda/latest/dg/invocation-sync.html),
[RevisionId do alias](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateAlias.html),
[retries do cliente](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html).

Evidências privadas desta preparação:
`/private/tmp/auto5-manual-readiness-20261010-rvjct4k3`.
Relatório sanitizado `readiness.json`, testes locais `authorization-local-checks.json`,
simulação `proposed-policy-simulation.json`, revisão `activation-plan-summary.json`.

**PARADA para revisão da população e ativação.** Nenhum apply/Invoke/SendEmail nesta
preparação. BRSA0257 fora da recuperação. AUTO-5 permanece em andamento; a execução
natural do Scheduler ainda precisa ser validada.

## 11. LIVE manual autorizado — 10/10/2026

**Recuperação manual BRSA0267: PASS. Autorização encerrada. AUTO-5 permanece aberta.**

O operador aprovou explicitamente os 27 destinatários, a ocorrência original de
sexta 09/10 às 20h, a janela de 10/10 03:30–04:00 America/Sao_Paulo, início antes
de 03:50, uma única chamada síncrona e o fechamento/reconciliação posterior.
BRSA0257 permaneceu fora da execução.

### Preflight e ativação

Revalidação às **03:27:41**: state 81; HEAD/ZIP/plano aprovados; alias versão 1;
manual false/expirada; automático false; ambos schedules DISABLED. Settings,
vínculos, prova do SYNC_RUN natural de sexta às 18h e publicação current
permaneceram iguais ao checkpoint aprovado. Readiness SES PASS e zero claims,
REMINDER e envios no baseline.

População recalculada: 59 avaliados, 34 ativos, 25 WITHDRAWN, 7 sem pendência,
27 elegíveis. Comparada também a identidade exata do conjunto de destinatários
em evidência privada; não houve ampliação nem substituição da população.

Aplicado uma vez o plano salvo `auto5-manual-activate.tfplan`, SHA-256
`f035150c80a6d38a8960bbad94ae218e227af2427d071a427548a87b68ba244f`.
Resultado **0 added / 3 changed / 0 destroyed**. Nenhum novo plano de ativação.
State 81→82; publicada versão **2** e alias manual apontado para ela. Auditoria
pós-apply às **03:29:33** confirmou mesmo código, somente BRSA0267/ocorrência
original, autorização 03:30–04:00, IAM somente InvokeFunction no alias,
automático false e ambos schedules DISABLED.

Antes do Invoke, nova leitura às **03:30:52** confirmou os mesmos 27 destinatários,
prova/current, settings/vínculos, readiness, quotas e ausência de claim/REMINDER.

### Uma única execução real

- Invoke iniciado: **03:30:52.565**, dentro da janela e antes de 03:50.
- InvocationType: `RequestResponse`, exclusivamente alias `manual-recovery`,
  usando sessão da role restrita do operador.
- SDK com `total_max_attempts=1`; marcador exclusivo criado antes da chamada.
- Evento `portal.operator`, modo `manual-recovery`, BRSA0267, dryRun=false,
  attemptNumber=2, sem sender ou destinatários no payload.
- scheduledFor: **`2026-10-09T23:00:00Z`**, a sexta-feira original às 20h.
  Não foi criada ocorrência de sábado.
- ExecutedVersion: **2**; HTTP 200, sem FunctionError; resultado `completed`,
  reason=null, retryable=false.
- Claim iniciou às **03:30:57.065** e terminou às **03:31:18.665**;
  duração de domínio **21.600ms**. Resposta recebida às **03:31:18.818**.
- Leitura durante a execução comprovou claim adquirido, status running e
  attemptNumber=2. Ao final existe exatamente um AUTO_REMINDER da ocorrência,
  status completed, vinculado ao SYNC_RUN original das 18h e à prova aprovada.
- Nenhum falso claim-conflict. O claim-fix foi exercitado em produção.

| Resultado agregado | Quantidade |
| --- | ---: |
| Avaliados | 59 |
| Ativos | 34 |
| WITHDRAWN | 25 |
| Elegíveis | 27 |
| Sent | 27 |
| Failed | 0 |
| Pending / sending / unknown | 0 / 0 / 0 |
| Skipped | 32 |
| Skip withdrawn | 25 |
| Skip no-pending | 7 |
| Skip no-email / already-sent / outros | 0 / 0 / 0 |

### Persistência, dedupe e SES

Auditoria somente leitura confirmou **27 REMINDER, todos sent**, com 27 pares
student/publication distintos e 27 messageIds distintos. Todos pertencem ao
conjunto aprovado e à publicação original; zero destinatário fora do conjunto,
zero reserva/envio para WITHDRAWN e zero duplicidade.

Os registros anteriores da partição BRSA0267 permaneceram idênticos, incluindo
settings, METADATA, publicação, SYNC_RUN e participação. As únicas inclusões da
execução nessa partição foram o AUTO_REMINDER original e os 27 REMINDER. Settings
de ambas as turmas intactos; BRSA0257 continua AUTO_REMINDER=0 e REMINDER=0.
Eventos de delivery são escritos normalmente pelo consumidor SES em suas chaves
EMAIL, fora da partição da turma.

Checkpoint de observabilidade **03:35:51 local**:

- Worker sent=27; CloudWatch **SES Send=27**, **Delivery=27**.
- **27 registros de delivery em delivered**, correlacionados aos messageIds
  dos REMINDER desta execução. Delivery não equivale a confirmação de leitura.
- GetAccount: SentLast24Hours=27; conta HEALTHY e SendingEnabled=true.
  O contador ainda mostrava zero na primeira leitura pós-envio, às 03:33;
  depois atualizou e convergiu com os registros/métricas.
- Nenhum Bounce, Complaint ou Reject observado até o checkpoint. Ausência de
  evento imediato não exclui feedback posterior.
- Lambda **Invocations=1, Errors=0, Throttles=0**, com datapoints retornados.
- Alarmes Errors e Throttles OK.
- Logs: um START, um END e um REPORT, resumo started e resumo completed;
  nenhuma linha inesperada e nenhum indício de PII, destinatário ou evento bruto.

Não ocorreu retry. Não foi gerada uma segunda chamada para testar dedupe;
a unicidade foi verificada nos registros persistidos e nos messageIds.

### Fechamento imediato e reconciliação

O fechamento iniciou imediatamente após a resposta, às **03:31:18.819**, e
terminou às **03:31:25.741**, sem erros:

1. Permissão temporária IAM revogada, restaurando a policy desabilitada.
2. Alias retornado à **versão 1**, desabilitada.
3. `$LATEST` com MANUAL_RECOVERY_ENABLED=false, datas epoch e automático=false;
   Active/Successful.
4. Ambos schedules confirmados DISABLED.

Nenhum controle foi tratado como cancelamento de execução em andamento. Neste
caso a resposta completed já havia chegado antes do fechamento.

Conforme a sequência de reconciliação documentada na seção 10, foi gerado e
revisado um plano novo de **fechamento**, contra state 82, usando defaults
manual=false. Escopo restrito à worker, alias e policy do operador, sem ACM,
schedules, código ou dados. Plano `auto5-manual-close.tfplan`, SHA-256
`433a5a0cf4ffef942a712d6f66bcc36b1baed255af30e290dd54883673e8201c`.

Aplicado uma vez: **0 added / 3 changed / 0 destroyed**, concluído às
**03:34:53**; state **83**. Essa reconciliação publicou a **versão 3 desabilitada**
e reapontou o alias para ela, porque o Terraform configura o alias com `.version`.
Portanto, versão 1 foi o retorno imediato; **o alias final é versão 3, manual=false**.
A versão 2 é histórica/imutável, não é mais alvo do alias e não possui permissão
de Invoke para a role do operador. Sua janela absoluta termina às 04h00.

Auditoria final confirmou:

- Cinco Lambdas Active/Successful, código aprovado inalterado e configurações
  não relacionadas equivalentes ao início da operação.
- Alias versão 3 e `$LATEST`: manual=false, automático=false, datas epoch.
- Trust original preservada; policy revogada. Simulação IAM nega Invoke no
  alias, ARN não qualificado e versão numérica 2.
- BRSA0267 e BRSA0257: DISABLED, calendário definitivo terça/sexta 20h preservado.
- State reconciliado no serial **83**.
- Full plan somente leitura, sem `-out`: **1 add / 0 change / 0 destroy**,
  exclusivamente `aws_acm_certificate.portal`; nenhuma ação residual AUTO-5.

Após convergência, os dois tfplans consumidos foram apagados. O tfvars temporário
de ativação também foi removido de `.build`, mantendo cópia privada de evidência.
Não houve mudança de código, frontend, API ou settings nesta operação.

Evidências privadas:
`/private/tmp/auto5-manual-live-20261010-h31eroeu`.
Relatórios sanitizados: `approved-preflight.json`, `activated.json`,
`pre-invoke.json`, `claim-observed.json`, `invoke-result.json`, `closure.json`,
`observation.json`, `infrastructure-final.json` e `completion.json`.

**PARADA.** Recuperação LIVE manual concluída; nenhuma nova tentativa autorizada.
Schedules permanecem DISABLED; BRSA0257 não foi ativada. AUTO-5 não está encerrada:
o disparo natural do Scheduler e a ativação da segunda turma continuam pendentes
de aprovação e validação separadas.

## 12. Fase A BRSA0257 — preflight de 10/10, 13h36

**Recuperação da ocorrência de sexta BLOQUEADA por publicação substituída.**
Rodada exclusivamente de leitura. Nenhuma autorização, versão, alias, policy,
schedule ou dado de domínio alterado; nenhum plano de ativação preparado,
nenhum Invoke, nenhum dry-run em produção e nenhum SendEmail.

### Estado seguro e acompanhamento da BRSA0267

Auditoria de 13:36:13 a **13:36:49 America/Sao_Paulo**, conta `712107929769`,
região `us-east-1`:

- State **83** antes/depois; HEAD `3dd32c7`, ZIP e código publicado aprovados.
- Cinco Lambdas **Active/Successful**, configurações não relacionadas intactas.
- Alias `manual-recovery` → **versão 3**, manual=false; `$LATEST` manual=false;
  automático=false. Nenhuma exceção de horário ativa.
- BRSA0257 e BRSA0267 schedules **DISABLED**, terça/sexta 20h,
  America/Sao_Paulo, flexible OFF.
- IAM temporário revogado; trust original e policy restrita preservados.
  Simulação nega Invoke no alias, função não qualificada e versões 2/3.
- BRSA0267: claim completed inalterado, 27 REMINDER sent inalterados e
  **27 deliveries continuam delivered**.
- Métricas desde o LIVE: SES Send=27 e Delivery=27; nenhum Bounce, Complaint
  ou Reject observado até este checkpoint. Lambda Invocations=1, Errors=0,
  Throttles=0; alarmes Errors/Throttles OK. Nenhuma nova invocação da worker
  observada depois da única chamada manual autorizada.

### Prova original e publicação atual

Ocorrência pretendida: sexta **09/10/2026 às 20h**,
`scheduledFor=2026-10-09T23:00:00Z`. Claim original da BRSA0257 ausente.

| Verificação | Resultado |
| --- | --- |
| SYNC_RUN de sexta 18h | portal.scheduler / succeeded |
| Etapas de sexta | catalog=succeeded, roster=succeeded, grades=published |
| Conclusão de sexta | 18:01:13, antes do limite original das 20h |
| Publicação de sexta ainda current | **Não** |
| metadataVersion da prova de sexta corresponde ao METADATA atual | **Não** |
| SYNC_RUN natural de sábado 06h | portal.scheduler / succeeded |
| Etapas de sábado | catalog=succeeded, roster=succeeded, grades=published |
| Conclusão de sábado | **06:01:10** |
| Publicação e metadataVersion de sábado correspondem ao estado atual | **Sim** |

O sync de sábado produziu uma publicação nova. A prova antiga não pode autorizar
o envio relativo à ocorrência de sexta. A checagem de `CohortRun.prepare` a
recusaria com `publication-changed`, mesmo com os gates corretos. Não há fallback,
alteração de scheduledFor para sábado nem relaxamento de prova proposto.

### População atual — publicação de sábado

Calculada pelas funções reais `fixed_publication`, `withdrawn_ids` e
`evaluate_recipient`, por leitura consistente, sem executar handler, claim,
reserva ou envio. Partição, snapshot e vínculo reverso permaneceram estáveis
entre as leituras anterior/posterior.

| Medida | Contagem |
| --- | ---: |
| Total | 56 |
| Ativos | 39 |
| WITHDRAWN / skip withdrawn | 17 |
| Skip no-email | 1 |
| Skip no-pending | 16 |
| Skip already-sent | 0 |
| Outros skips | 0 |
| **Elegíveis na publicação atual** | **22** |
| Endereços distintos entre elegíveis | 22 |

Todos os 22 estão ACTIVE (explícito ou implícito), têm pendência e nenhuma
reserva/envio anterior para a mesma publicação. Zero duplicidade de aluno,
student/publication ou endereço entre os elegíveis. BRSA0257 permanece
AUTO_REMINDER=0 e REMINDER=0.

**Esses 22 são candidatos da publicação atual; não tornam a recuperação de
sexta elegível e não estão autorizados a receber nesta rodada.** A população
precisa ser revalidada antes de qualquer envio futuro, inclusive se o número
permanecer igual mas os destinatários mudarem.

### Settings, remetente e capacidade

REMINDER_SETTINGS BRSA0257 v1 presente, automaticEnabled=true, inalterado;
sender configurado corresponde ao checkpoint aprovado da responsável Vitória.
Vínculos direto/reverso válidos. Lógica real `SESMailer.readiness`: **PASS**.
GetEmailIdentity HTTP 200, VerificationStatus=SUCCESS,
VerifiedForSendingStatus=true e DKIMStatus=SUCCESS. Nenhum endereço exposto.

SES: ProductionAccessEnabled=true, SendingEnabled=true, HEALTHY.
Quota 50.000/24h, SentLast24Hours=27, **49.973 disponíveis**, taxa **14/s**.
Capacidade suficiente para 22. Worker: timeout 300s, pacing 250ms (teto 4/s),
5,5s apenas de pausas para 22 envios; latência de leitura/transação/SES se soma
a esse tempo. Capacidade não elimina o bloqueio de prova.

### Contrato manual e proposta permitida

Revisão de `backend/automatic_reminders.py`, `previous`/`acquire`: o contrato
atual **não exige tentativa anterior nem claim preexistente**. `old=None`
permite a primeira aquisição, desde que todas as demais condições passem.
Assim, ausência de tentativa anterior não é o impedimento encontrado.

Há também uma restrição de configuração independente: a validação em
`infra/terraform/manual-recovery.tf` aceita explicitamente apenas
**BRSA0267 / 09-10-2026 20h**. Não basta alterar o payload ou reutilizar a
autorização anterior. Uma futura autorização da BRSA0257 dependeria de mudança
de configuração revisada, mantendo uma única turma/ocorrência, IAM do operador,
alias exclusivo e validade absoluta de até 30 minutos. Não foi alterada agora.

Não existe proposta válida para habilitar a recuperação de sexta com o estado
atual. Alternativas seguras para decisão do operador:

1. **Fluxo manual normal do portal**, usando a publicação atual e sua prévia,
   por pessoa instrutora vinculada e autenticada, com remetente pronto. A API
   existente está com REMINDERS_ENABLED=true; o lote usa expectedPublicationId,
   reserva transacional, exclusão de WITHDRAWN e dedupe. Depende de aprovação
   específica dos 22 destinatários atuais. Esse fluxo não exercita o claim
   AUTO_REMINDER da worker; não deve ser apresentado como prova equivalente
   de toda a recuperação automática.
2. **Aguardar a próxima ocorrência válida**, terça **13/10 às 20h**, com nova
   prova natural das 18h e população revalidada. Qualquer autorização manual
   futura deve se vincular a essa nova ocorrência real, com expiração curta e
   plano separado aprovado; não reutilizar a prova ou autorização de 09/10.

Fase B permanece condicionada ao aceite dos dois LIVE manuais. Os alvos de
Scheduler BRSA0267 em 13/10 e BRSA0257 em 16/10 continuam objetivos dependentes
das aprovações e da ordem dos gates. Se o manual da BRSA0257 for adiado para
13/10 às 20h, será necessário revisar o calendário do piloto natural, pois
não se deve habilitar o piloto exatamente no horário de disparo ou antes do
aceite exigido. Nenhuma habilitação ou observação futura foi agendada por esta
rodada de preflight.

Evidências privadas:
`/private/tmp/auto5-brsa0257-preflight-20261010-mwapsahe`.
Relatório sanitizado `preflight-summary.json`; dados usados na classificação
permanecem privados. **PARADA: nenhuma execução real autorizada ou realizada.**

## 13. BRSA0257 — prévia do fluxo manual normal, 10/10 às 13h48

O operador escolheu o fluxo manual normal para a publicação atual. A recuperação
de 09/10 continua bloqueada e não foi modificada. Esta rodada terminou na prévia,
sem aprovação de envio, alteração da worker ou início da Fase B.

### Forma de execução e limite de autenticação

Executada a implementação existente
`Portal.dispatch -> _reminder_batch("pending-preview-batch")`, localmente com
leituras reais da AWS, após conferir que portal.py, reminders.py, repository.py
e grades.py correspondem byte a byte ao ZIP publicado. A consulta usou o
contexto de dados do remetente configurado, sem grupo admin, e conferiu o vínculo
real por `can_teach`. Esse contexto local **não é sessão Cognito, JWT ou login**.

Foram bloqueadas explicitamente todas as escritas do Repository, criação de
identidade e envio do SES, além de qualquer operação AWS que não fosse leitura.
Nenhuma Lambda, handler HTTP, operação send-reminders ou worker foi invocada.

A prévia autenticada pela API normal permanece **pendente de acesso à sessão
da Vitória**; a informação foi solicitada ao operador, sem pedir senha/token
pelo chat. O fluxo manual normal usa o usuário autenticado como remetente,
não seleciona automaticamente o senderUserId de REMINDER_SETTINGS. Antes de
usar a API, a sessão deve corresponder ao remetente aprovado e aos vínculos
revalidados. Não foram criados login, conta, token ou claims para contornar isso.

### Publicação e lote observados

Prévia técnica concluída às **13:48:18 America/Sao_Paulo**. Publicação atual do
Canvas de sábado, publicada em **10/10/2026 às 06:01:10**, continua current.
METADATA, publicação, snapshot efetivamente usado na prévia, settings, vínculos
e partição da turma permaneceram estáveis entre as leituras.

- Fingerprint da publicação:
  `d6a32a86224bfd6cabba77ef44c6c3780cd94f71c0b14ea39661c6e0882404fb`.
- metadataVersion:
  `b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa`.
- PublicationId real, snapshot e conjunto de destinatários preservados somente
  em evidência privada, para comparação antes de qualquer envio aprovado.

| Classificação | Contagem |
| --- | ---: |
| Total avaliado na prévia | 56 |
| Ativos | 39 |
| WITHDRAWN / skip withdrawn | 17 |
| Sem e-mail | 1 |
| Sem pendências | 16 |
| Already-sent | 0 |
| Outros skips | 0 |
| **Elegíveis para revisão** | **22** |
| Endereços distintos entre elegíveis | 22 |

Conferidos para cada elegível: ACTIVE, pendência positiva e ausência de REMINDER
para a publicação atual. Zero aluno/endereço duplicado; nenhum já contatado.
O lote de envio futuro deve conter somente esse conjunto aprovado, revalidado
contra a publicação ainda current. Igualdade da contagem sozinha não basta.

### Remetente, SES e controles

Vitória: sender correspondente ao settings aprovado, vínculos direto/reverso
válidos, SES readiness **PASS** tanto na revalidação como no retorno da prévia.
Settings v1 intacto e automaticEnabled=true. Nenhuma mensagem de exemplo,
endereço, nome de aluno ou identificador pessoal foi impresso no relatório.

SES HEALTHY, SendingEnabled=true; 49.973 disponíveis/24h e taxa 14/s.
BRSA0267 continua com 27 REMINDER sent e 27 deliveries, sem novos bounces ou
complaints observados na revalidação desta rodada.

Estado preservado:

- State 83; cinco Lambdas Active/Successful com hash aprovado.
- Gate do fluxo normal do portal, já existente: REMINDERS_ENABLED=true.
- AUTOMATIC_REMINDERS_ENABLED=false; MANUAL_RECOVERY_ENABLED=false.
- Alias manual versão 3 desabilitada; IAM temporário revogado.
- Ambos schedules DISABLED.
- BRSA0257: AUTO_REMINDER=0 e REMINDER=0.
- Zero escrita de domínio, zero Invoke e zero SendEmail nesta rodada.

Evidências privadas:
`/private/tmp/auto5-brsa0257-portal-preview-20261010-ayoleacr`.
Resumo sanitizado `preview-summary.json`; retorno completo e conjunto proposto
permanecem privados. O conjunto está marcado `approved_for_sending=false`.

**PARADA antes do envio real.** Pendentes: sessão autenticada para a chamada
normal do portal, confirmação da prévia pela API e aprovação explícita do lote.
Uma futura aprovação exige revalidar publicação, destinatários e remetente antes
da única operação de envio. Nenhum plano ou alteração da Fase B foi preparado.

## 14. BRSA0257 — lote aprovado condicionalmente, 10/10 às 14h06

O operador aprovou os 22 destinatários da prévia técnica, com duas condições
antes de enviar: prévia idêntica pela API autenticada normal e confirmação
explícita na interface do portal. O login será feito pelo operador na conta
autorizada da Vitória, sem compartilhar senha, token ou cookies com o agente.
Nenhuma dessas condições foi tratada como cumprida apenas pela aprovação no chat.

### Revalidação somente leitura

Concluída às **14:05:51 America/Sao_Paulo**, com comparação do lote aprovado às
**14:06:22**. Permaneceram idênticos: publicationId, METADATA, metadataVersion,
settings e conjunto de destinatários com seus endereços e pendências. A
comparação conferiu os valores privados, além das contagens agregadas.

- Publicação current: **10/10/2026 às 06:01:10**.
- metadataVersion:
  `b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa`.
- **56 total; 39 ACTIVE; 17 WITHDRAWN; 1 sem e-mail; 16 sem pendências;
  0 already-sent; 22 elegíveis, com 22 endereços distintos.**
- Todos os elegíveis ACTIVE, com pendências e sem REMINDER para a publicação.
- Vitória: readiness PASS, identidade SES verificada, settings v1 e vínculos
  direto/reverso intactos.
- SES HEALTHY, sending enabled, quota disponível 49.973/24h e rate 14/s.
- BRSA0257: **AUTO_REMINDER=0; REMINDER=0**.
- BRSA0267: 27 REMINDER sent, 27 deliveries correlacionados por messageId,
  sem bounce/complaint observado.

As métricas SES globais da conta somavam 28 Send/28 Delivery no intervalo
consultado; elas incluem tráfego além dos 27 lembretes correlacionados da
BRSA0267. Esse total global não foi atribuído à BRSA0257 nem tratado como
evidência de envio deste lote.

Controles preservados: state 83, cinco Lambdas Active/Successful com hash
aprovado, alias manual versão 3 desabilitada, IAM temporário revogado,
AUTOMATIC_REMINDERS_ENABLED=false, MANUAL_RECOVERY_ENABLED=false e ambos
schedules DISABLED. REMINDERS_ENABLED=true permanece sendo o gate existente
do fluxo normal do portal.

### Etapa humana pendente e operação única

O agente não dispõe de controle da sessão do navegador. Foi solicitado ao
operador abrir BRSA0257, limpar a busca e usar o filtro **Com atividades sem
nota** para abrir **Lembretes em lote**, inicialmente sem confirmar o envio.
O resultado autenticado ainda não foi informado. A consulta aos logs da API
desde 14h00 não encontrou chamadas das rotas de prévia em lote ou envio em
lote até o checkpoint; os logs não contêm remetente nem conteúdo da prévia
e, isoladamente, não comprovam a identidade autenticada.

Após conferir a prévia idêntica, o lote deve ser apresentado ao operador e
confirmado no diálogo existente **Enviar lembrete para 22 alunos?**. O frontend
envia apenas os elegíveis da prévia, com expectedPublicationId, por uma única
operação POST. O fluxo de rede existente não repete POST automaticamente.
Qualquer divergência exige parada e nova prévia antes do envio.

A Lambda identity tem timeout de 29 segundos; em timeout, erro ou resultado
desconhecido, não repetir o envio. Consultar primeiro REMINDER e os eventos de
delivery persistidos. A confirmação do lote na interface e o resultado do envio
devem ser registrados antes de declarar PASS. O fluxo normal não cria claim
AUTO_REMINDER; sua ausência será conferida também após a operação.

**Nenhum envio executado pelo agente, nenhuma escrita de domínio ou mudança
de infraestrutura nesta rodada. Prévia autenticada e envio ainda pendentes.**
Nenhuma ativação da Fase B foi iniciada.

Evidências privadas:
`/private/tmp/auto5-brsa0257-portal-approved-20261010-bclzwl54`.
Resumos sanitizados: `preflight-summary.json` e
`approved-preflight-summary.json`. Evidências com dados pessoais permanecem
privadas e não foram incluídas neste documento.

## 15. BRSA0257 — auditoria do envio informado pelo operador, 10/10 às 14h32

**Resultado: envio não confirmado; não declarar PASS.** O operador informou
que confirmou uma única operação pelo portal autenticado da Vitória para os
22 elegíveis aprovados. A rodada seguinte realizou exclusivamente leituras na
produção, conta AWS 712107929769, região us-east-1. Não executou prévia HTTP,
InvokeFunction, envio, retry, escrita de domínio ou mudança de configuração.

### Registros persistidos e publicação

Leitura consistente iniciada às **14:30:50**, auditoria concluída às
**14:31:02** e segunda leitura consistente às **14:32:06 America/Sao_Paulo**.
A partição da BRSA0257 permaneceu idêntica ao baseline anterior ao envio
informado. A publicação de **10/10 às 06:01:10** continua current, com
metadataVersion
`b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa`.
O registro da publicação e os dados de notas/endereços do snapshot continuam
correspondendo à prévia aprovada.

| Evidência | Resultado observado |
| --- | ---: |
| Destinatários aprovados | 22 |
| REMINDER da publicação | 0 |
| REMINDER em qualquer publicação da turma | 0 |
| Registros sent | 0 |
| Registros failed | 0 |
| Registros sending | 0 |
| Registros unknown | 0 |
| Registros skipped | 0 |
| AUTO_REMINDER da BRSA0257 | 0 |
| MessageIds correlacionáveis ao lote | 0 |
| Entregas correlacionáveis ao lote | 0 |

O fluxo normal não persiste os skips como REMINDER. Portanto, o total real de
skipped da operação permanece **indeterminado**, pois não há corpo de resposta
nem chamada de envio observada. Os zeros da tabela são contagens de registros,
não um retorno bem-sucedido da operação.

Não foram encontrados duplicatas, reservas/envios para os 17 WITHDRAWN,
reservas/envios fora do conjunto aprovado ou envios para alunos sem pendências.
Como não há nenhum REMINDER da turma, isso **não comprova execução bem-sucedida
dos controles durante este LIVE**. Os 22 destinatários continuam sem registro
de envio para a publicação. Também não há registro `by` para comprovar o
remetente desta operação; a sessão foi informada pelo operador.

### API, resposta e SES

Foram consultados os logs de acesso de **10/10, 00h00 até 14h32**, abrangendo
49 eventos. Só foram observadas as rotas GET /me, GET /cohorts e GET
/cohorts/{code}/report, com HTTP 200, além de respostas 204 sem rota.

- Nenhuma chamada a pending-preview, pending-preview-batch, send-reminder ou
  send-reminders encontrada nesse intervalo.
- Nenhum status HTTP ou corpo de resposta de envio disponível para confirmar.
- Nenhum erro 5xx nos logs consultados. Os logs não contêm o conteúdo da
  requisição, o sujeito autenticado ou o corpo da resposta.

No intervalo de métricas **14h00–14h30min59s**, o SES global da conta registra
**1 Send e 1 Delivery às 14h03**, já anterior à aprovação condicional registrada
na seção 14; não há messageId de REMINDER da BRSA0257 para atribuir esses eventos
ao lote. Bounce, Complaint e Reject: **nenhum ponto observado**, soma zero.
Não atribuir o envio global aos 22 destinatários aprovados.

SES HEALTHY, SendingEnabled=true. BRSA0267 permanece com os mesmos
**27 REMINDER sent e 27 deliveries correlacionados**, sem bounce/complaint
observado. Os registros da operação anterior não mudaram.

### Logs e controles preservados

- Logs da API, identity, reminder-events e automatic-reminders examinados no
  intervalo 14h00–14h30min59s: sem indicadores de PII ou evento bruto.
- Identity: 6 invocações, **Errors=0; Throttles=0**, correspondentes ao tráfego
  de consulta observado. Worker automática e delivery: zero invocações no
  intervalo. Esses valores não comprovam uma execução do envio solicitado.
- Dois cold starts da identity emitiram `SyntaxWarning: invalid escape sequence`
  em `feedback.py:208`, às consultas anteriores. Sem erro de execução/timeout
  observado. O aviso foi registrado; nenhuma correção de código foi feita.
- Alarmes consultados: OK.
- REMINDER_SETTINGS das duas turmas intactos, comparados ao baseline aprovado;
  demais registros preexistentes da BRSA0257 também intactos.
- Cinco Lambdas Active/Successful, hash aprovado e configurações intactas.
- State **83**, alias manual **versão 3 desabilitada**, IAM temporário revogado.
- AUTOMATIC_REMINDERS_ENABLED=false e MANUAL_RECOVERY_ENABLED=false, inclusive
  na versão apontada pelo alias.
- BRSA0257 e BRSA0267: **DISABLED**, cron terça/sexta 20h, timezone
  America/Sao_Paulo, flexible OFF.

### Parada e evidências

Foi solicitado ao operador somente o horário aproximado, a mensagem exibida
pela interface e a confirmação do ambiente de produção/demonstração, sem senha,
token, cookies ou dados de alunos. A divergência entre a operação informada e
os registros da produção permanece sem causa determinada neste checkpoint.

**Não repetir o envio. Não habilitar schedules. Não iniciar outro envio nem a
Fase B. AUTO-5 continua aberta.**

Evidências privadas:
`/private/tmp/auto5-brsa0257-portal-result-20261010-cipq6s61`.
Resumos sanitizados: `audit-summary.json`, `domain-summary.json` e
`confirmation-summary.json`; partições e logs completos preservados com acesso
local restrito. Nenhuma PII incluída neste relatório.

## 16. BRSA0257 — preparação programática da API normal, 10/10

Escopo desta rodada: investigar e preparar o fluxo existente, revalidar a
publicação atual e executar somente a prévia autenticada quando o operador
concluir o login. **POST de envio não aprovado nesta rodada.** Não usar a
ocorrência antiga, manual-recovery, SYNC_RUN artificial ou invocação direta
com claims/API Gateway falsificados.

### Contrato confirmado no código, OpenAPI e AWS real

| Operação | Endpoint | Payload fechado |
| --- | --- | --- |
| Prévia | POST /cohorts/BRSA0257/pending-preview-batch | studentIds: lista de 1–200 IDs únicos |
| Envio futuro | POST /cohorts/BRSA0257/send-reminders | studentIds + expectedPublicationId |

Ambas as rotas apontam para **restart-portal-prod-identity**, handler
`portal.handler`, que despacha para `Portal._reminder_batch`. O authorizer
real é JWT, emissor Cognito do pool de produção, audiência do cliente web
aprovado, scope **portal/access**. O backend ainda exige token_use=access,
e-mail verificado e e-mail institucional para lembretes. `can_teach` exige
vínculo USER#/TEACH# da turma ou admin; esta operação será restringida à
identidade exata da Vitória, sem usar a exceção de administrador.

Referências: `openapi/portal.yaml` nas operações previewReminderBatch e
sendReminderBatch; `backend/portal.py` em authenticate, can_teach e
_reminder_batch; `backend/reminders.py` em reserve_reminder e
send_reserved_reminder; `backend/repository.py` em transaction/_expected_data.
O OpenAPI declara HTTP 200 genérico para o resultado e avisa que falhas
individuais podem existir nessa resposta: status HTTP sozinho não é PASS.

A prévia devolve publicationId, publishedAt, readiness, exemplo e destinatários
com pending/skip. metadataVersion não integra o payload do endpoint; será
comparada por leitura da METADATA antes/depois da prévia e antes do envio.
O remetente vem da sessão autenticada. REMINDER_SETTINGS é conferido no
preflight; a API normal não escolhe o remetente por esse registro.

### Autenticação sem exportação de segredos

Configuração pública do portal conferida contra o Terraform; módulos api.js
e auth.js publicados correspondem byte a byte aos arquivos revisados. O
cliente Cognito usa Authorization Code + PKCE, sem client secret, com access
token de 15 minutos e callbacks HTTPS existentes. Não foi adicionado callback
local, modificado o cliente ou criada identidade.

Abordagem preparada: script local Playwright com **janela visível e contexto
isolado novo**, em que o operador faz login na tela normal do Cognito. O
script não lê senha, cookies, localStorage, headers Authorization nem respostas
OAuth. Não há exportação de sessão, trace, gravação ou screenshot. O próprio
auth.js mantém a sessão; o próprio api.js faz a requisição autenticada dentro
desse contexto. Nenhum token passa para o processo operacional ou relatório.

Após login, GET /me deve corresponder ao userId/e-mail aprovados e papel de
instrutor sem admin. Só então o script permite **uma** chamada à prévia, com
os 56 IDs do snapshot conferido. Compara os 22 elegíveis por ID, endereço e
quantidade de pendências, além de publicação, readiness e motivos de skip.
Os resultados completos ficam em evidência privada; o relatório é agregado.

Durante essa sessão de investigação, as rotas de envio e demais escritas da
API são bloqueadas pelo script. Ele não possui execução de send-reminders.
Também não solicita criação de conta, recuperação de senha ou confirmação de
e-mail. A janela fecha ao concluir ou ao expirar o prazo local de login.

**Checkpoint de autenticação:** janela Cognito aberta às **15h54** e login
solicitado ao operador. Até este registro, a prévia autenticada não foi
executada; não confundir os resultados somente leitura abaixo com resposta
da API autenticada. A conclusão será registrada apenas com evidência efetiva.

### Revalidação de produção às 15h52

- Publicação de **10/10 às 06:01:10**, ainda current.
- METADATA e metadataVersion idênticas à aprovação:
  `b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa`.
- **56 total, 39 ACTIVE, 17 WITHDRAWN, 1 sem e-mail, 16 sem pendências,
  0 already-sent, 22 elegíveis**, com 22 endereços distintos.
- Conjunto de destinatários corresponde à prévia aprovada, todos ACTIVE,
  com pendências e sem REMINDER prévio para a publicação.
- Sender Vitória, vínculos direto/reverso e settings v1 PASS; readiness PASS.
- SES HEALTHY, envio habilitado, disponibilidade 49.972/24h e rate 14/s.
- REMINDER=0 e AUTO_REMINDER=0 para BRSA0257.
- State 83, cinco Lambdas Active/Successful com hash aprovado; alias manual
  versão 3 desabilitada, IAM temporário revogado; gates automático/manual
  false e ambos schedules DISABLED.

### Reserva, dedupe e operação única proposta

A API primeiro compara expectedPublicationId com a publicação current. Cada
reserva usa a chave **REMINDER#publicationId#studentId**, com transação que
condiciona METADATA ao snapshot lido, PARTICIPATION ausente/ACTIVE e REMINDER
ausente ou failed. sent, sending e unknown não são reabertos. Mudança de
publicação/participação durante a reserva bloqueia o destinatário; os fluxos
manual e automático compartilham a mesma chave de dedupe.

Isso não constitui garantia absoluta de exactly-once no SES. O envio SES não
usa chave de idempotência; falha incerta permanece unknown e bloqueada.
Rejeição definitiva pode ser failed, para eventual decisão explícita futura.
Esta operação não repetirá nem failed automaticamente.

Sequência proposta, dependente de **aprovação final posterior**:

1. Obter prévia autenticada idêntica e revisar o lote agregado.
2. Revalidar publicação, metadataVersion, participação, destinatários, settings,
   readiness e identidade autenticada imediatamente antes do envio.
3. Criar marcador local exclusivo da operação antes da requisição; nunca
   removê-lo automaticamente para permitir retry.
4. Emitir uma única chamada programática ao cliente existente
   `api.reminders.sendBatch`, sem clicar em botão, contendo apenas os IDs dos
   22 elegíveis confirmados e expectedPublicationId da prévia.
5. Examinar cada resultado, registros REMINDER e deliveries correlacionados.
   Confirmar AUTO_REMINDER=0, pois o fluxo manual normal não cria claim.

Timeouts reais: Lambda identity **29s**, integração API Gateway **30s**,
cliente existente **35s**. Em timeout, 5xx, queda de conexão ou resultado
desconhecido, **não repetir o POST**, mesmo que a interface sugira tentar
novamente. A execução pode ter realizado parte dos envios; consultar primeiro
os estados persistidos, messageIds, delivery e logs. O cliente existente já
limita POST a uma tentativa. Não há rollback de e-mail enviado.

Não foi necessário propor nova Lambda para o caminho disponível. Se não for
possível estabelecer a sessão legítima, um entrypoint operacional IAM para a
publicação CURRENT teria de ser tratado em mudança separada, com contrato,
testes, CI e aprovação de deploy; não será improvisado nesta investigação.

Evidências/preparação locais privadas:
`/private/tmp/auto5-brsa0257-api-prepare-20261010-8rac0vt3`.
Arquivos: `contract-summary.json`, `preflight-summary.json`,
`operation-plan.json`, `authenticated-preview.mjs` e manifesto privado.
Nenhuma alteração em código de domínio, infraestrutura, schedules ou gates;
nenhum e-mail enviado nesta preparação.

## 17. BRSA0257 — sessão isolada expirada; prévia não executada, 10/10

O operador informou a conclusão do login. Ao retomar, a evidência local mostrou
que o processo de prévia já havia encerrado por **TimeoutError na etapa de
espera do login Cognito**, às **16:04:06 America/Sao_Paulo**. O script aguardou
dez minutos, não observou o retorno autenticado dentro desse prazo e fechou
o contexto e a janela em seu bloco de encerramento.

Não é possível usar essa sessão já fechada ou afirmar que o login informado
foi validado pelo script. Nenhuma outra sessão foi inspecionada ou reutilizada;
nenhum token, cookie, senha ou credencial foi extraído. Diante da divergência,
a execução parou sem abrir outra sessão automaticamente.

Resultado do processo: **preview_request_issued=false; send_requests=0**.
Não existem resposta de prévia autenticada ou payload de envio derivado dela.
Os 22 destinatários permanecem uma aprovação técnica anterior, sem confirmação
pela API nesta rodada.

Revalidação exclusivamente por leitura às **16:35:14**:

- Partição completa da BRSA0257 idêntica ao baseline das 15h52, inclusive
  publicação, METADATA, settings e participação.
- REMINDER=0; AUTO_REMINDER=0.
- Logs da API entre 15h54 e 16h35 sem chamada de prévia ou envio de lembretes.
- AUTOMATIC_REMINDERS_ENABLED=false; MANUAL_RECOVERY_ENABLED=false.
- Alias manual versão 3, com manual recovery=false.
- Ambos schedules DISABLED, terça/sexta 20h, America/Sao_Paulo, flexible OFF.
- Zero escrita de domínio, alteração de infraestrutura ou envio pelo agente.

**PARADA.** A prévia autenticada exige nova sessão isolada ativa e login
legítimo; não houve aprovação nem tentativa de envio. A revalidação por AWS
não substitui a prévia autenticada solicitada.

Evidências no diretório da seção 16: `auth-failure-summary.json` e
`post-timeout-summary.json`; dados completos permanecem privados.

## 18. BRSA0257 — nova sessão isolada para prévia, 10/10 às 16h44

Nova rodada autorizada exclusivamente para autenticação legítima, revalidação
somente leitura e prévia pela API existente. Nenhum envio autorizado nesta
rodada. Não houve alteração em infraestrutura, código de domínio, gates ou
schedules.

A janela isolada Chromium foi aberta na entrada do portal e trazida à frente
às **16:44:13 America/Sao_Paulo**. O operador inicia o login normal pelo botão
**Entrar no meu portal** quando estiver pronto. O helper não clica nesse botão;
o prazo existente de dez minutos do fluxo OAuth começa nesse clique, e não
durante a preparação da janela. A espera local começou somente após a janela
e o botão estarem disponíveis, com limite às **17:14:13**.

O operador foi avisado da janela e do prazo. O script não acessa campos de
credenciais, cookies, localStorage, headers Authorization ou corpos OAuth.
Usa contexto novo sem exportação de sessão, gravação ou screenshots. O controle
local do navegador é restrito ao loopback e guardado em arquivo privado;
nenhum segredo Cognito é exportado ao processo operacional ou relatório.

Após autenticação, o helper deverá:

1. Conferir GET /me contra a identidade aprovada da Vitória, com papel de
   instrutor e sem utilizar admin.
2. Revalidar dados reais naquele momento: publicação current, metadataVersion,
   settings, vínculos direto/reverso, SES readiness, participação, pendências,
   REMINDER existentes e destinatários distintos.
3. Executar uma chamada a pending-preview-batch pelo api.js publicado.
4. Comparar o retorno com a leitura corrente e com o conjunto de referência,
   considerando IDs, endereços e pendências, além das contagens.
5. Revalidar por leitura que a partição, a publicação e o snapshot não mudaram
   durante a prévia. Apresentar resultado agregado e parar se houver mudança.

As duas rotas reais de prévia/envio foram novamente conferidas por leitura:
JWT Cognito, scope portal/access, integração com identity/portal.handler.
Configuração pública e módulos api.js/auth.js publicados continuam iguais aos
arquivos revisados. Isso confirma o contrato; não substitui login ou prévia.

**Checkpoint inicial:** login aguardando operador, TEACH da sessão e prévia
autenticada ainda pendentes; nenhuma requisição de prévia ou envio emitida.
Não atribuir PASS antes da resposta real.

Se a prévia for idêntica, a sessão ficará disponível por até **dez minutos a
partir da conclusão**, com deadline registrado no resultado. Não há keepalive
periódico; o cliente existente permanece responsável pela validade da sessão.
Ao expirar ou fechar, nova autenticação e nova revalidação serão necessárias.
O helper fecha o contexto e remove a referência privada de controle ao encerrar.

**send-reminders permanece bloqueado.** O helper desta rodada não implementa
envio. Um payload privado proposto poderá ser preparado a partir da prévia
autenticada aprovada, mas sua execução exige aprovação específica posterior,
revalidação, uma chamada e nenhum retry.

Evidências locais privadas:
`/private/tmp/auto5-brsa0257-api-session2-20261010-d9brshf2`.
`session-status.json` registra o estágio e os prazos; resumos de preflight,
prévia e pós-leitura só serão criados quando essas etapas realmente ocorrerem.

### Login confirmado e falha local antes da prévia

Às **16:45:42**, GET /me pelo cliente do portal confirmou a identidade aprovada
da Vitória, papel de instrutor e ausência de admin: **login PASS**. Antes de
consultar a prévia, o processo filho de revalidação falhou porque o arquivo
local chamado `inspect.py` ocultou o módulo homônimo da biblioteca padrão do
Python, provocando importação circular do boto3.

O helper encerrou o contexto nessa falha. **Nenhuma chamada à prévia e nenhum
envio foram emitidos.** A falha pertence ao script operacional local; não
houve mudança de código de domínio nem erro atribuído ao backend em produção.

Correção local: arquivo renomeado para `preflight_readonly.py` e referência
do helper atualizada. O script corrigido foi executado somente por leitura
antes de pedir nova autenticação. Às **16:47:33**, confirmou publicação e
metadataVersion idênticas, vínculos TEACH direto/reverso PASS, readiness PASS,
56 total/39 ACTIVE/17 WITHDRAWN/1 sem e-mail/16 sem pendências/0 already-sent/
**22 elegíveis**, com IDs e endereços distintos e o mesmo conjunto aprovado.
REMINDER=0; AUTO_REMINDER=0; flags false; ambos schedules DISABLED.

A janela foi reaberta às **16:47:44**, disponível para iniciar o login até
**17:17:44**. O operador foi informado do erro, da correção e da necessidade
de nova autenticação porque o contexto anterior já estava fechado. A prévia
continua bloqueada até login e nova revalidação posterior; a rota de envio
permanece bloqueada nesta rodada.

Primeira tentativa preservada em `attempt1-session-status.json` e
`attempt1-failure-summary.json`. O estado vivo da nova sessão permanece em
`session-status.json`; não usar o arquivo histórico como estado atual.

## 19. BRSA0257 — prévia autenticada e parada por mudança de população, 10/10 às 16h55

O novo login legítimo foi confirmado às **16:55:04 America/Sao_Paulo** por
GET /me através do cliente existente do portal: identidade autorizada da
Vitória, papel instructor e ausência de admin. Vínculos TEACH direto/reverso
válidos; a prévia autorizada pela API também confirmou acesso à turma.
Nenhum token, cookie, senha, endereço ou ID de aluno foi extraído para o
relatório.

Foi executada **uma** chamada autenticada a
`POST /cohorts/BRSA0257/pending-preview-batch`, pelo api.js publicado.
Conclusão da prévia e pós-leitura às **16:55:42**. Nenhuma chamada a
send-reminders foi executada; a rota de envio permanece bloqueada no helper.

Publicação current: **10/10/2026 às 06h01min10s**, sem alteração em relação à
referência. metadataVersion conferida antes/depois e idêntica:
`b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa`.
Readiness SES PASS; settings e remetente autorizados inalterados.

| População / classificação | Referência | Prévia autenticada |
| --- | ---: | ---: |
| Total | 56 | 56 |
| ACTIVE | 39 | 38 |
| WITHDRAWN | 17 | 18 |
| Skip no-email | 1 | 0 |
| Skip no-pending | 16 | 16 |
| Skip already-sent | 0 | 0 |
| Elegíveis | 22 | 22 |

Os 22 IDs e 22 endereços normalizados são distintos. O conjunto elegível e
suas pendências são exatamente os mesmos da referência: todos ACTIVE, com
pendências, sem REMINDER anterior; nenhum WITHDRAWN selecionado.

A comparação privada dos registros anteriores com a leitura pré-prévia
identificou **um novo PARTICIPATION WITHDRAWN e um registro AUDIT**. A única
linha diferente entre as prévias passou de no-email para withdrawn e está
fora dos 22 elegíveis. A mudança já existia antes da chamada de prévia.
Isso explica as contagens sem atribuir a alteração ao preview nem identificar
o aluno ou o autor da alteração. No-email é um motivo de skip após a regra
WITHDRAWN; zero nessa coluna não afirma que todos os 56 possuem e-mail.

As leituras consistentes antes/depois confirmaram partição e snapshot
idênticos durante a prévia: **zero escrita de domínio causada pela prévia**.
REMINDER=0, AUTO_REMINDER=0, settings intactos; automático=false,
manual recovery=false e ambos schedules DISABLED. Nenhum envio foi autorizado
ou realizado nesta rodada; nenhuma alteração de infraestrutura.

**PARADA obrigatória para revisão**, porque o operador exigiu nova revisão
se a publicação ou a população mudasse, mesmo mantendo 22 elegíveis. O resumo
técnico original do helper marcou PASS ao comparar publicação, settings e o
conjunto exato de destinatários, mas não incluiu as contagens de classificação
nesse rótulo. A revisão adicional registrou corretamente
`STOPPED_POPULATION_CHANGED` em `review-summary.json`; o artefato original
foi preservado e não representa autorização de envio.

A sessão foi mantida disponível por até **17:05:42**, com envio bloqueado,
sem keepalive ou exportação de autenticação. Esse prazo é o limite de retenção,
não garantia de validade futura: após encerramento/expiração, exigir novo
login e nova prévia. Qualquer envio requer aprovação explícita posterior e
revalidação imediata; nenhuma operação de envio está programada.

Evidências privadas no diretório da seção 18: `authenticated-preview-summary.json`,
`before-summary.json`, `after-summary.json` e `review-summary.json`.
Resposta completa e manifesto permanecem privados. **AUTO-5 aberta.**

## 20. BRSA0257 — envio manual normal aprovado, 10/10 às 17h05

O operador aprovou explicitamente **uma operação real para os mesmos 22
destinatários**, após revisar a mudança para 38 ACTIVE/18 WITHDRAWN. Escopo:
fluxo manual normal do portal, remetente Vitória, publicação current de
**10/10/2026 às 06h01min10s**, sem recuperação da ocorrência antiga.

### Autenticação e revalidação imediata

A sessão anterior estava aberta quando a aprovação chegou, mas o processo
que a controlava não permitia transferir o contexto autenticado ao processo
de envio; uma nova conexão Playwright não expunha o contexto anterior.
Nenhum envio foi tentado nessa sessão. O operador foi informado da limitação
local e da necessidade de novo login legítimo, sem extração de autenticação.

Nova janela disponibilizada às **17:04:21**, com prazo contado somente depois
de visível. O operador concluiu o login e GET /me confirmou a identidade
autorizada às **17:04:50**. Nenhum token, cookie ou senha foi exportado.
A aprovação do mesmo lote permaneceu válida; a janela foi preparada para
realizar a operação única apenas depois de todas as verificações passarem.

Foi obtida nova prévia autenticada pelo cliente existente. Leituras antes e
depois confirmaram publicação, metadataVersion, settings, participação e
conjunto exato de destinatários iguais ao checkpoint aprovado. Revalidação
final às **17:05:25**:

- Cognito da Vitória, TEACH direto/reverso e SES readiness: PASS.
- 56 total, 38 ACTIVE, 18 WITHDRAWN, 16 sem pendências, zero skip no-email,
  zero already-sent e **22 elegíveis**.
- 22 IDs e 22 endereços distintos; conjunto e pendências iguais aos aprovados.
- Todos ACTIVE e com pendências; nenhum WITHDRAWN ou previamente contatado.
- Publicação current e expectedPublicationId iguais à prévia; metadataVersion
  `b7341e42050380b8da7ec558fa70cbc5e0ac2683fc46a08c95f18539ad472baa` intacta.
- REMINDER=0 e AUTO_REMINDER=0 antes da operação.

### Uma chamada real

Foi liberada exclusivamente a operação aprovada
`POST /cohorts/BRSA0257/send-reminders`, através de `api.reminders.sendBatch`
do portal publicado. Payload restrito aos 22 studentIds aprovados e
expectedPublicationId; sem sender, destinatário adicional ou dados da
ocorrência antiga. Um marcador local exclusivo foi criado antes da chamada
e permanece preservado, impedindo repetição automática do script.

**Início 17:05:25,719; resposta 17:05:35,680 America/Sao_Paulo.**
**HTTP 200; uma requisição; 22 resultados sent; zero failed; zero skips.**
Conjunto de IDs retornado igual ao aprovado; publicationId igual à prévia.
Não houve retry, chamada direta à Lambda ou alteração de backend/Terraform/IAM.
A sessão foi encerrada às **17:05:35,758**.

### Persistência e entregas

A auditoria posterior utilizou exclusivamente leituras AWS, com bloqueio
local de chamadas de escrita e envio:

| Verificação | Resultado |
| --- | ---: |
| Selecionados / REMINDER da publicação | 22 / 22 |
| sent | 22 |
| failed / sending / unknown | 0 / 0 / 0 |
| skipped na resposta | 0 |
| MessageIds SES distintos | 22 |
| Delivery confirmado e correlacionado | 22 |
| Delivery pendente observado | 0 |
| Bounce / Complaint correlacionados observados | 0 / 0 |
| Duplicidade student/publication, endereço ou messageId | 0 |
| Reservas/envios WITHDRAWN | 0 / 0 |
| Envios sem pendências / fora do lote | 0 / 0 |
| AUTO_REMINDER BRSA0257 | 0 |

Os 18 WITHDRAWN ficaram excluídos. Todos os REMINDER pertencem à publicação
aprovada e ao remetente autorizado. As chaves estão corretas e não há estados
desconhecidos. Os registros preexistentes da partição permaneceram idênticos,
inclusive settings; apenas os 22 REMINDER foram acrescentados à turma.
O fluxo normal não cria AUTO_REMINDER. BRSA0267 conserva seus 27 deliveries.

Na primeira leitura às **17:05:52**, os 22 deliveries já estavam persistidos.
As métricas CloudWatch ainda não tinham pontos da operação; ausência de ponto
não foi interpretada como zero envios. A correlação individual usa os
messageIds dos REMINDER e os registros EMAIL/DELIVERY, sem imprimir esses IDs.
Bounce/Complaint são observações até o checkpoint, não garantia de ausência
de eventos posteriores.

### Observabilidade consolidada às 17h07

Nova auditoria somente leitura concluída às **17:07:19** confirmou a mesma
persistência e os mesmos 22 deliveries, com os registros preexistentes
idênticos byte a byte. A ingestão das métricas da operação já estava disponível:

| Métrica / evidência | Resultado |
| --- | ---: |
| SES Send / Delivery | 22 / 22 |
| SES Bounce / Complaint / Reject observados | 0 / 0 / 0 |
| identity Invocations no intervalo | 3 |
| identity Errors / Throttles | 0 / 0 |
| reminder-events Invocations | 22 |
| reminder-events Errors / Throttles | 0 / 0 |
| Worker automático: invocações observadas | 0 |
| Log API: POST send-reminders HTTP 200 | 1 |
| Padrões de PII / linhas inesperadas nos logs | 0 / 0 |

Intervalo CloudWatch: desde **17:05:00** até a coleta, incluindo a prévia,
GET /me e o envio na identity; as três invocações não representam três envios.
As métricas SES são da conta/região; os 22 eventos individuais foram também
correlacionados aos 22 messageIds do lote em DynamoDB. Sem eventos registrados
de Bounce/Complaint/Reject nesse intervalo. A worker automática não teve
logs nem pontos de invocação no período.

Os logs de delivery contêm 22 START/END/REPORT, sem falha ou timeout. O cold
start da identity repetiu o aviso conhecido `SyntaxWarning` de escape em
feedback.py:208 e sua linha de código, já observado antes deste envio;
nenhum erro de execução novo. Logs observados sem PII ou payload bruto.
Alarmes operacionais consultados continuam OK. SES HEALTHY e sending enabled.

**Envio manual normal BRSA0257: PASS neste checkpoint.** Não valida a
ocorrência natural do Scheduler, que permanece pendente.

### Controles preservados e evidências

AUTOMATIC_REMINDERS_ENABLED=false; MANUAL_RECOVERY_ENABLED=false.
BRSA0257 e BRSA0267 DISABLED, cron terça/sexta 20h, America/Sao_Paulo,
flexible OFF. Worker Active/Successful. REMINDER_SETTINGS inalterados.
Nenhuma automação foi habilitada; nenhuma nova operação de envio preparada.

Evidências locais privadas:
`/private/tmp/auto5-brsa0257-approved-send-20261010-0dcy_7if`.
Resumos sanitizados: `pre-send-pass-summary.json`, `send-result-summary.json`,
`domain-summary.json`, `audit-summary.json`. Payload, resposta detalhada,
manifesto e logs permanecem privados. Marcador da operação única preservado.

**AUTO-5 permanece aberta; a validação dos schedules naturais continua
pendente. PARADA após este envio, sem iniciar ativação automática.**

## 21. Desacoplamento do alias manual — preparação do gate automático

Checkpoint de 10/10/2026, após os dois envios manuais. **AUTO-5 EM ANDAMENTO.**
O gate automático está preparado no código, mas permanece **false na AWS**.
Nenhum apply ou envio faz parte desta correção.

### Causa e configuração explícita

A worker usa `publish=true`. O alias `aws_lambda_alias.manual_recovery`
referenciava `aws_lambda_function.automatic_reminders.version`; portanto,
alterar o gate ou o ZIP publicava uma versão e também movia o alias manual.
O plano isolado da worker não mostrava esse efeito residual do full plan.

O alias agora referencia `var.manual_recovery_target_version`, com valor
declarativo padrão `"3"`. A validação aceita somente versões publicadas
numéricas positivas, sem `$LATEST`, nome de alias, valor vazio, null ou zeros
à esquerda. `publish=true` permanece na worker; não há `ignore_changes`.
O valor precisa identificar uma versão existente e previamente verificada
na conta/região de destino; a validação sintática não atesta seu conteúdo.

O preflight de produção confirmou state serial **83**, alias na versão **3**,
sem routing weights adicionais. A versão 3 está Active/Successful,
`MANUAL_RECOVERY_ENABLED=false` e `AUTOMATIC_REMINDERS_ENABLED=false`,
com autorização expirada. Handler `automatic_reminders.handler`, Python
3.13, arm64, 256 MB, timeout 300 s; configuração comparada à worker atual.

Hash do pacote aprovado, inalterado:

```text
SHA-256: e5084d5657a71161dcb91da283a683746482fa566a0505f45e33eb9c7d9b4308
CodeSha256: 5QhNVlenEWHcuR2ig6aDdGSC+lZqBQX0XjPrnH2bQwg=
```

IAM temporário permanece revogado por condição temporal expirada; simulações
negam invocação do alias, da função não qualificada e da versão 3. Policies
não foram alteradas. Schedules BRSA0257/BRSA0267 continuam DISABLED, terça e
sexta às 20h, America/Sao_Paulo, flexible OFF. O target do Scheduler é o ARN
**não qualificado da worker**, executando `$LATEST`, e não o alias manual.
Assim, o futuro gate automático atualizado será o efetivamente utilizado
pelo Scheduler, enquanto o alias continuará na versão explicitamente fixada.

Os 49 REMINDER sent e 49 deliveries anteriores foram reconferidos; sem
novos lembretes ou eventos correlacionados de Bounce/Complaint observados.
Settings intactos, ambos remetentes ready e alarmes Errors/Throttles OK.

### Procedimento obrigatório para recuperação manual futura

1. Obter aprovação separada para turma, ocorrência, população, operador e
   validade curta. Revalidar domínio, publicação e readiness.
2. Preparar e revisar a configuração da versão autorizada; publicar essa
   versão em etapa controlada. Publicar **não move mais o alias**.
3. Conferir o número e o conteúdo da versão efetivamente publicada. Selecionar
   esse número em `manual_recovery_target_version` e revisar um plano explícito
   do alias e da autorização IAM. A configuração de `$LATEST` não modifica
   retroativamente o environment de uma versão imutável.
4. Somente após as aprovações e verificações previstas, realizar a operação
   única pelo alias. Timeout ou resultado desconhecido não autoriza retry.
5. Encerrar a autorização IAM, desabilitar manual em `$LATEST` e retornar o
   alias explicitamente à versão desabilitada verificada (atualmente 3, ou
   outra versão desabilitada aprovada). Reconciliar configuração/state e
   conferir full plan. Revogação não cancela execução já iniciada.

Atualizações automáticas de gate ou ZIP não constituem autorização para
mover o alias. Nenhum código Python, regra de domínio ou policy IAM foi
modificado nesta correção.

### Regressão e novos planos

O teste RED reproduziu o acoplamento: worker simulada na versão 4 fazia o
alias deixar a versão 3. O teste passa com a referência explícita. Testes
nativos Terraform cobrem publicação, ZIP, seleção deliberada de outra versão,
rejeição de valores inválidos, schedules desligados e manual false. A suíte
de transições executa o HCL real em cópias descartáveis com gate false e true,
usando providers mockados, e rejeita regressões deliberadas do isolamento.

Validação local: backend 300/300, integração Moto 82/82, Node/OpenAPI
177/177, navegador 19/19, build, fmt/validate e Terraform 20/20. Transições
do alias: duas suítes aprovadas e cinco mutações rejeitadas. Mutações do
claim: 12/12 detectadas; autorização manual: 11/11 detectadas; OpenAPI/HCL:
11 cenários aprovados. Revisão adversarial local: 0 BLOCKER / 0 IMPORTANT.

O plano `auto5-gate-enable.tfplan` foi **invalidado e removido**, sem apply.
O novo artefato previsto é `.build/auto5-gate-decoupled.tfplan`, somente após
CI verde e novo AWS × state: esperado 0 add / 1 change / 0 destroy, apenas
gate automático false → true. Full plan de auditoria esperado: 1 add / 1
change / 0 destroy, ACM conhecido + gate, **alias NO-OP**. Os hashes e os
resultados finais de CI/plan ficam nas evidências sanitizadas da entrega.

**PARADA obrigatória antes do apply.** Ambos schedules permanecem desligados;
nenhuma execução LIVE foi autorizada nesta etapa. A validação natural da
BRSA0267 e, após seu aceite, da BRSA0257 continua pendente.

## 22. Gate automático aplicado — schedules ainda desligados

**Estado atual em 10/10/2026: AUTO-5 EM ANDAMENTO.** Este checkpoint sucede
a preparação descrita acima; a abertura do gate foi aprovada separadamente.

Preflight: HEAD `e9247d23eb1d540b02bf2643ca3d55fbfd3872ab`, árvore rastreada
limpa, CI **38088144215 SUCCESS**, state serial **83**, AWS × state conferidos.
O arquivo não rastreado do operador foi preservado. Alias manual na versão 3
desabilitada, gates inicialmente false, IAM temporário revogado e ambos
schedules DISABLED. Os 49 REMINDER e deliveries anteriores foram confirmados.

Plano autorizado `.build/auto5-gate-decoupled.tfplan`, SHA-256
`34c660aaa7192416ee1d9992914add04fa365ee339ca5bcae6a5d76342d86cd8`.
Reaberto e revisado: somente environment da worker, automático false → true;
sem mudança de ZIP, alias, IAM, schedules, settings ou outras Lambdas.

**Apply único: 18:47:08–18:47:26 America/Sao_Paulo.**
**0 added / 1 changed / 0 destroyed.** Somente
`aws_lambda_function.automatic_reminders` foi alterada, com atualização
concluída pelo provider em 13 segundos. Nenhum retry ou invoke.

| Controle pós-apply | Estado confirmado |
| --- | --- |
| State serial | **84** |
| Worker publicada | versão **4**, Active / Successful |
| AUTOMATIC_REMINDERS_ENABLED em `$LATEST` e versão 4 | **true** |
| MANUAL_RECOVERY_ENABLED em `$LATEST` e versão 4 | **false** |
| Alias manual | versão **3**, sem routing weights adicionais |
| Versão 3 | recuperação manual e automático **false** |
| IAM temporário | revogado; simulações de Invoke negadas |
| BRSA0267 / BRSA0257 | **DISABLED / DISABLED** |
| Cron / timezone / flexible | terça e sexta 20h / America/Sao_Paulo / OFF |
| Target dos schedules | ARN não qualificado da worker (`$LATEST`) |
| REMINDER sent / deliveries BRSA0267 | **27 / 27**, preservados |
| REMINDER sent / deliveries BRSA0257 | **22 / 22**, preservados |
| Novos REMINDER / Send / invocações da worker observados | **0 / 0 / 0** |
| Novos Errors / Throttles / Bounce / Complaint observados | **0 / 0 / 0 / 0** |
| REMINDER_SETTINGS | inalterados; readiness de ambos remetentes PASS |

CodeSha256 e ZIP permanecem iguais aos hashes da seção 21. Handler, runtime,
arm64, 256 MB, timeout 300 s, role, concurrency 2, layers e demais environment
da worker foram preservados. As cinco Lambdas permanecem Active/Successful.
AUTO_REMINDER permanece 0 na BRSA0257 e 1 completed na BRSA0267, proveniente
do LIVE manual já registrado. Nenhum envio novo foi executado nesta etapa.

Full plan somente leitura concluído às **18:48:47**: **1 add / 0 change /
0 destroy**, exclusivamente `aws_acm_certificate.portal`. Worker, alias e
schedules NO-OP; state permaneceu 84. O tfplan consumido foi removido após
a convergência. Evidências agregadas em `apply-summary.json`,
`post-apply-summary.json` e `convergence-summary.json`, no diretório privado
`/private/tmp/auto5-gate-apply-20261010-xob80sn2`.

## 23. Piloto BRSA0267 — preparação, sem apply do schedule

A configuração declarativa `automatic_reminder_enabled_cohorts` seleciona
somente **BRSA0267** para o próximo plano. BRSA0257 continua excluída.
Um conjunto vazio permite preparar a desativação de ambos os schedules.
A validação recusa turmas sem schedule preparado e valores null.

Validação local desta preparação: Terraform **24/24**, backend **300/300**,
Moto **82/82**, Node/OpenAPI **177/177**, navegador **19/19**, build,
fmt/validate e diff-check aprovados. Mutações: claim **12/12**, autorização
manual **11/11**, alias **5/5** detectadas; duas transições do gate e 11
cenários OpenAPI/HCL aprovados. Os testes anteriores de isolamento continuam
exercitando ambos schedules desligados; novos testes cobrem o piloto exclusivo
e a desativação por seleção vazia. Revisão local: 0 BLOCKER / 0 IMPORTANT.

**Na AWS, ambos schedules continuam DISABLED até aprovação e apply separados.**
O plano isolado previsto `.build/auto5-brsa0267-enable.tfplan` deve conter
somente `aws_scheduler_schedule.automatic_reminders["BRSA0267"]`, state
DISABLED → ENABLED: **0 add / 1 change / 0 destroy**. Gate true já aplicado,
alias 3, manual false, ZIP, IAM, cron, input, retry e BRSA0257 sem alteração.
ACM fica fora das ações do plano isolado.

Após revisão/aprovação do plano, a primeira ocorrência natural pretendida
é **terça-feira 13/10/2026 às 20h**. Às 18h, conferir SYNC_RUN natural real:
succeeded, catálogo/matrícula succeeded, notas published ou unchanged,
publicationId/metadataVersion/prova válidas, publicação current e término
até 20h. Se a prova falhar, desabilitar o piloto antes das 20h.

Não substituir o Scheduler por invoke manual. Observar ocorrência, claim,
participação, dedupe, REMINDER, SES, deliveries, Errors/Throttles e logs sem
PII. Se a publicação continuar sendo a dos 27 contatos anteriores,
already-sent deve impedir reenvio; zero novos envios pode ser correto.
Depois da ocorrência natural, parar para revisão antes da BRSA0257.

Kill switch: incidente restrito ao piloto → desabilitar BRSA0267; incidente
sistêmico → também fechar o gate automático. Preservar as demais propriedades
do schedule e reconciliar Terraform/state. Isso impede novas execuções;
não cancela uma Lambda já iniciada. Não improvisar rollback de código.

**PARADA antes do apply do schedule.** AUTO-5 depende dos dois disparos
naturais validados; BRSA0257 requer aprovação posterior ao aceite do piloto.

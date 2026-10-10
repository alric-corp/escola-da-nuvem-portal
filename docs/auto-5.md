# AUTO-5 — ativação controlada dos lembretes automáticos

**Em andamento, bloqueada após o primeiro LIVE natural. Piloto BRSA0267 não aprovado.**

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

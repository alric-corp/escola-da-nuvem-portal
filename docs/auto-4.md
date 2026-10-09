# AUTO-4 — preparação operacional dos lembretes

**AUTO-4 em andamento.** Este documento reúne os checkpoints de produção de
07 e 08/10/2026. O deploy mais recente é o ajuste diagnóstico da seção 8, aplicado
sobre o commit `30bffb71b902e4311db1db45ea6e112b31f1270a`. O encerramento em
[auto-2.3.md](auto-2.3.md) é histórico e foi preservado.

Horários abaixo em `America/Sao_Paulo`, exceto timestamps com offset explícito.

## Estado atual — 09/10, dry-run BRSA0257 PASS; restauração em execução

Às **00h39**, o dry-run real da BRSA0257 passou: **56 avaliados, 25 elegíveis com
pendências, zero enviados**. Ambos os dry-runs operacionais agora têm PASS.
Os 412 registros da tabela ficaram inalterados; métricas confirmam uma invocação
direta, zero Errors/Throttles e zero SES Send no intervalo observado. Readiness,
settings e provas passaram em ambas as turmas. Schedules DISABLED e gate false.

A restauração definitiva das **20h–20h30 para ambas as turmas** está preparada
em código, sem os dois deslocamentos temporários. Passaram 300 testes de backend,
40 de integração e quatro testes Terraform. Commit/CI, plano e apply da restauração
ainda estão pendentes neste checkpoint. **AUTO-4 em andamento.**

## Checkpoint temporário — 09/10, 00h30–01h

O usuário confirmou a janela temporária **00h30–01h de 09/10** para finalizar o
dry-run da BRSA0257. Somente essa turma recebe o deslocamento de 4h30 em relação
à ocorrência das 20h; BRSA0267 permanece às 21h30–22h. LIVE, cron, settings e
gates não mudam. A prova usada continua sendo a das 18h de 08/10, com término
até as 20h de 08/10 e correspondência com a publicação atual.

Às 00h32, readiness, settings/vínculos e essa prova passaram novamente em leitura.
Os dois schedules seguem DISABLED; gate false; worker Active/Successful.
Passaram 302 testes de backend, 40 de integração e quatro testes Terraform.
Deploy e uma invocação diagnóstica ainda pendentes neste checkpoint. Após o
resultado positivo, segue a restauração definitiva das 20h já autorizada,
com commit separado, CI, plano isolado e apply revisado. AUTO-5 permanece fora do escopo.

## Checkpoint — 08/10, 00h27; readiness BRSA0257 aprovada

- Dry-run diagnóstico publicado para **21h30–22h**, qualquer dia, com fim exclusivo.
- LIVE permanece **terça/sexta, 20h–20h30**, com schedules **DISABLED** e gate **false**.
- Apply do ajuste: **0 add / 5 change / 0 destroy**, somente código das cinco Lambdas.
- IAM/configuração conferidos; full plan sem ação AUTO-4, somente ACM conhecido.
- REMINDER_SETTINGS criado nas duas turmas, versão 1, com `automaticEnabled=true`,
  usando o único instrutor elegível vinculado a cada turma, após confirmação.
- BRSA0267: dry-run concluído às **21h34**, com **59 avaliados / 33 elegíveis com
  pendências / 0 enviados**. BRSA0257: bloqueio esperado `sender-not-ready` às **21h35**.
- AUTO_REMINDER=0 e REMINDER=0 nas duas turmas; dados inalterados pelo diagnóstico.
- A seção 9 registra os dry-runs de 07/10. Após a confirmação da identidade,
  `SESMailer.readiness` da BRSA0257 passou em **08/10 às 00h26**, com HTTP 200 e
  `VerificationStatus=SUCCESS`. Settings, vínculos e travas foram revalidados (seção 11).
- O dry-run positivo da BRSA0257 e a restauração das 20h continuam pendentes.
  A janela de 07/10 já encerrou; uma próxima ocorrência exige sua própria prova
  do sync das 18h. **AUTO-4 permanece em andamento** e LIVE continua bloqueado.

## Checkpoint das 08h37 — Fase 1 verificada

- Horário definitivo restaurado para **20h**.
- LIVE permanece restrito a **terça e sexta**.
- Dry-run diagnóstico pode ocorrer em qualquer dia, inclusive fora dos dias de
  envio, mas mantém o slot das **20h** e a janela **20h–20h30**, com fim exclusivo.
  Continua exigindo SYNC_RUN das 18h do mesmo dia, publicação/prova atuais,
  REMINDER_SETTINGS, vínculos do remetente e readiness SES. Não é autorização
  para executar o diagnóstico em qualquer horário.
- Os dois schedules permanecem **DISABLED**; o gate da worker permanece **false**.
  Esses bloqueios impedem o envio automático de lembretes.
- `REMINDER_SETTINGS` ainda não existe nas duas turmas; será configurado na Fase 2.
- Nenhuma invocação, dry-run real, envio ou alteração em produção foi realizado
  por esta verificação. A AUTO-4 não está concluída.

## 1. Apply executado e escopo

Resultado confirmado: **0 add / 7 change / 0 destroy**.

- O plano salvo `auto4-2000.tfplan` contém cinco atualizações de código Lambda
  e duas mudanças de cron, sem replacement, criação ou exclusão.
- State serial **60 → 62**. A comparação entre o state do plano e o state atual
  encontra somente esses sete recursos alterados; seus valores aplicados
  correspondem ao plano. Nas Lambdas mudaram apenas hash, tamanho e data do ZIP.
- O CloudTrail confirma **sete chamadas bem-sucedidas feitas pelo Terraform**:
  cinco `UpdateFunctionCode` e dois `UpdateSchedule`, entre **08h16min43s e
  08h17min09s**. Os cinco hashes retornados pela AWS correspondem ao novo ZIP.
- O stdout original do apply não foi recuperado. A confirmação acima combina
  plano salvo, comparação de states, CloudTrail e leitura dos recursos reais;
  não representa uma nova execução de apply.

## 2. Schedules reais

Consultados em 07/10/2026, às 08h37.

| Turma | Estado | Cron | Timezone | Flexible |
| --- | --- | --- | --- | --- |
| BRSA0257 | `DISABLED` | `cron(0 20 ? * TUE,FRI *)` | `America/Sao_Paulo` | `OFF` |
| BRSA0267 | `DISABLED` | `cron(0 20 ? * TUE,FRI *)` | `America/Sao_Paulo` | `OFF` |

Targets, execution roles, inputs técnicos e retries correspondem ao plano.
Não há remetente, e-mail, aluno ou publicationId nos inputs. O Canvas Scheduler
permanece `ENABLED`, às 06h/18h, com flexible `OFF` e contexto nativo preservado.

## 3. Worker, IAM e pacote publicado

- `AUTOMATIC_REMINDERS_ENABLED=false`.
- `State=Active`; `LastUpdateStatus=Successful`.
- Handler `automatic_reminders.handler`, Python 3.13, arm64, 256 MB, timeout
  300 s, concorrência reservada 2. Sem Function URL ou endpoint API.
- identity, canvas_sync, reminder_events, auth_trigger e automatic_reminders
  estão `Active/Successful`, todas com o novo hash.
- Os **14 módulos runtime** do ZIP foram comparados byte a byte com o commit
  `30bffb7`. Hash local, state e `CodeSha256` das cinco Lambdas coincidem.

| Artefato | Valor |
| --- | --- |
| ZIP SHA-256 | `3a1f3a5b4ff5257905cdd258b6f911a0923a78b1215042f264ff62192dbeef3d` |
| source_code_hash / CodeSha256 | `Oh86W0/1JXkFzdJYtvkRoJI6eLEhUELyZP9iGS2+7z0=` |
| Tamanho do ZIP | 55.067 bytes |

A auditoria passou em **67 verificações IAM e 160 de infraestrutura**.
ConditionCheckItem da API permanece isolado para identity; Canvas possui a
permissão necessária; worker conserva o IAM mínimo; a role do Scheduler invoca
somente a worker. Delivery não recebe ConditionCheckItem efetivo e auth trigger
continua sem DynamoDB. O log da worker tem retenção de 30 dias; alarmes Errors/Throttles
estão `OK` e apontam para o tópico esperado.

## 4. Full plan pós-apply, somente auditoria

Comando executado:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color
```

Resultado: **1 add / 0 change / 0 destroy**, exclusivamente a criação já
conhecida de `aws_acm_certificate.portal`. **AUTO-4 sem ação residual**;
as 35 rotas da API permanecem sem ação. Este full plan não foi salvo para
apply nem aplicado. ACM permanece fora deste trabalho.

## 5. Ausência de efeitos após o apply

Janela observada nas métricas: **07/10/2026, 08h16min00s–08h37min47s**,
cobrindo o início das atualizações identificadas no CloudTrail.

| Evidência | Resultado |
| --- | --- |
| Invocações da worker | 0 observadas; nenhum datapoint de invocação |
| Novos eventos / START no log da worker | 0 / 0 |
| Invocações automáticas | Nenhuma observada; schedules desabilitados e worker sem invocação |
| Errors / Throttles das cinco Lambdas | 0 observados |
| AWS/SES `Send`, na conta/região | 0 observados na janela pós-apply; nenhum datapoint |

Leitura consistente do DynamoDB às **08h37min03s**, sem imprimir PII:

| Turma | AUTO_REMINDER# | REMINDER# | REMINDER# automático | REMINDER_SETTINGS | SYNC_RUN# |
| --- | ---: | ---: | ---: | ---: | ---: |
| BRSA0257 | 0 | 0 | 0 | 0 | 5 |
| BRSA0267 | 0 | 0 | 0 | 0 | 5 |

Hashes dos lembretes e settings permanecem iguais ao baseline anterior.
Os smokes históricos da AUTO-2.3 estão fora da janela pós-apply da AUTO-4.
Não houve chamada SendEmail nesta auditoria nem envio observado após o apply.
Essa conclusão está limitada ao intervalo observado; não é uma afirmação de
que a conta nunca enviou e-mails.

O SES informa **1 envio nas últimas 24 horas**. A consulta da métrica identifica
esse envio em **06/10 às 22h04**, antes do apply da AUTO-4; a consulta ampliada
até 07/10 às 08h42 também encontra **zero envios desde o apply**. A métrica
agregada não identifica o remetente ou a origem desse envio anterior.

## 6. Fase 2 — preparação em leitura; configuração pendente

A verificação pós-apply passou. A preparação da Fase 2 foi iniciada somente
com consultas, preservando schedules `DISABLED` e gate `false`.

- Cada turma possui **um vínculo de instrutor**, com vínculo reverso válido e
  e-mail institucional elegível. Nenhum remetente foi selecionado automaticamente.
- SES: `ProductionAccessEnabled=true`, `SendingEnabled=true`,
  `EnforcementStatus=HEALTHY`. Quotas observadas: **50.000 envios/24h** e
  **14 envios/s**, com 1 envio contabilizado nas últimas 24h.
- Readiness dos candidatos vinculados foi consultada às 21h06; os resultados
  constam na seção seguinte. A escolha do remetente ainda depende da definição
  explícita por turma. Não foi criada identidade nem solicitado e-mail de verificação.

Faltam os **senderUserId aprovados para BRSA0257 e BRSA0267** e o **valor inicial
de automaticEnabled em cada turma**. Esses dados foram solicitados antes de
qualquer gravação. O registro deverá conter somente `senderUserId`,
`automaticEnabled`, `version` e `updatedAt`; não incluirá e-mail.

`REMINDER_SETTINGS` continua ausente. Nenhuma configuração foi gravada,
nenhum dry-run real foi executado e nenhuma habilitação foi realizada.
**AUTO-4 permanece em andamento.**

## 7. Validação prevista para 07/10 — situação às 21h06

O dry-run real não foi executado e não havia uma invocação agendada para as 20h.
A consulta de métricas até 21h04 confirmou zero invocações da worker desde o
apply da AUTO-4. Às 21h03, os settings continuavam ausentes, os dois schedules
permaneciam `DISABLED` às 20h e a worker estava `Active/Successful`, com gate
`false` e hash do commit `30bffb7`.

A regra publicada permite diagnóstico em qualquer dia, dentro de **20h–20h30**.
Essa janela de 07/10 já terminou. A execução ainda hoje requer uma mudança
explícita da janela do dry-run, mantendo o horário LIVE definitivo das 20h e
as travas de infraestrutura. Foi solicitada a decisão entre esse ajuste e
preparar a próxima janela válida, **08/10 às 20h**; nenhuma alteração de código,
horário, configuração ou deploy foi feita nesta checagem.

Pré-requisitos consultados somente em leitura, às 21h06:

| Turma | Canvas Sync natural das 18h | Publicação / metadataVersion | Candidato vinculado | SES individual | REMINDER_SETTINGS |
| --- | --- | --- | ---: | --- | --- |
| BRSA0257 | `succeeded`; catálogo/matrícula `succeeded`, notas `published` | Correspondem à publicação atual | 1 | `NotFoundException` ao consultar a identidade | Ausente |
| BRSA0267 | `succeeded`; catálogo/matrícula `succeeded`, notas `published` | Correspondem à publicação atual | 1 | Verificado e pronto | Ausente |

Para BRSA0257, não se pode considerar a readiness do candidato verde. Criar a
identidade SES dispara um e-mail de verificação e exige autorização específica;
essa ação não foi executada. Os valores de `senderUserId` e `automaticEnabled`
continuam pendentes de definição antes da gravação dos settings. Nenhuma
invocação, escrita de settings ou chamada SendEmail foi feita nesta checagem.

## 8. Ajuste diagnóstico autorizado em 07/10 — publicado às 21h18

Às 21h, foi autorizado ajustar o dry-run para **21h30–22h**, com fim exclusivo,
para validação ainda hoje. LIVE permanece terça/sexta, **20h–20h30**; os cron
permanecem às 20h, os schedules `DISABLED` e o gate `false`.

O evento diagnóstico mantém `scheduledFor` às **20h** da mesma data local.
Somente o relógio de execução do dry-run recebe o deslocamento de 90 minutos.
A prova continua sendo o SYNC_RUN natural das 18h, terminado até as 20h, com
publicação e metadataVersion atuais. Não há exceção de calendário por data.

Passaram **299 testes de backend e 40 de integração**, incluindo limites da
janela, recusa de LIVE às 21h30, rechecagem do prazo após readiness, prova com
cutoff às 20h e ausência de escrita/envio no dry-run.

No checkpoint das 21h20, a configuração de REMINDER_SETTINGS aguardava a escolha entre as duas turmas ou
somente BRSA0267, usando o único instrutor elegível vinculado a cada turma e
`automaticEnabled=true`, necessário para a readiness do diagnóstico. Esse campo
não altera o gate da infraestrutura nem habilita schedules. BRSA0257 permanece
sem identidade SES; seu resultado esperado é o bloqueio `sender-not-ready`.
Nenhuma identidade SES ou e-mail de verificação será criado neste ajuste.

### Deploy e verificação pós-apply

- Apply iniciado às **21h17min59s**, encerrado às **21h18min38s**, sem falha.
- **0 add / 5 change / 0 destroy**: atualizações de código de identity,
  canvas_sync, reminder_events, auth_trigger e automatic_reminders. Nenhuma
  alteração de cron, environment, IAM, frontend, API ou configuração funcional
  das demais Lambdas.
- State **62 → 64**. O plano salvo foi conferido antes do apply, aplicado uma vez
  e apagado após convergência. Nenhum plano histórico foi reaplicado.
- Pacote com 14 módulos runtime; somente automatic_reminders.py difere do commit
  `30bffb7`. Código e testes deste ajuste ainda estão no working tree, sem commit.
- ZIP SHA-256: `4025e1d01de25416d3e23b79ac97e6aba16f65eb879304f13b6975e287feb3cb`.
- CodeSha256 das cinco Lambdas: `QCXh0B3iVBbT4jt5rJfmq6FvZeuHkwTxO2l14of+s8s=`.
- Todas `Active/Successful`. Passaram **67 verificações IAM e 160 de infraestrutura**.
  Worker permanece com gate false; schedules DISABLED às 20h; Canvas Scheduler
  ENABLED às 06h/18h; log e alarmes preservados.
- Terraform fmt/validate e **4 testes Terraform com providers mockados** passaram.
- Full plan somente leitura: **1 add / 0 change / 0 destroy**, exclusivamente
  `aws_acm_certificate.portal`; nenhuma ação residual AUTO-4. Não salvo nem aplicado.
- Leitura consistente às **21h19**: AUTO_REMINDER=0, REMINDER=0 e settings=0 nas
  duas turmas; hashes inalterados. Cada turma possui seis SYNC_RUN.
- Até **21h20**, zero invocações/erros/throttles observados da worker e zero
  eventos em seu log desde o início do ajuste. AWS/SES Send=0 observado na conta
  e região nesse intervalo. Métricas estão sujeitas ao atraso de publicação.
- Nenhum REMINDER_SETTINGS foi criado, nenhuma identidade SES foi criada e
  nenhuma invocação direta ou SendEmail foi executada nesta etapa.

Evidências sanitizadas fora do Git:
`/private/tmp/auto4-diagnostic-2130-20261007-vj42yzsu`.

No checkpoint das 21h20, o dry-run real ainda estava pendente da seleção dos
remetentes e da janela das 21h30–22h. A execução posterior está registrada abaixo.

## 9. Fase 2 — configuração e primeiro diagnóstico real, 07/10

### Configuração autorizada

Após a confirmação do usuário, foram configuradas **BRSA0257 e BRSA0267** às
**21h33min41s**, em uma transação condicional: dois registros novos, sem sobrescrever
settings existentes, com checagem dos vínculos de instrutor nos dois sentidos.
Cada registro contém somente `senderUserId`, `automaticEnabled=true`, `version=1`
e `updatedAt`. Nenhum e-mail foi persistido nos settings.

Essas duas escritas de configuração são separadas da evidência de ausência de
escrita durante o dry-run. O baseline do diagnóstico foi capturado **depois** da
configuração. Schedules permaneceram `DISABLED` e o gate da worker, `false`.
Nenhuma identidade SES foi criada e nenhum e-mail de verificação foi solicitado.

### Prova do Canvas natural

O sync natural das **18h de 07/10** foi revalidado em leitura: uma invocação da
canvas_sync, **Errors=0 / Throttles=0**, processando ambas as turmas. Os dois
SYNC_RUN estão `succeeded`, catálogo/matrícula `succeeded` e notas `published`.
Source, slot real das 18h, executionId e attemptNumber=1 são válidos. O término
foi anterior às 20h; publicationId existe e corresponde ao METADATA atual, com
metadataVersion válida. Nenhum sync manual foi executado.
O SYNC legado também está `published` nas duas turmas, aponta para a mesma
publicação e foi registrado imediatamente após a prova, conforme a ordem do
código. Foram processados 56 alunos na BRSA0257 e 59 na BRSA0267.

### Invocações diretas diagnósticas

Uma invocação síncrona por turma, **sem retry**, usando o relógio real dentro da
janela autorizada. Payload técnico com `dryRun=true`, sem remetente, destinatário,
studentId ou publicationId. `scheduledFor=2026-10-07T23:00:00Z` mantém a ocorrência
das 20h local; a execução do diagnóstico ocorreu às 21h34/21h35.

| Turma | Horário da execução | Resultado | Avaliados | Elegíveis / pendentes | Enviados |
| --- | --- | --- | ---: | ---: | ---: |
| BRSA0267 | 21h34min34s–21h34min40s | `dry-run`, sem erro | 59 | 33 / 33 | 0 |
| BRSA0257 | 21h35min05s–21h35min06s | `skipped / sender-not-ready` | Não chegou à avaliação | Não avaliados | 0 |

Na BRSA0267, 26 alunos foram desconsiderados: 22 por `withdrawn` e quatro por
`no-pending`. A publicação usada corresponde à prova natural validada. Nenhum
aluno foi reservado para envio. Na BRSA0257, os contadores retornados são zero
porque a readiness bloqueou antes da avaliação; isso não significa ausência de
alunos ou pendências. Nova consulta SES confirma `NotFoundException` para a
identidade do instrutor dessa turma. A identidade da BRSA0267 está verificada.

### Efeitos e travas após o diagnóstico

- Ambas as invocações retornaram HTTP 200, sem FunctionError e sem retry.
- Logs mostram exatamente duas invocações, correspondentes às duas chamadas
  diretas autorizadas. Nenhuma invocação automática foi observada.
- Resumos técnicos sem PII, destinatário, remetente, mensagem ou evento bruto;
  nenhum erro inesperado encontrado nos logs.
- AUTO_REMINDER=0, REMINDER=0 e REMINDER automático=0 nas duas turmas.
- Todos os **400 registros da tabela** permaneceram iguais entre os snapshots
  consistentes de **21h34min26s e 21h35min17s**, incluindo settings. A comparação
  foi feita por hashes, sem registrar dados pessoais no relatório.
- A comparação demonstra ausência de mudanças persistidas nesse intervalo; os
  testes de backend/integração cobrem a ausência de chamadas de escrita e envio
  no caminho dry-run. Não foi instalado um contador de chamadas AWS em produção.
- IAM e infraestrutura passaram novamente em **67 + 160 verificações**.
  As cinco Lambdas continuam Active/Successful com o hash publicado; worker gate
  `false`; schedules `DISABLED`, terça/sexta às 20h, timezone São Paulo, flexible OFF.
- Métricas consolidadas às **21h36min36s**, cobrindo **21h17–21h36**:
  worker **Invocations=2 / Errors=0 / Throttles=0**, correspondentes às duas
  invocações manuais identificadas nos logs; AWS/SES **Send=0** observado na conta
  e região. Nenhuma chamada SendEmail foi executada pelo procedimento.
- Novo full plan somente leitura após o diagnóstico: **1 add / 0 change / 0 destroy**,
  exclusivamente ACM conhecido. AUTO-4 sem ação residual; 35 rotas sem ação;
  state serial 64. Nenhum plano foi salvo para apply ou aplicado nesta fase.

As evidências individuais, comparações de dados, logs sanitizados e métricas estão
no diretório já indicado na seção 8; o resumo final é `diagnostic-final-summary.json`.

**AUTO-4 em andamento.** O diagnóstico positivo da BRSA0267 e o bloqueio da
BRSA0257 foram comprovados. Readiness da BRSA0257 continua pendente; nenhuma
habilitação LIVE foi realizada.

## 10. BRSA0257 — readiness novamente consultada às 21h52

O usuário confirmou que o slot temporário foi alterado intencionalmente para a
validação operacional e aprovou o dry-run da BRSA0267. **Não há investigação de
window bypass pendente.** A restauração definitiva do diagnóstico para 20h–20h30
fica condicionada ao dry-run positivo da BRSA0257, conforme a sequência aprovada.

Às **21h52min53s de 07/10**, foi executado somente o método existente
`SESMailer.readiness` para a identidade configurada da responsável da BRSA0257,
sem alterar sua lógica:

- `GetAccount`: HTTP 200.
- `GetEmailIdentity`: HTTP 404, `NotFoundException`.
- Resultado: `ready=false` — não foi possível confirmar a configuração do SES.
- Schedules reconfirmados `DISABLED`, cron `cron(0 20 ? * TUE,FRI *)`, timezone
  `America/Sao_Paulo`, flexible OFF; worker Active/Successful, hash vigente e gate false.
- Nenhuma identidade criada, nenhum e-mail de verificação solicitado, nenhuma
  escrita AWS, nenhuma invocação de worker e nenhum SendEmail nesta checagem.

**Parado conforme a regra de readiness FAIL.** A identidade precisa passar pelo
fluxo normal do portal e ser confirmada pela responsável. Não foi executado um
segundo diagnóstico da BRSA0257, nem iniciada a restauração do horário, testes,
commit, push, CI, novo plano ou apply desta restauração. A janela temporária do
dry-run continua publicada em 21h30–22h; LIVE permanece terça/sexta às 20h.

Evidência sanitizada:
`/private/tmp/auto4-brsa0257-readiness-20261007-ed_8ufns/readiness.json`.

**AUTO-4 em andamento; AUTO-5 não iniciada.**

## 12. Dry-run positivo BRSA0257 — 09/10 às 00h39

- Commit temporário: `97f75edf37e48aae8e167ed2f44fbb8de0562b6b`, enviado para
  `alric-corp/main`; [CI completo aprovado](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37879999581).
- Plano isolado revisado: **0 add / 5 change / 0 destroy**, somente o ZIP das
  cinco Lambdas. ACM no-op; nenhum schedule, IAM ou environment alterado.
- Apply único: **00h38min21s–00h39min00s**, resultado **0/5/0**, state **64 → 66**.
- ZIP SHA-256: `e9ae407b4a330cb63ba88772da15c39443670077310c34ec8c0b5ba40ad0965e`.
- CodeSha256: `6a5Ae0ozDLY7qIdy2hXDlENnAHcxDDTsjAtbpArQll4=`; cinco Lambdas
  Active/Successful, 67 verificações IAM e 160 de infraestrutura aprovadas.
- Full plan pós-apply: apenas ACM conhecido, **1 add / 0 change / 0 destroy**;
  nenhum resíduo AUTO-4. O plano consumido foi removido após convergência.
- Readiness SES, settings versão 1, vínculos e prova natural das 18h de **08/10**
  válidos em ambas as turmas. Nenhum settings foi alterado nesta etapa.
- Uma invocação síncrona da BRSA0257, **00h39min43s–00h39min49s**, `dryRun=true`,
  sem retry, relógio real, `scheduledFor=2026-10-08T23:00:00Z` (20h de 08/10).
- Resultado: **dry-run**, 56 avaliados, 25 elegíveis/pendentes, 31 desconsiderados
  (15 sem pendência, 15 withdrawn, um sem e-mail), **sent=0**. Publicação usada
  corresponde à prova validada. HTTP 200, sem FunctionError, logs sem PII/evento bruto.
- AUTO_REMINDER=0 e REMINDER=0 nas duas turmas. Os **412 registros** ficaram
  idênticos nos snapshots consistentes de **00h39min34s e 00h40min03s**.
- Métricas às **00h41min47s**: **Invocations=1 / Errors=0 / Throttles=0** desde o
  apply temporário; a única invocação corresponde à chamada manual autorizada.
  **AWS/SES Send=0** observado na conta/região. Nenhum envio automático.
- Como os dois dry-runs passaram, foi iniciada a restauração definitiva autorizada.
  Nenhum LIVE executado; schedules DISABLED e gate false preservados.

Evidências: `/private/tmp/auto4-midnight-20261009-luhafjbw`.

## 11. BRSA0257 — revalidação após confirmação SES, 08/10

O usuário informou que a responsável concluiu a confirmação depois do checkpoint
das 21h52. Foi executada nova consulta somente leitura, usando a lógica real de
`SESMailer.readiness`, às **00h26min28s de 08/10**. O código consultado corresponde
ao módulo do ZIP publicado; nenhuma lógica de readiness foi alterada.

| Verificação | Resultado atual |
| --- | --- |
| AWS account | `712107929769`, mesma conta da worker |
| Região SES | `us-east-1`, mesma região da worker |
| Remetente consultado | Identidade exata do vínculo indicado pelo senderUserId já configurado |
| GetAccount | HTTP 200; ProductionAccessEnabled=true; SendingEnabled=true; EnforcementStatus=HEALTHY |
| GetEmailIdentity | HTTP 200; IdentityType=EMAIL_ADDRESS |
| VerificationStatus | SUCCESS |
| VerifiedForSendingStatus | true |
| DKIM observado | Status=SUCCESS; SigningEnabled=true |
| SESMailer.readiness | **PASS / ready=true** |

A regra atual usa `VerifiedForSendingStatus`, `ProductionAccessEnabled` e
`SendingEnabled`; não usa DKIM como condição. Os campos DKIM acima foram apenas
registrados a partir da resposta real. Nenhum endereço de e-mail foi impresso.
O 404 histórico não se repetiu; a investigação condicional de CloudTrail e lista
de identities não foi necessária.

### Pré-requisitos revalidados às 00h27min37s

- REMINDER_SETTINGS BRSA0257 presente, schema correto, `automaticEnabled=true`,
  `version=1`, inalterado desde a criação autorizada.
- Vínculos direto e reverso válidos; remetente institucional válido.
- Schedule `DISABLED`, `cron(0 20 ? * TUE,FRI *)`, timezone `America/Sao_Paulo`,
  flexible OFF; target corresponde à worker.
- Worker gate `false`, Active/Successful, com o hash publicado esperado.
- SYNC_RUN das **18h de 07/10** continua `succeeded`, com catálogo/matrícula
  `succeeded`, notas `published`, contexto válido e término antes das 20h.
  PublicationId e metadataVersion correspondem ao METADATA atual; publicação
  existe, snapshot existe no S3 e SYNC legado está coerente.
- Settings, vínculos e provas foram relidos e permaneceram estáveis durante a consulta.

**Limite temporal:** a prova de 07/10 mantém sua integridade e correspondência
com a publicação atual. A janela diagnóstica de 07/10 encerrou às 22h. Em 08/10,
às 00h27, o sync das 18h de 08/10 ainda é futuro e sua prova ainda não existe.
Um novo diagnóstico deve revalidar a prova das 18h da data da sua ocorrência.

**Parado antes de qualquer dry-run, conforme solicitado.** Nesta revalidação:
zero escrita AWS, zero alteração de settings, zero identidade criada, zero
e-mail de verificação solicitado, zero invocação de worker e zero SendEmail.
Nenhuma restauração de horário, commit, push, plano ou apply foi iniciada.

Evidências sanitizadas:
`/private/tmp/auto4-brsa0257-revalidation-20261008-lhgtp9z8/readiness.json` e
`/private/tmp/auto4-brsa0257-revalidation-20261008-lhgtp9z8/prerequisites.json`.

**AUTO-4 em andamento; AUTO-5 não iniciada.**

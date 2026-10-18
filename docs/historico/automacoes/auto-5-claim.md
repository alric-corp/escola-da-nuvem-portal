# AUTO-5 — correção do falso claim-conflict

**Claim-fix publicado em produção em 09/10/2026, 22h00. Automação permanece
desabilitada. AUTO-5 BLOQUEADA para novos envios; sem migração ou novo LIVE.**

O deploy aprovado e a verificação atual estão na seção 7. As seções anteriores
preservam o diagnóstico e os checkpoints anteriores ao deploy.

Atualização de 10/10: a preparação de recovery foi encerrada **sem LIVE**;
janela definitiva restaurada às 01h04, gate false e schedules DISABLED.
O registro completo está na seção 8.

## Estado protegido — checkpoint anterior ao deploy

Leitura em produção em **09/10/2026, 20h57, America/Sao_Paulo**:
conta 712107929769, região us-east-1. Worker Active/Successful, gate **false**;
BRSA0257 e BRSA0267 **DISABLED**; AUTO_REMINDER=0 e REMINDER=0 nas duas.
Settings continuam versão 1, automaticEnabled=true, com os mesmos fingerprints
do primeiro LIVE. Nenhum dado ou configuração AWS foi alterado nesta correção.
BRSA0257 continua fora do piloto.

## 1. Diagnóstico exato

Caminho publicado no primeiro LIVE:

1. `automatic_reminders.CohortRun.prepare` chama
   `reminders.automatic_sender_readiness`.
2. `Repository.get` lê `data` de REMINDER_SETTINGS com ConsistentRead e faz
   `json.loads`. O modelo oficial valida exatamente quatro campos.
3. `prepare` guarda esse dict em `self.settings` e em `self.conditions`.
4. `acquire` tenta criar a ocorrência ausente, verificando METADATA, SYNC_RUN,
   settings e vínculos direto/reverso na mesma transação.
5. O código anterior constrói `:old` com `Repository._encode(expected)` e usa
   `ConditionExpression = "#d = :old"`, com `#d` apontando para **data**.
6. DynamoDB compara a String persistida com outra String. Os bytes diferem,
   apesar de os quatro valores serem os mesmos. A aquisição é cancelada e o
   handler retorna `skipped / claim-conflict`, antes de qualquer reserva/envio.

### Comparação sanitizada — igual nas duas turmas

| Campo / representação | Persistido | Esperado pela transação antiga | Comparação | Causa |
| --- | --- | --- | --- | --- |
| Tipo DynamoDB de `data` | String (`S`) | String (`S`) | Igual | Não existe DynamoDB Map nesse atributo |
| Identificador do remetente | String, valor omitido | Mesma String | Igual | Nenhuma troca de identidade |
| `automaticEnabled` | Boolean `true` dentro do JSON | Boolean `true` | Igual | Sem coerção de tipo |
| `version` | Inteiro `1` dentro do JSON | Inteiro `1` | Igual | Sem alteração de versão |
| `updatedAt` | `2026-10-08T00:33:41.282499+00:00` | Mesmo texto | Igual | Modelo não mudou o valor armazenado |
| Campos presentes | Os quatro campos do modelo | Os mesmos quatro | Igual | Sem campos extras/ausentes |
| Separadores | `, ` e `: ` | `, ` e `: ` | Igual | Espaçamento padrão em ambos |
| Ordem das chaves | remetente, habilitação, versão, data | habilitação, remetente, data, versão | **Diferente** | Writer preservou inserção; repositório ordenou |
| String completa em `data` | JSON em ordem de inserção | JSON ordenado | **Diferente** | A igualdade textual é a condição que falha |

A comparação real demonstrou que o texto persistido é exatamente
`json.dumps(reminder_settings(...))`, e não `Repository._encode(...)`.
Nenhum identificador de remetente ou e-mail foi impresso. Os cinco snapshots
condicionados continuam iguais à baseline pré-LIVE; apenas a serialização
esperada para REMINDER_SETTINGS diverge.

### Writer da AUTO-4

O one-shot `configure-settings-once.py`, preservado nos artefatos da AUTO-4,
chama o modelo oficial `reminder_settings(uid, True, 1, at)`, mas grava via
cliente DynamoDB de baixo nível usando **`json.dumps(settings)`**.
O Put exige ausência de PK/SK e a mesma transação verifica ambos os vínculos
usando os bytes realmente lidos. A criação foi protegida contra concorrência;
a incompatibilidade estava no serializer usado para `data`.

O caminho `Repository.put/transaction` grava com `_encode`, que usa
`json.dumps(..., ensure_ascii=False, sort_keys=True)`. O one-shot usa os defaults
`ensure_ascii=True, sort_keys=False`. Os valores reais são ASCII; a diferença
de escaping não afetou os bytes desse incidente. **A causa comprovada é a
ordem das chaves**, sem diferença de espaços, tipos, modelo ou conteúdo.

SHA-256 do writer histórico auditado:
`7064ac99ed142f4b49fdb35eb75a8510d51e5e53c282005c053115eb4d02fc16`.
O writer histórico não foi editado ou executado novamente.

## 2. RED determinístico e GREEN

`test_auto4_writer_v1_live_handler_acquires_claim` recria localmente o modelo v1,
o serializer `json.dumps`, o Put com ausência de PK/SK e as duas verificações de
vínculo do one-shot. Todas as identidades são fictícias.

O teste chama o **handler LIVE real**, com gate habilitado apenas no teste,
evento de sexta-feira às 20h, prova das 18h e Repository real sobre DynamoDB/S3
Moto. Só o SES e o relógio são substituídos; a transação é executada pelo Moto.

- Antes da correção: **RED**, retorno exato `('skipped', 'claim-conflict')`,
  enquanto o teste exige `('completed', None)`.
- Depois: **GREEN**, ocorrência adquirida/finalizada e dois envios fictícios;
  o texto original dos settings continua intacto. Nenhuma AWS real foi usada.

O dry-run mantém seu contrato: o novo teste com settings legados verifica zero
Put/Update/Delete/TransactWrite e nenhum envio, com todos os itens iguais antes/depois.

## 3. Alternativas e correção escolhida

| Alternativa | Implicação | Decisão |
| --- | --- | --- |
| Condicionar diretamente version/habilitação/sender | Requer Map ou atributos DynamoDB adicionais, migração condicional e compatibilidade entre writers e projeções | Bom desenho para um novo schema; maior mudança neste incidente |
| Regravar v1 como JSON canônico / migrar v2 | Corrige os dados atuais, mas mantém dependência textual da representação de futuros writers | Não escolhida |
| Canonicalizar a comparação lógica e condicionar aos bytes lidos | Mantém o schema, todos os campos protegidos e a condição atômica; adiciona leituras consistentes | **Escolhida: menor mudança sem migração** |

Única mudança de runtime: `Repository._expected_data`, usada em expected de
Put/Delete e ConditionCheck existentes. Para um expected não nulo/não seed:

1. Ler o item consistentemente, sem escrever.
2. Exigir `data` String com JSON válido.
3. Comparar `_encode(json.loads(data))` com `_encode(expected)`.
   É a mesma canonicalização única dos writers; tipos JSON são preservados,
   inclusive `true != 1`. Versão, habilitação, sender, data e campos extras
   participam da comparação. Divergência/ausência gera Conflict.
4. Usar **a String exata lida** em `:old`, mantendo `#d = :old` no DynamoDB.
   Uma mudança entre essa leitura e o commit continua cancelando a transação.

A leitura adicional não substitui a condição atômica. Não se adota um snapshot
novo com valores diferentes, não há retry interno e TransactionCanceled continua
virando Conflict. Ausência, seed e limites de contadores mantêm suas condições.
Nenhuma mudança em seleção, calendário, proof, lease, pacing, retry, mensagem,
participation, dedupe ou semântica de dry-run.

Existe um custo explícito: uma leitura GetItem consistente por snapshot esperado
em cada transação. Na aquisição inicial são cinco leituras adicionais; renovação
e reserva também verificam seus snapshots. GetItem já faz parte das permissões.
Uma reescrita até dos mesmos valores **depois da leitura final** pode causar um
conflito conservador, pois o commit exige os bytes lidos; não se mascara essa corrida.

### Settings existentes

**Sem migração necessária.** Os dois registros v1 são compatíveis com a correção
e permanecem intactos, inclusive sender, automaticEnabled, updatedAt e bytes de
`data`. Não há plano de dados, delete/recreate, e-mail persistido ou passagem a v2.

## 4. Testes e revisão adversarial

21 testes novos em `tests/integration/test_automatic_claim.py` cobrem:

- A: writer AUTO-4 → handler LIVE → claim/transação real sobre Moto.
- B: ordem, espaços, indentação e escapes JSON diferentes; valores iguais passam.
- C–F: versão, habilitação, sender e ausência, inclusive alterações sem bump de
  versão e corridas depois da comparação canônica → bloqueio.
- G: publicação e SYNC_RUN alterados → bloqueio.
- H: WITHDRAWN antes da reserva → zero reserva/envio para os alunos afetados.
- I: duas aquisições preparadas antes do commit → somente uma vence.
- J: crash após envio persistido e retry com lease expirado → nenhum reenvio.
- Tipos JSON distintos, updatedAt e campos extras; JSON inválido/Map/ausência;
  leitura consistente; Put/Delete condicionais e corrida após a leitura;
  dry-run sem qualquer escrita.

Regressão local: **300 backend; 61 integração/Moto; 177 Node; 19 arquivos browser;
quatro testes Terraform; build, fmt e validate PASS**. Contratos OpenAPI passaram,
incluindo **11 cenários de mutação e cinco rejeições esperadas** do baseline.

Mutações focadas: **12/12 eliminadas, zero sobreviventes**. Cobrem serializer
antigo, aceitação de snapshot diferente, coerção bool/int, leitura inconsistente,
remoção das condições de settings/claim/publicação/proof/WITHDRAWN, dedupe,
condição de escrita e supressão de TransactionCanceled. Executadas em cópias
descartáveis, com Moto e credenciais fictícias; também incluídas no CI.

Revisão adversarial do diff, das condições e dos testes: **0 BLOCKER / 0 IMPORTANT**.
Verificados especialmente TOCTOU entre leitura e commit, snapshot diferente com
mesma versão, bool versus int, exclusão concorrente, claim competidor, lease,
publicação, WITHDRAWN, dedupe/retry e ausência de PII nos erros. Não se trata de
uma validação LIVE em produção; custo das leituras adicionais deve ser observado
na futura execução aprovada.

## 5. Preparação do deploy — checkpoint anterior à aprovação

Após commit e CI completo verde, preparar ZIP e plano salvo isolado. Como o ZIP
é compartilhado, a expectativa inicial era **0 add / 5 change / 0 destroy**, apenas código
de identity, canvas_sync, reminder_events, auth_trigger e automatic_reminders.
Comparar os 14 módulos: somente repository.py deve diferir do ZIP publicado.
ACM, IAM, frontend e API Gateway ficam fora das ações. O plano efetivo e os
campos adicionais que reconciliam o kill switch estão detalhados na seção 6.
Gate false e ambos schedules DISABLED são precondições e devem permanecer assim.

**Parar antes do apply.** Publicar a evidência concreta do ZIP/plano para revisão.
Este checkpoint não autoriza apply, migração, reativação ou novo LIVE.

Depois de um deploy expressamente aprovado: confirmar hashes/Successful,
settings intactos e gates fechados; auditar convergência. Uma futura tentativa
do piloto BRSA0267 exige nova autorização, prova do Canvas natural das 18h do
dia, readiness/settings válidos, baseline, planos de ativação separados e margem
antes de uma ocorrência natural de terça/sexta às 20h. Não repetir LIVE manual
nem alterar a janela. BRSA0257 permanece DISABLED e depende de aprovação própria.

Evidências locais sanitizadas/privadas:
`/private/tmp/auto5-claim-20261009-bir8pxno`.
Os encerramentos históricos AUTO-2.3 e AUTO-4 permanecem intactos.

## 6. Plano concreto para aprovação — checkpoint de 09/10, 21h17

Correção: commit **`45a649d341f532e4e221eb0db3af58010c1762f0`**,
[CI completo COMPLETED / SUCCESS](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/38007753820).
Pacote gerado novamente após esse CI pelo provider archive: 14 módulos iguais
ao commit, **somente repository.py diferente do ZIP publicado**.

| Artefato | Valor |
| --- | --- |
| ZIP SHA-256 | `db7caa821cdbaad1f57b4875a5a8c6f8c4c43fdca39ecb49f23f59cfb778bd0f` |
| Novo CodeSha256 | `23yqghzbqtH1e0h1pajG+MTEP9yjnstJ8j9Zz7d4vQ8=` |
| Plano salvo | `infra/terraform/.build/auto5-claim-fix.tfplan` |
| Plano SHA-256 | `630968086b6e359512a4d65ec1347ba22aa142c14deb8f73837dc27d217ee2c9` |
| State usado | serial **70**, lineage conferida, sem alteração persistida |
| Resultado isolado | **0 add / 6 change / 0 destroy**, sem replacement |
| ACM / IAM / dados | **Sem ações / sem ações / sem migração** |

### Por que seis alterações, e não cinco

A auditoria AWS × state confirmou o kill switch real, mas o state serial 70 ainda
guarda o gate como true e BRSA0267 como ENABLED. Ambas as diferenças são do
kill switch autorizado das 20h07. As demais configurações das cinco Lambdas,
as nove policies IAM, cron/timezone/input/targets e os settings foram conferidos.

O primeiro plano, com refresh, incluiu ACM create por dependência transitiva
via Cognito/CloudFront. Foi **rejeitado e removido, sem apply**. O full plan
somente leitura confirmou **1 add / 5 change / 0 destroy**: cinco códigos e
exclusivamente ACM conhecido; as 35 rotas não têm ação.

O plano isolado final usa o padrão de isolamento da AUTO-4: **`-refresh=false`**,
depois da auditoria real e da comparação com o plano refreshed. Também usa
`-lock=false` para não escrever lock remoto. O state foi relido antes e depois
e permaneceu idêntico no serial 70. Esse plano não deve ser aplicado futuramente
sem revalidar state, hashes e AWS; ele não incorpora mudanças posteriores.

| Recurso | Delta no plano | Delta efetivo esperado na AWS |
| --- | --- | --- |
| identity | source_code_hash + last_modified calculado | Novo ZIP |
| canvas_sync | source_code_hash + last_modified calculado | Novo ZIP |
| reminder_events | source_code_hash + last_modified calculado | Novo ZIP |
| auth_trigger | source_code_hash + last_modified calculado | Novo ZIP |
| automatic_reminders | ZIP + gate true → false no state antigo | Novo ZIP; gate real já false |
| Schedule BRSA0267 | ENABLED → DISABLED no state antigo | Atualização idempotente; real já DISABLED |
| Schedule BRSA0257 | no-op, DISABLED | Nenhuma alteração |
| ACM | no-op no plano isolado | Nenhuma ação; pendência conhecida preservada |

Os valores finais completos das cinco Lambdas e do schedule BRSA0267 coincidem
com os valores finais do plano que fez refresh real. A diferença adicional é a
reconciliação explícita do kill switch no state antigo, sem reabrir qualquer gate.
Nenhum environment adicional, role, handler, runtime, arquitetura, memória,
timeout, concurrency, layer, cron, timezone, input ou retry será alterado.

Um plano estritamente 0/5 exigiria primeiro uma atualização persistida do state
para registrar o kill switch e uma nova preparação. **Essa escrita não foi feita**.
O plano 0/6 é uma proposta concreta para revisão, não uma aprovação de deploy.

**PARADA antes de qualquer apply ou write de produção.** Nenhum settings foi
alterado, nenhuma Lambda invocada e nenhum e-mail enviado por esta tarefa.
AUTO-5 continua bloqueada; não reativar BRSA0267 nem habilitar BRSA0257.

## 7. Deploy aprovado e concluído — 09/10, 22h00

**Claim-fix publicado em produção, automação permanece desabilitada.**
Esta aprovação instalou somente a correção. AUTO-5 continua bloqueada e o
piloto BRSA0267 ainda não possui aceite operacional.

### Preflight final

- HEAD `71e2a7e22f657231c543bbada9d693678b28f864`, árvore rastreada limpa,
  main remoto no mesmo SHA; arquivo não rastreado do usuário preservado.
- [CI completo COMPLETED / SUCCESS](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/38008494413),
  três jobs verdes. Código da correção no commit `45a649d`.
- State serial **70**, lineage e conteúdo iguais ao checkpoint aprovado.
- ZIP e tfplan com os mesmos SHA-256 da seção 6; somente `repository.py`
  difere do pacote anterior, entre os 14 módulos.
- Conta **712107929769**, região **us-east-1**: ambos schedules DISABLED,
  gate false, worker Active/Successful e contagens AUTO_REMINDER/REMINDER zero
  em ambas as turmas. Nove policies IAM iguais ao state.
- `terraform show` reconfirmou **0 add / 6 change / 0 destroy**. Cinco ZIPs e
  reconciliação idempotente do schedule BRSA0267; o gate true do state antigo
  foi reconciliado para false, que já era o valor real na AWS.
  Sem ações em ACM, IAM, BRSA0257, settings ou rotas, sem replacement/destroy.

### Apply único

Comando executado exatamente uma vez, sem recalcular o plano:

```sh
terraform -chdir=infra/terraform apply .build/auto5-claim-fix.tfplan
```

Início **09/10/2026 21h59min35s**, término **22h00min13s**,
America/Sao_Paulo; exit code 0.
**Apply complete! Resources: 0 added, 6 changed, 0 destroyed.**

| Recurso | Resultado do apply | Verificação AWS posterior |
| --- | --- | --- |
| auth_trigger | Atualizado, 7 s | Active / Successful, hash aprovado |
| canvas_sync | Atualizado, 14 s | Active / Successful, hash aprovado |
| reminder_events | Atualizado, 20 s | Active / Successful, hash aprovado |
| automatic_reminders | Atualizado, 27 s | Active / Successful, hash aprovado, gate false |
| identity | Atualizado, 26 s | Active / Successful, hash aprovado |
| Schedule BRSA0267 | Atualizado, 0 s | DISABLED, igual à AWS antes do apply |

As cinco Lambdas publicaram CodeSha256
`23yqghzbqtH1e0h1pajG+MTEP9yjnstJ8j9Zz7d4vQ8=`.
Handler, runtime, arquitetura, memória, timeout, role, environment, layers e
concurrency foram comparados com a AWS anterior e permanecem iguais.
Worker: `automatic_reminders.handler`, Python 3.13, arm64, 256 MB, 300 s,
reserved concurrency 2, gate **false**, sem Function URL.

### Estado real e convergência

| Controle | Resultado |
| --- | --- |
| BRSA0257 | DISABLED |
| BRSA0267 | DISABLED |
| Ambos os schedules | `cron(0 20 ? * TUE,FRI *)`, America/Sao_Paulo, flexible OFF |
| Target/input/retry dos schedules | Iguais ao preflight |
| Canvas Scheduler | ENABLED, 06h/18h, sem alteração funcional |
| State após apply | Serial **72**; gate false e ambos schedules DISABLED |
| AUTO_REMINDER / REMINDER | **0 / 0 em cada turma** |
| REMINDER_SETTINGS | Itens completos idênticos ao preflight, versão 1; sem migração |
| Worker Invocations / Errors / Throttles novos | **0 / 0 / 0 observados** |
| Alarmes Errors / Throttles | **OK / OK** |
| SendEmail automático | **0**, sem nova invocação da worker |

Nenhuma escrita de domínio, invocação manual, dry-run ou envio foi executado
nesta implantação. A leitura consistente confirmou settings intactos e ausência
de ocorrências/reservas. Logs da worker sem novos eventos/START durante o deploy;
métricas regionais SES Send/Bounce/Complaint sem datapontos de envio no período.
A telemetria tem ingestão assíncrona; a confirmação inclui as travas reais,
ausência de nova invocação e contagens dos dados, além das métricas.
A invocação histórica das 20h permanece registrada no relatório do piloto.

Full plan somente leitura, **22h00min52s–22h01min06s**, sem arquivo de saída:

```sh
terraform -chdir=infra/terraform plan -input=false -no-color -lock=false
```

**1 add / 0 change / 0 destroy**, exclusivamente
`aws_acm_certificate.portal` create, pendência conhecida. **Zero ação residual
da correção**, 35 rotas sem ação, nenhum warning/drift adicional. O state
continuou serial 72 e idêntico após a auditoria. ACM não foi aplicado.

Após convergência, o tfplan consumido foi apagado do checkout principal e da
worktree da correção; hashes e evidências textuais foram preservados. Nenhum
novo plano de deploy foi gerado. AUTO-2.3 e AUTO-4 permanecem intactas.

Evidências privadas desta implantação: caminho registrado em
`/private/tmp/auto5-claim-deploy-current`.

### Parada e próxima tentativa

**Não reabrir gate, não habilitar schedule, não executar LIVE nesta rodada.**
BRSA0257 permanece fora do piloto. Uma nova tentativa BRSA0267 exige rodada
separada e aprovação, Canvas natural das 18h, SYNC_RUN válido/publicação current,
readiness, settings e quotas/SES. Depois: plano/apply do gate com ambos schedules
DISABLED; plano/apply apenas de BRSA0267; aguardar terça/sexta às 20h natural.
Não alterar a janela nem invocar manualmente.

No futuro LIVE, comprovar claim/ocorrência, avaliação, WITHDRAWN, dedupe por
student/publication, envios coerentes, retry sem duplicação, Errors/Throttles zero
e logs sem PII. Novo claim-conflict é BLOCKER e exige kill switch/investigação.
**Este deploy não encerra AUTO-5 nem aprova uma nova tentativa do piloto.**


## 8. Preparação de recovery de 10/10 — encerrada sem LIVE

**A segunda tentativa LIVE não foi executada. AUTO-5 continua BLOQUEADA.**
A janela definitiva foi restaurada em produção às **01h04 de 10/10/2026**;
gate permaneceu false e ambos os schedules permaneceram DISABLED durante toda
esta rodada. BRSA0257 não entrou no piloto.

### Ocorrência e preflight somente leitura

- Ocorrência pretendida: **09/10 às 20h local**, `2026-10-09T23:00:00Z`.
  Nenhuma ocorrência de sábado foi criada.
- Prova: Canvas natural **09/10 às 18h**, `SYNC_RUN#2026-10-09T21:00:00Z`.
  Source portal.scheduler, succeeded, catalog/roster succeeded e grades
  published/unchanged; publicação ainda current e metadataVersion coerente.
  A publicação coincide com a do primeiro LIVE; término do sync anterior às 20h.
- BRSA0267: settings v1, automaticEnabled=true, vínculos e readiness PASS.
  SES ProductionAccessEnabled/SendingEnabled=true, HEALTHY; quota 50.000/24h,
  14/s e SentLast24Hours=0 nas leituras realizadas.
- População calculada somente por leitura: **59 avaliados, 34 ativos,
  25 WITHDRAWN, 27 elegíveis**; skips 25 withdrawn e 7 no-pending.
  Publicação e participação coincidem com a baseline final do primeiro LIVE.
  Esses números são uma previsão por leitura, não resultado de uma worker LIVE.
- AUTO_REMINDER e REMINDER zero nas duas turmas; gate false e schedules DISABLED.

### Alteração temporária e por que não houve envio

A janela não tinha configuração pronta. Foram adicionadas cinco linhas que
estendiam somente o LIVE de BRSA0267 da ocorrência original até **01h exclusiva**
(300 minutos). Nenhuma mudança de dias LIVE, slot, proof, claim, dedupe, sender,
participation, mensagem ou dry-run. Testes provaram recovery às 00h35, expiração
às 01h, recusa de sábado como nova ocorrência, proof de sexta às 18h e manutenção
da janela de 30 minutos para dry-run, outra turma e outras datas.

- Commits temporários `e2d6d55` e `6935120`: **305 backend, 62 integração/Moto,
  12/12 mutações eliminadas**, CI completo verde. Integração Moto exercitou o
  handler LIVE às 00h35 com settings v1 e a transação real; nenhum AWS real no teste.
- Deploy temporário **00h41min35s–00h42min14s**, **0/5/0**, com gate false.
- O commit separado do gate `d742cb6` falhou no CI porque o teste Terraform ainda
  exigia gate false. A expectativa temporária foi corrigida em `a34f135`, mantendo
  ambos schedules DISABLED; CI completo passou. **Nenhum apply do gate ocorreu.**
- Na revisão do plano do gate foi detectado um delta adicional de ZIP: os 14
  módulos tinham conteúdo idêntico, mas a worktree privada havia produzido modos
  0600 em vez dos 0644 originais. O plano foi rejeitado e apagado sem apply.
  O pacote foi normalizado para 0644 e publicado em **00h48min23s–00h49min02s**,
  outro **0/5/0**, ainda com gate false. Apenas automatic_reminders.py diferia em
  conteúdo do pacote definitivo; repository.py/claim-fix continuou idêntico.
- O horário autorizado foi ajustado de 00h35 para **00h45**, mas os checkpoints
  não estavam concluídos a tempo. Foi solicitada autorização para 00h50, sem
  resposta antes de esse horário passar. **Nenhuma invocação foi feita fora do
  horário autorizado. Não houve segunda/terceira chamada ou retry manual.**

### Restauração definitiva e convergência

Revert explícito **`9299067afbff9386f349f2c416587bfbae67430d`**. A árvore de código,
configuração e testes voltou exatamente ao estado `ee18dbf`, preservando o claim-fix.
**300 backend, 61 integração/Moto, 12/12 mutações e quatro testes Terraform PASS**;
[CI completo de restauração verde](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/38022208859).

Plano revisado salvo: **0 add / 5 change / 0 destroy**, somente códigos das cinco
Lambdas, sem gate/schedules/ACM/IAM/dados. Apply único da restauração:
**01h01min05s–01h04min04s**, **0 added / 5 changed / 0 destroyed**.
A leitura do backend/state e algumas atualizações AWS tiveram latência maior;
não houve falha parcial nem repetição de apply.

| Item | Estado final conferido |
| --- | --- |
| identity / canvas_sync / reminder_events / auth_trigger / worker | Active / Successful |
| ZIP SHA-256 | `db7caa821cdbaad1f57b4875a5a8c6f8c4c43fdca39ecb49f23f59cfb778bd0f` |
| CodeSha256 das cinco Lambdas | `23yqghzbqtH1e0h1pajG+MTEP9yjnstJ8j9Zz7d4vQ8=` |
| Worker gate | false; nunca aberto nesta rodada |
| BRSA0257 / BRSA0267 | DISABLED / DISABLED |
| Cron / timezone / flexible | Terça/sexta 20h / America/Sao_Paulo / OFF |
| LIVE / dry-run | LIVE terça/sexta 20h–20h30; dry-run qualquer dia 20h–20h30 |
| Exceção de recovery | Removida do código publicado |
| State | Serial **79**, reconciliado |
| Full plan sem salvar | **1/0/0**, somente ACM conhecido; 35 rotas sem ação |
| Ações residuais de recovery | Zero |
| AUTO_REMINDER / REMINDER | 0 / 0 nas duas turmas |
| REMINDER_SETTINGS | Itens completos intactos, sem migração |
| Novas invocações worker / envios automáticos | 0 / 0 |
| Errors / Throttles worker; alarmes | 0 / 0; OK |

Configurações das cinco Lambdas, concurrency e schedules foram comparadas com a
baseline anterior; sem alteração funcional remanescente. Canvas continua ENABLED
às 06h/18h. No período observado, todas as cinco Lambdas tiveram Errors/Throttles
zero, inclusive uso natural de identity/auth_trigger. Logs da worker sem novos
START/eventos e métricas SES Send/Bounce/Complaint sem atividade de envio observada.
Não foi gerado tráfego artificial para outras funções.

Os três planos consumidos foram apagados após convergência. Evidências privadas:
`/private/tmp/auto5-recovery-20261010-rwba0s8l`. AUTO-2.3 e AUTO-4 permanecem intactas.

**Claim, envio LIVE, dedupe e retry não foram exercitados em produção nesta
rodada.** Não há resultado PASS da segunda tentativa. O gate nunca precisou ser
fechado, pois nunca foi aberto. Nenhum sender, settings ou identidade SES foi
alterado. **Parado para revisão; nenhuma reativação ou nova tentativa autorizada.**

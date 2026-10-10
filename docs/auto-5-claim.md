# AUTO-5 — correção do falso claim-conflict

**AUTO-5 BLOQUEADA. Correção local preparada; sem deploy, migração ou novo LIVE.**

## Estado protegido

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

## 5. Deploy e eventual nova tentativa — dependem de aprovação

Após commit e CI completo verde, preparar ZIP e plano salvo isolado. Como o ZIP
é compartilhado, a expectativa é **0 add / 5 change / 0 destroy**, apenas código
de identity, canvas_sync, reminder_events, auth_trigger e automatic_reminders.
Comparar os 14 módulos: somente repository.py deve diferir do ZIP publicado.
Nenhuma ação em ACM, IAM, schedule, environment, frontend ou API Gateway.
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

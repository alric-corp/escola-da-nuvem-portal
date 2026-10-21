# 25 — Higiene do backend

**Status:** ✅ concluído em **21/10/2026** — implementação e implantação da C7.6 conferidas no código da Lambda efetivamente integrada à API. Nenhum novo deploy foi executado nesta conferência.

## Registro anterior ao fechamento

O registro anterior informava: C7.6 implementada e integrada à `main` (`0db040d`, `8f6a2b2`; teste `779ee7e`), com CI verde; implantação não confirmada. A tarefa ainda não estava em `concluido/` porque faltava comprovar a implantação. A [AUTO-5](../../historico/automacoes/auto-5.md), já encerrada, informa que a C7.6 ficou fora daquele deploy. Essa informação histórica é preservada; a conferência de 21/10/2026 abaixo resolve a pendência posterior.

As seções de implementação, testes e risco operacional abaixo registram a execução original de 11/10/2026; seus comandos e alertas não representam uma nova autorização de implantação.

## Escopo original da C7.6

- Substituir usos diretos de `datetime.now()` onde houver necessidade de
  clock/fonte testável.
- Corrigir o SyntaxWarning conhecido relacionado ao escape `"\;"` no backend.
- Revisar pequenos pontos de higiene encontrados durante a rodada, sem
  transformar o trabalho em refactor geral.

## Cuidados

- Alteração de backend exige considerar o deploy de Lambda em uma execução
  própria; este registro não autoriza deploy.
- Manter o comportamento funcional.
- Usar testes RED/GREEN para as mudanças.
- Usar Moto quando aplicável.
- Revisar packaging e o conteúdo do pacote da Lambda.
- Não fazer alterações apenas estéticas em massa.

## C7.6 — implementação local de 11/10/2026

### Escopo exato do que foi feito

- **SyntaxWarning.** Reproduzido no CI (`backend/feedback.py:208: SyntaxWarning: invalid escape sequence '\;'`) e no
  teste de compilação local. Era a string `'"\;'` em `content_disposition`; passou a `'"\\;'`, que contém os mesmos
  três caracteres (aspas, barra invertida e ponto e vírgula), ou seja, a sanitização é idêntica. É a única ocorrência
  em todo o Python do repositório. Nenhum aviso foi desligado globalmente.
- **Relógio da prévia.** O único `datetime.now()` direto no fluxo era a idade da prévia em `portal.py::_publish`. Ela
  agora usa `now()`, o mesmo relógio que grava `createdAt` (UTC com offset), em vez do relógio real. `DRAFT_TTL_DAYS`,
  a regra `age.days < DRAFT_TTL_DAYS - 1` e a mensagem não mudaram. O hack `portal.datetime` de
  `test_journey.py::frozen_clock` foi removido: um único `patch("portal.now")` basta.
- **Fora de escopo, de propósito:** `repository.py`/`time.time()` (TTL do DynamoDB em época de segundos),
  `automatic_reminders.py`, `canvas_sync.py`, `sync_runs.py` e a consolidação dos relógios. Nenhum deles tinha
  necessidade funcional demonstrada.

### Testes

- RED antes de corrigir: o teste de compilação com avisos como erro falhava (`invalid escape sequence \;`) e 4 testes
  de relógio falhavam porque o relógio real "expirava" prévias de 2026-09 e de 2020.
- Caracterização que já passava e continua passando: `content_disposition` com nome normal, aspas, barra invertida,
  ponto e vírgula, acentos, caracteres de controle, nome vazio e tentativa de quebrar o cabeçalho.
- Relógio fixo, só `portal.now`: antes do limite (0, 1 dia, 28d 23h59m59s), exatamente no limite (29 dias), depois
  (29d+1s, 30, 60), mudança de dia (23:59 → 00:01 publica; a idade é tempo decorrido, não dia de calendário), UTC
  independente do fuso do processo (UTC, America/Sao_Paulo, Pacific/Kiritimati) e nenhuma leitura do relógio real.
- Arquivos: `tests/integration/test_hygiene.py` (novo; fica fora de `backend/` para não entrar no pacote das Lambdas) e
  `backend/test_journey.py`.
- `python3 -m unittest discover -s backend`: 305 OK; `-s tests/integration`: 88 OK. Contratos Moto: claim 12/12 e
  recovery 11/11 mortas. Mutações dos testes novos (cópia temporária): 9 mortas, 1 equivalente
  (remover o `tzinfo` dos dois lados não muda o resultado). A equivalência vale porque `createdAt` do rascunho só é gravado em `_save_draft`, via `now()` (`datetime.now(timezone.utc).isoformat()`, sempre com offset `+00:00`); os dois lados da subtração são UTC com offset, e o fuso do processo não participa. Se algum dia outro código gravar `createdAt` sem offset, a subtração passa a falhar com `TypeError` (não a calcular errado), e a mutação deixaria de ser equivalente.

### Impacto no pacote e nas Lambdas

O pacote é um só (`data.archive_file.api`): as cinco Lambdas usam o mesmo ZIP. Só `backend/feedback.py` e
`backend/portal.py` mudam no pacote (os testes não entram nele). Um `terraform apply` posterior mudaria o hash das
cinco; a `automatic-reminders` tem `publish = true` e publicaria uma nova versão, e o Scheduler da BRSA0267 chama o
worker sem qualificador. O worker não importa `portal.py` nem `feedback.py`, então o comportamento dele não muda,
mas o deploy é **risco operacional da AUTO-5**: não fazer antes do encerramento da AUTO-5 e só com plano revisado e
aprovação própria. Este registro não autoriza deploy.


## Fechamento — 21/10/2026

### Revalidação local

O recorte `backend.test_journey` e `tests.integration.test_hygiene`, executado em **Python 3.12**, passou com **25 testes, zero falhas e zero skips**. Abrange o relógio da prévia/publicação, a sanitização de `Content-Disposition` e a compilação dos fontes com `SyntaxWarning`/`DeprecationWarning` tratados como erro. Não houve nova alteração no backend para encerrar esta tarefa.

Comando equivalente de reprodução, com as dependências de teste já instaladas no ambiente Python:

```sh
PYTHONPATH=backend python3.12 -B -m unittest backend.test_journey tests.integration.test_hygiene
```

### Implantação existente comprovada por leitura

A consulta STS confirmou a conta `712107929769`, identidade `user/Tomas-Instructor`, profile `default` e região explicitamente selecionada `us-east-1`. As consultas de Lambda e API Gateway e o download privado do ZIP foram somente de leitura.

| Evidência | Resultado observado |
| --- | --- |
| Lambda consultada | `restart-portal-prod-identity` |
| Estado / última atualização | `Active` / `Successful` |
| Runtime / versão | `python3.13` / `$LATEST` |
| `LastModified` | `2026-10-20T22:19:03Z` |
| `CodeSha256` | `S/bn9gfKgYiRWVade7YGBr22Qjpnzsbd7iC2W0364Ys=` |
| SHA-256 do ZIP baixado | `4bf6e7f607ca81889159569d7bb60606bdb6423a67cec6ddee20b65b4dfae18b` |
| API Gateway | API `y7e0g48k4d`, integração `20ivdta`, apontando para o ARN da Lambda `identity` sem qualificador; portanto utiliza `$LATEST` |

O hash do pacote corresponde à implantação de 20/10/2026 já relatada no [PR #10](https://github.com/alric-corp/escola-da-nuvem-portal/pull/10). A conferência direta de leitura descrita aqui foi feita em 21/10/2026. Os dois arquivos da C7.6, extraídos do ZIP em diretório privado, são byte a byte iguais aos arquivos presentes no commit `302bb3ccae7dd6365e77b485a7c1b110182f15f5` e na `main` de referência `9058941ffa4dca05b7d421ebaf555609fd76dfd2`:

| Arquivo | SHA-256 dos bytes locais e implantados |
| --- | --- |
| `portal.py` | `eca9560b5fb465bf6f2053cbfd32b83904e298b790a29b4c6e111d0390645dc8` |
| `feedback.py` | `042e2cbee46e0082c504e9275eb7503ff5de239107497706356d2fda499af814` |

Isso comprova que as correções de relógio e escape da C7.6 estão no código atualmente integrado à API. Os testes acima foram locais em Python 3.12; o runtime observado na AWS é Python 3.13. Não foi executada uma nova publicação acadêmica nem outra mutação produtiva para essa verificação, e não se afirma aqui uma nova execução desses fluxos em produção ou a conferência independente de todas as demais Lambdas.

### Alcance do encerramento

O TODO 25 foi movido para `concluido/` pela revalidação e pela comprovação da implantação existente. A conferência não executou Terraform, deploy, alterações de configuração ou escritas AWS. O ZIP e suas evidências privadas não são publicados no repositório.

O encerramento se limita à C7.6. Os TODOs 23 e 24 permanecem separados: suas novas correções e a implantação correspondente não são consideradas concluídas por esta evidência.

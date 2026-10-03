# Deploy do backend da C7.2 (participação)

**Datas:** 2026-10-02 (preparação) e 2026-10-03 (deploy e fechamento)
**Status:** CONCLUÍDO. Backend publicado em 03/10 por volta das 00:30 (Brasília). A primeira execução natural do Canvas Sync, às 06:00, ficou verde, e o smoke depois dela também.

## Resumo

- O backend da C7.2.1 (persistência e API) e da C7.2.2 (leitura, métricas e lembretes) está em produção nas quatro Lambdas que compartilham o pacote do backend.
- Antes do deploy, o empacotamento foi corrigido: o cache local do pytest entrava no zip.
- O plano usou `-target` + `-refresh=false` como exceção controlada, depois de comparar as Lambdas reais com o Terraform state.
- As leituras de produção antes e depois do deploy foram idênticas byte a byte. Zero erros. Zero marcas de participação.
- O Canvas Sync das 06:00 rodou com o código novo e publicou normalmente as duas turmas, sem erros. O smoke pós-sync manteve todas as invariantes.
- O frontend não mudou (`f1ebfed`). O certificado ACM do domínio customizado segue numa trilha separada.

## Versões

| Item | Valor |
|---|---|
| C7.2.1 | `1e6764e` — CI [37043820733](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37043820733) verde |
| C7.2.2 | `c46379b` — CI [37066242477](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37066242477) verde |
| Correção do pacote | `d4c571a` — CI [37092994597](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37092994597) verde: backend 220, Moto 23, frontend 117/117 e 17/17, Terraform fmt/validate/test e checagem do pacote |
| Backend em produção | pacote montado no `d4c571a`; apply em 03/10, 03:29:36Z → 03:30:08Z (00:29 → 00:30 em Brasília) |
| Frontend em produção | `f1ebfed` (sem deploy nesta release) |
| Marcas `PARTICIPATION#` | zero: antes do deploy, depois do deploy e depois do sync das 06:00 |

Desde o deploy anterior do backend (26/09), os únicos commits que alteram o backend fora dos testes são `1e6764e` e `c46379b` (`portal.py` e `grades.py`).

## Pacote das Lambdas

- **Achado:** o `data.archive_file.api` (`infra/terraform/api.tf`) compacta a pasta `backend/` inteira. A pasta local `backend/.pytest_cache/`, ignorada pelo git, entrava no zip.
- **Correção (`d4c571a`):** `.pytest_cache` entrou nos `excludes`. No CI, o job Terraform simula esse cache antes do `terraform test` e reprova o build se o zip montado pelo provider archive o contiver.
- **Prova:** sem a correção, a checagem falhou listando os 5 arquivos do cache. Com a correção, passou mesmo com o cache presente.
- **Pacote publicado:**
  - 12 módulos: `auth_trigger`, `canvas`, `canvas_sync`, `changes`, `delivery`, `feedback`, `grades`, `identity`, `integrity`, `portal`, `reminders`, `repository`;
  - 45.226 bytes, `source_code_hash` `oJUfftmJmpWabsHqme84vi9eniKGfG4e62WVVIMUcWs=`;
  - cada arquivo byte a byte igual ao do commit;
  - zero `.pytest_cache`, zero `__pycache__`, zero `test_*.py`.

## Plano direcionado: `-target` + `-refresh=false` (exceção controlada)

- **Por quê:** com `-target` sozinho nas quatro Lambdas, o plano ainda incluía a criação de `aws_acm_certificate.portal`. Duas coisas se combinam:
  - a Lambda `identity` depende do certificado por uma cadeia de referências: variável `AUTH_DOMAIN` → domínio, branding, cliente, resource server e user pool do Cognito → CloudFront (`infra/terraform/cdn.tf:65`) → certificado;
  - no refresh, o provider trata o certificado em `VALIDATION_TIMED_OUT` como apagado.
- **Mitigação, antes do apply:** com `-refresh=false`, o Terraform não relê as Lambdas na AWS. Por isso, a configuração real das quatro Lambdas foi comparada com o state em 25 campos cada. Entre eles: código, runtime, handler, role, memória, timeout, variáveis, layers, arquitetura, package type, logging, tracing, VPC, concorrência, tags e `LastModified`. **Resultado: zero divergências.**
- **Plano salvo:** `0 to add, 4 to change, 0 to destroy`.
  - Só mudam `source_code_hash` (`f0kcO0q…` → `oJUfftm…`, igual ao hash do zip) e `last_modified` (calculado pela AWS).
  - O ACM não aparece no plano. No JSON, as dependências trazidas pelo `-target` constam como `no-op`, isto é, sem ação.
- **Apply:** só do arquivo de plano revisado. Antes, uma trava conferiu que o zip era o mesmo que gerou o plano.
- **`-refresh=false` não virou padrão do projeto.** Foi uma exceção aprovada só para este deploy.

## Apply e verificação

- **Resultado:** `Apply complete! Resources: 0 added, 4 changed, 0 destroyed.`
- **As quatro Lambdas** (`identity`, `auth_trigger`, `canvas_sync`, `reminder_events`):
  - mudaram só o código (`oJUfftm…`), o tamanho (47.611 → 45.226 bytes) e o `LastModified`;
  - todo o resto ficou idêntico, com estado `Active`/`Successful`;
  - a configuração na AWS bate com o state.

## Smoke em produção (só leitura)

- **Método:** invocação direta da Lambda `identity` com um evento sintético de admin, no formato da API. As rotas usadas foram conferidas no código como sem escrita.
- **Leituras na turma BRSA0267:**
  - `/report`, que inclui o status do Canvas Sync;
  - "Notas da turma";
  - prévia individual de lembrete, sem envio.
- **Antes × depois do deploy:** respostas idênticas byte a byte nas três leituras, sem nenhum `participationStatus`. Só versões sanitizadas foram guardadas.
- **Erros:** zero `Errors` nas quatro Lambdas, zero 5xx na API e zero eventos de erro nos logs. A janela vai do apply (03:29:36Z) até depois do smoke pós-sync (03/10, ~11:45Z), e a hora anterior ao apply também foi conferida.

## Canvas Sync das 06:00 (03/10)

- **Execução natural, agendada:** 09:00:46Z → 09:01:28Z (06:00:46 → 06:01:28 em Brasília). Nada foi disparado manualmente.
  - 41,9 s; 115 MB; cold start de 186 ms, já com o código novo.
  - Para comparação, o sync anterior (02/10, 18:00, ainda com o código antigo) levou 50,9 s e também usou 115 MB.
- **Resultado:** `published` nas duas turmas (BRSA0257 e BRSA0267). O token do Canvas expira em 79,8 dias.
- **Erros:** zero linhas de erro no log da `canvas_sync`. Métricas: `Invocations=1`, `Errors=0`, `Throttles=0`. Zero 5xx na API.
- **`PARTICIPATION#`:** zero nas duas turmas depois do sync.

### Smoke pós-sync (BRSA0267, só leitura)

Comparação por estrutura e invariantes com a leitura de 00:30, não por conteúdo acadêmico, já que o sync publicou notas novas.

| Verificação | Resultado |
|---|---|
| `/report` e "Notas da turma" | HTTP 200, servidos pelo código novo |
| Status do Canvas Sync | `published` às 09:01:28Z, "44 nota(s) alterada(s)" |
| Estrutura | mesmas chaves de topo, por aluno e por linha |
| Alunos | 59 → 59, as mesmas pessoas; ninguém entrou nem saiu |
| "Notas da turma" × `/report` | as mesmas 59 pessoas |
| Atividades | 166 → 166, nenhuma nova ou removida; ativas 60 → 61 |
| Histórico | 19 → 20 publicações (a do sync) |
| `participationStatus` | nenhum |
| Frontend | 30 arquivos com HTTP 200; 29 byte a byte iguais ao build do `f1ebfed`; só o `config.json` difere, porque é gerado no deploy do frontend |

**As diferenças acadêmicas vêm do Canvas, não do código.** São elas: a publicação nova, as 44 notas, a atividade a mais ativa e a situação acadêmica redistribuída (`ok` 6 → 8, `attention` 19 → 15, `critical` 34 → 36).
- A comparação função a função (AST) entre `f1ebfed` e `d4c571a` mostra o caminho do sync e da publicação idêntico: `sync_from_canvas`, `_publish`, `_preview`, `parse_csv`, `summary`, `display_snapshot`, `canvas_sync.py`, `canvas.py`, `changes.py`, `integrity.py` e `repository.py`.
- A C7.2 alterou só `_report`, `_reminder_flow`, `_reminder_batch`, `dispatch`, `class_report` e `overview`, e acrescentou as funções de participação.

## Status das Lambdas (até 03/10, ~08:45 em Brasília)

| Lambda | Situação |
|---|---|
| `identity` | exercitada pelo smoke e por uso real depois do deploy; verde |
| `canvas_sync` | execução natural das 06:00; verde |
| `auth_trigger` | exercitada naturalmente em dois logins (01:03 e 08:41, Brasília); verde |
| `reminder_events` | nenhum evento do SES desde o deploy; aguarda o próximo |

`auth_trigger` e `reminder_events` não foram exercitadas artificialmente. Seus módulos permaneceram byte a byte inalterados e passaram no CI:
- `auth_trigger.py` não importa nada do projeto;
- `delivery.py` (handler da `reminder_events`) importa só o `repository.py`;
- os três não mudam desde antes do deploy anterior, de 26/09.

## Plano completo pós-deploy (auditoria)

Resultado estável: `1 to add, 0 to change, 0 to destroy`.
- A única mudança planejada é a criação de `aws_acm_certificate.portal`.
- As quatro Lambdas têm zero mudanças.
- Não foi rodado outro plano por causa do sync.

## Certificado ACM: trilha separada

- `aws_acm_certificate.portal` continua pendente.
- O certificado anterior está `VALIDATION_TIMED_OUT` na consulta detalhada do ACM (`FAILED` na lista).
- `portal_domain_ready = false`: o certificado não participa do runtime.
- Nenhuma ação nesta release.
- Quando o domínio customizado for retomado:
  - recriar o certificado conscientemente;
  - obter o **novo** CNAME de validação;
  - substituir o pedido de DNS anterior e validar;
  - só depois ativar `portal_domain_ready`.

  Não reaproveitar o CNAME antigo.

## Achado de refresh transitório do bucket do portal

- **Fatos:**
  - A primeira rodada completa do plano depois do deploy indicou, falsamente, que `aws_s3_bucket.portal` tinha sido removido.
  - O bucket existia na AWS, e o site respondia HTTP 200.
  - Leituras direcionadas do bucket (`plan -refresh-only`) deram "No changes".
  - Uma segunda execução completa não reproduziu o achado.
  - Nenhuma alteração foi aplicada, e nenhuma manipulação de state foi feita.
- **Classificação:** LOW operacional, comportamento transitório do refresh/provider. Não é bug da C7.2.
- **Aprendizado:** aplicar somente um `.tfplan` salvo e revisado, nunca um plano novo não inspecionado.
- **Sem mudança:** nenhum `ignore_changes`, nenhuma alteração de state, nenhuma alteração no S3.

## Rollback

- Não foi utilizado.
- Enquanto não existir nenhuma marca de participação, voltar ao backend anterior à C7.2 é seguro: sem marcas, as respostas são as mesmas.
- Depois da primeira marca `WITHDRAWN` real, um backend anterior à C7.2.2 deixa de ser destino seguro. Ele ignora `PARTICIPATION#`: os desistentes voltariam às métricas e poderiam receber lembretes em lote.

## Pré-requisito bloqueador da C7.2.3

Antes da C7.2.3 ser publicada, o envio do lote no frontend deve mandar **somente os IDs aprovados na prévia**, nunca todos os IDs selecionados.

Motivo: um aluno desistente durante a prévia pode ser reativado antes do envio. O backend recalcula o estado atual de cada ID recebido e nunca acrescenta IDs, mas não deve receber um ID que a prévia não aprovou.

Até a C7.2.3, produção continua com **zero** marcas: a rota `POST /cohorts/{code}/participation` não é chamada em produção.

## Histórico da preparação (02/10)

- O primeiro plano completo, no `c46379b`, trouxe as quatro Lambdas e a criação inesperada do certificado ACM. Por isso a release foi limitada às Lambdas.
- O plano com `-target` sozinho ainda trouxe o certificado. Com `-refresh=false`, ficaram só as quatro Lambdas.
- O achado do `.pytest_cache` levou à correção do pacote no `d4c571a`, antes do deploy.

## Arquivos de referência

Textos dos planos em `infra/terraform/.build/` (ignorado pelo git). Nenhum plano binário da rodada foi mantido.

| Arquivo | Conteúdo |
|---|---|
| `c722-plan.txt` | primeiro plano completo, no `c46379b` |
| `c722-lambdas-plan.txt` | plano direcionado com refresh (traz o certificado) |
| `c722-lambdas-norefresh-plan.txt` | plano direcionado com `-refresh=false`, exploratório |
| `c722-final-plan.txt` | plano salvo e aplicado (`terraform show`) |
| `c722-postdeploy-plan.txt` | primeira auditoria completa (com o achado transitório do bucket) |
| `c722-postdeploy-plan-2.txt` | segunda auditoria completa (só o ACM) |

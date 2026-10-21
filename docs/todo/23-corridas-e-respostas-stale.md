# 23 — Concorrência e respostas stale

**Status:** revisão transversal delimitada concluída em 21/10/2026. C7.3/C7.4 já estão implantadas e foram verificadas na release `9058941ffa4d-301af4d0e066`. Lacunas adicionais foram reproduzidas e corrigidas neste PR; **a implantação dessas correções permanece pendente**. O item continua no backlog por essa pendência operacional, não por falta das implementações históricas. C7.5/C7.6: [24](24-melhorias-ux-e-lifecycle.md) e [25](concluido/25-higiene-do-backend.md).
**Origem:** roadmap técnico C7 posterior à C7.2. O TODO 23 não está concluído.

## Contexto

Há fluxos assíncronos em que uma resposta antiga pode chegar depois de o
usuário já ter mudado de contexto e sobrescrever uma visualização mais nova.

A C7.2 já resolveu participação/desistentes e está concluída e ativada em
produção. Essa funcionalidade não faz parte deste TODO.

Os pontos abaixo preservam o roadmap e a caracterização RED/GREEN histórica
da C7.4. A revisão transversal desta missão está na consolidação de 21/10/2026.

## Registro original das pendências (histórico da C7.4)

### Resultado stale do lote

- C7.3 implementada no commit `1daab314413e675cec9cf1d8b3be2aa8b5e1dc25`.
- O resultado/erro do envio usa `batchPreviewRequest`, turma e view; somente
  o dono atual pode alterar resultado, redesenhar ou emitir aviso. Erro atual
  continua chegando ao `busy`; o `finally` só libera o elemento ainda conectado.
- Preservar o comportamento da C7.2: batch send usa somente os IDs aprovados
  pela preview.
- Não quebrar o motivo `withdrawn`.

### loadSender

- C7.4 local: geração própria, turma, view e identidade da sessão protegem
  dados, erro e loading. A verificação do remetente compartilha essa geração.

### loadMine

- C7.4 local: geração, turma, view, sessão e identidade da lista protegem
  dados, cursor, erro e loading; troca de contexto limpa a lista imediatamente.

### Preview individual

- C7.4 local: geração, turma, view, sessão e aluno protegem a prévia e o erro.
  Erro obsoleto não chega ao toast; envio antigo não recarrega uma prévia nova.

### Revisão transversal

- Procurar outros requests com o mesmo padrão, sem abrir refatoração genérica.

## Estratégia esperada

1. Criar characterization tests do comportamento atual.
2. Demonstrar a falha com teste RED.
3. Aplicar o menor generation/request guard necessário.
4. Executar mutations que comprovem a proteção.
5. Validar os fluxos com browser tests.

Preservar contratos existentes; não mudar um contrato sem necessidade
demonstrada.

## C7.4 — evidências locais de 10/10/2026

### Preflight e C7.3 publicada

Repositório `escola-da-nuvem-portal`, branch `main`, HEAD inicial
`43734b9a1416ebb4aa7b41964f109dd53ff57dca`, remote de destino
`alric-corp/escola-da-nuvem-portal`. `origin` não foi utilizado. O diff
preexistente de `docs/auto-5.md` e o arquivo não rastreado
`AUTO-2.3-aprovacao-apply.md` foram preservados integralmente. Não havia
alterações preexistentes nos arquivos necessários à C7.4.

**Deploy C7.3 CONFIRMADO por leitura HTTP**, sem publicação nesta rodada:
o [handler servido pelo CloudFront](https://d2bx9t870lzfvc.cloudfront.net/handlers/reminders.js)
retornou HTTP 200 e corresponde byte a byte ao handler do commit `1daab31`.
SHA-256: `6bd7ffc0676afede7d796b99273766c2e217117466aaeb41bc04da20aeb9d7d9`.
`index.html` e `app.js` publicados correspondem ao HEAD inicial; o entrypoint
importa esse handler. Essa evidência confirma C7.3, não o deploy da C7.4.

### Inventário anterior à correção

| Fluxo | Início / contexto capturado | Escritas após await e falha anterior | Loading / callbacks |
| --- | --- | --- | --- |
| `handlers/reminders.js::loadSender` | GET `reminder-settings`; capturava apenas `code` | Sucesso em `sender`, erro em `senderError`; bastava a turma coincidir. Requisições concorrentes e saída/retorno à mesma turma aceitavam respostas antigas | `senderLoading` no início e finally; finally A podia encerrar B. Chamado por boot, menu, retry/refresh; `verifySender` também escreve em sender |
| `handlers/feedback.js::loadMine` | GET `/feedback?limit=20`, cursor opcional; capturava referência de `myFeedback` e cursor | Sobrescrevia/anexava items, nextCursor e error sem geração ou validação de contexto. Lista anterior podia reaparecer e paginação antiga contaminar refresh | `list.loading` no início/finally; só render final verificava view. Boot, menu, retry, paginação e recargas após submit/uploads/anexos |
| `handlers/reminders.js::loadPending` | POST `pending-preview` com `studentId`; capturava turma, selecionava aluno e abria view | Sucesso/erro verificavam turma/view/aluno, mas duas chamadas do mesmo aluno e A→B→A não eram diferenciadas. Catch relançava até erro obsoleto ao busy/toast | Loading é derivado de preview nula/erro vazio. Painel, retry, refresh, recarga após participação e finally do envio individual |

Nos três fluxos, `busy` pertence ao botão clicado; renderizações substituem os
elementos e o finally não libera um botão novo. Ele foi preservado e exercitado
pelos testes. A correção impede que uma resposta antiga provoque renderização
ou loading/erro que pertenceriam à requisição mais recente.

### Implementação

- Gerações locais `senderRequest`, `mineRequest` e `pendingRequest`.
  Validação de ownership antes de cada escrita após await, erro e finally.
- `app.js::syncReadContext` compara sessão (`me`), turma, view, modo de
  visualização e aluno selecionado. Ao mudar, invalida as três leituras e limpa
  os dados antes de desenhar. Sair e voltar ao mesmo contexto não revalida A.
  Boot, logout e expiração de sessão também invalidam as leituras.
- Handlers recebem apenas os callbacks de composição `render` e `syncContext`;
  não importam autenticação, DOM, navegação nem uma infraestrutura genérica de
  cancelamento. Não dependem de AbortController.
- `loadMine` preserva paginação legítima e não consulta fora da view feedback.
  Uma resposta não escreve na referência antiga da lista.
- `verifySender` usa o mesmo ownership de `loadSender`. O retorno de um envio
  individual só avisa/recarrega se sua prévia ainda for atual; um erro de envio
  que espera a recarga também é revalidado antes de emitir aviso.
  A operação do servidor continua; não há cancelamento ou retry do envio.
- Endpoints, payloads, Cognito, autorização, participação/WITHDRAWN, regras de
  elegibilidade, publicação, dedupe, seleção aprovada do lote e mensagem
  permanecem inalterados. Nenhuma mudança em backend ou Terraform.

### RED/GREEN, regressão e mutations

- Primeira execução: **88 testes, 80 RED / 8 PASS**, reproduzindo as corridas
  antes de alterar a implementação.
- Callbacks relacionados: **4 RED adicionais** (verificação de remetente e
  recarga após envio); revisão identificou **1 RED adicional** para erro de
  envio cuja recarga se tornou obsoleta. Todos corrigidos.
- Resultado final: **94/94 cenários C7.4 PASS**, usando promises controladas,
  sem sleeps arbitrários. A/B fora de ordem, B falha/A sucesso, erros antigos,
  loading/busy de B, turma/view/aluno/sessão, A→B→A sem nova consulta,
  limpeza imediata, paginação e respostas atuais legítimas.
- `npm test`: **271 PASS**; preserva C7.3, contratos OpenAPI e participação.
- `npm run test:browser`: **20 suítes PASS**; inclui os três fluxos em
  **375px e 1440px**, navegação real, turma, expiração 401, DOM e ausência de
  toast obsoleto, além das regressões existentes de foco, lote e participação.
- `python3 tests/contracts/stale_mutations.py`: controles Node/browser PASS,
  **21 mutações mortas / 0 sobreviventes**. Exercita geração, sucesso, erro,
  finally, referência da lista, invalidação, callbacks de remetente/envio e
  ligação real de navegação/expiração no navegador. Muta somente cópias
  temporárias, sem editar o checkout nem acessar AWS.
- Revalidação na revisão final: `npm test` 271 PASS (padrão e UTC); `npm run
  test:browser` 20 PASS (padrão e UTC); mutações 21/21 mortas, 0 sobreviventes.
- Build estático e `git diff --check` PASS. Testes usam API/SES fictícios;
  nenhuma invocação ou e-mail real. Não houve alteração de produção.

### Limites e próximos passos

C7.4 foi revisada e commitada; as 21 mutações passaram a rodar no job `node` do
CI (`python3 tests/contracts/stale_mutations.py`; mutação sobrevivente falha o
job). O **deploy do frontend não foi feito** e depende de aprovação própria. A revisão transversal C7.5 e a etapa C7.6 permanecem não iniciadas.
O TODO 24 (feedback de formulário/admin, anexos/ObjectURL, drafts, UX) continua
separado; a limpeza aqui se restringe às três leituras identificadas.
AUTO-5 continua aguardando o disparo natural de 13/10, sem alteração dos gates
ou schedules por esta tarefa.


## Consolidação — 21/10/2026

Base consultada diretamente no GitHub: `9058941ffa4dca05b7d421ebaf555609fd76dfd2` (PR #11 integrado). Os relatos anteriores acima foram preservados como histórico; suas frases sobre deploy pendente e etapas futuras não descrevem mais, por si só, o estado atual.

### Implantação conferida

- Release efetivamente ativa: `9058941ffa4d-301af4d0e066`, `mode=modern`, `source_sha=9058941ffa4dca05b7d421ebaf555609fd76dfd2`.
- [Deploy 39543703472](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39543703472): `workflow_run`, publicação e ativação aprovadas, invalidação `I551X3VSPCPMAPHBTZ68YDGXPJ` concluída para `/` e `/index.html`, smoke aprovado. Artefato `activation-39543703472-1` confirma a ativação.
- Leitura HTTPS independente de `/` e `/index.html`: HTTP 200, mesmo ponteiro, `Cache-Control: no-cache`, SHA-256 `00c13b1c1b93b5d3f920e65c6f6a202def46b3c84b7eb4903b1bd18afa856664`.
- Manifesto SHA-256 `b994831a3ab7d3a26af092ee65e974098cae8084e5dda3aa6a7ae01a7b29be01`. Onze módulos/páginas relevantes (app, API, state, quatro handlers e quatro páginas) coincidem byte a byte com a main e com os hashes/tamanhos do manifesto.
- Isso comprova o código anterior à correção deste PR, **não** a implantação das novas correções. Não houve deploy nesta missão.

### Revisão transversal e resultado

| Fluxos examinados | Proteção / comportamento conferido |
| --- | --- |
| `app.js`: `loadReport`, `boot` e `loadClassReport` | Novos REDs reproduzem retorno acadêmico depois de Guia/turma/usuário/modo A→B→A, `/me` fora de ordem, expiração/logout durante boot e refresh das notas da turma após sair da tela. Correção: geração/contexto e identidade antes de aceitar dados/erros; boot antigo não reinicia rascunhos de outra sessão. |
| `reminders.js`: `loadSender`, `verifySender`, `loadPending` | C7.4 existente reexecutada: dados, erro, loading, finally, aluno, identidade e contexto continuam protegidos. Nenhum envio/cópia individual foi recolocado na interface. |
| `reminders.js`: `loadBatchPreview`, `sendBatch` | Novos REDs de saída/retorno à mesma turma/tela/sessão e identidade sem novo render. Correção: invalidar também a geração do lote, sincronizar antes de capturá-la e conferir o usuário. Confirmação, lista aprovada e POST único preservados. O aviso global de expiração real (401/preflight sem sessão) continua; erro antigo com B autenticado não aparece. |
| `feedback.js`: `loadMine`, submissão e upload de anexos | Paginação, cursor, referências, dados/erro/finally e guards C7.4/C7.5 revalidados. Novo RED da retomada de upload após troca de usuário: não encerra o busy nem consulta a lista de B. A mesma pessoa pode concluir um upload legítimo após navegar. |
| `feedback.js`: `loadAttachments`, fechar/reabrir galeria | Novos REDs de URLs/erro/render após troca de usuário, resposta de galeria substituída, fechamento e A→B→A. Contexto e referência são conferidos antes e depois dos awaits; somente galerias pendentes são fechadas ao invalidar o contexto. URLs já carregadas não são apagadas indiscriminadamente. |
| `admin-feedback.js`, `import.js` | Revisados junto ao [TODO 24](24-melhorias-ux-e-lifecycle.md): reset invalida leitura administrativa; arquivo/prévia pertencem ao rascunho/usuário que os iniciou, sem apagar rascunhos legítimos da mesma pessoa. |
| `access.js` e composição de mutações em `app.js` | Conferidos ownership de leituras/buscas e callbacks de recarga, sessão, operação e foco já exercitados em C1/C2. Não houve mudança de contrato ou repetição de operações. |

A revisão abrange os fluxos acima e seus callers atuais, inclusive navegação para o Guia durante leitura acadêmica, troca de turma no Guia e retorno ao painel. Não afirma ausência universal de corridas em qualquer código, API, múltiplas abas ou fluxos fora desse recorte. Participação/desistentes e AUTO-5 não foram reabertos.

### Regressões e pendência real

- `tests/report-context.mjs`: funções reais do app, promises controladas e testes de sucesso/erro/identidade; `tests/report-context-browser.mjs`: navegação real no Chromium em 375/1440 px. A versão original do app servida em área temporária falha nos quatro cenários do Guia; a correção passa.
- A revisão final do guard acrescentou 12 controles de expiração em `/me`, `/cohorts` e notas da turma. Cinco falhavam na primeira revisão deste PR: invalidar o boot também suprimia o aviso global da própria expiração; o preflight das notas não possui `status`. Os catches preservam 401/mensagem de expiração somente quando não há sessão; erro antigo com outra pessoa autenticada continua ignorado. O módulo completo passa 30/30. Essa regressão foi corrigida antes da integração, sem mudar a camada de autenticação.
- `tests/batch-stale-context.mjs`, `tests/feedback-async-context.mjs`, reforços de `tests/feedback-lifecycle.mjs` e `tests/import-lifecycle-browser.mjs` preservam também os controles positivos atuais.
- `tests/stale-responses.mjs` e os contratos de arquitetura foram adaptados ao novo guard, sem remover as verificações de ordem, identidade, sucesso e erro. Mutações continuam em cópias temporárias; a remoção conjunta das duas proteções de `loadMine` mantém o controle histórico, apesar de agora separadas pela invalidação de galerias.
- Descartar a resposta na UI não desfaz uma operação recebida pelo servidor. Nenhum POST é repetido ou cancelado; os testes de mutação usam somente dados fictícios.
- **Encerramento restante:** após integração/publicação pelo fluxo existente, conferir a release ativa e os hashes dos cinco arquivos de runtime alterados (`app.js` e handlers reminders/feedback/admin-feedback/import), relacionando-os ao commit integrado. Então mover o item para `concluido/`. Não é necessário novo deploy manual nem auditoria de infraestrutura.

Os resultados consolidados efetivamente executados nesta missão estão no [índice do backlog](README.md), separados das evidências históricas da C7.4.

# 24 — Melhorias de UX e lifecycle

**Status:** C7.5 implementada, testada e **implantada**, confirmada na release `9058941ffa4d-301af4d0e066` em 21/10/2026. A revisão desta missão reproduziu lacunas adicionais no isolamento de CSV/prévia, finally da lista administrativa e retomada/galeria de anexos; estão corrigidas neste PR, **com implantação pendente**. O item continua no backlog por essa pendência específica.

## Contexto

O registro original reunia pequenos problemas que não interromperam entregas prioritárias anteriores. A C7.5 implementou as correções abaixo; esta revisão reexecutou seus testes e examinou as lacunas adicionais descritas na consolidação.

## Pendências originais — resolvidas na C7.5

- **Admin Feedback:** um 409 de mudança de status pode deixar select/badge
  inconsistentes.
- **Admin Feedback:** tratamento de erro em “Carregar mais”.
- **Importação:** Map/estado dos drafts pode ficar desatualizado até `saveDraft`.
- **Feedback:** revisar estado sobrevivendo à troca de usuário.
- **Attachments:** lifecycle/revogação de ObjectURL.
- **Foco/acessibilidade:** revisar apenas pequenos casos remanescentes,
  preservando as garantias da C7.1.

## Resultado de cada pendência na C7.5 (10/10/2026)

| Pendência | Situação conferida | Resultado |
| --- | --- | --- |
| Admin Feedback: 409 no status | **Confirmada** com um servidor que aplica `expectedStatus`: o badge ficava no status antigo e toda nova tentativa dava 409 de novo | Corrigida: o 409 atualiza a lista com o servidor, mantém o detalhe aberto, nunca confirma sucesso e devolve o foco ao select |
| Admin Feedback: erro em "Carregar mais" | **Confirmada**: o erro escondia os itens já carregados e "Tentar novamente" recomeçava do zero. O mesmo padrão existia em "Meus feedbacks" | Corrigida nas duas listas: itens visíveis, cursor preservado, nova tentativa repete a mesma página sem duplicar |
| Importação: Map dos drafts desatualizado | **Confirmada em um caso**: após restaurar o rascunho de uma turma, a cópia no Map ficava velha e ainda contava como "arquivo não publicado" (ex.: depois de rejeitar um CSV de mais de 2 MB) | Corrigida: `restoreDraft` retira a cópia; o `state` é a fonte da turma aberta. Não foi encontrada outra manifestação |
| Feedback: estado entre usuários | **Confirmada**: só `myFeedback` e os drafts de importação eram reiniciados; rascunho, imagens, anexos, uploads e toda a fila do admin sobreviviam, e um envio em andamento do usuário anterior escrevia no estado do novo | Corrigida: `resetForUser` no boot (quando o `/me` muda) e no logout, com geração para envios em trânsito |
| Attachments: ObjectURL | **Confirmada em dois caminhos**: troca de usuário e logout não liberavam as prévias. Remover, descartar e concluir já liberavam, sem revogação prematura | Corrigida; liberar/remover/descartar/concluir continuam cobertos por caracterização |
| Foco/acessibilidade | **Confirmados três casos**: depois de salvar status, de voltar do detalhe e de abrir/ocultar anexos, o foco ia para o BODY | Corrigidos com um único `restoreFocus` que só age se o foco realmente se perdeu. Não foi encontrado outro caso; as garantias da C7.1 foram mantidas |

## C7.5 — evidências locais de 10/10/2026

### Arquivos

Código: `frontend/handlers/admin-feedback.js`, `frontend/handlers/feedback.js`, `frontend/handlers/import.js`,
`frontend/pages/admin-feedback.js`, `frontend/pages/feedback.js`, `frontend/app.js`. Testes novos:
`tests/feedback-lifecycle.mjs` (unitário), `tests/feedback-lifecycle-browser.mjs` (navegador) e
`tests/contracts/lifecycle_mutations.py` (mutações, no job `node` do CI). Ajustados: `tests/architecture.mjs`,
`tests/feedback-browser.mjs` e `package.json`. Endpoints, payloads, Cognito, regras de notas,
participação/WITHDRAWN, lembretes e backend: inalterados. As proteções de geração/ownership da C7.4 foram preservadas.

### RED / GREEN

- Unitário: **9 RED** pelo comportamento antes de qualquer correção (409 ×2, Carregar mais ×2, Map dos drafts, estado
  entre usuários ×3, URLs no logout/troca) e **6 de caracterização** que já passavam e continuam passando
  (409 nunca é sucesso, erro na primeira página, rascunho de outra turma, remover/descartar URL, URL do cartão).
  Reforços posteriores: 3 testes (refresh do 409 sem esvaziar a tela, troca durante o envio das imagens, envio concluído
  libera as prévias) e 2 de estado (envio e upload de A não alteram B).
- Navegador: **5 de 5 blocos RED** (409 com servidor com estado, foco ao salvar e voltar, Carregar mais com erro no
  admin e no aluno, foco ao alternar anexos), mais 3 blocos (foco escolhido pelo usuário preservado, troca de usuário com
  `/me` diferente e a mesma pessoa mantendo o rascunho).
- Dois testes antigos fixavam o comportamento corrigido e foram atualizados de propósito, com o motivo no comentário:
  `feedback-browser.mjs` (409 sem recarga e select preso na escolha; "com erro, a tela mostra só o aviso").

### Mutações

`python3 tests/contracts/lifecycle_mutations.py`: controles PASS, **37 mortas / 0 sobreviventes**, em cópias
temporárias (sem editar o checkout, sem AWS). Cada mutação é validada com `node --check`; erro de sintaxe aborta e
não conta. Cobre: 409 como sucesso, sem atualizar a tela, que esvazia a tela, item fora do filtro; cursor que avança
após erro; reset sem limpar rascunho/fila/geração; envio e upload do usuário anterior no estado do novo; URLs sem revogar
(remover, descartar, concluir, cartão) e revogação prematura; páginas que escondem itens ou recomeçam; Map obsoleto; boot e
logout sem reset; foco não restaurado, foco roubado do usuário. Uma mutação revelou um defeito do próprio teste
(a verificação de falhas do navegador estava antes dos últimos blocos), já corrigido. `stale_mutations.py` (C7.4)
continua com 21/21.

### Validação

`npm test` 294/294 e `TZ=UTC npm test` 294/294; `npm run test:browser` 21/21 e `TZ=UTC` 21/21; build e
`git diff --check` sem erro; `actionlint` do workflow sem erro. Nenhuma chamada AWS real.

### Riscos e limites

- O 409 faz uma leitura extra da primeira página da lista (até 50 itens). Se o item não estiver nela, o detalhe fecha
  e a pessoa volta à lista com o aviso do conflito.
- O texto do 409 vem do backend ("Recarregue e tente de novo"); a tela já foi atualizada quando ele aparece.
- Expiração de sessão (401) não reinicia o estado do Feedback: o login recarrega a página, que o limpa.
- Upload iniciado por A e concluído depois da troca para B: a revisão final achou que o laço de envio **continuava**
  (próximas imagens, envio ao S3 e conclusão do anexo) com a sessão de B. Corrigido: cada etapa confere o usuário
  e, trocado, nada mais sai (nem aviso, nem releitura de lista); as prévias de A são liberadas. Cobertos por 5 testes
  (formulário, cartão, slot já pronto, troca durante o S3) e 5 mutações.
- **Deploy do frontend pendente** e depende de aprovação própria. Nenhum commit, push, S3, CloudFront, Terraform ou Lambda.

## Regra original de execução (histórico)

Não juntar todos os pontos em um commit gigante. Quando este TODO for
retomado, dividir em subetapas pequenas conforme domínio e risco, com
validação específica de cada comportamento.

Não implementar nesta rodada documental.


## Consolidação — 21/10/2026

### Implementação, testes e implantação

O estado histórico da C7.5 foi revalidado, sem refazer sua implementação: 409 recarrega a primeira página sem transformar conflito em sucesso, preserva detalhe quando possível; falha em “Carregar mais” conserva itens/cursor e a nova tentativa não duplica; o Map não mantém cópia velha do rascunho aberto; mesma pessoa mantém rascunhos; troca de usuário/logout limpa dados próprios; uploads não continuam suas etapas com a sessão de outra pessoa; ObjectURLs são liberadas nos caminhos de término sem revogação prematura; o foco perdido é restaurado sem roubar foco escolhido.

A implantação anterior foi comprovada pelo [deploy 39543703472](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39543703472), manifesto da release ativa `9058941ffa4d-301af4d0e066` e leitura independente dos módulos publicados. Os arquivos de C7.5 coincidem byte a byte com a main `9058941`. Isso não comprova implantação das alterações feitas neste PR.

### Novas lacunas demonstradas e correções delimitadas

- **Importação:** `File.text()` antigo podia preencher arquivo/Map da pessoa seguinte, ou vencer uma seleção nova; erro de leitura antigo chegava fora de contexto. Prévia antiga de A (mesmo curso/nome/bytes) podia substituir a de B, e seu finally encerrava o loading atual. O reset também conservava confirmação/andamento de outro usuário. Agora seleção/conferência têm token local por curso, invalidado na troca de usuário/descarte; flags são isoladas somente ao trocar de pessoa. Rascunhos da mesma pessoa e a conclusão legítima para outra turma continuam cobertos.
- **Publicação versus nova seleção:** proteção adicional comprovada em teste defensivo: resposta antiga não apaga uma seleção mais nova. A interface normalmente bloqueia selecionar durante publicação; não se apresenta esse arranjo como defeito reproduzido pelo caminho normal.
- **Admin Feedback:** reset agora invalida também a geração da requisição; finally de A não redesenha o estado de B. Nenhuma nova política de paginação/status foi introduzida.
- **Anexos:** retomada de upload não altera busy/lista de outro usuário; galerias antigas não continuam consultas de URL nem redesenham a nova sessão. A invalidação da composição também cobre sair/voltar ao mesmo contexto; uploads legítimos da mesma pessoa não são cancelados pela navegação. Detalhes no [TODO 23](23-corridas-e-respostas-stale.md).

Regressões permanentes em `tests/feedback-lifecycle.mjs`, `tests/import-lifecycle-browser.mjs` e `tests/feedback-async-context.mjs`, com promises controladas e usuários fictícios. A caracterização antiga que preservava `acknowledgeRemoved/importLoading` entre pessoas foi substituída por asserções de isolamento, mantendo o teste de preservação para a mesma pessoa. Nenhuma asserção foi removida para obter CI verde.

**Pendência real:** comprovar a publicação das novas correções após o merge pelo CI/CD existente, comparando commit/release e módulos servidos; só então arquivar este item. Não há implantação de backend necessária nem autorização de deploy manual nesta missão. Não houve alteração de layout, textos do produto, autenticação, regras acadêmicas ou agendamentos.

Os resultados consolidados efetivamente executados nesta missão estão no [índice do backlog](README.md), separados dos números históricos acima.

# 29 · Mostrar a qualidade da sincronização por etapa

**Status:** implementado nesta branch; integração e implantação pendentes · **Área:** backend / instrutor

## Resultado da implementação

O relatório docente/admin recebe `canvasSyncDiagnostics`: resumo sanitizado de
catálogo, matrículas e notas a partir da última prova agendada do curso atual.
A Query é limitada e consistente; não lê todo o histórico nem chama o Canvas.
Provas novas guardam o courseId original; provas legadas só são atribuídas ao
curso atual quando a versão canônica dos metadados comprova o contexto.

O resumo preserva os horários registrados e distingue sucesso, falha, execução
sem conclusão e diagnóstico indisponível. Erro de leitura, página vazia com
continuação ou prova inconsistente não vira sucesso/ausência confirmada e não
derruba o relatório de notas. Aluno e admin em modo aluno não recebem o campo.
Não são expostos execução, versões internas ou texto de exceção; mensagens de
falha do resumo legado SYNC são sanitizadas apenas na resposta, sem reescrever
o registro histórico.

Painel e Publicações da turma mostram a informação na área de atualização já
existente. “Notas verificadas, sem mudanças” não substitui o resultado das
demais etapas. Backend anterior/registro antigo recebe uma indicação de
diagnóstico não disponível, sem mudar notas, observações de engajamento,
publicações ou elegibilidade dos lembretes automáticos.

Regressões: [backend](../../../backend/test_sync_diagnostics.py),
[DynamoDB Moto](../../../tests/integration/test_sync_diagnostics_aws.py),
[contratos de resposta](../../../tests/integration/test_report_schemas.py),
[Node](../../../tests/sync-diagnostics.mjs) e os testes de navegador do
[painel](../../../tests/teacher-home-browser.mjs) e
[histórico docente](../../../tests/teacher-publications-browser.mjs).
O cenário original de catálogo com falha/notas inalteradas foi reproduzido RED
na base e aprovado após a correção. Os testes usam dados fictícios.
Capturas: [desktop](../../evidence/todos-28-30/sincronizacao-desktop.png) e
[mobile](../../evidence/todos-28-30/sincronizacao-mobile.png).

OpenAPI foi atualizado nas fontes e regenerado pelo bundler existente. A
alteração aditiva muda o hash dos bytes do bundle; manifestos históricos e a
confirmação explícita de rollback por diferença de contrato permanecem intactos.

### Implantação ainda não executada

Este item exige atualizar o pacote compartilhado das Lambdas pelos
[procedimentos existentes](../../../infra/README.md#2-planejar-e-criar-a-infraestrutura-do-portal),
incluindo a API e `canvas-sync` que grava as provas. Não há recurso novo,
migração ou backfill. Preferir backend compatível antes do frontend. Se o
frontend chegar primeiro pelo merge, ele tolera a resposta anterior e informa
a limitação. O deploy automático da interface não implanta as Lambdas.

O PR e os testes não comprovam implantação. Não houve apply, invocação de sync,
envio de lembrete ou consulta a dados reais durante esta implementação.

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`. Reprodução local em
memória com `ScheduledSyncProofTests`, cliente Canvas controlado, dispatcher
real e renderização de `updateInfo()`. Não houve consulta ou incidente produtivo
comprovado.

**Cenário:** catálogo falha, matrícula funciona e as notas permanecem iguais.
O resultado da execução e o `SyncRun` são corretamente `failed`, com etapas
`catalog: failed`, `roster: succeeded`, `grades: unchanged`. Porém a API entrega
apenas `canvasSync.status: unchanged`; a tela mostra “Última verificação · sem
mudanças”, sem indicar a indisponibilidade do catálogo.

Referências:
- [canvas_sync.run](../../../backend/canvas_sync.py), linhas 54–60 e 84–95:
  preserva a falha de catálogo na prova da execução.
- [SyncRun.completion_write](../../../backend/sync_runs.py), linhas 98–105:
  diferencia as etapas e impede declarar sucesso completo.
- [Portal._report e sync_from_canvas](../../../backend/portal.py), linhas 1069,
  1136–1139 e 1154–1157: o resumo apresentado descreve as notas.
- [updateInfo](../../../frontend/ui.js), linhas 194–204, e
  [histórico](../../../frontend/pages/history.js): consomem esse resumo.

## Menor mudança recomendada

Reutilizar os registros já existentes para fornecer um resumo sanitizado por
etapa no relatório autorizado. Distinguir “notas verificadas, sem mudanças” de
“catálogo indisponível”, sem transformar falha auxiliar em falha das notas.
Apresentar a limitação na área de atualização existente, sem novo dashboard.

## Critérios de aceite

- [x] O cenário reproduzido mostra a falha parcial e a situação das notas
  separadamente; a última observação válida mantém sua idade original.
- [x] Recuperação posterior retira o aviso antigo, sem esconder falhas atuais.
- [x] Backend antigo/registro legado continuam legíveis e não são apresentados
  como prova de sucesso de todas as etapas.
- [x] Dados técnicos sanitizados somente para instrutor autorizado/admin;
  nenhum token, payload Canvas, dado de outro aluno ou mensagem sensível exposta.
- [x] API aditiva: fontes OpenAPI, bundle e testes de resposta atualizados.
- [x] Preservar as condições de `SyncRun` e dos lembretes automáticos já
  testadas em [test_canvas.py](../../../backend/test_canvas.py), inclusive falha de
  catálogo em curso compartilhado. Nenhuma nova chamada Canvas no carregamento.

## Limites e implantação

Exige frontend e implantação separada do backend, com compatibilidade entre
versões; sem infraestrutura nova. Não reabre o coletor AS-02/AS-03 nem o
[TODO 05](05-descoberta-de-turmas-por-vinculo.md): trata a informação
operacional mostrada, não migração, novas métricas ou regras acadêmicas.

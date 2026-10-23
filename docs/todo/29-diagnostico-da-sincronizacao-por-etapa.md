# 29 · Mostrar a qualidade da sincronização por etapa

**Status:** aberto · **Prioridade:** média · **Esforço:** médio · **Área:** backend / instrutor

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
- [canvas_sync.run](../../backend/canvas_sync.py), linhas 54–60 e 84–95:
  preserva a falha de catálogo na prova da execução.
- [SyncRun.completion_write](../../backend/sync_runs.py), linhas 98–105:
  diferencia as etapas e impede declarar sucesso completo.
- [Portal._report e sync_from_canvas](../../backend/portal.py), linhas 1069,
  1136–1139 e 1154–1157: o resumo apresentado descreve as notas.
- [updateInfo](../../frontend/ui.js), linhas 194–204, e
  [histórico](../../frontend/pages/history.js): consomem esse resumo.

## Menor mudança recomendada

Reutilizar os registros já existentes para fornecer um resumo sanitizado por
etapa no relatório autorizado. Distinguir “notas verificadas, sem mudanças” de
“catálogo indisponível”, sem transformar falha auxiliar em falha das notas.
Apresentar a limitação na área de atualização existente, sem novo dashboard.

## Critérios de aceite

- [ ] O cenário reproduzido mostra a falha parcial e a situação das notas
  separadamente; a última observação válida mantém sua idade original.
- [ ] Recuperação posterior retira o aviso antigo, sem esconder falhas atuais.
- [ ] Backend antigo/registro legado continuam legíveis e não são apresentados
  como prova de sucesso de todas as etapas.
- [ ] Dados técnicos sanitizados somente para instrutor autorizado/admin;
  nenhum token, payload Canvas, dado de outro aluno ou mensagem sensível exposta.
- [ ] API aditiva: fontes OpenAPI, bundle e testes de resposta atualizados.
- [ ] Preservar as condições de `SyncRun` e dos lembretes automáticos já
  testadas em [test_canvas.py](../../backend/test_canvas.py), inclusive falha de
  catálogo em curso compartilhado. Nenhuma nova chamada Canvas no carregamento.

## Limites e implantação

Exige frontend e implantação separada do backend, com compatibilidade entre
versões; sem infraestrutura nova. Não reabre o coletor AS-02/AS-03 nem o
[TODO 05](concluido/05-descoberta-de-turmas-por-vinculo.md): trata a informação
operacional mostrada, não migração, novas métricas ou regras acadêmicas.

# 27 · Alinhar os atalhos da situação da turma com a lista aberta

**Status:** aberto · **Prioridade:** média · **Esforço:** pequeno · **Área:** instrutor / frontend

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`. Reprodução Node local,
com relógio fixo e dois alunos fictícios críticos: um com última atividade
recente e outro anterior a sete dias. Sem chamadas ao Canvas ou à produção.

- [filterButton](../../frontend/pages/teacher.js), linhas 185–189, conta a
  população da turma para o status, independentemente da busca e do filtro Canvas.
- [filteredStudents](../../frontend/pages/teacher.js), linhas 148–166, aplica os
  filtros combinados à lista e à exportação.
- [Clique do atalho](../../frontend/app.js), linhas 1349–1358, altera somente o
  status e mantém os demais filtros.

**Resultado observado em Node:** cartão Crítico = **2** e lista = **1** com os
filtros Crítico e Canvas “7+ dias” ativos. Pela leitura do handler, clicar no
atalho preserva o filtro Canvas; esse clique não foi exercitado no navegador
neste levantamento. O comentário do cartão promete a mesma população ao
escolher o atalho; o teste existente em
[teacher-home.mjs](../../tests/teacher-home.mjs) não cobre essa combinação.

## Menor mudança recomendada

Tratar os cartões como atalhos para a população anunciada: selecionar o status
e limpar busca/filtro Canvas, atualizando os controles visíveis. A combinação
manual posterior continua permitida. Distinguir o clique no cartão dos demais
controles que também usam `data-filter`, para preservar os usos legítimos.

## Critérios de aceite

- [ ] Com busca e filtro Canvas previamente ativos, o atalho Crítico abre os
  dois alunos da reprodução e indica os filtros efetivamente selecionados.
- [ ] Os demais cartões também abrem a população que anunciam; desistentes
  mantêm as regras existentes de inclusão e ordenação.
- [ ] Combinações manuais continuam funcionando e o CSV exporta todos os
  resultados filtrados, com proteção contra fórmulas.
- [ ] Atualização localizada da tabela, foco, digitação, scroll e retorno do
  detalhe preservados, incluindo teclado e mobile.
- [ ] Regressões Node e navegador exercitam o clique real, além dos cálculos.

## Limites e implantação

Somente frontend; sem novos filtros, mudanças na classificação acadêmica ou
implantação backend. Não recalcular indicadores sobre uma página da tabela nem
refazer a otimização AS-07 ou o engajamento Canvas já entregues.

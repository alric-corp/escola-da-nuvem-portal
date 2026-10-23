# 27 · Alinhar os atalhos da situação da turma com a lista aberta

**Status:** ✅ implementação e testes locais concluídos; integração/publicação pendentes · **Prioridade original:** média · **Esforço:** pequeno · **Área:** instrutor / frontend

## Implementação — 23/10/2026

Os cartões recebem `data-teacher-shortcut`. Somente esse caminho limpa a busca
e seleciona “Todas as atividades” no filtro Canvas antes de atualizar a lista.
Controles, contagem de resultados e exportação são atualizados pelo render
localizado existente; filtros manuais continuam combináveis.

O teste de navegador demonstrou RED na busca que permanecia após o clique,
depois GREEN com busca vazia, Canvas em `all`, dois alunos críticos e CSV com
ambos. Reaplicar manualmente o filtro Canvas continua reduzindo a lista.

Os resultados consolidados e as capturas estão na
[validação conjunta do TODO 26](26-remover-foco-da-turma.md#validação-local--23102026).

## Evidência original — levantamento de 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`. Reprodução Node local,
com relógio fixo e dois alunos fictícios críticos: um com última atividade
recente e outro anterior a sete dias. Sem chamadas ao Canvas ou à produção.

- [filterButton](../../../frontend/pages/teacher.js), linhas 185–189 na revisão analisada, conta a
  população da turma para o status, independentemente da busca e do filtro Canvas.
- [filteredStudents](../../../frontend/pages/teacher.js), linhas 148–166 na revisão analisada, aplica os
  filtros combinados à lista e à exportação.
- [Clique do atalho](../../../frontend/app.js), linhas 1349–1358 na revisão analisada, alterava somente o
  status e mantém os demais filtros.

**Resultado observado em Node:** cartão Crítico = **2** e lista = **1** com os
filtros Crítico e Canvas “7+ dias” ativos. Pela leitura do handler, clicar no
atalho preserva o filtro Canvas; esse clique não foi exercitado no navegador
naquele levantamento. O comentário do cartão promete a mesma população ao
escolher o atalho; o teste existente em
[teacher-home.mjs](../../../tests/teacher-home.mjs) não cobria essa combinação.

## Menor mudança recomendada

Tratar os cartões como atalhos para a população anunciada: selecionar o status
e limpar busca/filtro Canvas, atualizando os controles visíveis. A combinação
manual posterior continua permitida. Distinguir o clique no cartão dos demais
controles que também usam `data-filter`, para preservar os usos legítimos.

## Critérios de aceite

- [x] Com busca e filtro Canvas previamente ativos, o atalho Crítico abre os
  dois alunos da reprodução e indica os filtros efetivamente selecionados.
- [x] Os demais cartões também abrem a população que anunciam; desistentes
  mantêm as regras existentes de inclusão e ordenação.
- [x] Combinações manuais continuam funcionando e o CSV exporta todos os
  resultados filtrados, com proteção contra fórmulas.
- [x] Atualização localizada da tabela, foco, digitação, scroll e retorno do
  detalhe preservados, incluindo teclado e mobile.
- [x] Regressões Node e navegador exercitam o clique real, além dos cálculos.
- [ ] Integração e publicação da nova interface — pendentes deste PR.

## Limites e implantação

Somente frontend; sem novos filtros, mudanças na classificação acadêmica ou
implantação backend. Não recalcular indicadores sobre uma página da tabela nem
refazer a otimização AS-07 ou o engajamento Canvas já entregues.

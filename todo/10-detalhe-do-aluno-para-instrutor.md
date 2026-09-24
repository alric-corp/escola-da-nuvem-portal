# 10 · Detalhe completo do aluno para o instrutor

**Prioridade:** baixa · **Esforço:** pequeno · **Área:** instrutor

## Problema
**Ver detalhes** (`pendingPage`) mostra apenas as atividades sem nota. O instrutor não vê as atividades em revisão, as notas, o histórico nem os módulos do aluno, justamente o que é útil numa conversa de acompanhamento.

## Proposta
Reaproveitar `activitiesPage` e `activityGroups` em modo somente leitura na tela do aluno, com o bloco de lembrete abaixo. O backend já tem os dados em `summary()`; basta ampliar a resposta de `pending-preview` ou criar uma rota `student-report`.

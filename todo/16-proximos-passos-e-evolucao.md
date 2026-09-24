# 16 · Priorizar atividades recentes e melhorar o gráfico de evolução

**Prioridade:** baixa · **Esforço:** pequeno · **Área:** aluno

## Problema
- Sem foco definido, `nextActivities` mostra primeiro as pendências pela ordem da publicação, que podem ser de semanas atrás.
- **Seu aprendizado evolui** mostra só a média total das últimas 8 publicações.

## Proposta
- Ordenar as sugestões priorizando atividades liberadas mais recentemente (o backend já calcula `activitiesReleased` por publicação; basta expor a data de liberação).
- Gráfico com KC e LAB separados e linhas de referência em 70% e 95%.

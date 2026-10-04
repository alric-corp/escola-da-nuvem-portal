# 16 · Priorizar atividades recentes e melhorar o gráfico de evolução

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída · **Prioridade:** baixa · **Esforço:** pequeno · **Área:** aluno

## Problema
- Sem foco definido, `nextActivities` mostra primeiro as pendências pela ordem da publicação, que podem ser de semanas atrás.
- **Seu aprendizado evolui** mostra só a média total das últimas 8 publicações.

## Proposta
- Ordenar as sugestões priorizando atividades liberadas mais recentemente (o backend já calcula `activitiesReleased` por publicação; basta expor a data de liberação).
- Gráfico com KC e LAB separados e linhas de referência em 70% e 95%.

## O que foi feito
- **Data de liberação**: cada publicação grava `releasedAt` (`{atividade: data}`). Atividade que já estava liberada herda a data da publicação anterior; sem esse mapa (publicação antiga), usa a data daquela publicação; atividade nova recebe a data de agora. O relatório anota `releasedAt` em cada atividade liberada. A lista de publicações do instrutor não carrega esse mapa, para não inchar a resposta.
- **Por onde começar** (sem foco do instrutor): pendências da liberada mais recente para a mais antiga, depois revisões na mesma ordem. Sem data, mantém a ordem da publicação (`nextActivities` em `frontend/student-journey.js`).
- **Seu aprendizado evolui**: gráfico de linhas em SVG com KC e LAB separados e linhas tracejadas nas referências da turma (limites configuráveis, TODO 12), com legenda.
- Testes: `backend/test_portal.py` (data mantida entre publicações e fallback para publicação antiga), `tests/student-journey.mjs` (ordem por recência) e `tests/instructor-tools-browser.mjs` (ordem e gráfico).

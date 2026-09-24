# 10 · Detalhe completo do aluno para o instrutor

**Status:** ✅ concluída · **Prioridade:** baixa · **Esforço:** pequeno · **Área:** instrutor

## Problema
**Ver detalhes** (`pendingPage`) mostra apenas as atividades sem nota. O instrutor não vê as atividades em revisão, as notas, o histórico nem os módulos do aluno, justamente o que é útil numa conversa de acompanhamento.

## Proposta
Reaproveitar `activitiesPage` e `activityGroups` em modo somente leitura na tela do aluno, com o bloco de lembrete abaixo. O backend já tem os dados em `summary()`; basta ampliar a resposta de `pending-preview` ou criar uma rota `student-report`.

## O que foi feito
- `POST /cohorts/{code}/pending-preview` passou a devolver também `summary` (médias, % com nota, situação), `allActivities` (todas as atividades com nota/estado/revisão), `history` (últimas 12 publicações do aluno, pelo mesmo cálculo do relatório do aluno, agora em `Portal.student_history`), `thresholds` e `canvasCourseId`. `activities` continua só com as pendências, como a prévia do lembrete espera.
- "Ver detalhes" (`pendingPage` em `frontend/pages/reminders.js`) mostra, abaixo das pendências e do lembrete: cartões de médias e situação, **Todas as atividades** agrupadas por módulo (com notas, sugestões de revisão e links do Canvas) e **Histórico do aluno**.
- Testes: `backend/test_reminders.py` (`test_preview_includes_full_student_detail_for_instructor`) e `tests/instructor-tools-browser.mjs`.

# 12 · Configuração da turma no backend (curso Canvas, limites, módulos)

**Status:** 🟨 parte 1 concluída e aplicada em produção em 2026-09-24 (limites e curso Canvas; apply: 1 rota criada, 3 lambdas atualizadas, 0 destruídos); parte 2 (catálogo e módulos) pendente · **Prioridade:** média · **Esforço:** médio · **Área:** backend / frontend

## Problema
- O mapeamento turma → curso Canvas (`cohortCanvasCourses`), os catálogos de links e a lista de módulos estão fixos em `frontend/canvas-links.js` e `frontend/student-journey.js`. Cada turma nova exige mudar o código e publicar de novo; sem isso, todas as atividades caem em "Outras atividades".
- Os limites 70% e 95% estavam repetidos no backend, no frontend e nos textos.

## Decisão de escopo (2026-09-24)
O titular optou por dividir a tarefa em duas partes. Esta sessão fez só a **parte 1**.

## Parte 1 — feita
### Backend
- `COHORT#<code>/METADATA` aceita `thresholds: {kc, lab}` e `canvasCourseId`. Sem configuração, vale 70/95 e nenhum curso (`cohort_thresholds()` em `portal.py`).
- `grades.summary()` e `grades.overview()` recebem os limites em vez de usar 70/95 fixos; `changes.student_history()`/`student_changes()` repassam. Todos os pontos que calculam situação (`_report`, `class_report`, `_preview`, `_publish`, lembretes) usam os limites da turma.
- Os relatórios (`/report`, `/class-report`) devolvem `thresholds` (e `/report` também `canvasCourseId`), para o frontend exibir os números reais.
- Nova rota `POST /cohorts/{code}/settings` (só admin): `{thresholds: {kc, lab}, canvasCourseId}`, com validação (1–100; ID numérico ou `null`), em transação e com registro `AUDIT#`.
- Publicações antigas guardam o resumo compacto (todo/06) calculado com os limites da época; mudar os limites vale para cálculos novos, não reescreve o histórico.

### Frontend
- Os textos de referência (cartões de média, "Como interpretar minhas notas?", critério de revisão, legendas do painel do instrutor e da consulta da turma) e o rótulo "Foque nos KCs/LABs" usam os limites devolvidos pela API; 70/95 fica só como valor padrão se a resposta não trouxer o campo.
- Links do Canvas e agrupamento por módulo usam `canvasCourseId` da turma quando configurado; `cohortCanvasCourses` fica como compatibilidade para turmas ainda não configuradas.
- "Turmas e acessos" ganhou "Configurações da <turma>": limites de KC/LAB e ID do curso Canvas.

### Testes
- `backend/test_portal.py`: 2 testes novos (configurar muda a situação calculada, aparece nos relatórios de instrutor e aluno e grava auditoria; só admin e com validação). Suíte: 95 unitários + 14 de integração.
- `tests/admin-access-browser.mjs`: cobre o formulário de configurações. Node 16 + navegador 8, todos passando. `terraform fmt/validate/test` passando.

## Limitação importante
Configurar `canvasCourseId` só gera links e módulos se o catálogo desse curso existir em `frontend/canvas-links.js`, que hoje tem só 4436 e 4413. **Uma turma de um curso novo ainda exige deploy** até a parte 2.

## Parte 2 — pendente
- Catálogo e módulos por curso: `CATALOG#<courseId>` no DynamoDB ou JSON no S3, com forma do admin cadastrar/atualizar.
- O backend passa a enviar `module` e `canvasUrl` em cada atividade, e o frontend só exibe.

## Critérios de aceite
- [ ] Criar uma turma nova com módulos e links não exige deploy — depende da parte 2.
- [x] Os limites vêm de um único lugar (metadados da turma, calculados no backend).

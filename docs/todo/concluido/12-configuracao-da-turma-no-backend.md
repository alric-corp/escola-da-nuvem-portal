# 12 · Configuração da turma no backend (curso Canvas, limites, módulos)

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ parte 1 aplicada em 2026-09-24 (limites e curso Canvas); parte 2 (catálogo e módulos pela API do Canvas) feita em 2026-09-25 · **Prioridade:** média · **Esforço:** médio · **Área:** backend / frontend

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
- Publicações antigas guardam o resumo compacto (TODO 06) calculado com os limites da época; mudar os limites vale para cálculos novos, não reescreve o histórico.

### Frontend
- Os textos de referência (cartões de média, "Como interpretar minhas notas?", critério de revisão, legendas do painel do instrutor e da consulta da turma) e o rótulo "Foque nos KCs/LABs" usam os limites devolvidos pela API; 70/95 fica só como valor padrão se a resposta não trouxer o campo.
- Links do Canvas e agrupamento por módulo usam `canvasCourseId` da turma quando configurado; `cohortCanvasCourses` fica como compatibilidade para turmas ainda não configuradas.
- "Turmas e acessos" ganhou "Configurações da <turma>": limites de KC/LAB e ID do curso Canvas.

### Testes
- `backend/test_portal.py`: 2 testes novos (configurar muda a situação calculada, aparece nos relatórios de instrutor e aluno e grava auditoria; só admin e com validação). Suíte: 95 unitários + 14 de integração.
- `tests/admin-access-browser.mjs`: cobre o formulário de configurações. Node 16 + navegador 8, todos passando. `terraform fmt/validate/test` passando.

## Parte 2 — feita (2026-09-25)
Em vez de cadastro manual, o catálogo vem da própria API do Canvas, com o mesmo token da [17](17-integracao-api-canvas.md).

### Backend
- `canvas.course_catalog()` lê `/courses/<id>/modules?include[]=items` e monta `{modules: [nomes na ordem do curso], items: {<ID da tarefa>: {module, url}}}`. A associação é pelo **ID da tarefa**, o mesmo número entre parênteses na coluna do CSV, e não pelo título. Ficam de fora: módulos e itens não publicados, itens que não são tarefa e links que não sejam item de módulo do próprio curso. Tarefa repetida vale na primeira ocorrência.
- A Lambda `canvas-sync` (6h e 18h) atualiza `CATALOG#<courseId>/METADATA` para **toda turma com `canvasCourseId`**, mesmo com `autoSync` desligado. Só regrava se algo mudou. Falha ao ler o catálogo entra no alarme, mas não impede a atualização das notas.
- `/report` (aluno e instrutor) e `pending-preview` anotam `module`, `moduleOrder` e `canvasUrl` em cada atividade (`portal.with_catalog`). Com catálogo, toda atividade recebe `module`; tarefa fora de módulo (Roll Call, Graduated) recebe `null`.

### Frontend
- `activityModule`, `groupActivities` e `canvasActivityLink` usam os campos do backend quando existem, com a ordem dos módulos do curso. Sem catálogo, continuam usando `canvas-links.js` e `student-journey.js` como antes.
- O link do catálogo só é aceito se for `https://awsrestart.instructure.com/courses/<n>/modules/items/<n>`.
- As configurações da turma avisam que módulos e links aparecem após a próxima atualização.

### Comparação com produção (somente leitura, 2026-09-25)
| Turma | Atividades | Links iguais aos atuais | "Outras atividades" antes → depois |
| --- | --- | --- | --- |
| BRSA0267 | 166 | 166 | 0 → 0 |
| BRSA0257 | 75 | 75 | 0 → 0 |

Os agrupamentos são os mesmos; só alguns nomes de módulo passam a ser exatamente os do Canvas:
- "Bases de dados" → "Bases";
- "Preparação para certificação" → "Preparação para exames";
- "Inteligência artificial" → "Habilidades avançadas da AWS: Inteligência Artificial PT";
- "Ferramentas e automação" → "Ferramentas e Automação";
- "Monitoramento e segurança" → "Monitoramento e Segurança".

### Testes
- `backend/test_canvas.py`:
  - catálogo (filtros, ordem, nomes, repetição);
  - relatório de aluno e instrutor com e sem catálogo;
  - `save_catalog` não regrava sem mudança;
  - catálogo atualizado para turma sem `autoSync`.
- `tests/student-journey.mjs` e `tests/canvas-links.mjs`: módulo, ordem e link vindos do backend, com recusa de link forjado.
- `tests/canvas-links-browser.mjs`: turma de curso fora da lista fixa mostra módulos e links do catálogo.

## Critérios de aceite
- [x] Criar uma turma nova com módulos e links não exige deploy: basta o ID do curso em Configurações.
- [x] Os limites vêm de um único lugar (metadados da turma, calculados no backend).

## Listas fixas removidas (2026-09-25)
As duas turmas já tinham catálogo, e a comparação mostrou os mesmos 241 links. Por isso as listas fixas saíram de `canvas-links.js` e `student-journey.js` (−365 linhas):
- `cohortCanvasCourses`;
- os catálogos de 170 e 75 itens;
- a tabela de módulos por número.

O frontend agora só exibe o que o backend anota. Sem catálogo, nada é deduzido pelo título: as atividades ficam em "Outras atividades" e sem link. O filtro de módulo da visão por atividade passou a seguir a ordem do curso.

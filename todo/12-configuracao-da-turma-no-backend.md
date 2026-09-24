# 12 · Configuração da turma no backend (curso Canvas, limites, módulos)

**Prioridade:** média · **Esforço:** médio · **Área:** backend / frontend

## Problema
- O mapeamento turma → curso Canvas (`cohortCanvasCourses`), os catálogos de links e a lista de módulos estão fixos em `frontend/canvas-links.js` e `frontend/student-journey.js`. Cada turma nova exige mudar o código e publicar de novo; sem isso, todas as atividades caem em "Outras atividades".
- Os limites 70% e 95% estão repetidos no backend, no frontend e nos textos.

## Proposta
- Guardar `canvasCourseId` e `thresholds: {kc: 70, lab: 95}` em `COHORT#<code>/METADATA`, editáveis pelo admin.
- Catálogo e módulos por curso: `CATALOG#<courseId>` no DynamoDB ou JSON no S3, servido pela API junto com o relatório.
- O backend passa a enviar `module` e `canvasUrl` em cada atividade, e o frontend só exibe.

## Critérios de aceite
- [ ] Criar uma turma nova com módulos e links não exige deploy.
- [ ] Os limites vêm de um único lugar.

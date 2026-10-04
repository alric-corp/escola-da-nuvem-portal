# 02 · Validar e ativar os links para o Canvas

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída · **Prioridade:** alta · **Esforço:** pequeno · **Área:** aluno

## Problema
O aluno vê "Sem nota" e "Por onde começar", mas não tinha como chegar à atividade. Os catálogos (BRSA0267 → 4436, BRSA0257 → 4413) estavam completos em `frontend/canvas-links.js`, mas `canvasLinksEnabled = false` (`frontend/ui.js`).

## O que foi feito
- `frontend/ui.js`: `canvasLinksEnabled` mudou para `true`. Passa a valer para as duas turmas associadas (`cohortCanvasCourses`): BRSA0267 → 4436 e BRSA0257 → 4413.
- `frontend/README.md` e `docs/jornada-aluno.md` atualizados para refletir o recurso ativo.
- Testes automatizados rodados e ajustados:
  - `node --test tests/canvas-links.mjs` — 13 testes, todos passando (não dependiam da flag).
  - `tests/canvas-links-browser.mjs` (Playwright) — passou sem alterações.
  - `tests/journey-browser.mjs` e `tests/student-journey-browser.mjs` continham asserções que **esperavam 0 links** (comportamento antigo). Foram corrigidas para o número real de atividades com correspondência no catálogo (1 e 3, respectivamente).
  - Suíte Python (`backend`, 78 testes) não é afetada por esta mudança (é só frontend).

## Validação real feita em 2026-09-24
Usando uma conta de instrutor logada no Canvas (via extensão Claude for Chrome), com a API do Canvas (`/api/v1/courses/:id/modules?include[]=items`):
- **Curso 4436 (BRSAO267):** os 170 IDs de item de módulo do catálogo existem no curso e os títulos batem (só diferenças de espaço, já ignoradas pelo normalizador `titleKey`). Nenhuma colisão de título+tipo (KC/Lab) que pudesse quebrar `canvasActivityEntry`.
- **Curso 4413 (BRSAO257):** os 75 IDs do catálogo existem e conferem da mesma forma.
- Cursos confirmados pelo `course_code` retornado pela API: 4436 = BRSAO267, 4413 = BRSAO257. A diferença entre a letra "O" (Canvas) e o dígito "0" (código do portal) é intencional e já documentada em `frontend/README.md`.
- **Permissão de acesso:** usando "Ver como aluno" do Canvas (aluno de teste), abertos com sucesso 1 KC + 1 Lab em cada curso (4 amostras no total) — todos carregaram normalmente, sem "Acesso Negado".

### Ressalva
"Ver como aluno" é um bom proxy, mas usa um aluno de teste do Canvas, não uma conta de aluno real matriculada — não cobre eventuais bloqueios por pré-requisito específicos de um aluno real. Como a checagem por API já confirma 100% de correspondência de IDs/títulos nos dois cursos, e a amostra de permissão não indicou nenhum problema, o risco residual é baixo.

## Relacionado
[12](12-configuracao-da-turma-no-backend.md): tirar o mapeamento turma → curso do código.

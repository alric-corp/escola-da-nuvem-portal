# 02 · Validar e ativar os links para o Canvas

**Status:** 🟨 ativado sem validação real · **Prioridade:** alta · **Esforço:** pequeno (código pronto) · **Área:** aluno

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

## ⚠️ Passo que ficou pendente
**Não foi feita a validação com conta real de aluno em cada curso**, recomendada no [handoff anterior](../CONTEXTO-HANDOFF-2026-09-24.md#cuidados-para-a-próxima-ia): abrir 3–5 links de KC e LAB com uma conta real e confirmar que o destino e a permissão estão corretos nos cursos **4436** e **4413**. Essa decisão foi tomada explicitamente pelo responsável do projeto, ciente do risco.

## Próximos passos recomendados
- [ ] Abrir alguns links reais (KC e LAB) nas duas turmas com uma conta de aluno e confirmar destino e permissão.
- [ ] Se algum link estiver incorreto, corrigir a entrada correspondente em `frontend/canvas-links.js` e publicar de novo com `scripts/deploy_frontend.sh`.
- [ ] Se tudo estiver certo, remover este aviso e marcar a tarefa como ✅.

## Relacionado
[12](12-configuracao-da-turma-no-backend.md): tirar o mapeamento turma → curso do código.

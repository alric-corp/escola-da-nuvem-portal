# 02 · Validar e ativar os links para o Canvas

**Prioridade:** alta · **Esforço:** pequeno (código pronto) · **Área:** aluno

## Problema
O aluno vê "Sem nota" e "Por onde começar", mas não tem como chegar à atividade. Os catálogos (BRSA0267 → 4436, BRSA0257 → 4413) estão completos em `frontend/canvas-links.js`, porém `canvasLinksEnabled = false` (`frontend/ui.js`).

## Passos
- [ ] Com uma conta real de aluno de cada curso, abrir 3–5 links (KC e LAB) e confirmar permissão e destino.
- [ ] Conferir com o titular se os links podem ser retomados.
- [ ] Mudar `canvasLinksEnabled` para `true`, rodar `tests/canvas-links*.mjs` e publicar com `scripts/deploy_frontend.sh`.

## Relacionado
[12](12-configuracao-da-turma-no-backend.md): tirar o mapeamento turma → curso do código.

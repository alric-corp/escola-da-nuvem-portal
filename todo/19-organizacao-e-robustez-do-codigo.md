# 19 · Organização do repositório e robustez do frontend

**Status:** ✅ concluída · **Prioridade:** baixa · **Esforço:** pequeno a médio · **Área:** manutenção

## Itens
- [x] Mover a ferramenta antiga (`app.js`, `index.html`, `style.css`, `logo.png` da raiz) para `legacy/`.
- [x] Mover `55_atividades_links_encontrados_curso_4436.md`, `links-canvas-pendentes.md` e `CONTEXTO-HANDOFF-*.md` para `docs/`.
- [x] `frontend/app.js`: trocar a cadeia de `if (action === …)` por um mapa `actions[action]`.
- [x] `api()` em `frontend/app.js`: checar `res.ok` e o `Content-Type` antes de `res.json()`, para que 502/504 do gateway mostrem uma mensagem amigável.
- [x] Busca do instrutor (`teacher.js`) e da tela "Notas da turma" sem distinção de acentos, com um helper `normalize` único em `ui.js`.
- [x] Decidir o futuro da tela `?turma=` (`class-report.js`), que duplica o painel do instrutor. Se for removida, apagar também a rota `class-report`.

## O que foi feito
- Ferramenta antiga movida para `legacy/` (com o README original, que credita os autores). A raiz ganhou um `README.md` curto sobre o portal atual.
- `55_atividades_links_encontrados_curso_4436.md`, `links-canvas-pendentes.md` e `CONTEXTO-HANDOFF-2026-09-24.md` movidos para `docs/`, com os links corrigidos (conferido: nenhum link relativo quebrado nos `.md`).
- `frontend/app.js`: a cadeia de `if (action === …)` virou o mapa `actions`; logout e troca de conta compartilham `signOut()`.
- `api()`: só lê o corpo como JSON quando o `Content-Type` é JSON; 502/503/504 sem mensagem da API mostram "O portal está temporariamente indisponível…".
- `normalize()` único em `frontend/ui.js`, usado nas buscas do painel do instrutor, da tela "Notas da turma" e das atividades do aluno (sem distinção de acentos e maiúsculas).
- Tela `?turma=` (`class-report.js`): **mantida**, por decisão do titular.

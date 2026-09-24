# 19 · Organização do repositório e robustez do frontend

**Prioridade:** baixa · **Esforço:** pequeno a médio · **Área:** manutenção

## Itens
- [ ] Mover a ferramenta antiga (`app.js`, `index.html`, `style.css`, `logo.png` da raiz) para `legacy/`.
- [ ] Mover `55_atividades_links_encontrados_curso_4436.md`, `links-canvas-pendentes.md` e `CONTEXTO-HANDOFF-*.md` para `docs/`.
- [ ] `frontend/app.js`: trocar a cadeia de `if (action === …)` por um mapa `actions[action]`.
- [ ] `api()` em `frontend/app.js`: checar `res.ok` e o `Content-Type` antes de `res.json()`, para que 502/504 do gateway mostrem uma mensagem amigável.
- [ ] Busca do instrutor (`teacher.js`) e da tela "Notas da turma" sem distinção de acentos, com um helper `normalize` único em `ui.js`.
- [ ] Decidir o futuro da tela `?turma=` (`class-report.js`), que duplica o painel do instrutor. Se for removida, apagar também a rota `class-report`.

# 21 · Sessão caindo rápido após o login

**Status:** ✅ concluída · **Prioridade:** alta · **Esforço:** pequeno · **Área:** aluno / frontend

## Problema
Relatado pelo titular: a sessão caía rápido depois do login. Causa: `frontend/auth.js` guardava os tokens (access/refresh) em `sessionStorage`, que é apagado ao fechar a aba ou o navegador — mesmo com o refresh token da Cognito valendo 7 dias, fechar a aba já derrubava a sessão.

## O que foi feito
- `frontend/auth.js`: `sessionStorage` → `localStorage` para a sessão (`avanca.session`) e o estado do fluxo OAuth (`avanca.oauth`). A sessão agora sobrevive a fechar a aba/navegador, até o refresh token expirar (7 dias) ou o instrutor sair explicitamente (logout continua limpando tudo).
- `frontend/app.js`: mesma troca para `avanca.context` (turma/tela/filtros lembrados) e `avanca.pending-cohort` (link de convite pendente) — evita a inconsistência de a sessão sobreviver a reabrir o navegador mas a turma/tela selecionada não.
- Nenhuma mudança no backend ou na infraestrutura: o "banco" que guarda a sessão já é local ao navegador; o ajuste foi só de onde guardar (`localStorage` em vez de `sessionStorage`), não de criar um armazenamento novo.
- Documentação atualizada (`docs/jornada-aluno.md`, `docs/arquitetura.md`, `frontend/README.md`, `infra/README.md`) para refletir `localStorage`; aproveitado para corrigir uma menção desatualizada ao fluxo de `/oauth2/userInfo` em `infra/README.md` (obsoleta desde o todo/04).

## Testes
- `tests/auth-refresh.mjs`: mock global `localStorage` (era `sessionStorage`); os 5 testes de renovação continuam passando sem mudança de lógica.
- Testes de navegador (`tests/*-browser.mjs`): seeds de sessão trocados para `localStorage.setItem(...)`.
- `npm test` (16) e `npm run test:browser` (8, 24 no total): todos passando.

## Nota
Guardar tokens em `localStorage` em vez de `sessionStorage` amplia um pouco a janela de exposição em caso de XSS (o token persiste mais tempo se roubado), mas é uma troca padrão em SPAs e o app já guardava tokens em texto simples no navegador antes desta mudança — o risco marginal é pequeno frente ao ganho de não precisar logar de novo a cada fechamento de aba.

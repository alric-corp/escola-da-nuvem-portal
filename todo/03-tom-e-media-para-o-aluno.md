# 03 · Tom da situação e explicação da média para o aluno

**Status:** ✅ concluída · **Prioridade:** alta · **Esforço:** pequeno · **Área:** aluno / frontend

## Problema
- O aluno via o selo "Crítico" (`badge(s.status)` em `frontend/pages/student.js`), que destoava do tom acolhedor do resto do portal.
- Atividade liberada sem nota conta como 0%. Logo depois de uma liberação, a média cai sem que o aluno tenha feito nada errado. A explicação só aparecia no bloco recolhido "Como interpretar minhas notas?".

## O que foi feito
- `frontend/ui.js`: nova função `studentStatusLabel(s)` e badge dedicado `studentBadge(s)`. Para `status` `attention`/`critical`, o rótulo passa a ser "Foque nos KCs", "Foque nos LABs" ou "Foque em KCs e LABs", calculado a partir de `s.kc < 70` e `s.lab < 95`. A cor/urgência do badge continua vindo da mesma classe CSS (`attention`/`critical`); só o texto muda. Os demais status (`ok`, `graduated`, `insufficient`) mantêm os rótulos existentes.
- `frontend/pages/student.js`: troca `badge(s.status)` por `studentBadge(s)`. As telas do instrutor (`class-report.js`, `import.js`, `teacher.js`) continuam usando `badge(s.status)` sem alteração — lá "Crítico" e "Atenção" seguem aparecendo normalmente.
- Nos cartões de média (`Média em KCs` / `Média em Labs`), a legenda agora soma quantas atividades daquele tipo estão sem nota quando houver alguma, por exemplo "Referência: 70% ou mais · 2 sem nota conta(m) como 0%".

## Critérios de aceite
- [x] Nenhuma tela do aluno mostra "Crítico" (só `studentBadge`, com os novos rótulos).
- [x] O cartão de média deixa claro o impacto das atividades sem nota (contagem por tipo na legenda).
- [ ] `tests/student-journey*.mjs` atualizados — o teste unitário (`tests/student-journey.mjs`) já passa sem alteração; o teste de navegador (`tests/student-journey-browser.mjs`) não pôde ser executado nesta sessão porque o Playwright não está instalado no ambiente. Ele também não faz asserção sobre o texto do badge, então não deveria quebrar, mas recomenda-se rodá-lo antes do deploy (`node --test tests/student-journey-browser.mjs`).

# 03 · Tom da situação e explicação da média para o aluno

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Evolução posterior:** a tela atual usa `goalIndicator` e as referências
da turma, em vez dos helpers studentBadge/studentStatusLabel citados no
relato original. Mantém o tom de progresso e o aviso de notas ausentes como
zero; o resumo do aluno não apresenta o selo “Crítico”.

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
- [x] Suítes Node e browser, incluindo `tests/student-journey*.mjs`, executadas e aprovadas na API-2, padrão e UTC (ver [base de validação](README.md#base-de-validação)). O impedimento histórico de Playwright indisponível foi superado; não se afirma cobertura dedicada de todas as frases da interface.

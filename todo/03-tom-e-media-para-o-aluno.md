# 03 · Tom da situação e explicação da média para o aluno

**Prioridade:** alta · **Esforço:** pequeno · **Área:** aluno / frontend

## Problema
- O aluno vê o selo "Crítico" (`badge(s.status)` em `frontend/pages/student.js`), que destoa do tom acolhedor do resto do portal.
- Atividade liberada sem nota conta como 0%. Logo depois de uma liberação, a média cai sem que o aluno tenha feito nada errado. A explicação só aparece no bloco recolhido "Como interpretar minhas notas?".

## Proposta
- Criar rótulos próprios para o aluno (por exemplo "Foque nos LABs", "Foque nos KCs", "Foque em KCs e LABs"), mantendo "Crítico" e "Atenção" só na visão do instrutor.
- Nos cartões de média, mostrar também a "média das atividades com nota", ou uma linha "N atividades sem nota contando como 0%".

## Critérios de aceite
- [ ] Nenhuma tela do aluno mostra "Crítico".
- [ ] O cartão de média deixa claro o impacto das atividades sem nota.
- [ ] `tests/student-journey*.mjs` atualizados.

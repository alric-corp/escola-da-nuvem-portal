# 15 · Avisar o aluno quando houver notas novas

**Status:** ⏸️ aguardando decisão da coordenação (2026-09-24) · **Prioridade:** baixa · **Esforço:** médio · **Área:** aluno

> Conferido em 04/10/2026: `Portal._publish` em [backend/portal.py](../../backend/portal.py) não dispara e-mail. A opção de aviso, preferências e envio propostos abaixo não estão implementados. Nenhuma decisão nova da coordenação foi presumida.

## Problema
O aluno só descobre uma publicação nova se entrar no portal.

## Proposta
- Opção por turma, ligada pelo instrutor no momento de publicar: "Avisar alunos vinculados".
- E-mail curto, sem notas no corpo, só com o link para o portal, enviado pelo remetente noreply do portal.
- Enviado apenas a alunos com vínculo `STUDY#` (conta confirmada), com opção de desinscrição (`USER#<sub>/PREFS`).

## Atenção
Hoje "publicar nunca envia e-mail" é uma garantia documentada. Mudar isso exige decisão da coordenação e atualização da documentação.

## Decisão
Adiada pelo titular: a garantia documentada "publicar nunca envia e-mail" continua valendo até a coordenação decidir mudar isso.

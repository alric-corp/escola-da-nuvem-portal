# 15 · Avisar o aluno quando houver notas novas

**Status:** ⏸️ despriorizado — fora do planejamento atual · **Prioridade original:** baixa · **Esforço original:** médio · **Área:** aluno

## Decisão atual — 23/10/2026

Por decisão do titular, a proposta fica preservada para possível reavaliação,
sem implementação ou prazo de retomada. Não integra o backlog ativo nem os
TODOs concluídos. O ID 15 e o conteúdo original são mantidos.

Publicar notas continua não enviando e-mail. Os lembretes existentes não foram
alterados; a proposta abaixo não descreve uma funcionalidade disponível.

> Conferido em 04/10/2026: `Portal._publish` em [backend/portal.py](../../../backend/portal.py) não dispara e-mail. A opção de aviso, preferências e envio propostos abaixo não estão implementados. Nenhuma decisão nova da coordenação foi presumida naquela revisão.

## Problema
O aluno só descobre uma publicação nova se entrar no portal.

## Proposta
- Opção por turma, ligada pelo instrutor no momento de publicar: "Avisar alunos vinculados".
- E-mail curto, sem notas no corpo, só com o link para o portal, enviado pelo remetente noreply do portal.
- Enviado apenas a alunos com vínculo `STUDY#` (conta confirmada), com opção de desinscrição (`USER#<sub>/PREFS`).

## Atenção
Hoje "publicar nunca envia e-mail" é uma garantia documentada. Mudar isso exige decisão da coordenação e atualização da documentação.

## Decisão anterior
Adiada pelo titular: a garantia documentada "publicar nunca envia e-mail" continua valendo até a coordenação decidir mudar isso.

# 06 · Relatório do aluno sem reler dezenas de snapshots

**Prioridade:** média · **Esforço:** médio · **Área:** backend

## Problema
`Portal._report` (aluno) lê até 12 publicações e a base de cada uma, podendo chegar a cerca de 24 snapshots completos do S3 em cada carregamento, para montar o histórico pessoal.

## Proposta
Ao publicar ou restaurar, calcular e gravar o resumo por aluno (médias e `student_changes`) em `COHORT#<code>/HIST#<canvasId>#<pubId>`, ou num único objeto S3 por publicação indexado por aluno. `_report` passa a ler só esses resumos.

## Critérios de aceite
- [ ] O relatório do aluno lê no máximo 1 snapshot, o atual.
- [ ] Publicações antigas sem resumo continuam funcionando (cálculo sob demanda como fallback).
- [ ] Resultado igual ao atual (teste comparando as duas implementações).

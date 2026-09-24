# 05 · Descobrir as turmas do aluno pelo vínculo, sem scan

**Prioridade:** média · **Esforço:** médio · **Área:** backend

## Problema
`GET /cohorts` faz um *scan* de todas as turmas e, para quem não é instrutor, lê do S3 o snapshot atual de cada uma para procurar o aluno. O custo cresce com o número de turmas e o tamanho dos snapshots, a cada login.

## Proposta
1. Consultar `USER#<sub>` com prefixo `STUDY#`. As turmas encontradas são as do aluno.
2. Só quando não houver nenhum vínculo, procurar por e-mail. Opcionalmente, manter um índice `EMAIL#<email> → [turma, canvasId]` gravado no momento da publicação.
3. Para o instrutor, consultar `USER#<sub>/TEACH#` em vez de chamar `can_teach` para cada turma.

## Critérios de aceite
- [ ] Um aluno já vinculado não provoca nenhuma leitura de snapshot em `/cohorts`.
- [ ] O primeiro acesso continua localizando a turma pelo e-mail.
- [ ] Testes de integração em `tests/integration/test_aws.py`.

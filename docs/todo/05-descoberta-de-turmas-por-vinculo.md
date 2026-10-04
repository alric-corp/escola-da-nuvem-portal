# 05 · Descobrir as turmas do aluno pelo vínculo, sem scan

**Status:** 🟨 parcial — otimização por vínculo implementada; scan global permanece · **Prioridade:** média · **Esforço:** médio · **Área:** backend

## Conferência em 04/10/2026

`Portal.dispatch` em `GET /cohorts` já consulta STUDY#/TEACH# e evita
snapshots das turmas vinculadas. Porém ainda percorre `self.repo.cohorts()`;
`Repository.cohorts` em [backend/repository.py](../../backend/repository.py)
usa `self.table.scan`, paginado, para listar as turmas.

Por isso o objetivo literal “sem scan” não foi considerado integralmente
concluído nesta revisão. O teste de integração existente comprova a redução
de leituras S3, não a eliminação do scan DynamoDB. A nota histórica abaixo
sobre `can_teach` continua válida; não há necessidade demonstrada de trocar
esse GetItem de uma turma específica. O restante requer decisão de escopo
ou implementação futura, sem mudança nesta rodada.

## Problema
`GET /cohorts` fazia um *scan* de todas as turmas e, para quem não é instrutor, lia do S3 o snapshot atual de cada uma para procurar o aluno. O custo crescia com o número de turmas e o tamanho dos snapshots, a cada login.

## O que foi feito
`backend/portal.py`, rota `GET /cohorts`:
- Antes do loop, duas queries únicas: `self.repo.list(self.upk, "STUDY#")` (turmas em que o usuário já está vinculado como aluno) e `self.repo.list(self.upk, "TEACH#")` (turmas em que já é instrutor). Isso substitui a checagem `can_teach(code)` (uma leitura por turma) por uma única query.
- No loop por turma: se o código está em `bound` (STUDY#) ou o usuário ensina/é admin, a turma entra na lista **sem nenhuma leitura de snapshot do S3**. Só cai no caminho antigo (ler a publicação atual do S3 e procurar pelo e-mail) quando não há nenhum vínculo — o primeiro acesso de cada aluno, exatamente como antes.
- `self.repo.cohorts()` continua fazendo `scan` na tabela (é uma lista de turmas, não de alunos — não cresce com o tamanho dos snapshots; o item 3 original do backlog, sobre isso, ficou fora do escopo — ver nota abaixo).

## Testes
- `tests/integration/test_aws.py`: novo teste `test_cohorts_listing_skips_snapshot_once_student_is_bound`, rodando com `moto` (DynamoDB e S3 reais via mock, não a classe fake dos testes unitários). Ele publica uma turma, chama `/cohorts` num aluno ainda sem vínculo e confirma que `s3.get_object` **é** chamado (fallback por e-mail no primeiro acesso); em seguida aciona o bind via `/cohorts/{code}/report`, chama `/cohorts` de novo e confirma que `s3.get_object` **não** é chamado dessa vez.
- Suíte completa do backend: 80/80 testes unitários + 8/8 de integração (`tests/integration/test_aws.py`), todos passando.

## Critérios de aceite
- [x] Um aluno já vinculado não provoca nenhuma leitura de snapshot em `/cohorts` (validado com moto, não só a classe fake dos testes unitários).
- [x] O primeiro acesso continua localizando a turma pelo e-mail.
- [x] Testes de integração em `tests/integration/test_aws.py`.

## Nota — item 3 da proposta original não abordado
A proposta original também sugeria consultar `USER#<sub>/TEACH#` **em vez de** chamar `can_teach` para cada turma dentro da rota de despacho por turma (`/cohorts/{code}/...`, linha `teach = self.can_teach(code)` em `dispatch`). Isso não foi alterado: ali `can_teach` já é uma única leitura (`GetItem`) para uma turma específica — não há "cada turma" nesse caminho, então não havia scan a eliminar. A otimização de query única só fazia sentido no loop de `/cohorts`, que foi o que mudou.

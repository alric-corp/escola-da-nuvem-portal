# 17 · Importar notas pela API do Canvas

**Status:** 🟨 viabilidade testada (2026-09-24), implementação pendente · **Prioridade:** estratégica · **Esforço:** grande · **Área:** instrutor / backend

## Problema
Toda semana o instrutor exporta o CSV manualmente, envia, confere e publica.

## Proposta
- Credencial de API do Canvas (chave de desenvolvedor da instituição ou token de serviço) guardada no Secrets Manager.
- Rota `POST /cohorts/{code}/preview-from-canvas`: busca notas e atividades do curso associado e gera o mesmo snapshot que `parse_csv`.
- Fluxo de revisão igual ao atual. Opcionalmente, criar a prévia automaticamente (agendada no EventBridge) e avisar o instrutor, que só revisa e publica.

## Pré-requisitos
[12](12-configuracao-da-turma-no-backend.md) (curso Canvas por turma) e autorização da instituição para uso da API.

## Teste de viabilidade — 2026-09-24
Feito com um token pessoal de instrutor (somente leitura, nada escrito no Canvas; o token não foi gravado no repositório e deve ser revogado). Comparação estrutural com os CSVs exportados em 14/09, olhando só contagens:

| Item que o `parse_csv` usa | Curso 4436 (BRSAO267) | Curso 4413 (BRSAO257) |
| --- | --- | --- |
| Atividades KC/LAB (`nome (id)` igual ao cabeçalho do CSV) | 163 de 163 | 74 de 74 |
| Alunos (o CSV tem +1, o aluno de teste, que a API não lista) | 59 de 59 | 56 de 56 |
| E-mail (`login_id` = "SIS Login ID") | 59 de 59 | 56 de 56 (o mesmo aluno sem e-mail nos dois) |
| Pontuação máxima (`points_possible`) | todas | todas |
| "Graduated Final Points" | atividade "Graduated" (1 ponto), grupo "Graduated" | idem |
| Notas iguais (pares com nota nos dois; o resto mudou desde 14/09) | 1054 de 1056 | 1805 de 1834 |

- **Endpoints**: `/courses/{id}/assignments`, `/courses/{id}/users?enrollment_type[]=student&include[]=email`, `/courses/{id}/students/submissions?student_ids[]=all&workflow_state=graded`.
- **Filtro `workflow_state=graded`**: seguro. As notas do CSV que ficaram de fora eram todas do aluno de teste; nenhuma submissão tem nota fora do estado "graded" (as "submitted" estão sem nota). Não havia nenhuma atividade dispensada (`excused`) nas duas turmas, então o mapeamento para "EX" **não foi verificado com dado real**.
- **Tempo**: sem filtro, 4436 levou 112 chamadas e 88 s (10.800 submissões, 88% "não entregue"). Com o filtro, as notas saem em 15 chamadas e 10 s (4436) ou 15 s (4413). O endpoint usa paginação por marcador (sem `rel="last"`), então paralelizar por página não funciona; o caminho é dividir os alunos em grupos (`student_ids[]=...`) em paralelo, ou rodar a busca de forma assíncrona. O limite do API Gateway é 29 s.

## Decisões pendentes antes de implementar
- **Credencial**: token pessoal de instrutor (expira; acesso = permissões da pessoa) ou chave de desenvolvedor / conta de serviço da instituição (recomendado). Em qualquer caso, guardada no Secrets Manager.
- **Autorização da instituição** para uso da API.
- Depende também da parte 2 da [12](12-configuracao-da-turma-no-backend.md) para cursos novos terem catálogo de links e módulos.

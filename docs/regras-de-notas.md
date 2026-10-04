# Regras de importação e cálculo

Implementadas em `backend/grades.py`. O frontend só as reproduz para exibição (`needsReview` em `frontend/student-journey.js`).

## Formato do CSV

- Exportação de notas do Canvas: UTF-8, separada por vírgula, até 2 MB.
- Colunas obrigatórias: `Student`, `ID` e `SIS Login ID`, além de exatamente uma linha `Points Possible`.
- Cabeçalhos repetidos ou linhas com número de campos diferente do cabeçalho são rejeitados.
- Entre 1 e 500 alunos e entre 1 e 200 atividades.
- **Atividade** é toda coluna cujo nome começa com um número e contém `KC` ou `LAB`. O sufixo `(id)` do Canvas é removido do nome exibido.
- O aluno de teste do Canvas é ignorado quando tem nome reservado, ID numérico, nenhum SIS User ID e login vazio ou hexadecimal de 40 caracteres.
- Um e-mail vazio gera aviso mas não bloqueia. E-mail malformado ou ID/e-mail duplicado bloqueiam a importação.
- Uma nota negativa, não numérica ou acima de `Points Possible` bloqueia a importação.

## Estado de cada atividade para um aluno

| Condição | Estado | Entra na média? |
| --- | --- | --- |
| Atividade não liberada | `unreleased` | Não |
| Célula `EX` | `exempt` | Não |
| Liberada e célula vazia | `pending` ("Sem nota") | **Sim, como 0%** |
| Liberada e com valor (inclusive 0) | `completed` | Sim |

## Médias e situação

- Percentual da atividade: `nota / Points Possible × 100`.
- Média KC e média LAB: média aritmética dos percentuais das atividades liberadas e não dispensadas de cada tipo.
- Média total: média entre KC e LAB (só das categorias disponíveis).
- Progresso: atividades com nota ÷ (com nota + sem nota).

| Situação | Regra (valores sem arredondamento) |
| --- | --- |
| `graduated` | `Graduated Final Points = 1`. Tem prioridade sobre as demais. |
| `insufficient` | Sem média de KC ou sem média de LAB |
| `ok` ("Médias na referência") | KC ≥ 70 **e** LAB ≥ 95 |
| `critical` | KC < 70 **e** LAB < 95 |
| `attention` | Só uma das duas referências atingida |

## Revisão sugerida

`needsReview` vale para uma atividade `completed` com percentual abaixo da referência da turma: por padrão, 70 (KC) ou 95 (LAB). Um zero registrado entra em revisão, não em "Sem nota". É uma sugestão de estudo, não uma garantia de nova tentativa no Canvas.

## Configuração dos limites

Os limites vêm dos metadados da turma e podem ser alterados por um administrador em “Turmas e acessos” → Configurações. O backend calcula médias/situação e `needsReview` usando esses valores e os devolve ao frontend. 70/95 são os padrões quando não há configuração; não é necessário editar código para mudar os limites de uma turma (veja [TODO 12 concluído](todo/concluido/12-configuracao-da-turma-no-backend.md)). Resumos históricos mantêm os limites usados na publicação original.

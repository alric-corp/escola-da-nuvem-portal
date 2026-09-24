# 11 · Administração de vínculos, nomes e solicitações

**Prioridade:** média · **Esforço:** médio · **Área:** admin

## Problema
- Um aluno vinculado à conta errada só pode ser corrigido editando o DynamoDB (`STUDY#` e `OWNER#`).
- O nome de exibição (`PROFILE#`) também só é editável na AWS.
- Não é possível recusar solicitações de instrutor. Solicitações aprovadas continuam listadas e mostram "Vincular à turma".

## Proposta
- Em "Turmas e acessos": buscar o aluno por nome, e-mail ou ID Canvas, ver a conta vinculada e **desvincular**, com confirmação e registro `AUDIT#`.
- Editar o nome de exibição, também com `AUDIT#`.
- Solicitações com status `pending`, `approved` ou `rejected`, ação **Recusar** e filtro por status.

## Critérios de aceite
- [ ] Toda operação exige o papel admin e é feita em transação.
- [ ] Desvincular permite que o aluno refaça o vínculo pelo e-mail no próximo acesso.

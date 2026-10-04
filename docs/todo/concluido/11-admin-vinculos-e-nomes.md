# 11 · Administração de vínculos, nomes e solicitações

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída (aplicado em produção) · **Prioridade:** média · **Esforço:** médio · **Área:** admin

## Problema
- Um aluno vinculado à conta errada só podia ser corrigido editando o DynamoDB (`STUDY#` e `OWNER#`).
- O nome de exibição (`PROFILE#`) também só era editável na AWS.
- Não era possível recusar solicitações de instrutor. Solicitações aprovadas continuavam listadas e mostravam "Vincular à turma" como se ainda estivessem pendentes (bug visual, corrigido junto).

## O que foi feito

### Backend
- `Portal.student()` (bind): a reserva `OWNER#<canvasId>` passa a gravar também `email` e `at` (data do vínculo), além de `userId` — necessário para o admin conseguir ver qual conta está vinculada (bindings anteriores a este recurso continuam funcionando, só não têm esse extra).
- `_students_search(code, cohort, pk, body)` — `POST /cohorts/{code}/students-search`, admin only. Recebe `{query}`, busca por substring (case-insensitive) em nome, e-mail do Canvas ou ID, na publicação atual da turma. Devolve até 25 resultados com `bound`/`boundEmail`/`boundAt`.
- `_unlink_student(code, pk, body)` — `POST /cohorts/{code}/unlink-student`, admin only. Recebe `{canvasId}`; exige que exista vínculo (`OWNER#`); remove `OWNER#` e `STUDY#` na mesma transação e grava um `AUDIT#`. Depois de desvinculado, o aluno (ou outra conta com o mesmo e-mail do Canvas) pode se vincular de novo no próximo acesso, como antes de qualquer vínculo existir.
- `_set_display_name(pk, body)` — `POST /cohorts/{code}/display-name`, admin only. Recebe `{canvasId, displayName}`; grava `PROFILE#<canvasId>` (já lido por `display_snapshot`, usado em todo relatório) e um `AUDIT#`.
- Rota global `POST /requests/{userId}/reject` — admin only, só aceita solicitações com `status == "pending"` (409 caso contrário); marca como `rejected` com `rejectedBy`/`rejectedAt`.
- `infra/terraform/api.tf`: quatro rotas novas, todas exigindo JWT + escopo `portal/access`, como as demais.

### Frontend (`frontend/pages/access.js`, `frontend/app.js`)
- **Solicitações de acesso**: corrigido o bug de exibição — só solicitações `pending` mostram o formulário "Vincular à turma"; `approved`/`rejected` mostram um rótulo, sem ação. Novo filtro por status (padrão: só pendentes) e botão **Recusar** em cada pendente.
- **Alunos vinculados da `<turma>`**: nova seção com busca por nome/e-mail/ID. Cada resultado mostra o e-mail da conta vinculada (ou "Sem vínculo") e os botões **Desvincular** (com confirmação) e **Editar nome** (edição em linha, sem `prompt()` do navegador — consistente com o resto do app).
- Nenhuma rota nova foi adicionada sem exigir papel admin (o backend também confere — a UI não é a única barreira).

## Testes
- `backend/test_portal.py`: 6 testes novos — busca por nome/e-mail/ID mostrando o vínculo corretamente; as três operações (busca, desvincular, renomear) exigem admin; desvincular permite vínculo novo pelo e-mail e grava auditoria; desvincular sem vínculo existente falha (404); renomear atualiza `PROFILE#` e aparece no relatório, com auditoria; recusar exige pendente e admin, e não pode ser repetido.
- `tests/integration/test_aws.py`: 1 teste novo com `moto` (DynamoDB/S3 reais simulados) cobrindo busca, renomear e desvincular-e-revincular de ponta a ponta, com transações reais.
- Suíte completa do backend: **93/93** unitários + **10/10** de integração, todos passando.
- `terraform validate`/`terraform test`: passando.
- Dois novos testes de navegador (Playwright, instalado temporariamente): `tests/admin-access-browser.mjs` (filtro de solicitações, recusar, buscar aluno, ver vínculo, desvincular, editar nome em linha). Suíte completa de navegador (8 arquivos aplicáveis) rodada e passando, sem regressão.

## Aplicado em produção em 2026-09-24
`terraform apply`: **4 recursos criados** (as rotas novas), **3 atualizados** (lambdas), **0 destruídos**. `terraform plan` depois confirma "No changes". `scripts/deploy_frontend.sh` publicado (invalidação `I2B9XGUBVWWG0RBHBSXQC2TS52`).

## Critérios de aceite
- [x] Toda operação exige o papel admin e é feita em transação (busca é só leitura; desvincular e editar nome usam `repo.transaction`, com registro `AUDIT#`).
- [x] Desvincular permite que o aluno refaça o vínculo pelo e-mail no próximo acesso.

# 28 · Gerenciar vínculos de instrutores já aprovados

**Status:** aberto · **Prioridade:** média · **Esforço:** pequeno a médio · **Área:** administrador / frontend

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`. Lacuna de jornada
confirmada por leitura e renderização Node com uma solicitação fictícia
`approved`: a lista mostra “Aprovada”, sem formulário de vinculação.

- [requestRow](../../frontend/pages/access.js), linhas 57–70, oferece ação
  somente para solicitações `pending`; a seção de instrutores oferece remoção.
- [approveInstructor](../../frontend/handlers/access.js), linhas 152–164,
  também exige solicitação pendente. A confirmação de remoção, linha 81,
  informa que a tela não consegue devolver o acesso.
- [Portal._approve_instructor](../../backend/portal.py), linhas 781–793,
  já permite ao administrador vincular uma solicitação institucional existente
  a outra turma; grava os dois vínculos em transação.

**Cenários:** instrutor aprovado na turma A precisa acompanhar B; ou teve o
vínculo removido e um administrador precisa devolvê-lo. O caminho de aprovação
inicial não deve ser reutilizado como uma ação enganosa em pedidos concluídos.

## Menor mudança recomendada

Adicionar gerenciamento explícito na seção “Instrutores da turma”, permitindo
selecionar uma pessoa já aprovada e vinculá-la à turma escolhida pela rota atual.
Separar esse fluxo da aprovação inicial e da recusa de solicitações.

## Critérios de aceite

- [ ] Administrador vincula aprovado a B sem retirar o vínculo de A.
- [ ] Após remoção, pode conceder novamente o vínculo por confirmação explícita.
- [ ] Não oferece vínculo duplicado; informa pessoa, turma e permissões antes
  do envio. Cancelamento não envia e clique duplo não duplica a operação.
- [ ] Solicitação recusada não é reaberta automaticamente; não administrador
  continua sem autorização. Revogação não causa nova concessão espontânea.
- [ ] Erros, resultados incertos, recarga e troca de turma/usuário preservam os
  padrões existentes de isolamento e acessibilidade.
- [ ] Testes de navegador e backend com dados fictícios demonstram o fluxo e
  a autorização. Documentação da jornada administrativa acompanha o resultado.

## Limites e implantação

Reutilizar a API atual; não criar contas, papel global, mudança Cognito ou nova
aprovação administrativa. Não alterar remetentes/agendas de lembretes como
efeito colateral. O [TODO 11](concluido/11-admin-vinculos-e-nomes.md) continua
concluído: este item cobre vínculos posteriores à primeira aprovação.

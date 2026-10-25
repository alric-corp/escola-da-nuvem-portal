# 28 · Gerenciar vínculos de instrutores já aprovados

**Status:** implementado nesta branch; integração e implantação pendentes · **Área:** administrador / frontend e backend

## Resultado da implementação

A seção “Instrutores da turma” oferece um seletor de pessoas já aprovadas que
ainda não possuem o vínculo escolhido. “Conceder acesso à turma” confirma
pessoa, turma e permissões, usando o POST existente. Aprovação inicial e recusa
continuam separadas. A revogação não reatribui acesso; uma reconcessão exige
nova escolha e confirmação explícitas e não altera os outros vínculos.

`linkApprovedInstructor` e a operação `link` reutilizam carregamento, erros e
consulta de reconciliação. Sem repetir POST automaticamente, preservam contexto
de turma/sessão e foco. Solicitações recusadas e pessoas já vinculadas ficam
fora da seleção. No backend, um teste demonstrou que o POST direto reabria uma
solicitação `rejected`; a validação anterior à transação agora recusa esse caso
com 409, preservando solicitações legadas sem `status`.

Regressões: [Node](../../../tests/admin-access-page.mjs),
[navegador](../../../tests/admin-access-page-browser.mjs) e
[dispatcher real com repositório controlado](../../../backend/test_instructor_links.py).
Os cenários cobrem vínculo adicional, reconcessão, recusa sem escrita,
cancelamento, duplicação, resultado incerto, troca de contexto, teclado e mobile.
As reproduções RED/GREEN usam dados fictícios, sem operação produtiva.
Capturas: [desktop](../../evidence/todos-28-30/instrutores-desktop.png) e
[mobile com texto a 200%](../../evidence/todos-28-30/instrutores-mobile-texto200.png).

O frontend usa a API existente, mas a nova recusa server-side precisa da
implantação separada do pacote backend junto ao TODO 29. Nenhuma Lambda foi
implantada nesta missão. “Concluído” nesta pasta descreve desenvolvimento,
não integração do PR nem aprovação de QA autenticado real.

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`. Lacuna de jornada
confirmada por leitura e renderização Node com uma solicitação fictícia
`approved`: a lista mostra “Aprovada”, sem formulário de vinculação.

- [requestRow](../../../frontend/pages/access.js), linhas 57–70, oferece ação
  somente para solicitações `pending`; a seção de instrutores oferece remoção.
- [approveInstructor](../../../frontend/handlers/access.js), linhas 152–164,
  também exige solicitação pendente. A confirmação de remoção, linha 81,
  informa que a tela não consegue devolver o acesso.
- [Portal._approve_instructor](../../../backend/portal.py), linhas 781–793,
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

- [x] Administrador vincula aprovado a B sem retirar o vínculo de A.
- [x] Após remoção, pode conceder novamente o vínculo por confirmação explícita.
- [x] Não oferece vínculo duplicado; informa pessoa, turma e permissões antes
  do envio. Cancelamento não envia e clique duplo não duplica a operação.
- [x] Solicitação recusada não é reaberta automaticamente; não administrador
  continua sem autorização. Revogação não causa nova concessão espontânea.
- [x] Erros, resultados incertos, recarga e troca de turma/usuário preservam os
  padrões existentes de isolamento e acessibilidade.
- [x] Testes de navegador e backend com dados fictícios demonstram o fluxo e
  a autorização. Documentação da jornada administrativa acompanha o resultado.

## Limites e implantação

Reutilizar a API atual; não criar contas, papel global, mudança Cognito ou nova
aprovação administrativa. Não alterar remetentes/agendas de lembretes como
efeito colateral. O [TODO 11](11-admin-vinculos-e-nomes.md) continua
concluído: este item cobre vínculos posteriores à primeira aprovação.

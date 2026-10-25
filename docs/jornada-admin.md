# Jornada do administrador

## Tornar-se administrador

O papel de administrador é concedido **manualmente** no Cognito: adicionar o usuário ao grupo `admin` do user pool, mediante autorização operacional. Não existe tela para conceder esse papel. Administradores têm acesso às turmas sem precisar de vínculo individual de instrutor; uma sessão anterior pode exigir novo login para refletir a alteração de grupo.

## Turmas e acessos

As ações abaixo ficam em **Turmas e acessos**. Confira o código da turma selecionada antes de confirmar uma operação. Trocar o nome de exibição ou desvincular uma conta no portal não altera o cadastro nem a matrícula no Canvas.

| Ação | Caminho na interface / rota | Efeito |
| --- | --- | --- |
| Criar turma | Criar uma turma · `POST /cohorts` | Cria a turma sem publicação e prepara suas referências derivadas; código em maiúsculas, padrão `[A-Z0-9-]{3,32}`. |
| Ver solicitações | Solicitações de instrutores · `GET /requests` | Lista pedidos pendentes, aprovados e recusados, com filtros. |
| Aprovação inicial | Escolher turma e **Vincular à turma** · `POST /cohorts/{code}/instructors` | Confirma pessoa/permissões; grava os dois vínculos `TEACH#` e marca o pedido como aprovado. |
| Conceder outro vínculo ou devolver acesso | Instrutores da turma → **Instrutor já aprovado** → **Conceder acesso à turma** · mesma rota | Vincula a pessoa aprovada à turma selecionada, preservando seus outros vínculos; não reabre pedido recusado. |
| Recusar solicitação pendente | **Recusar** · `POST /requests/{userId}/reject` | Exige confirmação e registra a recusa; a tela não oferece reabertura do pedido. |
| Remover vínculo de instrutor | Instrutores da turma → remover · `POST /cohorts/{code}/revoke-instructor` | Remove os dois vínculos somente desta turma. Confira o aviso sobre eventual remetente dos lembretes automáticos. |
| Corrigir vínculo de aluno | Buscar aluno → **Desvincular conta** · `POST /cohorts/{code}/unlink-student` | Remove `OWNER#/STUDY#`, com auditoria; preserva matrícula e notas. O próximo acesso pode refazer o vínculo pelo e-mail do Canvas. |
| Corrigir nome exibido | Buscar aluno → editar nome · `POST /cohorts/{code}/display-name` | Salva o nome de exibição no portal, sem alterar o Canvas. |
| Associar curso e atualização de notas | Configurações da turma · `POST /cohorts/{code}/settings` | Configura curso Canvas, referências e atualização automática. Módulos/links chegam pela sincronização das 6h e 18h; ligar a opção também permite publicação automática das notas. |

Solicitações aprovadas permanecem na lista como registro da decisão. A lista de instrutores é a da turma selecionada. Pessoas já vinculadas não aparecem como novas candidatas ao mesmo vínculo; o cancelamento da confirmação não envia a alteração.

## Diagnóstico e execução operacional

- Diferencie falta de matrícula no Canvas, ausência de publicação e conta vinculada incorretamente. Abrir o próprio relatório pela primeira vez pode criar `OWNER#/STUDY#`; não tratar esse GET como uma consulta sem efeitos.
- **Publicação de notas** pela interface/Canvas é diferente de publicação do frontend, implantação das Lambdas ou mudança de infraestrutura.
- O frontend segue PR → CI aprovado → merge → deploy automático. Consulte o [runbook de releases](../infra/FRONTEND-RELEASES.md); não use sync na raiz como rotina.
- Backend e infraestrutura seguem o [procedimento existente](../infra/README.md), com implantação separada. Este roteiro não autoriza mudanças AWS nem uso de ferramentas administrativas para contornar ações disponíveis no portal.
- QA manual e contas sintéticas: [instruções e limites](../tests/README.md#verificações-manuais-contra-o-ambiente-publicado). QA autenticado só é comprovado por uma execução real autorizada, com suas versões e limites registrados.

# Jornada do administrador

## Tornar-se administrador

O papel de administrador é concedido **manualmente** no Cognito: basta adicionar o usuário ao grupo `admin` do user pool. Não existe tela para isso. Um administrador tem acesso de instrutor a todas as turmas (`can_teach` devolve verdadeiro).

## Turmas e acessos (`frontend/pages/access.js`)

| Ação | Rota | Efeito |
| --- | --- | --- |
| Criar turma | `POST /cohorts` | `COHORT#<code>/METADATA` com `current: null`. O código é convertido para maiúsculas e precisa seguir o padrão `[A-Z0-9-]{3,32}`. |
| Ver solicitações | `GET /requests` | Todas as solicitações do portal, pendentes e aprovadas |
| Vincular instrutor | `POST /cohorts/{code}/instructors` | Uma transação grava `USER#/TEACH#`, `COHORT#/TEACH#` e marca a solicitação como `approved` |
| Remover vínculo | `POST /cohorts/{code}/revoke-instructor` | Apaga os dois registros `TEACH#` |

Limitações atuais:

- Não é possível recusar uma solicitação.
- Solicitações aprovadas continuam na lista.
- A lista de instrutores mostrada é só a da turma selecionada no menu lateral.

## Operações feitas fora do portal (console ou CLI da AWS)

| Necessidade | Como é feito hoje |
| --- | --- |
| Conceder papel de admin | Adicionar ao grupo `admin` no Cognito |
| Corrigir o vínculo de um aluno com a conta errada | Editar ou apagar `USER#<sub>/STUDY#<code>` e `COHORT#<code>/OWNER#<canvasId>` |
| Ajustar o nome exibido de um aluno | Criar `COHORT#<code>/PROFILE#<canvasId>` com `{"canvasId", "displayName"}` |
| Associar uma turma nova ao curso Canvas (links e módulos) | Editar `cohortCanvasCourses` e os catálogos em `frontend/canvas-links.js` e publicar o frontend de novo |
| Ligar ou desligar lembretes | Variável `reminders_enabled` no Terraform |

Antes de qualquer mudança na AWS, siga os cuidados de [CONTEXTO-HANDOFF-2026-09-24.md](../CONTEXTO-HANDOFF-2026-09-24.md): rodar `terraform plan`, não apagar publicações ou snapshots e publicar só `frontend/dist`.

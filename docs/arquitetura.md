# Arquitetura

```
Navegador ──► CloudFront ──► S3 (frontend/dist)
    │
    ├──► Cognito Managed Login (PKCE) ──► access token (escopo portal/access)
    │
    └──► API Gateway HTTP (JWT authorizer)
              │
              ▼
         Lambda "identity" (backend/portal.py)
              ├──► DynamoDB  restart-portal-<env>   (turmas, vínculos, publicações)
              ├──► S3 imports                       (CSV original + snapshot JSON)
              ├──► Cognito /oauth2/userInfo          (só se o token não trouxer o e-mail)
              └──► SES v2 ──► SNS ──► Lambda "reminder-events" (backend/delivery.py)

Cognito (login) ──► Lambda "auth-trigger" (backend/auth_trigger.py): e-mail no access token

EventBridge Scheduler (6h e 18h) ──► Lambda "canvas-sync" (backend/canvas_sync.py)
              ├──► Secrets Manager (token do Canvas)
              ├──► API do Canvas (somente leitura)
              ├──► mesma prévia/publicação do CSV (DynamoDB + S3)
              └──► falha ──► CloudWatch Alarm ──► SNS (e-mail)
```

## Componentes

| Peça | Arquivo | Observações |
| --- | --- | --- |
| Frontend estático | `frontend/` → `scripts/build_frontend.py` → `frontend/dist` | Módulos ES sem bundler. `config.json` é gerado a partir do output do Terraform. |
| Autenticação | `frontend/auth.js`, `infra/terraform/auth.tf` | Authorization code + PKCE, state e nonce. Access token de 15 min, refresh de 7 dias, ambos em `localStorage`. |
| API | `infra/terraform/api.tf` | HTTP API com throttling de 50 req/s (burst 100). Lambda de 512 MB, timeout de 29 s. |
| Regras de negócio | `backend/portal.py` | Classe `Portal`, com `dispatch` por rota. |
| Parser e cálculo | `backend/grades.py` | Não depende de AWS. Veja [regras-de-notas.md](regras-de-notas.md). |
| Diferenças entre publicações | `backend/changes.py` | Diff da turma (instrutor) e diff pessoal (aluno). |
| Persistência | `backend/repository.py` | `transaction()` usa comparação do JSON serializado como lock otimista. |
| Lembretes | `backend/reminders.py`, `backend/delivery.py`, `infra/terraform/reminders.tf` | Envio sem retry automático, individual ou em lote. Eventos SES gravados por `messageId`. |
| Atualização pelo Canvas | `backend/canvas.py`, `backend/canvas_sync.py`, `infra/terraform/canvas-sync.tf` | Às 6h e 18h, para turmas com `autoSync`: lê a API do Canvas, monta o mesmo CSV da exportação e publica como o fluxo manual, sem revisão humana. Não publica se nada mudou nem se a turma vier vazia ou com menos de 80% dos alunos atuais. Falha aciona alarme por e-mail. |
| Alarmes | `infra/terraform/monitoring.tf`, `infra/terraform/canvas-sync.tf` | E-mail (tópico SNS `alerts`) quando a API responde 3 ou mais erros 5xx em 15 minutos, quando o gatilho de login do Cognito falha (ninguém consegue entrar), quando o processamento de eventos do SES falha e quando a atualização pelo Canvas falha. |
| Retenção | `infra/terraform/storage.tf` | Prévias não publicadas expiram em 30 dias (tag `portal-status=draft` no S3 + TTL `expiresAt` no DynamoDB); versões antigas do bucket, em 90. |

## Autenticação de cada requisição

1. O API Gateway valida o JWT (assinatura, emissor, audiência).
2. `authenticate()` (`backend/portal.py`) exige `token_use = access` e o escopo `portal/access`.
3. O `email` e o `email_verified` vêm do próprio access token, incluídos pelo gatilho Cognito `auth-trigger`. Só se a claim não existir (token antigo), a Lambda chama `/oauth2/userInfo`.
4. Os grupos vêm do claim `cognito:groups`. Somente `admin` tem efeito: o papel de instrutor é definido pelos vínculos `TEACH#` no DynamoDB, não pelo grupo.

## Rotas

| Método e rota | Quem | Função |
| --- | --- | --- |
| `GET /me` | todos | Papéis, e-mail, elegibilidade de instrutor e solicitação existente |
| `POST /access-request` | e-mail `@escoladanuvem.org` | Solicitar acesso de instrutor |
| `GET /requests` | admin | Listar solicitações |
| `GET /cohorts` | todos | Turmas que o usuário ensina ou nas quais aparece como aluno |
| `POST /cohorts` | admin | Criar turma |
| `GET /cohorts/{code}/report` | instrutor ou aluno | Painel da turma (instrutor) ou relatório pessoal (aluno) |
| `GET /cohorts/{code}/class-report` | instrutor | Resumo sem e-mails ou IDs (tela `?turma=`) |
| `POST /cohorts/{code}/preview` | instrutor | Validar CSV, gravar rascunho e devolver prévia e diferenças |
| `POST /cohorts/{code}/publish` | instrutor (autor da prévia) | Publicar rascunho (recusado após 29 dias) |
| `POST /cohorts/{code}/restore` | instrutor | Voltar a uma publicação anterior |
| `POST /cohorts/{code}/focus-activities` | instrutor | Definir até 3 atividades de foco |
| `GET/POST /cohorts/{code}/instructors` | admin | Listar e vincular instrutores |
| `POST /cohorts/{code}/revoke-instructor` | admin | Remover vínculo |
| `POST /cohorts/{code}/pending-preview` | instrutor | Pendências de um aluno e prévia do lembrete |
| `POST /cohorts/{code}/send-reminder` | instrutor | Enviar o lembrete |
| `GET /cohorts/{code}/reminder-settings` | instrutor | Situação do remetente no SES |
| `POST /cohorts/{code}/verify-sender` | instrutor | Criar a identidade SES do próprio e-mail |
| `POST /cohorts/{code}/pending-preview-batch` | instrutor | Destinatários do lembrete em lote, com motivo de quem será pulado |
| `POST /cohorts/{code}/send-reminders` | instrutor | Enviar lembretes em lote |
| `POST /cohorts/{code}/students-search` | admin | Buscar aluno e ver o vínculo |
| `POST /cohorts/{code}/unlink-student` | admin | Desvincular aluno da conta |
| `POST /cohorts/{code}/display-name` | admin | Editar nome de exibição |
| `POST /cohorts/{code}/settings` | admin | Limites de KC/LAB, curso Canvas e atualização automática |
| `POST /requests/{userId}/reject` | admin | Recusar solicitação de instrutor |

## Modelo de dados (DynamoDB, tabela única `PK`/`SK`, payload em `data`)

| PK | SK | Conteúdo |
| --- | --- | --- |
| `COHORT#<code>` | `METADATA` | `code`, `name`, `current` (id da publicação vigente), `updatedAt`, `updateKind` (`publish`, `restore` ou `canvas`), `thresholds`, `canvasCourseId`, `autoSync` |
| `COHORT#<code>` | `DRAFT#<id>` | Rascunho de importação: autor, `base`, caminho do snapshot, status. Não publicado: expira pelo TTL `expiresAt` |
| `COHORT#<code>` | `PUB#<id>` | Publicação: metadados do rascunho, `publishedAt`, `publishedBy` (`system:canvas-sync` quando automática), contagem de mudanças, `history` (resumo compacto por aluno), `releasedAt` (data de liberação de cada atividade) |
| `COHORT#<code>` | `SYNC` | Resultado da última atualização pelo Canvas: `status` (`published`, `unchanged`, `failed`), `message`, `at` |
| `COHORT#<code>` | `AUDIT#<uuid>` | Registro de restauração, desvínculo, nome de exibição e configurações |
| `COHORT#<code>` | `FOCUS` | `activityIds` (até 3) e `version` |
| `COHORT#<code>` | `TEACH#<sub>` | Vínculo de instrutor (visão da turma) |
| `COHORT#<code>` | `OWNER#<canvasId>` | Qual conta (`userId`, `email`, `at`) é dona da matrícula |
| `COHORT#<code>` | `PROFILE#<canvasId>` | `displayName` opcional, editado pelo admin em "Turmas e acessos" |
| `COHORT#<code>` | `REMINDER#<pubId>#<canvasId>` | Estado do envio: `sending`, `sent`, `failed` ou `unknown` |
| `USER#<sub>` | `TEACH#<code>` | Vínculo de instrutor (visão do usuário) |
| `USER#<sub>` | `STUDY#<code>` | Vínculo do aluno com o `canvasId` |
| `REQUESTS` | `<sub>` | Solicitação de acesso de instrutor |
| `EMAIL#<messageId>` | `DELIVERY` | Último evento SES relevante |

## S3 de importações

`cohorts/<code>/<draftId>/source.csv` guarda o arquivo original (na atualização automática, o CSV montado a partir da API do Canvas) e `cohorts/<code>/<draftId>/snapshot.json` guarda o snapshot normalizado (atividades, alunos e notas brutas). Publicar não copia arquivos: a publicação aponta para o snapshot do rascunho e grava `history.json` com o resumo por aluno.

O snapshot contém a turma inteira. O backend filtra o aluno antes de responder e nenhuma rota devolve URL de download.

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
              ├──► Cognito /oauth2/userInfo          (e-mail verificado do usuário)
              └──► SES v2 ──► SNS ──► Lambda "reminder-events" (backend/delivery.py)
```

## Componentes

| Peça | Arquivo | Observações |
| --- | --- | --- |
| Frontend estático | `frontend/` → `scripts/build_frontend.py` → `frontend/dist` | Módulos ES sem bundler. `config.json` é gerado a partir do output do Terraform. |
| Autenticação | `frontend/auth.js`, `infra/terraform/auth.tf` | Authorization code + PKCE, state e nonce. Access token de 15 min, refresh de 7 dias, ambos em `localStorage`. |
| API | `infra/terraform/api.tf` | HTTP API com throttling de 10 req/s (burst 20). Lambda de 512 MB, timeout de 29 s. |
| Regras de negócio | `backend/portal.py` | Classe `Portal`, com `dispatch` por rota. |
| Parser e cálculo | `backend/grades.py` | Não depende de AWS. Veja [regras-de-notas.md](regras-de-notas.md). |
| Diferenças entre publicações | `backend/changes.py` | Diff da turma (instrutor) e diff pessoal (aluno). |
| Persistência | `backend/repository.py` | `transaction()` usa comparação do JSON serializado como lock otimista. |
| Lembretes | `backend/reminders.py`, `backend/delivery.py`, `infra/terraform/reminders.tf` | Envio sem retry automático. Eventos SES gravados por `messageId`. |

## Autenticação de cada requisição

1. O API Gateway valida o JWT (assinatura, emissor, audiência).
2. `authenticate()` (`backend/portal.py`) exige `token_use = access` e o escopo `portal/access`.
3. A Lambda chama `/oauth2/userInfo` com o mesmo token para obter `email` e `email_verified`, porque o access token do Cognito não traz o e-mail.
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
| `POST /cohorts/{code}/publish` | instrutor (autor da prévia) | Publicar rascunho |
| `POST /cohorts/{code}/restore` | instrutor | Voltar a uma publicação anterior |
| `POST /cohorts/{code}/focus-activities` | instrutor | Definir até 3 atividades de foco |
| `GET/POST /cohorts/{code}/instructors` | admin | Listar e vincular instrutores |
| `POST /cohorts/{code}/revoke-instructor` | admin | Remover vínculo |
| `POST /cohorts/{code}/pending-preview` | instrutor | Pendências de um aluno e prévia do lembrete |
| `POST /cohorts/{code}/send-reminder` | instrutor | Enviar o lembrete |
| `GET /cohorts/{code}/reminder-settings` | instrutor | Situação do remetente no SES |
| `POST /cohorts/{code}/verify-sender` | instrutor | Criar a identidade SES do próprio e-mail |

## Modelo de dados (DynamoDB, tabela única `PK`/`SK`, payload em `data`)

| PK | SK | Conteúdo |
| --- | --- | --- |
| `COHORT#<code>` | `METADATA` | `code`, `name`, `current` (id da publicação vigente), `updatedAt`, `updateKind` |
| `COHORT#<code>` | `DRAFT#<id>` | Rascunho de importação: autor, `base`, caminho do snapshot, status |
| `COHORT#<code>` | `PUB#<id>` | Publicação: metadados do rascunho, `publishedAt`, `publishedBy`, contagem de mudanças |
| `COHORT#<code>` | `AUDIT#<uuid>` | Registro de restauração |
| `COHORT#<code>` | `FOCUS` | `activityIds` (até 3) e `version` |
| `COHORT#<code>` | `TEACH#<sub>` | Vínculo de instrutor (visão da turma) |
| `COHORT#<code>` | `OWNER#<canvasId>` | Qual conta (`userId`) é dona da matrícula |
| `COHORT#<code>` | `PROFILE#<canvasId>` | `displayName` opcional. Editado manualmente na AWS. |
| `COHORT#<code>` | `REMINDER#<pubId>#<canvasId>` | Estado do envio: `sending`, `sent`, `failed` ou `unknown` |
| `USER#<sub>` | `TEACH#<code>` | Vínculo de instrutor (visão do usuário) |
| `USER#<sub>` | `STUDY#<code>` | Vínculo do aluno com o `canvasId` |
| `REQUESTS` | `<sub>` | Solicitação de acesso de instrutor |
| `EMAIL#<messageId>` | `DELIVERY` | Último evento SES relevante |

## S3 de importações

`cohorts/<code>/<draftId>/source.csv` guarda o arquivo original e `cohorts/<code>/<draftId>/snapshot.json` guarda o snapshot normalizado (atividades, alunos e notas brutas). Publicar não copia arquivos: a publicação aponta para o snapshot do rascunho.

O snapshot contém a turma inteira. O backend filtra o aluno antes de responder e nenhuma rota devolve URL de download.

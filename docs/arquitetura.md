# Arquitetura

```
Navegador ──► CloudFront ──► S3 web (index → releases/<id>/)
    │
    ├──► Cognito Managed Login (PKCE) ──► access token (escopo portal/access)
    │
    ├──► Cognito, API pública sem token (confirmação de cadastro: reenviar o código e confirmar)
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
| Frontend estático | `frontend/`; `.github/workflows/deploy-frontend.yml` | Módulos ES sem bundler, publicados em `releases/<id>/` com configuração própria. Build plano local em `frontend/dist`; operação pelo [runbook de releases](../infra/FRONTEND-RELEASES.md). |
| Autenticação | `frontend/auth.js`, `infra/terraform/auth.tf` | Authorization code + PKCE, state e nonce. Access token de 15 min, refresh de 7 dias, ambos em `localStorage`. |
| Confirmação de cadastro | `frontend/api.js`, `frontend/handlers/signup-confirmation.js`, `frontend/pages/signup-confirmation.js` | Antes do login, o navegador fala direto com a API pública do Cognito, sem backend e sem Terraform. Veja [Confirmação de cadastro](#confirmação-de-cadastro). |
| API | `infra/terraform/api.tf` | HTTP API com throttling de 50 req/s (burst 100). Lambda de 512 MB, timeout de 29 s. |
| Regras de negócio | `backend/portal.py` | Classe `Portal`, com `dispatch` por rota. |
| Parser e cálculo | `backend/grades.py` | Não depende de AWS. Veja [regras-de-notas.md](regras-de-notas.md). |
| Diferenças entre publicações | `backend/changes.py` | Diff da turma (instrutor) e diff pessoal (aluno). |
| Persistência | `backend/repository.py` | `transaction()` usa comparação do JSON serializado como lock otimista. |
| Lembretes | `backend/reminders.py`, `backend/delivery.py`, `infra/terraform/reminders.tf` | Envio sem retry automático, individual ou em lote. Eventos SES gravados por `messageId`. |
| Atualização pelo Canvas | `backend/canvas.py`, `backend/canvas_sync.py`, `infra/terraform/canvas-sync.tf` | Às 6h e 18h, para turmas com `autoSync`: lê a API do Canvas, monta o mesmo CSV da exportação e publica como o fluxo manual, sem revisão humana. Não publica se nada mudou nem se a turma vier vazia ou com menos de 80% dos alunos atuais. Também atualiza o catálogo de módulos e links (`CATALOG#<curso>`) de toda turma com curso configurado; os relatórios anotam módulo e link em cada atividade. Falha aciona alarme por e-mail. |
| Alarmes | `infra/terraform/monitoring.tf`, `infra/terraform/canvas-sync.tf` | E-mail (tópico SNS `alerts`) quando a API responde 3 ou mais erros 5xx em 15 minutos, quando o gatilho de login do Cognito falha (ninguém consegue entrar), quando o processamento de eventos do SES falha quando a atualização pelo Canvas falha e quando o token do Canvas expira em menos de 15 dias (ou a validade deixa de ser conferida). |
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
| `POST /cohorts/{code}/participation` | instrutor da turma ou admin | Marcar desistente ou reativar: `{ canvasId, status, expectedStatus }`, com `ACTIVE` ou `WITHDRAWN`; 409 se o status mudou desde a leitura |
| `POST /requests/{userId}/reject` | admin | Recusar solicitação de instrutor |

## Contrato OpenAPI

[`openapi/portal.yaml`](../openapi/portal.yaml) caracteriza as **35 operações**
da API HTTP do portal em OpenAPI **3.0.3**. É a fonte das rotas Terraform:
`yamldecode(file("${path.module}/../../openapi/portal.yaml"))` deriva método,
path, tipo de autorização e scopes, sem copiar o YAML para a infraestrutura.
O [inventário API-1](historico/api-1.md) registra o mapeamento completo, limites dos schemas,
mutações de teste e a etapa anterior à migração. O [relatório API-2](historico/api-2.md)
registra os testes e os planos somente leitura da migração.

- **API-1:** caracterização concluída em `c64921b`, com CI verde.
- **API-2:** concluída; o registro histórico preserva a etapa local e seus planos de migração.
  A lista manual saiu de `api.tf`; `aws_apigatewayv2_route.me` mantém `/me`
  e `aws_apigatewayv2_route.portal` mantém as outras 34 chaves `METHOD /path`.
  Os planos históricos direcionado e completo mantiveram as 35 rotas em **0/0/0**.
- **TODO 22:** fontes modulares em `openapi/src/`, bundle gerado/versionado em
  `openapi/portal.yaml` e verificação de atualização no CI já integrados pelo
  [PR #13](https://github.com/alric-corp/escola-da-nuvem-portal/pull/13).
  Edição, geração e verificação estão em [openapi/README.md](../openapi/README.md);
  o [registro concluído](todo/concluido/22-openapi-modular-e-pipeline-de-contrato.md)
  preserva os hashes e a equivalência semântica da migração.

Frontend e dispatchers públicos são comparados com OpenAPI. A equivalência
Terraform é testada nos recursos avaliados por `terraform test`, com mocks,
e não por um parser da sintaxe HCL. As proteções da C7.2.4.1 continuam,
adaptadas para usar OpenAPI como referência. O teste Python reutiliza o parser
YAML Node via um helper JSON; executar integração requer `npm ci` previamente.

`PortalJwt` descreve bearer JWT sem IDs de ambiente.
`x-portal-authorization-scopes` registra os scopes exigidos; a extensão
`x-portal-backend-operation` permite conferir a operação implementada.
O ambiente continua fornecendo `aws_apigatewayv2_authorizer.portal.id` e
`aws_apigatewayv2_integration.identity.id`. Terraform aceita somente os métodos
HTTP declarados no filtro; metadata não gera rota. Segurança não suportada
é recusada por preconditions, sem conversão silenciosa em acesso público.
O contrato não contém servidores de produção. Cognito/OAuth, uploads diretos
ao S3 e outros serviços externos ficam fora dos seus paths.

A validação de runtime continua no backend: OpenAPI não substitui validação
Python, `require(teach)` nem autorização de negócio. Não há codegen de cliente,
validação de payload pelo gateway ou documentação pública nesta etapa.
Os testes de contrato rodam em `npm test` (ou `node --test tests/openapi.mjs`);
reutilizam o parser YAML da dependência dev Playwright e Python3 stdlib para AST.
As mutações nativas rodam com `python3 tests/contracts/terraform_mutations.py`,
após inicializar os providers Terraform; usam cópias temporárias e mocks.

## Modelo de dados (DynamoDB, tabela única `PK`/`SK`, payload em `data`)

| PK | SK | Conteúdo |
| --- | --- | --- |
| `COHORT#<code>` | `METADATA` | `code`, `name`, `current` (id da publicação vigente), `updatedAt`, `updateKind` (`publish`, `restore` ou `canvas`), `thresholds`, `canvasCourseId`, `autoSync` |
| `COHORT#<code>` | `DRAFT#<id>` | Rascunho de importação: autor, `base`, caminho do snapshot, status. Não publicado: expira pelo TTL `expiresAt` |
| `COHORT#<code>` | `PUB#<id>` | Publicação: metadados do rascunho, `publishedAt`, `publishedBy` (`system:canvas-sync` quando automática), contagem de mudanças, `history` (resumo compacto por aluno), `releasedAt` (data de liberação de cada atividade) |
| `COHORT#<code>` | `SYNC` | Resultado da última atualização pelo Canvas: `status` (`published`, `unchanged`, `failed`), `message`, `at` |
| `COHORT#<code>` | `AUDIT#<uuid>` | Registro de restauração, desvínculo, nome de exibição, configurações e participação |
| `COHORT#<code>` | `FOCUS` | `activityIds` (até 3) e `version` |
| `COHORT#<code>` | `TEACH#<sub>` | Vínculo de instrutor (visão da turma) |
| `COHORT#<code>` | `OWNER#<canvasId>` | Qual conta (`userId`, `email`, `at`) é dona da matrícula |
| `COHORT#<code>` | `PROFILE#<canvasId>` | `displayName` opcional, editado pelo admin em "Turmas e acessos" |
| `COHORT#<code>` | `PARTICIPATION#<canvasId>` | Participação do aluno na turma: `status` (`ACTIVE` ou `WITHDRAWN`), `updatedAt`, `updatedBy`. Sem item, o aluno é ativo |
| `COHORT#<code>` | `REMINDER#<pubId>#<canvasId>` | Estado do envio: `sending`, `sent`, `failed` ou `unknown` |
| `USER#<sub>` | `TEACH#<code>` | Vínculo de instrutor (visão do usuário) |
| `USER#<sub>` | `STUDY#<code>` | Vínculo do aluno com o `canvasId` |
| `REQUESTS` | `<sub>` | Solicitação de acesso de instrutor |
| `EMAIL#<messageId>` | `DELIVERY` | Último evento SES relevante |

**Participação.** O Canvas continua sendo a fonte da matrícula e das notas. `PARTICIPATION#` é uma marca local do portal, aplicada na leitura, como o nome de exibição:
- `WITHDRAWN` (desistente) tira o aluno das métricas e estatísticas da turma e dos lembretes; ele continua listado, com a situação acadêmica de sempre;
- `ACTIVE`, ou a ausência do item, é a participação normal;
- sincronização com o Canvas, publicação e Restore não tocam na marca;
- o aluno não vê o status: ele só vem nas leituras do instrutor (relatório, Notas da turma, prévia do lembrete).

A rota exige o status esperado (`expectedStatus`) e responde 409 quando outra pessoa mudou antes. Cada mudança grava a marca e um `AUDIT#` na mesma transação.

**Rollback do backend com participação.** Com o frontend capaz de marcar desistentes (C7.2.4), um backend anterior à C7.2.2 não é um rollback seguro em geral. Ele ignora `PARTICIPATION#`: qualquer aluno marcado como `WITHDRAWN` voltaria a contar nas métricas e poderia receber lembretes. Antes de voltar para uma versão assim, é preciso garantir que não exista nenhuma marca `WITHDRAWN` efetiva e impedir novas marcações durante a janela. Voltar para uma versão a partir da C7.2.2 continua seguro.

## S3 de importações

`cohorts/<code>/<draftId>/source.csv` guarda o arquivo original (na atualização automática, o CSV montado a partir da API do Canvas) e `cohorts/<code>/<draftId>/snapshot.json` guarda o snapshot normalizado (atividades, alunos e notas brutas). Publicar não copia arquivos: a publicação aponta para o snapshot do rascunho e grava `history.json` com o resumo por aluno.

O snapshot contém a turma inteira. O backend filtra o aluno antes de responder e nenhuma rota devolve URL de download.

## Frontend: módulos e responsabilidades

Módulos ES servidos como estão, sem bundler: `index.html` carrega um único script, `app.js` (`type="module"`), e o navegador resolve os demais imports.

| Módulo | Responsabilidade |
| --- | --- |
| `app.js` | Raiz da composição: `render()` e a escolha da página pela view, listeners globais e `actions`, `busy()`, `start()`/`boot()`, sessão, troca de turma, student-view e composição entre domínios. Chama `api.js` direto no boot, no relatório, no resumo da turma, no foco e em operações curtas que terminam em `boot()`. |
| `api.js` | Rede: chamadas autenticadas à API (rotas, token, retentativa de GET, mensagens de erro, expiração da sessão via `configure({ config, onSessionExpired })`), envio de anexos direto ao S3 e as duas chamadas públicas da confirmação de cadastro ao Cognito, sem token. Não conhece DOM, `state` nem navegação. |
| `state.js` | O objeto `state`, o mesmo em todos os módulos: fonte única do estado de interface e de domínio no navegador. Não importa nada. |
| `ui.js` | Helpers de apresentação, markup compartilhado (menu, cabeçalhos, `errorPanel()`) e `notice()`. Lê `state` quando precisa, mas não é dono dele. |
| `pages/*` | Montam o HTML de cada tela a partir de `state`; o `app.js` encaixa o resultado no layout (a tela de entrada e o resumo `?turma=` escrevem direto em `#app`; a confirmação de cadastro ocupa a coluna de texto da tela de entrada). Não chamam a rede nem alteram `state`. |
| `handlers/*` | Regras de cada domínio (`access`, `import`, `admin-feedback`, `feedback`, `reminders`, `signup-confirmation`): chamam `api.js`, alteram `state` e pedem `render()`. |

Em resumo: a page diz como representar, o handler o que fazer, o `app.js` como conectar, o `api.js` como falar com o backend e o `state.js` onde vive o estado compartilhado. Completam o frontend `auth.js` (login e tokens, ver [Componentes](#componentes)), `student-journey.js`, `canvas-links.js` e `participation.js` (regras puras usadas pelas pages) e `demo.js` (transporte com dados fictícios).

### Dependências e ciclos

Imports conferidos no código:

```
index.html ──► app.js
                 ├──► auth.js
                 ├──► api.js ──► auth.js
                 ├──► state.js
                 ├──► ui.js ──► state.js
                 ├──► handlers/* ──► api.js, state.js, ui.js
                 ├──► pages/* ──► state.js, ui.js
                 │       ├──► student-journey.js, canvas-links.js, participation.js
                 │       ├──► outra page, para reaproveitar trechos de tela
                 │       └──► constante ou regra pura de um handler, quando precisa de definição única
                 └──► demo.js   (import dinâmico, só no modo de demonstração)
```

Ninguém importa `app.js`, e handler não importa outro handler nem page. O grafo não tem ciclos, por decisão: `app.js` já importa os handlers, então handler → `app.js` fecharia um ciclo; handler → handler esconderia uma composição que pertence ao `app.js`. Um teste de arquitetura percorre o grafo a partir do `app.js` e falha em qualquer ciclo.

### Handlers

Um handler importa só `api.js`, `state.js` e `ui.js` e recebe `render` por `configure({ render })`, que o `app.js` chama uma vez ao carregar. Não registra listeners e não é dono de `busy()`, do boot nem da navegação global. Pode abrir uma tela do próprio fluxo (os lembretes abrem a prévia individual e a de lote), mas menu, troca de turma, student-view e o que vem depois de publicar ou restaurar ficam no `app.js`.

Quando dois domínios se encontram, quem compõe é o `app.js`. Exemplo: ao abrir um item da lista de feedbacks do admin, o handler `admin-feedback` só marca a seleção, redesenha e devolve o item; o `app.js` move o foco e, se houver anexos, pede ao handler `feedback` que os carregue.

`configure({ render })` é mantido de propósito: deixa explícita a única dependência do handler em relação à raiz, permite testá-lo isolado com um `render` simulado e evita o import handler → `app.js`. Não há framework nem container de injeção; `configure` só guarda `render`, e o teste de arquitetura recusa qualquer outra dependência injetada.

### O que fica no `app.js`

- **Listeners globais** (`click`, `change`, `input` e `submit` delegados no `document`, e `beforeunload`), assim como o do seletor de imagens: a ordem dos ramos do clique faz parte do comportamento, `busy()` é transversal (desabilita o elemento durante a operação e transforma erro em `notice()`), o foco pode envolver mais de um domínio e a student-view restringe ações de todos eles. Handlers e pages não registram listeners.
- **Student-view** (admin visualizando como aluno): cruza URL (`?modo=`), `sessionStorage`, relatório, boot, navegação, Turmas e acessos e Feedbacks. É cola transversal, não um domínio.
- **Participação** (marcar desistente ou reativar, no detalhe do aluno): confirma, chama `api.js` e recarrega o detalhe (handler de Lembretes) e o relatório. Cruza dois domínios, como o Restore. Só o `app.js` chama a rota.
- **`start()` e `boot()`**: configuração, sessão e retorno do login, contexto salvo, turmas, retomada da view e carga inicial de cada domínio. A raiz orquestra; os handlers implementam os domínios.
- **Tela sem sessão** (`publicPage()`): a tela de entrada e, nela, a confirmação de cadastro, com o foco de cada etapa e o único timer que libera o reenvio.

### Confirmação de cadastro

Para quem criou a conta e não concluiu a confirmação do e-mail. Na tela de entrada, **Confirmar cadastro** abre o fluxo: e-mail, código e login. O navegador chama direto a API pública do Cognito (`ResendConfirmationCode` e `ConfirmSignUp`) com o ClientId público do `config.json`, sem token, sem cookie e sem passar pelo backend; nada disso depende de Terraform. O botão só aparece com `region` e `userPoolClientId` na configuração.

- `api.js` normaliza o e-mail, monta as duas chamadas e traduz os erros da AWS em categorias.
- `handlers/signup-confirmation.js` decide a etapa e o erro de domínio, espera 60 s entre reenvios e descarta respostas atrasadas.
- `pages/signup-confirmation.js` mostra cada etapa com textos fixos.
- O `app.js` liga as actions e os dois formulários e compõe a tela de entrada (`publicPage()`).

Todo resultado do reenvio que depende da conta (inexistente, já confirmada, com limite de envios atingido) deixa a mesma tela de um envio aceito; falhas técnicas aparecem como são. O código digitado vai do campo direto para a chamada e nunca fica no `state`, na URL, em storage ou no console. Confirmar não cria sessão: depois, **Fazer login** é o login de sempre.

### Estado

- `state.js` é o único módulo que exporta `state`, e todos o importam direto de `state.js`. Não criar reexport por conveniência.
- `app.js` e os handlers alteram `state`; `ui.js` e as pages só leem.
- Estado privado que não aparece na tela pode ficar no próprio módulo, como o contador de geração de uma requisição.

### Respostas fora de ordem

Quando uma resposta antiga pode chegar depois de uma mais nova (troca de turma ou de view, cliques repetidos, paginação):

1. guardar o contexto antes de chamar a API (turma, view, item);
2. se duas chamadas da mesma operação podem se sobrepor, numerar a requisição com um contador privado do módulo (`const request = ++contador`), porque a guarda de contexto sozinha não distingue duas respostas da mesma turma;
3. antes de aplicar sucesso, erro ou fim do carregamento, conferir se ainda é a requisição atual e se o contexto continua valendo; se não, descartar a resposta sem alterar `state`.

O contador não é obrigatório em toda chamada. Sair de um contexto pode invalidar a requisição em andamento incrementando o contador.

### Quando criar um handler

Quando houver uma fronteira de domínio coesa, em geral com várias destas marcas: página e fluxo próprios, grupo próprio em `api.js`, fatia própria de `state`, regras próprias e ganho real de teste ou manutenção. Não criar handler só para encurtar o `app.js`, mover um trecho pequeno, esconder um callback ou separar cola transversal.

Decisão atual: roteamento (`render` e `content`), student-view, boot, restauração de publicação e trechos curtos que terminam em `boot()` continuam no `app.js`. São composição ou pequenos demais, e extraí-los traria mais callbacks, indireção e risco de ciclo. Reavaliar somente se a responsabilidade crescer de forma independente.

### Actions

O objeto `actions` do `app.js` é o catálogo central dos botões com `data-action`: o listener de clique, depois de tratar os outros atributos `data-*`, executa a action dentro de `busy()`. Toda action precisa de um gatilho real: um `data-action` no markup ou o botão "Tentar novamente" do `errorPanel(mensagem, action)`, único `data-action` montado dinamicamente. Um teste de arquitetura falha com action sem gatilho ou com outro `data-action` dinâmico. Em geral a action só delega ao handler do domínio; quando compõe domínios ou termina em `boot()`, a composição fica escrita nela.

### Cache e ES modules

O frontend publicado usa releases imutáveis em `releases/<id>/`. Assets têm `Cache-Control: public, max-age=31536000, immutable`; o `index.html` da raiz é um ponteiro com `no-cache`. Imports e `config.json` são relativos à própria release, mantendo o grafo de módulos na mesma versão.

No layout plano legado, o cache de 300 segundos podia misturar módulos novos e antigos e impedir o carregamento. Esse era o bloqueio P2 do redesign; não é uma migração ainda pendente. Os arquivos novos continuam entrando nas listas explícitas de build/release e nos testes de arquitetura.

### Deploy seguro de módulos

O fluxo vigente é **PR → CI → merge → deploy automático (push na main, com a árvore aprovada no PR) do frontend**. A pipeline valida e publica o pacote completo, verifica a release remota, atualiza condicionalmente o index e invalida apenas `/` e `/index.html`. Não se faz deploy incremental de módulos na raiz.

A referência operacional é [infra/FRONTEND-RELEASES.md](../infra/FRONTEND-RELEASES.md), incluindo gates, configuração, operações manuais e rollback. `scripts/deploy_frontend.sh` permanece como script legado do layout plano, fora desse procedimento; seu comportamento não foi alterado.

Backend e infraestrutura seguem processo separado com plano Terraform revisado. Publicar a interface não atualiza as Lambdas nem altera a publicação de notas de uma turma.

### Testes do frontend

| Arquivo | O que cobre |
| --- | --- |
| `tests/state.mjs` | Contrato do `state` e referência única entre módulos |
| `tests/architecture.mjs` | Fronteiras e imports, composição no `app.js`, build sem ciclos, actions e guardas da suíte |
| `tests/handlers.mjs` | Handlers isolados, com `render` simulado e transporte falso |
| `tests/browser.mjs` e `tests/*-browser.mjs` | Comportamento ponta a ponta no navegador, com a API simulada |

Os demais unitários cobrem `api.js`, `notice()`, a renovação da sessão e as regras puras. `npm test` roda os unitários; `npm run test:browser` gera o build e roda as suítes de navegador. Duas guardas em `tests/architecture.mjs` mantêm a organização: todo `tests/*.mjs` está registrado em um dos dois scripts (exceto as verificações manuais contra o ambiente publicado, listadas no próprio teste), e toda action tem gatilho real.

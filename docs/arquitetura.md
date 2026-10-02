# Arquitetura

```
Navegador ──► CloudFront ──► S3 (frontend/dist)
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
| Frontend estático | `frontend/` → `scripts/build_frontend.py` → `frontend/dist` | Módulos ES sem bundler. `config.json` é gerado a partir do output do Terraform. |
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

Em resumo: a page diz como representar, o handler o que fazer, o `app.js` como conectar, o `api.js` como falar com o backend e o `state.js` onde vive o estado compartilhado. Completam o frontend `auth.js` (login e tokens, ver [Componentes](#componentes)), `student-journey.js` e `canvas-links.js` (regras puras usadas pelas pages) e `demo.js` (transporte com dados fictícios).

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
                 │       ├──► student-journey.js, canvas-links.js
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

Os arquivos são publicados com `Cache-Control: public,max-age=300`, sem service worker e sem hash no nome. Enquanto o cache não expira, o navegador pode combinar módulos novos com módulos antigos. Um import que não encontra o export pedido impede o carregamento do grafo inteiro, e o portal não abre. Por isso, remover, mover ou renomear um export que outro módulo importa segue uma transição:

1. criar a nova fonte única;
2. manter temporariamente um reexport compatível no lugar antigo (shim);
3. publicar o módulo novo antes do arquivo que o importa;
4. esperar o TTL e conferir que nenhuma versão em cache ainda depende do caminho antigo;
5. remover o shim em uma mudança separada.

Shims são temporários, e não há nenhum ativo. O build copia só os arquivos listados em `scripts/build_frontend.py`; módulo novo entra nessa lista (um teste de arquitetura confere).

### Deploy seguro de módulos

`scripts/deploy_frontend.sh` publica o build inteiro e invalida tudo ([infra/README.md](../infra/README.md#4-gerar-e-publicar-o-frontend)). Para publicar só os módulos alterados:

1. gerar o build do commit exato que será publicado;
2. usar a configuração de produção (`frontend_config` do Terraform);
3. calcular o delta contra os arquivos publicados;
4. enviar o módulo novo antes do arquivo que o importa;
5. conferir no S3, byte a byte, cada arquivo enviado;
6. invalidar no CloudFront só os caminhos alterados;
7. conferir que o CloudFront entrega os mesmos bytes;
8. fazer um smoke só de leitura;
9. repetir a conferência depois do TTL.

Módulos JS vão com `Content-Type: text/javascript` (o navegador recusa módulo ES servido sem tipo JavaScript) e todo arquivo com `Cache-Control: public,max-age=300`. Deploy incremental não usa `--delete`: uma versão em cache ainda pode pedir um arquivo que saiu do build. Backend e infraestrutura seguem o `terraform plan`/`apply`, em processo separado.

### Testes do frontend

| Arquivo | O que cobre |
| --- | --- |
| `tests/state.mjs` | Contrato do `state` e referência única entre módulos |
| `tests/architecture.mjs` | Fronteiras e imports, composição no `app.js`, build sem ciclos, actions e guardas da suíte |
| `tests/handlers.mjs` | Handlers isolados, com `render` simulado e transporte falso |
| `tests/browser.mjs` e `tests/*-browser.mjs` | Comportamento ponta a ponta no navegador, com a API simulada |

Os demais unitários cobrem `api.js`, `notice()`, a renovação da sessão e as regras puras. `npm test` roda os unitários; `npm run test:browser` gera o build e roda as suítes de navegador. Duas guardas em `tests/architecture.mjs` mantêm a organização: todo `tests/*.mjs` está registrado em um dos dois scripts (exceto as verificações manuais contra o ambiente publicado, listadas no próprio teste), e toda action tem gatilho real.

# Implantação em produção

Implantação realizada em 14/09/2026, com Terraform e publicação manual da interface.

- Portal: https://d2bx9t870lzfvc.cloudfront.net
- Conta AWS: `712107929769`; região: `us-east-1`.
- Turma inicial: `BRSA0267`, sem notas reais publicadas.
- CloudFront: `E3LDQGCHVIV9OK`.
- Cognito: `us-east-1_LUKZ5lBuw`.
- API: `https://y7e0g48k4d.execute-api.us-east-1.amazonaws.com`.
- DynamoDB: `restart-portal-prod`.

## Verificação realizada

O teste integrado executou o login real no Cognito com PKCE, importou e publicou um CSV sintético pela API e verificou o isolamento entre duas contas de aluno. Também confirmou a aprovação de um instrutor por turma e sua revogação imediata. As quatro contas temporárias, a turma sintética e os objetos de teste foram removidos.

O portal respondeu por HTTPS; a API recusou acesso anônimo com HTTP 401 e ambos os buckets recusaram acesso direto anônimo com HTTP 403. A configuração publicada corresponde aos endpoints provisionados. O plano Terraform após a implantação terminou sem alterações.

Scripts: `tests/live_accounts.py`, `tests/live_browser.mjs` e `tests/live_readiness.mjs`. A evidência local da execução fica em `infra/terraform/.build/live-smoke-results.json`, ignorada pelo Git. Os testes de contas e navegador criam recursos temporários; o teste de disponibilidade é somente leitura.

## Estado e operação

O estado principal está em `s3://restart-portal-tfstate-712107929769-us-east-1/portal/prod/terraform.tfstate`, com versionamento e lock. O estado local do bootstrap foi copiado para `bootstrap/terraform.tfstate` no mesmo bucket após sua criação. Essa cópia deve ser atualizada se o bootstrap mudar.

Configuração local: `infra/terraform/backend.hcl`, os arquivos `terraform.tfvars` e `portal-config.json`, todos ignorados pelo Git. Os comandos para futuras atualizações estão no [guia de infraestrutura](README.md).

## Primeiro acesso e importação

A conta administradora foi confirmada e liberada conforme o registro abaixo. Para publicar notas, o titular deve importar o CSV da turma, conferindo a prévia e as atividades liberadas. A validação automatizada em produção utilizou dados sintéticos; cada arquivo real deve ser conferido na prévia antes da publicação.

## Identidade visual e login

Em 14/09/2026, a logo fornecida foi adicionada à entrada, ao menu do portal e ao ícone da aba. O Cognito passou a usar Managed Login versão 2, com a mesma logo, tema navy e idioma português do Brasil. O plano Essentials já estava ativo e foi mantido. O Terraform criou uma configuração de branding e atualizou o domínio, sem excluir recursos; o plano posterior confirmou ausência de diferenças.

A configuração está em `infra/terraform/cognito-branding.json`; o arquivo de imagem compartilhado é `frontend/logo.png`. Foram conferidas as telas reais de login, cadastro e recuperação, além do layout móvel e do carregamento da logo. A atualização do frontend foi publicada no S3 e o cache do CloudFront foi invalidado.

Após a troca, o teste integrado real passou novamente: autenticação PKCE, publicação de CSV sintético, isolamento entre alunos e aprovação/revogação de instrutor. As contas e os dados temporários dessa execução também foram removidos.

Em 14/09/2026, a conta `tomas.alric@escoladanuvem.org` foi consultada no Cognito: habilitada, confirmada e com e-mail verificado. O grupo `admin` foi atribuído ao usuário e conferido por leitura posterior. Esse perfil também permite atuar como instrutor em todas as turmas, inclusive `BRSA0267`, por meio da autorização `can_teach`; não exige uma segunda conta ou vínculo de instrutor. Sessões anteriores precisam de novo login para receber o grupo no token.

## Histórico: consulta de convidados e visibilidade individual

Este acesso foi substituído pela consulta autenticada descrita abaixo.

Foi publicada a consulta de convidados em `https://d2bx9t870lzfvc.cloudfront.net/?turma=BRSA0267`. A página de entrada oferece esse acesso no lugar da demonstração. O modo de demonstração fica restrito a localhost para desenvolvimento.

Conforme a definição do titular, os nomes e as médias ficam visíveis por padrão. O aluno cadastrado e com e-mail confirmado pode acessar **Minha visibilidade** e ocultar o próprio nome. As notas permanecem na consulta, com um rótulo sem identificação; instrutores mantêm a identificação completa. A preferência é independente do CSV e permanece após novas publicações e restaurações.

O Terraform criou `GET /guest/cohorts/{code}` (consulta pública resumida) e `GET/POST /cohorts/{code}/privacy` (autenticadas), além de atualizar a Lambda. Foram três recursos criados, um atualizado e nenhum excluído. A verificação posterior terminou sem diferenças. CSVs, e-mails e IDs Canvas continuam fora da resposta pública, e os buckets permanecem privados.

Validação: 39 testes de backend, quatro testes de persistência com Moto, teste Terraform e fluxos de navegador passaram. Na AWS real, foram confirmados nomes visíveis por padrão, ocultação pela conta do aluno, manutenção da escolha após publicar/restaurar e consulta de convidado no celular. A última etapa de login do instrutor excedeu o tempo de navegação na primeira execução; a repetição isolada do login, aprovação e revogação passou. A evidência dessa repetição está em `infra/terraform/.build/guest-live-results.json`.

## Compatibilidade com o CSV real do Canvas

O CSV fornecido em 14/09/2026 foi validado localmente: 59 alunos e 166 atividades reconhecidas. O registro de teste do Canvas na linha 62 tinha um login interno hexadecimal em vez de e-mail. O importador passou a excluir essa conta antes da contagem de alunos, da sugestão de atividades e dos cálculos, exibindo um aviso na prévia. As mensagens de erro agora preservam a linha física original, inclusive após a linha Points Possible e linhas vazias.

Foram executados 44 testes de backend, quatro testes de persistência e testes de navegador com o novo aviso. O arquivo real foi apenas lido localmente para validação; essa correção não publicou suas notas nem alterou o CSV original.

## Correção de Turmas e acessos e contexto de navegação

A consulta de solicitações foi reproduzida contra o DynamoDB real e falhava por enviar `begins_with(SK, "")`: o serviço recusa valores vazios em condições de chave. `Repository.list` agora filtra pela chave de partição quando não há prefixo; a consulta corrigida foi confirmada no serviço real. A Lambda foi atualizada sem criar ou excluir recursos permanentes.

O frontend identifica **Painel do instrutor**, **Consulta pública**, **Publicações da turma** e **Turmas e acessos**, com página, turma/contexto, perfil e e-mail no cabeçalho. A consulta pública mantém o contexto de login após recarregar e oferece retorno ao painel. A administração exibe carregamento, erro com nova tentativa e mantém a turma selecionada sem reutilizar o relatório de outra turma.

Validação local: 45 testes de backend, cinco de persistência e testes de navegador, incluindo falha/recuperação da consulta, troca de turma e identificação da sessão na consulta pública.

No ambiente publicado, uma conta temporária confirmou o login real, HTTP 200 ao abrir e atualizar solicitações, contexto autenticado após recarregar a consulta pública e retorno ao painel no celular. A evidência local fica em `infra/terraform/.build/access-ui-results.json`. A verificação não alterou turmas, notas ou vínculos.


## Login obrigatório para consultar notas

Em 14/09/2026, o acesso de convidados foi removido conforme a nova definição do titular. **Notas da turma** exige login Cognito e matrícula na publicação atual da turma, autorização de instrutor ou perfil administrador. O resumo preserva a opção de ocultar nomes e não inclui e-mails, IDs Canvas ou atividades individuais dos colegas. O link `/?turma=BRSA0267` abre a entrada quando não há sessão e só consulta notas após autenticação.

O Terraform removeu `GET /guest/cohorts/{code}`, criou `GET /cohorts/{code}/class-report` com JWT/escopo `portal/access` e atualizou a Lambda. Plano aplicado: um recurso criado, um atualizado e um removido (a rota antiga). A interface foi publicada no S3 e o CloudFront recebeu invalidação. Nenhuma publicação de notas foi alterada.

Também foram publicados os quatro filtros de status na consulta da turma e a lista completa de KCs e LABs pendentes na área pessoal, separados por categoria.

Validação local: 48 testes de backend, cinco testes de persistência com Moto, testes de navegador e um teste Terraform passaram. Incluem matrícula ausente/removida, revogação de instrutor, ocultação do nome, ausência de token e sessão expirada.

Validação real somente de leitura: a nova consulta retorna HTTP 401 sem token, a rota antiga retorna 404 e os buckets seguem recusando acesso direto anônimo (403). O navegador confirmou que o link direto não busca notas sem login, não oferece entrada de convidado, funciona no celular e abre a tela do Cognito. Nenhuma credencial foi submetida nesse teste. Evidência: `infra/terraform/.build/login-required-readonly-results.json`.


## Importação de alunos sem e-mail no Canvas

Em 14/09/2026, o CSV BRSAO257 falhou na linha 35 porque SIS Login ID estava vazio em um aluno real. A correção geral permite e-mails ausentes sem descartar alunos ou notas: armazena `email: null`, gera aviso com a linha original e identifica o registro na prévia e no painel do instrutor. Novos vínculos continuam exigindo e-mail confirmado correspondente ao Canvas; vínculos já estabelecidos por ID Canvas são preservados. E-mails preenchidos inválidos e IDs duplicados continuam sendo rejeitados.

Validação local dos arquivos fornecidos: BRSAO257 com 56 alunos/75 atividades/um aluno sem e-mail; BRSAO267 com 59 alunos/166 atividades. Contas de teste reconhecidas foram excluídas com aviso. Nenhum arquivo original foi alterado e nenhuma publicação de notas foi feita nessa correção.

Passaram 51 testes de backend, seis de persistência com Moto e testes de navegador. A cobertura inclui múltiplos e-mails ausentes, preservação dos cálculos, serialização, bloqueio de novos vínculos, correção posterior pelo CSV e manutenção de vínculos existentes.

Terraform aplicado: zero recursos criados, uma Lambda atualizada, zero excluídos. Interface publicada no S3 com invalidação do CloudFront.


## Pendências do aluno para instrutores e preparação do SES

Em 14/09/2026 foram publicados **Ver detalhes** na coluna Pendências e a tela com KCs/LABs individuais, prévia do e-mail de apoio e envio individual confirmado pelo instrutor. Respostas vão ao e-mail do instrutor autenticado. O backend valida a autorização por turma, recalcula a mensagem e reserva o envio por aluno/publicação no DynamoDB. Não há disparo automático nem envio de mensagens aos alunos durante a implantação.

Terraform aplicado: cinco recursos criados (duas rotas JWT, identidade SES, configuration set e política IAM), uma Lambda atualizada e nenhum recurso removido. A identidade `tomas.alric@escoladanuvem.org` foi criada em us-east-1 e está **PENDING** de confirmação. A conta permanece no sandbox. A liberação de produção não foi solicitada: aguarda confirmação do titular sobre autorização dos destinatários exigida pela AWS. Pedido preparado em `infra/ses-production-request.json`; detalhes em `infra/SES.md`.

Validação: 62 testes do backend, nove testes de integração/contrato (Moto e Stubber), teste Terraform e fluxo de navegador com envio simulado passaram. Cobertura inclui duplicação, prévia desatualizada, falhas de envio, cenário sem e-mail, autorização por turma, HTML escapado e celular. A interface foi publicada no S3 com invalidação do CloudFront.


## Pedido de produção SES

Após confirmação explícita do titular sobre autorização dos alunos, o pedido de produção foi enviado em us-east-1. O SES aceitou a submissão, mas a consulta posterior registrou `DENIED`, caso `178941187900377`, com produção ainda desabilitada. O remetente continua pendente de verificação.

O motivo não pôde ser consultado pela API AWS Support, que retornou SubscriptionRequiredException. A consulta e eventual resposta ao caso devem ser feitas pelo Support Center no console; rascunho preparado em `infra/SES-REVIEW.md`. Nenhum lembrete foi enviado.


## Simplificação dos status e pausa dos e-mails de apoio

A pedido do titular, os cards do instrutor passaram a Total de alunos, Em dia, Atenção e Crítico. O card e o filtro de graduados foram retirados; a lista completa de alunos permanece em Todos os status. Os mesmos nomes são usados na consulta da turma e nos indicadores individuais. As regras acadêmicas de cálculo não mudaram.

A área de prévia/envio de e-mail foi removida da interface. `REMINDERS_ENABLED=false` bloqueia envio na API e permite consultar KCs/LABs pendentes sem chamar o SES. Recursos SES e registros anteriores foram preservados; aprovação posterior do SES não reativa os envios.

Validação: 63 testes de backend, navegador (cards, filtros, pendências sem e-mail e celular) e teste Terraform passaram. Plano da atualização: zero recursos criados, uma Lambda atualizada e zero excluídos.


## Escala responsiva para monitores grandes

A interface passou a usar tipografia em rem, com escala fluida da raiz a partir de 1280px de viewport. Menu lateral, largura útil, cards, campos, tabela e indicador circular acompanham o crescimento. Com fonte padrão, o texto da tabela chega a 17,5px em Full HD, 21px em QHD e 28px em 4K, contra 12px fixos anteriormente. O layout móvel foi preservado.

Navegador validado em 1366×768, 1920×1080, 2560×1440 e 3840×2160, além do celular. As verificações cobrem uso de largura, crescimento da tipografia, indicador circular sem transbordamento, navegação, filtros e pendências. Alteração somente de interface, publicada no S3/CloudFront; sem mudanças na API ou nas notas.


## Tela inicial ajustada à altura do MacBook

A entrada passou a usar altura disponível da janela em vez da área central mínima fixa de 680px. Título, arte, logo e espaçamentos respondem à altura, mantendo login, instruções de cadastro e rodapé visíveis nas dimensões testadas. As páginas internas preservam a escala anterior.

Testes locais de navegador em Retina (fator 2): 1512×982, 1512×850, 1512×755, 1440×780, 1280×650, 1024×640, 1800×1050 e 3024×1964, sem rolagem da entrada ou corte dos elementos essenciais. A suíte de navegação e celular também passou. Publicação restrita a `styles.css`, com invalidação desse caminho no CloudFront; sem alteração de notas ou infraestrutura.

## Limpeza de contas não confirmadas (24/09/2026)

A pedido do titular, as **26 contas `UNCONFIRMED`** do user pool foram apagadas (`admin-delete-user`), para esses alunos refazerem o cadastro do zero: 23 com e-mail presente nas publicações atuais (9 da BRSA0267 e 14 da BRSA0257) e 3 com e-mail que não bate com nenhum aluno das duas turmas no Canvas (esses precisam se cadastrar com o e-mail do Canvas para ver as notas). Antes de apagar, foi conferido que:

- nenhuma delas tinha item `USER#`, pedido de instrutor (`REQUESTS`) ou grupo no Cognito (conta não confirmada nunca consegue entrar);
- o Cognito já envia pela identidade de domínio `escoladanuvem.org` com DKIM e MAIL FROM em `SUCCESS` (a falha de DMARC registrada em `infra/SES.md` está resolvida), e a lista de supressão do SES estava vazia;
- a lista foi relida no momento da exclusão e só contas ainda `UNCONFIRMED` foram apagadas.

Resultado: pool com 34 contas, todas `CONFIRMED` e com e-mail verificado.

## Normalização do formato dos registros no DynamoDB (24/09/2026)

Os controles de concorrência de `Repository.transaction` comparam o `data` gravado com `json.dumps(..., sort_keys=True)`. Registros gravados antes dessa mudança tinham as chaves fora de ordem, então qualquer operação que os atualizasse falhava com `Conflict`. Isso afetava publicar, restaurar, configurar turma, aprovar ou revogar instrutor e desvincular aluno. Com autorização do titular, **47 dos 99 itens** foram regravados com as mesmas chaves e valores, só com as chaves em ordem. Cada escrita foi condicionada ao valor antigo. Resultado: 0 falhas e nenhum registro fora de ordem.

## Atualização automática pelo Canvas ligada (24/09/2026)

Ver [todo/17](../todo/17-integracao-api-canvas.md#ativação-2026-09-24). O agendamento roda às 6h e às 18h (horário de Brasília), e as duas turmas estão com `autoSync`. A primeira execução publicou nas duas turmas; a segunda não encontrou mudanças. O token pessoal expira em 22/12/2026.

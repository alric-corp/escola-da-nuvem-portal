# Infraestrutura do portal AWS re/Start

Infraestrutura e backend têm implantação separada com Terraform e credenciais locais do AWS CLI. O frontend é publicado automaticamente pelo GitHub Actions após merge na `main`, com CI aprovado no PR e árvore testada equivalente, conforme o [runbook de releases](FRONTEND-RELEASES.md). A sincronização Canvas existente executa às 6h e às 18h (horário de Brasília), independentemente do deploy da interface.

O ambiente da turma `BRSA0267` foi implantado. Consulte o [registro da implantação e verificações](DEPLOYMENT.md) para endereço, recursos e configuração do administrador.

## O que esta entrega implementa

- S3 privado para a interface e CloudFront com HTTPS e Origin Access Control (OAC).
- Outro bucket privado, versionado e criptografado para os CSVs originais. Ele **não** é uma origem do CloudFront.
- Cognito com cadastro por e-mail, confirmação do endereço, MFA opcional via aplicativo autenticador, cliente público OAuth authorization code e grupos `admin`, `instructor`, `student`.
- Managed Login versão 2 no plano Essentials, com logo e tema escuro definidos no Terraform (`auth.tf` e `cognito-branding.json`). O portal solicita o idioma `pt-BR`.
- HTTP API + Lambda Python 3.13 protegida por JWT e escopo `portal/access`, com identificação da conta, turmas, importação, publicação, consulta individual, histórico e aprovação/revogação de instrutores.
- Todas as rotas de notas exigem autenticação. `GET /cohorts/{code}/class-report` retorna o resumo somente para instrutores autorizados ou administradores. A rota anônima `/guest/cohorts/{code}` foi removida; alunos consultam apenas o próprio relatório em `GET /cohorts/{code}/report`. E-mails, IDs Canvas e arquivos não entram no resumo compartilhado.
- DynamoDB sob demanda, com recuperação pontual e proteção contra exclusão. Cadastro inicial da turma `BRSA0267`, configurável.
- Logs de API e Lambda com retenção de 14 dias, sem registrar corpo de requisições ou tokens no código fornecido.
- Estado principal remoto em S3 com versionamento, criptografia e lock nativo do Terraform.

O código do portal está em `frontend/` e `backend/`. O Terraform empacota o backend; o [passo 4](#4-gerar-e-publicar-o-frontend) aponta para a publicação automática da interface. A sincronização Canvas publica notas quando há mudança acadêmica válida; a importação de CSV pela área do instrutor continua disponível como complemento ou recuperação. Copiar um CSV diretamente para o bucket não processa nem publica notas. Consulte [o guia da aplicação](../frontend/README.md) para demonstração local e regras do importador.

## Requisitos e credenciais

- Terraform >= 1.10 e < 2.0, AWS CLI v2 e Python 3 para os testes locais.
- Credenciais com acesso para criar S3, CloudFront, Cognito, DynamoDB, API Gateway, Lambda, CloudWatch Logs e as roles/policies IAM do projeto, incluindo `iam:PassRole` para a Lambda.
- Região inicial: `us-east-1`. Usa os endpoints padrão de CloudFront/Cognito/API Gateway, sem exigir domínio próprio ou certificado ACM.

Execute os comandos a partir da raiz do repositório. Para usar um perfil específico, exporte `AWS_PROFILE` antes de iniciar; sem isso, o Terraform usa a cadeia padrão de credenciais, incluindo o perfil `default` configurado por `aws configure`.

```sh
# Apenas se você usa um perfil nomeado:
export AWS_PROFILE=meu-perfil-pessoal

aws sts get-caller-identity
```

Confira a conta retornada. Copie seu ID de 12 dígitos para `aws_account_id` nos passos abaixo. O provider e o backend verificam a conta esperada. Credenciais presentes em variáveis de ambiente podem ter precedência sobre o arquivo do AWS CLI; a chamada STS confirma a identidade efetiva.

## 1. Criar o bucket do estado — uma única vez

Crie `infra/bootstrap/terraform.tfvars` com seu ID real:

```hcl
aws_account_id = "123456789012"
aws_region     = "us-east-1"
```

```sh
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output -raw backend_config > infra/terraform/backend.hcl
```

Revise o plano antes de aplicá-lo. Esta etapa cria apenas o bucket de estado e suas configurações. O estado do próprio bootstrap fica em `infra/bootstrap/terraform.tfstate`: guarde uma cópia em armazenamento privado, fora do Git. O estado da aplicação ficará no bucket criado. Não apague o diretório do bootstrap sem guardar esse estado.

O lock usa `use_lockfile = true`; não há tabela DynamoDB exclusiva para locks. O bucket não elimina versões antigas automaticamente. Referência: [backend S3 do Terraform](https://developer.hashicorp.com/terraform/language/backend/s3).

## 2. Planejar e criar a infraestrutura do portal

```sh
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

Edite `infra/terraform/terraform.tfvars`: use a mesma conta e região do bootstrap; mantenha `initial_cohort = "BRSA0267"` para sua turma atual.

```sh
terraform -chdir=infra/terraform init -backend-config=backend.hcl
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -out=portal.tfplan
terraform -chdir=infra/terraform apply portal.tfplan
terraform -chdir=infra/terraform output
```

O apply cria recursos faturáveis na sua conta, e a distribuição CloudFront pode levar vários minutos para ficar disponível. Não há EC2, NAT Gateway, RDS ou servidor permanente nesta configuração. Uso, armazenamento, backups e logs ainda geram cobrança; esta entrega não calcula uma estimativa mensal nem cria alertas de orçamento.

Os arquivos `.terraform.lock.hcl` devem ser versionados para manter as versões verificadas dos providers. Arquivos de estado, planos, configurações locais e CSVs estão ignorados pelo Git.

## 3. Configurar o primeiro administrador

Após publicar a interface no passo 4, clique em **Entrar no meu portal**, crie sua conta no Cognito e confirme o e-mail. Também é possível criar a conta pelo console AWS; nesse caso conclua a troca da senha temporária e a verificação do endereço antes do uso.

O console Cognito permite adicionar o usuário ao grupo `admin`. Alternativamente, após existir uma conta confirmada:

```sh
portal_pool_id=$(terraform -chdir=infra/terraform output -raw user_pool_id)
aws cognito-idp admin-add-user-to-group \
  --region us-east-1 \
  --user-pool-id "$portal_pool_id" \
  --username 'seu-email@escoladanuvem.org' \
  --group-name admin
```

Use a região configurada se tiver alterado o padrão. Faça login novamente para obter um token com o grupo atualizado. Não coloque senhas em Terraform: elas seriam gravadas no estado.

Ter e-mail `@escoladanuvem.org` **não** concede privilégios. Após confirmar o endereço, o usuário pode solicitar acesso de instrutor na tela inicial. Em **Turmas e acessos**, um administrador aprova e vincula o instrutor à turma. Esses vínculos ficam no DynamoDB e são verificados a cada requisição; um grupo `instructor` do Cognito, sozinho, não concede acesso. A remoção do vínculo corta imediatamente o acesso à turma. Usuários sem vínculo de instrução são tratados como alunos e precisam constar no CSV publicado. O grupo Cognito `admin` continua sendo a permissão global configurada manualmente; sua revogação depende da expiração do token, de até 15 minutos.

O envio `COGNITO_DEFAULT` tem limite documentado de **50 mensagens por dia por conta**. A configuração atual em `auth.tf` usa `DEVELOPER` com SES; os recursos e o histórico dessa configuração estão em [SES.md](SES.md). Cadastro, recuperação de senha e lembretes têm contratos distintos, e não são habilitados pelo deploy do frontend. Referência: [quotas do Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html).

## 4. Gerar e publicar o frontend

O procedimento normal é **PR → CI aprovado → merge na `main` → deploy automático, sem segunda suíte**. A pipeline publica uma release imutável, ativa o `index.html` condicionalmente, invalida somente `/` e `/index.html` e executa o smoke público. O [runbook de releases](FRONTEND-RELEASES.md) é a referência para pré-condições, acompanhamento, operações manuais e recuperação. O portal usa o endereço CloudFront existente; domínio personalizado não é requisito.

Para gerar apenas um build local com a configuração pública:

```sh
terraform -chdir=infra/terraform output -json frontend_config > portal-config.json
python3 -B scripts/build_frontend.py --config portal-config.json
```

Esse JSON contém apenas configuração pública. O frontend usa authorization code com **PKCE S256**, verifica `state`/`nonce` e envia o **access token** com escopo `portal/access` no cabeçalho `Authorization: Bearer ...` da API. O callback é a raiz HTTPS do CloudFront. O backend confirma o `sub` e o e-mail verificado direto pelas claims do access token, incluídas por um gatilho Cognito "pre token generation" (ver TODO 04); só cai de volta no endpoint `userInfo` do Cognito se a claim ainda não existir. O frontend guarda o access e o refresh token em `localStorage`; o access token expira em 15 minutos e é renovado com o refresh token (7 dias) sem novo login.

O build copia uma lista explícita de arquivos para `frontend/dist`; essa pasta local não substitui o pacote versionado da pipeline. Não publique a raiz do repositório nem sincronize o build diretamente na raiz do bucket web. O script [`scripts/deploy_frontend.sh`](../scripts/deploy_frontend.sh) está preservado como **legado**, fora do procedimento normal: ele grava arquivos planos e invalida `/*`, podendo substituir o ponteiro da release ativa. Não o execute para atualizar a interface do ambiente versionado.

Proposta separada, não implementada nesta revisão: se o script legado continuar disponível para uso administrativo deliberado, avaliar uma recusa explícita quando detectar um ponteiro de release ativo. Isso reduziria o risco de executar o procedimento plano por engano, preservando um caminho de recuperação revisado. O script e seus comandos permanecem inalterados.

O frontend mantém a navegação na raiz, sem necessidade de fallback de erros para `index.html`. A API usa domínio separado e CORS permite somente a origem do portal. As respostas da API usam `Cache-Control: no-store`; o frontend usa `no-cache` no index e cache imutável nos assets versionados, conforme o [runbook](FRONTEND-RELEASES.md).

## 5. Operação posterior

Mudanças de infraestrutura e do backend: gere e revise um novo `terraform plan -out=portal.tfplan`, depois aplique esse plano pelo procedimento separado. Mudanças de interface seguem o [deploy automático](FRONTEND-RELEASES.md#deploy-automático). Atualizações de notas não exigem Terraform nem deploy: usam a sincronização Canvas existente ou, quando necessário, **Atualizar notas** com CSV completo, prévia e confirmação das atividades liberadas. CI verde e frontend publicado não comprovam implantação do backend.

O modelo inicial da tabela usa `PK`/`SK`. A turma é cadastrada como `PK=COHORT#BRSA0267`, `SK=METADATA`. O Terraform deixa de gerenciar mudanças no conteúdo desse item após a criação. Novas turmas devem ser novos registros, não mudanças em `initial_cohort`. Essa variável não é uma lista das turmas do sistema.

Os snapshots de notas e os CSVs originais ficam no S3 privado. O DynamoDB guarda vínculos `sub` ↔ ID Canvas ↔ turma, permissões por turma, metadados de publicação e o ponteiro para a versão atual. A publicação e a troca de ponteiro são transacionais; uma prévia baseada em versão antiga é recusada. A consulta do aluno retorna apenas suas próprias notas. O histórico do aluno mostra até 12 publicações, enquanto o instrutor pode consultar e restaurar as anteriores.

Para um segundo ambiente, use outro `environment`, outro arquivo de estado e outra pasta de trabalho/checkout. Não mude `environment` sobre o mesmo estado de produção para simular um novo ambiente.

## Validação local sem criar recursos

```sh
terraform -chdir=infra/bootstrap init -backend=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform test
python3 -B -m unittest discover -s backend -v
terraform fmt -check -recursive infra
git diff --check
```

O teste Terraform usa um provider AWS simulado e executa um plano, sem criar recursos. O provider archive apenas empacota o código local. Os testes Python verificam autenticação, escopo, origem dos papéis e ausência de promoção automática por domínio. Essas verificações não substituem `plan` com credenciais reais nem um teste de login/API após o deploy.

Após implantar, valide login e consultas com identidades de teste previamente autorizadas, sem usar dados de alunos como evidência. O QA autenticado real permanece pendente de execução; CI e smoke estático não o substituem. Chamadas de notas sem token devem ser recusadas pelo API Gateway; a antiga rota de convidados deve retornar 404. Uma conta de aluno deve consultar somente o próprio relatório, enquanto uma conta sem vínculo deve receber 403. A consulta coletiva deve ser permitida apenas a instrutores autorizados e administradores. URLs diretas dos buckets devem continuar recusando acesso anônimo. Publicação de CSV sintético e outras mutações são cobertas localmente com mocks ou em ambiente apropriado e autorizado; não são uma rotina obrigatória em produção após cada implantação. Os testes locais não validam a configuração efetiva do Cognito/CloudFront na sua conta.

## Proteção e remoção

Bucket de estado, CSVs, tabela, turma inicial e user pool têm proteção contra destruição pelo Terraform. DynamoDB e Cognito também têm proteção de exclusão no serviço. `terraform destroy` não é um caminho de limpeza automática desta configuração. A remoção exige uma alteração deliberada dessas proteções e revisão dos dados/versionamentos que precisam ser preservados.

Documentação de referência: [S3 privado com CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [JWT authorizer do API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html) e [runtimes Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).

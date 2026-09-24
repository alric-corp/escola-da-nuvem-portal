# Infraestrutura do portal AWS re/Start

Implantação manual com Terraform e as credenciais locais do AWS CLI. Não há pipeline, chaves no código, acesso automático ao Canvas ou publicação automática de notas.

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

O código do novo portal está em `frontend/` e `backend/`. O Terraform empacota a Lambda; a interface é publicada manualmente no passo 4. Até a publicação da interface, o bucket web fica vazio. Os CSVs devem ser enviados pela área do instrutor: copiar um arquivo diretamente para o bucket não processa nem publica notas. Consulte [o guia da aplicação](../frontend/README.md) para demonstração local e regras do importador.

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

O envio padrão de e-mails do Cognito tem limite documentado de **50 mensagens por dia por conta**. Para cadastrar uma turma inteira e atender recuperação de senha, avalie configurar SES antes do lançamento. SES e a verificação de domínio remetente não são criados aqui. Referência: [quotas do Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html).

## 4. Gerar e publicar o frontend

```sh
terraform -chdir=infra/terraform output -json frontend_config > portal-config.json
python3 -B scripts/build_frontend.py --config portal-config.json
```

Esse JSON contém apenas configuração pública. O frontend usa authorization code com **PKCE S256**, verifica `state`/`nonce` e envia o **access token** com escopo `portal/access` no cabeçalho `Authorization: Bearer ...` da API. O callback é a raiz HTTPS do CloudFront. O backend confirma o `sub` e o e-mail verificado direto pelas claims do access token, incluídas por um gatilho Cognito "pre token generation" (ver todo/04); só cai de volta no endpoint `userInfo` do Cognito se a claim ainda não existir. O frontend guarda o access e o refresh token em `localStorage`; o access token expira em 15 minutos e é renovado com o refresh token (7 dias) sem novo login.

Não publique a raiz deste repositório no S3: ela contém Terraform e poderá conter CSVs e planos locais. O build copia uma lista explícita de arquivos para `frontend/dist`. Publique somente essa pasta:

```sh
./scripts/deploy_frontend.sh

# Execução manual:
portal_web_bucket=$(terraform -chdir=infra/terraform output -raw frontend_bucket)
portal_distribution_id=$(terraform -chdir=infra/terraform output -raw cloudfront_distribution_id)

aws s3 sync frontend/dist/ "s3://$portal_web_bucket/" \
  --cache-control 'public,max-age=300'
aws cloudfront create-invalidation \
  --distribution-id "$portal_distribution_id" \
  --paths '/*'
```

O frontend mantém a navegação na raiz, sem necessidade de fallback de erros para `index.html`. A API usa domínio separado e CORS permite somente a origem do portal. Todas as respostas da aplicação usam `Cache-Control: no-store`.

## 5. Operação posterior

Mudanças de infraestrutura e da Lambda: gere e revise um novo `terraform plan -out=portal.tfplan`, depois aplique esse plano. Mudanças de interface: gere o build, publique e invalide o cache. Atualizações de notas são feitas em **Atualizar notas**, sem Terraform e sem deploy: envie o CSV, confirme as atividades liberadas, atualize a prévia se necessário e publique.

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

Após implantar, teste login real, publicação de um CSV sintético e acesso com duas contas de aluno diferentes. Todas as chamadas de notas sem token devem ser recusadas pelo API Gateway; a antiga rota de convidados deve retornar 404. Uma conta de aluno deve consultar somente o próprio relatório, enquanto uma conta sem vínculo deve receber 403. A consulta coletiva deve ser permitida apenas a instrutores autorizados e administradores. URLs diretas dos buckets devem continuar recusando acesso anônimo. Os testes locais não validam a configuração efetiva do Cognito/CloudFront na sua conta.

## Proteção e remoção

Bucket de estado, CSVs, tabela, turma inicial e user pool têm proteção contra destruição pelo Terraform. DynamoDB e Cognito também têm proteção de exclusão no serviço. `terraform destroy` não é um caminho de limpeza automática desta configuração. A remoção exige uma alteração deliberada dessas proteções e revisão dos dados/versionamentos que precisam ser preservados.

Documentação de referência: [S3 privado com CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [JWT authorizer do API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html) e [runtimes Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).

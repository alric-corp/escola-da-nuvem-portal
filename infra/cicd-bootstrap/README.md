# Bootstrap CI/CD do frontend (OIDC → role de deploy)

Terraform isolado da infraestrutura principal. Ele gerencia **apenas** dois recursos:

- `aws_iam_role.frontend_deploy`: a role assumida pelo GitHub Actions;
- `aws_iam_role_policy.frontend_deploy`: a policy inline dessa role, de menor privilégio.

Os demais recursos são lidos por `data` e nunca alterados:

- o provider OIDC `token.actions.githubusercontent.com`, que já existe e é compartilhado por roles de outros projetos;
- o bucket web;
- a distribuição CloudFront;
- a identidade do chamador.

Ficam de fora: Lambdas, DynamoDB, Cognito, Scheduler, SES, recursos da AUTO-5, e o CloudFront e o bucket propriamente ditos.

## Trust

`sts:AssumeRoleWithWebIdentity` só para um job do GitHub que satisfaça **todas** as condições `StringEquals` (sem curingas):

| Claim | Valor |
|---|---|
| `aud` | `sts.amazonaws.com` |
| `sub` | `repo:alric-corp@178685987/escola-da-nuvem-portal@1385899942:environment:production` (subject imutável, ativo no repositório) |
| `repository_id` / `repository_owner_id` | `1385899942` / `178685987` |
| `environment` | `production` |
| `ref` | `refs/heads/main` |

As seis claims acima são documentadas pelo GitHub para todo job que usa um environment, e todas são condition keys aceitas pelo STS para o GitHub.

**`job_workflow_ref` fica fora por padrão.** O GitHub só o documenta para jobs de *reusable workflow*. Composite Actions rodam dentro do job e não alteram nenhuma claim. Por isso a trust não presume o `job_workflow_ref` num job comum.

Ele é um endurecimento opcional, ativado pela variável `trusted_job_workflow_ref`, que aceita um valor exato deste repositório e da branch de deploy, sem curingas. Só deve ser preenchido com o valor observado no token real do job de deploy (operação `verify`), num `apply` revisado. Se a claim faltar, a trust falha fechada.

`workflow_ref` não é uma condition key do STS. `workflow` (o nome do workflow) é aceita, mas é mutável, e por isso não foi adotada.

## State

| Item | Decisão |
|---|---|
| Backend | S3 no bucket de state existente (`restart-portal-tfstate-<conta>-us-east-1`, criado por `infra/bootstrap`) |
| Chave | `cicd/frontend-deploy/terraform.tfstate`. **Nunca** `portal/prod/terraform.tfstate` (a da infraestrutura principal) |
| Proteção | O bucket tem versionamento, SSE-S3, bloqueio público e só aceita TLS. Lock nativo do S3 (`use_lockfile`). `allowed_account_ids` no backend e no provider. A role de deploy **não tem acesso** ao bucket de state |
| Versionamento | Cada `apply` gera uma nova versão do objeto de state. O histórico fica no versionamento do S3 |
| Recuperação | Restaurar a versão anterior do objeto (`aws s3api list-object-versions` / `get-object --version-id`). Em perda total: `terraform import aws_iam_role.frontend_deploy restart-portal-prod-github-frontend-deploy` e `terraform import aws_iam_role_policy.frontend_deploy restart-portal-prod-github-frontend-deploy:frontend-release-publish` |
| Arquivos locais | `backend.hcl` e `terraform.tfvars` são ignorados pelo Git (`.gitignore`: `backend.hcl`, `*.tfvars`). Só os `.example` são versionados |

## Procedimento (Checkpoint C, só com autorização específica)

```sh
cd infra/cicd-bootstrap
cp backend.hcl.example backend.hcl                # preencher conta; conferir a chave própria
cp terraform.tfvars.example terraform.tfvars      # bucket e distribuição (outputs da infra principal)
terraform init -backend-config=backend.hcl
terraform plan -out=bootstrap.tfplan              # esperado: 2 to add, 0 to change, 0 to destroy
terraform apply bootstrap.tfplan                  # somente depois de revisar o plan
terraform output github_environment_variables     # valores para o environment "production" do GitHub
```

Use o perfil administrativo local apenas aqui. Nenhuma chave vai para o GitHub, para o Terraform versionado, para artefatos ou para logs.

## Testes

`terraform init -backend=false && terraform test` roda com AWS simulada (`mock_provider`). Ele verifica:

- condições exatas da trust, sem curingas e só com `StringEquals`;
- ações e recursos permitidos;
- os Deny de sobrescrita, ativação cega e exclusão;
- as preconditions de conta e de audience do provider;
- o `job_workflow_ref` opcional: ausente por padrão; quando preenchido, entra com o valor exato; curinga, outro repositório ou outra branch são rejeitados;
- validações de entrada (environment, branch e prefixo sem curingas).

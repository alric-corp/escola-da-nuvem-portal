# 20 · Domínio próprio para o portal (students.escoladanuvem.org)

**Status:** 🟨 código pronto, aguardando DNS institucional · **Prioridade:** média · **Esforço:** pequeno · **Área:** infra

## Problema
O portal só é acessível pelo domínio padrão do CloudFront (`d2bx9t870lzfvc.cloudfront.net`), pouco amigável para os alunos.

## O que foi feito
- `infra/terraform/domain.tf` (novo): certificado ACM (`aws_acm_certificate.portal`, DNS validation) para `students.escoladanuvem.org`, mais duas novas variáveis:
  - `portal_domain` (default `"students.escoladanuvem.org"`).
  - `portal_domain_ready` (default `false`) — controla se o domínio já está ligado no CloudFront/Cognito/CORS. Enquanto `false`, só o certificado existe; nada em produção muda.
- `infra/terraform/cdn.tf`: `aliases` e `viewer_certificate` do CloudFront passam a depender de `portal_domain_ready` (usa o certificado ACM quando `true`, mantém o certificado padrão do CloudFront quando `false`).
- `infra/terraform/api.tf` e `auth.tf`: CORS da API e `callback_urls`/`logout_urls` do Cognito passam a usar `local.allowed_origins` — que inclui **as duas origens** (CloudFront padrão + domínio novo) assim que `portal_domain_ready = true`, para não quebrar links já compartilhados com o domínio antigo (ex.: o link de convidado citado em `infra/DEPLOYMENT.md`).
- `infra/terraform/outputs.tf`: novo output `portal_domain_dns_records` com os dois CNAMEs necessários.

## Aplicado em 2026-09-24
`terraform apply` rodado com `portal_domain_ready = false` (padrão): **1 recurso criado (o certificado ACM), 0 alterados, 0 destruídos** — CloudFront, Cognito e API continuam exatamente como antes. `terraform test` e `terraform plan` posteriores confirmam nenhuma mudança pendente além do certificado.

## ⚠️ Bloqueado — depende de quem administra o DNS de escoladanuvem.org
Como em [infra/SES.md](../infra/SES.md) (DKIM/SPF), **o DNS de `escoladanuvem.org` não é administrado pelo titular deste projeto**. Dois registros CNAME precisam ser publicados por quem administra esse DNS (texto pronto para encaminhar já foi passado ao titular na conversa):

| Tipo | Nome | Valor |
| --- | --- | --- |
| CNAME | `_58a463ab1b067dd0d97a8559e5f9a36a.students.escoladanuvem.org` | `_173b889aac4a2a6ec36736d174158b4e.wzccmgtwzk.acm-validations.aws.` |
| CNAME | `students.escoladanuvem.org` | `d2bx9t870lzfvc.cloudfront.net` |

## Próximos passos
- [ ] Pedir a quem administra o DNS de `escoladanuvem.org` para publicar os dois CNAMEs acima.
- [ ] Confirmar `status = ISSUED` no certificado: `aws acm describe-certificate --certificate-arn <arn> --query Certificate.Status`.
- [ ] Mudar `portal_domain_ready = true` em `infra/terraform/terraform.tfvars` e rodar `terraform apply` (vai atualizar CloudFront, Cognito e CORS da API — ainda mantendo o domínio antigo do CloudFront funcionando).
- [ ] Rodar `scripts/deploy_frontend.sh` de novo (o `frontend_config.redirectUri`/`logoutUri` passam a apontar para `https://students.escoladanuvem.org`).
- [ ] Avisar os alunos do novo endereço; o link antigo do CloudFront continua funcionando, então não há urgência em trocar tudo de uma vez.

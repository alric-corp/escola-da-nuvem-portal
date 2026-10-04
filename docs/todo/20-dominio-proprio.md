# 20 · Domínio próprio para o portal (students.escoladanuvem.org)

**Status:** 🟨 implementação parcial — certificado, DNS e ativação pendentes · **Prioridade:** média · **Esforço:** pequeno · **Área:** infra

## Estado conhecido — atualização documental

Domínio desejado: `students.escoladanuvem.org`. O certificado anterior entrou
em `VALIDATION_TIMED_OUT / FAILED`; `portal_domain_ready` permanece `false`.
O ACM pertence a esta trilha de domínio, fora da C7.2 e do trabalho OpenAPI.

O [full plan somente leitura da API-2](../api-2.md#prova-por-planos)
registrou o certificado ausente no refresh e propôs sua criação. Isso não
autoriza recriá-lo nesta rodada. Nenhuma nova consulta AWS/DNS foi realizada.

## Problema
O portal só é acessível pelo domínio padrão do CloudFront, pouco amigável para os alunos.

## O que foi feito
- `infra/terraform/domain.tf` (novo): certificado ACM (`aws_acm_certificate.portal`, DNS validation) para `students.escoladanuvem.org`, mais duas novas variáveis:
  - `portal_domain` (default `"students.escoladanuvem.org"`).
  - `portal_domain_ready` (default `false`) — controla se o domínio já está ligado no CloudFront/Cognito/CORS. Enquanto `false`, o domínio permanece inativo; o certificado anterior precisa ser recriado e validado nesta trilha.
- `infra/terraform/cdn.tf`: `aliases` e `viewer_certificate` do CloudFront passam a depender de `portal_domain_ready` (usa o certificado ACM quando `true`, mantém o certificado padrão do CloudFront quando `false`).
- `infra/terraform/api.tf` e `auth.tf`: CORS da API e `callback_urls`/`logout_urls` do Cognito passam a usar `local.allowed_origins` — que inclui **as duas origens** (CloudFront padrão + domínio novo) assim que `portal_domain_ready = true`, para não quebrar links já compartilhados com o domínio antigo (ex.: o link de convidado citado em `infra/DEPLOYMENT.md`).
- `infra/terraform/outputs.tf`: novo output `portal_domain_dns_records` com os dois CNAMEs necessários.

## Aplicado em 2026-09-24
`terraform apply` rodado com `portal_domain_ready = false` (padrão): **1 recurso criado (o certificado ACM), 0 alterados, 0 destruídos** — CloudFront, Cognito e API continuam exatamente como antes. `terraform test` e `terraform plan` posteriores confirmam nenhuma mudança pendente além do certificado.

## ⚠️ Bloqueado — depende de quem administra o DNS de escoladanuvem.org

Como em [infra/SES.md](../../infra/SES.md) (DKIM/SPF), o DNS institucional é
administrado por terceiros. Os valores antigos de CNAME foram removidos
deste documento e não devem ser reaproveitados automaticamente.

## Próximos passos — quando esta trilha for retomada

- [ ] Recriar conscientemente o certificado, com revisão e aprovação próprias.
- [ ] Obter o **novo CNAME de validação** do certificado recriado.
- [ ] Atualizar o pedido ao time de DNS com os registros atuais, sem gravar
  tokens de validação ou identificadores de recursos neste TODO.
- [ ] Aguardar a validação e confirmar que o certificado está `ISSUED`.
- [ ] Só então avaliar `portal_domain_ready`, com plano e aprovação separados
  para a ativação de CloudFront, Cognito e CORS.
- [ ] Após eventual ativação aprovada, avaliar a publicação da configuração
  frontend e a comunicação do novo endereço aos alunos.

Nenhuma dessas ações foi executada nesta organização documental.

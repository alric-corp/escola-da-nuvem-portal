# Domínio próprio para o portal (ex.: students.escoladanuvem.org) na frente do CloudFront.
# O DNS de escoladanuvem.org é administrado pela instituição, não pelo titular deste
# projeto (mesma situação do DKIM/SPF em email-domain.tf) — os dois CNAMEs abaixo (saída
# `portal_domain_dns_records`) precisam ser pedidos a quem administra esse DNS.
#
# `portal_domain_ready` começa em false: neste estado, só o certificado ACM é criado (sem
# custo, sem tocar CloudFront/Cognito/CORS). Depois que os dois CNAMEs estiverem publicados
# e o certificado mostrar `status = ISSUED` (`aws acm describe-certificate`), mude
# `portal_domain_ready` para true em terraform.tfvars e rode `terraform apply` de novo — só
# então o domínio passa a valer no CloudFront, no Cognito e na CORS da API. O domínio
# padrão do CloudFront continua funcionando durante e depois da transição, para não quebrar
# links já compartilhados (ex.: o link de convidado citado em infra/DEPLOYMENT.md).

variable "portal_domain" {
  description = "Domínio próprio à frente do CloudFront (ex.: students.escoladanuvem.org)."
  type        = string
  default     = "students.escoladanuvem.org"
}

variable "portal_domain_ready" {
  description = "true depois que o certificado ACM estiver emitido e os CNAMEs (ver portal_domain_dns_records) estiverem publicados no DNS. Liga o domínio no CloudFront, no Cognito e na CORS da API."
  type        = bool
  default     = false
}

resource "aws_acm_certificate" "portal" {
  domain_name       = var.portal_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

locals {
  cloudfront_domain = "https://${aws_cloudfront_distribution.portal.domain_name}"
  portal_url        = var.portal_domain_ready ? "https://${var.portal_domain}" : local.cloudfront_domain
  # A origem/URL antiga do CloudFront continua permitida mesmo depois da transição.
  allowed_origins = distinct(concat([local.cloudfront_domain], var.portal_domain_ready ? ["https://${var.portal_domain}"] : []))
}

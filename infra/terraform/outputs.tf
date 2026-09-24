output "portal_url" {
  value = local.portal_url
}

output "frontend_bucket" {
  value = aws_s3_bucket.portal.id
}

output "imports_bucket" {
  value = aws_s3_bucket.imports.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.portal.id
}

output "user_pool_id" {
  value = aws_cognito_user_pool.portal.id
}

output "table_name" {
  value = aws_dynamodb_table.portal.name
}

output "api_url" {
  value = aws_apigatewayv2_api.portal.api_endpoint
}

output "escoladanuvem_domain_dkim_dns" {
  description = "3 registros CNAME que habilitam o Easy DKIM e, ao serem publicados, também completam a verificação de propriedade do domínio escoladanuvem.org no SES (não há TXT de verificação separado neste fluxo)."
  value = [
    for token in aws_sesv2_email_identity.escoladanuvem_domain.dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      name  = "${token}._domainkey.${aws_sesv2_email_identity.escoladanuvem_domain.email_identity}"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "escoladanuvem_mail_from_dns" {
  description = "Registros MX e TXT (SPF) para o domínio MAIL FROM personalizado, necessário para alinhamento SPF no DMARC."
  value = {
    mx = {
      name     = aws_sesv2_email_identity_mail_from_attributes.escoladanuvem_domain.mail_from_domain
      value    = "feedback-smtp.${var.aws_region}.amazonses.com"
      priority = 10
    }
    spf_txt = {
      name  = aws_sesv2_email_identity_mail_from_attributes.escoladanuvem_domain.mail_from_domain
      value = "v=spf1 include:amazonses.com ~all"
    }
  }
}

output "frontend_config" {
  description = "Configuração pública do frontend. Não contém credenciais nem dados de alunos."
  value = {
    region                = var.aws_region
    apiUrl                = aws_apigatewayv2_api.portal.api_endpoint
    userPoolId            = aws_cognito_user_pool.portal.id
    userPoolClientId      = aws_cognito_user_pool_client.portal.id
    authDomain            = "https://${aws_cognito_user_pool_domain.portal.domain}.auth.${var.aws_region}.amazoncognito.com"
    redirectUri           = "${local.portal_url}/"
    logoutUri             = "${local.portal_url}/"
    scopes                = ["openid", "email", "profile", "portal/access"]
    instructorEmailDomain = var.instructor_email_domain
  }
}

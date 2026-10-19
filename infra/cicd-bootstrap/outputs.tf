output "role_arn" {
  value = aws_iam_role.frontend_deploy.arn
}

output "oidc_subject" {
  description = "Subject exato exigido na trust policy."
  value       = local.oidc_subject
}

output "trust_condition_keys" {
  description = "Claims exigidas na trust (StringEquals), para conferir contra o token real."
  value       = sort(keys(local.trust_conditions))
}

output "oidc_provider_arn" {
  description = "Provider existente, apenas referenciado."
  value       = data.aws_iam_openid_connect_provider.github.arn
}

output "github_environment_variables" {
  description = "Variáveis do environment do GitHub (não são segredos; nenhuma credencial)."
  value = {
    AWS_ROLE_ARN               = aws_iam_role.frontend_deploy.arn
    AWS_REGION                 = var.aws_region
    FRONTEND_BUCKET            = var.frontend_bucket_name
    CLOUDFRONT_DISTRIBUTION_ID = var.cloudfront_distribution_id
    PUBLIC_ORIGIN              = "https://${data.aws_cloudfront_distribution.portal.domain_name}"
  }
}

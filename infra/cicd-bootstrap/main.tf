data "aws_caller_identity" "current" {}

# O provider OIDC do GitHub já existe na conta e é compartilhado por roles de outros projetos:
# é só referenciado, nunca criado, importado ou alterado por este state.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# Recursos existentes da infraestrutura principal, só lidos (sem alterar bucket nem distribuição).
data "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name
}

data "aws_cloudfront_distribution" "portal" {
  id = var.cloudfront_distribution_id
}

locals {
  oidc_host = "token.actions.githubusercontent.com"
  # Subject imutável: repo:OWNER@OWNER_ID/REPO@REPO_ID:environment:NAME.
  oidc_subject = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repository}@${var.github_repository_id}:environment:${var.github_environment}"

  # Condições documentadas pelo GitHub para todo job com environment. job_workflow_ref só é documentado para
  # jobs de reusable workflow: entra apenas quando trusted_job_workflow_ref é preenchido com o valor observado
  # no token real (operação verify), nunca presumido.
  trust_conditions = merge(
    {
      "${local.oidc_host}:aud"                 = "sts.amazonaws.com"
      "${local.oidc_host}:sub"                 = local.oidc_subject
      "${local.oidc_host}:repository_id"       = var.github_repository_id
      "${local.oidc_host}:repository_owner_id" = var.github_owner_id
      "${local.oidc_host}:environment"         = var.github_environment
      "${local.oidc_host}:ref"                 = "refs/heads/${var.deploy_branch}"
    },
    var.trusted_job_workflow_ref == "" ? {} : { "${local.oidc_host}:job_workflow_ref" = var.trusted_job_workflow_ref }
  )

  bucket_arn       = data.aws_s3_bucket.frontend.arn
  distribution_arn = "arn:aws:cloudfront::${var.aws_account_id}:distribution/${var.cloudfront_distribution_id}"
  releases_arn     = "${local.bucket_arn}/${var.releases_prefix}*"
  activation_arn   = "${local.bucket_arn}/index.html"

  trust_policy = {
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubProductionDeployOnly"
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = local.trust_conditions }
    }]
  }

  deploy_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ListReleasesOnly"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = local.bucket_arn
        Condition = { StringLike = { "s3:prefix" = [var.releases_prefix, "${var.releases_prefix}*"] } }
      },
      {
        Sid    = "ReadReleasesAndActivation"
        Effect = "Allow"
        Action = "s3:GetObject"
        # config.json e logo.png da raiz são lidos para conferir coerência com a release e com o legado.
        Resource = [local.releases_arn, local.activation_arn, "${local.bucket_arn}/config.json", "${local.bucket_arn}/logo.png"]
      },
      {
        Sid      = "WriteReleasesAndActivation"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = [local.releases_arn, local.activation_arn]
      },
      {
        # Release é imutável: escrita só com If-None-Match (nunca sobrescreve um objeto existente).
        Sid       = "DenyReleaseOverwrite"
        Effect    = "Deny"
        Action    = "s3:PutObject"
        Resource  = local.releases_arn
        Condition = { Null = { "s3:if-none-match" = "true" } }
      },
      {
        # Ativação só com If-Match (ETag do index.html lido antes): duas ativações concorrentes não se sobrepõem.
        Sid       = "DenyBlindActivation"
        Effect    = "Deny"
        Action    = "s3:PutObject"
        Resource  = local.activation_arn
        Condition = { Null = { "s3:if-match" = "true" } }
      },
      {
        # Limpeza de releases e do legado é decisão separada, com credencial administrativa.
        Sid      = "DenyDeletesAndBucketChanges"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectAcl", "s3:PutObjectVersionAcl", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutLifecycleConfiguration", "s3:PutBucketVersioning"]
        Resource = [local.bucket_arn, "${local.bucket_arn}/*"]
      },
      {
        Sid      = "InvalidateThisDistributionOnly"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistribution"]
        Resource = local.distribution_arn
      }
    ]
  }
}

resource "aws_iam_role" "frontend_deploy" {
  name                 = var.role_name
  description          = "Publicação versionada do frontend pelo GitHub Actions (environment ${var.github_environment}, branch ${var.deploy_branch})."
  assume_role_policy   = jsonencode(local.trust_policy)
  max_session_duration = var.max_session_duration

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.aws_account_id
      error_message = "Credencial de outra conta."
    }
    precondition {
      condition     = contains(data.aws_iam_openid_connect_provider.github.client_id_list, "sts.amazonaws.com")
      error_message = "O provider OIDC existente não aceita a audience sts.amazonaws.com."
    }
  }
}

resource "aws_iam_role_policy" "frontend_deploy" {
  name   = "frontend-release-publish"
  role   = aws_iam_role.frontend_deploy.id
  policy = jsonencode(local.deploy_policy)
}

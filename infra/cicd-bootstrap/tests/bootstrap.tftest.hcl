# Políticas avaliadas pelo próprio Terraform (jsonencode), com AWS simulada: nenhuma chamada real.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = {
      arn            = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      client_id_list = ["sts.amazonaws.com"]
    }
  }
  mock_data "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::portal-web-test" }
  }
  mock_data "aws_cloudfront_distribution" {
    defaults = { domain_name = "d111111abcdef8.cloudfront.net" }
  }
}

variables {
  aws_account_id             = "123456789012"
  frontend_bucket_name       = "portal-web-test"
  cloudfront_distribution_id = "E2TESTDIST0001"
}

run "trust_policy_exige_subject_imutavel_e_environment" {
  command = plan
  assert {
    condition     = length(jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement) == 1
    error_message = "Trust com exatamente uma declaração."
  }
  assert {
    condition = jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Condition.StringEquals == {
      "token.actions.githubusercontent.com:aud"                 = "sts.amazonaws.com"
      "token.actions.githubusercontent.com:sub"                 = "repo:alric-corp@178685987/escola-da-nuvem-portal@1385899942:environment:production"
      "token.actions.githubusercontent.com:repository_id"       = "1385899942"
      "token.actions.githubusercontent.com:repository_owner_id" = "178685987"
      "token.actions.githubusercontent.com:environment"         = "production"
      "token.actions.githubusercontent.com:ref"                 = "refs/heads/main"
    }
    error_message = "Condições exatas da trust: as seis documentadas para job com environment, sem job_workflow_ref presumido."
  }
  assert {
    condition     = keys(jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Condition) == ["StringEquals"]
    error_message = "Sem StringLike/ForAllValues na trust."
  }
  assert {
    condition     = !can(regex("[*?]", jsonencode(jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Condition)))
    error_message = "Nenhum curinga nas condições da trust."
  }
  assert {
    condition     = jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Principal.Federated == "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    error_message = "Principal = provider OIDC existente."
  }
  assert {
    condition     = aws_iam_role.frontend_deploy.max_session_duration == 3600
    error_message = "Sessão de no máximo 1 h."
  }
}

run "policy_de_menor_privilegio" {
  command = plan
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement :
      alltrue([for a in flatten([s.Action]) : !can(regex("\\*", a))])
    ])
    error_message = "Nenhuma ação com curinga (s3:*, cloudfront:*)."
  }
  assert {
    condition = sort(distinct(flatten([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : flatten([s.Action]) if s.Effect == "Allow"
    ]))) == sort(["s3:ListBucket", "s3:GetObject", "s3:PutObject", "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistribution"])
    error_message = "Ações permitidas: só leitura/escrita de objetos, listagem de releases e invalidação."
  }
  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : [
        for r in flatten([s.Resource]) : startswith(r, "arn:aws:s3:::portal-web-test") || r == "arn:aws:cloudfront::123456789012:distribution/E2TESTDIST0001"
      ]
    ]))
    error_message = "Todo recurso é o bucket web ou a distribuição autorizada."
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : flatten([s.Resource]) if s.Sid == "WriteReleasesAndActivation"
    ][0] == ["arn:aws:s3:::portal-web-test/releases/*", "arn:aws:s3:::portal-web-test/index.html"]
    error_message = "Escrita só em releases/ e no index.html de ativação."
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : s.Condition if s.Sid == "DenyReleaseOverwrite"
    ][0] == { Null = { "s3:if-none-match" = "true" } }
    error_message = "Release imutável: PutObject sem If-None-Match é negado."
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : s.Condition if s.Sid == "DenyBlindActivation"
    ][0] == { Null = { "s3:if-match" = "true" } }
    error_message = "Ativação só condicional (If-Match)."
  }
  assert {
    condition = contains(flatten([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : flatten([s.Action]) if s.Effect == "Deny"
    ]), "s3:DeleteObject")
    error_message = "Exclusão negada explicitamente."
  }
  assert {
    condition     = output.github_environment_variables.PUBLIC_ORIGIN == "https://d111111abcdef8.cloudfront.net"
    error_message = "Origem pública vem da distribuição."
  }
}

run "conta_errada_bloqueia" {
  command = plan
  variables {
    aws_account_id = "210987654321"
  }
  expect_failures = [aws_iam_role.frontend_deploy]
}

run "provider_sem_audience_sts_bloqueia" {
  command = plan
  override_data {
    target = data.aws_iam_openid_connect_provider.github
    values = {
      arn            = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      client_id_list = ["outra-audience"]
    }
  }
  expect_failures = [aws_iam_role.frontend_deploy]
}

run "environment_com_curinga_rejeitado" {
  command = plan
  variables {
    github_environment = "prod*"
  }
  expect_failures = [var.github_environment]
}

run "prefixo_com_curinga_rejeitado" {
  command = plan
  variables {
    releases_prefix = "*"
  }
  expect_failures = [var.releases_prefix]
}

run "job_workflow_ref_opcional_entra_exato_quando_observado" {
  command = plan
  variables {
    trusted_job_workflow_ref = "alric-corp/escola-da-nuvem-portal/.github/workflows/deploy-frontend.yml@refs/heads/main"
  }
  assert {
    condition     = jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:job_workflow_ref"] == "alric-corp/escola-da-nuvem-portal/.github/workflows/deploy-frontend.yml@refs/heads/main"
    error_message = "Valor observado entra exato."
  }
  assert {
    condition     = length(keys(jsondecode(aws_iam_role.frontend_deploy.assume_role_policy).Statement[0].Condition.StringEquals)) == 7
    error_message = "As seis condições base continuam presentes."
  }
}

run "job_workflow_ref_com_curinga_rejeitado" {
  command = plan
  variables {
    trusted_job_workflow_ref = "alric-corp/escola-da-nuvem-portal/.github/workflows/deploy-*.yml@refs/heads/main"
  }
  expect_failures = [var.trusted_job_workflow_ref]
}

run "job_workflow_ref_de_outro_repositorio_rejeitado" {
  command = plan
  variables {
    trusted_job_workflow_ref = "alric-corp/outro-repo/.github/workflows/deploy-frontend.yml@refs/heads/main"
  }
  expect_failures = [var.trusted_job_workflow_ref]
}

run "job_workflow_ref_de_outra_branch_rejeitado" {
  command = plan
  variables {
    trusted_job_workflow_ref = "alric-corp/escola-da-nuvem-portal/.github/workflows/deploy-frontend.yml@refs/heads/feature"
  }
  expect_failures = [var.trusted_job_workflow_ref]
}

run "branch_com_curinga_rejeitada" {
  command = plan
  variables {
    deploy_branch = "*"
  }
  expect_failures = [var.deploy_branch]
}

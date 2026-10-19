# Complemento do bootstrap.tftest.hcl (Checkpoint B): escopo exato de listagem, leitura e negações da role.
# Mesma AWS simulada; nenhuma chamada real. Fecha a mutação listagem_fora_de_releases de
# tests/contracts/bootstrap_mutations.py, que sobrevivia aos testes do A.1.
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

run "listagem_e_leitura_com_escopo_exato" {
  command = plan
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : s.Condition if s.Sid == "ListReleasesOnly"
    ][0] == { StringLike = { "s3:prefix" = ["releases/", "releases/*"] } }
    error_message = "Listagem só do prefixo releases/."
  }
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : flatten([s.Resource]) if s.Sid == "ReadReleasesAndActivation"
      ][0] == ["arn:aws:s3:::portal-web-test/releases/*", "arn:aws:s3:::portal-web-test/index.html",
    "arn:aws:s3:::portal-web-test/config.json", "arn:aws:s3:::portal-web-test/logo.png"]
    error_message = "Leitura só de releases/, index.html, config.json e logo.png."
  }
  assert {
    condition = sort([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : flatten([s.Action]) if s.Sid == "DenyDeletesAndBucketChanges"
      ][0]) == sort(["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectAcl", "s3:PutObjectVersionAcl",
    "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutLifecycleConfiguration", "s3:PutBucketVersioning"])
    error_message = "Negação explícita de exclusões, ACLs, policy, lifecycle e versionamento."
  }
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.frontend_deploy.policy).Statement : s.Effect == "Deny" || s.Sid != "DenyDeletesAndBucketChanges"
    ])
    error_message = "A negação de exclusões é Deny."
  }
}

mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = {
      partition  = "aws"
      dns_suffix = "amazonaws.com"
    }
  }
}

variables {
  aws_account_id       = "123456789012"
  cognito_sender_email = "portal@example.test"
}

run "private_storage_and_authenticated_api" {
  command = plan

  override_resource {
    target          = aws_sesv2_email_identity.cognito_sender
    override_during = plan
    values          = { arn = "arn:aws:ses:us-east-1:123456789012:identity/portal@example.test" }
  }
  override_resource {
    target          = aws_sesv2_configuration_set.reminders
    override_during = plan
    values          = { arn = "arn:aws:ses:us-east-1:123456789012:configuration-set/test-reminders" }
  }

  assert {
    condition = alltrue([
      for b in aws_s3_bucket_public_access_block.private :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "Os buckets de site e CSV devem bloquear acesso público."
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.portal.signing_behavior == "always"
    error_message = "CloudFront deve assinar os acessos ao S3."
  }

  assert {
    condition     = aws_apigatewayv2_route.me.authorization_type == "JWT" && contains(aws_apigatewayv2_route.me.authorization_scopes, "portal/access")
    error_message = "A API exige JWT com escopo de acesso; um ID token não basta."
  }

  assert {
    condition     = alltrue([for route in aws_apigatewayv2_route.portal : route.authorization_type == "JWT" && contains(route.authorization_scopes, "portal/access")])
    error_message = "Rotas pessoais, de visibilidade e administração devem exigir access token."
  }

  assert {
    condition     = aws_apigatewayv2_route.portal["GET /cohorts/{code}/class-report"].authorization_type == "JWT"
    error_message = "A consulta da turma também deve exigir login."
  }

  assert {
    condition     = aws_lambda_function.identity.environment[0].variables["REMINDERS_ENABLED"] == tostring(var.reminders_enabled)
    error_message = "O envio deve respeitar a configuração de lembretes."
  }

  assert {
    condition     = aws_apigatewayv2_route.portal["POST /cohorts/{code}/pending-preview"].authorization_type == "JWT" && aws_apigatewayv2_route.portal["POST /cohorts/{code}/send-reminder"].authorization_type == "JWT"
    error_message = "Pendências individuais e lembretes devem exigir autenticação."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.reminders.policy).Statement[0].Condition.StringLike["ses:FromAddress"] == "*@${var.instructor_email_domain}"
    error_message = "O envio deve ficar restrito ao domínio institucional dos instrutores."
  }

  assert {
    condition     = toset(aws_sesv2_configuration_set.reminders.suppression_options[0].suppressed_reasons) == toset(["BOUNCE", "COMPLAINT"])
    error_message = "Lembretes devem respeitar supressão por rejeição e reclamação."
  }

  assert {
    condition     = !aws_cognito_user_pool_client.portal.generate_secret && toset(aws_cognito_user_pool_client.portal.allowed_oauth_flows) == toset(["code"])
    error_message = "O frontend deve usar um cliente público com fluxo authorization code."
  }

  assert {
    condition     = toset(keys(aws_cognito_user_group.roles)) == toset(["admin", "instructor", "student"])
    error_message = "Os perfis devem permanecer separados."
  }

  assert {
    condition     = aws_dynamodb_table.portal.deletion_protection_enabled && aws_dynamodb_table.portal.point_in_time_recovery[0].enabled
    error_message = "As notas precisam de proteção contra exclusão e recuperação habilitada."
  }

  assert {
    condition     = jsondecode(aws_dynamodb_table_item.initial_cohort.item).cohortCode.S == "BRSA0267"
    error_message = "A turma inicial deve ser BRSA0267."
  }

  assert {
    condition     = aws_cognito_user_pool.portal.user_attribute_update_settings[0].attributes_require_verification_before_update == toset(["email"])
    error_message = "Mudanças de e-mail devem exigir verificação."
  }
}

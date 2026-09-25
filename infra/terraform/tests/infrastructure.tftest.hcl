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
  # Fixo aqui: o terraform.tfvars local (produção) liga o agendamento e não pode mudar o teste.
  canvas_sync_enabled = false
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
  override_resource {
    target          = aws_lambda_function.auth_trigger
    override_during = plan
    values          = { arn = "arn:aws:lambda:us-east-1:123456789012:function:auth-trigger" }
  }
  override_resource {
    target          = aws_cognito_user_pool.portal
    override_during = plan
    values          = { id = "us-east-1_test", arn = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_test" }
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

  assert {
    condition     = aws_cognito_user_pool.portal.lambda_config[0].pre_token_generation_config[0].lambda_arn == aws_lambda_function.auth_trigger.arn && aws_cognito_user_pool.portal.lambda_config[0].pre_token_generation_config[0].lambda_version == "V2_0"
    error_message = "O access token deve ganhar email/email_verified pelo gatilho pre token generation (evento V2), para o backend não depender de /oauth2/userInfo a cada requisição."
  }

  assert {
    condition     = aws_lambda_function.auth_trigger.handler == "auth_trigger.handler"
    error_message = "O gatilho deve apontar para backend/auth_trigger.py."
  }

  assert {
    condition     = aws_lambda_permission.auth_trigger.principal == "cognito-idp.amazonaws.com" && aws_lambda_permission.auth_trigger.source_arn == aws_cognito_user_pool.portal.arn
    error_message = "Só o user pool do portal pode invocar o gatilho de pré-geração de token."
  }

  assert {
    condition     = aws_dynamodb_table.portal.ttl[0].enabled && aws_dynamodb_table.portal.ttl[0].attribute_name == "expiresAt"
    error_message = "Prévias não publicadas (DRAFT#) precisam expirar pelo TTL da tabela."
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_lifecycle_configuration.imports.rule :
      r.expiration[0].days == 30 && r.filter[0].tag[0].value == "draft"
      if length(r.filter[0].tag) > 0
    ])
    error_message = "Arquivos de prévia marcados como rascunho devem expirar em 30 dias."
  }

  assert {
    condition = anytrue([
      for r in aws_s3_bucket_lifecycle_configuration.imports.rule :
      r.noncurrent_version_expiration[0].noncurrent_days == 90 if length(r.filter[0].tag) == 0
    ])
    error_message = "Versões não correntes do bucket de importações devem expirar em 90 dias."
  }

  assert {
    condition     = aws_scheduler_schedule.canvas_sync.state == "DISABLED" && aws_scheduler_schedule.canvas_sync.schedule_expression_timezone == "America/Sao_Paulo" && aws_scheduler_schedule.canvas_sync.schedule_expression == "cron(0 6,18 * * ? *)"
    error_message = "A atualização pelo Canvas roda às 6h e às 18h de Brasília e nasce desligada até o token ser gravado."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.canvas_sync_errors.metric_name == "Errors" && length(aws_cloudwatch_metric_alarm.canvas_sync_errors.alarm_actions) == 1
    error_message = "Falhas da atualização pelo Canvas precisam acionar o alarme."
  }

  assert {
    condition = alltrue([
      for alarm in [aws_cloudwatch_metric_alarm.api_5xx, aws_cloudwatch_metric_alarm.auth_trigger_errors, aws_cloudwatch_metric_alarm.reminder_events_errors] :
      length(alarm.alarm_actions) == 1 && alarm.treat_missing_data == "notBreaching"
    ]) && aws_cloudwatch_metric_alarm.api_5xx.metric_name == "5xx" && aws_cloudwatch_metric_alarm.auth_trigger_errors.threshold == 1
    error_message = "Erros 5xx da API e falhas do login e dos eventos de e-mail precisam avisar por e-mail."
  }
}

run "canvas_token_expiry_warning" {
  command = plan

  variables {
    canvas_sync_enabled = true
  }

  assert {
    condition     = aws_scheduler_schedule.canvas_sync.state == "ENABLED" && length(aws_cloudwatch_metric_alarm.canvas_token_expiring) == 1
    error_message = "Com o agendamento ligado, existe o aviso de token do Canvas expirando."
  }

  assert {
    condition = alltrue([for a in aws_cloudwatch_metric_alarm.canvas_token_expiring :
    a.threshold == 15 && a.comparison_operator == "LessThanThreshold" && a.treat_missing_data == "breaching" && a.namespace == aws_lambda_function.canvas_sync.environment[0].variables.METRICS_NAMESPACE])
    error_message = "O aviso dispara com menos de 15 dias ou sem dado, no namespace em que a Lambda publica."
  }
}

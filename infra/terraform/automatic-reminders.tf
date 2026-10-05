# AUTO-2.3: infraestrutura preparada, com gates fechados. AUTO-4 revisará ativação.
# Remetente e automaticEnabled pertencem ao REMINDER_SETTINGS, nunca ao Terraform.
variable "automatic_reminder_cohorts" {
  description = "Turmas com schedules preparados (desabilitados); sem remetentes ou alunos."
  type        = set(string)
  default     = ["BRSA0257", "BRSA0267"]
  validation {
    condition     = alltrue([for code in var.automatic_reminder_cohorts : can(regex("^[A-Z0-9-]{3,32}$", code))])
    error_message = "Use códigos de turma com 3 a 32 letras maiúsculas, números ou hífens."
  }
}

resource "aws_cloudwatch_log_group" "automatic_reminders" {
  name              = "/aws/lambda/${local.name}-automatic-reminders"
  retention_in_days = 30
}

resource "aws_iam_role" "automatic_reminders" {
  name = "${local.name}-automatic-reminders"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "automatic_reminders" {
  name = "automatic-reminders"
  role = aws_iam_role.automatic_reminders.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OwnLogs", Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.automatic_reminders.arn}:*"
      },
      {
        # Repository usa Put nas transações/reservas/finalizações; este worker não
        # usa counters (UpdateItem), DeleteItem ou Scan.
        Sid      = "ReminderData", Effect = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"]
        Resource = aws_dynamodb_table.portal.arn
      },
      {
        Sid    = "ReadSnapshots", Effect = "Allow"
        Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.imports.arn}/cohorts/*"
      },
      {
        Sid       = "SendReminders", Effect = "Allow"
        Action    = ["ses:SendEmail"]
        Resource  = ["arn:${data.aws_partition.current.partition}:ses:${var.aws_region}:${var.aws_account_id}:identity/*@${var.instructor_email_domain}", aws_sesv2_configuration_set.reminders.arn]
        Condition = { StringLike = { "ses:FromAddress" = "*@${var.instructor_email_domain}" } }
      },
      {
        Sid    = "SenderReadiness", Effect = "Allow"
        Action = ["ses:GetEmailIdentity"], Resource = "arn:${data.aws_partition.current.partition}:ses:${var.aws_region}:${var.aws_account_id}:identity/*@${var.instructor_email_domain}"
      },
      { Sid = "AccountReadiness", Effect = "Allow", Action = ["ses:GetAccount"], Resource = "*" }
    ]
  })
}

resource "aws_lambda_function" "automatic_reminders" {
  function_name    = "${local.name}-automatic-reminders"
  role             = aws_iam_role.automatic_reminders.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "automatic_reminders.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  # Mesmo porte do Canvas; uma turma por invocação, envios sequenciais (250 ms).
  memory_size                    = 256
  timeout                        = 300
  reserved_concurrent_executions = 2
  environment {
    variables = {
      TABLE_NAME                 = aws_dynamodb_table.portal.name
      IMPORTS_BUCKET             = aws_s3_bucket.imports.id
      INSTRUCTOR_EMAIL_DOMAIN    = var.instructor_email_domain
      REMINDER_CONFIGURATION_SET = aws_sesv2_configuration_set.reminders.configuration_set_name
      AUTOMATIC_REMINDER_COHORTS = jsonencode(sort(tolist(var.automatic_reminder_cohorts)))
      # Espelho conservador do gate de infraestrutura: bloqueia invocação live
      # acidental também fora do Scheduler. Não impede dry-run explícito.
      AUTOMATIC_REMINDERS_ENABLED = "false"
    }
  }
  depends_on = [aws_iam_role_policy.automatic_reminders]
}

# Scheduler confirma a entrega à fila assíncrona. Lambda precisa de limite próprio
# para retomar partial/time-budget; o worker também impõe scheduledFor + 30 min.
resource "aws_lambda_function_event_invoke_config" "automatic_reminders" {
  function_name                = aws_lambda_function.automatic_reminders.function_name
  maximum_event_age_in_seconds = 1800
  maximum_retry_attempts       = 2
}

resource "aws_scheduler_schedule_group" "automatic_reminders" {
  name = "${local.name}-automatic-reminders"
}

resource "aws_iam_role" "automatic_reminders_scheduler" {
  name = "${local.name}-automatic-reminders-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole"
      # Scheduler suporta SourceArn do GRUPO, não de um schedule individual.
      Condition = { StringEquals = {
        "aws:SourceAccount" = var.aws_account_id
        "aws:SourceArn"     = aws_scheduler_schedule_group.automatic_reminders.arn
      } }
    }]
  })
}

resource "aws_iam_role_policy" "automatic_reminders_scheduler" {
  name = "invoke-automatic-reminders"
  role = aws_iam_role.automatic_reminders_scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.automatic_reminders.arn }]
  })
}

# A execution role acima autoriza InvokeFunction na mesma conta. Não adicionar
# aws_lambda_permission público/genérico: Scheduler não usa o modelo de Rule/SNS.
resource "aws_scheduler_schedule" "automatic_reminders" {
  for_each                     = var.automatic_reminder_cohorts
  name                         = "${local.name}-reminders-${each.key}"
  group_name                   = aws_scheduler_schedule_group.automatic_reminders.name
  description                  = "Lembretes da turma ${each.key}; ativação depende de revisão AUTO-4."
  schedule_expression          = "cron(0 20 ? * TUE,FRI *)"
  schedule_expression_timezone = "America/Sao_Paulo"
  state                        = "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_function.automatic_reminders.arn
    role_arn = aws_iam_role.automatic_reminders_scheduler.arn
    # Input é JSON válido antes da substituição e contém os keywords literais.
    input = replace(replace(jsonencode({
      source        = "portal.scheduler"
      type          = "automatic-reminders"
      version       = 1
      cohortCode    = each.key
      scheduledFor  = "<aws.scheduler.scheduled-time>"
      executionId   = "<aws.scheduler.execution-id>"
      attemptNumber = "<aws.scheduler.attempt-number>"
      dryRun        = false
    }), "\\u003c", "<"), "\\u003e", ">")
    retry_policy {
      maximum_event_age_in_seconds = 1800
      maximum_retry_attempts       = 2
    }
  }
  depends_on = [aws_iam_role_policy.automatic_reminders_scheduler, aws_lambda_function_event_invoke_config.automatic_reminders]
}

resource "aws_cloudwatch_metric_alarm" "automatic_reminders" {
  for_each            = toset(["Errors", "Throttles"])
  alarm_name          = "${local.name}-automatic-reminders-${lower(each.key)}"
  alarm_description   = "Falha técnica ou throttling no worker de lembretes. Consultar resumo sem PII no log da função."
  namespace           = "AWS/Lambda"
  metric_name         = each.key
  dimensions          = { FunctionName = aws_lambda_function.automatic_reminders.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

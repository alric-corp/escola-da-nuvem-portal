mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
}
mock_provider "archive" {}

variables {
  aws_account_id             = "123456789012"
  cognito_sender_email       = "portal@example.test"
  canvas_sync_enabled        = true
  automatic_reminder_cohorts = ["BRSA0257", "BRSA0267"]
}

override_resource {
  target          = aws_dynamodb_table.portal
  override_during = plan
  values          = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/test" }
}
override_resource {
  target          = aws_s3_bucket.imports
  override_during = plan
  values          = { arn = "arn:aws:s3:::test-imports" }
}
override_resource {
  target          = aws_s3_bucket.feedback
  override_during = plan
  values          = { arn = "arn:aws:s3:::test-feedback" }
}
override_resource {
  target          = aws_cloudwatch_log_group.automatic_reminders
  override_during = plan
  values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/test-automatic" }
}
override_resource {
  target          = aws_cloudwatch_log_group.canvas_sync
  override_during = plan
  values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/test-canvas" }
}
override_resource {
  target          = aws_cloudwatch_log_group.auth_trigger
  override_during = plan
  values          = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/test-auth" }
}
override_resource {
  target          = aws_secretsmanager_secret.canvas_token
  override_during = plan
  values          = { arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:test" }
}
override_resource {
  target          = aws_sesv2_configuration_set.reminders
  override_during = plan
  values          = { arn = "arn:aws:ses:us-east-1:123456789012:configuration-set/test" }
}
override_resource {
  target          = aws_lambda_function.automatic_reminders
  override_during = plan
  values          = { arn = "arn:aws:lambda:us-east-1:123456789012:function:automatic-reminders" }
}
override_resource {
  target          = aws_lambda_function.canvas_sync
  override_during = plan
  values          = { arn = "arn:aws:lambda:us-east-1:123456789012:function:canvas-sync" }
}
override_resource {
  target          = aws_iam_role.automatic_reminders_scheduler
  override_during = plan
  values          = { arn = "arn:aws:iam::123456789012:role/automatic-scheduler" }
}
override_resource {
  target          = aws_iam_role.canvas_sync_scheduler
  override_during = plan
  values          = { arn = "arn:aws:iam::123456789012:role/canvas-scheduler" }
}
override_resource {
  target          = aws_scheduler_schedule_group.automatic_reminders
  override_during = plan
  values          = { arn = "arn:aws:scheduler:us-east-1:123456789012:schedule-group/automatic" }
}

run "automatic_reminders_kill_switch" {
  command = plan

  assert {
    condition = (
      aws_lambda_function.automatic_reminders.handler == "automatic_reminders.handler"
      && aws_lambda_function.automatic_reminders.timeout == 300
      && aws_lambda_function.automatic_reminders.memory_size == 256
      && aws_lambda_function.automatic_reminders.reserved_concurrent_executions == 2
      && aws_lambda_function.automatic_reminders.runtime == "python3.13"
      && toset(aws_lambda_function.automatic_reminders.architectures) == toset(["arm64"])
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && toset(jsondecode(aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDER_COHORTS)) == var.automatic_reminder_cohorts
      && toset(keys(aws_lambda_function.automatic_reminders.environment[0].variables)) == toset([
        "TABLE_NAME", "IMPORTS_BUCKET", "INSTRUCTOR_EMAIL_DOMAIN", "REMINDER_CONFIGURATION_SET", "AUTOMATIC_REMINDER_COHORTS", "AUTOMATIC_REMINDERS_ENABLED"
      ])
    )
    error_message = "Worker dedicado: pacote/handler esperado, orçamento limitado e gate temporário aberto para recovery; schedules continuam DISABLED, sem segredo Canvas."
  }

  assert {
    condition = (
      length([for s in jsondecode(aws_iam_role_policy.portal_data.policy).Statement : s if contains(s.Action, "dynamodb:ConditionCheckItem")]) == 1
      && alltrue([for s in jsondecode(aws_iam_role_policy.portal_data.policy).Statement :
        s.Resource == aws_dynamodb_table.portal.arn
        && try(s.Condition.ArnEquals["lambda:SourceFunctionArn"], "") == "arn:aws:lambda:us-east-1:123456789012:function:${local.name}-identity"
        if contains(s.Action, "dynamodb:ConditionCheckItem")
      ])
      && !strcontains(aws_iam_role_policy.portal_data.policy, "dynamodb:*")
      && !strcontains(aws_iam_role_policy.portal_data.policy, "dynamodb:TransactWriteItems")
    )
    error_message = "API requer ConditionCheckItem na tabela; delivery não herda a ação da role compartilhada."
  }

  assert {
    condition = (
      contains(jsondecode(aws_iam_role_policy.canvas_sync.policy).Statement[1].Action, "dynamodb:ConditionCheckItem")
      && jsondecode(aws_iam_role_policy.canvas_sync.policy).Statement[1].Resource == aws_dynamodb_table.portal.arn
      && !strcontains(aws_iam_role_policy.canvas_sync.policy, "dynamodb:*")
      && !strcontains(aws_iam_role_policy.canvas_sync.policy, "dynamodb:TransactWriteItems")
      && !strcontains(aws_iam_role_policy.auth_trigger_logs.policy, "dynamodb:")
    )
    error_message = "Canvas exige ConditionCheckItem para SYNC_RUN; auth trigger continua sem DynamoDB."
  }

  assert {
    condition = toset(flatten([for s in jsondecode(aws_iam_role_policy.automatic_reminders.policy).Statement : s.Action])) == toset([
      "logs:CreateLogStream", "logs:PutLogEvents", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:ConditionCheckItem",
      "s3:GetObject", "ses:SendEmail", "ses:GetEmailIdentity", "ses:GetAccount"
    ]) && length(jsondecode(aws_iam_role_policy.automatic_reminders.policy).Statement) == 6
    error_message = "Worker: conjunto mínimo exato de ações, sem wildcard, Update/Delete/Scan, CreateEmailIdentity ou Canvas/Cognito."
  }

  assert {
    condition = alltrue([for s in jsondecode(aws_iam_role_policy.automatic_reminders.policy).Statement :
      s.Effect == "Allow" && (
        s.Sid == "ReminderData" ? s.Resource == aws_dynamodb_table.portal.arn :
        s.Sid == "OwnLogs" ? s.Resource == "${aws_cloudwatch_log_group.automatic_reminders.arn}:*" :
        s.Sid == "ReadSnapshots" ? s.Resource == "${aws_s3_bucket.imports.arn}/cohorts/*" :
        s.Sid == "AccountReadiness" ? s.Resource == "*" :
        s.Sid == "SenderReadiness" ? s.Resource == "arn:aws:ses:us-east-1:123456789012:identity/*@${var.instructor_email_domain}" :
        s.Sid == "SendReminders" ? (
          toset(s.Resource) == toset(["arn:aws:ses:us-east-1:123456789012:identity/*@${var.instructor_email_domain}", aws_sesv2_configuration_set.reminders.arn])
          && s.Condition.StringLike["ses:FromAddress"] == "*@${var.instructor_email_domain}"
        ) : false
      )
    ])
    error_message = "Resources IAM do worker precisam estar limitados à tabela/snapshots/identidades institucionais/log próprios."
  }

  assert {
    condition = toset(keys(aws_scheduler_schedule.automatic_reminders)) == toset(["BRSA0257", "BRSA0267"]) && alltrue([
      for code, schedule in aws_scheduler_schedule.automatic_reminders :
      schedule.state == "DISABLED" && schedule.schedule_expression == "cron(0 20 ? * TUE,FRI *)"
      && schedule.schedule_expression_timezone == "America/Sao_Paulo" && schedule.flexible_time_window[0].mode == "OFF"
      && schedule.group_name == aws_scheduler_schedule_group.automatic_reminders.name
      && schedule.target[0].arn == aws_lambda_function.automatic_reminders.arn
      && schedule.target[0].role_arn == aws_iam_role.automatic_reminders_scheduler.arn
      && schedule.target[0].retry_policy[0].maximum_event_age_in_seconds == 1800
      && schedule.target[0].retry_policy[0].maximum_retry_attempts == 2
      && alltrue([for keyword in ["scheduled-time", "execution-id", "attempt-number"] :
        strcontains(schedule.target[0].input, "<aws.scheduler.${keyword}>")
      ])
      && jsondecode(schedule.target[0].input) == {
        source        = "portal.scheduler", type = "automatic-reminders", version = 1, cohortCode = code,
        scheduledFor  = "<aws.scheduler.scheduled-time>", executionId = "<aws.scheduler.execution-id>",
        attemptNumber = "<aws.scheduler.attempt-number>", dryRun = false
      }
    ])
    error_message = "Ambos schedules DISABLED. Terça/sexta 20h São Paulo, retry limitado e input exato sem PII."
  }

  assert {
    condition = (
      aws_scheduler_schedule.canvas_sync.state == "ENABLED"
      && aws_scheduler_schedule.canvas_sync.schedule_expression == "cron(0 6,18 * * ? *)"
      && aws_scheduler_schedule.canvas_sync.schedule_expression_timezone == "America/Sao_Paulo"
      && aws_scheduler_schedule.canvas_sync.flexible_time_window[0].mode == "OFF"
      && aws_scheduler_schedule.canvas_sync.target[0].retry_policy[0].maximum_retry_attempts == 0
      && aws_scheduler_schedule.canvas_sync.target[0].arn == aws_lambda_function.canvas_sync.arn
      && aws_scheduler_schedule.canvas_sync.target[0].role_arn == aws_iam_role.canvas_sync_scheduler.arn
      && alltrue([for keyword in ["scheduled-time", "execution-id", "attempt-number"] :
        strcontains(aws_scheduler_schedule.canvas_sync.target[0].input, "<aws.scheduler.${keyword}>")
      ])
      && jsondecode(aws_scheduler_schedule.canvas_sync.target[0].input) == {
        source      = "portal.scheduler", type = "canvas-sync", scheduledFor = "<aws.scheduler.scheduled-time>",
        executionId = "<aws.scheduler.execution-id>", attemptNumber = "<aws.scheduler.attempt-number>"
      }
    )
    error_message = "Canvas mantém horário/target/retry e ganha somente os atributos nativos de contexto."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.automatic_reminders_scheduler.policy).Statement == [{
      Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.automatic_reminders.arn
      }] && jsondecode(aws_iam_role.automatic_reminders_scheduler.assume_role_policy).Statement == [{
      Effect    = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole",
      Condition = { StringEquals = { "aws:SourceAccount" = var.aws_account_id, "aws:SourceArn" = aws_scheduler_schedule_group.automatic_reminders.arn } }
    }]
    error_message = "Invocação autorizada somente pela execution role do grupo na mesma conta e somente para a worker."
  }

  assert {
    condition = (
      aws_lambda_function_event_invoke_config.automatic_reminders.maximum_event_age_in_seconds == 1800
      && aws_lambda_function_event_invoke_config.automatic_reminders.maximum_retry_attempts == 2
      && aws_cloudwatch_log_group.automatic_reminders.retention_in_days == 30
      && toset(keys(aws_cloudwatch_metric_alarm.automatic_reminders)) == toset(["Errors", "Throttles"])
      && alltrue([for metric, alarm in aws_cloudwatch_metric_alarm.automatic_reminders :
        alarm.metric_name == metric && alarm.threshold == 1 && alarm.period == 300
        && alarm.treat_missing_data == "notBreaching" && length(alarm.alarm_actions) == 1
      ])
    )
    error_message = "Retentativas assíncronas limitadas e alarmes Errors/Throttles sem ruído de ausência."
  }
}

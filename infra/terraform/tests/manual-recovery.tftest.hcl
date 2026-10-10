mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
}
mock_provider "archive" {}

variables {
  aws_account_id               = "123456789012"
  cognito_sender_email         = "portal@example.test"
  manual_recovery_operator_arn = "arn:aws:iam::123456789012:user/recovery-operator"
}

override_resource {
  target          = aws_lambda_function.automatic_reminders
  override_during = plan
  values = {
    arn           = "arn:aws:lambda:us-east-1:123456789012:function:restart-portal-prod-automatic-reminders"
    version       = "1"
    function_name = "restart-portal-prod-automatic-reminders"
  }
}

run "manual_disabled_and_iam_isolated" {
  command = plan

  assert {
    condition = (
      aws_lambda_function.automatic_reminders.publish
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "false"
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_COHORT == "BRSA0267"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_SCHEDULED_FOR == "2026-10-09T23:00:00Z"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ALIAS_ARN == local.manual_recovery_alias_arn
      && aws_lambda_alias.manual_recovery.name == "manual-recovery"
      && aws_lambda_alias.manual_recovery.function_version == "3"
      && aws_lambda_function_event_invoke_config.manual_recovery.maximum_retry_attempts == 0
      && aws_lambda_function_event_invoke_config.manual_recovery.maximum_event_age_in_seconds == 60
      && aws_lambda_function_event_invoke_config.manual_recovery.qualifier == "manual-recovery"
      && alltrue([for s in aws_scheduler_schedule.automatic_reminders : s.state == "DISABLED"])
    )
    error_message = "Gate automático aberto mantém manual fechado, schedules desligados, alias versionado sem retry e escopo original exato."
  }

  assert {
    condition = jsondecode(aws_iam_role.manual_recovery_operator[0].assume_role_policy).Statement == [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { AWS = var.manual_recovery_operator_arn }
      }] && jsondecode(aws_iam_role_policy.manual_recovery_operator[0].policy).Statement == [{
      Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = local.manual_recovery_alias_arn
      Condition = {
        DateGreaterThanEquals = { "aws:CurrentTime" = "1970-01-01T00:00:00Z" }
        DateLessThan          = { "aws:CurrentTime" = "1970-01-01T00:00:00Z" }
      }
    }]
    error_message = "Role manual confia em um único operador e só permite o alias, com autorização IAM expirada enquanto disabled."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.automatic_reminders_scheduler.policy).Statement == [{
      Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.automatic_reminders.arn
    }] && aws_lambda_function_event_invoke_config.automatic_reminders.maximum_retry_attempts == 2
    error_message = "Scheduler conserva somente ARN não qualificado e sua política de retry; não pode invocar o alias manual."
  }
}

run "manual_authorization_has_absolute_iam_expiry" {
  command = plan
  variables {
    manual_recovery = {
      enabled    = true, cohort = "BRSA0267", scheduled_for = "2026-10-09T23:00:00Z"
      not_before = "2026-10-10T05:00:00Z", expires_at = "2026-10-10T05:30:00Z"
    }
  }
  assert {
    condition = (
      aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "true"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_NOT_BEFORE == var.manual_recovery.not_before
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_EXPIRES_AT == var.manual_recovery.expires_at
      && jsondecode(aws_iam_role_policy.manual_recovery_operator[0].policy).Statement[0].Condition == {
        DateGreaterThanEquals = { "aws:CurrentTime" = var.manual_recovery.not_before }
        DateLessThan          = { "aws:CurrentTime" = var.manual_recovery.expires_at }
      }
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && alltrue([for s in aws_scheduler_schedule.automatic_reminders : s.state == "DISABLED"])
    )
    error_message = "Autorização manual tem a mesma expiração no runtime e IAM; não altera o gate automático independente nem os schedules desligados."
  }
}

run "manual_cannot_authorize_other_cohort" {
  command = plan
  variables {
    manual_recovery = {
      enabled    = true, cohort = "BRSA0257", scheduled_for = "2026-10-09T23:00:00Z"
      not_before = "2026-10-10T05:00:00Z", expires_at = "2026-10-10T05:30:00Z"
    }
  }
  expect_failures = [var.manual_recovery]
}

run "manual_cannot_authorize_more_than_thirty_minutes" {
  command = plan
  variables {
    manual_recovery = {
      enabled    = true, cohort = "BRSA0267", scheduled_for = "2026-10-09T23:00:00Z"
      not_before = "2026-10-10T05:00:00Z", expires_at = "2026-10-10T05:30:01Z"
    }
  }
  expect_failures = [var.manual_recovery]
}

run "manual_requires_specific_operator" {
  command = plan
  variables {
    manual_recovery_operator_arn = "arn:aws:iam::123456789012:root"
  }
  expect_failures = [var.manual_recovery_operator_arn]
}

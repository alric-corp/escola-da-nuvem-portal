mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
}
mock_provider "archive" {}

variables {
  aws_account_id               = "123456789012"
  cognito_sender_email         = "portal@example.test"
  manual_recovery_operator_arn = ""
}

# A publicação automática avançou; a versão manual desabilitada continua 3.
override_resource {
  target          = aws_lambda_function.automatic_reminders
  override_during = plan
  values = {
    arn     = "arn:aws:lambda:us-east-1:123456789012:function:restart-portal-prod-automatic-reminders"
    version = "4"
  }
}

run "automatic_publish_keeps_manual_version" {
  command = plan
  assert {
    condition     = aws_lambda_function.automatic_reminders.version == "4" && aws_lambda_alias.manual_recovery.function_version == "3"
    error_message = "Manual alias must remain at the explicitly selected disabled version when the worker publishes."
  }
  assert {
    condition = (
      aws_lambda_function.automatic_reminders.publish
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "false"
      && length(aws_lambda_alias.manual_recovery.routing_config) == 0
      && length(aws_scheduler_schedule.automatic_reminders) == 2
      && alltrue([for s in aws_scheduler_schedule.automatic_reminders :
        s.state == "DISABLED"
        && s.target[0].arn == aws_lambda_function.automatic_reminders.arn
        && s.target[0].arn != local.manual_recovery_alias_arn
      ])
    )
    error_message = "Publish remains enabled, manual remains closed and both disabled schedules target the unqualified worker."
  }
}

run "zip_publish_keeps_manual_version" {
  command = plan
  override_data {
    target = data.archive_file.api
    values = {
      output_base64sha256 = "dGVzdC1jaGFuZ2VkLXppcC1oYXNo"
    }
  }
  override_resource {
    target          = aws_lambda_function.automatic_reminders
    override_during = plan
    values = {
      version = "5"
    }
  }
  assert {
    condition = (
      aws_lambda_function.automatic_reminders.version == "5"
      && aws_lambda_function.automatic_reminders.source_code_hash == "dGVzdC1jaGFuZ2VkLXppcC1oYXNo"
      && aws_lambda_alias.manual_recovery.function_version == "3"
    )
    error_message = "A changed worker ZIP and published version must not move the manual alias."
  }
}

run "manual_target_requires_explicit_selection" {
  command = plan
  variables {
    manual_recovery_target_version = "8"
  }
  assert {
    condition = (
      aws_lambda_alias.manual_recovery.function_version == "8"
      && aws_lambda_function.automatic_reminders.version == "4"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "false"
      && alltrue([for s in aws_scheduler_schedule.automatic_reminders : s.state == "DISABLED"])
    )
    error_message = "Only deliberate target selection moves the alias; it must not enable manual authorization or schedules."
  }
}

run "reject_latest" {
  command = plan
  variables {
    manual_recovery_target_version = "$LATEST"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_alias" {
  command = plan
  variables {
    manual_recovery_target_version = "manual-recovery"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_zero" {
  command = plan
  variables {
    manual_recovery_target_version = "0"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_negative" {
  command = plan
  variables {
    manual_recovery_target_version = "-1"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_fraction" {
  command = plan
  variables {
    manual_recovery_target_version = "3.5"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_leading_zero" {
  command = plan
  variables {
    manual_recovery_target_version = "03"
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_empty" {
  command = plan
  variables {
    manual_recovery_target_version = ""
  }
  expect_failures = [var.manual_recovery_target_version]
}

run "reject_null" {
  command = plan
  variables {
    manual_recovery_target_version = null
  }
  expect_failures = [var.manual_recovery_target_version]
}

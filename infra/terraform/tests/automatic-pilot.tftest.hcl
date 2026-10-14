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
  automatic_reminder_cohorts   = ["BRSA0257", "BRSA0267"]
}

override_resource {
  target          = aws_lambda_function.automatic_reminders
  override_during = plan
  values = {
    arn     = "arn:aws:lambda:us-east-1:123456789012:function:restart-portal-prod-automatic-reminders"
    version = "4"
  }
}

run "brsa0257_one_time_pilot_preserves_brsa0267_recurrence" {
  command = plan
  assert {
    condition = (
      var.automatic_reminder_enabled_cohorts == toset(["BRSA0257", "BRSA0267"])
      && aws_scheduler_schedule.automatic_reminders["BRSA0267"].state == "ENABLED"
      && aws_scheduler_schedule.automatic_reminders["BRSA0257"].state == "ENABLED"
      && aws_scheduler_schedule.automatic_reminders["BRSA0257"].schedule_expression == "at(2026-10-14T20:00:00)"
      && aws_scheduler_schedule.automatic_reminders["BRSA0267"].schedule_expression == "cron(0 20 ? * TUE,FRI *)"
      && length(aws_scheduler_schedule.automatic_reminders) == 2
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "false"
      && aws_lambda_alias.manual_recovery.function_version == "3"
      && length(aws_lambda_alias.manual_recovery.routing_config) == 0
    )
    error_message = "BRSA0257 must run once on October 14 at 20h; BRSA0267 keeps its recurrence and manual/alias stay closed."
  }
  assert {
    condition = alltrue([for code, schedule in aws_scheduler_schedule.automatic_reminders :
      schedule.schedule_expression_timezone == "America/Sao_Paulo"
      && schedule.flexible_time_window[0].mode == "OFF"
      && schedule.target[0].arn == aws_lambda_function.automatic_reminders.arn
      && schedule.target[0].arn != local.manual_recovery_alias_arn
      && jsondecode(schedule.target[0].input) == {
        source        = "portal.scheduler", type = "automatic-reminders", version = 1, cohortCode = code,
        scheduledFor  = "<aws.scheduler.scheduled-time>", executionId = "<aws.scheduler.execution-id>",
        attemptNumber = "<aws.scheduler.attempt-number>", dryRun = false
      }
    ])
    error_message = "Both natural schedules must keep Sao Paulo timezone, OFF window, exact Scheduler input and the unqualified automatic worker."
  }
}

run "empty_selection_disables_both_schedules" {
  command = plan
  variables {
    automatic_reminder_enabled_cohorts = []
  }
  assert {
    condition = (
      alltrue([for schedule in aws_scheduler_schedule.automatic_reminders : schedule.state == "DISABLED"])
      && aws_lambda_function.automatic_reminders.environment[0].variables.AUTOMATIC_REMINDERS_ENABLED == "true"
      && aws_lambda_function.automatic_reminders.environment[0].variables.MANUAL_RECOVERY_ENABLED == "false"
      && aws_lambda_alias.manual_recovery.function_version == "3"
    )
    error_message = "Disabling schedules does not alter worker gates or move the manual alias."
  }
}

run "reject_unprepared_cohort" {
  command = plan
  variables {
    automatic_reminder_enabled_cohorts = ["BRSA9999"]
  }
  expect_failures = [var.automatic_reminder_enabled_cohorts]
}

run "reject_null_selection" {
  command = plan
  variables {
    automatic_reminder_enabled_cohorts = null
  }
  expect_failures = [var.automatic_reminder_enabled_cohorts]
}

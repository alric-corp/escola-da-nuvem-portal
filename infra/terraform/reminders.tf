variable "reminders_enabled" {
  description = "Habilita lembretes individuais, enviados somente após confirmação do instrutor."
  type        = bool
  default     = true
}

variable "cognito_sender_email" {
  description = "Remetente SES verificado usado pelo Cognito para e-mails de conta (cadastro, recuperação de senha). Os lembretes de atividades usam a identidade SES de cada instrutor, criada quando o instrutor solicita a confirmação."
  type        = string
  validation {
    condition     = can(regex("^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$", var.cognito_sender_email))
    error_message = "Informe um endereço de e-mail válido."
  }
}

moved {
  from = aws_sesv2_email_identity.reminders[0]
  to   = aws_sesv2_email_identity.cognito_sender
}

moved {
  from = aws_iam_role_policy.reminders[0]
  to   = aws_iam_role_policy.reminders
}

resource "aws_sesv2_email_identity" "cognito_sender" {
  email_identity = var.cognito_sender_email
}

resource "aws_sesv2_configuration_set" "reminders" {
  configuration_set_name = "${local.name}-reminders"
  reputation_options {
    reputation_metrics_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_iam_role_policy" "reminders" {
  name = "send-student-reminders"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Cada instrutor envia com sua própria identidade SES, confirmada por opção própria;
        # a condição restringe o remetente ao domínio institucional, não a um endereço fixo.
        Effect    = "Allow", Action = ["ses:SendEmail"]
        Resource  = ["arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/*", aws_sesv2_configuration_set.reminders.arn]
        Condition = { StringLike = { "ses:FromAddress" = "*@${var.instructor_email_domain}" } }
      },
      {
        Effect   = "Allow", Action = ["ses:CreateEmailIdentity", "ses:GetEmailIdentity"]
        Resource = "arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/*"
      },
      { Effect = "Allow", Action = ["ses:GetAccount"], Resource = "*" }
    ]
  })
}

resource "aws_sns_topic" "reminder_events" {
  name = "${local.name}-reminder-events"
}

resource "aws_sns_topic_policy" "reminder_events" {
  arn = aws_sns_topic.reminder_events.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Principal = { Service = "ses.amazonaws.com" }, Action = "SNS:Publish"
      Resource = aws_sns_topic.reminder_events.arn
      Condition = {
        StringEquals = { "AWS:SourceAccount" = var.aws_account_id }
        ArnEquals    = { "AWS:SourceArn" = aws_sesv2_configuration_set.reminders.arn }
      }
    }]
  })
}

resource "aws_sesv2_configuration_set_event_destination" "reminders" {
  configuration_set_name = aws_sesv2_configuration_set.reminders.configuration_set_name
  event_destination_name = "delivery-status"
  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "DELIVERY_DELAY"]
    sns_destination { topic_arn = aws_sns_topic.reminder_events.arn }
  }
  depends_on = [aws_sns_topic_policy.reminder_events]
}

resource "aws_cloudwatch_log_group" "reminder_events" {
  name              = "/aws/lambda/${local.name}-reminder-events"
  retention_in_days = 14
}

resource "aws_iam_role_policy" "reminder_event_logs" {
  name = "reminder-event-logs"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.reminder_events.arn}:*" }]
  })
}

resource "aws_lambda_function" "reminder_events" {
  function_name    = "${local.name}-reminder-events"
  role             = aws_iam_role.api.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "delivery.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 15
  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.portal.name
      IMPORTS_BUCKET        = aws_s3_bucket.imports.id
      REMINDER_EVENTS_TOPIC = aws_sns_topic.reminder_events.arn
    }
  }
  depends_on = [aws_iam_role_policy.reminder_event_logs, aws_iam_role_policy.portal_data]
}

resource "aws_lambda_permission" "reminder_events" {
  statement_id   = "AllowSESEventsFromSNS"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.reminder_events.function_name
  principal      = "sns.amazonaws.com"
  source_arn     = aws_sns_topic.reminder_events.arn
  source_account = var.aws_account_id
}

resource "aws_sns_topic_subscription" "reminder_events" {
  topic_arn  = aws_sns_topic.reminder_events.arn
  protocol   = "lambda"
  endpoint   = aws_lambda_function.reminder_events.arn
  depends_on = [aws_lambda_permission.reminder_events]
}

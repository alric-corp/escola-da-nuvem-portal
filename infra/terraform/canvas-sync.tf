# Atualização automática das notas pela API do Canvas (todo/17).
#
# Duas vezes por dia, a Lambda lê o token no Secrets Manager e publica as notas das turmas
# com "Atualizar automaticamente pelo Canvas" ligado (Turmas e acessos → Configurações).
# O segredo nasce vazio: coloque o token pelo Console (Secrets Manager → portal canvas-token
# → Retrieve secret value → Edit), nunca em arquivo versionado. Depois, mude
# canvas_sync_enabled para true e aplique.

variable "canvas_sync_enabled" {
  description = "Liga o agendamento da atualização pelo Canvas. Só ligue depois de gravar o token no segredo."
  type        = bool
  default     = false
}

variable "canvas_base_url" {
  description = "Endereço do Canvas da instituição."
  type        = string
  default     = "https://awsrestart.instructure.com"
}

variable "alert_email" {
  description = "E-mail que recebe o aviso quando a atualização pelo Canvas falha (confirmar a assinatura recebida por e-mail). Vazio = sem aviso por e-mail."
  type        = string
  default     = ""
}

resource "aws_secretsmanager_secret" "canvas_token" {
  name        = "${local.name}-canvas-token"
  description = "Token da API do Canvas usado pela atualização automática de notas (somente leitura de notas)."
}

resource "aws_cloudwatch_log_group" "canvas_sync" {
  name              = "/aws/lambda/${local.name}-canvas-sync"
  retention_in_days = 30
}

resource "aws_iam_role" "canvas_sync" {
  name = "${local.name}-canvas-sync"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "canvas_sync" {
  name = "canvas-sync"
  role = aws_iam_role.canvas_sync.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.canvas_sync.arn}:*" },
      {
        # Transações usam as permissões PutItem/DeleteItem das ações subjacentes.
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = aws_dynamodb_table.portal.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging"]
        Resource = "${aws_s3_bucket.imports.arn}/cohorts/*"
      },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.canvas_token.arn }
    ]
  })
}

resource "aws_lambda_function" "canvas_sync" {
  function_name    = "${local.name}-canvas-sync"
  role             = aws_iam_role.canvas_sync.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "canvas_sync.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  # Sem o limite de 29 s do API Gateway; cada turma leva cerca de 15 s.
  timeout = 300
  environment {
    variables = {
      TABLE_NAME        = aws_dynamodb_table.portal.name
      IMPORTS_BUCKET    = aws_s3_bucket.imports.id
      CANVAS_BASE_URL   = var.canvas_base_url
      CANVAS_SECRET_ARN = aws_secretsmanager_secret.canvas_token.arn
    }
  }
  depends_on = [aws_iam_role_policy.canvas_sync]
}

resource "aws_iam_role" "canvas_sync_scheduler" {
  name = "${local.name}-canvas-sync-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.aws_account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "canvas_sync_scheduler" {
  name = "invoke-canvas-sync"
  role = aws_iam_role.canvas_sync_scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.canvas_sync.arn }]
  })
}

resource "aws_scheduler_schedule" "canvas_sync" {
  name                         = "${local.name}-canvas-sync"
  description                  = "Atualiza as notas pelo Canvas às 6h e às 18h (horário de Brasília)."
  schedule_expression          = "cron(0 6,18 * * ? *)"
  schedule_expression_timezone = "America/Sao_Paulo"
  state                        = var.canvas_sync_enabled ? "ENABLED" : "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_function.canvas_sync.arn
    role_arn = aws_iam_role.canvas_sync_scheduler.arn
    retry_policy {
      # A própria Lambda já tenta de novo as falhas temporárias do Canvas; repetir a execução
      # inteira só duplicaria o trabalho.
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "canvas_sync_errors" {
  alarm_name          = "${local.name}-canvas-sync-falhou"
  alarm_description   = "A atualização das notas pelo Canvas falhou (token expirado, curso inacessível, turma vazia ou encolhida). Veja o log /aws/lambda/${local.name}-canvas-sync e o status em Turmas e acessos."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.canvas_sync.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

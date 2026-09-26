data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend"
  excludes    = ["test_identity.py", "test_portal.py", "test_grades.py", "test_reminders.py", "test_journey.py", "test_canvas.py", "__pycache__"]
  output_path = "${path.module}/.build/identity.zip"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-identity"
  retention_in_days = 14
}

resource "aws_iam_role" "api" {
  name = "${local.name}-identity"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_logs" {
  name = "write-own-logs"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.api.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "identity" {
  function_name    = "${local.name}-identity"
  role             = aws_iam_role.api.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "portal.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 512
  timeout          = 29
  environment {
    variables = {
      TABLE_NAME                 = aws_dynamodb_table.portal.name
      IMPORTS_BUCKET             = aws_s3_bucket.imports.id
      INSTRUCTOR_EMAIL_DOMAIN    = var.instructor_email_domain
      REMINDERS_ENABLED          = tostring(var.reminders_enabled)
      REMINDER_CONFIGURATION_SET = aws_sesv2_configuration_set.reminders.configuration_set_name
      AUTH_DOMAIN                = "https://${aws_cognito_user_pool_domain.portal.domain}.auth.${var.aws_region}.amazoncognito.com"
    }
  }
  depends_on = [aws_iam_role_policy.api_logs, aws_iam_role_policy.portal_data]
}

resource "aws_apigatewayv2_api" "portal" {
  name          = local.name
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = local.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_authorizer" "portal" {
  api_id           = aws_apigatewayv2_api.portal.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.portal.id]
    issuer   = "https://cognito-idp.${var.aws_region}.${data.aws_partition.current.dns_suffix}/${aws_cognito_user_pool.portal.id}"
  }
}

resource "aws_apigatewayv2_integration" "identity" {
  api_id                 = aws_apigatewayv2_api.portal.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.identity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "me" {
  api_id               = aws_apigatewayv2_api.portal.id
  route_key            = "GET /me"
  target               = "integrations/${aws_apigatewayv2_integration.identity.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.portal.id
  authorization_scopes = ["portal/access"]
}

resource "aws_apigatewayv2_route" "portal" {
  for_each = toset([
    "GET /cohorts", "POST /cohorts", "POST /access-request", "GET /requests",
    "GET /cohorts/{code}/class-report", "GET /cohorts/{code}/report", "POST /cohorts/{code}/preview",
    "POST /cohorts/{code}/publish", "POST /cohorts/{code}/restore",
    "POST /cohorts/{code}/focus-activities",
    "POST /cohorts/{code}/instructors", "GET /cohorts/{code}/instructors",
    "POST /cohorts/{code}/revoke-instructor",
    "POST /cohorts/{code}/pending-preview", "POST /cohorts/{code}/send-reminder",
    "POST /cohorts/{code}/pending-preview-batch", "POST /cohorts/{code}/send-reminders",
    "GET /cohorts/{code}/reminder-settings", "POST /cohorts/{code}/verify-sender",
    "POST /cohorts/{code}/students-search", "POST /cohorts/{code}/unlink-student",
    "POST /cohorts/{code}/student-view",
    "POST /cohorts/{code}/display-name", "POST /requests/{userId}/reject",
    "POST /cohorts/{code}/settings",
    "POST /feedback", "GET /feedback", "GET /admin/feedback", "POST /admin/feedback/{id}/status"
  ])
  api_id               = aws_apigatewayv2_api.portal.id
  route_key            = each.value
  target               = "integrations/${aws_apigatewayv2_integration.identity.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.portal.id
  authorization_scopes = ["portal/access"]
}

resource "aws_iam_role_policy" "portal_data" {
  name = "portal-data"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        # Transações usam as permissões das ações subjacentes: PutItem/DeleteItem e, nos
        # contadores atômicos do feedback (limite por hora e resumo por status), UpdateItem.
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = aws_dynamodb_table.portal.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging"]
        Resource = "${aws_s3_bucket.imports.arn}/cohorts/*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "portal" {
  api_id      = aws_apigatewayv2_api.portal.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    # Cada entrada faz pelo menos 3 chamadas (/me, /cohorts, /report); o limite anterior
    # (10 req/s, burst 20) deixava pouca margem para uma turma inteira abrindo o portal ao
    # mesmo tempo. Sem 429 registrado no CloudWatch até aqui (uso baixo); ajustado de forma
    # preventiva, mantendo proteção contra abuso. Ver todo/07.
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId", routeKey = "$context.routeKey"
      status    = "$context.status", responseLength = "$context.responseLength"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowAuthenticatedIdentityRoute"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.identity.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.portal.execution_arn}/*/*"
}

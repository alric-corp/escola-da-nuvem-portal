data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend"
  excludes    = ["test_identity.py", "test_portal.py", "test_grades.py", "test_reminders.py", "test_journey.py", "test_canvas.py", "__pycache__", ".pytest_cache"]
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
      FEEDBACK_BUCKET            = aws_s3_bucket.feedback.id
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

locals {
  openapi_spec         = yamldecode(file("${path.module}/../../openapi/portal.yaml"))
  openapi_http_methods = toset(["get", "post", "put", "patch", "delete", "head", "options"])
  openapi_operations = flatten([
    for path, item in local.openapi_spec.paths : [
      for method, operation in item : {
        route_key = "${upper(method)} ${path}"
        authorization_type = try(anytrue([
          for requirement in try(operation.security, local.openapi_spec.security, []) :
          contains(keys(requirement), "PortalJwt")
        ]), false) ? "JWT" : "NONE"
        authorization_scopes = toset(try(operation["x-portal-authorization-scopes"], []))
      } if contains(local.openapi_http_methods, method)
    ]
  ])
  routes        = { for operation in local.openapi_operations : operation.route_key => operation }
  me_route_key  = "GET /me" # Seleção do address histórico, não uma segunda declaração da rota.
  portal_routes = { for key, route in local.routes : key => route if key != local.me_route_key }

  # Falhar antes de provisionar se uma forma de segurança não suportada pudesse virar pública.
  # O adapter atual suporta [] (pública) ou exatamente PortalJwt; alternativas OR não são inferidas.
  openapi_routing_valid = (
    local.openapi_spec.openapi == "3.0.3"
    && local.openapi_spec.components.securitySchemes.PortalJwt.type == "http"
    && local.openapi_spec.components.securitySchemes.PortalJwt.scheme == "bearer"
    && local.openapi_spec.components.securitySchemes.PortalJwt.bearerFormat == "JWT"
    && alltrue(flatten([
      for path, item in local.openapi_spec.paths : [
        can(regex("^/[^\\s?#]*$", path)),
        alltrue([for key in keys(item) :
          contains(local.openapi_http_methods, key)
          || contains(["parameters", "summary", "description", "servers"], key)
          || startswith(key, "x-")
        ]),
        alltrue([for method, operation in item : try(
          jsonencode(try(operation.security, local.openapi_spec.security, [])) == jsonencode([{ PortalJwt = [] }])
          || (length(try(operation.security, local.openapi_spec.security, [])) == 0
          && length(try(operation["x-portal-authorization-scopes"], [])) == 0), false
        ) if contains(local.openapi_http_methods, method)])
      ]
    ]))
  )
}

resource "aws_apigatewayv2_route" "me" {
  api_id               = aws_apigatewayv2_api.portal.id
  route_key            = local.routes[local.me_route_key].route_key
  target               = "integrations/${aws_apigatewayv2_integration.identity.id}"
  authorization_type   = local.routes[local.me_route_key].authorization_type
  authorizer_id        = local.routes[local.me_route_key].authorization_type == "JWT" ? aws_apigatewayv2_authorizer.portal.id : null
  authorization_scopes = local.routes[local.me_route_key].authorization_scopes

  lifecycle {
    precondition {
      condition     = local.openapi_routing_valid
      error_message = "OpenAPI: path/método ou segurança não suportados; use PortalJwt ou security=[] sem scopes."
    }
  }
}

resource "aws_apigatewayv2_route" "portal" {
  for_each             = local.portal_routes
  api_id               = aws_apigatewayv2_api.portal.id
  route_key            = each.value.route_key
  target               = "integrations/${aws_apigatewayv2_integration.identity.id}"
  authorization_type   = each.value.authorization_type
  authorizer_id        = each.value.authorization_type == "JWT" ? aws_apigatewayv2_authorizer.portal.id : null
  authorization_scopes = each.value.authorization_scopes

  lifecycle {
    precondition {
      condition     = local.openapi_routing_valid
      error_message = "OpenAPI: path/método ou segurança não suportados; use PortalJwt ou security=[] sem scopes."
    }
  }
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
        # Delivery compartilha esta role, mas não executa ConditionCheck. A condição
        # concede a nova ação somente às chamadas originadas na função identity.
        Effect   = "Allow"
        Action   = ["dynamodb:ConditionCheckItem"]
        Resource = aws_dynamodb_table.portal.arn
        Condition = { ArnEquals = {
          "lambda:SourceFunctionArn" = "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:${var.aws_account_id}:function:${local.name}-identity"
        } }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging"]
        Resource = "${aws_s3_bucket.imports.arn}/cohorts/*"
      },
      {
        # Anexos do feedback: assinar o POST de upload (tmp/), ler para validar e promover, gerar
        # links de leitura (feedback/) e apagar o temporário.
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.feedback.arn}/tmp/*", "${aws_s3_bucket.feedback.arn}/feedback/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${aws_s3_bucket.feedback.arn}/tmp/*"
      },
      {
        # Rollback de uma promoção cuja gravação no DynamoDB falhou: apaga só a versão criada.
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "${aws_s3_bucket.feedback.arn}/feedback/*"
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

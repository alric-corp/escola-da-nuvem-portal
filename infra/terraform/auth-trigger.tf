# Gatilho Cognito "pre token generation" (V2_0): inclui email e email_verified no access
# token para que backend/portal.py:authenticate() não precise chamar /oauth2/userInfo em
# toda requisição (ver todo/04-email-no-access-token.md). Papel próprio, mínimo: só grava
# os próprios logs, sem acesso a DynamoDB/S3.

resource "aws_cloudwatch_log_group" "auth_trigger" {
  name              = "/aws/lambda/${local.name}-auth-trigger"
  retention_in_days = 14
}

resource "aws_iam_role" "auth_trigger" {
  name = "${local.name}-auth-trigger"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "auth_trigger_logs" {
  name = "write-own-logs"
  role = aws_iam_role.auth_trigger.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.auth_trigger.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "auth_trigger" {
  function_name    = "${local.name}-auth-trigger"
  role             = aws_iam_role.auth_trigger.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "auth_trigger.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 128
  timeout          = 5
  depends_on       = [aws_iam_role_policy.auth_trigger_logs]
}

resource "aws_lambda_permission" "auth_trigger" {
  statement_id   = "AllowCognitoPreTokenGeneration"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.auth_trigger.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_arn     = aws_cognito_user_pool.portal.arn
  source_account = var.aws_account_id
}

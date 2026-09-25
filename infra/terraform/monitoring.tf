# Alarmes do portal em produção, no mesmo tópico de e-mail do alarme da atualização pelo Canvas.
# O identity devolve 500 quando captura uma exceção, então a métrica Errors da Lambda não vê
# essas falhas; o 5xx da API cobre esse caso, além de timeout (504) e throttling da Lambda.
# Uso baixo (até ~800 chamadas/dia): 3 respostas 5xx em 15 minutos já indicam um problema real.

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-erros-5xx"
  alarm_description   = "A API do portal respondeu com erro 5xx (falha interna, timeout ou Lambda sobrecarregada). Veja o log /aws/lambda/${local.name}-identity e o log de acesso da API."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.portal.id, Stage = aws_apigatewayv2_stage.portal.name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Se o gatilho do token falhar, o Cognito recusa o login: ninguém entra no portal.
resource "aws_cloudwatch_metric_alarm" "auth_trigger_errors" {
  alarm_name          = "${local.name}-login-gatilho-falhou"
  alarm_description   = "O gatilho de geração de token do Cognito falhou, e o login foi recusado. Veja o log /aws/lambda/${local.name}-auth-trigger."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.auth_trigger.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "reminder_events_errors" {
  alarm_name          = "${local.name}-eventos-de-email-falhou"
  alarm_description   = "O processamento de eventos de entrega do SES falhou. Veja o log /aws/lambda/${local.name}-reminder-events."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.reminder_events.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

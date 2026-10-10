# AUTO-5: acesso manual à mesma worker por alias protegido. O payload não autentica.
variable "manual_recovery_operator_arn" {
  description = "Principal IAM exato autorizado a assumir a role de recuperação; vazio não cria a role."
  type        = string
  default     = ""
  validation {
    condition     = var.manual_recovery_operator_arn == "" || can(regex("^arn:aws:iam::${var.aws_account_id}:(user|role)/[A-Za-z0-9_+=,.@/-]+$", var.manual_recovery_operator_arn))
    error_message = "Informe um user/role IAM exato da mesma conta; sem root, serviço, sessão STS ou wildcard."
  }
}

variable "manual_recovery" {
  description = "Autorização revisada separadamente: uma turma/ocorrência original e validade absoluta de no máximo 30 min."
  type = object({
    enabled       = bool
    cohort        = string
    scheduled_for = string
    not_before    = string
    expires_at    = string
  })
  default = {
    enabled       = false
    cohort        = "BRSA0267"
    scheduled_for = "2026-10-09T23:00:00Z"
    not_before    = "1970-01-01T00:00:00Z"
    expires_at    = "1970-01-01T00:00:00Z"
  }
  validation {
    condition = (
      var.manual_recovery.cohort == "BRSA0267"
      && var.manual_recovery.scheduled_for == "2026-10-09T23:00:00Z"
      && (!var.manual_recovery.enabled || try(
        var.manual_recovery_operator_arn != ""
        && timecmp(var.manual_recovery.not_before, var.manual_recovery.expires_at) < 0
        && timecmp(var.manual_recovery.expires_at, timeadd(var.manual_recovery.not_before, "30m")) <= 0,
        false
      ))
    )
    error_message = "Somente BRSA0267/09-10-2026 20h; habilitação exige operador e autorização absoluta de até 30 minutos."
  }
}

locals {
  # Não referenciar o recurso Lambda no próprio environment (criaria ciclo).
  manual_recovery_alias_arn = "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:${var.aws_account_id}:function:${local.name}-automatic-reminders:manual-recovery"
}

resource "aws_lambda_alias" "manual_recovery" {
  name             = "manual-recovery"
  description      = "Recuperação direta autorizada; calendário automático permanece intacto."
  function_name    = aws_lambda_function.automatic_reminders.function_name
  function_version = aws_lambda_function.automatic_reminders.version
}

# A operação é síncrona. Defesa adicional: nunca repetir erros automaticamente
# caso um operador utilize InvocationType=Event por engano.
resource "aws_lambda_function_event_invoke_config" "manual_recovery" {
  function_name                = aws_lambda_function.automatic_reminders.function_name
  qualifier                    = aws_lambda_alias.manual_recovery.name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}

resource "aws_iam_role" "manual_recovery_operator" {
  count                = var.manual_recovery_operator_arn == "" ? 0 : 1
  name                 = "${local.name}-manual-recovery-operator"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { AWS = var.manual_recovery_operator_arn }
    }]
  })
}

resource "aws_iam_role_policy" "manual_recovery_operator" {
  count = var.manual_recovery_operator_arn == "" ? 0 : 1
  name  = "invoke-only-manual-recovery"
  role  = aws_iam_role.manual_recovery_operator[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = local.manual_recovery_alias_arn
      Condition = {
        # Gate fechado também revoga a permissão de Invoke da role. Datas no
        # passado não autorizam novas chamadas mesmo com credenciais STS válidas.
        DateGreaterThanEquals = { "aws:CurrentTime" = var.manual_recovery.enabled ? var.manual_recovery.not_before : "1970-01-01T00:00:00Z" }
        DateLessThan          = { "aws:CurrentTime" = var.manual_recovery.enabled ? var.manual_recovery.expires_at : "1970-01-01T00:00:00Z" }
      }
    }]
  })
}

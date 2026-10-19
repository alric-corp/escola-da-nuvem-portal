variable "aws_account_id" {
  description = "Conta esperada. Impede criação acidental em outra conta."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Informe o ID de 12 dígitos da conta AWS."
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# Identificadores do GitHub. Os IDs numéricos são imutáveis (não mudam com rename/transfer) e formam o
# subject imutável já ativo no repositório (use_immutable_subject = true).
variable "github_owner" {
  type    = string
  default = "alric-corp"
}

variable "github_owner_id" {
  type    = string
  default = "178685987"
  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id é numérico."
  }
}

variable "github_repository" {
  type    = string
  default = "escola-da-nuvem-portal"
}

variable "github_repository_id" {
  type    = string
  default = "1385899942"
  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id é numérico."
  }
}

variable "github_environment" {
  description = "Environment do GitHub cujo job pode assumir a role (com revisores e branch main)."
  type        = string
  default     = "production"
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.github_environment))
    error_message = "Nome de environment sem espaços, curingas ou ':'."
  }
}

variable "deploy_branch" {
  type    = string
  default = "main"
  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]+$", var.deploy_branch))
    error_message = "Branch exata, sem curingas."
  }
}

# Endurecimento opcional. Vazio = condição ausente da trust. Preencher só com o valor de job_workflow_ref
# observado no token real do job de deploy (operação verify), num apply revisado. Valor exato, sem curingas,
# do próprio repositório e da branch de deploy.
variable "trusted_job_workflow_ref" {
  type    = string
  default = ""
  validation {
    condition = var.trusted_job_workflow_ref == "" || can(regex(
      format("^%s/%s/\\.github/workflows/[A-Za-z0-9_.-]+\\.ya?ml@refs/heads/%s$", var.github_owner, var.github_repository, var.deploy_branch),
      var.trusted_job_workflow_ref
    ))
    error_message = "job_workflow_ref exato: OWNER/REPO/.github/workflows/ARQUIVO.yml@refs/heads/BRANCH, deste repositório."
  }
}

variable "frontend_bucket_name" {
  description = "Bucket web existente (output frontend_bucket da infraestrutura principal)."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.frontend_bucket_name))
    error_message = "Nome de bucket S3 inválido."
  }
}

variable "cloudfront_distribution_id" {
  description = "Distribuição existente (output cloudfront_distribution_id da infraestrutura principal)."
  type        = string
  validation {
    condition     = can(regex("^E[A-Z0-9]{6,20}$", var.cloudfront_distribution_id))
    error_message = "ID de distribuição CloudFront inválido."
  }
}

variable "role_name" {
  type    = string
  default = "restart-portal-prod-github-frontend-deploy"
}

variable "releases_prefix" {
  description = "Prefixo das releases imutáveis no bucket web."
  type        = string
  default     = "releases/"
  validation {
    condition     = can(regex("^[a-z0-9-]+/$", var.releases_prefix))
    error_message = "Prefixo simples terminado em '/', sem curingas."
  }
}

variable "max_session_duration" {
  type    = number
  default = 3600
  validation {
    condition     = var.max_session_duration >= 900 && var.max_session_duration <= 3600
    error_message = "Sessões curtas: entre 900 e 3600 segundos."
  }
}

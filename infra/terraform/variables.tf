variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_account_id" {
  description = "Conta pessoal na qual os recursos serão criados."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Informe o ID de 12 dígitos da sua conta AWS."
  }
}

variable "project_name" {
  type    = string
  default = "restart-portal"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project_name))
    error_message = "Use de 3 a 20 caracteres: letras minúsculas, números e hífen."
  }
}

variable "environment" {
  type    = string
  default = "prod"
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Use dev ou prod."
  }
}

variable "initial_cohort" {
  description = "Primeira turma; novas turmas serão cadastradas pela aplicação."
  type        = string
  default     = "BRSA0267"
  validation {
    condition     = can(regex("^[A-Z0-9-]{3,32}$", var.initial_cohort))
    error_message = "Use de 3 a 32 letras maiúsculas, números ou hífens."
  }
}

variable "instructor_email_domain" {
  description = "Domínio de candidatos a instrutor; não concede privilégios."
  type        = string
  default     = "escoladanuvem.org"
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.instructor_email_domain))
    error_message = "Informe um domínio minúsculo sem @."
  }
}

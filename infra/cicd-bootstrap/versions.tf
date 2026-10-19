# Identidade de deploy do frontend (GitHub Actions → AWS por OIDC). State próprio: nunca a chave
# portal/prod/terraform.tfstate da infraestrutura principal (ver README.md e backend.hcl.example).
terraform {
  required_version = ">= 1.10, < 2.0"
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project     = "restart-portal"
      Environment = "prod"
      ManagedBy   = "Terraform"
      Purpose     = "cicd-frontend-deploy"
    }
  }
}

resource "aws_cognito_user_pool" "portal" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  user_pool_tier           = "ESSENTIALS"
  username_configuration {
    case_sensitive = false
  }
  admin_create_user_config {
    allow_admin_create_user_only = false
  }
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }
  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.auth_trigger.arn
      lambda_version = "V2_0"
    }
  }
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Seu código de verificação | Escola da Nuvem"
    email_message = templatefile("${path.module}/verification-email.html.tftpl", {
      portal_url = local.portal_url
    })
  }
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = aws_sesv2_email_identity.escoladanuvem_domain.arn
    from_email_address    = "Portal Escola da Nuvem <noreply@${var.instructor_email_domain}>"
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_user_pool_domain" "portal" {
  domain                = local.suffix
  user_pool_id          = aws_cognito_user_pool.portal.id
  managed_login_version = 2
  depends_on            = [aws_cognito_managed_login_branding.portal]
}

resource "aws_cognito_managed_login_branding" "portal" {
  user_pool_id = aws_cognito_user_pool.portal.id
  client_id    = aws_cognito_user_pool_client.portal.id
  settings     = file("${path.module}/cognito-branding.json")
  asset {
    category   = "FORM_LOGO"
    color_mode = "DARK"
    extension  = "PNG"
    bytes      = filebase64("${path.module}/../../frontend/logo.png")
  }
}

resource "aws_cognito_resource_server" "portal" {
  identifier   = "portal"
  name         = "Portal API"
  user_pool_id = aws_cognito_user_pool.portal.id
  scope {
    scope_name        = "access"
    scope_description = "Acessar a API com as permissões da conta autenticada"
  }
}

resource "aws_cognito_user_pool_client" "portal" {
  name                                 = "${local.name}-web"
  user_pool_id                         = aws_cognito_user_pool.portal.id
  generate_secret                      = false
  supported_identity_providers         = ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "${aws_cognito_resource_server.portal.identifier}/access"]
  callback_urls                        = [for o in local.allowed_origins : "${o}/"]
  logout_urls                          = [for o in local.allowed_origins : "${o}/"]
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 7
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each = {
    admin      = "Administrador global, atribuição manual"
    instructor = "Instrutor aprovado; acesso a turmas exige vínculo na aplicação"
    student    = "Aluno; acesso a notas exige vínculo na aplicação"
  }
  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.portal.id
}

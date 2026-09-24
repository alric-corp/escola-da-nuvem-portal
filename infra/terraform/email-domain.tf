# Identidade de domínio no SES para escoladanuvem.org, com Easy DKIM e MAIL FROM
# personalizado. Resolve o alinhamento DMARC: a identidade de endereço avulso
# (aws_sesv2_email_identity.cognito_sender, em reminders.tf) não suporta DKIM e usa
# o domínio de bounce padrão *.amazonses.com, que nunca se alinha com o domínio do
# cabeçalho From (escoladanuvem.org) — e o DNS de escoladanuvem.org publica
# "v=DMARC1; p=reject; pct=100", então mensagens sem alinhamento são recusadas
# pelo destinatário (não apenas marcadas como spam).
#
# Esta identidade só passa a ser usada (email_configuration.source_arn em auth.tf)
# depois que os registros de saída deste arquivo forem publicados no DNS de
# escoladanuvem.org e o status virar SUCCESS dos dois lados — ver
# infra/SES.md. Até lá, o Cognito continua enviando pela identidade de endereço
# existente, sem mudança de comportamento.
resource "aws_sesv2_email_identity" "escoladanuvem_domain" {
  email_identity = var.instructor_email_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "escoladanuvem_domain" {
  email_identity         = aws_sesv2_email_identity.escoladanuvem_domain.email_identity
  mail_from_domain       = "mail.${var.instructor_email_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

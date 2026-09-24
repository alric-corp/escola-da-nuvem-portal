# Lembretes de atividades com Amazon SES

## Implementação atual — 24/09/2026 (ainda não implantada)

O fluxo de lembretes foi retomado no código por solicitação do titular. `reminders_enabled` no Terraform controla a Lambda (`REMINDERS_ENABLED`), com padrão `true`. Definir `false` bloqueia envio/ativação de remetente e mantém a consulta de atividades sem chamadas SES. Nenhum e-mail real foi disparado nos testes.

- Cadastro e recuperação continuam usando `noreply@escoladanuvem.org`, conforme `auth.tf`.
- Lembretes usam o endereço institucional da pessoa autenticada, com autorização na turma. O instrutor escolhe **Lembretes → Solicitar confirmação do meu e-mail**. Aprovação de acesso não dispara essa mensagem automaticamente.
- `SESMailer.ensure_identity` só cria a identidade quando ausente. Identidades existentes não são recriadas: o instrutor deve consultar a mensagem de confirmação anterior e usar **Já confirmei · verificar novamente**.
- A leitura de `GetAccount` e `GetEmailIdentity` verifica confirmação individual, acesso de produção e disponibilidade do serviço. A política de envio restringe o remetente ao domínio institucional.
- Cada envio exige prévia atual, destinatário confirmado na interface e reserva transacional. Não há envio coletivo nem disparo automático na publicação.
- `aws_sesv2_configuration_set_event_destination.reminders` publica DELIVERY, BOUNCE, COMPLAINT, REJECT e DELIVERY_DELAY no tópico SNS do portal. A Lambda `reminder_events` aceita apenas esse tópico e grava apenas status/data, sem armazenar destinatário ou corpo.
- `COHORT#<turma>/REMINDER#<publicação>#<aluno>` guarda a tentativa e o MessageId. `EMAIL#<messageId>/DELIVERY` guarda o evento, permitindo receber uma notificação mesmo antes de a chamada SendEmail retornar.
- `sent` é aceite do SES, não entrega. `delivered` é entrega ao servidor do destinatário, não comprovação de leitura. `failed` admite tentativa manual; `sending`, `unknown`, `bounced`, `complained` e demais estados não liberam duplicação da mesma publicação.

## Implantação e validação

Esta entrega altera API, infraestrutura e frontend; publicar somente o frontend não habilita os novos contratos. Revisar/aplicar o plano Terraform e depois executar `scripts/deploy_frontend.sh`. Os links de atividades Canvas permanecem pausados no frontend.

Validações locais: suíte Python com repositório em memória, Moto/botocore Stubber, testes de navegador com API simulada e `terraform validate/test`. O teste dos eventos cobre origem SNS, duplicação e ordenação. Entrega real em caixas de e-mail deve ser validada após a implantação usando um destinatário de teste escolhido pelo titular.

Referências: [eventos SES publicados no SNS](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html), [renovação OAuth no Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html).

## Histórico operacional

As seções abaixo registram o estado observado nas respectivas datas e não descrevem necessariamente a implementação atual.

## Solicitação de produção em 14/09/2026

O titular confirmou que os alunos autorizaram receber os lembretes e autorizou solicitar produção. O pedido foi submetido com sucesso pela API SES v2 em us-east-1, tipo TRANSACTIONAL, usando `ses-production-request.json`.

A consulta posterior retornou `ProductionAccessEnabled: false`, `ReviewDetails.Status: DENIED` e caso `178941187900377`. O remetente segue `PENDING`, sem verificação concluída. A razão da negativa não foi disponibilizada pelo GetAccount; não foi atribuída uma causa presumida.

A tentativa de consultar o caso pela API AWS Support retornou `SubscriptionRequiredException` (essa API exige assinatura Premium Support). O próximo passo é confirmar o remetente e abrir o caso no Support Center pelo console para ler e responder à comunicação da AWS. Texto factual de apoio preparado em `SES-REVIEW.md`; não enviado automaticamente. Não é necessário contratar suporte apenas para seguir esta orientação.

## Cadastro do Cognito bloqueado pelo limite de 50 e-mails/dia (14/09/2026)

O `email_configuration` do user pool usava `COGNITO_DEFAULT`, cujo limite de 50 e-mails/dia (cadastro + recuperação de senha) não é uma cota ajustável — não aparece em `aws service-quotas list-service-quotas --service-code cognito-idp`. CloudTrail confirmou os 429 em `signup_POST` na UI hospedada, todos de um único IP no mesmo intervalo, sugerindo novas tentativas do mesmo cliente, não ~163 alunos distintos.

A pedido do titular, o Terraform (`auth.tf`) foi alterado para `email_sending_account = "DEVELOPER"`, usando a identidade `aws_sesv2_email_identity.reminders` já existente (mesmo remetente `tomas.alric@escoladanuvem.org`). O plano (`terraform plan -out=cognito-ses-email.tfplan`, salvo em `infra/terraform/.build/cognito-ses-email-plan.txt`) mostra só essa mudança: 1 a alterar, 0 a criar, 0 a destruir.

**Não aplicado.** Confirmado ao vivo nesta data: remetente `VerificationStatus: PENDING` (`VerifiedForSendingStatus: false`) e conta SES ainda em sandbox (`ProductionAccessEnabled: false`). Aplicar agora pararia 100% dos cadastros (SES rejeita remetente não verificado; mesmo verificado, sandbox só entrega a destinatários também verificados). Só aplicar `cognito-ses-email.tfplan` depois de:
1. Confirmar o remetente (link de verificação enviado pelo SES à caixa `tomas.alric@escoladanuvem.org`).
2. Resolver o caso `178941187900377` e obter produção liberada no SES.

Até lá, o pool segue em `COGNITO_DEFAULT` (funcional até 50 envios/dia).

**Aplicado em 16/09/2026.** SES aprovado para produção (`ProductionAccessEnabled: true`, cota 50.000/24h) e remetente verificado; `terraform apply` rodado pelo titular. Confirmado ao vivo: `describe-user-pool` retorna `EmailSendingAccount: DEVELOPER`, `SourceArn` da identidade SES, e `terraform plan` não mostra diferenças. O cadastro do Cognito agora envia pelo SES, sem o teto de 50/dia do `COGNITO_DEFAULT`.

Os lembretes de atividades continuam pausados (`REMINDERS_ENABLED=false`, prévia/envio fora da interface) — essa aprovação do SES não reativa esse recurso; ver seção "Ativação do remetente e produção" acima.

## Remetente por instrutor (16/09/2026)

Cada turma tem seu próprio instrutor, então os lembretes passaram a ser enviados com o e-mail do instrutor que aprova/dispara o envio, não mais com um endereço fixo. `tomas.alric@escoladanuvem.org` continua existindo no Terraform (`aws_sesv2_email_identity.cognito_sender`), mas exclusivamente como remetente dos e-mails de conta do Cognito (cadastro, recuperação de senha) — não é mais usado nos lembretes.

- Quando um admin aprova um instrutor para uma turma (`POST /cohorts/{code}/instructors`), o backend chama `SESMailer.ensure_identity(email)`: se a identidade SES daquele e-mail ainda não existir, cria (`CreateEmailIdentity`), o que faz o SES mandar automaticamente o e-mail de confirmação para o instrutor. Identidades já existentes não são recriadas, para não reenviar a confirmação à toa.
- A política IAM da Lambda não fixa mais um único remetente: permite `ses:SendEmail` de qualquer endereço `*@escoladanuvem.org` (o mesmo domínio institucional já exigido para virar instrutor) e `ses:CreateEmailIdentity`/`ses:GetEmailIdentity` sobre qualquer identidade da conta.
- Na prévia/envio, `readiness()` e o `From`/`Reply-To` da mensagem usam o e-mail do instrutor autenticado (`self.user["email"]`), não mais uma variável fixa. Um instrutor cujo e-mail ainda não foi confirmado no SES simplesmente não consegue enviar (mesmo bloqueio de antes, só que por pessoa, não pela conta inteira) — outros instrutores já confirmados continuam funcionando normalmente.
- A variável Terraform `reminder_sender_email` foi renomeada para `cognito_sender_email` (reflete seu uso real); a env var `REMINDER_SENDER` do Lambda foi removida (não é mais lida).

Infra: `terraform plan` mostra só 2 mudanças (política IAM + variáveis do Lambda), 0 destruições — a identidade SES existente só migra de endereço no state (`aws_sesv2_email_identity.reminders[0]` → `aws_sesv2_email_identity.cognito_sender`), preservando a verificação já feita. Testado com `terraform test` (mock provider) e a suíte Python (`test_portal.py`, `test_reminders.py`, `tests/integration/test_ses.py` via Stubber) — nenhum aluno ou instrutor real recebe e-mail nesses testes.

## Diagnóstico: quase 100% dos e-mails de cadastro rejeitados por DMARC (17/09/2026)

Investigando um bounce pontual do e-mail de confirmação do Cognito para um aluno (`tomas.alricc@gmail.com`), a suspeita inicial foi erro de digitação no endereço. O titular confirmou que o endereço estava correto, o que levou à investigação abaixo.

**Não é um problema pontual.** `admin-get-user` confirmou a conta no Cognito (`UNCONFIRMED`, `Enabled: true`) e `get-suppressed-destination` confirmou que o endereço não está na lista de supressão do SES — ou seja, o SES aceitou o envio e o bounce veio do Gmail. A métrica `AWS/SES Bounce` no CloudWatch mostrou 27 bounces contra `SentLast24Hours: 28` na mesma janela: quase todo envio está sendo rejeitado, não só esse.

**Causa raiz:** `aws_sesv2_email_identity.cognito_sender` é uma identidade de **endereço** (`tomas.alric@escoladanuvem.org`), que não suporta Easy DKIM (`DkimAttributes.Status: NOT_STARTED`, permanente para esse tipo de identidade). Sem MAIL FROM personalizado (`BehaviorOnMxFailure: USE_DEFAULT_VALUE`), o envelope usa o domínio de bounce padrão `*.amazonses.com`, que nunca se alinha com `escoladanuvem.org` no cabeçalho `From`. O DNS de `escoladanuvem.org` publica `v=DMARC1; p=reject; pct=100`. Sem DKIM nem SPF alinhados, toda mensagem falha o DMARC e é recusada pelo destinatário (não apenas marcada como spam) — independente de o endereço do aluno estar certo. Essa limitação já estava registrada acima ("A identidade de endereço evita depender de acesso ao DNS institucional... a verificação do endereço, sozinha, não garante entrega em todas as caixas"); esta seção documenta que o efeito previsto se concretizou.

Achado à parte, sem relação com o SES: o SPF atual de `escoladanuvem.org` (`v=spf1 include:zcsend.net include:spf.protection.outlook.com include:zeptomail.net include:transmail.net -all include:_spf.google.com ~all`) tem um `-all` no meio da string, antes de `include:_spf.google.com ~all`. Como a avaliação de SPF para no primeiro mecanismo `all` encontrado, esse trecho final nunca é avaliado. Vale corrigir junto de quem administra o DNS, mas não é a causa do bounce investigado aqui.

**Correção aplicada (aditiva, sem afetar o envio atual):** criados em `infra/terraform/email-domain.tf` — `aws_sesv2_email_identity.escoladanuvem_domain` (identidade de domínio para `escoladanuvem.org`, com Easy DKIM `RSA_2048_BIT`) e `aws_sesv2_email_identity_mail_from_attributes.escoladanuvem_domain` (MAIL FROM personalizado em `mail.escoladanuvem.org`). Outputs em `outputs.tf` (`escoladanuvem_domain_dkim_dns`, `escoladanuvem_mail_from_dns`) expõem os registros DNS a publicar. Aplicado com `terraform apply -target=...` para isolar da drift pré-existente no working tree (2 rotas do API Gateway e a Lambda `identity`, sem relação com este trabalho) — `email_configuration.source_arn` em `auth.tf` **não foi alterado**, o Cognito continua enviando pela identidade de endereço existente.

Registros a publicar no DNS de `escoladanuvem.org` (fora do controle do titular; pedir a quem administra o DNS institucional):

| Tipo | Nome | Valor |
|---|---|---|
| CNAME | `z6qi3hlknvmtqhoz6l7ivizucwicppzl._domainkey.escoladanuvem.org` | `z6qi3hlknvmtqhoz6l7ivizucwicppzl.dkim.amazonses.com` |
| CNAME | `ntb5xmwnzdv2bjzmd7ou34gzmytuwfbl._domainkey.escoladanuvem.org` | `ntb5xmwnzdv2bjzmd7ou34gzmytuwfbl.dkim.amazonses.com` |
| CNAME | `udambm34djvtog3xbgplo6pcraetvlxt._domainkey.escoladanuvem.org` | `udambm34djvtog3xbgplo6pcraetvlxt.dkim.amazonses.com` |
| MX | `mail.escoladanuvem.org` | `10 feedback-smtp.us-east-1.amazonses.com` |
| TXT | `mail.escoladanuvem.org` | `v=spf1 include:amazonses.com ~all` |

Com Easy DKIM, os 3 CNAME publicados também completam a verificação de propriedade do domínio — não há TXT de verificação separado nesse fluxo.

**Próximos passos, nesta ordem:**
1. Repassar os 5 registros acima a quem administra o DNS de `escoladanuvem.org`.
2. Após propagação, confirmar com `aws sesv2 get-email-identity --email-identity escoladanuvem.org --region us-east-1` que `VerificationStatus` e `DkimAttributes.Status` estão `SUCCESS`.
3. Só então trocar `email_configuration.source_arn` em `auth.tf` de `aws_sesv2_email_identity.cognito_sender.arn` para `aws_sesv2_email_identity.escoladanuvem_domain.arn` e aplicar — trocar antes disso quebraria o envio atual (SES rejeita remetente referenciando identidade de domínio ainda não verificada).
4. Opcionalmente, corrigir o SPF malformado do domínio raiz `escoladanuvem.org` junto de quem administra o DNS (achado à parte, acima).
# Remetente da plataforma — 23/09/2026

Cognito atualizado em produção por plano Terraform limitado ao User Pool: remetente `Portal Escola da Nuvem <noreply@escoladanuvem.org>`, identidade SES `escoladanuvem.org`, sem Reply-To. Domínio verificado, DKIM e MAIL FROM `mail.escoladanuvem.org` confirmados como SUCCESS antes da aplicação. Leitura posterior confirmou a configuração do Cognito. Nenhum e-mail de teste foi enviado nesta alteração; recebimento ainda precisa ser validado. A identidade individual anterior foi preservada. As seções abaixo registram o histórico.

# Rascunho para o caso SES 178941187900377

**Não enviado.** Revise antes de colar no Support Center. Este texto responde ao e-mail da AWS pedindo frequência de envio, manutenção da lista de destinatários, tratamento de bounce/complaint/unsubscribe e um exemplo de mensagem — não à pergunta genérica anterior (esse rascunho antigo foi substituído). Confira o exemplo de e-mail abaixo antes de enviar; ele usa um nome de aluno fictício, não um aluno real.

Remetente verificado em 14/09/2026 (`VerifiedForSendingStatus: true`, `VerificationStatus: SUCCESS`, conferido via `aws sesv2 get-email-identity`). Conta ainda em sandbox (`ProductionAccessEnabled: false`) na mesma consulta.

---

Hello,

Thank you for the response on case 178941187900377. Here is the additional detail you requested.

For context: Escola da Nuvem is an AWS training institution running an AWS re/Start-affiliated program. Our students complete AWS Labs and Knowledge Checks (KCs) as part of the curriculum, and our portal tracks each student's progress from Canvas grade exports. The reminders we requested production access for are about that same pending coursework.

**Verified identity:** tomas.alric@escoladanuvem.org is now a verified address identity in us-east-1. We understand a verified domain identity is preferred; we started with a single verified address because we do not yet have delegated access to our institution's DNS to complete domain verification, and plan to move to a domain identity once that access is arranged.

**Sending frequency:** This is not a bulk or scheduled campaign. An email is sent only when an instructor reviews a new Canvas grade-export import for their own cohort and explicitly confirms sending — one message per student per grade publication, only to students who still have pending Knowledge Checks or Labs. A publication typically covers a single cohort of roughly 20-30 students, so we expect well under 100 messages per publication, occurring a few times per course. The system prevents sending more than one reminder for the same student and publication.

**Recipient list maintenance:** There is no separate marketing or mailing list. Recipients are computed server-side, per request, from the enrolled-student roster of the instructor's own Canvas grade export; the instructor cannot type in an arbitrary address. Each message addresses only the named student about that student's own pending activities.

**Bounce, complaint and unsubscribe handling:** Sending goes through an SES configuration set with reputation tracking and automatic suppression for BOUNCE and COMPLAINT. Because each message is a one-off, instructor-triggered reminder rather than a recurring campaign, there is no separate unsubscribe link; the message's Reply-To address goes to the sending instructor, and a student who no longer wants reminders replies to ask their instructor to stop — since nothing is sent automatically or on a recurring basis, that fully stops delivery going forward. We will treat SES suppression-list events the same way.

**Example message** (student name is a placeholder, not a real student):

```
Subject: Podemos ajudar? Atividades pendentes · BRSAO257

Olá, Ana Silva!

Percebemos que você está com atividades pendentes na turma BRSAO257,
conforme a atualização de 2026-09-14.

KCs pendentes:
- Networking Fundamentals

LABs pendentes:
- Deploy a Static Website

Precisa de algum auxílio? Responda a este e-mail para conversar com seu instrutor.

Se você já entregou as atividades após essa atualização, avise seu instrutor.

Conte com a gente!
Equipe de instrução · Escola da Nuvem · AWS re/Start
```

Please let us know if anything else would help complete this review.

Thank you.

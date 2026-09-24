# 08 · Enviar lembretes em lote

**Status:** ✅ concluída (aplicado em produção) · **Prioridade:** média · **Esforço:** médio · **Área:** instrutor

## Problema
O envio era de um aluno por vez: abrir detalhes, conferir, enviar, confirmar. Numa turma de 30 alunos, isso consumia muito tempo.

## O que foi feito

### Backend
- `backend/portal.py`: novo método `_reminder_batch`, com duas rotas:
  - `POST /cohorts/{code}/pending-preview-batch` — recebe `studentIds` (a lista já filtrada no painel), lê a publicação atual uma vez e devolve, para cada aluno: nome, e-mail, quantidade de atividades sem nota e o motivo de ser pulado (`no-email`, `no-pending`, `already-sent`, `not-found`) ou `skip: null` se for enviar. Também devolve uma mensagem de exemplo (`sample`) gerada a partir do primeiro aluno elegível, e a prontidão do SES (`ses`).
  - `POST /cohorts/{code}/send-reminders` — recebe `studentIds` e `expectedPublicationId`; reclassifica os alunos (a mesma lógica da prévia, para não confiar em nada vindo do navegador) e processa em sequência: reserva `REMINDER#<pub>#<aluno>` (mesma transação otimista do envio individual, incluindo a mesma proteção contra publicação concorrente), chama o SES e grava o resultado. Devolve `{results: [{id, name, status: "sent"|"skipped"|"failed", reason?}]}`.
  - Entre um envio e outro, uma pausa configurável (`REMINDER_BATCH_DELAY_SECONDS`, padrão 0,25s) para não estourar a taxa de envio do SES — a taxa real da conta não é exposta pela API do SESv2 usada aqui, então o valor é uma margem de segurança conservadora, não calculada dinamicamente.
  - Se a turma for publicada de novo no meio do lote (`Conflict` na transação), o envio para nesse ponto: o aluno em curso ainda é tentado, os restantes voltam como `skipped`/`publication-changed` — nenhum e-mail é enviado com dados de uma publicação que não é mais a atual.
  - Reaproveita `message_for` (mesmo texto do envio individual) e a mesma regra de não reenviar (só falhas anteriores podem ser retentadas).
- `infra/terraform/api.tf`: duas novas rotas registradas, com a mesma exigência de JWT + escopo `portal/access` das demais.

### Frontend
- `frontend/pages/teacher.js`: quando o filtro "Com atividades sem nota" está ativo e há resultados, aparece um botão "Enviar lembrete para N aluno(s)" com os IDs já filtrados.
- `frontend/pages/reminders.js`: nova `batchPage()` — lista os destinatários com o motivo de quem será pulado, mostra uma mensagem de exemplo (deixando claro que cada aluno recebe uma versão própria) e, depois do envio, uma tabela com o resultado por aluno (enviado/pulado/falhou, com o motivo).
- `frontend/app.js`: nova view `reminders-batch`, com `loadBatchPreview()` e os handlers `reminders-batch` (abre a prévia) e `send-reminders-batch` (confirma e envia). Voltar ao painel restaura a busca/filtro/ordenação anteriores, como já acontecia na tela de pendências individuais.

## Testes
- `backend/test_reminders.py`: 5 testes novos — prévia com os motivos corretos de pular; envio processa e não duplica em uma segunda tentativa; alunos inelegíveis são pulados sem travar o restante do lote; acesso exige papel de instrutor/domínio institucional e valida a lista de IDs; uma publicação concorrente no meio do lote interrompe o restante sem tentar enviar com dados desatualizados.
- Suíte completa do backend: **85/85** testes unitários + **9/9** de integração (`tests/integration/test_aws.py`), todos passando.
- `terraform validate`/`terraform test`: passando.
- Novo `tests/reminders-batch-browser.mjs` (Playwright, instalado temporariamente nesta sessão): filtra "Com atividades sem nota", abre o lote, confere quem é pulado e por quê, confirma o envio e o resultado por aluno, e confere que voltar ao painel restaura o filtro. Passou, junto com toda a suíte de navegador existente (nenhuma regressão).

## Aplicado em produção em 2026-09-24
`terraform apply`: **2 recursos criados** (as duas novas rotas), **3 atualizados** (as lambdas, com o código novo), **0 destruídos**. `terraform plan` depois confirma "No changes". `scripts/deploy_frontend.sh` publicado com sucesso (invalidação `I8NX7V6RZ0BHHG86PL0QGYC0B0`).

## Critérios de aceite
- [x] Nenhum aluno recebe dois e-mails na mesma publicação (mesma reserva/condição do envio individual, testada também no fluxo em lote).
- [x] O resultado por aluno (enviado, pulado, falhou) é mostrado ao final.
- [x] Publicar notas continua sem disparar e-mails (o lote só roda quando o instrutor abre a tela e confirma o envio).

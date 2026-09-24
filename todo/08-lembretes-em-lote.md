# 08 · Enviar lembretes em lote

**Prioridade:** média · **Esforço:** médio · **Área:** instrutor

## Problema
O envio é de um aluno por vez: abrir detalhes, conferir, enviar, confirmar. Numa turma de 30 alunos, isso consome muito tempo.

## Proposta
- No painel, filtrar "Com atividades sem nota" e oferecer **Enviar lembrete para N alunos**.
- Mostrar uma prévia de exemplo e a lista de destinatários, incluindo quem será pulado (sem e-mail ou já contatado nesta publicação).
- No backend, criar uma rota `send-reminders` que processa os alunos em sequência, reaproveitando a reserva `REMINDER#<pub>#<aluno>` e a regra de não reenviar.
- Respeitar a taxa de envio do SES.

## Critérios de aceite
- [ ] Nenhum aluno recebe dois e-mails na mesma publicação.
- [ ] O resultado por aluno (enviado, pulado, falhou) é mostrado ao final.
- [ ] Publicar notas continua sem disparar e-mails.

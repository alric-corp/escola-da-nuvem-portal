# 24 — Melhorias de UX e lifecycle

**Status:** pendente.

## Contexto

Pequenos problemas conhecidos que não justificaram interromper entregas
prioritárias anteriores. Cada caso deve ser conferido ao retomar o trabalho;
esta rodada apenas registra o backlog.

## Pendências conhecidas

- **Admin Feedback:** um 409 de mudança de status pode deixar select/badge
  inconsistentes.
- **Admin Feedback:** tratamento de erro em “Carregar mais”.
- **Importação:** Map/estado dos drafts pode ficar desatualizado até `saveDraft`.
- **Feedback:** revisar estado sobrevivendo à troca de usuário.
- **Attachments:** lifecycle/revogação de ObjectURL.
- **Foco/acessibilidade:** revisar apenas pequenos casos remanescentes,
  preservando as garantias da C7.1.

## Regra de execução futura

Não juntar todos os pontos em um commit gigante. Quando este TODO for
retomado, dividir em subetapas pequenas conforme domínio e risco, com
validação específica de cada comportamento.

Não implementar nesta rodada documental.

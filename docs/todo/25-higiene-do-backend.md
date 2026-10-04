# 25 — Higiene do backend

**Status:** pendente.

## Pendências conhecidas

- Substituir usos diretos de `datetime.now()` onde houver necessidade de
  clock/fonte testável.
- Corrigir o SyntaxWarning conhecido relacionado ao escape `"\;"` no backend.
- Revisar pequenos pontos de higiene encontrados durante a rodada, sem
  transformar o trabalho em refactor geral.

## Cuidados

- Alteração de backend exige considerar o deploy de Lambda em uma execução
  própria; este registro não autoriza deploy.
- Manter o comportamento funcional.
- Usar testes RED/GREEN para as mudanças.
- Usar Moto quando aplicável.
- Revisar packaging e o conteúdo do pacote da Lambda.
- Não fazer alterações apenas estéticas em massa.

Não implementar nesta rodada documental.

# TODO

Backlog atual do portal da Escola da Nuvem.

Arquivos na raiz representam trabalho pendente, incluindo evoluções guardadas
para o futuro. Itens entregues ficam em [`concluido/`](concluido/README.md),
com seu histórico e evidências de implementação.

## Pendentes

| ID | Item | Estado |
| --- | --- | --- |
| 05 | [Descoberta de turmas por vínculo](05-descoberta-de-turmas-por-vinculo.md) | Pendente — otimização por vínculo entregue; scan global permanece |
| 15 | [Aviso de nova publicação](15-aviso-de-nova-publicacao.md) | Pendente — decisão da coordenação |
| 20 | [Domínio próprio](20-dominio-proprio.md) | Pendente / dependência externa |
| 22 | [OpenAPI modular e pipeline de contrato](22-openapi-modular-e-pipeline-de-contrato.md) | Guardado / evolução futura |
| 23 | [Concorrência e respostas stale](23-corridas-e-respostas-stale.md) | Pendente — C7.3 concluída e deploy confirmado; C7.4 commitada, CI verde, deploy pendente; C7.5/C7.6 não iniciadas |
| 24 | [Melhorias de UX e lifecycle](24-melhorias-ux-e-lifecycle.md) | Pendente — não iniciado |
| 25 | [Higiene do backend](25-higiene-do-backend.md) | Pendente — não iniciado |

Não renumerar itens históricos: os números registram a origem do roadmap.
Ao concluir um item, mover o mesmo arquivo para `concluido/`, preservando
seu número e nome. Prioridades e esforços dos documentos existentes são
os registros históricos de abertura.

## Acompanhamentos de itens já implementados

- [13 — Retenção](concluido/13-retencao-de-dados.md): regras para novos
  rascunhos implementadas; limpeza de dados anteriores sem tags/TTL não realizada.
- [17 — Canvas](concluido/17-integracao-api-canvas.md): integração
  implementada; rotação da credencial pessoal continua manutenção operacional.

## Iniciativas operacionais em andamento

Não são TODOs numerados: acompanham uma operação em produção e não recebem ID.

### AUTO-5 — lembretes automáticos

[Evidências e checkpoints](../auto-5.md). Estado conhecido em 10/10/2026, 19h12:

- BRSA0267: Scheduler **ENABLED** (terça e sexta, 20h).
- BRSA0257: Scheduler **DISABLED**.
- Gate automático **true**; recuperação manual **false**.

Etapas:

- [x] LIVE manual BRSA0267: 27 enviados/27 deliveries, sem duplicidade.
- [x] Envio manual normal BRSA0257: 22 enviados/22 deliveries, sem duplicidade.
- [x] Gate automático aplicado, com schedules ainda DISABLED.
- [x] Piloto BRSA0267 habilitado (somente esse Scheduler).
- [ ] Piloto natural BRSA0267: **próximo marco em 13/10/2026** — Canvas natural
  às 18h e, em seguida, Scheduler da BRSA0267 às 20h.
- [ ] Primeira ocorrência natural BRSA0257: alvo 16/10 às 20h, somente após o
  piloto BRSA0267 PASS e com aprovação explícita.
- [ ] Encerramento: ambas as turmas com manual e Scheduler natural PASS,
  gates/settings/IAM corretos, SES/dedupe/WITHDRAWN/observabilidade aprovados e
  full plan sem drift AUTO-5, exceto o ACM conhecido.

**AUTO-5 está aberta; não está concluída** e não deve ser dada como concluída
antes dos dois Schedulers naturais. Não iniciar AUTO-6.

## Notas de contexto

API-1 e API-2 estão concluídas e commitadas; os registros ficam em
[historico/api-1.md](../historico/api-1.md) e [historico/api-2.md](../historico/api-2.md). O TODO 22 guarda uma evolução futura e
não as reabre.

A C7.2 foi concluída e ativada em produção. A C7.3 foi concluída e o deploy
foi confirmado. A C7.4 está commitada (`cdb5e36`) com CI verde; o deploy está
pendente de aprovação própria. Os itens do backlog não reabrem
participação/desistentes nem autorizam implementação ou deploy.

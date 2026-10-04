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
| 23 | [Concorrência e respostas stale](23-corridas-e-respostas-stale.md) | Pendente |
| 24 | [Melhorias de UX e lifecycle](24-melhorias-ux-e-lifecycle.md) | Pendente |
| 25 | [Higiene do backend](25-higiene-do-backend.md) | Pendente |

Não renumerar itens históricos: os números registram a origem do roadmap.
Ao concluir um item, mover o mesmo arquivo para `concluido/`, preservando
seu número e nome. Prioridades e esforços dos documentos existentes são
os registros históricos de abertura.

## Acompanhamentos de itens já implementados

- [13 — Retenção](concluido/13-retencao-de-dados.md): regras para novos
  rascunhos implementadas; limpeza de dados anteriores sem tags/TTL não realizada.
- [17 — Canvas](concluido/17-integracao-api-canvas.md): integração
  implementada; rotação da credencial pessoal continua manutenção operacional.

API-1 já foi concluída e commitada. A [API-2](../api-2.md) é uma entrega
separada, implementada localmente e aguardando aprovação; o TODO 22 guarda
uma evolução futura e não reabre API-1/API-2.

A C7.2 já foi concluída e ativada em produção. Os itens novos não reabrem
participação/desistentes nem autorizam implementação ou deploy nesta rodada.

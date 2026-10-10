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

## Operação pendente — AUTO-5

[Evidências e checkpoints](../auto-5.md). Atualização de 10/10/2026, 17h07:

- [x] LIVE manual BRSA0267: 27 enviados/27 deliveries, sem duplicidade;
  autorização encerrada. Nenhum novo bounce/complaint observado no preflight.
- [x] Envio manual normal BRSA0257: lote revisado e explicitamente aprovado;
  nova autenticação/prévia e revalidação PASS. Um POST HTTP 200, 22 REMINDER sent
  e 22 deliveries confirmados, sem duplicidade ou envio indevido. Gates false
  e schedules DISABLED; Errors/Throttles=0 e sem Bounce/Complaint observados.
  Sessão encerrada, nenhum retry. O fluxo normal não
  exerce claim AUTO_REMINDER da worker; AUTO_REMINDER BRSA0257 permanece zero.
- [ ] Gate automático: preparar commit/CI/plano somente após os dois LIVE
  manuais PASS; revisão antes do apply, com schedules ainda DISABLED.
- [ ] Piloto natural BRSA0267: alvo 13/10 às 20h, condicionado aos pré-requisitos
  e à aprovação; observar primeiro o SYNC_RUN natural das 18h.
- [ ] Primeira ocorrência natural BRSA0257: alvo 16/10 às 20h, somente após
  piloto natural BRSA0267 PASS e aprovação explícita.
- [ ] Encerramento: ambas as turmas com manual e Scheduler natural PASS,
  gates/settings/IAM corretos, SES/dedupe/WITHDRAWN/observabilidade aprovados e
  full plan sem drift AUTO-5, exceto ACM conhecido.

Estado preservado: state 83, alias manual versão 3 desabilitada, ambas as flags
false, IAM temporário revogado e ambos schedules DISABLED. As datas são metas
condicionais à conclusão aprovada do manual BRSA0257 e às revisões dos planos.
Nenhum schedule foi habilitado nesta rodada. **AUTO-5 aberta; não iniciar AUTO-6.**

API-1 já foi concluída e commitada. A [API-2](../api-2.md) é uma entrega
separada, implementada localmente e aguardando aprovação; o TODO 22 guarda
uma evolução futura e não reabre API-1/API-2.

A C7.2 já foi concluída e ativada em produção. Os itens novos não reabrem
participação/desistentes nem autorizam implementação ou deploy nesta rodada.

# TODO

Backlog atual do portal da Escola da Nuvem.

Arquivos na raiz representam o backlog ativo. Itens entregues ficam em
[`concluido/`](concluido/README.md), com seu histórico e evidências de
implementação. Propostas fora do planejamento atual ficam em
[`despriorizado/`](despriorizado/README.md), sem compromisso de entrega.

## Pendentes

| ID | Item | Estado |
| --- | --- | --- |
| 20 | [Domínio próprio](20-dominio-proprio.md) | Pendente / dependência externa |
| 28 | [Vínculos adicionais de instrutores](28-vinculos-adicionais-de-instrutores.md) | Lacuna de jornada: aprovado sem ação para outra turma ou devolução de acesso |
| 29 | [Diagnóstico da sincronização por etapa](29-diagnostico-da-sincronizacao-por-etapa.md) | Notas sem mudanças podem ocultar a falha auxiliar na apresentação do relatório |
| 30 | [QA manual e limpeza](30-atualizar-qa-manual-e-limpeza.md) | Roteiros antigos precisam acompanhar os perfis, releases e projeções atuais |

Não renumerar itens históricos: os números registram a origem do roadmap.
Ao concluir um item, mover o mesmo arquivo para `concluido/`, preservando
seu número e nome. Prioridades e esforços dos documentos existentes são
os registros históricos de abertura.

## Levantamento de fluxo — 23/10/2026

Base de código: main `bbd7e6972d736e4a68b610f68b035aad594e9aaa`, após PR #17,
consultada diretamente no GitHub. As mudanças locais de organização do backlog
foram preservadas. A revisão examinou Foco da turma, atalhos/filtros/CSV,
vínculos administrativos, resumo de sincronização e o kit de QA manual.

Os itens 26–28 foram demonstrados com renderização e funções reais em Node,
dados fictícios e sem rede. O item 29 foi reproduzido com repositório/Canvas
controlados, dispatcher e renderização reais. O item 30 decorre da comparação
dos scripts com os contratos atuais; nenhum script produtivo foi executado.
Essas evidências não comprovam frequência ou incidente em produção.

Ordem sugerida no levantamento inicial: corrigir 26/27 juntos, completar a
jornada 28 e melhorar o diagnóstico 29. A atualização local do kit 30 pode avançar em paralelo; o QA
autenticado continua dependendo de identidades e execução autorizadas.

**Evolução nesta branch:** o titular substituiu a correção do 26 pela
[remoção do Foco da turma](concluido/26-remover-foco-da-turma.md). Essa remoção e
a [correção dos atalhos do 27](concluido/27-atalhos-e-filtros-do-painel.md)
estão implementadas, com integração/publicação ainda pendentes. Os documentos
ficam em `concluido/` pelo escopo de desenvolvimento; não declaram implantação.

Não foram criados itens duplicados para implantação/cutover do 05, limpeza do
legado do 13, rotação Canvas do 17 ou destino institucional de solicitações,
já acompanhado no [Guia do curso](../course-guide.md). A leitura integral do
histórico do instrutor e a correlação de erros com logs podem ser reavaliadas
após medir volume/necessidade; não justificam ampliar esta entrega.

## Acompanhamentos de itens já implementados

- [05 — Descoberta sem Scan](concluido/05-descoberta-de-turmas-por-vinculo.md):
  implementação testada e integrada no PR #17, encerrada documentalmente em
  23/10/2026. Implantação backend, reconciliação e cutover produtivos ainda
  precisam ser comprovados conforme o [roteiro](../derived-access.md#implantação-futura-não-executada).
  Até lá, o fallback legado com Scan pode permanecer em produção.
- [13 — Retenção](concluido/13-retencao-de-dados.md): regras para novos
  rascunhos implementadas; limpeza de dados anteriores sem tags/TTL não realizada.
- [17 — Canvas](concluido/17-integracao-api-canvas.md): integração
  implementada; rotação da credencial pessoal continua manutenção operacional.

## Despriorizados

| ID | Item | Estado |
| --- | --- | --- |
| 15 | [Aviso de nova publicação](despriorizado/15-aviso-de-nova-publicacao.md) | Proposta preservada, fora do planejamento atual; sem implementação ou prazo de retomada |

Publicar notas continua não enviando e-mail; os lembretes existentes não foram
alterados. O número 15 não será reutilizado.

## Operações concluídas

Não são TODOs numerados: acompanham uma operação em produção e não recebem ID.

### AUTO-5 — lembretes automáticos

[Evidências e checkpoints](../historico/automacoes/auto-5.md). Estado verificado em
**CONCLUÍDA em 15/10/2026, 01h17**: ambos pilotos naturais **PASS**. BRSA0267 em 13/10:
32 enviados / 32 deliveries; BRSA0257 em 14/10: **14 enviados / 14 deliveries**,
sem falhas, duplicidade ou envio WITHDRAWN. Recorrência das duas turmas
restaurada, exceção retirada e aceite final aprovado. Seções 26–29.

- BRSA0267: Scheduler **ENABLED** (terça e sexta, 20h).
- BRSA0257: Scheduler **ENABLED** (terça e sexta, 20h).
- Gate automático **true**; recuperação manual **false**.

Etapas:

- [x] LIVE manual BRSA0267: 27 enviados/27 deliveries, sem duplicidade.
- [x] Envio manual normal BRSA0257: 22 enviados/22 deliveries, sem duplicidade.
- [x] Gate automático aplicado, com schedules ainda DISABLED.
- [x] Piloto BRSA0267 habilitado (somente esse Scheduler).
- [x] Piloto natural BRSA0267 de **13/10/2026**: Canvas natural das 18h
  succeeded/published e Scheduler das 20h completed; **32 sent / 32 deliveries**.
- [x] Antecipação pontual BRSA0257 implantada para **14/10 às 20h**;
  worker versão 5, CI verde e full plan somente ACM.
- [x] Primeira ocorrência natural BRSA0257: **14/10 às 20h PASS**, com prova
  natural das 18h válida, **14 sent / 14 deliveries**; auditoria na seção 28.
- [x] Restaurar a recorrência terça/sexta da BRSA0257 em plano revisado.
- [x] Remover a exceção datada de 14/10 da worker em deploy revisado.
- [x] Encerramento: ambas as turmas com manual e Scheduler natural PASS,
  gates/settings/IAM corretos, SES/dedupe/WITHDRAWN/observabilidade aprovados e
  full plan sem drift AUTO-5, exceto o ACM conhecido.

**AUTO-5 encerrada.** State 89, worker versão 6, 95 envios/95 entregas
preservados e full plan final somente ACM conhecido. AUTO-6 não iniciada.

## Notas de contexto

API-1 e API-2 estão concluídas e commitadas; os registros ficam em
[historico/api-1.md](../historico/api-1.md) e [historico/api-2.md](../historico/api-2.md). O [TODO 22 — OpenAPI modular](concluido/22-openapi-modular-e-pipeline-de-contrato.md) foi integrado pelo PR #13, sem reabri-las.

Em **22/10/2026 (Brasília)**, o TODO 22 foi encerrado documentalmente e movido para `concluido/`. O [PR #13](https://github.com/alric-corp/escola-da-nuvem-portal/pull/13) integrou a mudança em `c62f924033b6ea44cd09c4c1094b1a88610d2fa3`; [CI do PR](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39689826762) com quatro checks aprovados, [CI da main](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39692747676) e [deploy automático](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39694238148) concluíram com sucesso. A conferência AS-IS de 21/10/2026 observou a release `c62f924033b6-b17c56bb10be`, com o hash bruto do bundle esperado. Essa evidência histórica fecha a integração/publicação pendente, sem novo deploy, auditoria AWS ou afirmação de QA autenticado/coleta Canvas completa.

A C7.2 e a C7.3 continuam concluídas. Na revisão de 21/10/2026, a implantação
existente da C7.4/C7.5 foi comprovada na release `9058941ffa4d-301af4d0e066`
([deploy](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39543703472)),
com leitura dos módulos publicados. O TODO 25 foi encerrado: as duas correções
C7.6 foram encontradas no ZIP da Lambda efetivamente integrada à API,
correspondente à implantação já relatada no PR #10. Veja as evidências em
[25 — Higiene do backend](concluido/25-higiene-do-backend.md).

Após a integração do [PR #12](https://github.com/alric-corp/escola-da-nuvem-portal/pull/12), a pendência de publicação dos TODOs [23 — Concorrência](concluido/23-corridas-e-respostas-stale.md) e [24 — UX e lifecycle](concluido/24-melhorias-ux-e-lifecycle.md) foi encerrada. A conferência curta de 21/10/2026 encontrou a release ativa `e99c93f56932-0a4e45d446a9`, source `e99c93f569329279b79847916fdb5dbd92fbd670`, e cinco arquivos de runtime idênticos à revisão e aos hashes/tamanhos do manifesto. O [deploy automático 39600814952](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39600814952) concluiu publicação, ativação e smoke. Os dois registros foram movidos para `concluido/`, preservando o histórico e as limitações. Não houve novo deploy, revisão funcional ou reabertura de participação/desistentes, AUTO-5, domínio próprio ou TODO 25.


## Validação histórica — consolidação do PR #12 (21/10/2026)

Consolidação dos TODOs 23–25 a partir da main `9058941`: os números abaixo foram executados naquela missão e são preservados como histórico. Não são as contagens da implementação do TODO 22; seus resultados estão no documento e no PR correspondente.

| Comando | Resultado |
| --- | --- |
| `npm test` | 497 testes aprovados, zero falhas/skips |
| `npm run test:browser` | 255 testes/entradas aprovados, zero falhas/skips; os módulos de importação também incluem os novos cenários internos controlados |
| `python3 tests/contracts/stale_mutations.py` | Controles aprovados, 28 mutações mortas, zero sobreviventes; mantém os 21 controles históricos e acrescenta 7 |
| `python3 tests/contracts/lifecycle_mutations.py` | Controles aprovados, 44 mutações mortas, zero sobreviventes; preserva os controles existentes e acrescenta 5 |
| Python 3.12, `python -B -m unittest discover -s backend` | 317 aprovados |
| Python 3.12, `python -B -m unittest discover -s tests/integration` | 218 aprovados, Moto sem AWS real |
| Recorte TODO 25, `backend.test_journey tests.integration.test_hygiene` | 25 aprovados (já contidos nas suítes anteriores, não somados a elas) |

As novas regressões cobrem dados, erros, finally/loading, lista/cursor, troca de turma/tela/usuário, A→B→A e retornos legítimos; usam promises controladas, sem sleeps arbitrários. Uma proteção publicação/nova seleção é explicitamente defensiva: a UI normalmente bloqueia a seleção durante a publicação. As únicas atualizações de caracterização deliberada são o isolamento de confirmação/loading entre pessoas e o guard mais forte do lote; as verificações anteriores foram preservadas. Naquela missão, não houve novos recursos AWS, alterações de backend ou implementação do TODO 22.

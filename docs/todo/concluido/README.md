# TODOs concluídos — mapa de implementação

Revisão original em **04/10/2026**, no HEAD `c64921b`, com a implementação local
da API-2 ainda aguardando aprovação. Foram conferidos os **21 TODOs**
originais contra código, testes, histórico Git e relatórios existentes:
**18 concluídos, 1 parcial e 2 pendentes**.

Os 18 documentos dessa revisão estão em `docs/todo/concluido/`. Em 21/10/2026, os TODOs 23, 24 e 25 também foram encerrados, totalizando 21 documentos numerados concluídos; os demais ficam em `docs/todo/`.
Em **22/10/2026 (Brasília)**, o TODO 22 teve a integração/publicação confirmada e foi arquivado, totalizando **22 documentos numerados concluídos**.
Em **23/10/2026 (Brasília)**, o escopo de desenvolvimento do TODO 05 foi encerrado
e arquivado, totalizando **23 documentos numerados concluídos**. O TODO 15 foi
preservado em [despriorizado/](../despriorizado/15-aviso-de-nova-publicacao.md)
por decisão do titular, sem ser contado como implementado.
Os IDs foram preservados. O [backlog ativo](../README.md) mantém
os itens que ainda precisam de decisão ou trabalho.

“Concluído” significa que a implementação do escopo entregue está presente
no repositório. Não significa uma certificação funcional universal de produção.
A revisão original não consultou AWS, Canvas nem contas de alunos; as conferências
posteriores de publicação estão identificadas nos documentos individuais, com
suas fontes e limitações. Não houve novo deploy nesta atualização documental.

## Encerramento documental adicional — 23/10/2026 (Brasília)

| ID | Escopo integrado | Evidência e limite |
| --- | --- | --- |
| [05 — Descoberta sem Scan](05-descoberta-de-turmas-por-vinculo.md) | Projeções consultáveis na tabela existente, manutenção pelos writers e migração/reconciliação explícitas; zero Scan após cutover simulado | [PR #17](https://github.com/alric-corp/escola-da-nuvem-portal/pull/17) integrado em `bbd7e69`, [CI 4/4](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39895519895) aprovado. Implantação backend, backfill e cutover produtivos permanecem em [acompanhamento](../README.md#acompanhamentos-de-itens-já-implementados); não declarados executados. |

## Encerramento documental adicional — 22/10/2026 (Brasília)

| ID | Escopo integrado | Evidência de integração/publicação |
| --- | --- | --- |
| [22 — OpenAPI modular e pipeline de contrato](22-openapi-modular-e-pipeline-de-contrato.md) | Fontes por domínio, bundle determinístico versionado, check no CI e contratos dos consumidores, sem mudança semântica da API | [PR #13](https://github.com/alric-corp/escola-da-nuvem-portal/pull/13) integrado em `c62f924`; [CI do PR 4/4](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39689826762), [CI da main](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39692747676) e [deploy automático](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39694238148) aprovados. AS-IS de 21/10/2026 conferiu a release `c62f924033b6-b17c56bb10be` e o hash bruto esperado do OpenAPI. Histórico/limites preservados; não substitui QA autenticado ou comprovação da coleta Canvas. |

## Encerramento adicional — 21/10/2026

| ID | Código / testes nesta revisão | Implantação comprovada |
| --- | --- | --- |
| [23 — Concorrência e respostas stale](23-corridas-e-respostas-stale.md) | Revisão transversal, ownership/contexto e regressões RED/GREEN/mutações preservados | PR #12 integrado em `e99c93f`; deploy automático [39600814952](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39600814952) aprovado; ponteiro e cinco módulos públicos conferidos contra revisão e manifesto. Sem nova revisão funcional. |
| [24 — Melhorias de UX e lifecycle](24-melhorias-ux-e-lifecycle.md) | C7.5 e correções delimitadas de CSV, lista administrativa e anexos, com histórico de testes preservado | Mesma release ativa `e99c93f56932-0a4e45d446a9`; arquivos publicados idênticos ao commit integrado e ao manifesto. Sem acesso a contas ou dados de alunos. |
| [25 — Higiene do backend](25-higiene-do-backend.md) | Relógio da prévia, limites de expiração, compilação e Content-Disposition revalidados em 25 testes Python 3.12; sem nova alteração de backend | ZIP da Lambda `identity` e integração API Gateway conferidos somente por leitura; `portal.py` e `feedback.py` idênticos à revisão implantada `302bb3c` e à main `9058941`. Evidências e limites no documento. |

A pendência de publicação dos TODOs [23](23-corridas-e-respostas-stale.md) e [24](24-melhorias-ux-e-lifecycle.md) foi encerrada pela conferência somente leitura da release do PR #12. O [TODO 25](25-higiene-do-backend.md) permanece concluído e seu documento não foi alterado por essa conferência.

## Mapa dos 18 concluídos

| ID / tarefa | Implementação conferida | Evidência de teste / limite |
| --- | --- | --- |
| [01 — Atividades liberadas](01-lembrar-atividades-liberadas.md) | [Portal._prepare](../../../backend/portal.py) mantém atividades anteriormente ativas quando não há seleção explícita; [prévia](../../../frontend/pages/import.js) exibe alerta de retirada | [test_portal.py](../../../backend/test_portal.py): `test_preview_keeps_previously_active_activity_below_heuristic` e `test_preview_still_honors_explicit_selection` |
| [02 — Links Canvas](02-ativar-links-canvas.md) | Flag habilitada em [ui.js](../../../frontend/ui.js); [canvas-links.js](../../../frontend/canvas-links.js) valida links do catálogo recebido do backend | [canvas-links.mjs](../../../tests/canvas-links.mjs) e [canvas-links-browser.mjs](../../../tests/canvas-links-browser.mjs); catálogo fixo histórico foi substituído pelo item 12 |
| [03 — Tom e média do aluno](03-tom-e-media-para-o-aluno.md) | [studentPage](../../../frontend/pages/student.js) usa [goalIndicator](../../../frontend/ui.js), referências por turma e aviso de ausência de nota contando como zero | Código atual conferido; [student-journey-browser.mjs](../../../tests/student-journey-browser.mjs) integra a suíte já aprovada. Não se afirma asserção específica de cada frase |
| [04 — Claims de e-mail no token](04-email-no-access-token.md) | [auth_trigger.py](../../../backend/auth_trigger.py), [auth-trigger.tf](../../../infra/terraform/auth-trigger.tf) e [auth.tf](../../../infra/terraform/auth.tf) configuram pre token generation V2_0; `authenticate` evita userInfo quando a claim existe | [test_portal.py](../../../backend/test_portal.py) verifica ausência de chamada userInfo e recusa de e-mail não verificado; fallback permanece intencional |
| [06 — Histórico compacto](06-historico-do-aluno-sem-releitura.md) | [Portal._publish/history/student_summary_entry](../../../backend/portal.py) grava e lê history.json; snapshots antigos têm fallback | [test_aws.py](../../../tests/integration/test_aws.py): `test_student_report_history_uses_compact_summary_and_falls_back_for_legacy_publications` |
| [07 — Limites da API](07-limite-da-api.md) | [Stage](../../../infra/terraform/api.tf) com rate 50 / burst 100; [api.js](../../../frontend/api.js) tenta novamente GET em 429 e não repete POST | [rate-limit-browser.mjs](../../../tests/rate-limit-browser.mjs) e [api.mjs](../../../tests/api.mjs) |
| [08 — Lembretes em lote](08-lembretes-em-lote.md) | [Portal._reminder_batch](../../../backend/portal.py), [batchPage](../../../frontend/pages/reminders.js) e [handlers](../../../frontend/handlers/reminders.js); prévia, elegibilidade e proteção contra duplicação | [test_reminders.py](../../../backend/test_reminders.py) e [reminders-batch-browser.mjs](../../../tests/reminders-batch-browser.mjs), incluindo proteções posteriores para desistentes |
| [09 — Atividades e foco](09-visao-por-atividade-e-foco.md) | [grades.overview](../../../backend/grades.py), [activities-overview.js](../../../frontend/pages/activities-overview.js) e foco com limite de três | [test_grades.py](../../../backend/test_grades.py), [activity-overview-browser.mjs](../../../tests/activity-overview-browser.mjs) e [student-journey-browser.mjs](../../../tests/student-journey-browser.mjs) |
| [10 — Detalhe do aluno](10-detalhe-do-aluno-para-instrutor.md) | [Portal._reminder_flow](../../../backend/portal.py) fornece summary, allActivities e histórico; [reminders.js](../../../frontend/pages/reminders.js) mostra o detalhe | [test_reminders.py](../../../backend/test_reminders.py): `test_preview_includes_full_student_detail_for_instructor`; [instructor-tools-browser.mjs](../../../tests/instructor-tools-browser.mjs) |
| [11 — Administração de vínculos](11-admin-vinculos-e-nomes.md) | [Portal](../../../backend/portal.py): busca, desvínculo, nome e recusa com autorização; [access.js](../../../frontend/pages/access.js) e [handlers](../../../frontend/handlers/access.js) | [test_portal.py](../../../backend/test_portal.py), integração de transações em [test_aws.py](../../../tests/integration/test_aws.py) e [admin-access-browser.mjs](../../../tests/admin-access-browser.mjs) |
| [12 — Configuração da turma](12-configuracao-da-turma-no-backend.md) | Limites/curso em [Portal._set_cohort_settings](../../../backend/portal.py); catálogo por ID em [canvas.course_catalog](../../../backend/canvas.py) e [canvas_sync](../../../backend/canvas_sync.py), sem listas fixas de cursos no frontend | [test_canvas.py](../../../backend/test_canvas.py), testes de settings em [test_portal.py](../../../backend/test_portal.py) e [canvas-links-browser.mjs](../../../tests/canvas-links-browser.mjs) |
| [13 — Retenção](13-retencao-de-dados.md) | Tags draft/published e TTL em [Portal](../../../backend/portal.py)/[Repository](../../../backend/repository.py); regras 30/90 dias em [storage.tf](../../../infra/terraform/storage.tf) | [test_portal.py](../../../backend/test_portal.py), [test_aws.py](../../../tests/integration/test_aws.py) e [infrastructure.tftest.hcl](../../../infra/terraform/tests/infrastructure.tftest.hcl). Limpeza do legado sem tags/TTL não foi feita |
| [14 — CI](14-integracao-continua.md) | [Workflow](../../../.github/workflows/ci.yml), [package.json](../../../package.json), lockfile e [requirements-dev.txt](../../../requirements-dev.txt) | CI da API-1 verde no SHA `c64921b`; mudanças locais de CI da API-2 ainda não foram enviadas |
| [16 — Recência e evolução](16-proximos-passos-e-evolucao.md) | [Portal._publish](../../../backend/portal.py) mantém releasedAt; [nextActivities](../../../frontend/student-journey.js) ordena por recência; [evolution](../../../frontend/pages/student.js) separa KC/LAB | [test_portal.py](../../../backend/test_portal.py), [student-journey.mjs](../../../tests/student-journey.mjs) e [instructor-tools-browser.mjs](../../../tests/instructor-tools-browser.mjs) |
| [17 — Integração Canvas](17-integracao-api-canvas.md) | [canvas.py](../../../backend/canvas.py), [canvas_sync.py](../../../backend/canvas_sync.py), `sync_from_canvas` e [Scheduler](../../../infra/terraform/canvas-sync.tf); publicação automática conforme decisão registrada | [test_canvas.py](../../../backend/test_canvas.py) e [test_aws.py](../../../tests/integration/test_aws.py); não existe necessidade de criar a rota de prévia sugerida antes da decisão de automação |
| [18 — CSV e copiar mensagem](18-exportar-csv.md) | [studentsCsv](../../../frontend/pages/teacher.js), exportação em [app.js](../../../frontend/app.js) e clipboard em [handlers/reminders.js](../../../frontend/handlers/reminders.js) | [instructor-tools-browser.mjs](../../../tests/instructor-tools-browser.mjs) e [participation.mjs](../../../tests/participation.mjs): filtros, escape de fórmula e participação |
| [19 — Organização e robustez](19-organizacao-e-robustez-do-codigo.md) | Mapa actions em [app.js](../../../frontend/app.js), tratamento HTTP em [api.js](../../../frontend/api.js), normalize em [ui.js](../../../frontend/ui.js), notas em históricos de organização preservados no Git | [api.mjs](../../../tests/api.mjs), [architecture.mjs](../../../tests/architecture.mjs) e [handlers.mjs](../../../tests/handlers.mjs); legacy removido posteriormente no commit `aadb9b6` |
| [21 — Persistência da sessão](21-sessao-em-localstorage.md) | [auth.js](../../../frontend/auth.js) usa localStorage para sessão/OAuth; [app.js](../../../frontend/app.js) persiste contexto e limpa no logout | [auth-refresh.mjs](../../../tests/auth-refresh.mjs) e suítes de browser. sessionStorage de “Visualizar como aluno” é um fluxo distinto e intencional |

## Itens que não foram arquivados como concluídos

| ID | Status verificado | Implementado | Falta / decisão |
| --- | --- | --- | --- |
| [20 — Domínio próprio](../20-dominio-proprio.md) | Código parcial; operação pendente | Flags e referências de certificado/CORS/callbacks existem no HCL | Relatório API-2 registrou ACM ausente no refresh e create no plano; emissão/validação, DNS institucional e ativação continuam pendentes |

Na revisão original de 04/10/2026, o item 05 era parcial: os vínculos reduziam
leituras de snapshots, mas não eliminavam o Scan. A implementação posterior do
PR #17 e o encerramento de seu escopo de desenvolvimento estão registrados
[no documento arquivado](05-descoberta-de-turmas-por-vinculo.md), preservando a
pendência operacional. O item 15 foi despriorizado em 23/10/2026; sua
[proposta foi preservada](../despriorizado/15-aviso-de-nova-publicacao.md), sem
implementação, e publicar notas continua sem enviar e-mail.

## Ressalvas e correções do histórico

- **02/12:** catálogos fixos citados nos relatos antigos foram substituídos
  por catálogo do Canvas. Módulos/links de novos cursos já são implementados.
- **03:** a UI evoluiu de studentBadge para goalIndicator. O aviso antigo de
  Playwright indisponível foi superado pelas suítes executadas na API-2;
  não significa que todas as frases tenham asserção dedicada.
- **13:** a política prospectiva está implementada; o passivo de rascunhos
  anteriores, sem tags/TTL, continua explicitamente fora da conclusão.
  Nenhuma limpeza foi executada ou declarada concluída.
- **17:** a limitação histórica “aguardando parte 2 do item 12” foi resolvida.
  Rotação do token pessoal continua sendo manutenção operacional; sua validade
  atual não foi consultada nesta revisão.
- **19:** mover legacy foi concluído no commit `4414051`; remoção posterior
  em `aadb9b6` explica por que o diretório não existe mais.
- **20:** o relato de criação do certificado em setembro não comprova sua
  disponibilidade atual. Usou-se a evidência posterior do plano API-2.

Também foram corrigidas referências da documentação ativa que ainda diziam
ser necessário editar DynamoDB para desvincular um aluno ou editar código
para mudar os limites acadêmicos da turma.

## Base de validação

Esta organização documental reutiliza os resultados já concluídos da
[API-2](../../historico/api-2.md), sem apresentar testes antigos como uma nova execução:

| Verificação anterior sobre o mesmo código | Resultado |
| --- | ---: |
| Node, padrão e UTC | 163 passaram em cada execução |
| Browser, padrão e UTC | 19 passaram em cada execução |
| Backend Python | 220 passaram |
| Integração com Moto | 24 passaram |
| OpenAPI, incluído nos testes Node | 21 passaram |
| Terraform com mocks | 3 passaram |
| Mutações Terraform | 11 cenários + 5 rejeições esperadas |
| Build, fmt, validate e actionlint | Passaram |

[CI da API-1](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/37170775085):
verde. A API-2 segue apenas na árvore local; este mapa não a marca como
commitada, publicada ou aplicada.

Nesta revisão foram feitas inspeção de código/testes e conferência de
**200 links relativos, sem destinos quebrados**. Os 21 IDs foram preservados;
os 12 arquivos da API-2 anterior mantiveram seus hashes. Nenhum runtime, teste, Terraform ou workflow foi
alterado por esta organização; nenhum commit, push, apply ou deploy.

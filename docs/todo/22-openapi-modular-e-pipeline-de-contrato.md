# 22 — OpenAPI modular e pipeline de contrato

## Estado

Guardado / evolução futura. Backlog de arquitetura, sem implementação nesta rodada.

## Contexto

- API-1 introduziu o contrato OpenAPI e já foi concluída e commitada.
- API-2 tornou o OpenAPI a fonte das rotas Terraform e também foi concluída e
  commitada ([registro](../historico/api-2.md)); este item não reabre nem
  substitui essa entrega.
- A evolução futura é melhorar a organização do contrato sem misturar essa
  refatoração com a API-1/API-2 atual.

## Objetivo

- Organizar OpenAPI por domínio, com arquivos separados e referências `$ref`.
- Validar e gerar um bundle do contrato no pipeline.
- Entregar ao Terraform uma representação determinística.
- Manter uma única fonte de verdade, sem lista manual paralela de rotas.
- Conferir o contrato e seus artefatos no CI/GitHub Actions.

Estrutura conceitual a avaliar:

```text
openapi/
├── portal.yaml
├── paths/
├── schemas/
├── parameters/
├── requestBodies/
├── responses/
├── examples/
└── securitySchemes/
```

## Possível fluxo futuro

```text
OpenAPI modular
→ validate/lint
→ bundle
→ contract tests
→ manifest Terraform
→ terraform validate/test/plan
```

O formato do artefato/manifest e sua integração com Terraform ainda precisam
ser avaliados. O fluxo não autoriza apply ou deploy automático.

## Decisões a avaliar

- Ferramenta de bundling/lint.
- Se o artefato gerado entra ou não no Git.
- Como garantir reprodutibilidade local e no CI.
- Como evitar que o arquivo gerado vire uma segunda fonte de verdade editável.
- Eventual geração de cliente, somente se houver benefício futuro.

## Fora de escopo agora

- Não modularizar API-1/API-2 nesta tarefa.
- Não alterar Terraform nem adicionar dependência.
- Não criar Swagger UI ou endpoint `/docs`.
- Não gerar cliente.
- Não alterar API Gateway.

A implementação definitiva será decidida quando este item for retomado.


## Proposta delimitada para o próximo PR — 21/10/2026

Apenas preparação; nenhuma ferramenta foi selecionada/instalada e nenhum contrato foi modularizado nesta missão. API-1/API-2 permanecem concluídas.

| Consumidor atual de `openapi/portal.yaml` | Restrição a preservar |
| --- | --- |
| `tests/contracts/openapi.mjs`, `tests/openapi.mjs`, `tests/api.mjs`, ponte `openapi_routes.mjs` → `tests/integration/test_api_routes.py` | Parser/testes atuais resolvem referências locais a components; validam contrato e dispatchers reais. |
| `infra/terraform/api.tf` e `tests/routes.tftest.hcl` | `yamldecode(file(...))` deriva paths, métodos, JWT e scopes; não resolve referências externas. Preservar 35 operações, addresses e fingerprint de rotas. |
| `tests/contracts/terraform_mutations.py`, `manual_alias_transitions.py` | Mutações por âncoras do YAML e cópias isoladas do arquivo; precisam continuar testando o contrato efetivamente consumido. |
| `.github/scripts/prepare-release.py`, `release-api-routes.mjs`, `release_cli.py` | Preparação usa o contrato da revisão; arquivamento histórico leva esse caminho. SHA-256 é dos bytes brutos, não hash semântico. |
| `.github/scripts/frontend_release.py` | Hash integra manifesto/identidade; rollback com contrato diferente exige confirmação explícita. |

1. Fontes editáveis por domínio (`access`, `cohorts`, `grades`, `reminders`, `import`, `feedback`) e componentes compartilhados. Manter `openapi/portal.yaml` como **bundle gerado/versionado**, consumido pelos caminhos existentes; não manter duas fontes editáveis.
2. No próximo PR, definir um comando local de bundle e um check no CI que regenere em diretório temporário e compare bytes, recusando bundle desatualizado. Serialização determinística: UTF-8/LF, ordem estável, sem timestamps/caminhos absolutos; duas gerações devem ser idênticas.
3. O bundle precisa materializar path-items/operações/security necessários ao `yamldecode`, eliminando referências externas. Referências locais de schemas continuam válidas nos consumidores existentes. Cobrir referências ausentes/duplicadas e falha de resolução.
4. Demonstrar equivalência integral da árvore resolvida antes/depois: OpenAPI 3.0.3 / `info.version=1.0.0`, paths, métodos, operationIds, schemas, parâmetros, respostas, autenticação/scopes e extensões. Manter contratos Node/Python, rotas/addresses Terraform e mutações; adaptar suas âncoras somente quando necessário para mutar as fontes e regenerar a cópia isolada.
5. Se a serialização alterar `openapi_sha256`, registrar a diferença de bytes apesar da equivalência semântica. **Não** recalcular manifestos antigos nem remover a confirmação `confirm_release_id`: testar preparação e rollback simulado entre bundle novo e releases históricas, preservando a proteção atual.

Fora desse próximo PR: SDKs, Swagger UI, mudança de API, migração de infraestrutura ou deploy. A escolha de ferramenta fica para a implementação, com escopo limitado aos requisitos acima.

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

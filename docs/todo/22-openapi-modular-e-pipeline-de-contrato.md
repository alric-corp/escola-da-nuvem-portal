# 22 — OpenAPI modular e pipeline de contrato

## Estado

**Implementado neste PR, aguardando integração.** Fontes por domínio, bundle determinístico versionado, verificação no CI e regressões dos consumidores. Não houve mudança de comportamento HTTP, runtime do portal ou implantação produtiva.

API-1 e API-2 permanecem concluídas; seus registros em [API-1](../historico/api-1.md) e [API-2](../historico/api-2.md) foram preservados. A proposta anterior, registrada durante a consolidação dos TODOs 23–25, foi adotada sem reabrir essas entregas.

## Organização e ferramenta

- Entrada editável: `openapi/src/portal.yaml`, com metadados e referências OpenAPI.
- Operações: seis arquivos `src/domains/{access,cohorts,grades,reminders,import,feedback}.yaml`, seguindo os domínios/tags existentes. Uma definição por operação.
- Componentes compartilhados: `src/components/{schemas,responses,securitySchemes}.yaml`; nomes e componentes sem uso preservados.
- Saída: `openapi/portal.yaml`, gerado e versionado, com aviso para não editar manualmente.
- **Redocly CLI 2.67.1**, fixado apenas em `devDependencies` e no lockfile. Compatível com Node 22 do projeto. A CLI mantida fornece lint/resolução/bundle; não foi implementado parser ou resolver genérico próprio.
- Ruleset `spec`, colisões como erro, sem `--force`, sem remoção de componentes e sem dereference irrestrito. Telemetria/notificações desabilitadas; subprocesso sem rede para garantir entradas locais.

A manutenção e os comandos estão em [openapi/README.md](../../openapi/README.md):

```sh
npm ci
npm run openapi:bundle
npm run openapi:check
```

`bundle` gera explicitamente. `check` gera em diretório temporário e compara bytes, sem alterar o versionado; fonte inválida falha mesmo que exista uma saída antiga válida. Os mesmos inputs/versões produzem UTF-8/LF idêntico entre execuções/diretórios, sem timestamps/caminhos absolutos.

## Consumidores conferidos

| Consumidor atual de `openapi/portal.yaml` | Restrição a preservar |
| --- | --- |
| `tests/contracts/openapi.mjs`, `tests/openapi.mjs`, `tests/api.mjs`, ponte `openapi_routes.mjs` → `tests/integration/test_api_routes.py` | Parser/testes atuais resolvem referências locais a components; validam contrato e dispatchers reais. |
| `infra/terraform/api.tf` e `tests/routes.tftest.hcl` | `yamldecode(file(...))` deriva paths, métodos, JWT e scopes; não resolve referências externas. Preservar 35 operações, addresses e fingerprint de rotas. |
| `tests/contracts/terraform_mutations.py`, `manual_alias_transitions.py` | Mutações por âncoras do YAML e cópias isoladas do arquivo; precisam continuar testando o contrato efetivamente consumido. |
| `.github/scripts/prepare-release.py`, `release-api-routes.mjs`, `release_cli.py` | Preparação usa o contrato da revisão; arquivamento histórico leva esse caminho. SHA-256 é dos bytes brutos, não hash semântico. |
| `.github/scripts/frontend_release.py` | Hash integra manifesto/identidade; rollback com contrato diferente exige confirmação explícita. |


Os testes Node/Python e Terraform continuam usando o bundle no caminho original. O CI verifica sua atualização antes desses consumidores, dentro dos jobs existentes; os quatro status checks mantêm os nomes. Terraform/HCL não ganhou Node, external data source ou lista paralela de rotas, e não depende das fontes para plan/apply.

## Equivalência da migração

Referência: **`e99c93f569329279b79847916fdb5dbd92fbd670`**, main consultada no GitHub antes de iniciar. **35 operações / 31 paths**, OpenAPI **3.0.3**, `info.version=1.0.0`.

Comparação pontual dos dois documentos completos consolidados: todos os campos/valores, componentes e referências locais são iguais, desconsiderando apenas apresentação YAML/ordenação de chaves. Isso preserva também o grafo resolvido, porque seus nomes, referências e alvos não mudaram. A comparação não filtra schemas, parâmetros, required, tipos, enums, limites, defaults, nullable, respostas/content types, tags, descrições, operationIds, segurança, scopes ou extensões.

| Contrato | SHA-256 dos bytes |
| --- | --- |
| Anterior, revisão `e99c93f` | `61479fe37c8981747f8a5b20988e3bb47be53839365f998355e09d59424c8347` |
| Bundle desta migração | `2a34dd67ef6937921d02ee6ee0bcf2f518b30e985c4e8148b8bdb3187ff5ac6a` |

O comando reprodutível está no README. A igualdade com a revisão histórica foi demonstrada nesta migração; **não foi congelada como requisito permanente do CI**. Testes permanentes derivam seus controles do contrato atual e demonstram que diferenças de schema, required, autenticação, scope e demais campos são detectadas. Alterações intencionais futuras continuam possíveis com fontes, bundle e testes atualizados.

## Terraform, release e rollback

- HCL e identificadores de recursos inalterados. Rotas, JWT, scopes, integração e address histórico de `/me` preservados e avaliados pelo Terraform real com providers simulados.
- Mutações anteriores mantidas: 11 adulterações diretas do bundle, incluindo os guards de contrato inválido. Mais nove casos alteram fontes em cópia temporária, regeneram pelo bundler real e avaliam o consumidor Terraform. Âncora ausente ou mudança não aplicada falha; não conta como detecção.
- Transições do alias manual continuam testadas; as cópias de teste passam a gerar seu contrato das fontes, sem tocar state/infraestrutura.
- Preparação moderna e baseline histórica exercitadas localmente. Consumidores de release continuam usando o bundle, inclusive arquivos extraídos de commits antigos sem `src/`.
- `openapi_sha256` continua sendo SHA-256 dos bytes, não hash semântico. Serialização nova altera esse campo e a identidade da release; manifestos antigos e baseline não foram modificados.
- Rollback simulado entre hashes distintos continua recusado sem `confirm_release_id` correto, com zero PutObject/invalidações antes da confirmação. O comportamento com hash igual também foi preservado.

## Validações e limite de entrega

Testes permanentes cobrem geração válida/offline/repetível, diretórios diferentes, bundle ausente/manual/desatualizado, fonte/referência inválida, duplicatas, colisões, componentes sem uso, schemas recursivos e comparação integral sem apagar diferenças. Os contratos existentes Node/Python, testes/mutações Terraform e pipeline de release foram preservados e ampliados. As contagens efetivamente executadas e o resultado dos quatro checks constam no PR.

Validação local desta implementação, em 21/10/2026:

| Verificação | Resultado |
| --- | --- |
| `npm ci --offline` e `npm run openapi:check` | Lockfile reproduzível; bundle atualizado |
| `npm test` | 526 aprovados, incluindo 29 testes do novo módulo de bundle |
| Backend Python 3.12 | 317 aprovados |
| Integração Python 3.12/Moto | 223 aprovados, incluindo preparação moderna e leitura histórica |
| `node --test tests/release-cache-browser.mjs` | 9 cenários Chromium aprovados |
| Terraform fmt/validate e testes nativos com mocks | Aprovados; 24 testes |
| `terraform_mutations.py` | 20 cenários aprovados: 11 diretos + 9 fontes; 10 recusas esperadas da baseline |
| `manual_alias_transitions.py` | 2 transições aprovadas e 5 mutações recusadas |
| `actionlint`, `git diff --check` e links do backlog | Aprovados; 162 links relativos válidos |

As contagens são desta missão, sem somar novamente recortes contidos nas suítes. Nenhuma falha ou skip nas execuções finais. A nova regressão offline demonstrou dois GETs loopback antes do guard e zero depois; nos dois modos, a referência remota é recusada sem substituir o bundle anterior.

Sem novos serviços, SDKs, Swagger UI, alteração de API/backend/frontend, dependências de runtime, deploy manual, Terraform apply, alterações de state, IAM, Cognito, DNS, agendamentos ou kill switch. A pendência deste item é a integração do PR pelo fluxo existente; não há uma nova fase manual de publicação.

# Manutenção do contrato OpenAPI

Edite **`src/`**. `portal.yaml` é o bundle gerado e versionado; não o edite manualmente.
Os consumidores continuam lendo esse mesmo caminho. OpenAPI `3.0.3` e `info.version: 1.0.0` foram preservados nesta migração.

## Fontes

| Arquivo | Conteúdo editável |
| --- | --- |
| `src/portal.yaml` | Metadados, tags e referências aos path items e componentes |
| `src/domains/access.yaml` | Identidade, acesso, instrutores e vínculo individual |
| `src/domains/cohorts.yaml` | Turmas, configurações e participação |
| `src/domains/grades.yaml` | Relatórios, foco e visualização como aluno |
| `src/domains/reminders.yaml` | Prévia, remetente e envio de lembretes |
| `src/domains/import.yaml` | Prévia, publicação e restauração acadêmicas |
| `src/domains/feedback.yaml` | Feedback pessoal/administrativo e anexos |
| `src/components/{schemas,responses,securitySchemes}.yaml` | Definições compartilhadas, preservando seus nomes |

Cada operação tem uma única definição no domínio correspondente. O entrypoint contém referências OpenAPI, não outro manifesto de rotas. Componentes compartilhados são referenciados; não copie sua definição entre domínios.

## Gerar e verificar

Use Node **22.12+** (o CI usa Node 22) e as dependências de desenvolvimento do lockfile:

```sh
npm ci
npm run openapi:bundle
npm run openapi:check
```

O gerador executa **Redocly CLI 2.67.1**, instalado e fixado em `devDependencies`.
O ruleset `spec` valida o OpenAPI sem exigir mudanças editoriais como inclusão de servidores/licença. O bundle mantém componentes sem uso e referências locais; não usa expansão irrestrita, remoção de componentes, renomeação automática de colisões ou `--force`.

A geração usa apenas arquivos locais, com telemetria/notificações de atualização desabilitadas e rede bloqueada no subprocesso Redocly. Depois de `npm ci`, não há download durante a geração. O resultado é UTF-8/LF, sem timestamps ou caminhos da máquina. Os testes comparam bytes entre execuções, diretórios e working directories diferentes, inclusive com sockets bloqueados.

`openapi:check` valida e gera em diretório temporário, compara os bytes com `portal.yaml` e falha se houver divergência, ausência ou fonte inválida. Não reescreve o bundle para esconder um erro. Corrija a fonte, execute `openapi:bundle` e versione as fontes e o resultado juntos.

## Alterar uma operação

1. Edite a operação em `src/domains/`. Para um path novo, acrescente seu path item e a referência correspondente em `src/portal.yaml`; escape `/` como `~1` e `~` como `~0` no fragmento JSON Pointer.
2. Reutilize componentes existentes. Para um componente novo, defina-o no arquivo compartilhado e registre sua referência no entrypoint. Uma definição de operação não deve ser repetida em outro domínio.
3. Gere o bundle, confira o diff e execute `openapi:check`, os contratos Node/Python e os testes Terraform com mocks. Mudanças intencionais da API devem atualizar seus testes de contrato; esta migração não congela o contrato na revisão anterior.

Os checks existentes de backend, frontend e Terraform verificam o bundle antes dos consumidores. Os quatro nomes obrigatórios do CI são preservados. **Terraform não executa Node**: `plan`/`apply` continuam consumindo apenas o YAML versionado por `file()`/`yamldecode()`.

## Migração, releases e histórico

A referência da migração é `e99c93f569329279b79847916fdb5dbd92fbd670`. A comparação integral dos documentos consolidados preservou todos os campos, componentes e referências locais; portanto os alvos dessas referências também são equivalentes. Ordenação de chaves e comentários YAML não mudam essa comparação. Ausência, `false`, `null`, arrays, descrições, autenticação e scopes continuam distintos.

Para reproduzir **essa comparação pontual**, sem transformá-la em bloqueio permanente do CI:

```sh
comparacao_openapi=$(mktemp -d)
git show e99c93f569329279b79847916fdb5dbd92fbd670:openapi/portal.yaml > "$comparacao_openapi/antes.yaml"
node tests/contracts/openapi_equivalence.mjs "$comparacao_openapi/antes.yaml" openapi/portal.yaml
```

SHA-256 anterior: `61479fe37c8981747f8a5b20988e3bb47be53839365f998355e09d59424c8347`.
SHA-256 gerado nesta migração: `2a34dd67ef6937921d02ee6ee0bcf2f518b30e985c4e8148b8bdb3187ff5ac6a`.
Os bytes mudaram pela serialização e pelo comentário de arquivo gerado; a API permaneceu equivalente.

`openapi_sha256` continua sendo o hash dos **bytes**. Não é substituído por hash semântico. Manifestos e contratos históricos não são recalculados. Os scripts de release continuam lendo/arquivando `openapi/portal.yaml`; commits antigos não precisam de `src/` ou Redocly. A baseline histórica foi preservada e sua preparação continua testada localmente.

Uma diferença de hash continua exigindo a confirmação explícita do destino no rollback (`confirm_release_id`), mesmo quando os documentos são semanticamente equivalentes. Os testes simulados comprovam recusa sem escrita/invalidação e aceitação com a confirmação correta. A ferramenta de desenvolvimento não entra nos assets do frontend nem no pacote das Lambdas.

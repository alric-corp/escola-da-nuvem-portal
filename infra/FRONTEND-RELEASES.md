# Releases do frontend pelo GitHub Actions

Publicação versionada do frontend: releases imutáveis em `releases/<id>/` e um `index.html` ponteiro na raiz, operados pelo workflow manual [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml).

**Estado:** implementada e testada, mas **ainda não ativa**. Até a primeira ativação, o caminho vigente continua sendo `scripts/deploy_frontend.sh` ([README.md](README.md#4-gerar-e-publicar-o-frontend)). A primeira ativação depende de três condições:
- V3: environment `production` criado e protegido **antes** do merge do workflow;
- bootstrap da role aplicado;
- V1 (claims OIDC reais) e V2 (sonda S3) verificadas em execuções `verify` autorizadas.

O contrato está em [`.github/scripts/frontend_release.py`](../.github/scripts/frontend_release.py); a role, em [`cicd-bootstrap/`](cicd-bootstrap/README.md).

## Por que releases

No layout plano, um navegador com o `index.html` ou módulos em cache pode combinar arquivos de versões diferentes. Um import nomeado que não existe mais impede o portal de abrir (P2, [docs/arquitetura.md](../docs/arquitetura.md#deploy-seguro-de-módulos)).

Na release:
- todo JS e CSS vem de `releases/<id>/`;
- a config é lida relativa ao módulo (`new URL("./config.json", import.meta.url)`);
- o documento continua em `/`, e com ele o callback do Cognito, `?turma=` e `location.pathname`;
- uma página aberta segue inteira na própria release, porque nenhuma release é sobrescrita ou apagada.

```
/index.html                     ponteiro (no-cache); único objeto reescrito, sempre com If-Match
/config.json, /logo.png         raiz legada: lidos pela baseline e pelo logo; a pipeline nunca escreve neles
/app.js, /pages/... (legado)    layout plano C7.3, preservado
/releases/<sha12>-<content12>/  release imutável: assets, [config.json], pointer.html, manifest.json
```

O `release_id` amarra commit, assets, config, rotas da API e builder. A baseline C7.3 (`1daab31`, fixada em [`.github/release/baseline.json`](../.github/release/baseline.json)) sempre gera `1daab314413e-59ca26f6e38c`.

## Operações

Todas são disparadas em Actions → *Deploy do frontend* → *Run workflow*, na `main`, com `expected_main_sha` igual ao SHA revisado. Se a `main` avançar, a execução é recusada.

| `operation` | Faz | AWS | Aprovações |
|---|---|---|---|
| `prepare` (padrão) | Empacota e valida (offline, contra o publicado por HTTPS e no Chromium); artefato `release-<id>` | não | 1 |
| `verify` | Claims do token OIDC (sem o JWT) e leituras com a role; com `s3_probe`, sonda em `releases/_probe/<run>/` | leitura (sonda: escrita só no prefixo da sonda) | 1 |
| `publish` | `build` sem credencial, depois `publish` com OIDC: `releases/<id>/` com If-None-Match. **Não ativa** | escrita em `releases/` | 2 |
| `activate` | Ponteiro com If-Match, invalidação de `/` e `/index.html`, espera, smoke e registro | `index.html` e invalidação | 1 |
| `rollback` | Igual a `activate`, com as proteções de rollback | idem | 1 |

`source=baseline` só vale em `prepare` e `publish`. As operações `publish`, `activate` e `rollback` exigem a variable de repositório `FRONTEND_DEPLOY_ENABLED=true` (kill switch), que fica `false` fora das janelas de operação.

## Pré-requisitos (uma vez, pelo owner)

1. **Environment `production`**, configurado pela interface do GitHub:
   - revisor obrigatório;
   - *deployment branches*: só a branch `main`;
   - *allow administrators to bypass*: **desligado**. O gate exige `can_admins_bypass: false` e recusa quando o campo está ausente;
   - *prevent self-review* desligado: com um único mantenedor, a aprovação pelo próprio iniciador **não é revisão independente**, e o resumo do gate registra isso.
2. **Variables do environment**: `AWS_ROLE_ARN`, `AWS_REGION`, `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `PUBLIC_ORIGIN` (`https://<domínio>`, sem barra final) e `FRONTEND_CONFIG_JSON` (`terraform output -json frontend_config`, numa linha). **Nenhum secret AWS**: o gate falha se `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` ou `AWS_SESSION_TOKEN` existirem.
3. **Bootstrap da role**, localmente e com credencial administrativa, conforme [cicd-bootstrap/README.md](cicd-bootstrap/README.md). O plan esperado é **2 to add** (role e policy inline). O state fica numa chave própria. A role nunca acessa state, e o workflow nunca roda Terraform.

## Primeira publicação: migração da C7.3

1. `prepare`, source `baseline`: conferir o id `1daab314413e-59ca26f6e38c`, a equivalência com os 30 arquivos publicados e o Chromium.
2. `verify`: conferir as claims reais e decidir sobre `trusted_job_workflow_ref` num apply revisado (V1).
3. Kill switch ligado, depois `verify` com `s3_probe=true` (V2). O esperado:
   - passos 1 e 4: `AccessDenied`;
   - passo 2: `200`;
   - passos 3 e 5: `PreconditionFailed`;
   - `index.html` intacto.
4. `publish`, source `baseline`.
5. `activate`, com `release_id=<baseline>` e `expected_active_release=legacy`. A partir do legado só a baseline é aceita, e só se o `index.html` publicado for o da C7.3.
6. Conferir o portal. Depois, publicar a `main` é **decisão de produto separada**, porque ela contém o redesign: `publish` com source `main`, depois `activate` com `expected_active_release=<baseline>`.

## Rollback

`rollback`, com:
- `release_id=<anterior>`;
- `expected_active_release=<ativa>`;
- `confirm_release_id=<anterior>`, quando os contratos OpenAPI das duas releases diferem.

A pipeline recusa:
- release ausente ou adulterada;
- alvo abaixo do piso `1daab31`;
- alvo fora da first-parent da `main`;
- alvo posterior à ativa (para isso, use `activate`);
- alvo que usa rota da API ausente na release ativa;
- rollback a partir do legado.

A inclusão de rotas é necessária, mas não suficiente: payloads, autenticação e semântica dependem da revisão do environment.

A volta da baseline ao **layout plano** não passa pela pipeline. O procedimento é administrativo: restaurar o `index.html` legado (preservado no versionamento do bucket) com If-Match e invalidar `/` e `/index.html`.

## Falhas

- **Antes da gravação do `index.html`**: nada mudou. O resumo do job diz "recusado; nada foi alterado".
- **Depois da gravação**: o job sai com código 3. O resumo traz "ATENÇÃO: falha depois da ativação" e o artefato `activation-<run>` traz o registro (`smoke`, `recovery`, `error`). **Não há rollback automático.** Diagnosticar e então escolher uma saída:
  - reativar a mesma release, que refaz só a invalidação e o smoke;
  - fazer o rollback indicado no registro.

## O que a pipeline nunca faz

- Publicar ou ativar sem dispatch manual e sem aprovação.
- Usar chaves AWS permanentes.
- Sobrescrever ou apagar releases.
- Escrever fora de `releases/` e de `index.html`.
- Usar `s3 sync --delete` ou invalidar `/*`.
- Fazer rollback automático.
- Alterar `/config.json` ou o layout legado.

## Validação local (sem AWS)

```sh
npm test                                        # inclui tests/release-pipeline.mjs
npm run test:browser                            # inclui tests/release-cache-browser.mjs
python -m unittest discover -s tests/integration   # test_frontend_release_* (moto, rede bloqueada)
python tests/contracts/release_mutations.py     # 41 mutações; precisa de moto e Chromium
cd infra/cicd-bootstrap && terraform init -backend=false && terraform test && python3 ../../tests/contracts/bootstrap_mutations.py
```

Os testes da baseline extraem `1daab31` do Git, então o checkout precisa do histórico completo. O índice das suítes está em [tests/README.md](../tests/README.md).

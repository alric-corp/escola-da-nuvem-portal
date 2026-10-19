# Releases do frontend pelo GitHub Actions

Publicação versionada do frontend: releases imutáveis em `releases/<id>/` e um `index.html` ponteiro na raiz. O workflow [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) publica **automaticamente** cada push na `main` depois do CI verde e oferece operações manuais para recuperação.

**Estado:** implementada e testada, mas **ainda não ativa**. Até a migração, o caminho vigente continua sendo `scripts/deploy_frontend.sh` ([README.md](README.md#4-gerar-e-publicar-o-frontend)). O deploy automático depende dos [pré-requisitos](#pré-requisitos-uma-vez-pelo-owner) e da [migração da C7.3](#primeira-publicação-migração-da-c73). Antes deles, toda execução é recusada no gate ou na ativação, sem alterar nada no ar.

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

## Deploy automático

```
push na main (inclusive merge de PR)
  → CI (ci.yml): backend, integração, frontend e navegador, Terraform, bootstrap e mutações
  → [CI verde] Deploy do frontend (workflow_run), operação deploy:
      gate     sem AWS: CI verde de push na main deste repositório, commit do CI = commit da execução = HEAD
               atual da main, CI reconferido na API, kill switch, environment restrito à main
      build    environment production, sem AWS: empacota, valida offline, contra o publicado e no Chromium
      publish  environment production, OIDC: revalida o pacote, publica releases/<id>/ (If-None-Match), ativa
               (index.html com If-Match), invalida / e /index.html, espera a conclusão e faz o smoke público
```

O resumo do job `publish` separa três estados:
- **invalidação solicitada**: o ID aparece no log e, se a espera estourar, na mensagem de erro;
- **invalidação concluída**: o status `Completed` foi lido no CloudFront;
- **publicação verificada**: o smoke confirmou no domínio público que a raiz serve o ponteiro da release e que cada arquivo tem os bytes e o MIME do manifesto.

O artefato `activation-<run>-<tentativa>` guarda o registro: release ativa, anterior, ETags, invalidação e smoke.

Nada é publicado quando:
- o CI fica vermelho ou é cancelado;
- o CI vem de PR, de fork ou de outra branch;
- a `main` avança antes de uma escrita. O commit mais novo tem o próprio deploy;
- o kill switch está desligado;
- a config do environment difere da publicada. É preciso um `deploy` manual com `allow_config_change`;
- o layout no ar ainda é o legado. Antes, é preciso a migração;
- a release é anterior à ativa.

Nos dois últimos casos, a release fica publicada em `releases/<id>/`, mas inativa e inofensiva.

Concorrência: uma execução por vez (`frontend-production`), e uma execução em andamento nunca é cancelada. Entre as pendentes, o GitHub mantém só a mais nova: uma pendente mais antiga, inclusive um rollback manual, é cancelada se outro deploy entrar na fila.

## Operações manuais

Disparadas em Actions → *Deploy do frontend* → *Run workflow*, na `main`, com `expected_main_sha` igual ao SHA revisado. Se a `main` avançar antes da primeira escrita, a execução é recusada sem alterar nada: dispare de novo com o SHA atual (veja [Revalidação do HEAD da main](#revalidação-do-head-da-main)).

| `operation` | Faz | AWS |
|---|---|---|
| `prepare` (padrão) | Empacota e valida (offline, contra o publicado por HTTPS e no Chromium); artefato `release-<id>` | não |
| `verify` | Claims do token OIDC (sem o JWT) e leituras com a role; com `s3_probe`, sonda em `releases/_probe/<run>/` | leitura (sonda: escrita só no prefixo da sonda) |
| `publish` | `build` sem credencial, depois `publish` com OIDC: `releases/<id>/` com If-None-Match. **Não ativa** | escrita em `releases/` |
| `activate` | Ponteiro com If-Match, invalidação de `/` e `/index.html`, espera, smoke e registro | `index.html` e invalidação |
| `rollback` | Igual a `activate`, com as proteções de rollback | idem |
| `deploy` | O mesmo do automático: `publish` e, no mesmo job, a ativação da release recém-publicada (só para frente) | `releases/`, `index.html` e invalidação |

`source=baseline` só vale em `prepare`, `publish` e `deploy`. As operações `publish`, `activate`, `rollback` e `deploy`, inclusive o deploy automático, exigem a variable de repositório `FRONTEND_DEPLOY_ENABLED=true` (kill switch).

### Revalidação do HEAD da main

O HEAD atual de `refs/heads/main` é lido na API do GitHub (`GET /repos/{repo}/git/ref/heads/main`, com o `GITHUB_TOKEN` do job e `contents: read`). Ele precisa ser igual, nos 40 hex, ao `GITHUB_SHA` e ao SHA esperado (o `expected_main_sha` no manual, o commit do CI no automático):

| Verificação | Quando | Onde |
|---|---|---|
| A | No job `gate`, antes de qualquer job do environment | `check-deploy-gate.py --stage repository` |
| B | No primeiro passo de cada job do environment, depois da fila e da concorrência, e antes de artefato, dependência ou OIDC. No `publish`, é independente da verificação do `build` | `check-deploy-gate.py --stage environment` |
| C | Imediatamente antes da primeira escrita AWS: primeiro objeto da release, `index.html` ou invalidação, sonda | `main_head_guard` em `publish-release.py`, `activate-release.py`, `rollback-release.py` e `verify-access.py` |

Qualquer resposta que não prove a igualdade recusa a execução:
- HEAD diferente;
- HTTP diferente de 200 (401, 403, 404, 429 e 5xx);
- token ausente, rede ou timeout;
- JSON inválido;
- referência diferente de `refs/heads/main`;
- SHA ausente ou malformado.

**Janela residual:** entre a resposta da verificação C e a escrita no S3 (frações de segundo a poucos segundos) não há atomicidade possível. Uma integração na `main` exatamente nesse intervalo não é detectada. A release que seguir é a do commit verificado, íntegra e imutável, e o deploy seguinte, do novo HEAD, a substitui. As escritas condicionais (`If-None-Match` e `If-Match`) e a concorrência `frontend-production` continuam valendo.

## Pré-requisitos (uma vez, pelo owner)

1. **Environment `production`**, configurado pela interface do GitHub, conforme a política de deploy automático:
   - *deployment branches and tags*: *Selected branches and tags*, só a regra `main`, do tipo branch. **Obrigatório**: o gate recusa um environment ausente, sem restrição, com outra branch, com curinga ou com tag. Sem o environment, o GitHub o criaria sem restrição no primeiro job; o gate, que roda antes, recusa;
   - *required reviewers*: **desativado**; sem timer de espera nem regras customizadas de aprovação de deployment. O deploy segue automaticamente o CI verde na `main`;
   - *prevent self-review* não se aplica sem revisores. A restrição de branch e environment também está na trust da role (`ref` = `refs/heads/main` e environment `production`) e no gate.
2. **Variables do environment**:
   - `AWS_ROLE_ARN`, `AWS_REGION`, `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`;
   - `PUBLIC_ORIGIN`: `https://<domínio>`, sem barra final;
   - `FRONTEND_CONFIG_JSON`: `terraform output -json frontend_config`, numa linha.

   **Nenhum secret AWS**: o gate falha se `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` ou `AWS_SESSION_TOKEN` existirem.
3. **Bootstrap da role**, localmente e com credencial administrativa, conforme [cicd-bootstrap/README.md](cicd-bootstrap/README.md). O plan esperado é **2 to add** (role e policy inline). O state fica numa chave própria. A role nunca acessa state, e o workflow nunca roda Terraform. A trust não restringe o evento: o deploy automático (`workflow_run`) e o manual (`workflow_dispatch`) produzem o mesmo `sub` (environment `production`) e o mesmo `ref` (`refs/heads/main`).
4. **Kill switch**: a variable de repositório `FRONTEND_DEPLOY_ENABLED`. Fica `false` até a migração e depois `true`, que liga o deploy automático. Volta a `false` para congelar os deploys.
5. **Proteção da `main`**: PR obrigatório e somente os quatro checks do CI como critério de merge, sem aprovação humana ou Code Owners. Use o [ruleset mínimo abaixo](#governança-da-main-repositório-público).

Quem tem escrita no repositório integra na `main` e, com isso, publica; também pode disparar as operações manuais quando o kill switch está ligado. Quem é admin pode ainda ligar o kill switch e alterar o environment. Mantenha esse grupo restrito.

## Governança da main (repositório público)

**Decisão vigente de 19/10/2026:** toda alteração entra por Pull Request. A aprovação dos status checks do CI é o único critério obrigatório de merge. Não exigir aprovação humana, Code Owners ou aprovação manual de deployment. Esta decisão substitui recomendações anteriores de revisão humana obrigatória para merge ou deployment. O deploy automático depois do CI verde na `main` permanece sujeito aos gates técnicos de segurança e aos pré-requisitos de ativação.

O arquivo [`.github/rulesets/main.json`](../.github/rulesets/main.json) contém o ruleset importável em **Settings → Rules → Rulesets → Import a ruleset**. Ele está **documentado para aplicação**: adicionar o arquivo ao Git não configura o GitHub. No preflight de 19/10/2026, o repositório já era público, a `main` estava sem proteção/ruleset, e não havia environment `production` nem variable `FRONTEND_DEPLOY_ENABLED`. Esta entrega não altera esses settings, a visibilidade, a AWS ou o kill switch.

Configuração mínima:

- Enforcement **Active**, alvo somente `refs/heads/main`, sem atores de bypass (inclusive administradores e integrações).
- **Require a pull request before merging**; **0** aprovações. Desativar Code Owners, aprovação do último push, descarte de aprovações e resolução obrigatória de conversas.
- **Require status checks to pass**, com os quatro nomes exatos abaixo e origem **GitHub Actions** (`integration_id=15368`, confirmado na API). Não marcar *Require branches to be up to date before merging*: não há esse critério adicional na decisão.
- Bloquear exclusão e force push para preservar a `main` e seu histórico. Não exigir assinaturas, histórico linear, merge queue ou deployments bem-sucedidos.

| Status check obrigatório (nome exato) | Job em `ci.yml` |
|---|---|
| `Backend (Python + Moto)` | `python` |
| `Frontend (Node + Playwright)` | `node` |
| `Terraform (fmt, validate, test)` | `terraform` |
| `Bootstrap do deploy do frontend (fmt, validate, test)` | `cicd-bootstrap` |

Todos são jobs do workflow **CI**, executados em `pull_request` (inclusive Draft e fork), sem filtros de paths/branches, `if`, matriz ou `continue-on-error`. Os quatro foram confirmados com `success` no [CI de um PR anterior](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39193238318). Use o nome do job da tabela, sem prefixar `CI /`. Não cadastrar `CI`, nomes de steps, mutações individuais ou jobs de **Deploy do frontend**: estes não rodam no evento de PR e não satisfazem esse gate.

Não usar `[skip ci]` nem adicionar filtros de caminhos ao CI obrigatório: um workflow ignorado pode deixar checks permanentemente pendentes, como explica a [documentação do GitHub](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks). Se os jobs forem renomeados, atualizar o ruleset junto e confirmar os novos contextos num PR antes de exigi-los. As [regras de status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging) permitem fixar a origem no app GitHub Actions.

No repositório público, o CI de PR usa somente `contents: read`, sem credenciais AWS, OIDC ou secrets de produção. Contribuições de forks seguem as permissões e eventual liberação de execução do GitHub Actions para contribuidores externos; isso não é aprovação de merge ou deployment. Não usar `pull_request_target` para executar código do PR com privilégios. O deploy só aceita `workflow_run` do `ci.yml`, com sucesso, originado de `push` na `main` deste repositório, e confere novamente o SHA e o CI pela API. OIDC restrito ao environment/branch, IAM de menor privilégio, rejeição de chaves estáticas e falha fechada continuam obrigatórios.

### Checklist operacional de configuração manual (antes do merge)

Este checklist é para o administrador executar no GitHub; os arquivos deste PR não aplicam settings. Preparar a governança não exige bootstrap AWS, `terraform apply` ou deployment. Configure nesta ordem, mantendo a publicação desabilitada:

1. **Variable do repositório:** Settings → Secrets and variables → Actions → **Variables** → New repository variable. Nome exato `FRONTEND_DEPLOY_ENABLED`, valor literal `false` (minúsculo, sem aspas). Se já existir, editar para `false`. Salvar. Esta variable precisa estar no **repositório**, pois o job `gate` não usa environment; não criar uma cópia de mesmo nome em `production`.
2. **Environment:** Settings → Environments → New environment → nome `production` → Configure environment. Em *Deployment branches and tags*, selecionar **Selected branches and tags**; Add deployment branch or tag rule → Ref type **Branch**, Name pattern **main** → Add rule. Manter somente essa regra, sem tags ou curingas; não usar *Protected branches only*. Deixar **Required reviewers** desmarcado, sem revisores, *Wait timer* ou regras customizadas de aprovação. Salvar as regras. Não cadastrar secrets AWS permanentes. As variables de runtime listadas nos pré-requisitos podem continuar pendentes enquanto o kill switch estiver `false`.
3. **Ruleset:** Settings → Rules → Rulesets → New ruleset → **Import a ruleset** → selecionar [`.github/rulesets/main.json`](../.github/rulesets/main.json) desta branch. Conferir nome `main: PR e CI`, alvo branch `main` (`refs/heads/main`), enforcement **Active** e bypass list vazia. Confirmar PR obrigatório, **0** aprovações, Code Owners/último push/resolução obrigatória de conversas desativados e os **quatro nomes exatos da tabela**, com origem **GitHub Actions**. Deixar *Require branches to be up to date*, deployments obrigatórios, assinaturas, histórico linear e merge queue desativados. Manter bloqueio de exclusão/force push. Salvar e reabrir para conferir o estado persistido e eventuais regras herdadas que adicionem aprovações.

O fluxo de importação é descrito em [Managing rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository); a distinção entre branch e tag está em [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Antes de autorizar o merge, conferir o SHA mais recente do PR com os quatro checks concluídos em `success`, o ruleset efetivamente ativo, o environment com a única regra branch `main` e a repository variable persistida como `false`. O PR deve permanecer Draft até a autorização; não habilitar auto-merge. Com esses controles, o merge integra o código e dispara o CI da `main`, mas o deploy automático é recusado no gate pelo kill switch, antes de OIDC ou escrita AWS. Esse bloqueio esperado não é um check obrigatório de merge. A ativação futura, o bootstrap e a migração continuam sujeitos a autorização separada.

### P-SC1: dependências antes de credenciais

Os jobs `publish` (incluindo o deploy automático), `verify` e `activate` (incluindo rollback) executam [`setup-deploy-python`](../.github/actions/setup-deploy-python/action.yml) depois do gate de environment e **antes** de solicitar token OIDC ou assumir a role. A composite cria um venv novo, sem pacotes globais, e instala [`requirements-deploy.txt`](../.github/requirements-deploy.txt): boto3 e as seis dependências transitivas, todos com versão exata e SHA-256 de wheel conferido nos metadados do PyPI. `--require-hashes`, `--only-binary=:all:`, índice explícito e pip em modo isolado impedem dependências não verificadas e execução de builds de sdists, conforme [Secure installs do pip](https://pip.pypa.io/en/stable/topics/secure-installs/).

O instalador recusa credenciais AWS já disponíveis, roda `pip check` e só adiciona o venv ao `GITHUB_PATH` depois do sucesso. Qualquer falha interrompe o job antes de autenticação. As composites `publish-release` e `activate-release` usam esse intérprete e não instalam dependências nem executam `setup-python` após OIDC; no deploy, a mesma instalação serve à publicação e à ativação. O CI cobre a ordem real no YAML, as composites transitivas e recusas com pip real sobre wheels sintéticos locais. O job Backend ainda executa a mesma composite sobre o lock real e importa o runtime instalado no Linux, com apenas `contents: read`, sem credenciais. A verificação de hashes fixa os bytes revisados; atualizar versões exige revisar e atualizar os hashes junto do lock.

## Primeira publicação: migração da C7.3

1. `prepare`, source `baseline`: conferir o id `1daab314413e-59ca26f6e38c`, a equivalência com os 30 arquivos publicados e o Chromium.
2. `verify`: conferir as claims reais e decidir sobre `trusted_job_workflow_ref` num apply revisado (V1). O `event_name` do deploy automático é `workflow_run`, e a trust não o restringe.
3. Kill switch ligado, depois `verify` com `s3_probe=true` (V2). O esperado:
   - passos 1 e 4: `AccessDenied`;
   - passo 2: `200`;
   - passos 3 e 5: `PreconditionFailed`;
   - `index.html` intacto.
4. `deploy`, source `baseline`. Ou, em duas execuções, `publish` com source `baseline` e depois `activate` com `release_id=1daab314413e-59ca26f6e38c` e `expected_active_release=legacy`. A partir do legado só a baseline é aceita, e só se o `index.html` publicado for o da C7.3.
5. Conferir o portal.
6. Daí em diante, todo push na `main` publica a `main`. A primeira publicação da `main` leva o redesign. Para publicar sem esperar o próximo push: `deploy` com source `main`, ou *Re-run all jobs* no último *Deploy do frontend*, se o commit dele ainda for o HEAD.

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

A inclusão de rotas é necessária, mas não suficiente: payloads, autenticação e semântica dependem da revisão de quem dispara o rollback.

**O rollback vale até o próximo push na `main`**: o deploy automático seguinte ativa o commit novo, para frente a partir da release ativa. Para manter a versão anterior até a correção chegar à `main`:
1. desligue o kill switch logo depois do rollback. O deploy automático passa a ser recusado no gate;
2. religue-o depois do merge da correção, rodando `deploy` com source `main` ou esperando o próximo push.

Como o GitHub mantém só a pendente mais nova, evite integrar na `main` enquanto um rollback espera na fila.

A volta da baseline ao **layout plano** não passa pela pipeline. O procedimento é administrativo: restaurar o `index.html` legado (preservado no versionamento do bucket) com If-Match e invalidar `/` e `/index.html`.

## Falhas e diagnóstico

Acompanhe em Actions → *Deploy do frontend*: uma execução por CI concluído na `main`, com evento `workflow_run`. O resumo de cada job diz o que foi aprovado ou recusado.

- **No gate ou no primeiro passo de um job**: o motivo está listado e nada mudou. Exemplos: CI vermelho, kill switch, `main` avançada, environment ou variables ausentes, chave AWS estática.
- **No `build`**: validação offline, contra o publicado ou no Chromium. Nada mudou.
- **Na publicação**: `AccessDenied` aponta para a role ou a policy; conflito, para um objeto existente com conteúdo diferente. Nada é sobrescrito, e o `index.html` não muda.
- **Na ativação, antes da gravação do `index.html`**: o resumo diz "recusado; nada foi alterado".
- **Depois da gravação**: o job sai com código 3. O resumo traz "ATENÇÃO: falha depois da ativação" e o artefato `activation-<run>-<tentativa>` traz o registro (`smoke`, `recovery`, `error`). **Não há rollback automático.** Diagnosticar e então escolher uma saída:
  - reativar a mesma release, que refaz só a invalidação e o smoke;
  - fazer o rollback indicado no registro.

Falha transitória com o commit ainda no HEAD: *Re-run failed jobs*. O gate e as revalidações rodam de novo, e a publicação reconhece objetos idênticos.

Verificação manual no CloudFront:
- `curl -sI https://<domínio>/` deve trazer `cache-control: no-cache`;
- o `index.html` (`curl -s https://<domínio>/`) aponta para `releases/<id>/`, o mesmo `<id>` do resumo do job;
- `curl -sI https://<domínio>/releases/<id>/app.js` deve trazer `cache-control: public, max-age=31536000, immutable`.

## Mudanças no contrato da API

O frontend é publicado automaticamente; o backend (Terraform em `infra/terraform`) não. Um PR que muda `openapi/portal.yaml`, as rotas de `api.tf` e o frontend juntos precisa do backend aplicado **antes** do merge, ou do kill switch desligado até o apply. Senão o frontend novo chama rotas que ainda não existem (CORS ou erro de rede).

## O que a pipeline nunca faz

- Publicar sem o CI verde de um push na `main` deste repositório, fora da `main`, a partir de PR ou fork, ou com o kill switch desligado.
- Publicar no manual sem o SHA confirmado.
- Ativar no `publish` manual: só o `deploy` ativa, e só a release que acabou de publicar, para frente.
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
python tests/contracts/release_mutations.py     # 69 mutações; precisa de moto e Chromium
cd infra/cicd-bootstrap && terraform init -backend=false && terraform test && python3 ../../tests/contracts/bootstrap_mutations.py
```

Os testes da baseline extraem `1daab31` do Git, então o checkout precisa do histórico completo. O índice das suítes está em [tests/README.md](../tests/README.md).

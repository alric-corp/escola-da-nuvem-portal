# CI do PR e conteúdo autorizado para deploy

O CI completo roda apenas em `pull_request` para `main` (abertura, atualização e reabertura), com os quatro checks existentes. Cada job faz checkout explícito de `github.sha` — o merge temporário do PR — e verifica `git rev-parse HEAD`. O SHA e o número do PR constam no nome desse passo, consultável pela API de jobs do GitHub.

No `push/main`, o deploy não repete as suítes: identifica o PR efetivamente integrado, consulta seu CI `pull_request` e os quatro jobs bem-sucedidos da mesma tentativa. Confere o SHA testado registrado pelos quatro passos contra o commit Git, seus pais (base + head do PR) e a árvore do commit integrado. A árvore inteira precisa coincidir. Se a base mudou mas a árvore integral é idêntica, o gate registra explicitamente essa equivalência; mudança de conteúdo bloqueia. O SHA da branch, do merge temporário e do merge final podem diferir; igualdade de nomes ou um artefato autodeclarado não substitui essas verificações.

Se a base mudou e a árvore integrada difere da árvore testada, o deploy recusa: atualizar o PR e validar a combinação antes de integrar. Não existe segunda suíte oculta no deploy. A transição funciona no merge deste próprio PR, porque seu CI já registra os passos de checkout necessários.

Disparos manuais preservam inputs/aprovação externa de publicação e HEAD atual. Revisões antigas sem o novo passo podem usar exclusivamente a evidência histórica de CI `push/main` se o `ci.yml` daquela revisão realmente contém o gatilho legado. Esse caminho não autoriza a main nova sem evidência do PR. Baseline, releases antigas, hash OpenAPI e confirmação de rollback permanecem preservados.

Nenhum ruleset, environment, kill switch ou recurso AWS é alterado por esta implementação. A concorrência do deploy continua sem cancelar produção; somente CI obsoleto do mesmo PR é cancelado.

## Recorte de duração e validação

Referência saudável observada, sem reexecutar: [CI 39825458138](https://github.com/alric-corp/escola-da-nuvem-portal/actions/runs/39825458138), `push/main` de `142d4fa2150cece27cdc65a29f6b358dd3d9c6c3`, 22/10/2026. Duração entre início/fim de cada job (sem fila):

| Job | Duração |
|---|---:|
| Backend | 3min31s |
| Frontend | 10min27s |
| Terraform | 2min43s |
| Bootstrap | 1min08s |

No modelo novo esses quatro jobs rodam no PR, sem a segunda execução após merge. Não se promete redução de duração de cada suíte; o deploy mantém build/validações específicas da release, OIDC, publicação, ativação e smoke. Timeouts 30/5/5 e intérpretes do PR #16 permanecem. As medições desta referência não estimam latência AWS nem o tempo futuro de cada deploy.

Testes controlados: `test_ci_pr_approval.py` cobre IDs distintos com árvore igual, primeiro merge da transição, PR/CI incorretos, quatro jobs da mesma tentativa, checkouts divergentes, base/árvore diferentes, falhas HTTP, paginação, squash e recuperação histórica. O simulador executa o gate do workflow real e prova que uma árvore divergente não alcança build/OIDC/publicação. Mutações removem individualmente as guardas, sem acessar produção.

A prova depende de a API ainda conseguir ler o run, os jobs e o commit temporário testado. Ausência/expiração da evidência bloqueia, não aprova por inferência. A retenção de artefatos não participa desta decisão. Rebase/squash só é aceito quando o PR integrado, o head de origem, o merge temporário testado e a árvore integral final podem ser comprovados; ausência dessas referências não é inferida como equivalência.

Referências oficiais: [evento pull_request e GITHUB_SHA do merge temporário](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [API de runs](https://docs.github.com/en/rest/actions/workflow-runs) e [API de jobs/tentativas](https://docs.github.com/en/rest/actions/workflow-jobs).

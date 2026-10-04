# 07 · Revisar o limite de requisições da API

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída (aplicado em produção) · **Prioridade:** média · **Esforço:** pequeno · **Área:** infra

## Problema
A stage estava com `throttling_rate_limit = 10` e `throttling_burst_limit = 20` (`infra/terraform/api.tf`). Cada entrada faz pelo menos 3 chamadas (`/me`, `/cohorts`, `/report`). Uma turma inteira abrindo o portal ao mesmo tempo podia receber erros 429.

## O que foi verificado no CloudWatch (conta `712107929769`, API `y7e0g48k4d`)
- `4XXError` (soma por hora, últimos ~24 dias): **0**. Nenhum 429 registrado até hoje.
- `Count` por minuto no pico observado (14/09, ~19h): até 76 requisições/min (~1,3 req/s em média) — bem abaixo do limite antigo de 10 req/s, mas o uso até aqui é de testes/poucos alunos, não de uma turma inteira entrando ao mesmo tempo.
- Conclusão: não há evidência de que o limite antigo já tenha causado problema, mas ele deixa pouca margem (rajada de 20) para quando várias dezenas de alunos abrirem o portal juntos — daí o ajuste preventivo.

## O que foi feito
- `infra/terraform/api.tf`: `throttling_rate_limit` 10→**50**, `throttling_burst_limit` 20→**100** (valores sugeridos no próprio backlog), mantendo alguma proteção contra abuso (não removido o limite).
- `frontend/app.js` (função `api`, usada por toda chamada ao backend): chamadas **GET** que recebem 429 agora são repetidas automaticamente até 3 vezes, com espera crescente e variação (400ms, 800ms, 1600ms + jitter) para não sincronizar clientes limitados juntos. Chamadas **POST** não são repetidas automaticamente (evita duplicar uma ação como publicar notas ou enviar lembrete) — mostram a mensagem amigável já na primeira 429: "O portal está com muitos acessos agora. Aguarde alguns segundos e tente novamente."

## Testes
- Novo `tests/rate-limit-browser.mjs` (Playwright, instalado temporariamente nesta sessão para validar): confirma que uma rota GET com duas respostas 429 seguidas de sucesso resulta no painel carregado normalmente (3 tentativas), e que uma rota POST com 429 mostra a mensagem amigável imediatamente, sem repetir (1 tentativa).
- Suíte completa de testes de navegador existente (`tests/browser.mjs`, `tests/journey-browser.mjs`, `tests/student-journey-browser.mjs`, `tests/canvas-links-browser.mjs`) rodada com Playwright real: todos passando, sem regressão.
- **Nota:** o Playwright não estava instalado neste ambiente (diferente de sessões anteriores). Foi instalado temporariamente em `/tmp/pw-test` só para rodar esta validação; não faz parte do repositório. Se o ambiente de desenvolvimento não tiver Playwright disponível permanentemente, `npm install playwright` (ou equivalente) antes de rodar `tests/*-browser.mjs`.

## Aplicado em produção em 2026-09-24
- `terraform apply`: **0 destruídos, 4 atualizados in-place** (a stage com os novos limites + as 3 lambdas, que já traziam pendente o código das tarefas 05 e 06 — aproveitado no mesmo deploy). `terraform plan` depois confirma "No changes".
- `scripts/deploy_frontend.sh`: build gerado e sincronizado com o bucket `restart-portal-prod-712107929769-us-east-1-web`, com invalidação do CloudFront (`E3LDQGCHVIV9OK`). Esse deploy também levou ao ar as mudanças de frontend da tarefa 03 (tom da situação/média para o aluno), que ainda não tinham sido publicadas.

## Passos
- [x] Consultar no CloudWatch o pico de requisições e se já houve 429 (nenhum encontrado).
- [x] Ajustar os limites, para 50/100, mantendo proteção contra abuso.
- [x] No frontend, mostrar uma mensagem amigável para 429 e tentar de novo com espera crescente em chamadas GET.

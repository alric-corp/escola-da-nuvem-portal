# 07 · Revisar o limite de requisições da API

**Prioridade:** média · **Esforço:** pequeno · **Área:** infra

## Problema
A stage está com `throttling_rate_limit = 10` e `throttling_burst_limit = 20` (`infra/terraform/api.tf`). Cada entrada faz pelo menos 3 chamadas (`/me`, `/cohorts`, `/report`). Uma turma inteira abrindo o portal ao mesmo tempo pode receber erros 429.

## Passos
- [ ] Consultar no CloudWatch o pico de requisições e se já houve 429.
- [ ] Ajustar os limites, por exemplo 50/100, mantendo proteção contra abuso.
- [ ] No frontend, mostrar uma mensagem amigável para 429 e tentar de novo com espera crescente em chamadas GET.

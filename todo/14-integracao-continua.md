# 14 · Integração contínua (GitHub Actions)

**Prioridade:** média · **Esforço:** pequeno · **Área:** qualidade

## Problema
Existem cerca de 100 testes (Python, Moto, Node, Playwright, Terraform), mas eles dependem de instalações manuais em `/private/tmp` e nada roda automaticamente.

## Proposta
- `package.json` na raiz, com Playwright como devDependency e scripts `test`, `test:browser`.
- `requirements-dev.txt` com `boto3` e `moto` fixados.
- Workflow `.github/workflows/ci.yml` que roda em cada PR:
  - `python -m unittest discover -s backend`
  - `python -m unittest discover -s tests/integration` com Moto
  - `node --test tests/*.mjs`
  - build e `tests/browser.mjs`, `tests/journey-browser.mjs`
  - `terraform fmt -check`, `validate`, `test`
- Ajustar os testes para não exigir `PLAYWRIGHT_MODULE` apontando para `/private/tmp`.

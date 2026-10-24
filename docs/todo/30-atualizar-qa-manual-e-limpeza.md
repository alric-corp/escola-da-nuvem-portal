# 30 · Alinhar o kit de QA manual e sua limpeza ao portal atual

**Status:** aberto · **Prioridade:** média · **Esforço:** pequeno a médio · **Área:** QA / operação

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`, por leitura dos scripts
e comparação com backend/testes atuais. Os scripts `live_*` **não foram
executados**; não há afirmação de contas ou resíduos existentes em produção.

- [live_browser.mjs](../../tests/live_browser.mjs), linhas 114–145, espera aluno
  acessando `class-report` e os antigos botões “Notas da turma” e “Minha
  visibilidade”. A autorização atual exige instrutor/admin, demonstrada por
  [test_portal.py](../../backend/test_portal.py), linhas 405–418.
- [live_accounts.py](../../tests/live_accounts.py), linhas 66–76, limpa
  partições USER/COHORT. Os writers atuais também criam referências em
  `COHORT_DIRECTORY` e `DISCOVERY_EMAIL#…`, fora dessas partições
  ([derived_access.py](../../backend/derived_access.py), linhas 24–45).
- [live_readiness.mjs](../../tests/live_readiness.mjs), linha 39, compara apenas
  o `config.json` da raiz, preservado por compatibilidade; isso não comprova a
  configuração da release moderna ativa.
- [Jornada administrativa](../jornada-admin.md), linhas 18 e 27–32, ainda
  descreve recusa como ausente e correções de vínculo/nome como edição manual,
  embora essas ações já existam na interface e na API.

## Menor mudança recomendada

Atualizar expectativas, seletores e instruções das jornadas atuais. Separar o
roteiro de leitura com identidades já autorizadas dos testes que criam dados.
Revisar a limpeza dos recursos sintéticos e a identificação da configuração
efetivamente usada pela release, reutilizando os contratos e runbooks vigentes.

## Critérios de aceite

- [ ] Smoke segue os menus/perfis atuais; aluno recebe 403 em `class-report`
  e consulta somente os próprios dados. Não restaura funcionalidades removidas.
- [ ] Versão frontend/backend e limites da evidência são registrados; testes
  com mocks não são apresentados como QA autenticado real.
- [ ] Configuração verificada é a da release ativa; o arquivo legado não é
  tratado como fonte suficiente da versão moderna.
- [ ] Limpeza idempotente cobre somente referências derivadas do contexto
  sintético validado. Não apaga marcadores globais, candidatos de outra turma
  nem dados canônicos reais; falha parcial permite retomada.
- [ ] Testes locais controlados comprovam a seleção dos alvos de limpeza e as
  recusas de conta/turma/contexto incompatíveis, sem acesso AWS real.
- [ ] Instruções de jornada apontam para ações existentes e runbooks atuais.

## Limites e execução

Manter o kit fora do CI e sem novo gate por merge, conforme
[tests/README.md](../../tests/README.md#verificações-manuais-contra-o-ambiente-publicado).
Uso produtivo, criação/remoção de contas ou dados e qualquer mutação continuam
dependendo de autorização explícita. A pendência de QA autenticado só será
encerrada por execução real autorizada; esta tarefa não implanta nada.

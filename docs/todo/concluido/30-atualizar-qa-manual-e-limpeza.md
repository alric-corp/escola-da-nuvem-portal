# 30 · Alinhar o kit de QA manual e sua limpeza ao portal atual

**Status:** kit implementado nesta branch; integração pendente e QA autenticado real não executado · **Área:** QA / operação

## Resultado da implementação

O kit distingue leitura pública, QA autenticado com identidades já autorizadas
e smoke que cria dados sintéticos. Os módulos Node podem ser importados sem
abrir navegador, ler senhas ou fazer consultas. O roteiro considera que o
primeiro GET do relatório pode criar vínculo e que feedback/visualização como
aluno podem registrar efeitos; não chama esses caminhos de somente leitura.

`live_readiness.mjs` identifica o ponteiro, manifesto e config da release
moderna ativa, conferindo o hash do asset e a configuração esperada. Mantém a
configuração de raiz para baseline/legado. Registra o source SHA do frontend e
deixa `backendVersion: null` quando não há evidência independente da Lambda.

O smoke sintético foi alinhado aos menus atuais, ao isolamento do relatório
individual e à resposta 403 de `class-report` para aluno. Os controles antigos
de visibilidade e consulta da turma não foram restaurados.

A limpeza valida contexto, conta, identidades Cognito e dados antes de apagar.
Inclui somente as referências derivadas da turma sintética em
`COHORT_DIRECTORY` e `DISCOVERY_EMAIL`, preservando globais e outros candidatos.
Exclusões comparam o conteúdo observado; paginação, dados novos e falha parcial
permitem diagnóstico/retomada sem descartar o contexto. A exclusão Cognito usa
o Username canônico original revalidado, preservando uma identidade nova caso
o alias de e-mail seja reutilizado. Contextos sem identidade comprovada são
recusados para diagnóstico. Não faz Scan, backfill ou cutover de dados reais.

Regressões: [Node sem rede](../../../tests/live-qa.mjs) e
[Moto/fakes](../../../tests/integration/test_live_qa.py). O cleanup original foi
executado contra Moto e deixou referências derivadas mesmo após remover o
contexto (RED); a nova implementação limpa o escopo previsto e preserva os
demais registros (GREEN). Nenhum script live foi executado contra produção.

Os comandos e limites atuais estão no [guia de testes](../../../tests/README.md#verificações-manuais-contra-o-ambiente-publicado).
A jornada administrativa também foi atualizada com as ações já disponíveis,
incluindo o vínculo posterior do TODO 28.

**Pendência preservada:** somente uma execução real, explicitamente autorizada,
com identidades de teste adequadas pode comprovar QA autenticado em produção.
Os testes locais do kit e o CI não encerram essa pendência.

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`, por leitura dos scripts
e comparação com backend/testes atuais. Os scripts `live_*` **não foram
executados**; não há afirmação de contas ou resíduos existentes em produção.

- [live_browser.mjs](../../../tests/live_browser.mjs), linhas 114–145, espera aluno
  acessando `class-report` e os antigos botões “Notas da turma” e “Minha
  visibilidade”. A autorização atual exige instrutor/admin, demonstrada por
  [test_portal.py](../../../backend/test_portal.py), linhas 405–418.
- [live_accounts.py](../../../tests/live_accounts.py), linhas 66–76, limpa
  partições USER/COHORT. Os writers atuais também criam referências em
  `COHORT_DIRECTORY` e `DISCOVERY_EMAIL#…`, fora dessas partições
  ([derived_access.py](../../../backend/derived_access.py), linhas 24–45).
- [live_readiness.mjs](../../../tests/live_readiness.mjs), linha 39, compara apenas
  o `config.json` da raiz, preservado por compatibilidade; isso não comprova a
  configuração da release moderna ativa.
- [Jornada administrativa](../../jornada-admin.md), linhas 18 e 27–32, ainda
  descreve recusa como ausente e correções de vínculo/nome como edição manual,
  embora essas ações já existam na interface e na API.

## Menor mudança recomendada

Atualizar expectativas, seletores e instruções das jornadas atuais. Separar o
roteiro de leitura com identidades já autorizadas dos testes que criam dados.
Revisar a limpeza dos recursos sintéticos e a identificação da configuração
efetivamente usada pela release, reutilizando os contratos e runbooks vigentes.

## Critérios de aceite

- [x] Smoke segue os menus/perfis atuais; aluno recebe 403 em `class-report`
  e consulta somente os próprios dados. Não restaura funcionalidades removidas.
- [x] Versão frontend/backend e limites da evidência são registrados; testes
  com mocks não são apresentados como QA autenticado real.
- [x] Configuração verificada é a da release ativa; o arquivo legado não é
  tratado como fonte suficiente da versão moderna.
- [x] Limpeza idempotente cobre somente referências derivadas do contexto
  sintético validado. Não apaga marcadores globais, candidatos de outra turma
  nem dados canônicos reais; falha parcial permite retomada.
- [x] Testes locais controlados comprovam a seleção dos alvos de limpeza e as
  recusas de conta/turma/contexto incompatíveis, sem acesso AWS real.
- [x] Instruções de jornada apontam para ações existentes e runbooks atuais.

## Limites e execução

Manter o kit fora do CI e sem novo gate por merge, conforme
[tests/README.md](../../../tests/README.md#verificações-manuais-contra-o-ambiente-publicado).
Uso produtivo, criação/remoção de contas ou dados e qualquer mutação continuam
dependendo de autorização explícita. A pendência de QA autenticado só será
encerrada por execução real autorizada; esta tarefa não implanta nada.

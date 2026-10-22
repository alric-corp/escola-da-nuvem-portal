# AS-02, AS-03, AS-06 e AS-07 — implementação e ensaios locais

Revisão em **22/10/2026**, a partir da main `9097f5c7208be279aa85e007fe84d2f3e9c047e7` (PR #14/AS-01 integrado). O pacote AS-IS fornecido, `edn-as-is-2026-10-21.zip`, foi conferido pelo SHA-256 `50971f952bf0a8705dbb61c6ea99e3cd4a40aafb933950cbdd56189308673ac0`. Scripts da auditoria foram inspecionados; as reproduções usam dados fictícios e clientes controlados. Nenhuma consulta real Canvas/AWS, sincronização produtiva, envio de mensagem ou alteração de configuração foi executada.

| Achado | Entrega neste PR | Limite |
| --- | --- | --- |
| AS-02 | Corrigido e testado: catálogo completo ou último válido do mesmo curso | Implantação backend pendente; não comprova permissões da instância Canvas |
| AS-03 | Corrigido e testado: proveniência, retenção e coberturas independentes | Implantação backend pendente; sem QA autenticado produtivo |
| AS-06 | Otimizado com evidência: menos leituras redundantes, mesmo resultado autorizado | Parcial: Scan global e fallback S3 permanecem; TODO 05 continua aberto |
| AS-07 | Otimizado com evidência: atualização localizada e formatadores reutilizados | Sem paginação; medições sintéticas locais não são latência de produção |

## AS-02 — catálogo completo ou preservado

O RED na revisão acima confirmou que `items` omitido/null ou parcial podia virar catálogo vazio e substituir links/módulos válidos. Os controles inline completo e vazio legítimo já funcionavam. A regressão permanente está em [test_canvas_catalog.py](../tests/integration/test_canvas_catalog.py).

Agora cada módulo publicado reutiliza inline completo ou busca a rota de itens construída pelos IDs validados do curso/módulo. A leitura segue todas as páginas, inclusive página vazia com próximo link. O universo comparado com `items_count` é o de **todos os itens**, antes do filtro Assignment/publicação. Contagem incompatível, IDs repetidos, resposta malformada, erro intermediário ou outro curso/módulo tornam o candidato inconclusivo. URL de paginação e redirects são confinados à origem HTTPS e à rota consultada antes de encaminhar Authorization; `items_url` não vira uma origem arbitrária confiável.

Só um candidato completo chega a `save_catalog`. Falha preserva o registro anterior da mesma chave; sem anterior, não inventa links. Vazio/remoção comprovados podem substituir o anterior. Ordenação, primeira ocorrência de Assignment e filtro histórico de URL de item externo são preservados. `with_catalog` usa o curso atual da turma, sem reutilizar catálogo de outro curso.

Uma falha auxiliar não impede tentar notas, mas o SyncRun agendado continua incompleto/falho quando catálogo ou roster falham: não se relaxa a condição dos lembretes. O cache existente faz o catálogo/roster por curso, não por turma ou aluno. Custo: páginas de módulos + páginas de itens dos módulos incompletos; inline completo acrescenta **zero** chamadas de itens.

Fontes oficiais: [Modules](https://developerdocs.instructure.com/services/canvas/resources/modules), [paginação](https://developerdocs.instructure.com/services/canvas/basics/file.pagination). Foram consultadas para o contrato, sem acesso à instância real. `canvasLinksEnabled=false` é uma decisão preexistente preservada: testes verificam dados, helpers e agrupamentos; não afirmam que os botões Canvas estejam habilitados no produto.

## AS-03 — política e proveniência

A [política por campo e formato aditivo da API](canvas-engagement.md#política-do-portal-para-coletas-parciais-as-03) é a referência de manutenção. [Evidência RED/GREEN e tamanhos](evidence/as02-07/engagement-policy.json): na base um valor conhecido de 7.200s virava null com horário global novo após omissão; agora continua 7.200s, com a observação original, tentativa nova e qualidade `partial`.

Os [testes de atividade](../tests/integration/test_canvas_activity.py) exercitam omissão, null, inválidos/futuro, zero, múltiplas matrículas, remoção somente com listagem completa, mudança de curso, dados legados, autorização e CAS determinístico. O início da consulta ordena tentativas; a conclusão valida/identifica a observação. Atividade ocorrida durante a consulta é aceita quando anterior à conclusão. Uma transação que perde a comparação não é repetida. Falha na persistência não comprova gravação da qualidade: mantém warning e dados anteriores, sem bloquear o caminho acadêmico.

Não há nova tabela nem histórico de eventos. Serialização UTF-8 efetiva por `Repository._encode`, sem nomes/e-mails/payload:

| Alunos fictícios | JSON do registro | Atributos do item (nomes/chaves/string) |
| --- | ---: | ---: |
| 40 | 21.784 B | 21.820 B |
| 200 | 108.344 B | 108.380 B |
| 400 | 216.544 B | 216.580 B |
| 500 | 270.644 B | 270.680 B |

Essa amostra fica abaixo de 400 KiB; não demonstra capacidade/latência AWS nem justifica divisão preventiva. Os metadados aumentam o registro e o relatório; o tamanho deve voltar a ser medido se o formato ou o universo crescerem.

A tela mostra mediana e cobertura de tempo n/ativos, cobertura independente de última atividade, valores retidos, limitações legadas e aviso de observação antiga. Contagens de sete dias usam a última informação disponível; não provam ausência de interação posterior à observação. Zero válido permanece na mediana; desistentes ficam fora dos agregados e no final da ordenação. Busca/filtros/CSV e as doze colunas existentes são preservados. Não se adiciona nota de dedicação, nem se altera classificação acadêmica.

## AS-06 — descoberta de turmas

Reprodução:

```sh
python3 -m pip install -r requirements-dev.txt  # no ambiente local de testes
python3 scripts/benchmark_cohort_discovery.py --samples 3 --output /tmp/cohort-discovery.json
python3 -B -m unittest discover -s tests/integration -p test_cohort_discovery.py
```

[Amostras completas](evidence/as02-07/cohort-discovery.json): Python 3.12.13, Moto 5.1.22, macOS ARM64; 30 casos com três amostras antes/depois alternadas sobre o **mesmo fixture**. O script extrai somente o Portal da revisão-base via Git local; não troca checkout. Varia 5/25/50 turmas, 0/200/500/800 registros alheios, zero/um/vários vínculos válidos, aluno/instrutor/ambos/admin, turma sem publicação, vínculo removido e OWNER alheio. `Limit=25` força páginas pequenas só no ensaio, não altera o Repository produtivo.

A otimização reaproveita, dentro da requisição, a ausência de STUDY já lida por Query consistente; o fallback por e-mail e a conferência OWNER permanecem. Admin não precisa consultar STUDY/TEACH para ter visibilidade global. Não há cache entre usuários/requisições nem troca de consistência.

Exemplo com **50 turmas e 500 registros alheios** (além dos itens do fluxo):

| Perfil/vínculos válidos | GetItem antes → depois | Query antes → depois | Scan: páginas / examinados / turmas retornadas | S3 antes = depois |
| --- | ---: | ---: | --- | ---: |
| Aluno / 0 | 101 → 61 | 2 → 2 | 24 / 592 / 50 | 40 |
| Aluno / 4 | 94 → 57 | 2 → 2 | 24 / 596 / 50 | 37 |
| Instrutor e aluno / 2 | 99 → 60 | 2 → 2 | 24 / 596 / 50 | 39 |
| Admin / 0 | 0 → 0 | 2 → 0 | 24 / 592 / 50 | 0 |

Para o aluno sem vínculo, medianas locais foram 114,916 → 99,536ms, com intervalos 114,014–116,809 → 99,123–101,756ms. O ganho confiável é a redução de operações; estes tempos incluem emulação Moto e não estimam latência, capacidade consumida ou economia AWS.

Com **25 turmas fixas**, acrescentar 0/200/800 registros alheios aumenta itens examinados pelo Scan de 47/247/847 e páginas de 2/10/34, embora ele continue retornando 25 turmas. O filtro não elimina esse custo. O JSON dos itens de Scan retornados varia apenas de 3.502 para 3.566 B por causa das páginas vazias; são bytes serializados da fixture, não tráfego de rede ou capacidade faturada. O [TODO 05](todo/05-descoberta-de-turmas-por-vinculo.md) permanece parcial: eliminar o Scan exige uma decisão estrutural fora deste PR.

## AS-07 — tabela do instrutor

O [ensaio detalhado](evidence/as02-07/teacher-performance.md) compara a base, AS-03 ainda sem otimização e o resultado final, com a mesma massa de 40/200/400 alunos. Decompõe filtro/ordenação, HTML, substituição do DOM, layout/estilo e atualização da página; registra amostras e dispersão. Não representa p95/INP de produção nem celular físico.

Reutilizar `Intl.DateTimeFormat`/`Intl.Collator` e atualizar somente resultados/controles da tabela evita reconstruir menu, sessão, Foco e agregados por tecla. Não foi necessária paginação: todos os resultados continuam acessíveis e o CSV usa o conjunto filtrado inteiro. As regressões de navegador verificam preservação de nós da casca/agregados, foco/seleção, filtros combinados, detalhes/retorno, teclado, mobile e texto ampliado. Screenshots usam somente dados fictícios.

## Compatibilidade e implantação futura — não executada

- Frontend novo aceita backend anterior, campos desconhecidos, ausência de coleta e registro legado; sem metadados por campo, trata a referência global como legada, sem falso frescor.
- Backend novo mantém os valores/chaves existentes e acrescenta campos opcionais somente no relatório autorizado. O frontend anterior ignora os metadados extras. Aluno e relatório compartilhado não recebem métricas individuais.
- OpenAPI foi alterado em `openapi/src/` e consolidado com `npm run openapi:bundle`; `npm run openapi:check` valida o resultado. Rotas, scopes e notas não mudam. Não existe migração/backfill ou novo serviço.
- Preferir backend compatível antes do frontend. O merge dispara somente o frontend; se ele chegar primeiro, os valores antigos aparecem com a limitação legada até a implantação backend. Não bloquear o painel esperando novos dados.

A implantação posterior segue [infra/README.md, operação](../infra/README.md#5-operação-posterior). O archive `infra/terraform/.build/identity.zip` é compartilhado por `aws_lambda_function.identity`, `canvas_sync`, `automatic_reminders`, `reminder_events` e `auth_trigger`; a revisão do plano deve identificar as atualizações de código, sem introduzir mudança administrativa. Os caminhos diretamente afetados são a API identity e a coleta canvas-sync. Testes novos ficam fora de `backend/` para não entrar no pacote compartilhado, preservando a lista atual de exclusões.

Comandos do procedimento existente, **somente para futura implantação autorizada**, não executados nesta missão:

```sh
terraform -chdir=infra/terraform plan -out=portal.tfplan
# Revisar o plano e o pacote compartilhado; a implantação exige autorização própria.
terraform -chdir=infra/terraform apply portal.tfplan
```

Não executar sincronização manual ou envio para demonstrar a correção. Após implantação autorizada, a coleta agendada existente fornecerá os novos metadados; leitura posterior deverá comprovar código e resultado separadamente. CI verde e frontend publicado não comprovam AS-02/03 implantados.

## Validação e limites

Comandos consolidados: `npm test`, `npm run test:browser`, `python3 -B -m unittest discover -s backend`, `python3 -B -m unittest discover -s tests/integration`, mutações existentes de stale/lifecycle, build/release e `npm run openapi:check`; os resultados finais são registrados no PR. Benchmarks não viram testes com limites absolutos de tempo no CI. Testes funcionais verificam trabalho reduzido e invariantes.

Ambiente local Python 3.12.13/Node 26.7.0; CI fixa Python 3.12/Node 22. O runtime Lambda declarado é Python 3.13, indisponível localmente nesta revisão: não foi executado recorte nesse intérprete. Não houve QA autenticado real, comparação de pacotes produtivos, carga real ou leitura de capacidade/custo AWS. AS-01, TODOs 22–25, IAM, infraestrutura, agendamentos e kill switch foram preservados.

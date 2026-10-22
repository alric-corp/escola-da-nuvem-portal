# AS-07 — ensaio local da tabela do instrutor

Medição em 22/10/2026. Base `9097f5c7208be279aa85e007fe84d2f3e9c047e7`, AS-03 com o mesmo texto/qualidade da entrega ainda sem otimização, e implementação final. Todos os alunos, nomes, e-mails e respostas são fictícios. Nenhuma requisição externa, credencial real ou mutação é permitida pelo servidor do ensaio.

## Método e limites

- Apple M5 Pro, 15 CPUs lógicas; macOS ARM64, Node 26.7.0, Chromium 153.0.8010.12.
- Desktop 1440 × 1000, locale pt-BR, fuso America/Sao_Paulo, data fixa de 21/10/2026 às 12h UTC. Sem limitação artificial de CPU/rede. Os três estados foram medidos sequencialmente, sem outras suítes do projeto em execução.
- Mesma massa em todos os estados: 40, 200 e 400 alunos, incluindo zero, ausência, retenção, desistentes e duas atividades com foco. Três contextos por tamanho; uma interação de aquecimento e cinco amostras de cada ação por contexto: **15 amostras por ação/tamanho/estado**.
- Ordenação alterna nome/pendências; busca alterna dois termos que mantêm a massa; filtro alterna todos/ativos. O tempo síncrono inclui geração HTML e substituição DOM do handler. A construção HTML completa também é medida separadamente, sem substituição DOM.
- CDP fornece deltas de layout/recálculo de estilo; duas animation frames são um proxy de atualização, não uma medição isolada da pintura. Identidade dos nós indica se menu e agregado foram reconstruídos.
- Não são INP, p95, RUM, latência AWS ou resultados em celular físico. Dispersão e variação de processo/ordem não permitem atribuir um custo fixo ao AS-03; os ganhos finais são comparações deste ensaio.

## Tempos síncronos

Mediana [mínimo–máximo], em milissegundos. Cada célula contém 15 amostras.

| Alunos | Estado | Ordenar | Buscar | Filtrar |
| ---: | --- | ---: | ---: | ---: |
| 40 | Base | 14 [13–14] | 14 [12–16] | 13 [12–14] |
| 40 | AS-03 sem otimização | 11 [10–12] | 11 [10–12] | 10 [10–12] |
| 40 | Final | 2 [2–3] | 3 [2–3] | 2 [2–3] |
| 200 | Base | 54 [34–61] | 53 [34–61] | 49 [32–59] |
| 200 | AS-03 sem otimização | 39 [37–45] | 39 [37–43] | 38 [34–43] |
| 200 | Final | 8 [8–9] | 8 [7–9] | 8 [7–8] |
| 400 | Base | 72 [69–80] | 69 [68–75] | 67 [61–80] |
| 400 | AS-03 sem otimização | 76 [74–82] | 75 [74–78] | 73 [67–88] |
| 400 | Final | 16 [15–18] | 16 [15–17] | 15 [14–17] |

A mediana síncrona final cai aproximadamente 78–85% frente à base nas três ações. O AS-03 sem otimização fica ligeiramente mais lento em 400 alunos, mas as massas menores têm variação suficiente para não afirmar uma sobrecarga fixa da política.

## HTML, DOM e atualização visual

Medianas; layout e duas frames referem-se à ordenação. A geração HTML usa 15 amostras; DOM/bytes usam as três composições iniciais.

| Alunos | Estado | HTML completo (ms) | HTML (B) | Nós DOM | Layout (ms) | Até 2 frames (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 40 | Base | 5 | 69273 | 1446 | 3,249 | 46 |
| 40 | AS-03 sem otimização | 4 | 72804 | 1479 | 2,674 | 31 |
| 40 | Final | 1 | 72884 | 1480 | 1,923 | 31 |
| 200 | Base | 24 | 316088 | 6326 | 10,487 | 78 |
| 200 | AS-03 sem otimização | 19 | 332385 | 6483 | 8,014 | 63 |
| 200 | Final | 5 | 332465 | 6484 | 7,393 | 31 |
| 400 | Base | 34 | 624793 | 12425 | 15,191 | 95 |
| 400 | AS-03 sem otimização | 37 | 656950 | 12736 | 16,066 | 96 |
| 400 | Final | 9 | 657030 | 12737 | 14,334 | 63 |

No final, menu e agregado de engajamento mantêm a identidade em **15/15** amostras de cada ação/tamanho; base e estado intermediário mantêm em **0/15**. O ganho vem de formatadores reutilizados e composição restrita aos resultados, preservando controles e outros componentes.

**Limite preservado:** todas as linhas continuam no DOM, sem paginação. Os 12.737 nós em 400 alunos e o custo de layout não desaparecem; a redução síncrona não equivale a uma redução de 80% na entrega visual. O proxy até duas frames em 400 alunos foi de 95 para 63ms na ordenação. Não foi criada uma biblioteca ou virtualização.

## Sonda isolada de filtro/ordenação e substituição DOM

Recorte adicional, separado da interação completa acima. Mesma massa e três contextos por tamanho; uma amostra de aquecimento e cinco retidas por contexto (**15 amostras**). `filteredStudents()` usa busca “Fict”, todos os status e ordenação de pendências; cada amostra é a média de 20 chamadas para reduzir a quantização do relógio. Os resultados continuam contendo todos os 40/200/400 alunos.

A substituição mede somente `target.innerHTML = html` com o HTML já construído e serializado do próprio DOM, no alvo correspondente ao caminho real: aplicação inteira na base/intermediário, resultados no final. Exclui construir HTML, layout e pintura, que não podem ser inferidos dessa duração. Não equivale a disparar o handler nem a comprovar o comportamento funcional da aplicação — isso é coberto pelos testes de navegador.

Mediana [mínimo–máximo], em milissegundos:

| Alunos | Estado | Filtro + ordenação | Substituição DOM | Alvo |
| ---: | --- | ---: | ---: | --- |
| 40 | Base | 0,15 [0,15–0,25] | 1 [1–2] | `#app` |
| 40 | AS-03 sem otimização | 0,15 [0,15–0,2] | 1 [1–2] | `#app` |
| 40 | Final | 0,05 [0–0,05] | 1 [1–1] | `#teacher-student-results` |
| 200 | Base | 0,8 [0,8–0,85] | 3 [3–4] | `#app` |
| 200 | AS-03 sem otimização | 0,8 [0,75–0,9] | 4 [3–4] | `#app` |
| 200 | Final | 0,2 [0,2–0,25] | 4 [3–5] | `#teacher-student-results` |
| 400 | Base | 1,65 [1,6–1,8] | 7 [6–8] | `#app` |
| 400 | AS-03 sem otimização | 1,7 [1,6–1,85] | 7 [6–9] | `#app` |
| 400 | Final | 0,4 [0,4–0,45] | 7 [6–9] | `#teacher-student-results` |

A reutilização do collator reduz filtro/ordenação nesta sonda; o parsing/substituição das centenas de linhas permanece próximo entre estados. A atualização localizada preserva os componentes externos, mas não elimina o custo estrutural da própria tabela. **Pintura isolada não foi medida**; as duas frames do ensaio principal continuam sendo apenas proxy.

## Reprodução

A execução é local e manual; não cria um limite temporal frágil no CI. O [script](../../../scripts/benchmark_teacher.mjs) contém a massa e aborta requisições externas. Depois de instalar as dependências do repositório e Chromium pelo procedimento existente:

```sh
teacher_bench_dir=$(mktemp -d /tmp/edn-teacher-bench.XXXXXX)
git archive 9097f5c7208be279aa85e007fe84d2f3e9c047e7 frontend | tar -x -C "$teacher_bench_dir"
node scripts/benchmark_teacher.mjs --label base --frontend "$teacher_bench_dir/frontend" --output "$teacher_bench_dir/base.json"
node scripts/benchmark_teacher.mjs --probe --label base-probe --frontend "$teacher_bench_dir/frontend" --output "$teacher_bench_dir/base-probe.json"
patch -p1 -d "$teacher_bench_dir" < docs/evidence/as02-07/teacher-as03-unoptimized.patch
node scripts/benchmark_teacher.mjs --label as03-unoptimized --frontend "$teacher_bench_dir/frontend" --output "$teacher_bench_dir/as03.json"
node scripts/benchmark_teacher.mjs --probe --label as03-probe --frontend "$teacher_bench_dir/frontend" --output "$teacher_bench_dir/as03-probe.json"
node scripts/benchmark_teacher.mjs --label final --output "$teacher_bench_dir/final.json"
node scripts/benchmark_teacher.mjs --probe --label final-probe --output "$teacher_bench_dir/final-probe.json"
```

O patch reproduz somente a política/apresentação AS-03 sobre a base, sem atualização localizada nem reutilização dos formatadores. Não se aplica à árvore de trabalho da entrega. Os hashes dos quatro arquivos de runtime estão em cada evidência.

## Evidências e regressões

- Amostras: [base](teacher-base.json), [AS-03 sem otimização](teacher-as03-unoptimized.json), [final](teacher-final.json); [resumo com quartis/ranges](teacher-performance-summary.json).
- Sonda isolada: [base](teacher-base-probe.json), [AS-03 sem otimização](teacher-as03-unoptimized-probe.json), [final](teacher-final-probe.json).
- RED externo na base: asserções novas de universo/cobertura não existem, e o painel reconstrói seus nós. O segundo é a diferença de trabalho decidida nesta rodada, sem reinterpretar um contrato anterior.
- Foi encontrado e corrigido no render localizado o caso de teclado “Limpar busca e filtros”: como o botão vazio desaparece, o foco volta ao equivalente “Limpar filtros” da barra; não cai em BODY nem move o foco dos controles preservados. Reprodução RED externa anterior à correção, seguida de regressão permanente nos dois perfis.
- [Node](../../../tests/teacher-home.mjs) cobre cobertura por campo, zero/null/retido/legado, ausência de falso frescor, conjunto completo/CSV. [Navegador](../../../tests/teacher-home-browser.mjs) cobre teclado, foco/caret, DOM preservado, filtros, CSV completo, troca de turma, responsividade e texto ampliado. Recorte dirigido: 97 testes Node e 17 browser aprovados, sem falhas/skips; a consolidação é reportada separadamente no PR, sem somar conjuntos sobrepostos.
- Capturas fictícias: [engajamento desktop](teacher-engagement-desktop.png), [engajamento mobile](teacher-engagement-mobile.png), [tabela desktop](teacher-rows-desktop.png), [tabela mobile](teacher-rows-mobile.png).

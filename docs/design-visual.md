# Direção visual do portal

**Status:** piloto local, sem commit e sem deploy (branch local `visual/piloto-aluno`).

| Etapa | Situação |
|---|---|
| V2 — conteúdo de "Meu desempenho" | aprovada como referência visual |
| V3 e V3.1 — casca global | implementadas |
| V3.2 — navegação adaptativa | implementada e validada tecnicamente (testes e mutações) |
| Expansão 1 — "Minhas atividades" | **aprovada e encerrada** (V3.2 a V3.4.1 aprovadas visualmente em 12/10/2026) |
| V3.3 — refinamento de "Minhas atividades" e do limite da navegação | implementada; o link do Canvas junto ao título foi desfeito na 3.4 |
| V3.4 — consolidação: casca com texto ampliado em tela estreita, estados vazios, link do Canvas em linha própria | implementada |
| V3.4.1 — link do Canvas ao lado do título no desktop, sem sobreposição | **aprovada visualmente** |
| Expansão 2 — "Meu histórico" do aluno | **aprovada** técnica e visualmente (12/10/2026) |
| Expansão 3 — Feedback do aluno | **aprovada** técnica e visualmente, com a consolidação (12/10/2026) |
| Consolidação da Expansão 3 — mensagens longas, confirmação e erros no formulário | **aprovada** junto com a Expansão 3 |
| Expansão 4 — Painel do instrutor | **aprovada** técnica e visualmente (13/10/2026) |
| Expansão 5 — Publicações da turma | **aprovada** técnica e visualmente (13/10/2026) |
| Expansão 6 — Atualizar notas | **aprovada** técnica e visualmente (13/10/2026) |
| Expansão 7 — Lembretes (o remetente e o lote) | **aprovada** técnica e visualmente (13/10/2026), com o fechamento — o significado dos resultados e os avisos de sucesso (14/10/2026) |
| Expansão 8 — Turmas e acessos | **aprovada** visualmente (14/10/2026) |
| Expansão 8.1 — consolidação: Vincular com a turma escolhida e a pergunta; atalho Criar turma | ajustes **aprovados** nas capturas; regressão final comprovada no gate da Expansão 9 (14/10/2026) |
| Expansão 9 — Feedbacks administrativos | **aprovada** visualmente (14/10/2026) |
| Consolidação transversal final — auditoria do conjunto, remoções equivalentes no CSS (A/B), propostas C/D | **aprovada** (15/10/2026) |
| C1 — correções de confiabilidade pré-integração (D03, D04, D05) | **aprovada** funcionalmente (15/10/2026) |
| C2 — robustez pré-integração (o aviso da dúvida da restauração; salvamentos do foco sobrepostos) | implementada e validada tecnicamente, **aguardando aprovação final** |

Telas fora do piloto (as outras telas do instrutor — "Visão por atividade", o detalhe do aluno, com a prévia e o envio
individuais do lembrete, "Notas da turma" e o Feedback que instrutor e admin abrem pelo rodapé — e a entrada pública) não foram
expandidas. Do instrutor, foram expandidos o painel (página inicial, Expansão 4), "Publicações da
turma" (Expansão 5, que divide `history.js` com "Meu histórico"), "Atualizar notas" (Expansão 6) e "Lembretes" com "Lembretes em
lote" (Expansão 7). Da administração, "Turmas e acessos" (Expansão 8) e a área Feedbacks (Expansão 9).

## Objetivo

Responder ao retorno de que o portal "parece um site genérico feito por IA" com problemas observáveis e corrigíveis,
não com troca de framework. A identidade institucional (logo, azul-marinho, ciano) continua a mesma; muda o que
estava genérico: tipografia de reserva, hierarquia plana, molduras repetidas, rótulos decorativos e cores sem papel.

## Diagnóstico (capturas do HEAD `779ee7e`, dados sintéticos)

1. **Fonte de reserva.** O `:root` pede Inter, sem `@font-face` nem arquivo; no Chromium do Mac o texto sai em
   Arial e os rótulos monoespaçados em Menlo (medido via DevTools Protocol).
2. **Tudo com o mesmo peso.** Cinco painéis iguais empilhados; dentro do resumo, cartões dentro do cartão.
3. **A atualização compete com as tarefas.** Borda ciana de 4px antes de "Por onde começar".
4. **Rótulos decorativos e repetição.** "PRÓXIMOS PASSOS" e "A CADA PUBLICAÇÃO" repetem o título; a turma aparece
   três vezes na primeira tela.
5. **Fundo quadriculado** no resumo.
6. **Linhas largas demais.** Em 1440px, "Sem nota" fica a cerca de 800px do nome da atividade.
7. **Gráfico.** O rótulo "LAB 95%" cobre o último ponto.
8. **Defeito real.** `next.map(activityCard)` passava o índice como `studentView` (`56,67%` no primeiro cartão).
9. **Cores sem papel (iteração 2).** Nas barras, KC era âmbar e LAB verde-água (situação); no gráfico, KC era ciano
   e LAB âmbar (série). O ciano servia a botão, link, anel, código da turma e LAB ao mesmo tempo.
10. **Moldura de foco.** Depois do carregamento o foco fica no `<main tabindex="-1">` (C7.1) e o Chromium desenhava
    o anel padrão em volta de todo o conteúdo.
11. **Fora do piloto, registrados:** a entrada pública aparece por um instante para quem já tem sessão, enquanto
    `/me` responde (`boot()` desenha antes de `state.me`). A arte da entrada traz uma barra de progresso decorativa.

## Direção de arte: "Instrumento de referência"

O portal mede o progresso do aluno em relação a uma referência. A linguagem visual é a do instrumento de medida:
réguas, marcações e relações entre valores, sem virar dashboard genérico.

- **Precisa:** números tabulares, régua com a referência marcada, cobertura contada atividade por atividade.
- **Acolhedora:** rótulos em caixa normal, frases inteiras, situação em peso normal, uma ação principal por tela.
- **Tecnológica:** a régua e o marcador como assinatura; a monoespaçada só para códigos.
- **Aluno e instrutor:** o aluno vê orientação (situação, o que fazer, o que mudou). O instrutor, na expansão, deve
  ter densidade de tabela e a mesma régua em miniatura por aluno.

## Cor por papel

| Papel | Cor | Onde |
|---|---|---|
| Ação | ciano institucional (`--color-action`) | botões, links, foco |
| Série KC | branco (`--color-series-kc`) | barra, linha, pontos, referência, marcador, rótulo, legenda, marca do tipo na atividade |
| Série LAB | violeta `#b49cff` (`--violet` → `--color-series-lab`) | os mesmos lugares de KC |
| Situação | âmbar (atenção) e verde-água (atingida) | só no ícone e no texto de situação |
| Cobertura | cinza do texto secundário | régua de segmentos e legenda |

- A cor de uma série não muda quando a média fica abaixo ou acima da referência; um teste garante.
- O violeta foi escolhido por contraste (7,86:1 no fundo; 5,96:1 na superfície elevada) e por distância perceptual
  (CIEDE2000) das cores de situação e de ação, inclusive com simulação de daltonismo.
- KC saiu do ciano porque ciano + violeta quase se confundem para protanopia e deuteranopia (ΔE00 4,3 e 4,5);
  branco + violeta mantém ΔE00 ≥ 21 nos quatro tipos de visão simulados. Isso também deixa o ciano só para ação.
- Alternativa sem cor nova (KC ciano, LAB cinza) foi capturada para comparação: ΔE00 15–19 e o ciano volta a
  significar ação e dado ao mesmo tempo.

## Tipografia e materiais

- **Família principal:** `system-ui` por enquanto. Experimento com Atkinson Hyperlegible Next e IBM Plex Sans
  (OFL 1.1, arquivos do Google Fonts) feito só nas capturas; nenhuma fonte foi adicionada ao projeto.
- **Escala do piloto:** h1 de 1,5 a 2rem (650, espaçamento -0,01em), títulos de seção 1,125rem, médias 2,25rem
  (1,75rem no celular), corpo 0,9375rem e metadados 0,8125rem.
- **Materiais:** fundo silencioso; o resumo é o único painel elevado; listas sobre o fundo, separadas por linhas finas.
- **Assinatura:** a marca de referência (cursor triangular na régua das médias e no fim de cada referência do
  gráfico), agora na cor da série, com um vão da cor da superfície para continuar visível sobre o preenchimento.
- **Formas de situação:** anel aberto âmbar (abaixo da referência, revisar), visto verde-água (atingida), segmento
  vazio (sem nota). As mesmas formas aparecem nas médias, na legenda do resumo e nas linhas de atividade.

## Tokens principais (`:root`)

Cores semânticas como apelidos (`--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-text`,
`--color-text-muted`, `--color-line`, `--color-line-soft`, `--color-action`, `--color-focus`, `--color-success`,
`--color-warning`, `--color-danger`, `--color-series-kc`, `--color-series-lab`); a única cor literal nova é `--violet`,
fora dos tokens semânticos (um teste recusa cor literal em `--color-*`). Também espaço (`--space-1` a `--space-7`),
raio (`--radius-sm/md/lg`), movimento (`--motion-fast`, `--motion-base`, `--ease-standard`) e família (`--font-ui`,
`--font-code`). Nenhum token existente teve o valor alterado.

## Movimento e foco

- Só transições de estado (cor e borda em hover, sublinhado de link, giro da seta das ajudas). Sem animação de
  entrada: `render()` recria o DOM a cada mudança e a animação se repetiria.
- Carregamento: esboço estático do resumo, oculto da leitura assistiva; quem anuncia é o `role="status"`.
- `prefers-reduced-motion`: a regra global zera transições; o estado continua visível sem movimento.
- Em todas as telas, o `<main>` não desenha o anel do navegador ao receber foco programático; o destino do foco
  (C7.1) é o mesmo e controles mantêm o contorno de 3px. Com a barra inferior fixa (até 760px), a página tem recuo
  de rolagem (`scroll-padding-bottom` na raiz) da altura da barra: o foco pelo teclado, inclusive em campos de texto
  altos, nunca fica atrás dela. (Na 2ª iteração era `scroll-margin` nos controles; com campos de texto o Chromium
  combinava mal os dois mecanismos.)

## Componentes do piloto

- **Resumo:** "Seu resumo", cobertura ("7 de 8 atividades com nota" + régua com um segmento por atividade liberada;
  acima de 24, barra contínua; sem atividades, "Nenhuma atividade liberada ainda"), legenda ("1 sem nota",
  "3 para revisar"), ação principal, médias KC e LAB com régua e, no rodapé do painel, "Como interpretar minhas notas?".
- **Atualização do Canvas:** legenda discreta logo abaixo do resumo, mesmos textos e a mesma action.
- **Por onde começar:** filtros, lista, nota sobre "sem nota" depois da lista, link para todas.
- **Linhas de atividade:** sem ícone em caixa; tipo com a marca da série; situação num formato só (texto com forma).
- **Celular (até 600px):** médias em linhas de largura total (nome e valor na mesma linha, régua abaixo); topo com
  página, papel e e-mail em uma linha quando cabem; a turma fica no seletor do cabeçalho (no topo, só para leitura
  assistiva).

Escopo técnico: o CSS só desta tela está na seção 28 de `styles.css`, sob `.student-home` ou
`.layout:has(.student-home)`; o que ela divide com Minhas atividades (formas de situação, linha de atualização,
"Como interpretar", linhas de atividade, estados de carregamento e erro) está na seção 30, sob
`:is(.student-home, .student-activities)` (desde a Expansão 2, `:is()` com as telas que usam cada peça, inclusive
`.student-history` e, na Expansão 3, `.student-feedback` no cabeçalho). Um teste por seção recusa seletor solto. Textos, `data-*`, ids e handlers
continuam os mesmos; `ui.js` só ganhou a classe `goal-kc`/`goal-lab` no indicador de média, usado apenas por esta tela.

## Casca global (3ª iteração, com as correções da 3.1 e da 3.2)

A casca vale para todas as telas e papéis (aluno, instrutor, admin) e fica na seção 29 de `styles.css`; um teste
limita os seletores dessa seção às peças da casca e recusa seletores de conteúdo. O conteúdo das telas fora de "Meu
desempenho", "Minhas atividades", "Meu histórico", do Feedback do aluno, do Painel do instrutor, de Publicações da turma, de Atualizar notas, de Lembretes e de Turmas e acessos não muda (outro teste confere a fonte delas). O `app.js` mede a casca real depois
de cada render, ao redimensionar e quando o menu muda de tamanho (`syncShell`, com `ResizeObserver` no menu, que
pega a troca do tamanho do texto sem redimensionar a janela): escreve `--bottom-nav-height`, `data-sidebar`,
`data-bottom-nav` e `data-header` na raiz; não toca em estado, foco nem conteúdo. Se a troca de modo acontece com o
leitor já abaixo do cabeçalho, compensa a rolagem para o conteúdo não saltar.

- **Barra lateral (desktop):** o mesmo fundo escuro da página, separada do conteúdo só por uma linha fina (3.1: sem as
  marcações repetidas; a assinatura fica onde comunica estado). Fica fixa (sticky, altura da janela) só quando o
  conteúdo real cabe na janela (`data-sidebar="fixa"`); se não cabe (janela baixa, zoom, texto ampliado), rola com a
  página, sem rolagem interna, e a conta (com Sair) vem logo depois do menu. Turma em monoespaçada; frase de apoio
  sem moldura; conta com iniciais em monoespaçada e Sair com área de 44px; demais textos em `system-ui`.
- **Item ativo:** a marca de referência das médias (régua de 2px e triângulo, em ciano), na lateral do item no
  desktop e no topo do item na barra inferior. Sem caixa de fundo.
- **Topo:** uma linha (turma e tela à esquerda, separadas por um traço só visual; papel e e-mail à direita), com
  linha fina embaixo. O papel sai do ciano.
- **Rodapé:** espelha o topo (linha fina em cima, texto discreto).
- **Cabeçalho do celular (até 760px):** logo de 48px fixos (não cresce com o texto), turma e Sair numa faixa de 60px.
  O seletor nunca fica mais estreito que o código. Se não couber tudo numa linha (texto ampliado), o cabeçalho usa a
  menor composição que cabe, sempre na ordem do DOM e do teclado, sem `order` (`data-header`): logo e turma juntos e o
  Sair à direita na linha seguinte (`sair-abaixo`, 3.4); se nem a turma cabe ao lado do logo, ela fica na própria
  linha, na largura toda (`quebrado`, 3.2). A medida é feita no arranjo natural, para não oscilar.
- **Espaços da casca no celular (3.4):** recuos e vãos do cabeçalho, do seletor, do Sair, do menu no fluxo e do topo em
  px (iguais aos de antes com texto normal): o texto cresce, a moldura não. Com texto a 200% eram 32 px de cada lado no
  cabeçalho e 24 px no seletor, o que empurrava a turma para uma linha própria.
- **Texto ampliado em tela estreita (3.4):** até 15em de largura (media query em `em`, que segue o tamanho de fonte do
  navegador: 320–480 px com texto a 200%, 320–360 px a 150%; nunca com texto normal). O topo mostra só a identidade:
  papel e e-mail num parágrafo, com o e-mail quebrando depois do "@" (`<wbr>`), nunca no meio de uma palavra. O nome da
  página fica para a leitura assistiva, porque já está no item ativo do menu e no título da tela (como a turma no
  painel, desde a 3.2). Conteúdo visível na primeira tela, antes → depois: aluno 320×568 a 200% em Minhas atividades
  −38 → 163 px (o título passou a aparecer); no painel 6 → 179 px; 320×640 a 200% 51 → 244 px; 390×844 a 200% 296 →
  500 px; admin 390×844 a 200% 303 → 414 px; texto normal sem mudança.
- **Barra inferior (até 760px):** grade que acompanha o texto. Cada coluna tem no mínimo 6em do rótulo e, com 5 ou 6
  destinos, no máximo três por linha: o admin fica em 3×2 em 320–390px e em 2×3 com texto a 200%; o aluno, em 4×1
  (2×2 com texto a 200%). Rótulos em 12px (0,75rem) para todos os papéis, uma palavra por linha; quebra com hífen só
  como último recurso. Sem degradê (com 16px ele ainda apagava a média de KC na primeira tela em 320×640): borda de
  cima nítida. O espaço no fim do conteúdo e o recuo de rolagem usam a altura real da barra (com a área segura do
  aparelho). Contorno de foco por dentro do item, inteiro na borda da tela.
- **Menu no fluxo (3.2; limite ajustado na 3.3):** quando as linhas do menu passam de **22%** da altura da janela, ele
  sai da barra fixa e fica no fluxo, logo abaixo da turma e antes do Sair, na largura da tela
  (`data-bottom-nav="fluxo"`). Os mesmos destinos, ordem, ícones, rótulos, `aria-current`, marca do item ativo e
  contorno; rola com a página e não deixa reserva no fim dela (`--bottom-nav-height: 0`). Volta a ser barra fixa
  abaixo de **20%** (faixa de tolerância, sem oscilar perto do limite). Na 3.2 o limite era 25%/23%; o valor é uma
  hipótese de UX, medida nos casos abaixo (fração = linhas do menu ÷ altura da janela):

  | Caso | Fração | 3.2 (25%) | 3.3 (22%) |
  |---|---|---|---|
  | admin 390×844, texto a 200% | 22,8% (200 px) | fixa | **fluxo** |
  | admin 720×450 (zoom 200% de 1440×900), texto normal | 23,3% | fixa | **fluxo** |
  | aluno ou instrutor 320×568, texto a 200% | 22,6% | fixa | **fluxo** |
  | admin 412×915, texto a 200% | 21,0% | fixa | fixa |
  | admin 320×640, texto a 200%; admin 640×400 | 30,2%; 26,5% | fluxo | fluxo |
  | aluno 390×844, texto normal / a 200% | 6,3% / 15,2% | fixa | fixa |
  | aluno 320×640, texto a 200% | 20,1% | fixa | fixa |

  No fluxo, o cabeçalho segue a regra de sempre: logo e turma numa linha quando cabem (admin 390×844 a 200%), senão a
  turma ganha linha própria (admin 320×640 a 200%); o Sair vem depois do menu, à direita.
- **Rolagem até o foco:** `scroll-padding-block: 12px` na página inteira, para o contorno (3px a 3px de distância) não
  ficar fora da janela quando o navegador rola até um controle.
- **Tablet (761–1100px):** barra lateral de 210px; rótulos longos ("Publicações da turma") quebram em duas linhas.
- **Painel do aluno com texto ampliado:** o botão "Ver minhas atividades" quebra o texto em vez de ser recortado pelo
  resumo.

## Minhas atividades (Expansão 1)

A tela vira um registro: sem painel em volta, alinhada à coluna do título, na fonte do sistema.

- **Topo:** título, linha de atualização sem moldura (a ação "Consultar atualização" à direita no desktop e na coluna
  do texto no celular) e "Como interpretar minhas notas?".
- **Filtros:** tipo e módulo (selects de 44px com linha fina), contagem em texto discreto; situação como controle
  segmentado (o ativo leva o traço ciano por baixo, além do texto em destaque e de `aria-pressed`) e a busca. No
  celular, tipo, módulo e busca empilham na largura toda. Ordem visual = ordem do teclado.
- **Módulos (na ordem dos dados):** cabeçalho em linha com nome, cobertura ("3 de 3 com nota" + régua cinza com
  contorno, a mesma do resumo; se o texto quebra, a régua desce para baixo dele) e marcações "1 sem nota" / "2 para
  revisar" em âmbar com a forma da situação, sem selo.
- **Linhas:** sem caixa, separadas por linha fina; tipo com a marca da série (KC branco, LAB violeta); título; link do
  Canvas (só para atividades liberadas); à direita, nota com visto verde-água quando está na referência, ou "Sugestão
  de revisão" / "Sem nota" em âmbar com a forma; dispensada e não liberada em cinza com traço.
- **Link do Canvas (3.4.1):** quando a linha tem largura (container query na linha, 40rem, que acompanha o texto), o
  link fica numa coluna própria logo depois do título, alinhado à última linha dele e na altura do tipo + título; a
  caixa real de 44 px não cobre nada e a linha não cresce. O título tem no máximo 36rem (~70 caracteres): títulos
  longos quebram ali e o link fica sempre na mesma posição, longe da nota. Linhas estreitas (tablet em 768 px, texto
  ampliado) e o celular continuam com o link na própria linha (3.4). Histórico: a 3.3 subiu o link com margens
  negativas (`1lh`), mas, medido no navegador, a caixa de 44 px cobria o título longo em 29 de 29 linhas (o clique no
  texto do título abria o Canvas em 23) e o contorno de foco saía da linha; a 3.4 voltou à linha própria; a 3.4.1
  recupera a densidade sem sobreposição. Altura das linhas com link, 3.4 → 3.4.1: 1440 px 117,5 → 71,5; 1280 e 1024
  113,4 → 69; títulos longos em 1440 140,6 → 94,6, em 1280 135,2 → 89,2, em 1024 135,2 → 110,9; 768, texto a 200% e
  celular sem mudança.
- **Filtros no celular (3.3):** os seis continuam visíveis, sem rolagem lateral, sem select e sem menu oculto; até
  600 px o recuo lateral de cada filtro é 8 px (era 12 px), e eles cabem em duas linhas a partir de 320 px (eram três
  em 320 px). Fonte e altura de 44 px iguais; com texto ampliado quebram em mais linhas (390 a 200%: quatro).
- **Estados:** carregamento ("Carregando sua turma…") alinhado à esquerda, sem moldura e sem título (o foco da C7.1
  depois da carga continua no `<main>`). Lista vazia em três cenários (3.4), com filtros e busca preservados:

  | Cenário | Texto | Botão |
  |---|---|---|
  | turma sem nenhuma atividade no relatório | "Ainda não há atividades nesta publicação." | nenhum (não resolveria) |
  | filtro sem resultado | "Nenhuma atividade encontrada neste filtro." | "Limpar filtros" |
  | busca sem resultado | "Nenhuma atividade encontrada para “termo”." | "Limpar busca" |
  | busca e filtros sem resultado | "… para “termo” com os filtros selecionados." | "Limpar busca e filtros" |

  O botão diz o que será limpo; a ação é a mesma de antes (`clear-filters`, que volta busca e filtros ao padrão). O
  termo aparece como foi digitado (busca só com espaços também é busca), como texto escapado, e quebra dentro da tela. Erro recuperável com
  a borda de alerta, como no painel, e (3.3) com o título "Minhas atividades" acima dele; turma no topo e no seletor,
  "Tentar novamente" e foco como antes. O relatório é zerado a cada carga (`loadReport`, protegido pela C7.4), então
  os dados anteriores não ficam na tela durante o erro; filtros e busca, sim.

Escopo técnico: seção 31 de `styles.css`, só com `.student-activities` ou `.layout:has(.student-activities)`; o
`<div class="student-activities">` envolve a página e os estados de carregamento e erro dela
(`studentActivitiesState`, que na 3.3 recebe `titled` para o erro). Filtros, busca, agrupamento, links, `data-*`, ids
e handlers continuam os mesmos; os textos novos são os da lista vazia (3.3 e 3.4).

## Meu histórico (Expansão 2)

**Diagnóstico da página original (V3.4.1, capturas com dados sintéticos).** Uma tabela dentro de um painel (no celular,
um cartão por publicação dentro do painel), na fonte de reserva, com cabeçalhos em monoespaçada. Problemas de
apresentação: médias com duas casas (53,75%) enquanto "Meu desempenho" mostra uma (53,8%); a variação longe da média a
que se refere, numa frase ("KCs: -2,5 pontos percentuais · LABs: +24,25 pontos percentuais"), com hífen no lugar do
sinal de menos e "0 pontos percentuais" quando nada mudou; "Anterior" repetido em toda linha; "Ver atividades que
mudaram" fechado sem dizer quantas nem de que tipo; transições cruas ("Com nota 90% → Com nota 80%"); "Primeira
publicação disponível para comparação" justamente na que não tem comparação; datas só numéricas (09/10/2026). Linhas
de 145 px no desktop e cartões de 282 px no celular (7 publicações: 2.682 px de página em 390 px).

**O que o contrato oferece (sem mudança no backend).** `report.history` do aluno: até 12 publicações, mais recentes
primeiro (a em vigor sempre entra, mesmo se for mais antiga), cada uma com `publishedAt`, `current`, `kc`, `lab`,
`total` e `changes` (`backend/changes.py::student_changes`): `null` quando não há versão anterior com as notas do aluno
(primeira publicação, ou o aluno não estava na anterior); senão a variação de KC e LAB em pontos percentuais (`null`
quando um dos lados não tem média), a contagem de "sem nota" antes e depois, as atividades que mudaram (`name`,
`previousState`, `before`, `state`, `after`) e os nomes das removidas. A variação é em relação à versão **que estava
em vigor quando a publicação saiu**, não necessariamente a de baixo na lista: depois de uma restauração elas diferem.
`updateKind` diz se a versão em vigor foi restaurada. Limites funcionais (não resolvidos pela apresentação): a mudança
de uma atividade não traz o tipo (KC/LAB) nem a pontuação; não há motivo ou origem por publicação para o aluno; o
limite de referência antigo não é guardado; publicações sem o aluno não aparecem.

**Direção.** Registro cronológico de consulta, não cartões nem gráfico: uma publicação por item (`<ol>`, título `h2`
por publicação), separadas por linhas finas, sem painel. A data por extenso é o eixo à esquerda; médias e variações em
colunas alinhadas de uma publicação para outra (números tabulares), para a evolução ser lida na vertical; à direita, o
que mudou nas atividades, que abre e fecha. Mesma linguagem das outras telas: KC branco e LAB violeta só na marca do
rótulo, ciano só em ação (o resumo que abre), âmbar e verde-água só em direção de variação, marca de referência
(triângulo) só na versão em vigor.

- **Contexto (uma linha):** "7 publicações, de 28 de agosto a 9 de outubro de 2026. Variações das médias em pontos
  percentuais (p.p.)." (um dia só: "em 9 de outubro de 2026"; anos diferentes: as duas datas com ano). Com 12
  publicações, depois da lista: "O histórico mostra no máximo 12 publicações: as mais recentes e a que está em vigor."
- **Publicação:** "9 de outubro de 2026" e "sexta-feira, 18:03" no fuso do navegador (como o resto do portal; sem dd/mm
  ambíguo e com a hora, que separa duas publicações do mesmo dia). O leitor de tela ouve "Publicação de 9 de outubro de
  2026, sexta-feira, 18:03". "Em vigor" com a marca de referência; depois de uma restauração, "Em vigor · versão
  restaurada", e as publicações mais recentes que ela, "Não está em vigor". Sem rótulo nas demais.
- **Médias:** "Média KC", "Média LAB" e "Sem nota". Médias com uma casa, como "Meu desempenho" (o teste confere que a
  em vigor mostra os mesmos números). Variação do contrato com sinal (menos tipográfico), forma e cor: ▲ verde-água
  "+24,3 p.p.", ▼ âmbar "−2,5 p.p.", traço cinza "sem mudança", texto "sem comparação" (variação `null`) e "sem média"
  (média `null`); o leitor de tela ouve "subiu 24,3 pontos percentuais" ("ponto percentual" abaixo de 2). Uma casa; duas
  quando uma daria zero (+0,04 p.p., nunca "+0" nem "sem mudança"). "Sem nota 2 → 1" ("de 2 para 1"); só a contagem
  quando não mudou; nada quando o contrato não a traz. A variação nunca é calculada entre itens da lista.
- **Mudanças nas atividades:** resumo que diz quantas e de que tipo ("3 mudanças nas atividades" e, embaixo no desktop ou
  depois de dois-pontos na composição estreita, "1 nota registrada · 1 nota caiu · 1 removida da publicação"; um tipo
  só quebra no meio se não couber nem sozinho); a da versão em vigor vem aberta (é o "o que mudou agora", o mesmo de "Meu
  desempenho"), as outras fechadas. Tipos a partir de `previousState/state/before/after`: nota registrada, nota subiu,
  nota caiu, ficou sem nota, atividade liberada, atividade nova, dispensada, deixou de ser dispensada, retirada do
  cálculo, pontuação alterada (situação e nota iguais: pelo backend, só a pontuação máxima mudou) e removida da
  publicação. Cada linha: tipo, nome e transição ("Sem nota → 97%", "90% → 80%"; duas casas se uma esconder a diferença;
  o leitor de tela ouve "para" no lugar da seta). Título e transição na mesma linha quando cabem; senão a transição
  desce, à direita. Sem nada para abrir: "Nenhuma mudança nas suas notas." ou "Sem versão anterior com suas notas para
  comparar."
- **Quedas por liberação:** só na publicação em que uma média caiu e houve atividade liberada (ou nova) sem nota:
  "Atividades liberadas sem nota contam como 0% na média até a nota sair." (a regra de "Como interpretar minhas notas?").
- **Estados:** sem histórico, "As atualizações publicadas aparecerão aqui." (texto de antes), sem moldura; carregamento
  e erro na composição da tela, como em Minhas atividades (erro com o título "Meu histórico", turma, "Tentar novamente"
  e foco como antes).
- **Composições (container query na lista, em rem, que acompanha o texto):** larga a partir de 56rem (1280 e 1440 px):
  data, médias e mudanças numa linha; média a partir de 42rem (1024 px): a data numa linha e, embaixo, médias e
  mudanças lado a lado; estreita (768 px, celular, texto ampliado): data, médias e mudanças empilhadas, resumo corrido.
  Com a coluna da média de pelo menos 10rem (768 px, texto a 200% no desktop), a variação fica ao lado do número.

Densidade (mesmos dados, mesmas condições; publicação fechada, mediana; e onde começa a primeira):

| Janela | Antes | Depois | 1ª publicação antes → depois |
|---|---|---|---|
| 1440×900 | 145 px | 90 px | 409 → 307 px |
| 1280×800 | 139 px | 85 px | 389 → 289 px |
| 1024×768 | 143 px | 115 px | 397 → 286 px |
| 768×1024 | 259 px | 149 px | 455 → 375 px |
| 390×844 | 282 px | 171 px | 526 → 489 px |
| 320×640 | 282 px | 189 px | 585 → 534 px |
| 390×844, texto a 200% | 674 px | 592 px | 1.100 → 1.180 px |
| 1440×900, texto a 200% | 253 px | 303 px | 1.024 → 819 px |

Página com 7 publicações: 1440 1.481 → 1.236 px; 390 2.682 → 2.147 px; 390 a 200% 5.994 → 6.074 px; 1440 a 200%
2.939 → 3.444 px. Com 12: 390 4.144 → 3.032 px.

Escopo técnico: seção 32 de `styles.css`, só com `.student-history` ou `.layout:has(.student-history)` (teste de
arquitetura). A seção 30 passou a valer também para `.student-history` (atualização do Canvas, resumo que abre e
fecha, estados), e o cabeçalho das telas-registro (título, legenda da atualização sem recuo) saiu da 31 para a 30, sob
`:is(.student-activities, .student-history)`: estilo computado e HTML idênticos em Meu desempenho, Minhas atividades e
em todas as outras telas (82 cenários, 13.328 elementos). `pages/history.js` separa o aluno (`studentHistoryPage`,
`studentHistoryState` para carregamento e erro, ligado no `content()` do `app.js`) e o instrutor (`publicationsPage`,
a mesma tabela: HTML e estilo idênticos em 12 cenários de instrutor e admin, 320–1440 px e texto a 200%). Dados,
contrato, `data-*`, handlers e "Restaurar" sem mudança.

## Feedback do aluno (Expansão 3)

**O que existe (contrato atual, sem mudança no backend).** O aluno chega pelo menu (instrutor e admin, pelo link do
rodapé, na mesma página). Formulário: tipo (Bug, Sugestão, Melhoria, Outro — `backend/feedback.py::TYPES`), título
(3 a 120 caracteres depois de juntar espaços) e descrição (10 a 2.000, aparada), todos obrigatórios; vão junto a turma
atual e a tela de onde a pessoa veio (`page`, só os valores aceitos pelo backend). Até 3 imagens PNG, JPEG ou WebP de
até 5 MB, escolhidas antes do envio (prévia local, `ObjectURL`) e enviadas depois que o feedback é criado (slot, S3 por
presigned POST, conclusão); falha parcial oferece "Tentar novamente" (mesmo `clientToken`) ou "Descartar imagens". O
mesmo texto em 10 minutos devolve o feedback existente (`duplicate`); 5 envios por hora (429); conflito de gravação
(409). "Meus feedbacks": 20 por página, "Carregar mais" com cursor; cada item traz `id`, `type`, `title`,
`description`, `status` (Novo, Em análise, Resolvido, Arquivado), `createdAt`, `cohort`, `page`, `updatedAt` e a
contagem de `attachments`; em Novo ou Em análise, com menos de 3, aceita imagem nova pelo próprio item; a galeria pede
um link temporário (5 minutos) por imagem. **Não existe:** resposta ou comentário da equipe, histórico de status para o
aluno (só `updatedAt`, que o backend muda apenas quando o status muda — `feedback.with_status`), edição ou exclusão de
um feedback, remoção de imagem já anexada, filtros ou busca na lista do aluno, total de feedbacks.

**Diagnóstico da página original (Expansão 2 aprovada, capturas com dados sintéticos).** Dois painéis iguais empilhados
na fonte de reserva; em 1440×900 o primeiro feedback começava em 1.007 px, abaixo da primeira tela. Tipos em pílulas sem explicação;
campos de 1.050 px de largura; nenhuma indicação de obrigatoriedade nem das regras (3 e 10 caracteres só apareciam
depois do erro). Validação num aviso solto no canto da tela, um problema por vez ("Escolha o tipo do feedback." com o
título "KC" também inválido), longe do campo e sem marcar o campo. "Sobre: Desempenho" (parece o assunto; é a tela de
origem, com o rótulo curto do admin). Depois do envio, o foco caía no `<body>`; a confirmação aparecia duas vezes
(no formulário e no aviso). Durante o envio só o botão mudava. Lista em cartões com moldura, sem a mensagem enviada,
sem a tela de origem e sem dizer quando a situação mudou; "Novo" em ciano (a cor de ação); datas só numéricas. Em
320 px com texto a 200%, "+ Adicionar imagem" passava 21 px da largura.

**Direção.** Escrever é a tarefa principal; acompanhar e consultar vêm ao lado. Com largura (a partir de 56rem, 1280 e
1440 px), formulário e lista lado a lado e a lista começa na primeira tela; no tablet, no celular e com texto ampliado,
o formulário e depois a lista. O formulário é a única superfície da tela (a mesma do resumo de "Meu desempenho"); abaixo
de 30rem (celular, texto ampliado) ocupa a largura toda, sem moldura. "Meus feedbacks" é um registro sobre o fundo,
separado por linhas finas, como as outras telas do aluno.

- **Novo feedback:** "Tipo, título e descrição são obrigatórios." (e `required` nos campos). Tipos como quatro opções
  com uma linha de explicação cada ("Algo não funciona como deveria." etc.; o rádio do navegador, a caixa inteira
  clicável, a escolha por forma e borda), em duas colunas quando cabem; em coluna estreita (320 px, texto ampliado no
  celular) viram lista simples de rádios, com a explicação na mesma linha do nome. Título e descrição com a regra e os limites antes
  do campo ("de 3 a 120 caracteres", "de 10 a 2.000 caracteres") e a contagem embaixo, ligadas ao campo
  (`aria-describedby`). A descrição começa com quatro linhas e cresce com o texto. Anexos com os textos de antes
  (limites e o aviso de privacidade em âmbar). No rodapé, o que vai junto com o envio ("Junto com o feedback vão a
  turma BRSA0267 e a tela de origem, Minhas atividades.", com o nome do menu do aluno) e a ação principal.
- **Validação junto do campo:** ao enviar com problemas, nada sai; todos os problemas aparecem de uma vez, cada um logo
  abaixo do seu campo, com os textos do handler, marca de alerta (forma), borda do campo, `aria-invalid` e
  `aria-describedby`; o foco vai ao primeiro. O problema some assim que o campo fica válido, sem redesenhar a tela
  (foco e cursor ficam). O handler continua validando antes de enviar (um teste confere, rascunho a rascunho, que as
  duas validações coincidem). Texto do problema na cor do texto: o vermelho do sistema tem 4,48:1 sobre a superfície.
- **Envio:** "Enviando seu feedback…" (`role="status"`), formulário `aria-busy`, botão "Enviando…" parado; um segundo
  envio não sai. Sucesso: "Feedback enviado com sucesso." com um visto, recebe o foco; o novo item aparece no topo da
  lista. Falha parcial das imagens: o foco vai ao "Tentar novamente"; o botão de enviar parado aponta para o aviso que
  explica por quê. Na consolidação, todos os resultados passaram a ficar só no formulário (ver abaixo).
- **Meus feedbacks:** "A situação de cada um é atualizada pela equipe do portal."
  Cada item: título (`h3`); logo abaixo, sempre no mesmo lugar, a situação por texto e forma (anel = Novo; anel com
  metade cheia = Em análise; visto verde-água = Resolvido; traço = Arquivado; nenhuma em ciano), com "desde 9 de outubro
  de 2026" quando a equipe a mudou (o leitor de tela ouve "Situação: Em análise desde …"); tipo, data do envio (o leitor
  de tela ouve "enviado em"), "a partir de Minhas atividades", a turma só quando é outra e a contagem de anexos; a
  mensagem enviada (texto puro, com as quebras de linha; recolhida quando é longa, desde a consolidação). Ações de anexos
  como antes; "Adicionar imagem" parado durante o envio aponta para o andamento.
- **Estados:** carregando, vazio ("Você ainda não enviou feedbacks."), erro na primeira página (com recomeço) e erro no
  "Carregar mais" (os itens ficam; a nova tentativa repete a mesma página), com os papéis de antes.

Medidas (mesmos dados e condições; px; entre parênteses, quantos feedbacks na lista): altura da página, onde começa o
primeiro feedback, onde fica o botão de enviar, altura do formulário (do "Tipo" ao botão) e altura mediana de um feedback.

| Janela (itens) | Página | 1º feedback | Botão de enviar | Formulário | Feedback |
|---|---|---|---|---|---|
| 1440x900 (3) | 1.627 → 1.232 | 1.007 → 244 | 844 → 1.052 | 624 → 823 | 155 → 211 |
| 1440x900 (20) | 4.132 → 3.839 | 1.007 → 244 | 844 → 1.052 | 624 → 823 | 155 → 186 |
| 1280x800 (3) | 1.572 → 1.221 | 972 → 230 | 815 → 1.041 | 609 → 828 | 150 → 201 |
| 1280x800 (20) | 4.005 → 3.782 | 972 → 230 | 815 → 1.041 | 609 → 828 | 150 → 178 |
| 1024x768 (3) | 1.568 → 1.730 | 966 → 1.046 | 808 → 882 | 609 → 672 | 150 → 201 |
| 1024x768 (20) | 4.000 → 4.444 | 966 → 1.046 | 808 → 882 | 609 → 672 | 150 → 178 |
| 768x1024 (3) | 1.627 → 1.859 | 1.026 → 1.176 | 868 → 1.011 | 667 → 805 | 150 → 201 |
| 768x1024 (20) | 4.059 → 4.575 | 1.026 → 1.176 | 868 → 1.011 | 667 → 805 | 150 → 178 |
| 390x844 (3) | 1.845 → 2.158 | 1.136 → 1.295 | 990 → 1.154 | 719 → 874 | 168 → 220 |
| 390x844 (20) | 4.493 → 5.436 | 1.136 → 1.295 | 990 → 1.154 | 719 → 874 | 150 → 196 |
| 320x640 (3) | 1.944 → 2.275 | 1.218 → 1.344 | 1.072 → 1.185 | 770 → 875 | 168 → 243 |
| 320x640 (20) | 4.683 → 5.882 | 1.218 → 1.344 | 1.072 → 1.185 | 770 → 875 | 168 → 196 |
| 1440x900, texto a 200% (3) | 2.624 → 3.606 | 1.738 → 2.293 | 1.459 → 2.030 | 1.035 → 1.603 | 204 → 357 |
| 1440x900, texto a 200% (20) | 6.141 → 8.749 | 1.738 → 2.293 | 1.459 → 2.030 | 1.035 → 1.603 | 204 → 310 |
| 390x844, texto a 200% (3) | 3.342 → 5.175 | 2.099 → 2.977 | 1.916 → 2.651 | 1.345 → 1.940 | 278 → 614 |
| 390x844, texto a 200% (20) | 7.856 → 13.396 | 2.099 → 2.977 | 1.916 → 2.651 | 1.345 → 1.940 | 241 → 463 |

Com largura (1280 e 1440 px) a lista começa na primeira tela e a página fica mais curta que antes. No tablet e no
celular o formulário cresce com as explicações e regras (tipos, limites, o que vai junto) e cada feedback com a mensagem
enviada, que antes não aparecia; com texto a 200% em tela estreita os tipos viram lista simples (de ~770 para ~440 px),
mas a página com 20 feedbacks continua bem mais longa que antes (ver Limitações).

Escopo técnico: seção 33 de `styles.css`, só com `.student-feedback` ou `.layout:has(.student-feedback)` (teste de
arquitetura); a seção 30 passou a dar à tela o cabeçalho das telas do aluno. `pages/feedback.js` separa o aluno
(`studentFeedbackPage`, `studentFeedbackList`, `studentFeedbackEntry`, `feedbackProblems`) da tela de instrutor e admin
(`ownFeedbackPage` e `myFeedbackList`, as de antes); os mesmos ids, `data-*`, handlers e o seletor de arquivos. O
`app.js` ganhou só a composição: a tentativa de envio do aluno (`submitFeedback`), a marca de qual rascunho foi
conferido (`feedbackChecked`, por identidade: outro usuário ou envio concluído começam sem problemas na tela), a
limpeza do problema de um campo quando ele fica válido e, quando o foco chega à descrição pelo Tab, o campo inteiro à
vista (o navegador só rola até o cursor, e a borda de baixo ficava atrás da barra inferior do celular). Na Expansão 3,
`handlers/feedback.js`, `api.js`, `state.js` e a área Feedbacks do admin ficaram sem mudança (o handler ganhou na
consolidação só a opção `inline`, abaixo). Equivalência medida no navegador: HTML, estilo computado de todos os elementos (com
`::before`/`::after`) e foco em 157 cenários (77 das outras telas do aluno, do instrutor e do admin em 320–1440 px, estados e texto a 200%; 72 do Feedback de instrutor e admin pelo rodapé: vazio, problema de validação, preenchido com imagens, sucesso, falha no envio, falha parcial das imagens, galeria, mensagem extensa, lista vazia, erro na lista e texto a 200%; 8 da área Feedbacks: lista e detalhe com galeria), 24.560 elementos, idênticos antes e depois.

## Consolidação da Expansão 3 (Feedback do aluno)

A Expansão 3 foi aprovada como direção oficial; a consolidação resolve três pontos sem redesenhar a tela.

**1. Mensagens longas em "Meus feedbacks".** Uma mensagem com mais de 4 linhas na largura atual mostra as 3 primeiras,
com reticências, e o botão "Ler mensagem completa" (na linha das ações, logo abaixo do texto, antes de "Ver anexos");
aberta, ela aparece inteira, com as quebras de linha, e o botão vira "Recolher mensagem" (`aria-expanded`,
`aria-controls` para o texto). Com até 4 linhas a mensagem aparece inteira e sem botão (esconder uma linha atrás de um
botão de 44 px não economiza nada). A medida é do `app.js`, logo depois de cada render e quando a coluna muda de largura
ou o texto de tamanho (um `ResizeObserver` no título "Meus feedbacks", que acompanha as duas coisas sem mudar com as
mensagens); sem ela, a mensagem aparece inteira, nunca cortada sem botão. Recolhida, o texto inteiro continua no DOM
(leitor de tela, busca, seleção); a situação, a data, a tela de origem e os anexos não se escondem. Recolher no fim de
uma mensagem longa traz o botão de volta à vista; o foco fica nele.
O estado (quais estão abertas) fica no `app.js`, fora do `state.js`: um conjunto de ids por lista de "Meus feedbacks"
(`WeakMap` com a própria lista como chave). Pelo id e não pela posição, "Carregar mais" e a recarga depois de um envio
(o novo item no topo empurra os outros) mantêm cada uma aberta no feedback certo, inclusive com a lista em carregamento
ou com erro no "Carregar mais". Uma lista nova — outro usuário, outra turma, outra tela, a mesma regra C7.4 de
`invalidateReads` — começa toda recolhida; o mesmo id na lista de outra pessoa nunca chega aberto.

**2. Confirmação do envio.** Só no formulário, sem o aviso temporário que a repetia (e que, no celular, cobria o botão de
enviar e a barra inferior). Só aparece depois da resposta do servidor. O envio deduplicado (o mesmo texto em 10 minutos)
diz "Este feedback já tinha sido enviado. Ele não foi registrado de novo e continua em Meus feedbacks." em vez de
"enviado com sucesso": o handler passou a guardar a resposta (`state.feedbackSent` = `"duplicate"` em vez de `true`; a
chave e o valor inicial não mudam), inclusive quando o envio termina pela nova tentativa das imagens ou pela remoção da
que falhou. O foco vai à confirmação, que fica à vista (acima da barra inferior).

**3. Erros no formulário, não só no aviso.** Envio que falhou: o motivo fica junto do botão ("O feedback não foi
enviado." + a mensagem do servidor, para 409, 429 e outros 4xx; "Não foi possível confirmar o envio." para rede e erros
5xx, quando o feedback pode ter chegado, com "Envie de novo: se ele já tiver chegado, não será registrado duas vezes.",
o que o backend garante para o mesmo texto em 10 minutos), com "O que você escreveu continua no formulário.", borda
vermelha e a marca "!"; recebe o foco e o botão aponta para ele (`aria-describedby`). Some durante a nova tentativa e é
trocado pelo resultado; some também ao sair da tela. Arquivo recusado (tipo, tamanho, mais de 3): o motivo fica junto
das imagens (ou no feedback já enviado, quando a imagem era para ele), recebe o foco e sai na próxima escolha ou no
envio. Falha parcial das imagens: diz quantas faltaram e que "o texto não é enviado outra vez"; a nova tentativa usa o
mesmo slot e só reenvia as imagens. Imagem anexada pelo feedback já enviado: "Imagem anexada ao feedback." no próprio
item, para onde o botão aponta. Nenhum resultado do Feedback do aluno vai mais para o aviso temporário.

Estado adicional (justificativa e isolamento): só no `app.js`, como o `feedbackChecked` da Expansão 3, cada um preso ao
que descreve — `feedbackFailure` ao rascunho que saiu, `feedbackPicked` ao rascunho (formulário) ou à lista (feedback já
enviado), `feedbackOpen` à lista. A tela só mostra o que é do rascunho e da lista atuais; um rascunho novo (outro
usuário: `resetForUser`; envio concluído) ou uma lista nova (C7.4) começa sem nada, sem limpeza explícita. Testes de
troca de usuário com envio de A terminando depois da troca, com o mesmo id nas duas listas e com arquivo recusado de A
(C4), além dos de ciclo de vida da C7.5, que continuam iguais.

Handler: `submit`, `addPickedImages` e `retryUploads` ganharam a opção `inline` (o `app.js` passa só para o aluno): com
ela, nenhum aviso temporário e os arquivos recusados voltam para quem chamou; as chamadas e o estado são os mesmos (um
teste roda 12 roteiros com e sem a opção e compara chamadas, estado e avisos). Instrutor e admin continuam no caminho de
sempre, com os avisos. API pública do handler, `configure`, as 5 chamadas de `notice()` e o contrato do `state.js`
inalterados.

Foco: o `render()` devolve o foco perdido ao último controle com nome de um render anterior (regra global, C7.1). Nas
ações do aluno que decidem o foco no fim (envio, imagens, abrir e recolher, Ver anexos), essa memória é limpa antes de
começar: com o título focado durante a carga da lista, "Ver anexos" deixava o foco no título (igual na Expansão 3 e na
tela de instrutor e admin, que não muda nesta rodada). O botão da mensagem não tem `id` para não virar essa memória.

Densidade com 20 feedbacks de tamanhos variados (curtas, médias, com parágrafos e perto de 2.000 caracteres; px):

| Janela | Página E3 → consolidação | Lista | Maior item |
|---|---|---|---|
| 1440x900 | 7.100 → 4.586 (−35%) | 6.686 → 4.172 | 952 → 260 |
| 1024x768 | 6.769 → 5.078 (−25%) | 5.560 → 3.868 | 712 → 224 |
| 768x1024 | 7.411 → 5.260 (−29%) | 6.072 → 3.920 | 852 → 247 |
| 390x844 | 9.094 → 5.984 (−34%) | 7.558 → 4.448 | 1.150 → 309 |
| 320x640 | 10.285 → 6.249 (−39%) | 8.700 → 4.664 | 1.405 → 309 |
| 1440x900, texto a 200% | 15.157 → 9.976 (−34%) | 12.556 → 7.375 | 1.845 → 450 |
| 390x844, texto a 200% | 26.846 → 13.857 (−48%) | 23.419 → 10.430 | 4.066 → 656 |
| 320x568, texto a 200% | 32.242 → 15.175 (−53%) | 28.449 → 11.382 | 5.193 → 656 |

Com as mensagens curtas das capturas da Expansão 3 (uma frase cada) nada muda: nenhuma passa de 4 linhas, exceto duas em
320 px com texto a 200% (15.552 → 15.454 px).

Validação: `tests/student-feedback-outcomes.mjs` (unidade: o handler com e sem `inline`, o duplicado no estado, a troca de
usuário, a marcação da tela) e C1–C10 em `tests/student-feedback-browser.mjs` (mensagens curtas e longas em 320–1440 px,
texto a 200% e mudança do texto sem redimensionar a janela, abrir e recolher, Carregar mais e recarga, troca de usuário,
teclado, rolagem lateral e recortes, confirmação e duplicado, 409, 429, 500 e rede, imagens, foco); F3 e F5 passaram a exigir
o resultado no formulário e nenhum aviso; em `tests/feedback-attachments-browser.mjs`, a verificação do aluno que exigia o
aviso de "até 3 imagens" exige o mesmo texto junto das imagens e nenhum aviso. RED na Expansão 3: os 12 testes de navegador
e o de anexos falham por asserção; 7 dos 11 de unidade falham (os outros 4 são de preservação e passam nos dois lados).
Equivalência no navegador, Expansão 3 × consolidação: HTML, estilo computado de todos os elementos (com `::before`/`::after`,
inclusive os avisos) e foco em 225 cenários, 34.648 elementos, idênticos (77 das outras telas; 140 do Feedback de instrutor
e admin, com os caminhos desta rodada — duplicado, 409, rede, arquivo recusado, nova tentativa, descarte, imagem pelo item
e mensagens de tamanhos variados —, todos com os avisos de sempre; 8 da área Feedbacks). Mutações: 63 de 65 desta rodada
mortas por asserção (as 2 restantes são equivalentes: o `id` no botão da mensagem não pesa mais, porque todas as ações do
aluno limpam a memória de foco; e a recusa de A só chegaria a B por uma troca de usuário sem sair da tela, que o portal
não tem — a troca passa por outra tela, que já limpa); as 57 da Expansão 3, com as âncoras do código atual, as da C7.4
(21) e da C7.5 (37) e as das rodadas visuais anteriores, com os mesmos sobreviventes equivalentes de antes.

## Painel do instrutor (Expansão 4)

**Discovery (o painel antes, capturas com dados sintéticos).** O painel é a página inicial de instrutor e admin
(`teacher()`; o admin vê o mesmo). Respostas às perguntas da rodada:

1. **Tarefas mais frequentes:** depois de cada publicação, ver quem está abaixo da referência; achar quem precisa de
   intervenção (atenção, crítico, atividades sem nota) e abrir o detalhe para lembrar ou acompanhar; procurar um aluno;
   exportar a lista; conferir se a sincronização com o Canvas funcionou; de tempos em tempos, escolher o foco da turma.
2. **Imediato:** de quando são os números (última mudança, última e próxima verificação, falha da sincronização), quantos
   alunos em cada situação e quem são.
3. **Indicadores essenciais:** alunos (ativos, com desistentes à parte), na referência, atenção, crítico. De
   acompanhamento: com atividades sem nota e quem ainda não entrou no portal.
4. **Repetições:** "Painel da BRSA0267" repete a turma do topo e do seletor (mantido: é o título da tela); o subtítulo
   ("As notas chegam do Canvas automaticamente") repetia a linha de atualização (saiu); "Última publicação" na lista
   repetia a linha de atualização (saiu; a versão restaurada continua dita nela); "Com nota (%)" e "Sem nota" são o mesmo
   dado (ficou a contagem; o percentual continua no CSV); a regra "KCs ≥ 70% e Labs ≥ 95%" aparece uma vez.
5. **Atenção acadêmica:** a situação vem do backend (`grades.summary`, sem mudança): na referência (KC e LAB na
   referência), atenção (uma média abaixo), crítico (as duas abaixo), sem avaliação completa (falta uma das médias) e
   graduado. Os cartões contavam só as três primeiras, sem dizer onde ficavam as outras duas.
6. **KC e LAB:** média das atividades liberadas e não dispensadas, sem nota contando 0; referências da turma
   (`thresholds`, 70% e 95% por padrão). O painel só exibe; a decisão é do backend.
7. **Achar um aluno:** busca por nome ou e-mail, sem acento e sem maiúsculas (`normalize`).
8. **Filtros e ordenação:** um filtro por vez (situação, ativos/desistentes, sem e-mail, com atividades sem nota, sem
   portal); ordenação por nome, mais atividades sem nota ou menor média geral (média de KC e LAB, que a tabela não
   mostra); desistentes sempre depois em Todos; CSV com o que está filtrado; os cartões filtravam; busca, filtro e
   ordenação sobrevivem à ida a "Ver por atividade" ou ao detalhe (`teacherFilters`) e à recarga (`avanca.context`).
9. **Foco da turma:** até três atividades liberadas que o aluno vê primeiro, na ordem escolhida, quando estão sem nota
   ou com sugestão de revisão; salvo por `POST /focus-activities` com `expectedCurrent` (publicação) e
   `expectedVersion` (409 se outra pessoa salvou ou se as notas mudaram). Montado pela "Visão por atividade" e por
   "Remover" (rascunho `focusDraft`, até salvar ou recarregar o relatório). Salvar fica parado sem atividades (o
   backend aceitaria uma lista vazia; a regra da tela não mudou).
10. **Ações que mudam estado:** só salvar o foco. As outras leem ou navegam: consultar atualização, filtros, exportar CSV
    (local), lembrete em lote e detalhe (outras telas), atualizar notas (outra tela).
11. **Nova publicação:** o painel não se atualiza sozinho; "Consultar atualização" (ou trocar de turma) zera o relatório
    e mostra o carregamento, sem dados antigos (C7.4: `reportRequest`), e descarta o rascunho do foco. Uma publicação
    pelo Canvas só aparece na consulta seguinte; o foco salvo com uma publicação antiga recebe 409.
12. **Compartilhado com o admin:** o painel inteiro (o admin é instrutor de todas as turmas). Peças comuns a outras
    telas: `heading()`, `updateInfo()` (aluno e "Publicações da turma"), `errorPanel()`, `.panel`, `.button`, tabelas;
    `metric()` e `.metric` ("Notas da turma", detalhe do aluno); `.metric-filter` (área Feedbacks do admin).

Problemas observados: cinco cartões iguais, com o número de "Crítico" em vermelho; "Ainda não entraram" (acesso ao
portal) misturado às situações acadêmicas; o foco escondido num bloco fechado, sem dizer o que está salvo, e "Remover"
fechava o bloco (o "Salvar" sumia); o resultado do salvamento só no aviso temporário (no erro, o foco ia ao `<body>`);
um render no meio do salvamento reabilitava "Salvar"; tabela com cabeçalhos em monoespaçada, médias com até duas casas
(98,13% ao lado de 88%) e "Ver detalhes" com nome acessível "Ver pendências de…"; no celular, cartões com moldura de
211 px por aluno. **Responsividade:** com texto a 200% em 320 px, "Enviar CSV manualmente" e "Salvar foco da turma"
passavam da tela (causa: `.button { white-space: nowrap }` global, a caixa não pode quebrar o texto e fica mais larga que
a coluna de 288 px); e, fora da lista conhecida, com texto a 200% em 1440 px a tabela passava 528 px da tela (a troca
tabela/cartões era por largura da janela, `@media (min-width: 1024px)`, e não acompanhava o texto).

**Direção.** Um instrumento de acompanhamento, não um painel de cartões. O cabeçalho (título, ações, atualização do
Canvas como legenda) diz de quando são os números; a **Situação da turma** é a única superfície da tela; o **Foco da
turma** fica aberto ao lado; a **tabela** é o registro de consulta. Mesma linguagem das telas do aluno: system-ui, KC
branco e LAB violeta só nas réguas em miniatura, ciano só em ação, âmbar para atenção, verde-água para a referência,
linhas finas.

- **Situação da turma:** "Alunos na publicação" (ou "Alunos ativos · N desistentes") e uma régua proporcional dos alunos
  ativos (verde-água na referência, âmbar tracejado em atenção, âmbar cheio em crítico, cinza para os demais; decorativa,
  os números estão no texto). Abaixo, "Médias na referência", "Atenção" e "Crítico", com a regra de cada uma; o que fica
  fora delas é dito com palavras ("Fora dessas situações: 1 sem avaliação completa e 1 graduado."). Separado por linha
  fina, **Acompanhamento**: "Com atividades sem nota" (novo atalho: a contagem do filtro que já existia, ponto de partida
  do lembrete em lote) e "Ainda não entraram". Cada item é um atalho de filtro, como os cartões eram: mesmo `data-filter`,
  `aria-pressed`, rótulo, número e legenda (contrato da C7.2), o número contado com a mesma regra da lista
  (`matchesFilter`), e leva o foco à lista. O filtro em uso leva o traço ciano por baixo.
- **Situação por texto e forma:** visto verde-água (na referência), um anel âmbar (atenção: uma média abaixo), dois
  anéis (crítico: as duas abaixo), traço (sem avaliação completa), visto cinza (graduado). Na tabela, a média abaixo da
  referência leva o mesmo anel e o texto "abaixo da referência de 70%" para a leitura assistiva: o número de anéis da
  situação é o número de médias marcadas. Crítico deixou de ser vermelho (o vermelho fica para erro).
- **Médias:** uma casa, como o aluno vê em "Meu desempenho"; duas quando uma casa mostraria a referência para quem está
  abaixo (94,96% não vira "95%"; um teste varre 4.000 valores por referência). O CSV continua com os valores do backend.
- **Foco da turma:** aberto, com as atividades na ordem em que o aluno as vê (lista numerada), o tipo com a marca da
  série e, de cada uma, quantos alunos estão sem nota e em revisão (do backend). Estado do salvamento na própria seção:
  "Alterações ainda não salvas: os alunos continuam vendo o foco anterior." (o rascunho é outro conjunto ou outra
  ordem), "Salvando o foco da turma…" (`role="status"`, com o foco; Salvar e Remover parados mesmo que a tela seja
  redesenhada), "Foco da BRSA0267 atualizado." (o texto do aviso de antes) e o motivo do servidor como alerta ("O foco não
  foi salvo. …"), com o rascunho mantido. Salvar só é a ação principal quando há algo a salvar. Se a resposta chega com
  outro relatório na tela (consultar atualização, outra turma), o resultado vai para o aviso do portal, como antes. Ao
  remover, o foco fica no Remover que ocupou o lugar (ou em Salvar, ou em escolher atividades).
- **Desempenho dos alunos:** busca, filtro e ordenação com rótulo visível acima do campo ("Buscar aluno", "Filtrar",
  "Ordenar por"; "Menor média geral primeiro" diz o que ordena), "Limpar filtros", "Exportar CSV (N)" e a contagem
  ("3 de 12 alunos"). Tabela com legenda, cabeçalhos de coluna (com a referência: "Média KC · referência 70%") e o nome
  como cabeçalho da linha (papéis explícitos, que continuam valendo quando o CSS empilha a linha); e-mail quebra depois
  do "@"; "Desistente" e "Não entrou no portal" como texto junto do nome, sem selo; "Ver pendências" (o destino é
  "Pendências de …", e o nome acessível continua "Ver pendências de <aluno>").
- **Composição (container query em rem no painel, que acompanha o texto):** tabela a partir de 52rem (1280 e 1440 px),
  com cabeçalho fixo ao rolar e números à direita; abaixo, cada aluno é uma linha empilhada, sem moldura: nome e situação,
  depois as médias, "Sem nota" e a ação (26–52rem: tablet); nome, médias e situação com a ação (até 26rem: celular);
  KC e LAB lado a lado com texto a 200% (até 15rem), com a situação na linha inteira em 320 px a 200% e um valor por
  linha abaixo de 8,5rem. Situação e Foco lado a lado a partir de 56rem. Abaixo de 30rem a Situação da turma perde a
  moldura. Nas linhas empilhadas, o anel da média abaixo fica junto do rótulo.
- **Os dois botões:** a seção 34 deixa os botões do painel quebrarem o texto (`white-space: normal`, `max-width: 100%`),
  com o mesmo alvo de 44 px, o mesmo texto, a mesma semântica, a mesma ordem, o mesmo estado desabilitado e a mesma
  ação. Nenhuma fonte reduzida; nada escondido.
- **Estados:** carregamento ("Carregando sua turma…", sem título, como nas telas do aluno), erro com o título da tela e
  "Tentar novamente", turma sem publicação ("A turma está pronta para começar." sem números vazios), lista vazia que diz
  o que limita ("Nenhum aluno encontrado para “zzz” com o filtro escolhido.") com "Limpar busca e filtros" (a mesma action
  de "Limpar filtros"), falha da sincronização com marca âmbar e o texto inteiro, versão restaurada.

Escopo técnico: seção 34 de `styles.css`, só com `.teacher-home` ou `.layout:has(.teacher-home)` (teste de arquitetura).
`pages/teacher.js` monta a página (`teacherPage(view)`, `teacherHomeState` para carregamento e erro, `averageText`);
`filteredStudents`, `studentsCsv`, filtros, ordenação, CSV, ids (`search`, `status-filter`, `student-sort`,
`students-heading`, `focus-form`) e `data-*` são os de antes. O `app.js` ganhou a composição de carregamento e erro e o
salvamento do foco (`saveFocus`, `focusOutcome` preso ao relatório, `teacherView()`); o pedido e a atualização do foco
são os de antes, e a contagem de `notice()` no `app.js` continua 11 (o aviso do foco virou reserva). `state.js`,
`ui.js`, `api.js`, handlers e backend sem mudança.

Densidade (mesmos dados e condições; px; entre parênteses, quantos alunos): altura da página, onde começa a lista
("Desempenho dos alunos"), onde começa o primeiro aluno e a altura mediana de um aluno.

| Janela (alunos) | Página | Lista | 1º aluno | Aluno |
|---|---|---|---|---|
| 1440x900 (12) | 1.922 → 1.879 | 667 → 635 | 861 → 841 | 75 → 71 |
| 1440x900 (48) | 4.613 → 4.575 | 667 → 635 | 861 → 841 | 75 → 71 |
| 1280x800 (12) | 1.933 → 1.842 | 653 → 640 | 900 → 839 | 73 → 69 |
| 1280x800 (48) | 4.561 → 4.451 | 653 → 640 | 900 → 839 | 73 → 69 |
| 1024x768 (12) | 2.879 → 2.752 | 824 → 887 | 1.067 → 1.090 | 132 → 123 |
| 1024x768 (48) | 7.855 → 7.357 | 824 → 906 | 1.067 → 1.109 | 132 → 123 |
| 768x1024 (12) | 4.067 → 2.865 | 941 → 981 | 1.269 → 1.203 | 211 → 123 |
| 768x1024 (48) | 12.011 → 7.453 | 941 → 982 | 1.269 → 1.204 | 211 → 123 |
| 390x844 (12) | 4.320 → 4.056 | 1.139 → 1.339 | 1.452 → 1.694 | 211 → 175 |
| 390x844 (48) | 12.265 → 10.515 | 1.139 → 1.339 | 1.452 → 1.694 | 211 → 175 |
| 320x640 (12) | 4.526 → 4.115 | 1.345 → 1.398 | 1.658 → 1.752 | 211 → 175 |
| 320x640 (48) | 12.525 → 10.574 | 1.345 → 1.398 | 1.658 → 1.752 | 211 → 175 |
| 1440x900, texto a 200% (12) | 20.723 → 6.551 | 2.123 → 2.050 | 2.783 → 2.599 | 1.420 → 301 |
| 1440x900, texto a 200% (48) | 70.365 → 17.741 | 2.123 → 2.087 | 2.783 → 2.636 | 1.395 → 301 |
| 390x844, texto a 200% (12) | 8.383 → 9.600 | 2.294 → 3.316 | 2.822 → 3.995 | 410 → 438 |
| 390x844, texto a 200% (48) | 23.842 → 25.789 | 2.294 → 3.354 | 2.822 → 4.032 | 410 → 438 |
| 320x568, texto a 200% (12) | 9.034 → 11.643 | 2.832 → 4.012 | 3.360 → 4.723 | 447 → 562 |
| 320x568, texto a 200% (48) | 25.492 → 31.415 | 2.832 → 4.086 | 3.360 → 4.798 | 447 → 562 |

No desktop a lista começa um pouco mais cedo e cada aluno ocupa uma linha mais baixa, mesmo com o Foco da turma aberto
ao lado da Situação da turma. No tablet (768 px) cada aluno cai de 211 para 123 px (linhas empilhadas em duas faixas,
sem cartão). No celular cada aluno cai de 211 para 175 px e a página fica mais curta, mas a lista começa ~200 px mais
abaixo, porque a Situação da turma e o Foco da turma ficam abertos (o atalho "Ver todos os alunos" leva à lista). Com
texto a 200%: no desktop o painel antigo passava 528 px da tela e espremia o nome numa coluna estreita (linhas de 1.420
px); agora não há rolagem lateral e cada aluno ocupa 301 px. No celular a 200% o painel antigo passava 7 a 24 px da tela;
agora cada aluno ocupa 438 px em 390 px (410 antes) e 562 px em 320 px (447 antes, com rolagem lateral), e a lista
começa ~1.000 px mais abaixo (ver Limitações).

Validação: `tests/teacher-home.mjs` (unidade, 8 testes: atalhos com o número do próprio filtro; médias com uma casa sem
cruzar a referência, com varredura de 4.000 valores por referência; situação por texto e forma; quem fica fora das três
situações; estados do Foco da turma; estados vazios; tabela semântica e texto escapado; carregamento e erro) e
`tests/teacher-home-browser.mjs` (navegador, 11: P1 composição em 320–1440 px e texto a 200%; P2 sem rolagem lateral nem
controle ou texto recortado em 14 combinações de janela, texto (até 250%), zoom e janela baixa, com nomes e e-mails
longos e anel com duas casas nas duas médias; P3 os dois botões em 320 px a 200% e 250%; P4 atalhos, busca sem resultado e
filtros que sobrevivem à ida e volta e à recarga; P5 foco pendente, salvando, salvo e com erro, um envio por clique e o
foco no resultado; P5b relatório trocado durante o salvamento; P5c remover do meio; P6 estados; P7 forma, não só cor;
P8 teclado na ordem visual com o contorno lido nos pixels e acima da barra inferior; P9 admin e aluno). Testes existentes
ajustados à decisão, com cada asserção mantida: participação (unidade e navegador: atalhos e linhas), ferramentas do
instrutor, `browser.mjs`, `mobile-ux-browser.mjs`, `rate-limit-browser.mjs` e `student-journey-browser.mjs` (o foco não
fica mais num bloco fechado), `student-home-browser.mjs` (o painel do instrutor na fonte do sistema) e o S3 da casca.
Duas instabilidades do baseline (94/96 local, 95/96 UTC, as duas passando isoladas 4 de 4) foram corrigidas nos testes,
com reprodução determinística: F5 (durante a recarga da lista o botão "Adicionar imagem" some, e o predicado antigo
lançava `TypeError`) e S3 (o título lido depois de recriado pelo render tem estilo vazio). RED na árvore de antes: os 8
de unidade e os 11 de navegador falham por asserção. Equivalência no navegador, antes × depois: HTML, estilo computado de
todos os elementos (com `::before`/`::after`) e foco em 275 cenários, 42.008 elementos, idênticos (67 das outras telas do
aluno, do instrutor e do admin; 140 do Feedback de instrutor e admin pelo rodapé; 8 da área Feedbacks; 60 das telas
abertas a partir do painel — Visão por atividade, com o foco montado ali, Pendências do aluno, Lembretes em lote,
Atualizar notas e Notas da turma, em 320–1440 px e texto a 200%). Mutações: 66 de 66 desta rodada mortas por asserção (na
primeira rodada, 59: três só por tempo esgotado e duas lacunas viraram asserções, uma linha redundante do `saveFocus`
saiu e uma mutação mal desenhada foi trocada); as da C7.4 (21) e da C7.5 (37); as da Expansão 3 (57), da consolidação
(63 de 65, as 2 equivalentes de antes), da Expansão 2 (42, com uma âncora no `app.js` refeita) e das rodadas visuais (V2
12/14, V3 12/12, V3.1 15/16, V3.2 33/33, V3.3 10/10, V3.4 21/21, V3.4.1 9/10, as mesmas equivalentes de antes).

## Publicações da turma (Expansão 5)

**Discovery (a página antes, capturas com dados sintéticos).** A tela é a mesma para instrutor e admin (`teacher()`; o
admin é instrutor de todas as turmas) e divide `pages/history.js` com "Meu histórico" do aluno. O contrato é o de
`backend/portal.py::_report` (instrutor) e `_restore`, sem mudança. Respostas às perguntas da rodada:

1. **Tarefas:** conferir qual versão os alunos estão vendo e de quando ela é; ver o que cada publicação mudou (depois de
   cada sincronização ou envio manual); investigar algo que sumiu (aluno, nota ou atividade removidos, atividade retirada
   do cálculo); voltar a uma versão anterior quando uma publicação saiu errada (restaurar).
2. **Publicações que aparecem:** todos os registros `PUB#` da turma, sem limite, mais recentes primeiro (com a
   sincronização às 6h e às 18h, uma turma passa de 100 publicações). Cada registro traz `id`, `publishedAt`, `filename`,
   `base` (a versão que estava em vigor quando ele saiu; `null` na primeira), `publishedBy` (`system:canvas-sync` na
   sincronização), `createdAt` (do rascunho) e `changes` (as contagens de `changes.change_counts`).
3. **Versão em vigor:** `report.publication.id` (`current` da turma); a tela antiga comparava o id de cada linha com ele.
4. **Atual, anterior e restaurada:** em vigor pelo id; restaurada por `updateKind === "restore"`, que vale só para a versão
   em vigor e só enquanto a última mudança foi a restauração (a restauração seguinte ou uma publicação nova a apaga). Não
   há registro de restaurações passadas por publicação (o `AUDIT` não vem no relatório). A tela antiga chamava de
   "Anterior" todas as outras, inclusive as mais recentes que a em vigor depois de uma restauração.
5. **Datas:** `publishedAt` (a original de cada publicação); `updatedAt` da turma (a última mudança das notas: a data da
   publicação em vigor ou, com `updateKind` de restauração, a hora da restauração); `canvasSync.at` (última verificação);
   a próxima verificação é calculada no frontend (`ui.js::nextCanvasSync`, horários do agendamento do Terraform).
   `createdAt` (rascunho) não aparece.
6. **Indicadores por publicação:** só as contagens de mudança. Médias da turma por publicação não estão no contrato (o
   resumo por aluno fica no S3 e não vem no relatório do instrutor).
7. **Detalhes:** não havia; a tela mostrava cinco contagens numa frase, com os zeros.
8. **Atividades adicionadas, removidas ou modificadas:** a tela antiga só dizia liberadas e retiradas do cálculo. O contrato
   também traz atividades adicionadas e removidas, pontuações máximas alteradas, cadastros de aluno alterados e, a partir de
   26/09/2026, notas novas e removidas (`gradesAdded`, `gradesRemoved`); registros mais antigos podem não ter `changes`.
9. **Restauração:** "Restaurar" em toda publicação fora de vigor → `confirm()` ("Restaurar esta publicação? Os alunos
   passarão a ver as notas desta versão.") → `POST /cohorts/{code}/restore` com `publicationId` e `expectedCurrent` →
   o backend exige instrutor da turma ou admin (403), a publicação (404), `expectedCurrent` igual ao em vigor (409 "A turma
   foi atualizada. Recarregue o histórico.") e as validações atuais de integridade (409 com o motivo); grava `current`,
   `updatedAt`, `updateKind: "restore"` e um `AUDIT` numa transação condicionada (outra gravação no meio: 409 genérico);
   não cria publicação → `boot()` recarrega conta, turmas e relatório → aviso "Publicação restaurada.". Com a
   sincronização ligada, a verificação seguinte publica uma versão nova se o Canvas tiver dados diferentes da restaurada
   (`canvas_sync.run` compara com a versão em vigor).
10. **Publicação manual ou confirmação nesta tela:** não há publicação aqui (fica em Atualizar notas); a única confirmação é
    o `confirm()` da restauração.
11. **Permissões:** a tela e o "Restaurar" dependem de `canTeach` (instrutor da turma ou admin); o backend confere de novo
    (`require(teach)`). Na visualização como aluno o admin vê o histórico do aluno e o clique em `data-restore` é
    bloqueado (`allowedWhileViewing`). Não há outra ação condicionada por perfil.
12. **Estados:** carregando ("Carregando sua turma…", painel genérico), erro (painel sem o título da tela), vazio ("As
    atualizações publicadas aparecerão aqui."), conflito e demais falhas só no aviso temporário.
13. **Atualizações simultâneas:** `expectedCurrent` e a transação condicionada no backend; a tela não se atualiza sozinha
    ("Consultar atualização" recarrega); a carga do relatório é protegida pela C7.4 (`reportRequest`), inclusive na troca
    de turma.
14. **Compartilhado com o admin:** a tela inteira; `updateInfo()` (também do aluno e do painel), `heading()`,
    `errorPanel()`, `date()`; o módulo `history.js` com "Meu histórico".

Separadamente: **consulta** — versão em vigor, datas, origem, contagens por publicação, sincronização e "Consultar
atualização" (leitura); **altera estado** — só "Restaurar"; **autorização** — `canTeach` na tela, `require(teach)` no
backend; **regras temporais** — ordem por `publishedAt`, `updatedAt` como hora da restauração, horários da sincronização
(6h e 18h, Brasília); **dependências** — "Atualizar notas" (publicação manual), a sincronização com o Canvas
(publicação automática), o painel e as telas do aluno (leem a versão em vigor).

Problemas observados (antes): depois de uma restauração, as publicações mais recentes que a em vigor apareciam como
"Anterior", e a restauração só aparecia na linha de atualização, com a data numérica ("Última mudança nas notas:
11/10/2026, 09:10" e "Versão restaurada. Notas originalmente publicadas em 07/10/2026, 18:05."), longe da lista; a
publicação feita depois de uma restauração é comparada com a restaurada, não com a de baixo, e a tela não dizia; uma
frase com as cinco contagens, zeros incluídos, e a primeira publicação como "24 alunos adicionados"; "canvas-api.csv" como
arquivo de toda sincronização; "Restaurar" com moldura em todas as linhas e, no celular, um cartão de 216 px por
publicação; com texto a 200% em 1280 e 1440 px, "Restaurar" ficava fora da área visível da tabela (só rolando a tabela
para o lado) e, com texto a 250% em 320 px, a página tinha rolagem lateral. Na restauração: a pergunta não dizia qual
publicação; durante o envio só o botão clicado parava — um segundo "Restaurar" confirmado mandava outra restauração com a
mesma versão esperada, uma das duas recebia 409 e o aviso final podia dizer "A turma foi atualizada" com uma restauração
feita; erro só no aviso temporário, com o foco no `<body>`; falha de rede como "Failed to fetch"; com outra turma na tela,
"Publicação restaurada." sem dizer de qual turma.

**Direção.** Clareza operacional: primeiro o que vale agora, depois o registro. A **versão em vigor** é a única superfície
da tela (como o resumo do aluno e a Situação da turma); o **histórico** é um registro sobre o fundo, por mês, separado por
linhas finas, com a data como eixo. Mesma família das telas aprovadas: system-ui, ciano só em ação, âmbar só no que pede
atenção, verde-água só na confirmação, a marca de referência (triângulo) só na versão em vigor e o traço em "Não está em
vigor" (a linguagem de "Meu histórico", sem copiar a estrutura dele: aqui não há médias por publicação).

- **Em vigor:** "Em vigor" com a marca (e "· versão restaurada" depois de uma restauração), "Publicação de 10 de outubro
  de 2026" com o dia da semana e a hora, a origem ("Sincronização com o Canvas", ou "Envio manual" com o arquivo — pelo
  `publishedBy`; sem ele, só "Arquivo" e o nome, sem adivinhar), quantos alunos e quantas atividades liberadas (da versão
  em vigor no relatório). Depois de uma restauração: "**Restaurada em 11 de outubro de 2026, 09:10.** A restauração não cria
  uma nova publicação: voltou a valer a versão de 7 de outubro de 2026, com as notas daquela publicação.", quantas
  publicações mais recentes não estão em vigor, com "Ver no histórico" (leva a vista e o foco à publicação em vigor, no meio
  da lista) e, com a sincronização ligada (turma com `autoSync` e curso do Canvas), a consequência: "A atualização
  automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (hoje
  às 18h) publica uma nova versão.". No pé, a sincronização com os textos de sempre e as datas por extenso (sem "Última
  mudança nas notas", que já é a data acima), a falha com a marca âmbar e "Consultar atualização" (a mesma action).
  Abaixo de 30rem (celular, texto ampliado) sem moldura.
- **Histórico:** "13 publicações, de 28 de agosto a 10 de outubro de 2026." e os meses ("Outubro de 2026 · 6 publicações"),
  no fuso do navegador, como as datas. Cada publicação: dia e mês, dia da semana e hora (o leitor de tela ouve "Publicação
  de 10 de outubro de 2026, sábado, 18:04"), "Em vigor" (com fundo discreto) ou "Não está em vigor", a origem e o que mudou
  — só o que o contrato traz e não é zero, numa lista: "21 notas alteradas (2 removidas)", "1 aluno adicionado", "1 aluno
  removido", "1 cadastro alterado", "2 atividades liberadas", "1 atividade retirada do cálculo", "2 atividades adicionadas",
  "1 atividade removida", "1 pontuação máxima alterada". O que tira algo do que os alunos veem (aluno, nota ou atividade
  removidos, atividade retirada do cálculo) leva o anel âmbar. Primeira publicação: "Primeira publicação da turma: 24 alunos
  e 10 atividades, 2 liberadas."; sem nenhuma mudança: "Nenhuma mudança em relação à versão em vigor antes dela."; registro
  sem `changes`: "Comparação indisponível para esta publicação antiga." (o texto de antes); sem `gradesRemoved`, nada sobre
  notas removidas. Quando a versão comparada (`base`) não é a publicação logo abaixo (depois de uma restauração), a tela diz:
  "Em relação à publicação de 7 de outubro de 2026, 18:05, que estava em vigor." Nenhuma conta entre itens da lista.
- **Detalhes:** o contrato por publicação são as contagens, e todas aparecem na própria linha; não há o que abrir e fechar.
- **Restaurar:** na linha, como ação de texto, com o nome da publicação para a leitura assistiva ("Restaurar a publicação
  de 9 de outubro de 2026, 18:04"); nenhum na versão em vigor. A pergunta continua o `confirm()` nativo, agora dizendo
  qual publicação, qual sai de vigor e a consequência da sincronização (abaixo). Durante o envio: "Restaurando a
  publicação de 9 de outubro de 2026, 06:03…" (`role="status"`, com o foco) na publicação, e todos os "Restaurar" da
  turma parados, mesmo que a tela seja redesenhada (um clique num botão velho não envia nada). Sucesso só depois da
  resposta do servidor e da recarga: "Publicação restaurada." na região "Em vigor", com o foco, sem aviso temporário
  repetindo. Falha na própria publicação (`role="alert"`, com o foco): "A publicação não foi restaurada." com o motivo do
  servidor (403, 404, 409); sem resposta ou com erro 5xx, "Não foi possível confirmar a restauração." com "Ela pode ter
  sido concluída: consulte a atualização antes de tentar de novo."; todo 409 e toda dúvida oferecem "Consultar
  atualização". Se a pessoa saiu da tela ou da turma, o resultado vai para o aviso do portal, como antes — com a turma
  quando ela é outra ("Publicação da BRSA0267 restaurada.", "A publicação da BRSA0267 não foi restaurada. …").
- **Estados:** carregando ("Carregando sua turma…", sem título, como as outras telas) e erro com o título da tela e
  "Tentar novamente", na composição da tela; turma sem publicação: "As atualizações publicadas aparecerão aqui." e como a
  primeira chega (pela sincronização, com o horário, ou por um CSV em Atualizar notas).
- **Composição (container query em rem na tela, que acompanha o texto):** a partir de 52rem (1280 e 1440 px), data, origem,
  mudanças e "Restaurar" numa linha; de 36rem (1024 px, desktop com texto ampliado), a data à esquerda, origem e mudanças
  ao lado e a ação à direita; de 28rem (768 px), empilhada, com "Restaurar" à direita das mudanças; abaixo (celular, texto a
  200%), empilhada, com a ação embaixo. Ordem visual = ordem da leitura e do teclado.

Pergunta da restauração, antes e depois (o `confirm()` é o mesmo; muda o texto):

| Antes | Depois |
|---|---|
| Restaurar esta publicação? Os alunos passarão a ver as notas desta versão. | Restaurar a publicação de 9 de outubro de 2026, 06:03?<br><br>Os alunos passarão a ver as notas desta versão. A versão em vigor agora, publicada em 10 de outubro de 2026, 18:04, continua no histórico.<br><br>A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (hoje às 18h) publica uma nova versão. |

Escopo técnico: seção 35 de `styles.css`, só com `.teacher-publications` ou `.layout:has(.teacher-publications)` (teste de
arquitetura). `pages/history.js` monta a tela (`publicationsPage(view)`, `teacherPublicationsState` para carregamento e
erro, `restoreQuestion`); "Meu histórico" do aluno continua o mesmo (o período do contexto virou uma função comum, com o
mesmo texto). O `app.js` ganhou a composição de carregamento e erro e o andamento da restauração (`restorePublication`,
`restoreOutcome` — andamento preso à turma, erro e resultado ao relatório —, `publicationsView()`); o pedido
(`publicationId`, `expectedCurrent`), o `confirm()`, o `boot()` depois da resposta e o aviso de antes ficam, e a contagem
de `notice()` no `app.js` continua 11. `data-restore`, `data-action="refresh-report"`, `state.js`, `ui.js`, `api.js`,
handlers, backend, OpenAPI e infraestrutura sem mudança.

Densidade (mesmos dados e condições; px; entre parênteses, quantas publicações): altura da página, onde aparece qual
publicação está em vigor (antes: a linha "Versão atual" da tabela; depois: a data na região "Em vigor"), onde começa o
histórico e a altura mediana de uma publicação.

| Janela (publicações) | Página | Em vigor | Histórico | Publicação |
|---|---|---|---|---|
| 1440x900 (13) | 1.525 → 1.866 | 401 → 229 | 401 → 553 | 75 → 74 |
| 1440x900 (90) | 7.281 → 7.960 | 401 → 229 | 401 → 553 | 75 → 74 |
| 1440x900 (13, restaurada) | 1.553 → 2.090 | 653 → 229 | 429 → 718 | 75 → 92 |
| 1280x800 (13) | 1.476 → 1.786 | 382 → 215 | 382 → 523 | 73 → 74 |
| 1280x800 (90) | 7.177 → 7.515 | 382 → 215 | 382 → 523 | 73 → 70 |
| 1280x800 (13, restaurada) | 1.502 → 2.000 | 627 → 215 | 408 → 680 | 73 → 87 |
| 1024x768 (13) | 1.591 → 1.943 | 408 → 211 | 408 → 537 | 79 → 76 |
| 1024x768 (90) | 7.674 → 8.130 | 408 → 211 | 408 → 537 | 79 → 76 |
| 1024x768 (13, restaurada) | 1.618 → 2.138 | 671 → 211 | 435 → 695 | 79 → 90 |
| 768x1024 (13) | 3.333 → 2.573 | 472 → 257 | 472 → 642 | 202 → 124 |
| 768x1024 (90) | 19.657 → 12.503 | 472 → 257 | 472 → 642 | 202 → 124 |
| 768x1024 (13, restaurada) | 3.385 → 2.823 | 1.160 → 257 | 524 → 863 | 202 → 126 |
| 390x844 (13) | 3.495 → 3.155 | 493 → 280 | 493 → 695 | 202 → 150 |
| 390x844 (90) | 20.603 → 15.084 | 493 → 280 | 493 → 695 | 216 → 150 |
| 390x844 (13, restaurada) | 3.547 → 3.511 | 1.209 → 280 | 545 → 979 | 202 → 168 |
| 320x640 (13) | 3.695 → 3.392 | 567 → 303 | 567 → 783 | 216 → 173 |
| 320x640 (90) | 21.083 → 15.414 | 567 → 303 | 567 → 783 | 216 → 150 |
| 320x640 (13, restaurada) | 3.771 → 3.773 | 1.321 → 303 | 643 → 1.110 | 216 → 169 |
| 1440x900, texto a 200% (13) | 6.102 → 5.261 | 952 → 460 | 952 → 1.207 | 377 → 255 |
| 1440x900, texto a 200% (90) | 35.163 → 25.653 | 952 → 460 | 952 → 1.207 | 377 → 255 |
| 1440x900, texto a 200% (13, restaurada) | 6.240 → 5.713 | 2.221 → 460 | 1.090 → 1.604 | 377 → 262 |
| 390x844, texto a 200% (13) | 7.030 → 7.839 | 1.070 → 578 | 1.070 → 1.742 | 414 → 377 |
| 390x844, texto a 200% (90) | 40.126 → 34.940 | 1.070 → 578 | 1.070 → 1.703 | 414 → 332 |
| 390x844, texto a 200% (13, restaurada) | 7.226 → 8.805 | 2.538 → 578 | 1.266 → 2.562 | 414 → 414 |
| 320x568, texto a 200% (13) | 7.969 → 8.960 | 1.390 → 862 | 1.390 → 2.161 | 470 → 467 |
| 320x568, texto a 200% (90) | 45.937 → 36.550 | 1.390 → 862 | 1.390 → 2.161 | 470 → 332 |
| 320x568, texto a 200% (13, restaurada) | 8.213 → 10.090 | 3.074 → 898 | 1.634 → 3.147 | 470 → 467 |

A versão em vigor aparece no alto em qualquer janela; antes, depois de uma restauração, ela ficava no meio da tabela (653
px em 1440, 1.321 px em 320, 3.074 px em 320 com texto a 200%). O histórico começa mais abaixo, porque a versão em vigor
vem antes (1440: 401 → 553 px; 390: 493 → 695 px; com versão restaurada, 429 → 718 e 545 → 979 px). Cada publicação:
igual no desktop (75 → 74 px), 202 → 124 px no tablet (768 px) e 202–216 → 150–173 px no celular; com 90 publicações a
página cai de 19.657 para 12.503 px em 768 e de 20.603 para 15.084 px em 390, e cresce cerca de 340 px no desktop (a
região "Em vigor"). Com texto a 200%: em 1440 px, sem rolagem lateral e com "Restaurar" à vista (antes, fora da área da
tabela), publicação 377 → 255 px; no celular a página com versão restaurada cresce (320×568: 8.213 → 10.090 px; ver
Limitações).

Validação: `tests/teacher-publications.mjs` (unidade, 9 testes: versão em vigor pelo id, não pela posição; restauração com as duas datas e a consequência da sincronização só com `autoSync` e curso do Canvas; mudanças só com o que o contrato traz, primeira publicação, sem mudança e registros antigos; comparação com a base dita só quando não é a vizinha; Restaurar com o nome da publicação e parado durante a operação, andamento, erro e resultado; meses e datas; estados; pergunta da restauração e texto escapado; Meu histórico do aluno igual) e `tests/teacher-publications-browser.mjs` (navegador, 13: PB1 composição em 320–1440 px e texto a 200%, com a posição do Restaurar em cada composição; PB2 sem rolagem lateral, sem ação escondida (sem rolar nada para o lado) e sem texto recortado em 14 combinações de janela, texto (até 250%), zoom e janela baixa, com nomes de arquivo extensos e versão restaurada; PB3 vigência, restauração e comparação com a base; PB4 restauração: pergunta, andamento com o foco, todos os Restaurar parados, um envio, sucesso só depois da resposta e da recarga, na própria tela e com o foco, sem desmontar a região; PB4b render no meio; PB5 cancelar; PB6 falhas 409, integridade, 403, 500 e rede; PB7 troca de turma e consulta durante a restauração; PB7b restauração confirmada e recarga com erro; PB8 estados; PB9 teclado com o contorno lido nos pixels e acima da barra inferior; PB10 fuso do navegador; PB11 admin e aluno). Testes existentes ajustados à decisão, com a intenção de cada asserção mantida: arquitetura (a seção 34 termina na 35; testes novos de escopo da seção 35 e das classes antigas), `import-integrity-browser.mjs` (a explicação do bloqueio fica junto da publicação; a lista continua), `mobile-ux-browser.mjs` (Restaurar à vista sem rolar nada para o lado, quebra de linha do arquivo e das mudanças, nomes de 34 a 80 caracteres), H1 de `student-history-browser.mjs` (o instrutor tem a tela dele) e o S3 da casca (Publicações expandida; "Atualizar notas" passou a ser visitada, porque com todas as telas visitadas expandidas a regra de fonte da casca ficava mascarada e a mutação "S3 barra lateral sem a fonte do sistema" da V3 sobrevivia — voltou a 12 de 12). RED na árvore de antes: 8 dos 9 de unidade e os 13 de navegador falham por asserção (o de Meu histórico passa nos dois lados). Equivalência no navegador, antes × depois: HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 325 cenários, 67.132 elementos, idênticos (77 das outras telas do aluno, do instrutor e do admin, inclusive Meu histórico com e sem restauração, vazio, incompleto, com 12 publicações, com erro e texto a 200%; 140 do Feedback de instrutor e admin pelo rodapé; 8 da área Feedbacks; 100 do painel do instrutor e das telas abertas a partir dele, com o painel em 6 estados, inclusive a versão restaurada, e texto a 200%). Mutações: 83 de 83 desta rodada mortas por asserção, nenhuma por tempo esgotado; as da C7.4 (21) e da C7.5 (37); as da Expansão 4 (66), da Expansão 3 (57), da consolidação (63 de 65, as 2 equivalentes de antes), da Expansão 2 (42) e das rodadas visuais (V2 12/14, V3 12/12, V3.1 15/16, V3.2 33/33, V3.3 10/10, V3.4 21/21, V3.4.1 9/10, as mesmas equivalentes de antes). Suítes: unidade 335/335 e navegador 120/120, no fuso local e em UTC.

## Atualizar notas (Expansão 6)

**Discovery (a página antes, capturas com dados sintéticos).** A tela é a mesma para instrutor e admin (`teacher()`); fica
em `pages/import.js`, com o handler `handlers/import.js` (rascunhos por turma, leitura do CSV, prévia e publicação) e a
composição em `app.js`. O contrato é o de `backend/portal.py::_preview` (= `_save_draft` + `_integrity`) e `_publish`, com
`grades.parse_csv`, `changes.snapshot_changes` e `integrity.check`, sem mudança. Respostas às perguntas da rodada:

1. **Finalidade:** publicar as notas da turma a partir do CSV exportado do Canvas (com a linha Points Possible), quando a
   sincronização automática não basta (antes da próxima verificação, ou quando ela falha) ou quando a turma não tem
   sincronização. Os alunos só veem as notas novas depois da publicação.
2. **Ações:** escolher o arquivo; "Conferir arquivo" (gera a prévia); marcar ou desmarcar as atividades liberadas e
   "Atualizar prévia" (nova prévia com `activeIds`); confirmar a remoção de alunos (caixa, quando a prévia remove alguém);
   "Publicar atualização" (com `confirm()`).
3. **CSV ou Canvas:** só o envio manual de CSV. A sincronização com o Canvas é automática (6h e 18h, Brasília;
   `canvas_sync.run`) e não é acionada daqui: a tela só diz se ela está ligada e quando é a próxima verificação.
4. **Só consultam:** escolher o arquivo (lido no navegador; nada é enviado), marcar atividades e a caixa dos removidos (até
   a próxima prévia ou a publicação) e a leitura da versão em vigor (relatório).
5. **Modificam dados:** a conferência grava um rascunho (`DRAFT#`, o CSV e o snapshot no S3, que expiram em 30 dias) sem
   mudar o que os alunos veem; a publicação troca a versão em vigor da turma (`current`) e grava `PUB#` e `AUDIT#` numa
   transação condicionada — a única ação que muda o que os alunos veem.
6. **Ao escolher o arquivo:** `selectCsv` descarta a prévia e o arquivo anteriores; acima de 2.000.000 bytes recusa
   ("Selecione um CSV de até 2 MB."); senão lê o texto (UTF-8) e guarda nome e conteúdo no rascunho da turma, só na
   memória da aba. Se a turma mudou durante a leitura, o arquivo vai para o rascunho da turma de origem.
7. **Validações no frontend:** o tamanho (2 MB), arquivo vazio ou nenhum arquivo ("Selecione um arquivo CSV para
   continuar."), `accept=".csv,text/csv"` (só filtro do seletor) e as pré-condições de Publicar (prévia atual, seleção não
   alterada, sem bloqueio de integridade, removidos confirmados), conferidas de novo no handler.
8. **Validações do backend:** `grades.parse_csv` (UTF-8 até 2 MB; CSV estrito; cabeçalhos Student, ID e SIS Login ID, sem
   repetir; mesmo número de campos em todas as linhas; exatamente uma linha Points Possible; aluno de teste do Canvas
   ignorado com aviso; 1 a 500 alunos; 1 a 200 atividades numeradas KC/Lab com pontuação maior que zero; seleção de
   atividades existente; ID do Canvas numérico e nome; e-mail válido; IDs e e-mails sem repetição; nota até a Points
   Possible; "EX" como dispensa); corpo até 4 MB (413); integridade (matrícula e catálogo do Canvas, tamanho em relação à
   publicação em vigor, nome de arquivo de teste). Na publicação, de novo: prévia da própria conta (404), ainda baseada na
   versão em vigor e não publicada (409), dentro do prazo (409), removidos confirmados (400), ao menos uma atividade
   liberada (400) e a integridade recalculada (409 com o motivo).
9. **Prévia:** existe e é do backend: integridade, o que muda (contagens e listas, até 100 notas alteradas), avisos da
   importação, atividades com a sugestão de liberação (5 notas ou já liberada) e os resultados por aluno.
10. **Confirmação:** `confirm()` "Publicar as notas para 24 alunos da BRSA0267?" antes do pedido e, com alunos removidos,
    a caixa "Conferi e confirmo a remoção desses alunos nesta publicação." (Publicar parado até marcar).
11. **Turma de destino:** `state.code` no momento de cada ação; rascunhos por turma (`saveDraft`/`restoreDraft`) e por
    pessoa; a prévia que chega depois da troca de turma vai para o rascunho da turma de origem; no servidor, o rascunho é
    procurado na turma da URL e só da própria conta (outra turma ou outra conta: 404).
12. **Limites e formato:** 2 MB no navegador (tamanho do arquivo) e no backend (texto UTF-8), 4 MB no corpo; CSV UTF-8
    separado por vírgulas; 1–500 alunos; 1–200 atividades; o nome do arquivo é guardado com até 150 caracteres.
13. **Sucesso, falha, conflito e parcial:** prévia pronta ("Prévia pronta. Confira as atividades e os resultados.");
    publicação concluída (vai ao painel, recarrega e avisa "Atualização publicada. Os alunos já podem consultar."; com outra
    turma na tela, "Atualização publicada na BRSA0267."); falhas: 400 (arquivo ou pré-condição), 403, 404, 413, 429, 5xx e
    rede; conflito: 409 (versão em vigor mudou, prévia já publicada ou expirada, integridade recalculada, gravação
    concorrente). Não há resultado parcial: a publicação é uma transação (tudo ou nada).
14. **Processamento duplicado:** na conferência, `importLoading` e o botão parado; na publicação, só o botão clicado parava.
    No servidor, o rascunho passa a publicado e a transação é condicionada à versão em vigor: a mesma prévia não é
    publicada duas vezes (409).
15. **Assíncrono:** prévia e publicação são pedidos com a resposta como resultado; não há processamento em segundo plano.
    Andamento: "Conferindo…" no botão da conferência; nenhum na publicação.
16. **Troca de turma ou de usuário:** a troca de turma leva ao painel; a prévia atrasada vai para o rascunho de origem; a
    publicação concluída com outra turma na tela avisa com a turma. Na troca de usuário, o boot descarta os rascunhos
    (`resetDraftsForUser`).
17. **Instrutor e admin:** a mesma tela (`canTeach`); o backend exige instrutor da turma ou admin (403). Na visualização
    como aluno a tela não existe. A publicação só aceita a prévia da própria conta.
18. **Manual × automática:** com a sincronização ligada (`autoSync` e curso do Canvas), cada verificação compara os dados
    do Canvas com a versão em vigor e publica uma versão nova se forem diferentes: a publicação manual vale até a próxima
    verificação que encontrar diferença. Uma prévia gerada antes de uma sincronização que publicou fica velha (409).

Separadamente — **comportamento existente:** o descrito acima, mantido (mesmas chamadas, corpos, pré-condições, ids,
`data-action`, rascunhos e avisos). **Limitações do contrato:** a resposta da publicação não diz o que mudou além do
registro; o rascunho do servidor não é listado (a prévia vive só na aba); não há publicação parcial nem fila.
**Problemas de apresentação (antes):** sete painéis de mesmo peso, com o seletor de arquivo numa moldura tracejada dentro de
outra (o "arrastar e soltar" que ela sugere não existe) e uma barra de etapas decorativa (a etapa 3 nunca ficava ativa); o
campo nativo dizia "Nenhum arquivo escolhido" com um arquivo escolhido (o render recria o campo) e o nome aparecia de novo
no rodapé; "Publicar atualização" ficava depois da tabela de todos os alunos (3.891 px numa página de 4.100 em 1440, com 24
alunos); "Atualizar prévia" no topo, a até 3.000 px das atividades; a confirmação dos removidos a 2.850 px do botão, que
ficava parado sem dizer por quê; atividades numa caixa de 340 px com rolagem interna (5 de 12 à vista; no export real, 166
atividades); "máximo 100.00 pontos"; "Mudanças" repetidas na integridade e em "O que muda", com oito grupos fechados,
zeros incluídos; no celular, a situação de cada aluno só rolando a tabela para o lado. **Problemas funcionais
preexistentes:** erros da conferência e da publicação só no aviso temporário (6,5 s), com o foco no `<body>`; falha de rede
como "Failed to fetch", sem dizer que a publicação pode ter acontecido; foco perdido depois da prévia e ao marcar uma
atividade pelo teclado; durante a publicação, seletor, seleção e "Atualizar prévia" livres — um arquivo escolhido nesse meio
era descartado em silêncio, e "Atualizar prévia" reabilitava Publicar com outro rascunho (um segundo pedido saía; o servidor
recusa um dos dois, mas a tela podia mostrar erro e sucesso); uma publicação concluída depois de outra pessoa entrar na aba
apagava o arquivo dela e mostrava o aviso de sucesso; a pergunta dizia "1 alunos". **Corrigidos nesta rodada:** todos esses.
**Encontrado e não corrigido (fora do escopo):** com o seletor do sistema aberto, um redesenho da tela (por exemplo, o
relatório que termina de carregar) troca o campo e a escolha se perde — a tela continua mostrando "Nenhum arquivo
selecionado" (na cópia aprovada, 2 de 3 tentativas perdem a escolha). A correção é a mesma das imagens do Feedback
(seletor fora da área redesenhada) e muda a estrutura do `app.js`: fica proposta. **Para aprovação:** o texto da pergunta
(a mesma confirmação, no mesmo ponto); a confirmação dos removidos junto do botão; Publicar antes dos resultados por aluno;
o andamento e os erros na tela (o aviso do portal só fora dela).

**Direção.** Tarefa operacional, não painel: três etapas na ordem do trabalho — **1 Arquivo do Canvas**, **2 Prévia**,
**3 Publicação** —, numeradas, com o número na margem a partir de 36rem; antes da prévia, a 2 e a 3 dizem em uma linha o
que vem nelas. A única superfície é a da ação seguinte: o arquivo, antes da prévia; a publicação, depois. A prévia é
registro sobre o fundo, em blocos com linhas finas. Mesma família das telas aprovadas: system-ui, ciano só em ação, âmbar no
que pede atenção (anel), vermelho só no erro de verdade (itens críticos e falhas), verde-água só no que foi conferido, as
formas de situação do painel e a marca da série nas atividades (KC branco, LAB violeta).

- **Contexto:** "Em vigor: Publicação de 10/10/2026, 18:04 · Sincronização com o Canvas" (ou "Envio manual" com o arquivo,
  pelo `publishedBy`; "· restaurada em …" depois de uma restauração; "A turma ainda não tem notas publicadas."; carregando e
  erro com "Consultar atualização") e a atualização automática com os textos de antes, ou "Esta turma não tem atualização
  automática pelo Canvas: as notas mudam quando um CSV é publicado aqui.".
- **1 Arquivo do Canvas:** "Escolher arquivo" (o rótulo é o botão; o campo nativo fica fora da vista, no teclado e na
  leitura assistiva, com o contorno de foco no rótulo) e o nome do arquivo uma vez; depois de escolher, "Trocar arquivo".
  A dica com os limites reais: "CSV original exportado do Canvas, com a turma completa · UTF-8, com a linha Points Possible
  · até 2 MB". "Conferir arquivo" com "Conferir não publica: mostra a prévia e o que muda.". Andamento ("Conferindo
  nome.csv…", `role="status"`, com o foco) e erro na própria etapa (`role="alert"`, com o foco e ligado ao campo por
  `aria-describedby`, com `aria-invalid` quando o problema é do arquivo): "grande.csv não passou na conferência. Selecione um
  CSV de até 2 MB.", "vazio.csv está vazio. …", "nome.csv não passou na conferência. O CSV deve conter Student, ID e SIS
  Login ID, separado por vírgulas." (400 e 413), "Não foi possível conferir o arquivo. …" (403, 429, 5xx e rede, esta com
  "A conexão com o portal falhou. Tente de novo."). Nada some sozinho; trocar o arquivo ou conferir de novo limpa o erro.
- **2 Prévia:** de qual arquivo (o nome que o servidor guardou), quantos alunos e quantas atividades liberadas; a prévia
  pronta leva o foco ao título dela. **Integridade:** alunos e atividades encontrados, a data da matrícula, as três
  verificações com forma (visto ou anel) e os itens críticos ("Publicação bloqueada: corrija o arquivo e confira de novo.",
  com os IDs do Canvas) e avisos. **O que muda ao publicar:** "Alunos: 24 → 24. O arquivo substitui a publicação anterior
  por completo."; alunos removidos (com os nomes) e atividades que saem do cálculo em destaque; uma linha por mudança que
  existe ("17 notas alteradas (12 notas novas, 2 removidas)", "1 atividade será liberada"…), com os nomes ao abrir e as notas
  na escala do Canvas ("62,5 → 70"); o que não muda numa linha ("Sem mudança em: …"). **Avisos da importação.** **O que já
  foi liberado?:** "9 de 12 atividades liberadas"; caixa e nome, com o tipo (marca da série), notas preenchidas e a
  pontuação ("máximo 100 pontos"); com mais de 6 atividades sem nenhuma nota (no export real, o curso inteiro), elas
  ficam atrás de "Mostrar as N atividades sem notas preenchidas" (à vista se alguma estiver marcada); o foco fica na caixa ao marcar; "Atualizar prévia"
  logo abaixo.
- **3 Publicação:** "Publicar substitui as notas atuais da turma pelo arquivo completo da BRSA0267.", a consequência da
  sincronização (com ela ligada), a confirmação dos removidos ("Conferi e confirmo a remoção de 1 aluno nesta publicação.",
  o mesmo `#acknowledge-removed`) e, com Publicar parado, o motivo logo acima, ligado ao botão (bloqueio de integridade,
  seleção alterada ou removidos sem confirmação — os textos de antes). Andamento: "Publicando as notas da BRSA0267…"
  (`role="status"`, com o foco) e tudo da turma parado — seletor, atividades, "Atualizar prévia", confirmação e Publicar —,
  mesmo que a tela seja redesenhada. Sucesso como antes (painel, recarga e o aviso). Falha na própria etapa, com o foco:
  "A atualização não foi publicada." com o motivo do servidor (400, 403, 404, 429); com 409, "Esta prévia não pode ser
  publicada." com o motivo e "Consultar atualização" (o servidor usa o 409 para a turma atualizada, a prévia já publicada —
  inclusive por uma tentativa anterior cuja resposta se perdeu —, a expirada e a integridade recalculada); sem resposta ou
  com 5xx, "Não foi possível confirmar a publicação." com "Ela pode ter sido concluída: consulte a versão em vigor antes de
  publicar de novo." e "Consultar atualização" (recarrega o relatório; a versão em vigor aparece no próprio aviso, "Em vigor
  agora: …", e no contexto). O erro fica até a pessoa trocar o arquivo, conferir de novo ou confirmar outra publicação
  (cancelar a pergunta não muda nada) e sai junto com os rascunhos quando outra pessoa entra na aba. Fora da tela, o aviso
  do portal, com a turma quando ela é outra; de outra pessoa que entrou na aba, nada.
- **Conferência dos resultados:** depois das etapas (antes, Publicar vinha depois dela): tabela a partir de 44rem; abaixo,
  cada aluno em duas linhas (nome e situação; médias e "sem nota"), com os papéis de tabela explícitos.
- **Composição (container query em rem, acompanha o texto):** número das etapas na margem a partir de 36rem; atividades em
  duas colunas a partir de 50rem; resultados em tabela a partir de 44rem; abaixo de 30rem (celular, texto ampliado),
  superfícies sem moldura e botões na largura toda.

Pergunta da publicação, antes e depois (o `confirm()` é o mesmo, no mesmo ponto: depois das conferências locais e antes do
pedido; muda o texto):

| Antes | Depois |
|---|---|
| Publicar as notas para 24 alunos da BRSA0267? | Publicar as notas para 24 alunos da BRSA0267?<br><br>Arquivo: 2026-10-11T1450_Notas-BRSA0267.csv<br><br>A publicação substitui a versão em vigor, de 10/10/2026, 18:04. Os alunos passam a ver as notas deste arquivo.<br><br>A atualização automática pelo Canvas continua ligada: se os dados do Canvas forem diferentes desta versão, a próxima verificação (hoje às 18h) publica uma nova versão. |

Com um aluno, "1 aluno" (antes, "1 alunos"); na primeira publicação da turma, "Esta será a primeira publicação da turma.";
sem a sincronização, sem o último parágrafo.

Escopo técnico: seção 36 de `styles.css`, só com `.teacher-import` ou `.layout:has(.teacher-import)` (teste de arquitetura).
`pages/import.js` reescrita (`importPage(view)`); `handlers/import.js` com a pergunta nova, o aviso de início do andamento
(`publish(started)`, chamado depois da confirmação e antes do pedido) e a proteção contra a troca de usuário durante a
publicação (nada do estado de quem entrou muda); `app.js` com a composição: andamento da publicação preso à turma
(`publishing`), o erro da turma até a próxima ação — trocar o arquivo, conferir ou confirmar outra publicação — e descartado
no boot junto com os rascunhos quando outra pessoa entra na aba (`importFailure`), as atividades sem notas à vista por
prévia (`shownUnfilled`), o foco no andamento, na prévia pronta e no erro, e o aviso do portal como reserva. Pedidos e corpos
(`csv`, `filename`, `activeIds`; `draftId`, `acknowledgeRemoved`), pré-condições, rascunhos por turma, ids (`#import-form`,
`#csv-file`, `#acknowledge-removed`, `data-activity`), `data-action="publish"` e os avisos de antes ficam; a contagem de
`notice()` continua 11 no `app.js` e 2 no handler. `state.js`, `ui.js`, `api.js`, os outros handlers e páginas, backend,
OpenAPI e infraestrutura sem mudança.

Densidade (mesmos dados e condições; px; 24 alunos e 12 atividades, salvo indicação): altura da página com a prévia, onde
começa "O que muda ao publicar", onde fica "Publicar atualização", a distância entre os dois e a altura mediana de um aluno
nos resultados.

| Janela | Página | O que muda | Publicar | O que muda → Publicar | Aluno |
|---|---|---|---|---|---|
| 1440x900 | 4.100 → 3.213 | 1.121 → 735 | 3.891 → 1.888 | 2.770 → 1.153 | 59 → 40 |
| 1440x900 (166 atividades) | 4.100 → 3.179 | 1.121 → 735 | 3.891 → 1.855 | 2.770 → 1.120 | 59 → 40 |
| 1280x800 | 3.942 → 3.045 | 1.081 → 694 | 3.740 → 1.791 | 2.659 → 1.097 | 57 → 37 |
| 1024x768 | 4.135 → 3.690 | 1.126 → 736 | 3.928 → 2.193 | 2.802 → 1.457 | 63 → 57 |
| 768x1024 | 4.350 → 4.701 | 1.194 → 834 | 4.129 → 2.355 | 2.935 → 1.521 | 63 → 84 |
| 390x844 | 4.790 → 5.126 | 1.496 → 1.078 | 4.512 → 2.708 | 3.016 → 1.630 | 63 → 84 |
| 390x844 (166 atividades) | 4.790 → 5.037 | 1.496 → 1.078 | 4.512 → 2.618 | 3.016 → 1.540 | 63 → 84 |
| 320x640 | 4.998 → 6.279 | 1.635 → 1.308 | 4.720 → 3.311 | 3.085 → 2.003 | 63 → 107 |
| 1440x900, texto a 200% | 7.092 → 9.379 | 2.133 → 1.820 | 6.708 → 4.793 | 4.575 → 2.973 | 100 → 166 |
| 390x844, texto a 200% | 8.645 → 16.451 | 3.149 → 3.008 | 8.179 → 8.328 | 5.030 → 5.320 | 78 → 288 |
| 320x568, texto a 200% | 9.661 → 20.299 | 3.896 → 3.807 | 9.304 → 9.807 | 5.408 → 6.000 | 78 → 406 |

Validação: `tests/teacher-import.mjs` (unidade, 10 testes: etapas e o arquivo uma vez; contexto e versão em vigor; integridade; o que muda; atividades, com as sem notas atrás de "Mostrar"; publicação, com as mesmas condições de Publicar e o motivo; andamento e erros, inclusive a dúvida, o conflito e a consulta; resultados escapados; a pergunta e o andamento só depois de confirmar; a troca de usuário durante a publicação) e `tests/teacher-import-browser.mjs` (navegador, 15: IB1 composição; IB2 conferir com o foco e um pedido; IB3 erros da conferência na tela e ligados ao campo, sem aviso temporário, e a conferência seguinte sem o erro anterior; IB4 publicar — pergunta, andamento, tudo parado, um pedido, sucesso só depois da resposta; IB5 falhas da publicação, incerta e concluída no servidor, consulta, cancelar a pergunta sem apagar o erro e nenhum erro antigo depois de publicar; IB6 troca de turma; IB7 e IB7b troca de usuário — o erro não passa para quem entra nem volta para quem saiu e, sem troca, fica; IB8 atividades e foco; IB9 removidos; IB10 sem rolagem lateral nem controle escondido em 12 combinações de janela, texto (até 250%), zoom e janela baixa, com nome e mensagem extensos; IB11 teclado com o contorno lido nos pixels; IB12 estados; IB13 papéis; IB14 composição por largura). Testes existentes ajustados à decisão, com a intenção de cada asserção mantida: `import-lifecycle-browser.mjs` (o nome do arquivo ao lado do botão; o motivo do arquivo grande e do vazio e o 409 na tela, sem aviso temporário; a pergunta nova), `import-integrity-browser.mjs` (os mesmos textos, nos blocos novos; "Mudanças" no bloco do que muda), a arquitetura (seção 35 termina na 36; escopo da seção 36; classes antigas) e o S3 da casca (Atualizar notas expandida; Lembretes passou a ser a tela fora do piloto que prova a regra da casca). RED na árvore de antes: os 10 de unidade e os 15 de navegador falham por asserção. Equivalência no navegador, antes × depois: HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 373 cenários, 79.783 elementos, idênticos (77 das outras telas do aluno, do instrutor e do admin; 140 do Feedback de instrutor e admin; 8 da área Feedbacks; 90 do painel e das telas abertas a partir dele; 58 de Publicações da turma, inclusive a restauração em andamento, concluída, em conflito e sem rede). Compactação da seção 36: 74 cenas, 37.529 elementos, estilo idêntico antes e depois. Mutações: 119 de 119 desta rodada mortas por asserção; as anteriores no estado final (ver o relatório). Suítes: unidade 347/347 e navegador 135/135, no fuso local e em UTC.

## Lembretes (Expansão 7)

**Discovery (a jornada antes, capturas com dados sintéticos).** Lembretes não é uma tela só: o menu "Lembretes" abre a do
remetente (`senderPage`); o painel abre "Lembretes em lote" (`batchPage`, pelo filtro "Com atividades sem nota"); e o detalhe do
aluno ("Ver pendências") traz a prévia e o envio individuais (`reminderPreview`, dentro de `pendingPage`). Tudo fica em
`pages/reminders.js` e `handlers/reminders.js`, com a composição no `app.js`. O contrato é o de `backend/portal.py::_reminder_settings`,
`_reminder_flow` e `_reminder_batch` e o de `backend/reminders.py` (`evaluate_recipient`, `reserve_reminder`, `send_reserved_reminder`,
`message_for`, `SESMailer.readiness`), sem mudança. Respostas às perguntas da rodada:

1. **Tarefas:** preparar o remetente (ver se o e-mail institucional pode enviar e, se falta, pedir a verificação ao serviço de
   envio); lembrar um aluno (detalhe → prévia → "Enviar e-mail para este aluno" → situação da entrega); lembrar vários (painel, filtro
   "Com atividades sem nota" → "Enviar lembrete para N alunos" → quem recebe, quem fica de fora e por quê, exemplo da mensagem →
   "Enviar para N alunos" → resultado por aluno).
2. **Só leitura:** a consulta do remetente (`GET reminder-settings`), a prévia individual (`POST pending-preview`), a prévia do lote
   (`POST pending-preview-batch`), "Atualizar status do envio" (uma nova prévia individual) e "Copiar mensagem" (local).
3. **Modificam configurações:** só "Solicitar confirmação do meu e-mail" (`POST verify-sender`): cria a identidade do e-mail no SES
   se ela não existe, e a AWS envia a mensagem de verificação; um novo pedido não reenvia. Nenhuma configuração de turma é editada
   no portal.
4. **Envio manual:** sim, individual (`POST send-reminder`) e em lote (`POST send-reminders`, até 200 alunos).
5. **Prévia antes do envio:** sim. Individual: a mensagem exata (De, Para, Assunto, texto) e o `previewHash`, que o envio confere
   (409 se a mensagem ou as notas mudaram). Lote: a lista com o motivo de quem fica de fora e uma mensagem de exemplo (a do primeiro
   elegível); o envio confere a publicação (`expectedPublicationId`) e avalia cada aluno de novo.
6. **Turma:** `state.code` no momento da ação, na URL (`/cohorts/{code}/…`); no servidor, a publicação em vigor da turma da URL
   (`fixed_publication`).
7. **Instrutor responsável:** quem está na sessão. O remetente (e o "Responder para") é o e-mail da conta, do domínio institucional
   (403 se não for); o servidor exige instrutor da turma ou admin (`require(teach)`). No envio automático (AUTO-5), o remetente vem de
   `REMINDER_SETTINGS.senderUserId` (vínculo `TEACH#`), fora do portal.
8. **Elegíveis:** decididos no servidor (`evaluate_recipient`), na prévia e de novo no envio: na publicação em vigor, não desistente,
   com e-mail no Canvas, com ao menos uma atividade liberada sem nota e sem lembrete registrado nesta publicação (um registro que
   falhou com certeza não conta).
9. **Desistentes (WITHDRAWN):** ficam de fora no lote ("Desistente"), na prévia e no envio; no individual, aviso e envio parado, e o
   servidor recusa (409); a reserva confere a participação na mesma transação; o lote envia só quem a prévia aprovou (C7.2.3).
10. **Atividades pendentes:** as liberadas sem nota da publicação em vigor (`grades.summary`, `state === "pending"`), por nome, KCs e
    LABs separados na mensagem.
11. **Manual × automático:** o portal só envia à mão. O envio automático da AUTO-5 é uma Lambda agendada (terça e sexta às 20h,
    Brasília) para as turmas habilitadas em `REMINDER_SETTINGS`, gravado por operação, sem rota de leitura ou escrita no portal. Os dois
    usam a mesma chave por aluno e publicação (`REMINDER#<publicação>#<aluno>`): quem recebeu pelo automático aparece no lote como
    "Lembrete já registrado nesta publicação" e, no individual, com a situação da entrega. O portal não mostra se a turma tem envio
    automático nem quando é a próxima execução.
12. **Configurações por turma:** nenhuma editável no portal. A identidade do remetente é por pessoa (vale para todas as turmas dela);
    `REMINDERS_ENABLED` é da instalação.
13. **Prontidão:** `SESMailer.readiness(e-mail)` — conta do SES consultável, identidade verificada, acesso de produção e envio
    habilitado — devolve `{ready, reason}`. Com `REMINDERS_ENABLED` desligado, "O envio de lembretes está desativado nesta
    instalação."; fora do domínio institucional, 403. O lote e o individual mostram a prontidão e param o envio; o servidor confere de
    novo (409 com o motivo).
14. **Estados de envio e resultados:** individual — o registro `REMINDER#` (`sending`, `sent`, `failed`, `unknown`) e os eventos do SES
    (`delayed`, `delivered`, `rejected`, `bounced`, `complained`); lote — por aluno, `sent` (aceito pelo serviço de envio), `failed` (o
    lote não diz se a recusa foi certa ou se a resposta se perdeu; o registro guarda `failed` ou `unknown`) e `skipped`, com o motivo
    (`withdrawn`, `no-email`, `no-pending`, `already-sent`, `not-found`, `publication-changed`).
15. **Deduplicação na interface:** no lote, "Lembrete já registrado nesta publicação" (registro que não falhou com certeza: enviado,
    em andamento ou incerto); no individual, o envio para quando já há registro (salvo `failed`) e o servidor recusa (409); no
    frontend, a confirmação, o botão parado durante o envio, só os aprovados no lote e nenhum POST repetido pelo `api.js`. No servidor,
    a reserva condicionada: uma por aluno e publicação.
16. **Instrutor × admin:** as mesmas telas (`canTeach`; o admin é instrutor de todas as turmas); o servidor exige o vínculo e o domínio.
    Na visualização como aluno, as telas não existem.
17. **Publicações e sincronização:** a mensagem e a elegibilidade são da publicação em vigor. Uma publicação nova (manual ou pela
    sincronização) entre a prévia e o envio dá 409 antes de enviar (lote: `expectedPublicationId`; individual: `previewHash`) ou corta
    o lote no meio (o servidor devolve o mesmo motivo, `publication-changed`, para qualquer conflito na reserva: notas atualizadas, outro
    envio para a turma ao mesmo tempo — inclusive o automático — ou a turma alterada); a deduplicação é por publicação: numa publicação nova, todos podem receber de
    novo.
18. **Carregamento, falha e conflito:** remetente — consultando, erro (painel com "Tentar novamente"), ainda não consultado;
    verificação — erro só no aviso temporário; lote — consultando, erro (painel), envio com erro só no aviso temporário (409, 403, 429,
    5xx, rede); individual — carregando, erro, envio com erro no aviso e recarga da prévia.
19. **Troca de turma ou de usuário:** a troca de turma leva ao painel; leituras atrasadas são descartadas (C7.4: pedido, turma, tela e
    pessoa); o resultado atrasado de um envio em lote também (C7.3: pedido da prévia, turma e tela), sem redesenho e sem aviso; o boot
    de outra pessoa invalida as leituras.
20. **Irreversíveis:** os envios (e-mail enviado não volta, e a reserva bloqueia outro lembrete ao aluno nesta publicação, salvo falha
    certa) e a verificação (a AWS envia a mensagem e a identidade fica criada). Marcar desistente, no detalhe, muda métricas e lembretes
    e é reversível (Reativar).

Separadamente — **consulta:** remetente, prévias (individual e do lote), situação da entrega, copiar mensagem. **Configuração:** a
verificação do remetente (por pessoa, no SES). **Prévia:** individual (a mensagem exata) e do lote (destinatários e um exemplo).
**Operação de envio:** individual e em lote. **Resultado ou histórico:** individual, a situação da entrega na publicação; lote, o
resultado por aluno na resposta (não fica guardado; uma nova consulta mostra quem já tem lembrete). Não há histórico de envios no
contrato. **Limitações do contrato:** sem leitura de `REMINDER_SETTINGS`/`automaticEnabled` nem da próxima execução automática; o
`failed` do lote não distingue recusa de dúvida; `sent` é aceito pelo SES, não entrega; sem histórico por turma; `delivery.by` e `at`
(quem e quando) chegam na prévia individual e a tela não os mostra. **Problemas de apresentação (antes):** em Lembretes, um painel só,
os dois botões encostados, a situação só no texto do motivo (sem forma), "Já confirmei · verificar novamente" mesmo com o remetente
pronto e "Para enviar, abra um aluno no painel" (o lote não aparecia); no lote, elegíveis e pulados misturados numa tabela na ordem
da seleção, "Sem nota" em monoespaçada, "Enviar" no fim da página, depois da tabela e da mensagem (2.063 px em 1440 com 18 alunos), no
celular a situação só rolando a tabela para o lado e a barra inferior sobre ela, a prontidão em texto miúdo e o resultado com
"Enviado" (é aceito pelo serviço de envio) e "Falhou" (pode ser dúvida), zeros incluídos. **Problemas funcionais preexistentes:** erros
do envio em lote e da verificação só no aviso temporário (6,5 s), com o foco no `<body>`; "Failed to fetch" na falha de rede, e "Tente
novamente em instantes" num 503 em que o envio pode continuar no servidor; durante o envio, só o botão parado, sem andamento, com o
foco no `<body>`; a pergunta não dizia turma, remetente, que o envio não volta nem quantos ficam de fora. **Corrigidos nesta rodada:**
todos esses.

**Direção.** Uma jornada de comunicação operacional, em duas telas: "Lembretes" é a do remetente e de como enviar; "Lembretes em
lote", a decisão e o envio. A única superfície é a da ação — o remetente numa, o envio na outra —; o resto é registro sobre o fundo,
com linhas finas. Mesma família das telas aprovadas: system-ui, ciano só em ação, verde-água no que está confirmado (remetente
pronto), âmbar no que pede atenção (falta confirmar, sem confirmação do envio, envio interrompido), vermelho só em erro de
verdade.

- **Lembretes:** "Seu remetente": o e-mail, "Os lembretes saem deste e-mail, e as respostas dos alunos chegam nele." e a situação por
  texto e forma — visto verde-água "Pronto para enviar.", anel âmbar "Ainda não é possível enviar.", traço com o envio desativado —
  com o motivo do servidor. Quando falta confirmar: "A confirmação é individual e vale para todas as suas turmas. Ao solicitar pela
  primeira vez, a Amazon Web Services envia uma mensagem de verificação para esse e-mail … Solicitar outra vez não reenvia a
  mensagem.", "Solicitar confirmação do meu e-mail" e "Já confirmei · verificar novamente"; pronto ou desligado, só "Verificar
  novamente". Andamento ("Solicitando a confirmação do seu e-mail…", com o foco e as duas ações paradas) e erro na própria seção ("A
  confirmação não foi solicitada." com o motivo; sem resposta ou com 5xx, "Não foi possível confirmar o pedido." e "Ele pode ter
  chegado: verifique de novo…"). "Como enviar": para um aluno e para vários, com o atalho "Ver alunos com atividades sem nota" (o
  painel no filtro do lote) e "Ir ao painel da turma". "O que vale para todo envio": as regras do servidor (um lembrete por aluno por
  publicação; quem fica de fora; a mensagem montada pelo portal; "aceito" não é entrega; e a frase de antes, "Publicar notas nunca
  dispara lembretes automaticamente.").
- **Lembretes em lote:** "Quem recebe": "17 de 18 alunos vão receber um lembrete agora." (o texto de antes), "A mensagem usa as notas
  da publicação de …" e "Ficam de fora · N", por motivo, numa ordem fixa (lembrete já registrado nesta publicação, desistente, sem
  e-mail no Canvas, sem atividades sem nota, não encontrado nesta publicação; um motivo novo aparece com o código), cada aluno com
  quantas atividades sem nota. "Exemplo de mensagem": De, "Para: o e-mail de cada aluno no Canvas", Assunto e o texto como o aluno
  recebe. "Envio" (a superfície): a prontidão por forma e texto, "De <e-mail>", a consequência ("Ao confirmar, o portal envia agora um
  e-mail para cada um dos 17 alunos da lista. Um e-mail enviado não pode ser desfeito.") e "Enviar para 17 alunos"; sem remetente
  pronto, "Configurar meu remetente" e o motivo, ligado ao botão parado. "Recebem agora · N": a lista, em colunas quando cabem.
- **Envio:** a mesma pergunta, com o texto novo (abaixo). Depois de confirmar, "Enviando lembretes para 17 alunos… O resultado aparece
  aqui. Sair desta tela não cancela o envio." (`role="status"`, com o foco), e Enviar parado mesmo que a tela seja redesenhada.
  Resultado só depois da resposta, com o foco no título, que descreve as quantidades (`aria-describedby`, fechamento): "16 aceitos
  pelo serviço de envio · 1 sem confirmação do envio." (só o que não é zero), "“Aceito pelo serviço de envio” ainda não é a entrega
  na caixa do aluno: a situação de cada um aparece em “Ver pendências”, no painel." e os grupos por desfecho. Sem confirmação: o que
  significa e o que a nova consulta mostra (a recusa certa volta a aparecer para envio; a sem resposta fica registrada); envio
  interrompido por conflito (fechamento): "Envio interrompido por conflito. O servidor encontrou um conflito ao registrar um lembrete
  e parou o envio; este envio não mandou lembrete para N alunos (em “Envio interrompido por conflito”)." e as causas possíveis —
  outro envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma —, sem
  afirmar qual; a nova consulta mostra quem já tem lembrete registrado, inclusive por outro envio, e quem ainda pode receber; com
  qualquer dos dois, "Consultar destinatários de novo".
- **Falhas do envio (na própria seção, com o foco):** 4xx — "Nenhum lembrete foi enviado." e o motivo do servidor (o backend
  valida tudo antes do primeiro aluno, e o 429 vem do API Gateway, antes da Lambda: nada saiu — fechamento); com 409, também
  "Consultar destinatários de novo" (a ação principal; Enviar passa a secundária); sem resposta ou com 5xx — "Não foi possível
  confirmar o envio." e "Parte dos lembretes pode ter sido enviada, e o envio pode continuar no servidor. Antes de enviar de novo,
  consulte os destinatários: quem já tem lembrete registrado nesta publicação fica de fora e não recebe outro.". Enviar de novo
  continua possível (o servidor não repete quem já tem registro); cancelar a pergunta não apaga o erro; a nova tentativa o troca pelo
  andamento.
- **Fora da tela:** a resposta que chega com outra prévia, outra tela ou outra turma não redesenha nem avisa (C7.3), e um lote novo
  começa livre, mesmo com o envio antigo ainda em andamento. A verificação de quem saiu da aba não aparece para quem entrou.
- **Aviso temporário (fechamento):** o resultado do envio e a situação depois da verificação recebem o foco e são anunciados por
  ele; o aviso só aparece quando a pessoa levou o foco a outro lugar durante a operação — "Chegou a resposta do envio em lote.
  Confira o resultado por aluno." e "Chegou a resposta do pedido de confirmação. Confira a situação do seu remetente.", sem afirmar
  o desfecho.
- **Composição (container query em rem, acompanha o texto):** abaixo de 30rem, a superfície sem moldura e os botões na largura toda;
  os dois caminhos lado a lado a partir de 44rem; os nomes em colunas de 17rem quando cabem; palavras e endereços longos quebram onde
  for preciso.

Pergunta do envio em lote, antes e depois (o `confirm()` é o mesmo, no mesmo ponto: depois de calcular os aprovados e antes do
pedido; muda o texto):

| Antes | Depois |
|---|---|
| Enviar lembrete para 17 alunos? | Enviar lembrete para 17 alunos da BRSA0267?<br><br>Cada aluno recebe um e-mail individual com as próprias atividades sem nota, enviado de instrutor@example.test. O envio começa agora e não pode ser desfeito.<br><br>1 aluno selecionado fica de fora; os motivos estão na lista. |

Com um aluno, "1 aluno"; sem ninguém de fora, sem o último parágrafo.

Escopo técnico: seção 37 de `styles.css`, só com `.teacher-reminders` ou `.layout:has(.teacher-reminders)` (teste de arquitetura); a
folha antes dela ficou igual — nada saiu, porque as regras que as duas telas usavam (`.panel`, `.table-scroll`, `.reminder-panel`,
`.email-preview`) servem ao detalhe do aluno e a outras telas. `pages/reminders.js`: `senderPage(view)` e `batchPage(view)` reescritas;
`pendingPage`, `participationPanel`, `studentDetail` e `reminderPreview` sem mudança (impressão digital do HTML em 16 estados, teste
TR10). `handlers/reminders.js`: a pergunta (`batchQuestion`) e o aviso de início (`sendBatch(started)`, chamado depois da confirmação e
antes do pedido); chamadas, corpos, guardas (C7.3 e C7.4) e avisos iguais. `app.js`: as composições `refreshReminderSender`,
`verifyReminderSender`, `recheckReminderBatch` e `sendReminderBatch` (andamento, resultado e foco; o andamento da verificação preso à
pessoa e à turma, o erro à consulta do remetente que está na tela; o envio e o erro presos à prévia do lote), `senderView()` e
`batchView()`. A contagem de `notice()` continua 11 no `app.js` e 4 no handler; `state.js`, `ui.js`, `api.js`, backend, OpenAPI e
infraestrutura sem mudança. O teste de arquitetura passou a fixar as quatro composições (cada uma chama a operação do handler uma vez,
sem API nem estado de Lembretes) no lugar dos quatro wrappers que elas substituíram.

Densidade (mesmos dados e condições; px; o lote dos alunos com atividades sem nota do painel: 18 selecionados numa turma de 30, 37
numa de 59, com lembrete já registrado, desistente marcado depois do painel e sem e-mail entre eles): no lote, a altura da página,
onde aparece quem fica de fora (antes: a primeira linha com motivo na tabela), onde fica "Enviar para N alunos", quantas telas
até ele e a altura mediana de um aluno na lista (antes: a linha da tabela; depois: o nome na lista "Recebem agora"); e a altura da
tela Lembretes com o remetente ainda não confirmado.

| Janela (alunos) | Lote | Quem fica de fora | Enviar | Telas até Enviar | Aluno | Lembretes |
|---|---|---|---|---|---|---|
| 1440x900 (30 alunos) | 2.280 → 2.110 | 535 → 321 | 2.063 → 1.529 | 2,3 → 1,7 | 47 → 41 | 900 → 1.296 |
| 1440x900 (59 alunos) | 3.168 → 2.356 | 722 → 321 | 2.951 → 1.529 | 3,3 → 1,7 | 47 → 41 | 900 → 1.296 |
| 1280x800 (30 alunos) | 2.176 → 1.991 | 509 → 302 | 1.966 → 1.439 | 2,5 → 1,8 | 45 → 39 | 800 → 1.230 |
| 1024x768 (30 alunos) | 2.289 → 2.065 | 537 → 298 | 2.078 → 1.436 | 2,7 → 1,9 | 49 → 39 | 768 → 1.270 |
| 768x1024 (30 alunos) | 2.503 → 2.475 | 595 → 349 | 2.292 → 1.535 | 2,2 → 1,5 | 49 → 39 | 1.024 → 1.423 |
| 390x844 (30 alunos) | 2.905 → 2.769 | 730 → 491 | 2.623 → 1.778 | 3,1 → 2,1 | 49 → 39 | 992 → 1.741 |
| 390x844 (59 alunos) | 3.836 → 3.505 | 926 → 491 | 3.554 → 1.778 | 4,2 → 2,1 | 49 → 39 | 992 → 1.741 |
| 320x640 (30 alunos) | 3.145 → 3.016 | 755 → 491 | 2.863 → 2.006 | 4,5 → 3,1 | 49 → 39 | 1.069 → 1.849 |
| 1440x900, texto a 200% (30 alunos) | 4.808 → 4.911 | 1.218 → 777 | 4.445 → 3.154 | 4,9 → 3,5 | 89 → 77 | 1.457 → 2.818 |
| 390x844, texto a 200% (30 alunos) | 6.350 → 7.792 | 1.333 → 1.069 | 5.876 → 5.148 | 7 → 6,1 | 63 → 114 | 2.200 → 4.493 |
| 320x568, texto a 200% (30 alunos) | 7.475 → 9.396 | 1.724 → 1.352 | 7.110 → 6.260 | 12,5 → 11 | 63 → 158 | 2.533 → 5.556 |

Validação: `tests/teacher-reminders.mjs` (unidade, 10 testes: TR1 o remetente como a única superfície, com a situação por texto e forma e o motivo do servidor; TR2 consultando, erro e ainda não consultado, com textos escapados; TR3 a verificação em andamento e o erro, recusado ou incerto; TR4 os caminhos de envio e as regras; TR5 quem recebe, quem fica de fora por motivo, a mensagem, o envio e a lista, nessa ordem; TR6 Enviar parado sem remetente pronto e durante o envio, a consequência e o caso sem elegíveis; TR7 o erro do envio — recusa, conflito e dúvida; TR8 o resultado — aceito, sem confirmação, interrompido, só o que não é zero; TR9 a pergunta e o aviso de início só depois de confirmar; TR10 o detalhe do aluno igual, por impressão digital do HTML tirada da árvore de antes) e `tests/teacher-reminders-browser.mjs` (navegador, 15: RB1 a situação do remetente com a forma e o atalho para o filtro do lote; RB2 verificação — andamento, um pedido, resultado e erros na tela, com o foco, e a nova consulta; RB3 a composição do lote; RB4 enviar — a pergunta, cancelar, andamento com o foco, um pedido, sucesso só depois da resposta; RB5 falhas — recusa, conflito e dúvida, a nova consulta com o foco, cancelar sem apagar o erro, a nova tentativa; RB6 sem confirmação e envio interrompido, e o que a nova consulta mostra; RB7 troca de turma e de tela durante o envio, com um lote novo aberto enquanto o antigo corre; RB7b troca de usuário durante a verificação; RB8 sem rolagem lateral nem controle escondido em 11 combinações de janela, texto (até 250%), zoom e janela baixa, com e-mail, nomes e mensagem extensos; RB9 teclado com o contorno lido nos pixels, inclusive no andamento e no resultado, e Enviar acima da barra inferior; RB10 estados; RB11 papéis; RB12 composição e cores medidas; RB13 sessão encerrada; RB14 troca de turma e de tela durante a verificação). Testes existentes ajustados à decisão, com a intenção de cada asserção mantida: a arquitetura (as quatro composições no lugar dos quatro wrappers, cada uma chamando a operação do handler uma vez; o roteamento com `senderView()` e `batchView()`; a seção 36 termina na 37; o escopo da seção 37), `participation.mjs`, `participation-browser.mjs`, `handlers.mjs` e `reminders-batch-browser.mjs` (a pergunta nova; os motivos agrupados; o resultado com "aceito"; os erros do envio e da verificação na tela, sem aviso temporário — a C7.3 continua exigindo o mesmo: o erro atual aparece, o botão é liberado e o estado não muda) e a casca (S3: Lembretes expandida, e o Feedback do instrutor passou a ser a tela fora do piloto que prova a regra da casca; S1 espera a carga da tela antes de testar "Pular para o conteúdo" — com a resposta chegando com o foco no link, o render o recria e o foco vai ao `<body>`, regra do `render()` (C7.1), reproduzido de forma determinística nos dois builds; era a falha isolada do S1 no baseline). RED na árvore de antes: 9 dos 10 de unidade (o TR10, de preservação, passa nos dois lados) e 14 dos 15 de navegador falham, todos por asserção, nenhum por tempo esgotado (o RB13, de preservação — a sessão encerrada como antes —, passa nos dois lados). Equivalência no navegador, antes × depois: HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 383 cenários, 85.134 elementos, idênticos (77 das outras telas do aluno, do instrutor e do admin, com Atualizar notas; 140 do Feedback de instrutor e admin; 8 da área Feedbacks; 80 do painel e das telas abertas a partir dele; 58 de Publicações da turma; 20 do detalhe do aluno com a prévia e o envio individuais, em todos os estados da entrega, desistente e remetente não pronto), mais as 76 cenas das capturas de Atualizar notas (38.840 elementos), idênticas. Mutações: 119 de 119 desta rodada mortas por asserção; as anteriores no estado final (ver o relatório). Suítes: unidade 358/358 e navegador 150/150, no fuso local e em UTC.

## Turmas e acessos (Expansão 8)

**Discovery (a tela antes, capturas com dados sintéticos).** Turmas e acessos é uma tela só, do admin: `pages/access.js` e
`handlers/access.js`, com a composição e os formulários de criar turma e de configurações no `app.js`. O contrato é o de
`backend/portal.py` (`/requests`, `/requests/{id}/reject`, `/cohorts` POST, `/cohorts/{code}/instructors` GET e POST,
`revoke-instructor`, `students-search`, `unlink-student`, `display-name`, `settings`, `student-view`), sem mudança. Respostas às
perguntas da rodada:

1. **Propósito:** dar acesso de instrutor às turmas (a partir dos pedidos), tirar esse acesso, cuidar da ligação entre a conta do
   portal e o aluno do Canvas (ver, corrigir o nome de exibição, desfazer, ver o portal como o aluno), configurar a turma
   (referências, curso do Canvas, atualização automática) e criar turmas.
2. **Perfis:** só o admin (grupo `admin` do Cognito, lido do token por `groups_from_claim`). O item do menu só aparece para o admin
   (fora da visualização como aluno), e todas as rotas da tela exigem `require(self.admin)` no servidor (403).
3. **Instrutor:** não vê a tela nem o item do menu. Pede acesso pela tela de primeiro acesso (`POST /access-request`) e vê no seletor
   as turmas que acompanha.
4. **Admin:** consulta todos os pedidos (filtro por situação), os instrutores da turma selecionada e os alunos da publicação em vigor
   (busca, até 25); muda vínculos de instrutor (vincular, recusar, remover acesso), a ligação da conta do aluno (desvincular), o
   nome de exibição, as configurações da turma e cria turmas.
5. **Turmas:** pelo código (letras, números e hífen, 3 a 32, em maiúsculas) e pelo nome; a turma selecionada é a do seletor global
   (`state.code`), e cada operação leva o código na URL. Vincular usa a turma escolhida no próprio pedido, não a do seletor.
6. **Pessoas e turmas:** o instrutor é ligado à turma por um par `TEACH#` (`USER#uid/TEACH#code` e `COHORT#code/TEACH#uid`), criado
   na aprovação, que também marca o pedido como aprovado; o aluno é ligado à conta no primeiro acesso, pelo e-mail do Canvas
   (o vínculo passa a usar o ID do Canvas e a conta confirmada).
7. **Papéis:** admin (grupo do Cognito), instrutor (ter vínculos `TEACH#`) e aluno. Não há outros níveis nem papel por turma além
   do vínculo de instrutor.
8. **Distinção na jornada:** só o admin tem a tela; instrutor e aluno não têm o item nem os controles, e o servidor recusa as rotas.
9. **Só leitura:** `GET /requests`, `GET /cohorts/{code}/instructors`, a busca (`POST students-search`, sem efeito), o filtro e
   Atualizar; "Visualizar como aluno" (`POST student-view`) não muda dados do aluno, mas registra auditoria.
10. **Modificam:** vincular (`POST /cohorts/{code}/instructors`), recusar (`POST /requests/{id}/reject`), remover acesso
    (`POST revoke-instructor`), desvincular a conta (`POST unlink-student`), nome de exibição (`POST display-name`), configurações
    (`POST settings`) e criar turma (`POST /cohorts`).
11. **Criação ou convite de usuários:** não existem. A pessoa cria a própria conta (Cognito) e o instrutor pede acesso.
12. **Concessão e remoção:** sim, por turma: vincular dá acesso de instrutor a uma turma; remover acesso desfaz o par `TEACH#`
    daquela turma. O papel de admin não é concedido nem retirado pelo portal.
13. **Transferência de responsabilidades:** não existe; vincular e remover são independentes.
14. **Estados:** pedido `pending`, `approved` ou `rejected` (com `rejectedAt`); vínculo existe ou não (sem estado intermediário).
    Remover acesso não mexe no pedido, que continua aprovado.
15. **Validações:** no servidor, admin em tudo; pedido existente e do domínio institucional para vincular (400); recusa só de pedido
    pendente (409); remoção só de vínculo existente (404); código e nome válidos e código inexistente para criar (400, 409); busca de
    1 a 100 caracteres, com publicação em vigor (400, 409); nome de 1 a 100 (400); configurações (referências, ID numérico do
    curso, atualização automática só com curso; 400) e conflito de escrita (409). Na tela: `required`, `pattern` e `maxlength`;
    nome só com espaços ("Informe um nome.") e busca vazia, sem pedido.
16. **Confirmações:** o `confirm()` nativo em Recusar, Remover acesso e Desvincular. Vincular, nome, configurações e criar turma não
    perguntam (antes e depois).
17. **Mensagens:** antes, todo sucesso e todo erro no aviso temporário ("Solicitação recusada.", "Acesso removido.", "Instrutor
    vinculado à turma.", "Aluno desvinculado.", "Nome atualizado.", a mensagem do servidor nos erros). Depois: o sucesso continua no
    aviso, agora com a pessoa e a turma; o erro fica na tela, junto do alvo.
18. **Conflitos:** o servidor devolve 404 ou 409 com o motivo; todas as escritas são um `put` ou uma transação, e um 4xx garante que
    nada mudou. Sem resposta (rede) ou 5xx, o resultado é incerto. Antes, tudo virava aviso de erro; depois, recusa e dúvida são
    ditas de jeitos diferentes, e a dúvida e o conflito oferecem a consulta segura.
19. **Busca, filtro e paginação:** filtro das solicitações por situação (na tela); busca de alunos no servidor, com no máximo 25
    resultados e sem paginação; instrutores e solicitações vêm inteiros.
20. **Troca de turma e de sessão:** trocar a turma recarrega instrutores e pedidos e descarta a resposta antiga (C7.4); trocar a
    pessoa relê a conta no boot. Nesta rodada, as operações também ficaram presas à pessoa e à turma em que começaram.
21. **Cognito:** a identidade (e-mail, `sub`), o grupo `admin` e o cadastro e a confirmação da conta.
22. **Aplicação (DynamoDB):** pedidos, vínculos `TEACH#`, a ligação da conta do aluno, o nome de exibição, as configurações, as
    turmas e a auditoria.
23. **O próprio admin:** nenhuma operação muda o papel de admin. Um admin que também tenha vínculo de instrutor aparece na lista e
    pode ter esse vínculo removido; o acesso de admin continua.
24. **Último admin ou instrutor:** não há proteção para o último instrutor de uma turma (os admins continuam com acesso a todas); o
    papel de admin não passa pela tela.
25. **Compartilhado:** `ui.js` (`heading`, `e`, `current`, `plural`, `notice`), `state.js`, `api.js`, o seletor de turma da casca,
    `busy()` e a regra de foco do `render()`, a ação `retry-boot` (também da tela de erro do boot e do primeiro acesso) e a
    visualização como aluno (que volta para Turmas e acessos ou para a área Feedbacks). Estilos genéricos: `.button`, `.text-link`,
    `.page-heading`, `.sr-only`.

**Matriz das operações (o gate de segurança).** A autorização é do servidor; a tela só esconde o que o papel não usa.

| Operação | Papel autorizado (servidor) | Leitura ou escrita | Confirmação | Risco |
|---|---|---|---|---|
| Ver solicitações, filtro | admin | leitura | — | baixo |
| Ver instrutores da turma | admin | leitura | — | baixo |
| Buscar alunos | admin (publicação em vigor) | leitura | — | baixo (dados pessoais na tela) |
| Visualizar como aluno | admin | leitura com auditoria | — | baixo |
| Vincular à turma | admin | escrita (vínculo + pedido aprovado) | não (antes e depois) | alto: dá acesso às notas da turma |
| Recusar solicitação | admin | escrita (pedido recusado) | `confirm()` | médio: a pessoa não consegue pedir de novo |
| Remover acesso | admin | escrita (apaga o vínculo) | `confirm()` | alto: tira o acesso; para os lembretes automáticos se for o remetente (AUTO-5) |
| Desvincular conta do aluno | admin | escrita (ligação + auditoria) | `confirm()` | médio: o aluno perde o acesso até se ligar de novo |
| Nome de exibição | admin | escrita (perfil + auditoria) | não | baixo |
| Configurações da turma | admin | escrita (turma + auditoria) | não | médio: a atualização automática publica sem revisão |
| Criar turma | admin | escrita (turma nova) | não | baixo |

Não houve achado que exigisse mudar permissão, token, Cognito ou regra do servidor.

**Problemas encontrados na tela antiga.** Seis painéis iguais, com o bloco "Como funciona" sem dizer o escopo de cada parte (as
solicitações são do portal inteiro; instrutores, alunos e configurações, só da turma do seletor); a turma com o código só, sem o
nome; Recusar e Remover acesso com a mesma ênfase de consultar; a situação do pedido só por texto pequeno e sem data; a tabela de
alunos rolando para o lado em 1280 px ou menos e com texto ampliado (até 67 controles fora da vista), com a conta do portal e o
e-mail do Canvas em colunas que não diziam a diferença; todo erro no aviso temporário, que some, inclusive o resultado incerto
(rede, 5xx), dito como falha; perguntas sem a pessoa ("Remover o acesso deste instrutor à turma selecionada?"); avisos de sucesso
sem a pessoa e a turma; nenhum andamento junto do alvo, e as outras ações livres durante uma operação. Funcionais: durante a
carga, a página inteira virava o aviso; uma resposta antiga da busca podia sobrescrever a nova (a busca só conferia a turma); a
busca e a carga de quem saiu podiam aparecer para quem entrou na aba; o resultado de uma operação terminada depois da troca de
pessoa recarregava e avisava para quem entrou.

**Direção.** Uma área de administração na linguagem das telas aprovadas, em linhas sobre o fundo, não em cartões: (1) Solicitações
de acesso, com "Portal inteiro" escrito, a pessoa, a situação por texto e forma (anel âmbar: aguardando; visto verde-água:
aprovada; traço: recusada) com a data, e, nas pendentes, a turma escolhida no próprio pedido, Vincular e Recusar; (2) a turma
selecionada como a única superfície, com o código, o nome e o aviso de que o resto vale só para ela — os instrutores dela ("Acompanha
a BRSA0267" e Remover acesso), alunos e contas (busca com rótulo; cada aluno com o ID do Canvas, o e-mail no Canvas e a conta do
portal separados, com desde quando, e as ações) e as configurações; (3) Criar uma turma por último, também "Portal inteiro". As
ações de consequência (Recusar, Remover acesso, Desvincular conta) em vermelho, no texto e na borda, nunca com a ênfase de consultar
ou de conceder. Cada operação mostra o andamento junto do alvo, com o foco; durante ela, tudo que muda algo fica parado, ligado ao
andamento, e uma operação só sai uma vez. O erro fica junto do alvo: a recusa (4xx) diz que nada mudou; a dúvida (rede, 5xx) diz que
o pedido pode ter sido concluído e leva à consulta segura ("Atualizar a lista", "Buscar de novo", "Consultar de novo"), sem nova
tentativa automática. O sucesso só depois da resposta do servidor e da recarga, no aviso do portal, com a pessoa e a turma.

**Isolamento.** O andamento e o erro ficam presos à pessoa (o e-mail da sessão) e à lista em que aconteceram: outra pessoa na aba,
uma recarga ou outra turma começam sem eles. O resultado de uma operação de quem saiu não recarrega, não avisa e não aparece para
quem entrou; terminada com outra turma na tela, a recusa vai para o aviso do portal (com o motivo) e o sucesso diz a turma da
operação. A busca e a carga descartam respostas antigas, de outra turma e de outra pessoa; a busca vazia também descarta a busca
em andamento. Instrutor e aluno não recebem a tela nem nenhum controle, nem pelo contexto salvo.

**Contratos preservados.** As mesmas chamadas, corpos e rotas; os mesmos ids, `data-*` e formulários que o `app.js` liga
(`approve-form`, `#cohort-form`, `#cohort-settings-form`, `#student-search-form`, `data-revoke`, `data-reject`, `data-unlink`,
`data-start-edit-name`, `data-view-as-student`); a mesma pergunta nativa, no mesmo ponto (cancelar não envia nada nem para nada); as
mesmas validações; as chaves de `state.js` (o andamento, o erro e a turma escolhida em cada pedido ficam em variáveis do
`app.js`, presas à pessoa da sessão); a contagem de `notice()`.

## Feedbacks administrativos (Expansão 9)

**Discovery (a tela antes, capturas com dados sintéticos).** A área Feedbacks é uma tela só, do admin: `pages/admin-feedback.js` e
`handlers/admin-feedback.js`, com os anexos pelo handler de Feedback (`loadAttachments`) e "Visualizar como aluno" no `app.js`. O
contrato é o de `backend/portal.py` e `backend/feedback.py` (`GET /admin/feedback`, `POST /admin/feedback/{id}/status`, `GET
/feedback/{id}/attachments` e o link de cada imagem), sem mudança. Respostas às perguntas da rodada:

1. **Perfis:** só o admin (grupo `admin` do Cognito). As duas rotas da área exigem `require(self.admin)` no servidor (403);
   instrutor e aluno enviam feedback e consultam só os próprios (`/feedback`).
2. **Página própria:** sim, a view `admin-feedback`; o detalhe substitui a lista (não há rota por feedback).
3. **Pela casca:** o item "Feedbacks" do menu, só para o admin e fora da visualização como aluno. Antes, o topo dizia a turma do
   seletor ("Turma BRSA0267"), que não filtra nada aqui; agora, "Administração do portal", como em Turmas e acessos.
4. **Dados de cada feedback:** tipo, título (3 a 120), mensagem (10 a 2.000), tela de origem, turma (ou nenhuma), status, envio
   (`createdAt`), a conta que enviou (`sub` e e-mail), o ID do Canvas e a publicação em vigor no envio (quando quem enviou era aluno
   da turma), a última mudança (`updatedAt`, `updatedBy`), o histórico de status (até 20, com o `sub` de quem mudou) e o número de
   anexos; na resposta do admin, o nome atual do aluno na publicação em vigor, se ele ainda está na turma e se dá para visualizar
   como ele.
5. **Autoria:** sim — a conta (e-mail) e, se era aluno da turma no envio, o aluno (nome atual, ou "Fora da turma atual" com o ID do
   Canvas). Instrutor e admin que enviam pelo rodapé não têm vínculo de aluno.
6. **Contexto:** o portal inteiro; cada feedback diz a turma de onde veio (ou nenhuma) e a tela de origem.
7. **Tipos:** Bug, Sugestão, Melhoria, Outro.
8. **Estados:** Novo, Em análise, Resolvido e Arquivado existem no contrato; não há "respondido".
9. **Prioridade:** não existe.
10. **Leitura completa:** sim, no detalhe. A lista antiga não mostrava nada da mensagem.
11. **Responder:** não existe (nem comentário nem e-mail).
12. **Mudar o estado:** sim, com o status esperado (`expectedStatus`; 409 se outra pessoa mudou antes).
13. **Excluir ou arquivar:** não há exclusão; arquivar é o status Arquivado (sai da lista padrão e continua no filtro Status).
14. **Anexos:** até 3 imagens (PNG, JPEG, WebP, até 5 MiB), enviadas por quem escreveu, só enquanto o feedback está Novo ou Em
    análise (409 depois); o admin vê a galeria, com o link temporário (5 minutos) pedido imagem a imagem.
15. **Busca:** não existe.
16. **Filtros:** status (padrão "Todos (sem arquivados)", e "Todos, inclusive arquivados"), tipo e turma, aplicados no backend.
17. **Ordenação:** não existe (do mais novo para o mais antigo, pelo id).
18. **Paginação:** cursor, 50 por página ("Carregar mais").
19. **Data e hora:** do envio e da última mudança (`updatedAt` só muda com o status: `feedback.with_status`; anexar não muda).
20. **Sensível:** o e-mail da conta, o nome do aluno, o ID do Canvas, a mensagem e as imagens (podem trazer dados pessoais). O `sub`
    de quem enviou e de quem mudou o status é interno e não aparece na tela (nem antes nem agora).
21. **Do backend:** a lista filtrada e paginada, o resumo por status do portal inteiro (contadores; não segue os filtros), o nome
    atual do aluno e se dá para visualizar como ele.
22. **Derivado na tela:** o total sem arquivados do resumo, o começo da mensagem, o "desde" do status, "Sem vínculo de aluno" e
    "Fora da turma atual", e os nomes de tipo, status e tela de origem.
23. **Só leitura:** a lista, o resumo, os filtros, o detalhe, os anexos e "Visualizar como aluno" (consulta, com auditoria).
24. **Muda algo:** só a mudança de status.
25. **Erros previstos:** 400 (status inválido), 403 (não é admin), 404 (feedback não encontrado), 409 (alterado por outra pessoa),
    429 (limite), 5xx e rede. Nada é repetido sozinho: o `api.js` só repete GET, e só em 429.
26. **Mensagens extensas:** texto puro com as quebras de linha (`pre-wrap`), quebrando palavras longas; antes, só no detalhe.
27. **Troca de usuário:** o boot relê a conta e `resetForUser` troca a fila, os filtros e a seleção (C7.5).
28. **Resposta fora de ordem:** a lista descarta respostas antigas (contador de pedidos, C7.4); o 409 relê a primeira página em
    silêncio.
29. **Compartilhado com o Feedback do aluno:** `feedbackTypes`, `feedbackStatuses`, `originLabel`, `statusBadge` e
    `attachmentGallery` (`pages/feedback.js`), `loadAttachments` (`handlers/feedback.js`) e as regras das seções 25 e 26 (`.fb-*`,
    `.feedback-*`), que também servem ao Feedback de instrutor e admin pelo rodapé. Nada disso mudou.
30. **Compartilhado com outras telas do admin:** `busy()`, a regra de foco do `render()`, a visualização como aluno (que volta para
    cá ou para Turmas e acessos), `heading` e `notice`; e o padrão das operações da Expansão 8 (andamento e erro junto do alvo,
    recusa × dúvida, consulta segura), reaproveitado aqui.

**Classificação.** Existentes: lista, resumo, três filtros, paginação, detalhe com anexos, mudança de status e "Visualizar como
aluno". Contratos e permissões: as rotas de admin (403 para os outros papéis), `expectedStatus`, o resumo global, o link
temporário das imagens. Leitura: tudo, menos a mudança de status (a única escrita). Problemas de UX e funcionais preexistentes:
abaixo. Limitações do backend: sem resposta ao autor, sem busca, ordenação ou prioridade, histórico com o `sub` (sem e-mail) de quem
mudou, resumo sem os filtros. Melhorias só no frontend: as desta rodada. Propostas que exigem aprovação: no fim da seção.

**Matriz de permissões e contratos.** A autorização é do servidor; a tela só esconde o que o papel não usa.

| Operação | Papel autorizado (servidor) | Leitura ou escrita | Confirmação | Risco |
|---|---|---|---|---|
| Ver a lista, o resumo, os filtros, Carregar mais | admin | leitura | — | baixo (dados pessoais na tela) |
| Ver o detalhe e os anexos | admin (ou quem escreveu, só os próprios) | leitura | — | baixo (imagens com link de 5 minutos) |
| Visualizar como aluno | admin | leitura com auditoria | — | baixo |
| Mudar o status | admin | escrita (status, histórico e contadores numa transação) | não (antes e depois) | baixo: reversível pela tela; quem enviou vê o status, e com Resolvido ou Arquivado não anexa mais imagens |

Nenhum achado exigiu mudar permissão, token, Cognito, regra do servidor, contrato de feedback, armazenamento ou retenção.

**Problemas encontrados na tela antiga.** O topo dizia a turma do seletor numa área do portal inteiro. O resumo eram quatro cartões
de métrica (o vocabulário de painel), sem os arquivados, ao lado dos filtros de tipo e turma, como se fossem os números do filtro
(são do portal inteiro). A lista eram cartões-botão sem nada da mensagem: para triar, era preciso abrir um por um. O status era
uma pílula colorida (ciano para Novo, âmbar para Em análise: a cor de ação e a de atenção em estados que não são nem uma nem outra).
"Aluno: —" para quem não era aluno. O erro da mudança de status, inclusive o resultado incerto (rede, 5xx), só no aviso temporário,
que some; nenhum andamento junto da ação. Durante a carga, o resumo mostrava zeros. Funcionais: o seletor de status voltava ao
status atual quando a tela era refeita (o fim da carga das imagens, o andamento), e "Salvar status" com o status atual não fazia
nada, sem dizer; o aviso de sucesso de uma mudança de quem saiu aparecia para quem entrou na aba (e o 409 relia a lista em nome
dela); depois de um clique num atalho do resumo, o foco ia para o `<body>`.

**Direção.** Uma caixa de entrada na linguagem das telas aprovadas, em linhas sobre o fundo, não em cartões nem num painel de
métricas. No topo, o título com o escopo ("de todas as turmas") e, juntos, o resumo do portal inteiro — uma fileira de atalhos com
o nome e o número ("No portal inteiro": Todos (sem arquivados), Novos, Em análise, Resolvidos, Arquivados), o ativo com o traço
ciano por baixo e `aria-pressed`, como os atalhos do Painel do instrutor — e os três filtros do contrato, com rótulo acima. Cada
linha: o título, que é o botão que abre o feedback (a linha inteira é o alvo); o status por texto e forma, as do Feedback do aluno
(anel: Novo; anel meio cheio: Em análise; visto verde-água: Resolvido; traço: Arquivado), sem pílula; tipo, turma (ou "Sem turma"),
quem enviou, quando e os anexos; e o começo da mensagem em até duas linhas. No detalhe, que substitui a lista como antes: voltar;
tipo e quando (com a hora); o título; o status, "desde" quando mudou; a mensagem inteira; os anexos; "Detalhes do envio" (Aluno —
o nome, "Fora da turma atual" com o ID do Canvas ou "Sem vínculo de aluno" —, e-mail, turma, página de origem, publicação) com
"Visualizar como aluno"; e "Mudar o status", a única superfície, com a consequência dita ("Quem enviou vê o status no próprio
feedback e só pode anexar imagens enquanto ele está Novo ou Em análise. Os arquivados saem da lista padrão e continuam no filtro
Status."). Com largura (container de 52rem ou mais), a mensagem à esquerda e os dados do envio e a mudança de status ao lado; na
coluna estreita, tudo empilhado e a superfície sem moldura. Nada de resposta, prioridade, busca ou ordenação: o contrato não tem.

**A mudança de status.** O seletor começa no status atual e "Salvar status" fica parado, com o motivo à vista e ligado a ele
("Escolha outro status para salvar."), até outra escolha; a escolha de cada feedback fica quando a tela é refeita (presa ao item
como a lista o trouxe: a lista relida e outra pessoa começam sem ela). Salvar manda um pedido só, com o status esperado; o
andamento ("Mudando o status para Resolvido…", `role="status"`) fica junto da ação, com o foco, e o seletor e Salvar ficam parados,
ligados a ele — em qualquer feedback aberto: com outro aberto, o andamento diz qual ("Mudando o status de “…” para …"). Uma mudança
por vez; o botão parado não é a única proteção (clique duplo ou forçado não manda outro pedido). O sucesso só com a resposta, no
aviso do portal, como antes, e o foco volta ao seletor. O erro fica junto da ação, com o foco e `role="alert"`: a recusa (400, 403,
404, 409, 429) diz que o status não foi alterado, com a mensagem do servidor; a dúvida (rede, 5xx, resposta perdida) diz que não foi
possível confirmar e que o pedido pode ter sido concluído. A dúvida, o 404 e o 409 levam a "Atualizar a lista" (a consulta segura:
de volta à lista, relida com os filtros, e o foco na linha do feedback ou, se ele saiu da lista, no título da página); o 409
continua relendo a lista em silêncio antes de dizer o erro (C7.5), e o detalhe passa a mostrar o status do servidor. Nenhuma nova
tentativa automática. Com o detalhe já fechado (a pessoa voltou à lista) ou outra tela, a falha vai para o aviso do portal, como
antes.

**Conteúdo extenso e não confiável.** Título, mensagem, nome e e-mail sempre como texto (`e()`); HTML, `<script>`, Markdown e links
aparecem literais (nenhum elemento criado, nenhum link montado). O começo da mensagem junta as quebras de linha num espaço e corta
numa palavra até 180 caracteres, com reticências — contando por caractere (um emoji não é partido) e, sem espaço onde cortar, no
limite —, e fica em até duas linhas na tela; a mensagem inteira está no detalhe, a um clique. Palavras e endereços longos quebram
sem rolagem lateral. Mensagem vazia não deixa linha vazia; data inválida não vira texto ("Invalid Date").

**Estados assíncronos e isolamento.** A carga, o erro da lista com "Tentar novamente", a caixa vazia ("Nenhum feedback recebido até
agora." ou, só com arquivados, "Nenhum feedback fora os arquivados.") e o filtro sem resultado ("Nenhum feedback neste filtro.")
são ditos de jeitos diferentes; durante a carga, o resumo não mostra números. O erro de "Carregar mais" mantém os itens e repete a
mesma página (C7.5); sem mais páginas, o foco vai ao primeiro feedback que chegou. A lista de um filtro anterior que chega depois
não substitui a do atual (C7.4). O andamento e o erro ficam presos à pessoa da sessão: o resultado de uma mudança de quem saiu não
muda a tela, não avisa e não relê a lista para quem entrou.

**Contratos preservados.** As mesmas chamadas, corpos e rotas; os mesmos ids e `data-*` que o `app.js` liga (`data-fb-open`,
`data-fb-back`, `data-fb-status`, `data-fb-save`, `data-fb-view-as`, `#fb-filter-*`, `#fb-status-select`, `#fb-detail-title`,
`admin-feedback-retry`, `admin-feedback-more`); as classes que os testes antigos e as regras compartilhadas usam no detalhe
(`fb-detail`, `fb-title`, `fb-description`, `fb-facts`, `fb-detail-attachments`, `fb-status`, `fb-open`, `fb-more`); mudar o
status continua sem pergunta; as chaves de `state.js` (o andamento, o erro e a escolha ficam em variáveis do `app.js`); a contagem
de `notice()`; e o Feedback do aluno e o de instrutor e admin pelo rodapé, sem nenhuma mudança.

## Consolidação transversal final (depois da Expansão 9)

Com as Expansões 1 a 9 (e a 8.1) aprovadas, uma rodada sobre o conjunto: auditar o sistema visual, o CSS, os componentes, o foco,
as notificações e a responsividade; remover só o que é comprovadamente morto ou sempre vencido na cascata (categorias A e B), sem
mudar nada na tela; e deixar o resto proposto, com evidência (C: mudança visual; D: mudança arquitetural ou funcional; E: manter).
Backend, OpenAPI, infraestrutura, contratos, `state.js`, a contagem de `notice()` e as regras de autorização, publicação,
deduplicação e feedback não mudaram. Os registros da rodada (baseline congelado com somas, auditoria, ferramentas, logs e
relatórios) ficam fora do repositório, em `~/Developer/escola-da-nuvem/consolidacao-visual/`.

**O que foi medido.** 17 telas e estados — as dez do piloto, o detalhe do aluno, Visão por atividade, Notas da turma, o Feedback
pelo rodapé e a entrada pública — em 10 configurações (1440, 1280, 1024, 768, 390 e 320 px; texto a 200% em 390 e em 1440; zoom
200%; janela baixa): o estilo computado das peças equivalentes, as cores usadas de fato, o percurso pelo teclado, os alvos e o
transbordamento. O CSS foi lido regra a regra (conferido contra o CSSOM do Chromium) e a cascata analisada declaração a
declaração; o JavaScript, módulo a módulo; as 18 escritas do `api.js`, com sondas das falhas que chegam fora da tela e da troca de
pessoa na aba. Antes de tudo, as suítes rodaram com uma guarda de rede (todo nome fora da máquina sem DNS no Chromium; `fetch` e
TCP do Node para fora recusados): os mesmos resultados, e nenhum pedido sairia da máquina sem a guarda.

- **Sistema visual.** Nas telas do piloto, o título da página, a ação principal, o foco (3 px ciano), as formas de situação e a
  semântica de cor são os mesmos: ciano em ação e foco, verde-água no confirmado, âmbar em atenção, vermelho só no destrutivo;
  nenhuma situação só por cor. As diferenças que sobram mudam a aparência de telas aprovadas e ficaram propostas (C01–C04).
- **CSS.** 230.178 B (43.426 gzip), 1.595 regras, 33 `@media` e 39 `@container`; as seções do piloto (28–39) são 71,9% do arquivo.
  Achados: 12 classes sem fonte desde antes do piloto; `.metric-filter` e `filterMetric` sem uso desde a Expansão 9; 247
  declarações sempre vencidas pela mesma regra adiante (quase todas da base antiga das seções 03–15 sob as camadas 16, 21 e da
  casca); blocos idênticos entre as seções 34–39 (título, `.button`, `.text-link`, `h2`, erro da operação), que são o escopo por
  tela aprovado.
- **JavaScript.** Nenhum código morto além de `filterMetric`; helpers com o mesmo corpo em dois ou três módulos (`longDate`,
  `validDate`, `time`/`clock`, `syncs`, `syncConsequence`, `SYNC_USER`, `syncContext`).
- **Foco.** Toda parada do teclado com contorno visível nas 170 combinações; depois das consultas de recuperação (Atualizar notas,
  Publicações), o foco vai ao erro e, depois, ao botão de consulta, com contorno.
- **Notificações.** Nas telas do piloto: recusa e dúvida ditas de jeitos diferentes, sucesso só depois da resposta, nada repetido
  sozinho, nada de quem saiu para quem entrou. Quatro achados anteriores, fora do que A/B podem corrigir (D03–D06).
- **Responsividade.** Nenhuma rolagem lateral nem controle escondido nas telas do piloto, em nenhuma configuração; os custos de
  densidade aprovados nas Expansões 6–9 ficam.

**Ajustes feitos (A e B), um de cada vez, cada um com prova antes × depois.**

| ID | O que saiu | Prova própria |
|---|---|---|
| A01 | As regras das 12 classes legadas (`accent`, `brand-mark`, `brand-type`, `chart`, `chart-column`, `chart-track`, `class-entry`, `class-form`, `empty-icon`, `live-dot`, `pending-section`, `small-button`): 32 regras, 3 seletores em listas e o `@media` que ficou vazio; o título da seção 11 deixou de citar `.chart` | teste de arquitetura novo, RED por asserção na árvore de antes; nenhuma fonte (frontend inteiro, backend, OpenAPI) as gera |
| A02 | `filterMetric` (`ui.js`) e as 3 regras de `.metric-filter`, com o comentário delas | teste novo, RED por asserção; o teste da Expansão 4 deixou de fixar a presença de `.metric-filter`; nenhum import, chamada ou âncora de mutação |
| B01 | 51 declarações repetidas com o mesmo valor; com elas, a cópia do bloco de movimento reduzido da seção 17, que o próprio comentário chamava de duplicada | análise da cascata e CSSOM |
| B02 | 115 declarações da base antiga (seções 03–15) sempre vencidas | idem |
| B03 | 65 declarações das camadas posteriores (16–25 e uma da 33) sempre vencidas; 1 `@media` que ficou vazio | idem; teste de higiene novo (nenhuma declaração repete o valor da anterior com o mesmo seletor e contexto), RED no estado anterior |

Critério de B: a declaração só sai se, para cada seletor da regra, há adiante uma regra com o mesmo seletor (a mesma
especificidade), num contexto que vale sempre que o dela vale (o mesmo `@media`/`@container`, ou nenhum), definindo todas as
propriedades longas dela com prioridade igual ou maior — a vencedora da cascata nunca é a declaração que saiu. As vencedoras só
usam `var()`, `calc()` com `env()` e valores simples, entendidos por todo navegador da base suportada. Nenhuma regra mudou de
lugar, nenhum seletor mudou, nenhuma especificidade mudou. Em cada etapa, o candidato foi conferido contra o baseline regra a
regra (seletor, contexto, declarações e propriedades no CSSOM iguais, menos exatamente o removido).

**Resultado no CSS.** 230.178 → 219.237 B (−10.941 B, −4,8%); gzip -9 43.426 → 41.966 B (−1.460 B, −3,4%); regras 1.595 → 1.515;
declarações 5.007 → 4.659; `@media` 33 → 30; `!important` 5 → 3. Seletores sem fonte: 35 → 0. Declarações sempre vencidas: 247 → 1
(E01).

**Mantidos (E).** `.nav-item:hover` vencida por `color-mix()` (a anterior é a reserva de navegador sem suporte); `height: 100vh`
antes de `100dvh`; `line-clamp` sem prefixo ao lado do `-webkit-`; os tokens `--color-surface-raised` e `--bg-sidebar`, hoje sem
uso; a seção 24, só com o registro histórico; os blocos repetidos entre as seções 34–39 (escopo por tela, com teste por seção);
`configure()` em cada handler; o anel de 2 px dos links do Canvas (3.4.1); o título-botão de 22–24 px na linha dos Feedbacks (a
linha inteira é o alvo); os rótulos completos da barra inferior, só para leitura assistiva.

**Propostos (cada um com autorização própria; nenhum implementado).**

- C01 — raio e corpo dos botões (10/9 px no aluno, 6 px no instrutor e no admin); C02 — corpo dos campos (14,9/15,9/17 px) e dos
  rótulos; C03 — `h3` (15,9 × 17 px), sublinhado dos links de texto, entrelinha do subtítulo; C04 — telas fora do piloto:
  "Crítico" em vermelho, "Novo" em ciano, pílula âmbar, anel padrão do navegador, rolagem lateral com texto a 200% no detalhe do
  aluno e na entrada pública.
- D01 — camada compartilhada dos primitivos das telas do instrutor e do admin; D02 — um módulo comum para as datas e a
  sincronização.
- D03 — Publicações: quem entra na aba durante uma restauração de outra pessoa vê "Publicação restaurada." (IMPORTANT, anterior);
  D04 — Publicações: a falha de uma restauração terminada com outra turma na tela diz "não foi restaurada" também sem resposta ou
  com 5xx (IMPORTANT, anterior, já registrada na Expansão 5); D05 — Painel: "O foco não foi salvo. Failed to fetch" sem resposta
  (IMPORTANT de baixo impacto, anterior: o servidor versiona e uma nova tentativa recebe 409); D06 — Painel: o sucesso do foco
  salvo depois do fim da sessão aparece na entrada pública (MINOR, anterior).
- D07 — "Failed to fetch" e "Tente novamente" nos avisos de escritas incertas fora do piloto; D08 — o aviso temporário cobre a
  barra inferior e o pé da página enquanto está na tela; D09 — a regra de foco do `render()` (C7.1) e "Pular para o conteúdo"; D10
  — Publicações sem aviso do resultado com o foco em outro lugar.

**Validação.** Unidade 389 de 389 e navegador 186 de 186, no fuso local e em UTC (antes: 386 e 186; os três testes novos são os da
rodada). Mutações: 1.072 de 1.079 mortas por asserção em 18 suítes, nenhuma por tempo esgotado e nenhuma mexendo no worktree
(Expansão 9 127 de 127, 8.1 202 de 202, fechamento da Expansão 7 144 de 144, Expansão 6 119 de 119, Expansão 5 83 de 83, Expansão
4 66 de 66, C7.4 21 de 21, C7.5 37 de 37, Expansão 3 57 de 57, Expansão 2 42 de 42, v32 33 de 33, v33 10 de 10, v34 21 de 21;
consolidação da Expansão 3 63 de 65, v2 12 de 14, v31 15 de 16 e v341 9 de 10, com as mesmas sobreviventes no baseline; v3 11 de
12: a S4, que tira o `min-height: 0` do topo da casca, ficou equivalente com a consolidação — morta no baseline e, no final, o
build com ela idêntico ao final em 170 cenas, porque só neutralizava as alturas antigas, sempre vencidas, que a B02 e a B03
removeram; a declaração fica, como reforço); as 1.232 âncoras das rodadas anteriores aparecem uma vez cada (as 7 da Expansão 8
reescritas pela 8.1 continuam fora, como antes). Equivalência no navegador, baseline congelado × build final: cada etapa no tour
(17 telas × 10 configurações: 170 cenas, 39.540 elementos) e, no fim, 560 cenas das expansões anteriores (122.139 elementos), 66
da área Feedbacks (11.992) e 76 de Atualizar notas (38.840) — HTML, estilo computado com `::before`/`::after`, posição e tamanho,
foco, ordem do Tab e árvore de acessibilidade idênticos. As 8 repetições por tempo esgotado vieram do repouso da máquina ociosa
(registro de energia), nunca de uma diferença: a comparação só acontece com os dois lados abertos. Capturas: 70 pares em
`~/Desktop/escola-da-nuvem-capturas-piloto/consolidacao-transversal-final/` (com `index.html`, `results.json`,
`metricas-css.json`, `relatorio-equivalencia.md` e `SHA256SUMS.txt`), idênticos pixel a pixel, e o ZIP de revisão
`consolidacao-transversal-final.zip`, conferido depois de extraído (só PNG, o índice, as métricas, o relatório e as somas; dados
sintéticos).

**Estado local.** Candidata local consolidada, sem commit. O `main` remoto (`alric-corp`) andou durante a rodada, de `779ee7e`
para `f941e0f` (3 commits da frente da automação, em 10 arquivos de backend, documentação dela, Terraform e testes de integração —
nenhum em comum com o piloto): a integração parte da base nova, com as suítes e a equivalência de novo. Nenhum BLOCKER nem
IMPORTANT introduzido pela rodada; os IMPORTANT anteriores (D03–D05) esperam decisão. A avaliação de prontidão (inventário,
riscos, checklists, planos de commit, integração e rollback, critérios de GO/NO-GO) fica na pasta da consolidação, em
`relatorios/prontidao.md`.

## Decisões da consolidação transversal

1. Só A e B nesta rodada; o resto proposto com evidência e categoria. A redução do CSS é consequência, não objetivo.
2. A prova de cada remoção vem antes dela: busca no repositório inteiro (A), análise da cascata conferida no CSSOM (B), e a
   equivalência antes × depois em todas as telas e configurações depois dela.
3. Nenhuma regra muda de lugar e nenhum seletor muda: a consolidação dos primitivos repetidos entre as telas, que mudaria a ordem
   da cascata e acoplaria telas aprovadas, fica proposta (D01).
4. Os achados de resultado assíncrono em telas aprovadas (D03–D06) mudam o comportamento de telas aprovadas: ficam para
   autorização específica, com evidência e plano.

## C1 — Correções de confiabilidade pré-integração

Autorizada depois da aprovação da consolidação, só para D03, D04 e D05, sem redesenho e sem mudar contratos, backend, CSS,
`state.js` ou o mecanismo global de avisos. Mudaram `frontend/app.js` (a restauração, o salvamento do foco e os dois pontos em que
a sessão muda: o `/me` do boot e a expiração) e `frontend/pages/teacher.js` (a seção do foco). Testes novos:
`tests/c1-reliability.mjs` (2) e `tests/c1-reliability-browser.mjs` (15), registrados no `package.json`; uma expectativa antiga
corrigida (P5b, abaixo). Os registros da rodada ficam em `~/Developer/escola-da-nuvem/c1-confiabilidade/`.

**Garantias dos contratos (`backend/portal.py`, só leitura).** A restauração (`POST /cohorts/{code}/restore`) e o foco (`POST
/cohorts/{code}/focus-activities`) recusam tudo antes de escrever e escrevem numa transação condicional única; o 429 vem do API
Gateway, antes da Lambda. Um 5xx pode vir depois da escrita, e a falta de resposta não diz nada: as duas são dúvida. Repetir
depois de uma escrita que deu certo não grava de novo: a restauração recebe 409 (`expectedCurrent`) e o foco também (a versão
mudou).

| Resposta | Restauração | Foco da turma |
|---|---|---|
| 200 | sucesso confirmado | sucesso confirmado |
| 400 | — | recusa: nada gravado (validação) |
| 403, 404, 429 | recusa: nada gravado | recusa: nada gravado |
| 409 | conflito: este pedido não gravou; a consulta mostra o estado (versão em vigor mudou, integridade) | conflito: este pedido não gravou (versão do foco ou publicação mudou) |
| 5xx, rede, resposta perdida | resultado desconhecido | resultado desconhecido |

**D03 — a restauração presa à sessão.** Causa: o andamento, o erro e o resultado ficavam presos à turma e ao relatório, não à
sessão. O sucesso recarrega o portal; se a aba já era de outra pessoa (a sessão é compartilhada entre as abas), quem entrou via
"Publicação restaurada."; o erro ia para o aviso de quem entrou; o andamento aparecia para ela e parava o Restaurar dela; e, com a
sessão expirada (401), o sucesso aparecia na entrada pública. Correção: uma geração de sessão no `app.js`, que muda quando o `/me`
traz outra pessoa (`userId`) e quando a sessão expira. A restauração guarda a geração em que começou e descarta a resposta que
chega em outra: nem aviso, nem tela, nem recarga (nenhum pedido), e o andamento de quem está na aba fica como está. O andamento só
aparece na sessão que o começou; quem entrou encontra Restaurar livre e pode restaurar, vendo só o próprio andamento e o próprio
resultado; se as duas restaurações chegarem ao servidor, a que foi feita sobre uma versão que já não está em vigor é recusada
(409, `expectedCurrent`: garantia do backend). A → B → A: a geração muda duas vezes, e a resposta da sessão anterior de A não vale
para a nova (o e-mail sozinho não distinguiria). Sair navega para o logout: a página, com as respostas pendentes, acaba ali. O
pedido pode ter sido concluído no servidor; quem está na aba vê a versão em vigor ao consultar.

**D04 — a dúvida da restauração.** Causa: fora da tela, toda falha virava "A publicação da BRSA0267 não foi restaurada.", também
sem resposta ("Failed to fetch") ou com 5xx; com a mesma turma e o relatório trocado (Consultar atualização), aparecia o "Failed
to fetch" cru. Correção: a dúvida diz a turma de origem e a consulta segura, sem convidar a repetir; a recusa continua dizendo que
não restaurou. Na própria tela nada mudou (já dizia a dúvida, com "Consultar atualização"); no Painel da mesma turma (o mesmo
relatório), a dúvida continua esperando em Publicações, sem afirmar nada.

**D05 — o foco da turma.** Causa: o erro usava a mensagem crua ("Failed to fetch") e dizia "O foco não foi salvo." também quando a
gravação podia ter acontecido; com outro relatório na tela, o aviso não dizia a turma. Correção: na seção, a dúvida diz que não
deu para confirmar, o motivo e o que cada caminho faz com o que não foi salvo — a consulta ("Consultar atualização", que já
existia) descarta as escolhas não salvas; salvar de novo é seguro, porque o servidor confere a versão —; a recusa continua "O foco
não foi salvo." com o motivo; o rascunho continua na tela; o foco vai ao resultado, como antes. Com outro relatório na tela, o
aviso diz a turma. O resultado que chega em outra sessão não aparece e não desfaz o salvamento que quem está na aba começou (o
andamento só é limpo na sessão em que o pedido começou) — a mesma guarda da D03, que também resolve a D06 (o sucesso depois do fim
da sessão na entrada pública), sem código a mais.

**P5b.** O P5b (`tests/teacher-home-browser.mjs`, Expansão 4) esperava, com outra turma na tela, o motivo cru do 409 ("O foco foi
alterado por outro instrutor. Consulte a atualização antes de salvar."), sem a turma e sem dizer que não salvou — o texto que a
D05 corrige. A expectativa passou a "O foco da BRSA0267 não foi salvo. O foco foi alterado por outro instrutor. Consulte a
atualização antes de salvar.": RED por asserção no retrato pré-C1, GREEN depois. Pelo contrato, o 409 de `_focus_activities`
recusa antes de gravar, então "não foi salvo" é exato; e o aviso fora do relatório de origem precisa dizer a turma.

| Situação | Antes | Depois |
|---|---|---|
| Restauração, rede, outra turma na tela | A publicação da BRSA0267 não foi restaurada. Failed to fetch | Não foi possível confirmar a restauração da publicação da BRSA0267. A operação pode ter sido concluída: consulte a publicação em vigor da BRSA0267 em Publicações da turma antes de restaurar de novo. |
| Restauração, 5xx, outra turma | A publicação da BRSA0267 não foi restaurada. {o texto do 5xx} | a mesma dúvida acima |
| Restauração, rede, relatório trocado | Failed to fetch | a mesma dúvida acima |
| Restauração, recusa, outra turma | A publicação da BRSA0267 não foi restaurada. {motivo} | igual |
| Restauração de A, com B na aba | "Publicação restaurada.", o erro de A ou o andamento de A, para B | nada |
| B restaura durante a restauração de A | Restaurar parado para B, com o andamento de A; depois, "Publicação restaurada." para B | B restaura e vê só o próprio andamento e o próprio resultado |
| Foco, rede (na seção) | O foco não foi salvo. Failed to fetch | Não foi possível confirmar a atualização do foco da turma. A conexão com o portal falhou. A alteração pode ter sido salva. "Consultar atualização" mostra o foco em vigor, mas descarta as escolhas ainda não salvas; salvar de novo não grava duas vezes: se a alteração já tiver sido salva, o portal recusa a repetição. |
| Foco, 5xx (na seção) | O foco não foi salvo. {o texto do 5xx} | a dúvida, com o texto do 5xx |
| Foco, recusa (na seção) | O foco não foi salvo. {motivo} | igual |
| Foco, rede, outro relatório na tela | Failed to fetch | Não foi possível confirmar a atualização do foco da BRSA0267. A alteração pode ter sido salva: consulte a atualização no Painel do instrutor da BRSA0267 antes de salvar de novo. |
| Foco, recusa, outro relatório na tela | {motivo} | O foco da BRSA0267 não foi salvo. {motivo} |
| Foco de A, com B na aba ou depois do fim da sessão | "Foco da BRSA0267 atualizado." ou o erro de A | nada |
| B salva o foco durante o salvamento de A | o aviso de A para B; no render seguinte, o andamento e o rascunho de B somem | nada de A; o andamento e o rascunho de B continuam |

**Validação.** Unidade 391 de 391 e navegador 201 de 201, no fuso local e em UTC (o retrato pré-C1, nesta rodada: 389 e 186; os 17
novos são os da C1), com uma guarda de rede: o Chromium não resolve nenhum nome fora da máquina e o Node recusa `fetch`, TCP e DNS
para fora. A guarda herdada da consolidação deixava passar `net.connect` (argumentos normalizados); foi corrigida e provada por
uma sonda antes das suítes. Na rodada, 522 pedidos a hosts externos, todos atendidos por rota simulada (245) ou abortados pelo
teste (277); nenhum sairia da máquina. RED por asserção no retrato pré-C1, nenhum por tempo: 13 dos 15 testes de navegador
(C1-D03a–d, f, g; C1-D04b, c; C1-D05a–e), C1-U1 e o P5b; C1-D03e, C1-D04a e C1-U2 passam no retrato (preservação). Mutações: as 30
da C1 mortas por asserção (2 só depois de reforçar C1-D03d e C1-D03e; 3 vieram da revisão); as antigas, 1.072 de 1.079, com as
mesmas 7 sobreviventes da consolidação; nenhuma por tempo esgotado e nenhuma mexendo no worktree; as 1.232 âncoras antigas (6 da
E5 e da E4 reancoradas, com a mesma mutação) e as 30 da C1 aparecem uma vez cada. Equivalência no navegador, retrato × final: 170
cenas do tour, 560 das expansões anteriores, 66 da área Feedbacks e 76 de Atualizar notas (212.511 elementos) — HTML, estilo
computado com `::before`/`::after`, posição e tamanho, foco, ordem do Tab e árvore de acessibilidade idênticos, sem repetição.
Capturas: 35 pares em `~/Desktop/escola-da-nuvem-capturas-piloto/c1-confiabilidade-pre-integracao/` (com `index.html`,
`results.json` e `SHA256SUMS.txt`): os 25 que devem mudar são os cenários D03–D05 e os 10 que devem ficar iguais (a sessão
original, a própria tela, as recusas) são idênticos pixel a pixel; o ZIP de revisão `c1-confiabilidade-pre-integracao.zip`,
conferido depois de extraído (só PNG, o índice, os resultados e as somas; dados sintéticos). Sem rolagem lateral em 1440, 390 com
texto a 200% e 320.

**Limitações.** A aba só sabe que a sessão mudou no próximo `/me` (a recarga): se outra aba trocar de pessoa e a resposta de uma
falha chegar antes de qualquer recarga nesta, ela aparece para quem a aba ainda acredita estar ali (escutar a troca entre abas
mexeria no mecanismo global de sessão: proposta). Depois de salvar de novo um foco cuja resposta se perdeu, o 409 do servidor diz
"alterado por outro instrutor" mesmo quando foi a própria pessoa (texto do contrato). O aviso fora da tela continua o temporário
do portal (6,5 s, fechável, anunciado pela região `aria-live`), e a dúvida, mais longa que o texto de antes, ocupa mais da tela
enquanto ele dura: a 390 px com texto a 200%, 575 px (68% da altura) na restauração e 450 px (53%) no foco, contra 200 e 82 px
antes; a 1440 px, 144 e 122 px (antes, 82) — efeito da C1 num mecanismo anterior: ler o texto inteiro em 6,5 s é difícil; o
mecanismo é global (D07, D08) e não mudou; proposta: o aviso de erro fica até ser fechado, ou dura em proporção ao texto. Achado
da revisão desta rodada, anterior à C1 e não corrigido (fora da autorização): dois salvamentos do foco na mesma sessão — o segundo
começado depois de "Consultar atualização", com o primeiro ainda sem resposta — fazem a resposta do primeiro desfazer o andamento
do segundo (um render depois reabilita Salvar com o pedido pendente; o servidor recusa a repetição pela versão) e descartar o
rascunho dele; sonda idêntica antes e depois da C1; proposta: guardar o andamento pela identidade do salvamento, como a
restauração já faz. As sondas, os testes e as capturas usam o simulador da suíte (o mesmo modelo de `_restore` e
`_focus_activities`); nenhuma operação real. Continuam propostos: D07–D10, C01–C04, D01–D02.

## C2 — Robustez pré-integração

Autorizada depois da aprovação funcional da C1, só para as duas pendências da revisão final dela: o aviso da dúvida da restauração
no celular (C2-01) e salvamentos do foco da turma que se sobrepõem (C2-02). Sem redesenho e sem mudar contratos, endpoints,
backend, CSS, `state.js` ou o mecanismo global de avisos. Mudaram `frontend/app.js` (a dúvida da restauração, o salvamento do foco
e a consulta em Publicações) e `frontend/pages/history.js` (um atributo do bloco de dúvida). Testes novos:
`tests/c2-robustness.mjs` (1) e `tests/c2-robustness-browser.mjs` (16), registrados no `package.json`; duas expectativas da C1
atualizadas (C1-D04b e C1-D04c, abaixo). Os registros da rodada ficam em `~/Developer/escola-da-nuvem/c2-robustez/`.

**Origem.** A revisão final da C1 mediu a dúvida da restauração no aviso temporário do portal: 575 px (68% da altura) a 390 com
texto a 200%, por 6,5 s; e achou dois salvamentos do foco, na mesma sessão, desfazendo o andamento e o rascunho um do outro.

**C2-01 — a dúvida da restauração longe de Publicações.** Discovery: sem resposta ou com 5xx, com a pessoa em outra turma (ou em
outra tela, com o relatório trocado), a restauração lançava a dúvida inteira, e o `busy()` a levava ao aviso do portal
(`#notices`: `aria-live` polite e atômico, fechável, 6,5 s, fixo no canto inferior, até 350 px de largura a 390; nada na tela de
destino). Alternativas: (A) aviso curto e a orientação inteira num componente que já existe — o bloco de dúvida da E5, em
Publicações; (B) uma mensagem persistente e dispensável perto da jornada — um componente novo; (C) adaptar o aviso global só para
essa dúvida — mexe no mecanismo global. Escolhida a A, a menor: nenhum CSS novo, o mesmo bloco aprovado, o aviso global igual.

- Aviso curto: "Não foi possível confirmar a restauração da turma BRSA0267. Ela pode ter sido concluída: veja Publicações." — a
  operação, a turma, a dúvida, que pode ter sido concluída e onde ver. No aviso global (19 caracteres por linha a 390 com texto a
  200%): 6 linhas, 284 px (34%); 117 px (18%) a 320; 96 px (21%) com zoom a 200%. Medidas antes de escolher: a frase única (24%)
  perde "pode ter sido concluída"; "veja Publicações da BRSA0267" passa a 7 linhas (39%).
- Orientação persistente: a dúvida fica guardada por turma, em memória e só para a sessão que restaurou, e aparece em Publicações
  da turma de origem, na publicação que se tentou restaurar, com o texto e a consulta da E5 ("Não foi possível confirmar a
  restauração. {motivo} Ela pode ter sido concluída: consulte a atualização antes de tentar de novo." e "Consultar atualização");
  o Restaurar dessa publicação aponta para ela. Acaba quando a consulta feita em Publicações traz o relatório (a tela mostra a
  versão em vigor que o servidor tem), quando outra restauração da turma começa ou quando a sessão muda. Navegar (Painel, ida e
  volta de turma) não a encerra, e a consulta no Painel também não. O histórico vem inteiro do contrato (`_report` lista todas as
  publicações), então a publicação está sempre na lista.
- Um anúncio: longe dali, o aviso curto anuncia e a orientação aparece em Publicações sem papel de alerta; vista na hora
  (Publicações da turma, ou o mesmo relatório no Painel, como na E5), é um alerta, sem aviso. Com o relatório trocado em
  Publicações (Consultar atualização durante a restauração), a dúvida aparece ali, em vez de ir ao aviso; e a dúvida vista na
  própria tela agora sobrevive à ida e volta de turma.
- Nenhuma consulta nova, nenhuma repetição, nada no armazenamento local; a recusa e o sucesso, como na C1.

**C2-02 — salvamentos do foco que se sobrepõem.** Alcançabilidade (C2-F0, no retrato da C1 e na C2): clique duplo, Enter com
Salvar parado e renders (Publicações e volta) não abrem um segundo salvamento; Consultar atualização e a ida e volta de turma
durante o envio trazem um relatório novo, com Salvar livre — um segundo salvamento da mesma turma, na mesma sessão, sai pelo fluxo
normal; e "Escolher na visão por atividade" continua aberto durante o envio, então o rascunho muda enquanto o salvamento espera.
Causa: o andamento, o rascunho e o relatório não tinham dono — o `finally` de qualquer salvamento limpava qualquer andamento (um
render depois reabilitava Salvar com o pedido do outro pendente); o sucesso apagava qualquer rascunho e gravava o foco salvo no
relatório da tela, mesmo num relatório mais novo, por cima de uma confirmação mais recente; o aviso de um salvamento antigo
parecia o resultado do novo.

- Correção: cada salvamento é uma operação, e a resposta só mexe no que é dela — o andamento, só se ainda for o dela; o rascunho,
  só se ainda for o que ela enviou; o relatório na tela recebe o foco salvo se for o dela, ou um relatório novo que ainda mostra a
  versão de onde ela partiu e não tem rascunho. Se outro salvamento da turma começou depois, o aviso diz que é o anterior.
- Nada de "última escrita vence" no navegador: o rascunho leva a versão de onde partiu, e o servidor recusa (409) quando ela
  mudou. Sem fila, sem repetição e sem bloquear o segundo salvamento (a E4 decidiu que um relatório novo começa sem nada). Ignorar
  uma resposta antiga na tela não desfaz nada no servidor.
- Garantias do backend (`backend/portal.py`, só leitura): a versão do foco (`expectedVersion`) e a publicação (`expectedCurrent`)
  são conferidas antes da transação condicional; repetir depois de uma escrita recebe 409.

| Situação | Antes | Depois |
|---|---|---|
| Restauração sem resposta, com outra turma na tela | aviso de 33 palavras (575 px, 68% a 390 com texto a 200%; 6,5 s); nada em Publicações | aviso curto (284 px, 34%); a orientação inteira em Publicações da turma de origem, até a consulta |
| Restauração sem resposta, Consultar atualização durante ela, em Publicações | o aviso | a dúvida ali, anunciada uma vez |
| A dúvida vista na própria tela, depois da ida e volta de turma | some | continua até a consulta |
| Salvamento anterior responde com o novo pendente | o andamento e o rascunho do novo somem no render seguinte; "Foco da BRSA0267 atualizado." | o andamento e o rascunho do novo ficam; "O salvamento anterior do foco da BRSA0267 foi concluído." |
| Recusa do anterior depois de o novo confirmar | "O foco da BRSA0267 não foi salvo. {motivo}" | "O salvamento anterior do foco da BRSA0267 foi recusado. {motivo}" |
| Dúvida do anterior com o novo pendente | a dúvida da C1, como se fosse do novo | "Não foi possível confirmar o salvamento anterior do foco da BRSA0267: ele pode ter sido concluído." |
| Sucesso atrasado do anterior depois de o novo confirmar | sobrescreve o foco do novo na tela | a confirmação do novo fica |
| Escolha feita na Visão por atividade durante o salvamento | apagada pelo sucesso | continua, com "Alterações ainda não salvas" |
| Salvamento em outra turma durante o primeiro | o andamento dela some no render seguinte | fica |

**C1-D04b e C1-D04c.** As duas expectativas da C1 descreviam o comportamento que a C2-01 troca: o aviso longo com outra turma na
tela (D04b) e o aviso com o relatório trocado em Publicações (D04c). Passaram a esperar o aviso curto e a dúvida no lugar — RED
por asserção no retrato da C1, GREEN depois.

**Validação.** Unidade 392 de 392 e navegador 217 de 217, no fuso local e em UTC (o retrato aprovado da C1, nesta rodada: 391 e
201; os 17 novos são os da C2), com a guarda de rede corrigida na C1, provada antes das suítes sem sonda real de rede (127.0.0.2 e
`broadcasthost`: alvos que não saem da máquina): na rodada, 528 pedidos a hosts externos, todos atendidos por rota simulada (252)
ou abortados pelo teste (276); nenhum sairia da máquina. RED por asserção no retrato da C1, nenhum por tempo: 11 dos 16 testes de
navegador (C2-N1, N3, N4, N6, N7, N8; C2-F1–F5), C2-U1 e as duas expectativas da C1 atualizadas; passam no retrato, como devem, a
alcançabilidade (C2-F0) e as preservações (C2-N2, N5, F6, F7). Mutações: as 25 da C2 e as 30 da C1 (8 reancoradas) mortas por
asserção; as antigas, 1.072 de 1.079, com as mesmas 7 sobreviventes; nenhuma por tempo esgotado e nenhuma mexendo no worktree; 9
âncoras da E5 e da E4 reancoradas com a mesma mutação, e as 1.232 antigas aparecem uma vez cada. Equivalência no navegador,
retrato × final: 170 cenas do tour, 560 das expansões anteriores, 66 da área Feedbacks e 76 de Atualizar notas (212.511
elementos), idênticas em HTML, estilo computado, posição, foco, ordem do Tab e árvore de acessibilidade, sem repetição. Capturas:
24 pares em `~/Desktop/escola-da-nuvem-capturas-piloto/c2-robustez-pre-integracao/` (com `index.html`, `results.json` e
`SHA256SUMS.txt`): os 18 que devem mudar são os cenários da C2 e os 6 que devem ficar iguais são idênticos pixel a pixel; o ZIP de
revisão `c2-robustez-pre-integracao.zip`, conferido depois de extraído (só PNG, o índice, os resultados e as somas; dados
sintéticos).

**Limitações.** O aviso curto ainda cobre a barra inferior no celular enquanto está na tela (6,5 s, fechável): o mecanismo global
(D08) não mudou. A dúvida do foco fora do relatório de origem (C1) continua o aviso longo (450 px a 390 com texto a 200%): a C2-01
foi descrita para a restauração; a mesma solução cabe ali (proposta). A orientação vive na memória da aba: recarregar a página a
perde (a tela abre com a versão em vigor). Entre abas, como na C1: a aba só sabe que a pessoa mudou no próximo `/me`. As sondas,
os testes e as capturas usam o simulador da suíte (o mesmo modelo de `_restore` e `_focus_activities`); nenhuma operação real.

## C3 — Robustez tipográfica e responsividade multiplataforma

**Autorização.** Dada depois de a primeira CI Linux do PR #3 (run `38804653900`, `5867a62`) acusar 20 falhas de layout nos testes
de navegador que passavam no macOS.

**Escopo.** Só robustez tipográfica: sem redesenho; sem trocar a fonte (`system-ui` continua); sem mudar contratos, backend,
OpenAPI ou regras de negócio.

**Arquivos alterados.**
- `frontend/styles.css`: 14 trechos, todos escopados à tela ou ao componente.
- `frontend/app.js`: `showResult`.
- Critério ajustado em 7 testes de navegador e 3 testes novos (IB10b, IB10c e P3b), em 7 arquivos de teste.

Os registros da rodada ficam em `~/Developer/escola-da-nuvem/c3-robustez-tipografica/`, inclusive as tentativas descartadas, com a
evidência de cada uma (`alteracoes-css.md`).

**Causa.** No Ubuntu da CI, `system-ui` resolve para DejaVu Sans, 7% a 16% mais larga que a SF do macOS. Medido pelo CDP,
"Desempenho" a 12 px tem 79,5 px contra 74,5, e uma frase em negrito, 195 contra 168.

A reprodução num contêiner Linux sem rede, com os pacotes `fonts-dejavu-core` e `fonts-dejavu-mono` 2.37-8 do Ubuntu 24.04, deu
exatamente as 20 falhas; sem a DejaVu (WenQuanYi), deu só 2. As fontes do `body` (Arial/Liberation Sans) e de código
(Courier/Liberation Mono) têm métricas iguais nas duas plataformas.

**Classificação das 20.**
- 13 eram defeitos reais de layout (F1):
  - barra inferior: "Desempenho" hifenizado em 2 linhas (A7, N2, S6);
  - "Consultar atualização" com o `nowrap` global de `.button` (A10, B5, B9, H6);
  - palavras maiores que a coluna em títulos, botões, fatos e resumos (F6, C6, P2, P3, PB2, IB10);
  - o resultado focado mais alto que a área visível, que `scrollIntoView({block: "nearest"})` não rolava (C6).
- 2 combinavam CSS e critério (F3): N10 e B8.
- 2 eram de medição (F4):
  - N1 media uma peça escondida da vista;
  - V5 contava linhas por faixas de 4 px.
- 3 eram compacidade presa às métricas da SF (F2): B11, H7 e F7.

**Correções de CSS.**
- **Barra inferior com até 4 destinos:** colunas `minmax(min-content, 1fr)` nas faixas de 4, 3 e 2 colunas do `auto-fit`, com `hyphens: manual` no rótulo curto. Só a coluna do rótulo que não cabe cresce, sem hífen. A SF fica igual (4 × 79 px a 320).
- `overflow-wrap: anywhere`, o mesmo dos títulos do Painel e das Expansões 5–9, em:
  - títulos das telas do aluno;
  - `h2` e título do Acompanhamento do Painel;
  - aviso de atualização automática, confirmação dos removidos e resumo das mudanças de Atualizar notas.
- `white-space: normal` em "Consultar atualização" e nos valores "antes → depois" das notas.
- Ponto de quebra sem largura (`content: "\200b" / ""`) depois do papel no topo compacto.
- `margin-inline-end: 2rem` na grade título + link do Canvas (B8).
- **Na faixa de texto muito ampliado que o Painel já usa (`max-width: 8.5rem`, 320 px com 250%), o espaço decorativo cede antes de qualquer palavra:**
  - o preenchimento lateral dos botões do Painel (`var(--space-1)`);
  - o separador "·" entre os fatos de Publicações (cada fato já ocupa a própria linha);
  - a coluna do número das etapas de Atualizar notas (1,1em).

  A quebra no meio da palavra fica só como último recurso, quando nem assim a palavra cabe: com a DejaVu, "manualmente" ao lado do ícone e "Publicação" ao lado do número.

**Critérios de teste.**
- Mantidos os limites de A7, N2 e S6 e todas as asserções de acesso: rolagem, corte, alvo de 44 px, foco, ordem do teclado e fonte mínima.
- N1 ignora as peças recortadas para leitura assistiva.
- V5 agrupa as linhas por sobreposição vertical.
- N10 aceita o e-mail na linha seguinte quando o começo dele (até o "@") não cabe na linha do papel. A proibição de quebrar no meio da palavra continua.
- B8 desconta da altura acrescentada pelo link as linhas a mais do próprio título.
- B11, H7 e F7 medem a densidade com a tipografia de referência (`--font-ui: Arial, "Liberation Sans"`, injetada pelo teste), que dá o mesmo valor no macOS e no Linux. Os limites são os da aprovação, menos no histórico a 1440 px com texto a 200%:
  - o teto da maior linha passou de 330 (304 da SF + 26) para 400 (376 da referência + 24), porque o resumo e a explicação daquela publicação quebram em uma linha a mais com uma fonte mais larga que a SF;
  - entrou um teto para a soma das seis linhas, 1.875 (1.833 × 310/303, a folga da mediana). Sem ele, a regressão da E2 "resumo em duas linhas também na composição estreita" não mudaria mediana nem máximo na referência.
- **Testes novos:**
  - IB10b: a prévia com contagens de dois dígitos a 320 px com 250% ("17 notas alteradas (12 notas novas, 2 removidas)" pedia 313 px na DejaVu numa etapa de 290).
  - P3b e IB10c: nenhuma palavra dos botões do Painel e dos títulos das etapas partida quando cabe, com a tipografia de referência.

**Diferenças no macOS.** A equivalência no navegador (872 cenas) não acusa propriedade inesperada nem mudança de HTML, foco, árvore de acessibilidade ou ordem do Tab. As caixas que mudam com a SF são estas, todas intencionais:
- **Minhas atividades (B8):** a grade título + link do Canvas fica 2rem mais estreita. De 1024 a 1440 px, nada muda de lugar. Com zoom a 200% (720 px), o título longo de um cartão passa a 2 linhas, e o cartão e a página crescem 18 px; o link fica a 48 px da nota (antes, 34 px e, em outro cartão, 16).
- **Topo compacto do admin a 390 px com texto a 200%:** efeito do ponto de quebra do N10. "Administrador e instrutor" fica numa linha só e o e-mail inteiro na de baixo; antes, o papel quebrava em duas linhas. A altura do topo não muda.
- **Na faixa de 8,5rem (320 px com 250%):**
  - botões do Painel com menos preenchimento lateral: "Ver por atividade" em 1 linha e o ícone de "Enviar CSV" 10 px à esquerda;
  - fatos de Publicações sem o separador;
  - número da etapa 22 px mais perto do título.
- **Valores "antes → depois" das notas:** agora quebram nos espaços. Na `5867a62`, com a lista aberta e a SF a 320 px, o valor mais longo passava da coluna (18 px a 200% e 93 px a 250%), e a página rolava para o lado (3 e 78 px).
- **"automaticamente" no aviso de atualização automática (320 px a 250%):** tem 298 px com a SF, numa coluna de 290. Antes passava 8 px dela, para dentro da margem da página, e alargava junto o contexto da turma; agora quebra dentro da coluna (último recurso, sem espaço decorativo para ceder), e o contexto volta aos 290 px.

**Garantias mantidas.** Continuam iguais:
- o Design System, a fonte, as cores, a hierarquia e os componentes;
- as alturas de alvo (44 px) e o contorno de foco medido em pixels;
- a ordem do teclado igual à visual e a fonte mínima de 12 px;
- o texto inteiro e acessível (sem reticências) e a semântica de status e alerta;
- o comportamento das telas: HTML, árvore de acessibilidade e ordem do Tab iguais na equivalência.

Nenhum `overflow-x: hidden`, fonte menor, alvo menor, `transform` ou `!important`.

**Capturas.** 29 cenas × 3 fontes (SF, Verdana simulada, DejaVu real), antes e depois, só da janela, com o componente da cena ao
centro. Ficam em `~/Desktop/escola-da-nuvem-capturas-piloto/c3-robustez-tipografica/` e no ZIP de mesmo nome, com `index.html`,
`results.json` e `SHA256SUMS.txt`.
- **SF:** 21 de 29 idênticas pixel a pixel; as 8 diferentes são as descritas acima. Rolagem lateral de 1 cena (a lista de notas aberta) para 0.
- **Verdana e DejaVu:** rolagem lateral de 11 cenas para 0.

**Validação.**
- **macOS (worktree):** unidade 392/392 e navegador 220/220, no fuso local e em UTC; build, `node --check` e `git diff --check` limpos.
- **Linux nas condições da CI:** contêiner sem rede, 4 CPUs, DejaVu e UTC.
  - `5867a62`: 196/217 (as 20 falhas da CI mais C2-F5, um teste de tempo instável ali).
  - C3: 220/220.
- **Mutações direcionadas:** 42/42 mortas por asserção. Cada correção foi revertida e cada critério novo ganhou cenário negativo, no Linux e no macOS.
- **Mutações antigas:** 1.127/1.134, as mesmas 7 sobreviventes de sempre, iguais às da revisão de integração. A mutação da E2 que a referência escondia no H7 é a razão do teto da soma.
- **Equivalência no macOS:** `5867a62` × C3 em 872 cenas (tour, E9, Feedbacks administrativos e Atualizar notas). Nenhuma propriedade inesperada, e HTML, foco, árvore de acessibilidade e ordem do Tab iguais. As caixas só mudam nos componentes listados acima.
- **Varreduras:** 17 telas × 9 configurações de estresse, com SF, Verdana e DejaVu.
  - Rolagem lateral: nenhum problema novo; corrigidas 9 cenas (DejaVu e Verdana) e 3 (SF); nenhum resíduo que dependa da fonte.
  - Palavras partidas: só como último recurso.
  - Sobreposição de texto (linhas de texto de elementos diferentes que se cruzam): com a SF, nenhum par novo; com Verdana e DejaVu, só o par do Painel descrito nas limitações.
- **CI do PR:** pendente no momento do commit.

**Limitações.**
- A cobertura do IB10b e da correção do resumo de Atualizar notas depende da fonte: o teste falha sem a correção no Linux (DejaVu), não no macOS (SF).
- 12 cenas da varredura passam da tela com texto a 200–250% com qualquer fonte, inclusive a SF. São problemas de reflow fora das 20 falhas e anteriores à C3: Entrada pública, Pendências do aluno, Notas da turma, Feedback pelo rodapé do instrutor, e a sugestão de revisão em Meu desempenho e Minhas atividades a 250%. Ficam para uma rodada própria.
- No Painel a 320 px com texto a 250%, os rótulos dos atalhos da Situação da turma passam da própria coluna com qualquer fonte, porque a coluna do rótulo é `minmax(0, 1fr)` ao lado do número. Com a SF, o fim de "referência" encosta no "6", como já acontecia antes da C3. Com fonte larga, a C3 tirou a rolagem lateral, e o rótulo fica acima do número, sem encostar nele. A correção muda com a SF um componente aprovado que não estava entre as 20 falhas, então fica como proposta para uma rodada própria: o preenchimento e o espaço cedem na faixa de 8,5rem, com quebra de palavra como último recurso.

## C3.3 — Reflow e acionabilidade (F08, I-01, I-02)

**Origem.** Auditorias C3.2 do PR #3 (`8eadb8f`): F08 (BLOCKER, Sair da conta) e I-01/I-02 (IMPORTANT, regressões do PR
em relação à `main` em "Meu desempenho"). Reproduzidos antes de corrigir, com API simulada, no macOS (SF) e no Linux
(DejaVu, contêiner sem rede), e com uma fonte larga (Verdana).

**Escopo.** Só `frontend/styles.css` (7 trechos: 3 da A.1 e 1 da A.2) e testes de navegador. Sem JavaScript, sem trocar a fonte, sem reduzir
texto, sem esconder overflow, sem `z-index`.

**F08 — Sair da conta.** A barra lateral tem largura em px (210 px no tablet, 244 px até 1279 px), mas iniciais, nome e
Sair crescem com o texto, e a conta era uma linha flexível sem quebra. Com texto a partir de 175%, de 761 a 1279 px, o
Sair passava 39 a 136 px para fora da barra, sobre o conteúdo. Como a barra não cabia na altura da janela, ela rolava com
a página (`data-sidebar="rola"`, sem posicionamento), e o conteúdo, pintado depois, recebia o clique.
- No Painel, a 768 px com texto a 200%, o centro do Sair acionava o filtro Crítico. Em outras larguras, acionava outro
  atalho (Atenção, Sem nota, Ainda não entraram) ou nada. Depois que o primeiro clique filtrava a lista, os seguintes
  chegaram a "Limpar filtros" e "Exportar CSV".
- Nas 10 telas medidas a 768 px com texto a 200%, nenhum ponto do Sair recebia o clique. O teclado continuava certo.
- Não existia na `main`; vinha da casca do piloto (C2).
- Correção: `flex-wrap: wrap` na conta, com o bloco do nome partindo de 0 e crescendo até a própria largura
  (`flex: 1 1 0; max-width: max-content`).
  - A quebra usa o tamanho hipotético dos itens. Sem a base 0, a conta quebraria antes de o nome encolher, e mudaria o
    admin ("Administrador e instrutor") com texto normal de 768 a 1440 px.
  - Com ela, a conta só quebra quando nem o nome no mínimo cabe. Então nome e Sair descem para as linhas seguintes, na
    ordem do DOM, dentro da barra.
  - Com texto normal, a composição é a mesma. As exceções são os casos em que o Sair já passava da área de conteúdo
    da barra, mesmo com o nome no mínimo: nome longo no tablet (22 px) e admin no tablet (6 px). Nesses casos ele desce
    para a linha seguinte.

**I-01 — médias do resumo.** No celular, rótulo e número dividem uma linha (`minmax(0, 1fr) auto`). Com texto a 200%, a
coluna do rótulo ia a 0 px e "Média em KCs" passava por baixo do "51,3%": até 463 px de tinta em comum com a SF, 445 com
a DejaVu. Lado a lado, cada média precisa do número de 2,25rem mais o recuo. Com texto a 200%, o resumo
(`overflow: hidden`) cortava o número e o "%" a 601, 768, 1101, 1200, 1280 e 1440 px, conforme a fonte. A 1280 px, o "%"
sumia por inteiro na DejaVu e na Verdana.
- Correção: container query em rem na área das médias (`container: metas`), que segue o texto, como as listas de "Meu
  histórico".
  - Abaixo de 24rem, as médias empilham. Com texto normal, a área tem 31rem ou mais.
  - Abaixo de 17rem, o número desce para baixo do rótulo. 320 px têm 18rem com texto normal.
  - Abaixo de 8,5rem (320 px com 250%), o recuo lateral cede antes do número, como nos atalhos do Painel (C3).
- Calibragem: o número mais largo ("96,4%") mede 6,62rem na SF, 7,58 na DejaVu e 8,25 na Verdana. Lado a lado, as
  médias pedem até 22,5rem; rótulo e número numa linha, até 15,7rem.

**I-02 — títulos letra a letra.** As colunas de "Meu desempenho" abriam em `min-width: 1200px`, com a coluna lateral de
no mínimo 18rem. Com texto a 200%, de 1200 a 1440 px, "Por onde começar" ficava com 0 a 216 px, e 15 palavras dos
títulos quebravam (11 letra a letra, como "Introdução" em 10 linhas).
- Correção: o limite passa a `min-width: 75em`, em em, que segue o tamanho de fonte do navegador. São 1200 px com texto
  normal (o mesmo de antes) e 2400 px a 200%.
- Com texto de 125% a 175% no desktop, as colunas empilham abaixo de 75em, como já acontecia com o zoom equivalente.

**Testes novos.**
- P10 (Painel): clique real em cinco pontos do Sair, com o click registrado na captura (o logout nunca executa); Crítico
  sem `aria-pressed`; peças da conta dentro da barra; Espaço no Sair; nome longo; admin no tablet; conta do admin numa
  linha com texto normal no desktop.
- V11: geometria do texto, caixas, recorte, área de conteúdo e tinta (pixels) das médias de 320 a 1440 px com texto
  ampliado; composição igual com texto normal.
- V12: nenhuma palavra partida nos títulos de 1200 a 1440 px a 200%; limite das colunas em 1199/1200 px (texto normal) e
  em 2399/2400 px (200%).
- Os três falham na `8eadb8f` pelo motivo do defeito e passam na correção.

**A.1 — cartão "Seu resumo" (coluna da esquerda).** Achado na inspeção das capturas da C3.3, igual antes e depois dela.

- **Botão:** com texto a 200%, de 1101 a 1440 px, o resumo ficava em duas colunas (limite em px) e a coluna da esquerda
  tinha 138–212 px úteis. O texto e o ícone de "Ver minhas atividades" saíam do botão em até 39 px: ele é `inline-flex`
  com `justify-content: center` e `max-width: 100%`, e só "atividades" mede cerca de 168 px na DejaVu.
- **Contagens:** "3 para revisar" (`white-space: nowrap`) passava da coluna em até 91,8 px. Também passava a 320 px com
  200% em fonte larga (4,9 px na DejaVu).
- **Ícone:** abaixo de 1280 px o svg do botão encolhia junto com o texto que quebra (a regra da casca com
  `flex-shrink: 0` só vale a partir de 1280 px). Ficava com 18 px a 1101 px com texto normal em fonte larga, 7,7–17,6 px
  de 320 a 768 px com texto a 200%, e 0 px (some) a 320 px com 200% em fonte larga.
- **Correções:**
  - o limite de duas colunas do resumo passa a `max-width: 68.75em`, o mesmo raciocínio do limite das colunas: 1100 px
    com texto normal, 2200 px a 200%;
  - as contagens deixam de ter `nowrap`. Os itens continuam passando inteiros para a linha seguinte, e só um item que
    sozinho não cabe quebra o texto entre palavras;
  - o ícone do botão não encolhe (`flex: none`, como em `.tp-actions` do Painel). Com texto normal, só muda onde ele
    encolhia: a 1101 px com fonte larga, passa de 18 para 20 px, sem mudar o botão nem o cartão.
- **Teste:** V13 verifica texto e ícone dentro do botão, ícone inteiro (largura igual à altura), botão e contagens dentro
  da área útil da coluna de 320 a 1440 px com texto a 200%, clique e Enter no botão a 1280 px, e, com texto normal, duas
  colunas a partir de 1101 px e o ícone inteiro.

**A.2 — botão no reflow extremo.** Com o ícone inteiro (A.1), a 320 px com texto a 250% e fonte larga o texto e o ícone
passavam 13–15 px do botão: a coluna tem 208 px, e "atividades" (205 px na DejaVu, 202 px na Verdana), o intervalo de
12 px e o ícone de 20 px não cabem numa linha. Centralizado, o excesso saía pelos dois lados. Nem sem recuo caberia.

- **Correção:** `@media (max-width: 9em)` com `flex-wrap: wrap` no botão do resumo: só nessa condição o ícone pode descer
  para a linha seguinte, centralizado. São 360 px com texto a 250% e 144 px com texto normal (não existe), então o botão
  não muda com texto normal nem a 200% (lá o ícone cabe ao lado do rótulo em todas as fontes medidas).
- **Medido antes de escolher:** a mesma quebra por container query na coluna (`max-width: 6.5rem`) dá o mesmo resultado,
  mas quebra até 372 px a 250% (o ícone desce sem precisar) e exige `container-type` na coluna. A quebra sem condição (A1-2)
  mudava o botão a 1101 px com texto normal.
- **Teste:** V14, com a fonte do sistema e com uma fonte larga em toda plataforma (Verdana; no Linux, DejaVu Sans): rótulo
  inteiro e dentro do botão, sem palavra partida e sem reduzir a fonte; ícone inteiro e dentro do botão; botão dentro da
  coluna e da janela; alvo de 44 px; pontos do rótulo e do ícone no botão; foco visível e sem recorte; contagens na
  coluna; ícone ao lado do rótulo com texto normal e a 200%; clique e Enter a 320 px com 250%.

**Fora do escopo (registrado, sem mudança).**

- Atalhos da Situação da turma a 320/250% com a SF (proposta da C3, acima).
- "Sugestão de revisão" com `nowrap` em Minhas atividades e Meu desempenho a 320/250%.
- Rolagem lateral de "Meu desempenho" a 320/250%, igual antes e depois da C3.3:
  - "Sugestão de revisão" (`nowrap`) nos cartões de atividade: 25 px na SF e 67 px na Verdana;
  - o nome da tela no topo ("Meu desempenho", `nowrap`): 63 px com fonte larga;
  - "Como interpretar minhas notas?": 11 px com fonte larga.
- A 320 px com texto a 300% (fora da cobertura), "atividades" sozinha é mais larga que a coluna: com fonte larga passa
  25–27 px do botão mesmo com o ícone na linha de baixo.
- Pendências do aluno, Feedback pelo rodapé e Entrada pública (herdados da `main`).

## Decisões da Expansão 9

1. Caixa de entrada, não painel: linhas finas, o título como o alvo, o status por texto e forma, o começo da mensagem; nenhuma
   métrica nova.
2. O escopo dito: "Administração do portal" no topo, "de todas as turmas" no título e "No portal inteiro" no resumo (que não segue
   os filtros de tipo e turma).
3. O resumo continua filtrando (os atalhos de antes), agora com os arquivados e sem números inventados durante a carga.
4. O vocabulário de status do Feedback do aluno, sem pílula: ciano só nas ações, verde-água só no resolvido.
5. A mesma mudança de status (o status esperado, o 409 relendo em silêncio), parada enquanto o escolhido é o atual, com o andamento
   e o erro junto da ação; recusa × dúvida; a consulta segura volta à lista relida.
6. A consequência para quem enviou dita antes da ação; nenhuma pergunta nova (o status volta pela própria tela).
7. Só o que o contrato traz: sem resposta, prioridade, busca, ordenação, exclusão ou histórico com quem mudou.

**Riscos (revisão adversarial).** Nenhum BLOCKER. IMPORTANT, anteriores à rodada e corrigidos: o aviso de sucesso de uma mudança de
status de quem saiu aparecia para quem entrou na aba, e o 409 relia a lista em nome dela; o seletor de status voltava ao status
atual quando a tela era refeita (o fim da carga das imagens, o andamento), e "Salvar status" mandava o status atual — nada mudava e
nada era dito. Achado e corrigido durante a rodada: com a linha inteira como alvo, o deslocamento de `:active` da regra global de
botão fazia o botão conter o `::after` no meio do clique, e o clique fora do título se perdia (pego por FB2 antes de chegar à tela).
MINOR, anteriores e mantidos: com o detalhe fechado ou em outra tela, a falha vai para o aviso temporário, que some, e a dúvida ali
não diz que o pedido pode ter sido concluído (como antes); uma lista relida durante uma mudança em andamento pode mostrar o status de
antes até a próxima leitura; clicar no botão parado leva o foco ao `<main>` (`tabindex="-1"`, C7.1). MINOR desta rodada: com texto a
200% no celular, o resumo (5 atalhos com nome) e os filtros com rótulo deixam a lista mais abaixo (números abaixo); a mudança de
status de outra pessoa que entrou na aba fica parada até a de quem saiu terminar (uma por vez, como na Expansão 8).

**Validação.** RED na árvore de antes (a cópia do worktree no início da rodada, conferida pelas somas), por asserção e sem tempo
esgotado: unidade 11 de 11 (AF1–AF11; AF11 mostra o aviso de quem saiu para quem entrou) e navegador 18 de 20 (FB1–FB18; o FB19,
papéis, e o FB20, a falha com o detalhe fechado no aviso do portal, passam nos dois lados: preservação). Testes:
`tests/admin-feedback-page.mjs` (AF1–AF11: composição, linha, resumo, filtros, estados, detalhe, anexos e a ação de status,
andamento, recusa e dúvida, robustez do começo da mensagem e das datas, o handler com transporte falso e a troca de pessoa) e
`tests/admin-feedback-page-browser.mjs` (FB1–FB20, com API simulada: composição, detalhe e alvo da linha, a mudança de status com
clique duplo e forçado, 400, 403, 404, 429, 409, rede, 5xx e resposta perdida, resumo e filtros, 62 feedbacks e Carregar mais com
erro, carga e erro da lista, resposta antiga, troca de pessoa durante a mudança, troca de feedback durante a carga das imagens,
conteúdo não confiável, 10 combinações de largura, texto, zoom e altura com textos extensos, teclado e contorno, formas e cores,
escolha que sobrevive ao redesenho, andamento com outro feedback aberto, falha fora do detalhe e papéis). Testes antigos ajustados
ao comportamento autorizado, sem enfraquecer, com RED por asserção na árvore de antes: `tests/architecture.mjs` (a seção 38
termina na 39; a seção 39 escopada; as classes da tela antiga sem fonte nem regra), `tests/feedback-browser.mjs` (o resumo com os
arquivados; o 409 com o erro junto da ação e Salvar parado até outra escolha), `tests/feedback-lifecycle-browser.mjs` (C7.5: o 409
na tela, com o foco no erro) e `tests/feedback-attachments-browser.mjs` (a contagem de anexos na linha). As três mutações da C7.5
que miravam o código reescrito (`tests/contracts/lifecycle_mutations.py`) ganharam as âncoras novas, com a mesma mutação. Suítes:
unidade 386 de 386 e navegador 186 de 186, no fuso local e em UTC (antes da rodada: 373 e 166); a suíte da Expansão 9, mais três
vezes seguidas, sem falha. Mutações: 127 de 127 mortas por asserção, nenhuma por tempo esgotado (cinco sobreviveram à primeira
rodada e mostraram buracos: dois testes de unidade que esperavam uma promessa que o mutante deixava pendente, a troca de pessoa só
com quem entrou no mesmo feedback, o limite de duas linhas só medido no desktop e o texto que passa da própria caixa; os testes
foram reforçados e a rodada final as mata); as anteriores aplicáveis — 8.1 (202 de 202), fechamento da Expansão 7 (144 de 144),
Expansão 6 (119 de 119), C7.4 (21 de 21), C7.5 (37 de 37), consolidação da Expansão 3 (63 de 65; as 2 que sobram são as
equivalentes já registradas nela) e Expansão 3 (57 de 57) — e as 936 âncoras das rodadas anteriores (736 de antes e 200 da 8.1),
uma vez cada (as 7 da Expansão 8 que a 8.1 reescreveu continuam fora, como antes). Equivalência no navegador, antes × depois:
HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 560 cenários, 122.139 elementos, idênticos (72
das outras telas do aluno, do instrutor e do admin; 140 do Feedback de instrutor e admin pelo rodapé; 35 do Feedback do aluno; 80
do painel e das telas abertas a partir dele; 58 de Publicações da turma; 20 do detalhe do aluno; 61 de Lembretes; 94 de Turmas e
acessos, nas cenas das capturas da Expansão 8 e da 8.1). Três cenas foram repetidas com um navegador novo por tempo esgotado na
abertura ou numa ação — duas no build de antes e uma no de depois, em telas que a rodada não toca (a comparação só acontece depois
das duas aberturas); mais as 76 cenas de Atualizar notas (38.840 elementos, idênticas). Capturas: 69 pares em
`~/Desktop/escola-da-nuvem-capturas-piloto/expansao-9-feedbacks-administrativos/` (com `index.html`, `results.json`,
`densidade.json` e `SHA256SUMS.txt`) e o ZIP de revisão `expansao-9-feedbacks-administrativos.zip` (só PNG, o índice, as métricas
e as somas; dados sintéticos). **Medidas** (`densidade.json`, antes → depois): a primeira linha sobe no desktop (1440: 470 → 326
px; 1024: 431 → 309) e no celular (390: 781 → 648; 320: 781 → 666), e com 62 feedbacks cabem 6 linhas na primeira tela em 1440
(antes 4). Cada linha fica um pouco mais alta porque traz o começo da mensagem (1440: 105 → 108 px; 390: 124 → 148), e a página
dos 50 primeiros cresce no celular (390: 6.985 → 7.817 px) e diminui no desktop (1440: 6.415 → 5.863). Com texto a 200%, a lista
começa mais abaixo (390: 1.389 → 1.690; 1440: 949 → 1.036). Nas 69 capturas, nenhuma rolagem lateral, nenhuma chamada para fora da
origem e um pedido por mudança.

**Propostas (cada uma com aprovação própria; nenhuma implementada).** Mostrar o histórico de status com quem mudou (o backend
guarda o `sub`; dizer o e-mail exige resolver no servidor); resposta ao autor (não existe no contrato); busca e ordenação no
backend; o resumo seguindo os filtros (hoje é o contador global); a falha fora do detalhe guardada para quando ele abrir de novo
(hoje, o aviso temporário, como antes); e apagar `filterMetric` do `ui.js`, sem uso, com as regras de `.metric-filter`.

## Decisões da Expansão 8

1. Escopo dito por seção: o portal inteiro (solicitações, criar turma) × a turma selecionada (instrutores, alunos e contas,
   configurações), identificada por código e nome numa superfície só.
2. Só o que o contrato traz: nenhuma contagem de alunos ou de responsáveis, nenhum papel ou estado novo, nenhum convite.
3. Ênfases: consequência em vermelho (texto e borda), conceder em secundário, consultar em link; situação por texto e forma.
4. As mesmas operações, perguntas e validações, com andamento e erro junto do alvo e com o foco; recusa × dúvida; a dúvida e o
   conflito levam à consulta segura; nenhuma nova tentativa automática.
5. As perguntas dizem a pessoa, a turma e a consequência que o contrato garante (textos para aprovação, abaixo); a pergunta continua
   o `confirm()` nativo, no mesmo ponto.
6. Durante a carga, a estrutura fica à vista, com campos e ações que mudam algo parados e ligados ao aviso de carregamento (antes, a
   carga escondia a página): o fim da carga refaz os campos, e o que se digitasse sumiria.
7. Composição em linhas, sem tabela que role para o lado; container queries em rem (acompanham o texto).

**Textos para aprovação (mudam o que a pessoa lê antes de confirmar; a operação é a mesma).**

- Recusar: "Recusar a solicitação de {e-mail}? A pessoa não recebe acesso de instrutor. Esta tela não tem como reabrir uma
  solicitação recusada, e a pessoa não consegue pedir de novo." (antes: "Recusar esta solicitação de acesso?")
- Remover acesso: "Remover o acesso de {e-mail} à {turma}? A pessoa deixa de acompanhar a {turma}; o acesso a outras turmas não
  muda. Se ela for quem envia os lembretes automáticos da {turma}, eles param até outro remetente ser configurado. Esta tela não tem
  como devolver o acesso depois." (antes: "Remover o acesso deste instrutor à turma selecionada?")
- Desvincular: "Desvincular a conta {e-mail da conta} de {aluno} (ID Canvas {id}) na {turma}? O aluno continua na turma, com as
  notas; só a conta do portal deixa de estar ligada a ele. Ele poderá se vincular de novo pelo e-mail do Canvas no próximo acesso."
  (antes: "Desvincular este aluno? Ele poderá se vincular de novo pelo e-mail no próximo acesso.")

**Riscos (revisão adversarial).** Nenhum BLOCKER. IMPORTANT, anteriores à rodada e só propostos (mudam o fluxo): Vincular dá
acesso às notas da turma sem pergunta, com o seletor começando na primeira turma da lista; um vínculo errado pode ser removido, mas
a tela não vincula de novo a mesma pessoa. IMPORTANT, corrigidos nesta rodada: o andamento de uma remoção aparecia na linha da mesma
pessoa em outra turma; o seletor de turma do pedido voltava à primeira turma quando a tela era refeita (no andamento de Vincular,
depois de uma falha ou de outra ação) — uma nova tentativa iria para a turma errada —, e agora guarda a escolha de cada pedido, da
pessoa da sessão; a consulta pedida de um erro levava o foco a outro controle ou o perdia; o texto digitado na busca sumia no fim da
carga; a nota dos instrutores dizia que administradores "não aparecem" na lista (um admin com vínculo de instrutor aparece). MINOR: a
atualização automática liga sem pergunta (como antes); a tela não diz quem envia os lembretes automáticos (backend); o que foi
digitado e não enviado num formulário se perde quando uma operação termina (como antes); o nome da turma fica cortado no seletor
fechado do pedido (o código vem primeiro e aparece inteiro; a lista aberta mostra o nome inteiro); e o `pattern` do código da turma
(`[A-Za-z0-9-]{3,32}`, anterior à rodada) é inválido no modo de expressão regular que o navegador usa nesse atributo (`v`, que exige o
hífen escapado): o navegador ignora a validação na tela e registra um erro no console, e o código errado só é recusado pelo servidor
(400) — corrigir (`[A-Za-z0-9\-]{3,32}`) muda o fluxo (a mensagem nativa do navegador antes do envio) e fica para aprovação.

**Validação.** RED na árvore de antes (a cópia do worktree no início da rodada), com os testes novos: unidade 10 de 10 por
asserção (AA1–AA10); navegador 11 de 12 por asserção — o AB11 (papéis) passa nos dois lados (preservação) —, nenhum por tempo
esgotado. Quatro achados durante a rodada, cada um com RED por asserção na versão sem a correção e GREEN depois: o texto digitado
na busca de alunos sumia no fim da carga dos acessos (pego por `tests/student-view-browser.mjs`; AA3 e AB10); a consulta pedida de
um erro levava o foco ao "Atualizar" das solicitações (o mesmo `data-action`) ou o perdia em "Consultar de novo" (AB4, AB6, AB10);
o andamento de uma remoção aparecia na linha da mesma pessoa em outra turma, com a turma da tela no texto (AB7); o seletor de
turma do pedido voltava à primeira turma quando a tela era refeita, e uma nova tentativa ia para a turma errada (AB2, AA2; a
escolha de quem saiu não fica para quem entrou: AB7). Testes: `tests/admin-access-page.mjs` (AA1–AA10: composição e escopo,
solicitações, carga e erro, instrutores, alunos e contas, formulários, andamento, recusa e dúvida das sete operações, sem turmas,
perguntas e avisos, troca de pessoa e de turma e respostas antigas), `tests/admin-access-page-browser.mjs` (AB1–AB12, com API
simulada: composição e superfície única, vincular, recusar, remover acesso com 403, 404, rede e 503, alunos e contas,
configurações e criação, troca de turma e de pessoa durante as operações, 11 combinações de largura, texto e zoom com dados
extensos, teclado e contorno, estados, papéis, formas e ênfases), `tests/architecture.mjs` (seção 38 escopada; classes antigas sem
estilo; a seção 37 termina na 38) e `tests/admin-access-browser.mjs` (os textos novos; 403 e 409 na tela; a espera pelo fim da
carga, porque o título aparece já durante ela). Sincronização de testes antigos, sem mudar asserções: `feedback-lifecycle-browser`
(C7.5), `import-lifecycle-browser`, `teacher-import-browser` (IB6, IB7b) e `teacher-reminders-browser` (RB7b) usavam o aviso
"Configurações da turma atualizadas." como sinal do fim do boot; o aviso agora é só de quem salvou, e a espera é pela pessoa nova
no topo ou pela nova leitura do /me. Nos testes novos, as esperas são pela tela quieta (sem andamento nem carga), com limite e sem
falhar: depois do primeiro carregamento, `waitForLoadState("networkidle")` volta na hora; três rodadas sob carga paralela
passaram. Suítes: unidade 371 de 371 e navegador 163 de 163, no fuso local e em UTC (antes da rodada: 359 e 151). Mutações: 171 de
171 mortas por asserção, nenhuma por tempo esgotado (a única sobrevivente de uma rodada anterior, “campos com a largura do
navegador”, era uma regra redundante: saiu do CSS, provada por equivalência); as anteriores aplicáveis — fechamento da Expansão 7
(144 de 144), Expansão 6 (119 de 119), C7.4 (21 de 21) e C7.5 (37 de 37) — e as 736 âncoras das rodadas anteriores, uma vez cada
(a de "palavras longas sem quebra", da Expansão 7, passou a se repetir na seção 38 e ganhou o container no texto; a mutação é a
mesma). Equivalência no navegador, antes × depois: HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco
em 439 cenários, 94.195 elementos, idênticos (72 das outras telas do aluno, do instrutor e do admin; 140 do Feedback de instrutor
e admin; 8 da área Feedbacks; 80 do painel e das telas abertas a partir dele; 58 de Publicações da turma; 20 do detalhe do aluno;
61 de Lembretes e Lembretes em lote, nas cenas das capturas da Expansão 7), mais as 76 cenas de Atualizar notas (38.840
elementos), idênticas. Capturas: 71 pares em `~/Desktop/escola-da-nuvem-capturas-piloto/expansao-8-turmas-acessos/` (com
`index.html`, `results.json`, `densidade.json` e `SHA256SUMS.txt`) e o ZIP de revisão `expansao-8-turmas-acessos.zip` (só PNG, o
índice, as métricas e as somas; dados sintéticos). **Medidas** (`densidade.json`, com 9 pedidos pendentes, 10 instrutores e 25
alunos na busca, antes → depois): o primeiro Vincular sobe (1440: 666 → 315 px; 390: 1.197 → 612; 390 com texto a 200%: 2.678 →
1.827), e a busca de alunos também no desktop (3.054 → 2.298). A página cresce (1440: 5.233 → 6.423 px; 390: 7.627 → 11.566; 390 a
200%: 13.312 → 29.005; 320 a 250%: 17.920 → 45.811): cada aluno mostra o ID do Canvas, o e-mail no Canvas, a conta do portal e as
ações sem rolagem lateral (a altura mediana passa de 79 para 248 px em 390; antes, a tabela rolava para o lado em 1280 px ou menos
e com texto ampliado, com até 67 controles fora da vista e 109 px de rolagem lateral na página em 320 a 250%). Remover acesso fica
onde estava no desktop (1.514 → 1.389 px) e desce com texto ampliado (390 a 200%: 5.940 → 7.632), depois das solicitações. Criar
uma turma, que ficava no topo, vai para o fim (1440: 428 → 6.189 px com os 25 alunos na tela; sem busca, a página inteira tem
2.482 px, antes 2.143): é a tarefa mais rara. Nas 71 capturas, nenhuma rolagem lateral nem controle fora da vista (antes: até 67),
nenhuma chamada para fora da origem e um pedido por operação, na turma certa.

## Consolidação da Expansão 8 (8.1): Vincular com a turma escolhida e o atalho Criar turma

Com a Expansão 8 aprovada visualmente, dois ajustes autorizados (GO_WITH_CONDITIONS), sem redesenhar a tela e sem mudar backend,
contratos ou regras de autorização.

**Vincular com a turma escolhida.** Antes, o seletor de cada pedido começava na primeira turma da lista e Vincular ficava livre e
sem pergunta: um clique dava acesso à primeira turma. Agora o seletor começa em "Selecione uma turma" (valor vazio, nenhuma turma
marcada, `required`), e Vincular fica parado, com o motivo à vista e ligado ao botão ("Escolha a turma para vincular."), até a
escolha. A escolha é de cada pedido e da pessoa da sessão (uma variável do `app.js`, sem chave nova no `state.js` e sem
preferência guardada): o redesenho a mantém; a lista de turmas relida não escolhe por ninguém; uma resposta antiga não a troca;
"Selecione uma turma" a desfaz; uma turma que sai da lista volta ao começo; a escolha de um pedido não vale para outro; outra pessoa
na aba começa sem escolhas. Antes de enviar, o `app.js` confere a escolha deste pedido, feita pela pessoa da sessão, e que não há
outra operação em andamento (o botão parado não é a única proteção); o handler confere o pedido pendente e a turma da lista atual
e pergunta.

**A pergunta (o `confirm()` nativo, no mesmo ponto das outras).** "Vincular {e-mail} à turma {código — nome}? A pessoa passa a
acompanhar a {código} com as permissões de instrutor: ver as notas de todos os alunos, publicar e restaurar notas, marcar
desistências e enviar lembretes por e-mail aos alunos dessa turma. O acesso a outras turmas não muda." O texto sugerido ("poderá
acessar as informações dessa turma conforme as permissões de instrutor") foi ajustado ao contrato: o vínculo `TEACH#` libera, na
turma, todas as rotas que exigem instrutor (`require(teach)` em `backend/portal.py`: o relatório da turma e Notas da turma, o foco,
a prévia, a publicação e a restauração, a participação, os lembretes individuais e em lote) — "acessar as informações" esconderia
que a pessoa passa a publicar notas e a mandar e-mails aos alunos. Cancelar não envia nada nem começa andamento; confirmar envia um
pedido só, com a pessoa e a turma da pergunta (a mesma rota e o mesmo corpo, `{ userId }`). O andamento, o sucesso com a pessoa e a
turma, o erro na linha, a recusa (403, 404, 409, 429), a dúvida (rede, 5xx) com a consulta segura e o isolamento da Expansão 8 não
mudaram.

**Atalho Criar turma.** Um link discreto no cabeçalho, "Criar turma" (o `.text-link` de "Atualizar" e de "Ver no histórico", da
Expansão 5), com o destino dito à leitura assistiva ("— ir para o formulário, no fim da página"). É uma âncora para o título da
seção que já existe (`#aa-create-title`, com `tabindex="-1"`): o navegador leva a vista e o foco ao título, sem pedido e sem
redesenho (o que foi digitado continua), e o recuo de rolagem da raiz desconta a barra inferior no celular. Nenhum formulário novo;
nenhuma regra de CSS nova.

**Validação.** RED na árvore de antes (a Expansão 8 aprovada, cópia do início da rodada), por asserção e sem tempo esgotado: na
unidade, AA1, AA2, AA8, AA9 e os novos AA11 e AA12; no navegador, AB2, AB7, os novos AB13, AB14 e AB15 e o teste antigo de Turmas
e acessos (AB9 e AB11 passam nos dois lados: preservação). Testes da Expansão 8 ajustados ao comportamento autorizado, sem
enfraquecer: AA2 e AA8 (o seletor com "Selecione uma turma" e `required`), AA3 e AA7 (as vistas com as turmas escolhidas pelo
admin: sem escolha, Vincular para de propósito), AA9 (a pergunta e o pedido com os mesmos identificadores; cancelada, nada sai),
AB2, AB3, AB4, AB7 e AB10 ("tudo livre de novo" aceita só Vincular parado pelo motivo de escolher a turma, nunca pelo andamento
nem pela carga), AB9 (escolhe a turma antes de percorrer o teclado: parado, Vincular sai da ordem do Tab), AB10 (as 14 turmas e
"Selecione uma turma"), AB11 (sem a tela, sem o atalho) e o teste antigo (a pergunta de Vincular antes da de Remover acesso).
Suítes: unidade 373 de 373 e navegador 166 de 166, no fuso local e em UTC (antes da rodada: 371 e 163). Mutações: 202 de 202
mortas por asserção, nenhuma por tempo esgotado: as da Expansão 8 com as âncoras no código da 8.1 (“sem turmas, Vincular livre”
passou a fazer parte de “Vincular livre sem turma escolhida”; “vínculo com a turma do menu” foi para o `app.js`, onde a turma
agora é lida) e as novas da 8.1; as anteriores aplicáveis — fechamento da Expansão 7 (144 de 144), Expansão 6 (119 de 119), C7.4
(21 de 21) e C7.5 (37 de 37) — e as 736 âncoras das rodadas anteriores, uma vez cada. Equivalência no navegador, antes × depois:
HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 439 cenários, 94.195 elementos, idênticos (72
das outras telas do aluno, do instrutor e do admin; 140 do Feedback de instrutor e admin; 8 da área Feedbacks; 80 do painel e das
telas abertas a partir dele; 58 de Publicações da turma; 20 do detalhe do aluno; 61 de Lembretes e Lembretes em lote), mais as 76
cenas de Atualizar notas (38.840 elementos), idênticas. CSS: nenhuma regra mudou (`styles.css` igual, byte a byte). Capturas: 27
pares, só dos estados que mudaram, em `~/Desktop/escola-da-nuvem-capturas-piloto/expansao-8-1-consolidacao/` e o ZIP
`expansao-8-1-consolidacao.zip`.

**Limitações.** Vincular passou a pedir dois passos (escolher e confirmar). A escolha não sobrevive a recarregar a página (não é
guardada, de propósito). Com o seletor fechado, o nome da turma continua cortado (o código vem primeiro); a pergunta mostra código e
nome inteiros. Continuam como propostas, cada uma com aprovação própria: vincular de novo um pedido aprovado (o backend aceita); a
pergunta ao ligar a atualização automática; dizer quem envia os lembretes automáticos (backend); o `pattern` do código da turma.

**Estado final (gate da Expansão 9, 14/10/2026).** Os dois ajustes foram aprovados nas capturas. A regressão final foi conferida
sobre o código final da 8.1 (o mesmo do fim da cadeia, das 04:43 às 04:55; depois dela só este documento mudou): unidade 373 de 373
e navegador 166 de 166, no fuso local e em UTC; mutações 202 de 202 e as anteriores aplicáveis (144, 119, 21 e 37) por asserção; as
736 âncoras; equivalência em 439 + 76 cenas, idênticas. Nenhum BLOCKER ou IMPORTANT novo; a Expansão 9 começou depois disso.

## Decisões da Expansão 7

1. Lembretes como uma jornada em duas telas: o remetente e como enviar ("Lembretes"); a decisão e o envio ("Lembretes em lote"). A
   prévia e o envio individuais ficam no detalhe do aluno, para a expansão dele.
2. Só o que o contrato traz: a situação do remetente por `enabled` e `ready`, com o motivo do servidor; nada sobre o envio automático
   da AUTO-5 (o portal não lê `REMINDER_SETTINGS` nem a próxima execução); nenhuma contagem que o servidor não dá.
3. Rótulos que dizem o que o contrato garante: "Aceito pelo serviço de envio" (não "Enviado"), "Sem confirmação do envio" (não
   "Falhou"), "Lembrete já registrado nesta publicação" (não "Já contatado") e "Envio interrompido por conflito" (fechamento; não
   "Notas atualizadas durante o envio" nem "a turma mudou": o servidor usa o mesmo motivo para qualquer conflito na reserva).
4. As mesmas operações (chamadas, corpos, confirmação e guardas C7.3/C7.4), com andamento e resultado onde a pessoa está e com o
   foco; recusa dita como recusa e dúvida como dúvida; a dúvida e o conflito levam à nova consulta antes de enviar de novo (sem
   nova tentativa automática).
5. A pergunta do envio diz a turma, quantos, quem envia, que o envio não volta e quantos ficam de fora (a mesma confirmação, no
   mesmo ponto).
6. Composição em rem pela largura da tela; a única superfície é a da ação; nada escondido.

## Fechamento da Expansão 7 (o significado dos resultados e os avisos de sucesso)

Com a Expansão 7 aprovada visualmente, o fechamento conferiu, só por leitura, o contrato de `send-reminders`
(`backend/portal.py::_reminder_batch` e `handler`, `backend/reminders.py::reserve_reminder` e `send_reserved_reminder`,
`backend/repository.py::transaction` e `put`) e corrigiu o que a tela afirmava além dele. Backend, OpenAPI, infraestrutura, a
deduplicação e a elegibilidade não mudaram. Prova local, com o código real do backend e os dublês dos testes do backend, sem AWS:
409 e 403 sem chamada ao SES nem registro; conflito por outra reserva do mesmo aluno com a publicação igual; turma alterada sem
publicação nova; publicação nova; colisão de transação sem mudança de dados; recusa certa e incerta do SES, as duas `failed`; 500
depois de 2 aceites; outra reserva antes da avaliação (`already-sent`, sem corte).

| Resultado | Quando | Garantia real | Na tela |
|---|---|---|---|
| 403 | sem acesso à turma, envio desabilitado na instalação, e-mail não institucional | antes do primeiro aluno: nenhuma reserva, nenhuma chamada ao SES | "Nenhum lembrete foi enviado." e o motivo (mantido) |
| 409 | sem publicação; publicação diferente da prévia (`expectedPublicationId`); remetente não pronto | idem; não há 409 depois do primeiro aluno (no laço, o conflito na reserva vira `publication-changed`, a falha do SES vira `failed`, e qualquer outro erro, 500) | "Nenhum lembrete foi enviado.", o motivo e "Consultar destinatários de novo" (mantido) |
| 429 | só o limite do API Gateway (50/s, rajada 100), antes da Lambda; a rota não tem 429, e o `api.js` não repete POST | a Lambda não roda | "Nenhum lembrete foi enviado." e o motivo (mantido) |
| 5xx, rede, tempo esgotado | erro depois de enviar (ex.: gravar depois do aceite do SES), os 30 s do API Gateway com a Lambda ainda rodando, resposta perdida | parte pode ter sido enviada, e o envio pode continuar | "Não foi possível confirmar o envio." e a nova consulta antes de enviar de novo (mantido) |
| `sent` | o SES devolveu o MessageId; o registro fica `sent` | aceito pelo serviço de envio, não entregue | "Aceito pelo serviço de envio" (mantido) |
| `failed` | recusa certa (registro `failed`: o aluno pode receber de novo) ou sem resposta (`unknown`: fica bloqueado) | o lote não diz qual | "Sem confirmação do envio" e o que a nova consulta mostra (mantido) |
| `skipped` com motivo | avaliado antes da reserva, ou desistência confirmada na reserva | este envio não mandou lembrete ao aluno | o motivo (mantido) |
| `skipped`, `publication-changed` | o primeiro conflito na reserva — outra reserva do mesmo aluno (outro lote, o envio individual ou o automático), outra transação na turma ao mesmo tempo (todo cancelamento da transação vira conflito), publicação nova ou outra alteração da turma —, repetido para todos os seguintes, mesmo os que ficariam de fora por outro motivo | este envio não mandou lembrete a eles; não prova mudança de publicação; o aluno disputado pode ter recebido de outro envio | "Envio interrompido por conflito" e as causas possíveis, sem afirmar qual (corrigido) |

**Textos.** Mantidos: "Nenhum lembrete foi enviado." nos 4xx (o contrato garante que nada saiu), "Não foi possível confirmar o
envio." nos 5xx e sem resposta, "Aceito pelo serviço de envio", "Sem confirmação do envio" e os motivos. Corrigidos: "Interrompido:
a turma mudou durante o envio" → "Envio interrompido por conflito", com o alerta "O servidor encontrou um conflito ao registrar um
lembrete e parou o envio; este envio não mandou lembrete para N alunos (em “Envio interrompido por conflito”). A causa pode ser outro
envio para a turma ao mesmo tempo, inclusive o automático, uma publicação nova das notas ou outra alteração na turma; o portal não
sabe qual. Antes de enviar de novo, consulte os destinatários: a nova consulta mostra quem já tem lembrete registrado, inclusive por
outro envio, e quem ainda pode receber. Se as notas mudaram, ela já é da publicação nova, em que quem recebeu agora pode aparecer de
novo." (antes: "a turma mudou durante o envio" e "ficaram sem lembrete nesta tentativa"); "Envio em lote concluído. Confira o
resultado por aluno." → "Chegou a resposta do envio em lote. Confira o resultado por aluno." (o lote pode voltar interrompido);
"Confira a mensagem de verificação no seu e-mail institucional e depois verifique novamente." → "Chegou a resposta do pedido de
confirmação. Confira a situação do seu remetente." (o remetente pode já estar pronto ou parado por outro motivo). Quantidades e
grupos, como o servidor devolve.

**Avisos de sucesso.** O resultado do envio e a situação depois da verificação ficam na tela e recebem o foco que o render tirou do
andamento; o título do resultado descreve as quantidades (`aria-describedby`). Sem o foco ali — a pessoa o levou a outro controle, ou
ao `<main>` num clique na página, durante a operação —, nada anunciaria o resultado: o render refaz `#app`, e a única região viva que
persiste é a dos avisos. Por isso o aviso temporário fica só nesse caso: depois do render, o handler pergunta a quem chamou
(`announce`), e a composição responde pelo foco (`focusElsewhere`); o handler continua sem DOM. O mecanismo global de avisos, a
contagem de `notice()` (4 no handler), a confirmação pelo servidor, o comportamento fora da tela (nada: C7.3 e C7.4) e o sucesso
parcial não mudaram.

Validação: RED na árvore de antes, com os testes do fechamento — falham por asserção o TR8, o TR11 e o teste C7.3 do aviso (unidade),
o RB2, o RB4, o RB6 e o RB15 e o teste antigo do lote, no texto do aviso (navegador); nenhum por tempo esgotado. O TR7, com o 429
como recusa, passa nos dois lados (preservação). Testes: `tests/teacher-reminders.mjs` (TR7 com o 429; TR8 com o conflito sem causa,
o singular e a descrição do título; TR11, novo: o aviso só quando `announce` diz, depois do render, os dois textos, o padrão de antes
e nada para a resposta antiga), `tests/teacher-reminders-browser.mjs` (RB2 e RB4 sem aviso, com o foco e a descrição; RB6 com o
conflito; RB15, novo: outra reserva do mesmo aluno no meio do envio — o conflito, as quantidades, a nova consulta com o registro do
outro envio — e o aviso com o foco em outro lugar, no envio e na verificação), `tests/handlers.mjs` (o texto do aviso no C7.3) e
`tests/reminders-batch-browser.mjs` (com o foco no `<main>` depois do clique no botão parado, o aviso com o texto novo). Suítes:
unidade 359/359 e navegador 151/151, no fuso local e em UTC. Mutações: 144 de 144 mortas por asserção (as 119 da Expansão 7, duas com a âncora no código novo, e 25 do fechamento), nenhuma por tempo esgotado; as da C7.4 (21 de 21) e da C7.5 (37 de 37); as 592 âncoras das rodadas anteriores continuam aparecendo uma vez cada. Equivalência no navegador, antes × depois: HTML, estilo computado de todos os elementos (com `::before`/`::after`) e foco em 383 cenários, 85.134 elementos, idênticos (77 das outras telas do aluno, do instrutor e do admin; 140 do Feedback de instrutor e admin; 8 da área Feedbacks; 80 do painel e das telas abertas a partir dele; 58 de Publicações da turma; 20 do detalhe do aluno com a prévia e o envio individuais), mais as 76 cenas de Atualizar notas (38.840 elementos), idênticas.
Capturas, só dos estados que mudaram (10 pares): `~/Desktop/escola-da-nuvem-capturas-piloto/expansao-7-fechamento/`.

**Pendências.**

- Uma resposta 200 sem a lista de resultados (corpo truncado; o backend sempre devolve JSON) deixaria a prévia na tela, sem aviso
  nem erro (antes, o aviso "concluído"). Não tratada: é anterior à Expansão 7.
- Em Publicações da turma (Expansão 5), o resultado da restauração não tem aviso mesmo com o foco em outro lugar; alinhar à regra
  do fechamento é rodada própria.
- O envio individual, no detalhe do aluno, continua com o aviso de sucesso e o erro no aviso temporário (fora do escopo).
- `publication-changed` não diz a causa, e `failed` não separa recusa de dúvida: limites do contrato.

## Decisões da Expansão 6

1. Tarefa, não painel: três etapas na ordem do trabalho (Arquivo do Canvas, Prévia, Publicação), sem wizard — tudo na mesma
   tela, numerado; a única superfície é a da ação seguinte.
2. O arquivo escolhido aparece uma vez, com os limites reais ao lado; o campo nativo fica fora da vista (o redesenho o
   recria), com o contorno de foco no rótulo. Conferir não publica, e a tela diz.
3. Prévia sem repetição: integridade, o que muda (só o que muda, com os nomes ao abrir), avisos e as atividades — com mais de
   6 sem nenhuma nota, essas atrás de "Mostrar" (à vista se alguma estiver marcada); Publicar antes dos resultados por aluno,
   com a confirmação dos removidos junto do botão e o motivo quando ele está parado.
4. As mesmas operações (pedidos, corpos, confirmação e pré-condições), com andamento e resultado onde a pessoa está: durante a
   publicação tudo da turma parado; erros na tela, ligados ao campo quando são do arquivo; a dúvida (rede, 5xx) diz que a
   publicação pode ter acontecido e leva à consulta da versão em vigor; o erro fica até a pessoa agir de novo (cancelar a
   pergunta não o apaga) e nunca passa para outra pessoa na aba; o aviso do portal como reserva, com a turma.
5. A pergunta da publicação diz a turma, o arquivo, a versão que sai e a consequência da sincronização (a mesma confirmação,
   no mesmo ponto).
6. Composição em rem pela largura da tela (acompanha o texto); nenhum controle fora da área visível; nada escondido em
   rolagem interna.

## Decisões da Expansão 5

1. Clareza operacional: primeiro o que vale agora (a versão em vigor, a única superfície), depois o registro por mês. Em
   vigor pelo id do relatório, nunca pela posição na lista.
2. Restauração dita como restauração: data original e data da restauração separadas e rotuladas, "versão restaurada",
   "Não está em vigor" nas mais recentes e a consequência da sincronização. Nada além do contrato (restaurações antigas de
   outras versões não ficam registradas e não aparecem).
3. Mudanças só com o que o contrato traz e não é zero; a comparação é com a versão que estava em vigor (base) e é dita
   quando não é a vizinha; o que tira algo do que os alunos veem leva o anel âmbar. Sem abrir e fechar: tudo cabe na linha.
4. A restauração de antes (confirm, pedido, recarga), com a pergunta dizendo qual publicação e a consequência; andamento
   parando todos os "Restaurar" da turma; resultado e erro na própria tela, com o foco; o aviso do portal como reserva,
   com a turma quando ela é outra.
5. Composição em rem pela largura da tela (acompanha o texto), sem tabela larga nem cartões; nenhuma ação fora da área
   visível.

## Decisões da Expansão 4

1. O painel como instrumento de acompanhamento: situação da turma com contagens que filtram a lista, foco da turma
   aberto ao lado e tabela de consulta; sem cartões iguais. Nenhum indicador sem dado: o único atalho novo ("Com
   atividades sem nota") é a contagem de um filtro que já existia.
2. Situação acadêmica por texto e forma, com o número de anéis igual ao número de médias abaixo da referência; crítico
   em âmbar (atenção acadêmica), não em vermelho (erro).
3. Médias com uma casa, como o aluno vê, sem nunca cruzar a referência na exibição; o CSV e as regras não mudam.
4. Resultado do salvamento do foco na própria seção, preso ao relatório; o aviso do portal fica como reserva.
5. Tabela por largura do painel em rem (acompanha o texto ampliado), não por largura da janela.
6. Os botões do painel quebram o texto em vez de passar da tela; sem reduzir fonte, sem esconder.

## Decisões da consolidação da Expansão 3

1. Prévia de 3 linhas para mensagem com mais de 4 na largura atual (medida no layout, não por número de caracteres: a
   mesma mensagem pode ser curta no desktop e longa no celular com texto a 200%); botão explícito para abrir e recolher;
   texto inteiro sempre no DOM.
2. Estado de abertura por id, preso à lista de "Meus feedbacks" (some com ela: outro usuário, turma ou tela).
3. Resultados do Feedback do aluno só no formulário (e no próprio item); o aviso temporário do portal não muda e
   continua servindo a instrutor, admin e às outras telas.
4. Duplicado é dito como duplicado; sem resposta do servidor, a tela diz que não conseguiu confirmar e por que enviar de
   novo não duplica.

## Decisões da Expansão 3

1. Feedback do aluno com a tarefa principal em destaque (formulário), acompanhamento e consulta ao lado (registro), sem
   copiar a estrutura das outras telas e sem capacidade nova: nada de resposta da equipe, histórico de status, edição,
   filtro ou total que o contrato não traz.
2. Problemas de validação junto do campo, todos de uma vez, com as regras do handler (que continua a regra); erros de
   servidor continuam no aviso do portal (o estado não guarda a mensagem; mudar isso mexeria no contrato de `state.js`).
3. Situação com o vocabulário do contrato ("Novo", como o admin vê), por texto e forma; ciano só para ação.
4. Instrutor e admin continuam na tela antiga pelo rodapé, e a área Feedbacks do admin não muda (redesenho próprio).

## Decisões da Expansão 2

1. Meu histórico como registro cronológico de consulta: identificação da publicação, datas e sequência, evolução das
   médias, mudanças relevantes, comparação compreensível e detalhes que abrem; sem gráfico nem linha do tempo decorativa.
2. Nada fora do contrato: a variação é a do backend (em relação à versão em vigor antes), nunca a diferença entre itens;
   o que falta no contrato é dito com palavras (sem comparação, sem média) e não aparece como número.
3. Instrutor ("Publicações da turma") e Feedback ficam como estavam.

## Decisões da 3.4.1

1. Recuperar no desktop a composição compacta do link do Canvas ao lado do título (densidade da 3.3), preservando
   todos os ajustes responsivos da 3.4, os três estados vazios e o link em linha própria no celular.
2. Alvo real de 44 px, sem reduzir a caixa; sem sobreposição entre a caixa do link e o texto ou outros controles; foco,
   ordem do teclado e clique verificados no navegador.

## Decisões da 3.4 (consolidação)

1. Melhorar 320×568 com texto a 200%: cabeçalho, identidade, seletor de turma, barra inferior e primeira tela.
2. Estados vazios separados: sem atividades na turma, filtro sem resultado, busca sem resultado.
3. Link do Canvas em linha própria até haver prova visual de que junto ao título não piora legibilidade e resposta.
4. Barra inferior: medida a alternativa de esconder os ícones do menu com texto ampliado (o aluno em 320×568 a 200%
   voltaria à barra fixa de 113 px e ganharia ~32 px na primeira tela, mas o admin em 390×844 a 200% voltaria à barra
   fixa de 165 px). Não adotada: o menu mantém ícones e o limite de 22% da 3.3; fica como opção para a aprovação.

## Decisões aprovadas para a 3.3

1. No desktop, aproximar o link do Canvas do título para reduzir a altura das linhas (sem altura fixa, sem truncar).
2. Filtros de situação no celular visíveis, com quebra em duas linhas; sem rolagem horizontal, sem select, sem menu
   oculto.
3. Estado vazio em dois cenários (sem atividades × filtro sem resultado); texto só para diferenciá-los.
4. Erro de carregamento com o título "Minhas atividades".
5. Limite da navegação em 22% (volta abaixo de 20%) como experimento, comparado com 25%/23%; sem item "Mais", sem
   reduzir fonte, sem mudar a ordem do teclado.

## Higiene do CSS (3.3, Expansões 2 a 9 e consolidação transversal)

Removidas as 27 regras de `.ring` (o anel de progresso que a V2 trocou pela régua de cobertura): nenhuma fonte gera a
classe e o único teste que a cita exige que ela não exista. Equivalência medida no navegador: estilo computado de todos
os elementos, com `::before` e `::after`, em 56 telas/estados (três papéis, 320–1440 px, texto a 200%, erro,
carregamento, sem atividades, 40 atividades), idêntico antes e depois. Outras 13 classes já não eram geradas antes do
piloto (`accent`, `brand-mark`, `brand-type`, `chart`, `chart-column`, `chart-track`, `class-entry`, `class-form`,
`empty-icon`, `live-dot`, `pending-section`, `pending-unit`, `small-button`); ficam para uma limpeza própria (`pending-unit` saiu na
Expansão 4; as outras 12, na consolidação transversal). Tamanho de
`styles.css`: HEAD 78.936 B (15.740 gzip); 3.2 121.303 B (25.100 gzip); 3.3 119.803 B (25.014 gzip); 3.4 119.971 B
(25.106 gzip); 3.4.1 121.228 B (25.481 gzip); Expansão 2 132.960 B (27.527 gzip; seção 32 com 10.476 B, comentários
incluídos); Expansão 3 148.130 B (30.616 gzip; +11,4% e +11,2% sobre a Expansão 2; seção 33 com 15.098 B, comentários incluídos);
consolidação da Expansão 3 150.122 B (31.157 gzip; +1.992 B e +541 B, +1,3% e +1,8%; seção 33 com 17.026 B contada a
partir do título, 15.034 B na Expansão 3 pela mesma conta).

Expansão 2: saíram as três regras de `.history-table .h-kc` e `.h-lab` (células de KC e LAB que só o histórico do
aluno gerava; nenhuma fonte gera mais essas classes). As áreas `kc lab` do card do instrutor abaixo de 1024 px ficam no
modelo, para não mudar o espaçamento dele. Equivalência medida no navegador: HTML e estilo computado de "Publicações da
turma" (instrutor e admin, 320–1440 px, texto a 200%) e de todas as outras telas, idênticos antes e depois.

Expansão 3: nenhuma regra antiga de Feedback saiu. As seções 25 e 26 continuam servindo ao Feedback de instrutor e admin
(rodapé) e à área Feedbacks; a seção 33 neutraliza, só sob `.student-feedback`, o que delas pesaria na tela do aluno
(pílula do tipo, moldura de cartão, rodapé em coluna no celular, botão sem quebra de linha). Quando instrutor e admin
forem expandidos, essas camadas saem juntas. Consolidação: só a seção 33 cresceu (prévia, motivo da falha, foco dos
resultados, linha de ações vazia); as duas regras de foco da confirmação viraram uma só para todos os resultados.

Expansão 4: saíram as regras da lista e dos cartões do painel antigo, que só ele gerava: `.student-table` e `.cell-*`
(tabela ↔ cartões, seção 22), `.student-tools`, `.metrics-filters`, `.metric-neutral`, `.pending-count`, `.portal-ok`,
`.pending-unit` (já sem uso antes do piloto), as três de `#students-heading` (a seção 34 tem as suas) e `.focus-editor`
(seção 09; `.activity-module summary` continua). `.metric-filter` fica (área Feedbacks do admin). Um teste confere que
nenhuma fonte gera essas classes e que nenhuma regra as alcança; a equivalência no navegador mostra as outras telas
iguais. Tamanho de `styles.css`: 150.122 B (31.157 gzip) → 170.406 B (34.685 gzip), +20.284 B e +3.528 B (+13,5% e
+11,3%); seção 34 com 25.927 B contada a partir do título (21.182 B sem comentários); ≈5,6 KB de regras antigas saíram. A função `filterMetric` do
`ui.js` ficou sem uso (o painel tem os seus atalhos); não foi apagada nesta rodada para não mexer no `ui.js`.

Expansão 5: saíram as regras da tabela e dos cartões antigos de Publicações da turma, que só a tela antiga gerava:
`.history-table` e `.h-date`, `.h-status`, `.h-file`, `.h-changes`, `.h-action` (seção 22: os cartões abaixo de 1024 px e a
quebra de "O que mudou" e "Arquivo" no desktop, 2.332 B). Um teste confere que nenhuma fonte gera essas classes e que
nenhuma regra as alcança; a equivalência no navegador mostra as outras telas iguais. Tamanho de `styles.css`: 170.406 B
(34.685 gzip) → 182.073 B (35.955 gzip), +11.667 B e +1.270 B (+6,8% e +3,7%); seção 35
com 14.024 B contada a partir do título (11.516 B sem comentários).

Expansão 6: saíram as regras da tela antiga de Atualizar notas, que só ela gerava: `.steps` (a barra de etapas, inclusive a
monoespaçada e o ajuste do celular), `.drop-zone`, `.activity-options`, `.publish-footer` (e o ajuste do celular junto de
`.form-footer`, que fica), `.removal-warning`, `.import-warnings` e a seção 24 inteira (`.integrity-grid`, `-roster`,
`-checks`, `-critical`, `-warnings`): 4.065 B. Um teste confere que nenhuma fonte gera essas classes e que nenhuma
regra as alcança (`.next-steps`, do painel do aluno, continua); a equivalência no navegador mostra as outras telas iguais.
Tamanho de `styles.css`: 182.073 B (35.955 gzip) → 197.752 B (38.634 gzip), +15.679 B e
+2.679 B (+8,6% e +7,5%); seção 36 com 19.743 B contada a partir do título
(16.765 B sem comentários). A seção foi compactada depois de pronta (grupos com `:is()` só de
classes simples, os parágrafos com a cor do conteúdo explícita, porque a regra global de `p` é secundária); a compactação foi
provada no navegador: estilo computado de todos os elementos em 74 cenas, idêntico antes e depois.

Expansão 7: nenhuma regra saiu nem mudou — a seção 37 entrou no fim e a folha antes dela é a mesma, byte a byte. As regras que as
duas telas antigas usavam são genéricas e servem a outras telas (`.panel`, `.table-scroll`, `.button`) ou ao detalhe do aluno, que não
mudou (`.reminder-panel`, `.email-preview`). Tamanho de `styles.css`: 197.752 B (38.634 gzip) → 207.446 B (40.017 gzip), +9.694 B e
+1.383 B (+4,9% e +3,6%); seção 37 com 9.693 B contada a partir do título (7.605 B sem comentários) e 57 regras, todas sob
`.teacher-reminders` (1.405 → 1.462 regras na folha).

Fechamento da Expansão 7: nenhuma regra mudou (`styles.css` igual, byte a byte).

Expansão 8: saíram as regras da tela antiga de Turmas e acessos, que só ela gerava: `.approve-form` (cinco na seção 13 e duas no
ajuste do celular; a classe continua só como marca do formulário do pedido, que o `app.js` envia) e `.stack-form .checkbox-line`
(duas). Um teste confere que nenhuma regra alcança essas classes, que nenhuma fonte gera `checkbox-line` e que só o `app.js` e
`pages/access.js` citam `approve-form`; a folha antes da seção 38 é a de antes sem essas regras (e o título da seção 13 sem
`.approve-form`). Uma regra da seção 38 que sobreviveu às mutações saiu por redundante (campos na largura do rótulo: os rótulos em
grade já esticam o campo), provado com HTML, estilo computado e foco idênticos nas 71 cenas das capturas. Tamanho de `styles.css`:
207.446 B (40.017 gzip) → 218.485 B (41.624 gzip), +11.039 B e +1.607 B (+5,3% e +4,0%); seção 38 com 11.694 B contada a partir do
título (9.213 B sem comentários) e 79 regras, todas sob `.admin-access` ou `.layout:has(.admin-access)` (1.462 → 1.532 regras na
folha).

Expansão 9: saíram as regras da tela antiga da área Feedbacks, que só ela gerava: `button.feedback-card` (o cartão-botão da lista;
o envio pelo rodapé usa `li.feedback-card`, que fica), `.fb-filters`, `.fb-summary` e `.fb-actions` (seção 25 e o ajuste do
celular): 11 regras. Um teste confere que nenhuma fonte gera essas classes e que nenhuma regra as alcança. As classes que o detalhe
continua usando (`.fb-detail`, `.fb-description`, `.fb-facts`, `.fb-detail-attachments`, `.fb-status`) ficam, com a seção 39 por
cima; `.metric-filter` fica (`filterMetric`, sem uso no `ui.js`, ainda a gera). Tamanho de `styles.css`: 218.485 B (41.624 gzip) →
230.178 B (43.426 gzip), +11.693 B e +1.802 B (+5,4% e +4,3%); seção 39 com 12.397 B contada a partir do título (9.796 B sem
comentários) e 74 regras, todas sob `.admin-feedback` ou `.layout:has(.admin-feedback)` (1.532 → 1.595 regras na folha).

Consolidação transversal: saíram as regras das 12 classes legadas sem fonte (32 regras e 3 seletores em listas, seções 03, 04, 06,
08, 11, 12, 16, 17 e 21), `.metric-filter` com `filterMetric` (seção 22 e `ui.js`) e as 231 declarações sempre vencidas pela mesma
regra adiante (seções 03–25 e uma da 33), com os 3 blocos `@media` que ficaram vazios. Nenhuma regra mudou de lugar, nenhum
seletor nem especificidade mudou; um teste confere que nenhuma fonte gera as classes legadas, outro que `filterMetric` e
`.metric-filter` não existem, e outro que nenhuma declaração repete o valor da anterior com o mesmo seletor e contexto. Tamanho de
`styles.css`: 230.178 B (43.426 gzip) → 219.237 B (41.966 gzip), −10.941 B, −4,8% e −1.460 B, −3,4%; 1.595 → 1.515 regras;
equivalência no navegador (estilo computado de todos os elementos, com `::before`/`::after`) em todas as telas, idêntica antes e
depois.

## Limitações

- O conteúdo mudou em "Meu desempenho", "Minhas atividades", "Meu histórico", no Feedback do aluno, no Painel do instrutor, em
  Publicações da turma, em Atualizar notas, em Lembretes, em Turmas e acessos e na área Feedbacks do admin. As outras telas já
  têm a casca nova, mas o conteúdo antigo (fonte de reserva, cartões iguais, LAB em âmbar nos gráficos); isso some na expansão.
  Os dois botões do painel que passavam da tela com texto a 200% em 320 px foram corrigidos na Expansão 4.
- Painel do instrutor: no celular, a Situação da turma e o Foco da turma abertos empurram a lista (~200 px com texto
  normal, ~1.000 px com texto a 200%); o atalho "Ver todos os alunos" leva a ela. Em 1024 px a Situação e o Foco ficam
  empilhados (lado a lado espremeriam as três situações). O detalhe do aluno, "Notas da turma" e a "Visão por atividade"
  ainda mostram médias com duas casas (o painel mostra uma, como o aluno). Regras que não mudaram e continuam valendo:
  "Salvar foco da turma" fica habilitado sem mudança (salva de novo, com nova versão) e parado sem nenhuma atividade (não
  dá para limpar o foco pela tela, embora o backend aceite); "Consultar atualização" descarta um foco ainda não salvo
  (agora avisado por "Alterações ainda não salvas"); "Menor média geral primeiro" ordena por um número que a tabela não
  mostra (a média de KC e LAB) e põe quem não tem média primeiro. O erro 409 do foco pede "Consulte a atualização", que
  fica na linha de atualização, não junto do erro. O anel de média abaixo usa o valor que o backend envia (duas casas):
  uma média bruta a menos de 0,005 da referência pode chegar como 70 e não ganhar o anel, com a situação "Atenção" (o
  mesmo vale para "Meu desempenho"). O carregamento continua "Carregando sua turma…" (texto comum às telas).
- Publicações da turma: a versão em vigor fica no alto e o histórico começa mais abaixo (1440: 401 → 553 px; 390: 493 →
  695 px); com versão restaurada e texto a 200% no celular a página cresce (320×568: 8.213 → 10.090 px), porque a região
  explica a restauração e a sincronização. A data da restauração só existe enquanto a última mudança foi a restauração (o
  relatório não traz restaurações passadas). A origem vem de quem publicou (`publishedBy`; a sincronização publica como
  `system:canvas-sync`); registro sem esse campo mostra só o arquivo. Datas e meses no fuso do navegador; a próxima
  verificação ("hoje às 18h") continua calculada no horário de Brasília (`ui.js`, como no resto do portal). A pergunta da
  restauração continua o `confirm()` nativo (texto, sem estilo). Todo 409 oferece "Consultar atualização", inclusive o
  bloqueio pelas validações de integridade, em que consultar só mostra o estado; com o erro na tela, "Consultar
  atualização" aparece duas vezes (na região e no erro), com a mesma ação. "Publicação restaurada." fica na tela enquanto o
  relatório for o mesmo. A lista é inteira (sem paginação), com os meses como títulos. Com sincronização ligada, uma
  restauração vale até a próxima verificação que encontrar diferença no Canvas (regra do backend, agora dita na tela).
- Atualizar notas: com o seletor do sistema aberto, um redesenho da tela (o relatório que termina de carregar, por exemplo)
  troca o campo e a escolha se perde — a tela mostra "Nenhum arquivo selecionado" e a pessoa escolhe de novo (já acontecia
  antes; a correção, um seletor fora da área redesenhada como o das imagens do Feedback, muda a estrutura do `app.js` e fica
  proposta). O campo nativo, fora da vista, ainda diz "nenhum arquivo escolhido" à leitura assistiva (o nome escolhido vem
  na descrição dele). O aviso "Prévia pronta…" continua (é do handler) e cobre o canto da tela por 6,5 s. Durante a
  publicação, a turma fica parada nesta aba também para quem entrar nela (sem nenhum dado de quem saiu). As atividades sem
  notas só se recolhem com mais de 6 (até 6, a lista inteira, como antes). Com a sincronização ligada, a publicação manual
  vale até a próxima verificação que encontrar diferença no Canvas (regra do backend, agora dita na tela e na pergunta).
  Todo 409 da publicação oferece "Consultar atualização": o servidor usa o mesmo código para casos diferentes, e consultar
  não muda nada. Com texto a 200% no celular a página fica mais longa (390×844: 8.645 → 16.451 px; Publicar 8.179 → 8.328):
  cada aluno passa de 78 para 288 px nos resultados, porque médias, atividades sem nota e situação ficam à vista em linhas
  empilhadas (antes, a tabela rolava para o lado e a situação ficava fora da vista). A data da versão em vigor usa o formato
  curto do resto da tela (`date()`), como a da matrícula.
- Lembretes: o portal não mostra se a turma tem lembretes automáticos (AUTO-5) nem quando é a próxima execução — não há rota de
  leitura de `REMINDER_SETTINGS`. A frase de antes, "Publicar notas nunca dispara lembretes automaticamente.", continua verdadeira (o
  envio automático é agendado, não disparado pela publicação), mas não diz que pode haver envio automático; uma leitura só de
  consulta da configuração e da próxima ocorrência fica proposta (mexe no backend, rodada própria). O motivo `publication-changed` do lote vale
  para qualquer conflito na reserva (outra reserva do mesmo aluno, outra transação na turma ao mesmo tempo — inclusive o automático
  das 20h —, publicação nova, turma alterada) e se repete para todos os seguintes: a tela diz "Envio interrompido por conflito" sem
  afirmar a causa (fechamento). O `failed` do lote não distingue
  recusa certa de dúvida: a tela diz "sem confirmação" e explica o que a nova consulta mostra. O resultado do lote só existe na
  resposta: saindo da tela, ele se perde, e uma nova consulta mostra quem já tem registro (o contrato não tem histórico de envios). O
  aviso temporário de sucesso só aparece quando a pessoa levou o foco a outro lugar durante o envio ou a verificação (fechamento); o
  resultado na tela, com o foco, é o anúncio do caminho normal. Pedir a verificação de
  novo não reenvia a mensagem da AWS se a identidade já existe; se ela não chegou, é com a coordenação. Com a sessão expirada durante
  a verificação, a entrada pública aparece sem aviso (como antes: o handler descarta a resposta de quem saiu). A prévia e o envio
  individuais, no detalhe do aluno, continuam como antes: o erro do envio vai para o aviso temporário (a prévia recarrega e mostra a
  situação da entrega), e quem enviou e quando (`delivery.by`, `at`) não aparecem; ficam para a expansão do detalhe do aluno.
- Turmas e acessos: desde a 8.1, Vincular pede a turma escolhida no pedido e pergunta antes (o seletor começa sem turma); o
  andamento e o aviso dizem a turma, mas um vínculo feito na turma errada só pode ser removido — a tela não vincula de novo a
  mesma pessoa, porque o pedido continua aprovado e só os pendentes têm o formulário (o backend aceitaria; proposta nos próximos
  passos). A tela não diz se a pessoa é quem envia os lembretes automáticos da turma (AUTO-5): a pergunta de Remover acesso diz
  a consequência "se ela for"; dizer quem é exige uma leitura que o backend não tem. Recusar é definitivo pela tela, e a pessoa
  não consegue pedir de novo (contrato). A busca traz no máximo 25 alunos, só da publicação em vigor, sem paginação; instrutores
  e solicitações vêm inteiros. Ligar a atualização automática (que publica sem revisão) não pergunta, como antes. Durante a
  carga dos acessos, os campos e as ações que mudam algo ficam parados até a resposta ou o erro (antes, a página inteira virava
  o aviso de carregamento). Qualquer redesenho refaz os campos a partir do estado: o que foi digitado e não enviado num
  formulário se perde quando uma operação termina (como antes). O andamento de uma operação da turma não aparece em outra turma,
  e as ações dela ficam livres: uma segunda operação pode começar, como antes da expansão (o servidor trata cada uma). Com erro
  na carga, busca, configurações e criação continuam disponíveis (antes, a página inteira virava o erro). As perguntas continuam
  o `confirm()` nativo (texto, sem estilo). O nome da turma fica cortado no seletor fechado do pedido (o código vem primeiro). O
  `pattern` do código da turma, anterior à rodada, é inválido no modo `v` dos navegadores atuais: a validação na tela não
  acontece (erro no console), e o servidor recusa o código errado (400); a correção muda o fluxo e fica para aprovação.
- Feedbacks administrativos: não há resposta ao autor, busca, ordenação, prioridade nem exclusão (contrato). O resumo é o do
  portal inteiro (contadores) e não segue os filtros de tipo e turma: a tela diz "No portal inteiro". O histórico de status existe
  no backend, com o `sub` de quem mudou, e não aparece (dizer quem mudou exige resolver no servidor). O começo da mensagem é
  cortado na tela (180 caracteres, duas linhas com `line-clamp`; sem suporte, os 180 caracteres inteiros). Mudar o status não
  pergunta, como antes: a consequência para quem enviou fica dita junto da ação, e o status volta pela própria tela. Uma mudança
  por vez: outra pessoa que entra na aba durante a de quem saiu espera ela terminar. Com o detalhe fechado ou em outra tela, a
  falha da mudança vai para o aviso temporário, como antes (some, e a dúvida ali não diz que o pedido pode ter sido concluído).
  Com texto a 200% no celular, a lista começa mais abaixo que antes (390: 1.389 → 1.690 px), porque o resumo tem cinco atalhos com
  nome e os filtros têm rótulo; e cada linha traz o começo da mensagem (a página dos 50 primeiros cresce no celular: 6.985 → 7.817
  px). "Publicação" continua mostrando o identificador da publicação em vigor no envio.
- Publicações da turma (achado desta rodada, não corrigido para não mexer na Expansão 5 aprovada): se a restauração falha por
  rede com outra turma na tela, o aviso diz "não foi restaurada" — sem resposta, o resultado é incerto. Corrigido na C1 (D04).
- Consolidação transversal (achados anteriores, propostos e não corrigidos, porque mudam o comportamento de telas aprovadas): em
  Publicações, quem entra na aba durante uma restauração de outra pessoa vê "Publicação restaurada." na tela (D03); no Painel, a
  falha de rede ao salvar o foco diz "O foco não foi salvo. Failed to fetch" (D05) e o sucesso que chega depois do fim da sessão
  aparece na entrada pública (D06); fora do piloto, os avisos de escritas sem resposta trazem a mensagem do navegador ("Failed to
  fetch") e, com 503, "Tente novamente em instantes" (D07). As diferenças de raio e corpo de botão, corpo de campo e rótulo, `h3`
  e sublinhado de link entre as telas do aluno e as do instrutor e do admin continuam (C01–C03).
- C1 (correções de confiabilidade pré-integração): D03, D04 e D05 corrigidos; a D06 deixou de acontecer pela mesma guarda de
  sessão, sem código a mais. Achado da revisão da C1, anterior a ela e não corrigido: dois salvamentos do foco na mesma sessão (na
  seção da C1). D07 e C01–C03 continuam.
- C2 (robustez pré-integração): a corrida entre dois salvamentos do foco foi corrigida (C2-02); a dúvida da restauração longe de
  Publicações virou um aviso curto e uma orientação guardada em Publicações da turma de origem (C2-01). O aviso curto ainda cobre
  a barra inferior no celular enquanto está na tela (D08); a dúvida do foco fora do relatório de origem continua o aviso longo da
  C1 (proposta: a mesma solução).
- Limite de 22%: no fluxo, o admin em 390×844 com texto a 200% vê o menu (cerca de 200 px) no topo de cada tela antes
  do conteúdo, em vez de uma barra fixa do mesmo tamanho cobrindo o pé da janela o tempo todo. Admin em 412×915 a 200%
  (21%) continua com a barra fixa de 200 px; descer o limite para alcançá-lo encostaria no aluno em 320×640 a 200%
  (20,1%).
- Link do Canvas ao lado do título (3.4.1): container queries exigem navegadores de 2023 em diante (como `:has()`); sem
  suporte, o link fica na própria linha (3.4). No tablet (768 px) o link continua na própria linha: a coluna ao lado
  deixaria ~180 px para o título.
- Texto ampliado em tela estreita: no menu no fluxo o Sair continua numa linha própria depois do menu (ordem do DOM e do
  teclado). Media query em `em` segue o tamanho de fonte do navegador; o zoom da página já é coberto pelas larguras em
  px. Com texto a 300% em 320 px o conteúdo do painel ("Meu desempenho": médias e contagens) passa 113 px da largura,
  igual na 3.3; a casca não.
- A família do sistema varia por plataforma. As capturas são do Chromium no macOS; Safari, Firefox e Windows não
  foram renderizados. `:has()` e `color-mix()` exigem navegadores de 2023 em diante.
- O CSS cresce enquanto as regras antigas não forem removidas (medido no relatório da iteração). Na consolidação transversal
  saíram as regras sem consumidor e as declarações sempre vencidas (230.178 → 219.237 B); as camadas antigas que ainda valem para
  as telas fora do piloto (seções 03–27) ficam até a expansão delas, e os primitivos repetidos entre as seções 34–39 ficam como
  estão (proposta D01).
- Meu histórico: com texto a 200% no desktop a lista passa à composição estreita e cada publicação fechada fica mais
  alta que na tabela antiga (253 → 303 px; a tabela espremia o texto em colunas estreitas); a primeira publicação
  aparece mais cedo (1.024 → 819 px). Em 390 px a 200% a primeira publicação começa 80 px mais abaixo (a publicação em
  vigor vem aberta). A variação em p.p. vem do contrato com duas casas e as médias aparecem com uma: a diferença entre
  duas médias exibidas pode não bater na última casa com a variação mostrada (56,3% e 68,3%, variação −12,1 p.p.,
  porque as médias são 56,25 e 68,33). A atualização do Canvas no topo continua com a data numérica do resto do
  portal, ao lado das datas por extenso da lista. Datas no fuso do navegador, como no resto do portal.
- Feedback do aluno: a descrição que cresce com o texto usa `field-sizing` (Chromium); nos outros navegadores começa com
  quatro linhas e cresce arrastando a borda. O "desde" da situação depende de o backend só mudar `updatedAt` com o
  status (`feedback.with_status`; anexar imagem não muda). As linhas de explicação dos tipos são texto de interface, não
  regra do backend. Instrutor e admin continuam com a tela antiga pelo rodapé, com os avisos temporários de sempre.
  Com mensagens curtas, a página no celular continua mais longa que antes da Expansão 3 (390 px com texto a 200%,
  20 feedbacks: 7.856 → 13.396 px), porque cada feedback traz a mensagem e o formulário traz regras e explicações.
- Consolidação do Feedback: a prévia usa `line-clamp` (Chromium, Safari e Firefox atuais; sem suporte, a mensagem
  aparece inteira). Quando a 3ª linha da prévia é uma linha em branco entre parágrafos, as reticências ficam sozinhas
  nela. Mensagens abertas fecham ao sair da tela e voltar (lista nova). "Imagem anexada ao feedback." no item fica até a
  próxima escolha de imagem ou a saída da tela; a falha do envio pelo item continua como antes (no estado do handler).
  O foco vai à confirmação só depois que a lista recarrega (igual na Expansão 3). Quem já foi descartando as imagens
  depois de uma falha parcial não vê confirmação de que o texto foi registrado (o feedback aparece na lista; igual
  antes, comportamento fixado pela C7.5). O aviso temporário do portal continua no canto inferior das outras telas e,
  no celular, pode cobrir a barra inferior por até 6,5 s (fora do Feedback do aluno; não mudou nesta rodada).
- Foco: a regra global do `render()` que devolve o foco perdido ao último controle com nome de um render anterior ainda
  vale para instrutor e admin (com o título focado durante a carga da lista, "Ver anexos" deixa o foco no título);
  corrigir lá é mudança da C7.1, para uma rodada própria. Da mesma regra: se a lista do Feedback chega enquanto o foco
  está em "Pular para o conteúdo", o link é recriado e o foco vai ao `<body>` (igual na Expansão 3; reproduzido de
  forma determinística nos dois builds). É a origem de uma falha isolada do teste S1 de `tests/shell-browser.mjs` numa
  rodada completa em UTC (o teste espera o título, não a lista); 12 de 12 isoladas e a rodada seguinte passaram.

## Próximos passos (cada um com aprovação própria)

1. Aprovação final da C2 e, depois dela, a revisão de integração: a candidata sobre a base do `main` atual (`alric-corp`), com as
   suítes, as mutações e a equivalência de novo sobre essa base. Autorizações específicas, cada uma com o plano e o teste já
   descritos: D07–D10 (mensagens globais de rede, aviso sobre a barra inferior, regra de foco do `render()`, aviso do resultado em
   Publicações); a dúvida do foco fora do relatório de origem com a mesma solução da C2-01; padronizações visuais C01–C04; e as
   arquiteturais D01–D02. Da Expansão 9, continuam propostos: o histórico de status com quem mudou (resolver o `sub` no servidor);
   resposta ao autor; busca e ordenação no backend; o resumo seguindo os filtros; a falha fora do detalhe guardada para quando ele
   abrir de novo.
2. Turmas e acessos (8.1), propostas separadas, cada uma com aprovação própria: vincular de novo um pedido aprovado (o backend
   aceita); confirmar antes de ligar a atualização automática; a leitura (só consulta) de quem envia os lembretes automáticos da
   turma, para a linha do instrutor dizer (mexe no backend); o `pattern` do código da turma, inválido no modo `v` dos navegadores
   atuais (corrigir muda o fluxo).
3. Proposta separada, que mexe no backend: a leitura (só consulta) da configuração do
   envio automático da turma (AUTO-5) e da próxima ocorrência, para a tela de Lembretes dizer o que está configurado.
4. Correções de comportamento registradas: entrada pública durante o boot; regra de foco do `render()` (C7.1) que
   devolve o foco a um controle antigo (instrutor e admin); aviso temporário sobre a barra inferior no celular.
5. Expansão do conteúdo: as outras telas do instrutor (Visão por atividade, detalhe do aluno com a prévia e o envio individuais,
   Notas da turma),
   o Feedback de instrutor e admin pelo rodapé, e por último a entrada pública. Com as telas do aluno
   concluídas, as seções 28 e 30 a 37 viram base e as regras antigas são apagadas; o mesmo vale para as camadas antigas da
   barra lateral, hoje sobrescritas pela seção 29.

# Escola da Nuvem · Portal AWS re/Start

Portal estático em HTML, CSS e JavaScript modular (ES modules servidos sem bundler), com API Python em Lambda. Módulos e responsabilidades: [docs/arquitetura.md](../docs/arquitetura.md#frontend-módulos-e-responsabilidades).

## Identidade visual

A direção visual em vigor, o "Instrumento de referência", está em [docs/design-visual.md](../docs/design-visual.md): cor por papel, tipografia, tokens, componentes e a casca global. As telas que o redesign já cobriu são estas: painel, Minhas atividades, histórico e Feedback do aluno; painel do instrutor, Publicações da turma, Atualizar notas e Lembretes; Turmas e acessos; e Feedbacks administrativos, além da casca global. Têm CSS próprio nas seções 28 a 39 de `styles.css`. As demais telas ainda usam o estilo anterior, sobre a mesma paleta.

O portal usa o padrão técnico escuro da Escola da Nuvem. A paleta base está no início de `styles.css`: fundo `#001633`, sidebar `#0A3157`, superfícies `#08284A` e `#0B2E54`, texto branco e secundário `#B9CBDA`, bordas `#1C557A`, ciano `#00AFE8` (hover `#00CBDD`), verde-água `#00EBD2`, warning `#F2B84B` e danger `#D96B78`, sempre acompanhados por rótulos. Sobre ela, os tokens semânticos (`--color-*`) atribuem os papéis:

- o ciano fica reservado a ações, links e foco;
- as séries acadêmicas têm cor própria: KC em branco e LAB em violeta `#B49CFF`, a única cor nova;
- a situação usa âmbar (revisar) e verde-água (atingida), sempre com texto e forma.

As telas redesenhadas usam a família `system-ui` (`--font-ui`) e números tabulares; a monoespaçada fica só para códigos. A logo fornecida pela Escola da Nuvem está em `frontend/logo.png`, preservada sem alterações, e aparece na entrada, no menu e no ícone da aba. O build inclui esse arquivo explicitamente.

O Cognito usa Managed Login (versão 2), tema escuro e a mesma logo. As cores são definidas em `infra/terraform/cognito-branding.json`, aplicadas pelo Terraform. A autorização inclui `lang=pt-BR` para exibir o login em português. O user pool usa Essentials, plano já presente antes dessa personalização.

## Responsividade em monitores grandes

A tipografia usa `rem` e cresce gradualmente a partir de 1280 pixels de largura disponível no navegador. Com fonte padrão de 16px, o texto da tabela passa de cerca de 14px em 1280 para 17,5px em Full HD, 21px em QHD e 28px em 4K. Menu lateral, cards, controles, espaçamentos e largura útil acompanham essa escala. O layout compacto continua aplicado em tablets/celulares; não há detecção por modelo do monitor nem uso de CSS zoom/transform.

Os testes de navegador cobrem 1366×768, 1920×1080, 2560×1440 e 3840×2160, além das verificações móveis existentes, conferindo crescimento da tipografia, uso da largura e ausência de transbordamento horizontal da página. A escala considera pixels CSS; zoom do navegador e escala do sistema influenciam a largura disponível.

A tela inicial de entrada também considera a altura disponível: em desktops a partir de 900px, usa uma composição em três faixas (cabeçalho, conteúdo e rodapé), sem a antiga altura central mínima de 680px. Título, arte e espaçamentos se adaptam à altura da janela. Em janelas excepcionalmente pequenas ou com texto ampliado, o conteúdo pode rolar naturalmente, sem ser cortado. Os testes Retina usam fator 2 e incluem 1512×982, 1512×850 e 1512×755, verificando que login, cadastro e rodapé cabem na janela. Isso não altera a escala das páginas internas.

## Ver a interface localmente

Na raiz do repositório:

```sh
python3 -B scripts/build_frontend.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory frontend/dist
```

Acesse **http://localhost:8080/?demo=1**. A demonstração usa dados fictícios e permite alternar entre aluno e instrutor. Não acessa a AWS, não publica CSVs e não altera dados. Para ver a página de entrada, acesse a raiz sem `?demo=1`. Não abra `index.html` por `file://`: os módulos e a configuração precisam de HTTP.

O build não precisa de Node/npm. Ele copia somente os arquivos web previstos para `frontend/dist`; nunca copia Terraform, CSVs ou arquivos de credenciais. A demonstração só é ativada em localhost/loopback para desenvolvimento; a entrada publicada exige login, sem acesso de convidado nem link de demonstração.

## Implantar

O frontend segue **PR → CI → merge → deploy automático (push na main, com a árvore aprovada no PR)**, sujeito ao kill switch e aos gates existentes. A configuração de produção acompanha cada release; publicar o frontend não implanta o backend nem publica notas acadêmicas.

Use o [runbook de releases](../infra/FRONTEND-RELEASES.md) para publicação, operação manual e recuperação. O build plano local continua útil para desenvolvimento; `scripts/deploy_frontend.sh` é legado e não é o procedimento normal de publicação. Não sincronizar `frontend/dist` na raiz do bucket nem invalidar `/*` para atualizar uma release.

Backend e infraestrutura seguem o [processo separado](../infra/README.md#5-operação-posterior). O login local é apenas demonstração; o portal publicado usa o endereço HTTPS do CloudFront.

## Fluxos implementados

**Administrador:** criar turmas, consultar solicitações institucionais, aprovar/vincular instrutores, remover vínculos e operar as turmas. Administração global é uma concessão manual no Cognito.

**Navegação:** o Painel do instrutor reúne a consulta identificada da turma, com ordenação por nome, quantidade de atividades sem nota e menor média; filtros por situação, e-mail ausente e atividades sem nota. Ao voltar dos detalhes, os filtros e a busca são preservados. O menu não repete a tela de Notas da turma; a rota antiga continua exclusiva para instrutores autorizados. Publicações da turma reúne o histórico; Lembretes configura o remetente; Turmas e acessos administra vínculos.

**Instrutor:** visualizar suas turmas, importar CSV, revisar notas e atividades liberadas, publicar uma nova versão, consultar e restaurar publicações anteriores. A API consulta os vínculos no DynamoDB em todas as operações.

**Aluno:** confirmar sua conta, visualizar somente suas notas e pendências, filtrar atividades e consultar a evolução das últimas 12 publicações. O primeiro vínculo usa o e-mail confirmado que aparece no CSV e passa a ser persistido por `sub` e ID Canvas. Uma segunda conta com o mesmo e-mail não assume um vínculo existente.

**Consulta autenticada:** somente instrutores autorizados e administradores podem consultar nomes, médias de KC/Lab/geral, atividades realizadas e quantidade de pendências em **Notas da turma**. O link `/?turma=BRSA0267` exige login e o código sozinho não concede acesso. `GET /cohorts/{code}/class-report` exige access token Cognito com escopo `portal/access`; o backend verifica o vínculo de instrutor. A antiga rota `/guest/cohorts/{code}` foi removida. E-mails, IDs Canvas, atividades individuais e arquivos originais não fazem parte desse resumo.

**Leitura das notas:** uma atividade sem nota registrada pode aguardar entrega ou correção; o CSV não comprova entrega. Notas vazias em atividades liberadas entram como zero na média. Zero registrado conta como avaliação; dispensa e atividade não liberada ficam fora do cálculo. “Médias na referência” indica KC ≥ 70% e LAB ≥ 95%, sem afirmar que todas as atividades têm nota. A ajuda de cálculo está disponível nos painéis pessoais.

**Atualização e histórico:** a data de atualização fica destacada. Ao restaurar uma publicação, o portal distingue a data da restauração da data original das notas. O histórico pessoal mostra diferenças de médias em pontos percentuais e mudanças nas próprias atividades, comparadas à versão que estava vigente antes de cada publicação. A versão atual é incluída mesmo quando uma restauração aponta para uma publicação fora das 12 mais recentes. O histórico do instrutor mostra contagens de alterações; publicações antigas sem resumo são identificadas como tal.

**Primeiro acesso e falhas:** uma conta confirmada sem turma recebe orientações para conferir o e-mail do Canvas, trocar de conta e procurar o instrutor. A interface não presume saber se o motivo é falta de matrícula ou primeira publicação. Erros de consulta têm mensagem persistente e nova tentativa; erros de pendências permanecem na própria tela.

**Sessão e rascunhos:** o cliente renova o access token com o refresh token no endpoint OAuth do Cognito. O refresh fica em localStorage e é eliminado no logout. Turma, tela e filtros são associados ao e-mail da conta; notas e CSV não são gravados no armazenamento do navegador. Arquivos e prévias ficam em memória, por turma, durante a sessão da página. Fechar/recarregar com rascunho mostra o aviso do navegador; sair da conta pede confirmação de descarte. A renovação de sessão e a troca de turma preservam esse trabalho.

Em **Meu desempenho**, o aluno vê até três próximos passos automáticos: primeiro atividades sem nota e depois sugestões de revisão, priorizando as liberadas mais recentemente e preservando a ordem da publicação quando não há data. Atividades na referência, dispensadas ou não liberadas não reaparecem como tarefa. Os botões **Ver minhas pendências**, **Revisar resultados** e **Ver todas as atividades** abrem a lista completa com o filtro correspondente.

**Minhas atividades** agrupa os itens por módulo, com seções expansíveis e contagens referentes ao filtro atual. Busca (sem distinção de acentos), tipo, situação e módulo podem ser combinados. A classificação usa título completo, tipo e curso confirmado no catálogo; itens desconhecidos ficam em **Outras atividades**. O módulo não depende da ativação dos links do Canvas.

**Revisar resultados** inclui somente atividades avaliadas com percentual abaixo de 70% em KCs ou 95% em LABs. Zero registrado entra em revisão, não em “Sem nota”. A API calcula `needsReview` antes do arredondamento; o frontend mantém compatibilidade com relatórios antigos. O destaque é uma sugestão de estudo, não uma exigência de reenvio nem confirmação de que o Canvas permite outra tentativa. Dispensadas e não liberadas ficam fora da revisão.

O Foco da turma foi retirado da interface por decisão de produto. Seleções antigas recebidas do backend são ignoradas pelo frontend; a rota e os dados existentes permanecem por compatibilidade, sem nova gravação ou exclusão. A visão por atividade continua disponível para consultar as médias e pendências da turma.

A lista reflete a publicação acadêmica vigente, gerada pelo Canvas ou por CSV; as entregas continuam no Canvas. Detalhes individuais são retornados apenas no relatório autenticado do próprio aluno. Testes adicionais: `node --test tests/student-journey.mjs` e `node tests/student-journey-browser.mjs` (Playwright), além de `backend/test_journey.py`.

### Links das atividades no Canvas

**Ativado em 24/09/2026:** `canvasLinksEnabled = true` em `frontend/ui.js`. Os botões passam a ser exibidos nas duas turmas associadas. Ativado sem a validação com contas reais de aluno recomendada anteriormente; ver [TODO 02](../docs/todo/concluido/02-ativar-links-canvas.md) para o acompanhamento pós-ativação.

**Desde 25/09/2026 os links e os módulos vêm do Canvas, não de listas no código** ([TODO 12](../docs/todo/concluido/12-configuracao-da-turma-no-backend.md)). A Lambda `canvas-sync` lê os módulos do curso configurado em cada turma (Turmas e acessos → Configurações). O backend anota em cada atividade `module`, `moduleOrder` e `canvasUrl`, associando pelo ID da tarefa, e não pelo título. `frontend/canvas-links.js` só valida que `canvasUrl` é um item de módulo de `awsrestart.instructure.com` antes de exibir. `frontend/student-journey.js` agrupa pela ordem dos módulos no curso. Sem catálogo (curso ainda não lido), as atividades ficam em "Outras atividades" e sem link; nada é deduzido pelo título.

Atividades pendentes com link mostram **Abrir KC/LAB no Canvas**; atividades com nota mostram **Ver atividade no Canvas**. Os links abrem em nova aba e aparecem:
- no painel pessoal;
- em Minhas atividades;
- nas pendências consultadas pelo instrutor.

Atividades não liberadas, dispensadas ou fora de qualquer módulo ficam sem botão. A demonstração local não mostra links. O clique não altera notas, status, matrícula ou progresso e não substitui o login e as permissões do Canvas.

As listas fixas anteriores (170 itens do curso 4436 e 75 do 4413, fornecidas pelo instrutor) foram removidas depois de conferir que o catálogo da API produz exatamente os mesmos 241 links. Estão no histórico do Git até o commit `244f7b0`. Os sete materiais complementares do curso 4413 continuam em [canvas-materiais-complementares.md](../docs/canvas-materiais-complementares.md), sem gerar atividades.

Validação específica, sem acesso à AWS ou ao Canvas:

```sh
node --test tests/canvas-links.mjs tests/student-journey.mjs
npm run build --silent && node --test tests/canvas-links-browser.mjs
```

O teste de navegador usa API simulada com as anotações do backend. Ele verifica:
- aluno e instrutor;
- troca entre turmas sem manter links do curso anterior;
- recusa de link forjado;
- destinos exatos, nomes acessíveis e foco de teclado;
- larguras de 320, 390 e 1440 pixels.

## Atividades sem nota e lembretes

Nas turmas habilitadas, os lembretes são automáticos às terças e sextas, às 20h de Brasília, conforme as pendências e regras da turma ([AUTO-5](../docs/historico/automacoes/auto-5.md)). O painel também oferece [envio em lote](../docs/todo/concluido/08-lembretes-em-lote.md) pelo filtro **Com atividades sem nota**.

**Ver pendências**, na tabela do painel, mostra atividades, histórico, participação e situação da entrega. O modelo, a cópia e o botão de envio individual foram retirados da interface no [PR #10](https://github.com/alric-corp/escola-da-nuvem-portal/pull/10); não é necessário enviar e-mail por esse detalhe. O contrato individual implementado em 24/09/2026 permanece no backend, sem constituir uma ação disponível nessa tela.

Em **Lembretes**, o instrutor configura e confirma seu remetente institucional. Para envio manual em lote, a prévia informa os destinatários elegíveis e quem será ignorado. O backend revalida publicação, participação, remetente e reserva por aluno/publicação; não envia para desistentes. Resultados incertos bloqueiam repetição para evitar duplicidade. Publicar notas ou consultar pendências não envia e-mail.

**Aceito pelo serviço de envio** não significa entrega nem leitura. Eventos SES/SNS são processados pela Lambda existente; **Atualizar status do envio**, no detalhe, consulta a entrega ao servidor destinatário, atraso ou falha. Consulte [infra/SES.md](../infra/SES.md) para operação e limites.

## Atualizar notas: sincronização ou importação

Para turmas com `autoSync` habilitado, o Canvas é consultado às 6h e às 18h, no horário de Brasília. Não é necessário exportar/importar CSV como rotina obrigatória. Confira a última mudança nas notas e a última verificação no painel.

Para turmas sem sincronização, ou quando houver necessidade de importação manual:

1. Exporte o CSV da turma no Canvas como instrutor.
2. Entre no portal, escolha a turma e abra **Atualizar notas**.
3. Selecione o arquivo e clique em **Conferir arquivo**.
4. Confirme quais atividades estão liberadas. Se mudar a seleção, clique em **Atualizar prévia**.
5. Confira **O que muda ao publicar**: alunos adicionados/removidos, cadastros, atividades, pontuação máxima e notas alteradas (até 100 detalhes). Se houver alunos removidos, confira o arquivo completo e marque a confirmação. A API exige essa confirmação antes de publicar.
6. Clique em **Publicar atualização**. A comparação e a confirmação de remoção são refeitas quando uma nova prévia é gerada.

Os alunos continuam vendo a versão anterior até a publicação terminar. Se outra pessoa publicar antes de você, a prévia fica desatualizada e precisa ser gerada novamente. A publicação é um snapshot, não uma mesclagem: o CSV precisa conter a turma completa. Em **Publicações da turma**, é possível restaurar uma versão anterior, com registro da operação.

## Regras de importação e cálculo

- CSV UTF-8 com separador vírgula, cabeçalhos únicos, campos `Student`, `ID` e `SIS Login ID`, e uma linha `Points Possible`.
- Limites desta versão: 2 MB, 500 alunos e 200 atividades reconhecidas. IDs Canvas e e-mails preenchidos devem ser únicos na turma.
- O aluno de teste do Canvas é excluído antes dos cálculos quando tem um nome reservado reconhecido (português/inglês), ID numérico, nenhum SIS User ID e login vazio ou hexadecimal de 40 caracteres. A prévia informa a linha excluída. Nome sozinho não provoca exclusão; alunos com e-mail válido continuam sendo importados e e-mails inválidos de outros registros continuam sendo rejeitados. As mensagens usam a linha física original do CSV.
- Atividades são colunas numeradas que identificam `KC` ou `Lab`. Nomes e e-mails são tratados como texto na interface, sem interpretar HTML.
- Cada nota é dividida pelo máximo da atividade em `Points Possible`. A média de cada categoria é aritmética sobre os percentuais das atividades liberadas.
- Na primeira prévia, atividades com pelo menos cinco células preenchidas são sugeridas como liberadas. Para turmas menores, a sugestão usa o número de alunos. O instrutor confirma essa seleção em cada importação.
- E-mail ausente (`SIS Login ID` vazio ou só espaços): o aluno e suas notas são preservados, com aviso da linha e identificação na prévia/painel do instrutor. O campo é armazenado como `null`, sem e-mail fictício. Novos vínculos exigem corrigir o e-mail no Canvas e republicar; vínculos existentes por ID Canvas são preservados. E-mails preenchidos malformados e IDs duplicados continuam bloqueando a importação.
- Célula vazia em atividade liberada: pendência e zero no cálculo. Zero preenchido: realizada, com nota zero. `EX`: dispensada e excluída do cálculo/progresso. Atividade não liberada: não penaliza o aluno.
- Sem atividades avaliáveis em uma categoria: indicador `—` e situação “Sem avaliação completa”. A média total usa as categorias disponíveis.
- Referências: KC ≥ 70% e Lab ≥ 95%. A classificação usa valores não arredondados. `Graduated Final Points = 1` prevalece como graduado.
- Valores negativos, não numéricos, não finitos ou acima do máximo são rejeitados. Esta versão não trata bônus acima de `Points Possible`. Valores decimais com vírgula são aceitos dentro de campos CSV entre aspas.

## Organização e persistência

| Local | Conteúdo |
| --- | --- |
| `frontend/app.js` | Raiz da composição: `render()`, `actions`, sessão, navegação e troca de turma |
| `frontend/pages/` | HTML de cada tela a partir do `state`, sem rede |
| `frontend/handlers/` | Regras de cada domínio: chamam a API, alteram o `state` e pedem `render()` |
| `frontend/api.js` | Chamadas à API, retentativa de GET, expiração da sessão e envio de anexos ao S3 |
| `frontend/state.js` | Estado compartilhado entre os módulos |
| `frontend/ui.js` | Markup compartilhado, helpers de apresentação e `notice()` |
| `frontend/auth.js` | Authorization code, PKCE, state/nonce e sessão |
| `frontend/demo.js` | Dados fictícios, sem chamadas ao backend |
| `backend/portal.py` | Autorização por turma e operações do portal |
| `backend/grades.py` | Parser e regras acadêmicas |
| `backend/repository.py` | DynamoDB, transações e snapshots S3 |
| `infra/terraform/` | Recursos AWS, permissões e empacotamento da Lambda |

No DynamoDB: `COHORT#.../METADATA` guarda a versão atual; `PUB#...` e `DRAFT#...` guardam os metadados de publicação; `USER#.../TEACH#...` e `STUDY#...` guardam vínculos; `OWNER#...` impede apropriação de matrícula por outra conta. Snapshots completos e arquivos de origem ficam privados em `cohorts/<turma>/<importação>/` no S3.

O backend lê os snapshots e filtra o aluno antes de responder. O relatório pessoal nunca inclui outros alunos. O resumo da turma usa uma rota separada e autenticada, sem e-mails, IDs ou atividades individuais. Nenhuma resposta fornece uma URL de download do snapshot.

## Testes

O índice completo das suítes, com contratos, mutações e verificações manuais, está em [tests/README.md](../tests/README.md). A partir da raiz do repositório:

Para as suítes Python, ative antes um ambiente Python 3.13 conforme a [preparação dos testes](../tests/README.md#preparação).

```sh
npm ci
npx playwright install chromium
npm test                  # unitários Node, inclusive a arquitetura do frontend
npm run test:browser      # gera o build e roda as suítes Playwright com API simulada
python -m pip install -r requirements-dev.txt
python -m unittest discover -s backend
python -m unittest discover -s tests/integration   # Moto, nenhum recurso real
```

Para rodar uma suíte isolada, use `node --test tests/<arquivo>.mjs`. No caso das suítes de navegador, rode `npm run build` antes. Algumas suítes de navegador gravam capturas em `avanca-preview/`, no diretório temporário do sistema. O fluxo real Cognito → API Gateway e as permissões IAM precisam ser verificados após o deploy, pelas verificações manuais descritas em `tests/README.md`.

## Limites conhecidos

- O importador foi validado com o CSV real de uma turma em 14/09/2026 ([registro](../infra/DEPLOYMENT.md#compatibilidade-com-o-csv-real-do-canvas)). Cabeçalhos ou regras específicas de outros cursos do Canvas podem exigir ajustes.
- A descoberta sem Scan está implementada e integrada; até a implantação backend e o cutover, `GET /cohorts` pode usar o fallback legado com Scan ([TODO 05 concluído](../docs/todo/concluido/05-descoberta-de-turmas-por-vinculo.md), com operação em acompanhamento).
- Rascunhos e arquivos novos recebem tags e expiração; os dados anteriores, sem tags/TTL, não foram limpos ([TODO 13](../docs/todo/concluido/13-retencao-de-dados.md)).
- Vínculos persistidos são corrigidos em **Turmas e acessos**, que permite buscar, desvincular e editar o nome ([TODO 11](../docs/todo/concluido/11-admin-vinculos-e-nomes.md)). E-mails diferentes antes do primeiro vínculo precisam ser corrigidos no Canvas e refletidos em nova sincronização ou publicação manual.
- Cadastro e recuperação usam o Cognito com SES e remetente noreply; lembretes usam o endereço institucional confirmado do instrutor.
- Além da importação manual do CSV, a integração com a API do Canvas atualiza as notas por agendamento (`canvas-sync`, [TODO 17](../docs/todo/concluido/17-integracao-api-canvas.md)). A data da publicação fica visível aos alunos.
- Publicar notas não envia e-mail. A [proposta de aviso de nova publicação](../docs/todo/despriorizado/15-aviso-de-nova-publicacao.md) está despriorizada e sem implementação; os lembretes existentes permanecem como estão.

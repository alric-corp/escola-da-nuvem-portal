# Simulados AWS Cloud Practitioner CLF-C02

A área **Simulados AWS** reúne dois conjuntos independentes de 65 questões, totalizando 130 questões com resoluções em PT-BR. O Simulado 1 é o conjunto originalmente fornecido em português; o Simulado 2 foi traduzido do material em inglês. A numeração de 1 a 65 e as letras são próprias de cada conjunto. As respostas e o desempenho pessoal do material original não integram o banco compartilhado.

O seletor **Simulado** define o conjunto usado na prática, no exame e na revisão. Cada simulado tem sua própria tentativa em andamento e seu histórico de até 20 tentativas por conta e navegador. Trocar de conjunto e recarregar preservam essas tentativas, sem misturar questões que tenham o mesmo número.

Ao iniciar ou repetir um teste, a etapa **Escolha seu modo de teste** oferece duas opções. No **modo de prática**, a seleção pode ser alterada até acionar **Confirmar resposta**. A correção aparece somente depois dessa confirmação: uma alternativa nas questões simples ou duas nas questões de seleção dupla. No **modo de exame**, o usuário responde a todas as perguntas antes de consultar a correção completa. Respostas confirmadas na prática ficam bloqueadas; no exame, podem ser alteradas até a conclusão.

O **limite de tempo** padrão é de **90 minutos** nos dois modos. O controle **Estender tempo** abre as opções **1,5× (135 minutos)**, **2× (180 minutos)** e **Sem limite de tempo**. Desativar o controle restaura o padrão de 90 minutos. A configuração escolhida é gravada com a tentativa e mostrada no histórico e no resultado.

A prática mantém os filtros por domínio, quantidade de questões e embaralhamento. O exame completo usa todas as questões do simulado selecionado em ordem aleatória. Repetir os erros também abre a escolha de modo e tempo para o subconjunto selecionado. É possível navegar livremente, marcar dúvidas e voltar a respostas anteriores. Quando o prazo termina, a tentativa é concluída automaticamente; sem limite, a conclusão é manual.

Cada questão vale um ponto. Nas questões com duas respostas, o conjunto deve coincidir integralmente com o gabarito; respostas incompletas contam como erro. O resultado apresenta contagens e percentuais por domínio, revisão comentada e a opção de estudar novamente os erros. Domínios ausentes numa tentativa filtrada aparecem como sem questões.

Os percentuais deste treino não equivalem à nota oficial. O [guia CLF-C02](https://docs.aws.amazon.com/pt_br/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02.html) informa pontuação escalonada de 100 a 1.000, mínimo de 700, 50 questões pontuadas e 15 não pontuadas. Neste banco, todas as questões entram no resultado. A classificação por domínio serve ao estudo; os pesos oficiais de 24%, 30%, 34% e 12% não são usados para fabricar uma nota oficial nem para redistribuir o banco fornecido.

## Revisão do conteúdo

Revisão em 6 de novembro de 2026. As resoluções receberam revisão de clareza e referências oficiais em português. `aws.amazon.com/pt/` e `docs.aws.amazon.com/pt_br/` são usados conforme o site. Algumas páginas com `/pt/` continuam em inglês ou redirecionam para páginas em inglês; nesses casos, o link aponta para o manual traduzido. Os links dos dois simulados foram conferidos por HTTP e pelo idioma da página.

No Simulado 1, os ajustes relevantes são:

| Questão | Ajuste |
| --- | --- |
| 7 | Gabarito **C, AWS Business Support+**. A marcação de D contradizia a própria explicação. A [comparação de planos](https://aws.amazon.com/pt/premiumsupport/plans/) confirma telefone, web e chat no Business Support+. Preços não são fixados no banco. |
| 10 | Savings Plans é um compromisso de gasto por hora, não de uma quantidade física de computação. O desconto não reserva capacidade. |
| 14 e 18 | ACLs atuam na sub-rede, permitem negação explícita e são stateless; grupos de segurança são stateful e têm regras de permissão. |
| 19 | Storage Gateway oferece interfaces de arquivos, volumes e fitas conforme o tipo de gateway; removida a associação imprecisa com EFS. |
| 26 | Removida a afirmação absoluta de que Redshift não possui ingestão de streaming. Kinesis continua sendo o serviço de coleta de fluxos entre as alternativas. |
| 29 | [AWS Batch também usa Fargate](https://docs.aws.amazon.com/pt_br/batch/latest/userguide/batch_components.html). O enunciado identifica Fargate como mecanismo de computação sem servidor para contêineres no ECS/EKS. |
| 44 | Diferenciada a função do IAM do perfil de instância que a entrega ao EC2. |
| 46 | [ELB escala sua própria capacidade de balanceamento](https://docs.aws.amazon.com/pt_br/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html); EC2 Auto Scaling altera a quantidade de instâncias. |
| 49 | Política de senhas descrita como um mecanismo disponível; acesso federado, credenciais temporárias e MFA continuam como orientação de identidade. |
| 50 | Transit Gateway pode receber conexões VPN/Direct Connect; não oferece sozinho o enlace local. |
| 61 | Compartilhamento de descontos depende das preferências e da elegibilidade na cobrança consolidada. |
| 63 | Especificada a criptografia de arquivos de log com SSE-KMS para distinguir armazenamento de criptografia em trânsito. |

No Simulado 2, além da tradução de todos os enunciados, alternativas e comentários, foram corrigidos estes pontos:

| Questão | Ajuste |
| --- | --- |
| 1 | Especificado failover de DNS para Route 53. CloudFront também oferece failover de origem. |
| 5 | Diferenciadas filas SQS FIFO, tópicos SNS FIFO e ordenação por shard do Kinesis. |
| 9 | Métricas nativas de CPU e rede do EC2 não exigem agente do CloudWatch. |
| 17 | Somente os grupos de posicionamento de cluster têm a restrição a uma zona; outras estratégias podem abranger mais zonas. |
| 31 | Pedido o plano de menor custo com TAM, com resposta C, Enterprise Support. [Unified Operations também inclui TAM](https://aws.amazon.com/pt/premiumsupport/unified-operations-team/), tornando o enunciado original ambíguo. |
| 39 | DynamoDB oferece PartiQL; isso não o torna um data warehouse para análises SQL no data lake S3. |
| 43 | DynamoDB aceita atributos binários; S3 continua sendo a alternativa de armazenamento de objetos solicitada. |
| 49 | Cost Explorer possui previsões baseadas em histórico; Pricing Calculator atende ao planejamento de uma implantação nova. |
| 56 | Especificada conta autônoma para a exigência de usuário-raiz no encerramento, distinguindo contas-membro do Organizations. |
| 61 | Especificada execução de funções no Lambda, sem afirmar que ECS ou todas as modalidades de RDS nunca podem ser sem servidor. |

## Organização dos arquivos e novos simulados

| Arquivo | Responsabilidade |
| --- | --- |
| `frontend/practice-content.js` | Catálogo dos conjuntos e dados comuns da certificação e dos domínios. Não contém questões. |
| `frontend/practice-exams/clf-c02-01.js` | Metadados e 65 questões do Simulado 1. |
| `frontend/practice-exams/clf-c02-02.js` | Metadados e 65 questões traduzidas do Simulado 2. |
| `frontend/practice-exams/question.js` | Formato atual e legado, normalização de URLs e validação de referências oficiais. |
| `frontend/practice-exams/references.js` | Catálogo de títulos e URLs pertinentes às alternativas. |
| `docs/simulados-referencias.json` | Registro editorial com seções e trechos conferidos das fontes. |

Para acrescentar um conjunto:

1. Crie um arquivo em `frontend/practice-exams/`, exportando `exam` com `id` estável e exclusivo, título, descrição, idioma, data de revisão e `questions`.
2. Importe o conjunto em `frontend/practice-content.js` e acrescente-o a `practiceExams`.
3. Inclua o novo módulo na lista explícita de arquivos de `scripts/build_frontend.py`; o teste de arquitetura verifica os módulos alcançáveis pelo catálogo.
4. Confira gabarito, tradução e referências e execute os testes abaixo.

Os IDs numéricos das questões são locais a cada simulado. O motor usa também o ID do conjunto para localizar o enunciado e o gabarito. Contagens, filtros e pontuação vêm do conjunto registrado, sem concatenar os bancos numa lista única. Alterar o título não exige mudar o ID; mudar o ID criará outro histórico.

## Persistência e integração

O portal mantém a tentativa atual e até 20 tentativas concluídas de cada simulado em `localStorage`, em chave própria por e-mail de conta e conjunto. A seleção de simulado também é associada à conta. O Simulado 1 preserva a chave e o identificador anteriores para recuperar os registros já existentes. Não há sincronização entre dispositivos. A demonstração mantém os dados apenas em memória. Se o navegador impedir a gravação, a interface informa que o progresso dura somente enquanto a página estiver aberta.

O relógio usa um prazo absoluto; navegar, fechar a aba ou recarregar não reinicia o tempo escolhido. Ao retomar uma tentativa expirada, o resultado é concluído com as respostas salvas. O histórico não duplica a conclusão quando o relógio e uma ação acontecem próximos. Tentativas salvas antes da configuração de tempo preservam o comportamento original: 90 minutos no exame e sem limite na prática. Registros inválidos ou de outra versão do banco são descartados antes da correção.

A página funciona sem matrícula ou publicação acadêmica. Alunos, instrutores e administradores autenticados podem praticar na própria conta. O modo administrativo **Visualizar como aluno** não oferece ações de simulado em nome de outra pessoa. A área não chama APIs de escrita nem participa dos critérios de notas, graduação e voucher.

O prazo de uma tentativa de outro conjunto continua correndo. Ao selecioná-lo novamente, o portal verifica o prazo e conclui a tentativa se ele tiver expirado.

O catálogo, os arquivos dos simulados, `practice-focus.js` (navegação modal), `practice.js` (regras), `handlers/practice.js` (operações e persistência) e `pages/practice.js` (apresentação) são incluídos pelo build estático, sem dependências novas. O CSS está na seção 42, sob `.practice-page`. A publicação segue o fluxo existente de PR, CI e release.

## Validação local

```sh
npm test
npm run test:browser
```

Os testes usam dados e identidades fictícios. Cobrem seleção múltipla, correção, filtros, histórico, retomada, expiração, separação por conta, armazenamento indisponível, release em subdiretório e layout em celular e com texto ampliado. Para explorar manualmente, sirva `frontend/dist`, abra `?demo=1` e escolha **Simulados AWS**.

## Experiência da tentativa

A jornada é **escolha do simulado → configuração → tentativa → confirmação/correção → confirmação da conclusão → resultado/revisão**. Os cartões usam os nomes neutros **Modo de prática** e **Modo de exame**, inclusive no primeiro acesso. O botão de configuração inicia **Iniciar prática** ou **Iniciar exame**; **Nova tentativa** aparece quando existe resultado concluído daquele simulado. **Retomar tentativa** conserva o mesmo identificador, respostas, marcações, ordem e prazo.

O modo foco é calculado pela tela e pela tentativa válida em andamento. Iniciar ou retomar recolhe a navegação e libera sua largura. O enunciado e as alternativas mantêm uma largura de leitura limitada. A configuração, a lista e o resultado usam a navegação normal.

**Menu** abre a mesma barra lateral em um `dialog` modal nativo. Não há cópia de menu, novo estado de tentativa ou render ao abrir/fechar. O painel tem nome, `aria-controls`, `aria-expanded`, fechamento por botão/Escape e retorno do foco. O conteúdo de fundo fica inerte; o Tab circula apenas nos controles do painel enquanto ele é modal. Navegar para outra área mantém a tentativa; sair do foco restaura a disposição normal do portal. O painel não usa fullscreen.

**Mostrar tempo** começa ligado nas tentativas limitadas. Ocultar mostra **Tempo oculto. A contagem continua.** O contador fica fora da árvore de acessibilidade, e os segundos não são anunciados por região live. Ao mostrar o relógio e ao reativar a aba, o valor é recalculado imediatamente a partir do prazo. O prazo absoluto e a rotina de expiração são os mesmos com o tempo visível ou oculto, inclusive com o menu aberto ou a pessoa fora da área. A tentativa sem limite não apresenta esse controle.

A preferência é o campo opcional `timerVisible` do objeto da tentativa, salvo pelo mecanismo existente por usuário e simulado. Não cria chave de armazenamento, timestamp ou API. Registros anteriores sem o campo são lidos como visíveis; cada tentativa nova começa visível. Um valor de apresentação inválido é normalizado sem descartar respostas válidas. O menu aberto/fechado é efêmero e não é persistido.

Tentativas de prática antigas que já tinham respostas conferidas mantêm essa correção e o bloqueio dessas respostas; a confirmação explícita vale para respostas ainda não conferidas. Não é necessário iniciar uma nova tentativa para continuar o histórico existente.

Na prática, selecionar não entrega gabarito. A confirmação explícita revela um resumo na mesma questão e coloca explicação e documentação em cada cartão, sem repetir as alternativas em outro bloco. O foco vai intencionalmente ao resumo da correção, usando rolagem apenas até ele ficar visível. A questão continua com a mesma numeração e com o controle de marcar para revisão. No exame, comentários, referências e estados de correção só são renderizados após concluir.

Os cartões distinguem **Sua escolha · Correta**, **Sua escolha · Incorreta**, **Resposta correta · Não selecionada** e **Não selecionada**. Apenas a escolha errada recebe indicação de erro; distratores não escolhidos permanecem neutros. Texto e símbolos acompanham as cores. A seleção dupla continua exigindo o conjunto exato; não há crédito parcial. A posição da questão e a quantidade de respostas completas são contadores distintos.

## Alternativas e referências: cadastro e compatibilidade

As 130 questões e suas **542 alternativas** têm explicação e referências específicas. Os objetos levam `id`, `key`, `text`, `explanation` e `references` juntos. `id` mantém as letras originais usadas pelas respostas já salvas; `key` é a identidade editorial estável da alternativa. Não recalcular a chave quando corrigir a redação nem renumerar IDs quando reordenar objetos. Hoje o motor embaralha perguntas, preservando a ordem das alternativas; os testes também reordenam alternativas para conferir a associação de todos os campos.

Exemplo do formato para cadastrar uma questão:

```js
import { q } from "./question.js";
import { references as refs } from "./references.js";

q(66, "3.3", "Qual serviço fornece instâncias de computação virtual?", "A", [
  { id: "A", key: "ec2", text: "Amazon EC2",
    explanation: "EC2 fornece instâncias de computação virtual.", references: [refs.ec2] },
  { id: "B", key: "s3", text: "Amazon S3",
    explanation: "S3 armazena objetos; não provisiona instâncias EC2.", references: [refs.s3] },
  { id: "C", key: "route-53", text: "Amazon Route 53",
    explanation: "Route 53 oferece DNS e roteamento de nomes.", references: [refs.route53] },
  { id: "D", key: "rds", text: "Amazon RDS",
    explanation: "RDS gerencia bancos relacionais.", references: [refs.rds] },
], refs.ec2.url);
```

Cada referência contém `title` e `url`. Antes de adicioná-la ao catálogo, confira a página e a seção que fundamentam a explicação e registre a revisão em `docs/simulados-referencias.json`. Uma comparação de planos, perspectivas, controles ou tipos de política pode sustentar várias alternativas quando documentar efetivamente esses conceitos. Não copiar a fonte geral da questão para preencher opções sem conferir sua pertinência.

O formato anterior de `q` continua aceito. Alternativas legadas sem referência mantêm sua explicação e mostram **Referência específica indisponível para esta alternativa**; o material complementar da questão fica identificado separadamente. O fallback não é usado pelas 542 alternativas atuais. Links só aceitam HTTPS nos hosts oficiais `aws.amazon.com` e `docs.aws.amazon.com`; títulos, textos e atributos são escapados, sem HTML arbitrário. Abrir documentação é uma ação do usuário em nova aba com `noopener noreferrer`; renderizar referências não consulta páginas externas.

O CI valida estrutura, IDs/chaves, associação após reordenação, cobertura e formato de URLs usando os dados locais, sem depender da disponibilidade da AWS. O registro editorial contém 179 fontes, seções consultadas e trechos curtos. Essa conferência de conteúdo é distinta de verificar HTTP 200.

Nenhum gabarito ou identificador de simulado mudou nesta entrega. A resolução D da questão 26 do Simulado 2 ganhou a precisão **GWLB opera na camada 3**, conforme o manual de Gateway Load Balancer. Caso uma revisão futura altere o gabarito, publique outro identificador de versão e mantenha a versão anterior carregável para seus históricos, em vez de reinterpretar respostas antigas.

Limitação editorial específica: o manual oficial de **App2Container** continua em inglês mesmo no endereço com prefixo `pt_br`. O título do link informa **em inglês**. A página de produto redireciona para AWS Transform, por isso foi mantido o manual específico. CDK e X-Ray usam manuais em português em vez de páginas de produto sem tradução ou com redirecionamento. O manual do Amazon Connect usa o nome atual **Connect Customer** e documenta a equivalência com o nome legado usado nas questões.

## Capturas de revisão

As imagens usam sessão, turma, nome e e-mail fictícios dos testes de navegador.

| Estado | Desktop | Celular |
| --- | --- | --- |
| Tentativa em foco | [Desktop](images/simulados-experiencia/focus-desktop.png) | [Celular](images/simulados-experiencia/focus-mobile.png) |
| Correção no cartão | [Desktop](images/simulados-experiencia/feedback-desktop.png) | [Celular](images/simulados-experiencia/feedback-mobile.png) |
| Menu sobreposto | — | [Menu](images/simulados-experiencia/menu-mobile.png) |
| Configuração inicial | [Modos e 90 minutos padrão](images/simulados-experiencia/setup-desktop.png) | — |
| Texto a 200% | [Texto ampliado](images/simulados-experiencia/feedback-desktop-text-200.png) | — |

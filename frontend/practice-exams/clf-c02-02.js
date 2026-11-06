// Segundo conjunto fornecido em inglês. Tradução PT-BR sem respostas ou resultados pessoais.
// Ajustes de precisão estão identificados nas notas das respectivas questões.
import { aws, caf, q, shared, wa } from "./question.js";

const questions = [
  q(1, "3.5", "Qual serviço AWS pode detectar a indisponibilidade dos servidores de um site e direcionar os usuários para servidores alternativos por meio de failover de DNS?", "D", [
    "Amazon GuardDuty", "AWS Trusted Advisor", "Amazon CloudFront", "Amazon Route 53",
  ], [
    "GuardDuty monitora atividades suspeitas e acessos não autorizados nas contas e cargas de trabalho. Ele não faz o roteamento de DNS para servidores alternativos.",
    "Trusted Advisor analisa o ambiente e recomenda melhorias em custos, desempenho, segurança, tolerância a falhas e cotas. Ele não executa o failover de DNS.",
    "CloudFront é uma rede de entrega de conteúdo (CDN), com cache em locais de borda. Ele também oferece failover de origem, mas o roteamento de DNS solicitado é uma função do Route 53.",
    "Route 53 resolve nomes de domínio e permite combinar verificações de integridade com políticas de roteamento de failover. Quando o recurso principal fica indisponível, as respostas de DNS podem apontar para recursos secundários íntegros.",
  ], "https://docs.aws.amazon.com/pt_br/Route53/latest/DeveloperGuide/dns-failover-types.html", "Enunciado esclarecido para especificar failover de DNS: CloudFront também possui failover de origem, ao contrário da afirmação absoluta do original."),
  q(2, "3.6", "Um usuário precisa fazer um único backup de um volume do Amazon EBS anexado a uma instância EC2. Qual é a forma mais eficiente em termos operacionais?", "A", [
    "Criar um snapshot do volume EBS.", "Criar um script personalizado para copiar os arquivos do volume para o Amazon S3.", "Copiar o volume para um servidor externo conectado por AWS Direct Connect.", "Anexar outro volume EBS à instância e copiar o conteúdo.",
  ], [
    "Um snapshot é o recurso nativo de backup pontual do EBS, acionado por uma chamada de API ou pelo console. Os snapshots são incrementais e armazenados pela AWS no S3. É possível criá-los com o volume anexado; para consistência da aplicação, pode ser necessário pausar as gravações.",
    "Um script exige desenvolvimento, testes e manutenção. Usar o snapshot nativo do EBS demanda menos esforço operacional.",
    "Direct Connect fornece conectividade com a rede local. Usá-lo para copiar os dados exige infraestrutura adicional e um processo de transferência, aumentando o trabalho.",
    "Anexar, montar e copiar os dados para outro volume exige várias etapas e gerenciamento manual. O snapshot é a alternativa nativa mais simples.",
  ], "https://docs.aws.amazon.com/pt_br/ebs/latest/userguide/ebs-snapshots.html"),
  q(3, "4.1", "Após escolher uma reserva de Host dedicado do Amazon EC2, qual opção de pagamento oferece o maior desconto, considerando o mesmo host e prazo de reserva?", "B", [
    "Pagamento antecipado parcial", "Pagamento antecipado integral", "Sem pagamento antecipado", "Pagamento por hora sob demanda",
  ], [
    "O pagamento antecipado parcial reduz o desembolso inicial em comparação com o integral, mas não oferece o maior desconto entre essas opções.",
    "O pagamento antecipado integral exige pagar toda a reserva no início e oferece o maior desconto para a mesma configuração e o mesmo prazo.",
    "A opção sem pagamento antecipado dispensa o desembolso inicial, mas seu desconto é menor que o do pagamento integral.",
    "O pagamento sob demanda oferece flexibilidade, porém não concede o desconto pelo compromisso de uma reserva de Host dedicado.",
  ], aws("ec2/dedicated-hosts/pricing")),
  q(4, "4.3", "Qual ferramenta pode ajudar um usuário a identificar se precisa solicitar um aumento de cota de serviço da VPC?", "A", [
    "AWS Trusted Advisor", "AWS Service Catalog", "Relatório de Custos e Uso da AWS", "AWS Health Dashboard",
  ], [
    "Trusted Advisor executa verificações do ambiente e pode alertar sobre a utilização de cotas de serviço, incluindo recursos de VPC, ajudando a identificar a necessidade de aumento.",
    "Service Catalog permite que administradores criem, gerenciem e distribuam portfólios de produtos aprovados aos usuários.",
    "O Relatório de Custos e Uso detalha o consumo e as cobranças da conta. Não é a ferramenta de verificação de cotas solicitada.",
    "AWS Health informa eventos e condições de integridade dos serviços que podem afetar contas e recursos. Não é a verificação de utilização de cotas descrita.",
  ], "https://docs.aws.amazon.com/pt_br/awssupport/latest/user/service-limits.html"),
  q(5, "3.8", "Uma empresa precisa enviar, armazenar e receber mensagens entre componentes de uma aplicação por meio de uma fila. As mensagens devem ser processadas na ordem de entrada, FIFO. Qual serviço deve usar?", "B", [
    "Amazon Kinesis Data Streams", "Amazon Simple Queue Service (Amazon SQS)", "AWS Step Functions", "Amazon Simple Notification Service (Amazon SNS)",
  ], [
    "Kinesis Data Streams atende a fluxos de dados em tempo real e preserva ordenação em condições específicas de cada shard. Ele não é o serviço de filas de mensagens solicitado.",
    "SQS é um serviço de filas totalmente gerenciado que permite desacoplar e dimensionar componentes. As filas FIFO preservam a ordem das mensagens dentro de cada grupo e oferecem recursos de deduplicação.",
    "Step Functions coordena etapas e estados de fluxos de trabalho. Ele pode integrar serviços de mensagens, mas não fornece a fila FIFO solicitada.",
    "SNS distribui mensagens por publicação e assinatura, inclusive com tópicos FIFO. Para armazenar mensagens numa fila e permitir que consumidores as recebam, a alternativa adequada é SQS.",
  ], "https://docs.aws.amazon.com/pt_br/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html", "O original dizia que SNS e Kinesis não oferecem ordenação. A explicação distingue filas SQS, tópicos SNS FIFO e ordenação por shard no Kinesis."),
  q(6, "2.1", "De acordo com o modelo de responsabilidade compartilhada, quais tarefas são responsabilidade da AWS?", "AC", [
    "Manter a segurança física das instalações AWS.", "Definir firewalls de rede dentro da VPC do cliente.", "Aplicar patches e atualizações no hipervisor.", "Definir a criptografia dos dados do cliente.", "Aplicar patches aos sistemas operacionais convidados do EC2.",
  ], [
    "A AWS é responsável por manter a segurança física das instalações que operam seus serviços.",
    "O cliente define e configura os controles de segurança de sua VPC, como grupos de segurança e ACLs. Isso é segurança na nuvem.",
    "A AWS mantém e atualiza o hipervisor da infraestrutura subjacente. Essa tarefa faz parte da segurança da nuvem.",
    "O cliente administra seus dados e escolhe os controles de proteção, incluindo a configuração de criptografia aplicável.",
    "O cliente gerencia e aplica patches ao sistema operacional convidado das instâncias EC2.",
  ], shared),
  q(7, "3.7", "Qual benefício o Amazon Rekognition oferece?", "C", [
    "Fazer lances em trabalhos de detecção de objetos.", "Adicionar marcas-d'água às imagens.", "Detectar objetos que aparecem em imagens.", "Redimensionar automaticamente milhões de imagens.",
  ], [
    "Rekognition usa modelos de machine learning para analisar imagens e vídeos, mas não oferece um mecanismo de lances para trabalhos.",
    "Rekognition identifica conteúdo visual. Ele não adiciona marcas-d'água às imagens.",
    "Rekognition usa modelos de machine learning previamente treinados para detectar objetos e outros elementos em imagens e vídeos.",
    "Redimensionamento é uma operação de processamento de imagem, não a função de análise visual oferecida pelo Rekognition.",
  ], aws("rekognition")),
  q(8, "3.6", "Qual recurso ajuda a proteger objetos de buckets S3 contra sobrescritas ou exclusões acidentais, permitindo recuperar versões anteriores?", "B", [
    "Criptografia do lado do servidor", "Versionamento do bucket", "Políticas de ciclo de vida", "Pontos de acesso do S3",
  ], [
    "A criptografia do lado do servidor protege os dados armazenados. Ela não preserva, por si só, versões anteriores após uma sobrescrita ou exclusão.",
    "O versionamento mantém múltiplas versões dos objetos. Sobrescritas criam novas versões; uma exclusão simples normalmente insere um marcador de exclusão. Assim, versões anteriores podem ser recuperadas. Excluir explicitamente uma versão continua sendo possível com as permissões necessárias.",
    "Políticas de ciclo de vida automatizam transições de classe e expiração de objetos. Não substituem o versionamento para recuperar alterações acidentais.",
    "Pontos de acesso simplificam o gerenciamento do acesso aos dados. Eles não mantêm versões anteriores dos objetos.",
  ], "https://docs.aws.amazon.com/pt_br/AmazonS3/latest/userguide/Versioning.html"),
  q(9, "3.1", "Qual serviço deve ser usado para monitorar a utilização de CPU e de rede em instâncias EC2?", "B", [
    "Amazon Inspector", "Amazon CloudWatch", "AWS CloudTrail", "AWS Config",
  ], [
    "Inspector identifica vulnerabilidades de software e exposição não intencional à rede. Ele não mede a utilização de CPU ou o tráfego da instância.",
    "CloudWatch coleta métricas operacionais. O EC2 publica métricas nativas, como CPUUtilization, NetworkIn e NetworkOut, sem exigir a instalação do agente do CloudWatch. O agente é usado para métricas adicionais, como memória e dados do sistema operacional.",
    "CloudTrail registra chamadas de API e atividades de identidades na conta. Ele não fornece as métricas de utilização de CPU e rede solicitadas.",
    "Config registra configurações e alterações dos recursos e pode avaliar conformidade com regras. Não é o serviço de métricas de CPU e rede.",
  ], "https://docs.aws.amazon.com/pt_br/AWSEC2/latest/UserGuide/viewing_metrics_with_cloudwatch.html", "Corrigida a exigência de agente: as métricas básicas de CPU e rede do EC2 são nativas."),
  q(10, "4.1", "Uma aplicação stateless deve atender tráfego o dia inteiro e aceita interrupções nos recursos usados para absorver picos. O tráfego aumenta muito no horário comercial. Qual combinação é a mais econômica entre estas alternativas?", "C", [
    "Instâncias reservadas para o tráfego de base e para os picos.", "Instâncias sob demanda para a base e sob demanda com Auto Scaling para os picos.", "Instâncias reservadas para a base e instâncias Spot para os picos, usando EC2 Fleet.", "Instâncias sob demanda para a base e instâncias Spot para os picos, usando EC2 Fleet.",
  ], [
    "O compromisso de um ou três anos pode ser adequado à base constante, mas comprometer capacidade para picos limitados ao horário comercial pode desperdiçar o desconto contratado.",
    "Sob demanda oferece flexibilidade, mas não aproveita os descontos de compromisso na base nem os descontos Spot nos picos tolerantes a interrupções.",
    "O desconto de instâncias reservadas é adequado ao consumo constante da base. Spot aproveita capacidade com desconto para os picos tolerantes a interrupções. EC2 Fleet permite definir metas de capacidade e combinar diferentes opções e tipos de instância.",
    "Spot atende aos picos flexíveis, mas a base constante poderia aproveitar um desconto por compromisso em vez de usar apenas preços sob demanda.",
  ], "https://docs.aws.amazon.com/pt_br/AWSEC2/latest/UserGuide/Fleets.html"),
  q(11, "3.5", "Uma empresa está mudando de escritório e precisa estabelecer uma conexão criptografada com a AWS. Qual serviço atende ao requisito?", "A", [
    "AWS VPN", "AWS Direct Connect", "Amazon Connect", "Amazon Route 53",
  ], [
    "AWS Site-to-Site VPN estabelece túneis criptografados entre a rede AWS e redes locais ou de filiais, atendendo ao requisito de conectividade segura.",
    "Direct Connect oferece conectividade dedicada, mas não criptografa o tráfego por padrão. É possível adicionar proteção com mecanismos como VPN ou MACsec, conforme a configuração.",
    "Amazon Connect fornece uma central de atendimento em nuvem. Não é um serviço de conexão criptografada entre redes.",
    "Route 53 fornece registro de domínios, roteamento de DNS e verificações de integridade, não o túnel de rede solicitado.",
  ], aws("vpn")),
  q(12, "1.1", "Qual é um benefício de usar um serviço gerenciado da AWS?", "C", [
    "Eliminar a necessidade de uma estratégia de backup.", "Eliminar a necessidade de cumprir padrões de conformidade.", "Reduzir o trabalho operacional da equipe de TI.", "Aumentar os custos fixos para facilitar as previsões financeiras.",
  ], [
    "Alguns serviços gerenciados executam backups, mas o cliente continua responsável por definir uma estratégia de proteção e recuperação dos dados.",
    "A conformidade continua sendo uma responsabilidade compartilhada. Usar serviços gerenciados não elimina os requisitos aplicáveis à organização.",
    "Serviços gerenciados transferem à AWS parte das tarefas de administração e manutenção. Isso reduz o esforço operacional da equipe, que pode se concentrar nas aplicações e no negócio.",
    "Um benefício da nuvem é trocar investimentos fixos em infraestrutura por despesas variáveis de consumo, não aumentar os custos fixos.",
  ], aws("managed-services/benefits")),
  q(13, "1.4", "Qual princípio de projeto se relaciona ao dimensionamento adequado, ou rightsizing, da infraestrutura AWS?", "B", [
    "Dimensionar horizontalmente para aumentar a disponibilidade.", "Otimizar os custos.", "Fazer mudanças frequentes, pequenas e reversíveis.", "Executar operações como código.",
  ], [
    "O dimensionamento horizontal pode apoiar a confiabilidade e a disponibilidade, mas não é o conceito de rightsizing solicitado.",
    "Rightsizing usa métricas da carga de trabalho para escolher o tipo e o tamanho adequados de recursos. Evitar recursos superdimensionados é uma prática de otimização de custos do Well-Architected.",
    "Mudanças pequenas e reversíveis são um princípio de excelência operacional. Não descrevem diretamente o dimensionamento adequado de recursos.",
    "Operações como código é um princípio de excelência operacional voltado à automação e à repetibilidade das operações.",
  ], "https://docs.aws.amazon.com/pt_br/wellarchitected/latest/cost-optimization-pillar/welcome.html"),
  q(14, "1.1", "Qual benefício permite implantar infraestrutura em múltiplas Regiões geográficas conectadas por uma rede de baixa latência, alta capacidade e redundância?", "B", [
    "Segurança", "Alcance global", "Elasticidade", "Economias de escala",
  ], [
    "Segurança protege recursos e dados. Ela não é o nome do benefício de distribuir infraestrutura geograficamente.",
    "A infraestrutura global da AWS oferece Regiões em diferentes áreas geográficas, interligadas por uma rede de alta capacidade e redundância. Esse alcance permite aproximar aplicações dos usuários.",
    "Elasticidade permite adicionar ou liberar capacidade conforme a demanda. Não descreve a distribuição geográfica da infraestrutura.",
    "Economias de escala decorrem do uso agregado de muitos clientes e podem reduzir preços. Não descrevem a presença geográfica da AWS.",
  ], aws("about-aws/global-infrastructure")),
  q(15, "1.3", "Uma empresa quer usar a perspectiva de governança do AWS CAF para definir e acompanhar os resultados de negócio de sua transformação para a nuvem. Qual capacidade atende a esse objetivo?", "A", [
    "Gerenciamento de benefícios", "Gerenciamento de portfólio de aplicações", "Gerenciamento financeiro da nuvem", "Gerenciamento de riscos",
  ], [
    "Gerenciamento de benefícios ajuda a definir, acompanhar e concretizar os resultados dos investimentos em nuvem, identificando, medindo e comunicando o valor gerado pela transformação.",
    "Gerenciamento de portfólio ajuda a planejar e administrar as aplicações, incluindo decisões sobre suas estratégias de migração.",
    "Gerenciamento financeiro da nuvem acompanha custos, investimentos e indicadores financeiros. O acompanhamento amplo dos resultados de negócio é o foco de gerenciamento de benefícios.",
    "Gerenciamento de riscos identifica, avalia e reduz os riscos da adoção da nuvem. Não é a capacidade específica de acompanhamento de benefícios.",
  ], "https://docs.aws.amazon.com/pt_br/whitepapers/latest/overview-aws-cloud-adoption-framework/governance-perspective.html"),
  q(16, "1.1", "Qual benefício de migrar para a AWS ajuda a reduzir o tempo necessário para colocar novos produtos ou funcionalidades no mercado?", "B", [
    "Diminuir a velocidade de implantação.", "Aumentar a agilidade do negócio.", "Aumentar a segurança da aplicação.", "Ampliar a capacidade de backup.",
  ], [
    "Na nuvem, recursos podem ser provisionados em minutos, aumentando a velocidade de implantação em vez de reduzi-la.",
    "A disponibilidade rápida de recursos de TI permite experimentar e implantar funcionalidades ou aplicações com mais rapidez, aumentando a agilidade do negócio e reduzindo o tempo de chegada ao mercado.",
    "Segurança é essencial, mas não é o benefício que descreve diretamente a rapidez para lançar aplicações.",
    "Recursos de backup ajudam na proteção e recuperação dos dados, mas não descrevem o tempo para lançar novas funcionalidades.",
  ], aws("what-is-cloud-computing")),
  q(17, "3.2", "Uma empresa precisa manter duas instâncias EC2 em instalações distintas, com baixa latência de comunicação entre elas. Qual alternativa atende melhor a esse objetivo?", "D", [
    "Executar uma instância no ambiente local e outra numa Região AWS, conectadas por VPN.", "Colocar ambas num grupo de posicionamento para obter largura de banda dedicada.", "Colocar as instâncias em Regiões distintas conectadas por peering de VPC.", "Colocar as instâncias em zonas de disponibilidade distintas da mesma Região.",
  ], [
    "Executar recursos EC2 localmente exige uma solução como Outposts. Uma conexão entre o ambiente local e uma Região não oferece o mesmo objetivo de baixa latência entre zonas da mesma Região.",
    "Um grupo de posicionamento não fornece uma modalidade de largura de banda dedicada. Grupos de cluster concentram instâncias numa zona; outras estratégias podem abranger mais de uma zona, mas essa alternativa não especifica o isolamento solicitado.",
    "Regiões distintas oferecem separação geográfica, porém a distância geralmente aumenta a latência em comparação com zonas da mesma Região.",
    "Zonas de disponibilidade são instalações isoladas dentro de uma Região, conectadas por redes de baixa latência. Distribuir as instâncias entre zonas atende ao isolamento e reduz o risco de falha correlacionada de uma zona.",
  ], "https://docs.aws.amazon.com/pt_br/AWSEC2/latest/UserGuide/using-regions-availability-zones.html", "Corrigida a explicação sobre grupos de posicionamento: a restrição a uma única zona é própria de grupos de cluster, não de todas as estratégias."),
  q(18, "2.3", "Um desenvolvedor precisa autenticar acesso programático aos recursos AWS pela AWS CLI. Qual recurso do IAM, entre estas alternativas, pode ser usado como credencial?", "C", [
    "Chaves SSH", "Políticas do IAM", "Chaves de acesso do IAM", "Políticas de senha da conta",
  ], [
    "Chaves SSH autenticam conexões a servidores, como instâncias EC2. Elas não são credenciais para assinar chamadas da AWS CLI aos serviços AWS.",
    "Políticas do IAM definem permissões. Elas não são credenciais de autenticação.",
    "Um ID de chave de acesso e uma chave de acesso secreta permitem assinar requisições programáticas. Chaves de usuários IAM são de longo prazo; credenciais temporárias também incluem um token de sessão. Para pessoas, prefira federação ou IAM Identity Center quando possível.",
    "Uma política de senha define requisitos para senhas de usuários IAM. Ela não fornece credenciais programáticas à CLI.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/id_credentials_access-keys.html"),
  q(19, "3.5", "Uma empresa não tem data center próprio e precisa conectar os laptops dos funcionários diretamente e com segurança aos recursos AWS. Qual serviço atende ao requisito?", "C", [
    "Amazon Connect", "Amazon CloudFront", "AWS Client VPN", "AWS Outposts",
  ], [
    "Amazon Connect é uma central de atendimento em nuvem. Ele não fornece a conexão VPN dos laptops.",
    "CloudFront acelera a entrega de conteúdo estático e dinâmico por locais de borda. Ele não fornece acesso VPN aos recursos de rede.",
    "Client VPN é um serviço gerenciado de VPN para dispositivos de usuários. Um cliente compatível com OpenVPN permite acessar recursos AWS e redes conectadas de diferentes locais.",
    "Outposts estende infraestrutura e serviços AWS às instalações do cliente, atendendo a requisitos locais de latência e processamento. Não é o serviço de VPN por laptop solicitado.",
  ], aws("vpn/client-vpn")),
  q(20, "3.1", "Uma empresa precisa executar consultas e pesquisar e analisar dados de log de forma interativa. Qual recurso atende a esse requisito?", "A", [
    "Amazon CloudWatch Logs Insights", "Fluxos de logs do Amazon CloudWatch Logs", "Amazon EventBridge", "Detecção de anomalias do Amazon CloudWatch",
  ], [
    "CloudWatch Logs Insights permite pesquisar e analisar logs interativamente, usando uma linguagem de consulta apropriada. Uma consulta pode abranger múltiplos grupos de logs.",
    "Um fluxo de logs é uma sequência de eventos de uma mesma origem. Ele armazena registros, mas não é, por si só, a ferramenta de consulta e análise interativa.",
    "EventBridge encaminha eventos entre componentes e serviços. Ele não substitui uma ferramenta de consulta interativa de logs.",
    "A detecção de anomalias identifica desvios em padrões de métricas ou logs, conforme o recurso usado. A consulta interativa solicitada é função do Logs Insights.",
  ], "https://docs.aws.amazon.com/pt_br/AmazonCloudWatch/latest/logs/AnalyzingLogData.html"),
  q(21, "1.2", "Um sistema se recupera automaticamente de falhas quando sua carga de trabalho é executada na AWS. Qual pilar do Well-Architected essa situação demonstra?", "B", [
    "Excelência operacional", "Confiabilidade", "Otimização de custos", "Eficiência de desempenho",
  ], [
    "Excelência operacional trata de executar e monitorar sistemas e melhorar continuamente processos, incluindo automação e resposta a eventos.",
    "Confiabilidade trata de executar a função pretendida e se recuperar rapidamente de falhas. A recuperação automática é um dos princípios de projeto desse pilar.",
    "Otimização de custos evita gastos desnecessários e ajuda a escolher os tipos e as quantidades adequadas de recursos.",
    "Eficiência de desempenho trata de selecionar e usar recursos de computação adequados e manter sua eficiência conforme os requisitos mudam.",
  ], "https://docs.aws.amazon.com/pt_br/wellarchitected/latest/reliability-pillar/design-principles.html"),
  q(22, "2.3", "Uma aplicação em EC2 precisa acessar vários recursos, incluindo S3 e DynamoDB. Qual é a solução operacionalmente mais eficiente para conceder as permissões?", "D", [
    "Criar um usuário IAM e gravar suas chaves num perfil da CLI na instância.", "Criar uma função IAM com as permissões e associá-la ao usuário administrador.", "Criar um usuário IAM e inserir suas chaves no código da aplicação.", "Criar uma função IAM com as permissões e associá-la à instância EC2.",
  ], [
    "Gravar credenciais de longo prazo na instância exige administração e rotação manual. Uma função da instância evita essa necessidade.",
    "A função deve ser fornecida à carga de trabalho EC2 por um perfil de instância. A identidade do usuário administrador não concede automaticamente acesso à aplicação.",
    "Inserir chaves de longo prazo no código aumenta o risco de exposição e não é uma prática recomendada.",
    "Associe à instância um perfil de instância que contenha uma função IAM com as permissões necessárias. A aplicação recebe credenciais temporárias, sem armazenar chaves de longo prazo.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html"),
  q(23, "4.3", "Uma empresa precisa ter acesso a engenheiros de suporte em nuvem 24 horas por dia, todos os dias. Qual é o plano do AWS Support de menor custo que atende a esse requisito?", "B", [
    "AWS Unified Operations", "AWS Business Support+", "AWS Basic Support", "AWS Enterprise Support",
  ], [
    "Unified Operations inclui atendimento técnico contínuo, mas oferece um nível adicional de serviços e tem custo superior ao Business Support+.",
    "Business Support+ é o plano de menor custo entre essas alternativas que oferece acesso a engenheiros de suporte em nuvem 24 horas por dia, sete dias por semana.",
    "Basic Support inclui atendimento de conta e faturamento, documentação e outros recursos de autoatendimento. Ele não inclui a abertura de casos com engenheiros de suporte técnico.",
    "Enterprise Support oferece acesso contínuo a engenheiros, mas seu custo é maior que o do Business Support+.",
  ], aws("premiumsupport/plans")),
  q(24, "2.1", "Qual responsabilidade é compartilhada entre a AWS e o cliente?", "D", [
    "Fornecer a chave de criptografia do lado do cliente para o S3.", "Configurar uma instância EC2 do cliente.", "Controlar o ambiente físico dos data centers AWS.", "Promover conscientização e treinamento.",
  ], [
    "Na criptografia realizada do lado do cliente, cabe ao cliente administrar as chaves e o processo de proteção dos dados.",
    "EC2 é infraestrutura como serviço. O cliente configura e administra a segurança de seu sistema operacional convidado e de suas aplicações.",
    "Os controles físicos e ambientais das instalações AWS são responsabilidade da AWS.",
    "A AWS treina seus funcionários, e o cliente deve treinar sua própria equipe. Por isso, conscientização e treinamento são controles compartilhados, exercidos por cada parte em seu âmbito.",
  ], shared),
  q(25, "2.1", "No modelo de responsabilidade compartilhada, quais tarefas de segurança são responsabilidade do cliente?", "AE", [
    "Proteger a integridade dos dados do cliente.", "Manter a segurança física dos locais de borda.", "Proteger a rede da infraestrutura global da AWS.", "Manter a segurança física do hardware nas Regiões AWS.", "Criptografar dados do lado do cliente.",
  ], [
    "O cliente é responsável por classificar, administrar e proteger seus dados, usando os controles e serviços adequados para preservar sua integridade.",
    "A segurança física dos locais de borda faz parte da infraestrutura administrada pela AWS.",
    "A AWS protege a rede física de sua infraestrutura global. O cliente configura os controles de suas redes virtuais.",
    "A segurança física dos dispositivos nos data centers das Regiões é responsabilidade da AWS.",
    "A criptografia realizada na aplicação antes do envio à AWS é administrada pelo cliente, incluindo as escolhas e a gestão das chaves.",
  ], shared),
  q(26, "2.4", "Qual recurso pode ser associado diretamente a uma ACL da web do AWS WAF para proteger uma aplicação web?", "C", [
    "Network Load Balancer (NLB)", "AWS Lambda", "Application Load Balancer (ALB)", "Gateway Load Balancer (GWLB)",
  ], [
    "NLB atua na camada de transporte e não oferece associação direta com uma ACL da web do WAF para inspeção de solicitações HTTP.",
    "Lambda executa código e pode participar de automações relacionadas ao WAF. Uma função Lambda, isoladamente, não é um recurso de associação direta da ACL da web.",
    "ALB atua na camada de aplicação e pode receber uma ACL da web do WAF. Essa associação permite inspecionar e filtrar solicitações HTTP antes de encaminhá-las à aplicação.",
    "GWLB distribui tráfego para dispositivos virtuais de rede e segurança. Ele não é um balanceador HTTP com associação direta ao WAF.",
  ], "https://docs.aws.amazon.com/pt_br/waf/latest/developerguide/how-aws-waf-works-resources.html"),
  q(27, "2.2", "Uma empresa precisa registrar continuamente a atividade da conta AWS, incluindo ações realizadas pelo console, pelos SDKs e pela AWS CLI. Qual serviço atende a esse requisito?", "C", [
    "Amazon Inspector", "Amazon CloudWatch", "AWS CloudTrail", "AWS Trusted Advisor",
  ], [
    "Inspector procura vulnerabilidades de software e exposição de rede em cargas compatíveis. Ele não é o histórico de atividades das identidades na conta.",
    "CloudWatch coleta métricas e logs operacionais e permite alarmes. Pode integrar-se ao CloudTrail, mas não substitui o registro de chamadas de API e ações das identidades.",
    "CloudTrail registra eventos de atividade na conta, incluindo ações realizadas pelo console, pelos SDKs, por chamadas de API e pela CLI. A cobertura de eventos de dados depende da configuração aplicável.",
    "Trusted Advisor avalia o ambiente e recomenda melhorias de práticas. Ele não fornece o registro de auditoria das ações solicitado.",
  ], aws("cloudtrail")),
  q(28, "2.3", "Qual é uma prática recomendada para proteger o usuário-raiz de uma conta AWS?", "A", [
    "Ativar autenticação multifator (MFA) para o usuário-raiz.", "Nunca alterar a senha do usuário-raiz.", "Criar uma chave de acesso para o usuário-raiz.", "Compartilhar a senha do usuário-raiz com a equipe de operações.",
  ], [
    "MFA adiciona outro fator de autenticação e é uma medida essencial de proteção do usuário-raiz. A AWS exige sua configuração nas situações descritas na documentação do usuário-raiz.",
    "A senha deve ser longa, exclusiva e protegida, e deve ser substituída quando houver suspeita de comprometimento. Nunca alterá-la não é uma política adequada de proteção.",
    "A AWS recomenda não criar chaves de acesso do usuário-raiz para o trabalho cotidiano. Prefira identidades com permissões adequadas e credenciais temporárias.",
    "Compartilhar a senha do usuário-raiz reduz a segurança e a rastreabilidade. As pessoas devem usar suas próprias identidades autorizadas.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/root-user-best-practices.html"),
  q(29, "3.1", "Qual serviço pode implantar cópias equivalentes de uma infraestrutura em diferentes Regiões AWS usando o mesmo modelo de recursos?", "B", [
    "AWS CloudTrail", "AWS CloudFormation", "Amazon ElastiCache", "AWS Systems Manager",
  ], [
    "CloudTrail pode registrar atividade em múltiplas Regiões, mas não é o mecanismo de implantação de infraestrutura solicitado.",
    "CloudFormation descreve a infraestrutura como código. Reutilizar um modelo em diferentes Regiões permite implantações consistentes e repetíveis de recursos. A replicação do conteúdo dos dados deve ser configurada separadamente.",
    "ElastiCache fornece armazenamento de dados em memória e recursos de replicação conforme a modalidade. Ele não implanta cópias de uma infraestrutura AWS genérica.",
    "Systems Manager administra recursos e automatiza tarefas operacionais, inclusive em múltiplas Regiões. CloudFormation é a ferramenta de implantação por modelos desta questão.",
  ], aws("cloudformation")),
  q(30, "1.4", "Uma empresa quer levar à AWS licenças de software existentes que exigem identificação dos núcleos físicos. Qual opção atende ao requisito?", "A", [
    "Executar uma instância EC2 em um Host dedicado.", "Comprar instâncias reservadas com locação dedicada.", "Criar uma reserva de capacidade sob demanda.", "Executar uma instância EC2 com locação padrão.",
  ], [
    "Um Host dedicado fornece um servidor físico reservado ao cliente e visibilidade de informações como sockets e núcleos. Isso permite usar licenças compatíveis vinculadas a esses atributos físicos, respeitando os termos do fornecedor.",
    "A locação dedicada pode isolar instâncias de outros clientes, mas não oferece o mesmo controle e a mesma visibilidade do servidor físico de um Host dedicado.",
    "Uma reserva de capacidade garante capacidade correspondente em uma zona, mas não fornece a visibilidade de núcleos físicos exigida pelo licenciamento.",
    "A locação padrão usa hardware que pode ser compartilhado com outros clientes. Ela não fornece controle do servidor físico para esse modelo de licença.",
  ], aws("ec2/dedicated-hosts")),
  q(31, "4.3", "Entre os planos apresentados, qual é o de menor custo que inclui um gerente técnico de conta (TAM) designado?", "C", [
    "AWS Business Support+", "AWS Basic Support", "AWS Enterprise Support", "AWS Unified Operations",
  ], [
    "Business Support+ oferece acesso a engenheiros de suporte, mas não inclui um TAM designado.",
    "Basic Support inclui recursos de autoatendimento e suporte de conta e faturamento, sem TAM designado.",
    "Enterprise Support inclui um TAM designado e tem custo inferior ao Unified Operations. Portanto, é o plano de menor custo entre as alternativas que atende ao requisito.",
    "Unified Operations também inclui um TAM designado, além de outros especialistas e serviços proativos. Seu custo é superior ao Enterprise Support.",
  ], aws("premiumsupport/plans"), "Enunciado corrigido para pedir o plano de menor custo: Unified Operations também inclui TAM. A afirmação original de exclusividade do Enterprise tornava a questão ambígua."),
  q(32, "2.4", "Uma empresa está criando uma aplicação web na AWS. Qual serviço ajuda a proteger a aplicação contra ataques DDoS nas camadas de rede e transporte?", "C", [
    "AWS WAF", "Amazon GuardDuty", "AWS Shield", "AWS Firewall Manager",
  ], [
    "WAF inspeciona solicitações web e protege contra padrões de ataques na camada de aplicação, como injeção SQL e scripts entre sites. Não é o serviço de proteção DDoS de rede solicitado.",
    "GuardDuty detecta ameaças e atividades suspeitas. Ele não é o mecanismo específico de mitigação de ataques DDoS em andamento.",
    "Shield fornece proteção gerenciada contra DDoS, incluindo ataques comuns nas camadas de rede e transporte, para os recursos e as configurações compatíveis.",
    "Firewall Manager centraliza a gestão de políticas de segurança e pode administrar proteções de outros serviços. Ele não fornece, isoladamente, o mecanismo de mitigação DDoS.",
  ], aws("shield")),
  q(33, "4.2", "Qual serviço permite administrar uma conta de gerenciamento responsável pela cobrança consolidada de múltiplas contas AWS?", "A", [
    "AWS Organizations", "AWS Budgets", "Amazon Macie", "Amazon QuickSight",
  ], [
    "Organizations permite gerenciar várias contas centralmente. A cobrança consolidada reúne as cobranças e o pagamento das contas participantes na conta de gerenciamento.",
    "Budgets acompanha custos e uso em relação a limites definidos e pode gerar alertas e ações. Ele não cria uma organização com cobrança consolidada.",
    "Macie descobre e classifica dados sensíveis no S3, usando machine learning e correspondência de padrões.",
    "QuickSight oferece visualização de dados e painéis de business intelligence. Ele não estabelece o relacionamento de cobrança consolidada entre contas.",
  ], "https://docs.aws.amazon.com/pt_br/awsaccountbilling/latest/aboutv2/consolidated-billing.html"),
  q(34, "1.2", "Quais princípios de projeto do Well-Architected ajudam a aumentar a confiabilidade?", "BE", [
    "Medir a eficiência geral.", "Testar os procedimentos de recuperação.", "Adotar um modelo de consumo.", "Usar uma arquitetura monolítica como regra geral.", "Recuperar-se automaticamente de falhas.",
  ], [
    "Medir a eficiência geral é um princípio de otimização de custos, voltado a relacionar o valor entregue aos gastos.",
    "Testar os procedimentos de recuperação permite validar os caminhos de falha e verificar se a carga de trabalho pode voltar a operar conforme os objetivos estabelecidos.",
    "Adotar um modelo de consumo é um princípio de otimização de custos: pagar pelos recursos efetivamente necessários e utilizados.",
    "Um monólito pode aumentar o acoplamento entre componentes. Adotá-lo indiscriminadamente não é um princípio de confiabilidade; o desenho deve considerar isolamento de falhas e recuperação.",
    "A recuperação automática permite detectar falhas e acionar mecanismos de reparo ou substituição sem depender de intervenção manual, apoiando a confiabilidade.",
  ], "https://docs.aws.amazon.com/pt_br/wellarchitected/latest/reliability-pillar/design-principles.html"),
  q(35, "2.1", "Para uma carga de trabalho executada em EC2, qual tarefa é responsabilidade da AWS?", "D", [
    "Atualizar o sistema operacional convidado.", "Atualizar o mecanismo de banco de dados instalado pelo cliente.", "Atualizar os dados do usuário.", "Manter e atualizar o hardware físico subjacente.",
  ], [
    "O cliente aplica as atualizações ao sistema operacional convidado de suas instâncias EC2.",
    "Um banco de dados autogerenciado em EC2 é administrado pelo cliente, incluindo atualizações do mecanismo.",
    "O cliente é responsável por administrar, proteger e manter seus próprios dados.",
    "A AWS administra a infraestrutura física que executa EC2, incluindo manutenção e atualização dos dispositivos subjacentes.",
  ], shared),
  q(36, "4.2", "Qual ferramenta permite visualizar, compreender e analisar os custos e o uso da AWS ao longo do tempo?", "A", [
    "AWS Cost Explorer", "AWS Budgets", "Amazon CloudWatch", "AWS Trusted Advisor",
  ], [
    "Cost Explorer oferece visualizações e filtros para analisar gastos e consumo históricos da AWS, identificar tendências e compreender sua evolução.",
    "Budgets permite definir orçamentos e receber alertas de custos ou uso. A ferramenta voltada à análise visual solicitada é Cost Explorer.",
    "CloudWatch monitora métricas, logs e a operação das cargas de trabalho. Não é a ferramenta de análise de gastos solicitada.",
    "Trusted Advisor recomenda melhorias no ambiente, inclusive de custos. Ele não substitui a análise temporal de gastos do Cost Explorer.",
  ], aws("aws-cost-management/aws-cost-explorer")),
  q(37, "2.1", "Qual tarefa é responsabilidade da AWS no modelo de responsabilidade compartilhada?", "D", [
    "Configurar novos recursos dentro da conta do cliente.", "Atualizar os sistemas operacionais convidados de instâncias EC2.", "Projetar a recuperação de desastres da aplicação do cliente.", "Proteger a infraestrutura física.",
  ], [
    "O cliente decide quais serviços usar e como configurar seus recursos.",
    "Em EC2, o cliente administra as atualizações de seus sistemas operacionais convidados.",
    "A AWS oferece serviços de recuperação de desastres, mas o cliente define a arquitetura e os objetivos de recuperação de sua aplicação.",
    "A AWS mantém os controles de proteção física das instalações e do hardware que operam seus serviços.",
  ], shared),
  q(38, "1.3", "Qual capacidade fundamental pertence à perspectiva de operações do AWS Cloud Adoption Framework (AWS CAF)?", "C", [
    "Gerenciamento de identidade e acesso", "Gerenciamento de portfólio de aplicações", "Gerenciamento de desempenho e capacidade", "Gerenciamento de produtos",
  ], [
    "Gerenciamento de identidade e acesso pertence à perspectiva de segurança do CAF.",
    "Gerenciamento de portfólio de aplicações pertence à perspectiva de governança do CAF.",
    "Gerenciamento de desempenho e capacidade faz parte da perspectiva de operações e ajuda a manter os serviços adequados às necessidades do negócio.",
    "Gerenciamento de produtos pertence à perspectiva de negócios do CAF.",
  ], "https://docs.aws.amazon.com/pt_br/whitepapers/latest/overview-aws-cloud-adoption-framework/operations-perspective.html"),
  q(39, "3.4", "Uma empresa precisa gerar relatórios de business intelligence e análises operacionais sobre petabytes de dados estruturados e semiestruturados num data lake S3, usando consultas SQL. Qual serviço atende ao requisito?", "B", [
    "Amazon Neptune", "Amazon Redshift", "Amazon DynamoDB", "Amazon RDS",
  ], [
    "Neptune é um banco de grafos para dados e relacionamentos altamente conectados. Não é o data warehouse para consultas SQL ao data lake descrito.",
    "Redshift é um data warehouse gerenciado voltado a análises em grande escala com SQL. Redshift Spectrum permite consultar diretamente dados armazenados no S3, atendendo ao cenário de relatórios sobre o data lake.",
    "DynamoDB é um banco NoSQL operacional, de chave-valor e documentos. Embora ofereça uma linguagem compatível com SQL por meio do PartiQL, não é o serviço de análise de petabytes no data lake solicitado.",
    "RDS gerencia bancos relacionais voltados principalmente a cargas operacionais e transacionais. Redshift é a opção de data warehouse para o cenário descrito.",
  ], "https://docs.aws.amazon.com/pt_br/redshift/latest/dg/c-using-spectrum.html", "Corrigida a afirmação de que DynamoDB não tem suporte a uma linguagem compatível com SQL: ele oferece PartiQL, mas não atende ao papel de data warehouse solicitado."),
  q(40, "3.2", "Quais afirmações descrevem corretamente as Regiões e as zonas de disponibilidade da AWS?", "AD", [
    "As Regiões estão distribuídas pelo mundo.", "Uma zona de disponibilidade contém várias Regiões.", "Todas as Regiões estão a até 100 km umas das outras.", "Uma Região é composta por múltiplas zonas de disponibilidade.", "As Regiões levam automaticamente os serviços AWS às instalações locais do cliente.",
  ], [
    "As Regiões são áreas geográficas distribuídas pelo mundo e fazem parte da infraestrutura global da AWS.",
    "A relação é a inversa: uma Região contém zonas de disponibilidade, compostas por um ou mais data centers distintos.",
    "As Regiões ficam em diferentes áreas geográficas. Não existe a regra de que todas estejam a até 100 km entre si.",
    "Cada Região contém múltiplas zonas isoladas, permitindo distribuir cargas de trabalho para aumentar a disponibilidade.",
    "Serviços como Outposts permitem executar determinados recursos AWS nas instalações do cliente. Isso não ocorre automaticamente apenas pela existência de uma Região.",
  ], aws("about-aws/global-infrastructure/regions_az")),
  q(41, "3.1", "Uma empresa tem uma aplicação web Java e quer automatizar a criação do ambiente AWS e a implantação de novas versões da aplicação. Qual serviço atende ao requisito?", "A", [
    "AWS Elastic Beanstalk", "AWS Auto Scaling", "Amazon EC2", "AWS Control Tower",
  ], [
    "No Elastic Beanstalk, a empresa envia o código e o serviço administra a implantação, além de provisionamento de capacidade, balanceamento, dimensionamento automático e monitoramento de integridade do ambiente.",
    "Auto Scaling ajusta a capacidade dos recursos configurados. Ele não fornece, por si só, o fluxo completo de criação do ambiente e implantação da aplicação.",
    "EC2 fornece capacidade de computação. A empresa teria de configurar e administrar os mecanismos adicionais de implantação.",
    "Control Tower configura e governa ambientes com múltiplas contas. Não é o serviço de implantação da aplicação Java solicitado.",
  ], aws("elasticbeanstalk")),
  q(42, "3.1", "Uma empresa quer acessar remotamente instâncias EC2 com melhor segurança e auditoria, sem abrir portas SSH de entrada nem administrar chaves SSH. Qual recurso deve usar?", "D", [
    "Pares de chaves do EC2", "AWS Identity and Access Management (IAM)", "ACLs de rede", "AWS Systems Manager Session Manager",
  ], [
    "Pares de chaves podem autenticar conexões SSH, mas mantêm a necessidade de administrar chaves e o caminho de acesso SSH.",
    "IAM autoriza identidades e ações. Ele participa do controle de acesso ao Session Manager, mas não oferece, sozinho, a sessão remota solicitada.",
    "ACLs filtram tráfego de entrada e saída de sub-redes. Elas não fornecem uma sessão remota para administrar a instância.",
    "Session Manager permite sessões remotas gerenciadas e controladas por IAM, sem abrir portas de entrada nem distribuir chaves SSH. A instância precisa estar configurada como nó gerenciado e ter conectividade com os endpoints necessários.",
  ], "https://docs.aws.amazon.com/pt_br/systems-manager/latest/userguide/session-manager.html"),
  q(43, "3.6", "Entre os serviços apresentados, qual é a opção mais adequada e econômica para armazenar arquivos de imagens estáticas como objetos?", "B", [
    "Amazon DynamoDB", "Amazon S3", "Amazon Elastic Block Store (Amazon EBS)", "Amazon Elastic File System (Amazon EFS)",
  ], [
    "DynamoDB armazena itens de chave-valor e documentos, podendo incluir atributos binários. Ele não é a opção indicada para servir de repositório de arquivos de imagens estáticas.",
    "S3 é um serviço de armazenamento de objetos, adequado a imagens e outros arquivos estáticos. A cobrança depende do armazenamento, das solicitações e dos demais recursos utilizados, sem necessidade de administrar volumes ou servidores de arquivos.",
    "EBS fornece volumes em blocos para uso com EC2, com cobrança de capacidade provisionada e desempenho conforme o tipo. É uma solução operacionalmente mais complexa para esse repositório de objetos.",
    "EFS fornece um sistema de arquivos compartilhado para cargas que precisam de acesso por arquivo. Para o cenário de objetos estáticos descrito, S3 é a alternativa apropriada.",
  ], aws("s3"), "Removida a afirmação de que DynamoDB não pode armazenar imagens: ele aceita atributos binários, mas não é a solução de armazenamento de objetos solicitada."),
  q(44, "3.1", "Qual recurso um desenvolvedor pode usar para acessar os serviços AWS programaticamente a partir de uma linguagem de programação?", "C", [
    "Console de Gerenciamento da AWS", "AWS CodeDeploy", "Kits de desenvolvimento de software da AWS (SDKs)", "AWS CodePipeline",
  ], [
    "O console oferece uma interface web para interação com serviços. Ele não é a biblioteca de acesso programático a partir de uma linguagem.",
    "CodeDeploy automatiza implantações de aplicações em recursos compatíveis. Não é o conjunto de bibliotecas de acesso aos serviços.",
    "Os SDKs fornecem bibliotecas e APIs para que aplicações acessem serviços AWS usando linguagens de programação, incluindo o tratamento de solicitações e autenticação conforme a configuração.",
    "CodePipeline modela e automatiza etapas de entrega de software. Ele não substitui os SDKs usados pelo código da aplicação.",
  ], aws("developer/tools")),
  q(45, "1.1", "Um varejista tem grandes picos sazonais de vendas e demanda menor no restante do ano. É difícil prever a capacidade necessária em cada período. Quais benefícios da nuvem mais ajudam nesse cenário?", "CD", [
    "Presença global", "Cotas de serviço da AWS", "Elasticidade", "Pagamento conforme o uso", "Modelo de responsabilidade compartilhada",
  ], [
    "Alcance global aproxima aplicações dos usuários, mas não atende diretamente à variação sazonal de capacidade descrita.",
    "Cotas definem limites de utilização dos serviços. Elas não são o benefício de ajustar a capacidade à demanda.",
    "Elasticidade permite aumentar e reduzir recursos conforme a demanda. Assim, a empresa pode absorver os picos sem precisar manter toda a capacidade de pico durante o ano.",
    "Pagar pelo consumo permite relacionar despesas aos recursos realmente utilizados, inclusive nos períodos sazonais, reduzindo a necessidade de investir antecipadamente em capacidade física para os picos.",
    "O modelo de responsabilidade compartilhada define obrigações de segurança da AWS e do cliente. Não descreve a adaptação de capacidade ou de custos aos picos.",
  ], aws("what-is-cloud-computing")),
  q(46, "2.3", "Qual é uma prática recomendada para as chaves de acesso do usuário-raiz de uma conta AWS?", "A", [
    "Excluir as chaves de acesso do usuário-raiz sempre que possível.", "Permitir que administradores usem credenciais do usuário-raiz no dia a dia.", "Usar credenciais do usuário-raiz para acessar rotineiramente dados sensíveis.", "Usar credenciais do usuário-raiz para acessar rotineiramente bancos de produção.",
  ], [
    "Evite criar chaves de acesso do usuário-raiz e exclua as existentes que não sejam necessárias. Use o usuário-raiz apenas para tarefas que realmente exigem suas credenciais, protegendo-o com os controles apropriados.",
    "O trabalho cotidiano deve usar identidades individuais com permissões adequadas. Compartilhar o acesso raiz amplia o risco e prejudica a rastreabilidade.",
    "O acesso a dados sensíveis deve ser autorizado por políticas para as identidades que precisam dele, seguindo privilégio mínimo.",
    "Bancos de produção devem ser acessados por mecanismos de autenticação e permissões apropriados. Credenciais do usuário-raiz não são a identidade de trabalho cotidiano.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/root-user-best-practices.html"),
  q(47, "3.2", "Uma empresa está elaborando um plano de recuperação de desastres e precisa replicar dados entre áreas geográficas distintas. Qual componente da infraestrutura AWS atende a esse objetivo?", "B", [
    "Zonas de disponibilidade", "Regiões AWS", "Contas AWS", "Locais de borda",
  ], [
    "Uma zona contém um ou mais data centers isolados dentro de uma Região. Múltiplas zonas ajudam contra falhas locais, mas o requisito pede áreas geográficas distintas.",
    "Regiões são áreas geográficas distintas, cada uma com múltiplas zonas de disponibilidade. Replicar dados entre Regiões pode apoiar a recuperação de desastres que afetem uma Região inteira.",
    "Contas são limites de administração, segurança e faturamento. Contas distintas não garantem separação geográfica dos dados.",
    "Locais de borda executam funções específicas, como entrega e cache de conteúdo pelo CloudFront. Eles não substituem a arquitetura de replicação de dados entre Regiões.",
  ], aws("about-aws/global-infrastructure")),
  q(48, "4.1", "Uma empresa precisa executar uma aplicação em EC2 sem aceitar interrupções de capacidade Spot e sem compromisso de longo prazo. Qual opção é a mais econômica entre as apresentadas?", "D", [
    "Instâncias Spot", "Instâncias reservadas", "Hosts dedicados", "Instâncias sob demanda",
  ], [
    "Spot oferece descontos, mas sua capacidade pode ser interrompida. Não atende à restrição apresentada para a execução da carga.",
    "Instâncias reservadas oferecem descontos mediante compromisso de um ou três anos, o que contraria o requisito.",
    "Hosts dedicados atendem a requisitos de isolamento físico e licenciamento que não foram solicitados e tendem a aumentar o custo deste cenário.",
    "Sob demanda permite pagar pela capacidade utilizada, por segundo ou por hora conforme a modalidade, sem compromisso de longo prazo e sem a interrupção de capacidade característica do Spot.",
  ], aws("ec2/pricing/on-demand")),
  q(49, "4.2", "Uma empresa planeja uma nova aplicação analítica com Redshift e precisa estimar os custos antes de implantá-la. Qual ferramenta fornece essa estimativa?", "D", [
    "AWS Cost Explorer", "Savings Plans", "AWS Budgets", "AWS Pricing Calculator",
  ], [
    "Cost Explorer analisa gastos e uso existentes e pode produzir previsões com base no histórico. Para planejar o custo de uma nova configuração antes da implantação, use a calculadora de preços.",
    "Savings Plans é um modelo de desconto por compromisso de consumo em categorias elegíveis. Não é uma ferramenta de estimativa da nova arquitetura.",
    "Budgets permite definir limites de custos e uso e alertas de valores reais ou previstos. Não substitui a estimativa de uma nova configuração de recursos.",
    "Pricing Calculator permite modelar cenários e estimar o custo de serviços AWS antes da implantação, incluindo configurações de uso do Redshift.",
  ], aws("aws-cost-management/aws-pricing-calculator"), "Corrigida a afirmação absoluta de que Cost Explorer não faz estimativas: ele oferece previsões baseadas em histórico; o cenário exige planejamento de uma nova implantação."),
  q(50, "2.3", "Quais práticas ajudam a proteger o uso de identidades e credenciais do AWS IAM?", "AE", [
    "Rotacionar as credenciais de longo prazo quando elas forem necessárias.", "Manter todas as credenciais, mesmo as que nunca são usadas.", "Preferir sempre políticas inline às políticas gerenciadas pelo cliente.", "Usar credenciais do usuário-raiz para tarefas rotineiras do IAM.", "Ativar autenticação multifator (MFA).",
  ], [
    "Prefira credenciais temporárias. Quando chaves de acesso de longo prazo forem necessárias, a AWS recomenda atualizá-las e rotacioná-las conforme as práticas aplicáveis, além de removê-las quando deixarem de ser usadas.",
    "Credenciais desnecessárias ou sem uso devem ser revisadas e removidas para reduzir a superfície de exposição.",
    "Políticas gerenciadas pelo cliente podem ser reutilizadas e administradas centralmente. Políticas inline têm usos específicos, mas preferi-las sempre não é a recomendação geral.",
    "Reserve o usuário-raiz para tarefas que exigem suas credenciais. As tarefas rotineiras devem usar identidades com privilégios apropriados.",
    "MFA adiciona outro fator de autenticação e reduz o risco de acesso baseado apenas numa senha comprometida. É especialmente importante para identidades privilegiadas.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/best-practices.html"),
  q(51, "2.3", "Uma instância EC2 precisa recuperar credenciais armazenadas no AWS Secrets Manager. Qual identidade deve conceder as permissões à instância?", "A", [
    "Função do IAM", "Autenticação multifator (MFA)", "Grupos de segurança", "Grupo de usuários do IAM",
  ], [
    "Uma função IAM com as permissões necessárias pode ser entregue à instância por um perfil de instância. A aplicação usa as credenciais temporárias dessa função para consultar os segredos autorizados.",
    "MFA adiciona um fator à autenticação de usuários, mas não concede automaticamente à instância permissões de acesso aos segredos.",
    "Grupos de segurança controlam tráfego de rede. Eles não substituem a autorização IAM para ler um segredo.",
    "Um grupo IAM reúne usuários e permite atribuir permissões a eles. Uma instância EC2 não assume a identidade de um grupo de usuários.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html"),
  q(52, "2.2", "Qual serviço pode identificar informações de identificação pessoal (PII) armazenadas num bucket S3 e gerar uma descoberta de dados sensíveis?", "A", [
    "Amazon Macie", "AWS Trusted Advisor", "Amazon Inspector", "Amazon GuardDuty",
  ], [
    "Macie usa machine learning e correspondência de padrões para descobrir e classificar dados sensíveis no S3. Ele pode analisar buckets selecionados e gerar descobertas quando identificar PII e outros dados sensíveis.",
    "Trusted Advisor recomenda práticas para o ambiente AWS. Não é o serviço de inspeção do conteúdo de objetos em busca de PII.",
    "Inspector procura vulnerabilidades de software e exposição não intencional à rede em cargas compatíveis, não PII em objetos do S3.",
    "GuardDuty detecta ameaças e comportamento suspeito nas contas e cargas. Sua finalidade não é a descoberta e classificação de PII no conteúdo do S3.",
  ], aws("macie")),
  q(53, "3.4", "Qual serviço oferece armazenamento de dados em memória para casos como cache de aplicações e bancos de dados?", "B", [
    "Amazon DynamoDB", "Amazon ElastiCache", "Amazon RDS", "Amazon Timestream",
  ], [
    "DynamoDB é um banco durável de chave-valor e documentos. Ele não é o cache em memória solicitado.",
    "ElastiCache é um serviço gerenciado de armazenamento e cache em memória, usado para reduzir a latência e aliviar o acesso às fontes de dados.",
    "RDS administra bancos relacionais. Embora os mecanismos usem memória para otimização interna, sua finalidade não é oferecer o serviço de cache em memória descrito.",
    "Timestream atende a dados de séries temporais e tem arquitetura própria de armazenamento. Não é a solução de cache de aplicações solicitada.",
  ], aws("elasticache")),
  q(54, "3.8", "Qual serviço facilita configurar um novo ambiente AWS com múltiplas contas e governá-lo em escala?", "A", [
    "AWS Control Tower", "AWS Security Hub", "AWS Trusted Advisor", "AWS Resource Access Manager (AWS RAM)",
  ], [
    "Control Tower ajuda a estabelecer e governar um ambiente com várias contas, aplicando uma estrutura de landing zone e controles de governança.",
    "Security Hub reúne descobertas e avaliações de segurança. Ele não é o serviço de configuração inicial da landing zone com múltiplas contas.",
    "Trusted Advisor inspeciona o ambiente e fornece recomendações. Não substitui a configuração e a governança de múltiplas contas do Control Tower.",
    "RAM permite compartilhar recursos compatíveis entre contas, inclusive dentro de uma organização. Não estabelece sozinho a landing zone e sua governança.",
  ], aws("controltower")),
  q(55, "2.2", "Uma empresa precisa auditar seus recursos AWS e documentar as alterações de configuração realizadas. Qual serviço atende a esse requisito?", "D", [
    "AWS Artifact", "Amazon Inspector", "Amazon CloudWatch", "AWS Config",
  ], [
    "Artifact disponibiliza relatórios e acordos de segurança e conformidade da AWS. Ele não mantém o histórico de configuração dos recursos do cliente.",
    "Inspector verifica vulnerabilidades de software e exposição de rede. Ele não fornece o inventário histórico de configurações solicitado.",
    "CloudWatch coleta métricas e logs operacionais. O histórico estruturado de configuração de recursos é uma função do Config.",
    "Config mantém informações de inventário, configurações e histórico de mudanças dos recursos registrados. Esses registros permitem avaliar e auditar as alterações do ambiente.",
  ], aws("config")),
  q(56, "2.3", "Em uma conta AWS autônoma, quais tarefas exigem o uso do usuário-raiz?", "DE", [
    "Alterar o tipo de uma instância EC2.", "Agrupar recursos no AWS Systems Manager.", "Executar aplicações no Amazon EKS.", "Restaurar permissões quando o único administrador IAM removeu acidentalmente o próprio acesso.", "Encerrar a conta AWS autônoma.",
  ], [
    "Uma identidade IAM com as permissões necessárias pode alterar o tipo da instância. Não é necessário usar o usuário-raiz.",
    "Uma identidade IAM autorizada pode administrar os recursos e os agrupamentos do Systems Manager.",
    "Identidades autorizadas podem administrar e executar aplicações no EKS sem recorrer ao usuário-raiz.",
    "Quando o único administrador IAM perde as próprias permissões nessa conta, o usuário-raiz pode restaurar o acesso administrativo conforme os procedimentos de recuperação.",
    "O encerramento de uma conta autônoma exige autenticação como usuário-raiz da própria conta. Contas-membro de Organizations possuem procedimentos adicionais que podem permitir encerramento pela conta de gerenciamento.",
  ], "https://docs.aws.amazon.com/pt_br/accounts/latest/reference/manage-acct-closing.html", "O enunciado especifica conta autônoma: nem todo encerramento de conta-membro do Organizations exige fazer login como usuário-raiz na conta encerrada."),
  q(57, "3.3", "Uma aplicação será executada em EC2 e precisará de mais instâncias conforme a carga aumentar. Qual recurso pode iniciar automaticamente as instâncias adicionais necessárias?", "B", [
    "AWS App2Container", "Amazon EC2 Auto Scaling", "Elastic Load Balancing (ELB)", "AWS Systems Manager",
  ], [
    "App2Container é uma ferramenta de modernização que ajuda a preparar aplicações para execução em contêineres. Não é o mecanismo de ajuste da frota EC2 descrito.",
    "EC2 Auto Scaling pode adicionar ou remover instâncias de um grupo conforme políticas, métricas, horários e limites configurados, adequando a capacidade à carga da aplicação.",
    "ELB distribui tráfego entre destinos disponíveis. Ele não inicia instâncias EC2 para aumentar a frota da aplicação.",
    "Systems Manager administra recursos e automatiza tarefas operacionais. O ajuste automático da quantidade de instâncias com a carga é função do EC2 Auto Scaling.",
  ], aws("ec2/autoscaling")),
  q(58, "2.4", "Uma aplicação recebe ataques de injeção SQL de múltiplas origens externas. Qual serviço pode filtrar as solicitações web para ajudar a automatizar a mitigação?", "A", [
    "AWS WAF", "ACL de rede", "Elastic Load Balancing (ELB)", "Grupos de segurança",
  ], [
    "WAF inspeciona solicitações web e permite aplicar regras para identificar e bloquear padrões de injeção SQL. Essas regras complementam práticas seguras de desenvolvimento e de acesso ao banco.",
    "ACLs filtram tráfego por critérios como IP, protocolo e porta. Elas não inspecionam o conteúdo HTTP em busca de padrões SQL.",
    "ELB distribui solicitações entre os destinos. Para filtrar padrões de injeção SQL num ALB, associe uma ACL da web do WAF.",
    "Grupos de segurança controlam tráfego de rede para os recursos associados. Eles não analisam o conteúdo SQL das solicitações HTTP.",
  ], "https://docs.aws.amazon.com/pt_br/waf/latest/developerguide/waf-rule-statement-type-sqli-match.html"),
  q(59, "1.3", "Uma empresa executa MySQL em servidores autogerenciados no data center local e quer migrar para um serviço gerenciado AWS, como RDS, mantendo o mecanismo e a arquitetura principal. Qual estratégia de migração atende ao objetivo?", "B", [
    "Rehospedar (rehost)", "Mudar de plataforma (replatform)", "Refatorar (refactor)", "Recomprar (repurchase)",
  ], [
    "Rehospedar, ou lift and shift, transfere a carga com poucas mudanças. Levar os servidores autogerenciados para EC2 manteria a administração do banco com o cliente.",
    "Replatform faz otimizações direcionadas sem redesenhar toda a arquitetura. Migrar MySQL autogerenciado para RDS for MySQL mantém o mecanismo e reduz o trabalho operacional por meio do serviço gerenciado.",
    "Refatorar exige mudanças mais profundas na arquitetura ou no código para aproveitar recursos de nuvem. Esse nível de alteração não é necessário para a migração descrita.",
    "Recomprar significa substituir a solução por outro produto, frequentemente SaaS. Não é a estratégia de manter o MySQL numa plataforma gerenciada.",
  ], "https://docs.aws.amazon.com/pt_br/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html"),
  q(60, "1.2", "Qual alternativa é um exemplo de alta disponibilidade na nuvem AWS?", "A", [
    "Manter a aplicação acessível mesmo quando um recurso falha.", "Implantar recursos em qualquer parte do mundo usando Regiões AWS.", "Consultar o suporte técnico a qualquer hora do dia.", "Usar serviços pagando conforme o consumo.",
  ], [
    "Uma arquitetura de alta disponibilidade usa redundância e outros mecanismos para reduzir interrupções e manter o serviço acessível diante de falhas de componentes, evitando pontos únicos de falha.",
    "Essa alternativa descreve alcance global. A distribuição geográfica pode apoiar a disponibilidade, mas alcance global não é, por si só, sua definição.",
    "A disponibilidade do suporte, conforme o plano contratado, não garante que a aplicação continue operando durante uma falha.",
    "Pagamento conforme o uso descreve o modelo de preços, não a capacidade da aplicação de permanecer acessível.",
  ], wa),
  q(61, "3.3", "Qual serviço de computação permite executar funções de código sem provisionar nem administrar servidores?", "C", [
    "Amazon Elastic Container Service (Amazon ECS)", "Amazon EC2", "AWS Lambda", "Amazon RDS",
  ], [
    "ECS orquestra contêineres e pode usar infraestrutura EC2 ou computação sem servidor com Fargate. A execução de funções de código descrita é o caso do Lambda.",
    "EC2 fornece instâncias virtuais cujo sistema operacional e configuração são administrados pelo cliente, incluindo tarefas de capacidade e manutenção.",
    "Lambda executa funções em resposta a eventos, sem exigir que o cliente provisione ou administre servidores. A AWS mantém a infraestrutura e ajusta a capacidade do serviço; o cliente continua responsável por seu código e dependências.",
    "RDS é um serviço de bancos relacionais. Modalidades como Aurora Serverless podem ajustar capacidade, mas não são o serviço de execução de funções de código solicitado.",
  ], aws("lambda"), "O enunciado identifica execução de funções para evitar generalizações: ECS pode usar Fargate, e Aurora oferece modalidades sem servidor."),
  q(62, "2.3", "Quais afirmações descrevem os usuários e grupos de usuários do IAM?", "AD", [
    "Um usuário pode fazer parte de vários grupos.", "Um usuário só pode fazer parte de um único grupo por vez.", "Grupos podem ser aninhados e conter outros grupos.", "Grupos podem conter usuários, mas não outros grupos.", "Novos usuários entram automaticamente num grupo padrão.",
  ], [
    "Um usuário IAM pode pertencer a múltiplos grupos e receber as permissões aplicáveis desses grupos.",
    "Não existe a restrição a um único grupo. Usuários podem pertencer a vários grupos, respeitando as cotas aplicáveis.",
    "O IAM não permite grupos de usuários aninhados.",
    "Grupos IAM contêm usuários. Eles não contêm outros grupos, nem permitem uma hierarquia de grupos aninhados.",
    "Não há um grupo padrão ao qual todo novo usuário seja automaticamente associado. A inclusão nos grupos precisa ser configurada.",
  ], "https://docs.aws.amazon.com/pt_br/IAM/latest/UserGuide/id_groups.html"),
  q(63, "1.3", "Uma empresa está migrando uma aplicação para a AWS e precisa transferir seu banco de dados para o Amazon RDS. Qual serviço é indicado para realizar a migração dos dados?", "C", [
    "AWS Application Migration Service", "Migration Evaluator", "AWS Database Migration Service (AWS DMS)", "AWS Schema Conversion Tool (AWS SCT)",
  ], [
    "Application Migration Service atende à migração de servidores e aplicações para a AWS. Para transferir o banco para um destino gerenciado RDS, o serviço especializado é DMS.",
    "Migration Evaluator avalia o ambiente local e ajuda a criar o caso de negócio da migração, com projeções de custos e recursos. Ele não executa a transferência do banco.",
    "DMS ajuda a migrar bancos para a AWS, incluindo RDS como destino. Conforme a configuração e os mecanismos compatíveis, pode fazer carga inicial e replicar alterações para reduzir a interrupção durante a migração.",
    "SCT converte esquemas e objetos de banco entre mecanismos compatíveis e pode ser usado com DMS. Converter o esquema não substitui a transferência e a replicação dos dados solicitadas.",
  ], aws("dms")),
  q(64, "2.1", "No modelo de responsabilidade compartilhada, quais tarefas são responsabilidade do cliente ao executar aplicações em instâncias EC2?", "BC", [
    "Aplicar patches ao hardware de rede físico da AWS.", "Configurar os firewalls da carga de trabalho.", "Aplicar patches ao sistema operacional convidado.", "Desativar e descartar dispositivos físicos de armazenamento obsoletos.", "Proteger fisicamente o hardware do data center AWS.",
  ], [
    "A AWS administra o hardware físico de rede e aplica suas atualizações.",
    "O cliente configura os controles de tráfego de sua carga, como grupos de segurança, ACLs e firewalls do sistema operacional, conforme sua arquitetura.",
    "Em EC2, o cliente mantém e atualiza o sistema operacional convidado e as aplicações instaladas.",
    "A AWS administra o ciclo de vida e o descarte seguro dos dispositivos físicos de sua infraestrutura.",
    "A proteção física dos dispositivos e das instalações que operam os serviços é responsabilidade da AWS.",
  ], shared),
  q(65, "1.2", "Quais alternativas são princípios do pilar de segurança do AWS Well-Architected Framework?", "BE", [
    "Implantar globalmente em minutos.", "Proteger dados em trânsito e em repouso.", "Executar operações como código.", "Analisar e atribuir despesas.", "Monitorar, alertar e auditar ações e alterações nos recursos AWS.",
  ], [
    "Alcance global e implantação rápida são benefícios de nuvem e apoiam decisões de desempenho. Não são o princípio específico de proteção de dados solicitado.",
    "Proteger dados em trânsito e em repouso é um princípio de segurança. Envolve controles como criptografia, classificação e gestão de acesso adequados aos dados.",
    "Executar operações como código é um princípio de excelência operacional.",
    "Analisar e atribuir despesas pertence ao pilar de otimização de custos.",
    "Habilitar rastreabilidade é um princípio de segurança: monitorar, alertar e auditar as ações e mudanças no ambiente permite investigar e responder a eventos.",
  ], "https://docs.aws.amazon.com/pt_br/wellarchitected/latest/framework/sec-design.html"),
];

export const exam = {
  id: "clf-c02-02-v1", title: "Simulado 2", description: "Cenários de arquitetura, segurança e operação",
  locale: "pt-BR", sourceLocale: "en", reviewedAt: "2026-11-06", questions,
};

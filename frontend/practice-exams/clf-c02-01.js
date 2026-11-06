// Primeiro conjunto fornecido pelo usuário; sem respostas ou resultados pessoais.
import { aws, caf, q, shared, wa } from "./question.js";

const questions = [
  q(1, "1.1", "Quais são os benefícios de usar a nuvem AWS?", "AB", [
    "Possibilidade de implantação global em minutos.", "Maior velocidade e agilidade.", "Ausência de risco de violações de segurança.", "Não há necessidade de corrigir software do usuário.", "É feito o backup global de todos os dados do usuário.",
  ], [
    "É possível implantar aplicações em várias Regiões rapidamente e aproximá-las dos usuários.",
    "Provisionar recursos em minutos reduz o tempo necessário para experimentar e desenvolver.",
    "A nuvem não elimina riscos. O cliente continua responsável pela segurança de seus dados, acessos e configurações.",
    "O cliente continua responsável por corrigir suas aplicações e, no EC2, o sistema operacional convidado.",
    "A política de backup depende do serviço e da configuração. A AWS não faz backup global automático de todos os dados.",
  ], aws("what-is-cloud-computing")),
  q(2, "4.1", "Uma empresa exige isolamento físico entre suas instâncias do Amazon EC2 e as instâncias de outros clientes. Qual opção atende a esse requisito?", "C", [
    "Instâncias sob demanda", "Instâncias spot", "Hosts dedicados", "Instâncias reservadas",
  ], [
    "Sob demanda define uma forma de cobrança, sem garantir hardware fisicamente dedicado.",
    "Spot aproveita capacidade disponível com possibilidade de interrupção; não garante isolamento físico.",
    "Um host dedicado é um servidor físico reservado ao cliente, com visibilidade e controle da colocação das instâncias.",
    "Instâncias reservadas oferecem um benefício de faturamento, não um servidor físico dedicado.",
  ], aws("ec2/dedicated-hosts")),
  q(3, "2.4", "Quais recomendações estão incluídas nas verificações do AWS Trusted Advisor?", "AB", [
    "Permissões de bucket do Amazon S3", "Uso de autenticação multifator (MFA) no usuário-raiz da conta da AWS", "Interrupções de serviços da AWS", "Número de usuários na conta", "Patches de software disponíveis para instâncias do Amazon EC2",
  ], [
    "O Trusted Advisor verifica permissões de buckets e alerta para configurações de acesso aberto.",
    "Uma verificação de segurança alerta quando o usuário-raiz está sem MFA.",
    "Eventos de integridade e interrupções são acompanhados no AWS Health Dashboard.",
    "Contar usuários não é a recomendação de segurança solicitada nesta questão.",
    "O gerenciamento de patches de instâncias pode ser realizado com o AWS Systems Manager Patch Manager.",
  ], aws("premiumsupport/technology/trusted-advisor")),
  q(4, "1.1", "Uma empresa está desenvolvendo uma aplicação na AWS e precisa realizar alterações rapidamente na aplicação e nos recursos usados por ela. Qual característica da nuvem atende a esse requisito?", "A", [
    "Agilidade", "Elasticidade", "Confiabilidade", "Desempenho",
  ], [
    "Agilidade permite experimentar, provisionar recursos e realizar mudanças com rapidez.",
    "Elasticidade ajusta a capacidade à demanda; o foco aqui é a rapidez para realizar mudanças.",
    "Confiabilidade trata da operação correta e da recuperação de falhas.",
    "Eficiência de desempenho trata do uso adequado dos recursos para atender aos requisitos de desempenho.",
  ], aws("what-is-cloud-computing")),
  q(5, "1.2", "Uma empresa quer aumentar sua capacidade de recuperar sua infraestrutura após um desastre natural. Qual pilar do AWS Well-Architected Framework representa essa capacidade?", "B", [
    "Otimização de custos", "Confiabilidade", "Eficiência de desempenho", "Segurança",
  ], [
    "Otimização de custos trata de entregar valor com gastos adequados.",
    "Confiabilidade inclui recuperar-se de falhas e atender aos objetivos de recuperação de desastres.",
    "Eficiência de desempenho trata da escolha e do uso eficiente de recursos.",
    "Segurança trata de proteger informações, sistemas e ativos.",
  ], wa),
  q(6, "1.3", "Qual perspectiva do AWS Cloud Adoption Framework (AWS CAF) conecta tecnologia e negócios?", "A", [
    "Pessoas", "Governança", "Operações", "Segurança",
  ], [
    "A perspectiva de pessoas conecta tecnologia e negócios por meio de cultura, liderança, organização e aprendizado contínuo.",
    "Governança coordena iniciativas, investimentos e riscos da transformação.",
    "Operações garante a entrega dos serviços de nuvem conforme as necessidades do negócio.",
    "Segurança trata de confidencialidade, integridade e disponibilidade de dados e cargas de trabalho.",
  ], caf),
  q(7, "4.3", "Entre os planos apresentados, qual é o plano de menor custo do AWS Support que oferece suporte técnico por telefone?", "C", [
    "AWS Unified Operations", "AWS Basic Support", "AWS Business Support+", "AWS Enterprise Support",
  ], [
    "Unified Operations inclui suporte técnico e serviços proativos adicionais, com custo superior ao Business Support+.",
    "Basic oferece ajuda de conta e faturamento, documentação e recursos de autoatendimento; não permite abrir casos de suporte técnico.",
    "Business Support+ inclui acesso a engenheiros por telefone, web e chat 24 horas por dia e é o plano de menor custo entre estas alternativas com esse atendimento.",
    "Enterprise inclui atendimento técnico e um Technical Account Manager, mas custa mais que Business Support+.",
  ], aws("premiumsupport/plans"), "Gabarito corrigido: o material original marcava D, mas sua própria explicação indicava C. A comparação oficial confirma Business Support+."),
  q(8, "1.1", "Qual benefício da nuvem AWS permite provisionar apenas os recursos necessários e aumentar ou reduzir a capacidade conforme a demanda muda?", "C", [
    "Economia de custo", "Segurança", "Elasticidade", "Alta disponibilidade",
  ], [
    "Economizar pode ser uma consequência do ajuste de capacidade, mas não é o nome dessa característica.",
    "Segurança protege dados, identidades, aplicações e infraestrutura.",
    "Elasticidade é a capacidade de adquirir e liberar recursos conforme a demanda, com ajustes horizontais ou verticais conforme o serviço.",
    "Alta disponibilidade reduz interrupções por meio de redundância e outros mecanismos; não significa ajustar capacidade à demanda.",
  ], aws("what-is-cloud-computing")),
  q(9, "1.2", "Quais dos itens a seguir são pilares do AWS Well-Architected Framework?", "BC", [
    "Várias zonas de disponibilidade", "Eficiência de desempenho", "Sustentabilidade", "Uso de criptografia", "Alta disponibilidade",
  ], [
    "Usar várias zonas é uma prática de arquitetura relacionada à confiabilidade, não um pilar.",
    "Eficiência de desempenho é um dos seis pilares.",
    "Sustentabilidade é um dos seis pilares e trata da redução do impacto ambiental das cargas de trabalho.",
    "Criptografia é um mecanismo relacionado à segurança, não um pilar independente.",
    "Alta disponibilidade é uma característica de arquitetura relacionada à confiabilidade, não um pilar independente.",
  ], wa),
  q(10, "4.1", "Uma empresa está migrando uma aplicação para o Amazon EC2. O uso é constante e previsível, e a aplicação deve permanecer disponível. Entre estas alternativas, qual opção é a mais econômica?", "A", [
    "Savings Plans", "Instância spot", "Instância dedicada", "Instância sob demanda",
  ], [
    "Savings Plans oferecem descontos em troca de um compromisso de gasto por hora durante um ou três anos. São adequados para uso previsível. O desconto não é uma reserva de capacidade nem uma garantia de disponibilidade.",
    "Spot pode ser interrompida e, sozinha, não atende ao requisito de operação contínua.",
    "O requisito não exige hardware dedicado, que não é a opção de menor custo neste cenário.",
    "Sob demanda atende ao uso sem compromisso, mas não oferece o desconto por compromisso dos Savings Plans.",
  ], aws("savingsplans")),
  q(11, "4.1", "Uma empresa quer implantar uma aplicação stateless que aceita interrupções ocasionais. Qual opção de preço do Amazon EC2 é a mais acessível para esse caso?", "D", [
    "Reservas de capacidade sob demanda", "Instâncias reservadas", "Instâncias sob demanda", "Instâncias spot",
  ], [
    "Reservas de capacidade asseguram capacidade em uma zona específica, mas não oferecem o desconto Spot.",
    "Instâncias reservadas oferecem descontos por compromisso, mas o cenário permite aproveitar a capacidade Spot.",
    "Sob demanda evita compromisso de longo prazo, mas tem preço superior ao Spot para a mesma capacidade.",
    "Spot oferece capacidade não utilizada do EC2 com desconto e é adequada para cargas tolerantes a interrupções.",
  ], aws("ec2/spot")),
  q(12, "4.2", "Qual serviço ou recurso permite analisar custos e uso da AWS ao longo do tempo?", "A", [
    "AWS Cost Explorer", "Cobrança consolidada", "AWS Organizations", "AWS Budgets",
  ], [
    "Cost Explorer permite visualizar tendências e analisar custos e uso por período, serviço e outras dimensões.",
    "Cobrança consolidada reúne as cobranças de contas de uma organização; não é a ferramenta de análise temporal solicitada.",
    "Organizations gerencia múltiplas contas e oferece cobrança consolidada.",
    "Budgets permite definir orçamentos e alertas de custos ou uso; Cost Explorer é a ferramenta voltada à análise solicitada.",
  ], aws("aws-cost-management/aws-cost-explorer")),
  q(13, "4.1", "Um profissional precisa executar uma instância do Amazon EC2 por apenas sete horas, sem aceitar interrupções de capacidade Spot. Qual é a opção mais econômica?", "D", [
    "Instância reservada", "Host dedicado", "Instância spot", "Instância sob demanda",
  ], [
    "Um compromisso de um ou três anos não é adequado para uma necessidade isolada de sete horas.",
    "Um host dedicado tem custo e finalidade de isolamento ou licenciamento que o cenário não exige.",
    "Spot pode ser interrompida e não atende à exigência apresentada.",
    "Sob demanda é adequada para uso curto sem compromisso de longo prazo e sem a interrupção de capacidade característica do Spot.",
  ], aws("ec2/pricing/on-demand")),
  q(14, "2.4", "Qual serviço ou recurso pode bloquear explicitamente o tráfego para uma porta específica em sub-redes que contêm instâncias do Amazon EC2?", "C", [
    "AWS Direct Connect", "Conexões de peering do Amazon VPC", "ACL de rede", "Amazon Route 53",
  ], [
    "Direct Connect fornece conectividade dedicada, não regras de bloqueio por porta.",
    "Peering fornece conectividade entre VPCs, não filtragem de portas.",
    "ACLs de rede controlam tráfego no nível da sub-rede com regras de permissão e negação explícita. São stateless.",
    "Route 53 fornece DNS e roteamento por DNS, não filtragem de portas.",
  ], "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html"),
  q(15, "3.5", "Uma empresa quer melhorar a disponibilidade e o desempenho global de suas aplicações hospedadas na AWS. Qual serviço deve usar?", "B", [
    "Amazon Connect", "AWS Global Accelerator", "AWS Storage Gateway", "Amazon Lightsail",
  ], [
    "Amazon Connect fornece uma central de atendimento em nuvem.",
    "Global Accelerator usa a rede global da AWS e direciona conexões para endpoints saudáveis e adequados, melhorando disponibilidade e desempenho.",
    "Storage Gateway integra armazenamento local com armazenamento na nuvem.",
    "Lightsail simplifica a hospedagem de aplicações, mas não é o acelerador global solicitado.",
  ], aws("global-accelerator")),
  q(16, "2.1", "Uma empresa vai migrar uma aplicação para a AWS. Qual controle será de responsabilidade da AWS após a migração?", "A", [
    "Manter controles físicos e ambientais.", "Corrigir aplicações de propriedade do cliente.", "Corrigir o sistema operacional convidado do EC2.", "Identificar e proteger informações de identificação pessoal (PII).",
  ], [
    "A AWS mantém os controles físicos e ambientais da infraestrutura que opera os serviços.",
    "O cliente mantém e corrige suas próprias aplicações.",
    "Em instâncias EC2, o cliente é responsável pelo sistema operacional convidado.",
    "O cliente classifica e protege os dados que coloca na nuvem, usando as ferramentas adequadas.",
  ], shared),
  q(17, "3.4", "Uma empresa precisa de um banco de dados relacional para registrar os pedidos de novos clientes em um site. Qual serviço atende ao requisito?", "A", [
    "Amazon Aurora", "Amazon DynamoDB", "Amazon Redshift", "Amazon Neptune",
  ], [
    "Aurora é um banco relacional compatível com MySQL e PostgreSQL, adequado a aplicações transacionais.",
    "DynamoDB é um banco NoSQL de chave-valor e documentos.",
    "Redshift é um data warehouse voltado à análise de grandes conjuntos de dados, não a esse registro transacional.",
    "Neptune é um banco de grafos para dados altamente conectados.",
  ], aws("rds/aurora")),
  q(18, "2.4", "Quais mecanismos de segurança podem controlar o tráfego de rede para recursos em uma VPC?", "BD", [
    "Interface de rede elástica", "Grupo de segurança", "Tabela de rotas", "ACL de rede", "VPC Flow Logs",
  ], [
    "Uma interface de rede elástica representa uma placa de rede virtual, não uma política de filtragem.",
    "Grupos de segurança controlam tráfego nos recursos associados. São stateful e possuem regras de permissão.",
    "Tabelas de rotas determinam destinos do tráfego; não substituem firewalls.",
    "ACLs controlam tráfego de entrada e saída de sub-redes com regras de permissão e negação.",
    "Flow Logs registra informações sobre o tráfego, mas não o bloqueia.",
  ], "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Security.html"),
  q(19, "3.6", "Qual serviço de armazenamento híbrido permite que aplicações on-premises usem armazenamento na nuvem AWS?", "B", [
    "AWS Direct Connect", "AWS Storage Gateway", "AWS Backup", "Amazon Connect",
  ], [
    "Direct Connect fornece conectividade de rede dedicada, não uma interface de armazenamento híbrido.",
    "Storage Gateway conecta aplicações locais a armazenamento na nuvem por interfaces de arquivos, volumes ou fitas, com recursos de cache conforme o tipo de gateway.",
    "AWS Backup centraliza políticas e operações de backup; não é a interface de armazenamento solicitada.",
    "Amazon Connect é um serviço de central de atendimento.",
  ], aws("storagegateway")),
  q(20, "3.1", "Qual serviço permite provisionar infraestrutura como código usando modelos JSON ou YAML?", "D", [
    "AWS CodeBuild", "AWS Organizations", "AWS Config", "AWS CloudFormation",
  ], [
    "CodeBuild compila código, executa testes e gera artefatos. Um processo de build pode chamar outras ferramentas, mas não é o serviço de modelos de infraestrutura.",
    "Organizations gerencia múltiplas contas AWS.",
    "Config registra e avalia configurações de recursos.",
    "CloudFormation provisiona e atualiza recursos descritos em modelos de infraestrutura como código.",
  ], aws("cloudformation")),
  q(21, "4.3", "Uma empresa quer encontrar um parceiro que a ajude a criar e implantar um ambiente na nuvem. Qual recurso deve usar?", "A", [
    "Rede de Parceiros da AWS", "AWS Trusted Advisor", "AWS Support", "AWS Cloud Development Kit (AWS CDK)",
  ], [
    "A Rede de Parceiros da AWS reúne empresas que ajudam no planejamento, na migração e na implantação de soluções.",
    "Trusted Advisor faz verificações e recomendações sobre ambientes AWS; não é o catálogo de parceiros.",
    "AWS Support oferece atendimento e orientação conforme o plano, mas não é o recurso de busca de parceiros.",
    "CDK permite definir infraestrutura em linguagens de programação, não encontrar empresas de implantação.",
  ], aws("partners")),
  q(22, "3.1", "Uma empresa quer implantar rapidamente uma infraestrutura duplicada em outra Região AWS para criar redundância global. Qual serviço atende ao requisito?", "C", [
    "AWS Config", "Amazon API Gateway", "AWS CloudFormation", "Amazon Route 53",
  ], [
    "Config registra e avalia configurações, mas não é o mecanismo de implantação solicitado.",
    "API Gateway cria e gerencia APIs.",
    "CloudFormation permite reutilizar modelos para implantar recursos de forma repetível em diferentes Regiões.",
    "Route 53 pode direcionar usuários para outra Região, mas não implanta a infraestrutura dessa Região.",
  ], aws("cloudformation")),
  q(23, "1.4", "Uma empresa quer comparar os custos de sua infraestrutura on-premises com os custos de executá-la na AWS. Qual opção fornece essa análise?", "A", [
    "Usar o Migration Evaluator.", "Revisar o modelo de responsabilidade compartilhada.", "Auditar apenas os custos de licenciamento de software e hardware.", "Analisar o AWS Well-Architected Framework.",
  ], [
    "Migration Evaluator ajuda a construir um caso de negócio comparando o ambiente atual com alternativas na AWS.",
    "O modelo de responsabilidade compartilhada descreve responsabilidades de segurança.",
    "Licenciamento faz parte dos custos, mas essa auditoria isolada não oferece a comparação completa.",
    "Well-Architected orienta decisões de arquitetura; não é a ferramenta de avaliação de custos da migração.",
  ], aws("migration-evaluator")),
  q(24, "1.2", "Uma aplicação comercial global em EC2 exige a maior redundância e tolerância a falhas entre as alternativas abaixo. Como as instâncias devem ser distribuídas?", "B", [
    "Em várias zonas de disponibilidade de uma única Região.", "Em várias zonas de disponibilidade de duas Regiões.", "Com várias interfaces de rede em sub-redes não especificadas.", "Em uma única zona de disponibilidade de uma Região.",
  ], [
    "Múltiplas zonas protegem contra falhas de uma zona, mas não oferecem o isolamento entre Regiões da alternativa B.",
    "Distribuir recursos entre zonas e Regiões oferece o maior isolamento de falhas entre as opções. A aplicação também precisa de uma estratégia adequada de dados e failover.",
    "Várias interfaces não garantem distribuição entre zonas; interfaces anexadas à instância ficam na mesma zona dela.",
    "Uma única zona deixa a aplicação exposta à indisponibilidade dessa zona.",
  ], wa),
  q(25, "3.4", "Qual serviço deve ser usado para executar um banco de dados relacional autogerenciado?", "D", [
    "Amazon Route 53", "Amazon ElastiCache", "Amazon DynamoDB", "Amazon EC2",
  ], [
    "Route 53 fornece DNS, registro de domínios e verificações de integridade.",
    "ElastiCache fornece armazenamento de dados em memória, frequentemente usado como cache.",
    "DynamoDB é um banco NoSQL gerenciado.",
    "Em EC2, o cliente pode instalar e administrar seu próprio banco relacional, assumindo a gestão do sistema e do banco.",
  ], aws("ec2")),
  q(26, "3.7", "Qual serviço ajuda a coletar, processar e analisar dados de streaming em tempo real, como logs, transações e eventos de aplicações?", "A", [
    "Amazon Kinesis", "Amazon Athena", "Amazon Redshift", "AWS Direct Connect",
  ], [
    "Kinesis oferece serviços para dados de streaming; Kinesis Data Streams permite ingerir eventos para processamento em tempo real.",
    "Athena consulta dados usando SQL, principalmente em S3; não é o serviço de ingestão de streaming solicitado.",
    "Redshift é voltado a análises e possui integrações de ingestão de streaming. Kinesis é a alternativa voltada à coleta de fluxos desta questão.",
    "Direct Connect fornece conectividade, não processamento de dados de streaming.",
  ], aws("kinesis")),
  q(27, "2.2", "Qual serviço permite usar módulos de segurança de hardware (HSMs) dedicados na AWS para atender a requisitos de segurança de dados?", "A", [
    "AWS CloudHSM", "AWS Key Management Service (AWS KMS)", "AWS Directory Service", "AWS Secrets Manager",
  ], [
    "CloudHSM fornece HSMs dedicados para operações criptográficas e controle das chaves pelo cliente.",
    "KMS gerencia chaves e usa HSMs para protegê-las, mas não oferece ao cliente os dispositivos dedicados solicitados.",
    "Directory Service oferece soluções de diretório, como Microsoft Active Directory gerenciado.",
    "Secrets Manager armazena e gerencia segredos, incluindo rotação conforme a integração.",
  ], aws("cloudhsm")),
  q(28, "2.3", "Qual alternativa descreve uma prática recomendada que pode ser implementada usando o AWS IAM?", "D", [
    "Gerar chaves de acesso para todos os usuários do IAM.", "Armazenar credenciais de longo prazo nas instâncias do EC2.", "Desativar o acesso ao console para todos os usuários.", "Conceder somente as permissões necessárias para executar uma tarefa específica.",
  ], [
    "Não se deve criar credenciais de longo prazo sem necessidade. Prefira acesso federado e credenciais temporárias quando possível.",
    "Em EC2, use funções do IAM e credenciais temporárias em vez de gravar chaves de longo prazo.",
    "O acesso deve atender às necessidades de cada identidade; bloquear o console indiscriminadamente não expressa privilégio mínimo.",
    "Privilégio mínimo concede apenas ações e recursos necessários para as tarefas pretendidas.",
  ], "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html"),
  q(29, "3.3", "Qual mecanismo de computação sem servidor executa contêineres com Amazon ECS ou Amazon EKS sem que o cliente provisione ou gerencie instâncias do EC2?", "D", [
    "AWS Elastic Beanstalk", "Amazon Lightsail", "AWS Batch", "AWS Fargate",
  ], [
    "Elastic Beanstalk gerencia a implantação de aplicações e pode usar contêineres, mas não é o mecanismo de computação sem servidor solicitado.",
    "Lightsail oferece hospedagem simplificada e serviços de contêineres, mas não é o mecanismo de execução do ECS e do EKS solicitado.",
    "Batch agenda e gerencia trabalhos em lote. Ele pode usar Fargate ou EC2; o mecanismo de computação sem servidor é Fargate.",
    "Fargate fornece computação sem servidor para contêineres e remove a necessidade de administrar instâncias EC2.",
  ], aws("fargate"), "Enunciado e comentário ajustados: AWS Batch também pode executar trabalhos no Fargate. Não é correto afirmar que Batch exige sempre EC2."),
  q(30, "3.5", "Uma empresa precisa estabelecer uma AWS Site-to-Site VPN. Qual gateway, entre estas alternativas, pode terminar essa conexão na AWS?", "B", [
    "Gateway de internet", "Gateway privado virtual", "Gateway do AWS Direct Connect", "Gateway NAT",
  ], [
    "Gateway de internet fornece acesso à internet para recursos da VPC, não termina a VPN solicitada.",
    "Um gateway privado virtual pode ser o endpoint AWS de uma Site-to-Site VPN. Transit Gateway também é uma alternativa suportada, mas não está entre as opções.",
    "Direct Connect usa conectividade dedicada e não é o terminador de VPN desta questão.",
    "NAT permite conexões de saída de recursos privados, não termina túneis Site-to-Site VPN.",
  ], aws("vpn/site-to-site-vpn")),
  q(31, "2.2", "Qual serviço fornece downloads sob demanda de documentos de segurança e conformidade da AWS?", "C", [
    "AWS Trusted Advisor", "Amazon Inspector", "AWS Artifact", "AWS Directory Service",
  ], [
    "Trusted Advisor verifica o ambiente e recomenda melhorias.",
    "Inspector identifica vulnerabilidades de software e exposição de rede nas cargas compatíveis.",
    "Artifact disponibiliza relatórios e documentos sobre os controles de segurança e conformidade da AWS.",
    "Directory Service fornece recursos de diretório, não relatórios de conformidade.",
  ], aws("artifact")),
  q(32, "2.4", "Qual serviço pode inspecionar solicitações HTTP e bloquear padrões de ataque de injeção SQL?", "C", [
    "Grupos de segurança", "ACLs de rede", "AWS WAF", "Políticas do IAM",
  ], [
    "Grupos de segurança filtram tráfego de rede, mas não analisam o conteúdo HTTP para detectar injeção SQL.",
    "ACLs filtram tráfego da sub-rede por critérios de rede, não pelo conteúdo SQL de uma solicitação.",
    "WAF permite aplicar regras que inspecionam solicitações web e bloqueiam padrões de injeção SQL. A aplicação também precisa de práticas seguras de acesso ao banco.",
    "IAM controla permissões de identidades e ações nos serviços AWS, não filtra solicitações web por conteúdo.",
  ], aws("waf")),
  q(33, "2.2", "Qual serviço permite avaliar, auditar e acompanhar mudanças nas configurações dos recursos AWS?", "C", [
    "AWS Trusted Advisor", "Amazon Inspector", "AWS Config", "Amazon GuardDuty",
  ], [
    "Trusted Advisor recomenda melhorias com base em verificações de práticas recomendadas.",
    "Inspector identifica vulnerabilidades e exposição de rede nas cargas compatíveis.",
    "Config registra configurações e seu histórico de mudanças e pode avaliar conformidade com regras.",
    "GuardDuty detecta ameaças e atividades suspeitas; não substitui o histórico de configurações do Config.",
  ], aws("config")),
  q(34, "3.1", "Qual serviço pode ser usado para implantar e gerenciar aplicações web na AWS?", "A", [
    "AWS Elastic Beanstalk", "AWS Control Tower", "AWS Config", "Amazon Kinesis Data Streams",
  ], [
    "Elastic Beanstalk simplifica a implantação e o gerenciamento de aplicações e de seus recursos de infraestrutura.",
    "Control Tower estabelece e governa um ambiente com múltiplas contas.",
    "Config acompanha e avalia configurações de recursos.",
    "Kinesis Data Streams ingere dados de streaming para processamento.",
  ], aws("elasticbeanstalk")),
  q(35, "2.1", "Quais são controles compartilhados no modelo de responsabilidade compartilhada da AWS?", "AC", [
    "Gerenciamento de patches", "Segurança de zona", "Gerenciamento de configuração", "Controles ambientais", "Controles de segurança física",
  ], [
    "A AWS corrige a infraestrutura que opera. O cliente corrige as camadas sob sua gestão, como aplicações e sistemas operacionais convidados do EC2.",
    "A organização e a separação de dados por zonas de segurança são controles específicos do cliente.",
    "A AWS configura seus dispositivos de infraestrutura; o cliente configura os sistemas, dados e aplicações sob sua gestão.",
    "Os controles ambientais dos data centers são herdados da AWS.",
    "A segurança física dos data centers é um controle herdado da AWS.",
  ], shared),
  q(36, "1.4", "Qual benefício do modelo de pagamento conforme o uso permite trocar investimentos antecipados em infraestrutura por despesas de consumo?", "B", [
    "Reduzir custos variáveis", "Reduzir custos fixos", "Exigir pagamento antecipado pelos serviços AWS", "Aplicar-se somente a EC2, S3 e RDS",
  ], [
    "O conceito pedido é substituir custos fixos por variáveis; o consumo e o preço determinam a despesa variável.",
    "Pagar pelo consumo reduz a necessidade de investir previamente em capacidade física própria.",
    "Pagamento antecipado não é uma exigência do modelo conforme o uso.",
    "O modelo está disponível em muitos serviços AWS, não apenas nesses três.",
  ], aws("pricing")),
  q(37, "3.5", "Quais serviços podem fornecer conectividade entre uma rede on-premises e uma VPC?", "BD", [
    "Amazon Connect", "AWS Direct Connect", "AWS Data Exchange", "AWS VPN", "Amazon Route 53",
  ], [
    "Amazon Connect é uma central de atendimento, apesar do nome sugerir conexão.",
    "Direct Connect estabelece conectividade dedicada entre o ambiente local e a AWS.",
    "Data Exchange permite encontrar e usar dados de terceiros.",
    "Site-to-Site VPN pode conectar a rede local à AWS por túneis criptografados.",
    "Route 53 fornece DNS, não uma ligação de rede entre esses ambientes.",
  ], aws("vpn")),
  q(38, "2.1", "Quais tarefas são de responsabilidade da AWS no modelo de responsabilidade compartilhada?", "AD", [
    "Aplicar patches à infraestrutura do Elastic Load Balancing.", "Configurar um bucket S3 para permitir acesso público.", "Determinar quais serviços podem acessar uma tabela DynamoDB.", "Controlar o acesso físico aos data centers da AWS.", "Configurar usuários IAM com privilégio mínimo.",
  ], [
    "A AWS mantém e corrige a infraestrutura do serviço gerenciado de balanceamento.",
    "O cliente define as políticas e configurações de acesso de seu bucket.",
    "O cliente define permissões de acesso aos seus dados e recursos.",
    "A AWS controla o acesso físico às instalações que operam sua infraestrutura.",
    "O cliente configura suas identidades e permissões, incluindo privilégio mínimo.",
  ], shared),
  q(39, "3.5", "Uma empresa sem data center precisa conectar os laptops dos funcionários diretamente e com segurança aos recursos AWS. Qual serviço atende ao requisito?", "A", [
    "AWS Client VPN", "AWS Direct Connect", "AWS Site-to-Site VPN", "Amazon Connect",
  ], [
    "Client VPN permite que dispositivos de usuários se conectem de forma segura usando um cliente VPN.",
    "Direct Connect estabelece conectividade dedicada de uma rede local, não uma sessão VPN por laptop.",
    "Site-to-Site VPN conecta redes por meio de um dispositivo de gateway, não usuários individuais como no cenário.",
    "Amazon Connect é um serviço de central de atendimento.",
  ], aws("vpn/client-vpn")),
  q(40, "3.4", "Uma empresa desenvolve um aplicativo móvel que precisa de um banco NoSQL de alto desempenho. Quais serviços são opções de bancos NoSQL?", "BD", [
    "Amazon Aurora", "Amazon DynamoDB", "Amazon RDS", "Amazon DocumentDB (compatível com MongoDB)", "Amazon Redshift",
  ], [
    "Aurora é relacional, com compatibilidade MySQL e PostgreSQL.",
    "DynamoDB é um banco NoSQL gerenciado de chave-valor e documentos, com dimensionamento integrado.",
    "RDS gerencia bancos relacionais.",
    "DocumentDB é um banco de documentos gerenciado com compatibilidade com APIs do MongoDB.",
    "Redshift é um data warehouse analítico, não o banco NoSQL solicitado.",
  ], aws("nosql")),
  q(41, "1.2", "Após uma fusão, uma empresa quer revisar a arquitetura herdada quanto às práticas recomendadas de custos, segurança e desempenho. Qual ferramenta deve usar?", "B", [
    "AWS Cost Explorer", "AWS Well-Architected Tool", "AWS Compute Optimizer", "AWS Config",
  ], [
    "Cost Explorer analisa custos e uso, mas não realiza a revisão arquitetural ampla solicitada.",
    "Well-Architected Tool orienta a revisão de cargas de trabalho em relação aos pilares e às práticas recomendadas da AWS.",
    "Compute Optimizer recomenda configurações de recursos a partir de métricas, sem cobrir toda a revisão de segurança da arquitetura.",
    "Config registra configurações e avalia regras, mas não substitui uma revisão arquitetural pelos pilares.",
  ], aws("well-architected-tool")),
  q(42, "3.7", "Qual serviço adiciona conversão de fala em texto às aplicações?", "C", [
    "Amazon Textract", "Amazon Comprehend", "Amazon Transcribe", "Amazon Polly",
  ], [
    "Textract extrai texto e dados de documentos, formulários e tabelas.",
    "Comprehend analisa linguagem natural em textos, incluindo entidades e sentimentos.",
    "Transcribe reconhece fala e converte áudio em texto.",
    "Polly faz o caminho inverso: converte texto em fala.",
  ], aws("transcribe")),
  q(43, "3.8", "Qual serviço permite desacoplar componentes e dimensionar aplicações por meio de filas de mensagens?", "D", [
    "AWS Outposts", "Amazon Simple Email Service (Amazon SES)", "Amazon S3", "Amazon Simple Queue Service (Amazon SQS)",
  ], [
    "Outposts leva infraestrutura e serviços AWS às instalações do cliente.",
    "SES envia e recebe e-mails.",
    "S3 armazena objetos; não é o serviço de filas solicitado.",
    "SQS fornece filas gerenciadas para desacoplar produtores e consumidores e permitir processamento independente.",
  ], aws("sqs")),
  q(44, "2.3", "Uma aplicação em EC2 precisa gravar em um bucket S3 sem credenciais de longo prazo. Qual recurso deve usar?", "B", [
    "Amazon Cognito", "Função do IAM associada à instância por um perfil de instância", "Chave de acesso de um usuário IAM", "AWS Shield",
  ], [
    "Cognito atende à identidade de usuários de aplicações; não é o mecanismo adequado para a identidade dessa instância.",
    "Uma função do IAM entregue pelo perfil de instância fornece credenciais temporárias ao EC2. A política deve permitir somente as ações e o bucket necessários.",
    "Chaves de acesso de usuários IAM são credenciais de longo prazo.",
    "Shield protege contra DDoS; não concede permissões de gravação no S3.",
  ], "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html"),
  q(45, "3.3", "Uma aplicação web em EC2 precisa ajustar automaticamente a quantidade de instâncias conforme a demanda dos clientes. Qual recurso deve usar?", "D", [
    "AWS Compute Optimizer", "Amazon EC2 Capacity Reservations", "Amazon Lightsail", "Amazon EC2 Auto Scaling",
  ], [
    "Compute Optimizer recomenda configurações; não é o mecanismo de ajuste automático da frota.",
    "Capacity Reservations reserva capacidade em uma zona; não altera a quantidade de instâncias conforme a demanda.",
    "Lightsail fornece hospedagem simplificada; não é o mecanismo de scaling da frota EC2 solicitada.",
    "EC2 Auto Scaling adiciona ou remove instâncias de um grupo conforme políticas, programação e limites configurados.",
  ], aws("ec2/autoscaling")),
  q(46, "3.3", "Qual serviço distribui tráfego entre destinos saudáveis e ajusta automaticamente sua própria capacidade de balanceamento conforme o tráfego aumenta?", "D", [
    "AWS CodePipeline", "AWS Direct Connect", "Amazon Elastic Block Store (Amazon EBS)", "Elastic Load Balancing (ELB)",
  ], [
    "CodePipeline automatiza etapas de entrega de software, não balanceia tráfego.",
    "Direct Connect fornece uma conexão dedicada, não balanceamento de aplicações.",
    "EBS fornece armazenamento em blocos, não balanceamento de tráfego.",
    "ELB distribui tráfego e dimensiona a capacidade do balanceador. Para adicionar ou remover instâncias EC2, use EC2 Auto Scaling.",
  ], "https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html", "Enunciado e explicação distinguem a capacidade do balanceador (ELB) da quantidade de instâncias (EC2 Auto Scaling)."),
  q(47, "3.6", "Uma empresa precisa de armazenamento em blocos para o sistema operacional e os arquivos de uma aplicação em EC2. Qual serviço atende ao requisito?", "C", [
    "Amazon Elastic File System (Amazon EFS)", "Amazon S3", "Amazon Elastic Block Store (Amazon EBS)", "AWS Backup",
  ], [
    "EFS fornece um sistema de arquivos compartilhado; não é o volume de inicialização do sistema operacional do EC2.",
    "S3 armazena objetos, não fornece um volume de inicialização para EC2.",
    "EBS fornece volumes em blocos que podem armazenar o sistema operacional e os dados da aplicação.",
    "Backup gerencia cópias de segurança, não o volume de execução da instância.",
  ], aws("ebs")),
  q(48, "3.5", "Uma empresa hospeda um site em EC2 e quer reduzir a latência de acesso ao conteúdo para usuários globais. Qual serviço deve usar?", "D", [
    "AWS Elastic Beanstalk", "AWS Outposts", "AWS CloudFormation", "Amazon CloudFront",
  ], [
    "Elastic Beanstalk facilita implantação e gerenciamento; não fornece uma CDN global.",
    "Outposts fornece recursos AWS nas instalações do cliente, atendendo a requisitos locais.",
    "CloudFormation provisiona infraestrutura por modelos; não entrega conteúdo em locais de borda.",
    "CloudFront é uma CDN que entrega conteúdo por uma rede global de locais de borda, aproximando-o dos usuários.",
  ], aws("cloudfront")),
  q(49, "2.3", "Entre as alternativas abaixo, quais mecanismos ajudam a proteger as credenciais e a autenticação de usuários IAM?", "BE", [
    "Implementar Amazon Rekognition.", "Configurar uma política de senhas fortes e as regras de expiração exigidas pela organização.", "Bloquear acesso usando grupos de segurança.", "Usar recursos protegidos do AWS Shield.", "Usar autenticação multifator (MFA).",
  ], [
    "Rekognition analisa imagens e vídeos, não protege credenciais IAM.",
    "Uma política de senhas do IAM pode exigir requisitos de complexidade e, quando aplicável, expiração. Para pessoas, a AWS recomenda acesso federado e credenciais temporárias sempre que possível.",
    "Grupos de segurança filtram tráfego dos recursos associados, não definem a política de autenticação IAM.",
    "Shield oferece proteção contra DDoS, não proteção de senhas IAM.",
    "MFA adiciona um fator de autenticação além da senha, reduzindo o risco de acesso com uma senha comprometida.",
  ], "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html"),
  q(50, "3.5", "Quais serviços podem estabelecer conectividade de uma rede local com a nuvem AWS?", "BE", [
    "AWS Transit Gateway", "AWS VPN", "Amazon Connect", "Amazon S3", "AWS Direct Connect",
  ], [
    "Transit Gateway é um hub que pode receber conexões VPN e Direct Connect. Sozinho, sem esses mecanismos, não fornece o enlace da rede local.",
    "Site-to-Site VPN estabelece túneis criptografados entre a rede local e a AWS.",
    "Amazon Connect fornece uma central de atendimento, não conectividade entre redes.",
    "S3 fornece armazenamento de objetos.",
    "Direct Connect fornece conectividade dedicada entre a infraestrutura local e a AWS.",
  ], aws("directconnect")),
  q(51, "3.2", "Qual serviço reduz a latência de entrega de sites estáticos usando locais de borda em todo o mundo?", "D", [
    "AWS Lambda", "Amazon S3 Transfer Acceleration", "AWS Data Exchange", "Amazon CloudFront",
  ], [
    "Lambda executa código; por si só não é uma rede de entrega de conteúdo.",
    "S3 Transfer Acceleration acelera transferências com buckets S3, não substitui uma CDN para o site.",
    "Data Exchange oferece acesso a dados de terceiros.",
    "CloudFront entrega conteúdo de sites por uma rede global de locais de borda.",
  ], aws("cloudfront")),
  q(52, "2.1", "No modelo de responsabilidade compartilhada, quais atividades são responsabilidade do cliente?", "CD", [
    "Manter controles ambientais do data center AWS.", "Treinar a equipe do data center AWS.", "Criar e configurar ACLs de rede.", "Criptografar dados no lado do cliente.", "Corrigir componentes do sistema operacional do Amazon RDS.",
  ], [
    "A AWS mantém os controles ambientais de seus data centers.",
    "A AWS treina e administra as equipes que operam suas instalações.",
    "O cliente configura seus controles de rede, incluindo ACLs e grupos de segurança.",
    "O cliente administra a criptografia realizada em suas aplicações antes de enviar dados à nuvem.",
    "A AWS mantém o sistema operacional subjacente do serviço gerenciado RDS.",
  ], shared),
  q(53, "3.7", "Qual serviço oferece visualização de dados para analistas produzirem painéis e informações de business intelligence?", "B", [
    "AWS X-Ray", "Amazon QuickSight", "Amazon Rekognition", "Amazon Comprehend",
  ], [
    "X-Ray rastreia requisições em aplicações distribuídas para análise e diagnóstico.",
    "QuickSight fornece recursos de business intelligence, visualização de dados e painéis.",
    "Rekognition analisa imagens e vídeos.",
    "Comprehend extrai informações de linguagem natural em textos.",
  ], aws("quicksight")),
  q(54, "2.3", "Qual recurso pode conceder a usuários específicos permissões de leitura e gravação em um bucket S3?", "A", [
    "Políticas do IAM", "ACL de rede", "AWS Key Management Service (AWS KMS)", "Grupos de segurança",
  ], [
    "Políticas IAM podem conceder ações em buckets e objetos a identidades específicas, respeitando as demais políticas e negações aplicáveis.",
    "ACLs de rede filtram tráfego de sub-redes, não permissões de usuários em buckets.",
    "KMS controla chaves criptográficas e seu uso; não substitui as permissões de acesso ao bucket.",
    "Grupos de segurança filtram tráfego dos recursos associados, não autorizam usuários a ler objetos do S3.",
  ], aws("iam")),
  q(55, "1.3", "Uma empresa quer orientação e práticas recomendadas para os principais stakeholders conduzirem sua adoção e migração para a nuvem. Qual framework deve usar?", "B", [
    "AWS Support", "AWS Cloud Adoption Framework (AWS CAF)", "Amazon Connect", "AWS Well-Architected Framework",
  ], [
    "Support oferece atendimento conforme o plano; não é o framework de transformação organizacional solicitado.",
    "CAF orienta a transformação pelas perspectivas de negócios, pessoas, governança, plataforma, segurança e operações.",
    "Amazon Connect é um serviço de central de atendimento.",
    "Well-Architected orienta o desenho e a operação de cargas de trabalho; CAF atende ao foco organizacional desta questão.",
  ], caf),
  q(56, "2.2", "Qual serviço ajuda a identificar o usuário que encerrou uma instância EC2 ontem?", "B", [
    "Amazon CloudWatch", "AWS CloudTrail", "AWS Trusted Advisor", "Amazon Inspector",
  ], [
    "CloudWatch coleta métricas, logs e alarmes. O histórico de chamadas de API solicitado é fornecido pelo CloudTrail.",
    "CloudTrail registra eventos de atividade da conta, permitindo consultar a identidade e a chamada de API que encerrou a instância.",
    "Trusted Advisor recomenda melhorias, mas não fornece esse histórico de chamadas.",
    "Inspector identifica vulnerabilidades; não é o registro de ações de usuários.",
  ], aws("cloudtrail")),
  q(57, "2.4", "Qual serviço ajuda a proteger aplicações AWS contra ataques distribuídos de negação de serviço (DDoS)?", "A", [
    "AWS Shield", "AWS Auto Scaling", "Amazon GuardDuty", "Amazon Inspector",
  ], [
    "Shield fornece proteção gerenciada contra DDoS para os recursos e as integrações compatíveis.",
    "Auto Scaling ajusta capacidade, mas não substitui proteção específica contra DDoS.",
    "GuardDuty detecta ameaças e atividades suspeitas; não é o serviço específico de proteção DDoS.",
    "Inspector identifica vulnerabilidades de software e exposição de rede.",
  ], aws("shield")),
  q(58, "1.3", "Uma empresa quer orientação para gerenciar riscos da transformação para a nuvem e diminuir seu perfil geral de risco. Qual perspectiva do AWS CAF atende a esse objetivo?", "B", [
    "Negócios", "Governança", "Operações", "Segurança",
  ], [
    "Negócios alinha investimentos em nuvem aos resultados da organização.",
    "Governança coordena iniciativas e investimentos e inclui gerenciamento de riscos da transformação.",
    "Operações concentra-se na entrega, integridade e eficiência operacional dos serviços.",
    "Segurança protege dados e cargas de trabalho. O gerenciamento amplo dos riscos da transformação é o foco de governança.",
  ], caf),
  q(59, "2.1", "Qual tarefa é responsabilidade da AWS no modelo de responsabilidade compartilhada?", "B", [
    "Atualizar ACLs de rede do cliente para bloquear portas vulneráveis.", "Atualizar o firmware dos hosts físicos subjacentes do EC2.", "Atualizar regras dos grupos de segurança do cliente.", "Corrigir o sistema operacional convidado de instâncias EC2.",
  ], [
    "O cliente define e mantém as regras das ACLs de suas sub-redes.",
    "A AWS mantém os hosts físicos e o firmware da infraestrutura que executa EC2.",
    "O cliente define as regras dos grupos de segurança de seus recursos.",
    "O cliente mantém o sistema operacional convidado do EC2, podendo usar ferramentas como Systems Manager.",
  ], shared),
  q(60, "1.4", "Uma empresa quer evitar compromissos de longo prazo e trocar custos fixos por variáveis. Qual proposta de valor da AWS atende diretamente a esse requisito?", "D", [
    "Economia de escala", "Otimização de custos", "Descontos por volume", "Pagamento conforme o uso",
  ], [
    "Economia de escala decorre do uso agregado de muitos clientes; não é o nome do modelo de consumo solicitado.",
    "Otimização de custos é o processo de obter valor com gastos adequados; a pergunta pede a forma de pagamento.",
    "Descontos por volume dependem da quantidade consumida em serviços aplicáveis.",
    "Pagamento conforme o uso permite pagar pelo consumo em vez de investir antecipadamente em capacidade própria.",
  ], aws("pricing")),
  q(61, "4.2", "Qual recurso permite compartilhar os benefícios de desconto de instâncias reservadas entre contas de uma organização, quando o compartilhamento está habilitado?", "A", [
    "Cobrança consolidada do AWS Organizations", "Funções entre contas do IAM", "AWS Compute Optimizer ativado em todas as contas", "AWS Cost Explorer ativado em todas as contas",
  ], [
    "A cobrança consolidada pode aplicar os benefícios de desconto entre contas elegíveis da organização, conforme as preferências de compartilhamento.",
    "Funções entre contas concedem acesso a recursos; não compartilham automaticamente benefícios de faturamento.",
    "Compute Optimizer recomenda configurações, não distribui descontos entre contas.",
    "Cost Explorer analisa custos; o compartilhamento depende das regras de cobrança da organização.",
  ], "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ri-turn-off.html"),
  q(62, "4.2", "Como uma empresa pode separar os custos e obter forte isolamento de recursos entre produção e não produção?", "A", [
    "Usar contas AWS diferentes para produção e não produção.", "Usar CloudWatch para monitorar o consumo dos serviços.", "Criar funções IAM distintas para as cargas de trabalho.", "Usar EC2 apenas em não produção e outros serviços em produção.",
  ], [
    "Contas separadas isolam recursos e identificam as despesas de cada ambiente, mantendo a opção de cobrança consolidada.",
    "CloudWatch monitora recursos, mas não cria o isolamento de contas solicitado.",
    "Funções IAM controlam permissões, não separam o faturamento entre ambientes.",
    "Escolher serviços diferentes não garante separação completa dos custos e pode prejudicar a equivalência dos ambientes.",
  ], aws("organizations")),
  q(63, "2.2", "Qual serviço permite usar chaves gerenciadas pelo cliente para criptografar arquivos de log do CloudTrail armazenados no S3?", "A", [
    "AWS Key Management Service (AWS KMS)", "AWS Certificate Manager", "AWS Secrets Manager", "AWS Systems Manager",
  ], [
    "CloudTrail pode usar SSE-KMS para criptografar seus arquivos de log com uma chave KMS e controlar o uso dessa chave.",
    "Certificate Manager gerencia certificados TLS; não é o mecanismo de criptografia desses arquivos de log.",
    "Secrets Manager gerencia segredos, como credenciais de banco de dados.",
    "Systems Manager automatiza tarefas de gerenciamento de recursos, não fornece a chave criptográfica solicitada.",
  ], "https://docs.aws.amazon.com/awscloudtrail/latest/userguide/encrypting-cloudtrail-log-files-with-aws-kms.html"),
  q(64, "2.1", "Uma empresa executará uma carga de trabalho na AWS. Quais tarefas são responsabilidade do cliente?", "DE", [
    "Controlar acesso físico aos data centers AWS.", "Aplicar patches aos dispositivos físicos de rede da VPC.", "Aplicar patches ao sistema operacional subjacente do Lambda.", "Configurar permissões IAM com privilégio mínimo.", "Restringir o acesso de um bucket S3 a identidades IAM específicas.",
  ], [
    "A AWS controla o acesso físico às suas instalações.",
    "A AWS mantém os dispositivos físicos de sua infraestrutura de rede.",
    "A AWS mantém o sistema operacional subjacente do Lambda. O cliente continua responsável por seu código e dependências.",
    "O cliente determina quem recebe permissões e aplica privilégio mínimo às suas identidades.",
    "O cliente configura as políticas e os controles de acesso de seus buckets e dados.",
  ], shared),
  q(65, "2.2", "Uma empresa passa por uma avaliação de conformidade ISO 27017. Qual serviço permite baixar as certificações e os relatórios de conformidade da AWS?", "D", [
    "AWS Trusted Advisor", "AWS Shield", "AWS Well-Architected Tool", "AWS Artifact",
  ], [
    "Trusted Advisor verifica práticas recomendadas no ambiente, não fornece os documentos de auditoria solicitados.",
    "Shield protege contra DDoS.",
    "Well-Architected Tool orienta revisões de arquitetura, não disponibiliza os relatórios de conformidade da AWS.",
    "Artifact disponibiliza documentos de segurança e conformidade, incluindo certificações ISO e relatórios SOC e PCI aplicáveis.",
  ], aws("artifact")),
];

export const exam = {
  id: "clf-c02-65-v1", title: "Simulado 1", description: "Fundamentos e serviços da nuvem AWS",
  locale: "pt-BR", sourceLocale: "pt-BR", reviewedAt: "2026-11-06", questions,
};

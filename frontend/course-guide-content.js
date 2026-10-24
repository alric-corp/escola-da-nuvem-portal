// Conteúdo institucional estático: manutenção e rastreabilidade em docs/course-guide.md.
// A data abaixo é a revisão editorial do portal, não a emissão/vigência dos documentos.
export const courseGuideContent = {
  title: "Guia do curso",
  description: "As informações e os canais de apoio para acompanhar sua jornada.",
  metadata: {
    reviewedAt: "2026-10-24",
    timeZone: "America/Sao_Paulo",
    timeZoneLabel: "Horário de Brasília",
    sources: [
      { id: "inaugural", label: "Apresentação de regras AWS re/Start 2 + NoCode", issuedAt: null },
      { id: "normative", label: "Normativa de Abono de Faltas EdN", issuedAt: null },
      { id: "communications", label: "Comunicados e horários fornecidos pelo responsável nesta implementação", issuedAt: null },
    ],
  },
  tabs: [
    { id: "rules", label: "Regras do curso" },
    { id: "support", label: "Plantões e comunidade" },
    { id: "requests", label: "Faltas e solicitações" },
  ],
  documents: {
    normative: {
      url: new URL("./documents/normativa-abono-faltas.pdf", import.meta.url).href,
      label: "Ler normativa completa",
      description: "Normativa de Abono de Faltas EdN · PDF original · 5 páginas",
      format: "PDF",
      pages: 5,
    },
  },
  scope: "As orientações de curso desta aba vêm do material de AWS re/Start 2 + NoCode. Confirme com a equipe quais módulos e horários de aula se aplicam à sua turma.",
  graduation: [
    { title: "Laboratórios", text: "Completar e submeter todos os laboratórios, atingindo 100% de pontuação." },
    { title: "KCs / Quizzes", text: "Realizar todos os KCs / Quizzes e atingir pontuação igual ou superior a 70%, conforme o material." },
    { title: "Presença", text: "Ter pelo menos 80% de presença nas aulas." },
    { title: "Slides", text: "Consumir todos os slides." },
  ],
  kcReminder: "Todos os KCs são obrigatórios. Uma média elevada não substitui atividades obrigatórias não realizadas.",
  graduationContext: "A situação “Graduado” no portal acompanha a graduação registrada no Canvas.",
  voucher: [
    "Ser aprovado no módulo AWS re/Start.",
    "Conquistar pelo menos 80% no simulado.",
    "Comprometer-se a realizar o exame Cloud Practitioner no prazo estipulado pela Escola da Nuvem.",
    "Realizar o exame de forma remota caso não encontre vaga presencial no período estipulado.",
  ],
  voucherNote: "Consulte a equipe sobre o prazo aplicável à sua turma. O cumprimento dos requisitos não é uma promessa de emissão automática do voucher pelo portal.",
  orientations: [
    {
      title: "Participação e ambiente das aulas",
      paragraphs: ["É necessário acesso a computador para as atividades, microfone para interagir nas aulas e webcam para interação com mentores. A apresentação indica Google Meet e Google Classroom como ambientes das aulas técnicas e comportamentais."],
    },
    {
      title: "Organização do curso e horários de aula",
      paragraphs: ["O material apresenta o módulo AWS re/Start - IA, com computação em nuvem, materiais e atividades no Canvas e ferramentas de Inteligência Artificial AWS, e o módulo No Code, com ferramentas de integração No Code. Ao final, inicia-se a janela para realização do exame de certificação.", "A apresentação informa aulas de segunda a sexta-feira: das 9h às 12h no turno matutino e das 19h às 22h no noturno. Isso não define o turno da sua turma: confirme o seu horário com a equipe.", "As aulas de Competências Profissionais ocorrem em dias específicos. Consulte a Cartilha do Aluno para conhecer os dias aplicáveis."],
    },
    {
      title: "Gravações das aulas técnicas",
      paragraphs: ["As gravações ficam disponíveis para acesso online por sete dias e são excluídas após esse período. A orientação do material é não baixar nem compartilhar as gravações."],
    },
    {
      title: "Projeto final integrado",
      paragraphs: ["O projeto integra os conhecimentos das aulas de Competências Profissionais e Técnicas. O trabalho é em equipe, com colaboração, comunicação e organização das tarefas.", "Segundo a apresentação, a apresentação final do projeto será gravada e disponibilizada aos parceiros da Escola da Nuvem."],
    },
    {
      title: "Jornada após a aprovação",
      paragraphs: ["O material apresenta empregabilidade, com desenvolvimento e exposição de profissionais ao mercado; badge AWS re/Start; certificado Escola da Nuvem; e badge Cloud Practitioner caso haja aprovação no exame de certificação.", "Alunos que participam da Empregabilidade podem participar das trilhas de extensão, conforme a apresentação. Consulte a equipe sobre as oportunidades aplicáveis à sua jornada."],
    },
  ],
  support: [
    {
      id: "technical",
      title: "Plantão técnico",
      description: "Tire suas dúvidas sobre os conteúdos e atividades técnicas do curso.",
      schedule: ["Quartas-feiras, das 8h às 9h.", "Quartas-feiras, das 18h às 19h."],
      action: "Acessar plantão técnico",
      url: "https://meet.google.com/wgf-qmna-ajg",
      source: "communications",
    },
    {
      id: "careers",
      title: "Plantão de empregabilidade",
      description: "Um espaço aberto para tirar dúvidas sobre currículo, LinkedIn, processos seletivos e carreira.",
      complement: "Não é uma aula expositiva e não possui uma sequência fixa de conteúdo. O encontro é orientado pelas dúvidas dos participantes.",
      schedule: ["Quintas-feiras, às 14h."],
      action: "Acessar plantão de empregabilidade",
      url: "https://meet.google.com/agy-gbwe-jtr",
      source: "communications",
    },
    {
      id: "discord",
      title: "Comunidade no Discord",
      description: "Acesse a comunidade pelo convite disponibilizado pela Escola da Nuvem.",
      schedule: [],
      action: "Entrar no Discord",
      url: "https://discord.com/invite/yMPZrPUc4V",
      source: "communications",
    },
  ],
  requestSteps: [
    {
      title: "Consultar faltas",
      description: "Consulte a quantidade de faltas registrada no seu curso.",
      note: "A frequência é atualizada regularmente às terças e quintas-feiras.",
      action: "Consultar minhas faltas",
      url: "https://2sh9po.s.gy/faltas-EDN",
    },
    {
      title: "Fazer uma solicitação",
      description: "Utilize o formulário para solicitar abono de faltas e/ou transferência de turno. Antes de preencher, leia as orientações disponíveis nesta aba.",
      note: "O formulário é externo. Não envie atestados, documentos ou dados pessoais pelo portal.",
      action: "Abrir formulário de solicitação",
      url: "https://docs.google.com/forms/d/e/1FAIpQLSdFFlPkfcSqNNm5pcIzPToBgQ09PJfTyIH5wEuBq5yT-NsBug/viewform",
    },
    {
      title: "Acompanhar a resposta",
      description: "Consulte se sua solicitação foi deferida, indeferida ou considerada inválida e confira o motivo da decisão, quando disponível.",
      note: "Enviar o formulário não significa que a solicitação foi aprovada. Acompanhe o resultado na plataforma indicada.",
      availabilityNote: "O endereço de acompanhamento fornecido estava indisponível na revisão deste guia. Confirme o acesso com a equipe da Escola da Nuvem.",
      action: "Acompanhar minhas solicitações",
      url: "https://2sh9po.s.gy/Solicita",
    },
  ],
  videos: [
    { title: "Como consultar suas faltas", url: "https://youtu.be/Kt6rDq2hbP4" },
    { title: "Como realizar uma solicitação e acompanhar seu resultado", url: "https://youtu.be/X__7yCzRxc4" },
  ],
  normativeSummary: [
    "A justificativa não anula automaticamente o registro da falta. O art. 1º prevê a possibilidade de realizar as atividades avaliativas ocorridas na ausência, mediante solicitação específica.",
    "O art. 1º menciona até sete faltas justificadas. Isso não significa sete abonos garantidos.",
    "Pelo art. 2º, a documentação comprobatória deve ser apresentada em até dois dias úteis a partir do término do impedimento, devidamente datada, com carimbo e assinatura do responsável pelo documento.",
    "Os documentos e limites dependem da situação. Não são aceitos documentos rasurados ou apresentados fora do prazo.",
    "O aluno deve acompanhar o resultado e controlar suas faltas. O prazo da normativa de faltas não é apresentado aqui como prazo para transferência de turno.",
  ],
  normativeSections: [
    {
      title: "Saúde, acompanhamento e internação",
      paragraphs: ["Art. 3º, I e II: apresentar o original do atestado médico, psicológico, odontológico ou de outro profissional de saúde com registro em conselho, indicando a impossibilidade de frequentar as aulas. O CID não é obrigatório para justificar faltas.", "Atestado de acompanhamento é aceito para filhos menores de 16 anos e, nos demais casos, com comprovação de dependência. Também são aceitas declarações de comparecimento a consultas em postos de saúde, unidades de pronto atendimento e consultórios, datadas, com carimbo e assinatura do responsável.", "Para internação hospitalar, apresentar a nota original, datada, com carimbo e assinatura da instituição emitente."],
    },
    {
      title: "Falecimento",
      paragraphs: ["Art. 3º, III: apresentar original ou cópia simples do atestado de óbito e comprovação do parentesco. A normativa lista pai, mãe, irmão, cônjuge, filho, avós, padrasto, madrasta e enteados.", "Podem ser justificadas faltas por até sete dias consecutivos, contados do dia do óbito."],
    },
    {
      title: "Maternidade, paternidade e casamento",
      paragraphs: ["Art. 3º, IV e V: para licença-maternidade e/ou paternidade, apresentar cópia da certidão de nascimento do filho; para casamento, cópia da certidão de casamento. Em cada situação, a normativa prevê justificar faltas por até cinco dias consecutivos."],
    },
    {
      title: "Trabalho esporádico",
      paragraphs: ["Art. 3º, VI: quando coincidir com o horário habitual de estudo, conforme o Calendário Acadêmico, apresentar declaração com início e fim do período, carimbo da empresa e assinatura da chefia imediata. Quem trabalha em regime de turnos deve, preferencialmente, apresentar a escala com antecedência.", "O abono depende da análise da equipe e se limita a trabalho esporádico, não recorrente. São até dois dias consecutivos, respeitado o limite máximo de sete dias de justificativa."],
    },
    {
      title: "Religião",
      paragraphs: ["Art. 3º, VII: a normativa cita a Lei 13.796/19 para ausência em aula ou prova por crença religiosa. É obrigatório preencher o formulário e, a cada solicitação, anexar comprovante datado e assinado pelo representante da instituição religiosa e pelo estudante.", "O limite indicado é de até uma falta por semana por motivo relacionado à religião."],
    },
    {
      title: "Prova AWS Cloud Practitioner",
      paragraphs: ["Art. 3º, VIII: a falta no dia da prova AWS Certified Cloud Practitioner poderá ser abonada mediante comprovante de realização, com nome completo da pessoa candidata, data da avaliação e identificação da certificação AWS Cloud Practitioner. Após o envio e validação do comprovante, a ausência registrada será justificada, nos termos do documento."],
    },
    {
      title: "Viagens a trabalho",
      paragraphs: ["Art. 3º, IX: apresentar comprovante oficial de viagem a serviço, com nome completo e data e, se possível, identificação da atividade profissional. A normativa cita declaração da empresa, ordem de serviço, convocação ou documento similar.", "O abono depende do envio e validação do comprovante e da análise da equipe: apenas viagens esporádicas, não recorrentes. O limite é de até dois dias consecutivos, respeitado o máximo de sete dias de justificativa."],
    },
    {
      title: "Comprovação de participação por prints",
      paragraphs: ["Art. 3º, X: os prints da aula devem estar datados, com a data visível no desktop e o nome completo do estudante, evidenciando participação ou presença no ambiente virtual.", "Após a análise e validação dos registros, a falta poderá ou não ser abonada. O limite é excepcional: no máximo duas faltas."],
    },
    {
      title: "Problemas de internet ou energia",
      paragraphs: ["Art. 3º, XI: problemas individuais de internet ou energia elétrica não são abonados. Interrupções generalizadas, como quedas em toda a cidade ou região, podem ser analisadas excepcionalmente.", "É necessária comprovação por registros oficiais, comunicados públicos ou ampla repercussão. Para esses casos, a normativa permite no máximo duas faltas, em caráter excepcional."],
    },
    {
      title: "Casos não previstos e acompanhamento",
      paragraphs: ["Art. 4º: nos casos não previstos no art. 3º, o pedido feito pelo formulário é encaminhado à Operação Educacional e analisado pela coordenação da Operação, Analista de Operações e coordenações da instrutoria. Para esses casos, o retorno conclusivo é de até uma semana a partir do requerimento; esse não é um prazo universal para todas as solicitações.", "Art. 5º: é responsabilidade do aluno consultar o deferimento na plataforma indicada e controlar suas faltas."],
    },
  ],
};

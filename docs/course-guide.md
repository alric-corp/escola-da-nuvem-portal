# Guia do curso

Conteúdo e endereços ficam em [`frontend/course-guide-content.js`](../frontend/course-guide-content.js). O renderer é [`frontend/pages/course-guide.js`](../frontend/pages/course-guide.js). A página é informativa: não consulta a API, não controla frequência, não recebe documentos e não decide graduação, voucher ou abono. A sessão autenticada continua sendo exigida pelo aplicativo.

## Fontes e revisão editorial

Revisão editorial iniciada em **20/10/2026**, horário de Brasília. Esse registro identifica a revisão para esta implementação; **não** é data de emissão, vigência ou atualização institucional dos documentos. As fontes fornecidas não apresentam uma data de emissão aplicável; `issuedAt` permanece `null`.

- Apresentação original fornecida: “CX Aula Inaugural Regras Curso AWS CX Aula Inaugural Regras Curso AWS Restart 2 + NoCode - BRSAOXXX (1).pptx”, 13 slides. Textos, imagens dos slides 8 e 10 e hyperlinks foram inspecionados. O slide 8 apresenta o exemplo de 99/100 KCs: média elevada não substitui completar todos. O slide 10 reforça a realização do exame no prazo estipulado, sem indicar uma data.
- “Normativa de Abono de Faltas EdN.pdf”, 5 páginas, arts. 1º–5º. Texto integral extraído e todas as páginas conferidas visualmente; o PDF institucional inclui os contatos e a assinatura funcional da analista, sem registros de alunos.
- Comunicados, horários e URLs fornecidos pelo responsável no pedido de implementação.
- Referências do painel verificadas no código existente: padrão KC 70% e LAB 95%. Esses limites e os cálculos acadêmicos não foram alterados. O requisito de graduação de LAB 100% é apresentado separadamente.

### Aplicabilidade e diferenças editoriais

- As orientações de curso estão identificadas como provenientes do material **AWS re/Start 2 + NoCode**. A página não atribui módulos ou turno a uma turma sem confirmação. Aulas de segunda a sexta, 9h–12h / 19h–22h, aparecem apenas na seção complementar, como informação do material a confirmar com a equipe.
- Plantão técnico: a apresentação informa quarta 18h–19h; o responsável confirmou também 8h–9h. Os dois períodos publicados têm como origem o comunicado desta implementação.
- Empregabilidade: o comunicado informa quinta às 14h; o slide 12 menciona 14h–14h45. A interface informa **somente o início**, sem presumir duração. O término permanece pendente de confirmação editorial.
- Os horários foram centralizados com `America/Sao_Paulo` / “Horário de Brasília”, convenção operacional já usada pelo portal. Os slides não explicitam o fuso; não há conversão automática pelo fuso do navegador. Confirmar com o responsável caso seja estabelecido outro fuso.
- O material cita Cartilha do Aluno, gravações e materiais de estudo, mas não fornece URLs para todos esses recursos. Não foram criados links presumidos.
- A data do exame e o prazo aplicável ao voucher não foram informados. A página encaminha à equipe, sem calcular elegibilidade ou prometer emissão.
- Art. 1º da normativa distingue justificativa do registro de falta e prevê até sete justificativas, sem garantir abonos. Art. 2º: dois dias úteis a partir do término do impedimento; esse prazo não foi estendido à transferência de turno. Art. 4º: uma semana apenas para casos não previstos no art. 3º.
- O endereço de acompanhamento `https://2sh9po.s.gy/Solicita` respondeu **404 / “Link not found”** durante a revisão. O endereço fornecido foi preservado e recebeu aviso visível para confirmar o acesso com a equipe. Não foi inventado destino alternativo. Essa pendência não bloqueia os demais conteúdos e canais.

## Documentos distribuídos

Os documentos destinados aos alunos são assets públicos da release, com nomes estáveis em `frontend/documents/`. Não adicionar anexos privados, atestados ou arquivos de alunos a essa pasta. As URLs são construídas com `new URL(..., import.meta.url)`: apontam para a **mesma release versionada** do módulo, não para a raiz do CloudFront.

| Fonte original | SHA-256 verificado |
|---|---|
| Normativa PDF original | `5955ebc7db7a4eeceb07d0e4887e2e301ca6e88391cf18012b95baf33e1465d0` |
| Apresentação PPTX original | `51471938df333b38bcdae28e8875ab4f187b0695043ea3f86f32c06da2dfaee7` |

O nome original da apresentação contém um código genérico de turma. Ele não aparece no texto dos slides, nas imagens inspecionadas ou no nome estável oferecido pela interface.

- `normativa-abono-faltas.pdf`: o PDF original, sem alterações, `application/pdf`.
- `aula-inaugural-regras-curso.pptx`: a apresentação original, sem alterações, `application/vnd.openxmlformats-officedocument.presentationml.presentation`. A interface identifica o formato PowerPoint; é necessário um leitor compatível.

**Limitação da conversão:** a exportação local pelo Microsoft PowerPoint falhou; uma conversão alternativa por QuickLook foi rejeitada na conferência visual por perda de contraste e corte de conteúdo. Nenhum PDF dessa conversão foi incluído. Foi usado o fallback previsto no pedido: disponibilizar o original com suporte explícito de MIME/build/release. O resumo HTML mantém as orientações acessíveis sem depender da abertura da apresentação.

## Conferência de links externos

Consultas limitadas de leitura, sem preencher formulários, entrar em reuniões ou enviar solicitações. Os endereços fornecidos continuam exatamente iguais no módulo.

| Canal | Resultado observado |
|---|---|
| Plantão técnico / empregabilidade | HTTP 200 nos endereços Meet; isso não valida participação nem disponibilidade do encontro |
| Discord | HTTP 200; convite preservado sem entrar na comunidade |
| Vídeos de orientação | HTTP 200; links leves, sem iframe ou reprodução automática |
| Formulário | HTTP 200 após redirecionamento para autenticação Google; não houve preenchimento |
| Consulta de faltas | Encurtador redireciona para Google Apps Script, que respondeu HTTP 403 à consulta automatizada; não classificado como link inexistente |
| Acompanhar solicitações | HTTP 404 / “Link not found”; aviso editorial na interface e confirmação com equipe pendente |

Essas consultas demonstram apenas a resposta pública no momento da revisão. Serviços podem exigir login ou restringir clientes automatizados; não equivalem à execução dos fluxos administrativos.

## Manutenção

1. Atualizar textos, horários e URLs no módulo central, registrando a fonte e a data real da revisão. Preservar ressalvas, contexto e aplicabilidade.
2. Ao substituir documentos institucionais, conferir todas as páginas, imagens e hyperlinks, atualizar os hashes desta documentação e manter os nomes estáveis.
3. Incluir arquivos novos somente nas listas explícitas de build/release e no mapeamento MIME. Não alterar a baseline histórica.
4. Executar os testes de conteúdo, navegação/teclado, responsividade e release versionada. Não alterar backend, autenticação, critérios acadêmicos ou configurações administrativas para atualizar conteúdo.

As capturas de interface usam usuários e dados fictícios. Nenhuma implantação manual ou novo procedimento de backend é necessário para esta área estática.

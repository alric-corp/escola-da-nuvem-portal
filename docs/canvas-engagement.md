# Engajamento no Canvas no Painel do Instrutor

O painel distingue Crítico em vermelho (`--color-danger`), mantendo Atenção em âmbar e Médias na referência em verde-água. Critérios acadêmicos, referências KC/LAB e notas não mudam.

## Coleta e significado

A sincronização das 6h e 18h reutiliza a consulta paginada `GET /api/v1/courses/{course_id}/users?enrollment_type[]=student&include[]=email&include[]=enrollments`, sem chamadas individuais. A API documenta a inclusão de matrículas e seus campos de atividade: [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses) e [Enrollments](https://developerdocs.instructure.com/services/canvas/resources/enrollments). A disponibilidade depende das permissões do token; o [serializador oficial](https://github.com/instructure/canvas-lms/blob/master/lib/api/v1/user.rb) condiciona esses campos ao próprio usuário ou à permissão `read_reports` do curso.

Em 20/10/2026 foi realizada uma única consulta autorizada de leitura na instância existente, com `per_page=2`. Retornou HTTP 200; as duas pessoas da amostra tinham matrículas com `user_id`/`course_id` correspondentes e ambos os campos de atividade presentes. Isso comprova a disponibilidade nessa amostra, sem presumir cobertura de todas as pessoas/cursos. Token, dados pessoais e resposta bruta não foram registrados como evidência.

- Associação pelo Canvas User ID, curso e matrícula `StudentEnrollment`; matrículas apagadas/rejeitadas são ignoradas.
- Múltiplas matrículas/seções produzem uma pessoa por curso. Para evitar soma de contadores potencialmente sobrepostos, usa-se o **maior contador válido**, e a data válida mais recente. É uma consolidação conservadora, não uma soma de tempo entre seções.
- `total_activity_time` é acumulado no curso, em segundos. Zero é válido; ausente, nulo ou inválido é desconhecido. Não equivale a tempo efetivo de estudo nem mede somente os últimos sete dias.
- Datas precisam incluir fuso; datas inválidas ou futuras em relação à coleta são descartadas.
- Erro no include aciona a consulta original para preservar as notas; erro ao salvar métricas não bloqueia notas. Se os campos forem completamente omitidos, a coleta anterior é preservada. Campos explicitamente nulos representam uma coleta sem informação disponível.
- A coleta independe de novas publicações acadêmicas. O cache por curso evita repetir a consulta para turmas que compartilham um curso.

## Persistência e API

A tabela DynamoDB existente recebe um registro compacto por curso: `PK=CANVAS_ACTIVITY#<courseId>`, `SK=METADATA`, com `courseId`, `collectedAt` e `students`, indexado pelo Canvas User ID. Guarda apenas tempo/data, sem nome, e-mail, token ou payload Canvas. Snapshots e histórico de notas não são alterados.

O relatório existente `GET /cohorts/{code}/report` acrescenta os campos opcionais abaixo **somente na resposta de instrutor autorizado/administrador**, depois da autorização atual. A resposta do aluno e o resumo compartilhado não recebem métricas individuais. A leitura usa apenas DynamoDB, sem chamadas ao Canvas.

Exemplo parcial fictício:

```json
{
  "canvasEngagement": {"courseId": "123", "collectedAt": "2026-10-20T09:00:00+00:00"},
  "students": [{
    "id": "456",
    "canvasActivity": {
      "totalActivityTime": 19200,
      "lastActivityAt": "2026-10-19T15:30:00+00:00",
      "collectedAt": "2026-10-20T09:00:00+00:00"
    }
  }]
}
```

## Painel e exportação

A mediana e os indicadores consideram somente alunos ativos no portal. Última atividade conhecida com idade **maior ou igual a sete dias** entra em “Sem atividade registrada há 7+ dias”; datas mais recentes entram em “Com atividade nos últimos 7 dias”. Ausência de informação não é inatividade. Desistentes continuam no fim da tabela e fora dos indicadores.

O filtro de atividade pode ser combinado com situação acadêmica e busca. A ordenação por última atividade mostra as mais antigas primeiro, depois pessoas sem data, preservando desistentes ao final. Datas/horas usam `America/Sao_Paulo`, o fuso já usado pela sincronização. Coleta com mais de 24h recebe aviso discreto. Tempo é exibido em horas/minutos; valores positivos abaixo de um minuto aparecem como `<1min`.

O CSV mantém as dez colunas existentes e acrescenta última atividade (Brasília) e tempo acumulado; conserva BOM UTF-8, separador `;`, escape de aspas e proteção contra fórmulas. No celular, os dados aparecem na linha empilhada existente, sem rolagem horizontal. Backend antigo ou coleta indisponível produz “Sem informação”, sem quebrar a página.

Capturas de Chromium com dados inteiramente fictícios: [desktop](images/teacher-canvas/desktop.png) e [mobile](images/teacher-canvas/mobile.png). Os testes de navegador usam API simulada; não equivalem a QA autenticado em produção.

## Implantação do backend — evidência posterior

A implementação original não executou implantação de Lambdas. Essa pendência foi superada: a conferência AS-IS de **21/10/2026**, sobre a main `c62f924033b6ea44cd09c4c1094b1a88610d2fa3`, comparou o ZIP efetivo da Lambda `identity` e encontrou os 15 arquivos Python de runtime idênticos à revisão, incluindo `canvas_activity.py`. A Lambda `canvas-sync` tinha o mesmo `CodeSha256`:

`S/bn9gfKgYiRWVade7YGBr22Qjpnzsbd7iC2W0364Ys=`

O pacote foi atualizado em **20/10/2026, 22:19 UTC**; a implantação dessa data também está registrada no [PR #10](https://github.com/alric-corp/escola-da-nuvem-portal/pull/10) e na [conferência do TODO 25](todo/concluido/25-higiene-do-backend.md). São evidências de código implantado, não de coleta completa para todos os alunos/cursos nem de QA autenticado real.

Futuras atualizações de backend seguem o [procedimento separado](../infra/README.md#5-operação-posterior). O pacote é compartilhado por cinco Lambdas; o deploy automático do frontend não as atualiza. Não há recurso, endpoint ou agendamento novo nesta funcionalidade.

**Pendências do diagnóstico:** AS-02 (catálogo sem itens embutidos) e AS-03 (preservação/cobertura de atividade parcial) permanecem como próximos trabalhos, não corrigidos nesta atualização documental. A validação autenticada real também continua pendente.

## Sugestões futuras — fora deste PR

| Métrica | Benefício pedagógico | Endpoint de leitura |
|---|---|---|
| Entregas pendentes/atrasadas (`missing`, `late`) | Priorizar apoio a tarefas concretas, sem inferir dedicação pelo tempo | [`GET /courses/:course_id/students/submissions`](https://developerdocs.instructure.com/services/canvas/resources/submissions) |
| Progresso em módulos e requisitos | Identificar onde a pessoa precisa de apoio para avançar | [`GET /courses/:course_id/modules?student_id=…&include[]=items`](https://developerdocs.instructure.com/services/canvas/resources/modules) |
| Progresso de conclusão do curso | Acompanhar requisitos concluídos e restantes | [`GET /courses/:course_id/users/:user_id/progress`](https://developerdocs.instructure.com/services/canvas/resources/courses) |

Exigem avaliação própria de permissões, paginação e disponibilidade na instância. Nenhuma foi implementada.

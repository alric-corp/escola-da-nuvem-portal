# Jornada do instrutor

## 1. Obter acesso

1. O instrutor cria a conta no Cognito com um e-mail cujo domínio é **exatamente** `escoladanuvem.org`.
2. Sem turma vinculada, cai na tela "Primeiro acesso", que mostra **Solicitar acesso de instrutor** (`POST /access-request`, registrado em `REQUESTS/<sub>`).
3. Um administrador vincula o instrutor a uma ou mais turmas (veja [jornada-admin.md](jornada-admin.md)).
4. No próximo acesso, `GET /cohorts` devolve `canTeach: true` para essas turmas e o menu passa a mostrar as opções de instrutor.

O papel é avaliado **por turma**: a mesma conta pode ser instrutora numa turma e aluna em outra.

## 2. Painel do instrutor (`frontend/pages/teacher.js`)

- Métricas da turma: total de alunos, na referência, atenção e crítico. Desistentes (alunos que o backend marca com `participationStatus: "WITHDRAWN"`) ficam fora das métricas: com algum desistente, o primeiro cartão vira **Alunos ativos**, com o número de desistentes na legenda.
- **Foco da turma**: três campos de seleção com as atividades liberadas (`POST /focus-activities`). O salvamento exige a publicação atual e a versão do foco, para não sobrescrever a alteração de outro instrutor.
- Tabela de alunos:
  - busca por nome ou e-mail;
  - filtros: situação, sem e-mail no Canvas, com atividades sem nota; com algum desistente, também **Ativos** e **Desistentes**. Os demais filtros contam só ativos;
  - ordenação: nome, mais pendências, menores médias;
  - desistentes continuam na tabela, com o badge **Desistente**, depois dos ativos em Todos os status;
  - **Exportar CSV** gera a lista filtrada da tela, com a coluna **Participação** (Ativo ou Desistente) no fim. A coluna **Situação** continua sendo a situação acadêmica.
- **Ver pendências** de um aluno abre suas pendências, histórico, participação e situação dos lembretes. O modelo e o envio individual de e-mail foram removidos da interface; os filtros do painel são preservados ao voltar.
- No detalhe, **Marcar como desistente** ou **Reativar aluno**, depois da confirmação, muda a participação do aluno na turma (`POST /participation`). O portal recarrega o detalhe e o painel. Se outra pessoa mudou a participação antes, o portal avisa e mostra o estado atual, sem repetir o pedido. Nada muda no Canvas.

## 3. Atualizar notas: sincronização ou CSV

Nas turmas com `autoSync` habilitado, a consulta ao Canvas ocorre às 6h e às 18h, no horário de Brasília. O painel distingue a última verificação da última mudança nas notas. Não é necessário importar CSV semanalmente para manter essas turmas atualizadas.

O fluxo manual em **Atualizar notas** (`frontend/pages/import.js`) continua disponível para turmas sem sincronização ou quando uma importação for necessária:

```
Canvas: Notas ▸ Exportar CSV
        │
        ▼
Selecionar arquivo ─► Conferir arquivo ─► POST /preview
        │                                   ├─ parse_csv (valida e calcula)
        │                                   ├─ grava source.csv e snapshot.json no S3
        │                                   ├─ grava DRAFT#<id>
        │                                   └─ devolve prévia e diferenças com a publicação atual
        ▼
Marcar/desmarcar "O que já foi liberado?" ─► Atualizar prévia (nova chamada /preview com activeIds)
        ▼
Conferir "O que muda ao publicar" (+ confirmar alunos removidos, se houver)
        ▼
Publicar atualização ─► POST /publish ─► transação: METADATA.current = draft, DRAFT → PUB
```

Pontos importantes:

- **A publicação substitui tudo (snapshot), não mescla.** O CSV precisa conter a turma completa.
- Na primeira prévia (sem seleção explícita), uma atividade vem liberada quando tem pelo menos 5 notas preenchidas (ou todas, em turmas com menos de 5 alunos) **ou** já estava liberada na publicação atual. Isso evita que uma atividade caia do cálculo sozinha por ter poucas notas ainda. Se alguma atividade antes ativa sair da liberação (por exemplo, por não existir mais no CSV), a prévia mostra um alerta com a lista. Uma seleção manual do instrutor (ao marcar/desmarcar em "Atualizar prévia") sempre prevalece.
- A publicação é recusada quando:
  - outra pessoa publicou depois da prévia (`base` diferente da atual);
  - a prévia pertence a outro instrutor;
  - há alunos removidos sem confirmação;
  - nenhuma atividade está liberada.
- Os arquivos e prévias ficam só na memória da aba, por turma. Fechar a página com rascunho pendente pede confirmação.

## 4. Publicações da turma (`historyPage`)

A tela lista todas as publicações, com arquivo e contagem de mudanças. **Restaurar** (`POST /restore`) aponta `current` para uma publicação antiga e grava `AUDIT#`. Os alunos passam a ver a data da restauração e a data original das notas.

## 5. Lembretes por e-mail

Pré-requisitos, verificados em `SESMailer.readiness`:

1. `REMINDERS_ENABLED=true` na Lambda.
2. O instrutor abre **Lembretes**, clica em **Solicitar confirmação do meu e-mail** (cria a identidade SES) e confirma o link da AWS no e-mail institucional.
3. A conta SES está fora do sandbox e com envio habilitado.

Nas turmas habilitadas, o envio é automático às terças e sextas, às 20h de Brasília, conforme os gates e regras existentes ([AUTO-5](historico/automacoes/auto-5.md)). Como alternativa manual, o filtro **Com atividades sem nota** oferece **Enviar lembrete para…**, com prévia do lote e confirmação dos destinatários elegíveis.

No detalhe do aluno, **Atualizar status do envio** consulta o estado registrado; a tela não oferece modelo, cópia ou envio individual. A rota individual permanece no backend, mas não é o procedimento atual da interface. Eventos SES chegam via SNS à Lambda `reminder-events` e registram entrega, atraso ou falha. Aceite do SES não comprova entrega nem leitura.

Só é possível **um lembrete por aluno por publicação**, com exceção dos envios que falharam com certeza (`failed`). Resultados incertos (`unknown`) ficam bloqueados para evitar e-mail duplicado.

Desistente não recebe lembrete: o detalhe informa a participação e o backend recusa o envio (409). No lote (filtro **Com atividades sem nota** → **Enviar lembrete para…**), a prévia mostra quem será pulado e por quê, inclusive **Desistente**. O envio leva só os alunos aprovados nessa prévia, e o backend revalida cada um.

## 6. Notas da turma (`?turma=<code>`)

`frontend/pages/class-report.js` é uma tela somente leitura, sem e-mails nem IDs. Ela abre por link direto (`?turma=`). O conteúdo se sobrepõe ao painel do instrutor. Como no painel, desistentes ficam fora dos cartões e dos filtros de situação e aparecem na tabela com o badge, por último em Todos os status.

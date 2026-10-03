// Participação do aluno na turma (C7.2). O backend marca só os desistentes, com participationStatus "WITHDRAWN" nas
// linhas do instrutor (relatório, Notas da turma, prévia do lembrete); ausência = ativo. As telas leem o campo da
// própria linha, sem guardá-lo em outro lugar; marcar e reativar ficam para a C7.2.4.
export const isWithdrawn = (row) => row?.participationStatus === "WITHDRAWN";

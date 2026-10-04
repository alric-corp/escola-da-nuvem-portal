# 23 — Concorrência e respostas stale

**Status:** pendente · **Origem:** roadmap técnico C7 posterior à C7.2.

## Contexto

Há fluxos assíncronos em que uma resposta antiga pode chegar depois de o
usuário já ter mudado de contexto e sobrescrever uma visualização mais nova.

A C7.2 já resolveu participação/desistentes e está concluída e ativada em
produção. Essa funcionalidade não faz parte deste TODO.

Os pontos abaixo vêm do roadmap e devem ser caracterizados antes da correção;
este documento não registra uma nova reprodução dos problemas.

## Pendências conhecidas

### Resultado stale do lote

- Envio/resultado de um lote anterior pode contaminar uma visualização posterior.
- Preservar o comportamento da C7.2: batch send usa somente os IDs aprovados
  pela preview.
- Não quebrar o motivo `withdrawn`.

### loadSender

- Revisar resposta atrasada na mesma turma.
- Avaliar generation/request guard para distinguir requisições sucessivas.

### loadMine

- Proteger contra resposta antiga sobrescrevendo estado mais novo.

### Preview individual

- Erro ou resposta atrasada de outro aluno não deve contaminar o detalhe atual.

### Revisão transversal

- Procurar outros requests com o mesmo padrão, sem abrir refatoração genérica.

## Estratégia esperada

1. Criar characterization tests do comportamento atual.
2. Demonstrar a falha com teste RED.
3. Aplicar o menor generation/request guard necessário.
4. Executar mutations que comprovem a proteção.
5. Validar os fluxos com browser tests.

Preservar contratos existentes; não mudar um contrato sem necessidade
demonstrada. Nenhuma implementação será feita nesta tarefa documental.

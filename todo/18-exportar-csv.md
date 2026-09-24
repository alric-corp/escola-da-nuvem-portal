# 18 · Recuperar funções da ferramenta antiga (exportar CSV)

**Prioridade:** baixa · **Esforço:** pequeno · **Área:** instrutor

## Problema
A ferramenta antiga (raiz do repositório) permitia exportar o relatório em CSV, enviar por situação e copiar a mensagem de um aluno. O portal novo não tem essas funções.

## Proposta
- Botão **Exportar CSV** no painel do instrutor, gerado no navegador a partir de `state.report.students` e respeitando os filtros ativos.
- Envio por situação: coberto por [08](08-lembretes-em-lote.md).
- **Copiar mensagem**, na prévia do lembrete.

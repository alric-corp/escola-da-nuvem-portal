# 18 · Recuperar funções da ferramenta antiga (exportar CSV)

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída · **Prioridade:** baixa · **Esforço:** pequeno · **Área:** instrutor

## Problema
A ferramenta antiga (raiz do repositório) permitia exportar o relatório em CSV, enviar por situação e copiar a mensagem de um aluno. O portal novo não tem essas funções.

## Proposta
- Botão **Exportar CSV** no painel do instrutor, gerado no navegador a partir de `state.report.students` e respeitando os filtros ativos.
- Envio por situação: coberto por [08](08-lembretes-em-lote.md).
- **Copiar mensagem**, na prévia do lembrete.

## O que foi feito
- **Exportar CSV (N)** no painel do instrutor: gerado no navegador a partir das linhas visíveis (busca, filtro e ordenação ativos), com nome, e-mail, médias, % com nota, pendências e situação. Separador `;` e BOM UTF-8, para abrir direto no Excel em português com acentos. Células que começariam com `=`, `+`, `-` ou `@` recebem um apóstrofo, para não virarem fórmula.
- **Copiar mensagem** na prévia do lembrete (assunto + texto), com aviso claro se o navegador bloquear a área de transferência.
- Envio por situação já estava coberto pelo TODO 08.
- Testes: `tests/instructor-tools-browser.mjs` (conteúdo do CSV, filtro, proteção contra fórmula e cópia).

# 26 · Retirar o Foco da turma da interface

**Status:** ✅ implementação e testes locais concluídos; integração/publicação pendentes · **Prioridade original:** média · **Esforço:** pequeno · **Área:** frontend

## Decisão de produto — 23/10/2026

O titular decidiu retirar o recurso por falta de uso e excesso de informação
visual. A correção originalmente proposta para salvar foco vazio foi substituída
pela remoção da funcionalidade no frontend. Este documento preserva o ID 26;
o problema original abaixo explica a origem da decisão, não uma pendência atual.

## Implementação

- Painel do instrutor sem editor, estado de salvamento ou ações de foco.
- Visão por atividade preservada, sem coluna/ações “Adicionar ao foco”.
- Aluno mantém “Por onde começar” e os próximos passos automáticos existentes;
  seleções legadas do backend não influenciam a ordem nem o título da seção.
- Estado e handlers exclusivos do recurso retirados. Foco de teclado,
  acessibilidade e guardas dos demais fluxos permanecem.
- Backend, contrato OpenAPI, wrapper de compatibilidade da API e registros
  existentes preservados. Nenhuma exclusão ou gravação de foco foi executada.

## Evidência original — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`, com reprodução Node
local das funções reais e dados fictícios, sem rede. Não é relato de incidente
produtivo.

- [focusEditor](../../../frontend/pages/teacher.js), linhas 116–134 na revisão analisada: detectava a
  diferença entre foco salvo e rascunho, mas desabilita Salvar quando o rascunho
  está vazio.
- [Remover foco](../../../frontend/app.js), linhas 1309–1315 na revisão analisada: remover o último item
  produz corretamente `focusDraft = []`.
- [Portal._focus_activities](../../../backend/portal.py), linhas 628–642: a API já
  aceita `activityIds: []`, preservando publicação e versão esperadas.

**Reprodução:** foco salvo `[a1]` → remover `a1` → rascunho `[]`. A interface
exibe “Alterações ainda não salvas”, mas o botão Salvar fica desabilitado. O
instrutor não consegue encerrar o foco pela interface.

## Critérios da remoção

- [x] Nenhuma ação/coluna/editor de foco em instrutor, administrador ou aluno.
- [x] Payload com foco legado continua aceito, sem interferir nas sugestões.
- [x] Navegar, atualizar e trocar turma não envia `focus-activities`.
- [x] Visão por atividade, notas, filtros, CSV e próximos passos preservados.
- [x] Testes Node e navegador cobrem ausência dos controles e compatibilidade,
  incluindo teclado, mobile e texto ampliado.
- [ ] Integração e publicação da nova interface — pendentes deste PR.

Os testes exclusivos de salvar o recurso foram substituídos por provas da
remoção. Regressões independentes de restauração, sessão e mutações de
stale/lifecycle foram preservadas; “foco” nesses testes também designa o foco de
teclado, que não foi retirado.

## Validação local — 23/10/2026

- `npm test`: 544 aprovados; `npm run test:browser`: 250 aprovados, zero falhas
  ou skips. Recortes dirigidos não foram somados a essas suítes.
- Mutações de respostas antigas: 28/28 detectadas; lifecycle: 44/44 detectadas;
  zero sobreviventes e checkout preservado. Scripts de mutação inalterados.
- `openapi:check` e `git diff --check` aprovados; sem mudança no contrato HTTP.
- Capturas [desktop](../../evidence/todo26-27/desktop.png) e
  [mobile](../../evidence/todo26-27/mobile.png) usam dados fictícios.

A suíte de navegador passou de 263 para 250: foram retirados 15 casos exclusivos
do Foco e adicionados dois de ausência/compatibilidade e atalho. As regressões de
restauração C1-D03/D04, PR3-B1 e C2-N1–N8 foram preservadas. O teste de POST 429
foi transferido para participação, mantendo uma tentativa, mensagem de erro e
ausência de atualização otimista.

## Limites e implantação

Somente frontend; não exige implantação backend ou infraestrutura. Não altera
notas, regras acadêmicas, classificação ou limite das sugestões automáticas.
O [TODO 09](09-visao-por-atividade-e-foco.md) permanece como registro histórico.

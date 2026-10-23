# 26 · Permitir remover o último item do Foco da turma

**Status:** aberto · **Prioridade:** média · **Esforço:** pequeno · **Área:** instrutor / frontend

## Evidência — 23/10/2026

Revisão `bbd7e6972d736e4a68b610f68b035aad594e9aaa`, com reprodução Node
local das funções reais e dados fictícios, sem rede. Não é relato de incidente
produtivo.

- [focusEditor](../../frontend/pages/teacher.js), linhas 116–134: detecta a
  diferença entre foco salvo e rascunho, mas desabilita Salvar quando o rascunho
  está vazio.
- [Remover foco](../../frontend/app.js), linhas 1309–1315: remover o último item
  produz corretamente `focusDraft = []`.
- [Portal._focus_activities](../../backend/portal.py), linhas 628–642: a API já
  aceita `activityIds: []`, preservando publicação e versão esperadas.

**Reprodução:** foco salvo `[a1]` → remover `a1` → rascunho `[]`. A interface
exibe “Alterações ainda não salvas”, mas o botão Salvar fica desabilitado. O
instrutor não consegue encerrar o foco pela interface.

## Menor mudança recomendada

Permitir salvar uma lista vazia quando ela representa uma alteração do foco
salvo. Manter o estado vazio inicial sem alteração desabilitado. Reutilizar o
fluxo atual de salvamento e sua proteção contra conflito, sem nova rota.

## Critérios de aceite

- [ ] Remover o último item habilita Salvar e envia `activityIds: []` uma vez.
- [ ] Após salvar e recarregar, o foco permanece vazio; o aluno volta às
  sugestões automáticas já existentes.
- [ ] Vazio inicial, salvamento em andamento e demonstração continuam com os
  bloqueios adequados.
- [ ] Publicação/versão divergente continua retornando conflito; troca de turma,
  sessão e erros não aplicam o resultado no contexto errado.
- [ ] Regressão Node e navegador com teclado e mobile. O teste de vazio inicial
  em [teacher-home.mjs](../../tests/teacher-home.mjs) permanece preservado.

## Limites e implantação

Somente frontend; não exige implantação backend ou infraestrutura. Não altera
notas, escolha das sugestões, limite de três atividades ou regras acadêmicas.
O [TODO 09](concluido/09-visao-por-atividade-e-foco.md) permanece concluído:
este item trata somente o encerramento de um foco já salvo.

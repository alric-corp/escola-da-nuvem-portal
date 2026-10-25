# 32 · Acompanhar o ritmo do curso para o instrutor

**Status:** aberto · **Prioridade:** a definir após validar a fonte · **Área:** instrutor / planejamento

## Problema e referência — 24/10/2026

O titular acompanha o andamento coletivo comparando encontros realizados,
tempo reservado a Soft Skills e carga planejada dos conteúdos ministrados.
Esse planejamento não é o progresso individual do aluno, uma nota ou uma
medida de qualidade do trabalho do instrutor.

Referências fornecidas na conversa, sem presumir que sejam o estado atual:

| Programa | Encontros re/Start | Encontros NoCode | Total | Minutos programados | Horas |
| --- | ---: | ---: | ---: | ---: | ---: |
| AWS re/Start 1 | 95 | 20 | 115 | 20700 | 345h |
| AWS re/Start 2 | 64 | 15 | 79 | 14220 | 237h |

| Amostra informada | Encontros realizados | Minutos totais | Minutos Soft Skills | Minutos técnicos | Saldo informado |
| --- | ---: | ---: | ---: | ---: | ---: |
| re/Start 1 | 52 | 9360 | 2380 | 6980 (116h20) | +1360 (22h40 de atraso) |
| re/Start 2 | 62 | 11160 | 2590 | 8570 (142h50) | -520 (8h40 de adiantamento) |

As amostras usam 180 minutos por encontro e 34/37 ocorrências de Soft Skills
de 70 minutos. Esses valores descrevem o material recebido; não são uma regra
universal a fixar para toda turma. A data da conversa não é a data de medição
da planilha. Na segunda amostra, `-520` minutos corresponde a `-8h40`; o texto
`-9:20` informado precisa ser corrigido/conferido na origem.

## Definição a validar antes da implementação

Uma fórmula compatível com o sinal descrito pelo titular é:

```text
tempo técnico disponível = minutos dos encontros realizados − minutos de Soft Skills
saldo de ritmo = tempo técnico disponível − duração planejada dos conteúdos ministrados
```

Saldo positivo representa atraso em relação ao conteúdo; negativo representa
adiantamento; zero representa alinhamento. A primeira conta confere nas duas
amostras. A segunda precisa ser confrontada com a fórmula e com a soma dos
conteúdos na planilha original; os saldos não foram recalculados dessa soma.

Definir uma única fonte mantida pelo responsável para encontros efetivamente
realizados, conteúdos ministrados e ajustes de planejamento. Esclarecer a etapa
re/Start versus NoCode, tratamento de encontros parciais, revisões, exercícios,
feriados e sobreposição com Soft Skills. Usar calendário decorrido ou notas
publicadas como substitutos fabricaria uma precisão que esses dados não provam.

## Menor entrega proposta

Após validar a fonte, oferecer um bloco compacto “Ritmo do curso” para
instrutor autorizado/admin, por turma e etapa: encontros realizados, saldo
estimado com rótulo claro e última atualização. Detalhes do cálculo ficam sob
demanda. Evitar números negativos de horas na apresentação, preferindo
“8h40 adiantado”, e manter os minutos numéricos para cálculo.

Reutilizar os recursos existentes quando suficientes. Não criar um novo
sistema de agenda, controle de frequência, integração administrativa ou
painel extenso apenas para reproduzir a planilha.

## Critérios de aceite

- [ ] Fonte, responsável, revisão do planejamento e data de observação estão
  definidos, sem apresentar a atualização da interface como coleta nova.
- [ ] Programa/turma corretos, coordenados com o [TODO 31](31-programa-da-turma-e-guia-por-curso.md),
  sem misturar totais de re/Start, NoCode ou dados de outra turma.
- [ ] Fórmula validada com exemplos reproduzíveis, incluindo zero, negativo,
  minutos residuais, campo ausente, valor inválido e encontro parcial.
- [ ] Ausência de planejamento ou coleta antiga é explícita; não vira saldo
  zero, falso alinhamento ou reprovação do instrutor.
- [ ] Nenhuma alteração em notas, status acadêmico, participação, graduação,
  lembretes ou conclusão individual de atividades.
- [ ] Acesso restrito aos perfis e turmas autorizados; a jornada do aluno não
  recebe automaticamente um aviso de “instrutor atrasado”.
- [ ] Troca de turma/sessão e leitura atrasada não contaminam o planejamento;
  teclado, mobile e compatibilidade com dados anteriores são testados.

## Fora do escopo e estado

Não inferir realização de aulas por tempo de atividade Canvas, submissões ou
status “Finalizado” de um aluno. Não dividir o número de linhas da grade por
encontros: teoria, KC, laboratório e instrução administrativa são unidades
diferentes. Não recriar o [Foco da turma removido](concluido/26-remover-foco-da-turma.md)
nem duplicar as recomendações de atividades já existentes.

A leitura dos metadados de cursos Canvas confirmou seus IDs, mas não comprovou
uma fonte para os indicadores desta planilha. Este TODO é uma proposta, sem
implementação, nova infraestrutura ou compromisso de exibir saldos atuais.

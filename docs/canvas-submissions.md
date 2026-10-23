# Situação das entregas Canvas

## Acesso e compatibilidade

A coleta auxiliar usa a lista coletiva de submissões por curso, com paginação,
`grouped=true`, `per_page=10` e `include[]=visibility`, e a lista de assignments
para comprovar a aplicabilidade. O agrupamento pagina alunos; páginas pequenas
limitam o payload. O cliente descarta corpos e notas não utilizados a cada página.
É uma consulta separada das submissões `workflow_state=graded` do CSV: a seleção,
os valores e os cálculos acadêmicos permanecem iguais. O resultado é reaproveitado
pelas turmas do mesmo curso e não há chamada Canvas no carregamento das páginas.

Uma linha por aluno/curso na tabela existente limita o tamanho de cada item; o
marcador do curso ordena as tentativas, e as transações condicionais impedem uma
tentativa antiga de sobrescrever uma nova. O registro armazena somente IDs,
estados normalizados, tentativa, horários e proveniência. Ele não autoriza acesso.
O backend acrescenta o envelope somente ao relatório do próprio aluno e ao detalhe
já autorizado do instrutor. O frontend anterior ignora a extensão; o novo tolera
sua ausência. Não há migração obrigatória ou publicação artificial de notas.

## Referências e decisão

Documentação oficial conferida nesta implementação (revisão editorial em 23/10/2026):

- [Submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions):
  listagem coletiva, campos de tentativa, visibilidade, horários e relação da nota
  com a tentativa atual. A opção `read_status` não é solicitada.
- [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments):
  publicação, liberação, tipos de submissão e visibilidade.
- [Controller oficial](https://github.com/instructure/canvas-lms/blob/master/app/controllers/submissions_api_controller.rb):
  `for_students` pagina os usuários no modo agrupado. Isso não comprova a versão
  ou os campos efetivamente disponibilizados pela instância institucional.

| Evidência atual válida | Estado do portal |
| --- | --- |
| Entrega digital visível, `submitted`, tentativa e horário válidos | `submitted`: entrega registrada; avaliação não confirmada |
| Mesmas evidências e `pending_review` | `pending_review`: entrega em revisão, sem presumir quem revisa |
| `graded`, horários válidos de avaliação e de postagem, `grade_matches_current_submission=true` | `graded`: avaliação da tentativa já disponibilizada, sem copiar a nota |
| `grade_matches_current_submission=false`, entrega atual válida | `submitted`: nova tentativa; avaliação atual não confirmada |
| `unsubmitted`, atividade digital publicada/liberada/visível, `excused=false`, `has_overrides=false`, liberação informada (null válido), tentativa zero e sem horário de envio | `unsubmitted`: sem entrega registrada na observação |
| Dispensa, atividade não publicada/visível/liberada ou tipo sem entrega digital aplicável | `not_applicable` |
| Registro ausente, estado/campos incompletos, tipo desconhecido ou informação inválida | `unknown`; eventual observação anterior permanece retida e identificada |

Zero de nota não é usado para classificar uma entrega. `late` e `missing` não são
atalhos de classificação. LTI, quizzes, discussão e atividades offline não são
interpretados como uma entrega digital comum; precisam de evidência específica
antes de uma futura ampliação. Ausência de registro não significa não entrega.

Falha integral registra a tentativa sem renovar observações. Omissão/inválido
preserva o estado anterior e sua data; null explícito torna a situação atual
indisponível, preservando a referência da última observação válida. A leitura
informa parcialidade/falha e não mistura esses dados atuais ao histórico de notas.

## Implantação futura

O pacote compartilhado existente das Lambdas inclui o novo módulo automaticamente
pelo procedimento de backend. Atualizar o backend compatível antes do frontend é
recomendado; a ordem inversa mantém “situação indisponível”. A sincronização
agendada passa a preencher os dados, sem backfill produtivo nesta entrega.
Nenhuma mudança de infraestrutura, permissão, agenda ou Canvas é aplicada aqui.

## Limites e evidência local

A Lambda declarada continua em Python 3.13/ARM64, 256 MB e 300 segundos; nada
foi aplicado. As tentativas de notas de **todas** as turmas vêm antes da coleta de
entregas. O caminho auxiliar compartilha até 60 segundos por invocação e deixa de
iniciar trabalho ao atingir 240 segundos desde o início. Há limite de 1.000 páginas
por lista, 500 alunos, 200 atividades e 340.000 bytes por item de aluno. Exceder um
limite é indisponibilidade/parcialidade explícita, nunca sucesso truncado.

Cada página auxiliar possui limite de **4 MiB (4.194.304 bytes)** antes do parse
JSON: `read(limite + 1)` detecta excesso sem carregar o corpo completo. A coleta
acadêmica sem prazo auxiliar mantém `json.load` e o comportamento anterior. Uma
página auxiliar grande falha e preserva a observação anterior; ela não altera
notas ou publicações. O limite por página não certifica sozinho a memória AWS.

Timeouts HTTP usam o menor valor entre 30 segundos e o tempo restante; o cliente
reconfere o prazo após a resposta, inclusive na última página. A persistência
verifica o orçamento antes de iniciar novas linhas. Uma operação de rede/DB já em
voo pode ultrapassar o prazo; esses limites não são garantia de cancelamento
absoluto. Interrupção deixa o marcador conservador, e a próxima tentativa pode
sucedê-lo. Não há repetição automática de escrita.

Medições de 23/10/2026, HTTP controlado e `MemoryRepository`, macOS ARM64,
Python 3.12.13 local (a prova do runtime 3.13 é o CI):

| Massa | Consultas acadêmicas existentes¹ | Consultas extras de entregas | Maior item de aluno |
| --- | ---: | ---: | ---: |
| 40 alunos × 80 atividades | 34 | 5 (1 assignments + 4 grupos) | 25.528 bytes |
| 200 × 100 | 203 | 21 (1 + 20) | 31.890 bytes |
| 500 × 200 | 1.007 | 52 (2 + 50) | 63.790 bytes |

¹ Fixture com todas as notas já avaliadas, sem extrapolar para o volume real.
O caminho acadêmico permanece sem alteração. Para 500 × 200, o modo agrupado
examinado usa 50 páginas de alunos em vez das 1.000 páginas da matriz plana a 100
registros; não elimina o volume dos corpos retornados pelo Canvas. O writer mantém
somente uma linha antiga/nova em preparação por vez. A persistência total nessa
massa é 31.898.430 bytes distribuídos em 501 itens, nunca em um item único. A API
de detalhe lê somente o aluno autorizado, não a matriz inteira da turma.

Na maior massa, a maior página HTTP medida possui 1.133.270 bytes, abaixo dos 4 MiB.
O pico de RSS local foi 189.874.176 bytes na primeira coleta e 218.726.400 bytes
com registros anteriores, incluindo o repositório **inteiro em memória** do teste.
Esses resultados demonstram tamanho/fluxo local, não certificam memória, latência
ou conclusão da maior massa no ambiente AWS de 256 MB. Rede lenta ou prazo
insuficiente preservam os valores anteriores com sua proveniência. A instância
Canvas e o token institucional não foram consultados nesta missão; campos omitidos
permanecem desconhecidos, sem inferir permissões a partir da documentação.

Evidências JSON: [canvas-submissions/](evidence/canvas-submissions/).
Reprodução sem rede (valores em cada execução podem variar):

```sh
PYTHONPATH=backend python tests/benchmarks/canvas_submissions.py --students 40 --assignments 80
PYTHONPATH=backend python tests/benchmarks/canvas_submissions.py --students 500 --assignments 200 --existing
```

Os testes ficam em `tests/integration/test_canvas_submissions.py` (decisão,
paginação, falhas, orçamento, concorrência e notas inalteradas) e
`tests/integration/test_canvas_submission_storage.py` (Moto/serialização real).
Eles não entram no pacote compartilhado das Lambdas.

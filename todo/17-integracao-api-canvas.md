# 17 · Importar notas pela API do Canvas

**Status:** 🟨 implementado; falta gravar o token e ligar o agendamento · **Prioridade:** estratégica · **Esforço:** grande · **Área:** instrutor / backend

## Problema
Toda semana o instrutor exporta o CSV manualmente, envia, confere e publica.

## Proposta
- Credencial de API do Canvas (chave de desenvolvedor da instituição ou token de serviço) guardada no Secrets Manager.
- Rota `POST /cohorts/{code}/preview-from-canvas`: busca notas e atividades do curso associado e gera o mesmo snapshot que `parse_csv`.
- Fluxo de revisão igual ao atual. Opcionalmente, criar a prévia automaticamente (agendada no EventBridge) e avisar o instrutor, que só revisa e publica.

## Pré-requisitos
[12](12-configuracao-da-turma-no-backend.md) (curso Canvas por turma) e autorização da instituição para uso da API.

## Teste de viabilidade — 2026-09-24
Feito com um token pessoal de instrutor (somente leitura, nada escrito no Canvas; o token não foi gravado no repositório e deve ser revogado). Comparação estrutural com os CSVs exportados em 14/09, olhando só contagens:

| Item que o `parse_csv` usa | Curso 4436 (BRSAO267) | Curso 4413 (BRSAO257) |
| --- | --- | --- |
| Atividades KC/LAB (`nome (id)` igual ao cabeçalho do CSV) | 163 de 163 | 74 de 74 |
| Alunos (o CSV tem +1, o aluno de teste, que a API não lista) | 59 de 59 | 56 de 56 |
| E-mail (`login_id` = "SIS Login ID") | 59 de 59 | 56 de 56 (o mesmo aluno sem e-mail nos dois) |
| Pontuação máxima (`points_possible`) | todas | todas |
| "Graduated Final Points" | atividade "Graduated" (1 ponto), grupo "Graduated" | idem |
| Notas iguais (pares com nota nos dois; o resto mudou desde 14/09) | 1054 de 1056 | 1805 de 1834 |

- **Endpoints**: `/courses/{id}/assignments`, `/courses/{id}/users?enrollment_type[]=student&include[]=email`, `/courses/{id}/students/submissions?student_ids[]=all&workflow_state=graded`.
- **Filtro `workflow_state=graded`**: seguro. As notas do CSV que ficaram de fora eram todas do aluno de teste; nenhuma submissão tem nota fora do estado "graded" (as "submitted" estão sem nota). Não havia nenhuma atividade dispensada (`excused`) nas duas turmas, então o mapeamento para "EX" **não foi verificado com dado real**.
- **Tempo**: sem filtro, 4436 levou 112 chamadas e 88 s (10.800 submissões, 88% "não entregue"). Com o filtro, as notas saem em 15 chamadas e 10 s (4436) ou 15 s (4413). O endpoint usa paginação por marcador (sem `rel="last"`), então paralelizar por página não funciona; o caminho é dividir os alunos em grupos (`student_ids[]=...`) em paralelo, ou rodar a busca de forma assíncrona. O limite do API Gateway é 29 s.

## Decisões do titular (2026-09-24)
- **Publicação automática, sem revisão humana**, em todas as turmas que ligarem a opção. Recomendei gerar só a prévia (ou publicar sozinho apenas quando nada estrutural mudasse); o titular optou por publicar tudo. Consequência aceita: a seleção de atividades liberadas é a regra automática (as já liberadas + as com 5 ou mais notas) e alunos removidos no Canvas saem da publicação sem confirmação.
- **Token pessoal de instrutor por enquanto**, com alarme. Trocar por credencial institucional depois é só atualizar o valor do segredo.
- **Frequência**: às 6h e às 18h (Brasília).

## O que foi feito
- `backend/canvas.py`: cliente da API (paginação por `Link`, tenta de novo 429/5xx, mensagens claras para 401/403/404) e `course_csv()`, que monta o **mesmo CSV da exportação do Canvas** a partir da API. Assim, `parse_csv` aplica exatamente as regras do fluxo manual. Notas dispensadas viram `EX`; a atividade "Graduated" vira a coluna "Graduated Final Points".
- `backend/portal.py` (`sync_from_canvas`): gera a prévia e publica como um usuário de sistema (`system:canvas-sync`), com `updateKind = "canvas"`. Proteções contra falha técnica, não contra a decisão acima:
  - não publica se nada mudou (duas publicações idênticas por dia encheriam o histórico do aluno, que mostra as últimas 12);
  - não publica se o Canvas devolver a turma vazia ou com menos de 80% dos alunos da publicação atual (mais provável falha da API do que evasão) — registra a falha e aciona o alarme.
  - O resultado de cada execução fica em `COHORT#<code>/SYNC`.
- `backend/canvas_sync.py`: handler agendado; lê o token no Secrets Manager (texto puro ou `{"token": "..."}`), processa só turmas com `autoSync` e `canvasCourseId`, isola a falha de uma turma das outras e termina com erro se alguma falhou.
- `infra/terraform/canvas-sync.tf`: segredo (criado **vazio**), Lambda com papel mínimo (tabela, `cohorts/*` do bucket de importações e só este segredo), EventBridge Scheduler `cron(0 6,18 * * ? *)` em `America/Sao_Paulo` (**desligado** por padrão: `canvas_sync_enabled`), tópico SNS `alerts` com assinatura de e-mail opcional (`alert_email`) e alarme no CloudWatch para qualquer erro da Lambda.
- Frontend: caixa "Atualizar e publicar as notas automaticamente pelo Canvas" nas configurações da turma (exige o ID do curso); a linha "Última atualização das notas" diz quando as notas vieram do Canvas; o instrutor vê a última verificação e, se falhou, o motivo.
- O envio manual de CSV continua funcionando como alternativa.
- Testes: `backend/test_canvas.py` (montagem do CSV com paginação, EX e graduado; erros de token; publica/ignora/publica; turma vazia ou encolhida; só turmas com a opção; falha isolada), `tests/integration/test_aws.py` (handler de ponta a ponta com Secrets Manager, DynamoDB e S3 do Moto, inclusive segredo sem valor) e os testes de navegador de configurações e da linha de atualização.

## Para ativar
1. Revogar o token usado no teste de viabilidade e gerar outro no Canvas.
2. Gravar o token novo no segredo `restart-portal-prod-canvas-token` pelo Console da AWS (Secrets Manager → Retrieve secret value → Set secret value), sem colar em arquivo ou chat.
3. Em `infra/terraform/terraform.tfvars`: `canvas_sync_enabled = true` e `alert_email = "..."`; `terraform apply`; confirmar a assinatura recebida por e-mail.
4. Em "Turmas e acessos" → Configurações de cada turma: preencher o ID do curso (BRSA0267 → 4436, BRSA0257 → 4413) e ligar a atualização automática.

## Limitação conhecida
- Token pessoal expira em 22/12/2026; quando isso acontecer, a atualização falha (alarme) e as notas param na última publicação até o segredo ser atualizado.
- Turmas de cursos novos continuam sem links e módulos até a parte 2 da [12](12-configuracao-da-turma-no-backend.md).

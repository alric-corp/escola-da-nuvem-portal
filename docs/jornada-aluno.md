# Jornada do aluno

## 1. Primeiro acesso

1. O aluno abre o portal e vê a página de entrada (`frontend/pages/landing.js`), que orienta a criar a conta **com o mesmo e-mail do Canvas**.
2. **Entrar no meu portal** redireciona para o Cognito Managed Login (pt-BR), onde o aluno cria a conta e confirma o código recebido por e-mail.
   - Se a confirmação ficou pela metade (a tela foi fechada, o código expirou ou não chegou), **Confirmar cadastro**, na página de entrada, retoma o processo: e-mail → **Enviar código** → código recebido → **Confirmar** → **Fazer login**. Um novo código pode ser pedido a cada minuto, e a mensagem depois do envio é a mesma para qualquer conta, para não revelar quem tem cadastro.
3. De volta ao portal, `callback()` (`frontend/auth.js`) troca o código por tokens e `boot()` (`frontend/app.js`) chama:
   - `GET /me`, que devolve o papel `student` quando não há vínculo de instrutor;
   - `GET /cohorts`, que percorre as turmas e, em cada uma com publicação, procura o aluno no snapshot atual: primeiro pelo vínculo `STUDY#` e, sem vínculo, pelo e-mail.
4. **Se nenhuma turma for encontrada**, a tela "Primeiro acesso" pede para conferir o e-mail, oferece **Verificar novamente** e **Entrar com outra conta**, e orienta a procurar o instrutor.

## 2. Vínculo da matrícula

Na primeira chamada a `GET /cohorts/{code}/report`, `Portal.student(bind=True)` grava numa única transação:

- `COHORT#<code> / OWNER#<canvasId>` → `{userId}`
- `USER#<sub> / STUDY#<code>` → `{canvasId}`

A partir daí, o aluno é identificado pelo **ID Canvas**, não pelo e-mail. Se outra conta tentar usar o mesmo e-mail, `OWNER#` bloqueia. Um administrador pode desfazer um vínculo incorreto pela seção de alunos vinculados, em “Turmas e acessos”; o backend remove OWNER#/STUDY# em transação e registra auditoria (veja [TODO 11 concluído](todo/concluido/11-admin-vinculos-e-nomes.md)).

## 3. Meu desempenho (`frontend/pages/student.js` → `studentPage`)

| Bloco | Origem |
| --- | --- |
| Data da última atualização e **Consultar atualização** | `updatedAt` da turma. Diferencia publicação de restauração. |
| **Seu resumo**: com nota, sem nota, para revisar e o anel de progresso | `summary()` (backend) e `needsReview()` (frontend) |
| **Por onde começar** | `nextActivities()` em `frontend/student-journey.js` mostra até 3 sugestões automáticas: primeiro as sem nota, depois as de revisão, priorizando as liberadas mais recentemente. Sem data, preserva a ordem da publicação. Seleções antigas de foco não alteram as sugestões. |
| Situação (selo) e **Como interpretar minhas notas?** | `status`: `ok`, `attention`, `critical`, `graduated` ou `insufficient` |
| Métricas: média KC, média LAB, com nota, sem nota | `summary()` |
| **O que mudou nas suas notas** | `history[current].changes` (`student_changes`) |
| **Seu aprendizado evolui** | Média total das últimas 8 publicações |

## 4. Minhas atividades (`activitiesPage`)

- As atividades são agrupadas por **módulo** (`groupActivities`), na ordem do curso. Nome e ordem do módulo vêm do backend, pelo catálogo lido da API do Canvas ([TODO 12](todo/concluido/12-configuracao-da-turma-no-backend.md)). Sem catálogo, todas caem em "Outras atividades".
- Filtros combináveis:
  - situação: todas, sem nota, revisar, com nota, não liberadas, dispensadas;
  - tipo: KC ou LAB;
  - módulo;
  - busca por texto, que ignora acentos.
- Os botões de atalho de "Meu desempenho" abrem esta tela já filtrada.
- Os links "Abrir no Canvas" estão **ativos** desde 24/09/2026 (`canvasLinksEnabled = true` em `frontend/ui.js`) para as atividades que têm item de módulo no catálogo do curso da turma (`canvasUrl`, validado em `frontend/canvas-links.js`). Ativado sem a validação com conta real de aluno recomendada anteriormente — ver [TODO 02](todo/concluido/02-ativar-links-canvas.md).

## 5. Meu histórico (`historyPage`)

O histórico mostra as últimas 12 publicações, sempre incluindo a atual. Para cada uma: médias de KC e LAB, diferença em pontos percentuais em relação à versão base, variação no número de pendências e a lista de atividades que mudaram.

## 6. Sessão

- O access token é renovado automaticamente com o refresh token.
- A turma, a tela e os filtros ficam em `localStorage`, associados ao e-mail da conta.
- Se a sessão expira, o aluno volta para a página de entrada com o aviso "Sua sessão expirou".

## O que o aluno **não** tem hoje

- Aviso de que há notas novas: ele precisa entrar no portal para descobrir.
- Correção do próprio vínculo ou do nome de exibição.

# Contexto para continuidade — Student Performance Analyzer

Atualizado em 24/09/2026. Ambiente publicado: `prod`, região `us-east-1`.

## Objetivo do produto

Portal privado da Escola da Nuvem para alunos consultarem apenas as próprias notas e para instrutores importarem CSVs do Canvas, conferirem mudanças, publicarem notas e enviarem lembretes individuais.

Turmas confirmadas:

- `BRSA0267` → curso Canvas `4436` → AWS re/Start 1, com Linux, Redes, Python e demais módulos técnicos.
- `BRSA0257` → curso Canvas `4413` → AWS re/Start 2.

## O que foi publicado nesta entrega

### Jornada do aluno

- Início com resumo compacto: atividades com nota, sem nota e para revisar.
- Bloco “Por onde começar” com até três próximos passos.
- Separação entre “Sem nota” e “Revisar resultados”.
- Revisão usa KCs abaixo de `70%` e LABs abaixo de `95%`.
- Nota zero registrada entra em revisão; não é confundida com ausência de nota.
- Atividades dispensadas e não liberadas ficam fora da revisão.
- Lista “Minhas atividades” agrupada por módulo, com seções expansíveis.
- Filtros combináveis por tipo, situação, módulo e texto.
- Busca tolera diferenças de acentuação.
- Itens sem classificação ficam em “Outras atividades”.

### Foco definido pelo instrutor

- Instrutor ou administrador pode escolher até três atividades liberadas para destacar para a turma.
- O aluno vê apenas as atividades indicadas que ainda estão sem nota ou precisam de revisão.
- A seleção usa controle de versão e publicação atual para evitar sobrescrever alterações concorrentes.
- O foco é salvo no DynamoDB em `COHORT#<código>` / `FOCUS`.
- O foco não altera médias, notas, publicação ou data de atualização.

Nova rota autenticada:

`POST /cohorts/{code}/focus-activities`

### Catálogo Canvas

- BRSA0257: `75/75` atividades com link.
- BRSA0267: `166/166` atividades com link.
- Os links continuam deliberadamente pausados no frontend por `canvasLinksEnabled = false`.
- Os catálogos ficam em `frontend/canvas-links.js`.

### E-mails e lembretes

- Lambda principal atualizada.
- Lembretes habilitados na infraestrutura (`REMINDERS_ENABLED=true`).
- Instrutor precisa confirmar individualmente o próprio remetente institucional.
- SNS, SES configuration set e Lambda de eventos de entrega foram criados.
- Status de entrega, atraso, bounce, complaint e reject são registrados para consulta.

## Infraestrutura publicada

- Portal: https://d2bx9t870lzfvc.cloudfront.net
- CloudFront distribution: `E3LDQGCHVIV9OK`
- API: `https://y7e0g48k4d.execute-api.us-east-1.amazonaws.com`
- User Pool Cognito: `us-east-1_LUKZ5lBuw`
- Tabela DynamoDB: `restart-portal-prod`
- Bucket frontend: `restart-portal-prod-712107929769-us-east-1-web`
- Bucket de imports: `restart-portal-prod-712107929769-us-east-1-imports`
- Lambda principal: `restart-portal-prod-identity`
- Lambda de eventos: `restart-portal-prod-reminder-events`

## Publicação confirmada

Terraform aplicado com:

- `11 added`
- `1 changed`
- `2 destroyed`

As duas rotas antigas de privacidade foram removidas porque a tela de visibilidade dos alunos deixou de existir. A nova rota de foco foi criada.

Frontend publicado por `scripts/deploy_frontend.sh`.

Invalidação CloudFront:

- ID: `IEN0ONL8K7I44FLLS8XZJNK5RH`
- Status: `Completed`
- Caminho: `/*`

O domínio respondeu `HTTP 200`, com o bundle que contém `student-journey.js`, “Seu resumo” e “Por onde começar”. O plano Terraform posterior retornou `No changes`.

## Validações executadas

- Testes Python do backend: `76` passaram.
- Testes de integração AWS/Moto: `11` passaram.
- Testes JavaScript de jornada, links e autenticação: `16` passaram no conjunto principal.
- Testes de navegador de jornada: passaram.
- Testes de navegador geral: passaram.
- Testes de navegador dos links Canvas: passaram.
- `terraform validate`: passou.
- `terraform fmt -check`: passou.
- `git diff --check`: passou.

Os testes de navegador usam API simulada e não substituem um login real com aluno e instrutor.

## Próximas verificações recomendadas

1. Entrar com uma conta real de aluno e confirmar a nova organização de “Meu desempenho” e “Minhas atividades”.
2. Entrar com instrutor vinculado, abrir “Foco da turma”, salvar uma ou duas atividades e confirmar a visão do aluno.
3. Confirmar o remetente de um instrutor em “Lembretes” e enviar um lembrete para uma conta de teste.
4. Conferir o status do lembrete após entrega ou bounce.
5. Só depois desses testes considerar mudar `canvasLinksEnabled` para `true`.

## Cuidados para a próxima IA

- Não publicar a raiz do repositório no S3; usar apenas `frontend/dist`.
- Não habilitar os links Canvas sem validar permissões reais nos dois cursos.
- Não remover alunos, publicações, snapshots ou usuários sem pedido explícito.
- Atualizações de notas continuam sendo feitas dentro do portal por CSV; não editar os CSVs locais para alterar produção.
- Antes de qualquer mudança AWS, rodar `terraform -chdir=infra/terraform plan` e revisar destruições.
- Para mudança somente de frontend, usar `./scripts/deploy_frontend.sh`, que também invalida o CloudFront.
- O estado Terraform usa backend S3 com lock; nunca usar `-lock=false` sem investigar um lock ativo.

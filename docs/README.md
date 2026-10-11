# Documentação do portal

Descrição do funcionamento atual do portal Escola da Nuvem · AWS re/Start (`frontend/` + `backend/` + `infra/`).

## Documentação ativa

| Documento | Conteúdo |
| --- | --- |
| [arquitetura.md](arquitetura.md) | Componentes AWS, rotas da API, modelo de dados, autorização e módulos do frontend |
| [jornada-aluno.md](jornada-aluno.md) | Do primeiro acesso à consulta de notas e histórico |
| [jornada-instrutor.md](jornada-instrutor.md) | Acesso, rotina semanal de publicação, foco da turma e lembretes |
| [jornada-admin.md](jornada-admin.md) | Criação de turmas, aprovação de instrutores e operações manuais |
| [regras-de-notas.md](regras-de-notas.md) | Importação do CSV, cálculo de médias, situação e revisão |
| [canvas-materiais-complementares.md](canvas-materiais-complementares.md) | Materiais complementares do curso 4413 (BRSA0257), fora do gradebook |

Guias já existentes, mantidos nos locais originais:

- [frontend/README.md](../frontend/README.md): execução local, demonstração e testes.
- [infra/README.md](../infra/README.md) e [infra/DEPLOYMENT.md](../infra/DEPLOYMENT.md): implantação.
- [infra/SES.md](../infra/SES.md): e-mail e lembretes.

Tarefas parciais e pendentes ficam em [todo/](todo/README.md).
Os históricos concluídos e o mapa de implementação estão em
[todo/concluido/](todo/concluido/README.md).

## Operação e histórico

| Documento | Conteúdo |
| --- | --- |
| [auto-5.md](auto-5.md) | AUTO-5, em andamento: ativação controlada dos lembretes automáticos |
| [auto-2.1.md](auto-2.1.md), [auto-2.2.md](auto-2.2.md), [auto-2.3.md](auto-2.3.md), [auto-4.md](auto-4.md), [auto-5-claim.md](auto-5-claim.md) | Registros de entrega da automação de lembretes, concluídos; permanecem aqui por ora |
| [historico/api-1.md](historico/api-1.md), [historico/api-2.md](historico/api-2.md) | API-1 (caracterização OpenAPI) e API-2 (OpenAPI como fonte das rotas Terraform), concluídas |

Relatos antigos de sessão e deploy removidos desta árvore permanecem no
histórico Git.

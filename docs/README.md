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

Tarefas planejadas ficam em [../todo/](../todo/README.md).

## Registros de deploy

Implantações específicas, com versões, verificações e decisões — ver [docs/deploys/](deploys/).

| Registro | Conteúdo |
| --- | --- |
| [DEPLOY-BACKEND-C7.2-2026-10-02.md](deploys/DEPLOY-BACKEND-C7.2-2026-10-02.md) | Backend da C7.2 (participação): pacote, plano direcionado, smoke e Canvas Sync de fechamento |

## Histórico / Arquivo

Investigações e registros de contexto de um momento específico, superados pela integração atual com a API do Canvas ou por rodadas posteriores. Preservados como referência, não como instrução operacional atual — ver [docs/archive/](archive/).

# Documentação do portal

Descrição do funcionamento atual do portal Escola da Nuvem · AWS re/Start (`frontend/` + `backend/` + `infra/`).

## Produto

| Documento | Conteúdo |
| --- | --- |
| [jornada-aluno.md](jornada-aluno.md) | Do primeiro acesso à consulta de notas e histórico |
| [jornada-instrutor.md](jornada-instrutor.md) | Acesso, sincronização/importação de notas, foco da turma e lembretes |
| [jornada-admin.md](jornada-admin.md) | Criação de turmas, aprovação de instrutores e operações manuais |
| [regras-de-notas.md](regras-de-notas.md) | Importação do CSV, cálculo de médias, situação e revisão |
| [canvas-materiais-complementares.md](canvas-materiais-complementares.md) | Materiais complementares do curso 4413 (BRSA0257), fora do gradebook |

## Engenharia

| Documento | Conteúdo |
| --- | --- |
| [arquitetura.md](arquitetura.md) | Componentes AWS, rotas da API, modelo de dados, autorização e módulos do frontend |
| [design-visual.md](design-visual.md) | Direção visual do portal (cor por papel, tipografia, tokens, componentes, casca global) e registro das rodadas do redesign integrado à `main` pelo PR #3 |

## Guias dos componentes

Ficam nos diretórios de cada componente:

- [frontend/README.md](../frontend/README.md): execução local, demonstração e testes do frontend.
- [tests/README.md](../tests/README.md): índice das suítes, comandos, contratos e mutações.
- [infra/README.md](../infra/README.md): implantação separada de backend/infraestrutura. [infra/DEPLOYMENT.md](../infra/DEPLOYMENT.md) preserva o histórico datado de implantações, não o procedimento vigente.
- [infra/FRONTEND-RELEASES.md](../infra/FRONTEND-RELEASES.md): releases do frontend pelo GitHub Actions (pipeline ativa: CI do PR, push na main com prova da árvore testada, publicação/ativação automática, operações manuais e rollback).
- [infra/SES.md](../infra/SES.md): e-mail e lembretes.

## Backlog

Tarefas parciais e pendentes ficam em [todo/](todo/README.md).
Os históricos concluídos e o mapa de implementação estão em
[todo/concluido/](todo/concluido/README.md).
Propostas fora do planejamento atual ficam em
[todo/despriorizado/](todo/despriorizado/README.md).

## Histórico

Registros de entregas e operações concluídas. Eles são preservados como foram escritos: estados, contagens e caminhos citados dentro deles refletem a data de cada registro. Os seis registros AUTO estão em `historico/automacoes/` desde 18/10/2026; antes ficavam na raiz de `docs/`.

| Documento | Conteúdo |
| --- | --- |
| [historico/automacoes/auto-5.md](historico/automacoes/auto-5.md) | AUTO-5 concluída: pilotos manuais/naturais aprovados, recorrência terça/sexta nas duas turmas e 95 envios/95 entregas preservados |
| [auto-2.1.md](historico/automacoes/auto-2.1.md), [auto-2.2.md](historico/automacoes/auto-2.2.md), [auto-2.3.md](historico/automacoes/auto-2.3.md), [auto-4.md](historico/automacoes/auto-4.md), [auto-5-claim.md](historico/automacoes/auto-5-claim.md) | Registros de entrega da automação de lembretes, concluídos |
| [historico/api-1.md](historico/api-1.md), [historico/api-2.md](historico/api-2.md) | API-1 (caracterização OpenAPI) e API-2 (OpenAPI como fonte das rotas Terraform), concluídas |

Relatos antigos de sessão e deploy removidos desta árvore permanecem no
histórico Git.

# 17 · Importar notas pela API do Canvas

**Prioridade:** estratégica · **Esforço:** grande · **Área:** instrutor / backend

## Problema
Toda semana o instrutor exporta o CSV manualmente, envia, confere e publica.

## Proposta
- Credencial de API do Canvas (chave de desenvolvedor da instituição ou token de serviço) guardada no Secrets Manager.
- Rota `POST /cohorts/{code}/preview-from-canvas`: busca notas e atividades do curso associado e gera o mesmo snapshot que `parse_csv`.
- Fluxo de revisão igual ao atual. Opcionalmente, criar a prévia automaticamente (agendada no EventBridge) e avisar o instrutor, que só revisa e publica.

## Pré-requisitos
[12](12-configuracao-da-turma-no-backend.md) (curso Canvas por turma) e autorização da instituição para uso da API.

# 13 · Política de retenção de rascunhos e arquivos

**Prioridade:** baixa · **Esforço:** pequeno · **Área:** infra / backend

## Problema
Cada **Conferir arquivo** grava `source.csv`, `snapshot.json` e `DRAFT#`. Rascunhos nunca publicados não são apagados. O bucket tem versionamento, o que multiplica o armazenamento.

## Proposta
- Separar o prefixo dos rascunhos (por exemplo `drafts/`) do das publicações, ou marcar os objetos com tags.
- Regra de ciclo de vida no S3: apagar rascunhos não publicados após 30 dias e versões não correntes após N dias.
- TTL no DynamoDB para `DRAFT#` não publicados.
- Definir com a coordenação por quanto tempo publicações e CSVs originais devem ser guardados (dados pessoais).

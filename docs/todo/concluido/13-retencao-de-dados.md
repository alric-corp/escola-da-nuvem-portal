# 13 · Política de retenção de rascunhos e arquivos

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída (prazos definidos pelo titular em 2026-09-24) · **Prioridade:** baixa · **Esforço:** pequeno · **Área:** infra / backend

## Problema
Cada **Conferir arquivo** grava `source.csv`, `snapshot.json` e `DRAFT#`. Rascunhos nunca publicados não são apagados. O bucket tem versionamento, o que multiplica o armazenamento.

## Proposta
- Separar o prefixo dos rascunhos (por exemplo `drafts/`) do das publicações, ou marcar os objetos com tags.
- Regra de ciclo de vida no S3: apagar rascunhos não publicados após 30 dias e versões não correntes após N dias.
- TTL no DynamoDB para `DRAFT#` não publicados.
- Definir com a coordenação por quanto tempo publicações e CSVs originais devem ser guardados (dados pessoais).

## Decisão
Rascunhos (prévias nunca publicadas) expiram em **30 dias**; versões não correntes do bucket de importações, em **90 dias**. Publicações e seus CSVs originais **não expiram** (o histórico dos alunos depende deles).

## O que foi feito
- **S3** (`infra/terraform/storage.tf`, `aws_s3_bucket_lifecycle_configuration.imports`): a prévia grava `source.csv` e `snapshot.json` com a tag `portal-status=draft`; ao publicar, o backend troca para `published` **antes** de efetivar a publicação (se algo falhar depois, o arquivo só fica guardado a mais; nunca o contrário). Regras: objetos `draft` expiram em 30 dias e a versão não corrente deles em 1 dia; qualquer versão não corrente expira em 90 dias; marcadores de exclusão órfãos e uploads incompletos são limpos.
- **DynamoDB**: TTL no atributo `expiresAt`. `DRAFT#` gravado na prévia expira em 30 dias; a publicação regrava o item sem esse atributo.
- **Salvaguarda**: publicar uma prévia com 29 dias ou mais é recusado ("Esta prévia expirou…"), para nunca ler um arquivo já apagado pela regra do S3.
- Lambda ganhou `s3:PutObjectTagging` em `cohorts/*`.
- Testes: `backend/test_portal.py` (tags, TTL, prévia vencida), `tests/integration/test_aws.py` (tag e `expiresAt` reais via Moto), `infra/terraform/tests` (TTL e regras de ciclo de vida).

## Limitação
Arquivos e `DRAFT#` gravados **antes** desta mudança não têm tag nem TTL, então as regras não os alcançam. Rascunhos antigos não publicados (com dados pessoais) continuam guardados até uma limpeza pontual, que não foi feita.

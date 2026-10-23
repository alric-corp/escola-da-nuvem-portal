# Descoberta e histórico derivados (proposta e implementação)

Referência da alteração: main `142d4fa2150cece27cdc65a29f6b358dd3d9c6c3`.

A tabela existente continua sendo a fonte canônica de turmas, publicações e
vínculos. Não é necessário GSI: as projeções usam partições próprias e Query
com leitura consistente, evitando a consistência eventual de um índice.

- `COHORT_DIRECTORY/COHORT#<code>` enumera códigos para administração e jobs.
- `DISCOVERY_EMAIL#<sha256-email>/COHORT#<code>` aponta candidatos pertinentes
  ao e-mail normalizado; o hash é dado sensível derivado, não anonimização.
  Um candidato não concede acesso: a publicação atual, o aluno e OWNER são
  conferidos novamente. STUDY/TEACH continuam canônicos.
- `COHORT#<code>/RECENT#<instante UTC>#<desempate>` aponta para PUB existente.
  O leitor busca só as últimas doze e inclui a corrente antiga, como antes.

Candidatos são um conjunto seguro de possibilidades: entradas antigas podem
permanecer após remoção/correção, mas não passam pela autorização canônica.
Cada e-mail/turma ocupa uma entrada, independentemente do número de publicações.
A preparação grava todos os candidatos antes do CAS da publicação corrente;
uma falha parcial deixa apenas candidatos inofensivos e não ativa publicação.
Não há transação contendo centenas de alunos. O diretório e a referência
cronológica entram na mesma pequena transação dos writers reais.

O caminho legado permanece explícito até preparação e cutover administrativos.
Nenhum backfill acontece em login/cold start nem no deploy do frontend.
A migração é dry-run por padrão, idempotente e retomável por turma. Ela valida
a revisão canônica antes de marcar a projeção pronta; concorrência causa recusa
e permite nova execução. Descoberta e histórico têm cutovers independentes.
O fechamento operacional do TODO05 depende da migração real, não executada neste PR.

## Acessos e writers

| Caminho | Manutenção / validação |
| --- | --- |
| `POST /cohorts` | Turma, diretório, revisão de criação e histórico vazio pronto na mesma transação. |
| Publicação manual e `canvas_sync` | Ambos chamam `Portal._publish`: candidatos completos antes do CAS; PUB, referência RECENT, contagem e diretório na transação da publicação. |
| Restore | Reconstrói candidatos do snapshot restaurado antes do CAS; não cria uma nova PUB nem muda `publishedAt` histórico. |
| Configuração | Continua alterando a turma canônica; código imutável, diretório contém somente código. A troca de curso não transforma matrícula Canvas em autorização. |
| Aprovação/revogação TEACH | Os dois vínculos canônicos continuam transacionais. Query de TEACH participa da união; revogação não depende de índice eventual. |
| OWNER/STUDY, unlink e correção | Permanecem canônicos. Candidato por e-mail sempre confere snapshot vigente e OWNER; e-mail anterior pode encontrar candidato, mas não encontra o aluno. Vínculo preexistente mantém o comportamento anterior; o relatório continua exigindo o aluno na publicação atual. |
| Seed Terraform | Item inicial legado continua inalterado; a reconciliação administrativa inclui esse item antes do cutover. Uma instalação nova também precisa executar a preparação explícita. |

A alternativa de apenas STUDY/TEACH perderia primeiro acesso e turmas adicionais.
Um diretório global lido por cada aluno teria outro nome, mas o mesmo problema.
O diretório é usado somente para enumeração administrativa/jobs; alunos consultam
seu e-mail e seus vínculos. GSI não é necessário para esses acessos e acrescentaria
consistência eventual, manutenção HCL e custo sem benefício demonstrado aqui.

## Histórico

RECENT ordena pelo instante efetivo UTC; em empates, mantém ID ascendente, como
o sort estável antigo sobre Query de PUB# ascendente. A chave inclui o ID
original codificado em ordem inversa, inclusive terminador para IDs prefixados.
PUB e timestamps não são reescritos. Cada referência devolvida é resolvida por
GetItem consistente do PUB canônico, preservando metadados e o fallback de
resumo compacto/legado. A contagem pronta detecta partição truncada quando
ela não consegue atender `min(12, count)`; uma publicação que concorra entre a
leitura do marcador e a Query pode acrescentar referências válidas (sempre no
máximo 12), sem causar falso conflito. Referência inválida/sem PUB recusa
em vez de produzir ausência inventada. Não se pretende detectar toda corrupção
arbitrária sem leitura completa. O backfill só marca pronto após completar e
condicionar a revisão de origem; os writers passam a manter essa invariável.

O histórico do aluno continua escolhendo as últimas 12 publicações, reservando
um lugar para a corrente antiga. Se o aluno não estiver em alguma dessas
publicações, a resposta pode ter menos itens: não preenche com versões mais
antigas. O histórico completo do instrutor e `Repository.list` não foram limitados.

## Implantação futura (não executada)

Os comandos usam o ambiente autorizado pelo operador, `TABLE_NAME`,
`IMPORTS_BUCKET` e o Python/dependências do backend. Confirmar conta/perfil antes
de uma execução administrativa. Nenhum comando abaixo faz parte do deploy do
frontend ou roda automaticamente.

1. Implantar todos os writers/leitores compatíveis pelo procedimento existente
   do pacote compartilhado das Lambdas (identity e canvas-sync; sem novo recurso).
   Enquanto não houver flags, leitores usam o caminho legado explicitamente.
   Não misturar writers antigos e cutover pronto.
2. Simular sem gravar: `python scripts/migrate_derived_access.py`.
3. Preparar histórico/candidatos: `python scripts/migrate_derived_access.py --apply`.
   Pode retomar turma com `--cohort CODIGO`; cada execução relembra a revisão
   canônica atual, sem certificar um cursor antigo. `--only history` e
   `--only discovery` permitem reconciliações independentes.
4. Conferir todas as unidades sem erro. O critério de completude é: todos os
   candidatos da publicação atual gravados; todas as PUB referenciadas; marker
   por turma condicionado à revisão lida. Se publicação/configuração/restore
   concorrer, há Conflict e a unidade precisa ser reconciliada novamente.
5. Ativar descoberta após reconciliação completa:
   `python scripts/migrate_derived_access.py --apply --cutover-discovery`.
   Esse comando sempre percorre todas as turmas (não aceita `--cohort`); nova
   criação durante a janela altera a revisão de diretório e recusa o cutover.
   Publicações concorrentes pelos writers novos já preparam candidatos antes
   da ativação e não criam uma lacuna entre origem e índice.
6. Verificar `/cohorts` com identidades autorizadas e métricas operacionais;
   somente então registrar TODO05 como encerrado operacionalmente. Não foi
   feita migração/cutover/consulta de produção nesta implementação.

Falha parcial: preservar fontes e projeções, corrigir causa e executar novamente.
Não apagar PUB, metadados nem snapshots. Antes de rollback para writers antigos,
escolher uma janela sem writers em andamento e retornar explicitamente aos leitores legados:
`python scripts/migrate_derived_access.py --disable --apply` (sem `--apply`, apenas
simula). Isso muda readiness, sem apagar dados. Depois do retorno aos writers
novos, reconciliar de novo antes do cutover. Rollback de código sozinho não é
uma estratégia de reconciliação dos índices.

## Evidência e limites

`tests/integration/test_derived_access.py` usa Repository real e Moto com dados
fictícios: primeiro acesso/nova turma/OWNER, roles, revogação, candidato falso,
correção de e-mail, restore, preparação parcial, migração interrompida/retomada,
CAS em criação/publicação concorrentes, paginação (inclusive página vazia com
continuação), classe de 401 alunos, empates, corrente antiga, ausência do aluno,
resumo legado e recuperação sem apagar fonte.

`python scripts/benchmark_derived_access.py --output /tmp/derived-access.json`
reproduz as contagens na mesma massa, com três amostras locais. Os JSONs registram
ambiente, operações, itens examinados/devolvidos, bytes JSON e leituras S3.
Moto não demonstra latência, capacidade consumida nem economia AWS. No histórico
pequeno, os GetItem consistentes adicionais são um custo consciente em troca de
não ler todos os metadados quando o histórico cresce. Na descoberta, o ganho não
é uma redução universal de GetItem: preservar autorização exige releitura canônica.

### Contagens observadas nesta implementação

O [JSON completo](evidence/derived-access/benchmark.json) contém 12 cenários de
descoberta e três tamanhos de histórico, com igualdade de resposta conferida.
Em 50 turmas + 800 itens de outras funções, primeiro acesso sem vínculo:
36 páginas Scan / 892 itens examinados tornam-se zero Scan; leituras S3 de
40 para 21. Para admin, a Query do diretório enumera 50 códigos e resolve as
50 turmas canônicas, sem examinar os 800 itens alheios.

| PUB existentes | Antes: itens PUB lidos / páginas Query | Depois: refs / páginas forçadas / GetItem |
| --- | --- | --- |
| 12 | 12 / 1 | 12 / 3 / 13 |
| 100 | 100 / 4 | 12 / 3 / 13 |
| 1.000 | 1.000 / 40 | 12 / 3 / 13 |

Os 13 GetItem são readiness + 12 PUB canônicas; a consulta geral da página ainda
executa seus demais acessos. Páginas com cinco referências foram forçadas para
provar continuação; não se promete uma única Query nem latência real AWS.

# AUTO-5 — antecipação pontual BRSA0257 para 14/10/2026

O operador antecipou o piloto natural da BRSA0257 de sexta 16/10 para
**quarta 14/10/2026 às 20h America/Sao_Paulo**, após o piloto BRSA0267 de
13/10 passar com 32 envios e 32 entregas.

## Escopo

- BRSA0257: trocar o schedule existente, antes DISABLED e recorrente,
  por **uma ocorrência única** `at(2026-10-14T20:00:00)`, ENABLED.
- Worker: admitir somente o par **BRSA0257 / 2026-10-14T23:00:00Z** além
  do calendário normal de terça/sexta. Não liberar outras quartas-feiras.
- Preservar a janela **20h–20h30**, prova natural do Canvas de 14/10 às 18h,
  publicação/current/metadataVersion, settings, sender readiness, participação
  ACTIVE, dedupe e limites de retry. A exceção não autoriza recuperação manual.
- BRSA0267 mantém seu cron terça/sexta às 20h. Alias manual permanece na
  versão 3 desabilitada; IAM temporário continua revogado.

É uma execução real do Scheduler, com seus placeholders de ocorrência,
executionId e attemptNumber. Não substituir por invoke manual nem reutilizar
a prova ou a população de 13/10. A população autorizada para envio será
calculada pela worker a partir da publicação válida de 14/10.

## Pacote e implantação

A branch parte do commit de produção
`3dc27ab9fb4a419d371abf097d57ec61bbe06fd1`. Os 14 módulos desse commit
coincidem com o ZIP publicado antes desta alteração. Somente
`automatic_reminders.py` muda no pacote proposto; os outros 13 módulos
permanecem idênticos. As alterações C7.4–C7.6 pendentes não fazem parte dele.

O repositório usa o mesmo ZIP em cinco Lambdas. O plano de código deve
portanto atualizar essas cinco funções e o schedule BRSA0257:
**0 add / 6 change / 0 destroy**. Não aplicar ACM, IAM, alias, API Gateway,
frontend, dados ou alterações do schedule BRSA0267.

O full plan com refresh mantém o ACM conhecido como ação adicional. O plano
salvo de implantação usa o isolamento já empregado na AUTO-5: targets
explícitos e `-refresh=false`, condicionado a leitura atual AWS × state.
Reabrir o plano em JSON, validar suas seis ações, conferir os hashes e o
serial do state imediatamente antes do apply. Um plano com ACM deve ser
rejeitado e não aplicado.

Validação local: **310 testes backend no main**, **305 no pacote isolado**,
**84 Moto**, **24 Terraform**, fmt e validate PASS. As regressões novas cobrem
dia/turma exatos, prova natural do mesmo dia, publicação alterada, gates,
janela, WITHDRAWN, dedupe/retry e rejeição pelo caminho manual.

## Acompanhamento e encerramento

Antes das 20h, conferir o SYNC_RUN natural
`SYNC_RUN#2026-10-14T21:00:00Z`: succeeded, catalog/roster succeeded,
grades published ou unchanged, publicação current e metadataVersion iguais,
finishedAt até `2026-10-14T23:00:00Z`. Se a prova falhar, desabilitar
BRSA0257; a worker também recusa a ocorrência sem essa prova válida.

Após as 20h, correlacionar Scheduler, Lambda, claim/AUTO_REMINDER,
REMINDER/SES/deliveries, exclusão WITHDRAWN, dedupe, logs e alarmes.
`sent=0` pode ser correto se o dedupe ou a elegibilidade assim determinarem.
Problema restrito ao piloto: desabilitar BRSA0257. Problema sistêmico:
também fechar o gate automático. Não repetir manualmente.

O schedule `at` não tem recorrência: após a ocorrência, seu estado ENABLED
não significa que haverá novo disparo. Depois do aceite, restaurar o cron
terça/sexta da BRSA0257 em plano separado e remover a exceção datada da
worker em implantação revisada. A exceção expira funcionalmente pela data
e janela exatas, mesmo antes dessa limpeza.

AUTO-5 permanece aberta até o resultado natural da BRSA0257 e as verificações
finais, inclusive full plan sem ações residuais da AUTO-5. Não iniciar AUTO-6.

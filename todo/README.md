# TODO · Melhorias planejadas

Cada arquivo descreve uma tarefa: problema, proposta e critérios de aceite. Quando uma tarefa for concluída, marque-a aqui e atualize a documentação em [../docs/](../docs/README.md).

Legenda de status: ⬜ a fazer · 🟨 em andamento · ✅ concluída

## Prioridade alta

| # | Tarefa | Área | Esforço | Status |
| --- | --- | --- | --- | --- |
| 01 | [Lembrar as atividades liberadas entre importações](01-lembrar-atividades-liberadas.md) | Instrutor | P | ✅ |
| 02 | [Validar e ativar os links para o Canvas](02-ativar-links-canvas.md) | Aluno | P | ✅ |
| 03 | [Tom da situação e explicação da média para o aluno](03-tom-e-media-para-o-aluno.md) | Aluno | P | ✅ |
| 04 | [Remover a chamada ao /oauth2/userInfo em cada requisição](04-email-no-access-token.md) | Backend/Infra | M | ✅ |

## Prioridade média

| # | Tarefa | Área | Esforço | Status |
| --- | --- | --- | --- | --- |
| 05 | [Descobrir as turmas do aluno pelo vínculo, sem scan](05-descoberta-de-turmas-por-vinculo.md) | Backend | M | ✅ |
| 06 | [Relatório do aluno sem reler dezenas de snapshots](06-historico-do-aluno-sem-releitura.md) | Backend | M | ✅ |
| 07 | [Revisar o limite de requisições da API](07-limite-da-api.md) | Infra | P | ✅ |
| 08 | [Enviar lembretes em lote](08-lembretes-em-lote.md) | Instrutor | M | ✅ |
| 09 | [Visão por atividade e escolha do foco a partir dela](09-visao-por-atividade-e-foco.md) | Instrutor | M | ✅ |
| 11 | [Administração de vínculos, nomes e solicitações](11-admin-vinculos-e-nomes.md) | Admin | M | ✅ |
| 12 | [Configuração da turma no backend](12-configuracao-da-turma-no-backend.md) | Backend/Frontend | M | ⬜ |
| 14 | [Integração contínua (GitHub Actions)](14-integracao-continua.md) | Qualidade | P | ✅ |

## Prioridade baixa

| # | Tarefa | Área | Esforço | Status |
| --- | --- | --- | --- | --- |
| 10 | [Detalhe completo do aluno para o instrutor](10-detalhe-do-aluno-para-instrutor.md) | Instrutor | P | ⬜ |
| 13 | [Política de retenção de rascunhos e arquivos](13-retencao-de-dados.md) | Infra | P | ⬜ |
| 15 | [Avisar o aluno quando houver notas novas](15-aviso-de-nova-publicacao.md) | Aluno | M | ⬜ |
| 16 | [Priorizar atividades recentes e melhorar a evolução](16-proximos-passos-e-evolucao.md) | Aluno | P | ⬜ |
| 18 | [Recuperar funções da ferramenta antiga (exportar CSV)](18-exportar-csv.md) | Instrutor | P | ⬜ |
| 19 | [Organização do repositório e robustez do frontend](19-organizacao-e-robustez-do-codigo.md) | Manutenção | P–M | ⬜ |

## Fora da lista original

| # | Tarefa | Área | Esforço | Status |
| --- | --- | --- | --- | --- |
| 20 | [Domínio próprio para o portal (students.escoladanuvem.org)](20-dominio-proprio.md) | Infra | P | 🟨 (aguardando DNS institucional) |

## Estratégica

| # | Tarefa | Área | Esforço | Status |
| --- | --- | --- | --- | --- |
| 17 | [Importar notas pela API do Canvas](17-integracao-api-canvas.md) | Instrutor/Backend | G | ⬜ |

## Dependências

- 17 depende de 12 (curso Canvas associado à turma).
- 02 fica mais simples depois de 12, mas não depende dela.
- 18 (envio por situação) é coberta por 08.

Esforço: P = até 1 dia · M = 2–5 dias · G = mais de 1 semana (estimativas grosseiras).

# TODO · Backlog e histórico de decisões

Cada arquivo descreve uma tarefa: problema, proposta e (quando concluída) o que foi feito, com data. Itens concluídos não são apagados — servem como histórico de decisões e ficam referenciados em [../docs/](../docs/README.md) quando mudam a documentação ativa.

Índice por status. Dentro de cada seção, ordem numérica dos arquivos.

## Concluídos

| # | Tarefa | Área | Esforço |
| --- | --- | --- | --- |
| 01 | [Lembrar as atividades liberadas entre importações](01-lembrar-atividades-liberadas.md) | Instrutor / backend | P |
| 02 | [Validar e ativar os links para o Canvas](02-ativar-links-canvas.md) | Aluno | P |
| 03 | [Tom da situação e explicação da média para o aluno](03-tom-e-media-para-o-aluno.md) | Aluno / frontend | P |
| 04 | [Remover a chamada ao /oauth2/userInfo em cada requisição](04-email-no-access-token.md) | Backend / infra | M |
| 05 | [Descobrir as turmas do aluno pelo vínculo, sem scan](05-descoberta-de-turmas-por-vinculo.md) | Backend | M |
| 06 | [Relatório do aluno sem reler dezenas de snapshots](06-historico-do-aluno-sem-releitura.md) | Backend | M |
| 07 | [Revisar o limite de requisições da API](07-limite-da-api.md) | Infra | P |
| 08 | [Enviar lembretes em lote](08-lembretes-em-lote.md) | Instrutor | M |
| 09 | [Visão por atividade e escolha do foco a partir dela](09-visao-por-atividade-e-foco.md) | Instrutor | M |
| 10 | [Detalhe completo do aluno para o instrutor](10-detalhe-do-aluno-para-instrutor.md) | Instrutor | P |
| 11 | [Administração de vínculos, nomes e solicitações](11-admin-vinculos-e-nomes.md) | Admin | M |
| 12 | [Configuração da turma no backend (curso Canvas, limites, módulos)](12-configuracao-da-turma-no-backend.md) | Backend / frontend | M |
| 13 | [Política de retenção de rascunhos e arquivos](13-retencao-de-dados.md) | Infra / backend | P |
| 14 | [Integração contínua (GitHub Actions)](14-integracao-continua.md) | Qualidade | P |
| 16 | [Priorizar atividades recentes e melhorar a evolução](16-proximos-passos-e-evolucao.md) | Aluno | P |
| 17 | [Importar notas pela API do Canvas](17-integracao-api-canvas.md) | Instrutor / backend | G |
| 18 | [Recuperar funções da ferramenta antiga (exportar CSV)](18-exportar-csv.md) | Instrutor | P |
| 19 | [Organização do repositório e robustez do frontend](19-organizacao-e-robustez-do-codigo.md) | Manutenção | P–M |
| 21 | [Sessão caindo rápido após o login](21-sessao-em-localstorage.md) | Aluno / frontend | P |

17 (integração com a API do Canvas) está em produção desde 24/09: token gravado, sincronização automática às 6h e 18h (`America/Sao_Paulo`).

## Pendentes

Nenhum item pendente sem dependência externa no momento.

## Dependência externa / aguardando terceiros

| # | Tarefa | Área | Esforço | Aguardando |
| --- | --- | --- | --- | --- |
| 15 | [Avisar o aluno quando houver notas novas](15-aviso-de-nova-publicacao.md) | Aluno | M | Decisão da coordenação sobre enviar e-mail ao publicar (2026-09-24). |
| 20 | [Domínio próprio para o portal (students.escoladanuvem.org)](20-dominio-proprio.md) | Infra | P | DNS institucional (código e certificado já prontos; a entrega do DNS é manual, fora do Terraform). |

## Dependências entre tarefas

- 17 dependia de 12 (curso Canvas associado à turma) — ambas concluídas.
- 02 ficou mais simples depois de 12, mas não dependia dela.
- 18 (envio por situação) é coberta por 08.

Esforço: P = até 1 dia · M = 2–5 dias · G = mais de 1 semana (estimativas grosseiras, registradas quando a tarefa foi aberta).

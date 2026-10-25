# 31 · Identificar o programa da turma e adaptar o Guia do curso

**Status:** aberto · **Prioridade:** média · **Área:** aluno / instrutor / conteúdo

## Contexto e evidências — 24/10/2026

O titular confirmou dois programas diferentes:

| Turma no portal | Canvas courseId | Programa confirmado | Contexto informado |
| --- | --- | --- | --- |
| BRSA0257 | 4413 | AWS re/Start 2 | Instrutora Vitória; serviços e operações AWS, IA e NoCode com SharePoint e Power Automate |
| BRSA0267 | 4436 | AWS re/Start 1 | Instrutor Tomas; fundamentos, Linux, redes, segurança, Python e bancos de dados, além de AWS, IA e NoCode |

Na main `9b811cf08f9dd5e1f948c277acbfd237a933567e`, o
[conteúdo do Guia](../../frontend/course-guide-content.js) ainda apresenta uma
orientação única baseada no material re/Start 2 + NoCode. O
[renderer](../../frontend/pages/course-guide.js) usa o mesmo conteúdo para todas
as turmas, com ressalva de aplicabilidade.

Uma consulta autorizada, somente de leitura, confirmou HTTP 200 em
`GET /api/v1/courses/4413` e `/4436`. Os nomes retornados foram
`AWS re/Start BRSAO257` e `AWS re/Start BRSAO267`; `course_code` contém
`BRSAO257` e `BRSAO267`, com letra O, enquanto o portal usa dígito 0.
As respostas consultadas não identificaram re/Start 1/2: ementa vazia,
descrição pública não retornada, conta comum `AWS re/Start` e termo
`Período padrão`. Isso não afirma ausência universal dessa informação em
outros recursos ou integrações do Canvas. A associação dos programas acima
tem como fonte a confirmação do titular, não inferência desses metadados.

## Menor mudança proposta

Registrar explicitamente o programa associado à turma/curso, reutilizando a
configuração existente e um campo aditivo quando necessário. No Guia, mostrar
um bloco discreto “Programa da sua turma” e adaptar a seção de organização do
curso com um resumo dos módulos correspondentes. A troca de turma deve trocar
o conteúdo; o programa não deve ser deduzido do nome do docente, de notas,
de palavras encontradas nas atividades ou de prefixos numéricos do código.

Preservar as informações institucionais compartilhadas quando confirmadas
para os dois programas. Não publicar a grade inteira ou um cronograma novo:
os materiais fornecidos contêm linhas administrativas, atividades e encontros
com granularidades diferentes, além de datas a conferir. Não apresentar a
numeração 1/2 como dificuldade ou sequência obrigatória sem confirmação.

## Critérios de aceite

- [ ] BRSA0257 e BRSA0267 apresentam programa e resumo curricular corretos,
  associados ao courseId/cadastro confirmado, sem confundir letra O e dígito 0.
- [ ] Aluno, instrutor e administrador recebem a identificação da turma
  selecionada; admin em modo aluno preserva a experiência desse modo.
- [ ] Trocar turma, sessão ou modo não mantém conteúdo da turma anterior.
- [ ] Sem turma/programa conhecido, o Guia geral continua acessível, inclusive
  sem publicação ou com relatório acadêmico indisponível.
- [ ] Não altera notas, referências, participação ou o indicador Graduado do
  Canvas. Regras de graduação/voucher/horário não variam por suposição.
- [ ] Frontend e backend anteriores permanecem compatíveis; não exige migração
  para abrir o Guia nem consulta ao Canvas durante a navegação.
- [ ] Testes de conteúdo, navegação, teclado, mobile e contratos abrangem os
  dois programas e a configuração ausente. Acessos PDF/PPT retirados e os
  canais existentes não são restaurados como efeito colateral.

## Limites e dependências

Não criar serviço, tabela, scheduler, novo dashboard ou inferência de progresso
pela grade. Nome de instrutor é contexto informado e pode mudar; não deve
substituir os vínculos de autorização existentes. As [regras editoriais do
Guia](../course-guide.md) continuam aplicáveis. Se houver alteração no cadastro
backend, documentar a implantação separada sem confundir merge frontend com
implantação das Lambdas.

Este documento registra a proposta; a implementação não integra o PR dos
TODOs 28–30.

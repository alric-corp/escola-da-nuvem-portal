# Commits criados pelo Codex

Quando o Codex criar um commit neste repositório, usar a identidade de autor
`Codex <codex@openai.com>`, reconhecida pelo GitHub como `codex`.

Usar a identidade somente no comando do commit:

```sh
git -c user.name=Codex -c user.email=codex@openai.com commit --author='Codex <codex@openai.com>' -m 'mensagem do commit'
```

Preservar a configuração Git pessoal/global do operador. A regra vale para
novos commits criados pelo Codex; não reescrever commits anteriores sem uma
solicitação explícita. Contagens de commits e linhas no Contributors devem
refletir o histórico real publicado na branch padrão.

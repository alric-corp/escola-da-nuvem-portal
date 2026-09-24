# 📊 Desempenho Acadêmico — AWS re/Start

> **Ferramenta original, preservada como referência.** O portal atual está na [raiz do repositório](../README.md). Para usar esta versão, abra `legacy/index.html` no navegador.

**Versão atual:** v1.1.1  
**Última atualização:** 19/05/2026

Sistema web para análise e acompanhamento do desempenho dos alunos do programa AWS re/Start, desenvolvido para facilitar o monitoramento de Knowledge Checks (KCs), Labs e o envio de feedbacks personalizados por e-mail.


## 🚀 Funcionalidades

📁 Upload de CSV exportado diretamente do Canvas LMS

📊 Tabela de desempenho com:

- Barra visual de progresso
- Média Total
- Média de Labs
- Média de KCs

🎯 Cálculo automático de médias por aluno

✅ Regra de atividade ativa

- Um KC/Lab só é considerado caso pelo menos 5 alunos tenham a célula preenchida

🔴🟡🟢🎓 Classificação automática dos alunos:

- Crítico
- Atenção
- OK
- Graduado

🔍 Busca dinâmica por nome ou e-mail

🔃 Ordenação por qualquer coluna

📋 Cópia de mensagem personalizada por aluno

✉️ Envio de e-mail direto pelo Outlook com mensagem pré-preenchida

📧 Envio em massa por status dos alunos

📋 Cópia de desempenho em massa baseada em lista de e-mails

⬇️ Exportação do relatório em CSV

🕓 Histórico dos últimos 5 arquivos carregados

🌙 Dark Mode com persistência via `localStorage`


## 📋 Critérios de Status

| Status          | Critério                              |
| --------------- | ------------------------------------- |
| 🟢 OK           | KC ≥ 70% e Lab ≥ 95%                  |
| 🔴 Crítico      | KC ≤ 69,99% e Lab ≤ 94,99%            |
| 🟡 Atenção      | Apenas um dos critérios foi atingido  |
| 🎓 Graduado     | Coluna `Graduated Final Points` = `1` |


## 📐 Cálculo de Desempenho

### 📘 KCs

Média aritmética de todos os KCs ativos.

### 🧪 Labs

Média dos Labs ativos, normalizada para a escala de 0 a 100%.

### 📊 Total

Média entre:

- KC
- Lab

### ⏳ Pendência

Uma atividade é considerada pendente quando:

- a célula está vazia no CSV.

### ✅ Não pendente

Qualquer valor preenchido é considerado realizado, inclusive:

- `0`
- `0,00`


## 📁 Estrutura do Projeto

```bash
📦 projeto
 ┣ 📄 index.html       # Estrutura da interface
 ┣ 📄 style.css        # Estilos e Dark Mode
 ┣ 📄 app.js           # Lógica principal
 ┣ 📁 assets/
 ┃ ┣ 🖼️ anderson-albuquerque.jpg
 ┃ ┗ 🖼️ brian-richard.jpg
 ┗ 📄 README.md
````


## 🗂️ Formato do CSV Esperado

O arquivo deve ser exportado diretamente do Canvas LMS, sem alterações no Excel.

### Regras do arquivo

Separador: `,` (vírgula)

Valores numéricos:

```text
"100,00"
```

Células vazias:

* aluno não realizou a atividade

A linha:

```text
Points Possible
```

é ignorada automaticamente pelo sistema.


## 📌 Colunas Utilizadas

| Coluna                   | Finalidade                     |
| ------------------------ | ------------------------------ |
| `Student`                | Nome do aluno                  |
| `SIS Login ID`           | E-mail do aluno                |
| `Graduated Final Points` | Indica se o aluno foi graduado |
| `NNN...KC...`            | Knowledge Checks               |
| `NNN...Lab...`           | Laboratórios                   |


## ▶️ Como Utilizar

### 1️⃣ Clone o repositório

```bash
git clone https://github.com/seu-usuario/seu-repositorio.git
```

### 2️⃣ Abra o arquivo `index.html`

Não é necessário servidor web.

O sistema funciona diretamente no navegador.

### 3️⃣ Exporte o CSV do Canvas

No Canvas LMS:

```text
Notas → Exportar → CSV
```

### 4️⃣ Carregue o arquivo CSV

Clique em:

```text
📁 Selecione o arquivo CSV
```

### 5️⃣ Clique em `Processar`

O sistema irá:

* interpretar os dados,
* calcular os desempenhos,
* gerar os status automaticamente.


## 📧 Envio de E-mails

O sistema gera mensagens personalizadas contendo:

* Saudação baseada no horário
* Média de KC
* Média de Lab
* Lista de KCs pendentes
* Lista de Labs pendentes
* Critérios mínimos esperados

Os e-mails são abertos diretamente no Outlook Web com:

* destinatário,
* assunto,
* corpo da mensagem

já preenchidos automaticamente.


## 🛠️ Tecnologias Utilizadas

| Tecnologia        | Finalidade               |
| ----------------- | ------------------------ |
| HTML5             | Estrutura da aplicação   |
| CSS3              | Estilização e Dark Mode  |
| JavaScript (ES6+) | Lógica da aplicação      |
| PapaParse         | Leitura e parsing do CSV |
| Chart.js          | Estrutura de gráficos    |


## 👨‍💻 Desenvolvedores

<table>
  <tr>
    <td align="center">
      <a href="https://www.linkedin.com/in/anderson-garcia-albuquerque/" target="_blank">
        <img src="assets/anderson-albuquerque.jpg" width="90" style="border-radius:50%"><br>
        <strong>Anderson Albuquerque</strong>
      </a>
    </td>

<td align="center">
      <a href="https://www.linkedin.com/in/brianrichard1/" target="_blank">
        <img src="assets/brian-richard.jpg" width="90" style="border-radius:50%"><br>
        <strong>Brian Richard</strong>
      </a>
    </td>
  </tr>
</table>


## 📄 Licença

© 2025–2026 — Todos os direitos reservados.

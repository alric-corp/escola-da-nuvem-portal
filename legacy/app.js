/*
 Projeto: Desempenho Acadêmico — AWS re/Start
 Version: 1.1.1
 Updated: 2026-05-19
*/

let globalData = [];
let currentFilter = "all";
let currentSort = { key: "total", asc: false };

// ===================== DARK MODE =====================
function toggleDarkMode() {
  document.body.classList.toggle("dark");
  localStorage.setItem("darkMode", document.body.classList.contains("dark"));
}

if (localStorage.getItem("darkMode") === "true") {
  document.body.classList.add("dark");
}

// ===================== TOAST =====================
function toast(msg, tipo = "success") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.innerText = msg;
  container.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ===================== UTILITÁRIOS =====================
function normalize(text) {
  if (!text) return "";
  return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function isKC(col) {
  return /^\d+.*kc/.test(normalize(col));
}

function isLab(col) {
  return /^\d+.*lab/.test(normalize(col));
}

function fixEncoding(str) {
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}

function getSaudacao() {
  const hora = new Date().getHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function formatarNomeAtividade(col) {
  let nome = col.replace(/\(\d+\)/g, "").trim();
  const match = nome.match(/^(\d+)(.*)/);

  if (match) {
    const numero = match[1].trim();
    let resto = match[2].trim();
    const tipoMatch = resto.match(/[-\s\[_]*(?:[A-Z]{1,4}[-\s\[_]*)*?(KC|Lab|LAB|kc|lab)(.*)/i);

    if (tipoMatch) {
      const tipo = tipoMatch[1].toUpperCase() === "LAB" ? "Lab" : tipoMatch[1].toUpperCase();
      let titulo = tipoMatch[2].trim();
      titulo = titulo.replace(/^[-\s—–]+/, "").trim();
      titulo = titulo.replace(/\s*-{2,}\s*/g, " - ").trim();
      return `${numero} - ${tipo} - ${titulo}`;
    }

    resto = resto.replace(/^[-\s—–]+/, "").trim();
    return `${numero} - ${resto}`;
  }

  return nome;
}

// ===================== PROGRESSO =====================
function mostrarProgresso(valor) {
  const container = document.getElementById("progresso-container");
  const barra = document.getElementById("progresso");
  container.style.display = "block";
  barra.style.width = valor + "%";
}

function esconderProgresso() {
  setTimeout(() => {
    const container = document.getElementById("progresso-container");
    const barra = document.getElementById("progresso");
    container.style.display = "none";
    barra.style.width = "0%";
  }, 700);
}

// ===================== HISTÓRICO =====================
function salvarHistorico(nomeArquivo) {
  const historico = JSON.parse(localStorage.getItem("historico") || "[]");
  historico.unshift({ arquivo: nomeArquivo, data: new Date().toLocaleString("pt-BR") });
  localStorage.setItem("historico", JSON.stringify(historico.slice(0, 5)));
}

function mostrarHistorico() {
  const historico = JSON.parse(localStorage.getItem("historico") || "[]");
  if (!historico.length) {
    toast("Nenhum arquivo carregado ainda.", "info");
    return;
  }
  const lista = historico.map((h, i) => `${i + 1}. ${h.arquivo} — ${h.data}`).join("\n");
  alert("📂 Histórico de arquivos:\n\n" + lista);
}

// ===================== EXPORTAR CSV =====================
function exportarCSV() {
  if (!globalData.length) {
    toast("Nenhum dado para exportar.", "error");
    return;
  }

  const statusLabel = { green: "OK", red: "Crítico", yellow: "Atenção", graduated: "Graduado" };
  const headers = ["Nome", "Email", "Progresso", "Total", "Lab", "KC", "Status"];

  const rows = globalData.map(row => [
    row.name,
    row.email,
    row.progresso + "%",
    row.total + "%",
    row.lab + "%",
    row.kc + "%",
    statusLabel[getStatus(row)] || ""
  ]);

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${v}"`).join(";"))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "relatorio_atual_dos_alunos.csv";
  a.click();
  URL.revokeObjectURL(url);
  toast("Relatório exportado com sucesso! ✅");
}

// ===================== HANDLE FILE =====================
function handleFile() {
  const file = document.getElementById("fileInput").files[0];

  if (!file) {
    toast("Selecione um arquivo CSV.", "error");
    return;
  }

  document.getElementById("status").innerText = "Processando...";
  mostrarProgresso(30);

  Papa.parse(file, {
    header: true,
    complete: function (results) {
      mostrarProgresso(80);
      globalData = processCSV(results.data);
      renderTable();
      mostrarProgresso(100);
      esconderProgresso();
      salvarHistorico(file.name);
      document.getElementById("status").innerText = "Processamento concluído ✅";
      toast(`${globalData.length} aluno(s) carregado(s) com sucesso!`);
    },
    error: function () {
      esconderProgresso();
      document.getElementById("status").innerText = "Erro ao processar o arquivo.";
      toast("Erro ao processar o arquivo.", "error");
    }
  });
}

// ===================== PROCESSAR CSV =====================
function processCSV(data) {
  const columns = Object.keys(data[0] || {});
  const kcCols  = columns.filter(isKC);
  const labCols = columns.filter(isLab);

  function toNumber(v) {
    if (v === undefined || v === null) return 0;
    const s = v.toString().trim();
    if (s === "") return 0;
    return parseFloat(s.replace(",", ".")) || 0;
  }

  function celulaNaoVazia(row, col) {
    const v = row[col];
    if (v === undefined || v === null) return false;
    return v.toString().trim() !== "";
  }

  data = data.filter(r =>
    !String(Object.values(r)[0]).includes("Points Possible")
  );

  const kcAtivos = kcCols.filter(col =>
    data.filter(row => celulaNaoVazia(row, col)).length >= 5
  );

  const labAtivos = labCols.filter(col =>
    data.filter(row => celulaNaoVazia(row, col)).length >= 5
  );

  const targetColumns = [...kcAtivos, ...labAtivos];

  return data.map(row => {
    let kcSum = 0, kcCount = 0;
    let labSum = 0, labCount = 0;
    const pendencias = [];

    targetColumns.forEach(col => {
      const preenchida = celulaNaoVazia(row, col);
      const val = toNumber(row[col]);

      if (isKC(col)) {
        kcCount++;
        if (!preenchida) {
          pendencias.push(col);
        } else {
          kcSum += val;
        }
      }

      if (isLab(col)) {
        labCount++;
        if (!preenchida) {
          pendencias.push(col);
        } else {
          labSum += val > 1 ? 1 : val;
        }
      }
    });

    const kc    = kcCount  ? kcSum / kcCount          : 0;
    const lab   = labCount ? (labSum / labCount) * 100 : 0;
    const total = (kc + lab) / 2;

    // ===================== CÁLCULO DE PROGRESSO =====================
    const totalAtividades = kcCount + labCount;
    const atividadesFeitas = targetColumns.filter(col => {
      if (!celulaNaoVazia(row, col)) return false;
      if (isLab(col)) return toNumber(row[col]) > 0;
      return true;
    }).length;
    const progresso = totalAtividades > 0
      ? ((atividadesFeitas / totalAtividades) * 100).toFixed(2)
      : "0.00";

    return {
      name:      fixEncoding((row["Student"] || "").split(", ").reverse().join(" ")),
      email:     (row["SIS Login ID"] || "").trim().toLowerCase(),
      kc:        kc.toFixed(2),
      lab:       lab.toFixed(2),
      total:     total.toFixed(2),
      progresso,
      pendencias,
      graduated: toNumber(row["Graduated Final Points"]) === 1
    };
  });
}

// ===================== STATUS =====================
function getStatus(row) {
  if (row.graduated) return "graduated";
  const kc  = parseFloat(row.kc);
  const lab = parseFloat(row.lab);
  if (kc >= 70 && lab >= 95)       return "green";
  if (kc <= 69.99 && lab <= 94.99) return "red";
  return "yellow";
}

// ===================== ORDENAÇÃO =====================
function sortTable(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort = { key, asc: false };
  }
  renderTable();
}

// ===================== FILTROS =====================
function filterTable(status) {
  currentFilter = status;
  renderTable();
}

function searchTable() {
  renderTable();
}

// ===================== RENDER TABLE =====================
function renderTable() {
  const tbody = document.querySelector("#table tbody");
  tbody.innerHTML = "";

  let red = 0, yellow = 0, green = 0, graduated = 0;

  let filtered = globalData.filter(row => {
    const status = getStatus(row);
    return currentFilter === "all" || status === currentFilter;
  });

  const search = document.getElementById("search").value.toLowerCase();
  filtered = filtered.filter(r =>
    r.name.toLowerCase().includes(search) ||
    r.email.toLowerCase().includes(search)
  );

  filtered.sort((a, b) => {
    let valA = a[currentSort.key];
    let valB = b[currentSort.key];
    if (!isNaN(valA)) valA = parseFloat(valA);
    if (!isNaN(valB)) valB = parseFloat(valB);
    if (valA < valB) return currentSort.asc ? -1 : 1;
    if (valA > valB) return currentSort.asc ? 1 : -1;
    return 0;
  });

  globalData.forEach(row => {
    const s = getStatus(row);
    if (s === "red")       red++;
    if (s === "yellow")    yellow++;
    if (s === "green")     green++;
    if (s === "graduated") graduated++;
  });

  filtered.forEach((row, index) => {
    const status  = getStatus(row);
    const msg     = gerarMensagem(row);
    const assunto = "Desempenho atual no curso AWS re/Start";

    const icon =
      status === "graduated" ? "🎓" :
      status === "green"     ? "🟢" :
      status === "yellow"    ? "🟡" : "🔴";

    const barColor =
      status === "graduated" ? "#2563eb" :
      status === "green"     ? "#22c55e" :
      status === "yellow"    ? "#f59e0b" : "#ef4444";

    const tr = document.createElement("tr");
    tr.classList.add(status);

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td class="name-cell" title="${row.name} — ${row.email}">
        ${icon} ${row.name}
      </td>
      <td>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width:${parseFloat(row.progresso)}%;background:${barColor};"></div>
          <span>${row.progresso}%</span>
        </div>
      </td>
      <td>${row.total}%</td>
      <td>${row.lab}%</td>
      <td>${row.kc}%</td>
      <td>
        ${
          status === "graduated"
            ? '<span class="badge graduated">Graduado</span>'
            : status === "green"
            ? '<span class="badge green">OK</span>'
            : status === "yellow"
            ? '<span class="badge yellow">Atenção</span>'
            : '<span class="badge red">Crítico</span>'
        }
      </td>
      <td class="actions-cell">
        <button class="action-btn btn-copiar" title="Copiar mensagem">📋</button>
        <a class="action-btn" target="_blank" title="Enviar e-mail"
          href="https://outlook.office.com/mail/deeplink/compose?to=${row.email}&subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(msg)}">
          ✉️
        </a>
        <button class="action-btn btn-remover" title="Remover aluno">🗑️</button>
      </td>
    `;

    const btnCopiar = tr.querySelector(".btn-copiar");
    btnCopiar.dataset.email = row.email;
    btnCopiar.dataset.msg   = msg;
    btnCopiar.addEventListener("click", function (e) {
      e.stopPropagation();
      copiar(this.dataset.msg, this.dataset.email);
    });

    const btnRemover = tr.querySelector(".btn-remover");
    btnRemover.addEventListener("click", function (e) {
      e.stopPropagation();
      removerAluno(row);
    });

    tr.addEventListener("click", () => toggleDetalhe(tr, row));
    tbody.appendChild(tr);
  });

  const total = globalData.length;
  document.getElementById("count-all").innerText       = `🔎 ${total}`;
  document.getElementById("count-red").innerText       = `🔴 ${red}`;
  document.getElementById("count-yellow").innerText    = `🟡 ${yellow}`;
  document.getElementById("count-green").innerText     = `🟢 ${green}`;
  document.getElementById("count-graduated").innerText = `🎓 ${graduated}`;
}

// ===================== REMOVER ALUNO =====================
function removerAluno(row) {
  const confirmar = confirm(
    `Remover ${row.name} da lista?\n\nEssa ação não pode ser desfeita (a menos que recarregue o CSV).`
  );
  if (!confirmar) return;

  const idx = globalData.indexOf(row);
  if (idx !== -1) {
    globalData.splice(idx, 1);
    renderTable();
    toast("Aluno removido com sucesso! ✅");
  }
}

// ===================== LINHA EXPANSÍVEL =====================
function toggleDetalhe(tr, row) {
  const next = tr.nextSibling;
  if (next && next.classList && next.classList.contains("detalhe-row")) {
    next.remove();
    return;
  }

  const kcPendentes  = row.pendencias.filter(p => isKC(p)).map(formatarNomeAtividade);
  const labPendentes = row.pendencias.filter(p => isLab(p)).map(formatarNomeAtividade);

  const listaKC  = kcPendentes.length  ? kcPendentes.join("<br>")  : "Nenhum pendente";
  const listaLab = labPendentes.length ? labPendentes.join("<br>") : "Nenhum pendente";

  const detalhe = document.createElement("tr");
  detalhe.className = "detalhe-row";
  detalhe.innerHTML = `
    <td colspan="8">
      <div class="detalhe-conteudo">
        <strong>📧 E-mail:</strong> ${row.email}<br><br>
        <strong>📘 KCs pendentes (${kcPendentes.length}):</strong><br>${listaKC}
        <br><br>
        <strong>🧪 Labs pendentes (${labPendentes.length}):</strong><br>${listaLab}
      </div>
    </td>
  `;
  tr.after(detalhe);
}

// ===================== GERAR MENSAGEM =====================
function gerarMensagem(row) {
  const saudacao = getSaudacao();

  const kcPendentes  = row.pendencias.filter(p => isKC(p));
  const labPendentes = row.pendencias.filter(p => isLab(p));

  const listaKC  = kcPendentes.length
    ? kcPendentes.map(item => formatarNomeAtividade(item)).join("\n")
    : "Nenhum pendente";

  const listaLab = labPendentes.length
    ? labPendentes.map(item => formatarNomeAtividade(item)).join("\n")
    : "Nenhum pendente";

  return `${saudacao} ${row.name}, tudo bem com você?

Segue seu desempenho atual nas atividades re/Start:

Na média em KC's você está com ${row.kc}%, e em Lab's está em ${row.lab}%.

Os KCs/Labs pendentes são:

📘 KC (Knowledge Check)
${listaKC}

🧪 Lab (Laboratórios)
${listaLab}

Lembre-se:

1. Conclusão de 100% dos Laboratórios.
2. Pontuação mínima de 70% em KC's.
3. Presença mínima de 80%.

Atenciosamente,`;
}

// ===================== COPIAR =====================
async function copiar(msg, email) {
  try {
    await navigator.clipboard.writeText(msg);
    toast("Mensagem copiada! Abrindo e-mail... ✅");
  } catch {
    toast("Não foi possível copiar automaticamente.", "error");
  }
  window.open(`https://outlook.office.com/mail/deeplink/compose?to=${email}`, "_blank");
}

// ===================== ÁREA DE CÓPIA =====================
function mostrarAreaCopia() {
  const area = document.getElementById("area-copia");
  area.style.display = area.style.display === "none" ? "block" : "none";
}

// ===================== COPIAR DESEMPENHO ORDENADO =====================
function copiarDesempenhoOrdenado() {
  const input  = document.getElementById("lista-emails").value;
  const emails = input.split("\n").map(e => e.trim().toLowerCase()).filter(e => e);

  if (!emails.length) {
    toast("Cole ao menos um e-mail.", "warning");
    return;
  }

  let resultado      = "";
  let encontrados    = 0;
  let naoEncontrados = [];

  emails.forEach(email => {
    const aluno = globalData.find(a => (a.email || "").trim().toLowerCase() === email);
    if (aluno) {
      encontrados++;
      const total = parseFloat(aluno.total).toFixed(1).replace(".", ",") + "%";
      const lab   = parseFloat(aluno.lab).toFixed(1).replace(".", ",")   + "%";
      const kc    = parseFloat(aluno.kc).toFixed(1).replace(".", ",")    + "%";
      resultado += `${total}\t${lab}\t${kc}\n`;
    } else {
      naoEncontrados.push(email);
      resultado += `email não corresponde ao cadastrado no canvas\t\t\n`;
    }
  });

  const temp = document.createElement("textarea");
  temp.value = resultado.trim();
  temp.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);

  if (naoEncontrados.length > 0) {
    console.warn("E-mails não encontrados:", naoEncontrados);
    toast(`⚠️ ${naoEncontrados.length} e-mail(s) não encontrado(s). Veja o console (F12).`, "warning");
  } else {
    toast(`Desempenho copiado! ${encontrados} aluno(s) encontrado(s). ✅`);
  }
}

// ===================== ENVIO EM MASSA =====================
async function enviarParaTodos(status) {
  const alunos = globalData.filter(r => getStatus(r) === status);

  if (!alunos.length) {
    toast("Nenhum aluno nesse status.", "info");
    return;
  }

  const labelMap = {
    red:       "Críticos 🔴",
    yellow:    "Atenção 🟡",
    green:     "OK 🟢",
    graduated: "Graduados 🎓"
  };

  const confirmar = confirm(
    `Deseja abrir e-mail para ${alunos.length} aluno(s) com status "${labelMap[status]}"?\n\nO navegador pode bloquear múltiplos pop-ups.`
  );
  if (!confirmar) return;

  const assunto = "Desempenho atual no curso AWS re/Start";

  for (const aluno of alunos) {
    const msg = gerarMensagem(aluno);
    window.open(
      `https://outlook.office.com/mail/deeplink/compose?to=${aluno.email}` +
      `&subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(msg)}`,
      "_blank"
    );
    await new Promise(r => setTimeout(r, 600));
  }

  toast(`${alunos.length} e-mail(s) aberto(s)! ✅`);
}

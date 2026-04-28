/* =====================================================
   Mais Justiça — SCANNER (SerpAPI Real)
   script-scanner.js
===================================================== */

const API_BASE = "https://mais-justica-api.onrender.com";

let isLoading = false;

let scanButton = null;
let scanResult = null;
let loadingOverlay = null;

/* ================================
   INICIALIZAÇÃO
================================ */
document.addEventListener("DOMContentLoaded", () => {
  scanButton = document.getElementById("scanButton");
  scanResult = document.getElementById("scanResult");
  loadingOverlay = document.getElementById("loadingOverlay");

  if (scanButton && !scanButton.dataset.listenerAdded) {
    scanButton.addEventListener("click", iniciarVarredura);
    scanButton.dataset.listenerAdded = "true";
  }

  configurarMascaraCPF();
  configurarCursorCustom();
});

/* ================================
   FUNÇÃO PRINCIPAL
================================ */
async function iniciarVarredura() {
  if (isLoading) return;

  const nome = document.getElementById("nomeInput")?.value.trim() || "";
  const cpfInputValue = document.getElementById("cpfInput")?.value || "";
  const cpf = cpfInputValue.replace(/\D/g, "");
  const cpfFormatado = formatarCPF(cpf);
  const estado = document.getElementById("estadoInput")?.value.trim() || "";
  const linksRaw = document.getElementById("linksInput")?.value.trim() || "";

  const links = linksRaw
    ? linksRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  if (!scanButton || !scanResult) {
    console.error("Elementos do scanner não encontrados no HTML.");
    alert("Erro interno: elementos do scanner não encontrados.");
    return;
  }

  if (!nome || nome.length < 5) {
    alert("Digite um nome completo válido (mínimo 5 caracteres)");
    return;
  }

  if (cpf && !validarCPF(cpf)) {
    alert("CPF inválido");
    return;
  }

  isLoading = true;

  const cpfStatusTexto = cpf
    ? validarCPF(cpf)
      ? `CPF informado: ${cpfFormatado} — formato válido`
      : `CPF informado: ${cpfFormatado} — inválido`
    : "CPF não informado";

  scanButton.disabled = true;
  scanButton.innerText = "Buscando…";
  ativarLoading();

  scanResult.innerHTML = `
    <div class="scan-progress">
      <p>🔍 Varrendo ${15 + links.length} fonte(s) de dados…</p>
      <p class="scan-sub">Jusbrasil · Escavador · Tribunais · Diários oficiais · Buscadores</p>
      <p class="scan-sub">🔐 ${cpfStatusTexto}</p>
      <p class="scan-eta">Estimativa: 30–60 segundos</p>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nome,
        estado,
        cpf,
        cpfFormatado,
        links,
      }),
    });

    if (!response.ok) {
      throw new Error(`Servidor retornou HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.sucesso === false) {
      throw new Error(data?.error || data?.erro || "Erro desconhecido na API");
    }

    const resultados = Array.isArray(data.resultados)
      ? data.resultados
      : Array.isArray(data.dados)
      ? data.dados
      : [];

    renderResultados(resultados, nome, cpfFormatado);
  } catch (err) {
    console.error("Erro na varredura:", err);

    scanResult.innerHTML = `
      <div class="scan-error">
        <h3>⚠ Erro ao realizar a varredura</h3>
        <p>${escapeHtml(err.message)}</p>
        <p class="scan-sub">
          Verifique se o servidor está rodando em
          <strong>${escapeHtml(API_BASE)}</strong>
          e se a <strong>SERPAPI_KEY</strong> está configurada no <code>.env</code>.
        </p>
      </div>
    `;
  } finally {
    desativarLoading();
    scanButton.disabled = false;
    scanButton.innerText = "Iniciar Análise";
    isLoading = false;
  }
}

/* ================================
   RENDER RESULTADOS
================================ */
function renderResultados(results, nome, cpfFormatado = "") {
  if (!scanResult) {
    scanResult = document.getElementById("scanResult");
  }

  if (!results || results.length === 0) {
    atualizarDashboard(0);

    scanResult.innerHTML = `
      <div class="scan-empty">
        <h3>✅ Nenhuma exposição encontrada</h3>
        <p>Não foram encontrados dados de <strong>${escapeHtml(nome)}</strong> nas fontes analisadas.</p>
        ${
          cpfFormatado
            ? `<p class="scan-sub">CPF consultado: <strong>${escapeHtml(cpfFormatado)}</strong></p>`
            : ""
        }
      </div>
    `;

    return;
  }

  const grupos = {};

  results.forEach((item) => {
    const cat = item.categoria || item.tipo || "outros";

    if (!grupos[cat]) {
      grupos[cat] = [];
    }

    grupos[cat].push(item);
  });

  const labelCategoria = {
    juridico: "⚖️ Jurídico / Processos",
    fiscal: "🧾 Fiscal / Receita",
    eleitoral: "🗳️ Eleitoral",
    empresarial: "🏢 Empresarial",
    profissional: "💼 Profissional",
    social: "📱 Redes Sociais",
    oficial: "📰 Diário Oficial",
    link_informado: "🔗 Links Informados",
    outros: "📂 Outros",

    EXPOSICAO_DADOS: "📂 Exposição de Dados",
    EXPOSICAO_JURIDICA: "⚖️ Exposição Jurídica",
    PROCESSO_POSSIVEL: "⚠️ Processo Possível",
    PROCESSO_CONFIRMADO: "✅ Processo Confirmado",
  };

  const labelRisco = {
    alto: "🔴 Alto",
    medio: "🟡 Médio",
    baixo: "🟢 Baixo",
  };

  let html = "";

  for (const [cat, items] of Object.entries(grupos)) {
    html += `<h4 class="cat-header">${labelCategoria[cat] || escapeHtml(cat)}</h4>`;

    html += items
      .map((item) => {
        const itemUrl = item.url || item.link || "#";

        const cpfTexto =
          item.cpfMascarado ||
          item.dadosSensiveis?.encontrados?.cpfMascarado ||
          (item.cpfEncontrado ? cpfFormatado : "");

        const matchLevel =
          item.matchLevel ||
          (item.cpfEncontrado || item.dadosSensiveis?.cpf ? "forte" : "medio");

        const evidence = Array.isArray(item.evidence) ? item.evidence : [];

        const risco = item.risk || item.prioridade?.toLowerCase?.() || "baixo";

        const confidence = Number(item.confidence || item.score || 0);

        const tipo = item.tipo || "EXPOSICAO_DADOS";
        const statusValidacao = item.statusValidacao || "POSSIVEL_EXPOSICAO";

        return `
          <div class="result-card risk-${escapeHtml(risco)}">
            <div class="result-header">
              <span class="site-name">${escapeHtml(item.source || item.fonte || "Fonte")}</span>
              <span class="risk ${escapeHtml(risco)}">
                ${labelRisco[risco] || escapeHtml(risco)}
              </span>
            </div>

            <p class="result-title">
              ${escapeHtml(item.title || item.titulo || "Possível exposição encontrada")}
            </p>

            ${
              item.snippet
                ? `<p class="result-snippet">${escapeHtml(item.snippet)}</p>`
                : ""
            }

            <div class="result-meta">
              <span>Confiança: <strong>${confidence}%</strong></span>
              ${
                matchLevel
                  ? `<span>Match: <strong>${escapeHtml(matchLevel)}</strong></span>`
                  : ""
              }
              <span>Tipo: <strong>${escapeHtml(tipo)}</strong></span>
            </div>

            <div class="result-meta">
              <span>Status: <strong>${escapeHtml(statusValidacao)}</strong></span>
              ${
                item.acaoRemocao
                  ? `<span>Ação: <strong>${escapeHtml(item.acaoRemocao)}</strong></span>`
                  : ""
              }
            </div>

            ${
              cpfTexto
                ? `
              <div class="cpf-alert">
                🔐 CPF: <strong>${escapeHtml(formatarCPF(cpfTexto))}</strong>
                ${
                  item.cpfEncontrado || item.dadosSensiveis?.cpf
                    ? `<span> — possível dado sensível encontrado</span>`
                    : `<span> — informado na consulta</span>`
                }
              </div>
            `
                : ""
            }

            ${
              item.processNumbers && item.processNumbers.length
                ? `
              <div class="result-evidence">
                <strong>Número(s) CNJ detectado(s):</strong>
                <ul>
                  ${item.processNumbers
                    .map((num) => `<li>${escapeHtml(num)}</li>`)
                    .join("")}
                </ul>
              </div>
            `
                : ""
            }

            ${
              evidence.length
                ? `
              <div class="result-evidence">
                <strong>Evidências:</strong>
                <ul>
                  ${evidence.map((ev) => `<li>${escapeHtml(ev)}</li>`).join("")}
                </ul>
              </div>
            `
                : ""
            }

            ${
              item.observacaoAnalise
                ? `
              <div class="result-evidence">
                <strong>Observação:</strong>
                <p>${escapeHtml(item.observacaoAnalise)}</p>
              </div>
            `
                : ""
            }

            <div class="case-actions">
              <button type="button" onclick="window.open('${escapeAttr(itemUrl)}','_blank')">
                🔎 Ver fonte
              </button>

              <button type="button" onclick="solicitarRemocao('${encodeURIComponent(
                itemUrl
              )}', '${escapeAttr(item.source || item.fonte || "Fonte")}')">
                🗑️ Solicitar remoção
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const score = calcularScore(results);
  atualizarDashboard(score);

  scanResult.innerHTML = `
    <div class="result-summary">
      <span>
        ${results.length} exposição(ões) possível(is) encontrada(s) para
        <strong>${escapeHtml(nome)}</strong>
      </span>

      ${
        cpfFormatado
          ? `<span class="summary-cpf">CPF consultado: <strong>${escapeHtml(cpfFormatado)}</strong> · formato válido</span>`
          : ""
      }
    </div>

    <div class="result-grid">
      ${html}
    </div>
  `;
}

/* ================================
   SOLICITAR REMOÇÃO
================================ */
function solicitarRemocao(urlEncoded, source) {
  const url = decodeURIComponent(urlEncoded);

  const msg = `Você será direcionado para solicitar a remoção no ${source}.\n\nURL: ${url}\n\nDeseja continuar?`;

  if (confirm(msg)) {
    const removeLinks = {
      Jusbrasil: "https://www.jusbrasil.com.br/fale-conosco",
      Escavador: "https://www.escavador.com/sobre/contato",
      LinkedIn: "https://www.linkedin.com/help/linkedin/ask/ts-rmdi",
      Facebook: "https://www.facebook.com/help/contact/144059062408922",
      Instagram: "https://help.instagram.com/contact/",
      VerificaProcesso: "https://www.verificaprocesso.com/",
      ProcessoWeb: "https://processoweb.com.br",
    };

    const removeUrl =
      removeLinks[source] ||
      "https://search.google.com/search-console/remove-outdated-content?hl=pt-BR";

    window.open(removeUrl, "_blank");
  }
}

/* ================================
   SCORE
================================ */
function calcularScore(results) {
  if (!Array.isArray(results) || !results.length) return 0;

  const pesoRisco = {
    alto: 30,
    medio: 15,
    baixo: 5,
    urgente: 40,
    alta: 30,
    média: 15,
    media: 15,
    baixa: 5,
  };

  let total = 0;

  results.forEach((item) => {
    const risco = String(item.risk || item.prioridade || "baixo").toLowerCase();

    const base = pesoRisco[risco] || 10;
    const conf = Number(item.confidence || item.score || 50) / 100;

    const cpfBoost = item.cpfEncontrado || item.dadosSensiveis?.cpf ? 10 : 0;
    const cnjBoost =
      Array.isArray(item.processNumbers) && item.processNumbers.length ? 10 : 0;

    total += base * conf + cpfBoost + cnjBoost;
  });

  return Math.min(Math.round(total), 100);
}

/* ================================
   DASHBOARD
================================ */
function atualizarDashboard(score) {
  const pct = document.getElementById("radialPct");
  const status = document.getElementById("exposureStatusText");
  const exposureLevel = document.getElementById("exposureLevel");
  const radialFill = document.getElementById("radialFill");

  if (pct) pct.innerText = score + "%";

  let txt = "Seguro";

  if (score === 0) {
    txt = "Seguro";
  } else if (score > 70) {
    txt = "Alto";
  } else if (score > 40) {
    txt = "Médio";
  } else {
    txt = "Baixo";
  }

  if (status) status.innerText = txt;

  if (exposureLevel) {
    exposureLevel.innerText =
      score === 0 ? "Aguardando/Seguro" : `Nível: ${txt}`;
  }

  if (radialFill) {
    const circumference = 352;
    const offset = circumference - (score / 100) * circumference;
    radialFill.style.strokeDashoffset = offset;
  }

  atualizarBarras(score);
}

function atualizarBarras(score) {
  const juridico = Math.min(score, 100);
  const buscadores = Math.min(Math.round(score * 0.7), 100);
  const registros = Math.min(Math.round(score * 0.45), 100);
  const links = Math.min(Math.round(score * 0.3), 100);

  const fills = [
    {
      fill: "rbf-1",
      count: "rbc-1",
      value: juridico,
    },
    {
      fill: "rbf-2",
      count: "rbc-2",
      value: buscadores,
    },
    {
      fill: "rbf-3",
      count: "rbc-3",
      value: registros,
    },
    {
      fill: "rbf-4",
      count: "rbc-4",
      value: links,
    },
  ];

  fills.forEach((item) => {
    const fillEl = document.getElementById(item.fill);
    const countEl = document.getElementById(item.count);

    if (fillEl) fillEl.style.width = item.value + "%";
    if (countEl) countEl.innerText = item.value + "%";
  });
}

/* ================================
   LOADING
================================ */
function ativarLoading() {
  if (!loadingOverlay) {
    loadingOverlay = document.getElementById("loadingOverlay");
  }

  if (!loadingOverlay) return;

  loadingOverlay.classList.add("active");

  const bar = document.getElementById("loadingBarFill");
  const stepText = document.getElementById("loadingStepText");

  const steps = [
    {
      id: "lstep-1",
      text: "Verificando fontes jurídicas públicas",
      pct: "20%",
    },
    {
      id: "lstep-2",
      text: "Analisando buscadores e diretórios",
      pct: "40%",
    },
    {
      id: "lstep-3",
      text: "Processando links informados",
      pct: "60%",
    },
    {
      id: "lstep-4",
      text: "Calculando nível de exposição",
      pct: "80%",
    },
    {
      id: "lstep-5",
      text: "Gerando relatório orientativo",
      pct: "95%",
    },
  ];

  if (bar) {
    bar.style.transition = "none";
    bar.style.width = "0%";

    setTimeout(() => {
      bar.style.transition = "width .6s ease";
    }, 50);
  }

  steps.forEach((step, index) => {
    const el = document.getElementById(step.id);

    if (el) {
      el.classList.remove("active", "done");
    }

    setTimeout(() => {
      steps.forEach((prev, prevIndex) => {
        const prevEl = document.getElementById(prev.id);
        if (!prevEl) return;

        prevEl.classList.remove("active");

        if (prevIndex < index) {
          prevEl.classList.add("done");
        }
      });

      if (el) el.classList.add("active");
      if (bar) bar.style.width = step.pct;
      if (stepText) stepText.textContent = step.text;
    }, index * 650);
  });
}

function desativarLoading() {
  if (!loadingOverlay) {
    loadingOverlay = document.getElementById("loadingOverlay");
  }

  if (!loadingOverlay) return;

  const bar = document.getElementById("loadingBarFill");

  if (bar) {
    bar.style.width = "100%";
  }

  setTimeout(() => {
    loadingOverlay.classList.remove("active");

    if (bar) {
      bar.style.width = "0%";
    }

    for (let i = 1; i <= 5; i++) {
      const step = document.getElementById(`lstep-${i}`);
      if (step) step.classList.remove("active", "done");
    }
  }, 450);
}

/* ================================
   CPF MASK + VALIDAÇÃO
================================ */
function configurarMascaraCPF() {
  const cpfInput = document.getElementById("cpfInput");

  if (!cpfInput || cpfInput.dataset.maskAdded) return;

  cpfInput.addEventListener("input", function (e) {
    let v = e.target.value.replace(/\D/g, "").slice(0, 11);
    e.target.value = formatarCPF(v);
  });

  cpfInput.dataset.maskAdded = "true";
}

function formatarCPF(cpf) {
  let v = String(cpf || "").replace(/\D/g, "").slice(0, 11);

  if (v.length > 9) {
    v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*/, "$1.$2.$3-$4");
  } else if (v.length > 6) {
    v = v.replace(/^(\d{3})(\d{3})(\d{0,3}).*/, "$1.$2.$3");
  } else if (v.length > 3) {
    v = v.replace(/^(\d{3})(\d{0,3}).*/, "$1.$2");
  }

  return v;
}

function validarCPF(cpf) {
  cpf = String(cpf || "").replace(/\D/g, "");

  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let soma = 0;

  for (let i = 0; i < 9; i++) {
    soma += Number(cpf[i]) * (10 - i);
  }

  let resto = (soma * 10) % 11;

  if (resto === 10) resto = 0;
  if (resto !== Number(cpf[9])) return false;

  soma = 0;

  for (let i = 0; i < 10; i++) {
    soma += Number(cpf[i]) * (11 - i);
  }

  resto = (soma * 10) % 11;

  if (resto === 10) resto = 0;

  return resto === Number(cpf[10]);
}

/* ================================
   SEGURANÇA DE HTML
================================ */
function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(text) {
  return String(text ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll('"', "&quot;");
}

/* ================================
   CURSOR CUSTOM
   Mantido, mas com proteção para evitar erro.
================================ */
function configurarCursorCustom() {
  const cursor = document.getElementById("cursor");
  const follower = document.getElementById("cursor-follower");

  if (!cursor || !follower || cursor.dataset.cursorReady) return;

  let mouseX = 0;
  let mouseY = 0;
  let followerX = 0;
  let followerY = 0;

  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    cursor.style.left = `${mouseX}px`;
    cursor.style.top = `${mouseY}px`;
  });

  function animateFollower() {
    followerX += (mouseX - followerX) * 0.18;
    followerY += (mouseY - followerY) * 0.18;

    follower.style.left = `${followerX}px`;
    follower.style.top = `${followerY}px`;

    requestAnimationFrame(animateFollower);
  }

  cursor.dataset.cursorReady = "true";
  animateFollower();
}
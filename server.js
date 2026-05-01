require("dotenv").config();

const express = require("express");
const cors = require("cors");

try {
  require("dotenv").config();
} catch {}

const app = express();

app.use(cors());
app.use(express.json());

const CONFIG = {
  serpApiKey: process.env.SERPAPI_KEY || null,
  port: process.env.PORT || 3000,
  timeoutMs: 12000,
  delayMs: 800,
  minConfidence: 85,
};

const SEARCH_MODE = CONFIG.serpApiKey ? "serpapi" : "scrape";

/**
 * Fontes confiáveis / conhecidas
 * Mantive suas fontes originais e apenas deixei espaço para classificação.
 */
const TRUSTED_SOURCES = {
  "jusbrasil.com.br": {
    name: "Jusbrasil",
    weight: 25,
    category: "juridica_agregadora",
  },
  "escavador.com": {
    name: "Escavador",
    weight: 22,
    category: "juridica_agregadora",
  },
  "verificaprocesso.com": {
    name: "VerificaProcesso",
    weight: 20,
    category: "juridica_agregadora",
  },
  "processoweb.com.br": {
    name: "ProcessoWeb",
    weight: 20,
    category: "juridica_agregadora",
  },
  "projudi.tjpr.jus.br": {
    name: "PROJUDI-PR",
    weight: 18,
    category: "oficial_juridica",
  },
  "esaj.tjsp.jus.br": {
    name: "ESAJ-SP",
    weight: 18,
    category: "oficial_juridica",
  },
  "pje.tjba.jus.br": {
    name: "PJe-BA",
    weight: 18,
    category: "oficial_juridica",
  },
  "cnj.jus.br": {
    name: "CNJ",
    weight: 20,
    category: "oficial_juridica",
  },
  "jus.br": {
    name: "Tribunal",
    weight: 15,
    category: "oficial_juridica",
  },
  "gov.br": {
    name: "Governo Federal",
    weight: 12,
    category: "oficial_governo",
  },
  "google.com": {
    name: "Google Search",
    weight: 10,
    category: "busca",
  },
};

const BLOCKLIST_PATTERNS = [
  /\/nomes?\//i,
  /\/nome\//i,
  /\/pessoas?\//i,
  /\/pessoa\//i,
  /\/perfil\//i,
  /\/perfis\//i,
  /\/search\?/i,
  /\/busca/i,
  /page=/i,
  /pagina=/i,

  /facebook\.com/i,
  /instagram\.com/i,
  /twitter\.com/i,
  /linkedin\.com/i,
  /whatsapp\.com/i,
  /youtube\.com/i,
  /wikipedia\.org/i,

  /tabeliao/i,
  /cartorio/i,
  /curriculo/i,
  /cnpj/i,
  /empresa/i,
  /classificados/i,

  /tribunal[-\s]?de[-\s]?justica/i,
  /tribunal[-\s]?de[-\s]?justiça/i,
  /tjrj\.jus\.br/i,
  /tjgo\.jus\.br/i,
  /pauta/i,
  /sessao/i,
  /sessão/i,
  /jurisprudencia/i,
  /jurisprudência/i,
];

const STRONG_LEGAL_TERMS = [
  /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/,
  /processo/i,
  /processo judicial/i,
  /número do processo/i,
  /numero do processo/i,
  /andamento processual/i,
  /movimentação processual/i,
  /movimentacao processual/i,
  /ação judicial/i,
  /acao judicial/i,
  /ação civil/i,
  /acao civil/i,
  /execução fiscal/i,
  /execucao fiscal/i,
  /reclamação trabalhista/i,
  /reclamacao trabalhista/i,
  /vara c[ií]vel/i,
  /vara criminal/i,
  /tribunal/i,
  /ju[ií]zo/i,
  /comarca/i,
  /réu/i,
  /reu/i,
  /autor/i,
  /requerente/i,
  /requerido/i,
];

const WEAK_LEGAL_TERMS = [
  /processo/i,
  /advogado/i,
  /tribunal/i,
  /ju[íi]zo/i,
  /vara\s+(c[íi]vel|criminal|trabalhista)/i,
  /comarca/i,
  /réu|reu|autor|requerente|requerido/i,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeName(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function nameInText(nome, texto) {
  if (!nome || !texto) return false;

  const n = normalizeName(nome);
  const t = normalizeName(texto);

  if (t.includes(n)) return true;

  const partes = n.split(" ").filter((p) => p.length > 2);
  if (!partes.length) return false;

  let matches = 0;

  partes.forEach((p) => {
    if (t.includes(p)) matches++;
  });

  return matches / partes.length >= 0.8;
}

function cpfVariations(cpf) {
  if (!cpf) return [];

  const d = String(cpf).replace(/\D/g, "");
  if (d.length !== 11) return [];

  return [
    d,
    `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`,
    `${d.slice(0, 3)}.***.***-${d.slice(9)}`,
    `***.***.${d.slice(6, 9)}-${d.slice(9)}`,
    d.slice(0, 6),
    d.slice(0, 9),
  ];
}

function detectCpfInText(cpf, html) {
  if (!cpf || !html) {
    return {
      found: false,
      masked: null,
    };
  }

  for (const v of cpfVariations(cpf)) {
    if (html.includes(v)) {
      const d = String(cpf).replace(/\D/g, "");

      return {
        found: true,
        masked: `${d.slice(0, 3)}.***.***-${d.slice(9)}`,
      };
    }
  }

  return {
    found: false,
    masked: null,
  };
}

function extractProcessNumbers(text = "") {
  const pattern = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  return [...new Set(String(text).match(pattern) || [])];
}

function getSourceInfo(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");

    for (const [domain, info] of Object.entries(TRUSTED_SOURCES)) {
      if (host.includes(domain)) {
        return {
          ...info,
          domain: host,
        };
      }
    }

    return {
      name: host,
      weight: 5,
      category: "geral",
      domain: host,
    };
  } catch {
    return {
      name: "Desconhecido",
      weight: 0,
      category: "desconhecida",
      domain: null,
    };
  }
}

function isBlocklisted(url) {
  return BLOCKLIST_PATTERNS.some((p) => p.test(url));
}

function isGenericNamePage(url, title = "") {
  return [
    /\/nomes?\//i,
    /\/pessoas?\//i,
    /significado.*(nome|sobrenome)/i,
    /origem.*(nome|sobrenome)/i,
  ].some((p) => p.test(url) || p.test(title));
}

/**
 * Novo detector de dados sensíveis.
 * Ele não confirma nada sozinho, apenas sinaliza possível exposição.
 */
function detectarDadosSensiveis(texto = "", cpfInformado = null) {
  const content = String(texto || "");

  const cpfRegex = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

  const telefoneRegex =
    /(?:\(?\d{2}\)?\s?)?(?:9?\d{4})[-\s]?\d{4}\b/g;

  const enderecoRegex =
    /\b(rua|avenida|av\.|bairro|travessa|alameda|rodovia|estrada|cep|quadra|lote|condomínio|condominio|residencial)\b/i;

  const financeiroRegex =
    /\b(banco|agência|agencia|conta corrente|conta bancária|conta bancaria|pix|chave pix|cartão|cartao|boleto|dívida|divida|financiamento|empréstimo|emprestimo)\b/i;

  const cpfsEncontrados = content.match(cpfRegex) || [];
  const telefonesEncontrados = content.match(telefoneRegex) || [];

  const cpfPorParametro = cpfInformado
    ? detectCpfInText(cpfInformado, content)
    : { found: false, masked: null };

  const cpfDetectado = cpfsEncontrados.length > 0 || cpfPorParametro.found;
  const telefoneDetectado = telefonesEncontrados.length > 0;
  const enderecoDetectado = enderecoRegex.test(content);
  const financeiroDetectado = financeiroRegex.test(content);

  return {
    cpf: cpfDetectado,
    telefone: telefoneDetectado,
    endereco: enderecoDetectado,
    dadosFinanceiros: financeiroDetectado,
    nomeCompletoContexto: detectarNomeCompletoContexto(content),
    encontrados: {
      cpf: [...new Set(cpfsEncontrados)],
      telefone: [...new Set(telefonesEncontrados)],
      cpfMascarado: cpfPorParametro.masked,
    },
    total:
      (cpfDetectado ? 1 : 0) +
      (telefoneDetectado ? 1 : 0) +
      (enderecoDetectado ? 1 : 0) +
      (financeiroDetectado ? 1 : 0),
  };
}

function detectarNomeCompletoContexto(texto = "") {
  return /\b(nome|autor|réu|reu|requerente|requerido|parte|advogado|cliente|titular|cpf|processo|publicação|publicacao)\b/i.test(
    texto
  );
}

/**
 * Classificação de remoção/desindexação.
 * Não remove nada automaticamente, apenas sugere a ação.
 */
function classificarRemocao(url = "", texto = "") {
  const u = normalizeName(url);
  const t = normalizeName(texto);

  if (u.includes("jusbrasil") || u.includes("escavador")) {
    return "DESINDEXACAO";
  }

  if (
    /cpf|telefone|endereco|endereço|rua|avenida|bairro|cep|dados pessoais/i.test(
      t
    )
  ) {
    return "REMOVER_DADO_SENSIVEL";
  }

  if (u.includes("jus.br") || u.includes("gov.br")) {
    return "VALIDAR_FONTE_OFICIAL";
  }

  return "MONITORAR";
}

/**
 * Classificação geral do resultado.
 * Mantém cautela: processo confirmado só entra quando houver integração oficial futura.
 */
function classificarResultadoAvancado({
  nome,
  cpf,
  estado,
  url,
  title,
  snippet,
  html,
  score,
  evidence,
  processNumbers,
  cpfResult,
}) {
  const src = getSourceInfo(url);

  const textoCompleto = `${title || ""} ${snippet || ""} ${html || ""} ${
    evidence ? evidence.join(" ") : ""
  }`;

  const textoNormal = normalizeName(textoCompleto);
  const urlNormal = normalizeName(url);

  const dadosSensiveis = detectarDadosSensiveis(textoCompleto, cpf);

  const possuiNumeroCNJ =
    Array.isArray(processNumbers) && processNumbers.length > 0;

  const possuiTermoJuridicoForte = STRONG_LEGAL_TERMS.some((term) =>
    term.test(textoCompleto)
  );

  const possuiTermoJuridicoFraco = WEAK_LEGAL_TERMS.some((term) =>
    term.test(textoCompleto)
  );

  const nomeConfirmado =
    nameInText(nome, title) || nameInText(nome, snippet) || nameInText(nome, html);

  let tipo = "EXPOSICAO_DADOS";
  let statusValidacao = "POSSIVEL_EXPOSICAO";

  if (
    urlNormal.includes("jusbrasil") ||
    urlNormal.includes("escavador") ||
    possuiTermoJuridicoFraco ||
    possuiTermoJuridicoForte
  ) {
    tipo = "EXPOSICAO_JURIDICA";
    statusValidacao = "NECESSITA_VALIDACAO";
  }

  if (possuiNumeroCNJ || possuiTermoJuridicoForte) {
    tipo = "PROCESSO_POSSIVEL";
    statusValidacao = possuiNumeroCNJ
      ? "ALTA_PROBABILIDADE"
      : "NECESSITA_VALIDACAO";
  }

  /**
   * Placeholder futuro:
   * Nunca marcar como PROCESSO_CONFIRMADO agora,
   * porque ainda não existe validação oficial integrada.
   */
  const processoConfirmadoOficial = false;

  if (processoConfirmadoOficial) {
    tipo = "PROCESSO_CONFIRMADO";
    statusValidacao = "CONFIRMADO_OFICIAL";
  }

  const acaoRemocao = classificarRemocao(url, textoCompleto);

  let prioridade = calcularPrioridade({
    confidence: score,
    cpfEncontrado: Boolean(cpfResult?.found || dadosSensiveis.cpf),
  });

  if (possuiNumeroCNJ || dadosSensiveis.cpf) {
    prioridade = "URGENTE";
  }

  return {
    tipo,
    statusValidacao,
    dadosSensiveis,
    acaoRemocao,
    prioridade,
    nomeConfirmado,
    possuiNumeroCNJ,
    fonteCategoria: src.category || "geral",
    observacaoAnalise: gerarObservacaoAnalise({
      tipo,
      statusValidacao,
      dadosSensiveis,
      possuiNumeroCNJ,
      acaoRemocao,
      src,
    }),
    estadoConsiderado: estado || null,
    textoBaseAnalise: {
      title: title || "",
      snippet: snippet || "",
    },
  };
}

function gerarObservacaoAnalise({
  tipo,
  statusValidacao,
  dadosSensiveis,
  possuiNumeroCNJ,
  acaoRemocao,
  src,
}) {
  if (statusValidacao === "CONFIRMADO_OFICIAL") {
    return "Registro confirmado em fonte oficial integrada.";
  }

  if (possuiNumeroCNJ) {
    return "Número CNJ detectado. Recomendado validar manualmente em fonte oficial antes de afirmar existência de processo.";
  }

  if (dadosSensiveis?.cpf) {
    return "Possível CPF identificado no conteúdo. Prioridade alta para análise de remoção ou desindexação.";
  }

  if (tipo === "PROCESSO_POSSIVEL") {
    return "Possível exposição jurídica detectada. Não tratar como processo confirmado sem validação oficial.";
  }

  if (acaoRemocao === "DESINDEXACAO") {
    return `Fonte agregadora detectada (${src?.name || "fonte"}). Recomenda-se avaliar pedido de desindexação.`;
  }

  if (acaoRemocao === "REMOVER_DADO_SENSIVEL") {
    return "Possível dado sensível identificado. Recomenda-se avaliar pedido de remoção do dado exposto.";
  }

  return "Exposição digital identificada. Recomenda-se monitoramento.";
}

/**
 * Função futura para integração oficial.
 * Por enquanto, ela NÃO confirma nada.
 */
async function verificarProcessoOficial(numero) {
  return {
    confirmado: false,
    fonte: "CNJ",
    status: "não integrado",
    numero,
  };
}

/**
 * Queries originais preservadas + expansão controlada.
 * O parâmetro modo permite:
 * - full
 * - exposure
 * - processes
 */
function generateQueries(nome, estado, cpf, modo = "full") {
  const q = `"${nome}"`;
  const st = estado ? ` "${estado}"` : "";

  const queries = [];

  const incluirProcessos = modo === "full" || modo === "processes";
  const incluirExposicao = modo === "full" || modo === "exposure";

  if (incluirProcessos) {
    queries.push(
      // 🔥 FONTES PRINCIPAIS — mantidas
      `site:jusbrasil.com.br ${q}`,
      `site:jusbrasil.com.br ${q} processo`,
      `site:jusbrasil.com.br ${q}${st}`,

      `site:escavador.com ${q}`,
      `site:escavador.com ${q} processo`,
      `site:escavador.com ${q}${st}`,

      // 🔥 APOIO CONTROLADO — mantido
      `site:verificaprocesso.com ${q}`,
      `site:processoweb.com.br ${q}`,

      // 🔥 Novas buscas jurídicas
      `${q} processo`,
      `${q} processo judicial`,
      `${q} tribunal`,
      `${q} diário oficial`,
      `${q} diario oficial`,
      `site:jus.br ${q}`,
      `site:gov.br ${q} processo`
    );
  }

  if (incluirExposicao) {
    queries.push(
      // 🔎 Exposição geral
      `${q}`,
      `${q} CPF`,
      `${q} telefone`,
      `${q} endereço`,
      `${q} endereco`,
      `${q} dados pessoais`,
      `${q} site:gov.br`,
      `${q} site:jus.br`,
      `${q} site:diariooficial`
    );
  }

  if (cpf) {
    const d = String(cpf).replace(/\D/g, "");

    if (d.length === 11) {
      queries.push(
        `"${d}" ${q}`,
        `"${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}" ${q}`,
        `"${d.slice(0, 3)}.***.***-${d.slice(9)}" ${q}`
      );
    }
  }

  return [...new Set(queries)];
}

async function fetchWithTimeout(url, timeoutMs = CONFIG.timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LegalScanBot/1.0)",
        Accept: "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchViaSerpApi(query) {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    hl: "pt",
    gl: "br",
    num: "10",
    api_key: CONFIG.serpApiKey,
  });

  const url = `https://serpapi.com/search.json?${params}`;

  try {
    const res = await fetchWithTimeout(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[SERPAPI] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = await res.json();
    const organic = data.organic_results || [];

    if (data.search_information?.total_results !== undefined) {
      console.log(
        `  [SERPAPI] ~${data.search_information.total_results} resultados totais`
      );
    }

    return organic.map((r) => ({
      url: r.link || "",
      title: r.title || "",
      snippet: r.snippet || "",
    }));
  } catch (err) {
    console.error(`[SERPAPI ERROR] "${query}":`, err.message);
    return [];
  }
}

async function searchViaGoogleScrape(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    query
  )}&num=10&hl=pt-BR&gl=BR`;

  try {
    const res = await fetchWithTimeout(url);

    if (!res.ok) return [];

    const html = await res.text();

    return parseGoogleHtml(html);
  } catch (err) {
    console.error(`[SCRAPE ERROR] "${query}":`, err.message);
    return [];
  }
}

function parseGoogleHtml(html) {
  const urlPat = /href="\/url\?q=(https?:\/\/[^"&]+)/g;
  const titlePat = /<h3[^>]*>(.*?)<\/h3>/gs;
  const snippetPat =
    /<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)<\/div>/gs;

  const urls = [];
  const titles = [];
  const snippets = [];
  let m;

  while ((m = urlPat.exec(html)) !== null) {
    try {
      const d = decodeURIComponent(m[1]);

      if (!d.startsWith("https://www.google")) {
        urls.push(d);
      }
    } catch {}
  }

  while ((m = titlePat.exec(html)) !== null) {
    titles.push(m[1].replace(/<[^>]+>/g, "").trim());
  }

  while ((m = snippetPat.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  }

  return urls.slice(0, 10).map((url, i) => ({
    url,
    title: titles[i] || "",
    snippet: snippets[i] || "",
  }));
}

async function search(query) {
  return SEARCH_MODE === "serpapi"
    ? searchViaSerpApi(query)
    : searchViaGoogleScrape(query);
}

async function fetchPageHtml(url) {
  try {
    const res = await fetchWithTimeout(url);

    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "";

    if (!ct.includes("text/html")) return null;

    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Score principal.
 * Mantive a estrutura original e apenas integrei dados sensíveis/classificação.
 */
function scoreResult({ nome, url, title, snippet, html, cpf }) {
  let score = 0;
  const evidence = [];

  const fullText = `${title || ""} ${snippet || ""} ${html || ""}`;
  const texto = fullText.toLowerCase();

  if (
    texto.includes("significado do nome") ||
    texto.includes("origem do nome") ||
    texto.includes("lista de pessoas") ||
    texto.includes("facebook") ||
    texto.includes("instagram") ||
    texto.includes("linkedin")
  ) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: {
        found: false,
        masked: null,
      },
      dadosSensiveis: detectarDadosSensiveis("", cpf),
    };
  }

  const nomeNormal = normalizeName(nome);
  const textoNormal = normalizeName(fullText);
  const partes = nomeNormal.split(" ").filter((p) => p.length > 2);

  let matches = 0;

  partes.forEach((p) => {
    if (textoNormal.includes(p)) matches++;
  });

  const proporcaoNome = partes.length ? matches / partes.length : 0;

  const processNumbers = extractProcessNumbers(fullText);

  const cpfCheck =
    cpf && fullText
      ? detectCpfInText(cpf, fullText)
      : {
          found: false,
          masked: null,
        };

  const dadosSensiveis = detectarDadosSensiveis(fullText, cpf);

  const matchScore = calcularMatchAvancado({
    nome,
    estado: "",
    title,
    snippet,
    html,
  });

  if (proporcaoNome < 0.7 && !cpfCheck.found && processNumbers.length === 0) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: cpfCheck,
      dadosSensiveis,
    };
  }

  if (!cpfCheck.found && processNumbers.length === 0 && proporcaoNome < 0.8) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: cpfCheck,
      dadosSensiveis,
    };
  }

  const nameInTitle = nameInText(nome, title);
  const nameInSnippet = nameInText(nome, snippet);
  const nameInHtml = html ? nameInText(nome, html) : false;

  /**
   * Bloqueio preservado:
   * precisa ter nome no título/snippet OU CPF encontrado.
   */
  if (!nameInTitle && !nameInSnippet && !cpfCheck.found) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: cpfCheck,
      dadosSensiveis,
    };
  }

  if (!nameInTitle && !nameInSnippet && proporcaoNome < 0.8) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: cpfCheck,
      dadosSensiveis,
    };
  }

  if (html && !nameInHtml) {
    return {
      score: 0,
      evidence: [],
      processNumbers: [],
      cpfResult: cpfCheck,
      dadosSensiveis,
    };
  }

  if (nameInTitle) {
    score += 20;
    evidence.push("nome no título");
  }

  if (nameInSnippet) {
    score += 10;
    evidence.push("nome no snippet");
  }

  if (nameInHtml) {
    score += 15;
    evidence.push("nome confirmado na página");
  }

  for (const term of STRONG_LEGAL_TERMS) {
    if (term.test(fullText)) {
      score += 15;
      evidence.push("termo jurídico forte");
      break;
    }
  }

  const weakCount = WEAK_LEGAL_TERMS.filter((t) => t.test(fullText)).length;

  if (weakCount > 0) {
    score += Math.min(weakCount * 3, 10);
    evidence.push(`${weakCount} termo(s) jurídico(s)`);
  }

  if (processNumbers.length > 0) {
    score += 20;
    evidence.push(`número CNJ: ${processNumbers[0]}`);
  }

  const src = getSourceInfo(url);

  score += src.weight;
  evidence.push(`fonte: ${src.name}`);

  const cpfResult = cpfCheck;

  /**
   * Regra nova solicitada:
   * +30 CPF encontrado.
   * Mantive próximo do seu +35 original, mas ajustado para +30.
   */
  if (cpfResult.found || dadosSensiveis.cpf) {
    score += 30;
    evidence.push("CPF encontrado na página");
  }

  /**
   * Regra nova:
   * +15 nome confirmado.
   */
  if (nameInTitle || nameInSnippet || nameInHtml) {
    score += 15;
    evidence.push("nome confirmado");
  }

  score += Math.min(matchScore, 30);

  if (isGenericNamePage(url, title)) score -= 30;
  if (url.includes("/search")) score -= 20;

  return {
    score: Math.max(0, Math.min(100, score)),
    evidence,
    processNumbers,
    cpfResult,
    dadosSensiveis,
  };
}

const scoreToRisk = (s) => (s >= 70 ? "alto" : s >= 50 ? "medio" : "baixo");

const scoreToMatchLevel = (score, cpfOk, matchScore = 0) => {
  if (cpfOk) return "forte";
  if (matchScore > 50) return "forte";
  if (matchScore > 30) return "medio";
  if (score >= 85) return "medio";

  return "fraco";
};

const buildAction = (risk, src) =>
  risk === "alto"
    ? `Verificar urgentemente em ${src} e validar manualmente a exposição`
    : risk === "medio"
    ? `Analisar detalhes em ${src} e avaliar pedido de remoção/desindexação`
    : `Monitorar periodicamente em ${src}`;

/**
 * Aplica bônus por múltiplas fontes/processos repetidos.
 */
function aplicarBonusCruzamento(resultados) {
  return resultados.map((r) => {
    let boost = 0;

    resultados.forEach((other) => {
      if (r === other) return;

      const mesmoTitulo =
        normalizeName(r.title || "") === normalizeName(other.title || "");

      const mesmoProcesso =
        Array.isArray(r.processNumbers) &&
        Array.isArray(other.processNumbers) &&
        r.processNumbers.some((p) => other.processNumbers.includes(p));

      const mesmoDominio =
        r.source &&
        other.source &&
        normalizeName(r.source) !== normalizeName(other.source);

      if (mesmoTitulo || mesmoProcesso || mesmoDominio) {
        boost += 10;
      }
    });

    return {
      ...r,
      confidence: Math.min(100, r.confidence + boost),
      bonusMultiplasFontes: boost > 0,
    };
  });
}

/**
 * Executor principal preservado.
 * Agora recebe modo: full | exposure | processes.
 */
async function runScan(nome, estado, cpf, modo = "full") {
  const queries = generateQueries(nome, estado, cpf, modo);
  const seen = new Set();
  const rawResults = [];

  console.log(`\n[SCAN] "${nome}" | mode: ${SEARCH_MODE.toUpperCase()} | tipo: ${modo}`);

  for (const query of queries) {
    console.log(`  [QUERY] ${query}`);

    const hits = await search(query);

    for (const hit of hits) {
      if (hit.url && !seen.has(hit.url) && !isBlocklisted(hit.url)) {
        seen.add(hit.url);
        rawResults.push(hit);
      }
    }

    await sleep(CONFIG.delayMs);
  }

  console.log(`[SCAN] ${rawResults.length} URLs coletadas — analisando HTML...`);

  const processed = [];

  for (const { url, title, snippet } of rawResults) {
    const pre = scoreResult({
      nome,
      url,
      title,
      snippet,
      html: null,
      cpf,
    });

    if (pre.score < 10) continue;

    await sleep(300);

    const html = await fetchPageHtml(url);

    const { score, evidence, processNumbers, cpfResult } = scoreResult({
      nome,
      url,
      title,
      snippet,
      html,
      cpf,
    });

        if (score < CONFIG.minConfidence) continue;

    const src = getSourceInfo(url);
    const risk = scoreToRisk(score);

    const matchScore = calcularMatchAvancado({
      nome,
      estado,
      title,
      snippet,
      html,
    });

    const matchLevel = scoreToMatchLevel(score, cpfResult.found, matchScore);
    const evidenceText = evidence.join(" ").toLowerCase();

    if (score < 60 && processNumbers.length === 0) continue;
    if (matchLevel === "fraco") continue;

    if (
      evidenceText.includes("nome no snippet") &&
      !evidenceText.includes("nome confirmado na página") &&
      processNumbers.length === 0 &&
      !cpfResult.found
    ) {
      continue;
    }

    const nomeOuCpfBateNoResultado =
      nameInText(nome, title) ||
      nameInText(nome, snippet) ||
      cpfResult.found;

    if (!nomeOuCpfBateNoResultado) continue;

    const analiseAvancada = classificarResultadoAvancado({
      nome,
      cpf,
      estado,
      url,
      title,
      snippet,
      html,
      score,
      evidence,
      processNumbers,
      cpfResult,
    });

    processed.push({
      source: src.name,
      sourceCategory: src.category || "geral",
      title: title || url,
      url,
      risk,
      confidence: score,
      action: buildAction(risk, src.name),
      status: "Pendente",

      cpfEncontrado: cpfResult.found,
      cpfMascarado: cpfResult.masked || null,

      matchLevel,
      processNumbers,
      evidence,

      tipoProcesso: classificarProcesso(
        `${title || ""} ${snippet || ""} ${evidence.join(" ")}`
      ),

      prioridade: analiseAvancada.prioridade,

      tipo: analiseAvancada.tipo,
      statusValidacao: analiseAvancada.statusValidacao,
      dadosSensiveis: analiseAvancada.dadosSensiveis,
      acaoRemocao: analiseAvancada.acaoRemocao,
      nomeConfirmado: analiseAvancada.nomeConfirmado,
      possuiNumeroCNJ: analiseAvancada.possuiNumeroCNJ,
      observacaoAnalise: analiseAvancada.observacaoAnalise,
      estadoConsiderado: analiseAvancada.estadoConsiderado,
    });
  }

  processed.sort((a, b) => b.confidence - a.confidence);

  console.log(
    `[SCAN] Concluído — ${processed.length} resultado(s) qualificado(s).\n`
  );

  const cruzado = cruzarResultados(aplicarBonusCruzamento(processed));

  return cruzado.map((r) => ({
    ...r,
    certeza:
      r.cpfEncontrado || r.dadosSensiveis?.cpf
        ? "ALTA"
        : r.confidence > 85
        ? "ALTA"
        : r.confidence > 65
        ? "MÉDIA"
        : "BAIXA",
  }));
}

/**
 * Organiza o retorno novo sem quebrar o retorno antigo.
 */
function montarRespostaEstruturada({ nome, estado, cpf, results, modo }) {
  const exposicoesGerais = results.filter((r) => r.tipo === "EXPOSICAO_DADOS");

  const exposicoesJuridicas = results.filter(
    (r) => r.tipo === "EXPOSICAO_JURIDICA"
  );

  const processosPossiveis = results.filter(
    (r) => r.tipo === "PROCESSO_POSSIVEL"
  );

  const processosConfirmados = results.filter(
    (r) => r.tipo === "PROCESSO_CONFIRMADO"
  );

  const remocoesSugeridas = results
    .filter((r) =>
      ["DESINDEXACAO", "REMOVER_DADO_SENSIVEL", "VALIDAR_FONTE_OFICIAL"].includes(
        r.acaoRemocao
      )
    )
    .map((r) => ({
      title: r.title,
      url: r.url,
      source: r.source,
      prioridade: r.prioridade,
      acao: r.acaoRemocao,
      motivo: r.observacaoAnalise,
    }));

  const dadosSensiveis = results.filter(
    (r) => r.dadosSensiveis && r.dadosSensiveis.total > 0
  );

  return {
    sucesso: true,
    nome,
    estado: estado || null,
    cpfInformado: !!cpf,
    searchMode: SEARCH_MODE,
    modo,

    resumo: {
      totalResultados: results.length,
      exposicoes: exposicoesGerais.length,
      exposicoesJuridicas: exposicoesJuridicas.length,
      processosPossiveis: processosPossiveis.length,
      processosConfirmados: processosConfirmados.length,
      dadosSensiveis: dadosSensiveis.length,
      remocoesSugeridas: remocoesSugeridas.length,
    },

    dados: {
      exposicoesGerais,
      exposicoesJuridicas,
      processosPossiveis,
      processosConfirmados,
      remocoesSugeridas,
    },

    resultados: results,

    aviso:
      "Este sistema identifica possíveis exposições públicas. " +
      "Não confirma a existência de processos sem validação em fonte oficial.",
  };
}

/**
 * ROTA ORIGINAL — mantida funcionando.
 */
app.post("/scan", async (req, res) => {
  const { nome, estado, cpf } = req.body;

  if (!nome || nome.trim().split(/\s+/).length < 2) {
    return res.status(400).json({
      sucesso: false,
      error: "Nome completo é obrigatório (mínimo nome + sobrenome)",
    });
  }

  try {
    const results = await runScan(nome.trim(), estado?.trim(), cpf?.trim(), "full");

    return res.json({
      sucesso: true,
      nome,
      estado: estado || null,
      cpfInformado: !!cpf,
      searchMode: SEARCH_MODE,
      totalResultados: results.length,
      resultados: results,
      dados: results,
      aviso:
        "Este sistema identifica possíveis exposições públicas. " +
        "Não confirma a existência de processos. Consulte sempre um advogado.",
    });
  } catch (err) {
    console.error("[ERROR]", err);

    return res.status(500).json({
      sucesso: false,
      error: "Erro interno ao processar varredura",
    });
  }
});

/**
 * NOVA ROTA — exposição geral.
 */
app.post("/scan-exposure", async (req, res) => {
  const { nome, estado, cpf } = req.body;

  if (!nome || nome.trim().split(/\s+/).length < 2) {
    return res.status(400).json({
      sucesso: false,
      error: "Nome completo é obrigatório (mínimo nome + sobrenome)",
    });
  }

  try {
    const results = await runScan(
      nome.trim(),
      estado?.trim(),
      cpf?.trim(),
      "exposure"
    );

    return res.json(
      montarRespostaEstruturada({
        nome,
        estado,
        cpf,
        results,
        modo: "exposure",
      })
    );
  } catch (err) {
    console.error("[ERROR /scan-exposure]", err);

    return res.status(500).json({
      sucesso: false,
      error: "Erro interno ao processar exposição digital",
    });
  }
});

/**
 * NOVA ROTA — foco jurídico.
 */
app.post("/scan-processes", async (req, res) => {
  const { nome, estado, cpf } = req.body;

  if (!nome || nome.trim().split(/\s+/).length < 2) {
    return res.status(400).json({
      sucesso: false,
      error: "Nome completo é obrigatório (mínimo nome + sobrenome)",
    });
  }

  try {
    const results = await runScan(
      nome.trim(),
      estado?.trim(),
      cpf?.trim(),
      "processes"
    );

    return res.json(
      montarRespostaEstruturada({
        nome,
        estado,
        cpf,
        results,
        modo: "processes",
      })
    );
  } catch (err) {
    console.error("[ERROR /scan-processes]", err);

    return res.status(500).json({
      sucesso: false,
      error: "Erro interno ao processar análise jurídica",
    });
  }
});

/**
 * NOVA ROTA — relatório completo estruturado.
 */
app.post("/scan-full", async (req, res) => {
  const { nome, estado, cpf } = req.body;

  if (!nome || nome.trim().split(/\s+/).length < 2) {
    return res.status(400).json({
      sucesso: false,
      error: "Nome completo é obrigatório (mínimo nome + sobrenome)",
    });
  }

  try {
    const results = await runScan(nome.trim(), estado?.trim(), cpf?.trim(), "full");

    return res.json(
      montarRespostaEstruturada({
        nome,
        estado,
        cpf,
        results,
        modo: "full",
      })
    );
  } catch (err) {
    console.error("[ERROR /scan-full]", err);

    return res.status(500).json({
      sucesso: false,
      error: "Erro interno ao processar relatório completo",
    });
  }
});

/**
 * Rota futura para validação oficial.
 */
app.post("/verificar-processo-oficial", async (req, res) => {
  const { numero } = req.body;

  if (!numero) {
    return res.status(400).json({
      sucesso: false,
      error: "Número do processo é obrigatório",
    });
  }

  try {
    const resultado = await verificarProcessoOficial(numero);

    return res.json({
      sucesso: true,
      resultado,
    });
  } catch (err) {
    console.error("[ERROR /verificar-processo-oficial]", err);

    return res.status(500).json({
      sucesso: false,
      error: "Erro ao verificar processo oficial",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    searchMode: SEARCH_MODE,
    serpApiKey: CONFIG.serpApiKey
      ? "configurada ✓"
      : "não configurada (modo scrape)",
    rotas: [
      "POST /scan",
      "POST /scan-exposure",
      "POST /scan-processes",
      "POST /scan-full",
      "POST /verificar-processo-oficial",
      "GET /health",
    ],
    timestamp: new Date().toISOString(),
  });
});

app.use((err, _req, res, _next) => {
  console.error("[UNHANDLED ERROR]", err);

  res.status(500).json({
    sucesso: false,
    error: "Erro inesperado no servidor",
  });
});

app.listen(CONFIG.port, () => {
  console.log(`\n🔍 Legal Exposure Scanner`);
  console.log(`   Port       : ${CONFIG.port}`);
  console.log(
    `   Search mode: ${SEARCH_MODE.toUpperCase()}${
      SEARCH_MODE === "scrape"
        ? "  ⚠ (defina SERPAPI_KEY para usar SerpApi)"
        : "  ✓"
    }`
  );
  console.log(`   POST /scan                    → executar varredura original`);
  console.log(`   POST /scan-exposure           → análise de exposição`);
  console.log(`   POST /scan-processes          → análise jurídica`);
  console.log(`   POST /scan-full               → relatório completo`);
  console.log(`   POST /verificar-processo-oficial → placeholder CNJ`);
  console.log(`   GET  /health                  → status do servidor\n`);
});

function calcularMatchAvancado({ nome, estado, title, snippet, html }) {
  const texto = `${title || ""} ${snippet || ""} ${html || ""}`.toLowerCase();
  const nomeNormal = normalizeName(nome);
  const textoNormal = normalizeName(texto);

  let score = 0;

  if (textoNormal.includes(nomeNormal)) {
    score += 40;
  }

  const partes = nomeNormal.split(" ").filter((p) => p.length > 2);
  let matches = 0;

  partes.forEach((p) => {
    if (textoNormal.includes(p)) matches++;
  });

  const proporcao = partes.length ? matches / partes.length : 0;

  if (proporcao >= 0.8) score += 20;

  if (estado && textoNormal.includes(normalizeName(estado))) {
    score += 15;
  }

  return score;
}

function calcularIdentidade({ nome, estado, html, title, snippet }) {
  const texto = normalizeName(`${title || ""} ${snippet || ""} ${html || ""}`);
  const nomeBase = normalizeName(nome);

  let score = 0;

  if (texto.includes(nomeBase)) score += 50;

  const partes = nomeBase.split(" ").filter((p) => p.length > 2);
  let match = 0;

  partes.forEach((p) => {
    if (texto.includes(p)) match++;
  });

  const proporcao = partes.length ? match / partes.length : 0;

  if (proporcao > 0.8) score += 25;
  else if (proporcao > 0.6) score += 15;

  if (estado && texto.includes(normalizeName(estado))) {
    score += 15;
  }

  return Math.min(score, 100);
}

function classificarProcesso(texto = "") {
  texto = texto.toLowerCase();

  if (texto.includes("trabalhista")) return "Trabalhista";
  if (texto.includes("penal")) return "Penal";
  if (texto.includes("criminal")) return "Criminal";
  if (texto.includes("civil")) return "Civil";
  if (texto.includes("execução") || texto.includes("execucao")) return "Execução";

  return "Não identificado";
}

function calcularPrioridade(r) {
  if (r.cpfEncontrado) return "URGENTE";
  if (r.confidence > 85) return "ALTA";
  if (r.confidence > 65) return "MÉDIA";

  return "BAIXA";
}

function cruzarResultados(resultados) {
  return resultados.map((r) => {
    let boost = 0;

    resultados.forEach((other) => {
      if (r === other) return;

      const mesmoTitulo =
        normalizeName(r.title) === normalizeName(other.title);

      const mesmoProcesso =
        Array.isArray(r.processNumbers) &&
        Array.isArray(other.processNumbers) &&
        r.processNumbers.some((p) => other.processNumbers.includes(p));

      if (mesmoTitulo || mesmoProcesso) {
        boost += 10;
      }
    });

    return {
      ...r,
      confidence: Math.min(100, r.confidence + boost),
    };
  });
}

const nodemailer = require("nodemailer");

app.post("/send-email", async (req, res) => {
  const { nome, email, whatsapp, mensagem } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Site Mais Justiça" <${process.env.EMAIL_USER}>`,
      to: "seuemail@gmail.com",
      subject: "Novo contato do site",
      html: `
        <h2>Novo lead</h2>
        <p><b>Nome:</b> ${nome}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>WhatsApp:</b> ${whatsapp}</p>
        <p><b>Mensagem:</b> ${mensagem}</p>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao enviar email" });
  }
});
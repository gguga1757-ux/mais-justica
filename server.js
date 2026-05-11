require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");

const { securityConfig, validateEnvironment } = require("./config/security");
const {
  apiKeyAuth,
  applySecurityMiddleware,
  jsonBodyParser,
  originGuard,
  requestSignatureAuth,
  urlEncodedBodyParser,
} = require("./middlewares/security");
const {
  apiLimiter,
  bruteForceLimiter,
  enumerationDelay,
  generalLimiter,
  scanLimiter,
  scanSlowDown,
} = require("./middlewares/rateLimit");
const {
  contactSchema,
  escapeHtml,
  officialProcessSchema,
  rejectUnsafeQuery,
  scanSchema,
  validateBody,
} = require("./middlewares/validation");
const {
  asyncHandler,
  createHttpError,
  errorHandler,
  notFoundHandler,
} = require("./handlers/errorHandler");
const logger = require("./utils/logger");

const app = express();

validateEnvironment(logger);

app.disable("x-powered-by");
app.set("trust proxy", securityConfig.trustProxy);

applySecurityMiddleware(app);
app.use(generalLimiter);
app.use(jsonBodyParser);
app.use(urlEncodedBodyParser);
app.use(rejectUnsafeQuery);
app.use(apiKeyAuth);
app.use(originGuard);
app.use(requestSignatureAuth);
app.use(apiLimiter);

const CONFIG = {
  serpApiKey: securityConfig.serpApiKey,
  port: securityConfig.port,
  timeoutMs: securityConfig.externalTimeoutMs,
  delayMs: securityConfig.scanDelayMs,
  minConfidence: securityConfig.minConfidence,
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

const NAME_MATCH_LEVELS = {
  EXACT_NAME: "EXACT_NAME",
  STRONG_NAME: "STRONG_NAME",
  WEAK_NAME: "WEAK_NAME",
  NO_MATCH: "NO_MATCH",
};

const NAME_CONNECTORS = new Set([
  "da",
  "de",
  "di",
  "do",
  "du",
  "das",
  "dos",
  "e",
]);

function normalizeName(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForNameMatch(text = "") {
  return normalizeName(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlForNameMatch(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function getMainNameParts(nome = "") {
  return normalizeForNameMatch(nome)
    .split(" ")
    .filter((part) => part.length > 2 && !NAME_CONNECTORS.has(part));
}

function hasAllPartsClose(tokens, parts) {
  if (!tokens.length || !parts.length) return false;

  const needed = new Set(parts);
  const maxWindow = Math.min(
    18,
    Math.max(parts.length + 4, parts.length * 3)
  );

  for (let start = 0; start < tokens.length; start++) {
    const found = new Set();

    for (
      let cursor = start;
      cursor < tokens.length && cursor < start + maxWindow;
      cursor++
    ) {
      if (needed.has(tokens[cursor])) {
        found.add(tokens[cursor]);
      }

      if (found.size === needed.size) {
        return true;
      }
    }
  }

  return false;
}

function compareNameStrict(nome, texto = "") {
  const normalizedName = normalizeForNameMatch(nome);
  const normalizedText = normalizeForNameMatch(texto);
  const mainParts = getMainNameParts(nome);

  if (!normalizedName || !normalizedText || !mainParts.length) {
    return {
      level: NAME_MATCH_LEVELS.NO_MATCH,
      score: 0,
      exact: false,
      matchedParts: [],
      missingParts: mainParts,
      totalMainParts: mainParts.length,
    };
  }

  const tokens = normalizedText.split(" ").filter(Boolean);
  const tokenSet = new Set(tokens);
  const matchedParts = mainParts.filter((part) => tokenSet.has(part));
  const missingParts = mainParts.filter((part) => !tokenSet.has(part));
  const exact = ` ${normalizedText} `.includes(` ${normalizedName} `);

  if (exact) {
    return {
      level: NAME_MATCH_LEVELS.EXACT_NAME,
      score: 65,
      exact: true,
      matchedParts,
      missingParts: [],
      totalMainParts: mainParts.length,
    };
  }

  if (
    missingParts.length === 0 &&
    hasAllPartsClose(tokens, mainParts)
  ) {
    return {
      level: NAME_MATCH_LEVELS.STRONG_NAME,
      score: 45,
      exact: false,
      matchedParts,
      missingParts: [],
      totalMainParts: mainParts.length,
    };
  }

  if (matchedParts.length > 0) {
    return {
      level: NAME_MATCH_LEVELS.WEAK_NAME,
      score: 10,
      exact: false,
      matchedParts,
      missingParts,
      totalMainParts: mainParts.length,
    };
  }

  return {
    level: NAME_MATCH_LEVELS.NO_MATCH,
    score: 0,
    exact: false,
    matchedParts: [],
    missingParts,
    totalMainParts: mainParts.length,
  };
}

function bestNameMatch(...matches) {
  const order = {
    [NAME_MATCH_LEVELS.EXACT_NAME]: 4,
    [NAME_MATCH_LEVELS.STRONG_NAME]: 3,
    [NAME_MATCH_LEVELS.WEAK_NAME]: 2,
    [NAME_MATCH_LEVELS.NO_MATCH]: 1,
  };

  return matches.reduce(
    (best, current) =>
      order[current.level] > order[best.level] ? current : best,
    {
      level: NAME_MATCH_LEVELS.NO_MATCH,
      score: 0,
      exact: false,
      matchedParts: [],
      missingParts: [],
      totalMainParts: 0,
    }
  );
}

function compareNameInFields({ nome, title, snippet, html }) {
  const htmlText = html ? stripHtmlForNameMatch(html) : "";
  const titleMatch = compareNameStrict(nome, title || "");
  const snippetMatch = compareNameStrict(nome, snippet || "");
  const htmlMatch = compareNameStrict(nome, htmlText);
  const combinedMatch = compareNameStrict(
    nome,
    `${title || ""} ${snippet || ""} ${htmlText}`
  );
  const best = bestNameMatch(
    titleMatch,
    snippetMatch,
    htmlMatch,
    combinedMatch
  );

  return {
    ...best,
    locations: {
      title: titleMatch.level,
      snippet: snippetMatch.level,
      html: html ? htmlMatch.level : NAME_MATCH_LEVELS.NO_MATCH,
      combined: combinedMatch.level,
    },
  };
}

function isReliableNameMatch(level) {
  return (
    level === NAME_MATCH_LEVELS.EXACT_NAME ||
    level === NAME_MATCH_LEVELS.STRONG_NAME
  );
}

function nameInText(nome, texto) {
  return isReliableNameMatch(compareNameStrict(nome, texto).level);
}

function isTrustedLegalSource(url = "") {
  const src = getSourceInfo(url);
  return ["juridica_agregadora", "oficial_juridica"].includes(src.category);
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
  nameMatch,
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

  const nomeMatch =
    nameMatch ||
    compareNameInFields({
      nome,
      title,
      snippet,
      html,
    });

  const nomeConfirmado = isReliableNameMatch(nomeMatch.level);

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
    nameMatchLevel: nomeMatch.level,
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
      `site:jusbrasil.com.br ${q}`,
      `site:jusbrasil.com.br ${q} processo`,
      `site:jusbrasil.com.br ${q}${st}`,

      `site:escavador.com ${q}`,
      `site:escavador.com ${q} processo`,
      `site:escavador.com ${q}${st}`,

      `site:verificaprocesso.com ${q}`,
      `site:processoweb.com.br ${q}`,

      `${q} processo`,
      `${q} jusbrasil`,
      `${q} escavador`,
      `${q} diário oficial`,
      `${q} diario oficial`,
      `${q} processo judicial`,
      `${q} tribunal`,
      `site:jus.br ${q}`,
      `site:gov.br ${q} processo`
    );
  }

  if (incluirExposicao) {
    queries.push(
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
  const src = getSourceInfo(url);
  const nameMatch = compareNameInFields({
    nome,
    title,
    snippet,
    html,
  });

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
      nameMatch,
      approval: {
        approved: false,
        byName: false,
        byCpf: false,
        byCnj: false,
        hasStrongLegalEvidence: false,
      },
      discardReason: "pagina generica ou rede social",
    };
  }

  const processNumbers = extractProcessNumbers(fullText);

  const cpfCheck =
    cpf && fullText
      ? detectCpfInText(cpf, fullText)
      : {
          found: false,
          masked: null,
        };

  const dadosSensiveis = detectarDadosSensiveis(fullText, cpf);

  if (nameMatch.level === NAME_MATCH_LEVELS.EXACT_NAME) {
    score += 45;
    evidence.push("EXACT_NAME: nome completo exato");
  } else if (nameMatch.level === NAME_MATCH_LEVELS.STRONG_NAME) {
    score += 35;
    evidence.push("STRONG_NAME: todas as partes principais proximas");
  } else if (nameMatch.level === NAME_MATCH_LEVELS.WEAK_NAME) {
    score += 5;
    evidence.push(
      `WEAK_NAME: partes encontradas (${nameMatch.matchedParts.join(", ")})`
    );
  } else {
    evidence.push("NO_MATCH: nome nao encontrado");
  }

  if (isReliableNameMatch(nameMatch.locations.title)) {
    score += 15;
    evidence.push(`nome no titulo (${nameMatch.locations.title})`);
  }

  if (isReliableNameMatch(nameMatch.locations.snippet)) {
    score += 10;
    evidence.push(`nome no snippet (${nameMatch.locations.snippet})`);
  }

  if (isReliableNameMatch(nameMatch.locations.html)) {
    score += 10;
    evidence.push(`nome confirmado na pagina (${nameMatch.locations.html})`);
  }

  const possuiTermoJuridicoForte = STRONG_LEGAL_TERMS.some((term) =>
    term.test(fullText)
  );

  const possuiTermoJuridicoForteSemCnj = STRONG_LEGAL_TERMS.some(
    (term) => !term.toString().includes("\\d{7}") && term.test(fullText)
  );

  if (possuiTermoJuridicoForte) {
    score += 15;
    evidence.push("termo juridico forte");
  }

  const weakCount = WEAK_LEGAL_TERMS.filter((t) => t.test(fullText)).length;

  if (weakCount > 0) {
    score += Math.min(weakCount * 3, 10);
    evidence.push(`${weakCount} termo(s) jurídico(s)`);
  }

  if (processNumbers.length > 0) {
    score += 25;
    evidence.push(`número CNJ: ${processNumbers[0]}`);
  }

  score += src.weight;
  evidence.push(`fonte: ${src.name}`);

  const cpfResult = cpfCheck;

  if (cpfResult.found) {
    score += 35;
    evidence.push("CPF informado encontrado na pagina");
  } else if (dadosSensiveis.cpf && isReliableNameMatch(nameMatch.level)) {
    score += 20;
    evidence.push("CPF detectado no conteudo");
  }

  if (isReliableNameMatch(nameMatch.level)) {
    score += 10;
    evidence.push("nome confirmado por match rigido");
  }

  const hasStrongLegalEvidence =
    possuiTermoJuridicoForteSemCnj ||
    weakCount >= 2 ||
    ["juridica_agregadora", "oficial_juridica"].includes(src.category);

  const approval = {
    byName: isReliableNameMatch(nameMatch.level),
    byCpf: cpfResult.found,
    byCnj:
      processNumbers.length > 0 &&
      hasStrongLegalEvidence &&
      nameMatch.level !== NAME_MATCH_LEVELS.WEAK_NAME,
    hasStrongLegalEvidence,
  };

  approval.approved = approval.byName || approval.byCpf || approval.byCnj;

  if (approval.byCpf) {
    score = Math.max(score, 92);
  }

  if (nameMatch.level === NAME_MATCH_LEVELS.EXACT_NAME) {
    score = Math.max(score, 88);
  }

  if (nameMatch.level === NAME_MATCH_LEVELS.STRONG_NAME) {
    score = Math.max(score, 85);
  }

  if (approval.byCnj) {
    score = Math.max(score, 85);
  }

  if (isGenericNamePage(url, title)) score -= 30;
  if (url.includes("/search")) score -= 20;

  let discardReason = null;

  if (!approval.approved) {
    if (nameMatch.level === NAME_MATCH_LEVELS.WEAK_NAME) {
      discardReason =
        "nome parcial: faltam partes principais do nome completo";
    } else {
      discardReason =
        "sem EXACT_NAME/STRONG_NAME, sem CPF informado e sem CNJ com evidencia juridica forte";
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    evidence,
    processNumbers,
    cpfResult,
    dadosSensiveis,
    nameMatch,
    approval,
    discardReason,
  };
}

const scoreToRisk = (s) => (s >= 70 ? "alto" : s >= 50 ? "medio" : "baixo");

const scoreToMatchLevel = (score, cpfOk, matchScore = 0, nameMatchLevel = "") => {
  if (cpfOk) return "forte";
  if (nameMatchLevel === NAME_MATCH_LEVELS.EXACT_NAME) return "exato";
  if (nameMatchLevel === NAME_MATCH_LEVELS.STRONG_NAME) return "forte";
  if (nameMatchLevel === NAME_MATCH_LEVELS.WEAK_NAME) return "fraco";
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

      const fontesDiferentes =
        r.source &&
        other.source &&
        normalizeName(r.source) !== normalizeName(other.source);

      if (mesmoProcesso || (mesmoTitulo && fontesDiferentes)) {
        boost += fontesDiferentes ? 10 : 5;
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
      if (!hit.url) continue;

      if (isBlocklisted(hit.url)) {
        console.log(`  [DISCARD] ${hit.url} | motivo: blocklist`);
        continue;
      }

      if (seen.has(hit.url)) {
        continue;
      }

      if (hit.url && !seen.has(hit.url)) {
        seen.add(hit.url);
        rawResults.push({
          ...hit,
          query,
        });
        console.log(`  [FOUND] ${hit.url}`);
      }
    }

    await sleep(CONFIG.delayMs);
  }

  console.log(`[SCAN] ${rawResults.length} URLs coletadas — analisando HTML...`);

  const processed = [];

  for (const { url, title, snippet, query } of rawResults) {
    const pre = scoreResult({
      nome,
      url,
      title,
      snippet,
      html: null,
      cpf,
    });

    console.log(
      `  [PRE] ${url} | match=${pre.nameMatch.level} | score=${pre.score}`
    );

    if (
      !pre.approval.approved &&
      pre.nameMatch.level === NAME_MATCH_LEVELS.NO_MATCH &&
      !isTrustedLegalSource(url)
    ) {
      console.log(
        `  [DISCARD] ${url} | motivo: ${pre.discardReason} | score=${pre.score}`
      );
      continue;
    }

    if (pre.score < 10 && !isTrustedLegalSource(url)) {
      console.log(
        `  [DISCARD] ${url} | motivo: pre-score baixo | score=${pre.score}`
      );
      continue;
    }

    await sleep(300);

    const html = await fetchPageHtml(url);

    if (!html && isTrustedLegalSource(url)) {
      console.log(
        `  [HTML] ${url} | falhou; usando titulo/snippet como fallback`
      );
    }

    const {
      score,
      evidence,
      processNumbers,
      cpfResult,
      nameMatch,
      approval,
      discardReason,
    } = scoreResult({
      nome,
      url,
      title,
      snippet,
      html,
      cpf,
    });

    console.log(
      `  [ANALYZE] ${url} | query="${query}" | match=${nameMatch.level} | title=${nameMatch.locations.title} | snippet=${nameMatch.locations.snippet} | html=${nameMatch.locations.html} | score=${score}`
    );

    if (!approval.approved) {
      console.log(
        `  [DISCARD] ${url} | motivo: ${discardReason} | score=${score}`
      );
      continue;
    }

    if (score < CONFIG.minConfidence) {
      console.log(
        `  [DISCARD] ${url} | motivo: score abaixo do minimo (${CONFIG.minConfidence}) | match=${nameMatch.level} | score=${score}`
      );
      continue;
    }

    const src = getSourceInfo(url);
    const risk = scoreToRisk(score);

    const matchScore = calcularMatchAvancado({
      nome,
      estado,
      title,
      snippet,
      html,
    });

    const matchLevel = scoreToMatchLevel(
      score,
      cpfResult.found,
      matchScore,
      nameMatch.level
    );

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
      nameMatch,
    });

    console.log(
      `  [ACCEPT] ${url} | match=${nameMatch.level} | score final=${score}`
    );

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
      nameMatchLevel: nameMatch.level,
      nameMatch,
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

  cruzado.forEach((r) => {
    console.log(
      `  [FINAL] ${r.url} | match=${r.nameMatchLevel} | score final=${r.confidence}`
    );
  });

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
 * Rotas publicas com hardening de API, validacao e anti-automacao.
 */
const protectedScanMiddlewares = [
  scanLimiter,
  scanSlowDown,
  enumerationDelay,
  validateBody(scanSchema),
];

async function executeScanRoute(req, res, modo, legacyResponse = false) {
  const { nome, estado, cpf } = req.body;

  logger.audit("scan_started", req, {
    mode: modo,
    hasCpf: Boolean(cpf),
    hasState: Boolean(estado),
  });

  const results = await runScan(nome, estado, cpf, modo);

  logger.audit("scan_completed", req, {
    mode: modo,
    totalResultados: results.length,
  });

  if (legacyResponse) {
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
        "Este sistema identifica possiveis exposicoes publicas. " +
        "Nao confirma a existencia de processos. Consulte sempre um advogado.",
    });
  }

  return res.json(
    montarRespostaEstruturada({
      nome,
      estado,
      cpf,
      results,
      modo,
    })
  );
}

app.post(
  "/scan",
  ...protectedScanMiddlewares,
  asyncHandler((req, res) => executeScanRoute(req, res, "full", true))
);

app.post(
  "/scan-exposure",
  ...protectedScanMiddlewares,
  asyncHandler((req, res) => executeScanRoute(req, res, "exposure"))
);

app.post(
  "/scan-processes",
  ...protectedScanMiddlewares,
  asyncHandler((req, res) => executeScanRoute(req, res, "processes"))
);

app.post(
  "/scan-full",
  ...protectedScanMiddlewares,
  asyncHandler((req, res) => executeScanRoute(req, res, "full"))
);

app.post(
  "/verificar-processo-oficial",
  bruteForceLimiter,
  enumerationDelay,
  validateBody(officialProcessSchema),
  asyncHandler(async (req, res) => {
    const resultado = await verificarProcessoOficial(req.body.numero);

    return res.json({
      sucesso: true,
      resultado,
    });
  })
);

app.post(
  "/send-email",
  bruteForceLimiter,
  validateBody(contactSchema),
  asyncHandler(async (req, res) => {
    const { nome, email, whatsapp, assunto, mensagem } = req.body;

    if (!securityConfig.emailUser || !securityConfig.emailPass) {
      throw createHttpError(
        503,
        "Servico de contato indisponivel.",
        "EMAIL_NOT_CONFIGURED"
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: securityConfig.emailUser,
        pass: securityConfig.emailPass,
      },
    });

    const safeSubject = assunto || "Novo contato do site";

    await transporter.sendMail({
      from: `"Site Mais Justica" <${securityConfig.emailUser}>`,
      replyTo: email,
      to: securityConfig.contactToEmail,
      subject: safeSubject,
      text: [
        "Novo lead",
        `Nome: ${nome}`,
        `Email: ${email}`,
        `WhatsApp: ${whatsapp || "Nao informado"}`,
        `Assunto: ${safeSubject}`,
        `Mensagem: ${mensagem}`,
      ].join("\n"),
      html: `
        <h2>Novo lead</h2>
        <p><b>Nome:</b> ${escapeHtml(nome)}</p>
        <p><b>Email:</b> ${escapeHtml(email)}</p>
        <p><b>WhatsApp:</b> ${escapeHtml(whatsapp || "Nao informado")}</p>
        <p><b>Assunto:</b> ${escapeHtml(safeSubject)}</p>
        <p><b>Mensagem:</b> ${escapeHtml(mensagem)}</p>
      `,
    });

    logger.audit("contact_email_sent", req);
    return res.json({ sucesso: true });
  })
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    searchMode: SEARCH_MODE,
    externalSearch: CONFIG.serpApiKey ? "configured" : "scrape-fallback",
    timestamp: new Date().toISOString(),
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(CONFIG.port, () => {
  logger.info({
    event: "server_started",
    port: CONFIG.port,
    searchMode: SEARCH_MODE,
    nodeEnv: securityConfig.nodeEnv,
  });
});

server.requestTimeout = securityConfig.requestTimeoutMs;
server.headersTimeout = securityConfig.requestTimeoutMs + 5000;

function calcularMatchAvancado({ nome, estado, title, snippet, html }) {
  const nameMatch = compareNameInFields({
    nome,
    title,
    snippet,
    html,
  });

  let score = nameMatch.score;

  const textoNormal = normalizeForNameMatch(
    `${title || ""} ${snippet || ""} ${stripHtmlForNameMatch(html || "")}`
  );

  if (estado && textoNormal.includes(normalizeName(estado))) {
    score += 15;
  }

  return score;
}

function calcularIdentidade({ nome, estado, html, title, snippet }) {
  const nameMatch = compareNameInFields({
    nome,
    title,
    snippet,
    html,
  });

  let score = nameMatch.score;

  const texto = normalizeForNameMatch(
    `${title || ""} ${snippet || ""} ${stripHtmlForNameMatch(html || "")}`
  );

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


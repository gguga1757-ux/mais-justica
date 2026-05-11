const { z } = require("zod");

const isProduction = process.env.NODE_ENV === "production";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mais-justica.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5500",
];

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  "^https://mais-justica(?:-[a-z0-9-]+)?\\.vercel\\.app$",
];

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(1),
    SERPAPI_KEY: z.string().optional(),

    FRONTEND_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional()
    ),
    ALLOWED_ORIGINS: z.string().optional(),
    ALLOWED_ORIGIN_PATTERNS: z.string().optional(),
    ALLOW_REQUESTS_WITHOUT_ORIGIN: z.string().optional(),
    BLOCK_UNKNOWN_ORIGIN: z.string().optional(),

    REQUIRE_API_KEY: z.string().optional(),
    API_KEYS: z.string().optional(),
    REQUIRE_REQUEST_SIGNATURE: z.string().optional(),
    REQUEST_SIGNATURE_SECRET: z.string().optional(),
    SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().min(30).default(300),

    JSON_BODY_LIMIT: z.string().default("32kb"),
    URLENCODED_BODY_LIMIT: z.string().default("16kb"),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
    EXTERNAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(12000),
    SCAN_DELAY_MS: z.coerce.number().int().min(0).default(800),
    MIN_CONFIDENCE: z.coerce.number().int().min(0).max(100).default(85),

    GENERAL_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(15 * 60 * 1000),
    GENERAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    SCAN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(8),
    BRUTE_FORCE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(12),
    SLOWDOWN_AFTER: z.coerce.number().int().min(0).default(2),
    SLOWDOWN_MAX_DELAY_MS: z.coerce.number().int().min(0).default(4000),

    CSP_REPORT_ONLY: z.string().optional(),
    CSP_REPORT_URI: z.string().optional(),

    EMAIL_USER: z.string().optional(),
    EMAIL_PASS: z.string().optional(),
    CONTACT_TO_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional()
    ),
  })
  .passthrough();

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compilePatterns(patterns) {
  return patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseApiKeys(value) {
  return splitCsv(value).map((entry) => {
    const [id, ...rest] = entry.includes(":") ? entry.split(":") : [];
    const key = rest.length ? rest.join(":") : entry;

    return {
      id: id || `key_${Buffer.from(key).toString("base64url").slice(0, 8)}`,
      key,
    };
  });
}

const env = envSchema.safeParse(process.env);

if (!env.success) {
  const details = env.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

const parsedEnv = env.data;

const allowedOrigins = [
  ...DEFAULT_ALLOWED_ORIGINS,
  parsedEnv.FRONTEND_URL,
  ...splitCsv(parsedEnv.ALLOWED_ORIGINS),
].filter(Boolean);

const allowedOriginPatterns = compilePatterns([
  ...DEFAULT_ALLOWED_ORIGIN_PATTERNS,
  ...splitCsv(parsedEnv.ALLOWED_ORIGIN_PATTERNS),
]);

const cspConnectSrc = [
  "'self'",
  "https://mais-justica-api.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...allowedOrigins,
];

function buildContentSecurityPolicy() {
  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'", "https://mais-justica-api.onrender.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https:"],
    "script-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
    "script-src-attr": ["'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "connect-src": [...new Set(cspConnectSrc)],
  };

  if (isProduction) {
    directives["upgrade-insecure-requests"] = [];
  }

  if (parsedEnv.CSP_REPORT_URI) {
    directives["report-uri"] = [parsedEnv.CSP_REPORT_URI];
  }

  return directives;
}

const securityConfig = {
  nodeEnv: parsedEnv.NODE_ENV,
  isProduction,
  port: parsedEnv.PORT,
  trustProxy: parsedEnv.TRUST_PROXY,
  serpApiKey: parsedEnv.SERPAPI_KEY || null,

  allowedOrigins: [...new Set(allowedOrigins)],
  allowedOriginPatterns,
  allowRequestsWithoutOrigin: parseBool(
    parsedEnv.ALLOW_REQUESTS_WITHOUT_ORIGIN,
    true
  ),
  blockUnknownOrigin: parseBool(parsedEnv.BLOCK_UNKNOWN_ORIGIN, false),

  requireApiKey: parseBool(parsedEnv.REQUIRE_API_KEY, false),
  apiKeys: parseApiKeys(parsedEnv.API_KEYS),
  requireRequestSignature: parseBool(
    parsedEnv.REQUIRE_REQUEST_SIGNATURE,
    false
  ),
  requestSignatureSecret: parsedEnv.REQUEST_SIGNATURE_SECRET || null,
  signatureMaxAgeSeconds: parsedEnv.SIGNATURE_MAX_AGE_SECONDS,

  jsonBodyLimit: parsedEnv.JSON_BODY_LIMIT,
  urlencodedBodyLimit: parsedEnv.URLENCODED_BODY_LIMIT,
  requestTimeoutMs: parsedEnv.REQUEST_TIMEOUT_MS,
  externalTimeoutMs: parsedEnv.EXTERNAL_TIMEOUT_MS,
  scanDelayMs: parsedEnv.SCAN_DELAY_MS,
  minConfidence: parsedEnv.MIN_CONFIDENCE,

  rateLimits: {
    windowMs: parsedEnv.GENERAL_RATE_LIMIT_WINDOW_MS,
    generalMax: parsedEnv.GENERAL_RATE_LIMIT_MAX,
    apiMax: parsedEnv.API_RATE_LIMIT_MAX,
    scanMax: parsedEnv.SCAN_RATE_LIMIT_MAX,
    bruteForceMax: parsedEnv.BRUTE_FORCE_RATE_LIMIT_MAX,
    slowdownAfter: parsedEnv.SLOWDOWN_AFTER,
    slowdownMaxDelayMs: parsedEnv.SLOWDOWN_MAX_DELAY_MS,
  },

  cspReportOnly: parseBool(parsedEnv.CSP_REPORT_ONLY, false),
  cspDirectives: buildContentSecurityPolicy(),

  emailUser: parsedEnv.EMAIL_USER || null,
  emailPass: parsedEnv.EMAIL_PASS || null,
  contactToEmail: parsedEnv.CONTACT_TO_EMAIL || "maisjustica.suporte@gmail.com",
};

function isAllowedOrigin(origin) {
  if (!origin) return securityConfig.allowRequestsWithoutOrigin;

  return (
    securityConfig.allowedOrigins.includes(origin) ||
    securityConfig.allowedOriginPatterns.some((pattern) => pattern.test(origin))
  );
}

function validateEnvironment(logger = console) {
  const warnings = [];

  if (securityConfig.requireApiKey && securityConfig.apiKeys.length === 0) {
    warnings.push("REQUIRE_API_KEY=true, but API_KEYS is empty.");
  }

  if (
    securityConfig.requireRequestSignature &&
    !securityConfig.requestSignatureSecret
  ) {
    warnings.push(
      "REQUIRE_REQUEST_SIGNATURE=true, but REQUEST_SIGNATURE_SECRET is empty."
    );
  }

  if (isProduction && !securityConfig.serpApiKey) {
    warnings.push("SERPAPI_KEY is missing; production will use scrape mode.");
  }

  if (isProduction && securityConfig.allowedOrigins.length === 0) {
    warnings.push("No CORS origin is configured for production.");
  }

  warnings.forEach((message) => logger.warn?.({ event: "env_warning", message }));

  if (
    isProduction &&
    warnings.some((message) => message.includes("API_KEYS is empty"))
  ) {
    throw new Error("Production API key protection is enabled without API_KEYS.");
  }
}

module.exports = {
  securityConfig,
  isAllowedOrigin,
  validateEnvironment,
};

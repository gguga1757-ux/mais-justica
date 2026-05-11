const { z } = require("zod");
const { createHttpError } = require("../handlers/errorHandler");
const logger = require("../utils/logger");

const SQLI_PATTERNS = [
  /\bunion\s+select\b/i,
  /\bselect\s+.+\bfrom\b/i,
  /\binsert\s+into\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\bsleep\s*\(/i,
  /\bbenchmark\s*\(/i,
  /--/,
  /\/\*/,
  /\*\//,
];

const NOSQL_PATTERNS = [
  /\$where/i,
  /\$ne/i,
  /\$gt/i,
  /\$gte/i,
  /\$lt/i,
  /\$lte/i,
  /\$regex/i,
  /\$or/i,
  /\$and/i,
  /__proto__/i,
  /constructor/i,
  /prototype/i,
];

const XSS_PATTERNS = [
  /<\s*script\b/i,
  /<\s*iframe\b/i,
  /<\s*object\b/i,
  /<\s*embed\b/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\bon\w+\s*=/i,
  /\{\{/,
  /\$\{/,
];

function sanitizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertSafePrimitive(value, path) {
  if (typeof value !== "string") return;

  const text = sanitizeText(value);
  const patterns = [...SQLI_PATTERNS, ...NOSQL_PATTERNS, ...XSS_PATTERNS];
  const matched = patterns.find((pattern) => pattern.test(text));

  if (matched) {
    const error = createHttpError(
      400,
      "Entrada rejeitada por politica de seguranca.",
      "SUSPICIOUS_INPUT",
      { path, reason: "dangerous_pattern" }
    );
    error.expose = true;
    throw error;
  }
}

function assertSafeInput(value, path = "body", depth = 0) {
  if (depth > 8) {
    throw createHttpError(400, "Payload muito profundo.", "PAYLOAD_TOO_DEEP", {
      path,
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeInput(item, `${path}[${index}]`, depth + 1)
    );
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      if (
        key.startsWith("$") ||
        NOSQL_PATTERNS.some((pattern) => pattern.test(key))
      ) {
        throw createHttpError(
          400,
          "Parametro rejeitado por politica de seguranca.",
          "SUSPICIOUS_KEY",
          { path: `${path}.${key}` }
        );
      }

      assertSafeInput(item, `${path}.${key}`, depth + 1);
    });
    return;
  }

  assertSafePrimitive(value, path);
}

function isValidCpf(value) {
  const cpf = String(value || "").replace(/\D/g, "");

  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;

  return digit === Number(cpf[10]);
}

const nameSchema = z.preprocess(
  (value) => sanitizeText(value),
  z
    .string()
    .min(5, "Nome completo deve ter no minimo 5 caracteres.")
    .max(120, "Nome completo excede o limite.")
    .regex(/^[\p{L}\s.'-]+$/u, "Nome contem caracteres invalidos.")
    .refine(
      (value) => value.split(/\s+/).filter(Boolean).length >= 2,
      "Informe nome e sobrenome."
    )
);

const optionalStateSchema = z.preprocess((value) => {
  const text = sanitizeText(value);
  return text || undefined;
}, z.string().min(2).max(40).regex(/^[\p{L}\s.-]+$/u).optional());

const optionalCpfSchema = z.preprocess((value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || undefined;
}, z.string().length(11).refine(isValidCpf, "CPF invalido.").optional());

const urlSchema = z
  .preprocess((value) => sanitizeText(value), z.string().url().max(2048))
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }, "URL deve usar HTTP ou HTTPS.");

const scanSchema = z
  .object({
    nome: nameSchema,
    estado: optionalStateSchema,
    cpf: optionalCpfSchema,
    cpfFormatado: z
      .preprocess((value) => sanitizeText(value), z.string().max(14).optional())
      .optional(),
    links: z.array(urlSchema).max(10).optional().default([]),
  })
  .strict();

const officialProcessSchema = z
  .object({
    numero: z.preprocess(
      (value) => sanitizeText(value),
      z
        .string()
        .min(10)
        .max(40)
        .regex(
          /^(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\d{20})$/,
          "Numero de processo invalido."
        )
    ),
  })
  .strict();

const contactSchema = z
  .object({
    nome: nameSchema,
    email: z.preprocess(
      (value) => sanitizeText(value).toLowerCase(),
      z.string().email().max(180)
    ),
    whatsapp: z.preprocess((value) => {
      const text = sanitizeText(value);
      return text || undefined;
    }, z.string().min(8).max(30).regex(/^[\d\s()+.-]+$/).optional()),
    assunto: z.preprocess((value) => {
      const text = sanitizeText(value);
      return text || undefined;
    }, z.string().min(3).max(120).optional()),
    mensagem: z.preprocess(
      (value) => sanitizeText(value),
      z.string().min(10).max(2000)
    ),
    website: z.preprocess((value) => sanitizeText(value), z.string().max(0).optional()),
  })
  .strict();

function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "body",
    message: issue.message,
  }));
}

function validateBody(schema) {
  return function validationMiddleware(req, _res, next) {
    try {
      assertSafeInput(req.body, "body");

      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        const details = formatZodIssues(parsed.error);
        logger.audit("validation_failed", req, { details });
        return next(
          createHttpError(400, "Requisicao invalida.", "VALIDATION_ERROR", details)
        );
      }

      req.body = parsed.data;
      return next();
    } catch (error) {
      logger.audit("validation_blocked", req, {
        code: error.code || "VALIDATION_BLOCKED",
        details: error.details,
      });
      return next(error);
    }
  };
}

function rejectUnsafeQuery(req, _res, next) {
  try {
    assertSafeInput(req.query, "query");
    return next();
  } catch (error) {
    logger.audit("query_blocked", req, {
      code: error.code || "QUERY_BLOCKED",
      details: error.details,
    });
    return next(error);
  }
}

module.exports = {
  assertSafeInput,
  contactSchema,
  escapeHtml,
  isValidCpf,
  officialProcessSchema,
  rejectUnsafeQuery,
  sanitizeText,
  scanSchema,
  validateBody,
};

const morgan = require("morgan");

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "cpf",
  "cpfFormatado",
  "email",
  "pass",
  "password",
  "senha",
  "token",
  "apiKey",
  "api_key",
  "x-api-key",
  "whatsapp",
  "telefone",
]);

function maskCpf(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 11) return "[redacted]";
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

function maskEmail(value = "") {
  const [user, domain] = String(value).split("@");
  if (!user || !domain) return "[redacted]";
  return `${user.slice(0, 2)}***@${domain}`;
}

function maskValue(key, value) {
  const normalizedKey = String(key || "").toLowerCase();

  if (normalizedKey.includes("cpf")) return maskCpf(value);
  if (normalizedKey.includes("email")) return maskEmail(value);
  if (normalizedKey.includes("authorization")) return "[redacted]";
  if (normalizedKey.includes("cookie")) return "[redacted]";
  if (normalizedKey.includes("key")) return "[redacted]";
  if (normalizedKey.includes("pass")) return "[redacted]";
  if (normalizedKey.includes("token")) return "[redacted]";

  return "[redacted]";
}

function redactSensitive(input, depth = 0) {
  if (depth > 5) return "[max-depth]";
  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input.slice(0, 25).map((item) => redactSensitive(item, depth + 1));
  }

  if (typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
          return [key, maskValue(key, value)];
        }

        return [key, redactSensitive(value, depth + 1)];
      })
    );
  }

  if (typeof input === "string") {
    return input
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (match) =>
        maskCpf(match)
      )
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        (match) => maskEmail(match)
      );
  }

  return input;
}

function getClientIp(req) {
  return req.ip || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "";
}

function safePath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0] || "/";
}

function log(level, payload) {
  const entry = {
    level,
    ts: new Date().toISOString(),
    ...redactSensitive(payload),
  };

  const line = JSON.stringify(entry);

  if (level === "error") return console.error(line);
  if (level === "warn") return console.warn(line);
  return console.log(line);
}

function info(payload) {
  log("info", payload);
}

function warn(payload) {
  log("warn", payload);
}

function error(payload) {
  log("error", payload);
}

function audit(event, req, extra = {}) {
  info({
    event,
    requestId: req?.id,
    ip: req ? getClientIp(req) : undefined,
    method: req?.method,
    path: req ? safePath(req) : undefined,
    userAgent: req?.headers?.["user-agent"],
    origin: req?.headers?.origin,
    apiClientId: req?.apiClient?.id,
    ...extra,
  });
}

const morganMiddleware = morgan(
  (tokens, req, res) =>
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "http_request",
      requestId: req.id,
      ip: getClientIp(req),
      method: tokens.method(req, res),
      path: safePath(req),
      status: Number(tokens.status(req, res)),
      responseTimeMs: Number(tokens["response-time"](req, res)),
      contentLength: tokens.res(req, res, "content-length") || 0,
      userAgent: req.headers["user-agent"],
      origin: req.headers.origin,
      apiClientId: req.apiClient?.id,
    }),
  {
    skip: (req) => safePath(req) === "/health",
    stream: {
      write: (message) => {
        try {
          console.log(message.trim());
        } catch {
          console.log(message);
        }
      },
    },
  }
);

function auditMiddleware(req, res, next) {
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      audit("http_error_response", req, { status: res.statusCode });
    }
  });

  next();
}

module.exports = {
  audit,
  auditMiddleware,
  error,
  getClientIp,
  info,
  maskCpf,
  maskEmail,
  morganMiddleware,
  redactSensitive,
  safePath,
  warn,
};

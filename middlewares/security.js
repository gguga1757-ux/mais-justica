const crypto = require("crypto");
const compression = require("compression");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

const { createHttpError } = require("../handlers/errorHandler");
const { isAllowedOrigin, securityConfig } = require("../config/security");
const logger = require("../utils/logger");

const SAFE_REQUEST_ID = /^[a-zA-Z0-9_.:-]{8,128}$/;

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  req.id =
    typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : crypto.randomUUID();

  res.setHeader("X-Request-Id", req.id);
  next();
}

function timeoutMiddleware(req, res, next) {
  req.setTimeout(securityConfig.requestTimeoutMs);
  res.setTimeout(securityConfig.requestTimeoutMs);
  next();
}

function permissionsPolicyMiddleware(_req, res, next) {
  res.setHeader(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", ")
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
}

function corsOptionsDelegate(req, callback) {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    return callback(null, {
      origin: origin || false,
      credentials: false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-API-Key",
        "X-Request-Id",
        "X-Signature",
        "X-Timestamp",
      ],
      exposedHeaders: ["RateLimit", "RateLimit-Policy", "Retry-After", "X-Request-Id"],
      maxAge: 86400,
      optionsSuccessStatus: 204,
    });
  }

  logger.audit("cors_origin_blocked", req, { blockedOrigin: origin });
  return callback(
    createHttpError(403, "Origem nao autorizada.", "CORS_ORIGIN_BLOCKED")
  );
}

function rejectDuplicateQueryParams(req, _res, next) {
  const duplicated = Object.entries(req.query || {}).find(([, value]) =>
    Array.isArray(value)
  );

  if (duplicated) {
    return next(
      createHttpError(
        400,
        "Parametro duplicado nao permitido.",
        "DUPLICATE_QUERY_PARAM",
        { param: duplicated[0] }
      )
    );
  }

  return next();
}

function originGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (origin && !isAllowedOrigin(origin)) {
    logger.audit("origin_guard_blocked", req, { blockedOrigin: origin });
    return next(
      createHttpError(403, "Origem nao autorizada.", "ORIGIN_NOT_ALLOWED")
    );
  }

  if (!origin && referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (!isAllowedOrigin(refererOrigin)) {
        logger.audit("referer_guard_blocked", req, { blockedOrigin: refererOrigin });
        return next(
          createHttpError(403, "Origem nao autorizada.", "REFERER_NOT_ALLOWED")
        );
      }
    } catch {
      return next(
        createHttpError(400, "Referer invalido.", "INVALID_REFERER")
      );
    }
  }

  if (
    securityConfig.blockUnknownOrigin &&
    !origin &&
    !referer &&
    !req.apiClient
  ) {
    logger.audit("missing_origin_blocked", req);
    return next(
      createHttpError(403, "Origem obrigatoria.", "MISSING_ORIGIN")
    );
  }

  return next();
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  if (left.length !== right.length) {
    crypto.timingSafeEqual(
      crypto.createHash("sha256").update(left).digest(),
      crypto.createHash("sha256").update(right).digest()
    );
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function apiKeyAuth(req, _res, next) {
  if (["OPTIONS"].includes(req.method) || req.path === "/health") return next();

  const providedKey = req.headers["x-api-key"];

  if (!securityConfig.requireApiKey && !providedKey) return next();

  const match = securityConfig.apiKeys.find((candidate) =>
    timingSafeEqualText(candidate.key, providedKey)
  );

  if (!match) {
    logger.audit("api_key_rejected", req);
    return next(
      createHttpError(401, "Credencial de API invalida.", "INVALID_API_KEY")
    );
  }

  req.apiClient = {
    id: match.id,
    authenticated: true,
  };

  return next();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function normalizeSignature(signature = "") {
  return String(signature).replace(/^sha256=/i, "").trim();
}

function requestSignatureAuth(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const signature = req.headers["x-signature"];
  const timestamp = req.headers["x-timestamp"];
  const shouldValidate =
    securityConfig.requireRequestSignature || Boolean(signature);

  if (!shouldValidate) return next();

  if (!securityConfig.requestSignatureSecret) {
    return next(
      createHttpError(
        500,
        "Assinatura de request nao configurada.",
        "SIGNATURE_NOT_CONFIGURED"
      )
    );
  }

  if (!signature || !timestamp) {
    logger.audit("request_signature_missing", req);
    return next(
      createHttpError(401, "Assinatura de request obrigatoria.", "SIGNATURE_MISSING")
    );
  }

  const timestampMs = Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000;
  const ageSeconds = Math.abs(Date.now() - timestampMs) / 1000;

  if (!Number.isFinite(timestampMs) || ageSeconds > securityConfig.signatureMaxAgeSeconds) {
    logger.audit("request_signature_expired", req, { ageSeconds });
    return next(
      createHttpError(401, "Assinatura expirada.", "SIGNATURE_EXPIRED")
    );
  }

  const path = String(req.originalUrl || req.url || "").split("?")[0] || "/";
  const bodyHash = sha256(req.rawBody || "");
  const payload = `${timestamp}.${req.method.toUpperCase()}.${path}.${bodyHash}`;
  const expected = crypto
    .createHmac("sha256", securityConfig.requestSignatureSecret)
    .update(payload)
    .digest("hex");

  if (!timingSafeEqualText(expected, normalizeSignature(signature))) {
    logger.audit("request_signature_rejected", req);
    return next(
      createHttpError(401, "Assinatura de request invalida.", "SIGNATURE_INVALID")
    );
  }

  return next();
}

const jsonBodyParser = express.json({
  limit: securityConfig.jsonBodyLimit,
  strict: true,
  type: ["application/json", "application/*+json"],
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
});

const urlEncodedBodyParser = express.urlencoded({
  extended: false,
  limit: securityConfig.urlencodedBodyLimit,
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
});

function applySecurityMiddleware(app) {
  app.use(requestIdMiddleware);
  app.use(timeoutMiddleware);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: securityConfig.cspDirectives,
        reportOnly: securityConfig.cspReportOnly,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      frameguard: { action: "deny" },
      hsts: securityConfig.isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
      noSniff: true,
      originAgentCluster: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );

  app.use(permissionsPolicyMiddleware);
  app.use(cors(corsOptionsDelegate));
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    })
  );
  app.use(logger.morganMiddleware);
  app.use(logger.auditMiddleware);
  app.use(rejectDuplicateQueryParams);
}

module.exports = {
  apiKeyAuth,
  applySecurityMiddleware,
  jsonBodyParser,
  originGuard,
  requestSignatureAuth,
  urlEncodedBodyParser,
};

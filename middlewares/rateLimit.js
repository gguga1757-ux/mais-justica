const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");

const { securityConfig } = require("../config/security");
const logger = require("../utils/logger");

const { ipKeyGenerator } = rateLimit;

function limiterKey(req) {
  if (req.apiClient?.id) return `client:${req.apiClient.id}`;
  return ipKeyGenerator ? ipKeyGenerator(req.ip) : req.ip;
}

function rateLimitHandler(req, res) {
  const retryAfter =
    req.rateLimit?.resetTime instanceof Date
      ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
      : undefined;

  logger.audit("rate_limit_blocked", req, {
    limit: req.rateLimit?.limit,
    used: req.rateLimit?.used,
    retryAfter,
  });

  if (retryAfter) {
    res.setHeader("Retry-After", String(retryAfter));
  }

  return res.status(429).json({
    sucesso: false,
    error: "Muitas requisicoes. Tente novamente mais tarde.",
    code: "RATE_LIMITED",
    retryAfter,
    requestId: req.id,
  });
}

function createLimiter({ max, windowMs, messageCode = "RATE_LIMITED" }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: limiterKey,
    skip: (req) => req.method === "OPTIONS" || req.path === "/health",
    handler: (req, res) => {
      req.rateLimitCode = messageCode;
      return rateLimitHandler(req, res);
    },
  });
}

const generalLimiter = createLimiter({
  max: securityConfig.rateLimits.generalMax,
  windowMs: securityConfig.rateLimits.windowMs,
  messageCode: "GLOBAL_RATE_LIMITED",
});

const apiLimiter = createLimiter({
  max: securityConfig.rateLimits.apiMax,
  windowMs: securityConfig.rateLimits.windowMs,
  messageCode: "API_RATE_LIMITED",
});

const scanLimiter = createLimiter({
  max: securityConfig.rateLimits.scanMax,
  windowMs: securityConfig.rateLimits.windowMs,
  messageCode: "SCAN_RATE_LIMITED",
});

const bruteForceLimiter = createLimiter({
  max: securityConfig.rateLimits.bruteForceMax,
  windowMs: securityConfig.rateLimits.windowMs,
  messageCode: "BRUTE_FORCE_RATE_LIMITED",
});

const scanSlowDown = slowDown({
  windowMs: securityConfig.rateLimits.windowMs,
  delayAfter: securityConfig.rateLimits.slowdownAfter,
  delayMs: (hits) => {
    const extraHits = Math.max(0, hits - securityConfig.rateLimits.slowdownAfter);
    return Math.min(extraHits * 500, securityConfig.rateLimits.slowdownMaxDelayMs);
  },
  maxDelayMs: securityConfig.rateLimits.slowdownMaxDelayMs,
  keyGenerator: limiterKey,
  skip: (req) => req.method === "OPTIONS" || req.path === "/health",
  validate: { delayMs: false },
});

function enumerationDelay(req, _res, next) {
  const minMs = 250;
  const maxMs = 950;
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));

  logger.audit("enumeration_delay_applied", req, { delayMs: delay });
  setTimeout(next, delay);
}

module.exports = {
  apiLimiter,
  bruteForceLimiter,
  enumerationDelay,
  generalLimiter,
  scanLimiter,
  scanSlowDown,
};

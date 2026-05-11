const logger = require("../utils/logger");

function createHttpError(status, message, code = "HTTP_ERROR", details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  error.expose = status >= 400 && status < 500;
  return error;
}

function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function normalizeError(err) {
  if (err?.type === "entity.too.large") {
    return createHttpError(
      413,
      "Payload acima do limite permitido.",
      "PAYLOAD_TOO_LARGE"
    );
  }

  if (err instanceof SyntaxError && "body" in err) {
    return createHttpError(400, "JSON invalido.", "INVALID_JSON");
  }

  return err;
}

function notFoundHandler(req, _res, next) {
  next(createHttpError(404, "Rota nao encontrada.", "NOT_FOUND"));
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const normalized = normalizeError(err);
  const status = Number(normalized.status || normalized.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const isProduction = process.env.NODE_ENV === "production";
  const expose = normalized.expose || safeStatus < 500;

  logger.error({
    event: "request_error",
    requestId: req.id,
    ip: logger.getClientIp(req),
    method: req.method,
    path: logger.safePath(req),
    status: safeStatus,
    code: normalized.code || "INTERNAL_ERROR",
    message: normalized.message,
    stack: isProduction ? undefined : normalized.stack,
    details: normalized.details,
  });

  return res.status(safeStatus).json({
    sucesso: false,
    error: expose ? normalized.message : "Erro interno ao processar requisicao.",
    code: normalized.code || "INTERNAL_ERROR",
    requestId: req.id,
    ...(isProduction ? {} : { details: normalized.details || undefined }),
  });
}

module.exports = {
  asyncHandler,
  createHttpError,
  errorHandler,
  notFoundHandler,
};

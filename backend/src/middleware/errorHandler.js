import { RelayError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

const CLIENT_ERROR_CODES = {
  "entity.too.large": "payload_too_large",
  "entity.parse.failed": "invalid_json",
  "charset.unsupported": "unsupported_media_type",
  "encoding.unsupported": "unsupported_media_type",
};

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "not_found", message: `No route for ${req.method} ${req.path}` },
  });
}

function isClientError({ status }) {
  return status >= 400 && status < 500;
}

// Express identifies error middleware by its four parameters.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, _next) {
  if (error instanceof RelayError) {
    const { code, message, details } = error;
    return res.status(error.status).json({ error: { code, message, details } });
  }
  if (isClientError(error)) {
    const code = CLIENT_ERROR_CODES[error.type] ?? "invalid_request";
    return res.status(error.status).json({ error: { code, message: "The request is not valid" } });
  }
  logger.error({ err: error, requestId: req.id }, "Unhandled API error");
  return res
    .status(500)
    .json({ error: { code: "internal_error", message: "Internal server error" } });
}

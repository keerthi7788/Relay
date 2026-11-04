export class RelayError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends RelayError {
  constructor(resource, id) {
    super("not_found", `${resource} '${id}' not found`, 404);
  }
}

export class ConflictError extends RelayError {
  constructor(code, message) {
    super(code, message, 409);
  }
}

export class UnauthorizedError extends RelayError {
  constructor(code, message) {
    super(code, message, 401);
  }
}

export class BadRequestError extends RelayError {
  constructor(code, message) {
    super(code, message, 400);
  }
}

export class PayloadTooLargeError extends RelayError {
  constructor(message) {
    super("payload_too_large", message, 413);
  }
}

export class RateLimitedError extends RelayError {
  constructor() {
    super("rate_limited", "Too many requests; slow down", 429);
  }
}

export class UnsupportedMediaTypeError extends RelayError {
  constructor(message) {
    super("unsupported_media_type", message, 415);
  }
}

export class InvalidDefinitionError extends RelayError {
  constructor(code, message, details) {
    super(code, message, 422, details);
  }
}

export class TransientError extends RelayError {
  constructor(code, message, { body, trace = {} } = {}) {
    super(code, message);
    this.body = body;
    this.trace = trace;
  }
}

export class PermanentError extends RelayError {
  constructor(code, message, trace = {}) {
    super(code, message);
    this.trace = trace;
  }
}

export class UpstreamRejectedError extends PermanentError {
  constructor(upstreamStatus, body, message) {
    super("upstream_rejected", message);
    this.upstreamStatus = upstreamStatus;
    this.body = body;
  }
}

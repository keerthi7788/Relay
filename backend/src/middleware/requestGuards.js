import { BadRequestError, UnsupportedMediaTypeError } from "../shared/errors.js";

const ENCODED_NULL = /%00/;
const ESCAPED_NULL = "\\u0000";

function hasBody(req) {
  return req.get("transfer-encoding") !== undefined || Number(req.get("content-length")) > 0;
}

// Postgres can't store a null byte, so it's turned away here rather than as a 500 later.
export function rejectNullBytes(req, _res, next) {
  const inBody = req.body !== undefined && JSON.stringify(req.body).includes(ESCAPED_NULL);
  if (ENCODED_NULL.test(req.originalUrl) || inBody) {
    throw new BadRequestError("invalid_request", "Null bytes aren't allowed");
  }
  next();
}

// Without this, a body sent as text would be ignored and a run would start with no input.
export function rejectNonJsonBody(req, _res, next) {
  if (hasBody(req) && !req.is("json")) {
    throw new UnsupportedMediaTypeError("Send the body as application/json");
  }
  next();
}

export function requireBody(req, _res, next) {
  if (!hasBody(req)) {
    throw new BadRequestError("invalid_request", "Body is empty");
  }
  next();
}

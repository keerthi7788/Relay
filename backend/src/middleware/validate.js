import { BadRequestError } from "../shared/errors.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const { path, message } = result.error.issues[0];
    throw new BadRequestError("invalid_request", `${path.join(".") || "body"}: ${message}`);
  }
  return result.data;
}

export function validateBody(schema) {
  return (req, _res, next) => {
    req.body = parse(schema, req.body ?? {});
    next();
  };
}

// Express 5 makes req.query read-only, so parsed values live on their own property.
export function validateQuery(schema) {
  return (req, _res, next) => {
    req.validatedQuery = parse(schema, req.query);
    next();
  };
}

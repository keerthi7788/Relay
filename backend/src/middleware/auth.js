import { UnauthorizedError } from "../shared/errors.js";
import { secretsMatch } from "../shared/secrets.js";

const BEARER_PREFIX = "Bearer ";
const SERVICE_PRINCIPAL = "demo-operator";

// People sign in for a JWT. Scripts such as the smoke test use the fixed service token.
export function requireAuth(auth, serviceToken) {
  return (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;

    const principal = secretsMatch(token, serviceToken)
      ? SERVICE_PRINCIPAL
      : token && auth.verify(token);
    if (!principal) {
      throw new UnauthorizedError("invalid_token", "Missing or invalid bearer token");
    }
    req.principal = principal;
    next();
  };
}

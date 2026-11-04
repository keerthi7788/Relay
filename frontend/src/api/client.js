const TOKEN_KEY = "relay.token";
const SIGNED_OUT = "relay:signed-out";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);

export function signOut({ expired = false } = {}) {
  sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent(SIGNED_OUT, { detail: { expired } }));
}

export function onSignedOut(listener) {
  const handler = (event) => listener(event.detail);
  window.addEventListener(SIGNED_OUT, handler);
  return () => window.removeEventListener(SIGNED_OUT, handler);
}

export async function request(method, path, body) {
  const token = getToken();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "unreachable", "Can't reach Relay.");
  }

  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;

  if (response.status === 401 && token) signOut({ expired: true });
  const error = payload?.error ?? {};
  throw new ApiError(
    response.status,
    error.code ?? "unknown",
    error.message ?? "Something went wrong. Try again.",
    error.details,
  );
}

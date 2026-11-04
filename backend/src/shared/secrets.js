import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET_BYTES = 18;

const digest = (value) => createHash("sha256").update(value).digest();

export function hashSecret(secret) {
  return digest(secret).toString("hex");
}

export function generateWebhookSecret() {
  return `whsec_${randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url")}`;
}

export function secretsMatch(provided, expected) {
  return typeof provided === "string" && timingSafeEqual(digest(provided), digest(expected));
}

export function secretMatchesHash(provided, expectedHash) {
  return (
    typeof provided === "string" &&
    typeof expectedHash === "string" &&
    timingSafeEqual(digest(provided), Buffer.from(expectedHash, "hex"))
  );
}

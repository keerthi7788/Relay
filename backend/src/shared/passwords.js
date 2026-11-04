import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const key = await derive(password, salt, KEY_LENGTH);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const key = await derive(password, salt, KEY_LENGTH);
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}

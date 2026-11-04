import { randomBytes } from "node:crypto";

export function newId(prefix) {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

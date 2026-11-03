import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const key = (await scrypt(password, Buffer.from(saltHex, "hex"), 32)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

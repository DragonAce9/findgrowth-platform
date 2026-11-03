import { createHash, createHmac } from "node:crypto";

/** Development constant. Override with FG_PII_SALT. Documented in .env.example. */
export const DEV_PII_SALT = "findgrowth-dev-salt";

export function piiSalt(): string {
  return process.env.FG_PII_SALT || DEV_PII_SALT;
}

export function armSalt(): string {
  return process.env.FG_ARM_SALT || piiSalt();
}

/**
 * HMAC-SHA256 of an email or phone. Idempotent: a value that already starts with `hmac1:` is returned as-is,
 * so a cut saved after redaction joins the same way on the next build.
 * This is the identity path. hashId (unsalted SHA-256) is not.
 */
export function piiHmac(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("hmac1:")) return trimmed;
  const normalized = trimmed.toLowerCase();
  return `hmac1:${createHmac("sha256", piiSalt()).update(normalized).digest("hex")}`;
}

/** Unsalted short hash. Not used for identity nodes. */
export function hashId(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function scrubUrl(url: string): string {
  return url.replace(/([?&](?:email|token|e)=)[^&]+/gi, "$1redacted");
}

export function configDigest(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

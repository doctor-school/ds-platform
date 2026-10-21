import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The API's one at-rest encryption envelope (003 EARS-64 / EARS-71, ADR-0015 §4).
 *
 * What it protects: values that are bearer material if a database or Redis
 * dump leaks — the sign-in-host record's Zitadel session id and session token,
 * and an entry intent's hand-off reference. Hashing is not enough for them: the
 * API must present them back to Zitadel (finalise an auth request, terminate the
 * session), so they are stored reversibly, under a key that never lives with
 * the data.
 *
 * Shape: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. AES-256-GCM with a
 * fresh random 96-bit IV per value and the 128-bit authentication tag checked
 * on open, so a flipped bit, a value sealed under another key or a value moved
 * to another row (when `context` is bound as additional authenticated data) is
 * refused, never decrypted into garbage. The version prefix is the rotation
 * seam: a later key gets `v2` and `openAtRest` learns to read both.
 *
 * The key is 32 raw bytes, configured as base64 (`SIGN_IN_RECORD_KEY`); it is
 * never logged and never part of an error message.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode a base64 key; `null` unless it is well-formed and exactly 32 bytes. */
export function parseAtRestKey(raw: string | undefined): Buffer | null {
  if (!raw || !BASE64.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === KEY_BYTES ? key : null;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error("at-rest key must be exactly 32 bytes");
  }
}

/** Seal `plaintext`; `context`, when given, must be presented again to open. */
export function sealAtRest(
  plaintext: string,
  key: Buffer,
  context?: string,
): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  if (context !== undefined) cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Open an envelope; `null` for every refusal — unknown version, malformed
 * envelope, wrong key, wrong context, tampered bytes — so a caller treats them
 * all as «no usable value» and never branches on which one it was.
 */
export function openAtRest(
  envelope: string,
  key: Buffer,
  context?: string,
): string | null {
  assertKey(key);
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    if (context !== undefined) decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

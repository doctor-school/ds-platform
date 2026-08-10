import { createHmac, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * RFC 6238 TOTP primitives (011 EARS-5/EARS-6, design §7).
 *
 * **Why this exists at all, given the factor lives in the IdP.** The real
 * adapter never computes a code — Zitadel registers and verifies the factor
 * (`IdpClient.startTotpRegistration` / `verifyTotpRegistration`). This module
 * exists so the **in-repo fake is not more permissive than the real one** (011
 * Constraints): a fake that accepted any six digits would make the whole
 * EARS-5/6/7 suite vacuous — the exact failure the recorded project rule
 * (_fakes reject what real rejects_) names. Modelling the real algorithm is the
 * only way a fake rejects a wrong code, a replayed code, and an expired code for
 * the same reasons the IdP does, rather than by a hand-written table of "known
 * bad" inputs.
 *
 * The e2e suites also derive the current code from the secret the enrollment
 * offer returned — which is exactly what an operator's authenticator app does,
 * so the test drives the production contract rather than a test-only back door.
 *
 * Parameters are the interoperable defaults every authenticator app assumes and
 * Zitadel emits in its provisioning URI: HMAC-SHA1, 6 digits, a 30-second step.
 */

/** TOTP time step, seconds (RFC 6238 §4 recommended default; what Zitadel emits). */
export const TOTP_STEP_SECONDS = 30;

/** Code length in digits — the `digits=6` every authenticator app defaults to. */
export const TOTP_DIGITS = 6;

/**
 * Steps of clock skew accepted on either side of the current one. One step (±30 s)
 * is the conventional tolerance: it absorbs a phone whose clock drifts and the
 * seconds a human spends transcribing, without widening the window a shoulder-surfed
 * code stays usable in.
 */
export const TOTP_SKEW_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes as unpadded RFC 4648 base32 — the shared-secret encoding authenticator apps read. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an unpadded base32 secret back to bytes. Throws on a character outside the alphabet. */
export function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A fresh 160-bit TOTP shared secret in base32 — the SHA-1 block size, which is
 * what RFC 4226 §4 recommends and what authenticator apps expect.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The counter (time step) a moment falls in — the `T` of RFC 6238 §4. */
export function totpCounter(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The RFC 4226 HOTP value of `secret` at `counter`, zero-padded to {@link TOTP_DIGITS}. */
export function hotpCode(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * The code an authenticator app shows for `secret` at `atMs`. The e2e suites call
 * this to submit the code an operator would read off their phone.
 */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  return hotpCode(secret, totpCounter(atMs));
}

/**
 * Verify `code` against `secret`, returning the **counter it matched** (so the
 * caller can record the consumed step and refuse a replay within its window) or
 * `undefined` when it matches no accepted step.
 *
 * Returning the counter rather than a boolean is what makes single-use
 * enforceable: EARS-6 requires that "a code accepted once shall not be accepted
 * again within its validity window", and the window is identified by the step.
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  atMs: number = Date.now(),
): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = totpCounter(atMs);
  for (let drift = -TOTP_SKEW_STEPS; drift <= TOTP_SKEW_STEPS; drift++) {
    const counter = current + drift;
    if (hotpCode(secret, counter) === code) return counter;
  }
  return undefined;
}

/**
 * Build the `otpauth://totp/...` provisioning URI an authenticator app scans —
 * the same shape Zitadel returns, so the fake's offer is structurally
 * indistinguishable from the real one and the screen has nothing to branch on.
 */
export function totpProvisioningUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

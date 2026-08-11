import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * RFC 6238 code generation for the browser E2E — the operator's phone, modelled.
 *
 * **Deliberately an independent implementation, not an import of `apps/api`.** The
 * whole point of the 011 enrollment arc is that a THIRD party (an authenticator
 * app) and the server derive the same six digits from a shared secret. A test that
 * imported the server's own generator would prove only that the code agrees with
 * itself; deriving it here, from the published algorithm and the secret the screen
 * rendered, is what proves the emitted provisioning material is genuinely
 * interoperable. A drift between the two implementations is exactly the failure
 * this test exists to catch.
 *
 * Parameters are the interoperable defaults the provisioning URI declares:
 * HMAC-SHA1, 6 digits, 30-second step.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret: string): Buffer {
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

/** The six digits an authenticator app would display for `secret` right now. */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
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
  return String(binary % 1_000_000).padStart(6, "0");
}

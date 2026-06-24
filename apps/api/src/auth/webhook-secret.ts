import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a webhook-presented shared secret against the
 * configured one (#119 (b), design §11). The Zitadel Action webhook (EARS-19) is
 * authenticated by `IDP_WEBHOOK_SECRET`; a naive `provided === expected` leaks
 * timing proportional to the matching-prefix length, letting an attacker recover
 * the secret byte-by-byte. `crypto.timingSafeEqual` compares in time independent
 * of the mismatch position.
 *
 * Fail-closed semantics are preserved:
 *   - an unset / empty `expected` rejects every call (the mirror-write surface is
 *     never open by default);
 *   - a missing `provided` rejects;
 *   - a length mismatch returns `false` WITHOUT throwing (`timingSafeEqual`
 *     throws `RangeError` on unequal-length buffers, and the length itself is a
 *     secret-leaking oracle) — we compare against a same-length copy of `expected`
 *     so the comparison still runs in constant time relative to the real secret,
 *     then AND in the length check.
 */
export function webhookSecretMatches(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || provided === undefined) return false;

  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");

  // timingSafeEqual requires equal-length buffers. Comparing the provided buffer
  // against an expected-length buffer (never against its own length) keeps the
  // work proportional to the real secret regardless of the provided length; the
  // separate length equality then gates the result. A length difference yields a
  // guaranteed-false byte compare (zero-filled tail) AND a false length check.
  const sameLength = providedBuf.length === expectedBuf.length;
  const probe = sameLength ? providedBuf : Buffer.alloc(expectedBuf.length);
  const bytesEqual = timingSafeEqual(probe, expectedBuf);

  return sameLength && bytesEqual;
}

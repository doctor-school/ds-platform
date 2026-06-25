import { describe, expect, it } from "vitest";
import { webhookSecretMatches } from "./webhook-secret.js";

/**
 * #119 (b): constant-time webhook-secret comparison (design §11). The Zitadel
 * Action webhook authenticates with a shared secret; the previous check was a
 * constant-string `!==`, a timing side-channel an attacker can exploit to learn
 * the secret byte-by-byte. The replacement uses `crypto.timingSafeEqual`, which
 * compares in time independent of where the first mismatching byte sits — and
 * must NOT throw / early-return on a length mismatch (that would itself leak the
 * secret length). The fail-closed-on-unset behavior is preserved.
 */
describe("webhookSecretMatches — #119 constant-time webhook auth", () => {
  it("EARS-19: fails closed when the expected secret is unset (undefined)", () => {
    expect(webhookSecretMatches("anything", undefined)).toBe(false);
  });

  it("EARS-19: fails closed when the expected secret is empty", () => {
    expect(webhookSecretMatches("anything", "")).toBe(false);
  });

  it("EARS-19: rejects when the provided secret is undefined", () => {
    expect(webhookSecretMatches(undefined, "s3cret")).toBe(false);
  });

  it("EARS-19: rejects a mismatching secret of equal length", () => {
    expect(webhookSecretMatches("s3cret", "S3CRET")).toBe(false);
  });

  it("EARS-19: does not throw and returns false on a length mismatch (no length leak)", () => {
    expect(() => webhookSecretMatches("short", "a-much-longer-secret")).not.toThrow();
    expect(webhookSecretMatches("short", "a-much-longer-secret")).toBe(false);
    expect(webhookSecretMatches("a-much-longer-provided-secret", "short")).toBe(
      false,
    );
  });

  it("EARS-19: accepts an exact match", () => {
    expect(webhookSecretMatches("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("EARS-19: handles multibyte/unicode secrets by byte comparison", () => {
    expect(webhookSecretMatches("naïve-секрет", "naïve-секрет")).toBe(true);
    expect(webhookSecretMatches("naïve-секрет", "naive-секрет")).toBe(false);
  });
});

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openAtRest, parseAtRestKey, sealAtRest } from "./at-rest.js";

// 003 EARS-64 / EARS-71 — the at-rest envelope the sign-in-host record (Zitadel
// session id + token) and the entry intent's hand-off reference are stored in.
describe("at-rest envelope (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("EARS-64: a sealed value opens back to the plaintext under the same key", () => {
    const sealed = sealAtRest("session-token-123", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("session-token-123");
    expect(openAtRest(sealed, key)).toBe("session-token-123");
  });

  it("EARS-64: every seal draws a fresh IV, so equal plaintexts never share a ciphertext", () => {
    expect(sealAtRest("same", key)).not.toBe(sealAtRest("same", key));
  });

  it("EARS-64: a tampered ciphertext, tag or IV is refused", () => {
    const sealed = sealAtRest("value", key);
    const [version, iv, tag, ct] = sealed.split(".") as [
      string,
      string,
      string,
      string,
    ];
    const flip = (part: string): string => {
      const bytes = Buffer.from(part, "base64url");
      bytes[0] = bytes[0]! ^ 0x01;
      return bytes.toString("base64url");
    };
    expect(openAtRest([version, iv, tag, flip(ct)].join("."), key)).toBeNull();
    expect(openAtRest([version, iv, flip(tag), ct].join("."), key)).toBeNull();
    expect(openAtRest([version, flip(iv), tag, ct].join("."), key)).toBeNull();
  });

  it("EARS-64: a value sealed under another key is refused", () => {
    const sealed = sealAtRest("value", key);
    expect(openAtRest(sealed, randomBytes(32))).toBeNull();
  });

  it("EARS-64: a value bound to one context is refused under another", () => {
    const sealed = sealAtRest("value", key, "row-a");
    expect(openAtRest(sealed, key, "row-a")).toBe("value");
    expect(openAtRest(sealed, key, "row-b")).toBeNull();
    expect(openAtRest(sealed, key)).toBeNull();
  });

  it("EARS-64: an unknown version or a malformed envelope is refused", () => {
    const sealed = sealAtRest("value", key);
    expect(openAtRest(sealed.replace(/^v1\./, "v2."), key)).toBeNull();
    expect(openAtRest("v1.only-two", key)).toBeNull();
    expect(openAtRest("", key)).toBeNull();
  });

  it("EARS-64: the key must decode from base64 to exactly 32 bytes", () => {
    expect(parseAtRestKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(parseAtRestKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseAtRestKey(randomBytes(33).toString("base64"))).toBeNull();
    expect(parseAtRestKey("not base64 at all!")).toBeNull();
    expect(parseAtRestKey("")).toBeNull();
  });

  it("EARS-64: sealing refuses a key of the wrong length", () => {
    expect(() => sealAtRest("value", randomBytes(16))).toThrow();
  });
});

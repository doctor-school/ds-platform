import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "./idp.fake.js";
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpProvisioningUri,
  verifyTotpCode,
} from "./totp.js";

/**
 * 011 EARS-5 — the TOTP primitives and the **fake-parity contract** the whole
 * enrollment/challenge suite rests on.
 *
 * 011 Constraints state it plainly: _"The fake IdP is never more permissive than
 * the real one … A fake that accepts any 6 digits would make the entire
 * EARS-5/6/7 suite vacuous."_ These are the four refusals the Zitadel TOTP verify
 * makes, asserted against the in-repo fake — wrong code, replayed code, expired
 * window, no registered factor. Without this file the e2e suites could be green
 * against a fake that says yes to everything.
 */
describe("TOTP primitives (011 EARS-5)", () => {
  it("EARS-5: base32 round-trips, so a transcribed secret and a scanned one are the same secret", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255, 42, 17]);
    expect(base32Decode(base32Encode(bytes))).toEqual(Buffer.from(bytes));
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("EARS-5: the provisioning URI carries the same secret it labels", () => {
    const secret = generateTotpSecret();
    const uri = totpProvisioningUri({
      issuer: "Doctor.School",
      account: "ops@ds.test",
      secret,
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\/Doctor\.School%3Aops%40ds\.test\?/);
    expect(new URL(uri.replace("otpauth://", "https://")).searchParams.get("secret")).toBe(
      secret,
    );
  });

  it("EARS-5: a code verifies inside its window and expires outside it", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const code = totpCode(secret, at);

    expect(verifyTotpCode(secret, code, at)).toBeTypeOf("number");
    // ±1 step of clock tolerance — a drifting phone still works.
    expect(
      verifyTotpCode(secret, code, at + TOTP_STEP_SECONDS * 1000),
    ).toBeTypeOf("number");
    // Two steps out is expired, not "close enough".
    expect(
      verifyTotpCode(secret, code, at + 3 * TOTP_STEP_SECONDS * 1000),
    ).toBeUndefined();
    // A different secret never produces the same code.
    expect(verifyTotpCode(generateTotpSecret(), code, at)).toBeUndefined();
  });
});

describe("FakeIdpClient TOTP parity (011 Constraints — the fake rejects what the real one rejects)", () => {
  const sub = "fake-sub-parity";

  it("EARS-5: a provisional factor is NOT a registered factor", async () => {
    const idp = new FakeIdpClient();
    await idp.startTotpRegistration(sub);
    // Started, never confirmed: an unverified enrollment must not read as a
    // usable second factor, or a half-enrolled admin is routed into a challenge
    // they cannot pass.
    expect(await idp.hasTotpFactor(sub)).toBe(false);
  });

  it("EARS-5: a wrong code is refused and confirms nothing", async () => {
    const idp = new FakeIdpClient();
    await idp.startTotpRegistration(sub);
    expect(await idp.verifyTotpRegistration(sub, "000000")).toBe(false);
    expect(await idp.hasTotpFactor(sub)).toBe(false);
  });

  it("EARS-5: a correct code registers the factor exactly once — a replay inside the window is refused", async () => {
    const idp = new FakeIdpClient();
    const { secret } = await idp.startTotpRegistration(sub);
    const code = totpCode(secret);

    expect(await idp.verifyTotpRegistration(sub, code)).toBe(true);
    expect(await idp.hasTotpFactor(sub)).toBe(true);
    // The step is consumed: the same code observed over a shoulder or in a proxy
    // log is worthless for the rest of its 30-second life.
    expect(await idp.verifyTotpRegistration(sub, code)).toBe(false);
  });

  it("EARS-5: a subject with no provisional factor verifies nothing", async () => {
    const idp = new FakeIdpClient();
    expect(await idp.verifyTotpRegistration("nobody", "123456")).toBe(false);
  });

  it("EARS-5: re-registering replaces the provisional factor — the old secret stops verifying", async () => {
    const idp = new FakeIdpClient();
    const first = await idp.startTotpRegistration(sub);
    const second = await idp.startTotpRegistration(sub);
    expect(second.secret).not.toBe(first.secret);

    expect(await idp.verifyTotpRegistration(sub, totpCode(first.secret))).toBe(
      false,
    );
    expect(await idp.verifyTotpRegistration(sub, totpCode(second.secret))).toBe(
      true,
    );
  });
});

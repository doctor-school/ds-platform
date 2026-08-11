import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "./idp.fake.js";
import type { IdpSession } from "./idp.types.js";
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

/**
 * 011 EARS-6 — the LOGIN-time factor check (`checkTotpFactor`), the seam the
 * challenge handler stands on.
 *
 * Same discipline as the block above and for the same reason: the whole EARS-6/7
 * e2e is only as strong as the fake's willingness to say no. A fake that accepted
 * an unregistered factor, a stale session token, or a replayed code would make
 * every downstream assertion vacuous — the recorded project rule (_fakes reject
 * what real rejects_) is load-bearing exactly here.
 */
describe("FakeIdpClient TOTP challenge parity (011 EARS-6)", () => {
  const password = "Aa1!ufficiently-long-pw";

  /** A logged-in subject holding a REGISTERED factor — the challenge fixture. */
  async function enrolled(): Promise<{
    idp: FakeIdpClient;
    session: IdpSession;
    secret: string;
    sub: string;
  }> {
    const idp = new FakeIdpClient();
    const { sub } = await idp.createUser({
      email: `chal-${Math.random().toString(36).slice(2)}@ds.test`,
      password,
    });
    const { secret } = await idp.startTotpRegistration(sub);
    expect(
      await idp.verifyTotpRegistration(sub, totpCode(secret)),
    ).toBe(true);
    const login = await idp.passwordLogin(
      (await idp.getUser(sub))!.email!,
      password,
    );
    expect(login.outcome).toBe("authenticated");
    return {
      idp,
      session: (login as { session: IdpSession }).session,
      secret,
      sub,
    };
  }

  it("EARS-6: a correct code passes and ROTATES the session token", async () => {
    const { idp, session, secret } = await enrolled();
    // The enrollment burned the current step, so the challenge asks for the next
    // one — exactly what an operator reading their phone a moment later gets.
    const code = totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);

    const checked = await idp.checkTotpFactor(session, code);
    expect(checked).not.toBeNull();
    expect(checked!.sessionToken).not.toBe(session.sessionToken);
    // The rotated handle is the live one; the stale one is dead, so a caller that
    // dropped the rotation fails HERE rather than only in production.
    await expect(idp.exchangeSessionForTokens(checked!)).resolves.toBeDefined();
    await expect(idp.exchangeSessionForTokens(session)).rejects.toThrow();
  });

  it("EARS-6: a wrong code, a replayed code and a stale session token are all refused", async () => {
    const { idp, session, secret } = await enrolled();
    expect(await idp.checkTotpFactor(session, "000000")).toBeNull();

    const code = totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
    const checked = await idp.checkTotpFactor(session, code);
    expect(checked).not.toBeNull();
    // Replay inside the same window — refused, and refused identically.
    expect(await idp.checkTotpFactor(checked!, code)).toBeNull();
    // The pre-rotation handle is no longer a valid proof-of-check.
    expect(await idp.checkTotpFactor(session, code)).toBeNull();
  });

  it("EARS-6: a subject with only a PROVISIONAL factor cannot pass a challenge", async () => {
    const idp = new FakeIdpClient();
    const email = `prov-${Math.random().toString(36).slice(2)}@ds.test`;
    const { sub } = await idp.createUser({ email, password });
    const { secret } = await idp.startTotpRegistration(sub);
    const login = await idp.passwordLogin(email, password);
    const session = (login as { session: IdpSession }).session;

    // Correct digits, unregistered factor: an unconfirmed enrollment is not a
    // second factor, so the challenge refuses rather than admitting a
    // half-enrolled principal.
    expect(await idp.checkTotpFactor(session, totpCode(secret))).toBeNull();
  });

  it("EARS-6: an unknown or terminated session is refused", async () => {
    const { idp, session, secret } = await enrolled();
    await idp.terminateSession(session);
    expect(
      await idp.checkTotpFactor(
        session,
        totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000),
      ),
    ).toBeNull();
  });

  it("EARS-6: a code burned on the ENROLLMENT verify cannot be replayed at the challenge", async () => {
    const idp = new FakeIdpClient();
    const email = `share-${Math.random().toString(36).slice(2)}@ds.test`;
    const { sub } = await idp.createUser({ email, password });
    const { secret } = await idp.startTotpRegistration(sub);
    const code = totpCode(secret);
    expect(await idp.verifyTotpRegistration(sub, code)).toBe(true);

    const login = await idp.passwordLogin(email, password);
    const session = (login as { session: IdpSession }).session;
    // One consumed-step ledger across both surfaces — splitting it would let a
    // shoulder-surfed enrollment code walk straight into a challenge.
    expect(await idp.checkTotpFactor(session, code)).toBeNull();
  });
});

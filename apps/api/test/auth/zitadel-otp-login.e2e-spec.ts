import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * EARS-6/7 real-adapter integration spec (design §3, §6, §11 — passwordless
 * OTP-login): `requestEmailOtp` → fetch the delivered code from Mailpit →
 * `loginWithEmailOtp` → `exchangeSessionForTokens` against a **running** Zitadel
 * v4, proving the live Session-v2 OTP wire shape #153 wired (challenge create →
 * code verify → checked-session → token exchange).
 *
 * Gated on the OIDC-application env (`IDP_ISSUER` + `IDP_CLIENT_ID` +
 * `IDP_SERVICE_TOKEN` + `IDP_REDIRECT_URI`) — the login path runs the full token
 * exchange, which needs the app config — mirroring the #122 token-exchange spec.
 * It SKIPS in the shared CI job (which sets only `DATABASE_URL`; `IDP_ISSUER` is
 * not in turbo `passThroughEnv`) and runs only against a provisioned dev-stand
 * whose Zitadel SMTP provider points at Mailpit and whose `ds-platform-dev` OIDC
 * app exists (`infra/dev-stand/idp/bootstrap.md`). The wire shape and claim
 * parsing are pinned deterministically by `src/auth/idp/zitadel.idp.spec.ts`;
 * here we prove the same path against a real instance.
 *
 * Per the e2e convention this spec deletes its own users by email on teardown
 * (FakeIdpClient's deterministic fake-sub collides on `users.zitadel_sub`
 * otherwise).
 *
 * SMS path (EARS-7): the dev-stand has NO SMS provider, so the `otpSms` challenge
 * cannot be delivered/read here — there is no Mailpit equivalent for SMS. We do
 * NOT fake it green. The SMS path is unit-pinned (`zitadel.idp.spec.ts`) and
 * declared here as a parity-only skip; it is live-verifiable only once a real SMS
 * provider is configured (same honest gap as `requestPhoneVerification`, #148).
 */
const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI;

/** Mailpit REST base — the dev-stand catch-all UI/API (recipe default :8025). */
const MAILPIT_BASE = (
  process.env.MAILPIT_URL ?? "http://truenas.local:8025"
).replace(/\/$/, "");

/**
 * Mints a password that satisfies the `@ds/schemas` creation baseline (which
 * since #147 mirrors the live Zitadel default complexity policy). Even on a
 * passwordless-login test the user must be created WITH a password (the
 * registration cascade always sets one), so we need a valid fixture.
 */
function livePassword(): string {
  return `Int-${Date.now()}-aA1!`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Extract a 6-ish-char OTP code from a Mailpit message's body. */
function extractCode(msg: { Text?: string; HTML?: string }): string | null {
  const haystack = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
  return (
    haystack.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    haystack.match(/[?&]code=([A-Z0-9]{4,12})\b/)?.[1] ??
    haystack.match(/\b([0-9]{6,8})\b/)?.[1] ??
    null
  );
}

/**
 * Poll Mailpit for the OTP mail to `email` delivered AFTER `afterIso` and pull
 * the code. Polled (not a fixed sleep) because SMTP delivery is async after the
 * 2xx send. The `afterIso` cutoff skips `createUser`'s own initial verification
 * mail so we only read the login-OTP code.
 */
async function fetchOtpCode(
  email: string,
  afterIso: string,
): Promise<string | null> {
  const after = Date.parse(afterIso);
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ ID?: string; Created?: string }>;
      };
      const hit = (data.messages ?? []).find(
        (m) => m.Created && Date.parse(m.Created) >= after,
      );
      if (hit?.ID) {
        const msgRes = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
        if (msgRes.ok) {
          const code = extractCode(
            (await msgRes.json()) as { Text?: string; HTML?: string },
          );
          if (code) return code;
        }
      }
    }
    await sleep(500);
  }
  return null;
}

describe.skipIf(!LIVE_OIDC)("Zitadel OTP login (integration)", () => {
  let client: ZitadelIdpClient;
  const createdEmails: string[] = [];

  const newEmail = (): string => {
    const email = `int-153-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(() => {
    client = new ZitadelIdpClient({
      baseUrl: process.env.IDP_ISSUER!,
      serviceToken: process.env.IDP_SERVICE_TOKEN!,
      clientId: process.env.IDP_CLIENT_ID!,
      clientSecret: process.env.IDP_CLIENT_SECRET,
      redirectUri: process.env.IDP_REDIRECT_URI!,
      ...(process.env.IDP_SCOPES
        ? { scopes: process.env.IDP_SCOPES.split(/\s+/).filter(Boolean) }
        : {}),
    });
  });

  afterAll(async () => {
    // Delete live test users by email (e2e convention) so reruns and the
    // FakeIdpClient-backed suites do not collide on the mirror's zitadel_sub.
    const base = process.env.IDP_ISSUER!.replace(/\/$/, "");
    const headers = {
      authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}`,
      "content-type": "application/json",
    };
    for (const email of createdEmails) {
      try {
        const search = await fetch(`${base}/v2/users`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            queries: [{ emailQuery: { emailAddress: email } }],
          }),
        });
        if (!search.ok) continue;
        const data = (await search.json()) as {
          result?: Array<{ userId?: string }>;
        };
        const userId = data.result?.[0]?.userId;
        if (userId) {
          await fetch(`${base}/v2/users/${userId}`, {
            method: "DELETE",
            headers,
          });
        }
      } catch {
        // Best-effort; the reconciliation sweep tolerates leftover users.
      }
    }
  });

  it("EARS-6: request email OTP → Mailpit → login → exchange yields real tokens", async () => {
    const email = newEmail();
    const created = await client.createUser({ email, password: livePassword() });
    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBeTruthy();

    // Some Zitadel OTP-Email configs require a VERIFIED email before the login
    // challenge will dispatch. Verify the address first (best-effort: if the
    // instance does not require it the round-trip still works). Read the create
    // mail's code, verify, then settle before requesting the login OTP.
    await sleep(3000);
    const verifySentAt = new Date().toISOString();
    await client.requestEmailVerification(created.sub);
    const verifyCode = await fetchOtpCode(email, verifySentAt);
    if (verifyCode) {
      await client.verifyEmail(created.sub, verifyCode);
    }
    await sleep(1000);

    // EARS-6 step 1: arm the login challenge — Zitadel mails the code.
    let tokens: Awaited<ReturnType<typeof client.exchangeSessionForTokens>> | null =
      null;
    for (let attempt = 0; attempt < 3 && !tokens; attempt++) {
      const sentAt = new Date().toISOString();
      await expect(client.requestEmailOtp(email)).resolves.toBeUndefined();

      const code = await fetchOtpCode(email, sentAt);
      expect(code, "login OTP code should be delivered to Mailpit").toBeTruthy();

      // EARS-6 step 2: verify the code → checked session.
      const session = await client.loginWithEmailOtp(email, code!);
      if (!session) {
        await sleep(2000);
        continue;
      }
      expect(session.sub).toBe(created.sub);

      // EARS-8 convergence: trade the checked session for real tokens.
      tokens = await client.exchangeSessionForTokens(session.zitadelSessionId);
    }
    expect(tokens, "exchange should mint tokens after OTP login").toBeTruthy();
    expect(tokens!.accessToken).toBeTruthy();
    expect(tokens!.refreshToken).toBeTruthy();
    expect(tokens!.claims.sub).toBe(created.sub);
  }, 45_000);

  // EARS-7 SMS path: the dev-stand has no SMS provider, so the otpSms challenge
  // cannot be delivered or read here. Declared honestly as skipped — NOT faked
  // green. The wire shape is unit-pinned in zitadel.idp.spec.ts; this becomes a
  // live round-trip only once a real SMS provider is configured (#148 gap class).
  it.skip("EARS-7: SMS OTP login (no SMS provider on the dev-stand — unit-pinned only)", () => {
    // Intentionally skipped — see the block above and zitadel.idp.spec.ts.
  });
});

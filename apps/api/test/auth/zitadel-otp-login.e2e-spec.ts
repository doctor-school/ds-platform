import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";
import { NOTIFICATION_SUBJECTS } from "../support/notification-subjects.js";

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
 * SMS path (EARS-7): the dev-stand Zitadel now has a generic HTTP SMS provider
 * pointing at the local `sms-sink` service (the SMS analogue of Mailpit;
 * infra/dev-stand/compose.core.yml + idp/provision.sh), so the `otpSms` challenge
 * code IS delivered to the sink and read back over its REST API — the exact mirror
 * of the email/Mailpit side-channel above (#170). We do NOT surface the code
 * through any api/BFF response (that would make the EARS-8/16 ack a code oracle,
 * or need a banned backdoor). SMS-Aero is the PRODUCTION sender (recorded in the
 * specs); the dev-stand never reaches it. NOT faked green — proven against REAL
 * Zitadel, with the same token-exchange convergence the email test asserts.
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

/** SMS-sink REST base — the dev-stand SMS catch-all (recipe default :8090). */
const SMS_SINK_BASE = (
  process.env.SMS_SINK_URL ?? "http://truenas.local:8090"
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

/**
 * Extract a 6-ish-char OTP code from a Mailpit message.
 *
 * The branded verify-email (#869, provision.sh step 8.ter) is CODE-ONLY: the
 * code leads the SUBJECT (`GX5AVU — код подтверждения Doctor.School`) and the
 * body renders it as ONE unbroken token — there is no `code=` link to scrape
 * any more. Subject-first, then the legacy body patterns (the login email-OTP
 * mail still renders `Code 12345678`).
 */
function extractCode(msg: {
  Subject?: string;
  Text?: string;
  HTML?: string;
}): string | null {
  const fromSubject = (msg.Subject ?? "").match(/^([A-Z0-9]{4,12})\s+—/)?.[1];
  if (fromSubject) return fromSubject;
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
 *
 * `subject` disambiguates the TWO mails a single address receives here — the
 * registration verify-email (a 6-char alphanumeric, e.g. `JS5CIC`) and the
 * login email-OTP (an 8-digit code) — exactly as the portal `support/mailpit`
 * helper does (#131). The subjects are `ru`-locked since #177 and centralized in
 * `support/notification-subjects` (`NOTIFICATION_SUBJECTS`), the single SoT-traced
 * home — a hardcoded English literal would match nothing live (#305). The
 * `afterIso` cutoff ALONE is not enough: `afterIso` is
 * the test host's `new Date()` while Mailpit's `Created` is the dev-stand's
 * server clock, and any host↔stand skew (the TrueNAS box is not 24/7, so NTP
 * drifts) can pull the stale verify-email mail into the `Created >= after`
 * window — the login step then reads the registration code and never verifies
 * (proven live, #170 triage). Selecting by subject makes the read deterministic
 * regardless of clock skew. The default (no `subject`) preserves timestamp-only
 * behaviour for callers that receive a single mail.
 */
async function fetchOtpCode(
  email: string,
  afterIso: string,
  subject?: string,
): Promise<string | null> {
  const after = Date.parse(afterIso);
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ ID?: string; Created?: string; Subject?: string }>;
      };
      const hit = (data.messages ?? []).find(
        (m) =>
          m.Created &&
          Date.parse(m.Created) >= after &&
          // Substring, not equality: the branded verify-email subject leads
          // with the dynamic code (#869), so callers pass the stable tail
          // (`NOTIFICATION_SUBJECTS`) and we match it anywhere in the subject.
          (!subject || (m.Subject ?? "").includes(subject)),
      );
      if (hit?.ID) {
        const msgRes = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
        if (msgRes.ok) {
          const code = extractCode(
            (await msgRes.json()) as {
              Subject?: string;
              Text?: string;
              HTML?: string;
            },
          );
          if (code) return code;
        }
      }
    }
    await sleep(500);
  }
  return null;
}

/**
 * Extract the OTP code from a stored SMS-sink webhook body. The login OTP
 * (`session.otp.sms.challenged`) renders an 8-digit code in the SMS text and in
 * `args.oTP`; the phone-verify code (`user.human.phone.code.added`) is a 6-char
 * alphanumeric in `args.code` and the rendered `… code to verify it VBX53M.` text
 * (proven live, #170). Prefer the structured args field, then scan the text —
 * same belt-and-suspenders shape as `extractCode` for Mailpit.
 */
function extractSmsCode(msg: {
  body?: string;
  json?: { args?: { code?: string; oTP?: string } } | null;
}): string | null {
  const fromArgs = msg.json?.args?.oTP ?? msg.json?.args?.code;
  if (fromArgs) return String(fromArgs);
  const s = msg.body ?? "";
  return (
    s.match(/code to verify it ([A-Z0-9]{4,12})/)?.[1] ??
    s.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    s.match(/\b([0-9]{6,8})\b/)?.[1] ??
    null
  );
}

/**
 * Poll the SMS sink for the message to `phone` delivered AFTER `afterIso` and
 * pull the code — the SMS analogue of `fetchOtpCode`. Polled because the Zitadel
 * HTTP-SMS webhook fires async after the 2xx. The sink indexes by recipient phone
 * (raw substring) and returns newest-first; the `afterIso` cutoff skips an earlier
 * message and `event` restricts to a `contextInfo.eventType` (the SMS analogue of
 * Mailpit's subject filter). This matters: the phone-verify SMS
 * (`user.human.phone.code.added`, a 6-char alphanumeric) and the login OTP
 * (`session.otp.sms.challenged`, 8 digits) can land within the same poll window,
 * and Zitadel re-renders the verify code AROUND the login send — without the
 * event filter the login step can read the stale verify code and never verify
 * (proven live, #170, the SMS twin of the email `Verify OTP` subject fix).
 */
async function fetchSmsCode(
  phone: string,
  afterIso: string,
  event?: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${SMS_SINK_BASE}/api/messages?to=${encodeURIComponent(phone)}` +
        `&after=${encodeURIComponent(afterIso)}` +
        (event ? `&event=${encodeURIComponent(event)}` : ""),
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{
          body?: string;
          json?: { args?: { code?: string; oTP?: string } } | null;
        }>;
      };
      const hit = (data.messages ?? [])[0]; // newest-first
      if (hit) {
        const code = extractSmsCode(hit);
        if (code) return code;
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
    const created = await client.createUser({
      email,
      password: livePassword(),
    });
    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBeTruthy();

    // Some Zitadel OTP-Email configs require a VERIFIED email before the login
    // challenge will dispatch. Verify the address first (best-effort: if the
    // instance does not require it the round-trip still works). Read the create
    // mail's code, verify, then settle before requesting the login OTP.
    await sleep(3000);
    const verifySentAt = new Date().toISOString();
    await client.requestEmailVerification(created.sub);
    const verifyCode = await fetchOtpCode(
      email,
      verifySentAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    if (verifyCode) {
      await client.verifyEmail(created.sub, verifyCode);
    }
    await sleep(1000);

    // EARS-6 step 1: arm the login challenge — Zitadel mails the code.
    let tokens: Awaited<
      ReturnType<typeof client.exchangeSessionForTokens>
    > | null = null;
    for (let attempt = 0; attempt < 3 && !tokens; attempt++) {
      const sentAt = new Date().toISOString();
      await expect(client.requestEmailOtp(email)).resolves.toBeUndefined();

      const code = await fetchOtpCode(
        email,
        sentAt,
        NOTIFICATION_SUBJECTS.verifyEmailOtp,
      );
      expect(
        code,
        "login OTP code should be delivered to Mailpit",
      ).toBeTruthy();

      // EARS-6 step 2: verify the code → checked session.
      const session = await client.loginWithEmailOtp(email, code!);
      if (!session) {
        await sleep(2000);
        continue;
      }
      expect(session.sub).toBe(created.sub);

      // EARS-8 convergence: trade the checked session for real tokens.
      tokens = await client.exchangeSessionForTokens(session);
    }
    expect(tokens, "exchange should mint tokens after OTP login").toBeTruthy();
    expect(tokens!.accessToken).toBeTruthy();
    expect(tokens!.refreshToken).toBeTruthy();
    expect(tokens!.claims.sub).toBe(created.sub);
  }, 45_000);

  // EARS-7 SMS path — the live round-trip, the SAME bar the EARS-6 email test
  // sets (#170). The dev-stand's generic HTTP SMS provider delivers the code to
  // the local sink (the SMS analogue of Mailpit), so the otpSms challenge is read
  // back over the sink REST API and verified end-to-end. The code never rides any
  // api/BFF response (no EARS-8/16 oracle, no backdoor). Proven against REAL
  // Zitadel — NOT faked green.
  it("EARS-7: request SMS OTP → sink → login → exchange yields real tokens", async () => {
    const email = newEmail();
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const created = await client.createUser({
      email,
      password: livePassword(),
      phone,
    });
    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBeTruthy();

    // The otpSms challenge requires a VERIFIED phone (live delta, #170: an
    // unverified phone yields a phone-verify SMS, not a login OTP). Verify the
    // phone first: read the deliberate phone-verify SMS from the sink and confirm.
    await sleep(2000);
    const verifyAt = new Date().toISOString();
    await client.requestPhoneVerification(created.sub);
    const verifyCode = await fetchSmsCode(
      phone,
      verifyAt,
      "user.human.phone.code.added",
    );
    expect(verifyCode, "phone-verify SMS should reach the sink").toBeTruthy();
    const verified = await client.verifyPhone(created.sub, verifyCode!);
    expect(verified).toBe(true);
    await sleep(1000);

    // EARS-7 step 1: arm the SMS login challenge — Zitadel sends the code.
    let tokens: Awaited<
      ReturnType<typeof client.exchangeSessionForTokens>
    > | null = null;
    for (let attempt = 0; attempt < 3 && !tokens; attempt++) {
      const sentAt = new Date().toISOString();
      await expect(client.requestSmsOtp(phone)).resolves.toBeUndefined();

      const code = await fetchSmsCode(
        phone,
        sentAt,
        "session.otp.sms.challenged",
      );
      expect(
        code,
        "login OTP code should be delivered to the sink",
      ).toBeTruthy();

      // EARS-7 step 2: verify the code → checked session.
      const session = await client.loginWithSmsOtp(phone, code!);
      if (!session) {
        await sleep(2000);
        continue;
      }
      expect(session.sub).toBe(created.sub);

      // EARS-8 convergence: trade the checked session for real tokens.
      tokens = await client.exchangeSessionForTokens(session);
    }
    expect(
      tokens,
      "exchange should mint tokens after SMS-OTP login",
    ).toBeTruthy();
    expect(tokens!.accessToken).toBeTruthy();
    expect(tokens!.refreshToken).toBeTruthy();
    expect(tokens!.claims.sub).toBe(created.sub);
  }, 45_000);
});

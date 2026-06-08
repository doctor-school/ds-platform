import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * EARS-3 real-adapter integration spec (design §4 — the email-verification
 * resend + verify round-trip): `requestEmailVerification` → `verifyEmail`
 * against a **running** Zitadel v4, with the delivered code fetched from the
 * dev-stand Mailpit catch-all.
 *
 * This pins the live wire shape #148 fixed: the send is
 * `POST /v2/users/{id}/email/resend` `{ sendCode: {} }` (the merged
 * `/email/_send_code` 404s live) and the verify is
 * `POST /v2/users/{id}/email/verify` (the merged `/email/_verify` also 404s
 * live — corrected in the same change so this round-trip is provable). The
 * `sendCode` oneof routes the code through Zitadel's SMTP notifier → Mailpit,
 * exactly like the production notifier path, so we assert delivery there rather
 * than echoing the secret inline.
 *
 * Gated on the live-IdP env (`IDP_ISSUER` + `IDP_SERVICE_TOKEN`), mirroring the
 * #145 `zitadel-create-user` pattern — it SKIPS in the shared CI job (which sets
 * only `DATABASE_URL`; `IDP_ISSUER` is not in turbo `passThroughEnv`) and runs
 * only against a provisioned dev-stand whose Zitadel SMTP provider points at
 * Mailpit (see `infra/dev-stand/idp/provision.sh` step 6).
 *
 * Per the e2e convention this spec deletes its own users by email on teardown
 * (FakeIdpClient's deterministic fake-sub collides on `users.zitadel_sub`
 * otherwise).
 */
const LIVE_IDP = !!process.env.IDP_ISSUER && !!process.env.IDP_SERVICE_TOKEN;

/** Mailpit REST base — the dev-stand catch-all UI/API (recipe default :8025). */
const MAILPIT_BASE = (
  process.env.MAILPIT_URL ?? "http://truenas.local:8025"
).replace(/\/$/, "");

/**
 * Mints a password that satisfies BOTH the `@ds/schemas` shape guard
 * (`min(8)`) AND the live Zitadel default policy (≥1 upper-case) — see the
 * #145 create-user spec for the rationale (the schema is deliberately weaker
 * than the IdP policy).
 */
function livePassword(): string {
  return `Int-${Date.now()}-aA1!`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Extract the 6-char verification code from a Mailpit message's body. */
function extractCode(msg: { Text?: string; HTML?: string }): string | null {
  const haystack = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
  return (
    haystack.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    haystack.match(/[?&]code=([A-Z0-9]{4,12})\b/)?.[1] ??
    null
  );
}

/**
 * Poll Mailpit for the verification mail to `email` delivered AFTER `afterIso`
 * and pull the code out of it. Zitadel's "Verify email" template carries the
 * code both as `(Code XXXXXX)` and in the `verify?code=XXXXXX` UI link; we match
 * either. Polled (not a fixed sleep) because SMTP delivery is async after the
 * 2xx send. The `afterIso` filter is essential: `createUser` ALSO fires an
 * initial verification email, and the `resend` invalidates that earlier code —
 * so we must skip the create-email and only accept the resend mail (otherwise we
 * would read a stale, already-superseded code and `verifyEmail` would 4xx).
 */
async function fetchVerificationCode(
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
      // Messages come newest-first; take the first one created after the resend.
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

describe.skipIf(!LIVE_IDP)("Zitadel email verification (integration)", () => {
  let client: ZitadelIdpClient;
  const createdEmails: string[] = [];

  const newEmail = (): string => {
    const email = `int-148-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(() => {
    client = new ZitadelIdpClient({
      baseUrl: process.env.IDP_ISSUER!,
      serviceToken: process.env.IDP_SERVICE_TOKEN!,
    });
  });

  afterAll(async () => {
    // Clean up live test users by email (e2e convention) so reruns and the
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

  it("EARS-3: resend → Mailpit → verify round-trips against real Zitadel (#148)", async () => {
    const email = newEmail();
    const created = await client.createUser({
      email,
      password: livePassword(),
    });
    expect(created.alreadyExisted).toBe(false);
    expect(created.sub).toBeTruthy();

    // Zitadel auto-runs an initial verification code-gen on human-user creation
    // (with a password set), and that generation FINALIZES a couple of seconds
    // later — server-side, asynchronously. A `resend` fired before it settles is
    // overwritten by the late create code, so the freshly-mailed resend code then
    // 4xxs on verify (proven live on the dev-stand). Let the create-side gen
    // settle before the resend so the resend is the authoritative, last code.
    await sleep(3000);

    // The full round-trip is wrapped in a short retry as a belt-and-braces guard
    // against the residual settle race; in steady state the first attempt passes.
    // Each attempt marks a cutoff so we read THAT attempt's mail, never a stale
    // earlier one (`createUser`'s own mail, or a prior attempt's).
    let verified = false;
    for (let attempt = 0; attempt < 3 && !verified; attempt++) {
      const sentAt = new Date().toISOString();
      // The #148 fix: this hop 404'd before (wrong path `/email/_send_code`).
      await expect(
        client.requestEmailVerification(created.sub),
      ).resolves.toBeUndefined();

      const code = await fetchVerificationCode(email, sentAt);
      expect(
        code,
        "verification code should be delivered to Mailpit",
      ).toBeTruthy();

      // Verify the delivered code — also proves the corrected `/email/verify` path.
      verified = await client.verifyEmail(created.sub, code!);
      if (!verified) await sleep(2000);
    }
    expect(verified).toBe(true);
    // Async SMTP delivery + the create/resend settle + retry run past vitest's 5s
    // default; this is a live cross-service round-trip, not a unit test.
  }, 30_000);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";
import { NOTIFICATION_SUBJECTS } from "../support/notification-subjects.js";

/**
 * EARS-3 real-adapter integration spec (design §4 — the email-verification
 * resend + verify round-trip): `requestEmailVerification` → `verifyEmail`
 * against a **running** Zitadel v4, with the delivered mail fetched from the
 * dev-stand Mailpit catch-all.
 *
 * This pins the live wire shape #148 fixed: the send is
 * `POST /v2/users/{id}/email/resend` `{ sendCode: {…} }` (the merged
 * `/email/_send_code` 404s live) and the verify is
 * `POST /v2/users/{id}/email/verify` (the merged `/email/_verify` also 404s
 * live — corrected in the same change so this round-trip is provable). The
 * `sendCode` oneof routes the code through Zitadel's SMTP notifier → Mailpit,
 * exactly like the production notifier path, so we assert delivery there rather
 * than echoing the secret inline.
 *
 * #869 (owner Stage-A + Stage-B verdicts): the delivered mail is the CODE-ONLY
 * branded RU artifact provisioned by `infra/dev-stand/idp/provision.sh` step
 * 8.ter — the subject leads with the code (`GX5AVU — код подтверждения
 * Doctor.School`, < 50 chars), the body shows the code as ONE unbroken token
 * (the Stage-B rework dropped the triad grouping and its «без пробела»
 * qualifier — they contradicted each other) with an explicit 1-hour expiry
 * line and an ignore-if-not-you line, and it carries **no link to
 * Zitadel's hosted login-v2 UI** (`…/ui/v2/…` — the original #869 dead end, and
 * scanner bait: mail.ru's `checklink` AV prefetch GETs every URL in a delivered
 * mail). The ONLY permitted href is the BARE portal `/verify` navigation aid —
 * no query, no `{{.Code}}`/`{{.UserID}}` params, nothing consumed on GET. This
 * spec asserts the rendered artifact facts explicitly, then proves the manual
 * journey: the code a human would read from the mail round-trips through
 * `verifyEmail`.
 *
 * Gated on the live-IdP env (`IDP_ISSUER` + `IDP_SERVICE_TOKEN`), mirroring the
 * #145 `zitadel-create-user` pattern — it SKIPS in the shared CI job (which sets
 * only `DATABASE_URL`; `IDP_ISSUER` is not in turbo `passThroughEnv`) and runs
 * only against a provisioned dev-stand whose Zitadel SMTP provider points at
 * Mailpit AND whose `verifyemail` message text carries the step-8.ter branding
 * (re-run `infra/dev-stand/idp/provision.sh` after pulling this change).
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
 * The portal origin the bare `/verify` navigation URL points at — the same
 * `MAILER_PORTAL_BASE_URL` source `IdpModule` plumbs into the adapter (#869),
 * defaulting to the api's own `DEFAULT_PORTAL_BASE_URL` recipe default.
 */
const PORTAL_BASE = (
  process.env.MAILER_PORTAL_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

/**
 * Mints a password that satisfies the `@ds/schemas` creation baseline
 * (`NewPassword`: ≥8 + upper + lower + digit + symbol) — which since #147 mirrors
 * the live Zitadel default complexity policy, so the same fixture clears both the
 * BFF contract and the IdP (Zitadel remains the authority and may be stricter).
 */
function livePassword(): string {
  return `Int-${Date.now()}-aA1!`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The delivered-mail slice the #869 artifact assertions need. */
interface VerificationMail {
  Subject: string;
  Text: string;
  HTML: string;
}

/**
 * Poll Mailpit for the verification mail to `email` delivered AFTER `afterIso`
 * and return the FULL message (subject + both bodies) — the #869 assertions
 * target the rendered artifact, not just the extracted code. Selected by the
 * stable branded-subject tail (`NOTIFICATION_SUBJECTS.verifyEmail` — the subject
 * LEADS with the dynamic code, so equality can never match). Polled (not a fixed
 * sleep) because SMTP delivery is async after the 2xx send. The `afterIso`
 * filter is essential: `createUser` ALSO fires an initial verification email,
 * and the `resend` invalidates that earlier code — so we must skip the
 * create-email and only accept the resend mail (otherwise we would read a stale,
 * already-superseded code and `verifyEmail` would 4xx).
 */
async function fetchVerificationMail(
  email: string,
  afterIso: string,
): Promise<VerificationMail | null> {
  const after = Date.parse(afterIso);
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ ID?: string; Created?: string; Subject?: string }>;
      };
      // Messages come newest-first; take the first one created after the resend.
      const hit = (data.messages ?? []).find(
        (m) =>
          m.Created &&
          Date.parse(m.Created) >= after &&
          (m.Subject ?? "").includes(NOTIFICATION_SUBJECTS.verifyEmail),
      );
      if (hit?.ID) {
        const msgRes = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as Partial<VerificationMail>;
          return {
            Subject: msg.Subject ?? "",
            Text: msg.Text ?? "",
            HTML: msg.HTML ?? "",
          };
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
      // #869: with a portal origin configured the send carries the BARE /verify
      // urlTemplate — exactly what IdpModule wires in the running BFF.
      portalBaseUrl: PORTAL_BASE,
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

  it("003 EARS-3: the delivered mail is the code-only branded RU artifact, and its code verifies (#148/#869)", async () => {
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

      const mail = await fetchVerificationMail(email, sentAt);
      expect(
        mail,
        "verification mail should be delivered to Mailpit",
      ).toBeTruthy();

      // ── #869 rendered-artifact facts (owner Stage-A verdict + Issue AC) ────
      // Subject: leads with the 6-char code, branded tail, < 50 chars.
      expect(mail!.Subject).toMatch(
        /^[A-Z0-9]{6} — код подтверждения Doctor\.School$/,
      );
      expect(mail!.Subject.length).toBeLessThan(50);
      const code = mail!.Subject.slice(0, 6);

      // Body: the same code as ONE unbroken token (Stage-B verdict — no triad
      // grouping, so what the user sees is exactly what they type).
      expect(mail!.HTML).toContain(`<strong>${code}</strong>`);
      expect(mail!.Text).toContain(code);
      // The retired «без пробела» qualifier must be gone with the grouping.
      expect(mail!.Text).not.toContain("без пробела");
      expect(mail!.HTML).not.toContain("без пробела");
      // Explicit expiry line (the VERIFY_EMAIL_CODE generator lifetime, 3600s).
      expect(mail!.Text).toContain("Код действует 1 час");
      // Explicit "if you didn't register, ignore this email" line.
      expect(mail!.Text).toContain("проигнорируйте это письмо");

      // NO link into Zitadel's hosted login-v2 UI — the #869 AC invariant that
      // survives the Stage-A supersession, asserted as an explicit ABSENCE.
      expect(mail!.HTML).not.toContain("/ui/v2");
      expect(mail!.Text).not.toContain("/ui/v2");
      // The only href(s) are the BARE portal /verify navigation aid: no query,
      // no code, no userId — nothing a mail scanner's GET prefetch can consume.
      const hrefs = [...mail!.HTML.matchAll(/href="([^"]*)"/g)].map(
        (m) => m[1],
      );
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href).toBe(`${PORTAL_BASE}/verify`);
      }

      // ── the manual journey: the code a human reads from the mail verifies ──
      // (also proves the corrected `/email/verify` path, #148)
      verified = await client.verifyEmail(created.sub, code);
      if (!verified) await sleep(2000);
    }
    expect(verified).toBe(true);
    // Async SMTP delivery + the create/resend settle + retry run past vitest's 5s
    // default; this is a live cross-service round-trip, not a unit test.
  }, 45_000);
});

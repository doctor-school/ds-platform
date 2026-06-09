/**
 * Mailpit REST helper for the portal real-Zitadel E2E (#131) — the exact same
 * code-extraction pattern as `apps/api/test/auth/zitadel-otp-login.e2e-spec.ts`.
 * The dev-stand's Zitadel SMTP provider points at Mailpit (the catch-all inbox),
 * so the verification / login-OTP codes the browser flow triggers are delivered
 * there and read back over the REST API. We do NOT hardcode the FakeIdpClient
 * `424242` code here — this tier reads the REAL delivered code.
 */

const MAILPIT_BASE = (
  process.env.MAILPIT_URL ?? "http://truenas.local:8025"
).replace(/\/$/, "");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Extract a 6-ish-char OTP code from a Mailpit message body. */
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
 * Poll Mailpit for the mail to `email` delivered AFTER `afterIso` and pull the
 * code. Polled (not a fixed sleep) because SMTP delivery is async after the BFF's
 * 2xx. The `afterIso` cutoff lets a caller skip an earlier mail (e.g. read the
 * login-OTP code, not the registration-verification code) by passing the wall
 * clock captured just before the triggering action.
 */
export async function fetchOtpCode(
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

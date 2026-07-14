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

/**
 * Extract a 6-ish-char OTP code from a Mailpit message.
 *
 * The branded verify-email (#869, provision.sh step 8.ter) is CODE-ONLY: the
 * code leads the SUBJECT (`GX5AVU — код подтверждения Doctor.School`) and the
 * body shows it as two grouped triads (`GX5 AVU`) — there is no `code=` link to
 * scrape any more. Subject-first, then the grouped-body form, then the legacy
 * body patterns (the login email-OTP mail still renders `Code 12345678`).
 */
function extractCode(msg: {
  Subject?: string;
  Text?: string;
  HTML?: string;
}): string | null {
  const fromSubject = (msg.Subject ?? "").match(/^([A-Z0-9]{4,12})\s+—/)?.[1];
  if (fromSubject) return fromSubject;
  const haystack = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
  const grouped = haystack.match(/\b([A-Z0-9]{3}) ([A-Z0-9]{3})\b/);
  return (
    haystack.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    haystack.match(/[?&]code=([A-Z0-9]{4,12})\b/)?.[1] ??
    haystack.match(/\b([0-9]{6,8})\b/)?.[1] ??
    (grouped ? `${grouped[1]}${grouped[2]}` : null)
  );
}

/**
 * Poll Mailpit for the mail to `email` delivered AFTER `afterIso` and pull the
 * code. Polled (not a fixed sleep) because SMTP delivery is async after the BFF's
 * 2xx. The `afterIso` cutoff lets a caller skip an earlier mail by passing the
 * wall clock captured just before the triggering action.
 *
 * `subject` disambiguates the TWO Zitadel mails a single address receives in the
 * email-OTP journey, which Zitadel sends < 1 s apart so the time cutoff alone
 * cannot separate them (proven live, #131): registration sends a verify-email
 * mail (a 6-char alphanumeric code, e.g. `L3VMNK`) and the login-OTP request
 * sends an email-OTP mail (an 8-digit code, e.g. `47787462`). Because the
 * registration mail can land INSIDE the OTP window, the OTP-login step must
 * select by subject, not by timestamp — otherwise it reads the stale
 * registration code and login fails with a wrong-code. Subjects are `ru`-locked
 * since #177 and live in `notification-subjects` (`NOTIFICATION_SUBJECTS`) — the
 * caller passes the right one (#305). The default (no `subject`) preserves the
 * timestamp-only behaviour the single-mail callers rely on.
 */
export async function fetchOtpCode(
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

/** A fetched Mailpit message (the slice the EARS-23 notice assertions need). */
export interface MailpitMessage {
  Subject: string;
  Text: string;
  HTML: string;
}

/**
 * Poll Mailpit for a message to `email` delivered AFTER `afterIso` (optionally
 * filtered by `subjectIncludes`), returning the full message rather than a code.
 * Used by the EARS-23 account-exists-notice assertion (#207): the notice must
 * arrive AND must carry no verification/login code (it is a product notice, not
 * an identity-credential email). Returns `null` if no matching mail lands.
 */
export async function fetchMessage(
  email: string,
  afterIso: string,
  subjectIncludes?: string,
): Promise<MailpitMessage | null> {
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
          (!subjectIncludes || (m.Subject ?? "").includes(subjectIncludes)),
      );
      if (hit?.ID) {
        const msgRes = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as Partial<MailpitMessage>;
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

/**
 * SMS-sink REST helper for the portal real-Zitadel E2E (#170) — the SMS analogue
 * of `mailpit.ts`. The dev-stand's Zitadel generic HTTP SMS provider POSTs every
 * outbound SMS to the local `sms-sink` service (compose.core.yml) instead of a
 * real gateway, so the SMS-OTP codes the browser flow triggers are delivered
 * there and read back over the sink's small REST API. SMS-Aero is the PRODUCTION
 * sender (recorded in the specs); the dev-stand never reaches it. We do NOT
 * surface the code through any api/BFF response (that would make the EARS-8/16 ack
 * a code oracle, or need a banned test backdoor) — this reads the REAL delivered
 * code from the side-channel, exactly as the email journey reads Mailpit.
 *
 * The sink stores each webhook body verbatim and indexes it by recipient phone
 * (raw substring, provider-field-agnostic). `GET /api/messages?to=<phone>&after=
 * <iso>` returns newest-first matches; `DELETE /api/messages` clears the store.
 */

const SMS_SINK_BASE = (
  process.env.SMS_SINK_URL ?? "http://truenas.local:8090"
).replace(/\/$/, "");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface SinkMessage {
  id: number;
  receivedAt: string;
  body: string;
  json: {
    contextInfo?: { eventType?: string };
    args?: { code?: string; oTP?: string };
  } | null;
}

/**
 * Extract the OTP code from a stored SMS webhook body. The login OTP
 * (`session.otp.sms.challenged`) renders the 8-digit code in the SMS text
 * (`24252011 is your OTP …`) and in `args.oTP`; the phone-verify code
 * (`user.human.phone.code.added`) is a 6-char alphanumeric in `args.code` and the
 * rendered `… code to verify it VBX53M.` text (proven live on the dev-stand,
 * #170). Prefer the structured args field, then fall back to scanning the text —
 * the same belt-and-suspenders shape as the Mailpit `extractCode`.
 */
function extractCode(msg: SinkMessage): string | null {
  const fromArgs = msg.json?.args?.oTP ?? msg.json?.args?.code;
  if (fromArgs) return String(fromArgs);
  const s = msg.body;
  return (
    s.match(/code to verify it ([A-Z0-9]{4,12})/)?.[1] ??
    s.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    s.match(/\b([0-9]{6,8})\b/)?.[1] ??
    null
  );
}

/**
 * Poll the SMS sink for the message to `phone` delivered AFTER `afterIso` and
 * pull the code. Polled (not a fixed sleep) because the Zitadel HTTP-SMS webhook
 * fires async after the BFF's 2xx, exactly like the Mailpit poll. The `afterIso`
 * cutoff skips an earlier message, and `event` restricts to a
 * `contextInfo.eventType` — the SMS analogue of Mailpit's subject filter. This
 * matters: the phone-verify SMS (`user.human.phone.code.added`, a 6-char
 * alphanumeric) and the login OTP (`session.otp.sms.challenged`, 8 digits) can
 * land within one poll window and Zitadel re-renders the verify code around the
 * login send, so without the event filter the login step can read the stale
 * verify code and never verify (proven live, #170 — the SMS twin of the email
 * `Verify OTP` subject fix).
 */
export async function fetchSmsOtpCode(
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
      const data = (await res.json()) as { messages?: SinkMessage[] };
      const hit = (data.messages ?? [])[0]; // newest-first
      if (hit) {
        const code = extractCode(hit);
        if (code) return code;
      }
    }
    await sleep(500);
  }
  return null;
}

import { randomInt } from "node:crypto";

/**
 * The SMS analogue of `mailpit.ts` for the 003 SMS reset journey (#2861).
 *
 * Zitadel's HTTP SMS provider delivers every outbound SMS of a stand to the
 * `sms-sink` service (`infra/dev-stand/compose.core.yml`, `sms-sink/server.mjs`),
 * which stores each webhook body verbatim and answers
 * `GET /api/messages?to=<phone>&after=<iso>&event=<substr>` newest-first. The
 * suite reads the REAL delivered code there — never from an api response.
 *
 * The root is `E2E_SMS_SINK_URL` and nothing else. The stage box runs a sink too
 * (`infra/deploy/compose/stg-infra/compose.yml`), but its Caddy publishes only
 * Mailpit, so a slot run has no root to read and the `@sms-reset` scenarios
 * name their skip (`steps/password-reset-sms.steps.ts`) instead of guessing one.
 */
export function smsSinkUrl(): string | null {
  const root = process.env.E2E_SMS_SINK_URL?.trim();
  return root ? root.replace(/\/$/, "") : null;
}

/** The Zitadel event of the `/account` phone confirmation SMS (`verifyphone`). */
export const PHONE_CODE_EVENT = "user.human.phone.code.added";

/**
 * A fresh Russian mobile number per run. A fixed number cannot be re-run: the
 * EARS-14 per-phone budget (3 SMS an hour) is spent by one confirmation plus one
 * reset, and a number confirmed by an earlier run's account is answered with no
 * SMS (EARS-51). Sink-only — a stand never sends a real SMS (provision.sh,
 * SMS_DELIVERY_MODE=sink).
 */
export function freshConfirmablePhone(): string {
  return `+7999${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

export interface SinkMessage {
  body: string;
  json: {
    contextInfo?: { eventType?: string };
    args?: { code?: string };
  } | null;
}

/** The Zitadel event of the password-reset SMS (`passwordreset`, EARS-53). */
export const RESET_CODE_EVENT = "user.human.password.code.added";

/**
 * The six-digit code of a password-reset SMS; `null` for any other SMS. Read
 * from the structured `args.code` of the reset event, never from the rendered
 * text: the text is stand provisioning (provision.sh step 8.bis), which a stand
 * can carry in an older revision, while the event and its code are Zitadel's.
 */
export function resetSmsCode(message: SinkMessage): string | null {
  if (message.json?.contextInfo?.eventType !== RESET_CODE_EVENT) return null;
  const code = String(message.json.args?.code ?? "");
  return /^\d{6}$/.test(code) ? code : null;
}

/** The code of a phone confirmation SMS: the structured arg, then the text. */
export function phoneConfirmationCode(message: SinkMessage): string | null {
  const fromArgs = message.json?.args?.code;
  if (fromArgs && /^\d{6}$/.test(String(fromArgs))) return String(fromArgs);
  return message.body.match(/\b(\d{6})\b/)?.[1] ?? null;
}

/** Messages to `phone` received after `afterIso`, newest first. */
export async function smsSinkMessages(
  root: string,
  phone: string,
  afterIso: string,
  event?: string,
): Promise<SinkMessage[]> {
  const response = await fetch(
    `${root}/api/messages?to=${encodeURIComponent(phone)}` +
      `&after=${encodeURIComponent(afterIso)}` +
      (event ? `&event=${encodeURIComponent(event)}` : ""),
  );
  if (!response.ok)
    throw new Error(`SMS sink answered HTTP ${response.status}`);
  return (
    ((await response.json()) as { messages?: SinkMessage[] }).messages ?? []
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `pick` finds a code in the messages to `phone` after `afterIso`. */
export async function waitForSmsCode(
  root: string,
  phone: string,
  afterIso: string,
  pick: (message: SinkMessage) => string | null,
  event?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const message of await smsSinkMessages(root, phone, afterIso, event)) {
      const code = pick(message);
      if (code) return code;
    }
    await wait(500);
  }
  throw new Error("No matching SMS reached the sink");
}

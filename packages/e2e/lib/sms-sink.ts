import { randomInt } from "node:crypto";

/**
 * The SMS analogue of `mailpit.ts` for the 003 SMS reset journey (#2861).
 *
 * Zitadel's HTTP SMS provider delivers every outbound SMS of a stand to the
 * `sms-sink` service (`infra/dev-stand/compose.core.yml`, `sms-sink/server.mjs`),
 * which stores each webhook body verbatim and answers
 * `GET /api/messages?to=<phone>&event=<substr>` newest-first. The suite reads
 * the REAL delivered code there — never from an api response — and tells a
 * fresh delivery by the sink ids observed before the action (`SmsCheckpoint`),
 * never by the sink's `after` filter against a runner-clock instant.
 *
 * The root is `E2E_SMS_SINK_URL` and nothing else; without it the `@sms-reset`
 * scenarios name their skip (`steps/password-reset-sms.steps.ts`) instead of
 * guessing one. On the stage box the sink's GET read API is published behind
 * the stand gate (`infra/deploy/compose/stg-infra/Caddyfile`, #2878) and
 * `tools/staging/e2e-stage.mjs` sets the root, so the read carries the stand's
 * basic-auth pair (`E2E_HTTP_USER` / `E2E_HTTP_PASS`) the way Mailpit's does.
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

/** What a code picker reads: the stored webhook body and its parsed JSON. */
export interface SinkContent {
  body: string;
  json: {
    contextInfo?: { eventType?: string };
    args?: { code?: string };
  } | null;
}

/** A stored delivery: the sink's own monotonic id and arrival stamp. */
export interface SinkMessage extends SinkContent {
  id: number;
  receivedAt: string;
}

/**
 * The deliveries to one phone the sink already held before an action (#3057).
 *
 * The runner and the sink run on different machines, so a runner-clock instant
 * says nothing about the sink's `receivedAt` stamps: a runner clock a few
 * hundred milliseconds ahead hides every delivery its own request caused. A
 * delivery is fresh exactly when its sink id was not observed before the
 * action — causality from the store's own ids, no clock comparison.
 */
export interface SmsCheckpoint {
  readonly phone: string;
  readonly messageIds: readonly number[];
}

/** A checkpoint holding nothing: every delivery to `phone` counts. */
export function smsOrigin(phone: string): SmsCheckpoint {
  return { phone, messageIds: [] };
}

/** The Zitadel event of the password-reset SMS (`passwordreset`, EARS-53). */
export const RESET_CODE_EVENT = "user.human.password.code.added";

/**
 * The six-digit code of a password-reset SMS; `null` for any other SMS. Read
 * from the structured `args.code` of the reset event, never from the rendered
 * text: the text is stand provisioning (provision.sh step 8.bis), which a stand
 * can carry in an older revision, while the event and its code are Zitadel's.
 */
export function resetSmsCode(message: SinkContent): string | null {
  if (message.json?.contextInfo?.eventType !== RESET_CODE_EVENT) return null;
  const code = String(message.json.args?.code ?? "");
  return /^\d{6}$/.test(code) ? code : null;
}

/** The code of a phone confirmation SMS: the structured arg, then the text. */
export function phoneConfirmationCode(message: SinkContent): string | null {
  const fromArgs = message.json?.args?.code;
  if (fromArgs && /^\d{6}$/.test(String(fromArgs))) return String(fromArgs);
  return message.body.match(/\b(\d{6})\b/)?.[1] ?? null;
}

/** Every stored delivery to `phone` (optionally of `event`), newest first. */
async function sinkDeliveries(
  root: string,
  phone: string,
  event?: string,
): Promise<SinkMessage[]> {
  const user = process.env.E2E_HTTP_USER ?? "";
  const password = process.env.E2E_HTTP_PASS ?? "";
  const response = await fetch(
    `${root}/api/messages?to=${encodeURIComponent(phone)}` +
      (event ? `&event=${encodeURIComponent(event)}` : ""),
    {
      headers:
        user && password
          ? {
              authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
            }
          : {},
      // A redirect would carry the pair to wherever it points.
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(`SMS sink answered HTTP ${response.status}`);
  const messages =
    ((await response.json()) as { messages?: SinkMessage[] }).messages ?? [];
  for (const message of messages) {
    if (!Number.isSafeInteger(message.id) || message.id <= 0)
      throw new Error("Invalid SMS sink delivery id");
  }
  return messages;
}

/** Observe the deliveries to `phone` before the action that sends one. */
export async function captureSmsCheckpoint(
  root: string,
  phone: string,
): Promise<SmsCheckpoint> {
  return {
    phone,
    messageIds: (await sinkDeliveries(root, phone)).map(
      (message) => message.id,
    ),
  };
}

/** Deliveries to `phone` beyond `checkpoint`, newest first. */
export async function smsSinkMessages(
  root: string,
  phone: string,
  checkpoint: SmsCheckpoint,
  event?: string,
): Promise<SinkMessage[]> {
  if (checkpoint.phone !== phone)
    throw new Error("SMS checkpoint belongs to another phone");
  const seen = new Set(checkpoint.messageIds);
  return (await sinkDeliveries(root, phone, event)).filter(
    (message) => !seen.has(message.id),
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `pick` finds a code in the deliveries to `phone` beyond `checkpoint`. */
export async function waitForSmsCode(
  root: string,
  phone: string,
  checkpoint: SmsCheckpoint,
  pick: (message: SinkContent) => string | null,
  event?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const message of await smsSinkMessages(
      root,
      phone,
      checkpoint,
      event,
    )) {
      const code = pick(message);
      if (code) return code;
    }
    await wait(500);
  }
  throw new Error("No matching SMS reached the sink");
}

import { emailSender } from "./email-layout.js";
import { isCertificateHandshakeCode } from "./smtp-outcome.js";
import {
  ChannelRejection,
  type OutboundEmail,
  type ProbeResult,
  type RelayChannel,
  type SendOptions,
} from "./relay-channel.js";
export const RESEND_API_URL = "https://api.resend.com/emails";
/** Read-only endpoint for the 003 EARS-46 key check; nothing is sent. */
export const RESEND_DOMAINS_URL = "https://api.resend.com/domains";
export const RESEND_DEADLINE_MS = 10_000;
export interface ResendChannelConfig {
  enabled?: boolean | undefined;
  apiKey: string;
  from?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

/** Network failures that prove the request never left (003 EARS-45). */
const PRE_SEND_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function preSendFailure(err: unknown): string | undefined {
  const code = String(
    (err as { cause?: { code?: unknown } } | undefined)?.cause?.code ?? "",
  );
  if (PRE_SEND_CODES.has(code)) return code;
  if (isCertificateHandshakeCode(code)) return "ETLS";
  return undefined;
}

/** Parse a bounded error body; only the error name/field matter, text is dropped. */
function errorName(body: string): {
  name?: string | undefined;
  recipient: boolean;
} {
  try {
    const parsed = JSON.parse(body) as { name?: unknown; message?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      recipient:
        typeof parsed.message === "string" && /`to`/.test(parsed.message),
    };
  } catch {
    return { recipient: false };
  }
}

/** One bounded HTTP attempt. Raw responses never leave the adapter. */
export class ResendChannel implements RelayChannel {
  readonly provider = "resend";
  constructor(private readonly config: ResendChannelConfig) {}

  async send(message: OutboundEmail, options?: SendOptions): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(
        0,
        Math.min(RESEND_DEADLINE_MS, options?.deadlineMs ?? RESEND_DEADLINE_MS),
      ),
    );
    let status: number | undefined;
    try {
      let response: Response;
      try {
        response = await (this.config.fetchFn ?? fetch)(RESEND_API_URL, {
          method: "POST",
          signal: controller.signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          // 003 EARS-31: the composed artifact only — no tags, headers or
          // tracking options; tracking is off at the Resend domain level.
          body: JSON.stringify({
            from: emailSender(this.config.from),
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
      } catch (err) {
        const code = controller.signal.aborted
          ? undefined
          : preSendFailure(err);
        if (code) throw new ChannelRejection(code, "HTTP request not sent");
        throw new ChannelRejection(
          controller.signal.aborted ? "timeout" : "connection-failure",
          "HTTP acceptance unknown",
          "ambiguous",
        );
      }
      if (controller.signal.aborted)
        throw new ChannelRejection(
          "timeout",
          "HTTP acceptance unknown",
          "ambiguous",
        );
      status = response.status;
      // Acceptance is known from final headers; abort releases the unused body.
      if (status >= 200 && status <= 299) return;
      const code = String(status);
      if (status >= 500)
        throw new ChannelRejection(code, "HTTP server error", "ambiguous");
      if (status === 429) throw new ChannelRejection(code, "HTTP rejection");
      // Reading is bounded by the same abort signal. Contents are parsed for
      // the error class only and discarded: they can echo recipient/OTP/secrets.
      let body = "";
      try {
        body = await response.text();
      } catch {
        // The final status remains authoritative even if its body times out.
      }
      const parsed = errorName(body);
      throw new ChannelRejection(
        code,
        "HTTP rejection",
        parsed.name === "validation_error" && parsed.recipient
          ? "recipient-permanent"
          : "provider-failure",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  /**
   * 003 EARS-46 key check without sending: a 2xx read, or the sending-only
   * key's `restricted_api_key` 401 (the key is live), is `verified`.
   */
  async probe(): Promise<ProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_DEADLINE_MS);
    try {
      const response = await (this.config.fetchFn ?? fetch)(
        RESEND_DOMAINS_URL,
        {
          method: "GET",
          signal: controller.signal,
          redirect: "error",
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
        },
      );
      if (response.status >= 200 && response.status <= 299) return "verified";
      if (response.status !== 401) return "probe-failed";
      return errorName(await response.text()).name === "restricted_api_key"
        ? "verified"
        : "probe-failed";
    } catch {
      return "probe-failed";
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

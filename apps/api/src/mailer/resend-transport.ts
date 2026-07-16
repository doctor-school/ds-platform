import {
  ChannelRejection,
  type OutboundEmail,
  type RelayChannel,
} from "./relay-channel.js";

/** Resend send endpoint (https://resend.com/docs/api-reference/emails/send-email). */
export const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Resend channel config (`RESEND_API_KEY`; the From address reuses the
 * DKIM-aligned `noreply@doctor.school` — `resend._domainkey` is live in the
 * doctor.school zone, design §14.3).
 */
export interface ResendChannelConfig {
  apiKey: string;
  /** Envelope/From address; defaults to `noreply@doctor.school`. */
  from?: string | undefined;
  /** Override the HTTP client (the unit specs inject a scripted fake). */
  fetchFn?: typeof fetch | undefined;
}

/**
 * The Resend failover channel of the 003 §14.3 transport chain (EARS-31,
 * #1046) — an HTTPS adapter over the Resend REST API, deliberately
 * dependency-free (global `fetch`). Failover-only by design: it sits BEHIND
 * the mail.ru primary in the chain and carries traffic only when the primary
 * rejected the send (152-ФЗ posture, design §14.6 — these mails hold only the
 * recipient address and a short-lived one-time code).
 *
 * 2xx-only success (EARS-31): resolves on an HTTP 2xx; any other status — the
 * documented `429` rate limit, any 4xx/5xx — or a network failure rejects with
 * a {@link ChannelRejection} carrying the status / errno as the provider code.
 */
export class ResendChannel implements RelayChannel {
  readonly provider = "resend";

  constructor(private readonly config: ResendChannelConfig) {}

  async send(message: OutboundEmail): Promise<void> {
    const fetchFn = this.config.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from ?? "noreply@doctor.school",
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
    } catch (err) {
      // Connection-level failure — no HTTP status to report; the errno string
      // (bounded) is the provider code (EARS-31: any connection failure
      // triggers the channel switch).
      const errno = (err as { code?: unknown }).code;
      throw new ChannelRejection(
        typeof errno === "string" && errno ? errno : "connection-failure",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (response.status < 200 || response.status > 299) {
      // The body may echo request fields — treated as secret-bearing detail
      // and redacted upstream before any log/error egress (EARS-30).
      const body = await response.text().catch(() => "");
      throw new ChannelRejection(String(response.status), body.slice(0, 500));
    }
  }
}

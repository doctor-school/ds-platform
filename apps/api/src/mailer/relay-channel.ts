/**
 * The per-provider relay channel contract behind the 003 §14.3 failover chain
 * (EARS-31, #1046). A channel is ONE provider attempt: it resolves ONLY on a
 * 2xx provider acceptance and rejects with a {@link ChannelRejection} carrying
 * the provider response code otherwise — the failover decision itself lives in
 * `SmtpMailer.dispatch`, never inside a channel (no same-channel retry by
 * construction: the chain calls each channel at most once per send).
 */

/** The composed artifact handed to a channel — recipient + §13.3/§13.4 body. */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** One provider attempt. Resolves ⇔ the provider accepted with a 2xx. */
export interface RelayChannel {
  /**
   * Stable provider label for observability (design §14.3 dashboards):
   * `mail.ru` (the real SMTP primary), `resend` (failover), `mailpit`
   * (the #209 intercept).
   */
  readonly provider: string;
  send(message: OutboundEmail): Promise<void>;
}

/**
 * A non-2xx provider outcome. `code` is the provider response code (SMTP
 * `451`, HTTP `429`, or an errno string like `ECONNREFUSED` for a connection
 * failure) — bounded values, safe as a metric label. `message` is the RAW
 * provider detail and MAY echo the outbound message (and thus a transiting
 * one-time code): it never leaves `SmtpMailer.dispatch` un-redacted (EARS-30).
 */
export class ChannelRejection extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "ChannelRejection";
  }
}

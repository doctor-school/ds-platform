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
   * `postbox` / deliberate `mail.ru` (SMTP primary), `resend` (failover), `mailpit`
   * (the #209 intercept).
   */
  readonly provider: string;
  send(message: OutboundEmail): Promise<void>;
}

/** Bounded provider code and explicit acceptance certainty; details stay internal. */
export class ChannelRejection extends Error {
  constructor(
    readonly code: string,
    detail: string,
    readonly outcome: "rejected" | "uncertain" = "rejected",
  ) {
    super(detail);
    this.name = "ChannelRejection";
  }
}

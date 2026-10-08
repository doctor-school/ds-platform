/**
 * The per-provider relay channel contract behind the 003 §14.3 chain
 * (EARS-31/45/46). A channel is ONE provider attempt: it resolves ONLY on a
 * provider acceptance and rejects with a {@link ChannelRejection} carrying a
 * bounded code and the EARS-45 outcome class otherwise — the routing decision
 * lives in `SmtpMailer.dispatch`, never inside a channel (no same-channel
 * retry by construction: the chain calls each channel at most once per send).
 */

/** The composed artifact handed to a channel — recipient + §13.3/§13.4 body. */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** 003 EARS-45 attempt outcome classes. */
export type AttemptOutcome =
  "accepted" | "recipient-permanent" | "provider-failure" | "ambiguous";

/** Every class except `accepted` — what a rejected attempt carries. */
export type RejectionOutcome = Exclude<AttemptOutcome, "accepted">;

/** Per-attempt options: the effective deadline (003 §14.3 budget). */
export interface SendOptions {
  /** Lesser of the channel deadline and the remaining chain budget. */
  deadlineMs?: number | undefined;
}

/** 003 EARS-46 probe result for a configured channel. */
export type ProbeResult = "verified" | "probe-failed";

/** One provider attempt. Resolves ⇔ the provider accepted. */
export interface RelayChannel {
  /**
   * Actual provider label for observability: `postbox` / `mail.ru` (SMTP),
   * `resend` (HTTP), `mailpit` (the #209 intercept).
   */
  readonly provider: string;
  send(message: OutboundEmail, options?: SendOptions): Promise<void>;
  /** Readiness check without sending any message (003 EARS-46). */
  probe(): Promise<ProbeResult>;
}

/** Bounded provider code and the EARS-45 class; provider text stays internal. */
export class ChannelRejection extends Error {
  constructor(
    readonly code: string,
    detail: string,
    readonly outcome: RejectionOutcome = "provider-failure",
  ) {
    super(detail);
    this.name = "ChannelRejection";
  }
}

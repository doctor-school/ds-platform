import { Logger } from "@nestjs/common";
import { Counter, register } from "prom-client";

/** The two transactional-send channels the suppression seam guards (design §14.8). */
export type SuppressChannel = "email" | "sms";

/** Default reserved email recipient-domain suffix — the IANA `.invalid` TLD (design §14.8). */
export const DEFAULT_SYNTHETIC_DOMAIN = "@loadtest.invalid";

/**
 * Default reserved SMS recipient prefix — the ITU-reserved `+999` country code,
 * which is unassigned and can never be a real MSISDN (the SMS analog of the
 * `.invalid` email TLD, design §14.8: "an analogous reserved-recipient match").
 */
export const DEFAULT_SYNTHETIC_MSISDN_PREFIX = "+999";

/**
 * Prometheus counter for every suppressed synthetic send (003 EARS-33, design
 * §14.8): `mailer_synthetic_suppressed_total{channel}`. Label values are bounded
 * (`email` | `sms`). Registered in the prom-client DEFAULT registry alongside the
 * §14.5 relay counter; the exposition endpoint lands with the engineering-readiness
 * Prometheus slice. Unlike EARS-30 there is nothing to scrub — a suppressed send
 * carries only the synthetic recipient, never a one-time code.
 */
export const MAILER_SYNTHETIC_SUPPRESSED_METRIC = "mailer_synthetic_suppressed_total";

type SuppressedLabel = "channel";

/**
 * Get-or-create the suppression counter in the default registry — idempotent
 * across repeated construction (prom-client throws on a duplicate registration)
 * and across `register.clear()` in tests. Mirrors `relayCounter()` in
 * `relay-observability.ts`.
 */
function suppressedCounter(): Counter<SuppressedLabel> {
  const existing = register.getSingleMetric(MAILER_SYNTHETIC_SUPPRESSED_METRIC);
  if (existing) return existing as Counter<SuppressedLabel>;
  return new Counter<SuppressedLabel>({
    name: MAILER_SYNTHETIC_SUPPRESSED_METRIC,
    help: "BFF synthetic-send suppressions (003 EARS-33): load-test sends dropped before the relay/provider hop, by channel.",
    labelNames: ["channel"],
  });
}

/** The reserved-recipient tags a send is matched against (design §14.8). */
export interface SyntheticTags {
  /** Reserved email recipient-domain suffix (`LOADTEST_SYNTHETIC_DOMAIN`). */
  domain: string;
  /** Reserved SMS recipient prefix / test-MSISDN tag (`LOADTEST_SYNTHETIC_MSISDN_PREFIX`). */
  msisdnPrefix: string;
}

/**
 * Pure decision (003 EARS-33): does `recipient` carry the reserved synthetic tag
 * for `channel`? Matched by recipient ONLY — never by any toggle (the toggle is
 * the caller's gate). The match is a **full reserved-suffix / prefix** test, not a
 * substring: an address that merely CONTAINS the tag elsewhere is untagged.
 *
 * - **email** — case-insensitive suffix match on the reserved domain (`@loadtest.invalid`):
 *   `alice@loadtest.invalid` matches; `loadtest.invalid@real.example` does not (the
 *   tag is not the trailing domain), and `alice@loadtest.invalid.evil.example` does
 *   not (a different domain that only contains the tag).
 * - **sms** — prefix match on the reserved number range, after stripping spaces and
 *   dashes so `+999 12-34` still matches `+999`.
 */
export function isSyntheticRecipient(
  channel: SuppressChannel,
  recipient: string,
  tags: SyntheticTags,
): boolean {
  const value = recipient?.trim() ?? "";
  if (value.length === 0) return false;
  if (channel === "email") {
    return value.toLowerCase().endsWith(tags.domain.toLowerCase());
  }
  const normalized = value.replace(/[\s-]/g, "");
  return normalized.startsWith(tags.msisdnPrefix);
}

/** Sink override for the unit specs; production uses the prom counter + Logger. */
export interface SyntheticSuppressionSinks {
  /** Called once per suppressed send (after the counter + log). Test spy hook. */
  onSuppressed?: ((channel: SuppressChannel, recipient: string) => void) | undefined;
  /** Structured-log sink; defaults to a WARN line naming channel + synthetic recipient. */
  log?: ((line: string) => void) | undefined;
}

export interface SyntheticSuppressionConfig {
  /**
   * Live read of `LOADTEST_SUPPRESS_SYNTHETIC` (default `false` ⇒ the seam is
   * fully inert — every send proceeds unchanged). The ONLY switch: the three-state
   * matrix is fail-closed on it, so a missing/false toggle can never suppress a
   * real user's mail.
   */
  enabled: () => boolean;
  /** Reserved-recipient tags (`LOADTEST_SYNTHETIC_DOMAIN` / `..._MSISDN_PREFIX`). */
  tags: SyntheticTags;
  sinks?: SyntheticSuppressionSinks | undefined;
}

/**
 * The 003 EARS-33 synthetic-send suppression seam (design §14.8) — a
 * recipient-scoped, env-gated drop shared by BOTH the BFF mailer (email) and the
 * SMS-OTP send point, sitting at the same single send point as the §14.2
 * flag-gated delivery: matched by recipient only, **after** the identical
 * request-shape pipeline the #873 load test must exercise (enumeration-safe
 * wrapper, `register-notice-throttle`, artifact composition) and **before** the
 * relay/provider hop, so the campaign measures the real pipeline minus the relay.
 * It never touches the global `EMAIL_DELIVERY_MODE` / `SMS_DELIVERY_MODE`.
 *
 * Three-state matrix (fail-closed on the toggle):
 * - off → `false` (normal send) in every case;
 * - on + tagged → `true` (drop) + one `mailer_synthetic_suppressed_total{channel}`
 *   increment + one loud structured log line;
 * - on + untagged → `false` (normal send).
 */
export class SyntheticSuppression {
  private static readonly logger = new Logger("SyntheticSuppression");
  private readonly enabled: () => boolean;
  private readonly tags: SyntheticTags;
  private readonly onSuppressed:
    | ((channel: SuppressChannel, recipient: string) => void)
    | undefined;
  private readonly log: (line: string) => void;

  constructor(config: SyntheticSuppressionConfig) {
    this.enabled = config.enabled;
    this.tags = config.tags;
    this.onSuppressed = config.sinks?.onSuppressed;
    this.log =
      config.sinks?.log ?? ((line) => SyntheticSuppression.logger.warn(line));
  }

  /** A fully-inert instance — the safe default (toggle hard-off), for tests/fallbacks. */
  static disabled(): SyntheticSuppression {
    return new SyntheticSuppression({
      enabled: () => false,
      tags: {
        domain: DEFAULT_SYNTHETIC_DOMAIN,
        msisdnPrefix: DEFAULT_SYNTHETIC_MSISDN_PREFIX,
      },
    });
  }

  /**
   * Decide + record whether this send must be dropped before the relay/provider
   * hop. Returns `true` ONLY on the on+tagged case, and only then increments the
   * counter and emits the loud log line. `false` (normal send) for off (any
   * recipient) and for on+untagged — so the caller proceeds exactly as today.
   */
  suppress(channel: SuppressChannel, recipient: string): boolean {
    if (!this.enabled()) return false; // toggle off ⇒ inert (every case)
    if (!isSyntheticRecipient(channel, recipient, this.tags)) return false; // untagged ⇒ normal
    suppressedCounter().inc({ channel });
    this.log(
      JSON.stringify({
        event: "mailer_synthetic_suppressed",
        channel,
        recipient,
      }),
    );
    this.onSuppressed?.(channel, recipient);
    return true;
  }
}

/** DI token for the shared {@link SyntheticSuppression} seam (mailer + SMS send points). */
export const SYNTHETIC_SUPPRESSION = Symbol("SYNTHETIC_SUPPRESSION");

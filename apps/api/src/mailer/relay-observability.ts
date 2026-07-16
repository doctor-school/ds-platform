import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { Counter, register } from "prom-client";

/** One failed provider attempt. `detail` is ALREADY redacted (EARS-30). */
export interface RelayAttempt {
  provider: string;
  /** Provider response code — SMTP `451`, HTTP `429`, or an errno string. */
  code: string;
  detail?: string | undefined;
}

/** The active channel rejected the send and the chain switched (EARS-31). */
export interface FailoverEvent {
  /** Mail-class context (e.g. `verification-code email`) — never a recipient. */
  context: string;
  /** The rejecting provider. */
  from: string;
  /** Its response code. */
  code: string;
  /** The channel the send switched to. */
  to: string;
  detail?: string | undefined;
}

/** Every channel failed — the send failed closed with all provider codes. */
export interface RelayFailureEvent {
  context: string;
  attempts: RelayAttempt[];
}

/**
 * Prometheus counter for every mailer failover / relay failure (003 EARS-32,
 * #1046): `bff_mailer_relay_events_total{event, provider, code}`. Label values
 * are bounded (two event kinds; three providers; SMTP/HTTP codes + errno
 * strings). Registered in the prom-client DEFAULT registry — the exposition
 * endpoint lands with the engineering-readiness Prometheus slice (DEBT.md).
 */
export const MAILER_RELAY_EVENTS_METRIC = "bff_mailer_relay_events_total";

type RelayLabel = "event" | "provider" | "code";

/**
 * Get-or-create the relay counter in the default registry — idempotent across
 * repeated construction (prom-client throws on a duplicate registration) and
 * across `register.clear()` in tests.
 */
function relayCounter(): Counter<RelayLabel> {
  const existing = register.getSingleMetric(MAILER_RELAY_EVENTS_METRIC);
  if (existing) return existing as Counter<RelayLabel>;
  return new Counter<RelayLabel>({
    name: MAILER_RELAY_EVENTS_METRIC,
    help: "BFF mailer relay events (003 EARS-32): failovers and relay failures by provider and provider response code.",
    labelNames: ["event", "provider", "code"],
  });
}

/**
 * The observability port of the 003 §14.3 failover chain (EARS-32, #1046).
 * `SmtpMailer.dispatch` reports every channel switch and every fail-closed
 * send here; the unit specs inject a recording fake.
 *
 * EARS-30 contract for callers: every `detail` field handed in is ALREADY
 * redacted (the one-time code never reaches a sink through this port).
 */
export interface RelayObservability {
  /** The active channel rejected the send and the chain switched (EARS-31). */
  failover(event: FailoverEvent): void;
  /** Every channel failed — the send failed closed with all provider codes. */
  relayFailure(event: RelayFailureEvent): void;
}

export type CaptureLevel = "warning" | "error";

/** Sink overrides for the unit specs; production uses Logger + Sentry defaults. */
export interface RelayObservabilitySinks {
  warn?: ((line: string) => void) | undefined;
  error?: ((line: string) => void) | undefined;
  /** GlitchTip event sink — defaults to `Sentry.captureMessage` (no-op without a DSN). */
  capture?: ((message: string, level: CaptureLevel) => void) | undefined;
}

/**
 * Production {@link RelayObservability} (003 EARS-32): every failover and
 * relay failure emits the triple the spec mandates —
 *
 * 1. a STRUCTURED log line (JSON: event, mail-class context, provider,
 *    provider response code — never a recipient, never a code payload);
 * 2. a Prometheus counter increment labelled `{event, provider, code}` — the
 *    dashboards distinguish "healthy" / "mail.ru saturated, Resend carrying" /
 *    "channel dead" from these series;
 * 3. a GlitchTip event (`Sentry.captureMessage`; PII-stripped by the
 *    `initSentry` config, a no-op when the DSN is unset — dev-stand / CI).
 *
 * Degraded-channel state is thereby visible, never silent: a failover logs at
 * WARN (the send still delivered), a relay failure at ERROR (fail-closed).
 */
export class DefaultRelayObservability implements RelayObservability {
  private static readonly logger = new Logger("MailerRelay");
  private readonly warn: (line: string) => void;
  private readonly error: (line: string) => void;
  private readonly capture: (message: string, level: CaptureLevel) => void;

  constructor(sinks: RelayObservabilitySinks = {}) {
    this.warn =
      sinks.warn ?? ((line) => DefaultRelayObservability.logger.warn(line));
    this.error =
      sinks.error ?? ((line) => DefaultRelayObservability.logger.error(line));
    this.capture =
      sinks.capture ??
      ((message, level) => {
        Sentry.captureMessage(message, level);
      });
  }

  failover(event: FailoverEvent): void {
    this.warn(
      JSON.stringify({
        event: "mailer_failover",
        context: event.context,
        provider: event.from,
        code: event.code,
        failover_to: event.to,
        ...(event.detail ? { detail: truncate(event.detail) } : {}),
      }),
    );
    relayCounter().inc({
      event: "failover",
      provider: event.from,
      code: event.code,
    });
    this.capture(
      `BFF mailer failover: ${event.from} → ${event.to} (${event.code}) on ${event.context}`,
      "warning",
    );
  }

  relayFailure(event: RelayFailureEvent): void {
    this.error(
      JSON.stringify({
        event: "mailer_relay_failure",
        context: event.context,
        attempts: event.attempts.map((a: RelayAttempt) => ({
          provider: a.provider,
          code: a.code,
          ...(a.detail ? { detail: truncate(a.detail) } : {}),
        })),
      }),
    );
    for (const attempt of event.attempts) {
      relayCounter().inc({
        event: "relay_failure",
        provider: attempt.provider,
        code: attempt.code,
      });
    }
    this.capture(
      `BFF mailer relay failure on ${event.context}: ${event.attempts
        .map((a) => `${a.provider}=${a.code}`)
        .join(", ")} — send failed closed`,
      "error",
    );
  }
}

/** Keep log lines bounded — provider rejections can quote whole payloads. */
function truncate(detail: string): string {
  return detail.length > 300 ? `${detail.slice(0, 300)}…` : detail;
}

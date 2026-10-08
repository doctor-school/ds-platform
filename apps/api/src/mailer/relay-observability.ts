import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { Counter, register } from "prom-client";
import type { AttemptOutcome } from "./relay-channel.js";

/** 003 EARS-32 terminal chain outcomes. */
export type ChainOutcome =
  | `accepted-by-${string}`
  | "stopped-recipient-permanent"
  | "stopped-ambiguous"
  | "stopped-budget"
  | "exhausted";

/** One provider attempt with its EARS-45 class. `code` is ALREADY bounded. */
export interface RelayAttempt {
  /** The actual provider called — `postbox` / `mail.ru` / `resend` / `mailpit`. */
  provider: string;
  outcome: AttemptOutcome;
  /** SMTP `451` / `550 5.1.1`, HTTP `429`, an errno label or `accepted`. */
  code: string;
}

export interface AttemptEvent extends RelayAttempt {
  /** Mail-class context (e.g. `verification-code email`) — never a recipient. */
  context: string;
}

/** Exactly one per send (003 EARS-32). */
export interface ChainEvent {
  context: string;
  outcome: ChainOutcome;
  /** Disabled or absent chain channels — never counted as reserve. */
  skipped: number;
  attempts: RelayAttempt[];
}

/** Invalid selected configuration; nothing was sent anywhere. */
export interface ConfigurationErrorEvent {
  context: string;
  provider: string;
}

/**
 * Prometheus counter for every attempt, terminal chain outcome and
 * configuration error (003 EARS-32): `bff_mailer_relay_events_total{event,
 * provider, outcome, code, skipped}`. Registered in the prom-client DEFAULT
 * registry — the exposition endpoint lands with the engineering-readiness
 * Prometheus slice (DEBT.md).
 */
export const MAILER_RELAY_EVENTS_METRIC = "bff_mailer_relay_events_total";

type RelayLabel = "event" | "provider" | "outcome" | "code" | "skipped";

/** Get-or-create in the default registry — idempotent across `register.clear()`. */
function relayCounter(): Counter<RelayLabel> {
  const existing = register.getSingleMetric(MAILER_RELAY_EVENTS_METRIC);
  if (existing) return existing as Counter<RelayLabel>;
  return new Counter<RelayLabel>({
    name: MAILER_RELAY_EVENTS_METRIC,
    help: "BFF mailer relay events (003 EARS-32): attempts by actual provider and outcome class, terminal chain outcomes, configuration errors.",
    labelNames: ["event", "provider", "outcome", "code", "skipped"],
  });
}

/**
 * The observability port of the 003 §14.3 chain (EARS-32). `SmtpMailer`
 * reports every attempt, one terminal outcome per send and configuration
 * errors here; the unit specs inject a recording fake. Callers hand in bounded
 * codes only (EARS-30).
 */
export interface RelayObservability {
  attempt(event: AttemptEvent): void;
  chain(event: ChainEvent): void;
  configurationError(event: ConfigurationErrorEvent): void;
}

export type CaptureLevel = "warning" | "error";

/** Sink overrides for the unit specs; production uses Logger + Sentry defaults. */
export interface RelayObservabilitySinks {
  log?: ((line: string) => void) | undefined;
  warn?: ((line: string) => void) | undefined;
  error?: ((line: string) => void) | undefined;
  /** GlitchTip event sink — defaults to `Sentry.captureMessage` (no-op without a DSN). */
  capture?: ((message: string, level: CaptureLevel) => void) | undefined;
}

/**
 * Production {@link RelayObservability} (003 EARS-32): a structured log line
 * and a counter increment per event; GlitchTip receives degraded acceptance
 * (warning), every non-accepted chain and every configuration error (error).
 * Acceptance is recorded as `accepted`, never as delivery.
 */
export class DefaultRelayObservability implements RelayObservability {
  private static readonly logger = new Logger("MailerRelay");
  private readonly log: (line: string) => void;
  private readonly warn: (line: string) => void;
  private readonly error: (line: string) => void;
  private readonly capture: (message: string, level: CaptureLevel) => void;

  constructor(sinks: RelayObservabilitySinks = {}) {
    this.log =
      sinks.log ?? ((line) => DefaultRelayObservability.logger.log(line));
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

  attempt(event: AttemptEvent): void {
    const line = JSON.stringify({
      event: "mailer_attempt",
      context: event.context,
      provider: event.provider,
      outcome: event.outcome,
      code: event.code,
    });
    if (event.outcome === "accepted") this.log(line);
    else this.warn(line);
    relayCounter().inc({
      event: "attempt",
      provider: event.provider,
      outcome: event.outcome,
      code: event.code,
      skipped: "",
    });
  }

  chain(event: ChainEvent): void {
    const accepted = event.outcome.startsWith("accepted-by-");
    const last = event.attempts.at(-1);
    const line = JSON.stringify({
      event: "mailer_chain",
      context: event.context,
      outcome: event.outcome,
      skipped: event.skipped,
      attempts: event.attempts.map((a) => ({
        provider: a.provider,
        outcome: a.outcome,
        code: a.code,
      })),
    });
    if (accepted && event.attempts.length === 1) this.log(line);
    else if (accepted) this.warn(line);
    else this.error(line);
    relayCounter().inc({
      event: "chain",
      provider: last?.provider ?? "none",
      outcome: event.outcome,
      code: last?.code ?? "none",
      skipped: String(event.skipped),
    });
    const summary = event.attempts
      .map((a) => `${a.provider}=${a.code}`)
      .join(", ");
    if (!accepted)
      this.capture(
        `BFF mailer ${event.outcome} on ${event.context}: ${summary} — send failed closed`,
        "error",
      );
    else if (event.attempts.length > 1)
      this.capture(
        `BFF mailer degraded ${event.outcome} on ${event.context}: ${summary}`,
        "warning",
      );
  }

  configurationError(event: ConfigurationErrorEvent): void {
    this.error(
      JSON.stringify({
        event: "mailer_configuration_error",
        context: event.context,
        provider: event.provider,
        code: "configuration",
      }),
    );
    relayCounter().inc({
      event: "configuration",
      provider: event.provider,
      outcome: "configuration",
      code: "configuration",
      skipped: "",
    });
    this.capture(
      `BFF mailer configuration error on ${event.context} (${event.provider}) — send failed closed`,
      "error",
    );
  }
}

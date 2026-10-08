import { Logger } from "@nestjs/common";
import { Gauge, register } from "prom-client";
import type { FeatureFlags } from "../feature-flags/feature-flags.types.js";

/** 003 EARS-46 per-channel readiness states. */
export type ReadinessState =
  "disabled" | "absent" | "configured-unverified" | "probe-failed" | "verified";

export const READINESS_STATES: readonly ReadinessState[] = [
  "disabled",
  "absent",
  "configured-unverified",
  "probe-failed",
  "verified",
];

/** Position in the 003 §14.3 chain. */
export type ChainRole = "primary" | "reserve" | "resend";

/** One chain channel's statement — no secret, credential or address (EARS-30). */
export interface ChannelReadiness {
  role: ChainRole;
  provider: string;
  state: ReadinessState;
}

/** What the delivery reconcile consumes (003 EARS-46). */
export interface MailerReadinessSource {
  statement(): ChannelReadiness[];
  onChange(listener: (statement: ChannelReadiness[]) => void): () => void;
}

/** DI token for the mailer-owned readiness monitor. */
export const MAILER_READINESS = Symbol("MAILER_READINESS");

export const MAILER_CHANNEL_READINESS_METRIC = "mailer_channel_readiness";

/** Only `verified` reserves count as operational reserve (003 EARS-46). */
export function operationalReserve(statement: ChannelReadiness[]): string[] {
  return statement
    .filter((c) => c.role !== "primary" && c.state === "verified")
    .map((c) => c.provider);
}

function readinessGauge(): Gauge<"provider" | "state"> {
  const existing = register.getSingleMetric(MAILER_CHANNEL_READINESS_METRIC);
  if (existing) return existing as Gauge<"provider" | "state">;
  return new Gauge<"provider" | "state">({
    name: MAILER_CHANNEL_READINESS_METRIC,
    help: "BFF mailer chain channel readiness (003 EARS-46): 1 for the current state of each provider.",
    labelNames: ["provider", "state"],
  });
}

/**
 * Holds the latest readiness statement, refreshed by a probe at startup and on
 * every real-email flag change (003 EARS-46). Publishes a structured log line
 * and the `mailer_channel_readiness{provider,state}` gauge.
 */
export class MailerReadinessMonitor implements MailerReadinessSource {
  private static readonly logger = new Logger("MailerReadiness");
  private current: ChannelReadiness[];
  private readonly listeners = new Set<(s: ChannelReadiness[]) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private readonly log: (line: string) => void;

  constructor(
    private readonly probe: () => Promise<ChannelReadiness[]>,
    initial: ChannelReadiness[],
    sinks: { log?: (line: string) => void } = {},
  ) {
    this.current = initial;
    this.log = sinks.log ?? ((line) => MailerReadinessMonitor.logger.log(line));
  }

  statement(): ChannelReadiness[] {
    return this.current.map((c) => ({ ...c }));
  }

  onChange(listener: (statement: ChannelReadiness[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Probe now; concurrent triggers run one after another. */
  refresh(): Promise<ChannelReadiness[]> {
    const run = this.queue.then(async () => {
      this.current = await this.probe();
      this.publish();
      return this.statement();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Startup probe plus one per real-email flag change. */
  start(flags: Pick<FeatureFlags, "onChange">): void {
    this.unsubscribe = flags.onChange(() => {
      void this.refresh().catch(() => undefined);
    });
    void this.refresh().catch(() => undefined);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private publish(): void {
    const gauge = readinessGauge();
    const seen = new Set<string>();
    for (const channel of this.current) {
      if (seen.has(channel.provider)) continue;
      seen.add(channel.provider);
      for (const state of READINESS_STATES)
        gauge.set(
          { provider: channel.provider, state },
          state === channel.state ? 1 : 0,
        );
    }
    this.log(
      JSON.stringify({
        event: "mailer_channel_readiness",
        channels: this.current,
        operational_reserve: operationalReserve(this.current),
      }),
    );
    for (const listener of this.listeners) listener(this.statement());
  }
}

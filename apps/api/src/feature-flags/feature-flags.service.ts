import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  FeatureFlags,
  FlagName,
} from "./feature-flags.types.js";

/**
 * The narrow slice of the Unleash server SDK (`unleash-client`) this service
 * consumes — `isEnabled(name, context, fallbackValue)`, the `changed` event, and
 * `destroy`. Declared as a local port (not `import type { Unleash }`) so the unit
 * spec injects a hand-rolled fake with no live SDK, no network, and no timers
 * (the `@ds/api` suite runs without an Unleash server — see the module factory).
 */
export interface UnleashLike {
  isEnabled(name: string, context?: unknown, fallbackValue?: boolean): boolean;
  on(event: "changed", listener: () => void): void;
  off?(event: "changed", listener: () => void): void;
  destroy(): void;
}

/**
 * Live runtime feature-flag reader (#185), wrapping the Unleash **server SDK**.
 *
 * It is bound by {@link FeatureFlagsModule} to a real `unleash-client` instance
 * when `UNLEASH_URL` + `UNLEASH_API_TOKEN` are configured, otherwise to a
 * null-client (`client = null`) so the api boots and every flag read resolves to
 * the caller's env default — the documented Unleash-unreachable fallback.
 *
 * Reads are **fail-soft**: {@link isEnabled} returns the caller's `defaultValue`
 * when the client is absent, when the flag is unknown, or if the SDK throws. The
 * caller owns the security posture: the bot-protection guard passes a fail-closed
 * default so an Unleash outage cannot silently open the gate (design §4).
 */
@Injectable()
export class FeatureFlagsService implements FeatureFlags, OnModuleDestroy {
  constructor(private readonly client: UnleashLike | null) {}

  isEnabled(flag: FlagName, defaultValue: boolean): boolean {
    if (!this.client) return defaultValue;
    try {
      // The SDK's third arg is the fallback value used when the toggle is
      // unknown OR the client has not synchronised yet — so an unreachable
      // Unleash (no successful poll) reads as `defaultValue`, never an
      // implicit `false`. A defensive try/catch keeps a faulty SDK call from
      // throwing into the request path; it degrades to the env default.
      return this.client.isEnabled(flag, undefined, defaultValue);
    } catch {
      return defaultValue;
    }
  }

  onChange(listener: () => void): () => void {
    const client = this.client;
    if (!client) return () => undefined;
    client.on("changed", listener);
    return () => client.off?.("changed", listener);
  }

  /**
   * Clean SDK shutdown (stops the background poll + metrics timers) so the api
   * process can exit on `SIGTERM` without a dangling interval. No-op in the
   * env-only fallback mode. Nest calls this when shutdown hooks are enabled.
   */
  onModuleDestroy(): void {
    this.client?.destroy();
  }
}
